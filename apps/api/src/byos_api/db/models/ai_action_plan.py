from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class AiActionPlan(UUIDPrimaryKey, TimestampMixin, Base):
    """A batch of drive changes an agent turn proposed, awaiting the user's OK.

    The model never mutates anything directly: its write tool calls are recorded
    here and only run when the user applies the plan. Storing the plan (rather
    than round-tripping it through the client) means apply/discard can't be handed
    a set of actions the model never proposed, and a reloaded conversation can
    still show what was suggested and whether it went through.

    `actions` is the ordered list of {op, args, label, danger, auto} objects and
    `result` is the parallel list of per-action outcomes. A `null` hole in
    `result` means that action is still awaiting confirmation — a turn run in a
    permissive mode can leave some actions already done and others queued, and
    applying such a plan only fills the holes.
    """

    __tablename__ = "ai_action_plans"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    # pending → applied | discarded. Terminal states are never re-entered, so a
    # plan can't be applied twice.
    status: Mapped[str] = mapped_column(
        String(20), server_default=text("'pending'"), nullable=False
    )
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    result: Mapped[list[dict[str, Any] | None] | None] = mapped_column(JSONB)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_ai_action_plans_convo", "conversation_id", "created_at"),)
