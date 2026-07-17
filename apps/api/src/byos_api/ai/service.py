"""BYOK vault: persistence for saved LLM keys and named system prompts, plus
chat-thread cleanup. API keys are Fernet-encrypted at rest and never returned."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core import crypto
from byos_api.db.models import (
    AiChatMessage,
    AiConversation,
    AiFileChunk,
    AiKey,
    AiPrompt,
    User,
)

# Chat threads are transient — expire them after this many days.
CHAT_RETENTION_DAYS = 7
# Indexes cost more to rebuild than chats, so keep them longer; expiry is by
# inactivity (last retrieval), not index age, so active files never drop.
INDEX_RETENTION_DAYS = 30


# ── Keys ─────────────────────────────────────────────────────────────────────
async def list_keys(db: AsyncSession, user: User) -> list[AiKey]:
    return list(
        (
            await db.execute(
                select(AiKey).where(AiKey.user_id == user.id).order_by(AiKey.created_at)
            )
        ).scalars()
    )


async def get_key(db: AsyncSession, user: User, key_id: uuid.UUID) -> AiKey | None:
    return (
        await db.execute(select(AiKey).where(AiKey.id == key_id, AiKey.user_id == user.id))
    ).scalar_one_or_none()


async def create_key(
    db: AsyncSession,
    user: User,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key: str,
    embedding_model: str | None,
    temperature: float,
    max_tokens: int,
    top_p: float | None,
) -> AiKey:
    key = AiKey(
        user_id=user.id,
        name=name.strip() or "Key",
        base_url=base_url.strip(),
        model=model.strip(),
        encrypted_api_key=crypto.encrypt(api_key),
        embedding_model=(embedding_model or "").strip() or None,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return key


async def update_key(
    db: AsyncSession,
    user: User,
    key_id: uuid.UUID,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key: str | None,
    embedding_model: str | None,
    temperature: float,
    max_tokens: int,
    top_p: float | None,
) -> AiKey | None:
    key = await get_key(db, user, key_id)
    if key is None:
        return None
    key.name = name.strip() or key.name
    key.base_url = base_url.strip()
    key.model = model.strip()
    if api_key:  # omit to keep the stored key
        key.encrypted_api_key = crypto.encrypt(api_key)
    key.embedding_model = (embedding_model or "").strip() or None
    key.temperature = temperature
    key.max_tokens = max_tokens
    key.top_p = top_p
    await db.commit()
    await db.refresh(key)
    return key


async def delete_key(db: AsyncSession, user: User, key_id: uuid.UUID) -> None:
    key = await get_key(db, user, key_id)
    if key is not None:
        await db.delete(key)
        await db.commit()


# ── Prompts ──────────────────────────────────────────────────────────────────
async def list_prompts(db: AsyncSession, user: User) -> list[AiPrompt]:
    return list(
        (
            await db.execute(
                select(AiPrompt).where(AiPrompt.user_id == user.id).order_by(AiPrompt.created_at)
            )
        ).scalars()
    )


async def get_prompt(db: AsyncSession, user: User, prompt_id: uuid.UUID) -> AiPrompt | None:
    return (
        await db.execute(
            select(AiPrompt).where(AiPrompt.id == prompt_id, AiPrompt.user_id == user.id)
        )
    ).scalar_one_or_none()


async def create_prompt(db: AsyncSession, user: User, *, name: str, content: str) -> AiPrompt:
    prompt = AiPrompt(user_id=user.id, name=name.strip() or "Prompt", content=content.strip())
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


async def update_prompt(
    db: AsyncSession, user: User, prompt_id: uuid.UUID, *, name: str, content: str
) -> AiPrompt | None:
    prompt = await get_prompt(db, user, prompt_id)
    if prompt is None:
        return None
    prompt.name = name.strip() or prompt.name
    prompt.content = content.strip()
    await db.commit()
    await db.refresh(prompt)
    return prompt


async def delete_prompt(db: AsyncSession, user: User, prompt_id: uuid.UUID) -> None:
    prompt = await get_prompt(db, user, prompt_id)
    if prompt is not None:
        await db.delete(prompt)
        await db.commit()


# ── Conversations (drive-wide chat threads) ──────────────────────────────────
async def list_conversations(db: AsyncSession, user: User) -> list[AiConversation]:
    return list(
        (
            await db.execute(
                select(AiConversation)
                .where(AiConversation.user_id == user.id)
                .order_by(AiConversation.updated_at.desc())
            )
        ).scalars()
    )


async def get_conversation(
    db: AsyncSession, user: User, conversation_id: uuid.UUID
) -> AiConversation | None:
    return (
        await db.execute(
            select(AiConversation).where(
                AiConversation.id == conversation_id, AiConversation.user_id == user.id
            )
        )
    ).scalar_one_or_none()


async def create_conversation(db: AsyncSession, user: User, *, title: str) -> AiConversation:
    convo = AiConversation(user_id=user.id, title=(title.strip() or "New chat")[:200])
    db.add(convo)
    await db.commit()
    await db.refresh(convo)
    return convo


async def rename_conversation(
    db: AsyncSession, user: User, conversation_id: uuid.UUID, *, title: str
) -> AiConversation | None:
    convo = await get_conversation(db, user, conversation_id)
    if convo is None:
        return None
    convo.title = (title.strip() or convo.title)[:200]
    await db.commit()
    await db.refresh(convo)
    return convo


async def delete_conversation(db: AsyncSession, user: User, conversation_id: uuid.UUID) -> None:
    convo = await get_conversation(db, user, conversation_id)
    if convo is None:
        return
    # Delete the thread's messages explicitly, then the conversation — so no
    # orphaned messages are left behind regardless of the FK's on-delete rule.
    await db.execute(
        delete(AiChatMessage).where(AiChatMessage.conversation_id == conversation_id)
    )
    await db.delete(convo)
    await db.commit()


# ── Cleanup ──────────────────────────────────────────────────────────────────
async def purge_old_chats(db: AsyncSession, *, days: int = CHAT_RETENTION_DAYS) -> int:
    """Expire drive conversations older than `days` (cascading their messages),
    and sweep up any orphaned messages. Returns rows removed."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    r1 = await db.execute(delete(AiConversation).where(AiConversation.updated_at < cutoff))
    # Sweep up any conversation-less messages left by older deletes that didn't
    # cascade (e.g. legacy single-doc rows, or SET NULL orphans).
    r2 = await db.execute(delete(AiChatMessage).where(AiChatMessage.conversation_id.is_(None)))
    await db.commit()
    return sum(int(getattr(r, "rowcount", 0) or 0) for r in (r1, r2))


async def purge_stale_index(db: AsyncSession, *, days: int = INDEX_RETENTION_DAYS) -> int:
    """Reclaim space: drop embedded chunks not retrieved in `days` (files can be
    re-indexed on demand). Returns chunks removed."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    r = await db.execute(delete(AiFileChunk).where(AiFileChunk.last_used_at < cutoff))
    await db.commit()
    return int(getattr(r, "rowcount", 0) or 0)


async def unindex(
    db: AsyncSession,
    user: User,
    *,
    all_files: bool = False,
    file_ids: list[uuid.UUID] | None = None,
) -> int:
    """Delete a user's embedded chunks — all of them, or just the given files —
    to free space on demand. Returns chunks removed."""
    stmt = delete(AiFileChunk).where(AiFileChunk.user_id == user.id)
    if not all_files:
        if not file_ids:
            return 0
        stmt = stmt.where(AiFileChunk.file_id.in_(file_ids))
    r = await db.execute(stmt)
    await db.commit()
    return int(getattr(r, "rowcount", 0) or 0)
