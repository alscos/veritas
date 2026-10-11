#!/bin/sh
set -eu
name=${1:?Installation name required}
action=${2:?Action required}
case "$name" in *[!a-z0-9-]*|'') exit 1;; esac
base=/opt/inkgroove-backup-lab/$name
cd "$base"
test "$(pwd -P)" = "$base"
export COMPOSE_PARALLEL_LIMIT=1
dc() { docker compose --env-file /dev/null --project-directory "$base" -p "igbr-$name" -f compose.json "$@"; }
case "$action" in
 prepare)
  # Copy dependencies without writing to the development volume.
  docker run --rm -v inkgroove-dev_vendor:/dependencies:ro -v "$base/code:/workspace" inkgroove-dev-php:local sh -c 'mkdir -p /workspace/vendor && cp -a /dependencies/. /workspace/vendor/ && mkdir -p /workspace/storage/app/private/images /workspace/storage/framework/cache/data /workspace/storage/framework/sessions /workspace/storage/framework/views /workspace/storage/logs /workspace/bootstrap/cache'
  mkdir -p "$base/tools"
  chmod 755 "$base/code"
  docker run --rm -v inkgroove-dev_node_modules:/dependencies:ro -v "$base/tools:/tools" inkgroove-dev-php:local sh -c 'mkdir -p /tools/node_modules && cp -a /dependencies/. /tools/node_modules/'
  docker run --rm -e NODE_OPTIONS=--max-old-space-size=512 -v "$base/tools/node_modules:/workspace/node_modules" -v "$base/code:/workspace" -w /workspace inkgroove-dev-node:local npm run build
  dc up -d --wait db
  dc run --rm --no-deps app php artisan migrate --force
  dc up -d --wait app
  dc exec -T app php scripts/backup-lab-fixture.php seed
  ;;
 seed|verify|edit)
  docker run --rm --network "igbr-${name}_default" -e PLAYWRIGHT_BROWSERS_PATH=/opt/inkgroove/browsers -e NODE_OPTIONS=--max-old-space-size=512 -v inkgroove-dev_node_modules:/workspace/node_modules:ro -v "$base/code:/workspace" -w /workspace inkgroove-dev-node:local node scripts/check-backup-browser.mjs "$action"
  ;;
 integrity) dc exec -T app php scripts/backup-lab-integrity.php ;;
 stop) dc stop app db ;;
 *) exit 1;;
esac
