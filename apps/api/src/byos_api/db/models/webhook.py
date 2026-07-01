from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class Webhook(UUIDPrimaryKey, TimestampMixin, Base):
    """An outbound HTTP subscription. On matching events BYOS POSTs a JSON body
    signed with ``secret`` (HMAC-SHA256, ``X-BYOS-Signature`` header)."""

    __tablename__ = "webhooks"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    secret: Mapped[str] = mapped_column(String(64), nullable=False)
    # Subscribed event types (e.g. ["file.created", "file.replaced"]) or ["*"].
    events: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), nullable=False)
