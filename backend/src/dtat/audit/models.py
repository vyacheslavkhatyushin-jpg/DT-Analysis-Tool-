from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from dtat.audit.enums import ChangeAction, ChangeSource
from dtat.db import Base, str_enum


class ChangeLog(Base):
    """Append-only audit trail of every change to inventory objects."""

    __tablename__ = "change_log"
    __table_args__ = (Index("ix_change_log_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    username: Mapped[str | None] = mapped_column(String(64))
    source: Mapped[ChangeSource] = mapped_column(str_enum(ChangeSource, "change_source"))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column()
    # Human-readable label (site code, cell name...) kept so deleted objects stay identifiable.
    entity_label: Mapped[str | None] = mapped_column(String(128))
    action: Mapped[ChangeAction] = mapped_column(str_enum(ChangeAction, "change_action"))
    # {field: [old, new]}
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    comment: Mapped[str | None] = mapped_column(Text)
