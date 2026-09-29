import gzip
import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from dtat.config import get_settings
from dtat.maps.pmtiles import read_info


def write_pmtiles(path: Path, tile_type: int, metadata: dict) -> None:
    meta = gzip.compress(json.dumps(metadata).encode())
    header = bytearray(127)
    header[0:7] = b"PMTiles"
    header[7] = 3
    struct.pack_into("<QQ", header, 24, 127, len(meta))
    header[97] = 2  # gzip internal compression
    header[99] = tile_type
    header[100], header[101] = 0, 15
    struct.pack_into("<iiii", header, 102, 870000000, 539000000, 876000000, 542000000)
    header[118] = 12
    struct.pack_into("<ii", header, 119, 872500000, 540500000)
    path.write_bytes(bytes(header) + meta)


def test_read_info(tmp_path: Path) -> None:
    path = tmp_path / "ortho.pmtiles"
    write_pmtiles(path, 3, {"name": "Ортофото 2026-08"})
    info = read_info(path)
    assert info is not None
    assert info.tile_type == "jpeg"
    assert info.bounds == (87.0, 53.9, 87.6, 54.2)
    assert info.center == (87.25, 54.05, 12)
    assert info.metadata["name"] == "Ортофото 2026-08"


def test_not_pmtiles(tmp_path: Path) -> None:
    path = tmp_path / "x.pmtiles"
    path.write_bytes(b"hello")
    assert read_info(path) is None


@pytest.fixture
def tiles_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(get_settings(), "tiles_dir", tmp_path)
    return tmp_path


def test_basemaps_endpoint(viewer: TestClient, tiles_dir: Path) -> None:
    write_pmtiles(tiles_dir / "ortho.pmtiles", 3, {"name": "Ортофото"})
    layers = [{"id": name} for name in ("earth", "water", "roads", "landuse", "places")]
    write_pmtiles(tiles_dir / "region.pmtiles", 1, {"vector_layers": layers})
    (tiles_dir / "broken.pmtiles").write_bytes(b"nope")

    basemaps = {b["id"]: b for b in viewer.get("/api/v1/map/basemaps").json()}
    assert set(basemaps) == {"ortho.pmtiles", "region.pmtiles"}
    assert basemaps["ortho.pmtiles"]["kind"] == "raster"
    assert basemaps["ortho.pmtiles"]["name"] == "Ортофото"
    assert basemaps["region.pmtiles"]["kind"] == "vector"
    assert basemaps["region.pmtiles"]["schema_name"] == "protomaps"
    assert basemaps["region.pmtiles"]["url"] == "/tiles/region.pmtiles"
