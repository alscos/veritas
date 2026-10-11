Preparado y validado el procedimiento reproducible. Documentación y comandos en [docs/BACKUP_RESTORE.md](/Users/ale/Documents/veritas/docs/BACKUP_RESTORE.md); scripts reutilizables en `scripts/backup-*`.

- Copia completa de SQL, esquema, imágenes, configuración, claves, código sin commit, dependencias y activos, con manifiesto SHA-256.
- Restauración desde cero comprobada contra PHP/MariaDB reales: contenido e imágenes idénticos, HMAC, firmas y fronteras válidas, privacidad de entregas y nueva edición/sello correctos.
- Rechazos comprobados: destino activo o incorrecto, copia incompleta/corrupta y extracción fuera del directorio autorizado.
- Copia: **12,77 MB y 5,427 s**. Restauración final: **13,494 s**.
- Retirados exclusivamente los directorios, credenciales, copias, contenedores, redes y volúmenes del ensayo. Puertos liberados.
- `inkgroove-dev` permanece saludable; portada y `/up` devuelven **HTTP 200**.

Conservados los cambios locales. Sin cambios en producción/SiteGround, commits, push, correo ni publicaciones.

Pendientes: ensayo específico en SiteGround, almacenamiento externo cifrado, custodia de claves, retención y recuperación ante pérdida del host. Los borradores y eventos pendientes sólo en el navegador quedan fuera de la copia del servidor.