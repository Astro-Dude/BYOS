"""files.missing_at — files whose bytes were deleted directly in Telegram

Revision ID: 0014_file_missing_at
Revises: 0013_user_phone
Create Date: 2026-07-12
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_file_missing_at"
down_revision: str | None = "0013_user_phone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "files", sa.Column("missing_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("files", "missing_at")
