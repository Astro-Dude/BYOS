"""Semantic retrieval over embedded file chunks.

Chunks are embedded once and cached per (file version, embedding model). At query
time we embed the question and cosine-rank chunks with numpy — dimension-agnostic
(so any BYOK embedding model works) and, scoped per user, fast enough without a
vector index. Used for single-document long-doc mode and drive-wide RAG.
"""

from __future__ import annotations

import uuid

import numpy as np
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import llm, retrieval
from byos_api.core import crypto
from byos_api.db.models import AiFileChunk, AiKey, File, User

# Bound how much of a huge file we embed (keeps embedding cost/storage sane).
_MAX_EMBED_CHARS = 1_500_000


async def _touch(db: AsyncSession, file_ids: set[uuid.UUID]) -> None:
    """Mark files' chunks as recently used, so inactivity expiry keeps what's
    actually being queried and only reclaims stale indexes."""
    if not file_ids:
        return
    await db.execute(
        update(AiFileChunk)
        .where(AiFileChunk.file_id.in_(file_ids))
        .values(last_used_at=func.now())
    )
    await db.commit()


def _rank(query_vec: list[float], rows: list[AiFileChunk], k: int) -> list[AiFileChunk]:
    """Top-k rows by cosine similarity to query_vec (numpy)."""
    if not rows:
        return []
    matrix = np.array([r.embedding for r in rows], dtype=np.float32)
    q = np.array(query_vec, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1) * np.linalg.norm(q)
    norms[norms == 0] = 1e-9
    scores = matrix @ q / norms
    top = np.argsort(scores)[::-1][:k]
    return [rows[i] for i in top]


async def ensure_embedded(
    db: AsyncSession,
    user: User,
    file_id: uuid.UUID,
    version_id: uuid.UUID,
    full_text: str,
    key: AiKey,
) -> bool:
    """Embed + cache this file's chunks for (version, model) if not already
    present. Returns True if semantic data is available afterwards."""
    model = key.embedding_model
    if not model:
        return False
    fresh = (
        await db.execute(
            select(AiFileChunk.id)
            .where(
                AiFileChunk.file_id == file_id,
                AiFileChunk.embed_model == model,
                AiFileChunk.version_id == version_id,
            )
            .limit(1)
        )
    ).first()
    if fresh:
        return True
    # Clear any stale chunks (old version / this model) before re-embedding.
    await db.execute(
        delete(AiFileChunk).where(
            AiFileChunk.file_id == file_id, AiFileChunk.embed_model == model
        )
    )
    chunks = retrieval.chunk_text(full_text[:_MAX_EMBED_CHARS], size=1800, overlap=200)
    if not chunks:
        return False
    api_key = crypto.decrypt(key.encrypted_api_key)
    vectors = await llm.embed(key.base_url, api_key, model, chunks)
    for idx, (content, vector) in enumerate(zip(chunks, vectors, strict=False)):
        db.add(
            AiFileChunk(
                user_id=user.id,
                file_id=file_id,
                version_id=version_id,
                embed_model=model,
                chunk_index=idx,
                content=content,
                embedding=vector,
            )
        )
    await db.commit()
    return True


async def _embed_query(key: AiKey, query: str) -> list[float]:
    api_key = crypto.decrypt(key.encrypted_api_key)
    return (await llm.embed(key.base_url, api_key, key.embedding_model or "", [query]))[0]


async def semantic_chunks(
    db: AsyncSession, file_id: uuid.UUID, key: AiKey, query: str, *, k: int = 6
) -> list[str]:
    """Single-document: k chunks of one file most similar to the query."""
    if not key.embedding_model:
        return []
    rows = list(
        (
            await db.execute(
                select(AiFileChunk)
                .where(
                    AiFileChunk.file_id == file_id,
                    AiFileChunk.embed_model == key.embedding_model,
                )
                .order_by(AiFileChunk.chunk_index)
            )
        ).scalars()
    )
    if not rows:
        return []
    query_vec = await _embed_query(key, query)
    ranked = _rank(query_vec, rows, k)
    await _touch(db, {file_id})
    ranked.sort(key=lambda r: r.chunk_index)  # keep reading order
    return [r.content for r in ranked]


async def drive_semantic_chunks(
    db: AsyncSession, user: User, key: AiKey, query_vec: list[float], *, k: int = 8
) -> list[tuple[str, str, str]]:
    """Drive-wide: k chunks across ALL the user's indexed files for this key's
    embedding model. Returns (file_id, filename, chunk_text) triples for
    citations (file_id lets the UI open the source in a preview)."""
    if not key.embedding_model:
        return []
    rows = list(
        (
            await db.execute(
                select(AiFileChunk, File.name)
                .join(File, File.id == AiFileChunk.file_id)
                .where(
                    AiFileChunk.user_id == user.id,
                    AiFileChunk.embed_model == key.embedding_model,
                )
            )
        ).all()
    )
    if not rows:
        return []
    chunks = [r[0] for r in rows]
    names = [r[1] for r in rows]
    top = _rank(query_vec, chunks, k)
    await _touch(db, {c.file_id for c in top})  # keep queried files alive
    by_id = {id(c): n for c, n in zip(chunks, names, strict=False)}
    return [(str(c.file_id), by_id.get(id(c), "file"), c.content) for c in top]
