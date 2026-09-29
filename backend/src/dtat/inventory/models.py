from datetime import datetime
from enum import StrEnum
from typing import Any

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    Double,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSTZRANGE, ExcludeConstraint, Range
from sqlalchemy.orm import Mapped, mapped_column, relationship

from dtat.db import Base, TimestampMixin, str_enum


class Status(StrEnum):
    PLANNED = "planned"
    ACTIVE = "active"
    INACTIVE = "inactive"
    DISMANTLED = "dismantled"


class SiteKind(StrEnum):
    STATIONARY = "stationary"
    MOBILE = "mobile"


class DeviceKind(StrEnum):
    PHONE = "phone"
    ROUTER = "router"
    RADIO = "radio"
    PROBE = "probe"
    OTHER = "other"


class AssetKind(StrEnum):
    HAUL_TRUCK = "haul_truck"
    EXCAVATOR = "excavator"
    DRILL = "drill"
    DOZER = "dozer"
    LOADER = "loader"
    LIGHT_VEHICLE = "light_vehicle"
    OTHER = "other"


# --- Sites -----------------------------------------------------------------------------------


class Site(Base, TimestampMixin):
    __tablename__ = "site"
    __table_args__ = (
        CheckConstraint("lat BETWEEN -90 AND 90", name="lat_range"),
        CheckConstraint("lon BETWEEN -180 AND 180", name="lon_range"),
        Index("ix_site_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[SiteKind] = mapped_column(str_enum(SiteKind, "site_kind"))
    status: Mapped[Status] = mapped_column(str_enum(Status, "site_status"))
    lat: Mapped[float] = mapped_column(Double)
    lon: Mapped[float] = mapped_column(Double)
    geom: Mapped[WKBElement] = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False),
        Computed("ST_SetSRID(ST_MakePoint(lon, lat), 4326)", persisted=True),
        deferred=True,
    )
    structure_type: Mapped[str | None] = mapped_column(String(32))
    structure_height_m: Mapped[float | None] = mapped_column(Double)
    ground_elevation_m: Mapped[float | None] = mapped_column(Double)
    notes: Mapped[str | None] = mapped_column(Text)

    enodebs: Mapped[list["ENodeB"]] = relationship(back_populates="site", order_by="ENodeB.enb_id")
    # Cells whose antennas are installed here (their eNodeB may be on another site).
    cells: Mapped[list["Cell"]] = relationship(back_populates="site", order_by="Cell.eci")


class SitePosition(Base):
    """Position history of a site: mobile masts move with the mining front."""

    __tablename__ = "site_position"
    __table_args__ = (
        ExcludeConstraint(
            ("site_id", "="), ("valid_period", "&&"), using="gist", name="site_position_no_overlap"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id", ondelete="CASCADE"), index=True)
    lat: Mapped[float] = mapped_column(Double)
    lon: Mapped[float] = mapped_column(Double)
    valid_period: Mapped[Range[datetime]] = mapped_column(TSTZRANGE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- eNodeB and cells ------------------------------------------------------------------------


class ENodeB(Base, TimestampMixin):
    """Base station. `site` is where the baseband is; cells may be installed on other sites
    (remote radio units, DAS in another building)."""

    __tablename__ = "enodeb"
    __table_args__ = (CheckConstraint("enb_id BETWEEN 0 AND 1048575", name="enb_id_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id", ondelete="RESTRICT"), index=True)
    enb_id: Mapped[int] = mapped_column(unique=True)
    name: Mapped[str | None] = mapped_column(String(64))
    vendor: Mapped[str | None] = mapped_column(String(32))
    hw_model: Mapped[str | None] = mapped_column(String(64))
    sw_version: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[Status] = mapped_column(str_enum(Status, "enodeb_status"))
    notes: Mapped[str | None] = mapped_column(Text)

    site: Mapped[Site] = relationship(back_populates="enodebs")
    cells: Mapped[list["Cell"]] = relationship(
        back_populates="enodeb", order_by="Cell.local_cell_id"
    )


class CellConfigMixin:
    """Radio configuration that is versioned in time (see CellVersion)."""

    pci: Mapped[int] = mapped_column()
    earfcn_dl: Mapped[int] = mapped_column()
    earfcn_ul: Mapped[int | None] = mapped_column()
    band: Mapped[int | None] = mapped_column()
    bandwidth_mhz: Mapped[float | None] = mapped_column(Double)
    tac: Mapped[int | None] = mapped_column()
    max_tx_power_dbm: Mapped[float | None] = mapped_column(Double)
    antenna_model: Mapped[str | None] = mapped_column(String(64))
    height_m: Mapped[float | None] = mapped_column(Double)
    azimuth_deg: Mapped[float | None] = mapped_column(Double)
    mech_tilt_deg: Mapped[float | None] = mapped_column(Double)
    elec_tilt_deg: Mapped[float | None] = mapped_column(Double)
    beamwidth_deg: Mapped[float | None] = mapped_column(Double)


# Fields copied into every CellVersion snapshot.
CELL_VERSIONED_FIELDS: tuple[str, ...] = (
    "site_id",
    "eci",
    "local_cell_id",
    "status",
    "pci",
    "earfcn_dl",
    "earfcn_ul",
    "band",
    "bandwidth_mhz",
    "tac",
    "max_tx_power_dbm",
    "antenna_model",
    "height_m",
    "azimuth_deg",
    "mech_tilt_deg",
    "elec_tilt_deg",
    "beamwidth_deg",
)


class Cell(CellConfigMixin, Base, TimestampMixin):
    __tablename__ = "cell"
    __table_args__ = (
        UniqueConstraint("enodeb_id", "local_cell_id", name="uq_cell_enodeb_local_cell"),
        CheckConstraint("local_cell_id BETWEEN 0 AND 255", name="local_cell_id_range"),
        CheckConstraint("pci BETWEEN 0 AND 503", name="pci_range"),
        CheckConstraint("tac BETWEEN 0 AND 65535", name="tac_range"),
        CheckConstraint("azimuth_deg >= 0 AND azimuth_deg < 360", name="azimuth_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    enodeb_id: Mapped[int] = mapped_column(ForeignKey("enodeb.id", ondelete="RESTRICT"), index=True)
    # Where the antenna is installed: usually the eNodeB's site, but not for remote sectors.
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id", ondelete="RESTRICT"), index=True)
    local_cell_id: Mapped[int] = mapped_column()
    # Derived from eNB ID and local cell ID by the service layer; unique network-wide.
    eci: Mapped[int] = mapped_column(unique=True)
    name: Mapped[str | None] = mapped_column(String(64), unique=True)
    status: Mapped[Status] = mapped_column(str_enum(Status, "cell_status"))
    notes: Mapped[str | None] = mapped_column(Text)

    enodeb: Mapped[ENodeB] = relationship(back_populates="cells")
    site: Mapped[Site] = relationship(back_populates="cells")


class CellVersion(CellConfigMixin, Base):
    """Cell configuration valid during `valid_period`: the network as it was at any moment."""

    __tablename__ = "cell_version"
    __table_args__ = (
        ExcludeConstraint(
            ("cell_id", "="), ("valid_period", "&&"), using="gist", name="cell_version_no_overlap"
        ),
        Index("ix_cell_version_eci", "eci"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cell_id: Mapped[int] = mapped_column(ForeignKey("cell.id", ondelete="CASCADE"), index=True)
    valid_period: Mapped[Range[datetime]] = mapped_column(TSTZRANGE)
    site_id: Mapped[int] = mapped_column()
    enb_id: Mapped[int] = mapped_column()
    local_cell_id: Mapped[int] = mapped_column()
    eci: Mapped[int] = mapped_column()
    status: Mapped[Status] = mapped_column(str_enum(Status, "cell_version_status"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- Assets and devices ----------------------------------------------------------------------


class Asset(Base, TimestampMixin):
    """A piece of mining equipment or a vehicle."""

    __tablename__ = "asset"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[AssetKind] = mapped_column(str_enum(AssetKind, "asset_kind"))
    model: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)

    devices: Mapped[list["Device"]] = relationship(back_populates="asset")


class Device(Base, TimestampMixin):
    """Subscriber device: phone, router, PTT radio or a fixed test probe."""

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[DeviceKind] = mapped_column(str_enum(DeviceKind, "device_kind"))
    status: Mapped[Status] = mapped_column(str_enum(Status, "device_status"))
    imei: Mapped[str | None] = mapped_column(String(15), unique=True)
    imsi: Mapped[str | None] = mapped_column(String(15))
    iccid: Mapped[str | None] = mapped_column(String(22))
    model: Mapped[str | None] = mapped_column(String(64))
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("asset.id", ondelete="SET NULL"))
    # A role ("мастер участка"), not a person's name: devices must not identify people.
    role: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)

    asset: Mapped[Asset | None] = relationship(back_populates="devices")


# --- Map overlays ----------------------------------------------------------------------------


class MapOverlay(Base, TimestampMixin):
    """Vector layer drawn over the basemap: pit contour, roads, zones (GeoJSON, WGS-84)."""

    __tablename__ = "map_overlay"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    color: Mapped[str] = mapped_column(String(16))
    visible_by_default: Mapped[bool] = mapped_column(default=True)
    geojson: Mapped[dict[str, Any]] = mapped_column(JSONB)
