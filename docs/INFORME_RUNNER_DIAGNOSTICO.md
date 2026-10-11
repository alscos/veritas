# Preparación del runner de diagnóstico

11-10-2026, Madrid. Activación 00:51:14 Madrid (10-10 22:51:14 UTC), límite
23:11:14 UTC: veinte minutos. `main`, base `04c2e9c`, trabajo previo conservado.
**No se ejecutó Chromium, carga, fixture ni auditoría real.** Sólo scripts,
pruebas aisladas y documentación de pruebas.

Cierre documental 10-10 23:02:16 UTC: unos once minutos, dentro del límite.

## Evidencia recuperada

Leídos AGENTS, INFORME_CHROMIUM_REAL, los
[agregados conservados](measurements/chromium-real-20261011.json), el
[primer fallo](measurements/chromium-real-20261011-attempt1.json), el
[inventario histórico de fuentes](measurements/chromium-real-20261011-sources.json)
y únicamente los scripts implicados. Los logs privados habían sido retirados;
no se recrearon/restauraron datos para suplirlos.

Primer intento: aserción de estado del primer PATCH, **esperado 200 / observado
419**. La corrección anterior esperó el resultado terminal de la renovación
CSRF; el segundo registro conserva 419 → CSRF 200 → PATCH 200 → events 200.
Esto no demuestra un fallo de la aplicación.

El fallo de moviola del segundo intento **no puede identificarse exactamente**.
Se conservan `failed_stage=moviola`, `error_type=AssertionError`, 1.805 eventos,
posiciones 0/902/1.804 y respuestas de lectura. Faltan ID/operador de la aserción,
mensaje y stack con línea original; HTML antes/después o hashes, revisión y
updated_at comparados; conjuntos ordenados de eventos o hashes; lista de
peticiones de escritura y checkpoints de cada comparación aprobada. Las
respuestas no prueban ausencia de peticiones fallidas sin respuesta.

El tramo del código contiene seis comparaciones finales: HTML del borrador,
updated_at, revisión, eventos, HTML al regresar y ausencia de escrituras. No
se puede elegir una con certeza ni recuperar sus valores observado/esperado.
No se atribuye el fallo a aplicación, DOM, SQL o workers. Los fixtures se
eliminaron: **la auditoría HMAC anterior sigue pendiente, sin reconstrucción
retrospectiva posible**. No se reescriben resultados/informes anteriores.

## Cambios preparados

Todas las aserciones de `chromium-real-browser.mjs` tienen identificadores
descriptivos, conservando exactamente sus predicados y límites. Las seis finales:

| ID | Exigencia conservada |
| --- | --- |
| `moviola.draft_html_unchanged` | HTML del servidor idéntico |
| `moviola.updated_at_unchanged` | Fecha idéntica |
| `moviola.revision_unchanged` | Revisión idéntica |
| `moviola.server_events_unchanged` | Eventos idénticos, incluido orden |
| `moviola.editor_html_unchanged` | HTML al regresar idéntico |
| `moviola.no_write_requests` | Cero peticiones API distintas de GET |

El helper puro `chromium-real-diagnostics.mjs` registra paso, comparación,
operador, observado/esperado y aserciones aprobadas. Números/booleanos se
conservan; cadenas/HTML y arrays se resumen con longitud, bytes y SHA-256.
Añade primer índice diferente del array o posición UTF-16 diferente de la
cadena, sin normalizar Unicode. **Los hashes no sustituyen la comparación:**
strictEqual/deepStrictEqual/match/ok operan sobre los valores completos.

Conserva nombre/código/operador de la excepción, hasta seis frames y mensaje
acotado/redactado. Para AssertionError: primera línea y resumen del mensaje
original completo. Node 22 añade valores incluso con mensaje explícito; así
se evita publicar HTML expandido. Un fallo de operación borra la comparación
anterior para no atribuirle un timeout posterior. Errores de cierre se registran
aparte; se cierra antes de esperar operaciones pendientes. Si close falla,
se declara cierre incierto y no se bloquea esperando esas promesas.

`chromium-real-run.py` y el helper puro `chromium_real_errors.py` preparan:

1. Fin del proceso y recuperación del diagnóstico, con cierre de navegador
   confirmado. Puede recuperar el JSON de stdout propio si falla escribir el
   archivo del resultado; ignora texto de Docker y otros intentos.
2. Con fixture confirmado, navegador cerrado, guarda inactiva y saldo disponible,
   **auditoría existente de los eventos propios antes de limpiar**, incluso tras
   fallo funcional. El monitor sigue activo durante la auditoría y la fase usa
   el contador/límite existentes.
   El timeout limita también PHP dentro del contenedor, no sólo docker-exec,
   reservando un segundo para terminarlo; con menos de dos segundos de saldo
   no se inicia y queda pendiente por presupuesto insuficiente.
3. Guarda activa, presupuesto agotado, fixture no confirmado o cierre incierto:
   auditoría `pending`, con motivo explícito. Si guarda/presupuesto interrumpe
   la auditoría iniciada, queda fallo y motivo pendiente, seguido de limpieza.
4. Limpieza por manifiesto, sin sustituir el fallo original por un error de
   auditoría o limpieza. Auditoría correcta no convierte recorrido fallido en
   éxito. Se enumeran errores secundarios y se intentan las demás acciones propias.

La limpieza mantiene identidad/propietario y hashes de sesiones. Si falla borrar
filas, se conserva el registro exacto de sesiones para recuperar la limpieza;
se intenta retirar sólo la configuración de sonda propia. Un error de auditoría
conserva su log privado aunque limpiar pase; sólo tipo/fase/código se publican.
Si falta el diagnóstico del navegador o su archivo es ilegible, se preservan
logs privados. No se borra por tiempo/IP/user-agent ni se modifica el limpiador
PHP, algoritmo HMAC, guardas, workers o permisos de reintento.

## Validación realizada

Checks secuenciales en Alpine con servicios PHP/Node existentes de `inkgroove-dev`,
`run --rm --no-deps`, sin Laravel, SQL, HTTP o importación de Playwright:

- **12 unittest Python**, correctos: auditoría antes de limpieza tras fallo;
  guardas/presupuesto/cierre incierto/fixture ausente; interrupción durante
  auditoría; errores simultáneos; causa original conservada; continuación de
  acciones de limpieza y recuperación del diagnóstico sin archivo.
- **8 pruebas nativas Node**, correctas: IDs/valores numéricos; HTML exacto sin
  publicarlo; omisiones/reordenación rechazadas; operación sin comparación obsoleta;
  redacción/límites; cierres fallidos y fallo de lanzamiento sin escritor abierto.
- `node --check` del runner y parseo AST de supervisor/helper/tests Python.
  Diff, whitespace y enlaces locales comprobados.

Primera pasada aislada Node: 7/8; detectó la ampliación del mensaje de aserción
por Node 22. Corregidos diagnóstico y expectativa, repeticiones afectadas 8/8.
Python pasó inicialmente diez pruebas; se añadió y validó la de recuperación
de stdout y la de saldo insuficiente para acotar PHP. Ninguna prueba lanzó
Chromium. No se repitieron suites completas.
Se retiraron sólo dos bytecodes propios de las primeras pruebas; runners efímeros.

## Estado y pendientes

Runner preparado con **errores inyectados**, no validado con navegador/MariaDB.
El contador anterior permanece intacto: **2/2 intentos y 25,597 s**. Informes,
agregados e inventario histórico de fuentes intactos; este último describe las
fuentes anteriores, no el runner modificado. Sin datos reales, nuevos fixtures,
auditoría HMAC real, migración, cambios de aplicación/worker/producción/clave/host,
commits, push o publicación. No se instaló instrumentación ni se consultó `/up`:
el estado saludable conocido es el cierre anterior, no una nueva comprobación.

Pendientes: identificar la aserción histórica, verificar moviola, reapertura e
integridad en otro ensayo autorizado con presupuesto propio. **Esta tarea no
autoriza una tercera ejecución ni reiniciar el contador.** Safari/teclado físico,
treinta alumnos y beta permanecen pendientes.
