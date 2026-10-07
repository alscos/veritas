# Veritas 0.3

Veritas es un editor de escritura con memoria. Conserva cómo se construye un texto, permite recorrer sus transformaciones, crear versiones inmutables y compartirlas sin exponer los borradores posteriores del autor.

El núcleo está pensado para escritores, investigadores, editores y filólogos. La educación es uno de sus ámbitos de aplicación: añade encargos, entregas y revisión docente sobre el mismo documento y el mismo registro de proceso.

Esta versión establece la arquitectura de producto:

- cuentas de usuario;
- archivo personal de documentos;
- editor estructurado React/Tiptap con formato, tipografía y procedencia precisa de texto pegado y reelaborado;
- eventos encadenados mediante HMAC y fechados por el servidor;
- versiones selladas con certificado verificable;
- entregas que apuntan a una versión concreta;
- esquema preparado para cursos y actividades opcionales;
- moviola del proceso de escritura.

## Instalación rápida con Docker

```bash
cp .env.example .env
```

Edita al menos `DB_PASSWORD` y `DB_ROOT_PASSWORD` en ese archivo y ejecuta:

```bash
docker compose up --build -d
```

Abre `http://IP-DEL-SERVIDOR:8080` y crea la primera cuenta desde la pantalla de acceso.

Consulta [INSTALL.md](INSTALL.md) para Epheso, actualizaciones, copias de seguridad y una instalación LAMP sin Docker.

## Estado

Es una versión de desarrollo para pruebas privadas. El sellado demuestra la integridad del registro recibido por Veritas, no la autoría intelectual absoluta ni la ausencia de ayuda externa. Antes de utilizarla con usuarios reales deben completarse correo verificado, recuperación de contraseña, administración, política de retención, pruebas de penetración y revisión jurídica/RGPD.
