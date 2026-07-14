"""BYOM config persistence: store the user's OpenAI-compatible LLM settings.
The API key is Fernet-encrypted at rest and never returned in plaintext."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core import crypto
from byos_api.db.models import AiChatMessage, AiConfig, User

# Chat threads are transient — expire them after this many days.
CHAT_RETENTION_DAYS = 7


async def get_config(db: AsyncSession, user: User) -> AiConfig | None:
    return (
        await db.execute(select(AiConfig).where(AiConfig.user_id == user.id))
    ).scalar_one_or_none()


async def set_config(
    db: AsyncSession,
    user: User,
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    embedding_model: str | None,
    system_prompt: str | None,
    temperature: float,
    max_tokens: int,
    top_p: float | None,
) -> AiConfig:
    """Create or update the user's BYOM config. `api_key` may be None on an
    update (keep the existing key while editing other settings); it's required
    when there's no config yet."""
    cfg = await get_config(db, user)
    if cfg is None:
        if not api_key:
            raise ValueError("An API key is required to set up a model.")
        cfg = AiConfig(user_id=user.id, encrypted_api_key=crypto.encrypt(api_key))
        db.add(cfg)
    elif api_key:
        cfg.encrypted_api_key = crypto.encrypt(api_key)
    cfg.base_url = base_url.strip()
    cfg.model = model.strip()
    cfg.embedding_model = (embedding_model or "").strip() or None
    cfg.system_prompt = (system_prompt or "").strip() or None
    cfg.temperature = temperature
    cfg.max_tokens = max_tokens
    cfg.top_p = top_p
    await db.commit()
    await db.refresh(cfg)
    return cfg


async def delete_config(db: AsyncSession, user: User) -> None:
    cfg = await get_config(db, user)
    if cfg is not None:
        await db.delete(cfg)
        await db.commit()


async def purge_old_chats(db: AsyncSession, *, days: int = CHAT_RETENTION_DAYS) -> int:
    """Delete AI chat messages older than `days` (thread expiry). Returns the
    number removed."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(delete(AiChatMessage).where(AiChatMessage.created_at < cutoff))
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)
