from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator

from dtat.inventory.lte import (
    BANDWIDTHS_MHZ,
    ENB_ID_MAX,
    LOCAL_CELL_ID_MAX,
    PCI_MAX,
    TAC_MAX,
    dl_frequency_mhz,
    imei_is_valid,
)
from dtat.inventory.models import (
    AssetKind,
    Cell,
    CellVersion,
    DeviceKind,
    SiteKind,
    SitePosition,
    Status,
)
from dtat.schemas import OptStr, ORMModel


def _digits(min_len: int, max_len: int, what: str) -> AfterValidator:
    def check(value: str | None) -> str | None:
        if value is not None and not (value.isdigit() and min_len <= len(value) <= max_len):
            raise ValueError(f"{what}: ожидается {min_len}–{max_len} цифр")
        return value

    return AfterValidator(check)


def _check_imei(value: str | None) -> str | None:
    if value is not None and not imei_is_valid(value):
        raise ValueError("IMEI: ожидается 15 цифр с корректной контрольной цифрой")
    return value


def _check_bandwidth(value: float | None) -> float | None:
    if value is not None and value not in BANDWIDTHS_MHZ:
        allowed = ", ".join(f"{b:g}" for b in BANDWIDTHS_MHZ)
        raise ValueError(f"Полоса должна быть одной из: {allowed} МГц")
    return value


Imei = Annotated[OptStr, AfterValidator(_check_imei)]
Imsi = Annotated[OptStr, _digits(14, 15, "IMSI")]
Iccid = Annotated[OptStr, _digits(18, 22, "ICCID")]
Bandwidth = Annotated[float | None, AfterValidator(_check_bandwidth)]
Azimuth = Annotated[float, Field(ge=0, lt=360)]
Tilt = Annotated[float, Field(ge=-30, le=30)]
HeightM = Annotated[float, Field(ge=0, le=500)]
Lat = Annotated[float, Field(ge=-90, le=90)]
Lon = Annotated[float, Field(ge=-180, le=180)]


class EffectiveAt(BaseModel):
    # When the change happened in the real network. Defaults to now. Must not be in the future.
    effective_at: datetime | None = None


# --- Sites -----------------------------------------------------------------------------------


class SiteFields(BaseModel):
    name: OptStr = Field(default=None, max_length=128)
    kind: SiteKind = SiteKind.STATIONARY
    status: Status = Status.ACTIVE
    lat: Lat
    lon: Lon
    structure_type: OptStr = Field(default=None, max_length=32)
    structure_height_m: HeightM | None = None
    ground_elevation_m: float | None = None
    notes: OptStr = None


class SiteCreate(SiteFields):
    code: str = Field(min_length=1, max_length=32)

    @field_validator("code")
    @classmethod
    def _strip_code(cls, value: str) -> str:
        return value.strip()


class SiteUpdate(EffectiveAt):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: OptStr = Field(default=None, max_length=128)
    kind: SiteKind | None = None
    status: Status | None = None
    lat: Lat | None = None
    lon: Lon | None = None
    structure_type: OptStr = Field(default=None, max_length=32)
    structure_height_m: HeightM | None = None
    ground_elevation_m: float | None = None
    notes: OptStr = None


class SiteRead(SiteFields, ORMModel):
    id: int
    code: str
    created_at: datetime
    updated_at: datetime


class SitePositionRead(BaseModel):
    lat: float
    lon: float
    valid_from: datetime | None
    valid_to: datetime | None

    @classmethod
    def from_row(cls, row: SitePosition) -> "SitePositionRead":
        return cls(
            lat=row.lat,
            lon=row.lon,
            valid_from=row.valid_period.lower,
            valid_to=row.valid_period.upper,
        )


# --- eNodeB ----------------------------------------------------------------------------------


class ENodeBFields(BaseModel):
    name: OptStr = Field(default=None, max_length=64)
    vendor: OptStr = Field(default=None, max_length=32)
    hw_model: OptStr = Field(default=None, max_length=64)
    sw_version: OptStr = Field(default=None, max_length=64)
    status: Status = Status.ACTIVE
    notes: OptStr = None


class ENodeBCreate(ENodeBFields):
    site_id: int
    enb_id: int = Field(ge=0, le=ENB_ID_MAX)


class ENodeBUpdate(EffectiveAt):
    site_id: int | None = None
    enb_id: int | None = Field(default=None, ge=0, le=ENB_ID_MAX)
    name: OptStr = Field(default=None, max_length=64)
    vendor: OptStr = Field(default=None, max_length=32)
    hw_model: OptStr = Field(default=None, max_length=64)
    sw_version: OptStr = Field(default=None, max_length=64)
    status: Status | None = None
    notes: OptStr = None


class ENodeBRead(ENodeBFields, ORMModel):
    id: int
    site_id: int
    enb_id: int
    created_at: datetime
    updated_at: datetime


# --- Cells -----------------------------------------------------------------------------------


class CellFields(BaseModel):
    name: OptStr = Field(default=None, max_length=64)
    status: Status = Status.ACTIVE
    pci: int = Field(ge=0, le=PCI_MAX)
    earfcn_dl: int = Field(ge=0)
    earfcn_ul: int | None = Field(default=None, ge=0)
    bandwidth_mhz: Bandwidth = None
    tac: int | None = Field(default=None, ge=0, le=TAC_MAX)
    max_tx_power_dbm: float | None = Field(default=None, ge=-10, le=60)
    antenna_model: OptStr = Field(default=None, max_length=64)
    height_m: HeightM | None = None
    azimuth_deg: Azimuth | None = None
    mech_tilt_deg: Tilt | None = None
    elec_tilt_deg: Tilt | None = None
    beamwidth_deg: float | None = Field(default=None, gt=0, le=360)
    notes: OptStr = None


class CellCreate(CellFields):
    enodeb_id: int
    local_cell_id: int = Field(ge=0, le=LOCAL_CELL_ID_MAX)


class CellUpdate(EffectiveAt):
    enodeb_id: int | None = None
    local_cell_id: int | None = Field(default=None, ge=0, le=LOCAL_CELL_ID_MAX)
    name: OptStr = Field(default=None, max_length=64)
    status: Status | None = None
    pci: int | None = Field(default=None, ge=0, le=PCI_MAX)
    earfcn_dl: int | None = Field(default=None, ge=0)
    earfcn_ul: int | None = Field(default=None, ge=0)
    bandwidth_mhz: Bandwidth = None
    tac: int | None = Field(default=None, ge=0, le=TAC_MAX)
    max_tx_power_dbm: float | None = Field(default=None, ge=-10, le=60)
    antenna_model: OptStr = Field(default=None, max_length=64)
    height_m: HeightM | None = None
    azimuth_deg: Azimuth | None = None
    mech_tilt_deg: Tilt | None = None
    elec_tilt_deg: Tilt | None = None
    beamwidth_deg: float | None = Field(default=None, gt=0, le=360)
    notes: OptStr = None


class CellRead(CellFields):
    id: int
    enodeb_id: int
    enb_id: int
    site_id: int
    site_code: str
    local_cell_id: int
    eci: int
    band: int | None
    dl_frequency_mhz: float | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_cell(cls, cell: Cell) -> "CellRead":
        fields = {name: getattr(cell, name) for name in CellFields.model_fields}
        return cls(
            **fields,
            id=cell.id,
            enodeb_id=cell.enodeb_id,
            enb_id=cell.enodeb.enb_id,
            site_id=cell.enodeb.site_id,
            site_code=cell.enodeb.site.code,
            local_cell_id=cell.local_cell_id,
            eci=cell.eci,
            band=cell.band,
            dl_frequency_mhz=dl_frequency_mhz(cell.earfcn_dl),
            created_at=cell.created_at,
            updated_at=cell.updated_at,
        )


class CellVersionRead(ORMModel):
    valid_from: datetime | None
    valid_to: datetime | None
    site_id: int
    enb_id: int
    local_cell_id: int
    eci: int
    status: Status
    pci: int
    earfcn_dl: int
    earfcn_ul: int | None
    band: int | None
    bandwidth_mhz: float | None
    tac: int | None
    max_tx_power_dbm: float | None
    antenna_model: str | None
    height_m: float | None
    azimuth_deg: float | None
    mech_tilt_deg: float | None
    elec_tilt_deg: float | None
    beamwidth_deg: float | None

    @classmethod
    def from_row(cls, row: CellVersion) -> "CellVersionRead":
        data = {
            name: getattr(row, name)
            for name in cls.model_fields
            if name not in ("valid_from", "valid_to")
        }
        return cls(**data, valid_from=row.valid_period.lower, valid_to=row.valid_period.upper)


# --- Assets and devices ----------------------------------------------------------------------


class AssetFields(BaseModel):
    kind: AssetKind = AssetKind.OTHER
    model: OptStr = Field(default=None, max_length=64)
    notes: OptStr = None


class AssetCreate(AssetFields):
    name: str = Field(min_length=1, max_length=64)


class AssetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    kind: AssetKind | None = None
    model: OptStr = Field(default=None, max_length=64)
    notes: OptStr = None


class AssetRead(AssetFields, ORMModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime


class DeviceFields(BaseModel):
    kind: DeviceKind
    status: Status = Status.ACTIVE
    imei: Imei = None
    imsi: Imsi = None
    iccid: Iccid = None
    model: OptStr = Field(default=None, max_length=64)
    asset_id: int | None = None
    role: OptStr = Field(default=None, max_length=64)
    notes: OptStr = None


class DeviceCreate(DeviceFields):
    name: str = Field(min_length=1, max_length=64)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    kind: DeviceKind | None = None
    status: Status | None = None
    imei: Imei = None
    imsi: Imsi = None
    iccid: Iccid = None
    model: OptStr = Field(default=None, max_length=64)
    asset_id: int | None = None
    role: OptStr = Field(default=None, max_length=64)
    notes: OptStr = None


class DeviceRead(DeviceFields, ORMModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime


# --- Map overlays ----------------------------------------------------------------------------

_GEOMETRY_TYPES = {
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
}


def _check_feature_collection(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("type") != "FeatureCollection" or not isinstance(value.get("features"), list):
        raise ValueError("Ожидается GeoJSON FeatureCollection")
    for i, feature in enumerate(value["features"]):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not isinstance(geometry, dict) or geometry.get("type") not in _GEOMETRY_TYPES:
            raise ValueError(f"Объект #{i + 1}: отсутствует или некорректна геометрия")
    return value


FeatureCollection = Annotated[dict[str, Any], AfterValidator(_check_feature_collection)]
HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class MapOverlayCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: HexColor = "#8a8a8a"
    visible_by_default: bool = True
    geojson: FeatureCollection


class MapOverlayUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: HexColor | None = None
    visible_by_default: bool | None = None
    geojson: FeatureCollection | None = None


class MapOverlaySummary(ORMModel):
    id: int
    name: str
    color: str
    visible_by_default: bool
    updated_at: datetime


class MapOverlayRead(MapOverlaySummary):
    geojson: dict[str, Any]


# --- Search ----------------------------------------------------------------------------------


class SearchHit(BaseModel):
    type: Literal["site", "cell", "device", "asset"]
    id: int
    label: str
    sublabel: str | None = None
    lat: float | None = None
    lon: float | None = None
