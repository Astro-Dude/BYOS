"""Provider-agnostic storage interface.

Every storage backend (Telegram, Local, future Google Drive / S3 / R2 …)
implements this Protocol. The rest of the app only ever sees a `StoredObjectRef`
— an opaque, durable, provider-specific locator — so nothing above this layer
depends on which provider holds the bytes.

`replace` is intentionally NOT part of the interface: most providers are
append-only/immutable (Telegram included), so the metadata engine implements
"replace" as upload-new → create a file_version → atomically flip the file's
current_version_id → optionally delete the old object.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class ProviderAccount:
    """Resolved, DECRYPTED credentials + config handed to a provider at call time.
    Built from a `storage_accounts` row; never persisted in this form."""

    provider: str
    id: str | None = None
    credentials: dict[str, Any] = field(default_factory=dict)
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StoredObjectRef:
    """The durable reference persisted in `file_versions.provider_locator`.
    `locator` is opaque to the app (e.g. Telegram: {chat_id, message_id})."""

    provider: str
    locator: dict[str, Any]
    size: int
    checksum: str | None = None


@dataclass(frozen=True)
class ProviderObjectMeta:
    size: int
    mime: str | None = None
    exists: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AccessHandle:
    """How a client should fetch bytes. Providers with no public URL (Telegram)
    return kind='proxy' (BYOS streams through its own endpoint). Providers that
    can mint a signed URL return kind='url'."""

    kind: str  # "proxy" | "url"
    url: str | None = None


@runtime_checkable
class StorageProvider(Protocol):
    name: str

    async def upload(
        self,
        account: ProviderAccount,
        stream: AsyncIterator[bytes],
        *,
        filename: str,
        size: int,
        mime: str | None = None,
    ) -> StoredObjectRef: ...

    # Not `async def`: implementations are async generators, so calling this
    # returns an AsyncIterator directly (consumed with `async for`, no await).
    def download(
        self,
        account: ProviderAccount,
        ref: StoredObjectRef,
        *,
        byte_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]: ...

    async def delete(self, account: ProviderAccount, ref: StoredObjectRef) -> None: ...

    async def get_metadata(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> ProviderObjectMeta: ...

    async def exists(self, account: ProviderAccount, ref: StoredObjectRef) -> bool: ...

    async def shareable_access(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> AccessHandle: ...
