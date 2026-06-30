from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class Folder(UUIDPrimaryKey, TimestampMixin, Base):
    """Adjacency-list folder tree: `parent_id` is NULL at the root."""

    __tablename__ = "folders"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("folders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    __table_args__ = (Index("ix_folders_owner_parent", "owner_id", "parent_id"),)
