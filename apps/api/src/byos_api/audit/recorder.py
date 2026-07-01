"""Audit-event capture.

``record`` appends on an isolated session and never raises — an auditing
failure must not break the action being audited. IP is stored only as a salted
one-way hash, matching the analytics recorder.
"""

from __future__ import annotations

import hashlib
import logging
import uuid

from fastapi import Request

from byos_api.core.config import get_settings
from byos_api.core.db import SessionLocal
from byos_api.core.ratelimit import client_ip
from byos_api.db.models import AuditLog

logger = logging.getLogger("byos.audit")
_settings = get_settings()


def _hash_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    ip = client_ip(request)
    if not ip or ip == "unknown":
        return None
    return hashlib.sha256(f"{ip}:{_settings.jwt_secret_key}".encode()).hexdigest()[:64]


async def record(
    user_id: uuid.UUID,
    action: str,
    *,
    request: Request | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id[:120] if target_id else None,
        ip_hash=_hash_ip(request),
    )
    try:
        async with SessionLocal() as session:
            session.add(entry)
            await session.commit()
    except Exception:
        logger.debug("audit event dropped: %s", action, exc_info=True)
