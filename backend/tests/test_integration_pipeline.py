"""
Verifies the full existing pipeline (Member 1 placeholder -> Member 2 ->
Member 3) still works end-to-end after Member 2's changes, and that the
InvestigationResult model validates the richer response correctly.
"""

from models import InvestigationResult
from services.ais_service import find_vessels
from services.drift_service import estimate_origin
from services.ml_service import detect_spill
from fastapi.testclient import TestClient
from main import app
from data.synthetic_ais import MOCK_ORIGIN, MOCK_SPILL_TIME


def test_full_pipeline_runs_end_to_end(tmp_path):
    # Step 1: Member 1's placeholder detection (unchanged, still works)
    dummy_image_path = tmp_path / "dummy.png"
    dummy_image_path.write_bytes(b"not a real image, just a placeholder")
    spill = detect_spill(str(dummy_image_path))
    assert "confidence" in spill and "area_km2" in spill

    # Step 2: Member 2's geometry + drift pipeline
    origin_result = estimate_origin(12.9, 74.7, mask=spill.get("mask"))
    assert "latitude" in origin_result and "longitude" in origin_result
    assert origin_result["geometry"]["valid"] is True

    # Step 3: Member 3's vessel scoring (unchanged, still works)
    vessels = find_vessels(origin_result["latitude"], origin_result["longitude"])
    assert len(vessels) > 0
    assert all("score" in v for v in vessels)

    # Step 4: everything validates against the (extended) response model
    result = InvestigationResult(
        spill=spill,
        origin={
            "latitude": origin_result["latitude"],
            "longitude": origin_result["longitude"],
            "uncertainty_km": origin_result["uncertainty_km"],
        },
        vessels=vessels,
        geometry=origin_result["geometry"],
        prediction=origin_result["prediction"],
    )

    assert result.geometry.valid is True
    assert result.prediction.predicted_polygon_geojson is not None
    assert result.origin.uncertainty_km >= 0


def test_old_style_origin_response_still_validates():
    """An OriginResult built the OLD way (no uncertainty_km given) must
    still validate, since the field has a default -- this is the backward
    compatibility guarantee for anyone else's code still building it that way."""
    from models import OriginResult

    old_style = OriginResult(latitude=12.9, longitude=74.7)
    assert old_style.uncertainty_km == 0.0


def test_investigate_endpoint_returns_integrated_response():
    client = TestClient(app)
    response = client.post(
        "/api/investigate",
        data={"latitude": 12.9, "longitude": 74.7, "timestamp": MOCK_SPILL_TIME},
        files={"image": ("test.png", b"not a real image", "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert {"spill", "origin", "geometry", "prediction", "vessels"} <= body.keys()
    assert body["origin"]["uncertainty_km"] >= 0
    assert body["geometry"]["valid"] is True
    for vessel in body["vessels"]:
        assert vessel["id"] == vessel["mmsi"]
        assert vessel["name"]
        assert "score" in vessel and "reasons" in vessel
        assert "confidence" in vessel and "risk_level" in vessel


def test_suspects_endpoint_preserves_attribution_fields():
    client = TestClient(app)
    response = client.post(
        "/api/suspects",
        json={
            **MOCK_ORIGIN,
            "spill_time": MOCK_SPILL_TIME,
            "uncertainty_km": 3.5,
        },
    )

    assert response.status_code == 200
    vessels = response.json()["vessels"]
    assert vessels
    assert all(v["id"] == v["mmsi"] for v in vessels)
    assert all(v["name"] and v["reasons"] for v in vessels)
