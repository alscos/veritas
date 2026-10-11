# Desarrollo en el Mac y ejecución en Alpine

Editar en `~/Documents/veritas`. Los comandos siguientes se ejecutan desde esa
carpeta del Mac y utilizan el alias SSH `inkgroove-alpine`. No requieren PHP,
Composer, Node ni Docker locales.

## Preparación y sincronización

```sh
sh scripts/dev-remote.sh sync
sh scripts/dev-remote.sh init
sh scripts/dev-remote.sh build-tools
sh scripts/dev-remote.sh install
sh scripts/dev-remote.sh versions
```

`sync` copia el árbol de trabajo, incluidos archivos nuevos y cambios sin commit,
a `/opt/veritas-dev`. Excluye configuraciones privadas, `.git`, secretos,
dependencias, datos y cachés; permite `.env.example`. Los archivos remotos
reemplazados quedan en `.dev-backups/FECHA`. No elimina archivos remotos ausentes
en el Mac: revisar expresamente las eliminaciones/renombrados para evitar código
obsoleto; nunca borrar datos o secretos al reconciliar el código.

`init` genera secretos exclusivos con permisos 600 en `.dev-private/`, conserva
los existentes y recrea directorios de Laravel. No mostrar esos archivos ni la
salida completa de `docker compose config` o `docker inspect`: pueden revelar
credenciales. `config --quiet` valida sin imprimirlas.

`build-tools` construye primero PHP 8.3/Composer 2/Python 3, después Node 22 y
Chromium y por último la imagen MariaDB dev. El navegador se instala mediante la versión de Playwright extraída
del lockfile; `install` instala dependencias completas usando ambos lockfiles.
Repetir `build-tools` si cambia Playwright o los Dockerfiles, e `install` si
cambian dependencias. Las compilaciones de extensiones PHP usan un solo trabajo.

## Pruebas y compilación

```sh
sh scripts/dev-remote.sh frontend
sh scripts/dev-remote.sh build
sh scripts/dev-remote.sh phpunit
sh scripts/dev-remote.sh updaters
sh scripts/dev-remote.sh browser
sh scripts/dev-remote.sh smoke
# Equivalente: ejecuta los seis pasos secuencialmente y para al primer fallo.
sh scripts/dev-remote.sh test
```

Los runners son contenedores efímeros con `run --rm`, perfil `tools`, sin socket
Docker. El simulador de actualización usa Docker simulado, nunca el daemon real.
Vitest usa un worker. Node limita su heap a 512 MiB; PHP y Composer usan 512 MiB.
Apache tiene dos workers como máximo y MariaDB un buffer pool de 96 MiB.
El diagnóstico corrigió `ServerLimit 1 / MaxRequestWorkers 8`, que daba un
único worker efectivo; comparación y límites en
[PERFORMANCE_BOTTLENECKS.md](PERFORMANCE_BOTTLENECKS.md).
Este Alpine no delega los controladores cgroup al subgrupo Docker: aunque
`docker info` anuncia soporte, `mem_limit` falla al crear el contenedor porque
no existe `memory.max`. No se cambió la configuración del host. Los límites
internos anteriores no limitan el RSS completo del contenedor ni Chromium.
Comprobar RAM, swap y disco antes de ejecutar tareas pesadas y no lanzarlas en
paralelo; tampoco hay un límite global para los procesos de Docker BuildKit.

PHPUnit usa SQLite en memoria. `smoke` arranca la MariaDB dev, crea una base
`inkgroove_check` y un usuario que solo tiene permisos en esa base, aplica sus
migraciones y comprueba defaults y Unicode. La aplicación usa `inkgroove_dev`
con otro usuario y otra contraseña. Ambas están en una MariaDB independiente
de la instalación actual. La prueba de Chromium usa la API controlada del
proyecto; no sustituye la prueba integral de Laravel ni el teclado físico/Safari.

No ejecutar `scripts/check-alpine-runtime.sh` en este servidor compartido: es
exclusivo de un runner CI aislado y utiliza red host.

## Arranque, acceso y parada

```sh
sh scripts/dev-remote.sh up
sh scripts/dev-remote.sh status
/usr/bin/ssh -N -L 127.0.0.1:8083:127.0.0.1:8083 inkgroove-alpine
# Abrir http://localhost:8083 en el Mac; cerrar el túnel con Ctrl-C.
sh scripts/dev-remote.sh stop
```

`up` necesita haber completado `install` y `build`; aplica migraciones únicamente
en la base de la aplicación dev. La aplicación sirve directamente el código
sincronizado y los activos compilados remotos con Apache; no necesita Vite
permanente. Si cambia código, sincronizar y repetir las comprobaciones afectadas.
Si cambian dependencias o activos, reinstalar/compilar antes de volver a probar.
`stop` detiene solo app/db de desarrollo y conserva los volúmenes y secretos.

Compose es independiente: `compose.dev.yaml`, proyecto `inkgroove-dev`, red
`inkgroove-dev_default`, contenedores `inkgroove-dev-app` y `inkgroove-dev-db`,
imágenes `inkgroove-dev-php:local`, `inkgroove-dev-node:local` e
`inkgroove-dev-db:local` (basada en MariaDB 11.4), volúmenes
`inkgroove-dev_mysql`, `inkgroove-dev_vendor`, `inkgroove-dev_node_modules`.
La aplicación solo publica `127.0.0.1:8083`; la base no publica puertos.
Las claves, cookies y datos son exclusivos de dev. No se reutilizan `.env`,
imágenes ni rutas de datos de `/opt/veritas`.

Los scripts fijan ruta, proyecto y archivo Compose; no usan el Compose de
producción ni actualizadores. No hacer limpiezas globales de Docker, ejecutar
`down -v`, ni montar el socket del daemon en los runners.

## Evidencias

La preparación y los resultados concretos se registran en `AGENTS.md`.
El diagnóstico inicial del 10 de octubre de 2026 observó dos CPU visibles,
1278 MiB de RAM disponible según `free` y 32 GiB de disco libre. La RAM
reportada es compartida/no reservada: cgroup no fija techo y Docker stats no
informa un límite fiable de memoria. Volver a medir antes de cada sesión.

## Historial: comprobación contra PHP/MariaDB reales

Tras sincronizar y compilar, con app/db saludables, estos pasos son secuenciales:

```sh
sh scripts/dev-remote.sh history-seed-large
sh scripts/dev-remote.sh history-browser
sh scripts/dev-remote.sh history-outsider
# HTTP desde el Mac por un túnel en otra terminal:
/usr/bin/ssh -N -L 127.0.0.1:18083:127.0.0.1:8083 inkgroove-alpine
python3 scripts/check-dev-history-http.py http://127.0.0.1:18083 EMAIL_FIXTURE EMAIL_OUTSIDER DOCUMENT_ID
sh scripts/dev-remote.sh history-integrity
sh scripts/dev-remote.sh history-clean
```

`history-seed-large` crea 25.000 eventos en cinco sesiones, con HTML pequeño;
`history-seed-small` crea 2.000 eventos en dos sesiones con texto de unas 600
palabras. No ejecutar ambos sin limpiar el primero. El script exige ambiente
`local` y base `inkgroove_dev`, genera usuarios/documentos exclusivos y registra
sus IDs en `storage/app/history-benchmark.json` (600). La salida identifica solo
estos datos ficticios. Su contraseña de prueba es `Fictitious12345`.
`history-outsider` añade un segundo usuario ficticio al manifiesto.
`history-clean` coteja ID y correo, elimina exclusivamente los usuarios
registrados, sus sesiones de autenticación y sus documentos por cascada, y
retira el manifiesto. No toca otros usuarios ni limpia cachés globales.
No se crean entregas con restricciones de borrado en este fixture.

`history-browser` usa Chromium contra `http://app` en la red de desarrollo,
sin interceptar la API: escribe mientras llegan los metadatos, guarda, navega,
reproduce, comprueba que la moviola no escribe y reabre. `history-integrity`
recalcula cada HMAC, las cabezas de sesión y los sellos del documento ficticio.
El script HTTP comprueba permisos y emite un sello exclusivamente en el fixture.

Para medir tres primeras aperturas y tres reaperturas sobre el fixture pequeño:

```sh
sh scripts/dev-remote.sh history-seed-small
sh scripts/dev-remote.sh history-benchmark
python3 scripts/measure-dev-http.py http://127.0.0.1:18083 EMAIL_FIXTURE DOCUMENT_ID '?metadata=1' --all
sh scripts/dev-remote.sh history-integrity
sh scripts/dev-remote.sh history-clean
```

`history-benchmark` limita Chromium a 10 Mbit/s y 40 ms; cada primera apertura
usa un contexto nuevo, cada reapertura conserva el motor/caché de ese contexto.
Mide editor disponible y métricas completas por separado. La cifra `bytes` es
la suma CDP de respuestas terminadas hasta completar métricas e incluye activos,
detalle e historial; no equivale a bytes exclusivos del timeline. HTTP desde el
Mac mide exclusivamente el cuerpo de una página, por SSH sin limitación de red.
El heap CDP es una muestra sin forzar GC; Docker stats no mide memoria de forma
fiable en este host. Condiciones y resultados en
[DOCUMENT_OPEN_PERFORMANCE.md](DOCUMENT_OPEN_PERFORMANCE.md).

Vitest busca tests únicamente en `resources/js`, para no ejecutar copias
incompletas conservadas por `sync` en `.dev-backups`.

## Privacidad: fixture y navegador real

```sh
sh scripts/dev-remote.sh privacy-seed
sh scripts/dev-remote.sh privacy-browser
sh scripts/dev-remote.sh privacy-clean
```

Usa cuatro cuentas ficticias, un documento y una versión de formato antiguo;
registra sus IDs en `storage/app/privacy-fixture.json` (600). El navegador crea
sellos/entregas y dos imágenes exclusivamente de esos usuarios. Comprueba lectura
por versión, tercero excluido, cursores, imágenes, firmas, carreras de ingesta/
guardado/sello, caducidad y recuperación en el mismo contexto y una respuesta
PHP real retenida hasta después de cambiar de cuenta. Esta última usa Playwright
para retrasar una respuesta real; no sustituye su cuerpo por una API simulada.
Respeta el rate limit de login esperando en intervalos de 15 segundos. La limpieza
coteja ID y correo del manifiesto; elimina sus entregas antes de borrar sus datos,
y sólo los archivos de imágenes y sesiones de esas cuentas ficticias.

## Concurrencia y recuperación

El contrato, comandos del recorrido Chromium contra PHP/MariaDB y tratamiento
de eventos en conflicto están en [CONCURRENCY_RECOVERY.md](CONCURRENCY_RECOVERY.md).
`concurrency-migrate` aplica las migraciones compatibles sólo a dev; el runner
`smoke` las aplica también a su base independiente. `concurrency-browser` usa el
manifiesto de `privacy-seed`; `concurrency-integrity` verifica las cadenas de ese
fixture y `privacy-clean` retira exclusivamente sus datos. Ejecutar los pasos
secuencialmente y no repetir `seed` si existe un manifiesto.

## Copia y restauración aislada

El procedimiento reproducible, scripts, resultados MariaDB/Docker y límites
de recuperación están en [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Usa proyectos
y directorios propios; no restaura sobre desarrollo ni producción.

## Capacidad y crecimiento del almacenamiento

Herramientas, guardas, perfiles HTTP reales, intentos de navegador, proyecciones
y cierre del ensayo en [CAPACITY_AND_STORAGE.md](CAPACITY_AND_STORAGE.md).
El último nivel estable del perfil corto fue cinco escritores más profesor;
quince/treinta fallaron criterios de latencia y no se ejecutaron niveles mayores.
No acredita una clase de treinta ni capacidad equivalente en SiteGround.

## Un Chromium real acotado (contrato del 11-10-2026)

```sh
sh scripts/dev-remote.sh sync
sh scripts/dev-remote.sh chromium-real
```

Sólo con la autorización y límites de [GOAL_CHROMIUM_REAL](GOAL_CHROMIUM_REAL.md).
Usa el servicio Node existente con `run --rm --no-deps`, un contexto Chromium,
un autor y un fixture propio de 1.800 eventos (techo total 2.000). No modifica
workers, instala dependencias, reconstruye imágenes o ejecuta migraciones.
La API es real sin interceptar rutas; CDP limita 10 Mbit/s y 40 ms después del
login. Guardas de capacidad existentes intactas; el supervisor sólo detiene su
runner inventariado. Sondeos de salud no simulan la API editorial.

Inventario previo `storage/app/chromium-real.json`; sesiones propias registradas
por hashes exactos mediante un prepend temporal exclusivo de Apache dev. Se
retira al cerrar. Fases, inicio/fin y consumo persistente en
`.dev-private/chromium-real/ledger.json`, después en el agregado público
`docs/measurements/chromium-real-20261011.json`. No muestra cookies ni claves.
Contabiliza también sintaxis, comprobaciones puntuales y limpieza; ésta puede
continuar si el presupuesto se agota. Máximo 600 s de ensayo; una sola pasada
automática, sin reintento tras guarda. Rechaza inventario/resultado existentes
para no reiniciar contador ni sobrescribir evidencia. Un segundo intento
requiere fallo demostrado, corrección mínima y conservar el libro acumulado;
no borrar el resultado para forzarlo.

Tras interrupción, no volver a lanzar seed o el supervisor: revisar primero el
ledger activo, manifiesto y runner, detener sólo el runner propio y limpiar por
ese manifiesto. Conservar evidencia antes de retirar archivos privados.
El estado/checkpoints e informe distinguen recorrido funcional de capacidad.

Resultado del contrato: dos intentos agotados con limpieza y salud correctas,
pero sin recorrido completo; [INFORME_CHROMIUM_REAL](INFORME_CHROMIUM_REAL.md).
El segundo se permitió por corrección mínima de la expectativa CSRF del harness:
`sh scripts/dev-remote.sh chromium-real-retry` conserva el contador anterior,
exige el fallo coincidente y rechaza guarda/éxito/tercer intento. **Ya no procede
ejecutarlo**. No borrar el resultado para volver a ensayar. Antes de otra tarea,
mejorar identificación de aserciones y auditar HMAC antes de limpiar en fallos
sin guarda: esta versión del supervisor sólo auditaba al terminar el navegador
correctamente. Las herramientas preparadas no acreditan esas comprobaciones.

Preparación posterior sin ensayo: [INFORME_RUNNER_DIAGNOSTICO](INFORME_RUNNER_DIAGNOSTICO.md).
El runner actual identifica cada aserción y conserva la excepción acotada;
tras fallo funcional, confirma cierre del navegador y audita los eventos propios
antes de limpiar si guarda y presupuesto permiten. Si no, marca la auditoría
pendiente. Errores de auditoría/limpieza no sustituyen el fallo original. Sólo
validado con pruebas aisladas; **no autoriza otro Chromium ni reiniciar el contador**.
