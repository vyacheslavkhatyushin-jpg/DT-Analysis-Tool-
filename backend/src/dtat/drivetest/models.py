from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    DateTime,
    Double,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from dtat.db import Base, str_enum
from dtat.inventory.models import Device


class DriveSource(StrEnum):
    NETMONITOR = "netmonitor"
    NEMO = "nemo"
    APP = "app"


class DriveSession(Base):
    """One drive test: a log file from one device, with the original file kept for reprocessing."""

    __tablename__ = "drive_session"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    source: Mapped[DriveSource] = mapped_column(str_enum(DriveSource, "drive_source"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("device.id", ondelete="SET NULL"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    samples: Mapped[int] = mapped_column()
    distance_m: Mapped[float] = mapped_column(Double)
    plmn: Mapped[str | None] = mapped_column(String(8))
    operator: Mapped[str | None] = mapped_column(String(64))
    rx_bytes: Mapped[int | None] = mapped_column(BigInteger)
    tx_bytes: Mapped[int | None] = mapped_column(BigInteger)
    timezone: Mapped[str] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    parser_version: Mapped[str] = mapped_column(String(32))
    # The uploaded file, gzip-compressed: logs can be parsed again by a newer parser.
    original_gz: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    uploaded_by: Mapped[str] = mapped_column(String(64))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    device: Mapped[Device | None] = relationship()


class Measurement(Base):
    """A radio sample of a drive test (TimescaleDB hypertable partitioned by time).

    `cell_id` is the inventory cell the serving ECI matched, with the configuration valid at `time`.
    """

    __tablename__ = "measurement"
    __table_args__ = (Index("ix_measurement_session_time", "session_id", "time"),)

    session_id: Mapped[int] = mapped_column(
        ForeignKey("drive_session.id", ondelete="CASCADE"), primary_key=True
    )
    seq: Mapped[int] = mapped_column(primary_key=True)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    lat: Mapped[float | None] = mapped_column(Double)
    lon: Mapped[float | None] = mapped_column(Double)
    accuracy_m: Mapped[float | None] = mapped_column(Double)
    tech: Mapped[str | None] = mapped_column(String(8))
    tac: Mapped[int | None] = mapped_column()
    enb_id: Mapped[int | None] = mapped_column()
    local_cell_id: Mapped[int | None] = mapped_column(SmallInteger)
    eci: Mapped[int | None] = mapped_column()
    pci: Mapped[int | None] = mapped_column(SmallInteger)
    earfcn: Mapped[int | None] = mapped_column()
    rsrp: Mapped[float | None] = mapped_column(Double)
    rsrq: Mapped[float | None] = mapped_column(Double)
    sinr: Mapped[float | None] = mapped_column(Double)
    neighbors: Mapped[int | None] = mapped_column(SmallInteger)
    best_neighbor_rsrp: Mapped[float | None] = mapped_column(Double)
    cell_id: Mapped[int | None] = mapped_column()  # no FK: samples outlive inventory edits
