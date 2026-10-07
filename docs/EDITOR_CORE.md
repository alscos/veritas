# Núcleo editorial de Veritas

## Decisión

Veritas evoluciona de un campo `contentEditable` controlado manualmente a un editor estructurado basado en Tiptap/ProseMirror. El objetivo no es añadir una barra de formato aislada, sino disponer de un modelo documental extensible sin perder la trazabilidad que diferencia al producto.

La educación pasa a ser un módulo de uso, no la definición del núcleo. El mismo documento con memoria puede servir a un escritor, un editor, un investigador de procesos creativos o un alumno.

## Primera etapa del núcleo

- negrita, cursiva y subrayado;
- títulos H2 reversibles a párrafo;
- listas con viñetas y numeradas;
- citas;
- familias tipográficas controladas y cuatro escalas de tamaño;
- deshacer y rehacer;
- pegado siempre como texto plano;
- conservación exacta de líneas vacías en el pegado;
- procedencia `paste` y `paste-edited` sobre rangos concretos;
- carga diferida del motor editorial;
- pruebas automáticas de los invariantes principales.

La primera etapa no cambió el esquema de base de datos. La ampliación posterior
del [taller editorial](EDITOR_WORKSPACE.md) añade carpetas, configuración de papel
e imágenes mediante una migración aditiva. Los documentos anteriores siguen
abriéndose mediante el HTML saneado, con A4 como configuración de papel inicial.

## Invariantes que no deben romperse

1. Una acción visible del usuario debe corresponderse con una transacción registrable.
2. El texto pegado que no se modifica conserva su procedencia original.
3. Sólo el texto nuevo introducido al reelaborar un pegado recibe `paste-edited`.
4. El formato no puede borrar ni falsear las marcas de procedencia.
5. El servidor sanea y encadena los eventos; no confía en atributos arbitrarios del navegador.
6. Abrir la moviola, volver al editor o recargar no puede cambiar el contenido.
7. Los documentos existentes deben seguir siendo legibles durante toda la migración.

## Siguiente etapa técnica

1. Añadir `content_json` con un número de versión de esquema, conservando `content_html` como representación derivada.
2. Registrar pasos de ProseMirror normalizados, además de instantáneas periódicas, para reducir tamaño y reconstruir con mayor precisión.
3. Incorporar pruebas de integración navegador-servidor para guardado, recuperación, moviola, sellado y caracteres Unicode.
4. Ampliar el modelo tipográfico mediante estilos semánticos de documento, evitando CSS libre dentro del contenido.
5. Diseñar notas, variantes y comparación de versiones como extensiones del modelo, no como HTML especial.

## Criterio de aceptación antes de desplegar

La rama podrá sustituir al editor actual cuando pase las pruebas automáticas, se valide manualmente en Chrome y Safari, y se complete en Alpine el recorrido: crear, escribir, pegar, reelaborar, dar formato, deshacer, guardar, abrir la moviola, volver, recargar y sellar.
