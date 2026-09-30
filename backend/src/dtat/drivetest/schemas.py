from datetime import datetime

from pydantic import BaseModel, Field

from dtat.drivetest.definitions import Quality
from dtat.drivetest.models import DriveSource
from dtat.schemas import OptStr


class MetricRead(BaseModel):
    code: str
    title: str
    unit: str
    bounds: tuple[float, float, float] = Field(
        description="Нижние границы классов «хорошо», «удовлетворительно», «плохо»"
    )


class DriveSessionRead(BaseModel):
    id: int
    name: str
    source: DriveSource
    device_id: int | None
    device_name: str | None
    started_at: datetime
    ended_at: datetime
    samples: int
    distance_m: float
    plmn: str | None
    operator: str | None
    rx_bytes: int | None
    tx_bytes: int | None
    timezone: str
    notes: str | None
    filename: str
    uploaded_by: str
    uploaded_at: datetime


class DriveSessionListItem(DriveSessionRead):
    radio_samples: int
    matched_samples: int


class DriveImportRead(BaseModel):
    sessions: list[DriveSessionRead]


class DriveSessionUpdate(BaseModel):
    name: OptStr = Field(default=None, max_length=128)
    notes: OptStr = None
    device_id: int | None = None


class DistributionRead(BaseModel):
    metric: str
    counts: dict[Quality, int]
    median: float | None
    p10: float | None
    p90: float | None


class ServingCellRead(BaseModel):
    eci: int
    enb_id: int | None
    local_cell_id: int | None
    pci: int | None
    cell_id: int | None
    cell_name: str | None
    site_id: int | None
    site_code: str | None
    samples: int
    rsrp_median: float | None
    rsrq_median: float | None
    sinr_median: float | None
    max_distance_m: float | None
    inventory_pci: int | None


class SegmentRead(BaseModel):
    kind: str
    start: datetime
    end: datetime
    seconds: int
    lat: float | None
    lon: float | None
    eci: int | None
    cell_name: str | None
    rsrp_median: float | None
    sinr_median: float | None


class RenumberHintRead(BaseModel):
    enodeb_id: int
    enb_id: int
    name: str | None
    new_enb_id: int


class UnknownCellRead(BaseModel):
    eci: int
    enb_id: int | None
    local_cell_id: int | None
    pci: int | None
    samples: int
    hint: RenumberHintRead | None


class DriveReportRead(BaseModel):
    samples: int
    with_position: int
    with_radio: int
    matched: int
    distributions: list[DistributionRead]
    cells: list[ServingCellRead]
    cell_changes: int
    ping_pongs: int
    problems: list[SegmentRead]
    unknown: list[UnknownCellRead]


class TrackRead(BaseModel):
    """Samples with a position, column by column."""

    seq: list[int]
    time: list[datetime]
    lat: list[float]
    lon: list[float]
    rsrp: list[float | None]
    rsrq: list[float | None]
    sinr: list[float | None]
    pci: list[int | None]
    eci: list[int | None]
    cell_id: list[int | None]
