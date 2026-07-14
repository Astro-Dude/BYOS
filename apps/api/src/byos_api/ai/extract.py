"""Extract plain text from a file's bytes so BYOM features (summarize / chat)
have something to send to the model. Text-based formats only — scanned/image
PDFs and binary formats yield little or nothing."""

from __future__ import annotations

import io

# Extensions we treat as UTF-8-ish text (mirrors the preview modal's list).
_TEXT_EXT = {
    "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "rs",
    "java", "kt", "c", "cpp", "cc", "h", "hpp", "cs", "rb", "php", "swift", "css", "scss", "sass",
    "html", "htm", "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "sh", "bash", "zsh", "sql",
    "log", "csv", "tsv", "env",
}

# Cap extracted text so prompts stay within typical context windows (~30k tokens).
MAX_CHARS = 120_000


def is_extractable(mime: str | None, ext: str | None) -> bool:
    m = (mime or "").lower()
    e = (ext or "").lower()
    if m == "application/pdf" or e == "pdf":
        return True
    return (
        m.startswith("text/")
        or m in {"application/json", "application/xml"}
        or "javascript" in m
        or e in _TEXT_EXT
    )


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue  # skip pages that fail to parse
    return "\n".join(parts)


def extract_text(data: bytes, mime: str | None, ext: str | None) -> str:
    """Return extracted text (truncated to MAX_CHARS), or '' if unsupported."""
    m = (mime or "").lower()
    e = (ext or "").lower()
    if m == "application/pdf" or e == "pdf":
        text = _pdf_text(data)
    elif is_extractable(mime, ext):
        text = data.decode("utf-8", errors="replace")
    else:
        text = ""
    return text[:MAX_CHARS].strip()
