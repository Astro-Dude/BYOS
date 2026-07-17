"""Drop ai_chat_messages.file_id — single-doc chats now live in the client's
localStorage, so only drive conversations are stored server-side.

Revision ID: 0020_drop_chat_file_id
Revises: 0019_ai_conversations
Create Date: 2026-07-17
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_drop_chat_file_id"
down_revision: str | None = "0019_ai_conversations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Single-document threads are no longer persisted — discard the stored rows
    # (everything that isn't part of a drive conversation).
    op.execute("DELETE FROM ai_chat_messages WHERE conversation_id IS NULL")
    op.drop_index("ix_ai_chat_thread", table_name="ai_chat_messages")
    op.drop_column("ai_chat_messages", "file_id")  # drops its FK too


def downgrade() -> None:
    op.add_column(
        "ai_chat_messages",
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "ai_chat_messages_file_id_fkey",
        "ai_chat_messages",
        "files",
        ["file_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_ai_chat_thread", "ai_chat_messages", ["user_id", "file_id", "created_at"])
