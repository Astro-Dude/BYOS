"""Shared async Redis client (cache, rate limits, job broker)."""

from __future__ import annotations

from redis.asyncio import Redis

from byos_api.core.config import get_settings

redis_client: Redis = Redis.from_url(get_settings().redis_url, decode_responses=True)


async def get_redis() -> Redis:
    """FastAPI dependency returning the shared Redis client."""
    return redis_client
