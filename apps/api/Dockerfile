# syntax=docker/dockerfile:1

# ── Base: Python 3.12 + uv ────────────────────────────────────────────────────
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app

# ── Dev: editable install + reload ────────────────────────────────────────────
FROM base AS dev
# Install dependencies first for layer caching (lock optional).
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-install-project
COPY . .
RUN uv sync
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "byos_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "src"]

# ── Prod: gunicorn + uvicorn workers ──────────────────────────────────────────
FROM base AS prod
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-install-project --no-dev
COPY . .
RUN uv sync --no-dev
EXPOSE 8000
# Run uvicorn directly from the pre-built venv (no `uv run`, which would re-sync
# at startup). Worker count is env-driven (WEB_CONCURRENCY, default 2) so small
# VMs don't OOM; shell form so the var expands.
CMD ["sh", "-c", ".venv/bin/uvicorn byos_api.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
