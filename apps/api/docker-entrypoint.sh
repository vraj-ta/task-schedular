#!/usr/bin/env sh
# Entrypoint for the control-plane container.
#
# Applies any pending Prisma migrations, then execs the API. Idempotent —
# `prisma migrate deploy` is a no-op when the DB is up to date, so it's
# safe to run on every boot.
#
# We `exec` the final node process so it inherits PID 1 (proper SIGTERM
# delivery during `docker compose stop`).
set -e

# Pre-flight: wait for the DB. compose's healthcheck guards the first start,
# but a restart of the api container (network blip, etc.) doesn't re-trigger
# postgres healthcheck deps, so a short wait is cheap insurance.
echo "[entrypoint] applying migrations..."
node ../../node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting control-plane..."
exec node dist/index.js
