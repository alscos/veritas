#!/bin/sh
# Update an existing Docker installation after a private backup.
set -eu
umask 077

archive=${1:?Uso: sh upgrade-editor-workspace.sh /root/actualizacion.tar.gz}
case "$archive" in /*) ;; *) archive="$(pwd)/$archive" ;; esac
[ -f "$archive" ] || { echo "No existe el archivo: $archive" >&2; exit 1; }
cd "${VERITAS_DIR:-/opt/veritas}"
[ -f compose.yaml ] || { echo "No se encuentra compose.yaml." >&2; exit 1; }

timestamp=$(date +%Y%m%d-%H%M%S)
backup="${VERITAS_BACKUP_DIR:-/root}/veritas-backup-$timestamp"
mkdir "$backup"
echo "Creando copia de seguridad en $backup"
docker compose exec -T db sh -c 'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb-dump --single-transaction --user="$MARIADB_USER" "$MARIADB_DATABASE"' > "$backup/database.sql"
[ -s "$backup/database.sql" ]
tar --exclude='./data' --exclude='./vendor' --exclude='./node_modules' --exclude='./public/build' --exclude='./.git' -czf "$backup/source.tar.gz" .
if [ -d data/app ]; then tar -czf "$backup/app-data.tar.gz" data/app; fi
previous_image="veritas-app:backup-$timestamp"
docker image tag "$(docker inspect --format '{{.Image}}' veritas-app)" "$previous_image"
printf '%s\n' "$previous_image" > "$backup/previous-image.txt"

tar -xzf "$archive"
docker compose build app
docker compose up -d --no-deps app

attempt=0
until docker compose exec -T app php -r '$context = stream_context_create(["http" => ["timeout" => 2]]); exit(@file_get_contents("http://127.0.0.1/", false, $context) === false ? 1 : 0);' >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 20 ]; then
        docker compose logs --tail=60 app
        echo "La aplicación todavía no responde. La copia está en $backup; imagen anterior: $previous_image" >&2
        exit 1
    fi
    sleep 2
done
docker compose exec -T app php artisan migrate:status
docker compose ps
docker compose logs --tail=40 app
printf '\nActualización terminada. Copia: %s\nHaz una recarga completa del navegador y prueba un documento nuevo.\n' "$backup"
