"""Semantic long-document retrieval.

Embeds a file's chunks once (cached per file version + embedding model), then
ranks them by cosine similarity to the question's embedding. This handles
synonyms, paraphrases, and cross-language queries that lexical matching misses.
Dimension-agnostic (embeddings stored as a float array) and scoped to one file,
so a plain Python scan is enough — no vector index.
"""

from __future__ import annotations

import math

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import llm, retrieval
from byos_api.core import crypto
from byos_api.db.models import AiConfig, AiFileChunk, User

# Bound how much of a huge file we embed (keeps embedding cost/storage sane).
_MAX_EMBED_CHARS = 1_500_000


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


async def ensure_embedded(
    db: AsyncSession,
    user: User,
    file_id,
    version_id,
    full_text: str,
    cfg: AiConfig,
) -> bool:
    """Embed + cache this file's chunks for (version, model) if not already
    present. Returns True if semantic data is available afterwards."""
    model = cfg.embedding_model
    if not model:
        return False
    fresh = (
        await db.execute(
            select(AiFileChunk.id).where(
                AiFileChunk.file_id == file_id,
                AiFileChunk.embed_model == model,
                AiFileChunk.version_id == version_id,
            ).limit(1)
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
    key = crypto.decrypt(cfg.encrypted_api_key)
    vectors = await llm.embed(cfg.base_url, key, model, chunks)
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


async def semantic_chunks(
    db: AsyncSession, file_id, cfg: AiConfig, query: str, *, k: int = 6
) -> list[str]:
    """Return the k chunks most similar to the query, in document order."""
    model = cfg.embedding_model
    if not model:
        return []
    rows = list(
        (
            await db.execute(
                select(AiFileChunk)
                .where(AiFileChunk.file_id == file_id, AiFileChunk.embed_model == model)
                .order_by(AiFileChunk.chunk_index)
            )
        ).scalars()
    )
    if not rows:
        return []
    key = crypto.decrypt(cfg.encrypted_api_key)
    query_vec = (await llm.embed(cfg.base_url, key, model, [query]))[0]
    ranked = sorted(rows, key=lambda r: _cosine(query_vec, r.embedding), reverse=True)[:k]
    ranked.sort(key=lambda r: r.chunk_index)  # keep original reading order
    return [r.content for r in ranked]
