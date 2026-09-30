# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "ezdxf>=1.4", "numpy>=2", "scipy>=1.14", "pyproj>=3.7", "pillow>=11", "pmtiles>=3.4",
# ]
# ///
"""Raster basemap (PMTiles) from a surveyor's DXF: relief shading plus the plan's lines.

    uv run tools/dxf_basemap.py plan.dxf aktogay-plan.pmtiles --crs EPSG:2504

The DXF must be a 3D survey: POINT entities and polylines with elevations (breaklines) make the
relief model; every polyline is drawn over it. Layers whose polylines are mostly closed and flat
(buildings) are filled. Tiles are WebP with transparency outside the surveyed area.

Coordinates: DXF files carry no coordinate system. For Aktogay it is Pulkovo 1942 Gauss-Kruger
with the central meridian 81°E (EPSG:2504): GPS tracks of drive tests fall on the plan's roads
with a median offset of 6-8 m (UTM 44N, with similar numbers, is off by ~90 m). Check a new
file the same way before trusting it: the printed bounds must cover the sites.
"""

import argparse
import io
import math
import multiprocessing
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ezdxf.addons import iterdxf
from PIL import Image, ImageDraw
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from pyproj import Transformer
from scipy.interpolate import LinearNDInterpolator
from scipy.ndimage import map_coordinates
from scipy.spatial import Delaunay

R = 6378137.0
SIZE, SS = 256, 2  # tile size; lines are drawn at 2x and downsampled for smooth edges
MIN_ELEVATION = 100.0  # survey vertices lower than this are errors (zeros, typos)
LOW, HIGH = np.array([196, 187, 172]), np.array([242, 239, 232])  # recessive tint, low is darker
TERRAIN_COLOR, BUILDING_LINE, BUILDING_FILL, OTHER_COLOR = (
    (112, 92, 72, 110),
    (96, 108, 130, 220),
    (190, 198, 212, 235),
    (90, 90, 90, 130),
)  # fmt: skip


@dataclass
class Feature:
    minzoom: int
    color: tuple[int, int, int, int]
    fill: tuple[int, int, int, int] | None
    xy: np.ndarray  # Web Mercator
    bbox: tuple[float, float, float, float]


def read_dxf(path: str) -> tuple[np.ndarray, dict[str, list[np.ndarray]]]:
    """Survey points and polylines (x, y, z) by layer; the file is streamed, not loaded."""
    points: list[tuple[float, float, float]] = []
    lines: dict[str, list[np.ndarray]] = defaultdict(list)
    for e in iterdxf.opendxf(path).modelspace():
        kind, layer = e.dxftype(), e.dxf.layer
        if kind == "POINT":
            points.append(tuple(e.dxf.location))
        elif kind == "POLYLINE":
            vertices = [tuple(v.dxf.location) for v in e.vertices]
            if len(vertices) > 1:
                lines[layer].append(np.array(vertices))
        elif kind == "LWPOLYLINE":
            vertices = [(x, y, e.dxf.elevation) for x, y, *_ in e.get_points()]
            if len(vertices) > 1:
                lines[layer].append(np.array(vertices))
        elif kind == "LINE":
            lines[layer].append(np.array([tuple(e.dxf.start), tuple(e.dxf.end)]))
        elif kind == "3DFACE":
            points.extend(tuple(e.dxf.get(f"vtx{i}")) for i in range(4))
    return np.array(points).reshape(-1, 3), dict(lines)


def build_dem(points: np.ndarray, step: float, max_edge: float) -> tuple[np.ndarray, float, float]:
    """Elevation grid by linear interpolation over a triangulation of the survey. Triangles
    with edges longer than `max_edge` bridge unsurveyed areas and are left empty."""
    points = points[points[:, 2] > MIN_ELEVATION]
    _, unique = np.unique(np.round(points[:, :2] * 2).astype(np.int64), axis=0, return_index=True)
    points = points[np.sort(unique)]
    tri = Delaunay(points[:, :2])
    corners = points[tri.simplices][:, :, :2]
    too_long = np.max(np.linalg.norm(corners - corners[:, [1, 2, 0]], axis=2), axis=1) > max_edge
    interpolate = LinearNDInterpolator(tri, points[:, 2])
    x0, y0 = math.floor(points[:, 0].min()), math.floor(points[:, 1].min())
    nx = int((points[:, 0].max() - x0) / step) + 1
    ny = int((points[:, 1].max() - y0) / step) + 1
    dem = np.full((ny, nx), np.nan, dtype=np.float32)
    xs = x0 + np.arange(nx) * step
    for row in range(0, ny, 250):
        ys = y0 + np.arange(row, min(ny, row + 250)) * step
        gx, gy = np.meshgrid(xs, ys)
        query = np.c_[gx.ravel(), gy.ravel()]
        simplex = tri.find_simplex(query)
        z = interpolate(query)
        z[(simplex < 0) | too_long[simplex]] = np.nan
        dem[row : row + len(ys)] = z.reshape(len(ys), nx)
    return dem, x0, y0


def relief(dem: np.ndarray, step: float) -> list[np.ndarray]:
    """RGBA channels of the shaded relief (light from the north-west)."""
    valid = np.isfinite(dem)
    z = np.where(valid, dem, np.nanmedian(dem))
    dzdy, dzdx = np.gradient(z, step)
    azimuth, altitude = math.radians(315), math.radians(45)
    slope = np.arctan(1.6 * np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    shade = np.clip(
        np.sin(altitude) * np.cos(slope)
        + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - (math.pi / 2 - aspect)),
        0,
        1,
    )
    lo, hi = np.nanpercentile(dem, 1), np.nanpercentile(dem, 99)
    height = np.clip((z - lo) / (hi - lo), 0, 1)[..., None]
    rgb = (LOW + (HIGH - LOW) * height) * (0.62 + 0.38 * shade[..., None])
    return [rgb[..., i].astype(np.float32) for i in range(3)] + [valid.astype(np.float32) * 255]


def plan_features(lines: dict[str, list[np.ndarray]], crs: str) -> list[Feature]:
    """Polylines in Web Mercator with a style per layer: the two densest layers are terrain
    breaklines (shown from z15), layers of closed flat outlines are buildings (filled)."""
    to_mercator = Transformer.from_crs(crs, "EPSG:3857", always_xy=True)
    density = sorted(lines, key=lambda k: -sum(len(a) for a in lines[k]))
    terrain = set(density[:2])
    features = []
    for layer, arrays in lines.items():
        closed_flat = [
            len(a) > 3 and np.hypot(*(a[0, :2] - a[-1, :2])) < 0.01 and np.ptp(a[:, 2]) < 0.01
            for a in arrays
        ]
        buildings = layer not in terrain and sum(closed_flat) > len(arrays) / 3
        for array, is_outline in zip(arrays, closed_flat, strict=True):
            mx, my = to_mercator.transform(array[:, 0], array[:, 1])
            if layer in terrain:
                style = (15, TERRAIN_COLOR, None)
            elif buildings and is_outline:
                style = (14, BUILDING_LINE, BUILDING_FILL)
            else:
                style = (14, OTHER_COLOR, None)
            features.append(
                Feature(*style, np.c_[mx, my], (mx.min(), my.min(), mx.max(), my.max()))
            )
    features.sort(key=lambda f: f.fill is None)  # fills first, lines on top
    return features


# Worker state, set before the pool forks.
STATE: dict[str, object] = {}


def render(zxy: tuple[int, int, int]) -> tuple[int, bytes | None]:
    z, x, y = zxy
    channels: list[np.ndarray] = STATE["channels"]  # type: ignore[assignment]
    features: list[Feature] = STATE["features"]  # type: ignore[assignment]
    bboxes: np.ndarray = STATE["bboxes"]  # type: ignore[assignment]
    x0, y0, step = STATE["grid"]  # type: ignore[misc]
    to_crs: Transformer = STATE["to_crs"]  # type: ignore[assignment]

    size_m = 2 * math.pi * R / 2**z
    minx, maxy = -math.pi * R + x * size_m, math.pi * R - y * size_m
    px = SIZE * SS
    offsets = (np.arange(px) + 0.5) / px * size_m
    mx, my = np.meshgrid(minx + offsets, maxy - offsets)
    gx, gy = to_crs.transform(mx.ravel(), my.ravel())
    coords = np.vstack([(np.asarray(gy) - y0) / step, (np.asarray(gx) - x0) / step])
    alpha = map_coordinates(channels[3], coords, order=1, cval=0).reshape(px, px)
    if alpha.max() < 1:
        return zxy_to_tileid(z, x, y), None
    image = np.dstack(
        [map_coordinates(c, coords, order=1, cval=0).reshape(px, px) for c in channels[:3]]
        + [alpha]
    ).astype(np.uint8)
    base = Image.fromarray(image, "RGBA")
    overlay = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    scale = px / size_m
    hits = np.where(
        (bboxes[:, 2] >= minx)
        & (bboxes[:, 0] <= minx + size_m)
        & (bboxes[:, 3] >= maxy - size_m)
        & (bboxes[:, 1] <= maxy)
    )[0]
    for i in hits:
        feature = features[i]
        if z < feature.minzoom:
            continue
        points = [((u - minx) * scale, (maxy - v) * scale) for u, v in feature.xy]
        if feature.fill is not None:
            draw.polygon(points, fill=feature.fill, outline=feature.color)
        else:
            draw.line(points, fill=feature.color, width=SS if z < 17 else SS + 1)
    tile = Image.alpha_composite(base, overlay).resize((SIZE, SIZE), Image.LANCZOS)
    buffer = io.BytesIO()
    tile.save(buffer, "WEBP", quality=82, method=4)
    return zxy_to_tileid(z, x, y), buffer.getvalue()


def tile_ranges(z: int, bounds: tuple[float, float, float, float]) -> list[tuple[int, int, int]]:
    west, south, east, north = bounds
    n = 2**z

    def tile_y(lat: float) -> int:
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

    xs = range(int((west + 180) / 360 * n), int((east + 180) / 360 * n) + 1)
    return [(z, x, y) for x in xs for y in range(tile_y(north), tile_y(south) + 1)]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("dxf")
    parser.add_argument("output")
    parser.add_argument("--crs", default="EPSG:2504", help="система координат DXF (СК-42, ГК 81°)")
    parser.add_argument("--name", default="Топоплан (маркшейдерия)")
    parser.add_argument("--attribution", default="Маркшейдерская съёмка")
    parser.add_argument("--minzoom", type=int, default=10)
    parser.add_argument("--maxzoom", type=int, default=17)
    parser.add_argument("--step", type=float, default=4.0, help="шаг модели рельефа, м")
    parser.add_argument("--max-edge", type=float, default=120.0, help="длиннее — не заполнять, м")
    args = parser.parse_args()

    start = time.time()

    def log(message: str) -> None:
        print(f"{message} ({time.time() - start:.0f} с)", flush=True)

    points, lines = read_dxf(args.dxf)
    vertices = [a for arrays in lines.values() for a in arrays if np.ptp(a[:, 2]) > 0.01]
    survey = np.vstack([points, *vertices]) if vertices else points
    log(f"DXF: {len(points)} точек, {sum(len(v) for v in lines.values())} линий")
    dem, x0, y0 = build_dem(survey, args.step, args.max_edge)
    log(f"Рельеф: {dem.shape[1]} × {dem.shape[0]} ячеек по {args.step} м")

    to_wgs = Transformer.from_crs(args.crs, "EPSG:4326", always_xy=True)
    ny, nx = dem.shape
    lon, lat = to_wgs.transform(
        [x0, x0 + nx * args.step, x0, x0 + nx * args.step],
        [y0, y0, y0 + ny * args.step, y0 + ny * args.step],
    )
    west, east, south, north = min(lon), max(lon), min(lat), max(lat)
    log(f"Границы WGS-84: {south:.5f}…{north:.5f} с. ш., {west:.5f}…{east:.5f} в. д.")

    features = plan_features(lines, args.crs)
    STATE.update(
        channels=relief(dem, args.step),
        features=features,
        bboxes=np.array([f.bbox for f in features]).reshape(-1, 4),
        grid=(x0, y0, args.step),
        to_crs=Transformer.from_crs("EPSG:3857", args.crs, always_xy=True),
    )
    tiles: dict[int, bytes] = {}
    with multiprocessing.get_context("fork").Pool(os.cpu_count()) as pool:
        for z in range(args.minzoom, args.maxzoom + 1):
            work = tile_ranges(z, (west, south, east, north))
            for tile_id, data in pool.imap_unordered(render, work, chunksize=8):
                if data:
                    tiles[tile_id] = data
            size = sum(len(v) for v in tiles.values()) / 1e6
            log(f"z{z}: {len(work)} тайлов, всего {size:.1f} МБ")

    with Path(args.output).open("wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(
            {
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": args.minzoom,
                "max_zoom": args.maxzoom,
                "min_lon_e7": int(west * 1e7),
                "min_lat_e7": int(south * 1e7),
                "max_lon_e7": int(east * 1e7),
                "max_lat_e7": int(north * 1e7),
                "center_zoom": 13,
                "center_lon_e7": int((west + east) / 2 * 1e7),
                "center_lat_e7": int((south + north) / 2 * 1e7),
            },
            {"name": args.name, "attribution": args.attribution},
        )
    log(f"Готово: {args.output}, {len(tiles)} тайлов")


if __name__ == "__main__":
    main()
