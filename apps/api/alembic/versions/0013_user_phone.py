"""users.phone (for phone+password login) + backfill from telegram storage config

Revision ID: 0013_user_phone
Revises: 0012_drop_analytics_events
Create Date: 2026-07-12
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_user_phone"
down_revision: str | None = "0012_drop_analytics_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(32), nullable=True))
    # Backfill from the Telegram storage account's stored phone so existing users
    # can log in by phone immediately. One phone per user (owner_id is unique on
    # the telegram account in practice); pick the most recent if several.
    op.execute(
        """
        UPDATE users u
        SET phone = sa.config->>'phone'
        FROM storage_accounts sa
        WHERE sa.user_id = u.id
          AND sa.provider = 'telegram'
          AND sa.config ? 'phone'
          AND (sa.config->>'phone') IS NOT NULL
          AND u.phone IS NULL
        """
    )
    op.create_index("uq_users_phone", "users", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_users_phone", table_name="users")
    op.drop_column("users", "phone")
