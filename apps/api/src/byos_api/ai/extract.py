"""Extract plain text from a file's bytes so BYOM features (summarize / chat)
have something to send to the model. Text-based formats are read directly here;
content with no text layer at all — scanned PDF pages, standalone images — comes
back empty and is handled by ``ai.vision``, which transcribes it instead."""

from __future__ import annotations

import io

from byos_api.core.config import get_settings

# Extensions we treat as UTF-8-ish text (mirrors the preview modal's list).
_TEXT_EXT = {
    "txt",
    "md",
    "markdown",
    "json",
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "py",
    "go",
    "rs",
    "java",
    "kt",
    "c",
    "cpp",
    "cc",
    "h",
    "hpp",
    "cs",
    "rb",
    "php",
    "swift",
    "css",
    "scss",
    "sass",
    "html",
    "htm",
    "xml",
    "svg",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "sh",
    "bash",
    "zsh",
    "sql",
    "log",
    "csv",
    "tsv",
    "env",
}

# Raster formats the OpenAI-compatible multimodal `image_url` part accepts across
# providers. Deliberately narrow: tiff/bmp/heic would be rejected downstream, so
# claiming them here would only produce files that look indexable and never are.
_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
_IMAGE_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp"}

# Characters to drop from anything we extract. NUL is the important one: PDF text
# extraction emits it routinely (a real e-Aadhaar yielded 13), and Postgres text
# columns reject it outright — asyncpg raises CharacterNotInRepertoireError, the
# chunk insert fails, and the whole file gets reported as unreadable. The other C0
# controls and DEL only garble a chunk, so they go too. Tab/newline/CR stay.
_STRIP_CHARS: dict[int, None] = {c: None for c in range(32) if c not in (9, 10, 13)}
_STRIP_CHARS[127] = None


def clean_text(text: str) -> str:
    """Remove characters that can't be stored (NUL) or add nothing (C0/DEL)."""
    return text.translate(_STRIP_CHARS)


# Cap extracted text so prompts stay within typical context windows (~30k tokens).
MAX_CHARS = 120_000

# Below this many characters we treat a PDF page's text layer as absent rather
# than short. Tuned to sit above page furniture (a header, a folio, a caption)
# and below any page of real prose.
MIN_PAGE_CHARS = 80


class EncryptedPdf(Exception):
    """A PDF that needs a password we don't hold.

    Common for documents people actually store: e-Aadhaar, bank and card
    statements, payslips from some providers. Neither pypdf nor pypdfium2 can open
    one, so vision transcription can't rescue it either — it has to be reported.
    """


def is_pdf(mime: str | None, ext: str | None) -> bool:
    return (mime or "").lower() == "application/pdf" or (ext or "").lower() == "pdf"


def is_image(mime: str | None, ext: str | None) -> bool:
    """A raster image we could send to a vision model. SVG is excluded on
    purpose — it's XML, so the text path already reads it as source."""
    m = (mime or "").lower()
    e = (ext or "").lower()
    if m == "image/svg+xml" or e == "svg":
        return False
    return m in _IMAGE_MIME or e in _IMAGE_EXT


def is_extractable(mime: str | None, ext: str | None) -> bool:
    """Whether we can get text out of this file at all. Gates both the index
    target list and the "indexed / total" counter, so it has to describe real
    capability: images are only readable when vision transcription is on."""
    m = (mime or "").lower()
    e = (ext or "").lower()
    if is_pdf(mime, ext):
        return True
    if is_image(mime, ext):
        return get_settings().ai_vision_ocr
    return (
        m.startswith("text/")
        or m in {"application/json", "application/xml"}
        or "javascript" in m
        or e in _TEXT_EXT
    )


def pdf_pages(data: bytes) -> list[str]:
    """Per-page text from a PDF. A page that carries no text layer (or fails to
    parse) comes back as ''. Kept per-page rather than joined so callers can tell
    which pages are scanned and transcribe just those.

    Raises EncryptedPdf when the file needs a password."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted and not reader.decrypt(""):
        # Plenty of PDFs are "encrypted" only to restrict printing/copying and
        # open with an empty user password. A falsy result means this one really
        # does need a password.
        raise EncryptedPdf
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(clean_text(page.extract_text() or "").strip())
        except Exception:
            pages.append("")  # skip pages that fail to parse
    return pages


def sparse_pages(pages: list[str], *, minimum: int = MIN_PAGE_CHARS) -> list[int]:
    """Indexes of pages whose text layer is empty or near-empty — the scanned or
    image-only pages a text extractor can't see. A heuristic, not proof: a page
    holding just a full-bleed figure looks identical to a scan."""
    return [i for i, text in enumerate(pages) if len(text) < minimum]


def join_pages(pages: list[str], *, limit: int = MAX_CHARS) -> str:
    return "\n\n".join(p for p in pages if p)[:limit].strip()


def extract_text(data: bytes, mime: str | None, ext: str | None, *, limit: int = MAX_CHARS) -> str:
    """Return extracted text (truncated to `limit`), or '' if unsupported.
    Retrieval mode passes a much larger limit so the whole doc can be chunked."""
    if is_pdf(mime, ext):
        return join_pages(pdf_pages(data), limit=limit)
    if is_image(mime, ext):
        return ""  # no text layer to read — ai.vision transcribes these
    if is_extractable(mime, ext):
        return clean_text(data.decode("utf-8", errors="replace")[:limit]).strip()
    return ""
