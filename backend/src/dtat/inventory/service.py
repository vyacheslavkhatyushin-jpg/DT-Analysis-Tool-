"""Inventory business logic.

Services validate, apply changes, keep history (site positions, cell versions) and write the
audit log. They never commit: the caller owns the transaction, so an Excel import can run many
operations atomically and a dry run is simply a rollback.
"""

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import InstrumentedAttribute, Session, joinedload, selectinload

from dtat.audit.service import Actor, ChangeAction, diff, record_change
from dtat.db import Base, utcnow
from dtat.errors import ConflictError, InvalidDataError, NotFoundError
from dtat.inventory.lte import band_number, make_eci
from dtat.inventory.models import (
    CELL_VERSIONED_FIELDS,
    Asset,
    Cell,
    CellVersion,
    Device,
    ENodeB,
    MapOverlay,
    Site,
    SitePosition,
)
from dtat.inventory.schemas import (
    AssetCreate,
    AssetUpdate,
    CellCreate,
    CellUpdate,
    DeviceCreate,
    DeviceUpdate,
    ENodeBCreate,
    ENodeBUpdate,
    MapOverlayCreate,
    MapOverlayUpdate,
    SearchHit,
    SiteCreate,
    SiteUpdate,
)

SITE_FIELDS = (
    "code",
    "name",
    "kind",
    "status",
    "lat",
    "lon",
    "structure_type",
    "structure_height_m",
    "ground_elevation_m",
    "notes",
)
ENODEB_FIELDS = ("site_id", "enb_id", "name", "vendor", "hw_model", "sw_version", "status", "notes")
CELL_FIELDS = ("enodeb_id", "name", "notes", *CELL_VERSIONED_FIELDS)
ASSET_FIELDS = ("name", "kind", "model", "notes")
DEVICE_FIELDS = (
    "name",
    "kind",
    "status",
    "imei",
    "imsi",
    "iccid",
    "model",
    "asset_id",
    "role",
    "notes",
)
OVERLAY_FIELDS = ("name", "color", "visible_by_default")

# Clock skew tolerated for `effective_at` sent by clients.
_FUTURE_TOLERANCE = timedelta(minutes=5)


# --- helpers ---------------------------------------------------------------------------------


def _snapshot(obj: object, fields: Iterable[str]) -> dict[str, Any]:
    return {field: getattr(obj, field) for field in fields}


def _apply(obj: object, values: dict[str, Any]) -> None:
    for field, value in values.items():
        setattr(obj, field, value)


def _reject_nulls(values: dict[str, Any], required: Iterable[str]) -> None:
    for field in required:
        if field in values and values[field] is None:
            raise InvalidDataError(f"Поле {field} не может быть пустым", field=field)


def _get[M: Base](session: Session, model: type[M], obj_id: int, what: str) -> M:
    obj = session.get(model, obj_id)
    if obj is None:
        raise NotFoundError(f"{what} #{obj_id} не найден(а)")
    return obj


def _ensure_unique(
    session: Session,
    column: InstrumentedAttribute[Any],
    value: Any,
    message: str,
    *,
    exclude_id: int | None = None,
) -> None:
    if value is None:
        return
    model = column.class_
    query = select(model.id).where(column == value)
    if exclude_id is not None:
        query = query.where(model.id != exclude_id)
    if session.scalar(query.limit(1)) is not None:
        raise ConflictError(message, field=column.key)


def effective_time(effective_at: datetime | None) -> datetime:
    """Moment a change took effect in the real network; naive values are treated as UTC."""
    now = utcnow()
    if effective_at is None:
        return now
    if effective_at.tzinfo is None:
        effective_at = effective_at.replace(tzinfo=UTC)
    if effective_at > now + _FUTURE_TOLERANCE:
        raise InvalidDataError("Дата изменения не может быть в будущем", field="effective_at")
    return effective_at


def _current_row(
    session: Session, model: type[SitePosition] | type[CellVersion], owner: ColumnElement[bool]
) -> Any:
    return session.scalars(
        select(model).where(owner, func.upper_inf(model.valid_period))
    ).one_or_none()


def _split_history(
    session: Session,
    current: SitePosition | CellVersion,
    new_row: SitePosition | CellVersion,
    at: datetime,
) -> None:
    """Close `current` at `at` and open `new_row` from `at` on."""
    lower = current.valid_period.lower
    if lower is not None and at <= lower:
        raise InvalidDataError(
            f"Дата изменения должна быть позже предыдущего изменения ({lower:%Y-%m-%d %H:%M} UTC)",
            field="effective_at",
        )
    current.valid_period = Range(lower, at, bounds="[)")
    # The exclusion constraint is checked per statement: close the old period before inserting.
    session.flush()
    new_row.valid_period = Range(at, None, bounds="[)")
    session.add(new_row)


# --- sites -----------------------------------------------------------------------------------


def list_sites(session: Session) -> Sequence[Site]:
    return session.scalars(select(Site).order_by(Site.code)).all()


def get_site(session: Session, site_id: int) -> Site:
    return _get(session, Site, site_id, "Сайт")


def find_site_by_code(session: Session, code: str) -> Site | None:
    return session.scalars(select(Site).where(Site.code == code)).one_or_none()


def create_site(session: Session, actor: Actor, data: SiteCreate) -> Site:
    _ensure_unique(session, Site.code, data.code, f"Сайт с кодом {data.code} уже существует")
    site = Site(**data.model_dump())
    session.add(site)
    session.flush()
    # The first known position is assumed valid since forever: older measurements still match.
    session.add(
        SitePosition(site_id=site.id, lat=site.lat, lon=site.lon, valid_period=Range(None, None))
    )
    record_change(
        session,
        actor,
        entity_type="site",
        entity_id=site.id,
        entity_label=site.code,
        action=ChangeAction.CREATE,
        changes=diff({}, _snapshot(site, SITE_FIELDS)),
    )
    return site


def update_site(
    session: Session, actor: Actor, site_id: int, data: SiteUpdate
) -> tuple[Site, bool]:
    site = get_site(session, site_id)
    at = effective_time(data.effective_at)
    values = data.model_dump(exclude_unset=True, exclude={"effective_at"})
    _reject_nulls(values, ("code", "kind", "status", "lat", "lon"))
    if values.get("code") not in (None, site.code):
        _ensure_unique(
            session, Site.code, values["code"], f"Сайт с кодом {values['code']} уже существует"
        )

    before = _snapshot(site, SITE_FIELDS)
    _apply(site, values)
    changes = diff(before, _snapshot(site, SITE_FIELDS))
    if not changes:
        return site, False

    if "lat" in changes or "lon" in changes:
        current = _current_row(session, SitePosition, SitePosition.site_id == site.id)
        new_position = SitePosition(site_id=site.id, lat=site.lat, lon=site.lon)
        if current is None:
            new_position.valid_period = Range(None, None)
            session.add(new_position)
        else:
            _split_history(session, current, new_position, at)

    record_change(
        session,
        actor,
        entity_type="site",
        entity_id=site.id,
        entity_label=site.code,
        action=ChangeAction.UPDATE,
        changes=changes,
    )
    session.flush()
    return site, True


def delete_site(session: Session, actor: Actor, site_id: int) -> None:
    site = get_site(session, site_id)
    if site.enodebs:
        raise ConflictError("На сайте есть eNodeB: сначала удалите или перенесите их")
    if site.cells:
        raise ConflictError("На сайте установлены соты: сначала удалите или перенесите их")
    record_change(
        session,
        actor,
        entity_type="site",
        entity_id=site.id,
        entity_label=site.code,
        action=ChangeAction.DELETE,
        changes=diff(_snapshot(site, SITE_FIELDS), {}),
    )
    session.delete(site)
    session.flush()


def site_positions(session: Session, site_id: int) -> Sequence[SitePosition]:
    get_site(session, site_id)
    return session.scalars(
        select(SitePosition)
        .where(SitePosition.site_id == site_id)
        .order_by(func.lower(SitePosition.valid_period).desc().nulls_last())
    ).all()


# --- eNodeB ----------------------------------------------------------------------------------


def list_enodebs(session: Session, site_id: int | None = None) -> Sequence[ENodeB]:
    query = select(ENodeB).order_by(ENodeB.enb_id)
    if site_id is not None:
        query = query.where(ENodeB.site_id == site_id)
    return session.scalars(query).all()


def get_enodeb(session: Session, enodeb_id: int) -> ENodeB:
    return _get(session, ENodeB, enodeb_id, "eNodeB")


def find_enodeb_by_enb_id(session: Session, enb_id: int) -> ENodeB | None:
    return session.scalars(select(ENodeB).where(ENodeB.enb_id == enb_id)).one_or_none()


def _enodeb_label(enodeb: ENodeB) -> str:
    return f"eNB {enodeb.enb_id}" + (f" {enodeb.name}" if enodeb.name else "")


def create_enodeb(session: Session, actor: Actor, data: ENodeBCreate) -> ENodeB:
    get_site(session, data.site_id)
    _ensure_unique(session, ENodeB.enb_id, data.enb_id, f"eNB ID {data.enb_id} уже используется")
    enodeb = ENodeB(**data.model_dump())
    session.add(enodeb)
    session.flush()
    record_change(
        session,
        actor,
        entity_type="enodeb",
        entity_id=enodeb.id,
        entity_label=_enodeb_label(enodeb),
        action=ChangeAction.CREATE,
        changes=diff({}, _snapshot(enodeb, ENODEB_FIELDS)),
    )
    return enodeb


def update_enodeb(
    session: Session, actor: Actor, enodeb_id: int, data: ENodeBUpdate
) -> tuple[ENodeB, bool]:
    enodeb = get_enodeb(session, enodeb_id)
    at = effective_time(data.effective_at)
    values = data.model_dump(exclude_unset=True, exclude={"effective_at"})
    _reject_nulls(values, ("site_id", "enb_id", "status"))
    if values.get("site_id") not in (None, enodeb.site_id):
        get_site(session, values["site_id"])
    new_enb_id = values.get("enb_id", enodeb.enb_id)
    if new_enb_id != enodeb.enb_id:
        _ensure_unique(session, ENodeB.enb_id, new_enb_id, f"eNB ID {new_enb_id} уже используется")
        new_ecis = [make_eci(new_enb_id, cell.local_cell_id) for cell in enodeb.cells]
        clash = session.scalar(
            select(Cell.eci).where(Cell.eci.in_(new_ecis), Cell.enodeb_id != enodeb.id).limit(1)
        )
        if clash is not None:
            raise ConflictError(f"После смены eNB ID совпадёт ECI {clash} с другой сотой")

    before = _snapshot(enodeb, ENODEB_FIELDS)
    _apply(enodeb, values)
    changes = diff(before, _snapshot(enodeb, ENODEB_FIELDS))
    if not changes:
        return enodeb, False
    session.flush()
    session.refresh(enodeb, ["site"])

    # Moving the eNodeB (baseband) does not move its cells: they keep their own site.
    if "enb_id" in changes:
        for cell in enodeb.cells:
            cell.eci = make_eci(enodeb.enb_id, cell.local_cell_id)
            session.flush()
            _sync_cell_version(session, cell, at)

    record_change(
        session,
        actor,
        entity_type="enodeb",
        entity_id=enodeb.id,
        entity_label=_enodeb_label(enodeb),
        action=ChangeAction.UPDATE,
        changes=changes,
    )
    session.flush()
    return enodeb, True


def delete_enodeb(session: Session, actor: Actor, enodeb_id: int) -> None:
    enodeb = get_enodeb(session, enodeb_id)
    if enodeb.cells:
        raise ConflictError("У eNodeB есть соты: сначала удалите или перенесите их")
    record_change(
        session,
        actor,
        entity_type="enodeb",
        entity_id=enodeb.id,
        entity_label=_enodeb_label(enodeb),
        action=ChangeAction.DELETE,
        changes=diff(_snapshot(enodeb, ENODEB_FIELDS), {}),
    )
    session.delete(enodeb)
    session.flush()


# --- cells -----------------------------------------------------------------------------------


def _cells_query() -> Select[Cell]:
    return select(Cell).options(
        joinedload(Cell.enodeb).joinedload(ENodeB.site), joinedload(Cell.site)
    )


def list_cells(session: Session, site_id: int | None = None) -> Sequence[Cell]:
    """All cells, or the cells installed on `site_id` (whatever site their eNodeB is on)."""
    query = _cells_query().join(Cell.enodeb).order_by(ENodeB.enb_id, Cell.local_cell_id)
    if site_id is not None:
        query = query.where(Cell.site_id == site_id)
    return session.scalars(query).unique().all()


def get_cell(session: Session, cell_id: int) -> Cell:
    cell = session.scalars(_cells_query().where(Cell.id == cell_id)).unique().one_or_none()
    if cell is None:
        raise NotFoundError(f"Сота #{cell_id} не найдена")
    return cell


def find_cell_by_eci(session: Session, eci: int) -> Cell | None:
    return session.scalars(_cells_query().where(Cell.eci == eci)).unique().one_or_none()


def _cell_label(cell: Cell) -> str:
    return cell.name or f"ECI {cell.eci}"


def _band_or_error(earfcn_dl: int) -> int:
    band = band_number(earfcn_dl)
    if band is None:
        raise InvalidDataError(
            f"EARFCN {earfcn_dl} не относится к известному FDD-диапазону", field="earfcn_dl"
        )
    return band


def _version_snapshot(cell: Cell) -> dict[str, Any]:
    return {**_snapshot(cell, CELL_VERSIONED_FIELDS), "enb_id": cell.enodeb.enb_id}


def _sync_cell_version(session: Session, cell: Cell, at: datetime) -> None:
    """Open a new configuration version if the cell differs from its current version."""
    snapshot = _version_snapshot(cell)
    current = _current_row(session, CellVersion, CellVersion.cell_id == cell.id)
    if current is None:
        session.add(CellVersion(cell_id=cell.id, valid_period=Range(None, None), **snapshot))
        return
    if all(getattr(current, key) == value for key, value in snapshot.items()):
        return
    _split_history(session, current, CellVersion(cell_id=cell.id, **snapshot), at)


def create_cell(session: Session, actor: Actor, data: CellCreate) -> Cell:
    enodeb = get_enodeb(session, data.enodeb_id)
    eci = make_eci(enodeb.enb_id, data.local_cell_id)
    _ensure_unique(
        session,
        Cell.eci,
        eci,
        f"Сота с eNB ID {enodeb.enb_id} / Cell ID {data.local_cell_id} (ECI {eci}) уже существует",
    )
    _ensure_unique(session, Cell.name, data.name, f"Сота с именем {data.name} уже существует")
    # By default the antenna is installed where the eNodeB is.
    site_id = data.site_id if data.site_id is not None else enodeb.site_id
    get_site(session, site_id)
    cell = Cell(
        **data.model_dump(exclude={"site_id"}),
        site_id=site_id,
        eci=eci,
        band=_band_or_error(data.earfcn_dl),
    )
    session.add(cell)
    session.flush()
    session.refresh(cell, ["enodeb", "site"])
    # As with sites, the first known configuration is assumed valid since forever.
    session.add(
        CellVersion(cell_id=cell.id, valid_period=Range(None, None), **_version_snapshot(cell))
    )
    record_change(
        session,
        actor,
        entity_type="cell",
        entity_id=cell.id,
        entity_label=_cell_label(cell),
        action=ChangeAction.CREATE,
        changes=diff({}, _snapshot(cell, CELL_FIELDS)),
    )
    session.flush()
    return cell


def update_cell(
    session: Session, actor: Actor, cell_id: int, data: CellUpdate
) -> tuple[Cell, bool]:
    cell = get_cell(session, cell_id)
    at = effective_time(data.effective_at)
    values = data.model_dump(exclude_unset=True, exclude={"effective_at"})
    _reject_nulls(values, ("enodeb_id", "site_id", "local_cell_id", "status", "pci", "earfcn_dl"))

    # Validate everything before touching the object: queries below autoflush pending changes.
    if values.get("site_id", cell.site_id) != cell.site_id:
        get_site(session, values["site_id"])
    enodeb = cell.enodeb
    if values.get("enodeb_id", cell.enodeb_id) != cell.enodeb_id:
        enodeb = get_enodeb(session, values["enodeb_id"])
    local_cell_id = values.get("local_cell_id", cell.local_cell_id)
    eci = make_eci(enodeb.enb_id, local_cell_id)
    if eci != cell.eci:
        _ensure_unique(
            session, Cell.eci, eci, f"Сота с ECI {eci} уже существует", exclude_id=cell.id
        )
    if values.get("name") not in (None, cell.name):
        _ensure_unique(
            session, Cell.name, values["name"], f"Сота с именем {values['name']} уже существует"
        )
    if "earfcn_dl" in values:
        values["band"] = _band_or_error(values["earfcn_dl"])

    before = _snapshot(cell, CELL_FIELDS)
    _apply(cell, {**values, "eci": eci})
    changes = diff(before, _snapshot(cell, CELL_FIELDS))
    if not changes:
        return cell, False
    session.flush()
    session.refresh(cell, ["enodeb", "site"])
    _sync_cell_version(session, cell, at)
    record_change(
        session,
        actor,
        entity_type="cell",
        entity_id=cell.id,
        entity_label=_cell_label(cell),
        action=ChangeAction.UPDATE,
        changes=changes,
    )
    session.flush()
    return cell, True


def delete_cell(session: Session, actor: Actor, cell_id: int) -> None:
    cell = get_cell(session, cell_id)
    record_change(
        session,
        actor,
        entity_type="cell",
        entity_id=cell.id,
        entity_label=_cell_label(cell),
        action=ChangeAction.DELETE,
        changes=diff(_snapshot(cell, CELL_FIELDS), {}),
    )
    session.delete(cell)
    session.flush()


def cell_versions(session: Session, cell_id: int) -> Sequence[CellVersion]:
    get_cell(session, cell_id)
    return session.scalars(
        select(CellVersion)
        .where(CellVersion.cell_id == cell_id)
        .order_by(func.lower(CellVersion.valid_period).desc().nulls_last())
    ).all()


# --- assets ----------------------------------------------------------------------------------


def list_assets(session: Session) -> Sequence[Asset]:
    return session.scalars(select(Asset).order_by(Asset.name)).all()


def get_asset(session: Session, asset_id: int) -> Asset:
    return _get(session, Asset, asset_id, "Техника")


def find_asset_by_name(session: Session, name: str) -> Asset | None:
    return session.scalars(select(Asset).where(Asset.name == name)).one_or_none()


def create_asset(session: Session, actor: Actor, data: AssetCreate) -> Asset:
    _ensure_unique(session, Asset.name, data.name, f"Техника {data.name} уже существует")
    asset = Asset(**data.model_dump())
    session.add(asset)
    session.flush()
    record_change(
        session,
        actor,
        entity_type="asset",
        entity_id=asset.id,
        entity_label=asset.name,
        action=ChangeAction.CREATE,
        changes=diff({}, _snapshot(asset, ASSET_FIELDS)),
    )
    return asset


def update_asset(
    session: Session, actor: Actor, asset_id: int, data: AssetUpdate
) -> tuple[Asset, bool]:
    asset = get_asset(session, asset_id)
    values = data.model_dump(exclude_unset=True)
    _reject_nulls(values, ("name", "kind"))
    if values.get("name") not in (None, asset.name):
        _ensure_unique(
            session, Asset.name, values["name"], f"Техника {values['name']} уже существует"
        )
    before = _snapshot(asset, ASSET_FIELDS)
    _apply(asset, values)
    changes = diff(before, _snapshot(asset, ASSET_FIELDS))
    if not changes:
        return asset, False
    record_change(
        session,
        actor,
        entity_type="asset",
        entity_id=asset.id,
        entity_label=asset.name,
        action=ChangeAction.UPDATE,
        changes=changes,
    )
    session.flush()
    return asset, True


def delete_asset(session: Session, actor: Actor, asset_id: int) -> None:
    asset = get_asset(session, asset_id)
    record_change(
        session,
        actor,
        entity_type="asset",
        entity_id=asset.id,
        entity_label=asset.name,
        action=ChangeAction.DELETE,
        changes=diff(_snapshot(asset, ASSET_FIELDS), {}),
    )
    session.delete(asset)
    session.flush()


# --- devices ---------------------------------------------------------------------------------


def list_devices(session: Session) -> Sequence[Device]:
    return session.scalars(select(Device).order_by(Device.kind, Device.name)).all()


def get_device(session: Session, device_id: int) -> Device:
    return _get(session, Device, device_id, "Устройство")


def find_device(session: Session, *, name: str, imei: str | None) -> Device | None:
    """Match by IMEI when known, otherwise by name."""
    if imei:
        device = session.scalars(select(Device).where(Device.imei == imei)).one_or_none()
        if device is not None:
            return device
    return session.scalars(select(Device).where(Device.name == name)).one_or_none()


def create_device(session: Session, actor: Actor, data: DeviceCreate) -> Device:
    _ensure_unique(session, Device.name, data.name, f"Устройство {data.name} уже существует")
    _ensure_unique(session, Device.imei, data.imei, f"IMEI {data.imei} уже зарегистрирован")
    if data.asset_id is not None:
        get_asset(session, data.asset_id)
    device = Device(**data.model_dump())
    session.add(device)
    session.flush()
    record_change(
        session,
        actor,
        entity_type="device",
        entity_id=device.id,
        entity_label=device.name,
        action=ChangeAction.CREATE,
        changes=diff({}, _snapshot(device, DEVICE_FIELDS)),
    )
    return device


def update_device(
    session: Session, actor: Actor, device_id: int, data: DeviceUpdate
) -> tuple[Device, bool]:
    device = get_device(session, device_id)
    values = data.model_dump(exclude_unset=True)
    _reject_nulls(values, ("name", "kind", "status"))
    if values.get("name") not in (None, device.name):
        _ensure_unique(
            session, Device.name, values["name"], f"Устройство {values['name']} уже существует"
        )
    if values.get("imei") not in (None, device.imei):
        _ensure_unique(
            session, Device.imei, values["imei"], f"IMEI {values['imei']} уже зарегистрирован"
        )
    if values.get("asset_id") is not None:
        get_asset(session, values["asset_id"])
    before = _snapshot(device, DEVICE_FIELDS)
    _apply(device, values)
    changes = diff(before, _snapshot(device, DEVICE_FIELDS))
    if not changes:
        return device, False
    record_change(
        session,
        actor,
        entity_type="device",
        entity_id=device.id,
        entity_label=device.name,
        action=ChangeAction.UPDATE,
        changes=changes,
    )
    session.flush()
    return device, True


def delete_device(session: Session, actor: Actor, device_id: int) -> None:
    device = get_device(session, device_id)
    record_change(
        session,
        actor,
        entity_type="device",
        entity_id=device.id,
        entity_label=device.name,
        action=ChangeAction.DELETE,
        changes=diff(_snapshot(device, DEVICE_FIELDS), {}),
    )
    session.delete(device)
    session.flush()


# --- map overlays ----------------------------------------------------------------------------


def _overlay_snapshot(overlay: MapOverlay) -> dict[str, Any]:
    # The GeoJSON itself can be megabytes: the audit log keeps only the feature count.
    return {**_snapshot(overlay, OVERLAY_FIELDS), "features": len(overlay.geojson["features"])}


def list_overlays(session: Session) -> Sequence[MapOverlay]:
    return session.scalars(select(MapOverlay).order_by(MapOverlay.name)).all()


def get_overlay(session: Session, overlay_id: int) -> MapOverlay:
    return _get(session, MapOverlay, overlay_id, "Слой")


def create_overlay(session: Session, actor: Actor, data: MapOverlayCreate) -> MapOverlay:
    _ensure_unique(session, MapOverlay.name, data.name, f"Слой {data.name} уже существует")
    overlay = MapOverlay(**data.model_dump())
    session.add(overlay)
    session.flush()
    record_change(
        session,
        actor,
        entity_type="map_overlay",
        entity_id=overlay.id,
        entity_label=overlay.name,
        action=ChangeAction.CREATE,
        changes=diff({}, _overlay_snapshot(overlay)),
    )
    return overlay


def update_overlay(
    session: Session, actor: Actor, overlay_id: int, data: MapOverlayUpdate
) -> MapOverlay:
    overlay = get_overlay(session, overlay_id)
    values = data.model_dump(exclude_unset=True)
    _reject_nulls(values, ("name", "color", "visible_by_default", "geojson"))
    if values.get("name") not in (None, overlay.name):
        _ensure_unique(
            session, MapOverlay.name, values["name"], f"Слой {values['name']} уже существует"
        )
    before = _overlay_snapshot(overlay)
    geojson_changed = "geojson" in values and values["geojson"] != overlay.geojson
    _apply(overlay, values)
    changes = diff(before, _overlay_snapshot(overlay))
    if geojson_changed:
        changes.setdefault("features", [before["features"], len(overlay.geojson["features"])])
    if changes:
        record_change(
            session,
            actor,
            entity_type="map_overlay",
            entity_id=overlay.id,
            entity_label=overlay.name,
            action=ChangeAction.UPDATE,
            changes=changes,
        )
    session.flush()
    return overlay


def delete_overlay(session: Session, actor: Actor, overlay_id: int) -> None:
    overlay = get_overlay(session, overlay_id)
    record_change(
        session,
        actor,
        entity_type="map_overlay",
        entity_id=overlay.id,
        entity_label=overlay.name,
        action=ChangeAction.DELETE,
        changes=diff(_overlay_snapshot(overlay), {}),
    )
    session.delete(overlay)
    session.flush()


# --- map & search ----------------------------------------------------------------------------


def sites_with_cells(session: Session) -> Sequence[Site]:
    """Sites with the cells installed on them (and each cell's eNodeB)."""
    return session.scalars(
        select(Site).options(selectinload(Site.cells).joinedload(Cell.enodeb)).order_by(Site.code)
    ).all()


def search(session: Session, q: str, limit: int = 20) -> list[SearchHit]:
    q = q.strip()
    if not q:
        return []
    pattern = f"%{q}%"
    hits: list[SearchHit] = []

    for site in session.scalars(
        select(Site).where(or_(Site.code.ilike(pattern), Site.name.ilike(pattern))).limit(limit)
    ):
        hits.append(
            SearchHit(
                type="site",
                id=site.id,
                label=site.code,
                sublabel=site.name,
                lat=site.lat,
                lon=site.lon,
            )
        )

    cell_filter: ColumnElement[bool] = Cell.name.ilike(pattern)
    if q.isdigit():
        number = int(q)
        cell_filter = or_(
            cell_filter, Cell.eci == number, Cell.pci == number, ENodeB.enb_id == number
        )
    cells = session.scalars(
        _cells_query().join(Cell.enodeb).where(cell_filter).order_by(Cell.eci).limit(limit)
    ).unique()
    for cell in cells:
        site = cell.site
        hits.append(
            SearchHit(
                type="cell",
                id=cell.id,
                label=_cell_label(cell),
                sublabel=f"{site.code} · ECI {cell.eci} · PCI {cell.pci} · EARFCN {cell.earfcn_dl}",
                lat=site.lat,
                lon=site.lon,
            )
        )

    for device in session.scalars(
        select(Device)
        .where(or_(Device.name.ilike(pattern), Device.imei.ilike(pattern)))
        .limit(limit)
    ):
        hits.append(
            SearchHit(type="device", id=device.id, label=device.name, sublabel=device.model)
        )

    for asset in session.scalars(select(Asset).where(Asset.name.ilike(pattern)).limit(limit)):
        hits.append(SearchHit(type="asset", id=asset.id, label=asset.name, sublabel=asset.model))

    return hits[:limit]
