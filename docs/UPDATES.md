# Demo privada y actualizaciones de InkGroove

Repositorio privado: **git@github.com:alscos/veritas.git**. La ubicación que se había indicado en el Mac es **~/Documents/veritas**. El checkout preparado aquí utiliza `feature/siteground-growbig`.

## 1. Cerrar ahora la demo pública

En Site Tools de **inkgroove.com**, abrir **Seguridad → URLs protegidas**. Seleccionar el dominio, proteger la raíz **/** y crear un usuario y una contraseña para quienes deban ver la demo. Esta contraseña precede al inicio de sesión de InkGroove y al registro de cuentas; puede compartirse con los profesores invitados. Usar HTTPS.

Probar en una ventana privada: antes de ver la aplicación debe aparecer la solicitud de contraseña del navegador. Sin credenciales, tanto la portada como la API de altas deben devolver 401:

```sh
curl -sS -o /dev/null -w 'Inicio: HTTP %{http_code}\n' https://inkgroove.com/
curl -sS -X POST -o /dev/null -w 'Registro: HTTP %{http_code}\n' https://inkgroove.com/api/auth/register
```

El actualizador no borra `.well-known`, `.htpasswd` ni las reglas de SiteGround. Solo sustituye el bloque delimitado `# BEGIN INKGROOVE` / `# END INKGROOVE` de `.htaccess`. Para la primera adopción reconoce el bloque exacto de la versión instalada el 8 de octubre y conserva las reglas de autenticación y HTTPS que lo rodean. Si no lo reconoce, se detiene antes del mantenimiento.

## 2. Incorporar los cambios desde el Mac

Primero verificar la carpeta y el estado; el remoto debe señalar al repositorio existente:

```sh
cd ~/Documents/veritas
git status --short --branch
git remote -v
```

Si no existe la carpeta, `mdfind -name veritas` permite buscarla. No crear otro repositorio para esta actualización. Si hay cambios locales, conservarlos antes de integrar el bundle. El bundle entregado contiene la historia de hosting, la corrección de MySQL y la automatización nueva; requiere el commit de base `14701853294ad4ae0f8bc5f0f5dbbad1c52712c4`, ya publicado en este repositorio.

Con el checkout limpio y el bundle descargado (sustituir **ARCHIVO.bundle** por su nombre real):

```sh
git switch main &&
git fetch origin main &&
git merge --ff-only origin/main &&
git fetch ~/Downloads/ARCHIVO.bundle feature/siteground-growbig &&
git merge --no-edit FETCH_HEAD &&
git push origin main
```

Si Git informa de una divergencia o un conflicto, resolverlo antes de seguir. No usar `reset --hard` ni `push --force`. La secuencia se detiene si un paso falla.

## 3. Qué hace GitHub al actualizar main

`.github/workflows/release.yml` ejecuta pruebas de frontend, PHP y los actualizadores, prueba migraciones y texto Unicode con MySQL 8.4 real, compila el frontend y comprueba la construcción de Docker. Solo si todo pasa publica una release privada **build-SHA12**, con dos ZIP y sus hashes:

| Destino | Paquete | Contenido |
| --- | --- | --- |
| SiteGround | `inkgroove-siteground-SHA12.zip` | Laravel y dependencias de producción, recursos web compilados |
| Alpine | `inkgroove-alpine-SHA12.zip` | Código del commit para construir Docker en el servidor |

La release se mantiene como borrador hasta subir los cuatro archivos y se identifica como prerelease durante esta beta. No se reemplaza una release ya publicada. Un fallo de las pruebas no actualiza los servidores. Se puede repetir el workflow desde **Actions**, seleccionando **main**. El workflow necesita estar permitido en los ajustes del repositorio; no necesita contraseñas SSH de los servidores ni secretos del servicio.

La instalación se inicia con un comando en cada servidor cuando se quiera actualizar. No se ha programado un cron ni un despliegue en cada push. Alpine descarga desde GitHub hacia fuera; no hay que exponer su SSH a Internet.

## 4. Arranque único del actualizador

La versión ya instalada no contiene estos scripts. El kit entregado incluye `deploy/` y `scripts/update-alpine.sh`. Subirlo desde Descargas y extraerlo **en la carpeta privada del programa**, nunca en `public_html`:

**SiteGround**, por SSH:

```sh
cd ~/www/inkgroove.com/inkgroove &&
tar -xzf ~/inkgroove-update-tools.tar.gz
```

**Alpine**, por SSH:

```sh
cd /opt/veritas &&
tar -xzf /root/inkgroove-update-tools.tar.gz
```

Este kit solo incorpora herramientas; no modifica `.env`, imágenes, base de datos, editor compilado o reglas de protección. Comprobar su SHA256 contra el archivo acompañante antes de extraerlo. En el Mac:

```sh
scp -i ~/.ssh/id_ed25519 -P 18765 ~/Downloads/inkgroove-update-tools.tar.gz u245-uuyqhpetsksq@gmadm1047.siteground.biz:~/
scp ~/Downloads/inkgroove-update-tools.tar.gz root@192.168.1.56:/root/
```

## 5. Configurar acceso de lectura una vez

Crear en GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** un token para **solo alscos/veritas**, con **Contents: Read-only**. Darle caducidad; al caducar, ejecutar otra vez `configure`. No necesita permisos de escritura ni una nueva clave SSH. Puede usarse un token dedicado distinto en cada servidor.

**SiteGround**:

```sh
cd ~/www/inkgroove.com/inkgroove
php deploy/update-siteground.php configure
```

El asistente pide repositorio, token, `https://inkgroove.com/up` y las credenciales del muro de URLs protegidas. Contraseñas y token se introducen sin mostrarse. Se guardan con permisos 600 en `~/www/inkgroove.com/.inkgroove-updates/config.json`, fuera de `public_html` y del código que se sustituye. También puede editarse ese JSON privado con `nano`; no enviarlo a GitHub ni al chat. Confirmar que existe `mysqldump` o `mariadb-dump` antes del primer despliegue:

```sh
command -v mysqldump || command -v mariadb-dump
php deploy/update-siteground.php check
```

**Alpine**:

```sh
cd /opt/veritas
sh scripts/update-alpine.sh configure
sh scripts/update-alpine.sh check
```

Pide repositorio y token. Usa PHP dentro de la imagen Docker existente; no instala PHP, Node o jq en Alpine. La configuración permanece en `data/app/update/config.json` y se incluye en las copias privadas. Los tokens solo viajan a `api.github.com`; no se reenvían al almacenamiento al que GitHub redirige una descarga.

## 6. Actualizar en adelante

Después de subir cambios a main y esperar a que **Actions** esté verde:

**SiteGround**:

```sh
cd ~/www/inkgroove.com/inkgroove &&
php deploy/update-siteground.php update
```

**Alpine**:

```sh
cd /opt/veritas &&
sh scripts/update-alpine.sh update
```

Se puede añadir `build-SHA12` para instalar una release concreta. Ambos comprueban SHA256, perfil, revisión e inventario del ZIP antes de activar código; rechazan rutas peligrosas, enlaces y datos privados. Una revisión ya instalada no se activa otra vez. Bloquean despliegues simultáneos.

En SiteGround se comprueba HTTPS y el acceso al `/up` protegido, se pone mantenimiento, se obtiene la copia SQL y se guarda el núcleo y los recursos anteriores. Se conservan `.env`, claves y `storage`; se aplican migraciones y se renuevan las cachés. Los chunks antiguos siguen disponibles para pestañas abiertas. La copia y el registro privado quedan en `.inkgroove-updates/backups/FECHA-ID/`.

En Alpine se construye primero la imagen mientras funciona la versión anterior. Después se ponen mantenimiento y un marcador persistente, se copian SQL, código, imágenes y configuración y se reemplaza solo **app**. La base **db** y los volúmenes no se recrean. Se mantienen las claves de `data/app/veritas.env`. Las copias quedan en `/root/inkgroove-backup-FECHA-SHA12/`. No se ejecuta `docker compose down -v` ni se regenera una clave.

Los ZIP también se pueden instalar sin descarga desde GitHub:

```sh
# SiteGround, desde su núcleo privado:
php deploy/update-siteground.php install /ruta/inkgroove-siteground-SHA12.zip SHA256_REAL

# Alpine:
sh scripts/update-alpine.sh install /root/inkgroove-alpine-SHA12.zip SHA256_REAL
```

Tras instalar, entrar de nuevo y probar un documento: escribir, guardar, recargar y abrir la moviola. No actualizar durante una sesión de edición que deba conservarse abierta. Las copias se conservan para revisión; su limpieza es una decisión posterior.

## 7. Si algo falla

Un hash incorrecto, paquete incompleto, fallo de construcción o copia SQL fallida detienen la actualización. Si aún no ha empezado la activación/migración, se vuelve a abrir la versión anterior cuando es posible. Si falla una migración o una comprobación posterior, se conserva mantenimiento, copia y registro; el comando devuelve error y no declara la revisión instalada.

No se restaura SQL, no se ejecuta `migrate:rollback` y no se borran documentos automáticamente. Revisar el error y la compatibilidad del esquema antes de restaurar. En SiteGround consultar `deployment.log` de la copia; en Alpine `docker compose logs --tail=100 app`. El marcador `data/app/deploy-maintenance` mantiene la aplicación cerrada también tras reiniciar el contenedor: retirarlo y ejecutar `php artisan up` después de resolver la incidencia. Si un proceso de Alpine murió sin limpiar el bloqueo, comprobar que no sigue activo antes de retirar `data/app/update/deploy-lock`.

## Validación de esta entrega

Probados localmente: 20 pruebas de frontend, pruebas PHP de producto y despliegue y cinco recorridos de Alpine con Docker simulado. Cubren claves e imágenes conservadas, protección intacta, validación de ZIP, descargas sin filtrar tokens, backup fallido, migración fallida y repetición de versión. El ensayo de empaquetado verifica los ZIP reales. El primer workflow y la primera actualización de cada servidor se validan al activarlos; no se afirma que esos recorridos remotos se hayan ejecutado aquí.

Referencias: [URLs protegidas de SiteGround](https://es.siteground.com/kb/proteger-contrasena-url), [descargar releases privadas](https://docs.github.com/en/rest/releases/assets).
