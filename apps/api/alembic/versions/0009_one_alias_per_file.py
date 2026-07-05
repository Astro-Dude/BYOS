"""one alias per file (unique owner_id, file_id)

Revision ID: 0009_one_alias_per_file
Revises: 0008_username_alias_ns
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0009_one_alias_per_file"
down_revision: str | None = "0008_username_alias_ns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Collapse any pre-existing multiple aliases for the same file (keep earliest).
    op.execute(
        """
        DELETE FROM aliases a USING aliases b
        WHERE a.owner_id = b.owner_id AND a.file_id = b.file_id
          AND (a.created_at > b.created_at
               OR (a.created_at = b.created_at AND a.id > b.id))
        """
    )
    op.create_index("uq_aliases_owner_file", "aliases", ["owner_id", "file_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_aliases_owner_file", table_name="aliases")
