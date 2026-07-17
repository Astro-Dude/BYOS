from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class AiKey(UUIDPrimaryKey, TimestampMixin, Base):
    """A saved Bring-Your-Own-Key LLM connection. Users can save several and pick
    which to use. Provider-agnostic (any OpenAI-compatible endpoint via base_url +
    key + model). `encrypted_api_key` holds Fernet ciphertext, never returned."""

    __tablename__ = "ai_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional embedding model (same base_url + key) for semantic retrieval.
    embedding_model: Mapped[str | None] = mapped_column(String(200))
    temperature: Mapped[float] = mapped_column(Float, server_default=text("0.2"), nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, server_default=text("1024"), nullable=False)
    top_p: Mapped[float | None] = mapped_column(Float)
