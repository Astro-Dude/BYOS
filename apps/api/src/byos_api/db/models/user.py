from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, String, text
from sqlalchemy.orm import Mapped, mapped_column

from byos_api.core.db import Base
from byos_api.db.models.mixins import TimestampMixin, UUIDPrimaryKey


class User(UUIDPrimaryKey, TimestampMixin, Base):
    """Identity anchor. Provider-agnostic: `telegram_user_id` links a Telegram
    login today; email/password are nullable and unused under Telegram-only auth,
    kept so other login methods can attach in the future."""

    __tablename__ = "users"

    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(30), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
