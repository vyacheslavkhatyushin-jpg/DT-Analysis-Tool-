"""NetMonitor (Android) session logs: CSV with ';', one row per second, or a zip of such files.

Columns used (the app writes more): sys_time (local time, YYYYMMDDHHMMSS), tech, mcc, mnc,
net_op_name, lac_tac, node_id (eNB ID), cid (Cell ID), psc_pci, arfcn, rssi (RSRP for LTE), rsrq,
rssnr (SINR in 0.1 dB, as Android reports it), gps, accuracy, lat, long, lte_neighbors,
rssi_strongest, data_rx / data_tx (byte counters).

Missing values are written as "null", "" or 2147483647 (Integer.MAX_VALUE); RSRP 0 means the phone
had no measurement that second.
"""

import csv
import io
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, tzinfo

from dtat.errors import InvalidDataError

PARSER_VERSION = "netmonitor-1"
MAX_UNPACKED_BYTES = 500 * 1024 * 1024  # a zip must not unpack into more than this
REQUIRED = ("sys_time", "tech", "node_id", "cid", "psc_pci", "rssi", "rsrq", "lat", "long")
MISSING = {"", "null", "2147483647", "-2147483648"}


@dataclass
class Sample:
    seq: int
    time: datetime
    lat: float | None
    lon: float | None
    accuracy_m: float | None
    tech: str | None
    tac: int | None
    enb_id: int | None
    local_cell_id: int | None
    pci: int | None
    earfcn: int | None
    rsrp: float | None
    rsrq: float | None
    sinr: float | None
    neighbors: int | None
    best_neighbor_rsrp: float | None

    @property
    def eci(self) -> int | None:
        if self.enb_id is None or self.local_cell_id is None or not 0 <= self.local_cell_id <= 255:
            return None
        return self.enb_id * 256 + self.local_cell_id


@dataclass
class ParsedLog:
    filename: str
    data: bytes  # the log file itself, kept with the session
    samples: list[Sample]
    plmn: str | None = None
    operator: str | None = None
    rx_bytes: int | None = None
    tx_bytes: int | None = None
    skipped_rows: int = 0
    warnings: list[str] = field(default_factory=list)


def _text(value: str | None) -> str | None:
    value = (value or "").strip()
    return None if value in MISSING else value


def _int(value: str | None) -> int | None:
    text = _text(value)
    try:
        return int(float(text)) if text is not None else None
    except ValueError:
        return None


def _float(value: str | None) -> float | None:
    text = _text(value)
    try:
        return float(text.replace(",", ".")) if text is not None else None
    except ValueError:
        return None


def _in_range[T: (int, float)](value: T | None, low: float, high: float) -> T | None:
    return value if value is not None and low <= value <= high else None


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise InvalidDataError("Не удалось прочитать текст файла: ожидается UTF-8 или Windows-1251")


def is_netmonitor(header: list[str]) -> bool:
    return all(name in header for name in REQUIRED)


def parse_csv(data: bytes, filename: str, zone: tzinfo) -> ParsedLog:
    reader = csv.DictReader(io.StringIO(_decode(data)), delimiter=";")
    header = [h.strip() for h in reader.fieldnames or []]
    if not is_netmonitor(header):
        missing = [name for name in REQUIRED if name not in header]
        raise InvalidDataError(
            f"{filename}: это не лог сессии NetMonitor, нет столбцов {', '.join(missing)}"
        )
    log = ParsedLog(filename, data, [])
    plmns: Counter[str] = Counter()
    operators: Counter[str] = Counter()
    counters: list[tuple[int, int]] = []
    for index, row in enumerate(reader):
        try:
            text = (row.get("sys_time") or "").strip()
            moment = datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=zone)
        except ValueError:
            log.skipped_rows += 1
            continue
        tech = _text(row.get("tech"))
        lte = tech == "LTE"
        lat, lon = _float(row.get("lat")), _float(row.get("long"))
        has_fix = _text(row.get("gps")) != "0" and lat and lon and -90 <= lat <= 90
        rsrp = _in_range(_float(row.get("rssi")), -140, -44) if lte else None
        # With no RSRP the phone had no measurement: its RSRQ and SINR are not real either.
        rsrq = _in_range(_float(row.get("rsrq")), -34, 3) if rsrp is not None else None
        rssnr = _float(row.get("rssnr"))
        sinr = _in_range(rssnr / 10, -23, 40) if rssnr is not None and rsrp is not None else None
        best = _in_range(_float(row.get("rssi_strongest")), -140, -44) if lte else None
        log.samples.append(
            Sample(
                seq=report if (report := _int(row.get("report"))) is not None else index,
                time=moment,
                lat=lat if has_fix else None,
                lon=lon if has_fix else None,
                accuracy_m=_float(row.get("accuracy")) if has_fix else None,
                tech=tech,
                tac=_int(row.get("lac_tac")) if lte else None,
                enb_id=_int(row.get("node_id")) if lte else None,
                local_cell_id=_int(row.get("cid")) if lte else None,
                pci=_in_range(_int(row.get("psc_pci")), 0, 503) if lte else None,
                earfcn=_int(row.get("arfcn")) if lte else None,
                rsrp=rsrp,
                rsrq=rsrq,
                sinr=sinr,
                neighbors=_int(row.get("lte_neighbors")),
                best_neighbor_rsrp=best,
            )
        )
        mcc, mnc = _text(row.get("mcc")), _text(row.get("mnc"))
        if mcc and mnc:
            plmns[f"{mcc}-{mnc}"] += 1
        if name := _text(row.get("net_op_name")):
            operators[name] += 1
        rx, tx = _int(row.get("data_rx")), _int(row.get("data_tx"))
        if rx is not None and tx is not None:
            counters.append((rx, tx))
    if not log.samples:
        raise InvalidDataError(f"{filename}: в логе нет строк с измерениями")
    log.plmn = plmns.most_common(1)[0][0] if plmns else None
    log.operator = operators.most_common(1)[0][0] if operators else None
    if counters:
        # Counters restart with the phone; negative differences mean a restart, not traffic.
        log.rx_bytes = max(0, counters[-1][0] - counters[0][0])
        log.tx_bytes = max(0, counters[-1][1] - counters[0][1])
    return log


def parse(data: bytes, filename: str, zone: tzinfo) -> list[ParsedLog]:
    """A CSV log, or a zip with one or more of them (as NetMonitor exports sessions)."""
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = [i for i in archive.infolist() if i.filename.lower().endswith(".csv")]
            if not members:
                raise InvalidDataError(f"{filename}: в архиве нет файлов .csv")
            if sum(i.file_size for i in members) > MAX_UNPACKED_BYTES:
                raise InvalidDataError(f"{filename}: архив распаковывается больше чем в 500 МБ")
            return [parse_csv(archive.read(i), i.filename, zone) for i in members]
    return [parse_csv(data, filename, zone)]
