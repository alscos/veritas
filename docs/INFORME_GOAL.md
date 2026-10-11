# Cierre del diagnóstico de rendimiento

10-10-2026. Activación 16:20:12 UTC; cierre documental 16:23 UTC.
`main`, base `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`, árbol con cambios
previos conservados. Contrato: [GOAL_RENDIMIENTO](GOAL_RENDIMIENTO.md).

La mejora pequeña respaldada por evidencia ya estaba aplicada: **dos workers
Apache efectivos en desarrollo**. Se mantiene. No hay otra corrección justificable
con las mediciones disponibles y el presupuesto autorizado. Este goal cierra
la revisión y documentación, con un bloqueo explícito para nueva carga; no cierra
la validación de capacidad del piloto. Cero experimentos correctivos nuevos de
los tres máximos; sin cambios nuevos en código de aplicación ni configuración.

## Evidencia y causas

Fuentes revisadas: AGENTS, DEVELOPMENT, CAPACITY_AND_STORAGE y
[agregado de capacidad](measurements/capacity-20261010.json),
[diagnóstico más reciente](PERFORMANCE_BOTTLENECKS.md),
[apertura](DOCUMENT_OPEN_PERFORMANCE.md),
[privacidad](SUBMISSION_PRIVACY.md) y
[concurrencia/recuperación](CONCURRENCY_RECOVERY.md), con sus informes.
Los resultados siguientes se reutilizan; no se presentan como ensayos nuevos.

| Área | Hecho comprobado | Límite de la conclusión |
| --- | --- | --- |
| HTTP/workers | ServerLimit 1 reducía el máximo anunciado de ocho a un worker; una conexión ociosa retenía el servicio de otra | Reproducción mínima, no descomposición del p95 de treinta autores |
| KeepAlive | Dos workers eliminan la espera de la segunda conexión; KeepAlive Off mantuvo ~608 ms y se descartó | No se demuestra causa única de los timeouts de Chromium ni conviene cambiar KeepAlive sin medir |
| PHP/OPcache | OPcache activo dentro de Apache; PHP del ensayo `/up` tarda pocos ms | No es perfil de análisis HTML, ingesta o sellado |
| SQL/bloqueos | SQL acumulado 0 ms en `/up`; bloqueo común de documento conservado y validado por las pruebas de concurrencia anteriores | No hay trazas por petición de consultas o lock waits del ensayo de escritores; `sql_sample` mide exportación, no consultas |
| Recursos | Dos CPU por afinidad, RAM compartida sin reserva; accounting Docker no fiable; swap virtual casi llena | CPU moderada y memoria sobre la guarda no prueban margen para un aula; límites de ancestros no visibles |
| Generador | Cola mide retraso antes de emitir HTTP; el profesor serializa 25 páginas y retrasa su turno ~3,4 s | Esa cola no mide espera Apache/SQL ni demuestra saturación CPU |
| Navegador | Guarda detuvo el intento por dos timeouts de salud dev de 3 s; runner ~277,4 MiB PSS muestreado | No completó login ni hay CPU correlacionada suficiente; no fue parada por MemAvailable |
| Historial | Paginación/gzip ya redujeron transferencia y espera para montar editor; análisis completo sigue recorriendo metadatos/HTML | Sin nueva migración, índice, caché derivada o formato incremental; coste interno aún sin perfilar |

## Comparaciones válidas y capacidad

Comparación mínima previa, tres repeticiones, dos conexiones `/up`, retención
ociosa 600 ms, cero escritores y guardas iguales:

| Perfil | Antes: un worker | Después: dos workers |
| --- | ---: | ---: |
| Mediana HTTP sin sonda | 604,02 ms | 6,89 ms |
| Mediana HTTP con sonda | 604,05 ms | 11,13 ms |

En el perfil instrumentado, PHP mediana/máximo fue 3,93/4,82 ms antes y
9,67/16,34 ms después; seis peticiones por fase. La sonda incluye su propio
coste y excluye espera por worker. El cambio corrigió la configuración prefork
en `docker/dev/Dockerfile.php`; conserva KeepAlive y reciclado de 500 conexiones.
La imagen ya estaba reconstruida y app recreada sin migrate en el diagnóstico
anterior. No se compara el sondeo final de salud con estas medianas.

La comparación histórica real de apertura de 2.000 eventos, Chromium a 10 Mbit/s
y 40 ms, tres muestras, dio medianas **8,950 → 0,817 s** para editor disponible
y **15,566 → 0,126 s** para reapertura. Con paginación, las métricas completas
tardaron 9,302/0,922 s: son hitos distintos. No se extrapola a concurrencia.
El recorrido real anterior de 25.000 eventos comprobó escritura durante carga,
guardado, reapertura y moviola, pero tampoco fue un aula bajo carga.

La campaña HTTP real anterior al ajuste de pool acreditó únicamente **cinco
escritores + profesor, perfil corto de aproximadamente un minuto**. Ingesta
p95 49,81 ms, guardado p95 35,07 ms, cola de ingesta p95 1,21 ms. Quince falló
por consulta docente p95 1.804,08 ms; treinta por ingesta p95 1.711,12 ms y cola
561,61 ms (puertas 1.000/500 ms). Todos recibieron 200 en esas fases, pero no
cumplieron latencia. El perfil cinco + historial largo falló la puerta de cola
docente. Treinta logins desde una IP dieron uno 200 y 29 respuestas 429 por
limitación compartida: es un problema de entrada distinto de escritura.

**No hay comparación de escritores ni recorrido completo de navegador bajo
carga después del ajuste del pool.** Cinco usuarios HTTP ficticios no acreditan
cinco personas con navegador, ni treinta alumnos, duración de clase, gestión
de cursos/grupos o concurrencia educativa. No se declara beta preparada ni
equivalencia con SiteGround.

## Presupuesto y decisión de no repetir

El agregado conserva ventanas supervisadas: preparación fallida 2,05 s,
preparación CSRF fallida 637,01 s, normal 750,58 s, treinta 59,73 s, largo
61,16 s, navegador 9,36 s, auditoría 17,03 s y almacenamiento 215,45 s.
Suma sin redondear: **1.752,36 s**. Mezcla esperas, preparación, trabajo y
monitorización; no equivale a carga neta. El informe posterior aporta ~63 s
para ocho ejecuciones mínimas, no el acumulado anterior. La documentación no
permite determinar un saldo fiable de los **600 s acumulados** autorizados.

Por contrato se ejecuta **cero nueva carga experimental**: sin seed, escritores,
navegador ni reproducción de conexiones ociosas. Tampoco se intenta reconstruir
instrumentación para obtener tiempos retroactivos imposibles. Sólo se realizan
tests simulados y comprobaciones puntuales de configuración, ausencias y salud.
No se ejecutan 60/90/150 ni se relajan guardas, límites HTTP o permisos.

## Validación, limpieza y estado final

Comprobaciones nuevas secuenciales en `/opt/veritas-dev`, exclusivamente dev:

- `sh scripts/dev-remote.sh status`: app/db healthy. Apache `Syntax OK`,
  sin advertencia ServerLimit; dos workers configurados y tres procesos Apache.
  Aviso de FQDN preexistente sin efecto sobre Syntax OK; no se cambia el host.
- Cinco tests remotos `test_capacity_measurement.py` pasan en 0,035 s.
  Simulan guardas, CSRF y cohorte; no realizan HTTP, Docker ni escritura real.
- `/up` real HTTP 200 en 12,63 ms, sin Set-Cookie. Es salud puntual, no prueba
  editorial ni benchmark. MemAvailable 986.416 KiB (963,30 MiB); swap libre
  84 KiB; disco libre 31.396.712 KiB (~29,94 GiB), sin reserva garantizada.
- Consultas contadas únicamente para IDs inventariados 36–66: cero usuarios,
  documentos por propietario y sesiones autenticadas. No se leen contenidos.
- Ausentes `.dev-private/bottleneck`, `.dev-private/capacity-results`, manifiesto
  y export de capacidad, configuración/logs/sonda propios de capacidad, artefactos
  bottleneck en /tmp y directiva activa auto_prepend en Apache/ini.
- No se crearon fixtures, sesiones, túneles, runners persistentes, volúmenes ni
  instrumentación en este goal. No fue necesario borrar datos o archivos remotos.

La limpieza anterior de 34 documentos, 41.192 eventos y tres versiones está
respaldada por manifiesto/agregado. Su auditoría validó HMAC, cabeceras, 622
revisiones y fronteras. Las sesiones anónimas antiguas identificadas sólo por
tiempo/user-agent **no se borraron y no se acredita su ausencia actual**: 29
candidatas del burst, una Chromium y una primera prueba de registro. Su GC normal
no constituye evidencia de eliminación; no se borra por inferencia. InnoDB
retiene páginas reutilizables tras DELETE; no se truncan ni optimizan tablas.

Se reutiliza la validación vigente del núcleo: 32 Vitest, build, 37 PHPUnit/
344 assertions con SQLite, cinco simuladores, Chromium editorial con API
simulada, smoke MariaDB y recorridos reales de privacidad/concurrencia con
288 HMAC y cuatro versiones comprobados. No se repiten suites de aplicación
ni smoke con migraciones: sólo cambió documentación en este goal. La corrección
de pool anterior tiene su build, sintaxis y comparación HTTP documentados.
Verificación documental final: `git diff --check` y enlaces locales correctos.

Cambios de este cierre: contrato, estado, informe, actualización del diagnóstico
y corrección de DEVELOPMENT (dos workers, no ocho). Se conservan todos los
cambios locales anteriores, incluida la migración previa sin ejecutarla.
Sin producción, SiteGround, configuración global, claves, datos reales,
commits, push, publicaciones o correo. Dev queda saludable sin recreación.

## Siguiente tarea recomendada

Autorizar una tarea nueva de **validación de un único Chromium real en dev con
el pool de dos**, presupuesto acumulado explícito y registro de inicio/fin
para cada fase, incluidas preparación y esperas. Comprobar margen antes del
runner, mantener todas las guardas y parar sin repetir si se activan. Inventariar
sesiones propias desde el primer CSRF y coordinar trazas de ocupación/conexiones,
HTTP/PHP/SQL/locks y RSS/PSS sin contenidos ni credenciales. Completar acceso,
escritura, guardado, reapertura y moviola; contrastar limpieza y salud al final.

Si eso pasa, decidir una campaña separada corta de cinco escritores y sólo
escalar hasta treinta si las puertas anteriores pasan y hay presupuesto/margen.
Resolver NAT manteniendo defensas es otro trabajo antes del acceso de aula.
Safari/teclado físico, seguridad del piloto, recuperación de cuenta y
copias/restauración siguen pendientes de revisión. No ampliar workers ni comprar
infraestructura basándose en estos datos: si no hay margen, hace falta una
decisión sobre entorno con recursos reservados, sin modificar este host.
