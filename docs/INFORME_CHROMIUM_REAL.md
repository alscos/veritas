# Chromium real: cierre con bloqueo

11-10-2026, Madrid. Activación 00:34:18 Madrid (10-10 22:34:18 UTC).
Checkout `main`, base `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`; todos los
cambios e informes anteriores conservados. Contrato:
[GOAL_CHROMIUM_REAL](GOAL_CHROMIUM_REAL.md). Estado:
[ESTADO_GOAL](ESTADO_GOAL.md).

**El recorrido completo no queda validado.** Dos intentos, ambos con limpieza
verificada y desarrollo saludable. El segundo acredita login, apertura fría,
escritura durante carga y guardado reales; se detiene por una aserción de moviola.
No hubo parada de guardas. Se agota el máximo de dos intentos, aunque quede tiempo
de presupuesto. No hay tercer Chromium ni corrección de aplicación sin causa
identificada. No se declara preparada la beta.

## Revisión, entorno y cambios

Leídos AGENTS, DEVELOPMENT, INFORME_GOAL, PERFORMANCE_BOTTLENECKS,
CAPACITY_AND_STORAGE, DOCUMENT_OPEN_PERFORMANCE, SUBMISSION_PRIVACY y
CONCURRENCY_RECOVERY, con sus informes de cierre. No se repitieron las campañas
previas, pruebas completas, almacenamiento ni auditorías de datos anteriores.

Preflight en ambos intentos: Apache prefork/mod_php, Syntax OK, **padre + dos
hijos**. Configuración existente StartServers/MinSpareServers/MaxSpareServers/
ServerLimit/MaxRequestWorkers = 2; MaxConnectionsPerChild = 500. No se cambiaron
workers, KeepAlive, OPcache, imágenes, recursos del host o claves. App/db dev
healthy antes y después; PHP/MariaDB reales, puerto local 8083.

Se añadieron herramientas de ensayo dedicadas, porque el runner histórico de
25.000 eventos excede este contrato:

- `chromium-real-run.py`: supervisor secuencial, inventario previo, contador
  persistente, guardas existentes, runner Node documentado y limpieza.
- `chromium-real-fixture.php`: un autor, un documento, dos sesiones de 900 eventos
  válidos; margen de 200 para el recorrido. Identidades registradas antes del
  commit del fixture. HMAC generados igual que el fixture histórico; las nuevas
  escrituras atraviesan la aplicación real.
- `chromium-real-probe.php`: prepend temporal de Apache dev, sólo para peticiones
  con marcador de este run; registra SHA-256 de IDs de sesiones, nunca cookies.
- `chromium-real-browser.mjs`: un Chromium/contexto/página, sin interceptar rutas,
  mocks o API simulada. Accede a `http://app` por la red de `inkgroove-dev`.
- Acciones `chromium-real` y `chromium-real-retry` en los scripts remotos y
  documentación de uso en DEVELOPMENT.

Única corrección entre intentos: el runner esperaba la primera respuesta PATCH
200; se corrigió para esperar la respuesta terminal distinta de 419, respetando
la renovación CSRF ya implementada en `api.ts`. No se cambió código de aplicación,
persistencia, métricas, recuperación, autorización, sellado o migraciones.
La corrección está respaldada en el segundo intento por **419 → GET CSRF 200 →
PATCH 200 → POST events 200**. El 401 inicial de `/me` es anterior al login.

Sintaxis PHP/Node comprobada remotamente en ambas pasadas; Python y shell
comprobados; cinco tests simulados de guardas pasan en el cierre. No son prueba
de experiencia real ni de HMAC. Hashes de fuentes de los runners usados en el
segundo intento: [inventario de fuentes](measurements/chromium-real-20261011-sources.json).

## Recorrido y muestras individuales

Chromium **151.0.7922.34**, servicio Node existente con heap de 512 MiB;
`run --rm --no-deps`, sin socket Docker. Sólo un proceso navegador activo por
intento y un escritor; pasadas secuenciales. Sin cinco/treinta usuarios.

CDP aplicó, después del login, **40 ms** de latencia y **1.250.000 bytes/s**
de descarga/subida (10 Mbit/s). Login no limitado por CDP. Apertura fría = primer
montaje del editor en contexto nuevo después del archivo personal, sin precargar
su motor; no es navegación inicial de toda la aplicación. El prepend estuvo
activo en ambas pasadas; no hay comparación sin su coste.

| Intento | Editor disponible desde clic | Métricas completas desde clic | Guardado manual completo | Resultado |
| --- | ---: | ---: | ---: | --- |
| 1 | 366 ms | 565 ms | Sin muestra válida | Harness aborta ante primer PATCH 419 |
| 2 | 352 ms | 556 ms | 381 ms | Guardado confirmado; aserción fallida en moviola |

Son **dos muestras de apertura de intentos fallidos y una de guardado**; no se
calculan medianas/p95. Métricas completas se mide cuando desaparece «Cargando
historial…»; es distinto de editor disponible. Guardado se mide desde el clic
manual hasta «Todo guardado», después de PATCH terminal 200 e ingesta confirmada.
No hay muestras de reapertura, sello, heap final ni recorrido completo.
Fixture 1.800, no 2.000/25.000; no se comparan números con medianas históricas
como si fueran las mismas condiciones.

En ambas pasadas, «Cargando historial…» estaba visible antes y después de insertar
el marcador ficticio `recorrido real á génesis`: **ventana de escritura durante
carga observada**. En el segundo, lectura real del documento confirmó el marcador
guardado y metadatos reales contaron **1.805 eventos**, incluido un `save`.

Moviola del segundo intento: posiciones 0, 902 y 1.804 de 1.805; máximo 41 filas
comprobado en cada visita y marcador conservado en la última instantánea.
El flujo avanzó a reproducción desde 880 y lecturas posteriores de documento y
metadatos. **No se acredita el conjunto de invariantes de moviola**, porque una
aserción de esa fase falló. El resultado registra sólo `AssertionError` y etapa
`moviola`, sin nombre/valor de la comparación. El código realiza después de esas
lecturas comparaciones de HTML, updated_at, revisión, eventos, HTML al regresar
y ausencia de escrituras; la telemetría no permite identificar inequívocamente
cuál falló. El log de respuestas no contiene PATCH/POST nuevos tras entrar en
moviola, pero eso no sustituye todas las comparaciones ni prueba la ausencia de
peticiones fallidas sin respuesta. No se atribuye una corrupción al servidor.

Reapertura y sello no se alcanzaron; cero versiones creadas. No hay frontera
nueva que validar. El supervisor sólo ejecutaba `integrity` tras salida correcta
del navegador: **no recalculó los HMAC/cabeceras del fixture fallido antes de
limpiar**. Es una carencia del harness, no una comprobación correcta. Aunque el
seed genera sus HMAC y la suite anterior valida el núcleo, no sustituyen una
auditoría de estos 1.805 eventos reales. Ya retirados los datos, no se puede
completar retrospectivamente esa auditoría. No se recrean para presentar una
verificación distinta como la original.

## Presupuesto persistente y guardas

Nuevo presupuesto 600 s, independiente del diagnóstico anterior. Consumo
registrado por fases **25,597 s**, incluidas sintaxis, configuración, preparación,
fixtures, navegador, limpieza y auditoría puntual final. Inicio/fin UTC y consumo
de cada fase están en el [agregado completo](measurements/chromium-real-20261011.json).
Conserva anidado el intento 1, también publicado por separado en
[evidencia del primer fallo](measurements/chromium-real-20261011-attempt1.json).
El resultado persistente impide reiniciar el contador; `--retry` exige estado
limpio, sin guarda, fallo CSRF coincidente y exactamente un intento previo.
Ahora rechaza otra repetición, porque hay dos intentos.

| Fase agrupada | Intento 1, segundos | Intento 2, segundos |
| --- | ---: | ---: |
| Preflight/status/sintaxis/acceso al manifiesto | 1,412 | 1,611 |
| Guardas iniciales | 3,002 | 3,002 |
| Instalación y disponibilidad de prepend | 2,404 | 2,406 |
| Crear fixture | 0,604 | 0,602 |
| Navegador | 2,209 | 5,409 |
| Limpiar, estado, salud y ausencias | 1,171 | 1,164 |
| Total | **10,802** | **14,194** |

Auditoría final adicional: **0,601 s**, total 25,597. Preparación y esperas dentro
de cada fase se cuentan; no se descuenta el primer intento. Las sumas incluyen
el sondeo final de salud. Tiempos de trabajo local/redacción no son carga de ensayo.
No se usan segundos restantes para un tercer intento.

Guardas originales reutilizadas sin modificar `measure-capacity.py`: MemAvailable
>=600 MiB; disco >=5 GiB; crecimiento de swap <=128 MiB; salud/timeouts, dos
muestras degradadas, fallo del monitor. Sondeos aproximadamente cada dos segundos,
timeout 3 s; la salud de la instalación existente es sólo lectura `/up` para la
guarda, sin datos, configuración o escritura. Sin ensayos paralelos. El supervisor
tiene límite de fase navegador 240 s y saldo acumulado; detiene sólo el runner
propio tras cotejar nombre/proyecto. En estas pasadas no tuvo que detenerlo.

| Observación muestreada | Intento 1 | Intento 2 |
| --- | ---: | ---: |
| Muestras de monitor | 4 | 5 |
| MemAvailable inicial | 957,02 MiB | 940,91 MiB |
| MemAvailable mínimo | 909,95 MiB | 691,13 MiB |
| Disco disponible mínimo | 29,90 GiB | 29,85 GiB |
| Crecimiento de swap | 0 MiB | 0 MiB |
| Fallos salud dev/existente | 0/0 | 0/0 |
| Guarda activada | Ninguna | Ninguna |

Afinidad dos CPU `4,10`; no reserva de memoria/CPU ni accounting Docker fiable.
El mínimo del segundo deja sólo ~91 MiB sobre la guarda: no demuestra agotamiento
ni margen garantizado para otro ensayo. No se presentan como picos continuos,
PSS del navegador o capacidad de aula.

## Inventario, limpieza e integridad pendiente

Manifiesto previo exclusivo `storage/app/chromium-real.json`, con run, identidad,
documento/sesiones, techo, nombre de runner, registro temporal de sesiones y
configuración. Directorio privado `.dev-private/chromium-real` para ledger/logs.
Se rechazaron nombres/rutas preexistentes. IDs ficticios:

| Intento | Usuario | Documento | Run |
| --- | ---: | --- | --- |
| 1 | 67 | `01cd7325-d3e4-430b-963a-ecd40eba848e` | `5d20900d-aa3d-4fa7-aa7b-ce4d0e7af0e1` |
| 2 | 68 | `eb8d7808-947f-47c3-9b0d-fd262a43fea3` | `06c3db45-f684-47a8-95c4-eb3bb1f8a847` |

Limpieza por ID/correo y propietario, cascadas del fixture y hashes de sesiones
propias, tras cerrar el navegador; retirada exacta del prepend y registro.
Dos hashes de sesión capturados por intento, ninguna sesión anónima restante
que borrar en ese momento (la regeneración de login ya retiró la anterior).
Dos/tres sesiones editoriales retiradas respectivamente, cero versiones. Los
conteos después de borrar cubrieron eventos de todas esas sesiones y dieron cero.
No se publican los hashes de IDs de autenticación.

Auditoría puntual posterior: **cero usuarios 67/68, documentos, sesiones
editoriales, versiones y sesiones autenticadas propios**. Ausentes ambos runners
(`--rm`), ambos registros /tmp, prepend, manifiesto y directorio privado; sin
imágenes, descargas, túneles, redes o volúmenes nuevos. No hubo residuos nuevos
sin atribución. Las candidatas anónimas antiguas del diagnóstico anterior siguen
fuera de este inventario; no se consultan/borran ni se afirma su ausencia.
Se conservan backups remotos creados por sync, como exige el flujo documentado.

Desarrollo final: **app/db healthy, padre + dos hijos, `/up` 200 en 19,62 ms,
sin Set-Cookie**. La sonda fue retirada y Apache recargado sin cambiar el pool.
No se lee contenido real ni se cambia producción, SiteGround, host, claves,
esquema, recursos globales o controles de acceso. Sin commits, push, correo o
publicación. Los informes anteriores permanecen intactos.

## Bloqueo y siguiente prioridad

Bloqueo concreto: **dos intentos agotados, aserción de moviola sin detalle
suficiente y auditoría HMAC/reapertura no alcanzadas**. Estado seguro y evidencia
conservados; no hay otro ensayo permitido en esta tarea.

La siguiente tarea debe corregir primero la instrumentación del harness:
nombrar cada invariante y guardar resultados parciales y hashes de HTML propio,
revisión, updated_at y conjuntos de IDs antes/después, sin cookies ni contenido
real. Ejecutar la auditoría HMAC también tras un fallo de aserción que no active
una guarda, antes de limpiar y dentro del presupuesto; tras una guarda, conservar
el inventario/evidencia y realizar sólo limpieza autorizada. Con esa corrección,
autorizar un nuevo intento acotado con presupuesto explícito; no borrar el
ledger actual para reutilizarlo. Sólo si demuestra fallo de aplicación, aplicar
una corrección mínima y su prueba pertinente. No atribuir todavía el fallo a
workers, PHP, SQL, DOM o conservación de eventos.

Reapertura, HMAC de este recorrido y sello/frontera siguen pendientes. Safari
con teclado físico, capacidad de treinta alumnos y preparación de beta siguen
pendientes. Este ensayo funcional parcial no acredita cinco usuarios con
navegador, aula concurrente, gestión educativa o equivalencia con SiteGround.
