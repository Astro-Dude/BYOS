"""users.username + per-owner alias slug namespace

Revision ID: 0008_username_alias_ns
Revises: 0007_folder_color
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_username_alias_ns"
down_revision: str | None = "0007_folder_color"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(30), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # Alias slugs are now unique per owner (URL is /{username}/{slug}), not global.
    op.drop_index("ix_aliases_slug", table_name="aliases")
    op.create_index("ix_aliases_slug", "aliases", ["slug"])  # non-unique lookup index
    op.create_index("uq_aliases_owner_slug", "aliases", ["owner_id", "slug"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_aliases_owner_slug", table_name="aliases")
    op.drop_index("ix_aliases_slug", table_name="aliases")
    op.create_index("ix_aliases_slug", "aliases", ["slug"], unique=True)
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
