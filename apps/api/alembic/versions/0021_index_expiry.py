"""Shrink embeddings to float4 and add last_used_at for inactivity expiry.

Revision ID: 0021_index_expiry
Revises: 0020_drop_chat_file_id
Create Date: 2026-07-17
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_index_expiry"
down_revision: str | None = "0020_drop_chat_file_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Halve vector storage: embeddings are float32 at the source and ranked in
    # float32 anyway, so double precision wastes space.
    op.execute(
        "ALTER TABLE ai_file_chunks "
        "ALTER COLUMN embedding TYPE real[] USING embedding::real[]"
    )
    op.add_column(
        "ai_file_chunks",
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("ai_file_chunks", "last_used_at")
    op.execute(
        "ALTER TABLE ai_file_chunks "
        "ALTER COLUMN embedding TYPE double precision[] USING embedding::double precision[]"
    )
