# Privacidad de entregas y recuperación local

Trabajo sobre `main`, commit base `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`,
con cambios locales previos conservados. Entorno de ejecución exclusivo:
`/opt/veritas-dev`, proyecto `inkgroove-dev`. Resultados de validación al final.

## Contrato de lectura

El detalle, listado, modificaciones, imágenes subidas y eventos de un borrador
siguen reservados a su propietario. La bandeja `/api/submissions` devuelve sólo
entregas enviadas o recibidas por la cuenta autenticada. El nuevo detalle
`/api/submissions/{id}` devuelve la versión exacta y su certificado, sin cargar
el documento vivo, sus otras versiones, sus contadores ni sus fechas actuales.

Para leer proceso o imágenes de una entrega se debe indicar `version_id` en
`/api/documents/{document}/timeline` y en cada URL privada de imagen. El servidor
exige que la versión pertenezca al documento y esté entregada al usuario actual;
el propietario también puede consultar ese ámbito explícito. Sin versión,
ambas rutas son exclusivas del propietario. Las autorizaciones no dependen de
ocultar botones ni de conocer un UUID. No se crean destinatarios ni se envía
correo: la entrega directa sólo concede lectura al ID de usuario registrado.

En los sellos nuevos, `signed_payload.format_version = 2` y
`history_boundary[session_uuid] = {sequence, event_id, hash}` recogen el último
evento recibido de **cada** sesión con eventos. Se firma ese mapa junto con el
payload anterior. No es una frontera cronológica: las fechas del cliente,
empates del reloj y eventos posteriores de sesiones antiguas no pueden ampliarla.

Ingesta, guardado y sellado toman primero un bloqueo del mismo documento dentro
de una transacción. El sellado lee de nuevo el borrador bloqueado y captura sus
cabeceras; ningún escritor de esas rutas puede añadir eventos mientras se hace
esa captura. Las operaciones concurrentes se ordenan por el bloqueo: el sello
incluye los eventos cuya ingesta se confirmó antes de él, y el último guardado
confirmado antes de él. El cliente guarda y confirma sus eventos antes de pedir
el sello. Un guardado y una ingesta independientes de otra pestaña no se convierten
en una sola operación editorial: el sello acredita el estado recibido al capturar.

El servidor verifica la firma del certificado antes de usar su frontera.
Todos los selectores —metadatos, páginas, `event_id`, `snapshot_ids[]` y cursores—
parten de la misma consulta limitada por sesión, secuencia e ID. `before_id` y
el cursor sólo pueden recortar ese conjunto. `total` y palabras directas se
calculan dentro de él. Se sustituyen las sesiones vivas por sus IDs y cabeceras
selladas; no se comparten `ended_at`, `last_sequence`, `last_hash`, horas o sesiones
posteriores. Las imágenes se autorizan por su presencia en la instantánea o en
un evento dentro de la frontera verificada, nunca por el borrador posterior.

La vista mínima de entregas permite leer instantánea, metadatos y una instantánea
de proceso seleccionada. Sigue la paginación y muestra una ventana de 41 eventos;
no monta un editor ni escribe. No implementa aulas, actividades o administración.
Las exportaciones ODT/RTF existentes se generan en el navegador del propietario;
no hay una ruta de descarga que dé acceso al borrador de otro usuario. La ruta
pública de verificación mantiene su respuesta mínima (validez, código, fecha y
hash de contenido), sin texto, mapa de sesiones o imágenes.

## Sellos antiguos

No hay migración ni modificación de eventos, hashes, firmas o payloads antiguos.
No se reconstruyen fronteras a partir de fechas ni de la última sesión.
Una versión sin mapa firmado verificable permite leer su instantánea y las
imágenes de ella, pero el proceso devuelve 409. El detalle informa
`history_available: false` y un aviso ES/EN. El propietario conserva la lectura
general de su documento. Un certificado antiguo sigue verificándose con sus
bytes lógicos y el algoritmo anterior. La nueva firma incorpora el mapa completo;
`process_hash` se conserva por compatibilidad, sin atribuirle cobertura de todas
las sesiones de un sello antiguo.

## Recuperación por identidad

Claves nuevas: `veritas:recovery:v2:{user_id}:{document_uuid}`. El payload también
comprueba formato, propietario e ID. Sólo se consulta después de identificar la
cuenta y recibir un documento propio del servidor. Las entradas inválidas o más
antiguas que el estado del servidor se conservan, aunque no se restauran
automáticamente. Sólo se retira la recuperación concreta tras guardar y confirmar
sus eventos sin cambios pendientes.

Al detectar 401/419, cerrar sesión o cambiar cuenta se vacían documento visible,
archivo, carpetas e historial en memoria. Una generación de identidad impide
usar respuestas pendientes, incluso si ya se recibió su cabecera y queda por leer
el JSON. La identidad esperada viaja en `X-InkGroove-User`; el servidor rechaza
operaciones que lleguen con otra sesión autenticada. No es una credencial ni
sustituye la autorización del servidor. Un reintento CSRF no puede saltar la
comprobación de generación. Se conserva localmente el trabajo pendiente del
propietario antes de desmontar el editor. El acceso se ofrece después de finalizar
el logout, para evitar carreras entre logout y login.

Las otras pestañas reciben un aviso de cambio mediante un dato sin contenido en
`localStorage`; se limpia su vista. Además se comprueba `/me` al enfocar y cada
15 segundos: la caducidad silenciosa del servidor se conoce al recibir una
respuesta o en esa comprobación, no por anticipación. Las respuestas de la
identidad anterior se ignoran; no se reutilizan sus cachés al entrar otra cuenta.

### Recuperación explícita de una entrada antigua

Las claves `veritas:recovery:{document_uuid}` carecen de identidad comprobable.
No se leen, muestran, migran, atribuyen al nuevo login ni borran automáticamente.

1. El autor original utiliza su perfil del sistema/navegador en privado y se
   autentica en su propia cuenta. En un ordenador compartido, primero asegura
   un entorno de recuperación al que otras personas no tengan acceso.
2. Identifica el UUID original por sus propios registros. Comprueba `/api/me`
   y `/api/documents/{uuid}` con su sesión: la segunda ruta debe responder 200 y
   `document.owner_id` debe coincidir con `user.id`. Si no puede confirmar eso
   y que creó esa recuperación, detiene la importación; conserva una copia
   privada para investigar. La ausencia de propietario no se resuelve con una
   fecha, un título o la cuenta de quien usa ahora el ordenador.
3. Con herramientas del navegador, exporta **sólo esa clave** a un archivo JSON
   privado. No vuelca todo el almacenamiento, no pega el HTML en la consola
   como código y no lo renderiza en una página. Examina el JSON como texto con
   un editor de confianza. Mantiene intacta la entrada original y la copia.
4. Recupera explícitamente el texto que reconoce como suyo en un documento
   propio, contrastándolo con el guardado del servidor. La escritura/importación
   se registra como trabajo nuevo. No reenvía los eventos antiguos sin identidad,
   ni los presenta como evidencia recibida en el pasado, ni modifica un sello.
5. Sólo después de verificar el nuevo guardado puede eliminar manualmente esa
   clave concreta. Una entrada v2 retenida por conflicto con un guardado posterior
   puede exportarse y contrastarse del mismo modo, dentro de su cuenta propietaria.

Este aislamiento **no es cifrado**. Quien pueda abrir las herramientas del
navegador, acceder al perfil o disco, ejecutar JavaScript del mismo origen o
explotar XSS puede leer el almacenamiento local. No protege frente a un usuario
malicioso del mismo perfil de sistema. Usar perfiles separados y acceso privado
al equipo; las exportaciones, portapapeles y copias ya recibidas tampoco pueden
revocarse al cerrar sesión. No se borra masivamente trabajo para simular protección.

## Validación

Ejecución final secuencial en Alpine, con los runners existentes; 1.083 MiB de
RAM disponible al inicio y 815 MiB en una comprobación posterior (recurso
compartido, no reservado), 30,3 GiB libres. No se miden RSS o picos comparables.
No se modificó configuración global ni se reservaron cgroups.

- 31 Vitest: recuperación de A tras caducidad, rechazo para B, conservación de
  entradas sin dueño, respuesta pendiente, renovación CSRF y descarga tardías
  tras cambiar identidad; además las regresiones editoriales e históricas previas.
- TypeScript/Vite correctos. Persiste el aviso del chunk editorial, ahora
  aproximadamente 517,78 kB, sin fallo de compilación.
- 35 PHPUnit / 325 assertions, SQLite en memoria: B/C/D, todas las sesiones,
  eventos posteriores con timestamp igual y fecha cliente antigua, cursores,
  IDs de documento/versión/instantánea, sesiones limitadas, imágenes, sellos
  antiguos/nuevos, avisos ES/EN y rechazo de identidad antigua al escribir.
- Chromium con API **simulada**: tildes/composición, pegado/reelaboración,
  ES/EN sin cambiar texto, móvil, guardado/reapertura, ODT Unicode y moviola.
- Cinco simuladores Python de despliegue, con Docker simulado; smoke MariaDB
  real en `inkgroove_check`, defaults/Unicode y aislamiento de sus usuarios.
- Chromium con Apache/PHP/MariaDB **reales**, mismo contexto de navegador:
  B recibe la primera versión y D la segunda, C queda fuera; B no recibe
  borrador, texto, imágenes, sesiones, contadores o metadatos posteriores.
  Intentos con versión posterior, ID de evento y cursor manipulado no amplían
  lectura. Imágenes de la versión accesibles, posteriores denegadas, URL sin
  versión denegada al destinatario. La bandeja muestra el texto autorizado.
- La versión antigua ficticia conserva su firma válida y ofrece sólo la
  instantánea, con proceso 409. Los dos sellos nuevos también verifican.
  Cuatro peticiones reales concurrentes (dos ingestas, guardado, sello) pasan;
  cada cabecera capturada corresponde a su evento, secuencia y hash. En las
  pasadas observadas, el sello concurrente incluyó los cinco eventos ya recibidos.
  No se acredita con ello capacidad ni todos los posibles intercalados.
- En ese contexto real, cerrar la sesión del servidor con trabajo pendiente
  fuerza 401 al guardar: A queda en recuperación v2; B no ve ni restaura ese
  contenido y la entrada permanece intacta. Al entrar A nuevamente, reaparece
  y se guarda. Una entrada antigua sin dueño permanece sin autorestauración.
- La prueba retiene mediante Playwright una respuesta **real** de detalle de A,
  completa el login de B y después entrega el cuerpo original: no abre el editor
  ni muestra texto de A. No es una simulación del servidor. La caducidad se
  provoca invalidando sólo la sesión ficticia, equivalente a la denegación de
  una sesión expirada; no se espera el tiempo de expiración natural.
- Regresión real de 25.000 eventos / cinco sesiones: editor disponible en
  236 ms, guardado durante carga y finalización en 16.090 ms; 51 peticiones de
  metadatos, 96 instantáneas visitadas, máximo 41 filas. Inicio/centro/final,
  reproducción entre bloques, vuelta y reapertura correctos. Moviola sin
  escrituras ni modificación de HTML o `updated_at`. Heap observado al final:
  18.834.472 bytes, sin GC; no es un pico ni una comparación de capacidad.
- HTTP real desde el Mac por un túnel temporal: página de 1.000 metadatos,
  226.929 bytes identity → 11.308 gzip; página de 100 instantáneas,
  84.253 → 8.034 bytes. Igualdad exacta después de descomprimir, `Vary` y
  `private, no-store`; tercero 404 en metadatos/instantánea/bloque. Sello válido
  antes y después de leer. Comprobadas las 25.007 cadenas HMAC, cabeceras,
  hash del contenido y firma. Se cerró el túnel propio al terminar.

En pasadas iniciales se corrigieron la antigua prueba de imagen sin versión,
un efecto de desmontaje bajo StrictMode y la respuesta de logout después de
vaciar el guard. Se respetó el cupo de login esperando en bloques de 15 s.
La pantalla de acceso espera a que termine logout; un login posterior no puede
ser borrado por su respuesta tardía. Las pasadas afectadas se repitieron y
terminaron correctamente. La lectura de la limitación antigua traduce en ES/EN
al cambiar idioma y no presenta un contador de proceso desconocido como cero.

### Identificadores y limpieza

Todos los datos siguientes son ficticios y se eliminaron cotejando ID/correo
mediante los manifiestos de los scripts. Se eliminaron sus entregas, versiones,
imágenes privadas, sesiones editoriales/eventos y sesiones de autenticación;
se retiraron ambos manifiestos. La limpieza final de privacidad verificó cero
usuarios/documentos del fixture. No se borraron backups, volúmenes ni otras cuentas.

| Pasada | Usuarios | Documento |
| --- | --- | --- |
| Inicial, corregida | 6–9 | `01a12551-1282-7313-b403-9c142b3af7f0` |
| Intermedia | 10–13 | `01a12552-61d8-7179-a160-2a3009ad07f4` |
| Intermedia | 14–17 | `01a12553-e468-739d-8b08-5733e4ffc6c2` |
| Privacidad integral correcta | 18–21 | `01a12557-66f4-721c-9660-c377800dde48` |
| Privacidad integral repetida tras guardas CSRF/exportación | 22–25 | `01a1255b-fc11-72bc-a1a2-ae95c235f8cc` |
| Historial largo y tercero | 26, 27 | `01a1255e-964f-72ba-aad2-ff2eb746a0b6` |

Versiones de la última pasada de privacidad, eliminadas con su documento:

- Antigua: `01a1255b-fc12-7265-b636-36c8bd9cee97`;
  entrega `01a1255b-fc13-72b9-a9a3-2158c9d45169`.
- Entrega a B: `01a1255c-39b0-7244-a9b0-552a37d42873`.
- Entrega a D: `01a1255c-3a1f-72c7-8499-512e2fe32fd3`.
- Sello concurrente: `01a1255c-aac4-7315-adaa-d76923bf85e8`.

Versiones de la primera pasada integral correcta:
`01a12557-66f5-70d0-a006-51f53185f0e7`,
`01a12557-87fd-7026-ad00-d7e0fa02092d`,
`01a12557-8858-71ac-bd44-18a294958ffd`,
`01a12557-f928-726c-b355-d263f221fe13`.

Versión del historial largo: `01a1255f-89b6-7389-bf71-08a1710394bc`,
certificado `VRT-XVUEL8A35OJKDWDFGMFX`. Sesiones sembradas:
`01a1255e-964f-72ba-aad2-ff2eb79dba24`,
`01a1255e-96c3-7082-890f-851e54b48682`,
`01a1255e-9737-7292-a34e-c03e4cae80eb`,
`01a1255e-97ae-7121-a8ab-f6e08b33098e`,
`01a1255e-9821-7009-b46c-9ed338b171a8`.
Los siete eventos añadidos por Chromium se eliminaron por cascada con el fixture.

### Estado y límites

`inkgroove-dev-app` y `inkgroove-dev-db` saludables; puerto sólo
`127.0.0.1:8083`. El código y los activos finales quedaron sincronizados y
compilados. Sin migraciones nuevas, regeneración de claves, envío de correo,
commits, push, publicación o cambios en `/opt/veritas`, SiteGround o datos reales.

Pendientes Safari y teclado físico, pico/RSS, capacidad con alumnos, gestión
educativa, recuperación de cuenta y los controles del piloto de SECURITY.
La señal entre pestañas y el sondeo de identidad se implementaron; la prueba
integral de este encargo usa una pestaña en el mismo contexto, no una matriz
exhaustiva de navegadores/pestañas o suspensión del equipo. La expiración se
limpia cuando se detecta y el almacenamiento local sigue accesible a quien
controle ese perfil. Conflictos con un guardado posterior no se sobrescriben
automáticamente: la recuperación se conserva para contraste explícito.
No se declara preparada la beta ni validadas producción o concurrencia de aulas.

## Evolución de la recuperación y concurrencia

El contrato vigente se amplía en [CONCURRENCY_RECOVERY.md](CONCURRENCY_RECOVERY.md):
claves v2 por montaje de editor, selección explícita de copias y revisión entera
para guardar. La comparación histórica por `savedAt > updated_at` deja de decidir
la recuperación; una copia antigua se conserva y se consulta, pero no puede
sobrescribir una revisión posterior. Las entradas v2 anteriores siguen disponibles
para contraste explícito; sin revisión base no se reenvía automáticamente su
escritura. Se mantienen la identidad comprobada y las fronteras firmadas de las
entregas. Los resultados anteriores de este documento son históricos.
