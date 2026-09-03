"""
Member 2 — Geometry extraction.

Converts a binary spill mask (numpy array) into a real-world polygon,
using a configurable pixel -> lat/lon transform.

This is intentionally dependency-light (numpy + opencv only, both already
used elsewhere in this kind of project) rather than pulling in shapely/
pyproj, since a hand-rolled equirectangular projection is accurate enough
at spill scale (a few km) and keeps this module easy to run anywhere
without extra installs. If the team later wants shapely for more complex
geometry work, this module's output format (plain GeoJSON dicts) drops
into `shapely.geometry.shape(...)` without any changes needed here.

Public API:
    get_geometry(mask, bounding_box=None) -> dict
    generate_demo_mask(size=256, seed=42) -> np.ndarray
    DEMO_BOUNDING_BOX
"""

from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Demo bounding box: a placeholder real-world extent for un-georeferenced
# mask/images. Swap for the real georeferenced bounds of the SAR scene once
# Member 1's model provides a mask that comes with its own transform.
# ---------------------------------------------------------------------------
DEMO_BOUNDING_BOX: Dict[str, float] = {
    "lat_max": 13.05,
    "lat_min": 12.75,
    "lon_min": 74.55,
    "lon_max": 74.85,
}

EARTH_RADIUS_M = 6_371_000.0


def generate_demo_mask(size: int = 256, seed: int = 42) -> np.ndarray:
    """
    Creates a synthetic binary spill mask so Member 2's pipeline can be
    built and tested without waiting on Member 1's real model.

    Returns a (size, size) uint8 array, 1 = oil pixel, 0 = background.
    """
    rng = np.random.default_rng(seed)
    mask = np.zeros((size, size), dtype=np.uint8)

    cx = size // 2 + int(rng.integers(-20, 20))
    cy = size // 2 + int(rng.integers(-20, 20))
    axes = (int(rng.integers(30, 55)), int(rng.integers(20, 40)))
    angle = int(rng.integers(0, 180))

    cv2.ellipse(mask, (cx, cy), axes, angle, 0, 360, color=1, thickness=-1)

    # light irregularity so it isn't a perfect ellipse (more realistic-looking)
    noise = (rng.random((size, size)) > 0.985).astype(np.uint8)
    mask = np.clip(mask + noise, 0, 1).astype(np.uint8)
    return mask


def _pixel_to_latlon(
    px: float, py: float, mask_shape: Tuple[int, int], bbox: Dict[str, float]
) -> Tuple[float, float]:
    """
    Linear demo transform: maps a pixel coordinate to lat/lon across the
    given bounding box. This is a placeholder for real georeferencing
    (e.g. a rasterio affine transform) once Member 1 supplies a properly
    georeferenced SAR image/mask.
    """
    h, w = mask_shape
    lon = bbox["lon_min"] + (px / w) * (bbox["lon_max"] - bbox["lon_min"])
    lat = bbox["lat_max"] - (py / h) * (bbox["lat_max"] - bbox["lat_min"])
    return lat, lon


def _largest_contour_px(mask: np.ndarray, min_area_px: float = 15.0) -> Optional[np.ndarray]:
    """Returns the largest contour in the mask as an (N, 2) array of
    (x, y) pixel coordinates, or None if no valid contour is found."""
    mask_u8 = (mask > 0).astype(np.uint8)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contours = [c for c in contours if cv2.contourArea(c) >= min_area_px]
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    if len(largest) < 3:
        return None

    return largest.reshape(-1, 2)  # (N, 2) pixel points, dtype int


def _polygon_area_km2(latlon_points: list) -> float:
    """
    Shoelace-formula polygon area, computed on a local equirectangular
    projection (accurate for small extents like a spill, a few km wide).
    latlon_points: list of (lat, lon) tuples forming a closed-ish ring.
    """
    if len(latlon_points) < 3:
        return 0.0

    mean_lat_rad = np.radians(np.mean([lat for lat, _ in latlon_points]))
    xs, ys = [], []
    for lat, lon in latlon_points:
        x = np.radians(lon) * np.cos(mean_lat_rad) * EARTH_RADIUS_M
        y = np.radians(lat) * EARTH_RADIUS_M
        xs.append(x)
        ys.append(y)

    area_m2 = 0.0
    n = len(xs)
    for i in range(n):
        j = (i + 1) % n
        area_m2 += xs[i] * ys[j] - xs[j] * ys[i]
    area_m2 = abs(area_m2) / 2.0

    return area_m2 / 1_000_000.0  # -> km^2


def _centroid_latlon(mask: np.ndarray, bbox: Dict[str, float]) -> Optional[Tuple[float, float]]:
    """Centroid of the mask (via image moments), converted to lat/lon."""
    mask_u8 = (mask > 0).astype(np.uint8)
    moments = cv2.moments(mask_u8, binaryImage=True)
    if moments["m00"] == 0:
        return None
    cx = moments["m10"] / moments["m00"]
    cy = moments["m01"] / moments["m00"]
    return _pixel_to_latlon(cx, cy, mask.shape, bbox)


def get_geometry(
    mask: Optional[np.ndarray],
    bounding_box: Optional[Dict[str, float]] = None,
    georeferencing: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Convert a binary spill mask into a geo-referenced polygon + area + centroid.

    Args:
        mask: 2D numpy array (H, W). Nonzero = oil pixel.
              None, empty, or all-zero -> safe "invalid" response.
        bounding_box: dict with lat_max/lat_min/lon_min/lon_max describing
              the real-world extent of the mask. Defaults to DEMO_BOUNDING_BOX.
          georeferencing: optional dict containing ``image_path``. When supplied,
                    the mask is mapped through geo_service's CRS/GCP-aware
                    transform instead of the demo bounding-box transform.

    Returns a dict:
        {
          "valid": bool,
          "area_km2": float,
          "centroid": {"latitude": float, "longitude": float} | None,
          "polygon_geojson": {"type": "Polygon", "coordinates": [[[lon, lat], ...]]} | None,
          "shape": {"elongation": float, "bounds": [minlon, minlat, maxlon, maxlat]} | None,
        }
    """
    bbox = bounding_box or DEMO_BOUNDING_BOX
    invalid_response = {
        "valid": False,
        "area_km2": 0.0,
        "centroid": None,
        "polygon_geojson": None,
        "shape": None,
    }

    if mask is None or not isinstance(mask, np.ndarray) or mask.size == 0:
        return invalid_response
    if mask.sum() == 0:
        return invalid_response

    contour_px = _largest_contour_px(mask)
    if contour_px is None:
        return invalid_response

    if georeferencing and georeferencing.get("image_path"):
        from services.geo_service import mask_to_polygons

        polygons = mask_to_polygons(mask, georeferencing["image_path"])
        if not polygons:
            return invalid_response

        polygon = max(polygons, key=lambda item: _polygon_area_km2(item["polygon_latlon"]))
        latlon_points = polygon["polygon_latlon"]
        area_km2 = _polygon_area_km2(latlon_points)
        centroid_lat, centroid_lon = polygon["centroid_latlon"]
        lats = [lat for lat, _ in latlon_points]
        lons = [lon for _, lon in latlon_points]
        minlat, maxlat = min(lats), max(lats)
        minlon, maxlon = min(lons), max(lons)
        width = max(maxlon - minlon, 1e-9)
        height = max(maxlat - minlat, 1e-9)
        elongation = max(width, height) / min(width, height)
        ring = [[lon, lat] for lat, lon in latlon_points]
        if ring[0] != ring[-1]:
            ring.append(ring[0])

        return {
            "valid": area_km2 > 0,
            "area_km2": round(area_km2, 3),
            "centroid": {"latitude": centroid_lat, "longitude": centroid_lon},
            "polygon_geojson": {"type": "Polygon", "coordinates": [ring]},
            "shape": {
                "elongation": round(float(elongation), 2),
                "bounds": [minlon, minlat, maxlon, maxlat],
            },
        }

    latlon_points = [
        _pixel_to_latlon(float(x), float(y), mask.shape, bbox) for x, y in contour_px
    ]

    area_km2 = _polygon_area_km2(latlon_points)
    if area_km2 == 0.0:
        return invalid_response

    centroid = _centroid_latlon(mask, bbox)
    if centroid is None:
        return invalid_response
    centroid_lat, centroid_lon = centroid

    lats = [lat for lat, _ in latlon_points]
    lons = [lon for _, lon in latlon_points]
    minlat, maxlat = min(lats), max(lats)
    minlon, maxlon = min(lons), max(lons)
    width = max(maxlon - minlon, 1e-9)
    height = max(maxlat - minlat, 1e-9)
    elongation = max(width, height) / min(width, height)

    # GeoJSON wants (lon, lat) ordering, and the ring should be closed
    ring = [[lon, lat] for lat, lon in latlon_points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    return {
        "valid": True,
        "area_km2": round(area_km2, 3),
        "centroid": {"latitude": centroid_lat, "longitude": centroid_lon},
        "polygon_geojson": {"type": "Polygon", "coordinates": [ring]},
        "shape": {
            "elongation": round(float(elongation), 2),
            "bounds": [minlon, minlat, maxlon, maxlat],
        },
    }
