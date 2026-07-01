"""Rule-based natural-language query parsing.

Turns phrases like *"pdfs from last week larger than 2mb invoice"* into the
structured filters the file query already understands (type → mime/ext, size,
recency) plus a free-text remainder for full-text search. It degrades to plain
search: a query with no recognized tokens is passed through verbatim as FTS.

This is deliberately dependency-free. An LLM-backed parser can replace ``parse``
behind the same ``ParsedQuery`` contract without touching the query layer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# type keyword -> (mime_prefix, ext)
_TYPES: dict[str, tuple[str | None, str | None]] = {
    "image": ("image/", None),
    "images": ("image/", None),
    "photo": ("image/", None),
    "photos": ("image/", None),
    "picture": ("image/", None),
    "pictures": ("image/", None),
    "video": ("video/", None),
    "videos": ("video/", None),
    "movie": ("video/", None),
    "movies": ("video/", None),
    "audio": ("audio/", None),
    "music": ("audio/", None),
    "song": ("audio/", None),
    "songs": ("audio/", None),
    "pdf": (None, "pdf"),
    "pdfs": (None, "pdf"),
}

# Multi-word recency phrases, checked longest-first.
_RECENCY_PHRASES: tuple[tuple[str, int], ...] = (
    ("last 24 hours", 1),
    ("past 24 hours", 1),
    ("this week", 7),
    ("last week", 7),
    ("past week", 7),
    ("this month", 30),
    ("last month", 30),
    ("past month", 30),
    ("this year", 365),
    ("last year", 365),
    ("today", 1),
    ("yesterday", 2),
)
_RECENCY_WORDS: tuple[tuple[str, int], ...] = (("week", 7), ("month", 30), ("year", 365))

_UNIT = {"kb": 1024, "mb": 1024**2, "gb": 1024**3}
_SIZE_RE = re.compile(
    r"(>|<|over|under|larger than|bigger than|greater than|smaller than|less than)\s*"
    r"(\d+(?:\.\d+)?)\s*(kb|mb|gb)",
    re.IGNORECASE,
)
_GREATER = {">", "over", "larger than", "bigger than", "greater than"}

_STOP = {
    "from", "in", "the", "my", "files", "file", "show", "me", "all", "find",
    "with", "of", "and", "larger", "bigger", "smaller", "greater", "less",
    "than", "over", "under", "size",
}


@dataclass
class ParsedQuery:
    text: str = ""
    mime_prefix: str | None = None
    ext: str | None = None
    min_size: int | None = None
    max_size: int | None = None
    since_days: int | None = None


def parse(query: str) -> ParsedQuery:
    remaining = query.strip().lower()
    result = ParsedQuery()

    size_match = _SIZE_RE.search(remaining)
    if size_match:
        op = size_match.group(1).lower()
        num = float(size_match.group(2))
        unit = size_match.group(3).lower()
        threshold = int(num * _UNIT[unit])
        if op in _GREATER:
            result.min_size = threshold
        else:
            result.max_size = threshold
        remaining = remaining[: size_match.start()] + " " + remaining[size_match.end() :]

    for phrase, days in _RECENCY_PHRASES:
        if phrase in remaining:
            result.since_days = days
            remaining = remaining.replace(phrase, " ")
            break
    else:
        for word, days in _RECENCY_WORDS:
            if re.search(rf"\b{word}\b", remaining):
                result.since_days = days
                remaining = re.sub(rf"\b{word}\b", " ", remaining)
                break

    kept: list[str] = []
    for token in re.findall(r"[a-z0-9.]+", remaining):
        if token in _TYPES and result.mime_prefix is None and result.ext is None:
            result.mime_prefix, result.ext = _TYPES[token]
            continue
        if token in _STOP:
            continue
        kept.append(token)

    result.text = " ".join(kept).strip()
    return result
