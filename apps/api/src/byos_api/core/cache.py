"""Best-effort Redis JSON cache.

``cached_json`` returns a cached value if present, otherwise runs ``producer``,
stores its result, and returns it. Any Redis failure (server down, timeout)
degrades to calling ``producer`` directly — the cache is a pure optimization,
never a hard dependency, so the API works identically with Redis absent.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from byos_api.core.redis import redis_client

logger = logging.getLogger("byos.cache")


async def cached_json(key: str, ttl: int, producer: Callable[[], Awaitable[Any]]) -> Any:
    try:
        raw = await redis_client.get(key)
        if raw is not None:
            return json.loads(raw)
    except Exception:
        logger.debug("cache read failed for %s", key, exc_info=True)

    value = await producer()

    try:
        await redis_client.set(key, json.dumps(value), ex=ttl)
    except Exception:
        logger.debug("cache write failed for %s", key, exc_info=True)
    return value


async def invalidate(*keys: str) -> None:
    try:
        if keys:
            await redis_client.delete(*keys)
    except Exception:
        logger.debug("cache invalidate failed", exc_info=True)
