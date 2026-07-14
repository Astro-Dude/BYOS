"""Lightweight retrieval for long documents (books, long PDFs) that don't fit a
model's context window.

Chunks the text and picks the chunks most relevant to the question using simple
lexical scoring (term overlap) — no embedding model or vector store required, so
it works with any BYOK provider out of the box. Embedding-based retrieval can be
added later as a selectable strategy.
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Common words to ignore when scoring so relevance isn't dominated by filler.
_STOP = frozenset(
    "the a an and or of to in on for is are was were be been it this that these those with "
    "as at by from into about your you i we they he she what which who whom how when where why "
    "do does did can could should would will shall may might not no yes".split()
)


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def chunk_text(text: str, *, size: int = 1500, overlap: int = 200) -> list[str]:
    """Split into overlapping character windows, preferring paragraph breaks."""
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []
    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        # Try to end on a paragraph/sentence boundary for cleaner chunks.
        if end < n:
            window = text[start:end]
            for sep in ("\n\n", "\n", ". "):
                idx = window.rfind(sep)
                if idx > size // 2:
                    end = start + idx + len(sep)
                    break
        chunks.append(text[start:end].strip())
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


def top_chunks(chunks: list[str], query: str, *, k: int = 6) -> list[str]:
    """Return the k chunks most relevant to the query (lexical term overlap),
    preserving their original document order. Falls back to the first k chunks
    when the query has no useful terms or nothing matches."""
    if len(chunks) <= k:
        return chunks
    q_terms = {t for t in _tokens(query) if t not in _STOP and len(t) > 2}
    if not q_terms:
        return chunks[:k]
    scored: list[tuple[int, int]] = []  # (score, original index)
    for i, chunk in enumerate(chunks):
        toks = _tokens(chunk)
        score = sum(1 for t in toks if t in q_terms)
        if score:
            scored.append((score, i))
    if not scored:
        return chunks[:k]
    top_idx = sorted(i for _, i in sorted(scored, reverse=True)[:k])
    return [chunks[i] for i in top_idx]
