Implementado y validado. Informe completo: [SUBMISSION_PRIVACY.md](/Users/ale/Documents/veritas/docs/SUBMISSION_PRIVACY.md).

- **Entregas:** autorización por versión en el servidor, frontera firmada de todas las sesiones y bloqueo transaccional común para ingesta, guardado y sellado. B no obtiene borradores, imágenes, métricas ni metadatos posteriores; C queda excluido. Añadida una vista mínima de lectura.
- **Versiones antiguas:** firmas y payloads conservados. Sin frontera verificable, se comparte únicamente la instantánea autorizada, con aviso ES/EN.
- **Recuperación:** claves por usuario/documento/formato, comprobación de identidad y propiedad, limpieza del estado visible y rechazo de respuestas, renovaciones CSRF y exportaciones tardías. A recuperó su trabajo tras volver a entrar; B no lo vio ni restauró. Las entradas antiguas permanecen intactas, con recuperación explícita documentada. **No es cifrado.**
- **Pruebas:** 31 Vitest, 35 PHPUnit con 325 assertions, TypeScript/Vite, cinco simuladores y smoke MariaDB correctos. Chromium validó tanto la API simulada como los flujos reales con PHP/MariaDB.
- **Regresión:** 25.000 eventos, guardado durante carga, moviola sin escrituras, gzip equivalente byte por byte y comprobación de 25.007 HMAC y del sello.
- **Limpieza:** eliminados exclusivamente los fixtures registrados —usuarios ficticios 6–27 y sus datos—; manifiestos retirados y túnel cerrado. `inkgroove-dev` queda saludable.

Se conservaron los cambios previos. Sin cambios en producción, claves o configuración global; sin correos, commits, push ni publicaciones.

Pendientes Safari/teclado físico, capacidad con alumnos, memoria pico y controles generales del piloto. Este encargo no acredita que la beta esté preparada.