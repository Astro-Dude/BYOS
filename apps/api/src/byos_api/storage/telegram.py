"""Telegram (MTProto) storage provider.

Stores file bytes as documents in the user's Saved Messages ("me"). The durable
locator persisted per version is {chat, message_id} — never a Telegram file_id
(those expire). A fresh reference is resolved by re-fetching the message on every
download.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import logging
import tempfile
from collections.abc import AsyncIterator

from telethon import TelegramClient
from telethon.errors import UnauthorizedError
from telethon.sessions import StringSession
from telethon.tl.types import DocumentAttributeFilename

from byos_api.storage.base import (
    AccessHandle,
    ProviderAccount,
    ProviderAuthError,
    ProviderObjectMeta,
    StoredObjectRef,
)

logger = logging.getLogger("byos")

# Saved Messages is the storage bucket for v1 (a dedicated private channel is a
# later refinement).
_BUCKET = "me"


class TelegramClientPool:
    """Caches connected Telethon clients keyed by session string. One pool lives
    per API worker process (and thus per asyncio event loop)."""

    def __init__(self, api_id: int, api_hash: str) -> None:
        self._api_id = api_id
        self._api_hash = api_hash
        self._clients: dict[str, TelegramClient] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, session: str) -> TelegramClient:
        client = self._clients.get(session)
        if client is not None and client.is_connected():
            return client
        async with self._lock:
            client = self._clients.get(session)
            if client is None:
                client = TelegramClient(StringSession(session), self._api_id, self._api_hash)
                self._clients[session] = client
            if not client.is_connected():
                await client.connect()
            return client

    async def release(self, session: str) -> None:
        """Evict + disconnect a single cached client (e.g. on provider disconnect)."""
        client = self._clients.pop(session, None)
        if client is not None and client.is_connected():
            try:
                await client.disconnect()
            except Exception:
                logger.warning("Error disconnecting released Telegram client", exc_info=True)

    async def shutdown(self) -> None:
        """Disconnect all cached clients (called on API shutdown)."""
        clients = list(self._clients.values())
        self._clients.clear()
        for client in clients:
            try:
                if client.is_connected():
                    await client.disconnect()
            except Exception:
                logger.warning("Error disconnecting Telegram client on shutdown", exc_info=True)


def _session_of(account: ProviderAccount) -> str:
    session = account.credentials.get("session")
    if not session:
        raise ValueError("Telegram provider account is missing its session credential")
    return session


async def _aclose_iter(download_iter: object) -> None:
    """Close a Telethon download iterator (releases any borrowed exported sender).
    Handles both sync and async close()/aclose()."""
    for name in ("aclose", "close"):
        fn = getattr(download_iter, name, None)
        if callable(fn):
            result = fn()
            if inspect.isawaitable(result):
                await result
            return


class TelegramStorageProvider:
    name = "telegram"

    def __init__(self, pool: TelegramClientPool) -> None:
        self._pool = pool

    async def release_session(self, session: str) -> None:
        await self._pool.release(session)

    async def shutdown(self) -> None:
        await self._pool.shutdown()

    async def _auth_failed(self, session: str, exc: UnauthorizedError) -> ProviderAuthError:
        # The stored auth key was revoked (user terminated their Telegram
        # sessions). Drop the dead pooled client so a later reconnect starts
        # clean, and surface a domain error the API turns into "sign in again".
        await self._pool.release(session)
        return ProviderAuthError("Telegram session is no longer authorized")

    async def upload(
        self,
        account: ProviderAccount,
        stream: AsyncIterator[bytes],
        *,
        filename: str,
        size: int,
        mime: str | None = None,
    ) -> StoredObjectRef:
        session = _session_of(account)
        client = await self._pool.acquire(session)
        hasher = hashlib.sha256()
        written = 0
        # Buffer to a temp file so we never hold the whole file in memory and
        # Telethon can chunk the upload from disk.
        with tempfile.NamedTemporaryFile() as tmp:
            async for chunk in stream:
                tmp.write(chunk)
                hasher.update(chunk)
                written += len(chunk)
            tmp.flush()
            try:
                message = await client.send_file(
                    _BUCKET,
                    tmp.name,
                    force_document=True,
                    caption=filename[:1024],
                    mime_type=mime,
                    attributes=[DocumentAttributeFilename(file_name=filename)],
                )
            except UnauthorizedError as exc:
                raise await self._auth_failed(session, exc) from exc
        return StoredObjectRef(
            provider=self.name,
            locator={
                "chat": _BUCKET,
                "message_id": message.id,
                "filename": filename,
                "mime": mime,
            },
            size=written,
            checksum=hasher.hexdigest(),
        )

    async def _fetch_message(self, client: TelegramClient, ref: StoredObjectRef, session: str):
        try:
            return await client.get_messages(ref.locator["chat"], ids=ref.locator["message_id"])
        except UnauthorizedError as exc:
            raise await self._auth_failed(session, exc) from exc

    async def download(
        self,
        account: ProviderAccount,
        ref: StoredObjectRef,
        *,
        byte_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        session = _session_of(account)
        client = await self._pool.acquire(session)
        message = await self._fetch_message(client, ref, session)
        if message is None or message.media is None:
            raise FileNotFoundError("Telegram message or media no longer exists")
        # v1 streams the whole object; HTTP Range support arrives with previews (Phase 6).
        download_iter = client.iter_download(message.media)
        try:
            async for chunk in download_iter:
                yield chunk
        except UnauthorizedError as exc:
            raise await self._auth_failed(session, exc) from exc
        finally:
            # Always release the borrowed (possibly cross-DC) exported sender,
            # even when the client aborts the stream mid-download.
            await _aclose_iter(download_iter)

    async def delete(self, account: ProviderAccount, ref: StoredObjectRef) -> None:
        session = _session_of(account)
        client = await self._pool.acquire(session)
        try:
            await client.delete_messages(ref.locator["chat"], [ref.locator["message_id"]])
        except UnauthorizedError as exc:
            raise await self._auth_failed(session, exc) from exc

    async def get_metadata(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> ProviderObjectMeta:
        session = _session_of(account)
        client = await self._pool.acquire(session)
        message = await self._fetch_message(client, ref, session)
        if message is None or message.media is None:
            return ProviderObjectMeta(size=0, mime=ref.locator.get("mime"), exists=False)
        document = getattr(message, "document", None)
        size = getattr(document, "size", 0) or 0
        mime = getattr(document, "mime_type", None) or ref.locator.get("mime")
        return ProviderObjectMeta(size=size, mime=mime, exists=True)

    async def exists(self, account: ProviderAccount, ref: StoredObjectRef) -> bool:
        session = _session_of(account)
        client = await self._pool.acquire(session)
        message = await self._fetch_message(client, ref, session)
        return message is not None and message.media is not None

    async def shareable_access(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> AccessHandle:
        # No public URL — BYOS proxies the download stream.
        return AccessHandle(kind="proxy")
