from fastapi import APIRouter, Query, status

from dtat.auth.deps import CurrentUser, DbSession, EditorUser, ui_actor
from dtat.inventory import service
from dtat.inventory.schemas import (
    AssetCreate,
    AssetRead,
    AssetUpdate,
    CellCreate,
    CellRead,
    CellUpdate,
    CellVersionRead,
    DeviceCreate,
    DeviceRead,
    DeviceUpdate,
    ENodeBCreate,
    ENodeBRead,
    ENodeBUpdate,
    SearchHit,
    SiteCreate,
    SitePositionRead,
    SiteRead,
    SiteUpdate,
)

router = APIRouter(tags=["inventory"])


# --- sites -----------------------------------------------------------------------------------


@router.get("/sites")
def list_sites(_: CurrentUser, session: DbSession) -> list[SiteRead]:
    return [SiteRead.model_validate(s) for s in service.list_sites(session)]


@router.post("/sites", status_code=status.HTTP_201_CREATED)
def create_site(body: SiteCreate, user: EditorUser, session: DbSession) -> SiteRead:
    site = service.create_site(session, ui_actor(user), body)
    session.commit()
    return SiteRead.model_validate(site)


@router.get("/sites/{site_id}")
def get_site(site_id: int, _: CurrentUser, session: DbSession) -> SiteRead:
    return SiteRead.model_validate(service.get_site(session, site_id))


@router.patch("/sites/{site_id}")
def update_site(site_id: int, body: SiteUpdate, user: EditorUser, session: DbSession) -> SiteRead:
    site, _ = service.update_site(session, ui_actor(user), site_id, body)
    session.commit()
    return SiteRead.model_validate(site)


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(site_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_site(session, ui_actor(user), site_id)
    session.commit()


@router.get("/sites/{site_id}/positions")
def site_positions(site_id: int, _: CurrentUser, session: DbSession) -> list[SitePositionRead]:
    return [SitePositionRead.from_row(p) for p in service.site_positions(session, site_id)]


# --- eNodeB ----------------------------------------------------------------------------------


@router.get("/enodebs")
def list_enodebs(
    _: CurrentUser, session: DbSession, site_id: int | None = None
) -> list[ENodeBRead]:
    return [ENodeBRead.model_validate(e) for e in service.list_enodebs(session, site_id)]


@router.post("/enodebs", status_code=status.HTTP_201_CREATED)
def create_enodeb(body: ENodeBCreate, user: EditorUser, session: DbSession) -> ENodeBRead:
    enodeb = service.create_enodeb(session, ui_actor(user), body)
    session.commit()
    return ENodeBRead.model_validate(enodeb)


@router.get("/enodebs/{enodeb_id}")
def get_enodeb(enodeb_id: int, _: CurrentUser, session: DbSession) -> ENodeBRead:
    return ENodeBRead.model_validate(service.get_enodeb(session, enodeb_id))


@router.patch("/enodebs/{enodeb_id}")
def update_enodeb(
    enodeb_id: int, body: ENodeBUpdate, user: EditorUser, session: DbSession
) -> ENodeBRead:
    enodeb, _ = service.update_enodeb(session, ui_actor(user), enodeb_id, body)
    session.commit()
    return ENodeBRead.model_validate(enodeb)


@router.delete("/enodebs/{enodeb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_enodeb(enodeb_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_enodeb(session, ui_actor(user), enodeb_id)
    session.commit()


# --- cells -----------------------------------------------------------------------------------


@router.get("/cells")
def list_cells(_: CurrentUser, session: DbSession, site_id: int | None = None) -> list[CellRead]:
    return [CellRead.from_cell(c) for c in service.list_cells(session, site_id)]


@router.post("/cells", status_code=status.HTTP_201_CREATED)
def create_cell(body: CellCreate, user: EditorUser, session: DbSession) -> CellRead:
    cell = service.create_cell(session, ui_actor(user), body)
    session.commit()
    return CellRead.from_cell(service.get_cell(session, cell.id))


@router.get("/cells/{cell_id}")
def get_cell(cell_id: int, _: CurrentUser, session: DbSession) -> CellRead:
    return CellRead.from_cell(service.get_cell(session, cell_id))


@router.patch("/cells/{cell_id}")
def update_cell(cell_id: int, body: CellUpdate, user: EditorUser, session: DbSession) -> CellRead:
    service.update_cell(session, ui_actor(user), cell_id, body)
    session.commit()
    return CellRead.from_cell(service.get_cell(session, cell_id))


@router.delete("/cells/{cell_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cell(cell_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_cell(session, ui_actor(user), cell_id)
    session.commit()


@router.get("/cells/{cell_id}/versions")
def cell_versions(cell_id: int, _: CurrentUser, session: DbSession) -> list[CellVersionRead]:
    return [CellVersionRead.from_row(v) for v in service.cell_versions(session, cell_id)]


# --- assets ----------------------------------------------------------------------------------


@router.get("/assets")
def list_assets(_: CurrentUser, session: DbSession) -> list[AssetRead]:
    return [AssetRead.model_validate(a) for a in service.list_assets(session)]


@router.post("/assets", status_code=status.HTTP_201_CREATED)
def create_asset(body: AssetCreate, user: EditorUser, session: DbSession) -> AssetRead:
    asset = service.create_asset(session, ui_actor(user), body)
    session.commit()
    return AssetRead.model_validate(asset)


@router.patch("/assets/{asset_id}")
def update_asset(
    asset_id: int, body: AssetUpdate, user: EditorUser, session: DbSession
) -> AssetRead:
    asset, _ = service.update_asset(session, ui_actor(user), asset_id, body)
    session.commit()
    return AssetRead.model_validate(asset)


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_asset(session, ui_actor(user), asset_id)
    session.commit()


# --- devices ---------------------------------------------------------------------------------


@router.get("/devices")
def list_devices(_: CurrentUser, session: DbSession) -> list[DeviceRead]:
    return [DeviceRead.model_validate(d) for d in service.list_devices(session)]


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device(body: DeviceCreate, user: EditorUser, session: DbSession) -> DeviceRead:
    device = service.create_device(session, ui_actor(user), body)
    session.commit()
    return DeviceRead.model_validate(device)


@router.patch("/devices/{device_id}")
def update_device(
    device_id: int, body: DeviceUpdate, user: EditorUser, session: DbSession
) -> DeviceRead:
    device, _ = service.update_device(session, ui_actor(user), device_id, body)
    session.commit()
    return DeviceRead.model_validate(device)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(device_id: int, user: EditorUser, session: DbSession) -> None:
    service.delete_device(session, ui_actor(user), device_id)
    session.commit()


# --- search ----------------------------------------------------------------------------------


@router.get("/search")
def search(
    _: CurrentUser,
    session: DbSession,
    q: str = Query(min_length=1, max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[SearchHit]:
    return service.search(session, q, limit)
