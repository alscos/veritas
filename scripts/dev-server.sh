#!/bin/sh
set -eu
cd /opt/veritas-dev
test "$(pwd -P)" = /opt/veritas-dev
export COMPOSE_PARALLEL_LIMIT=1
dc() { docker compose --project-directory /opt/veritas-dev --env-file /dev/null -p inkgroove-dev -f /opt/veritas-dev/compose.dev.yaml "$@"; }
case "${1:-}" in
  init) python3 scripts/dev-init.py; dc config --quiet ;;
  build-tools) dc build php; dc build node; dc build db ;;
  install) dc run --rm --no-deps php composer install --no-interaction --prefer-dist; dc run --rm --no-deps node npm ci --no-audit --no-fund ;;
  frontend) dc run --rm --no-deps node npm test -- --maxWorkers=1 ;;
  build) dc run --rm --no-deps node npm run build ;;
  phpunit) dc run --rm --no-deps php php vendor/bin/phpunit ;;
  updaters) dc run --rm --no-deps php python3 -m unittest discover -s tests/deployment -v ;;
  browser) dc run --rm --no-deps node npm run test:browser ;;
  smoke) dc up -d --wait db; dc run --rm --no-deps php php scripts/dev-init-db.php; dc run --rm --no-deps smoke ;;
  test) for stage in frontend build phpunit updaters browser smoke; do sh scripts/dev-server.sh "$stage"; done ;;
  up) dc up -d --no-build --wait db app ;;
  stop) dc stop app db ;;
  status) dc ps ;;
  chromium-real) python3 scripts/chromium-real-run.py ;;
  chromium-real-retry) python3 scripts/chromium-real-run.py --retry ;;
  history-seed-small) dc exec -T app php scripts/dev-history-fixture.php 2000 ;;
  history-seed-large) dc exec -T app php scripts/dev-history-fixture.php 25000 ;;
  history-outsider) dc exec -T app php scripts/dev-history-fixture.php outsider ;;
  history-integrity) dc exec -T app php scripts/dev-history-fixture.php integrity ;;
  history-clean) dc exec -T app php scripts/dev-history-fixture.php clean ;;
  history-browser) dc run --rm --no-deps node node scripts/check-dev-history-browser.mjs ;;
  history-benchmark) dc run --rm --no-deps node node scripts/measure-dev-browser.mjs ;;
  concurrency-integrity) dc exec -T app php scripts/check-dev-concurrency-integrity.php ;;
  concurrency-migrate) dc exec -T app php artisan migrate --force ;;
  concurrency-browser) dc run --rm --no-deps node node scripts/check-dev-concurrency-browser.mjs ;;
  privacy-seed) dc exec -T app php scripts/dev-privacy-fixture.php seed ;;
  privacy-clean) dc exec -T app php scripts/dev-privacy-fixture.php clean ;;
  privacy-browser) dc run --rm --no-deps node node scripts/check-dev-privacy-browser.mjs ;;
  versions) dc run --rm --no-deps php sh -c 'php --version; composer --version; python3 --version'; dc run --rm --no-deps node sh -c 'node --version; npm --version; npx playwright --version' ;;
  *) echo 'Unknown dev action.' >&2; exit 1 ;;
esac
