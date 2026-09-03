"""
Member 3 test suite.

Covers all cases required by the spec:
    1.  vessel very close to origin
    2.  vessel far from origin
    3.  vessel present at the wrong time
    4.  vessel trajectory passing near origin
    5.  vessel moving away from origin
    6.  AIS gap detection
    7.  invalid coordinates
    8.  duplicate AIS records
    9.  no candidate vessels
    10. multiple candidate vessels
    11. correct ranking
    12. score always between 0 and 100
    13. correct evidence/reasons
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.ais_attribution import get_vessel_attribution
from services.ais_preprocessing import preprocess_ais_records, detect_gaps, validate_record
from data.synthetic_ais import get_synthetic_ais_dataset, MOCK_ORIGIN, MOCK_SPILL_TIME, MOCK_UNCERTAINTY_KM


def _run():
    return get_vessel_attribution(
        origin=MOCK_ORIGIN,
        spill_time=MOCK_SPILL_TIME,
        ais_data=get_synthetic_ais_dataset(),
        uncertainty_km=MOCK_UNCERTAINTY_KM,
    )


def _vessel(result, mmsi):
    return next(v for v in result["vessels"] if v["mmsi"] == mmsi)


# 1. vessel very close to origin
def test_vessel_close_to_origin_scores_high_distance_component():
    result = _run()
    v = _vessel(result, "111111111")  # MV CLOSEWATCH
    assert v["distance_km"] < 5
    assert v["score_breakdown"]["distance"] > 20


# 2. vessel far from origin
def test_vessel_far_from_origin_excluded_as_candidate():
    result = _run()
    mmsis = [v["mmsi"] for v in result["vessels"]]
    assert "222222222" not in mmsis  # MV FARAWAY, ~200km away, outside candidate_radius_km


# 3. vessel present at the wrong time
def test_vessel_present_at_wrong_time_excluded():
    result = _run()
    mmsis = [v["mmsi"] for v in result["vessels"]]
    assert "333333333" not in mmsis  # MV WRONGTIME, near origin but ~10hrs before window


# 4. vessel trajectory passing near origin
def test_trajectory_passing_near_origin_scores_well_on_trajectory():
    result = _run()
    v = _vessel(result, "444444444")  # MV PASSTHROUGH
    assert v["trajectory_alignment"] > 0.5


# 5. vessel moving away from origin
def test_vessel_moving_away_has_lower_score_than_vessel_staying_close():
    result = _run()
    departing = _vessel(result, "555555555")   # MV DEPARTING
    closewatch = _vessel(result, "111111111")  # MV CLOSEWATCH
    assert departing["score"] < closewatch["score"]


# 6. AIS gap detection
def test_gap_detection_finds_gap_for_vessel_1():
    records = preprocess_ais_records(get_synthetic_ais_dataset())["vessels"]["111111111"]
    gaps = detect_gaps(records, gap_threshold_minutes=10)
    assert len(gaps) >= 1
    assert gaps[0]["gap_duration_minutes"] >= 10


def test_gap_is_supporting_evidence_not_definitive():
    # anomaly weight should never dominate the total score by itself
    result = _run()
    v = _vessel(result, "111111111")
    assert v["score_breakdown"]["anomaly"] <= 10  # default ais_anomaly_weight is 0.10 of 100


# 7. invalid coordinates
def test_invalid_coordinates_are_reported_not_silently_dropped():
    is_valid, reason = validate_record({
        "mmsi": "999", "timestamp": "2026-08-20T14:00:00",
        "latitude": 999, "longitude": 74.0,
    })
    assert is_valid is False
    assert "latitude" in reason

    preprocessed = preprocess_ais_records(get_synthetic_ais_dataset())
    assert preprocessed["invalid_count"] >= 1
    assert any("latitude" in e["reason"] for e in preprocessed["errors"])


# 8. duplicate AIS records
def test_duplicate_records_are_removed():
    preprocessed = preprocess_ais_records(get_synthetic_ais_dataset())
    assert preprocessed["duplicate_count"] >= 1


# 9. no candidate vessels
def test_no_candidates_returns_empty_list_not_error():
    result = get_vessel_attribution(
        origin={"latitude": 0.0, "longitude": 0.0},  # nowhere near any synthetic vessel
        spill_time=MOCK_SPILL_TIME,
        ais_data=get_synthetic_ais_dataset(),
    )
    assert result == {"vessels": []}


# 10. multiple candidate vessels
def test_multiple_candidates_returned():
    result = _run()
    assert len(result["vessels"]) >= 2


# 11. correct ranking
def test_vessels_ranked_descending_by_score():
    result = _run()
    scores = [v["score"] for v in result["vessels"]]
    assert scores == sorted(scores, reverse=True)


# 12. score always between 0 and 100
def test_scores_always_in_valid_range():
    result = _run()
    for v in result["vessels"]:
        assert 0 <= v["score"] <= 100
        assert 0 <= v["confidence"] <= 1
        assert v["risk_level"] in ("HIGH", "MEDIUM", "LOW")
        assert sum(v["score_breakdown"].values()) == v["score"]


# 13. correct evidence/reasons
def test_reasons_are_generated_and_reference_actual_values():
    result = _run()
    v = _vessel(result, "111111111")
    assert len(v["reasons"]) > 0
    assert any(str(v["distance_km"]) in r for r in v["reasons"])


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
