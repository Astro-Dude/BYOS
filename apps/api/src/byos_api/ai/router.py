"""Bring Your Own Model (BYOM) endpoints: manage the user's LLM config and run
summarize / chat over a single document using their own key.

Chat is stateful (one thread per document, persisted) and streamed token-by-
token. Multi-document "chat with your drive" + selectable RAG strategies (query
rewriting, HyDE, rerank/LLM-as-judge, CRAG) are a later phase built on the
embeddings/vector layer — this ships single-document AI first.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import llm, service
from byos_api.ai.extract import extract_text, is_extractable
from byos_api.ai.schemas import (
    AiConfigIn,
    AiConfigOut,
    ChatMessageOut,
    ChatSendRequest,
    SummarizeRequest,
)
from byos_api.auth.dependencies import CurrentUser, SessionUser
from byos_api.core import crypto
from byos_api.core.db import SessionLocal, get_db
from byos_api.db.models import AiChatMessage, AiConfig, FileVersion, User
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider

router = APIRouter(prefix="/ai", tags=["ai"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Don't pull huge files into memory just to read their text.
_MAX_AI_BYTES = 25 * 1024 * 1024

_DEFAULT_SYSTEM = (
    "You are a helpful assistant answering questions about the user's document. "
    "Base answers on the document; if it doesn't contain the answer, say so."
)

_STREAM_MEDIA = "text/plain; charset=utf-8"
# Tell proxies (Render/nginx) not to buffer, so tokens reach the client live.
_STREAM_HEADERS = {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}

# Some models emit their reasoning inline in <think>/<thought> tags — strip it
# so it's neither shown nor fed back into the conversation as context.
_THOUGHT_RE = re.compile(r"<(think|thought)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)


def _strip_thoughts(text: str) -> str:
    return _THOUGHT_RE.sub("", text).strip()


def _as_out(cfg: AiConfig | None) -> AiConfigOut:
    if cfg is None:
        return AiConfigOut(configured=False)
    return AiConfigOut(
        configured=True,
        base_url=cfg.base_url,
        model=cfg.model,
        system_prompt=cfg.system_prompt,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        top_p=cfg.top_p,
    )


# ── Config ───────────────────────────────────────────────────────────────────
@router.get("/config", response_model=AiConfigOut)
async def get_config(user: CurrentUser, db: DbDep) -> AiConfigOut:
    return _as_out(await service.get_config(db, user))


@router.put("/config", response_model=AiConfigOut)
async def put_config(payload: AiConfigIn, user: SessionUser, db: DbDep) -> AiConfigOut:
    # Validate the endpoint/key/model with a tiny live call before saving. On an
    # edit without a new key, re-check using the stored one.
    key = payload.api_key
    if not key:
        existing = await service.get_config(db, user)
        if existing is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "An API key is required.")
        key = crypto.decrypt(existing.encrypted_api_key)
    try:
        await llm.validate(payload.base_url, key, payload.model)
    except llm.LLMError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    cfg = await service.set_config(
        db,
        user,
        base_url=payload.base_url,
        model=payload.model,
        api_key=payload.api_key,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        top_p=payload.top_p,
    )
    return _as_out(cfg)


@router.delete("/config", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(user: SessionUser, db: DbDep) -> None:
    await service.delete_config(db, user)


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _require_config(db: AsyncSession, user: User) -> AiConfig:
    cfg = await service.get_config(db, user)
    if cfg is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Add your own key first (Profile → AI model).",
        )
    return cfg


async def _load_text(db: AsyncSession, user: User, file_id: uuid.UUID) -> tuple[str, str]:
    """Return (filename, extracted_text) for an owned, text-readable file."""
    try:
        record = await files_service.get_owned_file(db, user, file_id)
    except files_service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    if not is_extractable(record.mime, record.ext):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This file type can't be read as text yet."
        )
    if record.current_version_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File has no content")
    version = await db.get(FileVersion, record.current_version_id)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File version not found")
    if version.size and version.size > _MAX_AI_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is too large for AI (max 25 MB)."
        )
    account = await files_service.account_for_file(db, user, record)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Storage provider is not connected")
    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    buffer = bytearray()
    try:
        async for chunk in get_provider(record.provider).download(account, ref):
            buffer.extend(chunk)
    except FileNotFoundError:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "File content no longer exists in the provider"
        ) from None
    text = extract_text(bytes(buffer), record.mime, record.ext)
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Couldn't read any text from this file (it may be a scanned/image PDF).",
        )
    return record.name, text


def _stream_params(cfg: AiConfig) -> dict:
    """Snapshot the config into plain values usable after the request session
    closes (the StreamingResponse body outlives the DB dependency)."""
    return {
        "base_url": cfg.base_url,
        "api_key": crypto.decrypt(cfg.encrypted_api_key),
        "model": cfg.model,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "top_p": cfg.top_p,
    }


# ── Summarize (one-shot, streamed) ───────────────────────────────────────────
@router.post("/summarize")
async def summarize(payload: SummarizeRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    cfg = await _require_config(db, user)
    name, text = await _load_text(db, user, payload.file_id)
    params = _stream_params(cfg)
    messages: list[llm.Message] = [
        {"role": "system", "content": cfg.system_prompt or _DEFAULT_SYSTEM},
        {
            "role": "user",
            "content": f"Summarize this document ('{name}') concisely, "
            f"highlighting the key points:\n\n{text}",
        },
    ]

    async def body() -> AsyncIterator[str]:
        async for delta in llm.stream_chat(messages=messages, **params):
            yield delta

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


# ── Chat (stateful, streamed) ────────────────────────────────────────────────
@router.get("/chat/{file_id}", response_model=list[ChatMessageOut])
async def chat_history(file_id: uuid.UUID, user: CurrentUser, db: DbDep) -> list[ChatMessageOut]:
    rows = (
        await db.execute(
            select(AiChatMessage)
            .where(AiChatMessage.user_id == user.id, AiChatMessage.file_id == file_id)
            .order_by(AiChatMessage.created_at)
        )
    ).scalars()
    return [ChatMessageOut.model_validate(r) for r in rows]


@router.delete("/chat/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat(file_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    rows = (
        await db.execute(
            select(AiChatMessage).where(
                AiChatMessage.user_id == user.id, AiChatMessage.file_id == file_id
            )
        )
    ).scalars()
    for row in rows:
        await db.delete(row)
    await db.commit()


@router.post("/chat")
async def chat(payload: ChatSendRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    cfg = await _require_config(db, user)
    name, text = await _load_text(db, user, payload.file_id)
    params = _stream_params(cfg)

    prior = list(
        (
            await db.execute(
                select(AiChatMessage)
                .where(
                    AiChatMessage.user_id == user.id,
                    AiChatMessage.file_id == payload.file_id,
                )
                .order_by(AiChatMessage.created_at)
            )
        ).scalars()
    )
    system = (cfg.system_prompt or _DEFAULT_SYSTEM) + (
        f"\n\nUse this document ('{name}') to answer:\n\n{text}"
    )
    messages: list[llm.Message] = [{"role": "system", "content": system}]
    messages.extend({"role": m.role, "content": m.content} for m in prior)
    messages.append({"role": "user", "content": payload.message})

    user_id = user.id
    file_id = payload.file_id
    question = payload.message

    async def body() -> AsyncIterator[str]:
        collected: list[str] = []
        async for delta in llm.stream_chat(messages=messages, **params):
            collected.append(delta)
            yield delta
        answer = _strip_thoughts("".join(collected))
        if answer:
            # Persist the turn once complete, in a fresh session (the request's
            # session is already torn down by the time the stream finishes).
            async with SessionLocal() as store:
                store.add(
                    AiChatMessage(user_id=user_id, file_id=file_id, role="user", content=question)
                )
                store.add(
                    AiChatMessage(
                        user_id=user_id, file_id=file_id, role="assistant", content=answer
                    )
                )
                await store.commit()

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)
