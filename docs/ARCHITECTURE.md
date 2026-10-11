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

## Lectura progresiva del historial

El editor obtiene el borrador mediante el detalle y carga metadatos del proceso
en segundo plano. `/timeline?metadata=1` devuelve hasta 1.000 eventos por página,
sin HTML; `direct_words` permite conservar las fórmulas de PPM sin descargar
instantáneas. `total`, `before_id` y `next_cursor` describen una lectura estable.
Las páginas posteriores deben enviar el mismo `before_id` y el cursor devuelto.
El orden es `server_received_at`, `sequence`, `id`; el último desempata las
coincidencias que antes no tenían orden especificado. La cota de ID excluye
inserciones posteriores, incluso con fecha anterior; la sesión local se combina
por `(writing_session_id, sequence)` y no se pierde al llegar una página.

La moviola solicita `snapshot_ids[]` (máximo 32 IDs del mismo documento) o
`event_id`, conserva como máximo 64 instantáneas remotas y renderiza una ventana
de 41 eventos alrededor de la selección. La selección mantiene su identidad
cuando llegan páginas. Reproducción espera la instantánea pendiente. Errores y
carga son explícitos y permiten reintentar. El borrador y su guardado no dependen
del análisis histórico.

La lectura sin `metadata` también está paginada: 50 eventos por defecto, máximo
100 y aproximadamente 2 MB de HTML por página (siempre admite un primer evento).
**Los clientes deben seguir `next_cursor`: ya no existe una respuesta completa
implícita ni el recorte silencioso a 10.000.** Gzip sigue negociándose en todas
las variantes correctas de esta ruta, sin cachear historiales privados. La ruta
usa un cupo de lectura propio de 120/minuto para que las páginas y la reproducción
no consuman el cupo de escritura de 60/minuto.

PHP calcula `direct_words` sin normalizar Unicode ni alterar HTML persistido;
MySQL se recorre sin buffer PDO durante esa consulta y el atributo se restaura
al terminar. No hay migración, índices nuevos, cambio de HMAC, sellos ni formato
de almacenamiento. El servidor aún analiza todas las instantáneas para completar
las métricas: baja la transferencia y la memoria del cliente, no elimina ese
trabajo ni demuestra concurrencia. Los eventos locales de la sesión activa
conservan sus instantáneas; el historial remoto conserva únicamente metadatos.

## Lectura de entregas y recuperación por identidad

El detalle de entrega devuelve únicamente su versión. El proceso y las imágenes
para un destinatario exigen `version_id` y autorización para esa versión concreta.
Los sellos de formato 2 incorporan una frontera firmada por todas las sesiones;
ingesta, guardado y captura del sello serializan mediante el bloqueo del documento.
No se comparten historiales generales de versiones antiguas sin frontera firmada.
La recuperación local incluye identidad, documento y formato; no se migra una
entrada antigua sin propietario al usuario que entra después. Contrato, pruebas
y límites en [SUBMISSION_PRIVACY.md](SUBMISSION_PRIVACY.md).

### Protección de escrituras

`documents.revision` se compara e incrementa bajo `FOR UPDATE` en cada PATCH.
No se usa `updated_at` como token. Ingestas repetidas comparan el evento aceptado;
`writing_events.request_hash` permite comprobar exactamente las solicitudes
nuevas sin cambiar la cadena HMAC. Contrato y recuperación por copias en
[CONCURRENCY_RECOVERY.md](CONCURRENCY_RECOVERY.md).
