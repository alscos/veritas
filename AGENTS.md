# Trabajo en InkGroove

## Propósito y alcance
- Editor con memoria de errores, enmiendas y evolución del texto, reproducible mediante timeline/moviola. La educación es un uso del núcleo; el documento pertenece al autor.
- Próximo objetivo: beta privada para cinco amigos y profesores; después, pruebas en grupos de treinta alumnos. Un profesor debe poder gestionar varios grupos. Existen tablas de cursos, pertenencias y actividades, pero las rutas actuales no implementan su gestión: no dar ese flujo ni la capacidad concurrente por validados.
- Consultar [README.md](README.md), [INSTALL.md](INSTALL.md) y [docs/](docs/), especialmente arquitectura, núcleo editorial, taller, I18N, seguridad y hoja de ruta. Las referencias históricas a ramas en la documentación no sustituyen comprobar el checkout actual.

## Arquitectura
- Laravel 12 / PHP 8.3+: API y sesiones en `routes/web.php`, controladores y servicios en `app/`, esquema en `database/migrations/`.
- React 19 / TypeScript / Tiptap 3 / ProseMirror en `resources/js/`; Vite compila a `public/build/`. Traducciones en `resources/js/i18n.ts` y `lang/es`, `lang/en`.
- MySQL/MariaDB en ejecución; SQLite en memoria para PHPUnit. Docker y LAMP comparten código. Conservar los identificadores internos Veritas por compatibilidad.
- Persistencia actual: HTML saneado por evento, cadena HMAC y hora del servidor. JSON versionado y operaciones incrementales son evolución pendiente. Las versiones selladas son inmutables; una entrega referencia una versión exacta, no el borrador vivo.

## Ejecución
- Usar los lockfiles: `composer install` y `npm ci`. CI/Docker usan PHP 8.3, Composer 2 y Node 22; usar Node 22.22.2+ en esa línea por los requisitos del lockfile. `package.json` no fija una versión de npm.
- El código se edita en `~/Documents/veritas` en el Mac; compilación y pruebas se ejecutan remotamente en Alpine por el alias SSH `inkgroove-alpine`, en un entorno de desarrollo separado. No usar la instalación actual como runner de pruebas.
- Instalación nueva: copiar `.env.example` a `.env`, configurar la base y las claves en privado, ejecutar `php artisan key:generate` y `php artisan migrate`. No regenerar claves de instalaciones existentes.
- Laravel: `php artisan serve`; frontend: `npm run dev` (Vite en 127.0.0.1). `npm run build` comprueba TypeScript y genera recursos; `npm run preview` previsualiza la compilación, no sustituye al backend. No hay script Composer `dev`.
- Alternativa Docker documentada: configurar `.env` y `docker compose up --build -d`; puerto predeterminado 8080, MariaDB 11.4 y datos persistentes bajo `data/`.
- Comprobación del Mac (9-10-2026): PHP, Composer, Node y npm no disponibles en PATH ni en las rutas habituales de Homebrew; tampoco Docker en PATH. No existen `vendor/` ni `node_modules/` locales. La preparación documental inicial no ejecutó pruebas; la validación remota posterior figura abajo.

## Alpine y flujo remoto comprobado (10-10-2026)
- SSH `inkgroove-alpine` funciona como `root` en `alpine-docker`; el agente necesita permiso de red fuera del sandbox. Alpine 3.21.0, x86_64, Docker 27.3.1 y Compose 2.31.0.
- Dos CPU visibles (afinidad `4,10`); cgroup `memory.max=max`, sin cuota CPU. RAM disponible inicial según `free`: 1278 MiB; tras preparar el entorno, 1097 MiB. Disco libre: de 32 a 30.4 GiB. Recursos compartidos, sin reserva garantizada; comprobarlos antes de cada sesión.
- Docker anuncia límites, pero no están delegados los controladores cgroup: `mem_limit` falla por ausencia de `memory.max`. No cambiar el host para este flujo. Ejecutar builds/tests secuencialmente; PHP/Composer y heap Node limitados a 512 MiB, Vitest con un worker, Apache con ocho workers, MariaDB con buffer de 96 MiB. No son un límite global del RSS ni de Chromium/BuildKit.
- Herramientas en imágenes propias: PHP 8.3.35, Composer 2.10.3, Python 3.11.2, Node 22.23.3, npm 10.9.9, Playwright 1.62.1 y Chromium 151.0.7922.34 (revisión 1234), obtenido desde la versión del lockfile.
- Instalación actual preservada: `/opt/veritas`, proyecto `veritas`, `veritas-app:latest`, contenedores `veritas-app`/`veritas-db` y puerto 8080. Sus IDs, imágenes y fechas de arranque permanecieron iguales durante la preparación. No leer secretos ni reutilizar configuración/datos de esa instalación.
- Desarrollo: `/opt/veritas-dev`, `compose.dev.yaml`, proyecto/red/volúmenes exclusivos `inkgroove-dev`; app y db solo persistentes mientras se trabaja, runners PHP/Node efímeros bajo demanda. App en `127.0.0.1:8083`, MariaDB sin puertos publicados; bases `inkgroove_dev` y `inkgroove_check` con usuarios/contraseñas distintos. Secretos y claves nuevas en `.dev-private/` (directorio 700, archivos 600), conservados al repetir `init`.
- Desde el Mac: `sh scripts/dev-remote.sh sync`, `init`, `build-tools`, `install`; después `test` ejecuta frontend, build, PHPUnit, simuladores, Chromium y smoke MariaDB secuencialmente. También admite cada paso por separado. No editar código en Alpine como flujo habitual.
- `sync` incluye cambios sin commit y `.env.example`, excluye secretos, configuraciones privadas, datos, dependencias y cachés. Conserva archivos reemplazados en `.dev-backups/`; no borra archivos remotos ausentes localmente. Revisar eliminaciones/renombrados expresamente para evitar código obsoleto.
- Arranque/parada: `sh scripts/dev-remote.sh up|stop|status`; acceso con `/usr/bin/ssh -N -L 127.0.0.1:8083:127.0.0.1:8083 inkgroove-alpine`. Consultar [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) para los comandos completos. `stop` conserva datos y secretos.
- Validaciones remotas: 22 pruebas frontend, compilación TypeScript/Vite, 28 pruebas PHPUnit (159 assertions), cinco simuladores Python, editor Chromium (tildes, procedencia, ES/EN, reapertura, ODT y moviola) y smoke MariaDB de Unicode/defaults en base independiente: correctos. Vite avisa de un chunk de editor de 517.53 kB; compilación completada. Portada y `/up` de dev devuelven HTTP 200.
- Verificados también los activos compilados servidos, parada/nuevo arranque saludable, permisos privados e idempotencia de claves. Ambos usuarios MariaDB tienen denegado el acceso a la base del otro. No quedan bloqueos de ejecución; siguen pendientes teclado físico/Safari y pruebas de capacidad con alumnos.
- No ejecutar `scripts/check-alpine-runtime.sh` aquí: requiere CI aislado y usa red host. No usar actualizadores, socket Docker dentro de runners, limpiezas globales ni `down -v`.

## Pruebas
- Frontend: `npm test` (Vitest); `npm run build` (TypeScript + Vite).
- Navegador: `npx playwright install chromium`, después `npm run test:browser`. Usa Chromium, Vite y una API controlada; no acredita integración real con PHP/MySQL.
- Backend: `composer test` (`php artisan test`) o `php vendor/bin/phpunit`; requiere dependencias de desarrollo y `pdo_sqlite`. Cubre persistencia, Unicode, permisos, sellado, saneamiento e idioma.
- Despliegue: `python3 -m unittest discover -s tests/deployment -v`. La CI en `.github/workflows/release.yml` añade smoke de MySQL real (`php scripts/check-mysql-release.php`) y arranque del paquete Alpine en Docker. Ejecutarlos solo en entornos de prueba preparados; el smoke MySQL aplica migraciones.
- Al cambiar el editor, comprobar escritura, pegado/reelaboración, formato, undo/redo, guardado, reapertura, moviola y sellado; revisar ES/EN, Chrome y Safari con teclado físico de macOS. Distinguir pruebas locales, CI y validación del servidor instalado.

## Cuidados del historial
- Mantener eventos append-only, secuencias, tiempos, procedencia y verificabilidad de sellos existentes. No borrar ni agrupar eventos perdiendo granularidad para ahorrar espacio; medir almacenamiento y latencia antes de probar grupos de treinta alumnos.
- Preservar la composición nativa de teclas muertas/IME y su nodo DOM hasta `compositionend`; aplicar después la procedencia al rango editado. No normalizar Unicode, dividir caracteres provisionales ni corregir masivamente el historial antiguo. Conservar NFC/NFD, tildes y líneas vacías al guardar, reabrir, reproducir y exportar.
- Pegado intacto mantiene `paste`; solo los caracteres introducidos al reelaborarlo reciben `paste-edited`. Formato y limpieza de formato conservan esas marcas.
- Cambiar ES/EN traduce la interfaz, nunca contenido del autor ni identificadores técnicos; no recrea el editor ni genera eventos de escritura. Zoom, paginación y búsqueda son presentación. Abrir/cerrar la moviola no modifica el documento.
- El servidor sanea y autoriza documentos e imágenes privadas y es la autoridad de integridad. El sello acredita el registro recibido, no autoría humana absoluta.

## Disciplina de trabajo
- Comprobar rama, commit y cambios locales antes de editar; conservar trabajo ajeno. No mostrar `.env`, claves, tokens, datos privados ni registros con secretos.
- Evitar migraciones destructivas, `reset --hard`, regeneración de claves y borrado de volúmenes. Mantener `storage/framework/views/.gitkeep` para los checkouts nuevos.
- Antes de ampliar el piloto, revisar los pendientes de [seguridad](docs/SECURITY.md), autorización entre grupos, recuperación de cuenta, copias/restauración y capacidad; no presentar el esquema educativo como un flujo terminado.
- Commits, push, publicación y despliegues requieren autorización en la tarea. El entorno de desarrollo está autorizado; conservar las instalaciones actuales y los cambios de trabajo. No hacer commits, push ni actualizaciones de producción en esta tarea.

## Historial progresivo, validación integral (10-10-2026)
- Base gzip validada antes de actualizar dev: HTTP Mac por SSH y Chromium contra Apache/PHP/MariaDB reales, sin interceptar API. Historial ficticio de 2.000 eventos: 14.023.244 → 222.858 bytes con gzip. Condiciones completas en `docs/DOCUMENT_OPEN_PERFORMANCE.md`.
- El detalle abre el editor; `/timeline?metadata=1` pagina 1.000 metadatos por cursor y cota de ID. Orden hora/sequence/id. Ya no hay recorte a 10.000; cualquier consumidor debe seguir `next_cursor`. Las instantáneas remotas se piden de 32 en 32, caché de 64 y ventana visible de 41 eventos. PPM y tiempos conservan fórmulas; carga/error/reintento explícitos ES/EN.
- Comparación real pequeña (10 Mbit/s, 40 ms, tres muestras): medianas primera apertura 8,950 → 0,817 s, reapertura 15,566 → 0,126 s. Métricas completas finales: medianas 9,302 s y 0,922 s. No confundir editor disponible con historial completo.
- Chromium real con fixture controlado de 25.000 eventos en cinco sesiones: abrió en 242 ms y permitió escribir/guardar durante carga; navegación inicio/centro/final, reproducción entre bloques y reapertura correctas. Moviola sin escrituras ni cambio de HTML/updated_at. Solo 96 IDs de instantáneas visitados. Heap final observado 26.979.216 bytes, sin GC; no es pico/RSS ni prueba de capacidad.
- HTTP real: otro propietario denegado en metadatos/snapshot/bloque; sello válido antes/después de lectura. Recalculados los HMAC de 25.007 eventos, cabezas y firma/hash de versión, correctos. El fixture pequeño final verificó 2.012 eventos.
- Validación final: 26 Vitest, TypeScript/Vite, 32 PHPUnit (275 assertions), Chromium con API controlada, cinco simuladores y smoke MariaDB de Unicode/defaults/aislamiento. Se corrigió el descubrimiento de tests en copias incompletas `.dev-backups` limitando Vitest a `resources/js`; no se borraron backups. Persiste aviso Vite del chunk editorial de 517,53 kB.
- Usuarios ficticios 2, 3, 4 y 5 y documentos/versión identificados en el informe eliminados exclusivamente mediante el manifiesto; también sus sesiones de autenticación y datos por cascada. Sin acceso a documentos existentes ni cambios en `/opt/veritas`, SiteGround, claves, esquema o recursos de otros proyectos; sin commits/push/publicación. Dev app/db saludables.
- Pendientes: Safari y teclado físico, capacidad con alumnos, memoria pico/RSS comparable, coste PHP de analizar HTML y consultas sin índice nuevo de orden global. La sesión activa conserva instantáneas locales. No acreditar concurrencia ni gestión educativa con estas pruebas.

## Privacidad de entregas y recuperación (10-10-2026)
- Informe y contrato: `docs/SUBMISSION_PRIVACY.md`. Fronteras por sesión en payload firmado v2; bloqueo común de documento en ingesta/guardado/sello. Destinatarios leen por versión explícita; sin frontera antigua, sólo instantánea y aviso ES/EN. Sin migración ni reescritura de eventos/sellos.
- Recuperación `veritas:recovery:v2:{user}:{document}`, confirmación de identidad/propiedad del servidor, generación contra respuestas/CSRF/exportaciones tardías; limpieza de estado y conservación del trabajo pendiente al salir/caducar. Entradas antiguas no se muestran/migran/borran automáticamente; recuperación explícita documentada. No es cifrado.
- Validación: 31 Vitest, TypeScript/Vite, 35 PHPUnit/325 assertions, cinco simuladores, Chromium con API simulada y smoke MariaDB; dos recorridos integrales correctos en un contexto Chromium contra PHP/MariaDB reales con A/B/C/D, firmas antiguas/nuevas, imágenes, carreras y recuperación. Reporte distingue respuesta real retrasada de API simulada.
- Regresión real 25.000 eventos: apertura 236 ms, guardado durante carga, 96 instantáneas y ventana 41, moviola sin escrituras; gzip exacto 226.929→11.308 bytes de página de metadatos y 84.253→8.034 de instantáneas. Comprobados 25.007 HMAC/cabeceras y sello antes/después.
- Usuarios ficticios 6–27, sus documentos, entregas, versiones, archivos de imagen y sesiones eliminados sólo por sus manifiestos; IDs en el informe. Manifiestos retirados y túnel propio cerrado. App/db dev saludables. Sin cambios en producción, datos reales, claves o configuración global; sin correo, commits/push/publicación. Pendientes Safari/teclado físico, capacidad y controles del piloto; no beta validada.
