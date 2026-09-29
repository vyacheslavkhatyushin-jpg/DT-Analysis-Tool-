import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg
from sqlalchemy import bindparam, func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from dtat.audit.service import Actor
from dtat.errors import InvalidDataError, NotFoundError
from dtat.inventory import service as inventory
from dtat.inventory.models import Cell, ENodeB
from dtat.inventory.schemas import CellUpdate
from dtat.kpi.definitions import KPI_BY_CODE, TRAFFIC_KPIS, Aggregate
from dtat.kpi.models import KpiCell, KpiFile, KpiSample
from dtat.kpi.report import HourlyReport

DEFAULT_PERIOD = timedelta(days=7)
ENB_NUMBER_RE = re.compile(r"(\d{4,7})")


# --- import ----------------------------------------------------------------------------------


@dataclass
class ImportResult:
    file: KpiFile
    sheet: str
    kpis: list[str]
    unknown_columns: list[str]
    new_cells: list[str]
    unlinked_cells: list[str]


def import_report(
    session: Session, actor: Actor, data: bytes, filename: str, timezone: str
) -> ImportResult:
    """Load an hourly report; values already stored for the same cell, KPI and hour are replaced."""
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise InvalidDataError(f"Неизвестный часовой пояс: {timezone}", field="timezone") from exc

    report = HourlyReport(data)
    # COPY through the psycopg connection of the ORM transaction: an import is 10^5–10^6 values.
    raw = session.connection().connection.driver_connection
    assert isinstance(raw, psycopg.Connection)
    try:
        with raw.cursor() as cur:
            cur.execute(
                "CREATE TEMP TABLE kpi_in (time timestamptz, cell_name text, enb_name text, "
                "kpi text, value double precision)"
            )
            with cur.copy("COPY kpi_in (time, cell_name, enb_name, kpi, value) FROM STDIN") as cp:
                for row in report.rows():
                    moment = row.local_time.replace(tzinfo=zone)
                    for kpi, value in row.values.items():
                        cp.write_row((moment, row.cell_name, row.enb_name, kpi, value))
    finally:
        report.close()

    stats = session.execute(
        text("SELECT min(time), max(time), count(DISTINCT cell_name), count(*) FROM kpi_in")
    ).one()
    if not stats[3]:
        session.execute(text("DROP TABLE kpi_in"))
        raise InvalidDataError("В файле нет значений KPI")
    known = set(session.scalars(select(KpiCell.cell_name)))
    # The eNodeB name of the latest hour wins: the operator may rename a node.
    session.execute(
        text(
            "INSERT INTO kpi_cell (cell_name, enb_name) "
            "SELECT DISTINCT ON (cell_name) cell_name, enb_name FROM kpi_in "
            "ORDER BY cell_name, time DESC "
            "ON CONFLICT (cell_name) DO UPDATE SET enb_name = EXCLUDED.enb_name"
        )
    )
    session.execute(
        text(
            "INSERT INTO kpi_sample (kpi_cell_id, kpi, time, value) "
            "SELECT DISTINCT ON (c.id, i.kpi, i.time) c.id, i.kpi, i.time, i.value "
            "FROM kpi_in i JOIN kpi_cell c USING (cell_name) "
            "ON CONFLICT (kpi_cell_id, kpi, time) DO UPDATE SET value = EXCLUDED.value"
        )
    )
    names = list(session.scalars(text("SELECT DISTINCT cell_name FROM kpi_in ORDER BY 1")))
    session.execute(text("DROP TABLE kpi_in"))

    file = KpiFile(
        filename=filename[:255],
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        timezone=timezone,
        uploaded_by=actor.username or "system",
        period_start=stats[0],
        period_end=stats[1] + timedelta(hours=1),
        cells=stats[2],
        samples=stats[3],
    )
    session.add(file)
    session.flush()
    linked = _linked_cell_ids(session)
    kpi_cells = session.scalars(select(KpiCell).where(KpiCell.cell_name.in_(names))).all()
    return ImportResult(
        file=file,
        sheet=report.layout.sheet,
        kpis=[k.code for k in report.layout.kpi_cols.values()],
        unknown_columns=report.layout.unknown_columns,
        new_cells=[n for n in names if n not in known],
        unlinked_cells=sorted(c.cell_name for c in kpi_cells if linked.get(c.id) is None),
    )


def list_files(session: Session) -> list[KpiFile]:
    return list(session.scalars(select(KpiFile).order_by(KpiFile.uploaded_at.desc())))


# --- linking to the inventory ----------------------------------------------------------------


def _linked_cell_ids(session: Session) -> dict[int, int | None]:
    """KPI cell id → inventory cell id: the explicit link, otherwise the cell with the same name."""
    rows = session.execute(
        select(KpiCell.id, func.coalesce(KpiCell.cell_id, Cell.id)).outerjoin(
            Cell, Cell.name == KpiCell.cell_name
        )
    )
    return dict(rows.all())


def get_kpi_cell(session: Session, kpi_cell_id: int) -> KpiCell:
    kpi_cell = session.get(KpiCell, kpi_cell_id)
    if kpi_cell is None:
        raise NotFoundError("Сота статистики не найдена")
    return kpi_cell


def link(
    session: Session, actor: Actor, kpi_cell_id: int, cell_id: int | None, rename: bool
) -> KpiCell:
    """Link a statistics cell to an inventory cell; `rename` gives the inventory cell the
    operator's name (statistics come from the live network and are the reference)."""
    kpi_cell = get_kpi_cell(session, kpi_cell_id)
    if cell_id is None:
        kpi_cell.cell_id = None
        session.flush()
        return kpi_cell
    cell = inventory.get_cell(session, cell_id)
    if rename and cell.name != kpi_cell.cell_name:
        holder = session.scalar(select(Cell).where(Cell.name == kpi_cell.cell_name))
        if holder is not None:
            raise InvalidDataError(f"Имя {kpi_cell.cell_name} уже занято другой сотой инвентаря")
        # Keep the history recorded under the old name linked to this cell.
        old = session.scalar(select(KpiCell).where(KpiCell.cell_name == cell.name))
        if old is not None and old.cell_id is None:
            old.cell_id = cell.id
        inventory.update_cell(session, actor, cell.id, CellUpdate(name=kpi_cell.cell_name))
    kpi_cell.cell_id = cell.id
    session.flush()
    return kpi_cell


@dataclass
class ReconciliationItem:
    kpi_cell: KpiCell
    candidates: list[Cell]  # inventory cells of the eNodeB with the same number, without statistics


@dataclass
class EnbNameDiff:
    enodeb: ENodeB
    kpi_enb_name: str


@dataclass
class Reconciliation:
    unlinked: list[ReconciliationItem] = field(default_factory=list)
    cells_without_kpi: list[Cell] = field(default_factory=list)
    enb_names: list[EnbNameDiff] = field(default_factory=list)


def _enb_number(name: str | None) -> str | None:
    match = ENB_NUMBER_RE.search(name or "")
    return match.group(1) if match else None


def reconciliation(session: Session) -> Reconciliation:
    links = _linked_cell_ids(session)
    kpi_cells = session.scalars(select(KpiCell).order_by(KpiCell.cell_name)).all()
    cells = session.scalars(
        select(Cell).options(joinedload(Cell.enodeb), joinedload(Cell.site)).order_by(Cell.name)
    ).all()
    linked = {cell_id for cell_id in links.values() if cell_id is not None}
    without_kpi = [c for c in cells if c.id not in linked]

    result = Reconciliation(cells_without_kpi=without_kpi)
    for kpi_cell in kpi_cells:
        if links.get(kpi_cell.id) is not None:
            continue
        number = _enb_number(kpi_cell.enb_name) or _enb_number(kpi_cell.cell_name)
        candidates = [
            c
            for c in without_kpi
            if number
            and number in {str(c.enodeb.enb_id), _enb_number(c.enodeb.name), _enb_number(c.name)}
        ]
        result.unlinked.append(ReconciliationItem(kpi_cell, candidates))

    by_id = {c.id: c for c in cells}
    seen: set[int] = set()
    for kpi_cell in kpi_cells:
        cell = by_id.get(links.get(kpi_cell.id) or 0)
        if cell is None or not kpi_cell.enb_name or cell.enodeb_id in seen:
            continue
        if cell.enodeb.name != kpi_cell.enb_name:
            seen.add(cell.enodeb_id)
            result.enb_names.append(EnbNameDiff(cell.enodeb, kpi_cell.enb_name))
    return result


# --- values ----------------------------------------------------------------------------------


def data_bounds(session: Session) -> tuple[datetime, datetime] | None:
    start, end = session.execute(select(func.min(KpiSample.time), func.max(KpiSample.time))).one()
    return (start, end + timedelta(hours=1)) if start is not None else None


def resolve_period(
    session: Session, start: datetime | None, end: datetime | None
) -> tuple[datetime, datetime] | None:
    """Default period: the last week of available data."""
    bounds = data_bounds(session)
    if bounds is None:
        return None
    end = end or bounds[1]
    start = start or max(bounds[0], end - DEFAULT_PERIOD)
    if start >= end:
        raise InvalidDataError("Начало периода должно быть раньше конца")
    return start, end


@dataclass
class KpiStat:
    value: float | None  # over the period, see Aggregate
    worst: float | None  # worst hour
    hours: int


@dataclass
class CellStats:
    kpi_cell: KpiCell
    cell_id: int | None
    values: dict[str, KpiStat]


_STATS_SQL = text("""
    WITH s AS (
        SELECT kpi_cell_id, kpi, time, value FROM kpi_sample
        WHERE time >= :start AND time < :end
    ), traffic AS (
        SELECT kpi_cell_id, time, sum(value) AS weight FROM s
        WHERE kpi IN :traffic GROUP BY kpi_cell_id, time
    )
    SELECT s.kpi_cell_id, s.kpi, avg(s.value), sum(s.value), min(s.value), max(s.value), count(*),
           sum(s.value * t.weight) / nullif(sum(t.weight), 0)
    FROM s LEFT JOIN traffic t USING (kpi_cell_id, time)
    GROUP BY s.kpi_cell_id, s.kpi
""").bindparams(bindparam("traffic", value=list(TRAFFIC_KPIS), expanding=True))


def cell_stats(session: Session, start: datetime, end: datetime) -> list[CellStats]:
    links = _linked_cell_ids(session)
    kpi_cells = {c.id: c for c in session.scalars(select(KpiCell))}
    values: dict[int, dict[str, KpiStat]] = defaultdict(dict)
    for kpi_cell_id, code, mean, total, low, high, hours, weighted in session.execute(
        _STATS_SQL, {"start": start, "end": end}
    ):
        kpi = KPI_BY_CODE.get(code)
        if kpi is None:
            continue
        if kpi.aggregate is Aggregate.SUM:
            value = total
        elif kpi.aggregate is Aggregate.TRAFFIC and weighted is not None:
            value = weighted
        else:
            value = mean
        worst = kpi.worst(low, high) if kpi.better else None
        values[kpi_cell_id][code] = KpiStat(value, worst, hours)
    return [
        CellStats(kpi_cells[kid], links.get(kid), stats)
        for kid, stats in sorted(values.items(), key=lambda kv: kpi_cells[kv[0]].cell_name)
    ]


@dataclass
class SeriesPoint:
    time: datetime
    values: dict[str, float]


def cell_series(
    session: Session, cell_id: int, start: datetime, end: datetime, kpis: list[str] | None
) -> list[SeriesPoint]:
    """Hourly values of an inventory cell, including history recorded under former names."""
    cell = inventory.get_cell(session, cell_id)
    kpi_cell_ids = select(KpiCell.id).where(
        or_(
            KpiCell.cell_id == cell.id,
            (KpiCell.cell_id.is_(None)) & (KpiCell.cell_name == cell.name),
        )
    )
    query = (
        select(KpiSample.time, KpiSample.kpi, KpiSample.value)
        .where(
            KpiSample.kpi_cell_id.in_(kpi_cell_ids),
            KpiSample.time >= start,
            KpiSample.time < end,
        )
        .order_by(KpiSample.time)
    )
    if kpis:
        unknown = [k for k in kpis if k not in KPI_BY_CODE]
        if unknown:
            raise InvalidDataError(f"Неизвестные KPI: {', '.join(unknown)}")
        query = query.where(KpiSample.kpi.in_(kpis))
    points: dict[datetime, dict[str, float]] = defaultdict(dict)
    for moment, kpi, value in session.execute(query):
        points[moment][kpi] = value
    return [SeriesPoint(moment, values) for moment, values in points.items()]
