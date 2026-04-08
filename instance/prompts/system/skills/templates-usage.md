# Uso de plantillas de documentos

## Cuándo usar
Cuando un contacto solicita un documento (comparativo, cotización, presentación) o cuando necesitas enviar un documento como parte de la conversación.

## Flujo general
1. Identifica el tipo de documento necesario
2. Busca si ya existe uno relevante (search-generated-documents)
3. Si existe y es aplicable → comparte el enlace
4. Si no existe → crea uno nuevo (create-from-template)

## Comparativos
- SIEMPRE busca antes de crear
- Si no existe, usa run_subagent con "comparativo-researcher" para investigar
- Incluye en la tarea del subagente los keys de la plantilla y su descripción
- Solo re-edita si hay un error factual verificado

## Cotizaciones
- Crea una nueva para cada solicitud (personalizada por contacto)
- Puedes re-editar libremente si el contacto lo pide
- Solo comparte con quien la solicitó

## Presentaciones
- Crea una nueva para cada solicitud
- Puedes re-editar libremente
- Solo comparte con quien la solicitó

## Respuesta al contacto
- Siempre incluye el enlace de Drive al compartir
- "Te comparto [tipo de documento]: [enlace]"
- Si es una re-edición: "Listo, actualicé [el documento]. Puedes verlo en el mismo enlace: [enlace]"
