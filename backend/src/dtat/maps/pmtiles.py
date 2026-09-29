"""Minimal PMTiles v3 header reader: enough to list offline basemaps without extra dependencies.

Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
"""

import gzip
import json
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HEADER_LEN = 127
TILE_TYPES = {1: "mvt", 2: "png", 3: "jpeg", 4: "webp", 5: "avif"}
_COMPRESSION_NONE = 1
_COMPRESSION_GZIP = 2


@dataclass(frozen=True)
class PMTilesInfo:
    tile_type: str
    min_zoom: int
    max_zoom: int
    bounds: tuple[float, float, float, float]  # west, south, east, north
    center: tuple[float, float, int]  # lon, lat, zoom
    metadata: dict[str, Any] = field(default_factory=dict)


def _read_metadata(f: Any, offset: int, length: int, compression: int) -> dict[str, Any]:
    if length == 0 or length > 10_000_000:
        return {}
    f.seek(offset)
    raw = f.read(length)
    try:
        if compression == _COMPRESSION_GZIP:
            raw = gzip.decompress(raw)
        elif compression != _COMPRESSION_NONE:
            return {}
        data = json.loads(raw)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def read_info(path: Path) -> PMTilesInfo | None:
    """Header and metadata of a PMTiles v3 archive, or None if the file is not one."""
    try:
        with path.open("rb") as f:
            header = f.read(HEADER_LEN)
            if len(header) < HEADER_LEN or header[:7] != b"PMTiles" or header[7] != 3:
                return None
            metadata_offset, metadata_length = struct.unpack_from("<QQ", header, 24)
            internal_compression = header[97]
            metadata = _read_metadata(f, metadata_offset, metadata_length, internal_compression)
    except OSError:
        return None

    min_lon, min_lat, max_lon, max_lat = (v / 1e7 for v in struct.unpack_from("<iiii", header, 102))
    center_lon, center_lat = (v / 1e7 for v in struct.unpack_from("<ii", header, 119))
    return PMTilesInfo(
        tile_type=TILE_TYPES.get(header[99], "unknown"),
        min_zoom=header[100],
        max_zoom=header[101],
        bounds=(min_lon, min_lat, max_lon, max_lat),
        center=(center_lon, center_lat, header[118]),
        metadata=metadata,
    )
