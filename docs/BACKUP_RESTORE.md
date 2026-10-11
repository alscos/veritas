# Copia y restauración completa de InkGroove

Procedimiento Docker restringido y ensayo del 10-10-2026, sobre `main`, base
`04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`, incluyendo cambios sin commit.
No es un actualizador ni un comando para restaurar sobre producción/desarrollo.

## Requisitos y frontera autorizada

Python 3, SSH/rsync en el Mac, Docker y Compose en Alpine. Los scripts sólo
aceptan hijos directos de `/opt/inkgroove-backup-lab`, sin enlaces. No usar
`/opt/veritas` ni `/opt/veritas-dev` como origen o destino. El perfil tiene un
único escritor, app; no hay workers externos ni cron. Si se adapta a otra
instalación, inventariar y detener TODOS los escritores, incluidas colas,
importadores y tareas programadas, antes de capturar SQL y archivos.

Se usan las imágenes existentes `inkgroove-dev-php:local` y
`inkgroove-dev-db:local`; el manifiesto exige sus IDs exactos. Para compilar y
comprobar se usa `inkgroove-dev-node:local`, con Node 22.23.3 y Playwright 1.62.1.
PHP 8.3.35/Composer 2.10.3, MariaDB 11.4 y Python 3 disponibles en este entorno.
No instala herramientas globales, cambia cgroups ni configura envíos o cron.
Antes de cada ensayo comprobar `free -m`, `df -h /opt`, nombres Docker y puertos.
La creación comprueba conflictos de nombres y hace bind de prueba a localhost.
No es una reserva atómica frente a otros administradores: si aparece una carrera,
Compose falla; no reemplazar sus recursos. Sólo app publica puerto, en localhost.

## Reproducción con datos ficticios

Desde el checkout del Mac, escoger nombres/puertos nuevos. Ejemplo del ensayo:

```sh
sh scripts/backup-lab-remote.sh source-20261010 18084
scp scripts/backup-lab-server.sh inkgroove-alpine:/tmp/inkgroove-backup-lab-server.sh
ssh inkgroove-alpine 'sh /tmp/inkgroove-backup-lab-server.sh source-20261010 prepare'
ssh inkgroove-alpine 'sh /tmp/inkgroove-backup-lab-server.sh source-20261010 seed'
ssh inkgroove-alpine 'sh /tmp/inkgroove-backup-lab-server.sh source-20261010 verify'
ssh inkgroove-alpine 'sh /tmp/inkgroove-backup-lab-server.sh source-20261010 integrity'
```

`prepare` copia dependencias existentes desde volúmenes dev **sólo lectura**,
compila en una copia propia de node_modules y migra únicamente la base nueva.
Usar dependencias que correspondan a los lockfiles; si han cambiado, instalarlas
con `composer install` y `npm ci` en el origen aislado antes de continuar.
`seed` se ejecuta una sola vez: crea dos documentos, carpeta Unicode, dos imágenes,
dos sesiones, tres eventos, tres versiones (una antigua y dos v2), una entrega y
cambios privados posteriores. Cuatro usuarios ficticios, contraseña de fixture
`Fictitious12345`. No se envía correo. Los manifiestos del fixture son privados.
El harness usa HTTP real contra Apache/PHP/MariaDB, sin interceptar API.

La sincronización excluye configuraciones privadas, `.git`, dependencias,
storage, datos, caches y activos previos; crea un árbol nuevo exacto del trabajo
actual y compila sus activos. `code-identity.json` registra commit, rama y estado
porcelain. No depende de que los cambios estén publicados; el archivo de copia
incluye el código efectivo, vendor, lockfiles y public/build.

## Copia consistente y privada

En Alpine, con los scripts copiados por el paso anterior:

```sh
python3 /tmp/inkgroove-backup-restore.py backup /opt/inkgroove-backup-lab/source-20261010 --backup /opt/inkgroove-backup-lab/copy-final-20261010
python3 /tmp/inkgroove-backup-restore.py validate /opt/inkgroove-backup-lab/copy-final-20261010
sh /tmp/inkgroove-backup-lab-server.sh source-20261010 stop
```

Requisito: tablas InnoDB y event_scheduler desactivado, comprobados en el ensayo.
No arrancar servicios externos que escriban en esta base.
La aplicación se detiene (también terminan las peticiones en curso). Mientras
permanece sin escritores se vuelca SQL UTF-8, esquema, triggers/rutinas/eventos,
con transacción consistente y blobs hexadecimales; después se capturan archivos.
La aplicación se reinicia al terminar, incluso ante fallo. Un fallo deja marcador
INCOMPLETE y la copia se rechaza. No copiar una app con escritores externos usando
este contrato. No iniciar app ni modificar archivos desde otro proceso durante
la captura. Evitar DDL concurrente; detener app no detiene administradores SQL.

Contenido: `database.sql`, `installation.tar.gz` (código, dependencias, activos,
storage e imágenes), `app.env` completo del origen, `code-identity.json` y
`manifest.json`. Las credenciales MariaDB administrativas no se necesitan para
restaurar: destino genera las suyas. APP_KEY y VERITAS_SIGNING_KEY sí se conservan.
El manifiesto registra tamaño y SHA-256 de cada artefacto, ID de imágenes,
identidad de instalación y duración. El archivo íntegro identifica también todos
los activos/código incluidos. SHA-256 detecta corrupción; no autentica una copia
frente a sustitución maliciosa de archivo Y manifiesto. Conservar un hash firmado
externo o autenticación del almacenamiento para ese riesgo.

Directorio base, instalaciones y copias 700; archivos privados y copia 600.
Ninguno está en Git ni bajo una raíz pública. No imprimir app.env, archivos de
contraseñas, `docker inspect` completo ni `docker compose config` sin `--quiet`.
Este perfil admite sólo imágenes en storage: rutas de medios externas necesitan
inventario y adaptación previa. Configuración de proxy/TLS, autenticación de
hosting y configuración global no forman parte de este perfil Docker aislado.

## Restauración nueva

```sh
python3 /tmp/inkgroove-backup-restore.py restore /opt/inkgroove-backup-lab/destination-20261010 --backup /opt/inkgroove-backup-lab/copy-final-20261010 --port 18085
sh /tmp/inkgroove-backup-lab-server.sh destination-20261010 integrity
sh /tmp/inkgroove-backup-lab-server.sh destination-20261010 verify
sh /tmp/inkgroove-backup-lab-server.sh destination-20261010 edit
sh /tmp/inkgroove-backup-lab-server.sh destination-20261010 integrity
```

Se valida toda la copia antes de crear destino. Se rechaza cualquier destino
existente, incluso vacío, por tanto también uno activo/no vacío. Se rechazan
inventarios incompletos, hashes/tamaños distintos, imágenes runtime cambiadas,
enlaces, duplicados, entradas especiales y rutas absolutas o con `..` en tar.
La extracción usa exclusivamente archivos regulares creados dentro del árbol
nuevo; no ejecuta `tar extractall`. Sólo se cambian conexión SQL, APP_URL y cookie
para separar instalaciones. Las demás opciones y claves se conservan. Se borran
caches compiladas, vistas, cache de archivos, sesiones de archivos y logs; las
sesiones de autenticación en SQL permanecen, aunque la cookie propia obliga al
login del ensayo. No se aplican migraciones durante restauración: se importa el
esquema exacto. Un fallo deja un destino parcial; inspeccionarlo y retirarlo con
su identidad registrada antes de repetir con otro nombre. Nunca reutilizarlo
como una restauración vacía.

Comprobar hashes de tablas ANTES de login/edición (éstos cambian sesiones/datos).
`backup-lab-integrity.php` calcula hashes de tablas editoriales, cuentas,
carpetas, migraciones e imágenes y recalcula cadenas HMAC/cabezas, hashes y firmas
de versiones y fronteras v2. El SQL completo conserva también tablas sin datos.
El harness comprueba login, lectura de documentos/imagenes/entrega, certificados,
rechazo de borrador/eventos/imagen posterior al destinatario y nueva escritura/sello.

Pruebas negativas reproducibles para estos nombres, sin crear destino:

```sh
scp scripts/check-backup-rejections.py scripts/backup-restore.py inkgroove-alpine:/tmp/
ssh inkgroove-alpine 'python3 /tmp/check-backup-rejections.py'
```

Crean y retiran exclusivamente `negative-{incomplete,corrupt,traversal}-20261010`.
El test traversal recalcula el hash para comprobar el rechazo de ruta aunque
el inventario criptográfico coincida. No prueban SQL arbitrario no confiable:
restaurar sólo copias propias cuya procedencia se haya autenticado.

## Navegador, almacenamiento externo y SiteGround

La copia del servidor excluye borradores/colas aún no recibidos, composiciones
no confirmadas, localStorage y copias `veritas:recovery:v2:{user}:{document}:{uuid}`,
exportaciones sólo en el equipo del autor y otras pestañas offline. Los eventos
recibidos pero aún no guardados sí están en SQL; no equivalen necesariamente al
texto guardado. Antes de mantenimiento avisar y pedir guardar/exportar el trabajo
pendiente. No migrar/borrar las recuperaciones del navegador ni sobrescribir
revisiones automáticamente después de restaurar. Una vuelta a un punto anterior
puede invalidar supuestos de sesiones/editor abiertos: cerrar/reabrir y contrastar
las copias, respetando CONCURRENCY_RECOVERY y SUBMISSION_PRIVACY.

Esto acredita MariaDB/Docker, no SiteGround. Falta ensayar allí mysqldump,
permisos/rutas privadas, PHP/extensiones, medios y archivos fuera del núcleo,
reglas .htaccess/HTTPS/URLs protegidas, sesiones, dominio/cookies, recuperación
en una base nueva y una raíz privada nueva. No ejecutar estos scripts Docker allí
ni confundir las copias del actualizador con una recuperación integral validada.

Para pérdida del host faltan: destino externo independiente, cifrado autenticado
antes de transferir, claves de descifrado custodiadas fuera del host y ensayo de
su recuperación, política de retención/RPO/RTO, permisos mínimos, verificación
periódica, alertas y ensayo sin imágenes/dependencias locales. El manifiesto exige
imágenes exactas pero NO las exporta: conservarlas mediante `docker image save`
en un paquete externo cifrado o disponer de un registro con esos digests. El
paquete sí incluye vendor y activos, no necesita npm para arrancar restaurado.
No se activan transferencias ni tareas programadas en este encargo.

## Resultados del ensayo y limpieza

RAM compartida disponible inicial: 1.052 MiB; disco libre 30,3 GiB. Origen y
destino nunca estuvieron activos a la vez; desarrollo permaneció activo. No son
reservas de memoria ni mediciones de RSS/pico, ni una prueba de capacidad.

| Artefacto / operación | Medida |
| --- | ---: |
| SQL completo | 29.328 bytes |
| Código + vendor + activos + storage, gzip | 12.741.180 bytes |
| Configuración privada del origen | 615 bytes |
| Identidad del checkout | 2.515 bytes |
| Copia total, incluido manifiesto | 12.774.751 bytes |
| Captura consistente, incluye parada y archivo | 5,427 s |
| Restauración nueva, importación y app saludable | 9,463 s |
| Repetición con comprobaciones finales de perfil | 13,494 s |

Son datos ficticios pequeños; no extrapolar RTO ni volumen a documentos reales.
El tiempo de copia se mide antes del reinicio de app. El de restauración incluye
validación, extracción, creación de MariaDB, importación y healthcheck. No incluye
transferencia externa, descifrado, DNS, lectura humana ni recuperación del host.

Pruebas pertinentes ejecutadas secuencialmente:

- TypeScript/Vite en el origen: correcto. Aviso previo de chunk 517,78 kB.
- Sintaxis Python, shell, PHP/JS de los nuevos scripts y `git diff --check`.
- Fuente leída y restauración leída mediante Chromium/HTTP real, sin mock API.
  Login, documento Unicode/formato/líneas vacías, carpeta, imágenes, versiones,
  firmas públicas y entrega correctos. El segundo documento tiene título Unicode.
- Antes de login en destino, `cmp` de las dos salidas de integridad fue exacto:
  cuentas, carpetas, documentos, imágenes, sesiones editoriales, eventos,
  versiones, certificados, entregas y migraciones. Imágenes con SHA-256 idéntico.
  Se conservaron esquema SQL, tres eventos, secuencias, cabezas HMAC, revisión 2,
  versión antigua y dos versiones v2 con fronteras válidas. Motores InnoDB y
  event_scheduler OFF comprobados. Las tablas de autenticación se incluyen en SQL;
  sus filas no se comparan tras login porque la prueba las modifica.
- Igualdad de APP_KEY y VERITAS_SIGNING_KEY comprobada sin imprimir valores;
  diferencias de configuración limitadas a ajustes del destino. Permisos 600/700.
- Destinatario: entrega exacta y su imagen autorizadas; borrador vivo, imagen,
  evento y versión posteriores denegados. Su timeline contiene sólo dos eventos.
- Escritura nueva, PATCH con revisión, ingesta nueva y sello nuevo correctos.
  Después: revisión 3, cuatro HMAC/cabezas válidas, cuatro versiones con firmas
  y fronteras válidas; el destinatario sigue con su entrega original.
- Rechazos: destino activo, existente/no vacío, destino dev, ruta fuera de base,
  SQL ausente, SQL corrupto y tar traversal con inventario recalculado. Ninguna
  prueba negativa creó un destino ni escribió fuera de la raíz.

Se corrigieron durante el ensayo la escritura de Vite sobre dependencias de sólo
lectura (ahora copia propia), WebCrypto sobre HTTP (hash en Node), permisos de
los directorios extraídos para Apache y espera ante rate limit de login. Una
primera restauración necesitó corregir permisos manualmente; su tiempo 93,820 s
NO es la restauración automatizada validada. Se retiró exclusivamente ese destino
y se repitió desde cero con el script corregido, sin intervención, con `cmp`
exacto. La primera pasada de seed falló al entrar al destinatario por rate limit;
la lectura completa posterior pasó y el harness ahora espera en bloques de 15 s.
No se cambiaron límites del servidor. No se ejecutó la suite editorial completa:
el cambio es de herramientas de copia; el recorrido pertinente usa PHP/MariaDB.

Recursos registrados por `installation.json`, retirados exclusivamente por
identidad de proyecto al finalizar:

| Tipo | Identificadores |
| --- | --- |
| Directorios | `/opt/inkgroove-backup-lab/source-20261010`, `destination-20261010` |
| Proyectos Docker | `igbr-source-20261010`, `igbr-destination-20261010` |
| Contenedores | `igbr-{source,destination}-20261010-{app,db}-1` |
| Redes | `igbr-{source,destination}-20261010_default` |
| Volúmenes retirados explícitamente | `igbr-source-20261010_mysql`, `igbr-destination-20261010_mysql` |
| Puertos localhost | 18084, 18085, liberados |
| Copias privadas temporales | `copy-20261010`, `copy-final-20261010` |
| Casos negativos | `negative-{incomplete,corrupt,traversal}-20261010`, ya retirados |

Los runners `docker run --rm` y Compose run --rm no dejaron contenedores.
Se retiraron código/herramientas propios, fixture, credenciales, SQL, imágenes y
copias privadas exclusivamente de estos directorios; no se conserva una copia
sensible del ensayo en Git. Se retiraron scripts auxiliares/pycache propios en
/tmp y se eliminó la base del ensayo sólo si quedó vacía. No hubo túneles,
transferencias externas, cron, correo, commits, push ni publicaciones.

Comandos de limpieza de instalaciones (ejecutar sólo tras registrar evidencia):

```sh
python3 /tmp/backup-restore.py cleanup /opt/inkgroove-backup-lab/destination-20261010
python3 /tmp/backup-restore.py cleanup /opt/inkgroove-backup-lab/source-20261010
```

`cleanup` valida identidad y montajes del perfil, ejecuta `down` sin `-v` y retira
únicamente el volumen mysql cuyo nombre Y etiqueta pertenecen a ese proyecto.
Nunca usar prune ni quitar volúmenes dev/producción. Las copias se retiran por su
ruta exacta después de revisar el manifiesto. La repetición del ensayo necesita
nombres nuevos o una limpieza registrada; no acepta sobreescribir instalaciones.

Limpieza comprobada: no quedan contenedores, redes, volúmenes ni directorios
del ensayo. `inkgroove-dev-app` y `inkgroove-dev-db` permanecen saludables,
con el mismo arranque observado (14 horas); `/up` y portada HTTP 200,
app sólo en `127.0.0.1:8083`. RAM disponible final 1.025 MiB y disco libre
30,3 GiB. No se modificó `/opt/veritas`, SiteGround ni configuración global.
Pendientes SiteGround, copias externas cifradas, custodia de claves, retención y
ensayo de pérdida del host. Esta prueba no acredita beta ni concurrencia de aulas.
