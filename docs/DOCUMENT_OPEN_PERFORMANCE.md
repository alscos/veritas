# Medición de apertura de documentos (10-10-2026)

Checkout inicial: `main`, `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`.
Edición en el Mac y ejecución secuencial en `/opt/veritas-dev` de Alpine.
Se conservaron los cambios locales previos. No se consultaron documentos reales,
secretos ni la instalación `/opt/veritas`; no hubo cambios de configuración,
migraciones nuevas, commits ni push.

## Base gzip previa a la paginación

Las secciones siguientes conservan las mediciones históricas del checkout
anterior a esta intervención. El contrato actual y la validación integral
figuran más abajo.

## Causa comprobada

`App.tsx` espera simultáneamente el detalle y `/timeline` antes de montar el
editor. El historial devuelve una instantánea HTML por evento. La respuesta
crece con el número de eventos multiplicado por el tamaño del texto, aunque
las instantáneas compartan casi todo su contenido. La ruta no comprimía la
respuesta en la aplicación y el Apache de desarrollo no habilita deflate.

Se usaron exclusivamente datos sintéticos: 2.000 eventos, un texto de unas
600 palabras, NFC/NFD, líneas vacías y marcas `paste`/`paste-edited`. Las
instantáneas tienen un sufijo numérico distinto. Este caso representa revisiones
repetidas sobre un texto ya extenso; no pretende representar todos los documentos.

## Backend Laravel, SQLite en memoria

`TimelineTransportTest` ejercita la ruta autenticada, sus consultas y la
serialización real. Cinco repeticiones; tiempos en milisegundos:

| Medición | Antes | Después |
| --- | ---: | ---: |
| Bytes HTTP del historial | 13.900.425 | 213.179 |
| Mediana petición sin gzip | 107,72 | 117,81 |
| Mediana SQL sin gzip | 15,78 | 20,68 |
| Mediana petición con gzip | — | 128,98 |

La compresión de nivel 1 costó unos 21 ms en la medición inicial y 23 ms en
la posterior. Los tiempos cambian en este host compartido; no se atribuye
la variación de SQL al cambio. La reducción de transferencia es del 98,5 %.
La medición de backend no incluye red, Apache ni MariaDB.

## Chromium: apertura y moviola

`scripts/measure-document-open.mjs` sirve una API sintética por HTTP con Vite,
sin interceptar las peticiones mediante Playwright. Chromium limita la descarga
a 10 Mbit/s y añade 40 ms de latencia. El motor del editor está precargado en
ambas variantes para aislar el historial. Se mide desde el clic hasta la
recepción del historial y hasta que aparece `.ProseMirror`.

El fixture de navegador tiene el mismo HTML y número de eventos, pero menos
metadatos que Eloquent: 13.463.246 bytes sin comprimir y 83.312 bytes con gzip.
El servidor sintético compara ambas codificaciones sobre el mismo código de
interfaz; no es una prueba integral contra Laravel/MariaDB.

| Variante | Historial, tres ejecuciones (ms) | Editor, tres ejecuciones (ms) |
| --- | --- | --- |
| Sin compresión | 10.954 / 10.981 / 10.987 | 12.020 / 12.141 / 12.071 |
| Gzip | 204 / 209 / 214 | 1.702 / 1.439 / 1.263 |

Mediana de apertura: **12,071 s → 1,439 s**, reducción del **88,1 %**.
El coste restante incluye deserialización, análisis de métricas, montaje y
paginación. La prueba comprueba el cuerpo descomprimido byte por byte, contenido
del editor, párrafos vacíos, igualdad de métricas entre variantes y apertura
de la moviola con todos los eventos históricos y el inicio de la sesión nueva.

## Cambio

`CompressTimeline` comprime exclusivamente la respuesta de lectura del
historial, con negociación `Accept-Encoding: gzip`, nivel 1 y umbral de 4 KiB.
Mantiene la respuesta sin compresión para cuerpos pequeños, clientes que no
aceptan gzip, `gzip;q=0`, ausencia de zlib y cuerpos que no se reducen.
Respeta respuestas ya codificadas y no comprime errores. Añade `Vary:
Accept-Encoding` y `Cache-Control: private, no-store` a respuestas correctas.

El navegador descomprime antes de `response.json()`. No cambian el contrato
JSON, el contenido, los eventos, su orden, las secuencias, tiempos, hashes,
sellos, fórmulas de métricas ni la moviola. No hay cambios de esquema,
reescritura de eventos ni caché de historiales privados.

## Reproducción histórica (antes de paginación)

Estos comandos corresponden a la interfaz/API anterior. El benchmark sintético
`measure-document-open.mjs` requiere ese checkout y no debe ejecutarse contra
la interfaz paginada. Para el estado actual usar los comandos de DEVELOPMENT
y los scripts `measure-dev-*` / `check-dev-history-*`.


Después de `sh scripts/dev-remote.sh sync`, ejecutar por separado, secuencialmente:

```sh
/usr/bin/ssh inkgroove-alpine 'cd /opt/veritas-dev && docker compose --env-file /dev/null -p inkgroove-dev -f compose.dev.yaml run --rm --no-deps -e INKGROOVE_BENCHMARK=1 php php vendor/bin/phpunit --filter TimelineTransportTest'
/usr/bin/ssh inkgroove-alpine 'cd /opt/veritas-dev && docker compose --env-file /dev/null -p inkgroove-dev -f compose.dev.yaml run --rm --no-deps node node scripts/measure-document-open.mjs'
sh scripts/dev-remote.sh test
```

## Validación realizada

Los seis pasos de `test` terminaron correctamente y se ejecutaron
secuencialmente en Alpine: 22 pruebas Vitest; TypeScript/Vite; 30 pruebas
PHPUnit con 201 assertions; cinco simuladores Python; recorrido Chromium
(composición nativa, procedencia, ES/EN, móvil, guardado/reapertura, ODT Unicode
y moviola); smoke MariaDB de defaults, Unicode y aislamiento de usuarios de
las bases dev/check. Las nuevas pruebas cubren negociación, cuerpos pequeños,
equivalencia exacta del historial y denegación a otro propietario. El benchmark
de navegador terminó sus seis aperturas correctamente.

Persiste el aviso previo de Vite por el chunk del editor de 517,53 kB.

## Límites de la base gzip (históricos)

- La compresión reduce la red, pero mantiene el coste de cargar el historial
  completo en memoria y analizar HTML. No demuestra capacidad concurrente.
- El límite previo de 10.000 eventos de `/timeline` permanecía en esta base;
  la intervención siguiente lo elimina mediante paginación.
- La primera apertura añade la carga del motor editorial; la medición aislada
  anterior usa el motor precargado. No se validó la latencia de producción.
- Pendientes Safari y teclado físico de macOS, historias mayores y pruebas
  integrales de latencia con PHP/MariaDB y conexiones de los futuros usuarios.

## Validación integral y paginación (10-10-2026)

Se conservó todo el trabajo local, incluido `CompressTimeline`. Se comprobó
`main` / `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0` antes de editar. `sync`,
`build` y `up` actuaron únicamente sobre `inkgroove-dev`. No hubo commits,
push, publicación, cambio de esquema/clave ni acceso a documentos existentes,
`/opt/veritas` o SiteGround. Los resultados siguientes corresponden al árbol
sin commit, no a producción ni CI.

### Condiciones de la base real

PHP 8.3.35, MariaDB 11.4 del proyecto dev, Apache y activos Vite de producción;
Node 22.23.3 y Chromium/Playwright del runner documentado. RAM compartida
inicial disponible: 1.140 MiB; disco libre: 30,4 GiB. Los comandos pesados de
pruebas y compilación se ejecutaron secuencialmente, con un worker Vitest y
heap Node/PHP de 512 MiB. Docker stats devuelve `0B / 0B` en este host: no se
usa como evidencia de RSS. No se modificaron los cgroups ni la configuración
global. El sembrado del fixture grande coincidió con una pasada PHPUnit
(15,158 s); ese tiempo no se usa como benchmark. La pasada posterior sin
esa coincidencia tardó 4,454 s, con 66,50 MB reportados por PHPUnit.

El fixture pequeño tiene 2.000 instantáneas distintas de unas 600 palabras,
dos sesiones y las mismas marcas/NFC/NFD/líneas vacías de la base sintética.
Las sesiones comparten hora de recepción fija `2026-10-10 12:00:00`, con
secuencias repetidas entre sesiones: ejercita empates, no representa duraciones
humanas reales. El reloj real de los nuevos eventos es el del servidor; por
eso no deben interpretarse las métricas temporales absolutas de ese fixture
ni compararse después de añadir sesiones como si fuera el mismo proceso.

HTTP desde el Mac usó `http://127.0.0.1:18083`, túnel SSH a `127.0.0.1:8083`,
una cookie de sesión ficticia y CSRF reales, sin throttling de red. Se leyó el
cuerpo completo de cada respuesta, tres veces por codificación, sin publicar
cookies ni tokens. Antes de paginar:

| Timeline real, 2.000 eventos | Bytes | Tiempos (ms) |
| --- | ---: | --- |
| Identity | 14.023.244 | 227,32 / 240,38 / 241,60 |
| Gzip | 222.858 | 136,21 / 149,19 / 156,84 |

Gzip redujo el cuerpo un 98,41 %. Ambos devuelven los 2.000 eventos; el cuerpo
descomprimido tiene 14.023.244 bytes y `Vary: Accept-Encoding`.

### Chromium real: antes y después

No se interceptó ninguna respuesta. El navegador accedió a `http://app` por
la red Docker exclusiva de dev y autenticó la cuenta ficticia. CDP impuso
10 Mbit/s y 40 ms después de cargar el archivo personal. Cada primera apertura
usa una página/contexto nuevo sin precargar el motor; la reapertura conserva
el motor y la caché del mismo contexto. Las seis aperturas visitan la moviola,
vuelven y guardan al salir: añaden eventos de sesión/guardado al fixture.
La comparación final usa otro fixture nuevo del mismo tamaño/HTML; las IDs y
las sesiones nuevas varían. No se presentan las diferencias de métricas
absolutas de esos procesos como efecto de la paginación.

| Editor disponible (ms) | Base gzip | Paginación, medición final |
| --- | --- | --- |
| Primera apertura, tres muestras | 8.954 / 8.922 / 8.950 | 832 / 805 / 817 |
| Reapertura, tres muestras | 15.514 / 15.693 / 15.566 | 126 / 122 / 166 |
| Mediana primera apertura | 8.950 | 817 |
| Mediana reapertura | 15.566 | 126 |

Reducción de mediana: **90,87 %** en primera apertura y **99,19 %** en
reapertura. Las métricas completas en la variante paginada tardaron
9.328 / 9.302 / 9.300 ms en primeras aperturas y 920 / 922 / 972 ms en
reaperturas. La disponibilidad del editor y el fin del historial son hitos
distintos; la paginación no hizo instantáneo el análisis de métricas.
Se observaron 401 iniciales en `/me` antes del login y un 419 en el primer
POST de eventos después de cada login, recuperado por la renovación CSRF
existente. No se ocultaron ni interceptaron esas respuestas.

La suma CDP de bytes de respuestas terminadas hasta métricas completas fue:

| Bytes CDP (activos + detalle + historial) | Base gzip | Paginación final |
| --- | --- | --- |
| Primera apertura | 406.154 / 406.913 / 407.839 | 201.515 / 209.301 / 210.414 |
| Reapertura | 240.111 / 241.789 / 257.470 | 38.729 / 39.936 / 41.052 |

Es una medida agregada de navegador, no bytes exclusivos del historial ni
tráfico del túnel SSH. HTTP desde el Mac al terminar el benchmark final leyó
**2.012 eventos en tres páginas** (incluye 12 eventos nuevos):

| Metadatos completos, HTTP Mac | Bytes sumados | Tiempos (ms) |
| --- | ---: | --- |
| Identity | 456.515 | 311,30 / 333,12 / 329,65 |
| Gzip negociado | 22.648 | 307,58 / 307,91 / 329,45 |

Las dos páginas grandes se comprimen; la última pequeña conserva identity
por el umbral de 4 KiB. Se mantienen `private, no-store` y `Vary`. La
transferencia con gzip baja frente a los 222.858 bytes previos, pero hay tres
peticiones y no se compara su tiempo total con el de una sola petición como
si fueran equivalentes.

Heap JS observado por CDP, en MB decimales, sin forzar GC:

| Muestra | Base gzip | Paginación final |
| --- | --- | --- |
| Primera apertura | 10,22 / 10,22 / 10,21 | 13,06 / 20,93 / 13,46 |
| Reapertura | 32,09 / 53,98 / 29,80 | 20,20 / 17,11 / 20,19 |

Estas muestras no miden pico de memoria, RSS, memoria de PHP/MariaDB ni una
reducción concluyente: dependen de GC, caché y eventos acumulados. El límite
estructural sí se prueba: no se transfieren instantáneas para abrir el editor,
la caché remota de moviola tiene 64 entradas y su lista tiene como máximo 41.

### Historial real de 25.000 eventos

Fixture diferente y de tamaño controlado: cinco sesiones de 5.000 eventos,
HTML de unas 25 palabras más marcas/Unicode/líneas vacías; cada sesión tiene
una hora fija distinta (`12:00:00` a `12:00:04`). No se usaron 25.000 copias de
un documento de 600 palabras. Chromium real no limitó la red en este recorrido;
no es comparable numéricamente con el benchmark anterior.

- Editor disponible: **242 ms**, con historial aún cargando.
- Carga completa y guardado de texto escrito durante la carga: **16.821 ms**.
- Dos aperturas: 51 peticiones de metadatos; 96 IDs de instantáneas solicitados
  al visitar inicio, centro y final y reproducir cruzando un bloque de 32.
- Lista: máximo 41 filas; contenido y `updated_at` del borrador idénticos antes
  y después de navegar/reproducir. Ningún POST/PATCH durante la moviola.
- Guardado y reapertura conservaron el texto nuevo; las métricas eran completas
  y se conservaron al volver de moviola. Heap al final: **26.979.216 bytes**,
  muestra sin GC; no existe una base anterior comparable de 25.000 eventos
  porque la ruta antigua recortaba a 10.000.
- HTTP Mac: otro propietario recibe 404 al pedir metadatos, una instantánea o
  un bloque. Sello real válido antes y después de leer el historial.
- Recalculadas **25.007 cadenas/eventos HMAC**, cabezas de sesión, hash del
  contenido sellado y firma del certificado: correctos. En el fixture pequeño
  final se recalcularon también los 2.012 eventos: correctos.

### Contrato y métricas

El contrato está descrito en [ARCHITECTURE.md](ARCHITECTURE.md). El borrador
abre sin esperar al historial; los metadatos llegan por cursor con cota de ID.
Se conserva el orden previo por hora y secuencia y se añade ID como desempate
estable. Antes ese desempate no estaba definido: no se promete reproducir el
orden arbitrario de empates de una consulta antigua. No se toca ningún evento
persistido. Todos los eventos son accesibles, sin recorte a 10.000.

Las funciones originales están en `writingMetrics.ts`; solo sustituyen el
análisis de HTML por `direct_words` cuando existe ese dato:

- PPM histórico: incremento no negativo de palabras directas entre primera y
  última instantánea del tramo de sesión; tiempo desde el primer `insert`
  distinto de pegado que supera las palabras directas iniciales hasta el último
  evento. Exige al menos tres palabras y cinco segundos; redondea ppm. Busca
  hacia atrás la última sesión con resultado. El ritmo vivo conserva el tiempo
  desde la primera escritura y el incremento frente al texto inicial.
- Agrupación y tiempos conservan sus reglas: nueva sesión por cambio de ID o
  reinicio de secuencia; total por máximo elapsed; intervalos blur/focus se
  restan de los huecos entre ediciones. Huecos de al menos 5 s y cola de al menos
  5 s son pausas; los menores se asignan a escritura (`insert`) o revisión.
- Palabras directas usan el mismo patrón Unicode, fronteras de bloque y
  procedencia: una palabra tocada por `paste` o `paste-edited` no es directa.
  No hay normalización Unicode ni traducción del contenido.
- Mientras falta historial no se muestran totales parciales como definitivos
  ni se usa un PPM histórico parcial; carga/error/reintento son explícitos en
  ES/EN. El PPM vivo puede mostrarse cuando ya tiene datos propios suficientes.

### Pruebas y limpieza

Pruebas sintéticas con SQLite: 32 PHPUnit, 275 assertions, incluida paginación
exacta de 25.000 eventos, cinco sesiones, empates, append con fecha anterior
durante la carga, ausencia de duplicados/omisiones, permisos y HTML/hash sin
alteración. Frontend: 26 Vitest, con equivalencia de PPM/todos los tiempos entre
HTML y metadatos, 25.000 metadatos y conservación de eventos nuevos. Compilación
TypeScript/Vite correcta; persiste el aviso de chunk editorial de 517,53 kB.
El recorrido Chromium de API controlada comprobó tildes, procedencia, ES/EN,
móvil, guardado/reapertura, ODT y moviola. No se confunde con los recorridos reales
anteriores. Cinco simuladores de despliegue y smoke MariaDB independiente
(defaults, Unicode y separación de usuarios) correctos.

Un intento adicional de Vitest descubrió tests en las copias incompletas de
`.dev-backups`. Se corrigió su búsqueda a `resources/js`; se conservaron las
copias y se repitieron únicamente las comprobaciones afectadas.

IDs ficticios, creados y eliminados por cotejo exacto/cascada del manifiesto:

| Uso | Usuarios | Documento |
| --- | --- | --- |
| Base gzip + primera medición progresiva | 2 | `01a122fe-9a2a-71b5-8495-6cf78e40c6c6` |
| 25.000 eventos + permisos + sello | 3 y 4 (otro propietario) | `01a12304-b8dd-706a-b951-ecf1645c2eb8` |
| Medición progresiva final | 5 | `01a12308-807f-716b-87a4-53a51c4c2e03` |

Sesiones sembradas del primero: `01a122fe-9a2b-706e-a0b1-6d34bd26def3`,
`01a122fe-9a8a-7390-82f0-afa2a93e9799`. Del grande:
`01a12304-b8dd-706a-b951-ecf165388f15`, `01a12304-b95b-70dd-87aa-f8057a8e3b18`,
`01a12304-b9dd-70c4-9c0c-706b5e769702`, `01a12304-bab1-73f5-a4f4-65951a6add74`,
`01a12304-bb6d-71c7-b146-3cc503bba2e1`. Del pequeño final:
`01a12308-807f-716b-87a4-53a51cdcd0e5`, `01a12308-80c0-728f-9c2a-ecbe37132e52`.
Versión ficticia: `01a12307-a6b6-708f-b9af-931de4f536d1`; certificado
`VRT-M9XFWNU32ORNJRLGNFDX`, eliminado con ese documento. También se eliminaron
por cascada las sesiones/eventos añadidos por Chromium, y por ID las sesiones
de autenticación de esos usuarios; se retiró el manifiesto. No se borraron
otros datos ni volúmenes.

### Límites y pendientes actuales

No hay bloqueo de ejecución. La aplicación dev queda saludable. El análisis
histórico sigue recorriendo HTML en PHP y las consultas no tienen un índice
nuevo específico del orden global; medir con tamaños/usuarios reales antes de
optimizar o aumentar el piloto. Los metadatos completos siguen siendo O(n),
y la sesión activa conserva sus instantáneas locales. El pico/RSS no se pudo
medir de forma comparable; las muestras de heap no acreditan capacidad.

Pendientes Safari con teclado físico de macOS, capacidad con alumnos y los
controles de seguridad/gestión educativa indicados en AGENTS y SECURITY. No se
validaron producción, SiteGround ni concurrencia de grupos.
