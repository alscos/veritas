Completado. Conservé los cambios locales y gzip; implementé historial paginado sin recorte a 10.000, apertura independiente del historial y moviola con instantáneas bajo demanda, caché limitada y máximo 41 filas visibles. PPM y tiempos mantienen sus fórmulas, con carga y errores explícitos. Almacenamiento, hashes y sellos permanecen intactos.

Mediciones contra PHP/MariaDB reales, con 2.000 eventos y Chromium a 10 Mbit/s/40 ms:

| Mediana del editor disponible | Antes | Después |
|---|---:|---:|
| Primera apertura | 8,950 s | 0,817 s |
| Reapertura | 15,566 s | 0,126 s |

Las métricas completas siguen tardando: 9,302 s y 0,922 s respectivamente.

El recorrido real con 25.000 eventos comprobó escritura durante la carga, guardado, navegación, reproducción y reapertura. La moviola no modificó el borrador. Pasaron permisos y verificación de 25.007 eventos HMAC y del sello.

También pasaron 26 Vitest, 32 PHPUnit/275 assertions, compilación, Chromium sintético, cinco simuladores y smoke MariaDB.

Fixtures eliminados e identificadores registrados. `inkgroove-dev` está saludable; `/up` devuelve 200. Sin commits, push ni publicaciones.

[Informe completo](/Users/ale/Documents/veritas/docs/DOCUMENT_OPEN_PERFORMANCE.md): condiciones, transferencia, memoria y distinción entre pruebas reales y sintéticas. Sin bloqueos pendientes. Quedan Safari con teclado físico, capacidad con alumnos y memoria pico/RSS comparable; PHP aún analiza el HTML histórico para completar las métricas.