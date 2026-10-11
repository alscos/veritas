# Guardados concurrentes y recuperación (10-10-2026)

Trabajo en `main`, base `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`.
Se conservan los cambios locales anteriores. Ejecución exclusiva en
`/opt/veritas-dev`, proyecto `inkgroove-dev`.

## Contrato

Antes, el bloqueo de fila ordenaba guardados pero permitía que un cliente
antiguo reemplazase el documento. La ingesta ignoraba una secuencia repetida sin
compararla y las pestañas compartían la clave local v2.

Ahora, cada documento tiene `revision`, entero inicialmente 0. Todo PATCH,
incluido título, página y carpeta, exige la revisión leída. Bajo el mismo bloqueo
`FOR UPDATE`, el servidor compara, sanea y guarda, incrementando la revisión.
Un cliente sin revisión recibe 422; una revisión desactualizada recibe 409 sin
modificar el documento. La precisión de `updated_at` no interviene. La migración
sólo añade columnas: no cambia contenido, eventos, HMAC ni certificados existentes.
Los clientes antiguos deben recargar los activos y obtener el contrato nuevo.

El cliente sólo adopta una revisión desde SU guardado confirmado. Una consulta
al servidor muestra título, revisión y texto en un panel de lectura; no cambia
el editor, su revisión base ni sus eventos. Un 409 detiene guardados e ingestas
posteriores de ese editor. No hay mezcla ni reintento de la escritura sobre una
revisión recién consultada. Se puede descargar el borrador como JSON o volver
al archivo personal conservando la copia local. El trabajo en conflicto se
contrasta y traslada explícitamente a un documento propio como edición nueva.

El estado remoto confirmado, la disponibilidad de copia local, el fallo y el
conflicto tienen indicaciones distintas ES/EN. El almacenamiento puede fallar:
se indica que no hay copia local confirmada y no se permite salir mediante la
opción de conservación si falla esa escritura. El perfil local no está cifrado.

## Recuperaciones y reintentos

Cada montaje de editor escribe en una clave propia
`veritas:recovery:v2:{user}:{document}:{uuid}`. No se comparte una clave entre
pestañas ni se depende de un ID de sessionStorage que un opener pueda clonar.
El payload conserva HTML, título, página, carpeta, sesión, secuencia, eventos
pendientes y revisión base. Se escribe al editar y antes de guardar; no sólo
al salir. La interfaz ofrece las copias disponibles por fecha y fragmento de
texto, después de confirmar identidad y propiedad. Un guardado correcto sólo
retira su copia y la entrada elegida que recuperó; conserva las otras.

Las entradas v2 anteriores siguen accesibles explícitamente, sin usar fechas
para decidir si pueden sobrescribir. Al no tener revisión base verificable,
se abren para conservar y contrastar, con el guardado bloqueado. Las entradas
v1 sin identidad no se leen ni migran; se conserva el procedimiento privado de
SUBMISSION_PRIVACY. Una copia de una revisión anterior también se conserva y
se abre bloqueada. La reapertura de una copia de la revisión actual puede guardar,
pero la comparación atómica del servidor vuelve a proteger la carrera posterior.

La cola se transmite en orden, en lotes de hasta 250 eventos. Sólo se retira un
prefijo después de recibir confirmación. Un error detiene el sondeo automático;
el botón de guardado inicia un intento explícito y una nueva edición puede
iniciar otro guardado. No hay bucle desatendido de reintentos sobre el mismo fallo.
Los lotes rechazados se conservan íntegros. Una nueva petición durante una ingesta
espera a ésta antes de continuar; no adelanta eventos. La recuperación conserva
las secuencias originales, incluso si se perdió una respuesta.

La ingesta bloquea documento y sesión. Una secuencia repetida se confirma sólo
si coincide con el evento aceptado. Los eventos nuevos guardan un fingerprint
SHA-256 de los campos originales (incluida la fecha cliente) en `request_hash`,
privado y fuera de la cadena HMAC. Para eventos anteriores, cuyo fingerprint no
existe, se compara el contrato canónico disponible: tipo, input, data, HTML
saneado y elapsed. No se puede reconstruir el HTML original anterior al saneado.
Una diferencia o un salto devuelve 409 y revierte TODO el lote; el prefijo
previamente aceptado no se modifica. Un reintento exacto acepta cero duplicados.

Una respuesta perdida de PATCH se trata conservadoramente: el servidor puede
haber guardado y aumentado revisión, pero el cliente no lo presupone. El
siguiente PATCH con su revisión antigua produce conflicto; debe consultar el
servidor. No se pierde ni se reaplica automáticamente su borrador.

## Qué significa el historial en un conflicto

Los eventos ya aceptados antes de detectar el conflicto permanecen append-only
en sus sesiones originales, con sus horas, secuencias, procedencia y HMAC.
El historial es un registro de instantáneas recibidas, incluidas ramas de trabajo;
no prueba que todas se convirtieran en texto definitivo. No se borran, agrupan,
reescriben ni se trasladan esos eventos a la sesión del otro cliente.
Los eventos aún pendientes al detectar 409 permanecen en la recuperación local
(y en su exportación); ese editor deja de enviarlos. Un PATCH rechazado no genera
un evento `save`. Los nuevos eventos `save` del cliente incluyen en `data` la
revisión devuelta por el servidor: son marcadores del cliente, no una nueva
credencial de integridad. La instantánea del documento y de la versión es la
referencia de texto guardado/sellado; no debe inferirse del último `insert` global.

El sellado sigue capturando todas las cabeceras recibidas bajo el bloqueo común,
incluidas las de ramas recibidas antes del conflicto. Eso se muestra al usuario
al consultar el proceso. La frontera firmada limita exactamente el proceso de
cada entrega y no se amplía al recibir eventos posteriores. No se reescriben
sellos antiguos ni se promete autoría humana absoluta. Un futuro modelo de
ramas/editorial debe conservar esos registros, no corregirlos retrospectivamente.

## Reproducción

Ejecutar secuencialmente, mediante los scripts existentes:

```sh
sh scripts/dev-remote.sh sync
sh scripts/dev-remote.sh concurrency-migrate
sh scripts/dev-remote.sh test
sh scripts/dev-remote.sh privacy-seed
sh scripts/dev-remote.sh concurrency-browser
sh scripts/dev-remote.sh concurrency-integrity
sh scripts/dev-remote.sh privacy-clean
sh scripts/dev-remote.sh privacy-seed
sh scripts/dev-remote.sh privacy-browser
sh scripts/dev-remote.sh concurrency-integrity
sh scripts/dev-remote.sh privacy-clean
sh scripts/dev-remote.sh status
```

Los fixtures reutilizan el manifiesto de privacidad con cuentas ficticias y
limpieza por ID/correo. No se permite sembrar sobre un manifiesto existente.
El navegador de concurrencia usa PHP/MariaDB reales; sólo intercepta una
respuesta DESPUÉS de aceptar el lote para provocar su pérdida. La desconexión
usa el modo offline de Chromium, sin API sustituta. PHPUnit usa SQLite y el
recorrido editorial estándar usa API simulada: se distinguen de esas pruebas.

## Límites

Pendientes Safari, teclado físico, suspensión abrupta, matriz de dispositivos y
capacidad con alumnos. LocalStorage no asegura persistencia ante cuota, borrado
del perfil o cierre durante una composición todavía no registrada; la interfaz
informa de fallos de copia y mantiene el tratamiento nativo de IME. El coste de
escribir una recuperación con instantáneas grandes depende del documento; no se
acredita capacidad ni memoria pico. No se repiten benchmarks extensos de apertura:
no cambia la paginación/caché/transportes históricos. No se declara preparada la beta.

## Archivos de esta intervención

- Servidor: `DocumentController.php`, `EventController.php`, `Document.php`,
  `WritingEvent.php`, migración `2026_10_10_200000_add_document_revision.php` y
  mensajes `lang/es/inkgroove.php`, `lang/en/inkgroove.php`.
- Cliente: `App.tsx`, `recovery.ts`, `types.ts`, `i18n.ts`.
- Pruebas: `DocumentConcurrencyTest.php`, `recovery.test.ts`; adaptación del
  contrato PATCH en `EditorWorkspaceTest.php`, `LocaleTest.php`,
  `SubmissionPrivacyTest.php` y `check-dev-privacy-browser.mjs`.
- Recorridos nuevos: `check-dev-concurrency-browser.mjs`,
  `check-dev-concurrency-integrity.php`; acciones en `dev-remote.sh`,
  `dev-server.sh`.
- Documentación: este informe, DEVELOPMENT, SUBMISSION_PRIVACY y ARCHITECTURE.

Todos los demás cambios encontrados al comenzar permanecen en el árbol de
trabajo. No hubo commits, push, publicaciones, correo ni modificaciones de
producción/configuración global/claves.

## Validación y limpieza realizadas

Comprobaciones finales secuenciales en Alpine, con los runners existentes:
32 Vitest; TypeScript/Vite; 37 PHPUnit / 344 assertions (SQLite); cinco
simuladores Python y Chromium editorial con API simulada (composición, Unicode,
procedencia, ES/EN, guardado/reapertura, exportación y moviola).
Vitest cubre además formato, limpieza de formato y undo/redo con procedencia.
Smoke MariaDB real de defaults/Unicode y separación de usuarios dev/check,
con la nueva migración compatible. Persiste el aviso previo del chunk editorial
(517,78 kB). `git diff --check` y sintaxis de los scripts correctos.

Chromium con Apache/PHP/MariaDB reales comprobó:

- Dos PATCH concurrentes sobre la misma revisión: exactamente 200 y 409. La
  prueba PHPUnit congela además el reloj y acredita dos revisiones distintas
  con el mismo `updated_at`, rechazando entre ellas la escritura desactualizada.
- Dos pestañas offline, textos/colas diferentes en claves diferentes; fallo,
  reconexión y guardado de A; B recibe conflicto y conserva su texto. Consultar
  el servidor no cambia su base; tres segundos sin reintentos de escritura.
  ES/EN, descarga JSON completa del borrador y reapertura de la copia antigua
  sin sobrescritura comprobados.
- Copia de la revisión actual: escritura offline y más de 250 eventos, reapertura
  y guardado en lotes ordenados; la copia en conflicto de la otra pestaña permanece.
- Respuesta perdida después de aceptación real: reintento exacto acepta cero
  duplicados y cambiar el contenido de esa secuencia da 409. Comprobado tanto
  con la petición explícita como con la cola del propio editor: error/copia
  pendiente, guardado manual posterior y un único evento con esa sesión/secuencia.
- Regresión de privacidad real: B/C/D, versiones antigua/nuevas, límites por
  sesión/evento/cursor, imágenes, firmas, sello/ingestas/guardado concurrentes,
  caducidad, recuperación de A sin mostrarla en B y respuesta real de A retrasada
  hasta después del login de B. Los límites de login se respetaron con esperas
  de 15 segundos; no se cambió la configuración.
- Tras las nuevas escrituras del recorrido final, se recalcularon los **288
  HMAC**, sus cabeceras, hashes/firma de **cuatro versiones** y sus fronteras:
  correctos. No hubo errores JavaScript de página.

Se ajustaron expectativas del harness: idioma persistido al reabrir y fixture
vacío para los recuentos exactos del recorrido de privacidad. Una pasada de
privacidad sobre el fixture ya editado falló por ese recuento; se verificaron
sus 293 HMAC y se limpió antes de repetir con un fixture nuevo. La pasada final
completa pasó. No se usan esas pasadas fallidas como evidencia de validación.

Fixtures creados y retirados mediante cotejo exacto de los manifiestos:

| Uso | Usuarios ficticios | Documento |
| --- | --- | --- |
| Concurrencia inicial y ajuste del harness | 28–31 | `01a125a4-13ac-72dc-8ddb-bd6a054c67c8` |
| Privacidad y concurrencia finales | 32–35 | `01a125ab-980a-70dc-8199-bde88d52aca1` |

La limpieza retiró exclusivamente entregas, versiones, imágenes/archivos,
sesiones editoriales/eventos y sesiones de autenticación de esas cuentas.
Ambos manifiestos se retiraron y ambas limpiezas comprobaron cero usuarios y
documentos del fixture. El archivo descargado por Chromium se borró mediante
su objeto Download; los contextos y runners efímeros se cerraron. Se conservaron
backups, volúmenes, claves y otros datos. No se abrió ningún túnel.

App/db dev quedaron saludables y los activos finales compilados se sirven en
`127.0.0.1:8083`. RAM compartida disponible observada: 1.055 MiB al inicio y
830 MiB después; disco libre 30,3 → 30,2 GiB. No son reservas ni picos de RSS.
Sin cambios en `/opt/veritas`, SiteGround, configuración global, claves o datos
reales. Sin correos, commits, push ni publicación. No se declara preparada la beta.
