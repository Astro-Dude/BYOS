# BYOS — Deployment

**Architecture (why):** the API must sit in the **same region as Supabase
(Mumbai / ap-south-1)** — that's the whole latency fix (API↔DB ~1 ms). The web
app fetches from the browser, so it can live on any edge/CDN host.

- **API** → Fly.io, region `bom` (Mumbai). Config: `apps/api/fly.toml`.
- **Web** → Vercel (global edge). Points at the API via `NEXT_PUBLIC_API_URL`.
- **Redis** → skipped for now (rate-limit + caches degrade gracefully). Add later
  only if co-located in `bom` (`fly redis create --region bom`).

> ⚠️ **`BYOS_ENCRYPTION_KEY` must be the exact value currently in
> `apps/api/.env`.** It encrypted the Telegram session that's already in
> Supabase — a different key means uploads/downloads can't decrypt it.

---

## Option C — Everything on Render (no card, one platform) ← current plan

Render deploys the whole monorepo from `render.yaml` (both services), needs **no
credit card**, and is dashboard-driven. Trade-off: free region is **Singapore**
(not Mumbai), so API↔Supabase is ~40-60ms, and free services **cold-start**
(~30-60s) after ~15 min idle. Fine for a demo/personal app.

**Steps:**
1. Push `render.yaml` (done).
2. Render dashboard → **New → Blueprint** → connect this repo → it reads
   `render.yaml` and creates **byos-api** + **byos-web**.
3. It'll prompt for the `sync:false` env vars. Set on **byos-api**:
   - `DATABASE_URL` = Supabase pooler URL (from `apps/api/.env.production`)
   - `BYOS_ENCRYPTION_KEY` = the exact value in `apps/api/.env`
   - `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` = from `apps/api/.env`
   - `CORS_ORIGINS`, `WEB_BASE_URL` = leave blank for now
   (`JWT_SECRET_KEY` is auto-generated.)
   Leave **byos-web**'s `NEXT_PUBLIC_API_URL` blank for now.
4. First deploy runs. Note the two URLs (e.g. `https://byos-api.onrender.com`,
   `https://byos-web.onrender.com`).
5. Fill the cross-refs and redeploy:
   - byos-api → `CORS_ORIGINS` and `WEB_BASE_URL` = the **web** URL
   - byos-web → `NEXT_PUBLIC_API_URL` = the **api** URL (this triggers a rebuild,
     since it's baked into the client bundle)
6. Verify: open the web URL, log in via Telegram, confirm it **stays logged in on
   reload** (cross-site cookie), upload + open a file.

**Migrations:** Supabase is already at head. After any new migration, run it
locally against Supabase (`cd apps/api && uv run alembic upgrade head` with `.env`
pointing at Supabase) — Render free has no release hook.

**Cold starts:** don't bother with a keep-alive cron on Render free — the account
only gets 750 instance-hours/month total, so you can't keep both services warm
24/7 anyway. Accept the cold start, or upgrade one service later.

---

## Option B — API on Google Cloud Run (Mumbai, free tier)

Cloud Run has a real free tier in `asia-south1` (Mumbai) and scales to zero. It
still needs a **billing account linked** (a card on file), but free-tier usage is
$0. Same Docker image (it now honors `$PORT`).

```bash
brew install --cask google-cloud-sdk    # or: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>       # create one at console.cloud.google.com
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

# Secrets: put values in a git-ignored YAML (keeps them off the command line).
# Keys: DATABASE_URL (Supabase), BYOS_ENCRYPTION_KEY (must match apps/api/.env),
# TELEGRAM_API_ID, TELEGRAM_API_HASH, JWT_SECRET_KEY, ENVIRONMENT: production,
# WEB_CONCURRENCY: "2", REFRESH_COOKIE_SECURE: "true",
# REFRESH_COOKIE_SAMESITE: none, CORS_ORIGINS + WEB_BASE_URL (Vercel URL later).
cd apps/api
gcloud run deploy byos-api \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --port 8080 \
  --env-vars-file cloudrun.env.yaml

gcloud run services describe byos-api --region asia-south1 --format 'value(status.url)'
curl <that-url>/health     # -> {"status":"ok","environment":"production",...}
```

- **Migrations:** Supabase is already at head (`alembic upgrade head` was run
  against it). Re-run locally after any new migration — there's no release hook.
- **Keep warm:** point a 5-min cron at `<url>/ping` (see Notes).
- **min-instances 0** = free/scale-to-zero (rely on the cron); `1` = always warm
  but billed continuously.

---

## Option A — API on Fly.io (Mumbai)

```bash
# one-time
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth login

cd apps/api

# Create the app (pick a unique name; update `app = ` in fly.toml to match)
fly apps create byos-api        # or your name

# Set secrets. Pull values from apps/api/.env and .env.production:
fly secrets set \
  DATABASE_URL="<.env.production DATABASE_URL — the Supabase pooler URL>" \
  BYOS_ENCRYPTION_KEY="<.env BYOS_ENCRYPTION_KEY — MUST match>" \
  TELEGRAM_API_ID="<.env TELEGRAM_API_ID>" \
  TELEGRAM_API_HASH="<.env TELEGRAM_API_HASH>" \
  JWT_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  REFRESH_COOKIE_SECURE="true" \
  REFRESH_COOKIE_SAMESITE="none" \
  CORS_ORIGINS="https://REPLACE-with-your-vercel-domain.vercel.app" \
  WEB_BASE_URL="https://REPLACE-with-your-vercel-domain.vercel.app"

# Deploy (runs `alembic upgrade head` as the release command, then starts)
fly deploy

fly status                 # note the hostname, e.g. https://byos-api.fly.dev
curl https://byos-api.fly.dev/health   # -> {"status":"ok",...}
```

`ENVIRONMENT=production` and `WEB_CONCURRENCY=2` are already set in `fly.toml`.
(You don't know the Vercel domain yet — set `CORS_ORIGINS`/`WEB_BASE_URL` now as a
placeholder and fix them in step 3.)

## 2. Deploy the web app (Vercel)

Easiest via the dashboard: **New Project → import the repo → Root Directory =
`apps/web`.** Vercel auto-detects Next.js. Add an env var:

```
NEXT_PUBLIC_API_URL = https://byos-api.fly.dev      # your Fly API URL
```

Deploy. Note the resulting domain, e.g. `https://byos.vercel.app`.

(CLI alternative: `npm i -g vercel && cd apps/web && vercel --prod`, then set the
env var in the project settings and redeploy.)

## 3. Wire the two together

Point the API's CORS + folder-share redirect at the real web domain:

```bash
cd apps/api
fly secrets set \
  CORS_ORIGINS="https://byos.vercel.app" \
  WEB_BASE_URL="https://byos.vercel.app"    # triggers a rolling restart
```

If you set `NEXT_PUBLIC_API_URL` after the first Vercel build, redeploy the web
app so it bakes in (it's a build-time public var).

## 4. Verify

- `https://byos.vercel.app` loads, Telegram login works, and **stays logged in on
  reload** (confirms the cross-site `SameSite=None` refresh cookie).
- Upload a file → appears; open it → downloads (confirms the encryption key +
  Supabase + Telegram all line up).
- p50 for a folder navigation should be well under ~100 ms now that API↔DB is
  co-located.

## Notes
- **Migrations** run automatically on every `fly deploy` (release command). To run
  manually: `fly ssh console -C "uv run alembic upgrade head"`.
- **Scaling:** `fly scale count 2` adds instances; use Supabase's pooler (already
  handled by `prepare_asyncpg`) so extra instances don't exhaust connections.
- **Cold starts:** `min_machines_running = 1` keeps one machine warm. Set it to 0
  to save cost at the price of a cold start after idle.
- **Keep-alive (scale-to-zero hosts, e.g. Cloud Run):** hit `GET /ping` (returns
  `204`, no DB/auth) every ~5 min from a free cron (UptimeRobot / cron-job.org /
  Cloud Scheduler). Cloud Run keeps an instance warm ~15 min after a request, so
  a 5-min ping keeps it warm continuously — and you're billed only per (tiny)
  request, not for idle time, so it stays within the free tier.
- **Custom domain (optional):** putting web + API under one registrable domain
  (`app.example.com` + `api.example.com`) lets you use `SameSite=Lax` instead of
  `None` — slightly stricter. Not required.
