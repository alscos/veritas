# Arquitectura de Veritas

## Principio de producto

El documento pertenece al usuario. Una actividad es una posible procedencia o destino, nunca el contenedor obligatorio del texto.

Un borrador es mutable y privado. Al sellarlo se crea una `document_version` inmutable con una huella del contenido y la última huella del proceso. Una `submission` referencia esa versión exacta; editar el documento después no modifica lo entregado.

## Capas

- **React/TypeScript:** archivo personal, editor, procedencia visual, moviola y flujos de sellado y entrega.
- **Laravel/PHP:** identidad, autorización, validación, saneamiento, sesiones, certificados y API.
- **MySQL/MariaDB:** usuarios, documentos, eventos, versiones, entregas, cursos y actividades.
- **Apache:** entrega los activos compilados y la aplicación PHP.

La aplicación usa el mismo código en Docker y en LAMP. Docker es una forma de distribución, no una arquitectura alternativa.

## Entidades

- `users`: identidad.
- `documents`: borrador vivo y privado.
- `writing_sessions`: periodos de elaboración.
- `writing_events`: operaciones append-only encadenadas.
- `document_versions`: instantáneas inmutables.
- `certificates`: firma y código verificable de cada versión.
- `submissions`: entrega de una versión a un usuario o actividad.
- `courses` y `course_memberships`: contexto educativo.
- `assignments`: encargos opcionales del profesor.

## Evolución del registro

La versión 0.3 conserva una instantánea saneada después de cada evento para simplificar la moviola. Antes de una implantación grande se incorporarán instantáneas periódicas y operaciones incrementales para reducir almacenamiento sin perder reconstrucción.

La procedencia visual distingue escritura directa, pegado intacto y pegado reelaborado. En esta versión inicial, la primera modificación convierte el segmento pegado completo en `paste-edited`. Un editor estructurado basado en ProseMirror/Tiptap permitirá en la siguiente fase conservar la procedencia a nivel de rangos precisos.
