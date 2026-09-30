import gzip
import hashlib
import math
import statistics
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import PurePath
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload

from dtat.audit.service import Actor
from dtat.drivetest import netmonitor
from dtat.drivetest.definitions import (
    GAP_SECONDS,
    INTERFERENCE_RSRP,
    INTERFERENCE_SINR,
    METRICS,
    MIN_PROBLEM_SECONDS,
    PING_PONG_SECONDS,
    WEAK_COVERAGE_RSRP,
    Quality,
)
from dtat.drivetest.models import DriveSession, DriveSource, Measurement
from dtat.errors import ConflictError, InvalidDataError, NotFoundError
from dtat.inventory import service as inventory
from dtat.inventory.models import Cell, ENodeB

EARTH_RADIUS_M = 6_371_000.0
MAX_SPEED_MPS = 70.0  # faster jumps between fixes are GPS glitches, not driving
MEASUREMENT_COLUMNS = (
    "session_id", "seq", "time", "lat", "lon", "accuracy_m", "tech", "tac", "enb_id",
    "local_cell_id", "eci", "pci", "earfcn", "rsrp", "rsrq", "sinr", "neighbors",
    "best_neighbor_rsrp",
)  # fmt: skip


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _distance(samples: Sequence[netmonitor.Sample]) -> float:
    total = 0.0
    previous: netmonitor.Sample | None = None
    for s in samples:
        if s.lat is None or s.lon is None:
            continue
        if previous is not None and previous.lat is not None and previous.lon is not None:
            step = haversine_m(previous.lat, previous.lon, s.lat, s.lon)
            seconds = max((s.time - previous.time).total_seconds(), 1.0)
            if step / seconds <= MAX_SPEED_MPS:
                total += step
        previous = s
    return total


# --- import ----------------------------------------------------------------------------------


def import_log(
    session: Session,
    actor: Actor,
    data: bytes,
    filename: str,
    timezone: str,
    *,
    name: str | None = None,
    device_id: int | None = None,
) -> list[DriveSession]:
    """Store a NetMonitor log (CSV or a zip of them) as drive sessions and match their cells."""
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise InvalidDataError(f"Неизвестный часовой пояс: {timezone}", field="timezone") from exc
    if device_id is not None:
        inventory.get_device(session, device_id)

    logs = netmonitor.parse(data, filename, zone)
    created = []
    for log in logs:
        sha = hashlib.sha256(log.data).hexdigest()
        existing = session.scalar(select(DriveSession).where(DriveSession.sha256 == sha))
        if existing is not None:
            raise ConflictError(f"{log.filename} уже загружен: сессия «{existing.name}»")
        samples = sorted(log.samples, key=lambda s: (s.time, s.seq))
        drive = DriveSession(
            name=(name if name and len(logs) == 1 else PurePath(log.filename).stem)[:128],
            source=DriveSource.NETMONITOR,
            device_id=device_id,
            started_at=samples[0].time.astimezone(UTC),
            ended_at=samples[-1].time.astimezone(UTC),
            samples=len(samples),
            distance_m=round(_distance(samples), 1),
            plmn=log.plmn,
            operator=log.operator,
            rx_bytes=log.rx_bytes,
            tx_bytes=log.tx_bytes,
            timezone=timezone,
            filename=PurePath(log.filename).name[:255],
            sha256=sha,
            parser_version=netmonitor.PARSER_VERSION,
            original_gz=gzip.compress(log.data),
            uploaded_by=actor.username or "system",
        )
        session.add(drive)
        session.flush()
        _insert_samples(session, drive.id, samples)
        match_cells(session, drive.id)
        created.append(drive)
    return created


def _insert_samples(
    session: Session, session_id: int, samples: Sequence[netmonitor.Sample]
) -> None:
    raw = session.connection().connection.driver_connection
    assert isinstance(raw, psycopg.Connection)
    with (
        raw.cursor() as cur,
        cur.copy(f"COPY measurement ({', '.join(MEASUREMENT_COLUMNS)}) FROM STDIN") as copy,
    ):
        seen: set[tuple[int, datetime]] = set()
        for s in samples:
            if (s.seq, s.time) in seen:  # a repeated row in the log
                continue
            seen.add((s.seq, s.time))
            copy.write_row(
                (
                    session_id, s.seq, s.time, s.lat, s.lon, s.accuracy_m, s.tech, s.tac,
                    s.enb_id, s.local_cell_id, s.eci, s.pci, s.earfcn, s.rsrp, s.rsrq, s.sinr,
                    s.neighbors, s.best_neighbor_rsrp,
                )
            )  # fmt: skip


def match_cells(session: Session, session_id: int) -> None:
    """Serving cell of every sample: the cell version with this ECI valid at the sample's time;
    otherwise the cell with this ECI now (an eNB ID corrected after the drive)."""
    params = {"sid": session_id}
    session.execute(text("UPDATE measurement SET cell_id = NULL WHERE session_id = :sid"), params)
    session.execute(
        text(
            "UPDATE measurement m SET cell_id = v.cell_id FROM cell_version v "
            "WHERE m.session_id = :sid AND v.eci = m.eci AND v.valid_period @> m.time"
        ),
        params,
    )
    session.execute(
        text(
            "UPDATE measurement m SET cell_id = c.id FROM cell c "
            "WHERE m.session_id = :sid AND m.cell_id IS NULL AND c.eci = m.eci"
        ),
        params,
    )


# --- sessions --------------------------------------------------------------------------------


def get_session(session: Session, session_id: int) -> DriveSession:
    drive = session.get(DriveSession, session_id, options=[joinedload(DriveSession.device)])
    if drive is None:
        raise NotFoundError(f"Сессия #{session_id} не найдена")
    return drive


@dataclass
class SessionListItem:
    drive: DriveSession
    radio_samples: int
    matched_samples: int


def list_sessions(session: Session) -> list[SessionListItem]:
    counts = {
        sid: (radio, matched)
        for sid, radio, matched in session.execute(
            select(
                Measurement.session_id,
                func.count(Measurement.rsrp),
                func.count(Measurement.cell_id).filter(Measurement.rsrp.is_not(None)),
            ).group_by(Measurement.session_id)
        )
    }
    drives = session.scalars(
        select(DriveSession)
        .options(joinedload(DriveSession.device))
        .order_by(DriveSession.started_at.desc())
    ).all()
    return [SessionListItem(d, *counts.get(d.id, (0, 0))) for d in drives]


def update_session(session: Session, session_id: int, values: dict[str, Any]) -> DriveSession:
    drive = get_session(session, session_id)
    if values.get("device_id") is not None:
        inventory.get_device(session, values["device_id"])
    if "name" in values and not values["name"]:
        raise InvalidDataError("Укажите название", field="name")
    for key, value in values.items():
        setattr(drive, key, value)
    session.flush()
    return drive


def delete_session(session: Session, session_id: int) -> None:
    session.delete(get_session(session, session_id))
    session.flush()


def original_file(session: Session, session_id: int) -> tuple[str, bytes]:
    drive = get_session(session, session_id)
    return drive.filename, gzip.decompress(drive.original_gz)


# --- analysis --------------------------------------------------------------------------------


@dataclass
class Row:
    seq: int
    time: datetime
    lat: float | None
    lon: float | None
    enb_id: int | None
    local_cell_id: int | None
    eci: int | None
    pci: int | None
    rsrp: float | None
    rsrq: float | None
    sinr: float | None
    cell_id: int | None


def _rows(session: Session, session_id: int) -> list[Row]:
    query = (
        select(
            Measurement.seq,
            Measurement.time,
            Measurement.lat,
            Measurement.lon,
            Measurement.enb_id,
            Measurement.local_cell_id,
            Measurement.eci,
            Measurement.pci,
            Measurement.rsrp,
            Measurement.rsrq,
            Measurement.sinr,
            Measurement.cell_id,
        )
        .where(Measurement.session_id == session_id)
        .order_by(Measurement.time, Measurement.seq)
    )
    return [Row(**r._asdict()) for r in session.execute(query)]


@dataclass
class Distribution:
    metric: str
    counts: dict[Quality, int]
    median: float | None
    p10: float | None
    p90: float | None


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


@dataclass
class ServingCell:
    eci: int
    enb_id: int | None
    local_cell_id: int | None
    pci: int | None
    cell: Cell | None
    samples: int
    rsrp_median: float | None
    rsrq_median: float | None
    sinr_median: float | None
    max_distance_m: float | None  # farthest sample from the cell's site: overshooting
    inventory_pci: int | None  # differs from `pci`: the inventory is out of date


@dataclass
class Segment:
    kind: str  # weak_coverage | interference | gap
    start: datetime
    end: datetime
    seconds: int
    lat: float | None
    lon: float | None
    eci: int | None
    cell_name: str | None
    rsrp_median: float | None
    sinr_median: float | None


@dataclass
class RenumberHint:
    enodeb: ENodeB
    new_enb_id: int


@dataclass
class UnknownCell:
    eci: int
    enb_id: int | None
    local_cell_id: int | None
    pci: int | None
    samples: int
    hint: RenumberHint | None


@dataclass
class SessionReport:
    samples: int
    with_position: int
    with_radio: int
    matched: int
    distributions: list[Distribution]
    cells: list[ServingCell]
    cell_changes: int
    ping_pongs: int
    problems: list[Segment]
    unknown: list[UnknownCell] = field(default_factory=list)


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _segments(rows: list[Row], kind: str, condition: Any, cells: dict[int, Cell]) -> list[Segment]:
    """Runs of consecutive samples (no more than 2 s apart) meeting the condition."""
    result: list[Segment] = []
    run: list[Row] = []

    def close() -> None:
        seconds = int((run[-1].time - run[0].time).total_seconds()) + 1 if run else 0
        if run and seconds >= MIN_PROBLEM_SECONDS:
            middle = run[len(run) // 2]
            eci = Counter(r.eci for r in run).most_common(1)[0][0]
            cell_id = Counter(r.cell_id for r in run).most_common(1)[0][0]
            cell = cells.get(cell_id) if cell_id is not None else None
            result.append(
                Segment(
                    kind=kind,
                    start=run[0].time,
                    end=run[-1].time,
                    seconds=seconds,
                    lat=middle.lat,
                    lon=middle.lon,
                    eci=eci,
                    cell_name=cell.name if cell else None,
                    rsrp_median=_median([r.rsrp for r in run if r.rsrp is not None]),
                    sinr_median=_median([r.sinr for r in run if r.sinr is not None]),
                )
            )
        run.clear()

    for row in rows:
        if run and (row.time - run[-1].time).total_seconds() > 2:
            close()
        if condition(row):
            run.append(row)
        else:
            close()
    close()
    return result


def _gaps(rows: list[Row]) -> list[Segment]:
    """No radio measurement for longer than GAP_SECONDS: no service, or logging stopped."""
    result = []
    last: Row | None = None
    for row in rows:
        if row.rsrp is None:
            continue
        if last is not None and (row.time - last.time).total_seconds() > GAP_SECONDS:
            seconds = int((row.time - last.time).total_seconds()) - 1
            result.append(
                Segment(
                    "gap",
                    last.time,
                    row.time,
                    seconds,
                    last.lat,
                    last.lon,
                    last.eci,
                    None,
                    None,
                    None,
                )
            )
        last = row
    return result


def _renumber_hints(
    session: Session, unknown: dict[int, set[tuple[int, int | None]]]
) -> dict[int, RenumberHint]:
    """An unknown eNB ID whose cells (Cell ID and PCI) all exist under another eNB: probably the
    same eNodeB entered with a wrong ID."""
    hints: dict[int, RenumberHint] = {}
    if not unknown:
        return hints
    cells = session.scalars(select(Cell).options(joinedload(Cell.enodeb))).unique().all()
    by_enodeb: dict[int, set[tuple[int, int]]] = defaultdict(set)
    enodebs: dict[int, ENodeB] = {}
    for cell in cells:
        by_enodeb[cell.enodeb_id].add((cell.local_cell_id, cell.pci))
        enodebs[cell.enodeb_id] = cell.enodeb
    for enb_id, observed in unknown.items():
        pairs = {(cid, pci) for cid, pci in observed if pci is not None}
        if not pairs:
            continue
        matches = [
            eid
            for eid, known in by_enodeb.items()
            if pairs <= known and enodebs[eid].enb_id != enb_id
        ]
        if len(matches) == 1:
            hints[enb_id] = RenumberHint(enodebs[matches[0]], enb_id)
    return hints


def analyse(session: Session, session_id: int) -> SessionReport:
    get_session(session, session_id)
    rows = _rows(session, session_id)
    radio = [r for r in rows if r.rsrp is not None]
    cell_ids = {r.cell_id for r in rows if r.cell_id is not None}
    cells = {
        c.id: c
        for c in session.scalars(
            select(Cell).options(joinedload(Cell.site)).where(Cell.id.in_(cell_ids))
        )
    }

    distributions = []
    for metric in METRICS:
        values = [v for r in radio if (v := getattr(r, metric.code)) is not None]
        counts = Counter(metric.quality(v) for v in values)
        distributions.append(
            Distribution(
                metric=metric.code,
                counts={q: counts.get(q, 0) for q in Quality},
                median=_median(values),
                p10=_percentile(values, 0.1),
                p90=_percentile(values, 0.9),
            )
        )

    serving: list[ServingCell] = []
    by_eci: dict[int, list[Row]] = defaultdict(list)
    for r in radio:
        if r.eci is not None:
            by_eci[r.eci].append(r)
    for eci, group in sorted(by_eci.items(), key=lambda kv: -len(kv[1])):
        cell_id = Counter(r.cell_id for r in group).most_common(1)[0][0]
        cell = cells.get(cell_id) if cell_id is not None else None
        distances = [
            haversine_m(r.lat, r.lon, cell.site.lat, cell.site.lon)
            for r in group
            if cell is not None and r.lat is not None and r.lon is not None
        ]
        pci = Counter(r.pci for r in group).most_common(1)[0][0]
        serving.append(
            ServingCell(
                eci=eci,
                enb_id=group[0].enb_id,
                local_cell_id=group[0].local_cell_id,
                pci=pci,
                cell=cell,
                samples=len(group),
                rsrp_median=_median([r.rsrp for r in group if r.rsrp is not None]),
                rsrq_median=_median([r.rsrq for r in group if r.rsrq is not None]),
                sinr_median=_median([r.sinr for r in group if r.sinr is not None]),
                max_distance_m=round(max(distances)) if distances else None,
                inventory_pci=cell.pci if cell else None,
            )
        )

    # Serving cell changes and ping-pong (back to the previous cell within a few seconds).
    changes: list[tuple[datetime, int, int]] = []
    previous: Row | None = None
    for r in radio:
        if r.eci is None:
            continue
        if previous is not None and previous.eci is not None and r.eci != previous.eci:
            changes.append((r.time, previous.eci, r.eci))
        previous = r
    ping_pongs = sum(
        1
        for (t1, a1, b1), (t2, a2, b2) in pairwise(changes)
        if b2 == a1 and a2 == b1 and (t2 - t1).total_seconds() <= PING_PONG_SECONDS
    )

    problems = [
        *_segments(
            rows,
            "weak_coverage",
            lambda r: r.rsrp is not None and r.rsrp < WEAK_COVERAGE_RSRP,
            cells,
        ),
        *_segments(
            rows,
            "interference",
            lambda r: (
                r.rsrp is not None
                and r.rsrp >= INTERFERENCE_RSRP
                and r.sinr is not None
                and r.sinr < INTERFERENCE_SINR
            ),
            cells,
        ),
        *_gaps(rows),
    ]
    problems.sort(key=lambda s: s.start)

    unknown_groups = {eci: g for eci, g in by_eci.items() if all(r.cell_id is None for r in g)}
    observed: dict[int, set[tuple[int, int | None]]] = defaultdict(set)
    for g in unknown_groups.values():
        if g[0].enb_id is not None and g[0].local_cell_id is not None:
            observed[g[0].enb_id].add((g[0].local_cell_id, g[0].pci))
    hints = _renumber_hints(session, observed)
    unknown = [
        UnknownCell(
            eci=eci,
            enb_id=g[0].enb_id,
            local_cell_id=g[0].local_cell_id,
            pci=Counter(r.pci for r in g).most_common(1)[0][0],
            samples=len(g),
            hint=hints.get(g[0].enb_id) if g[0].enb_id is not None else None,
        )
        for eci, g in sorted(unknown_groups.items(), key=lambda kv: -len(kv[1]))
    ]

    return SessionReport(
        samples=len(rows),
        with_position=sum(1 for r in rows if r.lat is not None),
        with_radio=len(radio),
        matched=sum(1 for r in radio if r.cell_id is not None),
        distributions=distributions,
        cells=serving,
        cell_changes=len(changes),
        ping_pongs=ping_pongs,
        problems=problems,
        unknown=unknown,
    )


@dataclass
class Track:
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


def track(session: Session, session_id: int) -> Track:
    """Samples with a position, as columns (compact for thousands of points)."""
    get_session(session, session_id)
    result = Track([], [], [], [], [], [], [], [], [], [])
    for r in _rows(session, session_id):
        if r.lat is None or r.lon is None:
            continue
        result.seq.append(r.seq)
        result.time.append(r.time)
        result.lat.append(round(r.lat, 6))
        result.lon.append(round(r.lon, 6))
        result.rsrp.append(r.rsrp)
        result.rsrq.append(r.rsrq)
        result.sinr.append(r.sinr)
        result.pci.append(r.pci)
        result.eci.append(r.eci)
        result.cell_id.append(r.cell_id)
    return result
