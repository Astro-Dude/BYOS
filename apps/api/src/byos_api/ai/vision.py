"""Vision transcription — read the content our text extractor can't see.

Scanned PDF pages and standalone images carry no text layer, so ``extract``
returns nothing for them and the file drops out of semantic search entirely. Here
we render those pages to PNG and ask the user's own (multimodal) BYOK model to
transcribe them. The result re-enters the pipeline as ordinary chunk text, so
embedding, cosine ranking and citations need no changes at all.

Cost lands on the user's key, so the trigger is deliberately narrow:

* only pages whose text layer is empty (``extract.sparse_pages``) — a text-native
  PDF costs nothing, even when it's full of figures;
* at most ``ai_vision_max_pages`` pages per file, and we log what that skipped;
* the first refusal stops the file — a non-multimodal model shouldn't burn twenty
  requests to fail twenty times.

This runs at indexing time only (``/ai/index``, or the lazy single-file index
behind retrieval chat), never on upload.
"""

from __future__ import annotations

import asyncio
import io
import logging

from byos_api.ai import extract, llm
from byos_api.core import crypto
from byos_api.core.config import get_settings
from byos_api.db.models import AiKey

logger = logging.getLogger("byos.ai.vision")

# ~144 DPI. Enough for body text and most footnotes; high enough resolutions cost
# more tokens per page without transcribing any better.
_RENDER_SCALE = 2.0

# Independent of the key's `max_tokens` (tuned for chat answers) — a dense page
# needs room, and truncating a transcription mid-page corrupts the chunk.
_MAX_TOKENS = 4096

# Providers cap inline image payloads (Anthropic ~5 MB); skip rather than fail.
_MAX_IMAGE_BYTES = 5 * 1024 * 1024

_PROMPT = (
    "Transcribe all text in this page image, in reading order, as plain Markdown. "
    "Preserve headings, lists and table structure. Describe any figure or chart "
    "briefly in [square brackets]. Output only the transcription — no preamble, "
    "no commentary. If the page has no legible text, output nothing."
)


def enabled() -> bool:
    return get_settings().ai_vision_ocr


def _mime_for(mime: str | None, ext: str | None) -> str:
    m = (mime or "").lower()
    if m in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
        return m
    e = (ext or "").lower()
    return "image/jpeg" if e in {"jpg", "jpeg"} else f"image/{e or 'png'}"


def _render(data: bytes, indexes: list[int]) -> dict[int, bytes]:
    """Render selected PDF pages to PNG bytes. Synchronous and CPU-bound — always
    called via ``asyncio.to_thread`` so it can't stall the event loop (the API
    runs a single worker in production)."""
    import pypdfium2 as pdfium

    out: dict[int, bytes] = {}
    doc = pdfium.PdfDocument(data)
    try:
        for i in indexes:
            if i >= len(doc):
                continue
            buffer = io.BytesIO()
            doc[i].render(scale=_RENDER_SCALE).to_pil().save(buffer, format="PNG")
            out[i] = buffer.getvalue()
    finally:
        doc.close()
    return out


async def _ask(key: AiKey, image: bytes, mime: str) -> str:
    return await llm.vision(
        base_url=key.base_url,
        api_key=crypto.decrypt(key.encrypted_api_key),
        model=key.model,
        image=image,
        mime=mime,
        prompt=_PROMPT,
        max_tokens=_MAX_TOKENS,
    )


async def transcribe_image(key: AiKey, data: bytes, mime: str | None, ext: str | None) -> str:
    """Transcribe a standalone image. '' if disabled, oversized, or the model
    can't read images."""
    if not enabled() or len(data) > _MAX_IMAGE_BYTES:
        return ""
    try:
        return await _ask(key, data, _mime_for(mime, ext))
    except llm.LLMError as exc:
        logger.info("vision transcription unavailable for image: %s", exc)
        return ""


async def transcribe_pdf(key: AiKey, data: bytes, pages: list[str]) -> list[str]:
    """Fill in the pages of `pages` that have no text layer with a transcription
    of their rendered image. Returns a new page list; pages we couldn't or
    wouldn't transcribe keep whatever text they already had."""
    if not enabled():
        return pages
    sparse = extract.sparse_pages(pages)
    if not sparse:
        return pages
    cap = max(0, get_settings().ai_vision_max_pages)
    targets, skipped = sparse[:cap], sparse[cap:]
    if skipped:
        logger.warning(
            "vision cap reached: transcribing %d of %d text-less pages, skipping %d "
            "(raise AI_VISION_MAX_PAGES to cover the rest)",
            len(targets),
            len(sparse),
            len(skipped),
        )
    if not targets:
        return pages
    try:
        images = await asyncio.to_thread(_render, data, targets)
    except Exception as exc:  # a malformed or encrypted PDF shouldn't fail the index
        logger.info("couldn't render PDF pages for transcription: %s", exc)
        return pages

    filled = list(pages)
    for index, png in images.items():
        try:
            text = await _ask(key, png, "image/png")
        except llm.LLMError as exc:
            # Stop at the first refusal — most likely a model that isn't
            # multimodal, and retrying every page would just repeat the charge.
            logger.info("vision transcription stopped at page %d: %s", index + 1, exc)
            break
        if text:
            filled[index] = text
    return filled
