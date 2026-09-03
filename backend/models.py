from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class SpillResult(BaseModel):
    confidence: float
    area_km2: float


class OriginResult(BaseModel):
    latitude: float
    longitude: float
    # Member 2 addition. Default keeps this backward compatible with any
    # existing caller that builds an OriginResult without this field.
    uncertainty_km: float = 0.0


class AISGap(BaseModel):
    """Member 3 -- a detected AIS transmission gap for a vessel."""
    gap_start: str
    gap_end: str
    gap_duration_minutes: float


class VesselResult(BaseModel):
    id: str
    name: str
    score: float
    reasons: List[str]
    mmsi: Optional[str] = None
    # --- Member 3 additions (all optional so older callers/tests still validate) ---
    risk_level: Optional[str] = None
    confidence: Optional[float] = None
    distance_km: Optional[float] = None
    time_difference_minutes: Optional[float] = None
    trajectory_alignment: Optional[float] = None
    ais_anomalies: Optional[List[AISGap]] = None
    score_breakdown: Optional[Dict[str, float]] = None


class SpillGeometryResult(BaseModel):
    """Member 2 -- mask -> polygon geometry output."""
    valid: bool
    area_km2: float
    centroid: Optional[Dict[str, float]] = None
    polygon_geojson: Optional[Dict[str, Any]] = None
    shape: Optional[Dict[str, Any]] = None


class DriftPredictionResult(BaseModel):
    """Member 2 -- forward drift output."""
    predicted_polygon_geojson: Optional[Dict[str, Any]] = None
    forward_hours: float


class InvestigationResult(BaseModel):
    spill: SpillResult
    origin: OriginResult
    vessels: List[VesselResult]
    # Member 2 additions -- optional so this stays backward compatible with
    # any existing frontend code still only reading spill/origin/vessels.
    geometry: Optional[SpillGeometryResult] = None
    prediction: Optional[DriftPredictionResult] = None


class InvestigationRequest(BaseModel):
    latitude: float
    longitude: float
    timestamp: str
    image_path: str


class SuspectRequest(BaseModel):
    """Member 3 -- request body for the standalone /api/suspects endpoint."""
    latitude: float
    longitude: float
    spill_time: str
    uncertainty_km: float = 3.5


class AttributionResponse(BaseModel):
    """Member 3 -- response body for the standalone /api/suspects endpoint."""
    vessels: List[VesselResult]
