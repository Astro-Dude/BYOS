"""BYOK (Bring Your Own Key) endpoints.

- Vault: manage multiple saved LLM keys + named system prompts.
- Single-document: summarize / stateful chat over one file (long-doc retrieval).
- Drive-wide: index files and RAG-chat across the whole drive with selectable
  strategies (query rewriting, HyDE, rerank/LLM-as-judge, CRAG).

Chats are streamed token-by-token; the drive thread is `file_id = NULL`.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import extract, llm, rag, retrieval, semantic, service
from byos_api.ai.schemas import (
    AiKeyIn,
    AiKeyOut,
    AiPromptIn,
    AiPromptOut,
    ChatMessageOut,
    ChatSendRequest,
    ConversationCreate,
    ConversationOut,
    ConversationRename,
    DriveChatRequest,
    IndexRequest,
    IndexStatusOut,
    SummarizeRequest,
    UnindexRequest,
)
from byos_api.auth.dependencies import CurrentUser, SessionUser
from byos_api.core import crypto
from byos_api.core.db import SessionLocal, get_db
from byos_api.db.models import AiChatMessage, AiFileChunk, AiKey, File, FileVersion, User
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider

router = APIRouter(prefix="/ai", tags=["ai"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_MAX_AI_BYTES = 25 * 1024 * 1024
_RETRIEVAL_LIMIT = 2_000_000  # long-doc / indexing reads far more than the context cap

_DEFAULT_SYSTEM = (
    "You are a helpful assistant answering questions about the user's document(s). "
    "Base answers on the provided content; if it doesn't contain the answer, say so."
)

_STREAM_MEDIA = "text/plain; charset=utf-8"
_STREAM_HEADERS = {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}


def _evt(obj: dict) -> str:
    """Frame a drive-chat control event: an ASCII record-separator, a compact
    JSON object, then a newline. These stream before the answer text (RAG steps,
    then sources); the client parses leading events and treats the rest as the
    answer. `\\x1e` never appears in model output, so it's a safe delimiter."""
    return f"\x1e{json.dumps(obj)}\n"

_THOUGHT_RE = re.compile(r"<(think|thought)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)


def _strip_thoughts(text: str) -> str:
    return _THOUGHT_RE.sub("", text).strip()


def _answer_only(text: str) -> str:
    """Drop any trailing control events (e.g. the persisted sources) from a
    stored assistant message, so past turns fed back to the model are clean."""
    return text.split("\x1e", 1)[0].rstrip()


# ── Vault: keys ──────────────────────────────────────────────────────────────
@router.get("/keys", response_model=list[AiKeyOut])
async def list_keys(user: CurrentUser, db: DbDep) -> list[AiKeyOut]:
    return [AiKeyOut.model_validate(k) for k in await service.list_keys(db, user)]


async def _validate_key(payload: AiKeyIn, existing: AiKey | None) -> None:
    api_key = payload.api_key or (crypto.decrypt(existing.encrypted_api_key) if existing else None)
    if not api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An API key is required.")
    try:
        await llm.validate(payload.base_url, api_key, payload.model)
    except llm.LLMError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/keys", response_model=AiKeyOut)
async def create_key(payload: AiKeyIn, user: SessionUser, db: DbDep) -> AiKeyOut:
    await _validate_key(payload, None)
    key = await service.create_key(
        db, user,
        name=payload.name, base_url=payload.base_url, model=payload.model,
        api_key=payload.api_key or "", embedding_model=payload.embedding_model,
        temperature=payload.temperature, max_tokens=payload.max_tokens, top_p=payload.top_p,
    )
    return AiKeyOut.model_validate(key)


@router.put("/keys/{key_id}", response_model=AiKeyOut)
async def update_key(
    key_id: uuid.UUID, payload: AiKeyIn, user: SessionUser, db: DbDep
) -> AiKeyOut:
    existing = await service.get_key(db, user, key_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found")
    await _validate_key(payload, existing)
    key = await service.update_key(
        db, user, key_id,
        name=payload.name, base_url=payload.base_url, model=payload.model,
        api_key=payload.api_key, embedding_model=payload.embedding_model,
        temperature=payload.temperature, max_tokens=payload.max_tokens, top_p=payload.top_p,
    )
    assert key is not None
    return AiKeyOut.model_validate(key)


@router.delete("/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(key_id: uuid.UUID, user: SessionUser, db: DbDep) -> None:
    await service.delete_key(db, user, key_id)


# ── Vault: prompts ───────────────────────────────────────────────────────────
@router.get("/prompts", response_model=list[AiPromptOut])
async def list_prompts(user: CurrentUser, db: DbDep) -> list[AiPromptOut]:
    return [AiPromptOut.model_validate(p) for p in await service.list_prompts(db, user)]


@router.post("/prompts", response_model=AiPromptOut)
async def create_prompt(payload: AiPromptIn, user: SessionUser, db: DbDep) -> AiPromptOut:
    p = await service.create_prompt(db, user, name=payload.name, content=payload.content)
    return AiPromptOut.model_validate(p)


@router.put("/prompts/{prompt_id}", response_model=AiPromptOut)
async def update_prompt(
    prompt_id: uuid.UUID, payload: AiPromptIn, user: SessionUser, db: DbDep
) -> AiPromptOut:
    p = await service.update_prompt(db, user, prompt_id, name=payload.name, content=payload.content)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt not found")
    return AiPromptOut.model_validate(p)


@router.delete("/prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(prompt_id: uuid.UUID, user: SessionUser, db: DbDep) -> None:
    await service.delete_prompt(db, user, prompt_id)


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _require_key(db: AsyncSession, user: User, key_id: uuid.UUID) -> AiKey:
    key = await service.get_key(db, user, key_id)
    if key is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a key first (set one up in BYOK).")
    return key


async def _system_prompt(db: AsyncSession, user: User, prompt_id: uuid.UUID | None) -> str:
    if prompt_id is None:
        return _DEFAULT_SYSTEM
    prompt = await service.get_prompt(db, user, prompt_id)
    return prompt.content if prompt else _DEFAULT_SYSTEM


def _stream_params(key: AiKey) -> dict:
    """Snapshot the key into plain values usable after the request session closes
    (the StreamingResponse body outlives the DB dependency)."""
    return {
        "base_url": key.base_url,
        "api_key": crypto.decrypt(key.encrypted_api_key),
        "model": key.model,
        "temperature": key.temperature,
        "max_tokens": key.max_tokens,
        "top_p": key.top_p,
    }


async def _extract_owned(
    db: AsyncSession, user: User, record: File, *, limit: int
) -> tuple[uuid.UUID, str] | None:
    """Best-effort (version_id, text) for a File record — None if not usable."""
    if not extract.is_extractable(record.mime, record.ext) or record.current_version_id is None:
        return None
    version = await db.get(FileVersion, record.current_version_id)
    if version is None or (version.size and version.size > _MAX_AI_BYTES):
        return None
    account = await files_service.account_for_file(db, user, record)
    if account is None:
        return None
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
        return None
    text = extract.extract_text(bytes(buffer), record.mime, record.ext, limit=limit)
    return (version.id, text) if text else None


async def _load_text(
    db: AsyncSession, user: User, file_id: uuid.UUID, *, limit: int = extract.MAX_CHARS
) -> tuple[str, str, uuid.UUID]:
    """Strict variant for single-file endpoints: raises clear HTTP errors."""
    try:
        record = await files_service.get_owned_file(db, user, file_id)
    except files_service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    if not extract.is_extractable(record.mime, record.ext):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This file type can't be read as text yet."
        )
    got = await _extract_owned(db, user, record, limit=limit)
    if got is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Couldn't read this file (missing content, too large, or a scanned/image PDF).",
        )
    version_id, text = got
    return record.name, text, version_id


# ── Single document: summarize + chat ────────────────────────────────────────
@router.post("/summarize")
async def summarize(payload: SummarizeRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    key = await _require_key(db, user, payload.key_id)
    name, text, _ = await _load_text(db, user, payload.file_id)
    system = await _system_prompt(db, user, payload.prompt_id)
    params = _stream_params(key)
    messages: list[llm.Message] = [
        {"role": "system", "content": system},
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


@router.post("/chat")
async def chat(payload: ChatSendRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    """Single-document chat. Stateless server-side — the client stores the thread
    in localStorage and replays prior turns via `history` for context."""
    key = await _require_key(db, user, payload.key_id)
    limit = _RETRIEVAL_LIMIT if payload.retrieval else extract.MAX_CHARS
    name, text, version_id = await _load_text(db, user, payload.file_id, limit=limit)
    if payload.retrieval:
        picked: list[str] = []
        if key.embedding_model:
            try:
                await semantic.ensure_embedded(db, user, payload.file_id, version_id, text, key)
                picked = await semantic.semantic_chunks(db, payload.file_id, key, payload.message)
            except llm.LLMError:
                await db.rollback()
                picked = []
        if not picked:
            picked = retrieval.top_chunks(retrieval.chunk_text(text), payload.message, k=6)
        text = "\n\n---\n\n".join(picked)

    base_system = await _system_prompt(db, user, payload.prompt_id)
    system = f"{base_system}\n\nUse this document ('{name}') to answer:\n\n{text}"
    messages: list[llm.Message] = [{"role": "system", "content": system}]
    # Client-supplied history (bounded), then the new question.
    messages.extend({"role": t.role, "content": t.content} for t in payload.history[-20:])
    messages.append({"role": "user", "content": payload.message})

    params = _stream_params(key)

    async def body() -> AsyncIterator[str]:
        async for delta in llm.stream_chat(messages=messages, **params):
            yield delta

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


# ── Drive-wide: indexing ─────────────────────────────────────────────────────
async def _index_targets(db: AsyncSession, user: User, payload: IndexRequest) -> list[File]:
    stmt = select(File).where(File.owner_id == user.id, File.current_version_id.is_not(None))
    if not payload.all:
        conds = []
        if payload.file_ids:
            conds.append(File.id.in_(payload.file_ids))
        if payload.folder_ids:
            conds.append(File.folder_id.in_(payload.folder_ids))
        if not conds:
            return []
        stmt = stmt.where(or_(*conds))
    files = (await db.execute(stmt)).scalars().all()
    return [f for f in files if extract.is_extractable(f.mime, f.ext)]


@router.post("/index")
async def index_drive(payload: IndexRequest, user: SessionUser, db: DbDep) -> StreamingResponse:
    key = await _require_key(db, user, payload.key_id)
    if not key.embedding_model:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This key has no embedding model set (needed to index)."
        )
    targets = await _index_targets(db, user, payload)

    async def body() -> AsyncIterator[str]:
        total = len(targets)
        yield f"0/{total}\n"
        done = 0
        for record in targets:
            try:
                got = await _extract_owned(db, user, record, limit=_RETRIEVAL_LIMIT)
                if got is not None:
                    version_id, text = got
                    await semantic.ensure_embedded(db, user, record.id, version_id, text, key)
            except llm.LLMError as exc:
                await db.rollback()
                yield f"error: {exc}\n"
                return
            except Exception:
                await db.rollback()  # skip a bad file, keep going
            done += 1
            yield f"{done}/{total} {record.name}\n"

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


@router.get("/index/status", response_model=IndexStatusOut)
async def index_status(key_id: uuid.UUID, user: SessionUser, db: DbDep) -> IndexStatusOut:
    """Report which extractable files are already embedded for this key's
    embedding model at their current version (so the UI can mark them done)."""
    key = await _require_key(db, user, key_id)
    files = (
        await db.execute(
            select(File).where(File.owner_id == user.id, File.current_version_id.is_not(None))
        )
    ).scalars().all()
    extractable = [f for f in files if extract.is_extractable(f.mime, f.ext)]
    if not key.embedding_model:
        return IndexStatusOut(indexed_file_ids=[], total=len(extractable))

    embedded = {
        r
        for r in (
            await db.execute(
                select(AiFileChunk.file_id)
                .join(File, File.id == AiFileChunk.file_id)
                .where(
                    AiFileChunk.user_id == user.id,
                    AiFileChunk.embed_model == key.embedding_model,
                    AiFileChunk.version_id == File.current_version_id,
                )
                .distinct()
            )
        ).scalars()
    }
    indexed = [str(f.id) for f in extractable if f.id in embedded]
    return IndexStatusOut(indexed_file_ids=indexed, total=len(extractable))


@router.post("/unindex")
async def unindex(payload: UnindexRequest, user: SessionUser, db: DbDep) -> dict[str, int]:
    """Delete embedded chunks to free space — all files, or specific ones."""
    removed = await service.unindex(
        db, user, all_files=payload.all, file_ids=payload.file_ids
    )
    return {"removed": removed}


# ── Drive-wide: conversations ────────────────────────────────────────────────
@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user: CurrentUser, db: DbDep) -> list[ConversationOut]:
    return [ConversationOut.model_validate(c) for c in await service.list_conversations(db, user)]


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    payload: ConversationCreate, user: CurrentUser, db: DbDep
) -> ConversationOut:
    return ConversationOut.model_validate(
        await service.create_conversation(db, user, title=payload.title)
    )


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(
    conversation_id: uuid.UUID, payload: ConversationRename, user: CurrentUser, db: DbDep
) -> ConversationOut:
    convo = await service.rename_conversation(db, user, conversation_id, title=payload.title)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return ConversationOut.model_validate(convo)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    await service.delete_conversation(db, user, conversation_id)


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageOut])
async def conversation_messages(
    conversation_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> list[ChatMessageOut]:
    if await service.get_conversation(db, user, conversation_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    rows = (
        await db.execute(
            select(AiChatMessage)
            .where(AiChatMessage.conversation_id == conversation_id)
            .order_by(AiChatMessage.created_at)
        )
    ).scalars()
    return [ChatMessageOut.model_validate(r) for r in rows]


# ── Drive-wide: RAG chat ─────────────────────────────────────────────────────
async def _persist_drive_turn(
    conversation_id: uuid.UUID, user_id: uuid.UUID, question: str, answer: str, *, retitle: bool
) -> None:
    from byos_api.db.models import AiConversation

    async with SessionLocal() as store:
        store.add(
            AiChatMessage(
                user_id=user_id, conversation_id=conversation_id, role="user", content=question
            )
        )
        store.add(
            AiChatMessage(
                user_id=user_id, conversation_id=conversation_id, role="assistant", content=answer
            )
        )
        convo = await store.get(AiConversation, conversation_id)
        if convo is not None:
            convo.updated_at = datetime.now(UTC)  # bump for sidebar ordering
            if retitle:
                convo.title = question.strip()[:60] or convo.title
        await store.commit()


@router.post("/drive/chat")
async def drive_chat(payload: DriveChatRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    key = await _require_key(db, user, payload.key_id)
    if not key.embedding_model:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This key has no embedding model set (needed for RAG)."
        )
    convo = await service.get_conversation(db, user, payload.conversation_id)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    # First message in a still-untitled conversation → title it from the question.
    retitle = convo.title.strip() in ("", "New chat")

    base_system = await _system_prompt(db, user, payload.prompt_id)
    prior: list[llm.Message] = [
        {"role": m.role, "content": _answer_only(m.content)}
        for m in (
            await db.execute(
                select(AiChatMessage)
                .where(AiChatMessage.conversation_id == payload.conversation_id)
                .order_by(AiChatMessage.created_at)
            )
        ).scalars()
    ]

    params = _stream_params(key)
    conversation_id, user_id = payload.conversation_id, user.id
    question, strategies = payload.message, payload.strategies

    async def body() -> AsyncIterator[str]:
        # Run retrieval here (not before) so each RAG pre-step streams to the UI
        # as it happens. Uses its own session — the request session may already
        # be closing by the time this stream is consumed.
        hits: list[tuple[str, str, str]] = []
        try:
            async with SessionLocal() as rdb:
                async for evt in rag.retrieve(rdb, user, key, question, strategies):
                    if evt["kind"] == "step":
                        yield _evt(evt)
                    elif evt["kind"] == "hits":
                        hits = evt["hits"]
        except llm.LLMError as exc:
            yield _evt({"kind": "error", "detail": str(exc)})
            return

        # Numbered excerpts (no file names in prose) so we can attribute sources
        # after the fact without the model inlining them.
        context = (
            "\n\n---\n\n".join(f"[{i}]\n{c}" for i, (_f, _n, c) in enumerate(hits))
            or "(no indexed content matched)"
        )
        system = (
            f"{base_system}\n\nAnswer using these excerpts from the user's files. "
            f"Do not mention or list file names in your answer.\n\n{context}"
        )
        messages: list[llm.Message] = [{"role": "system", "content": system}, *prior]
        messages.append({"role": "user", "content": question})

        collected: list[str] = []
        async for delta in llm.stream_chat(messages=messages, **params):
            collected.append(delta)
            yield delta
        answer = _strip_thoughts("".join(collected))

        # Attribute which files the answer actually used, then emit them.
        used = await rag.cited_files(key, question, answer, hits)
        sources_evt = _evt({"kind": "sources", "sources": [{"id": f, "name": n} for f, n in used]})
        yield sources_evt

        if answer:
            # Persist the sources alongside the answer so they survive a reload.
            stored = answer + sources_evt if used else answer
            await _persist_drive_turn(conversation_id, user_id, question, stored, retitle=retitle)

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)
