"""folders.color

Revision ID: 0007_folder_color
Revises: 0006_audit_logs
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_folder_color"
down_revision: str | None = "0006_audit_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("folders", sa.Column("color", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("folders", "color")
