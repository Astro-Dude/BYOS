"""drop analytics_events (event tracking removed)

Revision ID: 0012_drop_analytics_events
Revises: 0011_api_key_scopes
Create Date: 2026-07-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_drop_analytics_events"
down_revision: str | None = "0011_api_key_scopes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = sa.dialects.postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.drop_table("analytics_events")


def downgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "owner_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", UUID, nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("referrer", sa.String(512)),
        sa.Column("country", sa.String(2)),
        sa.Column("browser", sa.String(120)),
        sa.Column("ip_hash", sa.String(64)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_analytics_events_target_id", "analytics_events", ["target_id"])
    op.create_index("ix_analytics_events_created_at", "analytics_events", ["created_at"])
    op.create_index("ix_analytics_owner_created", "analytics_events", ["owner_id", "created_at"])
    op.create_index("ix_analytics_owner_event", "analytics_events", ["owner_id", "event_type"])
