"""
Member 3 explainable vessel attribution scoring.

Design goals (per spec):
    - deterministic
    - explainable (score_breakdown per factor)
    - configurable (weights/thresholds come from config/ais_config.py)
    - never a black box
"""

from config.ais_config import get_config


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def score_distance(min_distance_km: float, candidate_radius_km: float) -> float:
    """Closer to origin => higher score. Linear decay to 0 at candidate_radius_km."""
    if min_distance_km is None:
        return 0.0
    return _clamp(100.0 * (1 - min_distance_km / candidate_radius_km))


def score_time(time_difference_minutes: float, candidate_window_minutes: float,
               after_spill_penalty: float) -> float:
    """
    Closer to spill_time => higher score. Vessels seen only *after* the
    spill are discounted (still evidence, but weaker than before/around).
    """
    if time_difference_minutes is None:
        return 0.0
    raw = _clamp(100.0 * (1 - abs(time_difference_minutes) / candidate_window_minutes))
    if time_difference_minutes > 0:  # vessel seen after the spill time
        raw *= after_spill_penalty
    return _clamp(raw)


def score_trajectory(trajectory_min_distance_km: float, candidate_radius_km: float) -> float:
    """Trajectory passing close to origin => higher score."""
    if trajectory_min_distance_km is None:
        return 0.0
    return _clamp(100.0 * (1 - trajectory_min_distance_km / candidate_radius_km))


def score_presence(has_presence_near_spill: bool, closest_presence_minutes: float,
                    presence_window_minutes: float) -> float:
    """Was the vessel actually transmitting near the spill time (not just close on paper)?"""
    if closest_presence_minutes is None:
        return 0.0
    if has_presence_near_spill:
        return 100.0
    return _clamp(100.0 * (1 - abs(closest_presence_minutes) / (presence_window_minutes * 4)))


def score_ais_anomaly(gap_near_spill: bool, gap_duration_minutes: float) -> float:
    """
    A transmission gap overlapping the spill window is *supporting* evidence
    only (low weight by default) -- never treated as proof by itself.
    """
    if not gap_near_spill:
        return 0.0
    return _clamp(min(100.0, 40.0 + gap_duration_minutes))  # longer gap -> slightly higher, capped


def score_speed(speed: float) -> float:
    """
    Speed-based scoring.

    Moderate speeds near a spill area are slightly more suspicious than
    very high speeds. This is only a supporting factor.
    """

    if speed is None:
        return 30.0

    if speed < 2:
        return 90.0

    if speed < 8:
        return 100.0

    if speed < 15:
        return 70.0

    if speed < 25:
        return 40.0

    return 10.0


def score_vessel_type(vessel_type: str) -> float:
    """
    Vessel-type prior.

    Tankers are more plausible oil-spill candidates than fishing vessels,
    but this should never dominate the overall score.
    """

    if vessel_type is None:
        return 30.0

    vessel_type = str(vessel_type).lower()

    mapping = {
        "tanker": 100,
        "oil tanker": 100,
        "chemical tanker": 95,
        "cargo": 70,
        "bulk carrier": 60,
        "container": 60,
        "fishing": 20,
        "passenger": 10,
    }

    return mapping.get(vessel_type, 30)


def classify_risk(score: float, config: dict = None) -> str:
    cfg = get_config(config)
    thresholds = cfg["risk_thresholds"]
    if score >= thresholds["HIGH"]:
        return "HIGH"
    if score >= thresholds["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


def calculate_confidence(data_completeness: float, point_density: float,
                          origin_uncertainty_factor: float, config: dict = None) -> float:
    """
    Confidence (0-1) in the *attribution ranking itself* -- how much AIS
    evidence backs this vessel's score -- not a guilt probability.
    """
    cfg = get_config(config)
    w = cfg["confidence_weights"]
    confidence = (
        w["data_completeness"] * data_completeness
        + w["point_density"] * point_density
        + w["origin_uncertainty"] * origin_uncertainty_factor
    )
    return round(max(0.0, min(1.0, confidence)), 2)


def calculate_vessel_score(
    distance_km: float,
    time_difference_minutes: float,
    trajectory_min_distance_km: float,
    has_presence_near_spill: bool,
    closest_presence_minutes: float,
    gap_near_spill: bool,
    gap_duration_minutes: float,
    vessel_type: str = None,
    speed: float = None,
    config: dict = None
) -> dict:
    """
    Combine all explainable factors into a final 0-100 score.

    Returns:
        {
            "score": float,
            "risk_level": str,
            "score_breakdown": {...},
            "component_scores": {...}
        }
    """

    cfg = get_config(config)
    weights = cfg["weights"]

    distance_component = score_distance(
        distance_km,
        cfg["candidate_radius_km"]
    )

    time_component = score_time(
        time_difference_minutes,
        cfg["candidate_time_window_hours"] * 60,
        cfg["after_spill_time_penalty"],
    )

    trajectory_component = score_trajectory(
        trajectory_min_distance_km,
        cfg["candidate_radius_km"]
    )

    presence_component = score_presence(
        has_presence_near_spill,
        closest_presence_minutes,
        cfg["presence_window_minutes"]
    )

    anomaly_component = score_ais_anomaly(
        gap_near_spill,
        gap_duration_minutes or 0
    )

    speed_component = score_speed(speed)

    vessel_type_component = score_vessel_type(
        vessel_type
    )

    contributions = {
        "distance": (
            distance_component
            * weights["distance_weight"]
        ),

        "time": (
            time_component
            * weights["time_weight"]
        ),

        "trajectory": (
            trajectory_component
            * weights["trajectory_weight"]
        ),

        "presence": (
            presence_component
            * weights["presence_weight"]
        ),

        "anomaly": (
            anomaly_component
            * weights["ais_anomaly_weight"]
        ),

        "speed": (
            speed_component
            * weights["speed_weight"]
        ),

        "vessel_type": (
            vessel_type_component
            * weights["vessel_type_weight"]
        ),
    }

    breakdown = {
        k: round(v)
        for k, v in contributions.items()
    }

    final_score = _clamp(
        sum(breakdown.values()),
        0.0,
        100.0
    )

    return {
        "score": round(final_score, 2),

        "risk_level": classify_risk(
            final_score,
            config
        ),

        "score_breakdown": breakdown,

        "component_scores": {
            "distance": round(distance_component, 2),
            "time": round(time_component, 2),
            "trajectory": round(trajectory_component, 2),
            "presence": round(presence_component, 2),
            "anomaly": round(anomaly_component, 2),

            "speed": round(speed_component, 2),

            "vessel_type": round(
                vessel_type_component,
                2
            ),
        },
    }


# --- Backward-compatible wrapper --------------------------------------------
# The original prototype scoring function. Kept so any existing caller
# (e.g. an older ais_service import) does not break; new code should use
# calculate_vessel_score() above.
def calculate_suspicion_score(proximity_score: float, timing_score: float,
                               trajectory_score: float, heading_score: float,
                               ais_anomaly_score: float) -> float:
    score = (
        proximity_score * 0.30
        + timing_score * 0.25
        + trajectory_score * 0.20
        + heading_score * 0.15
        + ais_anomaly_score * 0.10
    )
    return round(score, 2)
