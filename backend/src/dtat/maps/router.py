from typing import Any, Literal

from fastapi import APIRouter, status
from pydantic import BaseModel

from dtat.auth.deps import CurrentUser, DbSession, EditorUser, ui_actor
from dtat.config import get_settings
from dtat.inventory import service
from dtat.inventory.models import SiteKind, Status
from dtat.inventory.schemas import (
    MapOverlayCreate,
    MapOverlayRead,
    MapOverlaySummary,
    MapOverlayUpdate,
)
from dtat.maps.pmtiles import read_info

router = APIRouter(prefix="/map", tags=["map"])

# Layer names of the Protomaps basemap schema, which the frontend knows how to style.
_PROTOMAPS_LAYERS = {"earth", "water", "roads", "landuse"}


class MapCell(BaseModel):
    id: int
    name: str | None
    eci: int
    enb_id: int
    local_cell_id: int
    pci: int
    earfcn_dl: int
    band: int | None
    bandwidth_mhz: float | None
    azimuth_deg: float | None
    beamwidth_deg: float | None
    height_m: float | None
    status: Status


class MapSite(BaseModel):
    id: int
    code: str
    name: str | None
    kind: SiteKind
    status: Status
    lat: float
    lon: float
    structure_height_m: float | None
    cells: list[MapCell]


class Basemap(BaseModel):
    id: str
    name: str
    url: str
    kind: Literal["raster", "vector"]
    tile_type: str
    schema_name: Literal["protomaps", "generic"] | None
    vector_layers: list[str]
    min_zoom: int
    max_zoom: int
    bounds: tuple[float, float, float, float]
    center: tuple[float, float, int]
    attribution: str | None


@router.get("/inventory")
def map_inventory(_: CurrentUser, session: DbSession) -> list[MapSite]:
    result = []
    for site in service.sites_with_cells(session):
        cells = [
            MapCell(
                id=cell.id,
                name=cell.name,
                eci=cell.eci,
                enb_id=enodeb.enb_id,
                local_cell_id=cell.local_cell_id,
                pci=cell.pci,
                earfcn_dl=cell.earfcn_dl,
                band=cell.band,
                bandwidth_mhz=cell.bandwidth_mhz,
                azimuth_deg=cell.azimuth_deg,
                beamwidth_deg=cell.beamwidth_deg,
                height_m=cell.height_m,
                status=cell.status,
            )
            for enodeb in site.enodebs
            for cell in enodeb.cells
        ]
        result.append(
            MapSite(
                id=site.id,
                code=site.code,
                name=site.name,
                kind=site.kind,
                status=site.status,
                lat=site.lat,
                lon=site.lon,
                structure_height_m=site.structure_height_m,
                cells=cells,
            )
        )
    return result


@router.get("/basemaps")
def list_basemaps(_: CurrentUser) -> list[Basemap]:
    """Offline basemaps: every PMTiles archive placed in the tiles directory."""
    tiles_dir = get_settings().tiles_dir
    if not tiles_dir.is_dir():
        return []
    basemaps = []
    for path in sorted(tiles_dir.glob("*.pmtiles")):
        info = read_info(path)
        if info is None:
            continue
        meta: dict[str, Any] = info.metadata
        layers = [
            str(layer.get("id"))
            for layer in meta.get("vector_layers", [])
            if isinstance(layer, dict) and layer.get("id")
        ]
        is_vector = info.tile_type == "mvt"
        schema_name: Literal["protomaps", "generic"] | None = None
        if is_vector:
            schema_name = "protomaps" if set(layers) >= _PROTOMAPS_LAYERS else "generic"
        basemaps.append(
            Basemap(
                id=path.name,
                name=str(meta.get("name") or path.stem),
                url=f"/tiles/{path.name}",
                kind="vector" if is_vector else "raster",
                tile_type=info.tile_type,
                schema_name=schema_name,
                vector_layers=layers,
                min_zoom=info.min_zoom,
                max_zoom=info.max_zoom,
                bounds=info.bounds,
                center=info.center,
                attribution=meta.get("attribution"),
            )
        )
    return basemaps


@router.get("/overlays")
def list_overlays(_: CurrentUser, session: DbSession) -> list[MapOverlayRead]:
    return [MapOverlayRead.model_validate(o) for o in service.list_overlays(session)]


@router.post("/overlays", status_code=status.HTTP_201_CREATED)
def create_overlay(
    body: MapOverlayCreate, user: EditorUser, session: DbSession
) -> MapOverlaySummary:
    overlay = service.create_overlay(session, ui_actor(user), body)
    session.commit()
    return MapOverlaySummary.model_validate(overlay)


@router.patch("/overlays/{overlay_id}")
def update_overlay(
    overlay_id: int, body: MapOverlayUpdate, user: EditorUser, session: DbSession
) -> MapOverlaySummary:
    overlay = service.update_overlay(session, ui_actor(user), overlay_id, body)
    session.commit()
    return MapOverlaySummary.model_validate(overlay)


@router.delete("/overlays/{overlay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_overlay(overlay_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_overlay(session, ui_actor(user), overlay_id)
    session.commit()
