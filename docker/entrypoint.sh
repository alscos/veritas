#!/bin/sh
set -eu

mkdir -p /data storage/app storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs
: "${DB_PASSWORD:?DB_PASSWORD es obligatorio}"

if [ ! -f /data/veritas.env ]; then
    app_key="base64:$(openssl rand -base64 32)"
    signing_key="$(openssl rand -hex 48)"
    cat > /data/veritas.env <<EOF
APP_NAME=InkGroove
APP_ENV=production
APP_KEY=${app_key}
APP_DEBUG=false
APP_URL=${APP_URL:-http://localhost:8080}
LOG_CHANNEL=stderr
LOG_LEVEL=warning
DB_CONNECTION=mysql
DB_HOST=${DB_HOST:-db}
DB_PORT=${DB_PORT:-3306}
DB_DATABASE=${DB_DATABASE:-veritas}
DB_USERNAME=${DB_USERNAME:-veritas}
DB_PASSWORD=${DB_PASSWORD}
SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_ENCRYPT=true
SESSION_SECURE_COOKIE=${SESSION_SECURE_COOKIE:-false}
SESSION_SAME_SITE=lax
VERITAS_SIGNING_KEY=${signing_key}
EOF
    chmod 600 /data/veritas.env
fi

ln -sf /data/veritas.env /var/www/html/.env
chown -R www-data:www-data /data storage

attempt=0
until mariadb-admin ping --silent --host="${DB_HOST:-db}" --port="${DB_PORT:-3306}" --user="${DB_USERNAME:-veritas}" --password="${DB_PASSWORD}"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 40 ]; then
        echo "No se pudo conectar con MySQL después de 80 segundos." >&2
        exit 1
    fi
    sleep 2
done

if [ -f /data/deploy-maintenance ]; then php artisan down --retry=60; fi
php artisan migrate --force
php artisan config:cache
php artisan route:cache

exec "$@"
