from datetime import datetime

from pydantic import BaseModel

from dtat.kpi.definitions import Aggregate, Better, Level
from dtat.schemas import ORMModel


class KpiDefRead(BaseModel):
    code: str
    title: str
    unit: str
    aggregate: Aggregate
    better: Better | None
    warn: float | None
    bad: float | None


class KpiFileRead(ORMModel):
    id: int
    filename: str
    sha256: str
    size_bytes: int
    timezone: str
    uploaded_by: str
    uploaded_at: datetime
    period_start: datetime
    period_end: datetime
    cells: int
    samples: int


class KpiImportRead(BaseModel):
    file: KpiFileRead
    sheet: str
    kpis: list[str]
    unknown_columns: list[str]
    new_cells: list[str]
    unlinked_cells: list[str]


class KpiStatRead(BaseModel):
    value: float | None
    level: Level | None
    worst: float | None
    worst_level: Level | None
    hours: int


class KpiCellStatsRead(BaseModel):
    kpi_cell_id: int
    cell_name: str
    enb_name: str | None
    cell_id: int | None
    values: dict[str, KpiStatRead]


class KpiSummaryRead(BaseModel):
    start: datetime | None
    end: datetime | None
    data_start: datetime | None
    data_end: datetime | None
    cells: list[KpiCellStatsRead]


class KpiPointRead(BaseModel):
    time: datetime
    values: dict[str, float]


class KpiSeriesRead(BaseModel):
    cell_id: int
    start: datetime | None
    end: datetime | None
    points: list[KpiPointRead]


class InventoryCellRef(BaseModel):
    id: int
    name: str | None
    enb_id: int
    enodeb_name: str | None
    site_code: str


class UnlinkedKpiCellRead(BaseModel):
    kpi_cell_id: int
    cell_name: str
    enb_name: str | None
    candidates: list[InventoryCellRef]


class EnbNameDiffRead(BaseModel):
    enodeb_id: int
    enb_id: int
    name: str | None
    kpi_name: str


class ReconciliationRead(BaseModel):
    unlinked: list[UnlinkedKpiCellRead]
    cells_without_kpi: list[InventoryCellRef]
    enb_names: list[EnbNameDiffRead]


class KpiLink(BaseModel):
    cell_id: int | None
    # Give the inventory cell the operator's name (statistics come from the live network).
    rename: bool = True


class KpiCellRead(ORMModel):
    id: int
    cell_name: str
    enb_name: str | None
    cell_id: int | None
