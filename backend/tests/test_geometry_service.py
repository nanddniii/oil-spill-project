import numpy as np
import pytest

from services.geometry_service import (
    DEMO_BOUNDING_BOX,
    generate_demo_mask,
    get_geometry,
)


def test_demo_mask_has_oil_pixels():
    mask = generate_demo_mask()
    assert mask.sum() > 0


def test_valid_mask_produces_polygon():
    mask = generate_demo_mask()
    result = get_geometry(mask)

    assert result["valid"] is True
    assert result["area_km2"] > 0
    assert result["centroid"] is not None
    assert "latitude" in result["centroid"]
    assert "longitude" in result["centroid"]
    assert result["polygon_geojson"]["type"] == "Polygon"
    assert len(result["polygon_geojson"]["coordinates"][0]) >= 4  # closed ring


def test_centroid_within_bounding_box():
    mask = generate_demo_mask()
    result = get_geometry(mask)
    lat = result["centroid"]["latitude"]
    lon = result["centroid"]["longitude"]

    assert DEMO_BOUNDING_BOX["lat_min"] <= lat <= DEMO_BOUNDING_BOX["lat_max"]
    assert DEMO_BOUNDING_BOX["lon_min"] <= lon <= DEMO_BOUNDING_BOX["lon_max"]


def test_empty_mask_is_safe():
    mask = np.zeros((256, 256), dtype=np.uint8)
    result = get_geometry(mask)

    assert result["valid"] is False
    assert result["area_km2"] == 0.0
    assert result["centroid"] is None
    assert result["polygon_geojson"] is None


def test_none_mask_is_safe():
    result = get_geometry(None)
    assert result["valid"] is False
    assert result["area_km2"] == 0.0


def test_empty_array_mask_is_safe():
    result = get_geometry(np.array([]))
    assert result["valid"] is False


def test_custom_bounding_box_changes_coordinates():
    mask = generate_demo_mask()
    custom_bbox = {"lat_max": 20.0, "lat_min": 19.5, "lon_min": 70.0, "lon_max": 70.5}

    result_default = get_geometry(mask)
    result_custom = get_geometry(mask, bounding_box=custom_bbox)

    assert result_default["centroid"] != result_custom["centroid"]
    assert 19.5 <= result_custom["centroid"]["latitude"] <= 20.0
    assert 70.0 <= result_custom["centroid"]["longitude"] <= 70.5


def test_larger_mask_gives_larger_area():
    small_mask = np.zeros((256, 256), dtype=np.uint8)
    small_mask[120:136, 120:136] = 1  # 16x16 blob

    large_mask = np.zeros((256, 256), dtype=np.uint8)
    large_mask[80:176, 80:176] = 1  # 96x96 blob

    small_result = get_geometry(small_mask)
    large_result = get_geometry(large_mask)

    assert large_result["area_km2"] > small_result["area_km2"]


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
