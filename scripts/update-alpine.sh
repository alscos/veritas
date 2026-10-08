#!/bin/sh
# Pull validated private GitHub releases, or install a ZIP verified locally.
set -eu
umask 077

operation=${1:-help}
case "$operation" in configure|check|update|install) ;; *)
    echo 'Uso: sh scripts/update-alpine.sh configure | check | update [build-SHA12] | install ARCHIVO.zip SHA256'
    exit 0 ;;
esac
root=${VERITAS_DIR:-/opt/veritas}
root=$(CDPATH= cd -- "$root" && pwd)
cd "$root"
test -f compose.yaml
test -f .env
old_image=$(docker inspect --format '{{.Image}}' veritas-app)
private="$root/data/app/update"
mkdir -p "$private"
chmod 700 "$private"
mkdir "$private/deploy-lock" 2>/dev/null || { echo 'Ya hay una actualización en curso. Si un proceso se interrumpió, revisar antes de retirar data/app/update/deploy-lock.' >&2; exit 1; }
maintenance=0
activated=0
backup=''
cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$result" -ne 0 ] && [ "$maintenance" -eq 1 ]; then
        if [ "$activated" -eq 0 ]; then
            docker compose exec -T app php artisan up >/dev/null 2>&1 && rm -f data/app/deploy-maintenance || true
        else
            echo "La aplicación sigue en mantenimiento. Copia privada: $backup. No se revierte la base de datos automáticamente." >&2
        fi
    fi
    rm -rf "$private/work"
    rmdir "$private/deploy-lock" 2>/dev/null || true
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
# Bootstrap from the current source, even when the running image predates the updater.
mkdir -p "$private/lib"
cp deploy/update-client.php "$private/update-client.php"
cp deploy/lib/UpdateSupport.php deploy/lib/GitHubRelease.php "$private/lib/"
helper() {
    docker run --rm --entrypoint php --volume "$root:/workspace" "$old_image" /workspace/data/app/update/update-client.php "$@"
}
if [ "$operation" = configure ]; then
    docker run --rm -it --entrypoint php --volume "$root:/workspace" "$old_image" /workspace/data/app/update/update-client.php configure
    exit
fi
if [ "$operation" = check ]; then helper check "${2:-}"; exit; fi
if [ -f data/app/deploy-maintenance ]; then echo 'Existe un despliegue pendiente en mantenimiento. Revisarlo antes de continuar.' >&2; exit 1; fi
mkdir "$private/work"
if [ "$operation" = install ]; then
    archive=${2:?Falta el ZIP}
    hash=${3:?Falta SHA256}
    cp "$archive" "$private/work/package.zip"
    revision=$(helper extract /workspace/data/app/update/work/package.zip "$hash")
else
    revision=$(helper fetch "${2:-}")
fi
case "$revision" in *[!a-f0-9]*|'') echo 'Revisión inválida.' >&2; exit 1 ;; esac
[ "${#revision}" -eq 40 ]
if [ -f "$private/installed-revision" ] && [ "$(cat "$private/installed-revision")" = "$revision" ]; then echo 'Esta revisión ya está instalada.'; exit; fi
stage="$private/work/source"
test -f "$stage/Dockerfile"
test -f "$stage/compose.yaml"
candidate="veritas-app:release-$revision"
echo "Construyendo $candidate; la aplicación actual sigue disponible."
docker build --tag "$candidate" --file "$stage/Dockerfile" "$stage"
docker compose exec -T app php -r '$c=stream_context_create(["http"=>["timeout"=>10,"ignore_errors"=>true]]); @file_get_contents("http://127.0.0.1/up",false,$c); exit(preg_match("~^HTTP/\\S+ 200~",$http_response_header[0]??"")?0:1);'
backup="${VERITAS_BACKUP_DIR:-/root}/inkgroove-backup-$(date -u +%Y%m%d-%H%M%S)-$(printf '%.12s' "$revision")"
mkdir "$backup"
echo "Copia privada: $backup"
docker image tag "$old_image" "veritas-app:backup-$(date -u +%Y%m%d-%H%M%S)"
printf '%s\n' "$old_image" > "$backup/previous-image.txt"
touch data/app/deploy-maintenance
maintenance=1
docker compose exec -T app php artisan down --retry=60
sleep 2
docker compose exec -T db sh -c 'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb-dump --single-transaction --quick --hex-blob --user="$MARIADB_USER" "$MARIADB_DATABASE"' > "$backup/database.sql"
test -s "$backup/database.sql"
tar --exclude='./data' --exclude='./vendor' --exclude='./node_modules' --exclude='./public/build' --exclude='./.git' -czf "$backup/source.tar.gz" .
tar --exclude='data/app/update' -czf "$backup/app-data.tar.gz" data/app
if [ -f "$private/config.json" ]; then cp "$private/config.json" "$backup/update-config.json"; fi
# From this point hold maintenance on any error: a partial activation needs review.
activated=1
helper apply
docker image tag "$candidate" veritas-app:latest
docker compose up -d --no-deps --no-build app
echo 'Esperando el arranque de Apache y las migraciones de la nueva versión.'
attempt=0
until docker compose exec -T app php -r '$c=stream_context_create(["http"=>["timeout"=>2,"ignore_errors"=>true]]); @file_get_contents("http://127.0.0.1/up",false,$c); exit(preg_match("~^HTTP/\\S+ 200~",$http_response_header[0]??"")?0:1);' >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        echo "La nueva versión no responde. Consulte docker compose logs app y $backup." >&2
        docker compose ps >&2 || true
        docker compose logs --tail=60 app >&2 || true
        exit 1
    fi
    sleep 2
done
docker compose exec -T app php artisan migrate:status
docker compose exec -T app php artisan up
rm -f data/app/deploy-maintenance
maintenance=0
printf '%s\n' "$revision" > "$private/installed-revision"
docker compose ps
echo "Instalada $(printf '%.12s' "$revision"). Copia: $backup"
