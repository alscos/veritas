#!/bin/sh
# CI only: build the actual private release ZIP and boot Apache against CI MySQL.
# Requires an isolated Linux runner with MySQL on 127.0.0.1:3306; never run on a live server.
set -eu
: "${INKGROOVE_DOCKER_SMOKE_CI:?Run this smoke test only on an isolated CI runner}"
: "${DB_DATABASE:?Define the CI database}"
: "${DB_USERNAME:?Define the CI database user}"
: "${DB_PASSWORD:?Define the CI database password}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
archive=${1:?Provide the Alpine release ZIP}
php_bin=${PHP_BIN:-php}
work=$(mktemp -d)
container=''
volume=''
image="inkgroove-runtime-smoke:$(date +%s)-$$"
cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ -n "$container" ]; then
        if [ "$result" -ne 0 ]; then docker logs --tail=100 "$container" >&2 || true; fi
        docker rm -f "$container" >/dev/null 2>&1 || true
    fi
    if [ -n "$volume" ]; then docker volume rm "$volume" >/dev/null 2>&1 || true; fi
    docker image rm "$image" >/dev/null 2>&1 || true
    rm -rf "$work"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
hash=$(sha256sum "$archive" | cut -d ' ' -f 1)
"$php_bin" -r '
require $argv[1]."/deploy/lib/UpdateSupport.php";
umask(0077);
InkGroove\Deploy\UpdateSupport::extract($argv[2], $argv[3], $argv[4], "alpine");
' "$root" "$archive" "$hash" "$work/source"
docker build --tag "$image" --file "$work/source/Dockerfile" "$work/source"
# Match the updater's persistent maintenance marker from the first boot.
volume="${image#*:}-data"
docker volume create "$volume" >/dev/null
docker run --rm --entrypoint sh --volume "$volume:/data" "$image" -c 'touch /data/deploy-maintenance'
container=$(docker run --detach --network host --volume "$volume:/data" \
    --env DB_HOST=127.0.0.1 --env DB_PORT=3306 \
    --env DB_DATABASE --env DB_USERNAME --env DB_PASSWORD \
    --env APP_URL=http://localhost --env SESSION_SECURE_COOKIE=false "$image")
http_status() {
    docker exec "$container" php -r '
    $context = stream_context_create(["http" => ["timeout" => 2, "ignore_errors" => true, "follow_location" => 0]]);
    $response = @fopen("http://127.0.0.1".$argv[1], "rb", false, $context);
    if ($response) fclose($response);
    preg_match("~^HTTP/\\S+ ([0-9]{3})~", $http_response_header[0] ?? "", $match);
    $status = $match[1] ?? "0";
    echo $argv[1].": HTTP ".$status.PHP_EOL;
    exit($status === $argv[2] ? 0 : 1);
    ' "$1" "$2"
}
attempt=0
until http_status /up 200 >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then echo 'The packaged Docker runtime did not boot.' >&2; exit 1; fi
    sleep 2
done
docker exec "$container" php artisan list --raw >/dev/null
docker exec --user www-data "$container" php -r '
foreach (["composer.json", "app/Console/Commands/HostingPreflight.php", "bootstrap/app.php", "vendor/autoload.php", "public/index.php"] as $file) {
    if (!is_readable($file)) throw new RuntimeException("Apache cannot read ".$file);
}
'
http_status /up 200
http_status / 503
docker exec "$container" php artisan up
http_status / 200
assets=$(docker exec --user www-data "$container" php -r '
$manifest = json_decode(file_get_contents("public/build/manifest.json"), true, flags: JSON_THROW_ON_ERROR);
if (empty($manifest["resources/js/main.tsx"]["css"])) throw new RuntimeException("Missing Vite entry");
$paths = [];
foreach ($manifest as $entry) {
    foreach (array_merge([$entry["file"]], $entry["css"] ?? [], $entry["assets"] ?? []) as $path) $paths[$path] = true;
}
foreach (array_keys($paths) as $path) {
    if (!is_readable("public/build/".$path)) throw new RuntimeException("Apache cannot read asset ".$path);
    echo "/build/".$path.PHP_EOL;
}
')
printf '%s\n' "$assets" | while IFS= read -r asset; do http_status "$asset" 200; done
docker exec "$container" php artisan down --retry=60
http_status /up 200
http_status / 503
echo 'Packaged Docker runtime: CLI, Apache, assets and maintenance OK.'
docker rm -f "$container" >/dev/null
container=''
