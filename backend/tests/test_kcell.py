from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from dtat.inventory.kcell import convert, write_template

HEADER = [
    "№", "SITENAME", "EUTRANCELL", "Cell ID", "Site type", "EARFCNDL", "Antenna type",
    "Electrical tilt", "Mechanical tilt", "PHYSICALCELLID", "AZIMUT", "HEIGHT", "LATITUDE",
    "LONGITUDE", "Number of antennas", None, "Tower", "ДГУ", None,
]  # fmt: skip
A, B = (46.95, 79.95), (46.96, 79.86)


def _row(sitename: str, cell: str, cell_id: int, pci: int, coords: tuple[float, float],
         *, site_type: str = "Outdoor", azimuth: float = 120, antennas: int = 1,
         tower: int | None = None, comment: str | None = None) -> list[object]:  # fmt: skip
    return [
        None, sitename, cell, cell_id, site_type, 6200, "HW ADU4518R7v06", 5, 0, pci, azimuth,
        30, *coords, antennas, None, tower, None, comment,
    ]  # fmt: skip


def _source(*rows: list[object]) -> BytesIO:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(HEADER)
    for row in rows:
        ws.append(row)
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


def test_convert_sites_cells_and_remote_sectors() -> None:
    source = _source(
        _row("ERBS_34344_SULPHIDE_KP", "P_534344-70", 70, 43, A, tower=1),
        _row(
            "ERBS_34344_SULPHIDE_KP",
            "P_534344-78",
            78,
            2,
            A,
            site_type="Indoor DAS",
            azimuth=0,
            antennas=5,
            comment="Офис внутри",
        ),
        _row(
            "ERBS_34344_SULPHIDE_KP",
            "P_534344-80",
            80,
            44,
            A,
            site_type="Indoor DAS",
            comment="Remote сектор ERBS_34348_KONUS_KP",
        ),
        _row("ERBS_34371_ZHANAR_KP", "34371A", 11, 7, B, comment="Сущ-ая вышка"),
        # A sector of 34371 installed on 34344's site, found by coordinates.
        _row("ERBS_34371_ZHANAR_KP", "34371D", 14, 17, A),
        _row("ERBS_34348_KONUS_KP", "P_534348-70", 70, 50, (46.949, 79.938)),
    )
    result = convert(source, {"34348": (46.949468, 79.938039)})

    sites = {s.code: s for s in result.sites}
    assert list(sites) == ["34344", "34348", "34371"]
    assert sites["34344"].notes == ["Kcell: Tower=1"]
    assert sites["34371"].notes == ["Сущ-ая вышка"]
    # 34348 was first seen as a remote location, then as an eNodeB site: real name, given position.
    assert (sites["34348"].name, sites["34348"].lat) == ("KONUS_KP", 46.949468)

    cells = {c["name"]: c for c in result.cells}
    assert cells["P_534344-70"]["notes"] is None
    assert cells["P_534344-70"]["enb_id"] == 34344
    assert cells["P_534344-70"]["earfcn_ul"] == 24200
    assert cells["P_534344-70"]["azimuth_deg"] == 120
    assert cells["P_534344-78"]["azimuth_deg"] is None
    assert cells["P_534344-78"]["notes"] == "Indoor DAS; антенн: 5; Офис внутри"
    assert (cells["P_534344-80"]["site_code"], cells["P_534344-80"]["enb_site_code"]) == (
        "34348",
        "34344",
    )
    assert (cells["34371D"]["site_code"], cells["34371D"]["enb_site_code"]) == ("34344", "34371")
    assert cells["34371A"]["enb_site_code"] is None
    assert result.remote_cells == 2


def test_converted_template_imports_cleanly(engineer: TestClient) -> None:
    source = _source(
        _row("ERBS_34344_SULPHIDE_KP", "P_534344-70", 70, 43, A),
        _row(
            "ERBS_34344_SULPHIDE_KP",
            "P_534344-80",
            80,
            44,
            A,
            site_type="Indoor DAS",
            comment="Remote сектор ERBS_PS3",
        ),
    )
    data = write_template(convert(source, {"PS3": B}))
    response = engineer.post(
        "/api/v1/inventory/import",
        files={"file": ("inventory.xlsx", data, "application/octet-stream")},
        data={"dry_run": "false"},
    )
    report = response.json()
    assert report["applied"] and report["total_errors"] == 0, report
    cells = {c["name"]: c for c in engineer.get("/api/v1/cells").json()}
    assert cells["P_534344-80"]["site_code"] == "PS3"
    assert cells["P_534344-80"]["enodeb_site_code"] == "34344"


def test_convert_rejects_other_layouts() -> None:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(["Site", "Cell"])
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    with pytest.raises(ValueError, match="Нет столбцов"):
        convert(buffer)
