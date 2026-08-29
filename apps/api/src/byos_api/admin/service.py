"""Platform-wide analytics for admins.

Everything here aggregates across *all* users, which is exactly why the router
guards it with `require_admin`. The per-account rollups the sidebar uses live in
`analytics` and are scoped to the caller.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.config import get_settings
from byos_api.db.models import (
    AiConversation,
    AiFileChunk,
    AiKey,
    Alias,
    ApiKey,
    File,
    Folder,
    Share,
    User,
    Webhook,
)

_DIGITS = re.compile(r"\D")

# How far back the daily series reach.
WINDOW_DAYS = 30


def is_bootstrap_admin(user: User) -> bool:
    """Whether `ADMIN_IDS` names this user.

    This is the break-glass path, not the admin list. It exists so the first
    admin can always get in — including on a fresh database where nobody has the
    flag yet, and after an accidental self-revoke. Matches the Telegram id or the
    phone number, compared digits-only and by suffix, so "7992214793" matches a
    stored "+917992214793" without anyone needing to know the storage format.
    """
    ids = get_settings().admin_id_set
    if not ids:
        return False
    if user.telegram_user_id is not None and str(user.telegram_user_id) in ids:
        return True
    if user.phone:
        digits = _DIGITS.sub("", user.phone)
        return any(candidate and digits.endswith(candidate) for candidate in ids)
    return False


def is_admin(user: User) -> bool:
    """Whether this user may see platform analytics and manage other admins.

    The database flag is the managed list; the env bootstrap is the escape hatch.
    Either grants access, so revoking the bootstrap account's flag doesn't lock it
    out — deliberate, since that account is the recovery path.
    """
    return bool(user.is_admin) or is_bootstrap_admin(user)


async def list_admins(db: AsyncSession) -> list[dict[str, Any]]:
    """Everyone with the flag, plus whoever the bootstrap names.

    The bootstrap account is included even without the flag, because it *is* an
    admin in practice — a list that omitted it would be lying about who has
    access.
    """
    rows = list(
        (await db.execute(select(User).where(User.is_admin.is_(True)).order_by(User.created_at)))
        .scalars()
        .all()
    )
    seen = {r.id for r in rows}
    if get_settings().admin_id_set:
        for u in (await db.execute(select(User))).scalars().all():
            if u.id not in seen and is_bootstrap_admin(u):
                rows.append(u)
    return [
        {
            "id": u.id,
            "username": u.username,
            "phone": u.phone,
            "granted": bool(u.is_admin),
            "bootstrap": is_bootstrap_admin(u),
        }
        for u in rows
    ]


async def find_user(db: AsyncSession, identifier: str) -> User | None:
    """Look someone up by username or phone.

    Phone matching is digits-only by suffix for the same reason as the bootstrap:
    an admin typing "9876543210" shouldn't have to know it's stored E.164.
    """
    ident = identifier.strip().lstrip("@")
    if not ident:
        return None
    found = (
        await db.execute(select(User).where(func.lower(User.username) == ident.lower()))
    ).scalar_one_or_none()
    if found is not None:
        return found
    digits = _DIGITS.sub("", ident)
    if not digits:
        return None
    for u in (await db.execute(select(User).where(User.phone.is_not(None)))).scalars().all():
        if _DIGITS.sub("", u.phone or "").endswith(digits):
            return u
    return None


async def set_admin(db: AsyncSession, user: User, granted: bool) -> None:
    user.is_admin = granted
    await db.commit()


async def _scalar(db: AsyncSession, stmt: Any) -> int:
    return int((await db.execute(stmt)).scalar() or 0)


async def _daily(db: AsyncSession, table: str, column: str = "created_at") -> list[dict[str, Any]]:
    """Rows per day for the window, zero-filled.

    `generate_series` does the filling in Postgres rather than in Python: a gap in
    the data would otherwise silently compress the x-axis and make a quiet week
    look like a busy one.
    """
    rows = (
        await db.execute(
            text(
                f"""
                WITH days AS (
                    SELECT generate_series(
                        (now() AT TIME ZONE 'utc')::date - INTERVAL '{WINDOW_DAYS - 1} days',
                        (now() AT TIME ZONE 'utc')::date,
                        INTERVAL '1 day'
                    )::date AS day
                )
                SELECT days.day::text AS day, COUNT(t.{column}) AS n
                FROM days
                LEFT JOIN {table} t ON (t.{column} AT TIME ZONE 'utc')::date = days.day
                GROUP BY days.day
                ORDER BY days.day
                """  # noqa: S608 — table/column are module constants, never user input
            )
        )
    ).all()
    return [{"day": r.day, "value": int(r.n)} for r in rows]


async def platform_stats(db: AsyncSession) -> dict[str, Any]:
    totals = {
        "users": await _scalar(db, select(func.count()).select_from(User)),
        "files": await _scalar(db, select(func.count()).select_from(File)),
        "folders": await _scalar(db, select(func.count()).select_from(Folder)),
        "bytes": await _scalar(db, select(func.coalesce(func.sum(File.size), 0))),
        "aliases": await _scalar(db, select(func.count()).select_from(Alias)),
        "shares": await _scalar(db, select(func.count()).select_from(Share)),
        "api_keys": await _scalar(db, select(func.count()).select_from(ApiKey)),
        "webhooks": await _scalar(db, select(func.count()).select_from(Webhook)),
        "ai_keys": await _scalar(db, select(func.count()).select_from(AiKey)),
        "conversations": await _scalar(db, select(func.count()).select_from(AiConversation)),
        "indexed_chunks": await _scalar(db, select(func.count()).select_from(AiFileChunk)),
    }

    # Composition by extension — the long tail is folded into "other" so the
    # waffle always sums to the real total.
    ext_rows = (
        await db.execute(
            select(
                func.coalesce(func.nullif(File.ext, ""), "none").label("ext"),
                func.count().label("n"),
                func.coalesce(func.sum(File.size), 0).label("bytes"),
            )
            .group_by(text("ext"))
            .order_by(text("n DESC"))
            .limit(8)
        )
    ).all()
    top_n = sum(int(r.n) for r in ext_rows)
    types = [{"ext": r.ext, "count": int(r.n), "bytes": int(r.bytes)} for r in ext_rows]
    if totals["files"] > top_n:
        types.append({"ext": "other", "count": totals["files"] - top_n, "bytes": 0})

    # Size distribution in powers of 1024, which is how storage actually clusters.
    size_rows = (
        await db.execute(
            text(
                """
                SELECT bucket, COUNT(*) AS n FROM (
                    SELECT CASE
                        WHEN size < 65536 THEN '<64 KB'
                        WHEN size < 1048576 THEN '64 KB–1 MB'
                        WHEN size < 10485760 THEN '1–10 MB'
                        WHEN size < 104857600 THEN '10–100 MB'
                        ELSE '>100 MB' END AS bucket
                    FROM files
                ) s GROUP BY bucket
                """
            )
        )
    ).all()
    order = ["<64 KB", "64 KB–1 MB", "1–10 MB", "10–100 MB", ">100 MB"]
    by_bucket = {r.bucket: int(r.n) for r in size_rows}
    sizes = [{"bucket": b, "count": by_bucket.get(b, 0)} for b in order]

    # Activity by hour of day, all 24 present so the radial chart is a full circle.
    hour_rows = (
        await db.execute(
            text(
                """
                SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'utc')::int AS h,
                       COUNT(*) AS n
                FROM audit_logs
                WHERE created_at > now() - INTERVAL '30 days'
                GROUP BY h
                """
            )
        )
    ).all()
    by_hour = {int(r.h): int(r.n) for r in hour_rows}
    hours = [{"hour": h, "value": by_hour.get(h, 0)} for h in range(24)]

    actions = [
        {"action": r.action, "count": int(r.n)}
        for r in (
            await db.execute(
                text(
                    """
                    SELECT action, COUNT(*) AS n FROM audit_logs
                    WHERE created_at > now() - INTERVAL '30 days'
                    GROUP BY action ORDER BY n DESC LIMIT 10
                    """
                )
            )
        ).all()
    ]

    # Per-account storage, biggest first — the shape of the tail matters more than
    # the names, so only the username goes out.
    top_users = [
        {"label": r.label or "—", "bytes": int(r.bytes), "files": int(r.files)}
        for r in (
            await db.execute(
                select(
                    User.username.label("label"),
                    func.coalesce(func.sum(File.size), 0).label("bytes"),
                    func.count(File.id).label("files"),
                )
                .join(File, File.owner_id == User.id, isouter=True)
                .group_by(User.id, User.username)
                .order_by(text("bytes DESC"))
                .limit(10)
            )
        ).all()
    ]

    # Cumulative bytes per day: the running total is what shows growth, and it's
    # cheaper to accumulate in Postgres than to ship 30 deltas and sum them twice.
    growth = [
        {"day": r.day, "value": int(r.total)}
        for r in (
            await db.execute(
                text(
                    f"""
                    WITH days AS (
                        SELECT generate_series(
                            (now() AT TIME ZONE 'utc')::date - INTERVAL '{WINDOW_DAYS - 1} days',
                            (now() AT TIME ZONE 'utc')::date, INTERVAL '1 day')::date AS day
                    )
                    SELECT days.day::text AS day,
                           COALESCE(SUM(f.size) FILTER (
                               WHERE (f.created_at AT TIME ZONE 'utc')::date
                                     <= days.day), 0) AS total
                    FROM days LEFT JOIN files f ON true
                    GROUP BY days.day ORDER BY days.day
                    """  # noqa: S608 — WINDOW_DAYS is a module constant
                )
            )
        ).all()
    ]

    # Distinct actors per day — "how many people used it", not "how much happened".
    active = [
        {"day": r.day, "value": int(r.n)}
        for r in (
            await db.execute(
                text(
                    f"""
                    WITH days AS (
                        SELECT generate_series(
                            (now() AT TIME ZONE 'utc')::date - INTERVAL '{WINDOW_DAYS - 1} days',
                            (now() AT TIME ZONE 'utc')::date, INTERVAL '1 day')::date AS day
                    )
                    SELECT days.day::text AS day, COUNT(DISTINCT a.user_id) AS n
                    FROM days LEFT JOIN audit_logs a
                      ON (a.created_at AT TIME ZONE 'utc')::date = days.day
                    GROUP BY days.day ORDER BY days.day
                    """  # noqa: S608
                )
            )
        ).all()
    ]

    providers = [
        {"label": r.provider, "count": int(r.n), "bytes": int(r.bytes)}
        for r in (
            await db.execute(
                select(
                    File.provider.label("provider"),
                    func.count().label("n"),
                    func.coalesce(func.sum(File.size), 0).label("bytes"),
                )
                .group_by(File.provider)
                .order_by(text("n DESC"))
            )
        ).all()
    ]

    # Version churn: how many files are actually being revised.
    version_rows = (
        await db.execute(
            text(
                """
                SELECT COUNT(*) AS versions,
                       COUNT(DISTINCT file_id) AS versioned,
                       COUNT(*) FILTER (WHERE version_no > 1) AS revisions
                FROM file_versions
                """
            )
        )
    ).one()

    shares = [
        {"label": r.kind, "count": int(r.n)}
        for r in (
            await db.execute(
                text(
                    """
                    SELECT kind, COUNT(*) AS n FROM (
                        SELECT CASE
                            WHEN password_hash IS NOT NULL THEN 'password'
                            WHEN expires_at IS NOT NULL THEN 'expiring'
                            WHEN view_only THEN 'view only'
                            WHEN max_downloads IS NOT NULL THEN 'capped'
                            ELSE 'open' END AS kind
                        FROM shares
                    ) s GROUP BY kind ORDER BY n DESC
                    """
                )
            )
        ).all()
    ]

    alias_kinds = [
        {"label": r.kind, "count": int(r.n)}
        for r in (
            await db.execute(
                text(
                    """
                    SELECT CASE WHEN folder_id IS NOT NULL THEN 'folder' ELSE 'file' END AS kind,
                           COUNT(*) AS n
                    FROM aliases GROUP BY kind ORDER BY n DESC
                    """
                )
            )
        ).all()
    ]

    # Reclaimable space: every copy beyond the first in each identical-hash group.
    dup = (
        await db.execute(
            text(
                """
                SELECT COALESCE(COUNT(*), 0) AS groups,
                       COALESCE(SUM(waste), 0) AS bytes
                FROM (
                    SELECT hash, (COUNT(*) - 1) * MIN(size) AS waste
                    FROM files WHERE hash IS NOT NULL
                    GROUP BY hash HAVING COUNT(*) > 1
                ) g
                """
            )
        )
    ).one()

    # Index coverage — of the files that *could* be indexed, how many are.
    indexed_files = await _scalar(
        db, select(func.count(func.distinct(AiFileChunk.file_id)))
    )

    tags = [
        {"label": r.name, "count": int(r.n)}
        for r in (
            await db.execute(
                text(
                    """
                    SELECT t.name, COUNT(ft.file_id) AS n
                    FROM tags t JOIN file_tags ft ON ft.tag_id = t.id
                    GROUP BY t.name ORDER BY n DESC LIMIT 14
                    """
                )
            )
        ).all()
    ]

    return {
        "generated_at": datetime.now(UTC),
        "window_days": WINDOW_DAYS,
        "totals": totals,
        "signups": await _daily(db, "users"),
        "uploads": await _daily(db, "files"),
        "types": types,
        "sizes": sizes,
        "hours": hours,
        "actions": actions,
        "top_users": top_users,
        "growth": growth,
        "active": active,
        "providers": providers,
        "versions": {
            "total": int(version_rows.versions),
            "versioned_files": int(version_rows.versioned),
            "revisions": int(version_rows.revisions),
        },
        "shares_by_kind": shares,
        "aliases_by_kind": alias_kinds,
        "duplicates": {"groups": int(dup.groups), "reclaimable_bytes": int(dup.bytes)},
        "index_coverage": {"indexed": indexed_files, "files": totals["files"]},
        "tags": tags,
    }
