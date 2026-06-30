# BYOS — Bring Your Own Storage

A unified layer **on top of** the storage you already own (Telegram first; Google Drive,
Dropbox, S3, R2, … later). BYOS owns the *experience* — organization, search, preview,
versioning, dynamic aliases, sharing, analytics — while providers store only bytes.

> Flagship feature: **permanent dynamic aliases**. A stable URL (`/a/resume`) whose
> underlying file you can replace forever without the link ever changing.

This repository is currently at **Phase 0 — Scaffold**. See the full roadmap and
architecture in the plan: `~/.claude/plans/modular-bouncing-volcano.md`.

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 15 (App Router, TS), Tailwind, shadcn/ui, TanStack Query |
| API | FastAPI (Python 3.12), SQLAlchemy 2.0 (async) + Alembic, Pydantic v2 |
| Data | PostgreSQL 16 (`pg_trgm`, `citext`, `pgcrypto`), Redis 7 |
| Workers | arq (Redis) — added in later phases |
| Telegram | Telethon (MTProto) — Phase 2 |
| Tooling | pnpm + Turborepo (JS), uv (Python), Docker Compose |

## Layout

```
apps/web      Next.js app — landing, auth, dashboard shell
apps/api      FastAPI service — auth, storage abstraction, metadata engine
packages/     Shared TS (generated API client, future UI kit)
infra/        docker-compose for local dev
```

## Quickstart (Docker — recommended)

```bash
cp .env.example .env
# generate real secrets:
python3 -c "import secrets; print('JWT_SECRET_KEY=' + secrets.token_urlsafe(48))"
python3 -c "from cryptography.fernet import Fernet; print('BYOS_ENCRYPTION_KEY=' + Fernet.generate_key().decode())"
# paste those into .env, then:

docker compose -f infra/docker-compose.yml up --build
```

- Web → http://localhost:3000
- API docs → http://localhost:8000/docs
- API health → http://localhost:8000/health

Migrations run automatically on API start (`alembic upgrade head`).

## Local (without Docker)

You need Postgres 16 and Redis running locally, then:

```bash
pnpm install                 # JS deps (root)

# API
cd apps/api
uv sync                      # Python deps + venv
uv run alembic upgrade head  # apply migrations
uv run uvicorn byos_api.main:app --reload --port 8000

# Web (new shell)
cd apps/web
pnpm dev
```

## Type generation (API → TS client)

```bash
pnpm codegen   # exports OpenAPI from FastAPI, then generates the typed client
```

## Tests / checks

```bash
# API
cd apps/api && uv run pytest && uv run ruff check . && uv run mypy src

# Web
cd apps/web && pnpm lint && pnpm typecheck
```

## Roadmap status

- [x] **Phase 0** — Scaffold: monorepo, auth skeleton, storage abstraction (+ Local
  provider stub), base schema, Docker dev env, type pipeline.
- [ ] Phases 1–15 — see the plan file.
