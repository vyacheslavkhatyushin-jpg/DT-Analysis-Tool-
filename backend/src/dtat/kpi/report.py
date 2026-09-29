"""Read an operator's hourly per-cell KPI report (Excel).

The sheet and header row are found by their columns, not by position: a date, an hour, a cell name
and optionally an eNodeB name, plus any KPI columns from the catalogue. Unknown columns are
reported and skipped. Excel errors such as "#DIV/0" (no events in that hour) mean "no value".
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

from dtat.errors import InvalidDataError
from dtat.kpi.definitions import KPI_BY_HEADER, KpiDef, normalize_header

DATE_HEADERS = {"date", "дата"}
HOUR_HEADERS = {"hour", "час"}
CELL_HEADERS = {"eutrancellid", "eutrancell", "eutrancellfdd", "cell", "cellname", "сота"}
ENB_HEADERS = {"erbsname", "erbs", "enodeb", "enodebname", "enbname", "sitename"}
HEADER_SEARCH_ROWS = 10


@dataclass
class ReportRow:
    local_time: datetime  # naive, in the report's time zone
    cell_name: str
    enb_name: str | None
    values: dict[str, float]


@dataclass
class ReportLayout:
    sheet: str
    header_row: int
    date_col: int
    hour_col: int | None
    cell_col: int
    enb_col: int | None
    kpi_cols: dict[int, KpiDef]
    unknown_columns: list[str] = field(default_factory=list)


def _find_layout(ws: Any) -> ReportLayout | None:
    for row_idx, row in enumerate(
        ws.iter_rows(max_row=HEADER_SEARCH_ROWS, values_only=True), start=1
    ):
        names = [normalize_header(v) for v in row]

        def first(options: set[str], names: list[str] = names) -> int | None:
            return next((i for i, n in enumerate(names) if n in options), None)

        date_col, cell_col = first(DATE_HEADERS), first(CELL_HEADERS)
        if date_col is None or cell_col is None:
            continue
        hour_col, enb_col = first(HOUR_HEADERS), first(ENB_HEADERS)
        kpi_cols = {i: KPI_BY_HEADER[n] for i, n in enumerate(names) if n in KPI_BY_HEADER}
        if not kpi_cols:
            continue
        used = {date_col, cell_col, hour_col, enb_col, *kpi_cols}
        unknown = [str(v).strip() for i, v in enumerate(row) if v is not None and i not in used]
        return ReportLayout(
            ws.title, row_idx, date_col, hour_col, cell_col, enb_col, kpi_cols, unknown
        )
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "."))
        except ValueError:
            return None  # "#DIV/0", "-", "" ...
    return None


def _day(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time())
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)  # noqa: DTZ007 - local time, zone applied later
        except ValueError:
            continue
    raise ValueError(f"не распознана дата «{text}»")


def _hour(value: Any) -> int:
    if isinstance(value, time):
        return value.hour
    number = _number(str(value).split(":")[0]) if value is not None else None
    if number is None or not 0 <= number <= 23 or number != int(number):
        raise ValueError(f"час «{value}» не от 0 до 23")
    return int(number)


class HourlyReport:
    def __init__(self, data: bytes) -> None:
        try:
            self._wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:  # openpyxl raises a variety of errors for broken files
            raise InvalidDataError("Не удалось прочитать файл: ожидается .xlsx") from exc
        layouts = [layout for ws in self._wb.worksheets if (layout := _find_layout(ws))]
        if not layouts:
            self._wb.close()
            raise InvalidDataError(
                "Не найден лист с почасовыми KPI по сотам: нужны столбцы даты, часа, имени соты "
                "(EUtranCell Id) и хотя бы одного известного показателя"
            )
        self.layout = layouts[0]

    def rows(self) -> Iterator[ReportRow]:
        layout = self.layout
        ws = self._wb[layout.sheet]
        for row_num, row in enumerate(
            ws.iter_rows(min_row=layout.header_row + 1, values_only=True),
            start=layout.header_row + 1,
        ):
            cell_raw = row[layout.cell_col] if layout.cell_col < len(row) else None
            if cell_raw is None or str(cell_raw).strip() == "":
                continue
            try:
                moment = _day(row[layout.date_col])
                if layout.hour_col is not None:
                    moment = moment.replace(hour=0, minute=0) + timedelta(
                        hours=_hour(row[layout.hour_col])
                    )
            except ValueError as exc:
                raise InvalidDataError(f"Лист «{layout.sheet}», строка {row_num}: {exc}") from exc
            values = {
                kpi.code: number
                for idx, kpi in layout.kpi_cols.items()
                if idx < len(row) and (number := _number(row[idx])) is not None
            }
            enb = row[layout.enb_col] if layout.enb_col is not None else None
            yield ReportRow(
                moment, str(cell_raw).strip(), str(enb).strip() if enb else None, values
            )

    def close(self) -> None:
        self._wb.close()
