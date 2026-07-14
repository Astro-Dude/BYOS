from __future__ import annotations

import uuid

from sqlalchemy import ARRAY, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class AiFileChunk(UUIDPrimaryKey, TimestampMixin, Base):
    """A chunk of a file's text plus its embedding, for semantic long-document
    retrieval. Cached per (file, version, embedding model) — embeddings are
    dimension-agnostic (stored as a float array) so any BYOK embedding model
    works. Scoped to one file, so a plain scan + cosine in Python is plenty
    (no vector index needed)."""

    __tablename__ = "ai_file_chunks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    embed_model: Mapped[str] = mapped_column(String(200), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(ARRAY(Float), nullable=False)

    __table_args__ = (Index("ix_ai_file_chunks_lookup", "file_id", "embed_model"),)
