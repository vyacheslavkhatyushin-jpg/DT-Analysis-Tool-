from typing import Any

from fastapi.testclient import TestClient


def create_site(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body = {"code": "S1", "name": "Борт 1", "lat": 54.0, "lon": 87.0, **overrides}
    response = client.post("/api/v1/sites", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def create_enodeb(client: TestClient, site_id: int, enb_id: int = 170001) -> dict[str, Any]:
    response = client.post("/api/v1/enodebs", json={"site_id": site_id, "enb_id": enb_id})
    assert response.status_code == 201, response.text
    return response.json()


def create_cell(client: TestClient, enodeb_id: int, **overrides: Any) -> dict[str, Any]:
    body = {
        "enodeb_id": enodeb_id,
        "local_cell_id": 1,
        "name": "S1-1",
        "pci": 10,
        "earfcn_dl": 1300,
        "azimuth_deg": 90,
        "elec_tilt_deg": 4,
        **overrides,
    }
    response = client.post("/api/v1/cells", json=body)
    assert response.status_code == 201, response.text
    return response.json()
