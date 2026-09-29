from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from dtat.audit.enums import ChangeAction, ChangeSource
from dtat.audit.models import ChangeLog

__all__ = ["Actor", "ChangeAction", "ChangeSource", "diff", "record_change"]


@dataclass(frozen=True)
class Actor:
    """Who makes a change and through which channel."""

    user_id: int | None
    username: str | None
    source: ChangeSource


SYSTEM_ACTOR = Actor(user_id=None, username=None, source=ChangeSource.SYSTEM)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[Any]]:
    """Fields whose values differ, as {field: [old, new]} with JSON-friendly values."""
    keys = before.keys() | after.keys()
    return {
        key: [_jsonable(before.get(key)), _jsonable(after.get(key))]
        for key in sorted(keys)
        if before.get(key) != after.get(key)
    }


def record_change(
    session: Session,
    actor: Actor,
    *,
    entity_type: str,
    entity_id: int,
    entity_label: str | None,
    action: ChangeAction,
    changes: dict[str, list[Any]],
    comment: str | None = None,
) -> None:
    session.add(
        ChangeLog(
            user_id=actor.user_id,
            username=actor.username,
            source=actor.source,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            action=action,
            changes=changes,
            comment=comment,
        )
    )
