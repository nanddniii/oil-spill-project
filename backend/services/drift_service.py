"""
Member 2 — Drift / hindcast service.

Implements a simple, explainable, physics-informed drift model:

    combined surface drift velocity = ocean current + (wind_factor * wind)

wind_factor = 0.03 is a widely used first-order rule of thumb in oil-spill
drift literature (surface oil moves at roughly 3% of wind speed, in the
wind's direction, on top of the ocean current).

Used for:
  - backward hindcast: estimate the spill's origin point + an uncertainty
    radius, by walking the drift vector backward over a small range of
    plausible elapsed times.
  - forward prediction: project the current spill polygon forward in time
    to approximate future spread.

This is intentionally a PROTOTYPE simplification:
  - no turbulent diffusion / spreading, no evaporation or weathering,
    no wave-driven Stokes drift, no real oceanographic reanalysis data.
  - The upgrade path is to swap DEMO_WIND / DEMO_CURRENT for real
    historical reanalysis values (ERA5 wind, HYCOM/Copernicus Marine
    currents) and eventually replace this whole module's projection logic
    with a Lagrangian particle-tracking engine such as OpenDrift.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from services.geometry_service import (
    DEMO_BOUNDING_BOX,
    generate_demo_mask,
    get_geometry,
)

WIND_FACTOR = 0.03  # ~3% of wind speed contributes to surface drift

# ---------------------------------------------------------------------------
# Demo wind/current values. Clearly labeled prototype placeholders -- swap
# for a real historical value (looked up for the specific incident's date
# and location) when available. direction_deg = compass bearing the flow
# is heading TOWARDS (0 = north, 90 = east), kept consistent for both.
# ---------------------------------------------------------------------------
DEMO_WIND: Dict[str, float] = {"speed_mps": 6.5, "direction_deg": 210}
DEMO_CURRENT: Dict[str, float] = {"speed_mps": 0.3, "direction_deg": 160}

DEFAULT_ELAPSED_HOURS_CANDIDATES: List[float] = [2, 4, 6, 8]
DEFAULT_FORWARD_HOURS = 6.0

EARTH_RADIUS_M = 6_371_000.0


def _to_xy(speed_mps: float, direction_deg: float) -> Tuple[float, float]:
    """Decomposes a speed + compass direction into (east, north) m/s components."""
    rad = math.radians(direction_deg)
    return speed_mps * math.sin(rad), speed_mps * math.cos(rad)


def _combined_drift_vector(
    wind: Dict[str, float], current: Dict[str, float]
) -> Tuple[float, float]:
    """Combined surface drift velocity (east, north) in m/s."""
    wx, wy = _to_xy(wind["speed_mps"] * WIND_FACTOR, wind["direction_deg"])
    cx, cy = _to_xy(current["speed_mps"], current["direction_deg"])
    return wx + cx, wy + cy


def _project_point(
    lat: float, lon: float, vx: float, vy: float, seconds: float
) -> Tuple[float, float]:
    """
    Moves a lat/lon point by a velocity vector (m/s) over `seconds`, using
    a small-distance equirectangular approximation. Accurate enough at
    spill/drift scale (tens of km); not meant for long-range navigation.
    """
    dlat = (vy * seconds) / 111_320.0
    dlon = (vx * seconds) / (111_320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r_km = EARTH_RADIUS_M / 1000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r_km * math.asin(min(1.0, math.sqrt(a)))


def backward_hindcast(
    centroid_lat: float,
    centroid_lon: float,
    wind: Dict[str, float],
    current: Dict[str, float],
    elapsed_hours_candidates: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    Estimates the spill origin by walking the drift vector backward from the
    current centroid, over a small range of plausible elapsed times (since
    the true elapsed time since release is unknown). The spread across that
    range becomes the reported uncertainty radius.
    """
    elapsed_hours_candidates = elapsed_hours_candidates or DEFAULT_ELAPSED_HOURS_CANDIDATES
    if not elapsed_hours_candidates:
        raise ValueError("elapsed_hours_candidates must contain at least one value")

    vx, vy = _combined_drift_vector(wind, current)

    candidate_points = []
    for hours in elapsed_hours_candidates:
        seconds = hours * 3600
        lat, lon = _project_point(centroid_lat, centroid_lon, -vx, -vy, seconds)
        candidate_points.append((lat, lon))

    mid_idx = len(candidate_points) // 2
    origin_lat, origin_lon = candidate_points[mid_idx]

    uncertainty_km = max(
        _haversine_km(origin_lat, origin_lon, lat, lon) for lat, lon in candidate_points
    )

    return {
        "latitude": origin_lat,
        "longitude": origin_lon,
        "uncertainty_km": round(uncertainty_km, 2),
        "elapsed_hours_assumed": elapsed_hours_candidates[mid_idx],
        "candidate_elapsed_hours": elapsed_hours_candidates,
    }


def forward_prediction(
    polygon_geojson: Optional[Dict[str, Any]],
    centroid_lat: float,
    centroid_lon: float,
    wind: Dict[str, float],
    current: Dict[str, float],
    forward_hours: float = DEFAULT_FORWARD_HOURS,
) -> Dict[str, Any]:
    """
    Translates the current spill polygon forward by the drift vector to
    approximate future spread.

    Simplification: this TRANSLATES the polygon rather than also spreading/
    diffusing it -- a real spill also grows and thins over time, which this
    prototype does not model. Flagged here and in the project docs.
    """
    vx, vy = _combined_drift_vector(wind, current)
    seconds = forward_hours * 3600

    if polygon_geojson and polygon_geojson.get("type") == "Polygon":
        ring = polygon_geojson["coordinates"][0]  # [[lon, lat], ...]
        new_ring = []
        for lon, lat in ring:
            new_lat, new_lon = _project_point(lat, lon, vx, vy, seconds)
            new_ring.append([new_lon, new_lat])
        predicted_geojson = {"type": "Polygon", "coordinates": [new_ring]}
    else:
        # No polygon available (e.g. geometry extraction failed) -- fall
        # back to moving just the centroid point so callers still get
        # *something* renderable.
        new_lat, new_lon = _project_point(centroid_lat, centroid_lon, vx, vy, seconds)
        predicted_geojson = {"type": "Point", "coordinates": [new_lon, new_lat]}

    return {
        "predicted_polygon_geojson": predicted_geojson,
        "forward_hours": forward_hours,
    }


def estimate_origin(
    latitude: float,
    longitude: float,
    mask=None,
    bounding_box: Optional[Dict[str, float]] = None,
    georeferencing: Optional[Dict[str, str]] = None,
    wind: Optional[Dict[str, float]] = None,
    current: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Main entry point used by main.py.

    Backward-compatible with the original placeholder's signature --
    `estimate_origin(latitude, longitude)` still works unchanged, since
    mask/bounding_box/wind/current are all optional. This lets the rest of
    the app keep calling this function exactly as before while gaining the
    full geometry + drift pipeline underneath.

    - If a real spill mask is supplied (from Member 1's model, once ready),
      geometry is computed from it.
    - If not, falls back to a small demo mask so the pipeline is testable
      and demoable end-to-end today, without waiting on Member 1.
    - If geometry extraction fails for any reason (e.g. an empty/invalid
      mask), falls back to the caller-supplied lat/lon as the spill
      location, so the endpoint always returns a usable result.

    Returns:
        {
          "latitude": float,          # estimated origin
          "longitude": float,         # estimated origin
          "uncertainty_km": float,
          "geometry": {...},          # see geometry_service.get_geometry()
          "prediction": {...},        # see forward_prediction()
          "demo_data_used": {...}     # what placeholder inputs were used, for transparency
        }
    """
    wind = wind or DEMO_WIND
    current = current or DEMO_CURRENT
    bbox = bounding_box or DEMO_BOUNDING_BOX

    used_demo_mask = mask is None
    if mask is None:
        mask = generate_demo_mask()

    geometry = get_geometry(
        mask,
        bounding_box=bbox,
        georeferencing=georeferencing if not used_demo_mask else None,
    )

    if geometry["valid"]:
        centroid_lat = geometry["centroid"]["latitude"]
        centroid_lon = geometry["centroid"]["longitude"]
    else:
        # Geometry extraction failed -- fall back to the caller-supplied
        # spill location so the endpoint still returns something usable.
        centroid_lat, centroid_lon = latitude, longitude

    origin = backward_hindcast(centroid_lat, centroid_lon, wind, current)
    prediction = forward_prediction(
        geometry.get("polygon_geojson"), centroid_lat, centroid_lon, wind, current
    )

    return {
        "latitude": origin["latitude"],
        "longitude": origin["longitude"],
        "uncertainty_km": origin["uncertainty_km"],
        "geometry": geometry,
        "prediction": prediction,
        "demo_data_used": {
            "used_demo_mask": used_demo_mask,
            "wind": wind,
            "current": current,
            "bounding_box": bbox,
            "elapsed_hours_assumed": origin["elapsed_hours_assumed"],
            "note": (
                "wind/current/bounding_box are prototype placeholder values; "
                "replace with real historical data + Member 1's georeferenced "
                "mask when available."
            ),
        },
    }
