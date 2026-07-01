"""Redis fixed-window rate limiting.

``rate_limit`` fails **open**: if Redis is unavailable the request is allowed,
so an outage degrades throughput protection but never takes the API down. Use
``limit(...)`` as a route dependency to cap requests per client IP.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, Request, status

from byos_api.core.redis import redis_client

logger = logging.getLogger("byos.ratelimit")


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit(key: str, limit_count: int, window_seconds: int) -> bool:
    """Return True if the request is within the limit, False if it exceeds it."""
    try:
        redis_key = f"rl:{key}"
        count = await redis_client.incr(redis_key)
        if count == 1:
            await redis_client.expire(redis_key, window_seconds)
        return count <= limit_count
    except Exception:
        logger.debug("rate-limit check failed for %s — allowing", key, exc_info=True)
        return True  # fail open


def limit(prefix: str, limit_count: int, window_seconds: int):
    async def dependency(request: Request) -> None:
        key = f"{prefix}:{client_ip(request)}"
        if not await rate_limit(key, limit_count, window_seconds):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests — please slow down.",
            )

    return dependency
