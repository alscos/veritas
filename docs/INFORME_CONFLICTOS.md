Implementado y validado en desarrollo. Antes, un cliente antiguo podía sobrescribir el documento y las pestañas compartían recuperación. Ahora:

- Cada guardado compara e incrementa una revisión entera de forma atómica. Una revisión antigua recibe 409.
- El conflicto conserva texto y eventos locales, detiene reintentos y ofrece descargar el borrador o consultar el servidor en ES/EN, sin mezcla automática.
- Las pestañas guardan copias separadas. La recuperación antigua permanece accesible, sin poder sobrescribir una revisión posterior.
- Los lotes se envían ordenadamente; repetirlos no duplica eventos y reutilizar una secuencia con contenido diferente se rechaza.

Pasaron **32 Vitest, 37 PHPUnit/344 assertions**, compilación, simuladores y smoke MariaDB. Chromium contra **PHP/MariaDB reales** validó concurrencia, desconexión, reapertura, recuperación de más de 250 eventos, respuesta perdida y aislamiento de entregas. El recorrido editorial adicional usó API simulada. Se verificaron **288 HMAC y cuatro versiones**, incluidas sus fronteras.

Los eventos ya aceptados permanecen en sus sesiones originales; los pendientes en conflicto quedan locales. El proceso advierte que puede incluir borradores distintos del texto definitivo.

Modifiqué controladores/modelos de persistencia, una migración compatible, editor, recuperación, traducciones, pruebas y scripts. El listado completo y los resultados están en [CONCURRENCY_RECOVERY.md](/Users/ale/Documents/veritas/docs/CONCURRENCY_RECOVERY.md).

Fixtures eliminados exclusivamente por sus manifiestos; cero usuarios/documentos ficticios restantes. App/db dev saludables. Cambios locales conservados; sin tocar producción, claves ni configuración global, y sin correos, commits, push o publicaciones.

Pendientes Safari, teclado físico, capacidad y límites de almacenamiento local. **No se declara preparada la beta.**