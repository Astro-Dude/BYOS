"""BYOK conversations: ai_conversations + ai_chat_messages.conversation_id

Revision ID: 0019_ai_conversations
Revises: 0018_ai_vault
Create Date: 2026-07-17
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019_ai_conversations"
down_revision: str | None = "0018_ai_vault"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_conversations_user", "ai_conversations", ["user_id"])

    op.add_column(
        "ai_chat_messages",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_ai_chat_conversation",
        "ai_chat_messages",
        "ai_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_ai_conv_thread", "ai_chat_messages", ["conversation_id", "created_at"])
    # The old single drive thread (file_id IS NULL) is superseded by conversations.
    op.execute("DELETE FROM ai_chat_messages WHERE file_id IS NULL")


def downgrade() -> None:
    op.drop_index("ix_ai_conv_thread", table_name="ai_chat_messages")
    op.drop_constraint("fk_ai_chat_conversation", "ai_chat_messages", type_="foreignkey")
    op.drop_column("ai_chat_messages", "conversation_id")
    op.drop_index("ix_ai_conversations_user", table_name="ai_conversations")
    op.drop_table("ai_conversations")
