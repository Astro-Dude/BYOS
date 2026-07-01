"""analytics_events.owner_id + rollup indexes

Revision ID: 0004_analytics_owner
Revises: 0003_favorites
Create Date: 2026-07-01
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_analytics_owner"
down_revision: str | None = "0003_favorites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # analytics_events is append-only and empty until this phase ships, so a
    # NOT NULL add needs no backfill.
    op.add_column(
        "analytics_events",
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_analytics_owner_created", "analytics_events", ["owner_id", "created_at"]
    )
    op.create_index(
        "ix_analytics_owner_event", "analytics_events", ["owner_id", "event_type"]
    )


def downgrade() -> None:
    op.drop_index("ix_analytics_owner_event", table_name="analytics_events")
    op.drop_index("ix_analytics_owner_created", table_name="analytics_events")
    op.drop_column("analytics_events", "owner_id")
