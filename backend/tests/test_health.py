from fastapi.testclient import TestClient


def test_health_reports_version_and_build(app_client: TestClient) -> None:
    response = app_client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["build"] == "dev"
