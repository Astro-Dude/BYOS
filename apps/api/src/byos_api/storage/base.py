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

import functools
import inspect
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, cast, runtime_checkable


class ProviderAuthError(Exception):
    """The provider rejected our stored credentials — e.g. the user terminated
    their Telegram sessions, revoking the auth key, or a GitHub token was
    revoked. The account must be reconnected before any storage operation can
    succeed. Callers map this to a clear "reconnect" response rather than a
    generic 500. `provider` says which one: only Telegram's means signing in
    again, since Telegram is also how users log in."""

    def __init__(
        self,
        message: str = "",
        *,
        provider: str = "telegram",
        revoked: bool = False,
        account_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        # The credentials themselves are dead (a token that expired or was
        # revoked, deleted keys), as opposed to valid ones missing a permission.
        # Only then is the storage flagged as needing to be reconnected.
        self.revoked = revoked
        # Which storage, so it can be flagged. Filled in by `tags_account`.
        self.account_id = account_id


class ProviderError(Exception):
    """The provider refused or failed an operation for a reason other than
    credentials (file too large, bucket missing, rate limited). The message is
    plain language, safe to show the user."""

    def __init__(self, message: str, *, provider: str, status: int = 502) -> None:
        super().__init__(message)
        self.provider = provider
        self.status = status


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


def tags_account[F: Callable[..., Any]](fn: F) -> F:
    """For provider methods taking the ProviderAccount first: stamp its id onto
    any ProviderAuthError on the way out, so the error handler knows which
    storage to flag. Works for coroutines and async generators (downloads)."""

    def stamp(exc: ProviderAuthError, account: Any) -> None:
        if exc.account_id is None and isinstance(account, ProviderAccount):
            exc.account_id = account.id

    if inspect.isasyncgenfunction(fn):

        @functools.wraps(fn)
        async def gen(self: Any, account: Any, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
            inner = fn(self, account, *args, **kwargs)
            try:
                async for item in inner:
                    yield item
            except ProviderAuthError as exc:
                stamp(exc, account)
                raise
            finally:
                await inner.aclose()

        return cast(F, gen)

    @functools.wraps(fn)
    async def call(self: Any, account: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            return await fn(self, account, *args, **kwargs)
        except ProviderAuthError as exc:
            stamp(exc, account)
            raise

    return cast(F, call)
