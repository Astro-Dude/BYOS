"""BYOK (Bring Your Own Key) endpoints.

- Vault: manage multiple saved LLM keys + named system prompts.
- Single-document: summarize / stateful chat over one file (long-doc retrieval).
- Drive-wide: index files and RAG-chat across the whole drive with selectable
  strategies (query rewriting, HyDE, rerank/LLM-as-judge, CRAG).

Chats are streamed token-by-token; the drive thread is `file_id = NULL`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import (
    agent,
    citations,
    extract,
    llm,
    organize,
    rag,
    retrieval,
    semantic,
    service,
    vision,
)
from byos_api.ai.modes import Mode
from byos_api.ai.schemas import (
    ActionOut,
    ActionResultOut,
    AgentChatRequest,
    AiKeyIn,
    AiKeyOut,
    AiKeyRevealed,
    AiPromptIn,
    AiPromptOut,
    ApplyResultOut,
    ChatMessageOut,
    ChatSendRequest,
    ConversationCreate,
    ConversationOut,
    ConversationRename,
    DriveChatRequest,
    Effort,
    IndexRequest,
    IndexStatusOut,
    ModelCheckIn,
    ModelCheckOut,
    ModelListIn,
    ModelListOut,
    PlanOut,
    SummarizeRequest,
    UnindexRequest,
)
from byos_api.audit import recorder as audit
from byos_api.auth.dependencies import CurrentUser, SessionUser, get_session_user
from byos_api.core import crypto
from byos_api.core.db import SessionLocal, get_db
from byos_api.db.models import (
    AiActionPlan,
    AiChatMessage,
    AiFileChunk,
    AiKey,
    File,
    FileVersion,
    User,
)
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider

logger = logging.getLogger("byos.ai")

# Session-only: the assistant spends the user's model keys and can change or
# delete files and make links, so an API key (whatever its scopes) can't reach it.
router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(get_session_user)])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_MAX_AI_BYTES = 25 * 1024 * 1024
_RETRIEVAL_LIMIT = 2_000_000  # long-doc / indexing reads far more than the context cap

_DEFAULT_SYSTEM = (
    "You are a helpful assistant answering questions about the user's document(s). "
    "Base answers on the provided content; if it doesn't contain the answer, say so."
)

# Appended to whichever system prompt is in force — including a user's own custom
# prompt — so the client can always highlight the value that was actually asked
# for. Rendered as <mark> by the chat formatter.
_HIGHLIGHT_NOTE = (
    "Formatting: wrap the single most direct answer — the figure, name, date or "
    "short phrase the user actually asked for — in ==double equals==, e.g. "
    "“your total net pay was ==₹84,500.00==”. Use it exactly once, on the key "
    "value only, never on a whole sentence or a heading. Omit it entirely if the "
    "answer isn't a specific value."
)


def _answering_system(base: str) -> str:
    """System prompt for the question-answering endpoints (summarize / chat /
    drive RAG). The agent deliberately doesn't use this — its replies describe
    changes rather than reporting a value."""
    return f"{base}\n\n{_HIGHLIGHT_NOTE}"


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


_WORKING_RE = re.compile(r"<(think|thought|reasoning)\b[^>]*>.*?</\1>", re.I | re.DOTALL)


def _answer_only(text: str) -> str:
    """Drop any trailing control events (e.g. the persisted sources) and shown
    working from a stored assistant message, so past turns fed back to the model
    are clean."""
    return _WORKING_RE.sub("", text.split("\x1e", 1)[0]).strip()


# ── Vault: keys ──────────────────────────────────────────────────────────────
@router.get("/keys", response_model=list[AiKeyOut])
async def list_keys(user: CurrentUser, db: DbDep) -> list[AiKeyOut]:
    return [AiKeyOut.model_validate(k) for k in await service.list_keys(db, user)]


@router.get("/keys/{key_id}/reveal", response_model=AiKeyRevealed)
async def reveal_key(
    key_id: uuid.UUID, request: Request, user: SessionUser, db: DbDep
) -> AiKeyRevealed:
    """Return one key's decrypted value, so the owner can check or copy what they
    saved. Its own endpoint (not part of AiKeyOut) so keys are never carried by
    routine responses, and every reveal lands in the audit log."""
    key = await service.get_key(db, user, key_id)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found")
    await audit.record(
        user.id, "ai_key.reveal", request=request, target_type="ai_key", target_id=str(key_id)
    )
    return AiKeyRevealed(api_key=crypto.decrypt(key.encrypted_api_key))


async def _validate_key(payload: AiKeyIn, existing: AiKey | None) -> llm.ModelCheck:
    api_key = payload.api_key or (crypto.decrypt(existing.encrypted_api_key) if existing else None)
    if not api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An API key is required.")
    try:
        return await llm.validate(payload.base_url, api_key, payload.model)
    except llm.LLMError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _fit(payload: AiKeyIn, check: llm.ModelCheck | None) -> AiKeyIn:
    """The settings, made to suit the model just tested. A level it doesn't have
    moves to the nearest one it does, and goes when it has none; top-p goes if
    the model refuses it. Temperature is kept: it's skipped when sending, and
    comes back into use if the key moves to a model that takes it."""
    if check is None:
        return payload
    effort = payload.reasoning_effort
    if effort and not check.efforts:
        effort = None
    elif effort and effort not in check.efforts:
        effort = cast(Effort, llm.nearest_effort(effort, check.efforts))
    top_p = None if "top_p" in check.unsupported else payload.top_p
    return payload.model_copy(update={"reasoning_effort": effort, "top_p": top_p})


def _key_out(key: AiKey, check: llm.ModelCheck | None) -> AiKeyOut:
    out = AiKeyOut.model_validate(key)
    if check is not None:
        out.check = ModelCheckOut(unsupported=check.unsupported, efforts=check.efforts)
    return out


@router.post("/keys", response_model=AiKeyOut)
async def create_key(payload: AiKeyIn, user: SessionUser, db: DbDep) -> AiKeyOut:
    check = await _validate_key(payload, None)
    payload = _fit(payload, check)
    key = await service.create_key(
        db,
        user,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key=payload.api_key or "",
        embedding_model=payload.embedding_model,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        top_p=payload.top_p,
        reasoning_effort=payload.reasoning_effort,
    )
    return _key_out(key, check)


@router.put("/keys/{key_id}", response_model=AiKeyOut)
async def update_key(key_id: uuid.UUID, payload: AiKeyIn, user: SessionUser, db: DbDep) -> AiKeyOut:
    existing = await service.get_key(db, user, key_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found")
    # Only re-test the connection when something it depends on changed; renaming
    # a key or adjusting its settings shouldn't cost a request to the provider.
    check = None
    if (
        payload.api_key
        or payload.base_url.strip() != existing.base_url
        or payload.model.strip() != existing.model
    ):
        check = await _validate_key(payload, existing)
        payload = _fit(payload, check)
    key = await service.update_key(
        db,
        user,
        key_id,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key=payload.api_key,
        embedding_model=payload.embedding_model,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        top_p=payload.top_p,
        reasoning_effort=payload.reasoning_effort,
    )
    assert key is not None
    return _key_out(key, check)


async def _form_api_key(payload: ModelListIn, user: User, db: AsyncSession) -> str:
    """The key the form is working with: the one typed in, or the saved one."""
    if payload.api_key:
        return payload.api_key
    if payload.key_id:
        existing = await service.get_key(db, user, payload.key_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found")
        return crypto.decrypt(existing.encrypted_api_key)
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter an API key first.")


@router.post("/models", response_model=ModelListOut)
async def list_models(payload: ModelListIn, user: SessionUser, db: DbDep) -> ModelListOut:
    """The models a key can use, for the key form's model picker."""
    api_key = await _form_api_key(payload, user, db)
    try:
        models = await llm.list_models(payload.base_url, api_key)
    except llm.LLMError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ModelListOut(models=models)


@router.post("/models/check", response_model=ModelCheckOut)
async def check_model(payload: ModelCheckIn, user: SessionUser, db: DbDep) -> ModelCheckOut:
    """Test a model with one tiny request, so the key form can switch off the
    settings it doesn't support before the user saves."""
    api_key = await _form_api_key(payload, user, db)
    try:
        check = await llm.validate(payload.base_url, api_key, payload.model)
    except llm.LLMError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ModelCheckOut(unsupported=check.unsupported, efforts=check.efforts)


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
        "reasoning_effort": key.reasoning_effort,
    }


async def _read_text(data: bytes, record: File, *, key: AiKey | None, limit: int) -> str:
    """Text for a file we've just downloaded. Reads the text layer, and — when a
    key is supplied and vision is on — transcribes whatever has none: scanned PDF
    pages, and standalone images, which have no text layer at all."""
    if key is not None and vision.enabled():
        if extract.is_image(record.mime, record.ext):
            transcribed = await vision.transcribe_image(key, data, record.mime, record.ext)
            return extract.clean_text(transcribed)[:limit]
        if extract.is_pdf(record.mime, record.ext):
            pages = await vision.transcribe_pdf(key, data, extract.pdf_pages(data))
            return extract.join_pages(pages, limit=limit)
    return extract.extract_text(data, record.mime, record.ext, limit=limit)


class ExtractFailed(Exception):
    """A file's text couldn't be obtained, and why.

    Every failure carries a specific reason: this shows up verbatim as a skip
    line during indexing and as the 422 detail on the single-file endpoints. The
    old code returned None from six different places, so "nothing happened" was
    the only feedback a user ever got.
    """


async def _extract_owned(
    db: AsyncSession, user: User, record: File, *, limit: int, key: AiKey | None = None
) -> tuple[uuid.UUID, str]:
    """(version_id, text) for a File record, or ExtractFailed with the reason.
    Pass `key` to allow vision transcription of content with no text layer."""
    if not extract.is_extractable(record.mime, record.ext):
        raise ExtractFailed("this file type can't be read as text")
    if record.current_version_id is None:
        raise ExtractFailed("it has no stored content")
    version = await db.get(FileVersion, record.current_version_id)
    if version is None:
        raise ExtractFailed("its current version is missing")
    if version.size and version.size > _MAX_AI_BYTES:
        limit_mb = _MAX_AI_BYTES // (1024 * 1024)
        raise ExtractFailed(f"it's larger than {limit_mb} MB")
    account = await files_service.account_for_file(db, user, record)
    if account is None:
        raise ExtractFailed("its storage account is no longer connected")
    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    try:
        provider = get_provider(record.provider)
    except KeyError:
        raise ExtractFailed(f"its storage provider ({record.provider}) isn't available") from None
    buffer = bytearray()
    try:
        async for chunk in provider.download(account, ref):
            buffer.extend(chunk)
    except FileNotFoundError:
        raise ExtractFailed("it's missing from storage") from None
    try:
        text = await _read_text(bytes(buffer), record, key=key, limit=limit)
    except extract.EncryptedPdf:
        raise ExtractFailed(
            "it's password-protected (re-upload it without the password to index it)"
        ) from None
    if not text:
        raise ExtractFailed(_no_text_reason(record, key))
    return (version.id, text)


def _no_text_reason(record: File, key: AiKey | None) -> str:
    """Explain an empty extraction. This is the common one — a scan or a photo
    has no text layer at all, so whether vision could run decides everything."""
    is_visual = extract.is_image(record.mime, record.ext) or extract.is_pdf(record.mime, record.ext)
    if not is_visual:
        return "no readable text was found in it"
    if not vision.enabled():
        return "it's a scan or image and vision transcription is off (AI_VISION_OCR)"
    if key is None:
        return "it's a scan or image, which needs a model to transcribe"
    return (
        "it's a scan or image and the transcription came back empty; "
        f"check that '{key.model}' accepts images"
    )


async def _load_text(
    db: AsyncSession,
    user: User,
    file_id: uuid.UUID,
    *,
    limit: int = extract.MAX_CHARS,
    key: AiKey | None = None,
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
    try:
        version_id, text = await _extract_owned(db, user, record, limit=limit, key=key)
    except ExtractFailed as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Couldn't read this file: {exc}."
        ) from None
    return record.name, text, version_id


# ── Single document: summarize + chat ────────────────────────────────────────
@router.post("/summarize")
async def summarize(payload: SummarizeRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    key = await _require_key(db, user, payload.key_id)
    name, text, _ = await _load_text(db, user, payload.file_id, key=key)
    system = _answering_system(await _system_prompt(db, user, payload.prompt_id))
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
    name, text, version_id = await _load_text(db, user, payload.file_id, limit=limit, key=key)
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

    base_system = _answering_system(await _system_prompt(db, user, payload.prompt_id))
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
async def _embedded_file_ids(db: AsyncSession, user: User, model: str) -> set[uuid.UUID]:
    """Files with chunks for `model` at their CURRENT version. Anything else is
    either never indexed or stale after a re-upload."""
    return set(
        (
            await db.execute(
                select(AiFileChunk.file_id)
                .join(File, File.id == AiFileChunk.file_id)
                .where(
                    AiFileChunk.user_id == user.id,
                    AiFileChunk.embed_model == model,
                    AiFileChunk.version_id == File.current_version_id,
                )
                .distinct()
            )
        ).scalars()
    )


async def _index_targets(
    db: AsyncSession, user: User, payload: IndexRequest, key: AiKey
) -> list[File]:
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
    targets = [f for f in files if extract.is_extractable(f.mime, f.ext)]
    if payload.remaining and key.embedding_model:
        # "Index remaining" means exactly that: don't walk files that are already
        # done, so progress reads 5/5 instead of 15/15 with ten no-ops.
        embedded = await _embedded_file_ids(db, user, key.embedding_model)
        targets = [f for f in targets if f.id not in embedded]
    return targets


# Free-tier embedding endpoints throttle aggressively, and a burst of indexing
# can trip DNS for a single request, so both get waited out rather than counted
# as failures. Bounded: a stuck provider shouldn't hold the stream open forever.
_RATE_LIMIT_RETRIES = 3
_RATE_LIMIT_MAX_WAIT = 30.0
_TRANSIENT = (llm.LLMRateLimited, llm.LLMUnreachable)


async def _reset_session(db: AsyncSession, *live: object) -> None:
    """Roll back a failed file and re-load the objects the run keeps using.

    A rollback expires every instance in the session, so anything held across it
    — the user, the key — lazy-loads on next touch, which inside an async
    generator raises MissingGreenlet instead of doing the work. Everything else
    the loop needs is passed around as plain ids.
    """
    await db.rollback()
    for obj in live:
        await db.refresh(obj)  # type: ignore[arg-type]


async def _index_one(
    db: AsyncSession, user: User, file_id: uuid.UUID, key: AiKey, *, force: bool = False
) -> None:
    """Extract and embed one file, retrying through rate limits. Raises the last
    LLMError if it still can't get through, so the caller can skip the file.

    Takes an id rather than a File: a rollback anywhere in the run expires every
    instance in the session, so the record is re-read each attempt instead of
    being held across one."""
    for attempt in range(_RATE_LIMIT_RETRIES + 1):
        try:
            record = await files_service.get_owned_file(db, user, file_id)
            # Check before doing any work. Without this, re-indexing downloads the
            # file and re-runs vision transcription on it, only for
            # `ensure_embedded` to find the chunks already there and discard all
            # of it — slow, and it re-charges the user's key for nothing.
            if (
                not force
                and record.current_version_id is not None
                and await semantic.is_embedded(
                    db, file_id, record.current_version_id, key.embedding_model or ""
                )
            ):
                return
            version_id, text = await _extract_owned(
                db, user, record, limit=_RETRIEVAL_LIMIT, key=key
            )
            await semantic.ensure_embedded(db, user, file_id, version_id, text, key, force=force)
            return
        except _TRANSIENT as exc:
            if attempt >= _RATE_LIMIT_RETRIES:
                raise
            await _reset_session(db, user, key)
            # Honour a rate limit's hint when it gives one; otherwise back off
            # 2s, 4s, 8s.
            hint = getattr(exc, "retry_after", None)
            wait = hint if hint is not None else 2.0 * (2**attempt)
            await asyncio.sleep(min(wait, _RATE_LIMIT_MAX_WAIT))


@router.post("/index")
async def index_drive(payload: IndexRequest, user: SessionUser, db: DbDep) -> StreamingResponse:
    key = await _require_key(db, user, payload.key_id)
    if not key.embedding_model:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This key has no embedding model set (needed to index)."
        )
    targets = await _index_targets(db, user, payload, key)

    # Plain (id, name) pairs, resolved before streaming starts: a rollback during
    # the run expires every ORM instance, and reading an expired attribute inside
    # the generator is sync IO in async context (MissingGreenlet) instead of the
    # progress line we meant to send.
    queue = [(f.id, f.name) for f in targets]

    async def recover() -> None:
        await _reset_session(db, user, key)

    async def body() -> AsyncIterator[str]:
        total = len(queue)
        yield f"0/{total}\n"
        done, skipped = 0, 0
        for file_id, name in queue:
            try:
                await _index_one(db, user, file_id, key, force=payload.force)
            except llm.LLMAuthError as exc:
                # The key itself is wrong — every remaining file would fail the
                # same way, so stop rather than burn through the list.
                await recover()
                yield f"error: {exc}\n"
                return
            except llm.LLMError as exc:
                # One file's provider error (a persistent rate limit, a model
                # that choked on this content) must not end the whole run —
                # that's how a 40-file index used to die at file 11.
                await recover()
                skipped += 1
                yield f"warn: {name}: {exc}\n"
            except ExtractFailed as exc:
                # Nothing to embed — say exactly why, since the file will keep
                # showing as un-indexed until the cause is fixed.
                await recover()
                skipped += 1
                yield f"warn: {name}: {exc}\n"
            except Exception as exc:
                # Shouldn't happen — every known cause has its own reason above.
                # Name the exception anyway: "couldn't be read" alone sent us
                # digging through server logs to identify one locked PDF.
                logger.warning("indexing skipped %s", name, exc_info=True)
                await recover()
                skipped += 1
                yield f"warn: {name}: couldn't be read ({type(exc).__name__})\n"
            done += 1
            yield f"{done}/{total} {name}\n"
        if skipped:
            yield f"done: {done - skipped} indexed, {skipped} skipped\n"

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


@router.get("/index/status", response_model=IndexStatusOut)
async def index_status(key_id: uuid.UUID, user: SessionUser, db: DbDep) -> IndexStatusOut:
    """Report which extractable files are already embedded for this key's
    embedding model at their current version (so the UI can mark them done)."""
    key = await _require_key(db, user, key_id)
    files = (
        (
            await db.execute(
                select(File).where(File.owner_id == user.id, File.current_version_id.is_not(None))
            )
        )
        .scalars()
        .all()
    )
    extractable = [f for f in files if extract.is_extractable(f.mime, f.ext)]
    if not key.embedding_model:
        return IndexStatusOut(indexed_file_ids=[], total=len(extractable))

    embedded = await _embedded_file_ids(db, user, key.embedding_model)
    indexed = [str(f.id) for f in extractable if f.id in embedded]
    return IndexStatusOut(indexed_file_ids=indexed, total=len(extractable))


@router.post("/unindex")
async def unindex(payload: UnindexRequest, user: SessionUser, db: DbDep) -> dict[str, int]:
    """Delete embedded chunks to free space — all files, or specific ones."""
    removed = await service.unindex(db, user, all_files=payload.all, file_ids=payload.file_ids)
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
async def _retire_plan(plan_id: uuid.UUID) -> None:
    """Mark a revised plan discarded, if it's still waiting: its replacement
    has arrived. One that was applied meanwhile is left as it is."""
    async with SessionLocal() as store:
        plan = await store.get(AiActionPlan, plan_id)
        if plan is not None and plan.status == "pending":
            plan.status = "discarded"
            await store.commit()


def _revision_events(content: str) -> str:
    """The "revised" notes already at the head of a message, kept when it's
    rewritten again so the whole trail of changes stays visible."""
    return "".join(
        line + "\n"
        for line in content.split("\n")
        if line.startswith("\x1e") and '"kind": "revised"' in line
    )


async def _persist_drive_turn(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    *,
    retitle: bool,
    replaces: uuid.UUID | None = None,
) -> None:
    from byos_api.db.models import AiConversation

    async with SessionLocal() as store:
        if replaces is not None:
            # A revision: rewrite the message that held the replaced plan, with
            # the user's note on top, instead of adding a new exchange.
            old = (
                await store.execute(
                    select(AiChatMessage)
                    .where(
                        AiChatMessage.conversation_id == conversation_id,
                        AiChatMessage.user_id == user_id,
                        AiChatMessage.role == "assistant",
                        AiChatMessage.content.contains(f'"plan_id": "{replaces}"'),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if old is not None:
                note = _evt({"kind": "revised", "note": question})
                old.content = _revision_events(old.content) + note + answer
                await store.commit()
                return
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

    base_system = _answering_system(await _system_prompt(db, user, payload.prompt_id))
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
        excerpts: dict[str, str] = {}
        for fid, _name, chunk in hits:
            excerpts[fid] = excerpts.get(fid, "") + "\n" + chunk
        sources_evt = _evt(
            {
                "kind": "sources",
                "sources": [
                    {"id": f, "name": n, "quotes": citations.quotes_for(answer, excerpts.get(f))}
                    for f, n in used
                ],
            }
        )
        yield sources_evt

        if answer:
            # Persist the sources alongside the answer so they survive a reload.
            stored = answer + sources_evt if used else answer
            await _persist_drive_turn(conversation_id, user_id, question, stored, retitle=retitle)

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


# ── Agent: propose changes, then apply on confirmation ───────────────────────
def _actions_out(
    actions: list[dict[str, object]], results: list[dict[str, object] | None] | None
) -> list[ActionOut]:
    """Zip a plan's actions with their outcomes. `results` may be shorter than
    `actions` (or absent) when nothing has run yet."""
    outcomes = list(results or [])
    outcomes += [None] * (len(actions) - len(outcomes))
    return [
        ActionOut(
            op=str(a.get("op", "")),
            label=str(a.get("label", "")),
            danger=bool(a.get("danger")),
            auto=bool(a.get("auto")),
            result=(
                ActionResultOut(ok=bool(r.get("ok")), detail=str(r.get("detail", "")))
                if r
                else None
            ),
        )
        for a, r in zip(actions, outcomes, strict=True)
    ]


def _plan_out(plan: AiActionPlan) -> PlanOut:
    return PlanOut(
        id=plan.id,
        status=plan.status,
        actions=_actions_out(list(plan.actions or []), plan.result),
        created_at=plan.created_at,
    )


@router.post("/agent/chat")
async def agent_chat(payload: AgentChatRequest, user: CurrentUser, db: DbDep) -> StreamingResponse:
    """Run one agent turn. Read tools execute live; every change the model wants
    is collected into a plan and streamed back for the user to confirm — this
    endpoint never mutates the drive."""
    key = await _require_key(db, user, payload.key_id)
    convo = await service.get_conversation(db, user, payload.conversation_id)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    retitle = convo.title.strip() in ("", "New chat")
    # Read-only turns answer questions, so they want the highlight convention too;
    # the note no-ops on a turn that just summarises changes.
    base_system = _answering_system(await _system_prompt(db, user, payload.prompt_id))
    prior: list[dict[str, object]] = [
        {"role": m.role, "content": _answer_only(m.content)}
        for m in (
            await db.execute(
                select(AiChatMessage)
                .where(AiChatMessage.conversation_id == payload.conversation_id)
                .order_by(AiChatMessage.created_at)
            )
        ).scalars()
    ]
    conversation_id, question = payload.conversation_id, payload.message
    strategies = payload.strategies
    replaces: uuid.UUID | None = None
    previous = ""
    seed: list[dict[str, Any]] | None = None
    if payload.revises is not None:
        # Ask again with the note; the reply takes that plan's place. The old
        # plan is only retired once the new reply is saved, so a run that fails
        # leaves it exactly as it was, still ready to apply.
        old_plan = await db.get(AiActionPlan, payload.revises)
        if old_plan is None or old_plan.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
        replaces = old_plan.id
        seed = list(old_plan.actions or [])
        previous = organize.previous_plan(seed)
    note = question
    if replaces is not None:
        question = f"Change the plan you just proposed: {note}"
    # Organizing, whether by /organize or asked in plain words ("tidy up my
    # downloads"): the user's message is stored as typed; the agent also gets
    # the run's settings, and the tools those settings rule out are withheld.
    # It only ever proposes in a read-only chat, so nothing moves unconfirmed.
    task, mode, exclude, max_steps = question, payload.mode, frozenset[str](), agent.MAX_STEPS
    fix_brief = ""
    failed: list[tuple[dict[str, Any], str]] = []
    if payload.fixes is not None:
        failed_plan = await db.get(AiActionPlan, payload.fixes)
        if failed_plan is None or failed_plan.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
        actions = list(failed_plan.actions or [])
        outcomes = list(failed_plan.result or [])
        outcomes += [None] * (len(actions) - len(outcomes))
        # Point $new refs at the real folders that plan made, so the agent
        # redoes the changes against what exists instead of renumbering.
        made: dict[int, uuid.UUID] = {}
        await agent.recall_folders(db, user, actions, outcomes, made)
        for a, r in zip(actions, outcomes, strict=True):
            if r and not r.get("ok"):
                args = organize.with_real_folders(a.get("args") or {}, actions, made)
                failed.append(({**a, "args": args}, str(r.get("detail", ""))))
        if not failed:
            raise HTTPException(status.HTTP_409_CONFLICT, "Nothing in that plan failed.")
        fix_brief = organize.fix_brief(failed)
        # The fix lands in the failed plan's own message, like a revision, rather
        # than as a new exchange underneath it.
        replaces = failed_plan.id
    settings = (
        payload.organize
        or (organize.fix_settings([a for a, _ in failed]) if payload.fixes is not None else None)
        or organize.looks_like_organizing(question)
    )
    # Read only means read only: an organizing request there gets a short reply
    # and a one-tap switch to Ask first, instead of a plan drafted on the quiet.
    read_only_refusal = settings is not None and payload.mode is Mode.READ_ONLY
    if settings is not None and not read_only_refusal:
        # A fix redoes a handful of changes: it gets the folders to aim at, not
        # the whole-drive brief, which would send it reorganizing everything.
        context = (
            await organize.folders_listing(db, user)
            if payload.fixes is not None
            else organize.brief(settings, await organize.inventory(db, user))
        )
        task = f"{question}\n\n{context}"
        exclude = organize.excluded_tools(settings)
        max_steps = organize.MAX_STEPS
    if previous:
        task = f"{task}\n\n{previous}"
    if fix_brief:
        task = f"{task}\n\n{fix_brief}"
    # Decrypt up front: the stream body can't return a clean HTTP error.
    api_key = crypto.decrypt(key.encrypted_api_key)

    async def body() -> AsyncIterator[str]:
        if read_only_refusal:
            reply = organize.READ_ONLY_REPLY
            switch = _evt({"kind": "switch_mode", "mode": Mode.ASK.value, "retry": question})
            yield reply + switch
            await _persist_drive_turn(
                conversation_id, user.id, question, reply + switch, retitle=retitle
            )
            return
        # Own session: the request session may be closing by the time this
        # stream is consumed (same reason as drive chat).
        answer, plan_evt, sources_evt, question_evt = "", "", "", ""
        async with SessionLocal() as adb:
            fresh = await adb.get(User, user.id)
            if fresh is None:
                return
            async for evt in agent.run(
                adb,
                fresh,
                key,
                task,
                prior,
                api_key=api_key,
                system_prompt=base_system,
                mode=mode,
                strategies=strategies,
                exclude=exclude,
                max_steps=max_steps,
                seed=seed,
            ):
                if evt["kind"] == "answer":
                    answer = str(evt["text"])
                    if answer:
                        yield answer
                elif evt["kind"] == "plan":
                    plan = await agent.save_plan(
                        adb,
                        fresh,
                        conversation_id,
                        list(evt["actions"]),
                        list(evt["results"]),
                    )
                    plan_evt = _evt(
                        {
                            "kind": "plan",
                            "plan_id": str(plan.id),
                            "status": plan.status,
                            "actions": [
                                a.model_dump(mode="json")
                                for a in _actions_out(list(plan.actions), plan.result)
                            ],
                            # The drive's shape once applied, drawn as a tree;
                            # only for plans that create or move things.
                            "preview": await organize.preview(adb, fresh, list(plan.actions)),
                            # An organizing run's settings, so "change something"
                            # revises under the same limits.
                            "organize": settings.model_dump() if settings else None,
                        }
                    )
                    yield plan_evt
                elif evt["kind"] == "sources":
                    sources_evt = _evt(evt)
                    yield sources_evt
                elif evt["kind"] == "question":
                    question_evt = _evt(evt)
                    yield question_evt
                else:
                    yield _evt(evt)

        if (answer or plan_evt) and replaces is not None:
            await _retire_plan(replaces)
        if answer or plan_evt:
            # Store the plan and sources events with the answer so a reloaded
            # conversation still shows them (a plan's live status comes from
            # /agent/plans). Sources are references only: file id, name and the
            # quoted words, never the file's contents.
            await _persist_drive_turn(
                conversation_id,
                user.id,
                note if replaces is not None else question,
                answer + sources_evt + plan_evt + question_evt,
                retitle=retitle and replaces is None,
                replaces=replaces,
            )

    return StreamingResponse(body(), media_type=_STREAM_MEDIA, headers=_STREAM_HEADERS)


@router.get("/agent/plans", response_model=list[PlanOut])
async def list_plans(conversation_id: uuid.UUID, user: CurrentUser, db: DbDep) -> list[PlanOut]:
    """Every plan in a conversation, with its current status — fetched once when
    a conversation opens so each message can show whether its plan was applied."""
    rows = (
        await db.execute(
            select(AiActionPlan)
            .where(
                AiActionPlan.user_id == user.id,
                AiActionPlan.conversation_id == conversation_id,
            )
            .order_by(AiActionPlan.created_at)
        )
    ).scalars()
    return [_plan_out(p) for p in rows]


async def _owned_plan(db: AsyncSession, user: User, plan_id: uuid.UUID) -> AiActionPlan:
    plan = await db.get(AiActionPlan, plan_id)
    if plan is None or plan.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return plan


@router.post("/agent/plans/{plan_id}/apply", response_model=ApplyResultOut)
async def apply_plan(plan_id: uuid.UUID, user: CurrentUser, db: DbDep) -> ApplyResultOut:
    """Execute a confirmed plan. Only a pending plan can be applied, so a double
    click (or a replayed request) can't run the same changes twice. Actions that
    already ran during the turn (auto/full mode) keep their outcome and are not
    repeated."""
    plan = await _owned_plan(db, user, plan_id)
    if plan.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This plan was already {plan.status}.")
    results = await agent.apply(db, user, plan)
    return ApplyResultOut(
        plan_id=plan.id,
        status=plan.status,
        applied=sum(1 for r in results if r and r.get("ok")),
        failed=sum(1 for r in results if r and not r.get("ok")),
        actions=_actions_out(list(plan.actions or []), results),
    )


@router.post("/agent/plans/{plan_id}/discard", response_model=PlanOut)
async def discard_plan(plan_id: uuid.UUID, user: CurrentUser, db: DbDep) -> PlanOut:
    plan = await _owned_plan(db, user, plan_id)
    if plan.status == "pending":
        plan.status = "discarded"
        await db.commit()
        await db.refresh(plan)
    return _plan_out(plan)
