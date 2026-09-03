"""
Member 3 (AIS / Vessel Attribution) configuration.

Every tunable weight / threshold used by the attribution pipeline lives
here so the scoring behaviour can be adjusted without touching any
service code. A plain Python dict (rather than YAML/JSON) is used so no
new dependency is introduced -- the repo currently has none of the
common config-file libraries.

To tune the system, edit AIS_CONFIG below (or override programmatically
by passing a `config` dict into `get_vessel_attribution`).
"""

AIS_CONFIG = {
    # ---- Scoring weights (must sum to 1.0) --------------------------------
    "weights": {
    "distance_weight": 0.30,
    "time_weight": 0.20,
    "trajectory_weight": 0.20,
    "presence_weight": 0.10,
    "ais_anomaly_weight": 0.05,

    # NEW
    "speed_weight": 0.05,
    "vessel_type_weight": 0.10,
    },

    # ---- Candidate filtering ----------------------------------------------
    "candidate_radius_km": 20,
    "candidate_time_window_hours": 6,

    # ---- Time scoring -------------------------------------------------------
    # A vessel seen shortly *before*/*around* the spill is weighted more
    # heavily than one seen only *after* it (still evidence, just weaker).
    "presence_window_minutes": 30,      # "around the spill time" window
    "after_spill_time_penalty": 0.6,    # multiplier applied to time_score if vessel only seen after spill

    # ---- Gap detection ------------------------------------------------------
    "gap_threshold_minutes": 10,        # consecutive missing pings >= this = a "gap"
    "gap_near_spill_window_minutes": 60,  # a gap overlapping this window around spill_time counts as an anomaly

    # ---- Risk classification -------------------------------------------------
    "risk_thresholds": {
    "HIGH": 70,
    "MEDIUM": 45,
        # anything below MEDIUM threshold -> LOW
    },

    # ---- Confidence (uncertainty quantification) -----------------------------
    "confidence_weights": {
        "data_completeness": 0.5,
        "point_density": 0.3,
        "origin_uncertainty": 0.2,
    },
    "min_points_expected": 3,  # AIS points expected in the candidate window for full "point density" confidence

    # ---- Performance --------------------------------------------------------
    # Coarse bounding-box pre-filter (in degrees) applied before precise
    # Haversine distance calculations, to cheaply discard far-away vessels
    # when scanning large AIS datasets (tens of thousands of records).
    "bbox_prefilter_deg_per_km": 1 / 111.0,
}


def get_config(overrides: dict = None) -> dict:
    """
    Return the active config, optionally shallow-merged with caller-provided
    overrides (e.g. for tests, or future per-region tuning).
    """
    if not overrides:
        return AIS_CONFIG

    merged = {**AIS_CONFIG, **overrides}
    for key in ("weights", "risk_thresholds", "confidence_weights"):
        if key in overrides:
            merged[key] = {**AIS_CONFIG[key], **overrides[key]}
        else:
            merged[key] = AIS_CONFIG[key]
    return merged
