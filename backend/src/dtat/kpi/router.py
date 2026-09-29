from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status

from dtat.audit.service import Actor, ChangeSource
from dtat.auth.deps import CurrentUser, DbSession, EditorUser, ui_actor
from dtat.inventory.models import Cell
from dtat.kpi import service
from dtat.kpi.definitions import KPI_BY_CODE, KPIS
from dtat.kpi.schemas import (
    EnbNameDiffRead,
    InventoryCellRef,
    KpiCellRead,
    KpiCellStatsRead,
    KpiDefRead,
    KpiFileRead,
    KpiImportRead,
    KpiLink,
    KpiPointRead,
    KpiSeriesRead,
    KpiStatRead,
    KpiSummaryRead,
    ReconciliationRead,
    UnlinkedKpiCellRead,
)

router = APIRouter(tags=["kpi"])

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
Start = Annotated[datetime | None, Query(description="Начало периода; по умолчанию неделя")]
End = Annotated[datetime | None, Query(description="Конец периода; по умолчанию конец данных")]


@router.get("/kpi/catalogue")
def catalogue(_: CurrentUser) -> list[KpiDefRead]:
    return [
        KpiDefRead(
            code=k.code,
            title=k.title,
            unit=k.unit,
            aggregate=k.aggregate,
            better=k.better,
            warn=k.warn,
            bad=k.bad,
        )
        for k in KPIS
    ]


@router.post("/kpi/import")
def import_report(
    user: EditorUser,
    session: DbSession,
    file: Annotated[UploadFile, File()],
    timezone: Annotated[str, Form(description="Часовой пояс времени в отчёте")] = "Asia/Almaty",
) -> KpiImportRead:
    """Load an hourly per-cell KPI report; repeated hours replace the stored values."""
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Файл больше 100 МБ")
    actor = Actor(user_id=user.id, username=user.username, source=ChangeSource.IMPORT)
    result = service.import_report(session, actor, data, file.filename or "kpi.xlsx", timezone)
    session.commit()
    return KpiImportRead(
        file=KpiFileRead.model_validate(result.file),
        sheet=result.sheet,
        kpis=result.kpis,
        unknown_columns=result.unknown_columns,
        new_cells=result.new_cells,
        unlinked_cells=result.unlinked_cells,
    )


@router.get("/kpi/files")
def list_files(_: CurrentUser, session: DbSession) -> list[KpiFileRead]:
    return [KpiFileRead.model_validate(f) for f in service.list_files(session)]


@router.get("/kpi/summary")
def summary(
    _: CurrentUser, session: DbSession, start: Start = None, end: End = None
) -> KpiSummaryRead:
    """Every cell's KPI over the period: the value (see the catalogue) and the worst hour."""
    bounds = service.data_bounds(session)
    period = service.resolve_period(session, start, end)
    if bounds is None or period is None:
        return KpiSummaryRead(start=None, end=None, data_start=None, data_end=None, cells=[])
    cells = []
    for stats in service.cell_stats(session, *period):
        values = {}
        for code, stat in stats.values.items():
            kpi = KPI_BY_CODE[code]
            values[code] = KpiStatRead(
                value=stat.value,
                level=kpi.level(stat.value),
                worst=stat.worst,
                worst_level=kpi.level(stat.worst),
                hours=stat.hours,
            )
        cells.append(
            KpiCellStatsRead(
                kpi_cell_id=stats.kpi_cell.id,
                cell_name=stats.kpi_cell.cell_name,
                enb_name=stats.kpi_cell.enb_name,
                cell_id=stats.cell_id,
                values=values,
            )
        )
    return KpiSummaryRead(
        start=period[0], end=period[1], data_start=bounds[0], data_end=bounds[1], cells=cells
    )


@router.get("/cells/{cell_id}/kpi")
def cell_series(
    cell_id: int,
    _: CurrentUser,
    session: DbSession,
    start: Start = None,
    end: End = None,
    kpi: Annotated[list[str] | None, Query(description="Коды KPI; по умолчанию все")] = None,
) -> KpiSeriesRead:
    """Hourly KPI values of an inventory cell."""
    period = service.resolve_period(session, start, end)
    if period is None:
        return KpiSeriesRead(cell_id=cell_id, start=None, end=None, points=[])
    points = service.cell_series(session, cell_id, *period, kpi)
    return KpiSeriesRead(
        cell_id=cell_id,
        start=period[0],
        end=period[1],
        points=[KpiPointRead(time=p.time, values=p.values) for p in points],
    )


def _cell_ref(cell: Cell) -> InventoryCellRef:
    return InventoryCellRef(
        id=cell.id,
        name=cell.name,
        enb_id=cell.enodeb.enb_id,
        enodeb_name=cell.enodeb.name,
        site_code=cell.site.code,
    )


@router.get("/kpi/reconciliation")
def reconciliation(_: CurrentUser, session: DbSession) -> ReconciliationRead:
    """Differences between the operator's statistics and the inventory."""
    result = service.reconciliation(session)
    return ReconciliationRead(
        unlinked=[
            UnlinkedKpiCellRead(
                kpi_cell_id=item.kpi_cell.id,
                cell_name=item.kpi_cell.cell_name,
                enb_name=item.kpi_cell.enb_name,
                candidates=[_cell_ref(c) for c in item.candidates],
            )
            for item in result.unlinked
        ],
        cells_without_kpi=[_cell_ref(c) for c in result.cells_without_kpi],
        enb_names=[
            EnbNameDiffRead(
                enodeb_id=d.enodeb.id,
                enb_id=d.enodeb.enb_id,
                name=d.enodeb.name,
                kpi_name=d.kpi_enb_name,
            )
            for d in result.enb_names
        ],
    )


@router.put("/kpi/operator-cells/{kpi_cell_id}/link")
def link(kpi_cell_id: int, body: KpiLink, user: EditorUser, session: DbSession) -> KpiCellRead:
    """Link a statistics cell to an inventory cell (optionally renaming the inventory cell)."""
    kpi_cell = service.link(session, ui_actor(user), kpi_cell_id, body.cell_id, body.rename)
    session.commit()
    return KpiCellRead.model_validate(kpi_cell)
