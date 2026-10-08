# InkGroove: logo y tipografía

La identidad visual usa el tintero de época aprobado y el nombre InkGroove en Selectric Century Medium 8, a partir de los archivos proporcionados. El verde `#12352d`, el coral `#ff6b42` y el papel `#fffefb` conservan la paleta de la aplicación.

## Archivos

Los SVG originales están en `resources/brand/`. Tanto el símbolo como las letras son trazados; no contienen imágenes incrustadas ni dependen de una fuente externa. Los huecos del grabado son transparentes.

- `InkGroove-logo-tinta-naranja.svg`: versión usada en las cabeceras claras; mancha ampliada y nombre del mismo coral. El tintero conserva su verde.
- `InkGroove-logo-tinta-claro.svg`: variante para el acceso sobre fondo verde, con tintero claro y nombre y mancha coral.
- `InkGroove-logo-tinta-verde.svg`: variante monocroma con la mancha ampliada.
- `InkGroove-logo-naranja.svg`: versión anterior, conservada como alternativa.
- `InkGroove-logo-verde.svg`: alternativa monocroma, con la mancha del mismo verde.
- `InkGroove-logo-claro.svg`: versión clara anterior.
- `InkGroove-icono-naranja.svg` y `InkGroove-icono-verde.svg`: símbolo independiente.
- `InkGroove-wordmark.svg`: nombre independiente.

El favicon usa el tintero sobre una superficie clara para que resulte legible con ambos temas del navegador. Vite incorpora las imágenes del logo y la fuente a los recursos de producción con nombres que cambian al actualizar su contenido.

## Uso de la fuente

Los archivos adjuntos de Selectric Century carecen de las vocales acentuadas y la ñ. Algunos glifos de diéresis también están vacíos. La ampliación incluida añade `áéíóúñü ÁÉÍÓÚÑÜ ¿¡`, marcas combinantes y los signos de acento y virgulilla. Repara las diéresis de a, o y u. Las vocales usan los contornos originales; la í utiliza la i sin punto. La diéresis se construye a partir del punto de la fuente; el acento y la virgulilla son nuevos contornos.

Las versiones ampliadas llevan nombres propios para distinguirlas de los originales y evitar conflictos al instalarlas:

- `InkGrooveType8-ES.ttf` → **InkGroove Type 8**, basada en Medium 8.
- `InkGrooveType9-ES.ttf` → **InkGroove Type 9**, basada en Medium 9.
- `InkGrooveTypeClean-ES.ttf` → **InkGroove Type Clean**, basada en Medium 9 Clean.

`resources/fonts/InkGrooveTypeClean-ES.woff` se sirve desde la aplicación, sin llamadas a servicios externos. La regla `@font-face` define `InkGroove Type Clean` con peso 400 y `font-display: swap`. La variable `--display-font` y la clase `.display-type` se aplican a los titulares del acceso, archivo y entregas. Los controles conservan su tipografía habitual. El selector del editor ofrece **Selectric Clean · ES**; elegirlo queda registrado como un cambio de formato y se conserva al guardar, reabrir, reproducir y exportar. Negrita y cursiva en esta opción se sintetizan a partir del estilo regular.

El motor tipográfico trata igual el texto español en NFC y NFD. No se cambia ni normaliza el texto de los documentos para corregir la fuente. Se amplían las métricas verticales para que no se recorten las mayúsculas acentuadas.

Los ODT y RTF declaran la familia **InkGroove Type Clean** cuando se selecciona. No incrustan la fuente: para conservar la tipografía al abrirlos en un editor de escritorio hay que instalar el TTF. El texto permanece en Unicode y legible aunque el editor sustituya la fuente.

La licencia y los créditos originales (IBM, Jens Kutilek) se conservan en los metadatos y en `resources/fonts/OFL.txt`. Los originales están en `resources/fonts/source/`. La ampliación se distribuye bajo SIL Open Font License 1.1, que permite modificar e incrustar las fuentes, con sus condiciones de atribución, nombres reservados y redistribución:

- <https://github.com/jenskutilek/quarantine-fonts>
- <https://openfontlicense.org/open-font-license-official-text/>

## Regenerar los recursos

El servidor no necesita herramientas tipográficas. Los TTF, WOFF y SVG generados ya se incluyen. Para regenerarlos durante el desarrollo se necesita Python con `fontTools`; para verificar el renderizado, también `Pillow` con RAQM:

```sh
python3 scripts/build-selectric-es.py
python3 scripts/check-selectric-es.py
python3 scripts/build-brand.py
npm run build
```

Este cambio afecta a la presentación de la marca. Los nombres internos, las claves de recuperación local, el registro de eventos y los certificados existentes conservan sus identificadores.
