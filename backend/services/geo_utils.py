"""
Geospatial utilities for Member 3.

The repository does not currently depend on GeoPandas / Shapely / PyProj /
PostGIS (see backend/requirements.txt), so this module implements the
standard spherical-earth formulas (Haversine + cross-track distance)
instead of a naive Euclidean approximation.

If a geospatial library is added to the project later, these functions
should be swapped for the library's equivalents (e.g. `shapely` geometry +
a projected CRS, or PostGIS `ST_Distance`) rather than duplicated -- the
call signatures below are intentionally simple (plain lat/lon floats in,
km out) so that swap is a drop-in change for callers.
"""

from math import radians, sin, cos, asin, sqrt, atan2, acos

EARTH_RADIUS_KM = 6371.0088


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in kilometres."""
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    a = min(1.0, max(0.0, a))  # guard against float rounding pushing this slightly out of [0, 1]
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def bearing_rad(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing (radians) from point 1 to point 2."""
    phi1, phi2 = radians(lat1), radians(lat2)
    dlambda = radians(lon2 - lon1)
    y = sin(dlambda) * cos(phi2)
    x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlambda)
    return atan2(y, x)


def bbox_prefilter_deg(radius_km: float) -> float:
    """Cheap degrees-per-km conversion for a coarse lat/lon bounding-box filter."""
    return radius_km / 111.0


def point_within_bbox(lat: float, lon: float, center_lat: float, center_lon: float, radius_km: float) -> bool:
    """
    Cheap O(1) bounding-box check used to discard obviously-far vessels
    before running the more expensive Haversine calculation over a large
    AIS dataset.
    """
    delta_deg = bbox_prefilter_deg(radius_km)
    return (
        abs(lat - center_lat) <= delta_deg
        and abs(lon - center_lon) <= delta_deg / max(cos(radians(center_lat)), 0.01)
    )


def segment_distance_km(lat1: float, lon1: float, lat2: float, lon2: float,
                         lat0: float, lon0: float) -> float:
    """
    Minimum distance (km) from point (lat0, lon0) to the great-circle
    segment running from (lat1, lon1) to (lat2, lon2).

    Used for trajectory analysis: how close did a vessel's path come to
    the estimated spill origin, not just its individual AIS pings.
    """
    if lat1 == lat2 and lon1 == lon2:
        return haversine_distance_km(lat1, lon1, lat0, lon0)

    seg_len_km = haversine_distance_km(lat1, lon1, lat2, lon2)
    d13_km = haversine_distance_km(lat1, lon1, lat0, lon0)

    ang_d13 = d13_km / EARTH_RADIUS_KM
    brng13 = bearing_rad(lat1, lon1, lat0, lon0)
    brng12 = bearing_rad(lat1, lon1, lat2, lon2)

    sin_dxt = sin(ang_d13) * sin(brng13 - brng12)
    sin_dxt = min(1.0, max(-1.0, sin_dxt))  # guard against float rounding
    cross_track_km = asin(sin_dxt) * EARTH_RADIUS_KM

    cos_ratio = cos(ang_d13) / cos(cross_track_km / EARTH_RADIUS_KM)
    cos_ratio = min(1.0, max(-1.0, cos_ratio))  # guard against float rounding
    along_track_km = acos(cos_ratio) * EARTH_RADIUS_KM

    if along_track_km < 0:
        return d13_km
    if along_track_km > seg_len_km:
        return haversine_distance_km(lat2, lon2, lat0, lon0)
    return abs(cross_track_km)
