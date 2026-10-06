"""shares: drop password protection, view-only and download limits, all retired.

A share that had a password or a download limit is deleted rather than kept:
with the check gone it would open for anyone holding the token, as often as
they like, which isn't what its owner set up. `visibility` only ever said
whether there was a password, so it goes too. Expiry stays.

Revision ID: 0025_share_drop_password
Revises: 0024_ai_key_reasoning_effort
Create Date: 2026-10-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_share_drop_password"
down_revision: str | None = "0024_ai_key_reasoning_effort"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM shares WHERE password_hash IS NOT NULL OR max_downloads IS NOT NULL")
    op.drop_column("shares", "password_hash")
    op.drop_column("shares", "max_downloads")
    op.drop_column("shares", "view_only")
    op.drop_column("shares", "visibility")


def downgrade() -> None:
    op.add_column(
        "shares",
        sa.Column("visibility", sa.String(20), server_default=sa.text("'public'"), nullable=False),
    )
    op.add_column(
        "shares",
        sa.Column("view_only", sa.Boolean, server_default=sa.text("false"), nullable=False),
    )
    op.add_column("shares", sa.Column("max_downloads", sa.Integer))
    op.add_column("shares", sa.Column("password_hash", sa.String(255)))
