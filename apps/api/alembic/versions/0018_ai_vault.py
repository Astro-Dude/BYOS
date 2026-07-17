"""BYOK vault: ai_keys + ai_prompts (multiple per user); migrate + drop ai_configs;
nullable ai_chat_messages.file_id (drive-wide thread)

Revision ID: 0018_ai_vault
Revises: 0017_ai_semantic
Create Date: 2026-07-16
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_ai_vault"
down_revision: str | None = "0017_ai_semantic"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_keys",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.String(length=200), nullable=True),
        sa.Column("temperature", sa.Float(), server_default=sa.text("0.2"), nullable=False),
        sa.Column("max_tokens", sa.Integer(), server_default=sa.text("1024"), nullable=False),
        sa.Column("top_p", sa.Float(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_keys_user", "ai_keys", ["user_id"])

    op.create_table(
        "ai_prompts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_prompts_user", "ai_prompts", ["user_id"])

    # Migrate existing single configs into a named "Default" key (+ prompt).
    op.execute(
        """
        INSERT INTO ai_keys (id, user_id, name, base_url, model, encrypted_api_key,
                             embedding_model, temperature, max_tokens, top_p, created_at)
        SELECT gen_random_uuid(), user_id, 'Default', base_url, model, encrypted_api_key,
               embedding_model, temperature, max_tokens, top_p, now()
        FROM ai_configs
        """
    )
    op.execute(
        """
        INSERT INTO ai_prompts (id, user_id, name, content, created_at)
        SELECT gen_random_uuid(), user_id, 'Default', system_prompt, now()
        FROM ai_configs
        WHERE system_prompt IS NOT NULL AND btrim(system_prompt) <> ''
        """
    )

    op.drop_table("ai_configs")

    # Null file_id marks the drive-wide chat thread.
    op.alter_column("ai_chat_messages", "file_id", existing_type=postgresql.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column("ai_chat_messages", "file_id", existing_type=postgresql.UUID(), nullable=False)
    op.create_table(
        "ai_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.String(length=200), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), server_default=sa.text("0.2"), nullable=False),
        sa.Column("max_tokens", sa.Integer(), server_default=sa.text("1024"), nullable=False),
        sa.Column("top_p", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_ai_configs_user", "ai_configs", ["user_id"], unique=True)
    op.drop_index("ix_ai_prompts_user", table_name="ai_prompts")
    op.drop_table("ai_prompts")
    op.drop_index("ix_ai_keys_user", table_name="ai_keys")
    op.drop_table("ai_keys")
