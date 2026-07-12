# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (set in docker-compose) so the pnpm workspace resolves.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ── Dev: workspace install + next dev ─────────────────────────────────────────
FROM base AS dev
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "@byos/web", "dev"]

# ── Build: Next standalone output ─────────────────────────────────────────────
FROM base AS build
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the API URL
# must be present here. Render passes service env vars as build args.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @byos/web build

# ── Prod: minimal runtime ─────────────────────────────────────────────────────
FROM node:22-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
