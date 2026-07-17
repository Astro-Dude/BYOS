from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class AiChatMessage(UUIDPrimaryKey, TimestampMixin, Base):
    """One message in a drive-wide `conversation_id` thread (the ChatGPT-style
    threads on the BYOK page). Cascades away with its conversation.

    Single-document (preview-panel) chats are NOT stored here — the client keeps
    those in localStorage — so this table only holds drive conversations."""

    __tablename__ = "ai_chat_messages"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_conversations.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (Index("ix_ai_conv_thread", "conversation_id", "created_at"),)
