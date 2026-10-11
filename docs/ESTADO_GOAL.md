# Estado del goal de rendimiento

Actualizado: **10-10-2026, 16:23:49 UTC**. Activación 16:20:12 UTC;
límite 18:20:12 UTC. Checkpoint: cierre documentado con límite de nueva carga.

- Leídos contrato, desarrollo, capacidad, diagnóstico más reciente, apertura,
  privacidad y concurrencia. `main`/`04c2e9c`; cambios anteriores conservados.
- Cuello de un worker corregido previamente a dos; comparación mínima ya
  concluida, no repetida. Cinco pruebas remotas de guardas pasan nuevamente.
- Estado remoto: app/db saludables; Apache Syntax OK y pool efectivo configurado
  a dos. Ausentes manifiesto/export/sonda/logs de capacidad y directorio privado
  bottleneck. No se ha creado fixture ni instrumentación en este goal.
- Presupuesto de nueva carga **no acreditable**: agregado previo mezcla pausas,
  preparaciones y carga (750,58 s en una ventana); diagnóstico posterior ~63 s.
  No se acepta ~63 s como total acumulado. Nueva carga: **0 s**;
  experimentos correctivos nuevos: **0/3**.
- Comprobación final: `/up` 200 en 12,63 ms sin Set-Cookie; cero cuentas,
  documentos y sesiones autenticadas de IDs inventariados 36–66. Sin directiva
  activa auto_prepend ni artefactos temporales bottleneck. MemAvailable 963,30
  MiB; disco ~29,94 GiB; app/db saludables. No se borró nada.
- Contrato e informe final escritos; referencia a ocho workers corregida en
  DEVELOPMENT. Diagnóstico diferencia ~63 s de su fase de 1.752,36 s de ventanas
  anteriores, que mezclan carga/esperas. Capacidad HTTP previa: cinco + profesor
  en perfil corto, no navegador concurrente ni treinta alumnos.
- Comprobación documental completada: `git diff --check`, whitespace y enlaces
  de los cinco documentos correctos. Cierre en menos de cuatro minutos; no hay
  acciones pendientes dentro del presupuesto seguro de esta tarea.
- Pendiente fuera del cierre: un Chromium real con pool de dos y presupuesto
  explícito nuevo; después campaña pequeña si pasa. PHP/SQL/locks del editor,
  NAT, Safari/teclado físico y controles del piloto siguen pendientes.
- Bloqueo: sin un registro acumulado inequívoco no se puede repetir Chromium ni
  escritores. Haría falta una nueva tarea con presupuesto explícito; no basta
  tiempo transcurrido ni relajar guardas. No bloquea el cierre documental seguro.
- Limpieza histórica limitada: no hay inventario inequívoco de 31 candidatas
  anónimas; no se eliminan por tiempo/IP/user-agent ni se afirma que su GC ocurrió.
  No repetir campañas o limpieza global al retomar. Ver [INFORME_GOAL](INFORME_GOAL.md).

## Chromium real — checkpoint 1, 11-10-2026 00:38 Madrid

Nueva activación 10-10-2026 22:34:18 UTC; límite 11-10 00:04:18 UTC.
Contrato nuevo: [GOAL_CHROMIUM_REAL](GOAL_CHROMIUM_REAL.md). Presupuesto nuevo
600 s, independiente del cerrado; consumo de ensayo todavía 0 s, intentos 0/2.
Rama/base y cambios revisados; informes anteriores conservados y leídos.
El runner histórico de 25.000 eventos no cumple este contrato: se prepara una
variante dedicada que reserva margen bajo los 2.000 y registra sesiones propias
desde el primer acceso. No se ha creado fixture ni ejecutado navegador.
Pendiente: inventario, guardas/preflight, ensayo único, integridad y limpieza.

## Chromium real — checkpoint 2, 11-10-2026 00:39 Madrid

Primer intento 22:39:03–22:39:14 UTC: consumo **10,802 s/600**, intentos 1/2.
Pool efectivo confirmado padre + dos hijos; guardas sin paradas, mínimo
MemAvailable 909,95 MiB. Login real 200, editor 366 ms, métricas 565 ms,
ventana de escritura durante carga observada. Fallo demostrado del harness:
assert exigía 200 sobre primer PATCH 419, antes de la renovación/reintento
CSRF existente en api.ts. No se interpreta como fallo final de la aplicación.
Evidencia preservada en measurements/chromium-real-20261011-attempt1.json.
Fixture usuario 67/documento 01cd7325-d3e4-430b-963a-ecd40eba848e limpiado:
cero filas inventariadas, dos hashes de sesiones propios cotejados; sonda/runner
retirados, dev saludable. Corrección mínima del runner: esperar respuesta
terminal distinta de 419. Se habilita sólo un segundo intento con el contador
previo conservado; prohibido reintentar después de guarda o tercer intento.

## Chromium real — checkpoint 3, 11-10-2026 00:43 Madrid

Ensayo terminado con bloqueo; **intentos 2/2**, consumo acumulado **25,597/600 s**
incluida auditoría de cierre. No habrá tercer intento aunque quede presupuesto.
Intento 2, 22:39:59–22:40:14 UTC: login real, editor 352 ms, métricas 556 ms,
guardado 381 ms, escritura durante carga observada y 1.805 eventos en servidor.
Secuencia CSRF 419 → renovación 200 → PATCH 200 → events 200 confirma corrección
del harness. Moviola visitó inicio/centro/final y luego falló una aserción sin
identificador; no se acredita invariancia completa, reapertura ni sello.
HMAC no auditados: supervisor sólo los ejecutaba tras navegador correcto y
limpió al fallar. Carencia registrada, sin sustituirla por pruebas históricas.
Guardas sin activación; mínimo MemAvailable 691,13 MiB, cinco muestras.

Limpieza de ambos fixtures cotejada: usuarios 67/68, documentos/sesiones/versiones
y sesiones autenticadas propios en cero. Runners, registro/prepend, manifiesto
y directorio privado ausentes. Dev app/db saludables, tres procesos Apache,
`/up` 200 en 19,62 ms sin Set-Cookie. Cinco tests de guardas pasan. Ningún cambio
de app/migración/worker/producción; sólo herramientas, corrección del runner e
informes. Evidencia agregada y primer fallo conservados en docs/measurements.

Siguiente prioridad externa: instrumentar cada comparación de moviola y
auditar HMAC antes de limpiar tras fallo sin guarda; nueva autorización para
un ensayo acotado con presupuesto propio. No reiniciar contador ni volver a
sembrar en esta tarea. Informe: [INFORME_CHROMIUM_REAL](INFORME_CHROMIUM_REAL.md).
Pendientes Safari/teclado físico, treinta alumnos y beta. El cierre es con
bloqueo de validación, no una pasada editorial correcta.

Comprobación documental final 10-10 22:43:25 UTC: diff/whitespace/enlaces correctos,
hashes de fuentes coinciden con lo ensayado; primer fallo conservado sin cambios
y suma de fases coherente con contador 25,597 s. Trabajo total menor de diez
minutos, dentro de noventa. No quedan acciones de ensayo autorizadas: cierre de
la tarea por bloqueo concreto, con los límites y evidencia indicados arriba.

## Runner diagnóstico — checkpoint, 11-10-2026 01:00:52 Madrid

Activación 10-10 22:51:14 UTC; límite 23:11:14 UTC (veinte minutos).
Sólo scripts/documentación y pruebas aisladas: **cero Chromium, carga, fixtures
o consultas de datos reales**. Informe:
[INFORME_RUNNER_DIAGNOSTICO](INFORME_RUNNER_DIAGNOSTICO.md).

No se identifica la aserción de moviola: faltan ID/operador/mensaje/stack y
valores comparados. Primer fallo recuperable: esperado 200 / observado 419.
Sin atribución a la aplicación. HMAC anteriores siguen pendientes: fixtures
eliminados sin auditoría, no se recrean/restauran.

Todas las aserciones mantienen exigencias y añaden IDs/diagnóstico acotado.
Preparado cierre → auditoría propia si guarda/saldo permiten → limpieza por
manifiesto. Guarda/presupuesto/cierre incierto dejan auditoría pendiente.
Errores secundarios no ocultan el original; se conserva registro de sesiones
si falla limpiar, y logs privados si falla auditoría o recuperación del reporte.

Validación aislada remota: doce unittest Python y ocho pruebas nativas Node,
AST Python y Node --check; ninguna usa Playwright, Laravel, HTTP o SQL.
Detectado en test que Node expande AssertionError; corregido para evitar publicar
HTML sin debilitar la comparación. Bytecode propio retirado, runners --rm.

Informes/mediciones previos intactos; contador anterior sigue **2/2 y 25,597 s**.
Sin cambios de app/worker/producción ni nueva comprobación de salud. Un nuevo
recorrido necesita autorización; no ejecutar el tercero en esta tarea.

Cierre 10-10 23:02:16 UTC: runner preparado, doce pruebas Python y ocho Node
correctas; últimos AST/Node --check, enlaces y diff correctos. Aproximadamente
once minutos de trabajo. No quedan acciones pendientes dentro de este contrato
sin navegador; la validación real y los HMAC históricos permanecen pendientes.


## Revisión manual y fluidez de moviola — 11-10-2026

Alejandro informa de recorrido manual equivalente en Safari y Chrome, salvo
parpadeo al retroceder en la moviola. Capturas: texto sustituido por carga y
aviso de fallo de instantánea. No se extrapola a funciones aún no comprobadas.

Corrección preparada en copia aislada del export de las 00:00:15 UTC, base
04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0 más cambios locales. Retención de
fotograma con identidad/tiempo correctos, precarga bidireccional, caché 64 y
lecturas serializadas. Regresión anterior reproducida; 15 pruebas pasan y
Chromium local con API controlada pasa (120 eventos, respuestas de 120 ms).
Observación antes/después: 4/0 parpadeos, máximo 7/1 lecturas simultáneas.
No constituye capacidad ni ensayo contra PHP/MariaDB; sin acceso a servidores,
datos, claves, commits o publicación. Informe: INFORME_MOVIOLA_FLUIDEZ.md.

Estado: preparado/validado localmente; pendiente aplicar en el Mac, compilar
desarrollo y repetir Safari/Chrome. El HTTP del fallo capturado no se conoce.
La aserción histórica y sus HMAC eliminados continúan sin poder verificarse.
El contrato de Chromium real sigue cerrado; no se autoriza ni ejecuta aquí un
tercer intento. Reapertura/HMAC integrales, treinta alumnos y beta pendientes.
