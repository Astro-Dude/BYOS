from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import UUIDPrimaryKey


class AnalyticsEvent(UUIDPrimaryKey, Base):
    """Append-only access events (views/downloads). Rolled up in Phase 11."""

    __tablename__ = "analytics_events"

    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # file | alias | share
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)  # view | download
    referrer: Mapped[str | None] = mapped_column(String(512))
    country: Mapped[str | None] = mapped_column(String(2))
    browser: Mapped[str | None] = mapped_column(String(120))
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
