"""Drive-wide RAG: retrieve the most relevant chunks across the user's indexed
files, with optional, user-selectable strategies:

- query rewriting — turn the question into a keyword-rich search query
- HyDE — draft a hypothetical answer and embed that instead of the raw query
- rerank (LLM-as-judge) — have the model reorder/keep the best retrieved chunks
- CRAG (corrective) — grade the retrieval; if weak, rewrite + retrieve once more

Each is opt-in and best-effort (a failing pre-step falls back gracefully).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import llm, semantic
from byos_api.ai.schemas import RagStrategies
from byos_api.core import crypto
from byos_api.db.models import AiKey, User

# A retrieved hit: (file_id, filename, chunk_text).
Hit = tuple[str, str, str]

_THOUGHT_RE = re.compile(r"<(think|thought)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)


def _clean(text: str) -> str:
    """Strip a model's inline reasoning so pre-step output is just the result."""
    return _THOUGHT_RE.sub("", text).strip()


def _params(key: AiKey) -> dict:
    return {
        "base_url": key.base_url,
        "api_key": crypto.decrypt(key.encrypted_api_key),
        "model": key.model,
        "temperature": 0.1,
        "max_tokens": 512,
        "top_p": key.top_p,
    }


async def _rewrite(key: AiKey, question: str) -> str:
    messages = [
        {
            "role": "system",
            "content": "Rewrite the user's question into a concise, keyword-rich search "
            "query for retrieving documents. Output only the query.",
        },
        {"role": "user", "content": question},
    ]
    try:
        return _clean(await llm.chat(messages=messages, **_params(key))) or question
    except llm.LLMError:
        return question


async def _hyde(key: AiKey, question: str) -> str:
    messages = [
        {
            "role": "system",
            "content": "Write a short, plausible passage that would answer the question, "
            "as if excerpted from a relevant document.",
        },
        {"role": "user", "content": question},
    ]
    try:
        return _clean(await llm.chat(messages=messages, **_params(key))) or question
    except llm.LLMError:
        return question


async def _rerank(key: AiKey, question: str, hits: list[Hit], keep: int) -> list[Hit]:
    listing = "\n".join(f"[{i}] ({n}) {c[:500]}" for i, (_fid, n, c) in enumerate(hits))
    messages = [
        {
            "role": "system",
            "content": "Given a question and numbered snippets, list the indices of the most "
            "relevant snippets, comma-separated, best first. Output only numbers.",
        },
        {"role": "user", "content": f"Question: {question}\n\nSnippets:\n{listing}"},
    ]
    try:
        raw = _clean(await llm.chat(messages=messages, **_params(key)))
    except llm.LLMError:
        return hits[:keep]
    order = [int(x) for x in re.findall(r"\d+", raw)]
    picked = [hits[i] for i in order if 0 <= i < len(hits)][:keep]
    return picked or hits[:keep]


async def _sufficient(key: AiKey, question: str, hits: list[Hit]) -> bool:
    joined = "\n\n".join(c for _fid, _n, c in hits[:4])
    messages = [
        {
            "role": "system",
            "content": "Answer only YES or NO: do the snippets contain enough information "
            "to answer the question?",
        },
        {"role": "user", "content": f"Question: {question}\n\nSnippets:\n{joined}"},
    ]
    try:
        return "yes" in _clean(await llm.chat(messages=messages, **_params(key))).lower()[:6]
    except llm.LLMError:
        return True  # don't block answering on a grading failure


def _diversify(hits: list[Hit], keep: int) -> list[Hit]:
    """Prioritise file coverage: take the best chunk from each distinct file
    first (in ranked order), then backfill with any remaining chunks. Keeps
    multi-document questions (e.g. "average across 7 monthly payslips") from
    silently dropping a whole file just because another file had two strong
    chunks. Order within each group is preserved (relevance-ranked)."""
    primary: list[Hit] = []
    extra: list[Hit] = []
    seen: set[str] = set()
    for h in hits:
        if h[0] in seen:
            extra.append(h)
        else:
            seen.add(h[0])
            primary.append(h)
    return (primary + extra)[:keep]


async def retrieve(
    db: AsyncSession,
    user: User,
    key: AiKey,
    question: str,
    strategies: RagStrategies,
    *,
    k: int = 40,
    keep: int = 20,
) -> AsyncIterator[dict]:
    """Async-generate the RAG pipeline as events so the UI can show progress
    live: `{"kind": "step", ...}` for each pre-step as it happens, then a final
    `{"kind": "hits", "hits": [...]}` carrying the grounding chunks.

    `k` candidates are retrieved and `keep` are kept — generous so questions
    spanning many files don't lose a document — with per-file coverage enforced
    by `_diversify` before trimming."""
    query = question
    if strategies.rewrite:
        query = await _rewrite(key, question)
        yield {"kind": "step", "label": "Rewrote search query", "detail": query}

    embed_text = query
    if strategies.hyde:
        embed_text = await _hyde(key, query)
        yield {"kind": "step", "label": "Drafted a hypothetical answer (HyDE)", "detail": ""}

    query_vec = await semantic._embed_query(key, embed_text)
    hits = await semantic.drive_semantic_chunks(db, user, key, query_vec, k=k)

    if strategies.rerank and hits:
        hits = await _rerank(key, question, hits, k)
        yield {"kind": "step", "label": "Reranked snippets by relevance", "detail": ""}

    if strategies.crag and hits and not await _sufficient(key, question, hits):
        query2 = await _rewrite(key, question)
        yield {"kind": "step", "label": "Retrieval looked weak — retried (CRAG)", "detail": query2}
        hits = await semantic.drive_semantic_chunks(
            db, user, key, await semantic._embed_query(key, query2), k=k
        )
        if strategies.rerank and hits:
            hits = await _rerank(key, question, hits, k)

    yield {"kind": "hits", "hits": _diversify(hits, keep)}


async def cited_files(
    key: AiKey, question: str, answer: str, hits: list[Hit]
) -> list[tuple[str, str]]:
    """After answering, ask which numbered excerpts the answer actually drew on,
    and return the unique (file_id, filename) of those — so the UI shows only the
    files that fed the answer (one for a lookup, several for an aggregation).
    Falls back to the top hit if the model gives nothing usable."""
    if not hits:
        return []
    listing = "\n".join(f"[{i}] ({n}) {c[:300]}" for i, (_f, n, c) in enumerate(hits))
    messages = [
        {
            "role": "system",
            "content": "You are given a question, an assistant's answer, and numbered source "
            "excerpts. Reply with ONLY the numbers of the excerpts whose information the answer "
            "actually used, comma-separated (e.g. 0, 2, 5). If the answer did not rely on any "
            "excerpt (e.g. it is general knowledge), reply with the single word: none.",
        },
        {
            "role": "user",
            "content": f"Question:\n{question}\n\nAnswer:\n{answer}\n\nExcerpts:\n{listing}",
        },
    ]
    try:
        raw = _clean(await llm.chat(messages=messages, **_params(key)))
    except llm.LLMError:
        return []
    if "none" in raw.lower()[:8]:
        return []  # answer wasn't grounded in the files → no sources
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for i in (int(x) for x in re.findall(r"\d+", raw)):
        if 0 <= i < len(hits) and hits[i][0] not in seen:
            seen.add(hits[i][0])
            out.append((hits[i][0], hits[i][1]))
    return out
