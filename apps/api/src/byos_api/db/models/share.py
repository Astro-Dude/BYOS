from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class Share(UUIDPrimaryKey, TimestampMixin, Base):
    """A shareable link to a file or alias with optional access controls."""

    __tablename__ = "shares"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE")
    )
    alias_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("aliases.id", ondelete="CASCADE")
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    visibility: Mapped[str] = mapped_column(
        String(20), server_default=text("'public'"), nullable=False
    )
    password_hash: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_downloads: Mapped[int | None] = mapped_column(Integer)
    download_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    view_only: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
