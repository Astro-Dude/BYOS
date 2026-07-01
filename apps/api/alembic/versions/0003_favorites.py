"""files.is_favorite for starring

Revision ID: 0003_favorites
Revises: 0002_telegram_auth
Create Date: 2026-07-01
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_favorites"
down_revision: str | None = "0002_telegram_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column("is_favorite", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index("ix_files_owner_favorite", "files", ["owner_id", "is_favorite"])


def downgrade() -> None:
    op.drop_index("ix_files_owner_favorite", table_name="files")
    op.drop_column("files", "is_favorite")
