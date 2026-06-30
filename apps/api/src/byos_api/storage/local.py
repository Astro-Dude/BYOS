"""Local filesystem provider — a stub that proves the StorageProvider pipeline
end-to-end before Telegram exists. Writes bytes under a base directory (a Docker
volume in dev). The durable locator is simply the relative object key."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from byos_api.storage.base import (
    AccessHandle,
    ProviderAccount,
    ProviderObjectMeta,
    StoredObjectRef,
)

_CHUNK = 256 * 1024


class LocalStorageProvider:
    name = "local"

    def __init__(self, base_dir: str = ".data/local") -> None:
        self.base = Path(base_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, ref: StoredObjectRef) -> Path:
        return self.base / ref.locator["key"]

    async def upload(
        self,
        account: ProviderAccount,
        stream: AsyncIterator[bytes],
        *,
        filename: str,
        size: int,
        mime: str | None = None,
    ) -> StoredObjectRef:
        key = uuid.uuid4().hex
        dest = self.base / key
        hasher = hashlib.sha256()
        written = 0
        with dest.open("wb") as fh:
            async for chunk in stream:
                fh.write(chunk)
                hasher.update(chunk)
                written += len(chunk)
        return StoredObjectRef(
            provider=self.name,
            locator={"key": key, "filename": filename, "mime": mime},
            size=written,
            checksum=hasher.hexdigest(),
        )

    async def download(
        self,
        account: ProviderAccount,
        ref: StoredObjectRef,
        *,
        byte_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        path = self._path(ref)
        with path.open("rb") as fh:
            if byte_range is None:
                while data := fh.read(_CHUNK):
                    yield data
            else:
                start, end = byte_range  # inclusive, HTTP Range semantics
                fh.seek(start)
                remaining = end - start + 1
                while remaining > 0 and (data := fh.read(min(_CHUNK, remaining))):
                    remaining -= len(data)
                    yield data

    async def delete(self, account: ProviderAccount, ref: StoredObjectRef) -> None:
        self._path(ref).unlink(missing_ok=True)

    async def get_metadata(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> ProviderObjectMeta:
        path = self._path(ref)
        if not path.exists():
            return ProviderObjectMeta(size=0, mime=ref.locator.get("mime"), exists=False)
        return ProviderObjectMeta(
            size=path.stat().st_size, mime=ref.locator.get("mime"), exists=True
        )

    async def exists(self, account: ProviderAccount, ref: StoredObjectRef) -> bool:
        return self._path(ref).exists()

    async def shareable_access(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> AccessHandle:
        # No public URL — BYOS proxies the download (enables auth + analytics + range).
        return AccessHandle(kind="proxy")
