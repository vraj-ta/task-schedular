# Control-plane API image (multi-stage).
#
# Stage 1 (build):
#   - install workspace deps (root npm workspaces)
#   - compile @task-scheduler/shared-types -> dist/  (NODE ESM resolves via dist)
#   - run `prisma generate` with a placeholder DATABASE_URL  (Prisma 7 evaluates
#     env('SCHEDULER_DATABASE_URL') eagerly even for `generate` — never connects)
#   - tsc the API
#
# Stage 2 (runtime):
#   - copy only node_modules + built artifacts + prisma schema + prisma.config.ts
#   - run from /app/apps/api so `prisma migrate deploy` auto-loads prisma.config.ts
#
# Both stages run as node:24-bookworm-slim. Stay on slim (not alpine) — pg's
# native bindings + bcryptjs work fine on slim and the layer's GHCR cache is warm.

# -------- build --------
FROM node:24-bookworm-slim AS build

# Prisma's query engine binary links against libssl. node:*-bookworm-slim
# ships without it, which produces a `prisma:warn Prisma failed to detect the
# libssl/openssl version to use` at runtime and falls back to the openssl-1.1.x
# binary target. Install openssl + ca-certificates so Prisma picks the correct
# binary for Debian 12 (openssl-3.0.x).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace manifests first so install is cached across source edits.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

# Sources.
COPY packages/shared-types packages/shared-types
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src apps/api/src

# shared-types must emit dist/ — the API imports it as a published package.
RUN npm --workspace @task-scheduler/shared-types run build

# Prisma generate. Placeholder URL is fine — the CLI never connects.
ENV SCHEDULER_DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN npm --workspace @task-scheduler/api run prisma:generate

# Compile API.
RUN npm --workspace @task-scheduler/api run build

# Prune dev deps so the runtime stage doesn't carry typescript, vitest, etc.
RUN npm prune --omit=dev

# -------- runtime --------
FROM node:24-bookworm-slim AS runtime

# Same libssl story — the runtime container also needs it for the Prisma
# query engine and for `prisma migrate deploy` (run by the compose `migrate`
# one-shot, which reuses this image).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

# Workspace manifests + root package-lock so npm understands the workspace
# layout. Without these the bare `node` invocation still works, but anyone
# running `npx prisma migrate deploy` from inside the container needs them.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/shared-types/package.json packages/shared-types/package.json

# node_modules — pruned to production deps.
COPY --from=build /app/node_modules ./node_modules

# Built outputs.
COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/api/dist apps/api/dist

# Prisma schema + config — required for `prisma migrate deploy` at runtime.
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts

# Default artifact dir; mounted as a named volume in docker-compose.
RUN mkdir -p /var/scheduler/artifacts && chown -R node:node /var/scheduler/artifacts

# Entrypoint that applies pending migrations before exec'ing the API.
# Replaces the previous separate `migrate` one-shot compose service.
COPY --chown=node:node apps/api/docker-entrypoint.sh /usr/local/bin/scheduler-entrypoint.sh
RUN chmod +x /usr/local/bin/scheduler-entrypoint.sh

USER node
EXPOSE 4100

# Run from /app/apps/api so `prisma migrate deploy` finds prisma.config.ts in cwd.
WORKDIR /app/apps/api

ENTRYPOINT ["/usr/local/bin/scheduler-entrypoint.sh"]
