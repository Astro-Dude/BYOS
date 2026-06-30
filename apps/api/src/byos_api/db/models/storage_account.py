from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class StorageAccount(UUIDPrimaryKey, TimestampMixin, Base):
    """A user's connection to a storage provider (e.g. a Telegram account).

    `encrypted_credentials` holds Fernet ciphertext (e.g. a Telegram
    StringSession); it is never stored or logged in plaintext.
    """

    __tablename__ = "storage_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str | None] = mapped_column(String(120))
    encrypted_credentials: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), server_default=text("'connected'"), nullable=False
    )
