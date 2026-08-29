"""users.is_admin — a managed admin list instead of hardcoded config.

Revision ID: 0023_user_is_admin
Revises: 0022_ai_action_plans
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_user_is_admin"
down_revision: str | None = "0022_ai_action_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    # Partial index: the admin list is tiny next to the user table, so only the
    # true rows are worth indexing.
    op.create_index(
        "ix_users_is_admin", "users", ["is_admin"], postgresql_where=sa.text("is_admin")
    )


def downgrade() -> None:
    op.drop_index("ix_users_is_admin", table_name="users")
    op.drop_column("users", "is_admin")
