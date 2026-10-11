#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
action=${1:-help}
case "$action" in
  sync)
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 inkgroove-alpine 'mkdir -p /opt/veritas-dev /opt/veritas-dev/.dev-backups'
    # No deletion: overwritten remote source is retained in timestamped backups.
    rsync -az --backup --backup-dir=".dev-backups/$(date -u +%Y%m%dT%H%M%SZ)" \
      --filter='+ /.env.example' --exclude='.env' --exclude='.env.*' \
      --exclude='.git/' --exclude='.dev-private/' --exclude='.dev-backups/' \
      --exclude='.aws/' --exclude='.codex/' --exclude='.agents/' \
      --exclude='data/' --exclude='vendor/' --exclude='node_modules/' \
      --exclude='/public/build/' --exclude='/storage/' --exclude='/bootstrap/cache/*.php' \
      --exclude='*.sqlite*' --exclude='.phpunit*cache*' --exclude='coverage/' \
      --exclude='releases/' --exclude='__pycache__/' --exclude='*.pyc' \
      --exclude='.inkgroove-updates/' --exclude='.DS_Store' \
      -e '/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10' "$root/" inkgroove-alpine:/opt/veritas-dev/
    ;;
  init|build-tools|install|frontend|build|phpunit|updaters|browser|smoke|test|up|stop|status|versions|history-seed-small|history-seed-large|history-clean|history-outsider|history-integrity|history-browser|history-benchmark|privacy-seed|privacy-clean|privacy-browser|concurrency-migrate|concurrency-browser|concurrency-integrity|chromium-real|chromium-real-retry)
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 inkgroove-alpine "sh /opt/veritas-dev/scripts/dev-server.sh $action"
    ;;
  *) echo 'Usage: sh scripts/dev-remote.sh sync|init|build-tools|install|frontend|build|phpunit|updaters|browser|smoke|test|up|stop|status|versions|history-seed-small|history-seed-large|history-clean|history-outsider|history-integrity|history-browser|history-benchmark'; exit 1 ;;
esac
