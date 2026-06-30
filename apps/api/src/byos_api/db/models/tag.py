from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class Tag(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "tags"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_tag_owner_name"),)


file_tags = Table(
    "file_tags",
    Base.metadata,
    Column(
        "file_id", UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
    ),
    Column(
        "tag_id", UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    ),
)
