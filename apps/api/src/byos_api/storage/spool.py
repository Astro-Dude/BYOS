"""Buffer an upload stream to learn its size and hash before sending it on.

GitHub and S3 both want the length up front (and S3 multipart wants a seekable
file), but uploads arrive as a stream. Small files stay in memory; bigger ones
spill to a temp file on disk, so a 2 GB upload doesn't sit in RAM.
"""

from __future__ import annotations

import hashlib
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import IO

_IN_MEMORY = 8 * 1024 * 1024
_CHUNK = 1024 * 1024


@dataclass
class Spooled:
    file: IO[bytes]
    size: int
    sha256: str

    async def chunks(self) -> AsyncIterator[bytes]:
        self.file.seek(0)
        while data := self.file.read(_CHUNK):
            yield data

    def close(self) -> None:
        self.file.close()


async def spool(stream: AsyncIterator[bytes]) -> Spooled:
    fh = tempfile.SpooledTemporaryFile(max_size=_IN_MEMORY)  # noqa: SIM115 - caller closes
    hasher = hashlib.sha256()
    size = 0
    async for chunk in stream:
        fh.write(chunk)
        hasher.update(chunk)
        size += len(chunk)
    fh.seek(0)
    return Spooled(file=fh, size=size, sha256=hasher.hexdigest())
