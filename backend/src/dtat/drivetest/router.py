from dataclasses import asdict
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status

from dtat.audit.service import Actor, ChangeSource
from dtat.auth.deps import CurrentUser, DbSession, EditorUser
from dtat.drivetest import service
from dtat.drivetest.definitions import METRICS
from dtat.drivetest.models import DriveSession
from dtat.drivetest.schemas import (
    DistributionRead,
    DriveImportRead,
    DriveReportRead,
    DriveSessionListItem,
    DriveSessionRead,
    DriveSessionUpdate,
    MetricRead,
    RenumberHintRead,
    SegmentRead,
    ServingCellRead,
    TrackRead,
    UnknownCellRead,
)

router = APIRouter(tags=["drive-tests"])

MAX_UPLOAD_BYTES = 100 * 1024 * 1024


def _read(drive: DriveSession) -> DriveSessionRead:
    return DriveSessionRead(
        id=drive.id,
        name=drive.name,
        source=drive.source,
        device_id=drive.device_id,
        device_name=drive.device.name if drive.device else None,
        started_at=drive.started_at,
        ended_at=drive.ended_at,
        samples=drive.samples,
        distance_m=drive.distance_m,
        plmn=drive.plmn,
        operator=drive.operator,
        rx_bytes=drive.rx_bytes,
        tx_bytes=drive.tx_bytes,
        timezone=drive.timezone,
        notes=drive.notes,
        filename=drive.filename,
        uploaded_by=drive.uploaded_by,
        uploaded_at=drive.uploaded_at,
    )


@router.get("/drive/metrics")
def metrics(_: CurrentUser) -> list[MetricRead]:
    return [MetricRead(code=m.code, title=m.title, unit=m.unit, bounds=m.bounds) for m in METRICS]


@router.post("/drive-sessions/import")
def import_log(
    user: EditorUser,
    session: DbSession,
    file: Annotated[UploadFile, File()],
    timezone: Annotated[str, Form(description="Часовой пояс времени в логе")] = "Asia/Almaty",
    name: Annotated[str | None, Form()] = None,
    device_id: Annotated[int | None, Form()] = None,
) -> DriveImportRead:
    """Load a NetMonitor session log (.csv, or .zip with one or more logs)."""
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Файл больше 100 МБ")
    actor = Actor(user_id=user.id, username=user.username, source=ChangeSource.IMPORT)
    drives = service.import_log(
        session,
        actor,
        data,
        file.filename or "netmonitor.csv",
        timezone,
        name=(name or "").strip() or None,
        device_id=device_id,
    )
    session.commit()
    return DriveImportRead(sessions=[_read(service.get_session(session, d.id)) for d in drives])


@router.get("/drive-sessions")
def list_sessions(_: CurrentUser, session: DbSession) -> list[DriveSessionListItem]:
    return [
        DriveSessionListItem(
            **_read(item.drive).model_dump(),
            radio_samples=item.radio_samples,
            matched_samples=item.matched_samples,
        )
        for item in service.list_sessions(session)
    ]


@router.get("/drive-sessions/{session_id}")
def get_session(session_id: int, _: CurrentUser, session: DbSession) -> DriveSessionRead:
    return _read(service.get_session(session, session_id))


@router.patch("/drive-sessions/{session_id}")
def update_session(
    session_id: int, body: DriveSessionUpdate, _: EditorUser, session: DbSession
) -> DriveSessionRead:
    drive = service.update_session(session, session_id, body.model_dump(exclude_unset=True))
    session.commit()
    return _read(service.get_session(session, drive.id))


@router.delete("/drive-sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, _: EditorUser, session: DbSession) -> None:
    service.delete_session(session, session_id)
    session.commit()


def _report(session: DbSession, session_id: int) -> DriveReportRead:
    report = service.analyse(session, session_id)
    return DriveReportRead(
        samples=report.samples,
        with_position=report.with_position,
        with_radio=report.with_radio,
        matched=report.matched,
        distributions=[DistributionRead(**asdict(d)) for d in report.distributions],
        cells=[
            ServingCellRead(
                eci=c.eci,
                enb_id=c.enb_id,
                local_cell_id=c.local_cell_id,
                pci=c.pci,
                cell_id=c.cell.id if c.cell else None,
                cell_name=c.cell.name if c.cell else None,
                site_id=c.cell.site_id if c.cell else None,
                site_code=c.cell.site.code if c.cell else None,
                samples=c.samples,
                rsrp_median=c.rsrp_median,
                rsrq_median=c.rsrq_median,
                sinr_median=c.sinr_median,
                max_distance_m=c.max_distance_m,
                inventory_pci=c.inventory_pci,
            )
            for c in report.cells
        ],
        cell_changes=report.cell_changes,
        ping_pongs=report.ping_pongs,
        problems=[SegmentRead(**asdict(s)) for s in report.problems],
        unknown=[
            UnknownCellRead(
                eci=u.eci,
                enb_id=u.enb_id,
                local_cell_id=u.local_cell_id,
                pci=u.pci,
                samples=u.samples,
                hint=RenumberHintRead(
                    enodeb_id=u.hint.enodeb.id,
                    enb_id=u.hint.enodeb.enb_id,
                    name=u.hint.enodeb.name,
                    new_enb_id=u.hint.new_enb_id,
                )
                if u.hint
                else None,
            )
            for u in report.unknown
        ],
    )


@router.get("/drive-sessions/{session_id}/report")
def report(session_id: int, _: CurrentUser, session: DbSession) -> DriveReportRead:
    """Quality distributions, serving cells, problem segments and unknown cells of a session."""
    return _report(session, session_id)


@router.post("/drive-sessions/{session_id}/rematch")
def rematch(session_id: int, _: EditorUser, session: DbSession) -> DriveReportRead:
    """Match the samples to inventory cells again, e.g. after fixing an eNB ID."""
    service.get_session(session, session_id)
    service.match_cells(session, session_id)
    session.commit()
    return _report(session, session_id)


@router.get("/drive-sessions/{session_id}/track")
def track(session_id: int, _: CurrentUser, session: DbSession) -> TrackRead:
    return TrackRead(**asdict(service.track(session, session_id)))


@router.get("/drive-sessions/{session_id}/original", response_class=Response)
def original(session_id: int, _: CurrentUser, session: DbSession) -> Response:
    filename, content = service.original_file(session, session_id)
    return Response(
        content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
