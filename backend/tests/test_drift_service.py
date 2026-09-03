import numpy as np
import pytest

from services.drift_service import (
    DEMO_CURRENT,
    DEMO_WIND,
    backward_hindcast,
    estimate_origin,
    forward_prediction,
)
from services.geometry_service import generate_demo_mask, get_geometry


REFERENCE_LAT, REFERENCE_LON = 12.9, 74.7


def test_backward_hindcast_returns_valid_shape():
    result = backward_hindcast(REFERENCE_LAT, REFERENCE_LON, DEMO_WIND, DEMO_CURRENT)

    assert "latitude" in result
    assert "longitude" in result
    assert result["uncertainty_km"] >= 0
    assert result["elapsed_hours_assumed"] > 0


def test_backward_hindcast_moves_opposite_to_drift():
    """The origin estimate should be displaced in roughly the opposite
    direction to the drift vector, relative to the current position."""
    result = backward_hindcast(REFERENCE_LAT, REFERENCE_LON, DEMO_WIND, DEMO_CURRENT)

    # with this demo wind/current (both blowing toward south-ish/south-east),
    # walking backward should move the origin north/west of the reference point
    assert result["latitude"] != REFERENCE_LAT
    assert result["longitude"] != REFERENCE_LON


def test_backward_and_forward_are_roughly_inverse():
    """Projecting forward then backward by the same elapsed time should
    land close to the starting point (sanity check on the vector math)."""
    from services.drift_service import _combined_drift_vector, _project_point

    vx, vy = _combined_drift_vector(DEMO_WIND, DEMO_CURRENT)
    seconds = 4 * 3600

    forward_lat, forward_lon = _project_point(REFERENCE_LAT, REFERENCE_LON, vx, vy, seconds)
    back_lat, back_lon = _project_point(forward_lat, forward_lon, -vx, -vy, seconds)

    assert back_lat == pytest.approx(REFERENCE_LAT, abs=1e-6)
    assert back_lon == pytest.approx(REFERENCE_LON, abs=1e-6)


def test_uncertainty_grows_with_wider_time_range():
    narrow = backward_hindcast(
        REFERENCE_LAT, REFERENCE_LON, DEMO_WIND, DEMO_CURRENT,
        elapsed_hours_candidates=[4, 5],
    )
    wide = backward_hindcast(
        REFERENCE_LAT, REFERENCE_LON, DEMO_WIND, DEMO_CURRENT,
        elapsed_hours_candidates=[1, 12],
    )
    assert wide["uncertainty_km"] > narrow["uncertainty_km"]


def test_forward_prediction_with_polygon_changes_position():
    mask = generate_demo_mask()
    geometry = get_geometry(mask)
    assert geometry["valid"]

    prediction = forward_prediction(
        geometry["polygon_geojson"],
        geometry["centroid"]["latitude"],
        geometry["centroid"]["longitude"],
        DEMO_WIND,
        DEMO_CURRENT,
        forward_hours=6,
    )

    predicted = prediction["predicted_polygon_geojson"]
    assert predicted["type"] == "Polygon"

    original_ring = geometry["polygon_geojson"]["coordinates"][0]
    predicted_ring = predicted["coordinates"][0]
    assert original_ring[0] != predicted_ring[0]  # actually moved


def test_forward_prediction_without_polygon_falls_back_to_point():
    prediction = forward_prediction(
        None, REFERENCE_LAT, REFERENCE_LON, DEMO_WIND, DEMO_CURRENT
    )
    assert prediction["predicted_polygon_geojson"]["type"] == "Point"


def test_estimate_origin_backward_compatible_signature():
    """The original call signature `estimate_origin(lat, lon)` must still work."""
    result = estimate_origin(REFERENCE_LAT, REFERENCE_LON)

    assert "latitude" in result
    assert "longitude" in result
    assert "uncertainty_km" in result


def test_estimate_origin_uses_demo_mask_when_none_provided():
    result = estimate_origin(REFERENCE_LAT, REFERENCE_LON)
    assert result["demo_data_used"]["used_demo_mask"] is True
    assert result["geometry"]["valid"] is True


def test_estimate_origin_accepts_real_mask():
    mask = generate_demo_mask(seed=99)
    result = estimate_origin(REFERENCE_LAT, REFERENCE_LON, mask=mask)
    assert result["demo_data_used"]["used_demo_mask"] is False
    assert result["geometry"]["valid"] is True


def test_estimate_origin_handles_empty_mask_safely():
    empty_mask = np.zeros((256, 256), dtype=np.uint8)
    result = estimate_origin(REFERENCE_LAT, REFERENCE_LON, mask=empty_mask)

    # geometry extraction fails -> falls back to caller lat/lon as centroid
    assert result["geometry"]["valid"] is False
    assert "latitude" in result
    assert "longitude" in result
    assert result["prediction"]["predicted_polygon_geojson"] is not None


def test_estimate_origin_includes_prediction_and_geojson():
    result = estimate_origin(REFERENCE_LAT, REFERENCE_LON)
    assert result["prediction"]["predicted_polygon_geojson"]["type"] in ("Polygon", "Point")
    assert result["geometry"]["polygon_geojson"]["type"] == "Polygon"


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
