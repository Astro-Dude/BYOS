"""telegram-only auth: telegram_user_id, nullable email/password

Revision ID: 0002_telegram_auth
Revises: 0001_initial
Create Date: 2026-07-01
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_telegram_auth"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_user_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_users_telegram_user_id", "users", ["telegram_user_id"], unique=True)
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=True)
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=False)
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=False)
    op.drop_index("ix_users_telegram_user_id", table_name="users")
    op.drop_column("users", "telegram_user_id")
