#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$root/../releases"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
php_bin=${PHP_BIN:-php}
revision=$(git -C "$root" rev-parse HEAD)
if [ -n "$(git -C "$root" status --porcelain)" ]; then echo 'Cerrar el commit antes de empaquetar Alpine.' >&2; exit 1; fi
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
git -C "$root" archive --format=tar HEAD | tar -xf - -C "$stage"
REVISION="$revision" "$php_bin" -r 'file_put_contents($argv[1], json_encode(["profile"=>"alpine","revision"=>getenv("REVISION"),"candidate"=>false,"built_at_utc"=>gmdate(DATE_ATOM)], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES).PHP_EOL);' "$stage/BUILD-INFO.json"
"$php_bin" "$root/scripts/make-release-zip.php" "$stage" "$out/inkgroove-alpine-$(printf '%.12s' "$revision").zip"
