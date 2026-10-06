"""Which files an answer actually came from, and the words it took from them.

Searching returns several candidate files; most answers use one or two. The
agent is asked to end its answer with a line per file it relied on:

    [source: <file_id> | <a few words quoted exactly from that file>]

Those lines are stripped from the answer shown to the user. A quote is only
kept if it really is in that file's text (models paraphrase), so the viewer can
highlight it with confidence. When the model doesn't cite, the files are picked
by the facts the answer states (amounts, dates, ids) that appear in them.
"""

from __future__ import annotations

import re
from typing import Any

_CITE_RE = re.compile(
    r"^[ \t]*\[\s*source\s*:\s*(?P<id>[0-9a-fA-F-]{36})\s*(?:\|\s*(?P<quote>.*?))?\s*\][ \t]*$",
    re.MULTILINE | re.IGNORECASE,
)
# Numbers worth matching on: three or more digits, with the separators people
# write them with (84,500.00 · 30/06/2026 · EMP1234 is caught by _ID_RE).
_NUMBER_RE = re.compile(r"\d[\d,./-]*\d")
_ID_RE = re.compile(r"\b[A-Z]{2,}\d{3,}\b")
# A bare year helps tell files apart but is too common to be worth highlighting.
_YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")

MAX_QUOTES = 3
MAX_QUOTE_CHARS = 200


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def split(answer: str) -> tuple[str, list[tuple[str, str]]]:
    """The answer without its citation lines, and the (file id, quote) pairs."""
    cites = [
        (m.group("id").lower(), (m.group("quote") or "").strip().strip("\"'“”‘’"))
        for m in _CITE_RE.finditer(answer)
    ]
    clean = _CITE_RE.sub("", answer)
    # Tidy the gap the lines leave, and any "Sources:" heading left over.
    clean = re.sub(r"\n\s*(?:sources?|citations?)\s*:?\s*$", "", clean.rstrip(), flags=re.I)
    return clean.rstrip(), cites


def facts(answer: str) -> list[str]:
    """Figures the answer states, as written: amounts, dates, reference ids."""
    found: list[str] = []
    for m in [*_NUMBER_RE.finditer(answer), *_ID_RE.finditer(answer)]:
        value = m.group(0).strip(".,/-")
        if len(_digits(value)) >= 3 and value not in found:
            found.append(value)
    return found


def _in_text(fact: str, text: str) -> bool:
    if fact.lower() in text.lower():
        return True
    # 84500 vs 84,500.00: compare the digits, allowing the trailing ".00".
    digits = _digits(fact)
    flat = _digits(text)
    return len(digits) >= 4 and digits in flat


def quotes_for(answer: str, text: str | None) -> list[str]:
    """The answer's figures that appear in a file's text, to highlight there."""
    return _markable([f for f in facts(answer) if _in_text(f, text or "")])


def _markable(found: list[str]) -> list[str]:
    return [f for f in found if not _YEAR_RE.match(f)][:MAX_QUOTES]


def _verified(quote: str, text: str) -> list[str]:
    """The quote if it's really in the text; else the figures in it that are."""
    if not quote:
        return []
    quote = quote[:MAX_QUOTE_CHARS]
    if _norm(quote) in _norm(text):
        return [quote]
    return [f for f in facts(quote) if _in_text(f, text)]


def pick(
    answer: str,
    cites: list[tuple[str, str]],
    texts: dict[str, str],
    names: dict[str, str],
    order: list[str],
) -> list[dict[str, Any]]:
    """The sources to show: `{id, name, quotes}`, most relevant first.

    `texts` is what the agent read from each candidate file, `order` the order
    they came up in (search ranks the likeliest first)."""
    if cites:
        picked: dict[str, list[str]] = {}
        for fid, quote in cites:
            if fid not in names:
                continue  # an id the model made up, or one it never read
            quotes = picked.setdefault(fid, [])
            for q in _verified(quote, texts.get(fid, "")):
                if q not in quotes and len(quotes) < MAX_QUOTES:
                    quotes.append(q)
        if picked:
            return [{"id": fid, "name": names[fid], "quotes": q} for fid, q in picked.items()]

    stated = facts(answer)
    if not stated:
        # Nothing to match on (a summary, say): the top search result.
        return [{"id": order[0], "name": names[order[0]], "quotes": []}] if order else []
    scored = []
    for fid in order:
        found = [f for f in stated if _in_text(f, texts.get(fid, ""))]
        if found:
            scored.append((len(found), fid, _markable(found)))
    if not scored:
        return []  # the figures didn't come from any file it read
    best = max(score for score, _, _ in scored)
    return [
        {"id": fid, "name": names[fid], "quotes": found}
        for score, fid, found in scored
        if score == best
    ]
