from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey

if TYPE_CHECKING:
    from byos_api.db.models.tag import Tag


class File(UUIDPrimaryKey, TimestampMixin, Base):
    """Logical file. The bytes live in a provider; `current_version_id` points
    at the version served right now (flipped atomically on replace/restore).

    NOTE: a Postgres GENERATED `search_vector tsvector` column and its GIN /
    pg_trgm indexes are added in the migration (used from Phase 5); it is not
    mapped here to keep the Phase 0 ORM surface minimal.
    """

    __tablename__ = "files"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("folders.id", ondelete="SET NULL")
    )
    storage_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("storage_accounts.id", ondelete="SET NULL")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ext: Mapped[str | None] = mapped_column(String(32))
    mime: Mapped[str | None] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(BigInteger, server_default=text("0"), nullable=False)
    hash: Mapped[str | None] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(50), nullable=False)

    # FK added via ALTER in the migration (circular dependency with file_versions).
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    is_favorite: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )

    modified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    tags: Mapped[list[Tag]] = relationship(secondary="file_tags", lazy="selectin")

    __table_args__ = (
        Index("ix_files_owner_folder", "owner_id", "folder_id"),
        Index("ix_files_owner_created", "owner_id", "created_at"),
        Index("ix_files_mime", "mime"),
    )


class FileVersion(UUIDPrimaryKey, TimestampMixin, Base):
    """An immutable stored object. `provider_locator` is the DURABLE reference
    persisted per provider (for Telegram: {chat_id, message_id, ...} — never a
    raw file_id, which expires)."""

    __tablename__ = "file_versions"

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    provider_locator: Mapped[dict] = mapped_column(JSONB, nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, server_default=text("0"), nullable=False)
    hash: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("file_id", "version_no", name="uq_file_version_no"),)
