# BYOS — Developer Guide

Use BYOS programmatically: upload, organize, search, version, and share files —
and get notified when they change. This covers authentication, the REST API, and
webhooks.

- **Base URL:** your API host (dev: `http://localhost:8000`).
- **Interactive docs:** `GET /docs` (OpenAPI/Swagger UI) · schema at `/openapi.json`.
- **TypeScript SDK:** the `@byos/api-client` package (typed wrapper over this API).
- **Content type:** JSON everywhere except file uploads (multipart/form-data).

---

## Authentication

Two ways to authenticate; both are sent as a bearer token:

```
Authorization: Bearer <token>
```

1. **API key (for scripts, servers, CI)** — a long‑lived key you create once.
   Looks like `byosk_<prefix>_<secret>`. This is the recommended path for
   programmatic access.
2. **JWT access token (for browsers)** — short‑lived (15 min), obtained via the
   Telegram login flow and refreshed with a rotating cookie. Used by the web app.

The same endpoints accept either. A few endpoints are **public** (no auth):
`GET /{username}/{slug}` (alias resolution) and `GET /health`.

### Getting an API key
Create one in the app under **Developer → API keys**, or via the API (using a
browser session):

```
POST /api-keys        { "name": "CI token" }
→ 201 { "key": "byosk_ab12cd34_…", "api_key": { "id", "name", "prefix", … } }
```

The plaintext `key` is shown **once** — store it securely. Only its SHA‑256 hash
is kept server‑side. Manage keys:

| Method & path | Purpose |
|---|---|
| `POST /api-keys` `{name}` | Create a key (returns plaintext once) |
| `GET /api-keys` | List your keys (prefix + last‑used, never the secret) |
| `DELETE /api-keys/{id}` | Revoke a key (immediately stops working; idempotent) |

Use it:
```bash
curl -H "Authorization: Bearer byosk_ab12cd34_…" http://localhost:8000/files
```

---

## Conventions

- **Errors:** non‑2xx responses return `{ "detail": "message" }`. Common codes:
  `400` bad input, `401` unauthenticated, `404` not found, `409` conflict,
  `413` upload too large, `422` validation/scan failure, `429` rate limited.
- **Pagination:** list endpoints take `limit` (≤ 500) and `offset`. There's no
  total count; request the next page when you receive a full page.
- **Idempotency:** mutations are safe to retry — deleting a missing resource is a
  no‑op (`204`); re‑uploading identical content returns the existing file; etc.
- **Caching:** file content responses send an `ETag`; send `If-None-Match` to get
  a `304 Not Modified` and skip re‑downloading unchanged bytes.
- **Rate limits:** the login flow and public link endpoints are IP‑rate‑limited
  (`429` when exceeded).

---

## Files

| Method & path | Purpose |
|---|---|
| `GET /files?folder_id&favorite&tag&limit&offset` | List files (filter by folder / favorite / tag) |
| `POST /files` (multipart: `file`, `folder_id?`) | Upload a file (goes to your Telegram) |
| `GET /files/{id}/content` | Download / stream the current version (ETag/304) |
| `POST /files/{id}/move` `{folder_id}` | Move to a folder (`null` = root) |
| `DELETE /files/{id}` | Delete (idempotent) |
| `PUT /files/{id}/favorite` `{favorite}` | Star / unstar |
| `POST /files/{id}/tags` `{name}` · `DELETE /files/{id}/tags/{name}` | Add / remove tag |
| `GET /files/tags` | All your tag names |
| `GET /files/duplicates` | Files grouped by identical content hash |
| `GET /files/search?q&ext&mime&folder_id&limit` | Full‑text + fuzzy search |
| `GET /files/nl-search?q&limit` | Natural‑language search ("pdfs from last week >2mb") |

**FileItem** shape:
```json
{ "id","name","ext","mime","size","provider","folder_id",
  "is_favorite","tags":[],"created_at","modified_at" }
```

### Versions
Replacing a file keeps history; the current version is what downloads/links serve.

| Method & path | Purpose |
|---|---|
| `POST /files/{id}/replace` (multipart: `file`) | Upload a new version (becomes current) |
| `GET /files/{id}/versions` | List versions (with `is_current`) |
| `POST /files/{id}/versions/{vid}/restore` | Make an old version current |
| `GET /files/{id}/versions/{vid}/content` | Download a specific version |
| `DELETE /files/{id}/versions/{vid}` | Delete a non‑current version |

---

## Folders

| Method & path | Purpose |
|---|---|
| `GET /folders?parent_id` | List a folder's children (root if omitted) |
| `POST /folders` `{name, parent_id?}` | Create (idempotent per name+parent) |
| `GET /folders/{id}/breadcrumb` | Ancestor path |
| `PATCH /folders/{id}` `{name?, color?}` | Rename and/or set color (color = hex from the palette, or `null`) |
| `POST /folders/{id}/move` `{parent_id}` | Move (cycle‑safe; `null` = root) |
| `DELETE /folders/{id}` | Delete (subfolders cascade; files become root) |

---

## Aliases (permanent links)

A file has at most **one** alias. The public URL is `/{username}/{slug}` and always
serves the file's **current** version — replace or restore a version to change what
it points to, without the URL changing.

| Method & path | Purpose |
|---|---|
| `POST /aliases` `{slug, file_id, description?}` | Create a link (409 if the file already has one) |
| `GET /aliases` | List your aliases |
| `PATCH /aliases/{id}` `{file_id?, description?}` | Repoint / edit |
| `DELETE /aliases/{id}` | Delete |
| `GET /{username}/{slug}` | **Public** — stream the current version (rate‑limited) |

---

## Analytics & audit

| Method & path | Purpose |
|---|---|
| `GET /analytics/overview` | Storage used, counts, 30‑day + all‑time views/downloads |
| `GET /analytics/timeseries?days` | Daily views/downloads buckets |
| `GET /analytics/top?limit` | Most‑accessed files/links |
| `GET /audit?limit&offset` | Your security‑relevant activity log |

---

## Account

| Method & path | Purpose |
|---|---|
| `GET /auth/me` | Current user (`id, username, display_name, …`) |
| `POST /auth/username` `{username}` | Set your unique username (required before creating links) |
| `GET /providers` · `DELETE /providers/telegram` | Connected storage providers |

(The Telegram login endpoints — `/auth/telegram/*`, `/auth/refresh`, `/auth/logout`
— are for the browser flow; scripts use API keys instead.)

---

## Webhooks

Get an HTTP callback when your files change.

| Method & path | Purpose |
|---|---|
| `POST /webhooks` `{url, events?}` | Subscribe (`events` = subset of the list below, or `["*"]`) |
| `GET /webhooks` | List (includes each webhook's signing `secret`) |
| `DELETE /webhooks/{id}` | Delete |

**Events:** `file.created`, `file.replaced`, `file.deleted`.

**Delivery:** BYOS sends a JSON `POST` to your URL:
```json
{ "event": "file.created",
  "data": { "file_id","name","size","mime","folder_id" } }
```
It's fire‑and‑forget (a failed delivery is dropped, not retried in the current
build), with a ~5s timeout.

**Verify the signature** — every request includes
`X-BYOS-Signature: sha256=<hmac>`, an HMAC‑SHA256 of the raw body keyed with your
webhook's `secret`. Always verify before trusting the payload:

```python
import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")
```

---

## TypeScript SDK

`@byos/api-client` wraps this API with types. Every call takes the token as the
first argument:

```ts
import { ByosClient } from "@byos/api-client";

const api = new ByosClient("http://localhost:8000");
const key = "byosk_ab12cd34_…";

const files = await api.listFiles(key);                       // list root
const alias = await api.createAlias(key, "resume", files[0].id);
const url   = api.aliasUrl("your-username", alias.slug);      // /your-username/resume
await api.uploadFile(key, file, undefined, (pct) => console.log(pct)); // real upload %
```

---

## Examples (curl)

Upload a file:
```bash
curl -H "Authorization: Bearer $KEY" -F "file=@report.pdf" http://localhost:8000/files
```

Create a permanent link, then share `/{username}/resume`:
```bash
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"slug":"resume","file_id":"<uuid>"}' http://localhost:8000/aliases
```

Natural‑language search:
```bash
curl -H "Authorization: Bearer $KEY" \
     "http://localhost:8000/files/nl-search?q=pdfs%20from%20last%20week%20larger%20than%202mb"
```

Subscribe to file events:
```bash
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"url":"https://you.example.com/hooks/byos","events":["file.created","file.replaced"]}' \
     http://localhost:8000/webhooks
```
