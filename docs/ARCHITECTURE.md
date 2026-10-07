# Arquitectura de Veritas

## Principio de producto

El documento pertenece al usuario. Una actividad es una posible procedencia o destino, nunca el contenedor obligatorio del texto.

Un borrador es mutable y privado. Al sellarlo se crea una `document_version` inmutable con una huella del contenido y la última huella del proceso. Una `submission` referencia esa versión exacta; editar el documento después no modifica lo entregado.

El núcleo de Veritas no presupone un aula. Es un editor de procesos textuales sobre el que pueden construirse flujos para creación literaria, crítica genética, edición, investigación o enseñanza.

## Capas

- **React/TypeScript + Tiptap/ProseMirror:** archivo personal, documento estructurado, procedencia visual por rangos, moviola y flujos de sellado y entrega.
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

La versión 0.3 conserva una instantánea HTML saneada después de cada evento para simplificar la moviola. El editor ya trabaja sobre un árbol estructurado de ProseMirror, pero el contrato persistente continúa siendo HTML para mantener compatibilidad con los documentos y certificados existentes.

La procedencia visual distingue escritura directa, pegado intacto y pegado reelaborado. Las marcas personalizadas `paste` y `paste-edited` permiten que sólo el rango realmente introducido al revisar un pegado cambie de procedencia; el resto conserva su marca original.

Cada transacción significativa genera una instantánea y un tipo de evento. El servidor vuelve a sanear el HTML, asigna la hora de recepción y enlaza el evento al anterior mediante HMAC. El navegador nunca es la autoridad de integridad.

La siguiente evolución de almacenamiento incorporará un esquema JSON versionado, operaciones incrementales e instantáneas periódicas. El HTML seguirá siendo una representación derivada para visualización, exportación y compatibilidad.

## Frontera de formato y seguridad

El editor no acepta HTML arbitrario del portapapeles. El pegado entra como texto plano y recibe una marca de procedencia. Al guardar, `DocumentSanitizer` aplica de nuevo una lista cerrada de elementos y atributos; las familias y tamaños tipográficos son identificadores controlados, no estilos CSS enviados por el cliente.

Esta separación permite ampliar el editor sin convertir el documento en una superficie de scripts o estilos inyectados.
