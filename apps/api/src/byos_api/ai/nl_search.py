"""Query parsing for the search box.

Two layers, unified into one :class:`ParsedQuery`:

1. **Explicit operators** (Discord/GitHub-style, checked first) —
   ``type:pdf ext:png tag:invoice in:reports size:>2mb before:2026-07-01
   after:2026-06-01 during:2026-06 is:starred "exact phrase" -exclude``.
2. **Natural-language fallback** on whatever text is left — phrases like
   *"pdfs from last week larger than 2mb"* still work, but never override an
   explicit operator.

Everything not recognized becomes free text for full-text / fuzzy search. This
is deliberately dependency-free; an LLM parser could replace ``parse`` behind
the same contract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

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
    "doc": (None, "doc"),
    "docs": (None, "doc"),
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

_UNIT = {"b": 1, "kb": 1024, "mb": 1024**2, "gb": 1024**3}
_SIZE_RE = re.compile(
    r"(>|<|over|under|larger than|bigger than|greater than|smaller than|less than)\s*"
    r"(\d+(?:\.\d+)?)\s*(kb|mb|gb)",
    re.IGNORECASE,
)
_GREATER = {">", "over", "larger than", "bigger than", "greater than"}

# A size operator value like ">2mb", "<=500kb", "2gb".
_SIZE_OP_RE = re.compile(r"^(>=|<=|>|<)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$", re.IGNORECASE)

# Tokenizer: key:"quoted", key:value, "quoted", or a bare word.
_TOKEN_RE = re.compile(r'(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)')

_KNOWN_OPS = {"type", "ext", "tag", "in", "folder", "size", "before", "after", "during", "is"}

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
    tags: list[str] = field(default_factory=list)
    folder_name: str | None = None
    is_favorite: bool | None = None
    min_size: int | None = None
    max_size: int | None = None
    since_days: int | None = None
    after: date | None = None  # created on/after this date (inclusive)
    before: date | None = None  # created strictly before this date


def _parse_size_op(value: str, result: ParsedQuery) -> None:
    m = _SIZE_OP_RE.match(value)
    if not m:
        return
    op = m.group(1) or ">"
    num = float(m.group(2))
    unit = (m.group(3) or "b").lower()
    threshold = int(num * _UNIT[unit])
    if op in (">", ">="):
        result.min_size = threshold
    else:
        result.max_size = threshold


def _parse_date_token(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _apply_during(value: str, result: ParsedQuery) -> None:
    """`during:2026`, `during:2026-06`, or `during:2026-06-15` → [after, before)."""
    parts = value.split("-")
    try:
        if len(parts) == 1:  # whole year
            year = int(parts[0])
            result.after = date(year, 1, 1)
            result.before = date(year + 1, 1, 1)
        elif len(parts) == 2:  # whole month
            year, month = int(parts[0]), int(parts[1])
            result.after = date(year, month, 1)
            result.before = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        else:  # a single day
            day = date.fromisoformat(value)
            result.after = day
            result.before = date.fromordinal(day.toordinal() + 1)
    except (ValueError, IndexError):
        pass


def _apply_operator(key: str, value: str, result: ParsedQuery) -> None:
    key = key.lower()
    value = value.strip()
    if not value:
        return
    if key == "type":
        if value.lower() in _TYPES:
            result.mime_prefix, result.ext = _TYPES[value.lower()]
    elif key == "ext":
        result.ext = value.lstrip(".").lower()
    elif key == "tag":
        result.tags.append(value.lower())
    elif key in ("in", "folder"):
        result.folder_name = value
    elif key == "size":
        _parse_size_op(value, result)
    elif key == "before":
        result.before = _parse_date_token(value) or result.before
    elif key == "after":
        result.after = _parse_date_token(value) or result.after
    elif key == "during":
        _apply_during(value, result)
    elif key == "is":
        if value.lower() in ("starred", "favorite", "favourite", "fav"):
            result.is_favorite = True


def _apply_nl_fallback(remaining: str, result: ParsedQuery) -> str:
    """Legacy natural-language heuristics on leftover text; never overrides an
    operator that already set the same field. Returns the final free text."""
    remaining = remaining.lower()

    if result.min_size is None and result.max_size is None:
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

    if result.since_days is None and result.after is None and result.before is None:
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
    for raw in remaining.split():
        word = raw.lstrip("-")  # keep a leading "-" (FTS exclusion) on the token
        if word in _TYPES and result.mime_prefix is None and result.ext is None:
            result.mime_prefix, result.ext = _TYPES[word]
            continue
        if word in _STOP:
            continue
        kept.append(raw)
    return " ".join(kept).strip()


def parse(query: str) -> ParsedQuery:
    result = ParsedQuery()
    quoted_parts: list[str] = []  # exact phrases — bypass NL heuristics
    bare_parts: list[str] = []  # run through the NL fallback

    for m in _TOKEN_RE.finditer(query.strip()):
        op_key_q, op_val_q, op_key, op_val, quoted, bare = m.groups()
        if op_key_q is not None and op_key_q.lower() in _KNOWN_OPS:
            _apply_operator(op_key_q, op_val_q, result)
        elif op_key is not None and op_key.lower() in _KNOWN_OPS:
            _apply_operator(op_key, op_val, result)
        elif quoted is not None:
            quoted_parts.append(f'"{quoted}"')  # preserve phrase quoting for FTS
        elif op_key_q is not None:  # unknown operator with quoted value → text
            bare_parts.append(f"{op_key_q}:{op_val_q}")
        elif op_key is not None:  # unknown "key:value" → text
            bare_parts.append(f"{op_key}:{op_val}")
        elif bare is not None:
            bare_parts.append(bare)

    nl_text = _apply_nl_fallback(" ".join(bare_parts), result)
    result.text = " ".join(p for p in (*quoted_parts, nl_text) if p).strip()
    return result
