# Instalación

## SiteGround GrowBig

Para el perfil de hosting compartido, el paquete compilado y los pasos de instalación y validación, ver [docs/SITEGROUND.md](docs/SITEGROUND.md). El núcleo de Laravel se mantiene fuera de `public_html`.

## Docker sobre Epheso/Alpine

El sistema operativo anfitrión puede ser Alpine Linux. Las imágenes de Veritas encapsulan Apache, PHP y MariaDB; no es necesario que la imagen de aplicación utilice la misma distribución que el anfitrión.

1. Descomprime el paquete y entra en su directorio.
2. Crea `.env` junto a `compose.yaml`:

```dotenv
APP_URL=http://192.168.1.50:8080
VERITAS_PORT=8080
DB_DATABASE=veritas
DB_USERNAME=veritas
DB_PASSWORD=cambia-esta-clave
DB_ROOT_PASSWORD=cambia-tambien-esta-clave
SESSION_SECURE_COOKIE=false
```

3. Construye y arranca:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Los datos persistentes se guardan bajo `./data`. El primer arranque crea claves privadas en `./data/app/veritas.env`; incluye ese archivo en las copias de seguridad y no lo publiques en Git.

Para una instalación expuesta a Internet configura un proxy HTTPS, cambia `APP_URL`, establece `SESSION_SECURE_COOKIE=true` y restringe el acceso directo al puerto de Veritas.

## Actualización

Antes de actualizar:

```bash
docker compose exec db mariadb-dump -u root -p veritas > veritas-backup.sql
tar -czf veritas-app-data.tgz data/app
```

Después de sustituir el código:

```bash
docker compose up --build -d
```

Las migraciones se aplican automáticamente sin borrar documentos existentes.

## Instalación LAMP

Requisitos mínimos:

- PHP 8.3 o posterior con `pdo_mysql`, `mbstring`, `intl`, `dom`, `openssl` y `zip`;
- MySQL 8 o MariaDB 10.11 o posterior;
- Apache con `mod_rewrite` y encabezados, o Nginx equivalente;
- HTTPS para producción;
- Composer durante la preparación del paquete.

Proceso:

```bash
composer install --no-dev --optimize-autoloader
npm ci
npm run build
cp .env.example .env
php artisan key:generate
php artisan migrate --force
php artisan config:cache
php artisan route:cache
```

El `DocumentRoot` del dominio debe apuntar exclusivamente a `public/`, nunca a la raíz del repositorio. Da permiso de escritura al usuario de PHP sobre `storage/` y `bootstrap/cache/`.

Node no es necesario en producción una vez compilado `public/build`.

## Repositorio privado

El proyecto está preparado para Git. Antes de subirlo comprueba que `.env`, `data/`, `vendor/`, `node_modules/` y los registros siguen ignorados. No cambies ni publiques `VERITAS_SIGNING_KEY`: perderla invalida la comprobación de certificados anteriores y divulgarla permitiría fabricar firmas.
