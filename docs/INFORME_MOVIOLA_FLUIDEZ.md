# InkGroove · Corrección de fluidez de la moviola

11 de octubre de 2026. Estado: **preparada y validada localmente; pendiente de aplicar y comprobar en desarrollo**.

## Base y alcance

Base: exportación `inkgroove-source-20261011-000015-49875.tar.gz`, 195 fuentes,
checkout `main` sobre `04c2e9ce175fe123fb2f9fcf661a3a927ea49ab0` con cambios
locales. Ese HEAD no identifica todo el contenido exportado. La copia original
se conserva; se trabaja en una copia aislada sin `.git`. No se ha accedido al
Mac, Alpine, SiteGround, datos reales, claves ni base de datos. Sin commits,
push, publicaciones ni cambios de configuración. El paquete incluye el diff,
SHA-256 anteriores/resultantes y un aplicador que comprueba la base.

## Evidencia y diagnóstico

Alejandro informa de comportamiento equivalente en Safari y Chrome en su
recorrido manual, salvo parpadeos al retroceder en la moviola. Las capturas
aportadas muestran tanto `Cargando instantánea…` sustituyendo el texto como
`No se pudo cargar la instantánea.`. La observación respalda ese recorrido;
no valida todos los menús, exportaciones, entregas ni capacidad.

El código anterior de `Timeline`:

- Sustituye todo el HTML por un párrafo de carga cuando falta una instantánea.
- Precarga desde la selección hacia delante; el evento anterior suele quedar
  fuera del lote durante el retroceso.
- Descarta la respuesta al cambiar de selección aunque la lectura sigue en
  curso, lo que permite múltiples lecturas simultáneas y desaprovecha resultados.
- Conserva un error booleano que puede seguir visible en una selección en caché.

Se reprodujo la sustitución del HTML en una prueba de regresión del código
anterior. Esto demuestra la regresión visual, pero no identifica el HTTP ni
la causa de la petición que falló en la captura. Tampoco recupera la aserción
histórica de Codex ni sus HMAC, cuyos datos ya se eliminaron.

## Cambio

- Conserva el último fotograma confirmado mientras espera otro. El encabezado
  y el tiempo siguen identificando el fotograma realmente mostrado; un estado
  separado identifica la selección pendiente. No presenta el texto anterior
  como evidencia del evento nuevo.
- Precarga en ambas direcciones cerca de la selección, al aproximarse al borde
  de la caché. Lotes de hasta 32; caché de 64 instantáneas remotas y, aparte, el
  último fotograma mostrado. Ventana lateral de hasta 41 eventos.
- Una lectura de instantáneas en curso por moviola. Los saltos rápidos conservan
  la selección más reciente, reutilizan las respuestas recibidas y no permiten
  que una respuesta anterior seleccione el fotograma.
- Abortado/aislado al salir o cambiar de documento. Errores por ID, sin reintentos
  automáticos interminables; reintento explícito. Una respuesta que omite HTML
  no se transforma en una instantánea vacía válida.
- La reproducción espera cuando falta el fotograma y continúa al llegar.
  Ante fallo de la selección se detiene y el reintento permanece disponible.
- Mantiene ES/EN, HTML exacto, Unicode, párrafos vacíos y marcas de procedencia.

No cambia ingesta, guardado, recuperación, métricas, versiones, HMAC, permisos,
fronteras de entrega ni esquema. Las lecturas usan el endpoint autorizado
existente; no descarga de antemano todo el HTML del historial.

## Comprobaciones realizadas

Dependencias coincidentes con el lockfile exportado. Runtime local Node 24.19.0,
Vitest 5.0.3, Vite 7.3.6, TypeScript 5.9.3, Playwright 1.62.1. Chromium local
138.0.7204.0; no es el Chromium 151 ni el Node 22 del desarrollo de Alpine.

1. Regresión en la base anterior: fallo esperado; recibe
   `<p>Cargando instantánea…</p>` donde se exige mantener el HTML confirmado.
   En el control se exportó la función para acceder a ella desde el test, sin
   cambiar su lógica.
2. Trece pruebas nuevas de moviola y dos existentes de historial: **15/15**.
   Cubren retroceso, caché bidireccional, cambios rápidos de selección, identidad
   del fotograma, tiempo, límites, fallo/reintento, respuesta incompleta,
   instantánea realmente vacía, cambio de documento, reproducción y ES/EN/demo.
3. Recorrido Chromium local con 120 eventos ficticios, API controlada y 120 ms
   de retraso por respuesta. Una pasada antes y una después, secuenciales.
   Un `MutationObserver` cuenta los fotogramas cuyo texto se vacía o se sustituye
   por el mensaje de carga tras mostrarse el primer fotograma.

| Observación del recorrido controlado | Base anterior | Corrección |
| --- | ---: | ---: |
| Parpadeos detectados | 4 | 0 |
| Máximo de lecturas simultáneas | 7 | 1 |
| Lecturas de instantáneas | 11 | 6 |
| Conserva HTML durante carga | No | Sí |
| Conserva HTML tras fallo simulado | No | Sí |
| Solicitudes distintas de GET | 0 | 0 |
| Errores JavaScript no capturados | 0 | 0 |

El control anterior termina con la aserción de conservación fallida; el
recorrido corregido pasa. Son muestras funcionales individuales, sin medianas,
p95 ni inferencia de capacidad. El fallo HTTP del fixture es un 503 deliberado;
no se afirma que ese fuese el error de la captura de Alejandro.

4. TypeScript y compilación Vite. La fuente binaria
   `InkGrooveTypeClean-ES.woff` está excluida del export; Vite conserva su referencia
   y avisa de que debe resolverse en ejecución. Persiste aviso del chunk del
   editor superior a 500 kB. El parche no reemplaza fuentes ni entrega activos
   compilados: deben compilarse en el árbol completo de desarrollo.

Se entregan `resources/js/timeline.test.tsx` y
`scripts/check-timeline-browser.mjs` para repetir la regresión con herramientas
ya presentes. Este último crea y retira su fixture local y siempre intercepta
la API; no admite una URL remota ni es un runner de PHP/MariaDB.

## Pendientes y siguiente paso

Aplicar con comprobación de base, sincronizar y compilar exclusivamente en
desarrollo con los scripts existentes. Repetir el recorrido de Alejandro en
Safari y Chrome, incluyendo retroceso lento, saltos amplios, play, regreso al
editor y reapertura con texto intacto. Si reaparece el aviso de fallo, identificar
la petición, su estado HTTP y un registro depurado; no deducir su causa sólo
por el parpadeo.

Una caché acotada no garantiza que un salto a una zona todavía no leída responda
instantáneamente. Mientras llega, mantiene el fotograma confirmado e identifica
la espera. La fluidez contra PHP/MariaDB y los navegadores reales de Alejandro
se da por pendiente hasta recibir evidencia posterior a la instalación.

El contrato anterior de Chromium real permanece cerrado: este trabajo no
ejecuta un tercer intento contra el backend, nueva carga, auditoría HMAC ni
reapertura integral del fixture histórico. Treinta alumnos, preparación de
beta y operación del piloto siguen pendientes.

## Decisión

Se conserva la carga progresiva y su memoria acotada, corrigiendo la precarga y
el cambio de fotograma. Alternativa descartada: volver a descargar todas las
instantáneas, que recuperaría fluidez a costa del tiempo de apertura y memoria
ya optimizados. El coste añadido es una cola de lecturas, precarga limitada y
un fotograma retenido. Revisar tras la prueba manual del desarrollo completo.
