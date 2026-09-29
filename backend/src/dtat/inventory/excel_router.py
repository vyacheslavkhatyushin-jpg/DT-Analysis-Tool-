from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response

from dtat.audit.service import Actor, ChangeSource
from dtat.auth.deps import CurrentUser, DbSession, EditorUser
from dtat.db import utcnow
from dtat.inventory.excel import ImportReport, build_workbook, import_workbook

router = APIRouter(prefix="/inventory", tags=["inventory-excel"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _xlsx(content: bytes, filename: str) -> Response:
    return Response(
        content,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template.xlsx", response_class=Response)
def template(_: CurrentUser) -> Response:
    return _xlsx(build_workbook(None), "inventory-template.xlsx")


@router.get("/export.xlsx", response_class=Response)
def export(_: CurrentUser, session: DbSession) -> Response:
    return _xlsx(build_workbook(session), f"inventory-{utcnow():%Y%m%d-%H%M}.xlsx")


@router.post("/import")
def import_file(
    user: EditorUser,
    session: DbSession,
    file: Annotated[UploadFile, File()],
    dry_run: Annotated[bool, Form()] = True,
    effective_at: Annotated[datetime | None, Form()] = None,
) -> ImportReport:
    """Check (dry_run=true) or apply an inventory workbook. Nothing is applied if any row fails."""
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Файл больше 20 МБ")
    actor = Actor(user_id=user.id, username=user.username, source=ChangeSource.IMPORT)
    sheets = import_workbook(session, actor, data, effective_at)
    total_errors = sum(len(s.errors) for s in sheets)
    applied = not dry_run and total_errors == 0
    if applied:
        session.commit()
    else:
        session.rollback()
    return ImportReport(dry_run=dry_run, applied=applied, sheets=sheets, total_errors=total_errors)
