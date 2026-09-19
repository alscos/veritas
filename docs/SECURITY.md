# Modelo de seguridad

## Qué certifica Veritas

Veritas certifica que el servidor recibió un contenido y una cadena concreta de eventos asociados a una cuenta autenticada. No certifica por sí solo la autoría intelectual, la identidad física de quien tecleó ni la ausencia de ayuda externa.

## Controles incluidos

- contraseñas con hash Argon2id;
- sesiones cifradas, cookies HttpOnly y SameSite;
- CSRF para operaciones de escritura;
- consultas mediante Eloquent/PDO preparado;
- saneamiento del HTML en el servidor;
- límites de tamaño y de frecuencia;
- control de propiedad en cada documento;
- eventos append-only con secuencia continua;
- fecha de recepción del servidor;
- cadena HMAC entre eventos;
- versiones inmutables con hash SHA-256;
- certificados firmados con una clave separada;
- entrega de versiones, no de borradores vivos;
- CSP y encabezados defensivos en Apache.

## Antes de un piloto real

1. Verificación de correo y recuperación segura de contraseña.
2. Gestión institucional de roles y pertenencia a cursos.
3. Rotación documentada de claves de firma sin invalidar certificados históricos.
4. Registro de auditoría administrativo.
5. Política RGPD de minimización, retención, exportación y borrado.
6. Copias de seguridad cifradas y restauración ensayada.
7. Pruebas de autorización, CSRF, XSS, fuerza bruta y manipulación de eventos.
8. Accesibilidad y reglas para dictado y tecnologías de apoyo.
9. Revisión legal del texto del certificado y de los términos de uso.
