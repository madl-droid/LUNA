# src/extractors/ — Extractores Globales

## Propósito
Funciones de extracción de contenido unificadas. **CUALQUIER** módulo, agente, subagente o proceso que necesite extraer información de un archivo DEBE usar estas funciones. No se duplica lógica de extracción en ningún otro lugar.

## Archivos
- `types.ts` — Tipos: ExtractedContent, ExtractedSection, ExtractorResult (unión discriminada por kind), ExtractedImage, SheetsResult, SlidesResult, etc.
- `utils.ts` — Utilidades: resolveMimeType, isImplicitTitle, computeMD5, isSmallImage, constantes
- `index.ts` — Registry central: extractContent(), isSupportedMimeType(), classifyMimeType()
- Extractores por formato (uno por archivo): markdown.ts, text.ts, docx.ts, sheets.ts, pdf.ts, slides.ts, image.ts, web.ts, youtube.ts, video.ts, audio.ts

## Regla de uso
```typescript
import { extractContent } from '../../extractors/index.js'
const result = await extractContent(buffer, fileName, mimeType, registry)
```

## Tipos de resultado
- `ExtractedContent` — resultado genérico (text + sections + metadata). Lo devuelven: MD, TXT, JSON, DOCX, PDF.
- `ExtractorResult` — unión discriminada por `kind` para resultados tipados por formato.
- `toExtractedContent(result)` — convierte cualquier ExtractorResult a ExtractedContent para backward compat.

## Detección de títulos
Todos los extractores de texto usan `isImplicitTitle()` de utils.ts:
- ALL CAPS
- < 15 palabras
- Termina en ":"
- Seguida de texto más largo
- Se necesitan ≥ 2 criterios para ser título

## Imágenes en documentos
DOCX, PDF y Web extraen imágenes embebidas. Filtros comunes:
- Mínimo 75×75px
- Dedup por hash MD5
- Se asignan a la sección más cercana por encima

## Trampas
- `registry` es opcional pero necesario para LLM vision (imágenes, PDF scanned)
- Los extractores legacy de `src/modules/knowledge/extractors/` se mantienen como shim re-export
- `parseFAQsFromXlsx` NO migra — es lógica de negocio de knowledge, no extracción
- Smart chunker NO migra — chunking es concern de knowledge/embedding
