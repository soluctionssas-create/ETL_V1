from fastapi.testclient import TestClient

from app.main import app


def test_liveness():
    client = TestClient(app)
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
