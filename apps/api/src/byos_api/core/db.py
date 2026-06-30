"""Async SQLAlchemy engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from byos_api.core.config import get_settings

_settings = get_settings()


def prepare_asyncpg(raw_url: str) -> tuple[URL, dict[str, Any]]:
    """Normalize a Postgres URL for SQLAlchemy + asyncpg.

    - Forces the ``postgresql+asyncpg`` driver.
    - Strips libpq-only query params (``sslmode``, ``channel_binding``) that the
      asyncpg driver rejects, and translates an SSL requirement into asyncpg's
      ``ssl`` connect arg (managed providers like Neon/Supabase append these).
    - For PgBouncer endpoints (Neon's ``-pooler`` host), disables asyncpg's
      prepared-statement cache, which is incompatible with transaction pooling.
    """
    url = make_url(raw_url)
    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    ssl_q = query.pop("ssl", None)
    query.pop("channel_binding", None)
    url = url.set(drivername="postgresql+asyncpg", query=query)

    connect_args: dict[str, Any] = {}
    ssl_required = sslmode in {"require", "verify-ca", "verify-full", "prefer", "allow"} or (
        ssl_q in {"require", "true", "1"}
    )
    if ssl_required:
        connect_args["ssl"] = "require"
    if "-pooler" in (url.host or ""):
        connect_args["statement_cache_size"] = 0
    return url, connect_args


_engine_url, _connect_args = prepare_asyncpg(_settings.database_url)
engine = create_async_engine(
    _engine_url, pool_pre_ping=True, future=True, connect_args=_connect_args
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a request-scoped async session."""
    async with SessionLocal() as session:
        yield session
