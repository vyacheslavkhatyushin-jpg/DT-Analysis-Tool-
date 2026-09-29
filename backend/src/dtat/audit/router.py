from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import select

from dtat.audit.enums import ChangeAction, ChangeSource
from dtat.audit.models import ChangeLog
from dtat.auth.deps import CurrentUser, DbSession
from dtat.schemas import ORMModel

router = APIRouter(tags=["audit"])


class ChangeRead(ORMModel):
    id: int
    ts: datetime
    username: str | None
    source: ChangeSource
    entity_type: str
    entity_id: int
    entity_label: str | None
    action: ChangeAction
    changes: dict[str, Any]
    comment: str | None


@router.get("/changes")
def list_changes(
    _: CurrentUser,
    session: DbSession,
    entity_type: str | None = None,
    entity_id: int | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ChangeRead]:
    query = select(ChangeLog).order_by(ChangeLog.id.desc()).limit(limit).offset(offset)
    if entity_type is not None:
        query = query.where(ChangeLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.where(ChangeLog.entity_id == entity_id)
    return [ChangeRead.model_validate(c) for c in session.scalars(query)]
