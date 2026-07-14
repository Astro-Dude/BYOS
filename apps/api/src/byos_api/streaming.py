"""Shared HTTP streaming for stored objects.

Primes the first chunk so provider errors (missing object, rate limit) surface
as a real status code instead of a truncated body under an already-sent 200.
Used by file downloads, alias resolution, version downloads, and share links.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import HTTPException, Request, status
from fastapi.responses import Response, StreamingResponse

from byos_api.storage import ProviderAccount, StorageProvider, StoredObjectRef
from byos_api.storage.base import ProviderAuthError

logger = logging.getLogger("byos")


async def _aclose(stream: AsyncIterator[bytes]) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


def _cache_headers(etag: str | None) -> dict[str, str]:
    # Content is addressed by hash, so an unchanged body always revalidates to a
    # 304. max-age=0 + must-revalidate keeps zero staleness (a replaced file gets
    # a new hash → new ETag) while still sparing the body on repeat downloads.
    headers = {"Cache-Control": "private, max-age=0, must-revalidate"}
    if etag:
        headers["ETag"] = f'"{etag}"'
    return headers


def _matches_etag(request: Request | None, etag: str | None) -> bool:
    if not etag or request is None:
        return False
    header = request.headers.get("if-none-match")
    if not header:
        return False
    return any(tag.strip().strip('"') == etag for tag in header.split(","))


async def stream_object(
    provider: StorageProvider,
    account: ProviderAccount,
    ref: StoredObjectRef,
    *,
    filename: str,
    mime: str | None,
    disposition: str = "attachment",
    etag: str | None = None,
    request: Request | None = None,
    on_missing: Callable[[], Awaitable[None]] | None = None,
) -> Response:
    from telethon.errors import FloodWaitError

    # Conditional GET: the client already holds this exact content.
    if _matches_etag(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=_cache_headers(etag))

    stream = provider.download(account, ref)
    try:
        first_chunk = await stream.__anext__()
        exhausted = False
    except StopAsyncIteration:
        first_chunk, exhausted = b"", True
    except FileNotFoundError:
        await _aclose(stream)
        if on_missing is not None:
            await on_missing()  # flag the record as gone-from-provider
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "File content no longer exists in the provider"
        ) from None
    except FloodWaitError as exc:
        await _aclose(stream)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, f"Telegram rate limit — retry in {exc.seconds}s"
        ) from exc
    except ProviderAuthError:
        await _aclose(stream)
        raise  # → global handler → 409 "sign in again to reconnect"
    except Exception as exc:
        # Anything else (malformed locator, unexpected provider error) — log the
        # real cause and return a clear message instead of a bare 500.
        await _aclose(stream)
        logger.exception("stream_object: failed to fetch %r from provider", filename)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't load this file from its storage provider. It may be corrupted "
            "or was uploaded incompletely.",
        ) from exc

    async def body() -> AsyncIterator[bytes]:
        if not exhausted:
            yield first_chunk
        async for chunk in stream:
            yield chunk

    headers = {"Content-Disposition": f'{disposition}; filename="{filename}"'}
    headers.update(_cache_headers(etag))
    return StreamingResponse(
        body(),
        media_type=mime or "application/octet-stream",
        headers=headers,
    )
