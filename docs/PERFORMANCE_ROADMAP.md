# BYOS — Performance / Latency Roadmap

Tracks the latency work. **Root cause:** request time is dominated by the
API↔DB round-trip. Measured from a local API (India) → Neon (Singapore):
~228 ms/query warm, ~1.4 s when a connection re-establishes, ~4.6 s cold. Local
Postgres: ~0.2 ms. Reads *and* writes pay this; caches don't help writes.

**The order of impact:** co-locate API+DB ≫ optimistic UI ≫ fewer round-trips ≫
hot-read caching. Do them in that order.

---

## ✅ Done
- **Dev DB → local Postgres** (`apps/api/.env`) — dev is now ~0.2 ms/query.
- **Analytics overview** collapsed 4 queries → 1 round trip.
- **Optimistic delete**, ETag/304 on downloads, pagination + infinite scroll.
- **Provider-agnostic DB layer** (`prepare_asyncpg` handles Neon + Supabase poolers).

- **Prod DB → Supabase (Mumbai / ap-south-1, session pooler), always-on.** Done.
  Measured ~57–90 ms/query (vs Neon Singapore ~228 ms), no per-request cold
  starts. `prepare_asyncpg` keeps prepared statements on for the session pooler
  (only transaction poolers / port 6543 / Neon `-pooler` disable them). Data API
  disabled + automatic RLS on in Supabase. Prod uses `.env.production`; dev stays
  on local Postgres.

## 🚧 Next
- **Co-locate the deployed API in ap-south-1** so API↔Supabase is ~1 ms (see §2).
  Until then, testing from a laptop still pays the browser↔DB distance.

---

## 1. Optimistic UI (near-term, ~1–2 hrs, no infra)
Make writes *feel* instant regardless of DB latency: update the UI immediately,
fire the request in the background, roll back on error. This is the high-value
subset of "local-first" without a sync engine.

**Apply to:** favorite toggle, add/remove tag, rename (file & folder), create
alias, create share, move. (Delete already does this.)

**Pattern:**
1. Compute the new state and `setState` immediately.
2. Fire `authed(() => api.x(...))` without blocking the UI.
3. On failure: revert to the previous state + show a toast.
4. Keep a small "pending" indicator only for long ops (upload).

**Files:** `apps/web/app/(app)/dashboard/page.tsx` (`toggleFavorite`, tag/rename
handlers), the tags/alias/share modals. **Risk:** low — mutations are already
idempotent server-side; a failed write just reverts and the next load resyncs.

## 2. Co-locate API + DB (the real fix, deploy-time)
The only thing that makes reads *and* writes actually fast. Put the API in the
**same region** as the DB so API↔DB is ~1 ms; then the only network hop is the
user's browser → API (one round trip, already minimized).

**Plan:**
- Choose region near users (India → **Mumbai ap-south-1**).
- Deploy the API to a host in that region: **Fly.io** (region `bom`), **Render**
  (Singapore/other; Mumbai via provider), or **Railway** (app + Postgres same
  region). Supabase DB in ap-south-1.
- Add a `Dockerfile`/deploy config for `apps/api`; set prod env (`.env.production`
  values) as platform secrets; run `alembic upgrade head` on deploy.
- Deploy `apps/web` (Vercel/Netlify) with `NEXT_PUBLIC_API_URL` → the API host;
  set `CORS_ORIGINS` to the web origin.
- **Verify:** hit `/health` and a couple of authed endpoints; confirm p50 < 100 ms.

## 3. Reduce round-trips per request (small, universal)
Every authed request currently does an extra query to load the `User`
(`get_current_user` → `db.get(User, sub)`). At 228 ms that's a full extra hop.
- Option A: trust the short-lived (15 min) JWT `sub` — construct a lightweight
  principal without a DB hit; only `/auth/me` loads the full row. Saves 1 hop on
  every authed call. Trade-off: a deactivated user's token works until expiry.
- Option B: cache the user in Redis (co-located) with a short TTL.
- Also: audit endpoints for N+1 (e.g. `analytics.top_content` resolves labels
  one-by-one — batch it).

## 4. Hot-read caching with Redis (complement, not a fix)
Only helps repeated, staleness-tolerant **reads**; never writes. Already used for
the analytics overview (30 s) + rate limits, with graceful fallback.
- Could add: cache folder/file listings per (owner, folder) with invalidation on
  mutation. Worth it only if Redis is co-located and browsing is read-heavy.
- **Keep-alive cron is NOT useful** for per-query latency (only prevents cold
  starts) — confirmed: repeating the same action stayed slow, so the cost is
  distance, not warmth.

## 5. Local-first sync (long-term, weeks — only if we want *instant* + offline)
Keep a **client-side replica** of the user's metadata (IndexedDB / SQLite-WASM);
UI reads from it (0 ms) and syncs to Postgres in the background. Files stay in
Telegram — only metadata rows sync, so initial hydration is small (KB–MB).

**Do NOT hand-roll the sync engine.** Use a proven one:
- **Replicache** — server-authoritative, simplest model; you implement `push`
  (apply client mutations) + `pull` (deltas) endpoints. Best fit for our
  REST/FastAPI backend.
- **ElectricSQL / PowerSync** — Postgres↔local-SQLite sync; pair well with
  Supabase; more infra.

**Requirements / risks:**
- **Per-user row scoping is security-critical** — a client may only ever replicate
  its own rows. Enforce server-side on every pull/push.
- Conflict model: prefer **server-authoritative** (local = optimistic cache) to
  avoid multi-device merge complexity.
- Offline mutation queue + reconciliation with the optimistic UI from §1.
- Phase it: start with read replication of files/folders/tags, then add
  optimistic mutations, then offline.

**Decision gate:** only build this if a co-located Supabase deployment (§2) still
doesn't feel instant enough. It likely will be fast enough on its own.

---

## Supabase swap — checklist (in progress)
1. Create a Supabase project in **ap-south-1 (Mumbai)** (or nearest to users).
2. Grab the **connection string** (Settings → Database):
   - Session pooler (`...pooler.supabase.com:5432`) is a good default for our
     persistent async app; transaction pooler (`:6543`) also works — both are
     handled (`statement_cache_size=0` auto-set for pooler hosts).
   - Format: `postgresql+asyncpg://postgres.<ref>:<pwd>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
3. Put it in `apps/api/.env.production` as `DATABASE_URL` (keep dev on localhost).
4. `alembic upgrade head` against Supabase (one-time; user-approved prod action).
5. Verify `/health` + an authed round-trip; measure query latency.
