"""ai_keys.reasoning_effort: how hard a reasoning model thinks, per key.

Revision ID: 0024_ai_key_reasoning_effort
Revises: 0023_user_is_admin
Create Date: 2026-10-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_ai_key_reasoning_effort"
down_revision: str | None = "0023_user_is_admin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: existing keys get "automatic" (the lowest level).
    op.add_column("ai_keys", sa.Column("reasoning_effort", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_keys", "reasoning_effort")
