import io
import zipfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from dtat.drivetest.netmonitor import parse
from dtat.errors import InvalidDataError
from tests.helpers import create_cell, create_site

HEADER = (
    "report;sys_time;sim_state;net_op_name;net_op_code;roaming;net_type;call_state;data_state;"
    "data_act;data_rx;data_tx;gsm_neighbors;umts_neighbors;lte_neighbors;rssi_strongest;tech;mcc;"
    "mnc;lac_tac;node_id;cid;psc_pci;rssi;rsrq;rssnr;slev;gps;accuracy;lat;long;band;arfcn;"
    "bts_psc_pci;bts_band;bts_arfcn;site_name;site_lat;site_long;cell_name;azimuth;height;"
    "tilt_mech;tilt_el;"
)
START = datetime(2024, 7, 14, 9, 40)
LAT, LON = 46.9447, 79.9386


def _row(
    i: int, enb: int, cid: int, pci: int, rsrp: int, rsrq: int = -8, rssnr: int = 150,
    *, gps: int = 1, rx: int = 1000, strongest: int = 2147483647,
) -> str:  # fmt: skip
    t = (START + timedelta(seconds=i)).strftime("%Y%m%d%H%M%S")
    lat, lon = LAT + i * 0.0001, LON + i * 0.0001
    return (
        f"{i};{t};READY;KazMinerals;99999;0;LTE;IDLE;CONNECTED;NONE;{rx + i * 10};500;0;0;1;"
        f"{strongest};LTE;999;99;55100;{enb};{cid};{pci};{rsrp};{rsrq};{rssnr};4;{gps};2;{lat};"
        f"{lon};800;6200;null;null;null;null;;;null;null;null;null;null;"
    )


def _log(rows: list[str]) -> bytes:
    return "\n".join([HEADER, *rows, ""]).encode()


def _drive_rows() -> list[str]:
    rows = [_row(i, 534344, 72, 40, -80) for i in range(10)]  # good, cell 72
    rows += [_row(i, 534344, 70, 43, -82) for i in range(10, 13)]  # cell 70 for 3 s
    rows += [_row(i, 534344, 72, 40, -107, rssnr=20) for i in range(13, 19)]  # back: ping-pong
    rows += [_row(i, 534344, 72, 40, -85, rssnr=-30) for i in range(19, 25)]  # interference
    rows += [_row(i, 999999, 1, 7, -90) for i in range(25, 27)]  # a cell not in the inventory
    rows += [_row(27, 534344, 72, 40, 0, 0, 2147483647)]  # no measurement this second
    return rows


def _import(client: TestClient, data: bytes, filename: str = "Сессия_1.csv", **form: str) -> dict:
    response = client.post(
        "/api/v1/drive-sessions/import",
        files={"file": (filename, data, "text/csv")},
        data=form,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _inventory(client: TestClient, enb_id: int = 534344) -> dict[int, int]:
    site = create_site(client, code="34344", lat=LAT, lon=LON)
    response = client.post("/api/v1/enodebs", json={"site_id": site["id"], "enb_id": enb_id})
    assert response.status_code == 201, response.text
    enodeb = response.json()["id"]
    return {
        local: create_cell(
            client, enodeb, local_cell_id=local, name=f"P_534344-{local}", pci=pci, earfcn_dl=6200
        )["id"]
        for local, pci in ((70, 43), (72, 40))
    }


def test_parse_netmonitor_values() -> None:
    rows = [_row(0, 534344, 72, 40, -70, -7, 270, strongest=-85), _row(1, 534344, 72, 40, 0, 0, 5)]
    rows.append(_row(2, 534344, 72, 40, -71, gps=0))
    [log] = parse(_log(rows), "s.csv", ZoneInfo("Asia/Almaty"))
    first, empty, no_fix = log.samples
    assert (first.enb_id, first.local_cell_id, first.eci) == (534344, 72, 534344 * 256 + 72)
    assert (first.rsrp, first.rsrq, first.sinr, first.tac) == (-70, -7, 27.0, 55100)
    assert first.best_neighbor_rsrp == -85
    assert first.time == datetime(2024, 7, 14, 9, 40, tzinfo=ZoneInfo("Asia/Almaty"))
    assert (empty.rsrp, empty.rsrq, empty.sinr) == (None, None, None)  # RSRP 0: no measurement
    assert (no_fix.lat, no_fix.lon, no_fix.rsrp) == (None, None, -71)
    assert (log.plmn, log.operator, log.rx_bytes) == ("999-99", "KazMinerals", 20)


def test_parse_zip_and_rejects_other_files() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("a.csv", _log([_row(0, 1, 1, 1, -80)]))
        archive.writestr("b.csv", _log([_row(0, 1, 1, 1, -90)]))
        archive.writestr("readme.txt", "x")
    logs = parse(buffer.getvalue(), "x.zip", ZoneInfo("UTC"))
    assert [log.filename for log in logs] == ["a.csv", "b.csv"]
    with pytest.raises(InvalidDataError, match="не лог сессии NetMonitor"):
        parse(b"a;b;c\n1;2;3\n", "other.csv", ZoneInfo("UTC"))


def test_import_matches_cells_and_finds_problems(engineer: TestClient) -> None:
    cells = _inventory(engineer)
    [drive] = _import(engineer, _log(_drive_rows()), name="Карьер, объезд")["sessions"]
    assert drive["name"] == "Карьер, объезд"
    assert (drive["samples"], drive["plmn"], drive["operator"]) == (28, "999-99", "KazMinerals")
    assert drive["started_at"] == "2024-07-14T04:40:00Z"  # Asia/Almaty is UTC+5
    assert drive["distance_m"] > 0

    report = engineer.get(f"/api/v1/drive-sessions/{drive['id']}/report").json()
    assert (report["samples"], report["with_radio"], report["matched"]) == (28, 27, 25)
    assert (report["cell_changes"], report["ping_pongs"]) == (3, 1)
    served = {c["eci"]: c for c in report["cells"]}
    assert served[534344 * 256 + 72]["cell_id"] == cells[72]
    assert served[534344 * 256 + 72]["samples"] == 22
    kinds = [(p["kind"], p["seconds"], p["cell_name"]) for p in report["problems"]]
    assert ("weak_coverage", 6, "P_534344-72") in kinds
    assert ("interference", 6, "P_534344-72") in kinds
    assert [u["eci"] for u in report["unknown"]] == [999999 * 256 + 1]
    assert report["unknown"][0]["hint"] is None
    rsrp = next(d for d in report["distributions"] if d["metric"] == "rsrp")
    assert sum(rsrp["counts"].values()) == 27 and rsrp["counts"]["poor"] == 6

    track = engineer.get(f"/api/v1/drive-sessions/{drive['id']}/track").json()
    assert len(track["lat"]) == len(track["cell_id"]) == 28
    assert track["rsrp"][27] is None and track["cell_id"][0] == cells[72]

    listed = engineer.get("/api/v1/drive-sessions").json()
    assert [(s["radio_samples"], s["matched_samples"]) for s in listed] == [(27, 25)]
    original = engineer.get(f"/api/v1/drive-sessions/{drive['id']}/original")
    assert original.content == _log(_drive_rows())


def test_duplicate_update_and_delete(engineer: TestClient) -> None:
    [drive] = _import(engineer, _log(_drive_rows()))["sessions"]
    assert drive["name"] == "Сессия_1"
    again = engineer.post(
        "/api/v1/drive-sessions/import",
        files={"file": ("copy.csv", _log(_drive_rows()), "text/csv")},
    )
    assert again.status_code == 409 and "уже загружен" in again.json()["detail"]

    url = f"/api/v1/drive-sessions/{drive['id']}"
    assert (
        engineer.patch(url, json={"name": "Утро", "notes": "без теста скорости"}).json()["name"]
        == "Утро"
    )
    assert engineer.patch(url, json={"device_id": 12345}).status_code == 404
    assert engineer.delete(url).status_code == 204
    assert engineer.get(url).status_code == 404


def test_wrong_enb_id_hint_and_rematch(engineer: TestClient) -> None:
    cells = _inventory(engineer, enb_id=34344)  # entered without the operator's "5"
    [drive] = _import(engineer, _log(_drive_rows()))["sessions"]
    report = engineer.get(f"/api/v1/drive-sessions/{drive['id']}/report").json()
    hints = {u["eci"]: u["hint"] for u in report["unknown"]}
    hint = hints[534344 * 256 + 72]
    assert (hint["enb_id"], hint["new_enb_id"]) == (34344, 534344)

    fixed = engineer.patch(f"/api/v1/enodebs/{hint['enodeb_id']}", json={"enb_id": 534344})
    assert fixed.status_code == 200, fixed.text
    report = engineer.post(f"/api/v1/drive-sessions/{drive['id']}/rematch").json()
    assert report["matched"] == 25
    assert {c["cell_id"] for c in report["cells"]} == {cells[70], cells[72], None}


def test_import_errors(engineer: TestClient) -> None:
    response = engineer.post(
        "/api/v1/drive-sessions/import",
        files={"file": ("s.csv", _log(_drive_rows()), "text/csv")},
        data={"timezone": "Mars/Base"},
    )
    assert response.status_code == 422 and response.json()["field"] == "timezone"


def test_viewer_cannot_import(viewer: TestClient) -> None:
    response = viewer.post(
        "/api/v1/drive-sessions/import", files={"file": ("s.csv", _log(_drive_rows()), "text/csv")}
    )
    assert response.status_code == 403
    assert [m["code"] for m in viewer.get("/api/v1/drive/metrics").json()] == [
        "rsrp",
        "rsrq",
        "sinr",
    ]
