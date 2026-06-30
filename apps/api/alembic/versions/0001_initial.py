"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-01
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())


def _pk() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    op.create_table(
        "users",
        _pk(),
        _created_at(),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(120)),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("is_verified", sa.Boolean, server_default=sa.text("false"), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "refresh_tokens",
        _pk(),
        _created_at(),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)

    op.create_table(
        "storage_accounts",
        _pk(),
        _created_at(),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("label", sa.String(120)),
        sa.Column("encrypted_credentials", sa.Text()),
        sa.Column("config", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("status", sa.String(20), server_default=sa.text("'connected'"), nullable=False),
    )
    op.create_index("ix_storage_accounts_user_id", "storage_accounts", ["user_id"])

    op.create_table(
        "folders",
        _pk(),
        _created_at(),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", UUID, sa.ForeignKey("folders.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(255), nullable=False),
    )
    op.create_index("ix_folders_owner_parent", "folders", ["owner_id", "parent_id"])

    op.create_table(
        "files",
        _pk(),
        _created_at(),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", UUID, sa.ForeignKey("folders.id", ondelete="SET NULL")),
        sa.Column(
            "storage_account_id",
            UUID,
            sa.ForeignKey("storage_accounts.id", ondelete="SET NULL"),
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("ext", sa.String(32)),
        sa.Column("mime", sa.String(255)),
        sa.Column("size", sa.BigInteger, server_default=sa.text("0"), nullable=False),
        sa.Column("hash", sa.String(64)),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("current_version_id", UUID),  # FK added after file_versions exists
        sa.Column(
            "modified_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_files_owner_folder", "files", ["owner_id", "folder_id"])
    op.create_index("ix_files_owner_created", "files", ["owner_id", "created_at"])
    op.create_index("ix_files_mime", "files", ["mime"])

    op.create_table(
        "file_versions",
        _pk(),
        _created_at(),
        sa.Column("file_id", UUID, sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer, nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("provider_locator", JSONB, nullable=False),
        sa.Column("size", sa.BigInteger, server_default=sa.text("0"), nullable=False),
        sa.Column("hash", sa.String(64)),
        sa.UniqueConstraint("file_id", "version_no", name="uq_file_version_no"),
    )
    op.create_index("ix_file_versions_file_id", "file_versions", ["file_id"])

    # Circular FK: files.current_version_id -> file_versions.id
    op.create_foreign_key(
        "fk_files_current_version",
        "files",
        "file_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "aliases",
        _pk(),
        _created_at(),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("file_id", UUID, sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.String(255)),
    )
    op.create_index("ix_aliases_slug", "aliases", ["slug"], unique=True)

    op.create_table(
        "tags",
        _pk(),
        _created_at(),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.UniqueConstraint("owner_id", "name", name="uq_tag_owner_name"),
    )

    op.create_table(
        "file_tags",
        sa.Column(
            "file_id", UUID, sa.ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("tag_id", UUID, sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "shares",
        _pk(),
        _created_at(),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", UUID, sa.ForeignKey("files.id", ondelete="CASCADE")),
        sa.Column("alias_id", UUID, sa.ForeignKey("aliases.id", ondelete="CASCADE")),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("visibility", sa.String(20), server_default=sa.text("'public'"), nullable=False),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("max_downloads", sa.Integer),
        sa.Column("download_count", sa.Integer, server_default=sa.text("0"), nullable=False),
        sa.Column("view_only", sa.Boolean, server_default=sa.text("false"), nullable=False),
    )
    op.create_index("ix_shares_token", "shares", ["token"], unique=True)

    op.create_table(
        "analytics_events",
        _pk(),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", UUID, nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("referrer", sa.String(512)),
        sa.Column("country", sa.String(2)),
        sa.Column("browser", sa.String(120)),
        sa.Column("ip_hash", sa.String(64)),
        _created_at(),
    )
    op.create_index("ix_analytics_events_target_id", "analytics_events", ["target_id"])
    op.create_index("ix_analytics_events_created_at", "analytics_events", ["created_at"])

    # Search (Phase 5): immutable two-arg to_tsvector → generated column + GIN; trigram on name.
    op.execute(
        """
        ALTER TABLE files ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            to_tsvector(
                'english',
                coalesce(name, '') || ' ' || coalesce(ext, '') || ' ' || coalesce(mime, '')
            )
        ) STORED
        """
    )
    op.execute("CREATE INDEX ix_files_search_vector ON files USING GIN (search_vector)")
    op.execute("CREATE INDEX ix_files_name_trgm ON files USING GIN (name gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_files_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_files_search_vector")
    op.execute("ALTER TABLE files DROP COLUMN IF EXISTS search_vector")

    op.drop_table("analytics_events")
    op.drop_table("shares")
    op.drop_table("file_tags")
    op.drop_table("tags")
    op.drop_table("aliases")
    op.drop_constraint("fk_files_current_version", "files", type_="foreignkey")
    op.drop_table("file_versions")
    op.drop_table("files")
    op.drop_table("folders")
    op.drop_table("storage_accounts")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
