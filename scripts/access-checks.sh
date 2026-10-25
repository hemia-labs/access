#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile
node --test test/release/*.test.mjs
bun run --cwd apps/api test --runInBand
bun run --cwd apps/api test:activation
bun run --cwd apps/api test:typecheck
bun run --cwd apps/api build
apps/api/node_modules/.bin/eslint --config apps/api/eslint.config.mjs 'apps/api/src/**/*.ts' 'test/api/**/*.ts'
bun run --cwd apps/web lint
python3 -m unittest discover -s test/deploy -p 'test_*.py'
ACCESS_ENV_FILE=/dev/null ACCESS_JWKS_PRIVATE_KEY_FILE=/dev/null docker compose --env-file /dev/null build
python3 test/docker/smoke.py
