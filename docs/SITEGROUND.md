# InkGroove en SiteGround GrowBig

Candidato para una demo o piloto pequeño. Este perfil mantiene Laravel 12, PHP 8.3+, MySQL/MariaDB y el editor React/Tiptap. El frontend se compila antes de subirlo; el hosting no necesita Docker, Node, Redis ni un proceso permanente de colas para las funciones actuales. La instalación real se valida en la cuenta de SiteGround antes de marcar una versión como probada allí.

Validación local del candidato: compilación de producción, 20 pruebas del frontend, 7 pruebas PHP, fuentes españolas y ensayo del paquete con el núcleo separado y configuración, rutas y vistas cacheadas. El ensayo local usa SQLite; quedan pendientes MySQL, Apache/caché y SSL de SiteGround. Las pruebas se amplían o repiten si aparecen cambios o errores que lo justifiquen.

## Qué cambia

- HTML y API, incluidos errores de sesión, responden con `Cache-Control: private, no-store`. No deben pasar por una caché de páginas compartida.
- JavaScript, CSS, fuentes y logos tienen nombres con hash y un manifiesto Vite. El editor continúa cargándose bajo demanda. Apache permite caché prolongada para esos archivos versionados.
- El perfil usa caché de Laravel en archivos, sesiones cifradas en la base de datos, cookies seguras y logs diarios con retención de 14 días.
- El paquete contiene dependencias PHP de producción y recursos compilados. Omite `.env`, bases de datos locales, imágenes de usuarios, historial Git, Node y dependencias de pruebas.
- Las fuentes españolas y el nuevo logo se incluyen, con la licencia de la fuente. Los identificadores internos de Veritas se mantienen para conservar las sesiones, recuperación local y sellos existentes.

## Preparar y cerrar el commit

En la máquina de desarrollo, con Node 22, PHP 8.3+ y Composer 2:

```sh
npm ci
npm test
npm run build
php vendor/bin/phpunit
python3 scripts/check-selectric-es.py
git diff --check
git status --short
```

El último comprobador necesita `fontTools` y Pillow con RAQM solo en desarrollo. Revisar que los cambios correspondan a la marca y al perfil de hosting; nunca añadir `.env`, `data/` ni claves SSH. Título sugerido: `Prepare InkGroove branding and SiteGround deployment`. La rama de trabajo actual es `feature/editor-core`; no se debe sobrescribir `main` ni forzar un push.

Después del commit, crear el paquete:

```sh
sh scripts/package-siteground.sh ../releases
```

La herramienta vuelve a compilar, instala Composer sin dependencias de desarrollo en un directorio temporal y comprueba el contenido real. Requiere haber instalado las dependencias de Node (`npm ci`). No modifica el `vendor` de trabajo. Para ensayar antes del commit admite `--candidate`; ese archivo queda expresamente identificado como candidato, no como el contenido exacto de un commit. Se generan un `.tar.gz`, su SHA256, `BUILD-INFO.json` y un inventario de hashes de los archivos.

Publicar la rama en el repositorio privado desde el Mac, con su acceso SSH ya configurado. Crear una etiqueta de release únicamente después de la prueba en SiteGround. La primera instalación debe usar una base nueva: una migración de los datos y certificados de Alpine requiere conservar sus claves originales y un procedimiento aparte.

## Preparar la cuenta

1. Asociar el dominio comprado a un sitio nuevo en GrowBig. No instalar WordPress para esta aplicación. Si el dominio está en otro registrador, configurar el DNS con los valores que indique SiteGround.
2. Activar SSL para ese dominio y la redirección HTTPS en Site Tools. Decidir un único hostname canónico (con o sin `www`) y usarlo en `APP_URL`.
3. En **Devs → PHP Manager**, seleccionar PHP 8.3 o una versión superior compatible con el lockfile. Comprobar también por SSH el PHP CLI; la selección del PHP web no garantiza que `php` en consola sea el mismo ejecutable.
4. Crear una base MySQL y un usuario con permisos sobre ella en **Site → MySQL**. Guardar sus nombres, contraseña y host en el archivo privado de configuración. No usar el usuario de otra web ni copiar credenciales aquí o a GitHub.
5. Activar SSH en **Devs → SSH Keys Manager**. Usar el host, usuario, puerto y ruta que muestre Site Tools; no son los del Alpine.

## Ubicación de los archivos

Usar el directorio del dominio que SiteGround muestre realmente. El diseño del paquete es:

| Carpeta | Contenido | Acceso web |
|---|---|---|
| `DOMINIO/inkgroove/` | Laravel, `vendor`, `.env`, almacenamiento privado | Fuera de `public_html` |
| `DOMINIO/public_html/` | Entrada PHP, favicon y `build/` compilado | Público |

`public_html/index.php` busca el núcleo en la carpeta hermana `inkgroove/`. No subir el repositorio entero a `public_html`. La cuenta debe permitir PHP leer y escribir en esa carpeta hermana; comprobarlo en la prueba real. Si la cuenta impone un `open_basedir` que lo impide, ajustar la ubicación autorizada con SiteGround antes de desplegar.

## Primera instalación

Estas instrucciones son para un sitio nuevo. Antes de actualizar una instalación existente, seguir el apartado de actualización. Sustituir las rutas y nombres de archivo por los datos reales; no ejecutar los marcadores literalmente.

1. Subir el paquete y su `.sha256` por SFTP/SSH al directorio del dominio, fuera de `public_html`.
2. En ese directorio, comprobar el SHA256 y descomprimir. El paquete rellena `inkgroove/` y `public_html/`; no debe aplicarse encima de otra web.

```sh
sha256sum -c inkgroove-siteground-COMMIT.tar.gz.sha256
tar -xzf inkgroove-siteground-COMMIT.tar.gz
sha256sum -c FILES.sha256
cd inkgroove
cp deploy/siteground/env.example .env
chmod 600 .env
```

Si la utilidad SHA256 no está disponible, verificar con `shasum -a 256` o `php -r 'echo hash_file("sha256", $argv[1]), PHP_EOL;' ARCHIVO` y comparar el resultado antes de extraer.

3. Editar `.env` con el dominio HTTPS real, la ruta absoluta de `public_html` en `INKGROOVE_PUBLIC_PATH` y las credenciales de la base nueva. Los ejemplos `YOUR.DOMAIN`, `ACCOUNT` y `REPLACE_*` son marcadores. La contraseña puede ir entre comillas dobles; usar un editor de texto, sin interpolación del shell.
4. Generar las claves **solo para esta instalación nueva**:

```sh
php artisan key:generate --force
php -r '$p=".env"; $s=file_get_contents($p); if (!preg_match("/^VERITAS_SIGNING_KEY=[ \t]*$/m", $s)) exit(1); file_put_contents($p, preg_replace("/^VERITAS_SIGNING_KEY=[ \t]*$/m", "VERITAS_SIGNING_KEY=".bin2hex(random_bytes(32)), $s));'
```

La segunda orden escribe la clave sin mostrarla y se niega a reemplazar una ya configurada. Guardar una copia privada de `.env`. Cambiar esas claves en una actualización puede invalidar sesiones o la verificación de sellos previos.

5. El PHP web debe poder escribir en `storage/` y `bootstrap/cache/` como el propietario de la cuenta. Con los permisos normales del mismo usuario suelen bastar directorios `755` y archivos `644`; `.env` se mantiene en `600`. Comprobar escritura real, sin aplicar `777`.
6. Comprobar y activar:

```sh
php artisan inkgroove:preflight
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan inkgroove:preflight
```

Si `php` es anterior a 8.3, usar en todas las órdenes el ejecutable PHP 8.3+ indicado por SiteGround. El comprobador revisa CLI, extensiones, configuración, rutas, recursos compilados, claves, UTF-8, conexión y tamaño estimado de MySQL; no muestra secretos. No sustituye las pruebas del PHP web, SSL, permisos y caché reales.

La migración de documentos usa `DEFAULT ('')` para las columnas LONGTEXT: MySQL 8.0.13+ exige una expresión entre paréntesis incluso para el valor vacío. Si una instalación con el paquete anterior falla con el error 1101 al crear `documents`, sustituir `database/migrations/2026_09_19_000002_create_document_tables.php` por la versión corregida y volver a ejecutar `php artisan migrate --force`. Laravel conserva la migración de identidad ya completada y continúa con las pendientes. No regenerar claves ni usar `migrate:fresh` para este error.

7. Vaciar una vez **Speed → Caching → Dynamic Cache → Flush Cache** y la CDN si está activada. Verificar que la caché de páginas no almacena las respuestas de la aplicación. Los recursos estáticos pueden conservar su caché.
8. Visitar `https://DOMINIO/up` y después el inicio. Revisar los errores de Laravel en `inkgroove/storage/logs/laravel-AAAA-MM-DD.log`, que no debe ser accesible por HTTP. No dejar un `phpinfo()` público.

## Validación para dar la versión por instalada

- Crear cuenta de prueba y documento vacío: sin `undefined`, PPM coherente y sesión guardada.
- Escribir español (`áéíóúñü ¿¡`), varios saltos de línea y formato; guardar, recargar y reabrir sin cambios.
- Pegar un párrafo y editar unas palabras: solo esas modificaciones pasan a azul; el resto conserva su origen.
- Añadir imagen privada, carpeta y tamaño de hoja; comprobar que otro usuario no puede acceder al documento ni a su imagen.
- Abrir la moviola y volver al editor sin perder contenido ni eventos. Revisar tiempos, pausas y orden de eventos.
- Sellar una versión, editar el borrador y comprobar que el sello anterior sigue verificándose y su versión no cambia.
- Exportar ODT/RTF; abrirlos en un editor de escritorio, comprobando texto y saltos.
- Dejar caducar la sesión: al volver, identificar al usuario sin recargar manualmente ni perder un borrador pendiente.
- Comprobar dos navegadores con cuentas distintas: no compartir HTML con datos de otro usuario ni tokens CSRF por la caché. En Network, HTML y API deben llevar `private, no-store`.
- En móvil: logo legible, controles utilizables y sin desbordamiento de la página.

Estas pruebas deben completarse en SiteGround antes de etiquetar el commit como probado en ese proveedor. La comprobación local del paquete no mide su capacidad con usuarios simultáneos.

## Actualizaciones y vuelta atrás

Crear una copia verificable de la base de datos, del núcleo, de `public_html`, de las imágenes privadas y de `.env` antes de actualizar. Comprobar que el backup cubre también la carpeta hermana `inkgroove/`, no solo la web pública. Guardar el paquete previo, su hash y `BUILD-INFO.json`.

Cerrar las sesiones de edición o avisar a los usuarios y poner la aplicación en mantenimiento (`php artisan down`). Sustituir el código y dependencias conservando `.env`, `storage/app/` y los demás datos privados. No regenerar claves. Copiar los recursos del nuevo `public_html/build/` **sin borrar los anteriores todavía**: una pestaña abierta puede necesitar cargar un chunk del editor de la versión anterior. Generar la nueva configuración, rutas y vistas cacheadas en el servidor, ejecutar las migraciones revisadas y el comprobador, y levantar (`php artisan up`). Purgar la caché dinámica y comprobar la aceptación.

La reversión repone el código y recursos anteriores junto con sus claves y datos compatibles. Si hubo cambios de esquema incompatibles, restaurar también la copia de la base tras evaluar la pérdida de escrituras posteriores; no ejecutar `migrate:rollback` a ciegas. El instalador no ejecuta migraciones destructivas ni borrados de datos automáticamente.

## Capacidad y siguientes mejoras

GrowBig publica **1000 MB por base de datos**. Hoy se conserva el HTML completo tras cada evento de escritura: eso facilita la reconstrucción pero repite mucho contenido. El cambio de caché y el frontend versionado no eliminan ese crecimiento. No debe prometerse una capacidad de alumnos o escritores sin medir una sesión representativa y las métricas de CPU, disco e inodos de la cuenta.

Prioridad siguiente, antes de abrir un servicio amplio:

1. Compactar el registro sin pérdidas, mediante compresión o diferencias más checkpoints. Conservar tiempos, procedencia, secuencias y verificabilidad de registros y sellos existentes; no agrupar eventos descartando la granularidad ni borrar el historial para ahorrar espacio.
2. Paginar la moviola: la consulta actual tiene un límite de 10 000 eventos. Probar reconstrucción completa de documentos largos y varias sesiones.
3. Medir el tamaño real del registro y latencia de guardado en MySQL, además de una prueba con usuarios simultáneos. Definir alertas de capacidad y cuándo pasar a un servidor con más recursos.
4. Para una beta pública: terminar recuperación de contraseña y verificación de correo, protección de altas, política de conservación y revisión de seguridad del flujo de documentos y certificados.

El primer despliegue se orienta a enseñar el editor y reunir resultados de un piloto acotado. No convierte el sello técnico en una garantía absoluta de autoría humana.

## Referencias consultadas (8 de octubre de 2026)

- SiteGround y Laravel: <https://es.siteground.com/kb/instalar-laravel/>
- Caché de una aplicación que no es WordPress: <https://www.siteground.com/kb/disable-dynamic-caching-website/>
- Límite de tamaño de MySQL: <https://www.siteground.com/kb/reduce-database-size/>
- Despliegue de Laravel 12: <https://laravel.com/docs/12.x/deployment>
- Manifiesto y carga de recursos Vite: <https://laravel.com/docs/12.x/vite>
