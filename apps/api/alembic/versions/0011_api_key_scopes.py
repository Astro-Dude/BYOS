"""api key scopes + expiry

Revision ID: 0011_api_key_scopes
Revises: 0010_folder_aliases
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_api_key_scopes"
down_revision: str | None = "0010_folder_aliases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL scopes = legacy key → full access (back-compat). New keys get an
    # explicit list, so existing keys keep working unchanged.
    op.add_column("api_keys", sa.Column("scopes", sa.dialects.postgresql.JSONB(), nullable=True))
    op.add_column(
        "api_keys", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("api_keys", "expires_at")
    op.drop_column("api_keys", "scopes")
