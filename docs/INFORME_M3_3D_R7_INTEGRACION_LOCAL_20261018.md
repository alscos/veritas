# M3.3D-R7 · Integración ordinaria local · 18-10-2026

**Candidato local integrado; sin instalación ni commits.** Decisión para la siguiente fase de consolidación Git supervisada y preflight MariaDB aislada: **SÍ**, limitada a revisión y preparación. Requiere confirmar identidad Git, revisar el conjunto heredado y congelar el candidato aprobado antes de ejecutar aquel preflight. No autoriza instalar, migrar dev ni publicar.

## Punto de partida y preservación

Rama comprobada al inicio y cierre: `feature/m33d-consolidacion-20261018`; HEAD `0c202ae87e226ba280040930286dc6a94e80e9dd`. La rama ya existía al entrar; no se creó desde Codex. Índice vacío. 38 archivos tracked modificados inicialmente, además de los untracked heredados. No se escribió en `.git`; identidad explícita `user.name`/`user.email` sigue sin configurar en la consulta efectiva. No se utiliza la identidad inferida.

Leídos AGENTS, README/INSTALL, arquitectura y seguridad; consultados ESTADO_GOAL, decisión D, contrato de Entregas, contrato PDF M3.2A, R6/inventario/manifiesto, R5.3 y C-R6. Código real examinado: rutas ordinarias/candidatas, bootstrap y middleware, VersionAccess/PDF/test, emisores C/D, Gate/lector, Versiones y ficha/pruebas. La exigencia R6 de fuente sólo propietario queda corregida por el encargo R7 y por el contrato previo de Entregas; no se reinterpreta la historia.

Preservación saneada fuera del checkout: `/private/tmp/inkgroove-m33dr7-6rt_pbv7`, permisos privados. Estado/índice/rutas tracked y untracked en NUL; 247 hashes contemporáneos anteriores a editar, todos coincidentes con R6; preimagen de ESTADO_GOAL. Para el patch propio se recuperaron únicamente las diez fuentes públicas de la copia de pruebas R6 y se cotejaron contra esos hashes previos; esas copias posteriores no se presentan como capturas contemporáneas. No se abrieron `.env*`, configuración privada, SQL, documentos/imágenes/PDF reales, cookies, sesiones, mediciones ni backups heredados. Sólo se reutilizaron dependencias del laboratorio y fuentes permitidas, nunca su storage.

## Cambios R7 y política comprobada

Tres archivos cambian comportamiento: `SummaryCapabilityHeaders.php`, `routes/web.php` y `SummaryShareChoice.tsx`. Otros tres actualizan comentarios de registro en la colección, Gate y ReadController. Cuatro archivos de pruebas cambian: SummaryShareChoice, mobileNavigation, VersionShareGate y VersionSharesProduct. **Diez fuentes, +220/−30 líneas respecto de las preimágenes R7**, no respecto de HEAD. Documentación propia separada: este informe, manifiesto y apéndice de ESTADO_GOAL.

- **PDF/Entregas:** VersionAccess::exact, VersionPdfController y VersionPdfTest permanecen byte a byte iguales. Propietario y destinatario de la versión exacta conservan 200; destinatario de A no obtiene B pasando `version_id=A` a la ruta B. Otra cuenta, portador anónimo y portador autenticado sin Entrega no obtienen fuente PDF por poseer una concesión 1/2/3. Un signed_in_link válido puede entregar texto sellado por la ficha sin conceder documentos, timeline, fuente PDF o URL privada de imagen. La prueba de imágenes obtiene primero bytes válidos por el canal de capacidad y demuestra después denegación por las rutas privadas.
- **Autoridad/origen:** sólo `/process-summary/share` y descendientes exigen Host crudo exactamente igual a host/puerto del `veritas.public_origin` validado. Host forjado no se rescata con X-Forwarded-Host canónico; headers forwarded host/proto/port contradictorios o listas se rechazan. Forwarded y X-Forwarded-Prefix se rechazan. Los valores coincidentes se toleran, sin sustituir Host. Origin mutante debe coincidir con el origen configurado: ausente, literal `null`, ajeno y APP_URL alternativo fallan; cross-site también. No cambia trustProxies('*'), APP_URL ni configuración global. El caso `APP_URL=http://localhost:8083` y origen `http://127.0.0.1:8084` pasa Kernel. Esto verifica la política de aplicación; no prueba proxy real, TLS ni recepción de headers en Apache. La política global de IP/proxies y la capacidad de sus cupos no se certifican aquí.
- **Recorrido:** web.php incluye una sola vez la colección antes del catch-all. Nueve acciones: shell GET, query POST, event/image POST, gestión GET, grants GET/POST, revoke POST y accesses GET. Conservan web/CSRF, auth donde corresponde, throttle y cabeceras no-store/noindex/no-referrer. No se expone SealedVersionReader directamente. Query con cursor es también la lectura paginada. Falta de origen válido deniega antes de acceder a DB. El esquema completo es requisito de ejecución; 000009/000010 no se han aplicado fuera de SQLite en memoria.
- **Versiones:** el selector existente sólo admite versiones con certificado y sealed_at. Abre gestión D de documento/versión exactos en otra pestaña; cambia destino al seleccionar A/B y traduce ES/EN. Reutiliza VersionShareApp y su ficha; no copia HTML vivo ni monta otro editor. Las rutas C y `/verify/{code}` se conservan. El test antiguo que exigía ausencia de rutas D se sustituye por registro ordinario probado; se mantiene su negativa de emisión nivel3 mediante C. No se altera el test PDF para ocultar regresiones.
- **Contrato D/PDF:** niveles fijos, SessionGuard, restricted one permitido/two denegado, signed_in_link, negación nivel3 sin sesión, recheck de páginas/eventos/imágenes, TTL UTC y auditoría agregada conservados. Recorrido nuevo de 40 eventos: páginas 32+8, snapshot y procedencia literales, evento/borrador posterior excluidos, revocación entre páginas y expiración deniegan; ninguna lectura cambia tablas editoriales/sellos. Se repiten las pruebas R5.3 de atributos hostiles inertes y errores Worker/HTTP/timeout/cancelación/descarga. No cambia renderer, Worker ni diseño PDF. Unicode NFC/NFD, BR/vacíos y fuentes siguen cubiertos por las suites. El problema del PDF histórico aproximado sigue independiente y abierto.

Las rutas están **registradas en el código ordinario local** porque A/B pasan y el mismo registro se prueba mediante Kernel, sin inyección de rutas ni reordenación desde el fixture. No hay un servidor local operativo iniciado ni activos instalados en este checkout. Registro de código no equivale a instalación: sólo se activa en una ejecución con origen y esquema válidos. No se atribuye pase a un runtime servido que no se ha ejecutado.

## Validación del corte final

Runner nuevo aislado, sin `.env`, caché/configuración ni DB/storage del checkout; testing + SQLite `:memory:` protegido por TestCase. Migraciones completas, incluidas 000008→000009→000010, exclusivamente en memoria. PHP 8.3.35, memory_limit512M; Node22.23.0, heap1024 MiB; Vitest un worker. Dependencias ya existentes cotejadas con ambos lockfiles: 106 paquetes Composer y 238 entradas Node, sin versiones discrepantes ni obligatorias ausentes. Ninguna instalación nueva.

| Comprobación nueva final | Resultado |
| --- | --- |
| PHPUnit completo | 137 tests / 3.260 assertions, exit0; 88,010 s pared |
| Vitest completo | 29 archivos / 183 tests, exit0; 46,153 s pared |
| TypeScript --noEmit | exit0; 6,648 s pared |
| Vite build, heap1024 | exit0; 13,472 s pared; aviso editorial 520,09 kB |
| Fuentes probadas vs checkout | 247/247 hashes iguales |
| Build efímero | 35 archivos / 6642515 bytes; no instalado |

SHA-256 del inventario canónico de fuentes: `2fcf25e5a0d8c9c2ef6d0a938c58eb44dac45df0917c44bf83d8af63ad373f3d`.
SHA-256 del manifiesto publicado: `79a2ccd2605e53788766f3f2a99487a4d00d21c902510eabb7faecea918ec314`.
Estos hashes identifican fuentes/artefactos de prueba, no un commit o paquete.

A/B antes del registro ordinario: 10 pruebas/450 aserciones correctas. Primer intento A/B: cuatro fallos al construir el Host del harness; Symfony deriva Host de la URI absoluta, se corrigió la prueba, no la política. Primer completo: 136 pruebas, una expectativa errónea en el test nuevo de cupo (la petición 30 aún es válida); se corrigió a 31 y se añadió el recorrido paginado. Logs iniciales y finales separados, sin ocultar intentos. Las suites usan Kernel, jsdom, API controlada y Worker simulado; DeploymentTest utiliza operaciones simuladas, sin red/instalación real.

No se ejecutan HTTP en cable, navegador real nuevo, PDF/QR real nuevo, Apache, MariaDB ni pruebas físicas. Chrome comunicado en R6 pertenece al laboratorio: sesión, one/two, signed_in_link, revocación y descarga/QR; no se atribuye a R7. Sin recrear esa aceptación ni afirmar Safari, concurrencia o beta.

## Corte exacto, runtime y revisión Git

[Manifiesto R7](M3_3D_R7_CANDIDATE_MANIFEST_20261018.json): 247 fuentes exactas y hashes, diez deltas propios con pre/postimagen y conteo, runtime/build/pruebas separados, activos temporales Vite, dependencias/migraciones y propuesta de staging por rutas. El patch exclusivo R7 y los logs están en el directorio temporal citado. No es paquete operativo ni release, y no incluye vendor como payload instalable.

La dependencia real es M3.1/M3.2 (v3, fuentes, PDF/lectura/Entregas) → A/B/C (resumen y 000008) → D (000009/000010, tiempo UTC, Gate/lector/ficha) → R7 (registro/guarda/entrada ordinaria). No sirve un commit R7 aislado sobre HEAD ni copiar PHP nuevo sobre el esquema C-R6. Las fuentes/licencias, entradas Vite, CSS, Worker y lockfile acompañan a sus consumidores. Config/bootstrap/rutas/App contienen herencias mezcladas que requieren revisión completa.

La allowlist es **propuesta para revisión**, no autorización de staging automático: primero revisar las rutas heredadas enumeradas y sus diferencias con HEAD; después los diez deltas R7 con el patch exacto. Archivos mixtos se revisan por hunks (en especial web.php y tests heredados); no añadirlos enteros suponiendo que todo es R7. ESTADO_GOAL sólo aporta su apéndice R7: su historia anterior sigue fuera de este staging hasta revisión independiente. El informe/manifiesto propios forman un segundo grupo documental. Excluir por defecto `.env*` y ejemplos, SQL/storage, capacidades/PDF, mediciones, capturas, dependencias/build generados, auxiliares y documentación heredada no depurados. El manifiesto no añade rutas por semejanza de nombre; incluye explícitamente los seis soportes de pruebas requeridos por imports/tests, sujetos también a revisión.

En Terminal normal, la revisión posterior debe confirmar rama/HEAD/índice y autor/committer, inspeccionar cada ruta/hunk permitido, leer el diff staged completo y ejecutar `git diff --cached --check` antes de cualquier commit autorizado en otra tarea. Nada se ha añadido al índice. No hay SHA/parent de commits R7. Sin fetch, push, merge, tag, SSH, Docker, CI, Alpine/GitHub/SiteGround, paquete o migración persistente.

| Superficie | Implementado | Probado SQLite-Kernel | Registrado runtime local | Commits Git | Instalado dev | Pendiente |
| --- | --- | --- | --- | --- | --- | --- |
| PDF/Entregas y no ascenso | preservado + tests | sí | ruta previa conservada | no | no cambio R7 | HTTP ordinario real |
| Host/Origin nueva colección | sí, acotado | sí | middleware y rutas | no | no | proxy/headers reales |
| Gestión/ficha niveles1/2/3 | reutilizada | sí | sí, código ordinario | no | no | MariaDB dos conexiones/HTTP |
| Versiones exacta → gestión | sí | Kernel + jsdom separados | sí, fuente frontend | no | no | navegador ordinario/Worker CSP |
| PDF QR R5.3 | preservado | PHP + jsdom/Worker simulado | flujo existente reutilizado | no | no | runtime ordinario; PDF histórico aparte |
| 000009/000010 | heredadas aditivas | sí, sólo memoria | fuentes necesarias | no | no | preflight esquema/FK/zona MariaDB |
| Consolidación Git | revisión preparada | corte congelado | no aplica | ninguno | no aplica | identidad y hunks heredados |

**Siguiente paso mínimo:** revisar en Terminal normal la allowlist y los hunks del corte R7, confirmando identidad Git; sin staging global ni ejecución remota. Tras esa consolidación supervisada podrá prepararse el preflight MariaDB aislado con autorización propia. Instalación, política de retención/purga de auditoría, aceptación Safari/teclado físico, capacidad y controles del piloto siguen pendientes.
