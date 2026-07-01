"""Pluggable auto-tagging.

The default ``HeuristicTagger`` derives a coarse type tag (image, video, audio,
document, spreadsheet, archive, code) from mime/extension — enough to auto-group
uploads with zero dependencies. A model-backed tagger (OCR keywords, image
recognition/labels) implements the ``Tagger`` protocol and is installed via
``set_tagger``; the upload path calls ``suggest_tags`` after storing a file.
"""

from __future__ import annotations

from typing import Protocol

_DOC_EXTS = {"doc", "docx", "txt", "md", "rtf", "odt", "pages"}
_SHEET_EXTS = {"xls", "xlsx", "csv", "ods", "numbers"}
_ARCHIVE_EXTS = {"zip", "tar", "gz", "rar", "7z", "bz2"}
_CODE_EXTS = {
    "py", "js", "ts", "tsx", "jsx", "go", "rs", "java",
    "c", "cpp", "rb", "sh", "json", "yaml", "yml",
}


class Tagger(Protocol):
    def suggest(self, *, filename: str, mime: str | None, ext: str | None) -> list[str]: ...


class HeuristicTagger:
    def suggest(self, *, filename: str, mime: str | None, ext: str | None) -> list[str]:
        m = (mime or "").lower()
        e = (ext or "").lower()
        if m.startswith("image/"):
            return ["image"]
        if m.startswith("video/"):
            return ["video"]
        if m.startswith("audio/"):
            return ["audio"]
        if m == "application/pdf" or e == "pdf":
            return ["document"]
        # Extension-specific categories win over the broad text/* document catch,
        # so e.g. a .py served as text/x-python tags as "code", not "document".
        if e in _CODE_EXTS:
            return ["code"]
        if e in _SHEET_EXTS or "spreadsheet" in m or "excel" in m:
            return ["spreadsheet"]
        if e in _ARCHIVE_EXTS:
            return ["archive"]
        if e in _DOC_EXTS or m.startswith("text/") or "word" in m:
            return ["document"]
        return []


_tagger: Tagger = HeuristicTagger()


def set_tagger(tagger: Tagger) -> None:
    global _tagger
    _tagger = tagger


def suggest_tags(*, filename: str, mime: str | None, ext: str | None) -> list[str]:
    return _tagger.suggest(filename=filename, mime=mime, ext=ext)
