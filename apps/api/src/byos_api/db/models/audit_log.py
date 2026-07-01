from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import UUIDPrimaryKey


class AuditLog(UUIDPrimaryKey, Base):
    """Append-only record of security-relevant actions, surfaced to the user as
    their activity history."""

    __tablename__ = "audit_logs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)  # e.g. "file.delete"
    target_type: Mapped[str | None] = mapped_column(String(20))
    target_id: Mapped[str | None] = mapped_column(String(120))
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
