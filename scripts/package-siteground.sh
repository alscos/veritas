#!/bin/sh
# Build on the development machine; PHP/MySQL are sufficient on the hosting.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CANDIDATE=0
if [ "${1:-}" = "--candidate" ]; then CANDIDATE=1; shift; fi
if [ "$#" -gt 1 ]; then
    echo 'Uso: sh scripts/package-siteground.sh [--candidate] [directorio-de-salida]' >&2
    exit 1
fi
OUT=${1:-"$ROOT/../releases"}
mkdir -p "$OUT"
OUT=$(CDPATH= cd -- "$OUT" && pwd)
PHP_BIN=${PHP_BIN:-php}
command -v "$PHP_BIN" >/dev/null
command -v npm >/dev/null
if [ -n "${COMPOSER_PHAR:-}" ]; then
    test -f "$COMPOSER_PHAR"
else
    command -v composer >/dev/null
fi

REVISION=$(git -C "$ROOT" rev-parse HEAD)
DIRTY=$(git -C "$ROOT" status --porcelain)
if [ -n "$DIRTY" ] && [ "$CANDIDATE" -ne 1 ]; then
    echo 'Hay cambios sin commit. Cierra el commit o usa --candidate para un ensayo identificado como tal.' >&2
    exit 1
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LABEL=$(printf '%.12s' "$REVISION")
if [ "$CANDIDATE" -eq 1 ]; then LABEL="$LABEL-candidate-$STAMP"; fi
ARCHIVE="$OUT/inkgroove-siteground-$LABEL.tar.gz"
if [ -e "$ARCHIVE" ]; then
    echo 'El paquete de este commit ya existe. Usa otro directorio para no sobrescribirlo.' >&2
    exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
CORE="$STAGE/inkgroove"
PUBLIC="$STAGE/public_html"
mkdir -p "$CORE" "$PUBLIC"

cd "$ROOT"
# Run npm ci and the tests before packaging a release (see docs/SITEGROUND.md).
npm run build
for directory in app bootstrap config routes; do cp -R "$ROOT/$directory" "$CORE/$directory"; done
rm -f "$CORE"/bootstrap/cache/*.php
mkdir -p "$CORE/database" "$CORE/resources" "$CORE/deploy"
for directory in migrations seeders; do
    if [ -d "$ROOT/database/$directory" ]; then cp -R "$ROOT/database/$directory" "$CORE/database/$directory"; fi
done
cp -R "$ROOT/resources/views" "$CORE/resources/views"
cp -R "$ROOT/deploy/siteground" "$CORE/deploy/siteground"
for file in artisan composer.json composer.lock; do cp "$ROOT/$file" "$CORE/$file"; done
mkdir -p "$CORE/bootstrap/cache" "$CORE/storage/app/private/images" \
    "$CORE/storage/framework/cache/data" "$CORE/storage/framework/sessions" \
    "$CORE/storage/framework/views" "$CORE/storage/logs"

# Reuse locally installed archives without removing development dependencies in the repo.
# Composer still reconciles the isolated directory against composer.lock with --no-dev.
if [ -d "$ROOT/vendor" ]; then cp -R "$ROOT/vendor" "$CORE/vendor"; fi
cd "$CORE"
if [ -n "${COMPOSER_PHAR:-}" ]; then
    "$PHP_BIN" "$COMPOSER_PHAR" install --no-dev --no-interaction --prefer-dist --optimize-autoloader
else
    composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
fi

cp "$ROOT/deploy/siteground/index.php" "$PUBLIC/index.php"
cp "$ROOT/public/.htaccess" "$PUBLIC/.htaccess"
cp "$ROOT/public/favicon.svg" "$PUBLIC/favicon.svg"
cp -R "$ROOT/public/build" "$PUBLIC/build"
cp "$ROOT/resources/fonts/OFL.txt" "$PUBLIC/build/OFL.txt"
cp "$ROOT/docs/SITEGROUND.md" "$STAGE/INSTALL-SITEGROUND.md"
REVISION="$REVISION" STAMP="$STAMP" CANDIDATE="$CANDIDATE" \
    "$PHP_BIN" -r 'file_put_contents($argv[1], json_encode(["revision" => getenv("REVISION"), "candidate" => getenv("CANDIDATE") === "1", "built_at_utc" => getenv("STAMP"), "php_build_version" => PHP_VERSION], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES).PHP_EOL);' "$STAGE/BUILD-INFO.json"
"$PHP_BIN" "$ROOT/scripts/check-siteground-package.php" "$STAGE"

tar -czf "$ARCHIVE" -C "$STAGE" .
"$PHP_BIN" -r 'file_put_contents($argv[1].".sha256", hash_file("sha256", $argv[1])."  ".basename($argv[1]).PHP_EOL); echo "Paquete: ", $argv[1], PHP_EOL, "SHA256: ", hash_file("sha256", $argv[1]), PHP_EOL;' "$ARCHIVE"
