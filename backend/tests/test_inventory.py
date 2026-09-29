from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.helpers import create_cell, create_enodeb, create_site


def test_cell_gets_eci_and_band(engineer: TestClient) -> None:
    site = create_site(engineer)
    enodeb = create_enodeb(engineer, site["id"], enb_id=170001)
    cell = create_cell(engineer, enodeb["id"], local_cell_id=2)
    assert cell["eci"] == 170001 * 256 + 2
    assert cell["band"] == 3
    assert cell["dl_frequency_mhz"] == 1815.0
    assert cell["site_code"] == "S1"


def test_unknown_earfcn_is_rejected(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"])
    response = engineer.post(
        "/api/v1/cells",
        json={"enodeb_id": enodeb["id"], "local_cell_id": 1, "pci": 1, "earfcn_dl": 37900},
    )
    assert response.status_code == 422
    assert response.json()["field"] == "earfcn_dl"


def test_validation_limits(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"])
    base = {"enodeb_id": enodeb["id"], "local_cell_id": 1, "earfcn_dl": 1300}
    assert engineer.post("/api/v1/cells", json={**base, "pci": 504}).status_code == 422
    assert (
        engineer.post("/api/v1/cells", json={**base, "pci": 1, "azimuth_deg": 360}).status_code
        == 422
    )
    assert (
        engineer.post("/api/v1/cells", json={**base, "pci": 1, "bandwidth_mhz": 7}).status_code
        == 422
    )


def test_duplicates_conflict(engineer: TestClient) -> None:
    site = create_site(engineer)
    assert (
        engineer.post("/api/v1/sites", json={"code": "S1", "lat": 1, "lon": 1}).status_code == 409
    )
    enodeb = create_enodeb(engineer, site["id"])
    create_cell(engineer, enodeb["id"])
    response = engineer.post(
        "/api/v1/cells",
        json={"enodeb_id": enodeb["id"], "local_cell_id": 1, "pci": 2, "earfcn_dl": 1300},
    )
    assert response.status_code == 409


def test_cell_change_creates_version_and_audit(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"])
    cell = create_cell(engineer, enodeb["id"], elec_tilt_deg=4)
    changed_at = datetime.now(UTC) - timedelta(days=2)
    response = engineer.patch(
        f"/api/v1/cells/{cell['id']}",
        json={"elec_tilt_deg": 6, "notes": "после драйва", "effective_at": changed_at.isoformat()},
    )
    assert response.status_code == 200
    assert response.json()["elec_tilt_deg"] == 6

    versions = engineer.get(f"/api/v1/cells/{cell['id']}/versions").json()
    assert [v["elec_tilt_deg"] for v in versions] == [6, 4]
    assert versions[0]["valid_to"] is None
    assert versions[1]["valid_from"] is None  # first version: valid since forever
    assert versions[1]["valid_to"] == versions[0]["valid_from"]

    changes = engineer.get(
        "/api/v1/changes", params={"entity_type": "cell", "entity_id": cell["id"]}
    ).json()
    assert changes[0]["action"] == "update"
    assert changes[0]["changes"]["elec_tilt_deg"] == [4, 6]
    assert changes[0]["username"] == "engineer"


def test_notes_change_does_not_create_version(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"])
    cell = create_cell(engineer, enodeb["id"])
    engineer.patch(f"/api/v1/cells/{cell['id']}", json={"notes": "комментарий"})
    assert len(engineer.get(f"/api/v1/cells/{cell['id']}/versions").json()) == 1


def test_effective_at_must_follow_previous_change(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"])
    cell = create_cell(engineer, enodeb["id"])
    now = datetime.now(UTC)
    engineer.patch(
        f"/api/v1/cells/{cell['id']}",
        json={"pci": 11, "effective_at": (now - timedelta(days=1)).isoformat()},
    )
    response = engineer.patch(
        f"/api/v1/cells/{cell['id']}",
        json={"pci": 12, "effective_at": (now - timedelta(days=5)).isoformat()},
    )
    assert response.status_code == 422
    future = engineer.patch(
        f"/api/v1/cells/{cell['id']}",
        json={"pci": 12, "effective_at": (now + timedelta(days=5)).isoformat()},
    )
    assert future.status_code == 422


def test_site_move_keeps_position_history(engineer: TestClient) -> None:
    site = create_site(engineer, kind="mobile")
    engineer.patch(f"/api/v1/sites/{site['id']}", json={"lat": 54.01, "lon": 87.02})
    positions = engineer.get(f"/api/v1/sites/{site['id']}/positions").json()
    assert [(p["lat"], p["lon"]) for p in positions] == [(54.01, 87.02), (54.0, 87.0)]
    assert positions[0]["valid_to"] is None


def test_enb_id_change_updates_eci(engineer: TestClient) -> None:
    enodeb = create_enodeb(engineer, create_site(engineer)["id"], enb_id=100)
    cell = create_cell(engineer, enodeb["id"], local_cell_id=3)
    engineer.patch(f"/api/v1/enodebs/{enodeb['id']}", json={"enb_id": 200})
    updated = engineer.get(f"/api/v1/cells/{cell['id']}").json()
    assert updated["eci"] == 200 * 256 + 3
    versions = engineer.get(f"/api/v1/cells/{cell['id']}/versions").json()
    assert [v["eci"] for v in versions] == [200 * 256 + 3, 100 * 256 + 3]


def test_delete_guards(engineer: TestClient) -> None:
    site = create_site(engineer)
    enodeb = create_enodeb(engineer, site["id"])
    cell = create_cell(engineer, enodeb["id"])
    assert engineer.delete(f"/api/v1/sites/{site['id']}").status_code == 409
    assert engineer.delete(f"/api/v1/enodebs/{enodeb['id']}").status_code == 409
    assert engineer.delete(f"/api/v1/cells/{cell['id']}").status_code == 204
    assert engineer.delete(f"/api/v1/enodebs/{enodeb['id']}").status_code == 204
    assert engineer.delete(f"/api/v1/sites/{site['id']}").status_code == 204
    deleted = engineer.get("/api/v1/changes", params={"entity_type": "site"}).json()[0]
    assert deleted["action"] == "delete"
    assert deleted["entity_label"] == "S1"


def test_devices_and_assets(engineer: TestClient) -> None:
    asset = engineer.post("/api/v1/assets", json={"name": "С-101", "kind": "haul_truck"}).json()
    response = engineer.post(
        "/api/v1/devices",
        json={
            "name": "RTR-1",
            "kind": "router",
            "imei": "490154203237518",
            "asset_id": asset["id"],
        },
    )
    assert response.status_code == 201
    bad_imei = engineer.post(
        "/api/v1/devices", json={"name": "RTR-2", "kind": "router", "imei": "490154203237519"}
    )
    assert bad_imei.status_code == 422
    assert engineer.delete(f"/api/v1/assets/{asset['id']}").status_code == 204
    assert engineer.get("/api/v1/devices").json()[0]["asset_id"] is None


def test_search(engineer: TestClient) -> None:
    site = create_site(engineer, code="KR-R01")
    enodeb = create_enodeb(engineer, site["id"], enb_id=170001)
    cell = create_cell(engineer, enodeb["id"], name="KR-R01-1", pci=77)
    by_code = engineer.get("/api/v1/search", params={"q": "r01"}).json()
    assert {hit["type"] for hit in by_code} == {"site", "cell"}
    by_eci = engineer.get("/api/v1/search", params={"q": str(cell["eci"])}).json()
    assert by_eci[0]["id"] == cell["id"]
    by_pci = engineer.get("/api/v1/search", params={"q": "77"}).json()
    assert by_pci[0]["label"] == "KR-R01-1"


def test_map_inventory_and_overlays(engineer: TestClient) -> None:
    site = create_site(engineer)
    create_cell(engineer, create_enodeb(engineer, site["id"])["id"])
    sites = engineer.get("/api/v1/map/inventory").json()
    assert sites[0]["cells"][0]["azimuth_deg"] == 90

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Point", "coordinates": [87, 54]},
            }
        ],
    }
    response = engineer.post("/api/v1/map/overlays", json={"name": "Контур", "geojson": geojson})
    assert response.status_code == 201
    bad = engineer.post("/api/v1/map/overlays", json={"name": "X", "geojson": {"type": "Point"}})
    assert bad.status_code == 422
    assert engineer.get("/api/v1/map/overlays").json()[0]["geojson"] == geojson
