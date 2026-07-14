"""ai_configs — Bring Your Own Model (BYOM): per-user OpenAI-compatible LLM config

Revision ID: 0015_ai_config
Revises: 0014_file_missing_at
Create Date: 2026-07-15
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_ai_config"
down_revision: str | None = "0014_file_missing_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_configs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), server_default=sa.text("0.2"), nullable=False),
        sa.Column("max_tokens", sa.Integer(), server_default=sa.text("1024"), nullable=False),
        sa.Column("top_p", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_ai_configs_user", "ai_configs", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_ai_configs_user", table_name="ai_configs")
    op.drop_table("ai_configs")
