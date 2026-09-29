from datetime import datetime

from sqlalchemy import DateTime, Double, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from dtat.db import Base
from dtat.inventory.models import Cell


class KpiFile(Base):
    """An imported statistics file: what, when and by whom, and the period it covered."""

    __tablename__ = "kpi_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column()
    timezone: Mapped[str] = mapped_column(String(64))
    uploaded_by: Mapped[str] = mapped_column(String(64))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cells: Mapped[int] = mapped_column()
    samples: Mapped[int] = mapped_column()


class KpiCell(Base):
    """A cell as the operator's statistics name it.

    Operator statistics come straight from the network, so their names are the reference. A KPI
    cell is linked to the inventory cell with the same name, or explicitly (`cell_id`) when the
    names differ, e.g. history recorded under a cell's former name.
    """

    __tablename__ = "kpi_cell"

    id: Mapped[int] = mapped_column(primary_key=True)
    cell_name: Mapped[str] = mapped_column(String(64), unique=True)
    enb_name: Mapped[str | None] = mapped_column(String(64))
    cell_id: Mapped[int | None] = mapped_column(
        ForeignKey("cell.id", ondelete="SET NULL"), index=True
    )

    cell: Mapped[Cell | None] = relationship()


class KpiSample(Base):
    """Hourly KPI value of a cell (TimescaleDB hypertable partitioned by time)."""

    __tablename__ = "kpi_sample"
    __table_args__ = (Index("ix_kpi_sample_kpi_time", "kpi", "time"),)

    kpi_cell_id: Mapped[int] = mapped_column(
        ForeignKey("kpi_cell.id", ondelete="CASCADE"), primary_key=True
    )
    kpi: Mapped[str] = mapped_column(String(32), primary_key=True)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    value: Mapped[float] = mapped_column(Double)
