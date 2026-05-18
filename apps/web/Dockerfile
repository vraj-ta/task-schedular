# Operator console image (multi-stage).
#
# Stage 1 builds the Vite bundle.
# Stage 2 serves it from nginx and proxies /api/* to the API service.

# -------- build --------
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

COPY packages/shared-types packages/shared-types
COPY apps/web apps/web

# Shared-types ships as dist/ (the web client imports it as a package).
RUN npm --workspace @task-scheduler/shared-types run build

RUN npm --workspace @task-scheduler/web run build

# -------- runtime (nginx) --------
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
