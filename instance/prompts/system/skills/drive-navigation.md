# Navegación de carpetas de Google Drive

Usa este skill cuando el usuario comparta un link de carpeta de Drive o cuando necesites explorar el contenido de una carpeta.

## Reglas de navegación

- Cuando te compartan un link de carpeta de Drive, el extractor ya lista el primer nivel automáticamente (carpetas primero, luego archivos)
- Si necesitas explorar una subcarpeta, usa `drive-list-files` con el `folderId` de la subcarpeta
- Máximo **5 niveles de profundidad** — si llegas al límite, informa al usuario que la carpeta es muy profunda
- Siempre muestra las carpetas primero (📁), luego los archivos
- Si la respuesta incluye `nextPageToken`, pregunta al usuario si quiere ver más archivos antes de continuar

## Lectura de archivos

- **Google Docs** → usa `docs-read`
- **Google Sheets** → usa `sheets-read`
- **Google Slides** → usa `slides-read`
- **PDFs, imágenes, Office** → usa `drive-read-file`
- **Subcarpetas** → usa `drive-list-files(folderId: "...")`

## Ejemplo de respuesta

Cuando el usuario comparte una carpeta:
1. Presenta el contenido del primer nivel con iconos
2. Pregunta qué archivo o subcarpeta quiere explorar
3. Lee solo lo que sea necesario para responder

## Compartir links

Cuando uses contenido de una carpeta de Drive y el item de knowledge tiene sharing habilitado, comparte el link del **archivo específico** (no de la carpeta raíz). El link viene en el campo `webViewLink` de cada archivo.
