"""
Backward-compatible wrapper around services/ais_attribution.py.

`find_vessels(latitude, longitude, ...)` is what main.py's /api/investigate
endpoint calls. The real Member 3 implementation lives in
ais_attribution.py (get_vessel_attribution), which takes the full
origin/spill_time/AIS interface described in the spec and returns richer
vessel dicts keyed by "mmsi" (plus fields like "name"/"movement_direction"
not exposed on the API's VesselResult schema).

`to_vessel_result_dicts()` below is the single shared place that adapts
those raw dicts down to the VesselResult schema shape ("id" instead of
"mmsi", only the exposed fields). It's used both by find_vessels() (for
/api/investigate) and directly by main.py's /api/suspects endpoint, so the
mapping only needs to be correct in one place.
"""

from services.ais_attribution import get_vessel_attribution


def to_vessel_result_dicts(raw_vessels: list) -> list:
    """
    Adapts get_vessel_attribution()'s raw vessel dicts (keyed by "mmsi")
    to the shape the API's VesselResult/AttributionResponse models expect
    (keyed by "id"). Shared by both /api/investigate and /api/suspects so
    there's one mapping to keep correct, not two copies that can drift.
    """
    return [
        {
            "id": v["mmsi"],
            "mmsi": v["mmsi"],
            "name": v.get("name") or f"Unknown Vessel ({v['mmsi']})",
            "position": v.get("position"),
            "heading": v.get("heading"),
            "track_history": v.get("track_history"),
            "score": v["score"],
            "reasons": v["reasons"],
            "risk_level": v["risk_level"],
            "confidence": v["confidence"],
            "distance_km": v["distance_km"],
            "time_difference_minutes": v["time_difference_minutes"],
            "trajectory_alignment": v["trajectory_alignment"],
            "ais_anomalies": v["ais_anomalies"],
            "score_breakdown": v["score_breakdown"],
        }
        for v in raw_vessels
    ]


def find_vessels(latitude: float, longitude: float, spill_time=None,
                  ais_data=None, uncertainty_km: float = None):
    """
    Thin adapter kept for backward compatibility with main.py.
    Prefer calling get_vessel_attribution() directly for new code.
    """
    origin = {"latitude": latitude, "longitude": longitude}

    if spill_time is None:
        # No spill time was supplied by the caller (older integration) --
        # fall back to the synthetic dataset's mock spill time so the
        # pipeline still runs deterministically end-to-end.
        from data.synthetic_ais import MOCK_SPILL_TIME
        spill_time = MOCK_SPILL_TIME

    result = get_vessel_attribution(
        origin=origin,
        spill_time=spill_time,
        ais_data=ais_data,
        uncertainty_km=uncertainty_km,
    )

    return to_vessel_result_dicts(result["vessels"])
