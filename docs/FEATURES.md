# BYOS — Feature Reference

**BYOS ("Bring Your Own Storage")** is a unified layer on top of storage you
already own. Your files live in *your* provider (Telegram today; Drive/Dropbox/
S3/R2 next); BYOS holds only the metadata and gives you the experience —
organization, search, preview, versioning, sharing, analytics, and permanent
links. The database owns everything *about* your files; the provider stores only
the bytes.

- **Web app:** Next.js 15 (App Router, TypeScript, Tailwind) — `apps/web`
- **API:** FastAPI (Python 3.12, SQLAlchemy 2.0 async) — `apps/api`
- **Data:** PostgreSQL (local for dev, Neon for production) + Redis (optional cache/limits)
- **Storage:** the user's own Telegram account (via Telethon)

Base API URL in examples: `http://localhost:8000`.

---

## 1. Authentication — Telegram-only

There is **no email/password**. Your Telegram account *is* your BYOS account
**and** your storage. Logging in both identifies you and connects your storage
in one step.

**Flow (3 steps):**
1. Enter your phone number → Telegram sends a login code.
2. Enter the code. If your Telegram has 2FA, you're asked for your Telegram password.
3. On success you get an app session (short-lived JWT access token + a rotating
   refresh cookie that persists ~30 days).

**Sessions persist:** once logged in, returning to the app skips sign-in and goes
straight to the dashboard (until you log out or the cookie expires).

| Endpoint | Purpose |
|---|---|
| `POST /auth/telegram/start` `{phone}` | Send login code; returns a stateless `ticket` |
| `POST /auth/telegram/verify` `{ticket, code}` | Verify code → session, or `password_needed` |
| `POST /auth/telegram/password` `{ticket, password}` | Complete 2FA → session |
| `POST /auth/refresh` | Exchange the refresh cookie for a new access token |
| `POST /auth/logout` | Revoke the refresh token, clear the cookie |
| `GET /auth/me` | Current user |

**Security notes:** the pending login is carried to the client as a Fernet-
encrypted "ticket" (no server-side pending state). The verified Telegram session
string is Fernet-encrypted at rest. App auth = own JWT (15-min access) + hashed,
rotating, revocable refresh tokens.

---

## 2. Storage providers

Your files are stored in your own Telegram (uploaded to your Saved Messages).
BYOS never holds the bytes. The provider is abstracted behind a `StorageProvider`
interface, so Drive/Dropbox/S3/R2 slot in later with no app changes.

- Uploads **always** go to your connected Telegram — there is no local-disk
  fallback (uploading without a connected provider returns `409`).
- The durable locator is `{chat, message_id}` (never a raw `file_id`, which
  expires); a fresh file reference is fetched before each download.

| Endpoint | Purpose |
|---|---|
| `GET /providers` | Connected providers + status |
| `DELETE /providers/telegram` | Disconnect Telegram |

---

## 3. Files & folders (virtual file system)

A Drive-like hierarchy stored as an adjacency list (`parent_id`) with recursive
CTEs for breadcrumbs and safe moves. Browsing never calls the provider — it's all
metadata.

**Files:** upload (drag-and-drop or the New button), download, rename, delete,
move between folders. Uploads are **idempotent** — re-uploading identical content
(same name + hash) in the same folder returns the existing file instead of
duplicating.

**Folders:** create, rename, move (cycle-safe), delete (cascades), infinite
nesting, breadcrumb navigation.

**Listing is paginated** (`limit` ≤ 500, `offset`) and the dashboard uses
infinite scroll.

| Endpoint | Purpose |
|---|---|
| `GET /files?folder_id&favorite&tag&limit&offset` | List files (paginated, filterable) |
| `POST /files` (multipart) | Upload a file |
| `GET /files/{id}/content` | Download / stream (ETag + `304` revalidation) |
| `DELETE /files/{id}` | Delete (idempotent) |
| `GET /folders?parent_id` · `POST /folders` | List / create folders |
| `GET /folders/{id}/breadcrumb` | Ancestor path |
| `PATCH /folders/{id}` · `POST /folders/{id}/move` · `DELETE /folders/{id}` | Rename / move / delete |

---

## 4. Search

Two complementary search modes:

- **Full-text + fuzzy:** Postgres `search_vector` (a generated `tsvector` over
  name/tags/mime) with `ts_rank` ordering, plus `pg_trgm` substring matching for
  partial words. Structured filters: `ext`, `mime`, `folder_id`.
- **Natural-language search:** type things like *"pdfs from last week larger than
  2mb invoice"*. A rule-based parser maps type words → mime/ext, size/recency
  phrases → filters, and passes the remaining words to full-text search. Falls
  back to plain search when nothing special is detected. (The dashboard search
  box uses this.)

| Endpoint | Purpose |
|---|---|
| `GET /files/search?q&ext&mime&folder_id&limit` | Full-text + fuzzy search |
| `GET /files/nl-search?q&limit` | Natural-language search |

---

## 5. Preview

Stream-and-preview without downloading: images, PDFs, text/markdown/code, audio,
and video are shown inline in a modal. Streaming is proxied through BYOS (which
enables access control, analytics, and range/caching), never a public provider
link. The first chunk is primed so provider errors surface as real status codes.

---

## 6. Dynamic aliases — the flagship

A **permanent, stable public URL whose underlying file can be swapped without the
link ever changing.** Share `/a/resume` once; replace the file behind it forever;
everyone who has the link always gets the current version.

- `slug` is unique and permanent; the alias resolves → file → *current version*.
- Public and unauthenticated: `GET /a/{slug}` streams the current version.

| Endpoint | Purpose |
|---|---|
| `POST /aliases` `{slug, file_id, description?}` | Create a permanent link |
| `GET /aliases` · `PATCH /aliases/{id}` · `DELETE /aliases/{id}` | Manage aliases |
| `GET /a/{slug}` | **Public** — stream the current version (rate-limited) |

---

## 7. Version history

Every "replace" keeps history. Aliases and shares always serve the current
version; restoring is an instant pointer flip (no re-upload).

- Replace is a metadata operation: upload new bytes → new `file_version` row →
  atomically flip `current_version_id`. Replacing with identical content is a
  no-op (idempotent).
- List, restore, download, or delete individual versions (can't delete the
  current one — restore another first).

| Endpoint | Purpose |
|---|---|
| `POST /files/{id}/replace` (multipart) | Upload a new version |
| `GET /files/{id}/versions` | List versions |
| `POST /files/{id}/versions/{vid}/restore` | Make an old version current |
| `GET /files/{id}/versions/{vid}/content` | Download a specific version |
| `DELETE /files/{id}/versions/{vid}` | Delete a non-current version |

---

## 8. Sharing (links with access controls)

Create shareable links with per-link controls:

- **Password** (hashed), **expiry** (in days), **max downloads** (one-time or N),
  **view-only** (inline, no download).
- Public endpoint enforces every control and counts downloads.

| Endpoint | Purpose |
|---|---|
| `POST /shares` `{file_id, password?, expires_in_days?, max_downloads?, view_only?}` | Create a share |
| `GET /shares` · `DELETE /shares/{id}` | List / revoke |
| `GET /s/{token}?pw=` | **Public** — open a share (rate-limited) |

---

## 9. Tags & favorites

- **Favorites/starred:** one-click star; a "Starred" view lists them.
- **Tags:** many-to-many labels, normalized and de-duplicated; filter by tag;
  clickable tag chips on file rows.
- **Auto-tagging:** on upload, files get a coarse type tag (image, document,
  video, audio, spreadsheet, archive, code) via a pluggable tagger (heuristic by
  default; an OCR/vision model can replace it). Config: `AUTO_TAGGING` (default on).

| Endpoint | Purpose |
|---|---|
| `PUT /files/{id}/favorite` `{favorite}` | Star / unstar |
| `POST /files/{id}/tags` `{name}` · `DELETE /files/{id}/tags/{name}` | Add / remove tag |
| `GET /files/tags` | All of the user's tags |
| `GET /files?favorite=true` · `GET /files?tag=<name>` | Filter |

---

## 10. Insights (analytics)

An access-analytics dashboard. Views/downloads are recorded on alias, share, and
file-content access (best-effort, on an isolated DB session that can never break
the download it measures; IPs are stored only as a salted one-way hash;
country/browser come from edge headers / user-agent).

- **Overview:** storage used (unlimited — shows usage, never a quota), file count,
  links count, total + last-30-day views and downloads.
- **Activity chart:** daily views vs downloads for the last 30 days.
- **Most accessed:** top files/links by hit count.
- **Duplicate files:** files with identical content grouped by hash (see §12).

| Endpoint | Purpose |
|---|---|
| `GET /analytics/overview` | Storage/counts + view/download tallies |
| `GET /analytics/timeseries?days` | Daily buckets |
| `GET /analytics/top?limit` | Most-accessed targets |

---

## 11. Developer platform

Use BYOS programmatically.

- **API keys** (`byosk_<prefix>_<secret>`): create (shown once), list, revoke.
  A key works anywhere a JWT does — send `Authorization: Bearer byosk_...`. Only
  a SHA-256 hash is stored; verification is a single indexed lookup.
- **Webhooks:** subscribe to `file.created` / `file.replaced` / `file.deleted`
  (or `*`). BYOS POSTs a JSON event signed with your secret
  (`X-BYOS-Signature: sha256=<hmac>`) so you can verify authenticity. Delivery is
  fire-and-forget (best-effort in-process; arq is the production path).
- The TypeScript SDK is the `@byos/api-client` package.

| Endpoint | Purpose |
|---|---|
| `POST /api-keys` `{name}` | Create a key (returns the plaintext once) |
| `GET /api-keys` · `DELETE /api-keys/{id}` | List / revoke |
| `POST /webhooks` `{url, events?}` | Create a webhook |
| `GET /webhooks` · `DELETE /webhooks/{id}` | List / delete |

---

## 12. AI features

- **Duplicate detection:** groups your files by content hash (reuses the hash
  stored at upload — no re-reading). Surfaced in Insights. `GET /files/duplicates`.
- **Natural-language search:** see §4 (`GET /files/nl-search`).
- **Auto-tagging:** see §9.
- **Flagged / pluggable (needs an external model, off by default):**
  - *Semantic search* — an `EmbeddingProvider` seam + pgvector (documented in
    `ai/embeddings.py`); lexical search remains the default until a provider is set.
  - *OCR / image recognition* — plugs into the `Tagger` seam.

---

## 13. Security

- **Telegram-only auth**, encrypted provider sessions at rest (Fernet).
- **Rate limiting** (Redis, fail-open) on the login flow and public
  `/a/{slug}` + `/s/{token}` endpoints — configurable, degrades gracefully if
  Redis is down.
- **Audit log / Activity view:** records login, file delete, share create, and
  API-key create/revoke; `GET /audit`. IPs stored as salted hashes only.
- **Upload validation** *before* bytes hit the provider: max size (`413`) and a
  blocked-extension policy (`400`), both configurable (permissive by default).
- **Virus-scan hook** (`security/scanning.py`): no-op by default; a real scanner
  (ClamAV/API) implements the `Scanner` protocol via `set_scanner`.
- **Access control:** every resource is owner-scoped; mutations are idempotent.

| Endpoint | Purpose |
|---|---|
| `GET /audit?limit&offset` | Your recent security-relevant actions |

---

## 14. Performance

- **HTTP caching:** content responses carry `ETag` + `Cache-Control`; a repeat
  download with a matching `If-None-Match` returns `304` (no body re-sent).
- **Pagination + infinite scroll** for file lists.
- **Redis cache** (graceful): expensive reads (analytics overview) are cached
  ~30s; degrades to direct computation when Redis is absent.
- **Optimistic UI:** deletes update the view instantly (idempotent server-side).
- **Fewer round trips:** e.g. the analytics overview does all its counts in one
  query.

> **Latency note (important for dev):** the API↔DB round-trip dominates request
> time. Against a distant managed DB (e.g. Neon in another region) each query is
> ~200ms+ warm and ~1.4s when a connection re-establishes; against a co-located
> DB it's <1ms. **Use a local Postgres for development** (`DATABASE_URL` →
> `localhost`), and in production **deploy the API in the same region as the DB**.

---

## 15. UI / UX

- Google Drive-style shell: left sidebar (My Drive, Starred, Links, Insights,
  Developer, Activity), top search bar, breadcrumb, list/grid toggle, type filter
  chips, drag-and-drop upload, right-click-style `⋮` menus.
- Premium neutral theme (warm greige base, slate-teal accent `#3C6E66`), dark-mode
  friendly tokens, lucide SVG icons, Space Grotesk brand wordmark, and the BYOS
  monogram logo.
- Menus render in a portal so they're never clipped; unlimited storage is shown
  as usage (never a quota bar).

---

## Configuration (environment)

Dev config lives in `apps/api/.env`; production in `.env.production` (both
git-ignored). Key settings:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres URL (**localhost for fast dev**, Neon for prod) |
| `REDIS_URL` | Redis (optional; cache + rate limits degrade gracefully) |
| `JWT_SECRET_KEY` | Signs access tokens (also salts IP hashes) |
| `BYOS_ENCRYPTION_KEY` | Fernet key for provider sessions + login tickets |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | From my.telegram.org |
| `ENABLE_LOCAL_STORAGE` | Register the local disk provider (tests only; default false) |
| `AUTO_TAGGING` | Heuristic auto-tag on upload (default true) |
| `MAX_UPLOAD_BYTES` / `BLOCKED_EXTENSIONS` | Upload validation (permissive defaults) |
| `AUTH_RATE_LIMIT` / `PUBLIC_RATE_LIMIT` (+ windows) | Rate-limit tuning |

Interactive API docs (OpenAPI/Swagger) are served at `/docs`.
