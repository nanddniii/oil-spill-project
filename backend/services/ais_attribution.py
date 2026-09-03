"""
Member 3 -- AIS / Vessel Attribution.

Public entry point: get_vessel_attribution(origin, spill_time, ais_data, ...)

Pipeline:
    raw AIS records
        -> preprocessing (validate, dedupe, sort, group, gap detection)
        -> candidate filtering (bbox pre-filter -> radius + time window)
        -> per-candidate distance / time / trajectory analysis
        -> scoring (explainable, configurable weights)
        -> ranked vessels with reasons, risk_level, confidence

This module is intentionally decoupled from FastAPI / Member 4's API layer,
and from Member 1 & 2's real outputs -- it only depends on the plain
`origin` / `spill_time` / `ais_data` shapes described in the spec, so it
can be developed, tested, and swapped in independently.
"""

from datetime import datetime

from config.ais_config import get_config
from services import geo_utils
from services.ais_preprocessing import preprocess_ais_records, detect_gaps, _parse_timestamp
from services.scoring import calculate_vessel_score, calculate_confidence


# ---------------------------------------------------------------------------
# Pluggable data-source interfaces (Future NTRO Enhancement)
# ---------------------------------------------------------------------------
# These let ais_data / vessel_registry be swapped for live sources later
# (live AIS streams, satellite detections from Member 1, historical vessel
# databases, blacklisted/repeat-offender registries) without changing the
# scoring pipeline itself. For now, get_vessel_attribution() also accepts a
# plain list of dicts directly, which is what the synthetic dataset and the
# tests use.

class AISDataSource:
    """Interface a future live/streaming AIS source would implement."""

    def fetch(self, start_time: datetime, end_time: datetime, bbox: dict = None) -> list:
        raise NotImplementedError


class StaticAISDataSource(AISDataSource):
    """Wraps an in-memory list of AIS records (synthetic data, a CSV load, etc.)."""

    def __init__(self, records: list):
        self._records = records

    def fetch(self, start_time: datetime, end_time: datetime, bbox: dict = None) -> list:
        return self._records


def _parse_time(value):
    parsed = _parse_timestamp(value)
    if parsed is None:
        raise ValueError(f"invalid spill timestamp '{value}'")
    return parsed


def _reconstruct_trajectory_min_distance(records: list, origin_lat: float, origin_lon: float):
    """Min distance (km) from any segment of the vessel's path to the origin."""
    if len(records) < 2:
        if not records:
            return None
        return geo_utils.haversine_distance_km(
            records[0]["latitude"], records[0]["longitude"], origin_lat, origin_lon
        )

    min_dist = None
    for prev, curr in zip(records, records[1:]):
        d = geo_utils.segment_distance_km(
            prev["latitude"], prev["longitude"],
            curr["latitude"], curr["longitude"],
            origin_lat, origin_lon,
        )
        if min_dist is None or d < min_dist:
            min_dist = d
    return min_dist


def _movement_direction_summary(records: list) -> str:
    """Human-readable overall movement direction, from first to last ping."""
    if len(records) < 2:
        return "insufficient data"
    import math
    bearing = math.degrees(geo_utils.bearing_rad(
        records[0]["latitude"], records[0]["longitude"],
        records[-1]["latitude"], records[-1]["longitude"],
    )) % 360
    compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    idx = round(bearing / 45) % 8
    return compass[idx]


def _build_reasons(
    distance_km,
    time_difference_minutes,
    trajectory_min_distance_km,
    trajectory_component,
    presence_near_spill,
    gaps_near_spill,
    config,
    vessel_type=None,
    speed=None,
) -> list:
    reasons = []

    if distance_km is not None:
        reasons.append(f"{distance_km} km from estimated spill origin")

    if time_difference_minutes is not None:
        abs_min = round(abs(time_difference_minutes))
        if abs_min <= config["presence_window_minutes"]:
            reasons.append(f"Present within {abs_min} minutes of estimated spill time")
        elif time_difference_minutes < 0:
            reasons.append(f"Present {abs_min} minutes before estimated spill time")
        else:
            reasons.append(f"Present {abs_min} minutes after estimated spill time")

    if trajectory_min_distance_km is not None:
        if trajectory_component >= 60:
            reasons.append(f"Trajectory passed within {trajectory_min_distance_km} km of estimated origin")
        else:
            reasons.append("Trajectory does not closely align with estimated origin")

        if not presence_near_spill:
            reasons.append(
            "No AIS ping found close to the estimated spill time"
        )

    for gap in gaps_near_spill:
        reasons.append(
            f"AIS gap detected for {gap['gap_duration_minutes']} minutes near the spill window"
        )

    if vessel_type:
        reasons.append(
            f"Vessel type identified as {vessel_type}"
        )

    if speed is not None:
        reasons.append(
            f"Recorded speed near spill window: {round(speed, 1)} knots"
        )

    return reasons


def _candidate_bbox_filter(records: list, origin_lat: float, origin_lon: float, radius_km: float) -> list:
    """Cheap pre-filter to cut down expensive Haversine calls on large datasets."""
    return [
        r for r in records
        if geo_utils.point_within_bbox(r["latitude"], r["longitude"], origin_lat, origin_lon, radius_km)
    ]


def get_vessel_attribution(origin: dict, spill_time, ais_data: list = None,
                            uncertainty_km: float = None, config: dict = None,
                            vessel_registry: dict = None) -> dict:
    """
    Main Member 3 entry point.

    Args:
        origin: {"latitude": float, "longitude": float}  (Member 2's estimated spill origin)
        spill_time: ISO-8601 string or datetime
        ais_data: list of raw AIS record dicts. If None, the synthetic dev dataset is used.
        uncertainty_km: optional radius of uncertainty around `origin` (Member 2 output), used in confidence scoring.
        config: optional override dict merged over config/ais_config.py defaults.
        vessel_registry: optional {mmsi: {"blacklisted": bool, "notes": str}} lookup
            (Future NTRO Enhancement hook -- historical/repeat-offender vessel records).

    Returns:
        {"vessels": [ ... ranked, descending by score ... ]}
        Never raises just because no vessels qualify -- returns {"vessels": []} instead.
    """
    cfg = get_config(config)

    if ais_data is None:
        from data.synthetic_ais import get_synthetic_ais_dataset
        ais_data = get_synthetic_ais_dataset()

    origin_lat, origin_lon = origin["latitude"], origin["longitude"]
    spill_dt = _parse_time(spill_time)
    radius_km = cfg["candidate_radius_km"]
    window_minutes = cfg["candidate_time_window_hours"] * 60

    # --- 1. Preprocess ------------------------------------------------------
    preprocessed = preprocess_ais_records(ais_data)
    vessels_by_mmsi = preprocessed["vessels"]

    # --- 2. Candidate filtering + per-vessel analysis ------------------------
    ranked_vessels = []

    for mmsi, records in vessels_by_mmsi.items():
        # cheap bbox pre-filter (performance, for large datasets) before
        # any precise Haversine work
        bbox_hits = _candidate_bbox_filter(records, origin_lat, origin_lon, radius_km)
        if not bbox_hits:
            continue

        # time-window filter
        window_hits = [
            r for r in records
            if abs((r["timestamp"] - spill_dt).total_seconds() / 60.0) <= window_minutes
        ]
        if not window_hits:
            continue

        # precise distance filter/analysis over all of the vessel's records
        # (not just bbox_hits) so the true closest point is found
        distances = [
            (r, geo_utils.haversine_distance_km(r["latitude"], r["longitude"], origin_lat, origin_lon))
            for r in records
        ]
        closest_record, min_distance_km = min(distances, key=lambda pair: pair[1])
        if min_distance_km > radius_km:
            continue  # not actually a spatial candidate

        # --- Time analysis ---
        time_difference_minutes = (closest_record["timestamp"] - spill_dt).total_seconds() / 60.0

        presence_candidates = [
            (r, (r["timestamp"] - spill_dt).total_seconds() / 60.0) for r in window_hits
        ]
        closest_presence_record, closest_presence_minutes = min(
            presence_candidates, key=lambda pair: abs(pair[1])
        )
        has_presence_near_spill = abs(closest_presence_minutes) <= cfg["presence_window_minutes"]

        # --- Trajectory analysis ---
        trajectory_min_distance_km = _reconstruct_trajectory_min_distance(records, origin_lat, origin_lon)
        direction = _movement_direction_summary(records)

        # --- AIS gap detection (scoped to this vessel) ---
        all_gaps = detect_gaps(records, cfg["gap_threshold_minutes"])
        gaps_near_spill = [
            g for g in all_gaps
            if abs((datetime.fromisoformat(g["gap_start"]) - spill_dt).total_seconds() / 60.0)
            <= cfg["gap_near_spill_window_minutes"]
            or abs((datetime.fromisoformat(g["gap_end"]) - spill_dt).total_seconds() / 60.0)
            <= cfg["gap_near_spill_window_minutes"]
        ]
        gap_near_spill = len(gaps_near_spill) > 0
        gap_duration_minutes = max((g["gap_duration_minutes"] for g in gaps_near_spill), default=0)

        # --- Scoring ---
        result = calculate_vessel_score(
    distance_km=round(min_distance_km, 2),

    time_difference_minutes=time_difference_minutes,

    trajectory_min_distance_km=(
        round(trajectory_min_distance_km, 2)
        if trajectory_min_distance_km is not None
        else None
    ),

    has_presence_near_spill=has_presence_near_spill,

    closest_presence_minutes=closest_presence_minutes,

    gap_near_spill=gap_near_spill,

    gap_duration_minutes=gap_duration_minutes,

    vessel_type=records[0].get("vessel_type"),

    speed=closest_record.get("speed"),

    config=config,
)

        # --- Confidence (uncertainty quantification on the ranking itself) ---
        window_span_minutes = window_minutes * 2
        total_gap_minutes_in_window = sum(
            g["gap_duration_minutes"] for g in all_gaps
            if abs((datetime.fromisoformat(g["gap_start"]) - spill_dt).total_seconds() / 60.0) <= window_minutes
        )
        data_completeness = max(0.0, 1 - (total_gap_minutes_in_window / window_span_minutes))
        point_density = min(1.0, len(window_hits) / cfg["min_points_expected"])
        if uncertainty_km:
            origin_uncertainty_factor = max(0.0, 1 - (uncertainty_km / radius_km))
        else:
            origin_uncertainty_factor = 1.0
        confidence = calculate_confidence(data_completeness, point_density, origin_uncertainty_factor, config)

        # --- Future NTRO hook: repeat-offender / blacklist registry ---
        registry_reason = None
        if vessel_registry and mmsi in vessel_registry and vessel_registry[mmsi].get("blacklisted"):
            registry_reason = "Vessel appears in the repeat-offender/blacklist registry"

        reasons = _build_reasons(
            distance_km=round(min_distance_km, 2),
            time_difference_minutes=time_difference_minutes,
            trajectory_min_distance_km=(
                round(trajectory_min_distance_km, 2) if trajectory_min_distance_km is not None else None
            ),
            trajectory_component=result["component_scores"]["trajectory"],
            presence_near_spill=has_presence_near_spill,
            gaps_near_spill=gaps_near_spill,
            config=cfg,
            vessel_type=records[0].get("vessel_type"),
            speed=closest_record.get("speed"),
        )
        if registry_reason:
            reasons.append(registry_reason)

        ranked_vessels.append({
            "mmsi": mmsi,
            "name": records[0].get("vessel_name", "UNKNOWN"),
            "score": result["score"],
            "risk_level": result["risk_level"],
            "confidence": confidence,
            "distance_km": round(min_distance_km, 2),
            "time_difference_minutes": round(time_difference_minutes, 1),
            "trajectory_alignment": round(result["component_scores"]["trajectory"] / 100.0, 2),
            "movement_direction": direction,
            "ais_anomalies": all_gaps,
            "score_breakdown": result["score_breakdown"],
            "reasons": reasons,
        })

    ranked_vessels.sort(key=lambda v: v["score"], reverse=True)

    return {"vessels": ranked_vessels}
