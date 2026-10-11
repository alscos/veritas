# Cuello de rendimiento: diagnóstico acotado, 10-10-2026

Checkout `main`, base `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`.
Se conservaron todos los cambios locales. Fuentes iniciales: AGENTS.md,
[ensayo de capacidad](CAPACITY_AND_STORAGE.md) y su
[agregado existente](measurements/capacity-20261010.json), procesado con Python.
No se repitieron la campaña de escritores, auditorías HMAC ni recorridos de
integridad. No se ejecutaron 60/90/150, migraciones ni cambios de almacenamiento.

## Conclusión y límites

Está demostrado un cuello de concurrencia de **la configuración propia de
desarrollo**: Apache prefork tenía un único trabajador efectivo. Una conexión
ociosa retenía ese trabajador y retrasaba otra petición de salud unos 600 ms,
aunque PHP sólo trabajaba unos pocos milisegundos. Dos trabajadores eliminan
esa espera en el mismo perfil mínimo. Es un cambio pequeño de configuración;
no modifica el núcleo editorial ni controles de acceso.

No está demostrado que sea la causa única de las latencias de treinta autores
ni de la parada histórica de Chromium. Faltan trazas temporales de conexiones
de aquella ejecución. Tampoco hay evidencia suficiente para atribuirla a SQL,
locks, falta de CPU o falta de RAM. **No se acredita capacidad de aula**.

## Qué detuvo Chromium

El agregado registra `Two degraded health samples`: **dos sondeos de dev
agotaron el timeout de 3 s**, antes de completar login. Fue la guarda de salud,
no la de MemAvailable. El agregado conserva el número de fallos y el timeout,
no la duración exacta de cada sondeo fallido; no se inventan milisegundos más
precisos. El supervisor detuvo exclusivamente su runner efímero.

MemAvailable mínimo 766,23 MiB, umbral 600 MiB. Salud de la instalación existente
máximo 41,45 ms, cero fallos; umbral de degradación máximo de 1 s o cinco veces
su base. App CPU <=0,9% en esa ventana. No hay pico CPU del navegador con marcas
precisas. El recorrido editorial bajo carga sigue sin completar en ese ensayo.

## Recursos efectivos y consumidores

Dos CPU por afinidad `4,10`; cuota visible `cpu.max=max 100000`.
`memory.max=max` visible **no descarta límites de ancestros**. LXCFS expone
4 GiB MemTotal y 1 GiB swap, prácticamente llena (1.023,93 MiB ocupados).
`free` expone los 63.988 MiB del host: no son presupuesto disponible para dev.
Inicio del ensayo: 1.045 MiB MemAvailable y 30,3 GiB libres, sin reserva frente
a otros proyectos. Docker stats no da accounting útil. No se cambiaron host,
cgroups, cuotas, swap ni configuración global.

Picos muestreados del ensayo existente, no máximos continuos ni simultáneos:

| Perfil | App RSS / PSS MiB; CPU % | MariaDB RSS / PSS MiB; CPU % | Generador/supervisor RSS MiB; CPU % |
| --- | --- | --- | --- |
| Preparación + 1/5/15 | 127,4 / sin PSS; 36,12 | 171,8 / sin PSS; 3,63 | 53,9; 2,93 |
| 30 autenticados | 67,2 / 45,1; 51,41 | 223,3 / 220,5; 6,62 | 54,2; 4,88 |
| 5 + historial largo | 57,9 / 39,9; 53,32 | 222,6 / 220,7; 25,87 | 54,6; 3,40 |
| Intento navegador | 70,2 / 43,2; 0,90 | 222,6 / 219,8; 0 | 22,8; 0,90 |

100% significa una CPU. RSS suma páginas compartidas; PSS aproxima su reparto.
El navegador es otro consumidor: runner Node + Chromium **475,9 MiB RSS /
277,4 MiB PSS**, aparte del supervisor Python. No son heap del editor.

La instrumentación se distingue conceptualmente, pero su coste no se aisló
completamente: monitor Python en el generador/supervisor, sondeos HTTP que usan
el mismo trabajador, procesos auxiliares Docker excluidos de su CPU y sonda
PHP dentro de app. No se deben sumar como un consumidor medido independiente.
La sonda existente sólo medía memoria: events hasta 16 MiB asignados / 9,16
usados; timeline 22 / 20,40 MiB. No medía duración PHP ni SQL.

En treinta autores MemAvailable mínimo 760,93 MiB: margen de 160,93 MiB sobre
la guarda. No demuestra agotamiento, ni garantiza margen para navegadores
adicionales o documentos mayores. No usar swap ni `memory_limit` como reserva.

## Servidor y cambio aplicado

PHP 8.3.35 con Apache prefork/mod_php en imagen de desarrollo; MariaDB 11.4,
buffer pool 96 MiB, max_connections 30; PHP memory_limit 512 MiB por petición.
Apache original: StartServers 1, MinSpareServers 1, MaxSpareServers 2,
**ServerLimit 1 / MaxRequestWorkers 8**. `apachectl` confirmó la advertencia y
reducción efectiva a uno. KeepAlive On, timeout 5 s, máximo 100 peticiones;
reciclado a 500 conexiones. No era un pool efectivo de ocho trabajadores.

OPcache está cargado, habilitado y confirmado también dentro de Apache por
`opcache_get_status(false)`: usado hasta 23.449.648 bytes en una muestra.
Valores ini consultados: memoria 128 MiB, validate_timestamps=1,
revalidate_freq=2. No se cambió OPcache ni se le atribuye la demora.

[Dockerfile de desarrollo](../docker/dev/Dockerfile.php) cambia únicamente el
pool a **StartServers 2, MinSpareServers 2, MaxSpareServers 2, ServerLimit 2,
MaxRequestWorkers 2**. Se conserva KeepAlive y reciclado. No se eligieron ocho
workers sin conocer su memoria bajo escrituras. La imagen propia se reconstruyó
y app se recreó mediante override temporal `command: [apache2-foreground]`,
**sin ejecutar el arranque habitual que llama a migrate**. DB/volúmenes/claves
se conservaron. Cambiaron los IDs de app dev, de forma deliberada; la DB no se
recreó. El cambio queda en la imagen y su Dockerfile, sin depender del override.

## Comparación mínima y separación de tiempos

[measure-worker-idle.py](../scripts/measure-worker-idle.py): tres repeticiones
de dos conexiones a `/up`, cero escritores. La primera recibe respuesta y
permanece ociosa 600 ms; inmediatamente se mide otra conexión. Se lee el cuerpo,
se exige 200 y ausencia de Set-Cookie. Se mantienen monitor y guardas existentes.
No se abre el editor, no hay cookies, usuarios, documentos ni fixtures nuevos.

| Configuración | Petición de la segunda conexión, tres muestras ms | Mediana ms |
| --- | --- | ---: |
| Original, un worker | 608,02 / 603,66 / 604,02 | 604,02 |
| Dos workers, sin sonda PHP | 10,11 / 6,89 / 2,91 | 6,89 |
| Un worker efectivo, con sonda | 604,01 / 604,15 / 604,05 | 604,05 |
| Dos workers tras recreación, con sonda | 11,13 / 11,56 / 10,88 | 11,13 |

La sonda temporal comienza en auto_prepend_file y termina en shutdown: aproxima
duración PHP incluyendo su instrumentación; no mide la espera previa a obtener
worker. Seis solicitudes por perfil instrumentado: PHP mediana/máximo
**3,93/4,82 ms** con uno y **9,67/16,34 ms** con dos. SQL total acumulado por
las conexiones Laravel **0 ms** en ambos; no se midió conteo de consultas ni
esperas de locks. `/up` no hace ingesta ni bloquea documentos. Es evidencia de
espera fuera de PHP en esta reproducción, no un perfil SQL del editor.

Una prueba intermedia `KeepAlive Off` mantuvo ~608 ms: el cierre de la conexión
también podía retener al trabajador. Se descartó ese cambio. Otra restitución
por graceful tras reducir el pool dejó el comportamiento de uno; no se tomó
como comparación válida de dos. Se recreó app y se comprobaron padre + dos
hijos. El log PHP acumulado se resumió por las seis últimas muestras de cada
fase; no se mezclaron fases. Un intento de log global Apache `%D` no produjo
muestras por la configuración del vhost; no se usa como evidencia.

Ocho ejecuciones del diagnóstico, ~63 s de ventana supervisada, incluida
preparación/pausas: **sólo esta fase**, no el acumulado de la campaña anterior.
No permite acreditar presupuesto restante bajo el contrato posterior de diez
minutos acumulados (véase el cierre del goal abajo). Nunca hubo
más de dos conexiones propias simultáneas ni escritores. Todas las guardas
permanecieron activas: memoria >=600 MiB, disco >=5 GiB, swap crecimiento
<=128 MiB, salud/timeouts y fallo del monitor. Cero paradas y cero fallos de
salud; mínimo MemAvailable observado 794,17 MiB, salud existente máximo 10,94
ms. No se relajaron controles de acceso ni límites HTTP.

## Perfil de escritores y NAT: resultados existentes, sin repetir

Cliente: ingesta cada 1.200 ms, máximo 250 eventos/lote; guardado tras 1.100 ms
de pausa; identidad cada 15 s. Generador: ciclos de seis segundos, tres lotes
de **seis eventos** a 0/1,2/2,4 s, PATCH a 4,7 s. Diez ciclos, unos 180
eventos y 40 solicitudes regulares/minuto/autor; vaciado PATCH final adicional.
Documentos cortos creciendo a pocos KiB. El profesor lee lista/versión cada
seis segundos. El perfil largo añade una versión de 25.000 eventos en 25
páginas, mientras cinco autores escriben en documentos normales.

| Escritores | req/s total | Ingesta p95 ms | Cola del actor de ingesta p95 ms |
| --- | ---: | ---: | ---: |
| 1 | 1,09 | 42,53 | 1,32 |
| 5 | 4,07 | 49,81 | 1,21 |
| 15 | 11,47 | 161,98 | 129,06 |
| 30 | 22,60 | 1.711,12 | 561,61 |

Todas esas solicitudes fueron 200. Quince falló por versión docente p95
1.804,08 ms; treinta por ingesta/cola frente a puertas 1.000/500 ms. La cola
del agregado es retraso **antes de emitir la petición en el generador**, no
tiempo de cola Apache ni espera SQL. Los actores serializan sus peticiones.
Con historial largo, profesor cola p95 3.385,27 ms porque lee 25 páginas
sucesivas (~9,4 s) antes del turno previsto a los seis segundos. Es presión
del método/perfil; no demuestra saturación CPU. No se cambia la fórmula para
ocultarlo: en una siguiente medición hay que distinguir explícitamente el
recorrido largo del sondeo periódico, sin borrar turnos retrasados.

El agregado carece de tiempos PHP/consultas/locks por esas peticiones. Su campo
`sql_sample` es **tamaño de export SQL**, no medición de consultas. El bloqueo
común de documento sigue intacto; distintos autores usan documentos distintos.
No se atribuye una espera de locks sin medirla. La reproducción mínima explica
una causa concreta del servidor, pero no permite descomponer retroactivamente
los 1.711 ms de ingesta en PHP, SQL, cola de accept y red.

Acceso desde una IP: treinta CSRF 200, **un login 200 y 29 login 429**,
concurrencia cinco. Login p95 182,90 ms mezcla aceptación/rechazo. Es limitación
de acceso, separada de escritores ya autenticados, sin 429 en sus fases normales.
Las rutas conservan throttle general 60/min y login 8/min; los limitadores
numéricos comparten el ámbito de clave aplicable. No se modificaron ni se
interpretó el burst como agotamiento CPU. Revisión NAT con defensas intactas
sigue siendo trabajo pendiente, independiente de capacidad de escritura.

## Pruebas, limpieza, salud y siguiente acción

Validación remota: cinco pruebas `test_capacity_measurement.py`, todas correctas;
imagen dev compilada; Apache `Syntax OK`, sin advertencia de ServerLimit;
padre y dos hijos confirmados; comparaciones HTTP reales anteriores. Diff sin
errores de whitespace. No cambió editor/PHP de la aplicación ni persistencia:
no se repitieron suites editoriales, smoke con migraciones ni integridad ya
validada. Safari/teclado físico y navegador bajo escritores siguen pendientes.

Se retiraron únicamente sonda/config/logs temporales y archivos del directorio
privado `bottleneck` creado aquí. No se tocaron resultados ajenos, caches,
sesiones ni fixtures del ensayo anterior. **No se creó ni eliminó ninguna
sesión o fila** en este diagnóstico: `/up` sin Set-Cookie; se conservan sesiones
anónimas históricas no inventariadas. Sin volúmenes/redes nuevos ni limpiezas
globales. Script nuevo y Dockerfile remoto corresponden a sus fuentes locales.

Cierre: app/db dev saludables; `/up` dev 200 en 13,71 ms y existente 200 en
4,04 ms. App RSS/PSS 101,24/48,54 MiB; DB 249,58/246,79 MiB, muestras de cierre,
no picos comparables de escritores. Instalación existente conserva IDs
`b680b997…` / `c5f3bdce…` y arranques del 09-10 / 19-09. Sin producción,
SiteGround, secretos, correo, commits, push ni publicación.

Siguiente acción concreta: repetir **sólo el intento de un Chromium** con este
pool y guardas, inventario exacto de sesiones propias y trazas de ocupación por
conexión. Después, si pasa, una comparación corta autenticada de hasta treinta
autores con marcas coordinadas HTTP/PHP/SQL/locks y RSS/PSS por worker. No
elevar autores antes de resolver NAT y completar navegador. Para ampliar pool
se necesita presupuesto reservado: mantener >=600 MiB disponibles incluyendo
generador, instrumentación y runner Chromium (~277 MiB PSS observado), más
incremento PSS medido de workers bajo documentos representativos. Este host
compartido no ofrece esa reserva; no se recomienda una cantidad de RAM/CPU
garantizada ni ocho workers con los datos actuales. Si no hay margen,
usar un entorno con memoria/CPU reservadas y accounting delegado, sin modificar
este host. La limitación demostrada aquí es configuración dev; la necesidad
de más infraestructura para un aula sigue sin cuantificar.

## Cierre del goal, revisión del 10-10-2026

Contrato en [GOAL_RENDIMIENTO.md](GOAL_RENDIMIENTO.md), estado en
[ESTADO_GOAL.md](ESTADO_GOAL.md) y decisión en [INFORME_GOAL.md](INFORME_GOAL.md).
Se conserva el diagnóstico anterior; no se repitieron conexiones ociosas,
escritores, navegador, almacenamiento ni auditoría masiva. Cero experimentos
correctivos nuevos, cero carga experimental adicional.

La suma de ventanas supervisadas del agregado de capacidad es **1.752,36 s**:
incluye preparaciones fallidas, pausas, auditoría y almacenamiento. No es tiempo
neto de carga ni se suma al ensayo mínimo como una medida homogénea. La ventana
normal sola dura 750,58 s, con autenticación/esperas incluidas. No hay un libro
acumulado que delimite toda la carga imputable a los diez minutos; por contrato,
no se ejecuta nueva carga. La cifra ~63 s anterior no autoriza repetir Chromium.

Comprobaciones remotas puntuales de cierre, sin escritores ni sesiones nuevas:
app/db healthy; Apache Syntax OK, sin aviso ServerLimit, configuración de dos
workers y tres procesos Apache (padre + dos hijos); `/up` 200 en **12,63 ms**,
sin Set-Cookie. No hay directiva activa auto_prepend en conf-enabled/ini ni
artefactos bottleneck en /tmp. Cinco tests de guardas pasan (0,035 s; simulados).
Ausentes directorios privados bottleneck/capacity-results, manifiesto y export
de capacidad y archivos propios de sonda/logs. Consultas sólo sobre IDs
inventariados 36–66: **cero usuarios, documentos por propietario y sesiones
autenticadas**. No se borró nada. Las sesiones anónimas históricas sin inventario
exacto conservan la limitación de limpieza anterior; no se afirma su ausencia.

MemAvailable puntual **963,30 MiB**, swap libre 84 KiB, disco disponible
31.396.712 KiB (~29,94 GiB). Son muestras de salud, no una reserva ni capacidad
del pool bajo escritura. Desarrollo no se recreó ni se migró en este cierre.
Se corrigió únicamente la referencia documental de DEVELOPMENT a ocho workers.
No se midió producción ni se consultó SiteGround.

Se mantiene el pool de dos y se descartan más ajustes por falta de evidencia
comparativa válida dentro del presupuesto. OPcache está validado por el informe
previo; PHP/SQL/locks del editor y coste CPU correlacionado de Chromium siguen
sin descomponer. Las herramientas preparadas no subsanan esas mediciones.
La siguiente tarea necesita presupuesto explícito y guardas intactas: un
Chromium aislado con trazas y sesiones inventariadas, antes de nueva escritura
concurrente. El último nivel HTTP estable sigue siendo cinco escritores más
profesor en el perfil corto anterior al cambio de pool, no treinta alumnos ni
experiencia completa bajo carga con el pool nuevo.
