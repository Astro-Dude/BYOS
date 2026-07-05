"""folder aliases: an alias may target a file OR a folder

Revision ID: 0010_folder_aliases
Revises: 0009_one_alias_per_file
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_folder_aliases"
down_revision: str | None = "0009_one_alias_per_file"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # file_id becomes nullable; a new folder_id target is added.
    op.alter_column("aliases", "file_id", existing_type=sa.dialects.postgresql.UUID(), nullable=True)
    op.add_column(
        "aliases",
        sa.Column("folder_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_aliases_folder_id_folders",
        "aliases",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Rebuild the one-per-file unique index as partial (NULL file_id no longer collides).
    op.drop_index("uq_aliases_owner_file", table_name="aliases")
    op.create_index(
        "uq_aliases_owner_file",
        "aliases",
        ["owner_id", "file_id"],
        unique=True,
        postgresql_where=sa.text("file_id IS NOT NULL"),
    )
    op.create_index(
        "uq_aliases_owner_folder",
        "aliases",
        ["owner_id", "folder_id"],
        unique=True,
        postgresql_where=sa.text("folder_id IS NOT NULL"),
    )
    op.create_check_constraint(
        "ck_aliases_one_target", "aliases", "num_nonnulls(file_id, folder_id) = 1"
    )


def downgrade() -> None:
    op.drop_constraint("ck_aliases_one_target", "aliases", type_="check")
    op.drop_index("uq_aliases_owner_folder", table_name="aliases")
    op.drop_index("uq_aliases_owner_file", table_name="aliases")
    # Drop any folder-target aliases before restoring the NOT NULL file_id constraint.
    op.execute("DELETE FROM aliases WHERE file_id IS NULL")
    op.drop_constraint("fk_aliases_folder_id_folders", "aliases", type_="foreignkey")
    op.drop_column("aliases", "folder_id")
    op.alter_column(
        "aliases", "file_id", existing_type=sa.dialects.postgresql.UUID(), nullable=False
    )
    op.create_index("uq_aliases_owner_file", "aliases", ["owner_id", "file_id"], unique=True)
