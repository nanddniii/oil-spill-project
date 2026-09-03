from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from models import (
    InvestigationResult,
    InvestigationRequest,
    SuspectRequest,
    AttributionResponse,
)

from services.ml_service import detect_spill
from services.drift_service import estimate_origin
from services.ais_service import find_vessels, to_vessel_result_dicts
from services.ais_attribution import get_vessel_attribution
import os
import uuid

# Member 1's real georeferencing module (reads actual SAR image bounding
# boxes via rasterio). Optional: it depends on rasterio, which may not be
# installed everywhere, and it only matters once a real georeferenced
# image is uploaded. If it's unavailable or the uploaded image isn't
# georeferenced (e.g. a plain PNG used for testing), we transparently fall
# back to Member 2's demo bounding box -- nothing else changes.
try:
    from services.geo_service import extract_image_metadata
    GEO_SERVICE_AVAILABLE = True
except ImportError:
    GEO_SERVICE_AVAILABLE = False


app = FastAPI(
    title="Oil Spill Investigation API",
    description="Backend for SIH26143",
    version="1.0.0"
)

# Dev-only CORS: allows a frontend served from a different origin/port (or
# opened directly as a file) to call this API during local development and
# demos. Tighten this (specific origins only) before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _real_bounding_box_or_none(image_path: str):
    """
    Tries to extract a real geographic bounding box from the uploaded
    image using Member 1's geo_service (real Sentinel-1 georeferencing).
    Returns None if unavailable for any reason -- missing dependency, a
    non-georeferenced test image, a corrupt file, etc. -- so the caller can
    fall back to Member 2's demo bounding box without special-casing.
    """
    if not GEO_SERVICE_AVAILABLE:
        return None
    try:
        meta = extract_image_metadata(image_path)
        bbox = meta.get("bounding_box") or {}
        if all(bbox.get(k) is not None for k in ("lat_max", "lat_min", "lon_min", "lon_max")):
            return bbox
    except Exception:
        # Not a georeferenced raster (e.g. a plain PNG/JPG test upload),
        # or rasterio couldn't open it -- this is expected for most test
        # uploads today, not an error worth surfacing to the caller.
        pass
    return None


@app.get("/")
def root():
    return {
        "message": "Oil Spill Investigation API is running"
    }


@app.post("/api/investigate", response_model=InvestigationResult)
async def investigate(
    latitude: float = Form(...),
    longitude: float = Form(...),
    timestamp: str = Form(...),
    image: UploadFile = File(...)
):
    # Create uploads folder if it doesn't exist
    os.makedirs("uploads", exist_ok=True)

    # Create a unique filename
    filename = f"{uuid.uuid4()}_{image.filename}"
    image_path = os.path.join("uploads", filename)

    # Save uploaded image
    image_data = await image.read()

    with open(image_path, "wb") as file:
        file.write(image_data)

    # Step 1: Detect oil spill (Member 1's model -- still a placeholder;
    # once it returns a real mask, pass spill.get("mask") below unchanged)
    spill = detect_spill(image_path)

    # Step 1b: use a real georeferenced bounding box if this image has one
    # (Member 1), otherwise Member 2's estimate_origin() falls back to its
    # own demo bounding box automatically.
    bounding_box = _real_bounding_box_or_none(image_path)

    # Step 2: Estimate origin -- geometry extraction + drift/hindcast
    # (Member 2). `mask` may later come from Member 1's real model; until
    # then this falls back to an internal demo mask automatically.
    origin_result = estimate_origin(
        latitude,
        longitude,
        mask=spill.get("mask") if isinstance(spill, dict) else None,
        bounding_box=bounding_box,
        georeferencing=(
            {"image_path": image_path}
            if isinstance(spill, dict) and spill.get("mask") is not None
            else None
        ),
    )

    # Step 3: Find and score nearby vessels (Member 3's real AIS
    # attribution pipeline). Member 2's uncertainty_km feeds directly into
    # Member 3's confidence calculation -- a tighter origin estimate means
    # higher confidence in the resulting vessel ranking.
    vessels = find_vessels(
        origin_result["latitude"],
        origin_result["longitude"],
        spill_time=timestamp,
        uncertainty_km=origin_result["uncertainty_km"],
    )

    return {
        "spill": spill,
        "origin": {
            "latitude": origin_result["latitude"],
            "longitude": origin_result["longitude"],
            "uncertainty_km": origin_result["uncertainty_km"],
        },
        "vessels": vessels,
        "geometry": origin_result["geometry"],
        "prediction": origin_result["prediction"],
    }


@app.post("/api/suspects", response_model=AttributionResponse)
async def suspects(request: SuspectRequest):
    """
    Member 3's standalone attribution endpoint -- re-scores vessels for a
    given origin/time/uncertainty without needing to re-run detection or
    drift. Useful for "what if the origin were here instead" investigation
    workflows, or for testing the AIS pipeline in isolation.
    """
    result = get_vessel_attribution(
        origin={
            "latitude": request.latitude,
            "longitude": request.longitude
        },
        spill_time=request.spill_time,
        uncertainty_km=request.uncertainty_km
    )

    # get_vessel_attribution() returns raw vessel dicts keyed by "mmsi" (plus
    # extra fields like "name"/"movement_direction" not in VesselResult).
    # to_vessel_result_dicts() is the same mapping /api/investigate uses,
    # so this endpoint's response actually validates against
    # AttributionResponse instead of failing on a missing "id" field.
    vessels = to_vessel_result_dicts(result["vessels"])

    return {"vessels": vessels}
