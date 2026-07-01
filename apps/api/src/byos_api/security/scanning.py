"""Pluggable upload scanning.

A no-op scanner ships by default, so uploads work out of the box. A real
scanner (ClamAV, an AV API, or content inspection) implements the ``Scanner``
protocol and is installed via ``set_scanner`` at startup; the upload path calls
``scan_upload`` before persisting metadata and rejects anything not clean.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ScanResult:
    clean: bool
    reason: str | None = None


class Scanner(Protocol):
    async def scan(self, *, filename: str, size: int, mime: str | None) -> ScanResult: ...


class NoopScanner:
    """Default: accepts everything. Replace via set_scanner for real scanning."""

    async def scan(self, *, filename: str, size: int, mime: str | None) -> ScanResult:
        return ScanResult(clean=True)


_scanner: Scanner = NoopScanner()


def set_scanner(scanner: Scanner) -> None:
    global _scanner
    _scanner = scanner


async def scan_upload(*, filename: str, size: int, mime: str | None) -> ScanResult:
    return await _scanner.scan(filename=filename, size=size, mime=mime)
