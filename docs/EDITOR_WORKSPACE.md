# Taller editorial

Veritas añade herramientas de escritura al editor Tiptap/ProseMirror sin cambiar
su núcleo de memoria documental. La instalación sigue usando PHP, Apache y
MySQL/MariaDB. No requiere las extensiones comerciales de Tiptap.

## Funciones

- Folios A4, A5, Letter y Legal, en vertical u horizontal. Márgenes de 15, 20,
  25 y 30 mm, zoom y saltos de página explícitos.
- Descarga editable ODT 1.3 y RTF, con texto Unicode, líneas vacías, formato,
  listas, enlaces, tablas e imágenes incrustadas.
- Carpetas personales: creación, cambio de nombre y traslado de documentos.
  Eliminar una carpeta conserva los documentos en «Sin carpeta».
- Imágenes JPG, PNG, WebP y GIF mediante arrastre, portapapeles o selector,
  con descripción y tamaño ajustable. Máximo 5 MB e imagen de 40 megapíxeles;
  hasta 100 imágenes por documento.
- Menú Formato / Insertar / Página / Archivo: párrafo y títulos H1–H3, familias
  tipográficas, tamaños en puntos, color, negrita, cursiva, subrayado, tachado,
  subíndice y superíndice, alineación, justificado, sangría, interlineado,
  listas, citas, tablas, enlaces, líneas, deshacer, rehacer y buscar/reemplazar.

Las copias ODT/RTF son documentos editables. El historial, las marcas de
procedencia y la certificación se conservan en Veritas; no se transfieren como
prueba a esos archivos. El PDF certificado con QR sigue en la hoja de ruta.

## Guardado y procedencia

La configuración del papel se guarda con el documento y con cada versión sellada.
Los cambios de formato y las inserciones de imágenes se registran. La paginación,
el zoom y las coincidencias de búsqueda sólo afectan a la vista y no generan
eventos de escritura ni se incluyen en el HTML guardado.

El rojo corresponde al pegado conservado y el azul sólo a los caracteres
introducidos al reelaborarlo. Limpiar el formato mantiene esas marcas. Las
líneas vacías forman parte del documento y se conservan en el guardado.

Las imágenes se guardan fuera de la carpeta pública y se sirven con autorización.
El propietario accede a ellas; un destinatario sólo accede a las incluidas en una
versión entregada. Cada imagen tiene una huella SHA-256 incluida en el sellado.
En Docker quedan en `data/app/images`, junto al almacenamiento persistente de
la aplicación. El saneador del servidor sólo admite formatos controlados,
enlaces seguros e imágenes que pertenecen al documento.

## Alcance de la maquetación

Los folios se calculan en el navegador mediante decoraciones de ProseMirror.
El texto continuo fluye entre páginas y los saltos explícitos crean otra hoja.
Las imágenes y las tablas pequeñas se mantienen juntas cuando caben en un folio.
La división de tablas extensas, las viudas y huérfanas, los encabezados y pies
editables y la impresión exacta requieren una siguiente etapa de maquetación.
Los motores de Word y LibreOffice pueden repartir las páginas de la copia
editable de forma distinta por las fuentes disponibles y sus reglas de composición.

## Validación

- `npm test`: procedencia, undo/redo, composición de texto, formato, búsqueda y
  generación de ODT/RTF; `npm run build`: TypeScript y compilación de producción.
- `vendor/bin/phpunit`: guardado Unicode y del papel, carpetas privadas, imágenes,
  permisos de entrega, sellado y saneado. Estas pruebas usan SQLite en memoria
  y requieren `pdo_sqlite` en el entorno de pruebas.
- Recorrido real en Chromium con Laravel: creación, carpetas, texto en varios
  folios, reelaboración azul, tipografía, arrastre de una imagen, ODT/RTF,
  reapertura y moviola sin alteración del documento.
- Los paquetes ODT y su XML, y los controles de RTF, tienen pruebas estructurales;
  el ODT de prueba también pasa el esquema oficial ODF 1.3 de OASIS.
  La revisión visual de los archivos en Word/LibreOffice y la prueba en Safari
  deben completarse durante la validación de la instalación.

## Actualización de Alpine

El paquete incremental se aplica sobre la instalación del núcleo editorial
`ad4d584` o una revisión posterior de esta rama. Incluye la corrección de
procedencia. No incluye credenciales, documentos ni imágenes de usuarios.

Después de copiar el archivo a `/root`, extrae únicamente el instalador para
ejecutarlo antes de sustituir el código:

```sh
tar -xOf /root/ACTUALIZACION.tar.gz scripts/upgrade-editor-workspace.sh > /root/veritas-upgrade.sh
sh /root/veritas-upgrade.sh /root/ACTUALIZACION.tar.gz
```

El instalador guarda la base de datos, el código, la configuración y el volumen
de la aplicación en una carpeta privada `/root/veritas-backup-FECHA`. Conserva
también una etiqueta de la imagen anterior. Compila y recrea únicamente el
servicio `app`. El arranque ejecuta la migración `000004`, que añade carpetas,
configuración de papel e imágenes. La base de datos existente permanece en su
volumen.

Haz una recarga completa y prueba: crear carpeta/documento, escribir con tildes
y líneas vacías, pegar/reelaborar, arrastrar imagen, cambiar papel, descargar,
reabrir, reproducir la moviola y sellar. Revisa `docker compose logs --tail=60 app`
si aparece un error. No restaures la base de datos de la copia mientras se
investiga un fallo de la aplicación.

Para LAMP, configura un directorio de imágenes fuera del document root mediante
`VERITAS_MEDIA_PATH`, con permiso de escritura para PHP, y límites de subida
`upload_max_filesize=5M` y `post_max_size=8M`. Guarda ese directorio en las copias
de seguridad junto a la base de datos y las claves de la aplicación.
