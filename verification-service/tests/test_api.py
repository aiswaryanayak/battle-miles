from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

import app.routes as routes
from app.main import app


client = TestClient(app)


def image_bytes(format_name="PNG", size=(100, 100)):
    buffer = BytesIO()
    Image.new("RGB", size, color=(180, 180, 180)).save(buffer, format=format_name)
    return buffer.getvalue()


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_valid_analysis_with_mocked_ocr(monkeypatch):
    monkeypatch.setattr(routes, "extract_text", lambda image: "Strava\n10 km\nDuration 50:00\nPace 5:00 /km")
    response = client.post(
        "/analyze",
        files={"file": ("proof.png", image_bytes(), "application/octet-stream")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "analyzed"
    assert body["extracted_metrics"]["distance_km"] == 10.0
    assert body["risk_score"] >= 0
    assert body["risk_level"] in {"low", "moderate", "high"}


def test_unsupported_format(monkeypatch):
    monkeypatch.setattr(routes, "extract_text", lambda image: "")
    buffer = BytesIO()
    Image.new("RGB", (100, 100), color="gray").save(buffer, "BMP")
    response = client.post(
        "/analyze",
        files={"file": ("proof.bmp", buffer.getvalue(), "image/bmp")},
    )
    assert response.status_code == 400


def test_corrupted_image():
    response = client.post(
        "/analyze",
        files={"file": ("proof.png", b"broken", "image/png")},
    )
    assert response.status_code == 400


def test_oversized_image():
    response = client.post(
        "/analyze",
        files={"file": ("proof.png", b"x" * (10 * 1024 * 1024 + 1), "application/octet-stream")},
    )
    assert response.status_code == 413
