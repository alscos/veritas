# Capacidad y almacenamiento: ensayo de desarrollo

Ensayo del 10-10-2026, `main`, commit base
`04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0`, con los cambios locales conservados.
Esta fase añade herramientas, pruebas e instrumentación temporal de desarrollo.
No altera persistencia, fórmulas, hashes, sellos, índices ni autorización.

## Entorno y guardas

PHP 8.3.35, MariaDB 11.4, Apache prefork, Python **3.14.8 del host** Alpine 3.21,
Node 22.23.3 y Chromium del lockfile. Sólo `inkgroove-dev`, localhost 8083;
MariaDB sin puerto publicado. La instalación existente sólo se comprueba mediante
`/up` e identidad/estado de contenedores, sin leer datos ni configuración privada.

Inicio: afinidad CPU `4,10` (dos CPU), `cpu.max=max 100000`,
`memory.max=max`, 1.045 MiB realmente disponibles según MemAvailable,
30,3 GiB de disco libre, carga 0,42 / 0,62 / 0,76.
`free` muestra 63.988 MiB totales y swap 8.192 MiB (2.563 ocupados),
pero esas cifras provienen del host y **no son el presupuesto de este namespace**.
`/proc/meminfo` está montado mediante **LXCFS**: MemTotal 4.194.304 KiB (4 GiB),
SwapTotal 1.048.576 KiB, con sólo unos 72 KiB libres. La monitorización registró
1.023,93 MiB de swap ocupados, sin crecimiento apreciable. MemAvailable es
la cifra usada por las guardas e incluye caché recuperable: no es RAM reservada.
En el cierre se observaron unos 3,78 GiB en memory.current del ámbito visible.
El techo del ancestro fuera de este namespace no es comprobable desde aquí;
no se deduce ausencia de límites externos porque memory.max visible diga max.
No se utiliza swap como presupuesto adicional.
Docker anuncia soporte pero no delega límites aplicables; stats devuelve memoria
no fiable. No se modifica cgroup ni configuración global.

Guardas previas del generador: MemAvailable >=600 MiB, disco >=5 GiB;
salud inicial de instalación existente, muestreo aproximadamente cada 2 s (más coste de sondeos), parada automática
ante dos muestras con salud degradada (existente >máximo de 1 s o cinco veces
su base; HTTP no saludable de dev/existente), monitor fallido, cinco errores
HTTP 5xx/transporte en las últimas cien solicitudes de una fase (mínimo veinte),
ingesta/guardado fallidos. La versión final también detiene ante crecimiento
de swap >128 MiB desde su base; aquí la swap virtual ya estaba prácticamente llena. Peticiones con timeout 5 s; salud timeout 3 s.
La parada impide programar solicitudes nuevas y deja terminar las ya en curso.
No se fuerza el máximo ni se detiene producción.

Puerta para subir de nivel: cero errores, p95 <=1 s por operación y cola p95
<=500 ms. Una fase HTTP 429 se registra como limitador, nunca como agotamiento
CPU. Los escenarios altos sólo se autorizan metodológicamente tras fases
anteriores estables y margen de recursos. No cambiar límites para pasarlos.

**Configuración efectiva observada:** Apache avisa que `ServerLimit 1` reduce
`MaxRequestWorkers 8` a **un worker**. Se mide tal cual. PHP tiene memory_limit
512 MiB por petición; MariaDB buffer pool 96 MiB y max_connections 30.
Ninguno es un límite global de RSS.

## Perfiles y semántica de medidas

Cliente inspeccionado: ingesta cada 1.200 ms, lotes máximo 250, guardado tras
1.100 ms de pausa, comprobación de identidad cada 15 s. El perfil activo ofrece
un ciclo de seis segundos: tres lotes de seis eventos a 0 / 1,2 / 2,4 s,
guardado a 4,7 s y pausa; los sufijos numéricos son marcadores ficticios,
no una transcripción literal de cada carácter del teclado; unos 180 eventos/minuto. Revisión periódica del
texto, NFC/NFD, contenido creciente y párrafo vacío en perfiles de almacenamiento.
Los documentos normales empiezan cortos y crecen a unos pocos KiB; no se
ensayaron treinta textos extensos simultáneos. Este patrón por pausas ofrece 40 escrituras/minuto/usuario; escritura continua
más guardados frecuentes puede alcanzar el límite general de 60 solicitudes.

Una fase nominal por nivel de 60 s, diez ciclos, un profesor leyendo lista y versión
entregada cada seis segundos. Inicialmente abre y reabre cada documento y lee
sus metadatos. Calentamiento separado: cuentas autenticadas, detalles, seis
eventos, guardado, sello v2 y entrega al profesor. El inicio de clase se mide
aparte, treinta clientes/cookies desde una IP y concurrencia limitada a cinco.
La preparación posterior espera en bloques de 15 s ante 429, conservando límites.
No equivale a gestión de cursos/grupos, cuyas rutas siguen pendientes.

p50/p95 por operación usan orden estadístico nearest rank, lectura completa del
cuerpo y reloj monotónico. Cola es inicio real menos instante programado; el
generador no descarta turnos retrasados y su duración real puede superar 60 s.
Se registran solicitudes programadas/intentadas, procesadas, estados, bytes y
caudal HTTP; un evento y una petición no son la misma unidad. La última escritura regular cae en 58,7 s: las fases terminan entre 58,7 y 59,3 s
y el caudal divide por esa duración real. No hay una red
remota simulada para HTTP, sólo loopback real con PHP/MariaDB.

Memoria: /proc por PID de app/db, suma RSS y suma VmHWM (comparten páginas;
la suma no es memoria física exclusiva). CPU por diferencias de ticks de esos
PID, 100% equivale a una CPU; con recambio de PID la estimación tiene límites.
Pico RSS observado aproximadamente cada 2 s (más coste de sondeos), no pico continuo; VmHWM individual completa muestras
pero sumar máximos de distintos procesos no demuestra simultaneidad.
Generador: ru_maxrss del proceso Python. Chromium: runner propio y muestra heap
CDP por separado. PSS también se registra cuando smaps_rollup es accesible.
Contenedores: cgroup/stats sin medición fiable, se informa
suma de procesos como aproximación, nunca se sustituye con memory_limit PHP.

Instrumentación PHP temporal: auto_prepend_file sólo en Apache dev registra
pico de memoria asignada/usada por petición, estado y tipo genérico; sin cuerpos,
cookies, consulta, identidades ni secretos en el registro de memoria. Incluye overhead de la sonda y no
sustituye RSS. Se retira al cierre con recarga graceful, conservando configuración
original. No se cambia la aplicación para medir.

## Reproducción

Desde Mac:

```sh
sh scripts/dev-remote.sh sync
ssh inkgroove-alpine 'cd /opt/veritas-dev && docker exec inkgroove-dev-app php scripts/capacity-fixture.php seed'
ssh inkgroove-alpine 'cd /opt/veritas-dev && sh scripts/capacity-probe.sh install'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/measure-capacity.py'
ssh inkgroove-alpine 'cd /opt/veritas-dev && mv .dev-private/capacity-results/http.json .dev-private/capacity-results/http-normal.json'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/capacity-storage.py'
ssh inkgroove-alpine 'cd /opt/veritas-dev && docker exec inkgroove-dev-app php scripts/capacity-fixture.php integrity'
# Sólo con recursos/salud dentro de guardas; es un diagnóstico explícito de 30.
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/measure-capacity.py --authenticated --normal-level 30'
ssh inkgroove-alpine 'cd /opt/veritas-dev && mv .dev-private/capacity-results/http.json .dev-private/capacity-results/http-30.json'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/measure-capacity.py --authenticated --long 5'
ssh inkgroove-alpine 'cd /opt/veritas-dev && mv .dev-private/capacity-results/http.json .dev-private/capacity-results/http-long.json'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/capacity-browser-watch.py'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/capacity-audit.py'
# Antes de clean, guardar sólo agregados: nunca publicar cookies, expected.json ni SQL.
ssh inkgroove-alpine 'cd /opt/veritas-dev && docker cp inkgroove-dev-app:/tmp/inkgroove-capacity-php.jsonl .dev-private/capacity-results/php.jsonl && chmod 600 .dev-private/capacity-results/php.jsonl'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 scripts/capacity-summary.py .dev-private/capacity-results --sql storage/app/capacity-export.sql.gz'
ssh inkgroove-alpine 'cd /opt/veritas-dev && python3 -m unittest discover -s tests/deployment -p test_capacity_measurement.py -v'
ssh inkgroove-alpine 'docker exec inkgroove-dev-app php scripts/capacity-fixture.php clean'
ssh inkgroove-alpine 'cd /opt/veritas-dev && sh scripts/capacity-probe.sh remove'
```

No repetir seed sobre un manifiesto existente ni ejecutar dos ensayos con el
mismo registro. El código de salida cero del generador no significa estable:
revisar siempre `stop`, estados y percentiles antes de avanzar. Instalar la
sonda ANTES del acceso para inventariar también sesiones anónimas. Resultados privados en
`.dev-private/capacity-results/`; export temporal en storage/app, ambos fuera de
Git. El manifiesto coteja ID/correo y elimina exclusivamente cuentas ficticias,
sus entregas, eventos/documentos por cascada, sesiones y archivos registrados.
No hay volúmenes nuevos ni prune/down -v. Revisar salud y recursos antes de cada
paso. La sonda PHP necesita instalación/retiro explícito en dev; no está activa
por ejecutar seed. Un fallo de guardas exige revisar causa antes de repetir.

## Resultados

Agregados sin cookies, tokens ni contenido: [capacity-20261010.json](measurements/capacity-20261010.json).
Las preparaciones fallidas están separadas de las fases de carga. Los datos
ficticios y todos los resultados privados se retiran después de generar este agregado.

### Acceso de clase y preparaciones

Treinta CSRF y treinta logins, cinco peticiones concurrentes, misma IP:
**1 login 200, 29 respuestas 429**. CSRF p50/p95 24,32/52,13 ms;
login p50/p95 24,65/182,90 ms. El p95 de login mezcla aceptación y rechazos,
no representa treinta autenticaciones completas.

La inspección de `ThrottleRequests` del vendor instalado confirmó que
`throttle:60,1` y `throttle:8,1` usan el mismo prefijo vacío y firma anónima
(dominio/IP); ambos incrementan el mismo contador. CSRF consume ese contador
general y el login aceptado atraviesa ambos middleware. **No son dos cupos
independientes.** La preparación esperó sus ventanas; no se vació caché ni se
suplantaron IP. Una clase no puede entrar simultáneamente en este perfil.

Dos preparaciones fallidas se excluyen: primero se intentó login después de
un CSRF 429; después faltó refrescar el token rotado por Laravel al regenerar
la sesión (419 en ingesta/guardado/sello). No aceptaron eventos. Se corrigió
la herramienta y se añadieron pruebas de ambas condiciones. La preparación
válida, con autenticación real de las 31 cuentas, ocupó unos 566 s antes de
las fases 1/5/15; no se cuenta como caudal de escritura. Las fases posteriores
reutilizan cookies privadas tras comprobar `/me` e identidad, con CSRF vigente.
La tabla de recursos de 1/5/15 incluye esa preparación y su coste de contraseña.

### Escritores autenticados y profesor

Dos aperturas HTTP por autor al inicio (detalle y repetición), metadatos del
historial y diez ciclos. Latencias de ingesta y guardado, ms:

| Escritores + profesor | Ingesta p50 / p95 | Guardado p50 / p95 | Cola ingesta p95 | Peticiones completadas | HTTP req/s | Evaluación |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 + 1 | 25,12 / 42,53 | 20,29 / 37,12 | 1,32 | 64 | 1,09 | Estable en esta muestra |
| 5 + 1 | 26,81 / 49,81 | 21,14 / 35,07 | 1,21 | 240 | 4,07 | Estable en esta muestra |
| 15 + 1 | 28,61 / 161,98 | 25,60 / 42,92 | 129,06 | 680 | 11,47 | Falla p95 de consulta docente: 1.804,08 ms |
| 30 + 1, diagnóstico | 36,12 / 1.711,12 | 25,07 / 45,94 | 561,61 | 1.340 | 22,60 | Falla p95 y cola de ingesta |

Todas las solicitudes de esas fases devolvieron **200**: ningún 5xx, timeout
de transporte o 429 de escritura. Las guardas detuvieron la escalada tras 15.
Se ejecutó después 30 como diagnóstico independiente, con las mismas guardas
de memoria, errores y salud: no había presión ni degradación de la instalación
existente. No se dio por estable 15 para justificarlo. **60, 90 y 150 no ejecutados**,
porque 15/30 ya fallaron los criterios de latencia; no se buscó una caída.
El fixture actual admite treinta escritores y rechaza declarar más actores
que clientes registrados; ampliar la cohorte es trabajo para otro ensayo.

Carga ofrecida/procesada por fase:

| Escritores | Lotes regulares previstos / aceptados | Eventos aceptados | PATCH regulares / finales aceptados |
| --- | ---: | ---: | ---: |
| 1 | 30 / 30 | 180 | 10 / 1 |
| 5 | 150 / 150 | 900 | 50 / 5 |
| 15 | 450 / 450 | 2.700 | 150 / 15 |
| 30 | 900 / 900 | 5.400 | 300 / 30 |

No se descartaron ciclos retrasados. Los PATCH finales son vaciados adicionales,
no una carga ofrecida de escritura regular. Seis eventos de calentamiento por
pasada normal quedan fuera de esta tabla. Las revisiones del servidor se cotejaron
con el HTML/revisión/secuencia finales esperados por el generador: 15 documentos
tras la primera pasada, 30 tras el diagnóstico y cinco tras el perfil largo.
Los actores HTTP serializan sus solicitudes; el cliente real puede seguir
acumulando texto mientras guarda y combinar una cola mayor en un lote de 250.
Este modelo mide retraso del actor, no reproduce exactamente esa cola de React.
`elapsed_ms` es sintético por secuencia; tiempos de recepción son del servidor.
No se usan estos fixtures para validar valores humanos de PPM ni sus pausas.

Detalle/repetición y metadatos al inicio de la fase (p95 ms):

| Escritores | Dos detalles HTTP por autor | Metadatos por autor | Lista / versión del profesor |
| --- | ---: | ---: | ---: |
| 1 | 14,48 | 8,96 | 40,35 / 31,40 |
| 5 | 54,61 | 65,46 | 50,17 / 52,04 |
| 15 | 123,15 | 183,19 | 102,27 / 1.804,08 |
| 30 | 214,05 | 545,79 | 201,25 / 216,19 |

### Historial largo con actividad

Cinco escritores más profesor, nueva fase nominal de 60 s. El profesor consulta
la entrega de **25.000 eventos** y completa sus veinticinco páginas de métricas
mientras los autores escriben en documentos normales. 265 solicitudes, todas
200, 4,49 req/s; 150 lotes / 900 eventos y 55 guardados aceptados.

Ingesta p50/p95 **32,16/395,28 ms**, guardado **25,33/275,37 ms**;
páginas históricas **372,91/466,82 ms**. La lectura completa requiere unos
9,4 s de peticiones sucesivas; no equivale a disponibilidad del editor.
La cola p95 del profesor alcanzó **3.385 ms**: su actor serializa esas 25 páginas
antes de la consulta programada a los seis segundos. **Es retraso del generador
por ese perfil, no prueba de saturación CPU.** Se contabiliza y falla la puerta
de cola; la escritura conservó sus datos. No se acredita cinco autores más
ese recorrido docente como un perfil completamente estable bajo la guarda.

### CPU y memoria

Picos observados por sondeos. CPU: 100% = una CPU, no porcentaje del host de
64 GiB. RSS es suma de procesos; PSS se pudo leer en los perfiles posteriores.
El ámbito de app puede incluir el PHP CLI de verificadores/exportación.

| Perfil | App RSS MiB / CPU % | MariaDB RSS MiB / CPU % | Generador RSS MiB | MemAvailable mínimo MiB |
| --- | ---: | ---: | ---: | ---: |
| Preparación válida + 1/5/15 | 127,4 / 36,12 | 171,8 / 3,63 | 53,9 | 827,3 |
| 30, autenticados | 67,2 / 51,41 | 223,3 / 6,62 | 54,2 | 760,9 |
| Crecimiento de almacenamiento | 122,2 / 48,65 | 223,2 / 43,48 | 42,2 | 807,7 |
| 5 + historial largo | 57,9 / 53,32 | 222,6 / 25,87 | 54,6 | 774,8 |
| Auditoría HMAC/privacidad | 105,9 / 54,74 | 223,1 / 51,41 | 28,0 | 786,5 |

CPU pico del proceso Python generador: 2,93% en preparación/1/5/15, 4,88%
en 30 y 3,40% en el perfil largo; supervisor del navegador 0,90%. Excluye
subprocesos Docker y no implica ausencia de retraso por serialización del actor.

PSS pico en 30: app 45,1 MiB, MariaDB 220,5 MiB. Los picos RSS de preparación
incluyen autenticación y no significan que cada escritura consuma 127 MiB.
Máxima suma de VmHWM de app en preparación válida: 135,0 MiB; MariaDB llegó
posteriormente a 223,4 MiB. No son picos simultáneos de memoria física exclusiva.
En 30 quedó un mínimo de **160,9 MiB sobre la guarda de 600 MiB**, sin garantía
para otros horarios o carga de otros proyectos. CPU por PID puede perder un
intervalo al reciclar procesos; no hay muestreo continuo ni pico de RSS instantáneo.

Picos PHP asignados/usados por petición, con sonda temporal:

| Tipo genérico | Muestras 200/201 | Asignado MiB | Usado MiB |
| --- | ---: | ---: | ---: |
| GET, excepto timeline | 1.006 | 12 | 4,95 |
| PATCH | 622 | 12 | 1,19 |
| POST, excepto events | 73 | 18 | 3,44 |
| Events | 1.807 | 16 | 9,16 |
| Timeline | 144 | 22 | 20,40 |

Muestras de toda la sesión, no percentiles por nivel. PHP asignado no incluye
necesariamente toda la memoria nativa y no sustituye RSS/PSS ni el límite del
contenedor. `memory_limit=512M` no demuestra disponibilidad de 512 MiB adicionales.
La memoria de contenedores no tiene un contador Docker útil aquí; se informa la
aproximación por procesos y queda pendiente medir en un host con accounting delegado.

### Un navegador real: intento detenido

Un único Chromium/Node efímero, API real, sin interceptarla; se preparó el recorrido
apertura, escritura, guardado, moviola y reapertura sobre 25.000 eventos, con
10 Mbit/s y 40 ms después del acceso. **No completó el login**: dos sondeos dev
agotaron 3 s y la guarda detuvo sólo su runner. Existente respondió en 41,45 ms
máximo, sin fallos; MemAvailable mínimo 766,2 MiB. No fue una parada por memoria.
No se ejecutaron Chrome adicionales ni se relajó la guarda para validar el flujo.

Pico muestreado del runner (Node + procesos Chromium): RSS **475,9 MiB**,
PSS **277,4 MiB**. Supervisor Python: 22,8 MiB RSS. CPU de app durante esa ventana
<=0,9%; no se atribuye a agotamiento CPU. El intento no dejó un pico CPU del
navegador con marcas temporales suficientemente precisas: queda pendiente esa
medición y la experiencia completa bajo carga. No hay heap/editor disponible
válidos de esta pasada. Las pruebas históricas de navegador de otros informes
no se convierten en evidencia de esta carga.

Apache mantiene `KeepAlive On`, `KeepAliveTimeout 5`, `MaxKeepAliveRequests 100`,
un worker efectivo y reciclado a 500 conexiones. Los sondeos también observan
recambios de PID e intervalos con sólo el padre Apache. La cola con CPU moderada,
y los timeouts al abrir Chromium, son **compatibles** con serialización, reciclado
y ocupación del worker por conexiones persistentes. Falta instrumentar conexiones
para correlacionar cada pausa; no se afirma causa única ni se cambia configuración.

## Crecimiento de almacenamiento medido

Cuatro documentos independientes, textos repetitivos que crecen desde unas
30 repeticiones a 500 de `pingüino génesis texto`, NFC/NFD y párrafo vacío;
HTML final aproximadamente 13 KiB, unas 1.500 palabras. Un historial por documento,
lotes HTTP reales de hasta 250, espera 1,3 s entre lotes. El perfil es acelerado
y sintético, no una cronología humana ni un ensayo de capacidad por su duración.
Datos y hashes fueron creados por los controladores reales.

| Eventos del documento | HTML de instantáneas, bytes | HTML vivo, bytes | Ingesta incluida espera |
| --- | ---: | ---: | ---: |
| 100 | 695.532 | 13.017 | 1,60 s |
| 1.000 | 6.900.133 | 13.018 | 6,19 s |
| 5.000 | 34.480.133 | 13.018 | 30,07 s |
| 25.000 | 172.395.134 | 13.019 | 166,14 s |

La ingesta de almacenamiento tuvo un **429**, respetó la espera y terminó sin
pérdida ni duplicado. Son 136 solicitudes del perfil: 129 con 200, seis con 201,
una con 429; p50/p95 179,44/259,63 ms, incluyendo operaciones de control.
Las páginas históricas solas, sin escritores: p50/p95 341,33/443,65 ms en 25 páginas
para 25.000; el detalle HTTP de ese documento, tres muestras, p50/p95 8,21/8,23 ms;
repetición 7,93/7,96 ms. Base y cachés calientes tras ingesta: **no son cold-start
ni tiempos de montaje del editor**. Para 100 y 1.000 eventos sólo hay una página
histórica, y para 5.000 cinco; esos p95 pequeños no tienen fuerza estadística.

MariaDB/archivos acumulados durante el perfil, MB decimales:

| Punto | HTML lógico de todos los fixtures | Datos writing_events | Índices writing_events | Físico esquema dev | Físico datadir completo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antes | 3,108 | 5,423 | 0,852 | 34,443 | 205,300 |
| +100 | 3,803 | 5,423 | 0,852 | 34,476 | 205,332 |
| +1.000 | 10,703 | 7,520 | 0,885 | 34,509 | 205,365 |
| +5.000 | 45,183 | 55,804 | 3,178 | 81,727 | 252,588 |
| +25.000 | 217,579 | 325,386 | 5,276 | 346,001 | 516,862 |

Datos/índices vienen de INFORMATION_SCHEMA: estimaciones/allocaciones InnoDB,
no sumas exactas de texto ni bytes únicos por alumno. El espacio físico es `du`
sobre el volumen propio, no volumen lógico de filas. Había 22,020 MB libres dentro
de la tabla antes: los casos pequeños reutilizan páginas y apenas agrandan el
archivo. En el tramo 25.000 se añadieron 269,582 MB estimados de datos, 2,097 MB de
índices y 264,274 MB físicos al esquema. Las diferencias no son pérdida de datos:
estadísticas, páginas, reutilización y reservas tienen bases distintas.
La herramienta final ejecuta `du` de esquema/datadir en llamadas separadas;
el agregado corrige las muestras originales donde `du` excluyó del segundo
argumento el esquema ya contado en el primero.

Una PNG ficticia de ruido 512×512: **787.252 bytes** almacenados, **787.510**
con gzip nivel 1 (empeora levemente). No se deduce compresión útil de fotos ya
comprimidas. Se contabiliza el archivo, además de su fila y sus índices.

Export SQL exclusivo de las filas ficticias (usuarios, documentos, sesiones
editoriales, eventos, imágenes, versiones, certificados y entregas):
**236.716.309 bytes → 5.783.069 bytes con gzip nivel 1**, 2,44% del SQL.
Las instantáneas eran 217,579 MB de HTML lógico. El SQL tiene nombres de columnas,
metadatos y escapes; no es el mismo denominador. Export streaming sin buffer PDO.
**No es una copia de instalación restaurable**: excluye esquema, configuración,
sesiones de autenticación, archivos, código y dependencias. Se mide tamaño;
la restauración integral anterior está en BACKUP_RESTORE. No se conserva el SQL.

## Proyecciones: no son pruebas ejecutadas

Supuesto por cuenta para un periodo de uso: **10 documentos**, **3.000 eventos
por documento**, HTML medio **6.900 bytes**, dos versiones selladas por documento,
diez sesiones editoriales por documento y **dos imágenes de 1 MiB por documento**.
Se reservan **1 MB adicional/cuenta** para documentos/versiones/certificados,
cuentas/sesiones y metadatos; no constituye una cuota ni mide esos flujos a escala.
Las cuentas del cuadro son homogéneas; 30 escritores + profesor son 31 cuentas,
no las treinta cuentas de la primera proyección.

Coeficientes del tramo medido de 25.000: datos ~10.783 bytes/evento, índices
~84 bytes/evento, físico incremental ~10.571 bytes/evento. Para presupuesto vivo
se redondea a **11.000 bytes/evento**, más el MB adicional y las imágenes.
Añade **300 MB fijos** al vivo para estructura del datadir y código/vendor/activos:
el componente fuera del esquema dev medido era 170,856 MB y el subconjunto
app/bootstrap/config/database/lang/resources/routes/public/vendor, 73,150 MB
(éste incluye dependencias dev). No incluye imágenes Docker, SO ni node_modules;
son costes del entorno, no crecimiento por cuenta.
Son extrapolaciones de InnoDB y HTML simple en este volumen, no constantes del producto.

| Cuentas | HTML lógico GB | Datos DB GB | Índices GB | Imágenes GB | Disco vivo presupuestado GB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30 | 6,21 | 9,70 | 0,075 | 0,63 | 10,86 |
| 150 | 31,05 | 48,52 | 0,377 | 3,15 | 53,10 |
| 300 | 62,10 | 97,05 | 0,755 | 6,29 | 105,89 |
| 750 | 155,25 | 242,62 | 1,887 | 15,73 | 264,28 |

Copia estimada: **200 bytes comprimidos/evento** (medido ~166 en este export),
el MB adicional por cuenta y las imágenes sin reducción; añade 12,741 MB fijos
para código/vendor/activos del paquete gzip histórico de BACKUP_RESTORE. Retención
supuesta: **siete copias completas**, sin deduplicación ni incrementales, todas
contadas en el mismo almacenamiento para este presupuesto.

| Cuentas | Una copia GB (extrap.) | Siete copias GB | Vivo + siete copias GB |
| --- | ---: | ---: | ---: |
| 30 | 0,85 | 5,96 | 16,82 |
| 150 | 4,21 | 29,46 | 82,56 |
| 300 | 8,40 | 58,83 | 164,72 |
| 750 | 20,99 | 146,94 | 411,22 |

GB decimales; los 30,0 GiB libres finales son unos 32,2 GB compartidos, no reserva
para InkGroove. No añade margen por crecimiento de otros proyectos, logs sin
retención, binlogs/redo nuevos, archivos externos ni índices futuros. El modelo
no acredita la política de backup externo, cifrado, RPO/RTO o restauración a escala.

La compresión depende del texto y su repetición entre snapshots; este fixture
es favorable. HTML medio mayor multiplica los bytes por evento; filas/snapshots
que superen la ventana gzip (~32 KiB), contenido menos repetitivo, imágenes y
más copias pueden empeorar mucho el presupuesto. Usar el escenario comprimido
como hipótesis, **no garantía**, y medir corpus ficticios de mayor variedad/tamaño
antes de comprometer disco. Textos que crecen linealmente por carácter pueden
producir crecimiento aproximadamente cuadrático con el número de eventos hasta
que dejan de alargarse; revisiones sobre un texto ya largo siguen duplicándolo.

## Próximas mejoras propuestas, no implementadas

1. Medir conexiones/ocupación y reciclado del Apache efectivo; ensayar en otro
   perfil dev un pool real pequeño con guardas y PSS/RSS por worker. Resolver la
   discrepancia ServerLimit/MaxRequestWorkers antes de atribuir capacidad al PHP
   o subir autores. No basta con multiplicar ocho procesos de 512 MiB por petición.
2. Revisar el contador compartido CSRF/login/API para NAT de aula, manteniendo
   defensas de acceso y ensayando la entrada de treinta usuarios. Separar ese
   trabajo de cualquier cambio de integridad/persistencia.
3. Perfilar PHP/SQL por petición: análisis de HTML de métricas, ordenación global,
   COUNT/paginación y búsqueda de referencias de imágenes en snapshots. La lectura
   histórica consume todos los HTML en el servidor; privacidad e integridad deben
   conservarse. Evaluar índices/cachés derivados versionados sólo en una fase nueva.
4. Diseñar el formato incremental/versionado e instantáneas periódicas previsto
   por la arquitectura. Conservar cada evento y verificabilidad histórica; no
   borrar/agrupar el historial antiguo ni convertir este ensayo en una migración.
5. Medir textos no repetitivos y HTML >32 KiB, muchas sesiones/imágenes, dos horas
   de clase, navegadores con carga HTTP simultánea y memoria/CPU con marcas precisas.
   Resolver primero el intento Chromium detenido; Safari y teclado físico siguen
   pendientes. Ampliar fixture y probar 60/90/150 sólo tras niveles bajos estables.
6. Establecer presupuesto/alertas de almacenamiento y retención de copias externas
   cifradas y verificar restauración con tamaño representativo, según BACKUP_RESTORE.
   No se configura correo, cron, transferencia ni hosting en esta fase.

## Integridad, limpieza y cierre

Cinco pruebas de guardas/CSRF/cohorte pasaron en Alpine; sintaxis de Python,
PHP, shell y JS comprobada; JSON del agregado y git diff --check correctos.
No se ejecutó build ni la suite completa de la aplicación: no se cambió su código.
La experiencia Chromium de esta fase se mantiene como fallida, separada de esos checks.

Después de todos los perfiles: **41.192 eventos HMAC**, cabeceras y secuencias
contiguas válidas, **622 revisiones**, contenido final contrastado en **34 documentos**,
tres versiones con hashes/firma/fronteras correctos. Los cotejos de estado esperado
comprueban además que todas las ingestas y revisiones de los autores llegaron;
no sólo recalculan una cadena que podría estar incompleta. No hay duplicados
por sesión/secuencia en las solicitudes procesadas.

HTTP real del profesor: versiones normales limitadas a **6** y **552** eventos,
mientras el vivo ya tenía **912**; instantánea posterior y borrador vivo 404.
Entrega larga exactamente **25.000**, sin eventos posteriores en ese documento;
su imagen subida después del sello 404. No se considera probado un snapshot
posterior del largo porque no existía: el navegador se detuvo antes de escribir.
Los mismos registros conservan sus firmas después de las lecturas.

Se retiraron por manifiesto los **31 usuarios ficticios, IDs 36–66**, sus **34
documentos**, **41.192 eventos**, **tres versiones/entregas**, una imagen y las
sesiones autenticadas de esas cuentas. Run del fixture:
`0207675c-8c89-4704-8310-65ea68131692`. El limpiador verificó cero cuentas/documentos
registrados y ausencia del archivo de imagen, sin tocar otros propietarios.
El runner `inkgroove-capacity-browser` se eliminó con --rm; no se crearon redes,
volúmenes ni un clon, ni se abrió túnel.

La revisión de limpieza detectó una limitación: el primer burst y el navegador
fallido no habían registrado IDs de sesiones anónimas. Hay **29 candidatos Python
y uno Chromium por tiempo/user-agent**, no identificación inequívoca. Además, la
primera comprobación del nuevo registro creó una sesión antes de que funcionase.
**No se borraron por IP/user-agent/ventana temporal.** Se conservan bajo la caducidad
normal de Laravel (driver database, 120 minutos; retirada física por su GC); no se afirma limpieza integral de esas sesiones transitorias.
La sonda final registra sólo SHA-256 de IDs de solicitudes propias marcadas, en
archivo privado: una nueva CSRF anónima se registró y se eliminó por coincidencia
exacta. Ese mecanismo está preparado y probado para siguientes repeticiones; no
permite atribuir retrospectivamente las anteriores. No se guardan cookies/IDs en
el agregado público. Se retiran registros privados, cookies y hashes de prueba.

Sonda auto_prepend, logs privados y configuración temporal retirados; Apache
recargado a su configuración original. El SQL gzip y manifiesto se borraron.
Se conservan datos, claves, volúmenes, caches/backups de desarrollo y cambios
locales ajenos. No se limpian logs/caches globales ni se optimizan/truncan tablas.
Tras borrar las filas, InnoDB **retiene páginas**: esquema físico 354.420 KiB,
datadir 521.276 KiB. No son fixtures accesibles todavía; son archivos con espacio
reutilizable que no se reducen con DELETE. Disco libre 30,3 → 30,0 GiB.

App/db dev saludables, mismos IDs/arranques; `/up` HTTP 200 (~5 ms), memoria
final disponible observada ~1.012 MiB. Existente conserva IDs y fechas de arranque
(app `b680b997…`, db `c5f3bdce…`) y `/up` 200; sin parada/actualización de producción.
Sin cambios en SiteGround, claves, esquema, controles de acceso o configuración
global; sin correo, commits, push ni publicaciones.

**Último nivel estable comprobado: 5 escritores + profesor, sólo el perfil normal
corto.** Quedan preparados generador, guardas, medición de almacenamiento, sonda,
auditoría y comandos; no quedan acreditados grupo de treinta, experiencia de
navegador bajo carga, gestión educativa ni beta. Una muestra corta de salud
no equivalen a una clase prolongada, otro servidor o SiteGround.
