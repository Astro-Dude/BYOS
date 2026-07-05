from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class Alias(UUIDPrimaryKey, TimestampMixin, Base):
    """Flagship feature: a permanent slug → logical target. The target is
    EITHER a file (replacing it flips File.current_version_id, so the URL never
    changes) OR a folder (a browsable, shareable public listing)."""

    __tablename__ = "aliases"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Slug is unique per owner (namespaced under the owner's username in the URL).
    slug: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    # Exactly one of file_id / folder_id is set (enforced by ck_aliases_one_target).
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE"), nullable=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("folders.id", ondelete="CASCADE"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        Index("uq_aliases_owner_slug", "owner_id", "slug", unique=True),
        # One link per file / per folder per owner (partial: NULLs don't collide).
        Index(
            "uq_aliases_owner_file",
            "owner_id",
            "file_id",
            unique=True,
            postgresql_where=text("file_id IS NOT NULL"),
        ),
        Index(
            "uq_aliases_owner_folder",
            "owner_id",
            "folder_id",
            unique=True,
            postgresql_where=text("folder_id IS NOT NULL"),
        ),
        CheckConstraint(
            "num_nonnulls(file_id, folder_id) = 1", name="ck_aliases_one_target"
        ),
    )
