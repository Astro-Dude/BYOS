"""Shared HTTP streaming for stored objects.

Primes the first chunk so provider errors (missing object, rate limit) surface
as a real status code instead of a truncated body under an already-sent 200.
Used by file downloads, alias resolution, version downloads, and share links.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse

from byos_api.storage import ProviderAccount, StorageProvider, StoredObjectRef


async def _aclose(stream: AsyncIterator[bytes]) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


async def stream_object(
    provider: StorageProvider,
    account: ProviderAccount,
    ref: StoredObjectRef,
    *,
    filename: str,
    mime: str | None,
    disposition: str = "attachment",
) -> StreamingResponse:
    from telethon.errors import FloodWaitError

    stream = provider.download(account, ref)
    try:
        first_chunk = await stream.__anext__()
        exhausted = False
    except StopAsyncIteration:
        first_chunk, exhausted = b"", True
    except FileNotFoundError:
        await _aclose(stream)
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "File content no longer exists in the provider"
        ) from None
    except FloodWaitError as exc:
        await _aclose(stream)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, f"Telegram rate limit — retry in {exc.seconds}s"
        ) from exc

    async def body() -> AsyncIterator[bytes]:
        if not exhausted:
            yield first_chunk
        async for chunk in stream:
            yield chunk

    return StreamingResponse(
        body(),
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )
