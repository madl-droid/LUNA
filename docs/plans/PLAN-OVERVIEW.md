# Plan Maestro: Extractores y Manejo de Archivos (v2)

## Arquitectura: 2 Pipelines + Especializados

```
                        Archivo entra
                             │
                    ¿Tiene contenido visual?
                    (imgs, scans, slides)
                             │
              ┌──────────────┴──────────────┐
              │                             │
     PIPELINE TEXTO                PIPELINE VISUAL
     (chunkDocs)                   (chunkPdf — 3 págs)
              │                             │
     .txt, .md, .json              .pdf con imgs/scans
     .docx SIN imgs                .docx CON imgs → PDF
     .pdf SOLO texto               .pptx → PDF
                                   Google Slides → PDF
                                   Speaker notes → chunks text extras

     ESPECIALIZADOS (no cambian):
     ├─ sheets  → 1 fila = 1 chunk
     ├─ image   → 1 imagen = 1 chunk
     ├─ audio   → temporal 60/70/10
     ├─ video   → temporal 50/60/10
     ├─ web     → secciones semánticas
     ├─ youtube → chapters o 5min
     └─ drive   → metadata + enlace
```

## Tracks de Ejecución

```
TRACK A (extractors/*.ts)          TRACK B (smart-chunker.ts)         TRACK C (infra)
├─ WP1: Metadata completa          ├─ WP2: Pipeline dual text/visual  ├─ WP-INFRA: Dockerfile + LibreOffice
├─ WP5: LLM dual description       ├─ WP3: Audio temporal chunking    └─ WP10: Binary lifecycle
├─ WP6: Sheets metadata            ├─ WP4: Video temporal chunking
├─ WP7: Web metadata               └─ (propagate metadata)
└─ WP9: DOCX/PDF router
                                    ↓ depends on Track A + B + C
                              TRACK D (unificación)
                              ├─ WP8: Slides/PPTX → PDF
                              └─ DOCX con imgs → PDF
                                    ↓
                              TRACK E (tests)
                              └─ WP11: Tests completos
```

## Paralelización

| Batch | Tracks | Simultáneo? |
|-------|--------|-------------|
| **Batch 1** | A + B + C | SÍ — archivos distintos |
| **Batch 2** | D | NO — depende de A+B+C |
| **Batch 3** | E | NO — depende de todos |

## Decisiones Tomadas (v2)

| Pregunta | Decisión | Razón |
|----------|----------|-------|
| Pipeline de texto | **Unificar** .txt/.md/.json/.docx-sin-imgs/.pdf-solo-texto → chunkDocs() | Un solo chunker semántico para todo texto plano |
| Pipeline visual | **Unificar** .pdf-con-imgs/.docx-con-imgs/.pptx/slides → chunkPdf() 3 págs | Un solo chunker multimodal para todo visual |
| PDF solo texto | **Va a pipeline texto** (chunkDocs, headings) | Más semántico que cortar por páginas arbitrarias |
| PDF con imágenes | **Va a pipeline visual** (chunkPdf, 3 págs) | Multimodal embedding necesita ver las páginas |
| PDF páginas por chunk | **3** (con 1 página overlap + 200 chars text overlap) | Balance costo/contexto |
| DOCX con imágenes | **Convertir a PDF → pipeline visual** | Gemini ve layout+imágenes+texto junto |
| Audio chunking | **STT completo → split transcript 60/70/10** | 1 llamada STT, split posterior |
| Video chunking | **Gemini multimodal → split 50/60/10** | 1 llamada LLM, split posterior |
| Speaker notes (slides) | **Chunks extras contentType='text'** | No se pierden, van como texto adicional |
| Temperatura extractores | **Quitar de extractores, usar solo router** | Bug: extractores sobreescriben el task router |
| LibreOffice | **Instalar en Dockerfile** | Para DOCX/PPTX→PDF local |
| YouTube + Drive folders | **Diferido** | Requieren más diseño |

## Almacenamiento de Binarios (v2)

### Regla universal: binarios SIEMPRE se guardan chunkeados

```
Archivo entra
  ↓
¿Necesita binario para embedding multimodal?
  ├─ NO (texto puro, web, youtube, drive metadata) → no guardar
  └─ SÍ (pdf, image, audio, video, sheets-csv) → guardar chunkeado
      ↓
    Partir binario en segmentos (1 por chunk)
    Guardar en instance/knowledge/media/
      ↓
    ¿Source = knowledge o attachment?
      ├─ KNOWLEDGE → vive mientras el documento de KB exista
      │              se borra cuando usuario elimina del KB
      └─ ATTACHMENT → vive hasta que TODOS los chunks estén embedded
                      nightly batch limpia los que tienen cleanup_ready=TRUE
```

### Tabla por tipo

| Tipo | Guarda binario? | Formato guardado | Knowledge: vida | Attachment: vida |
|------|----------------|-----------------|-----------------|------------------|
| text (.txt,.md,.json) | NO | — | — | — |
| pdf (pipeline visual) | SÍ, chunkeado | PDF parcial por chunk | Hasta borrar KB doc | Hasta embed completo |
| pdf (pipeline texto) | NO | — | — | — |
| image | SÍ, 1 archivo | Original (png/jpg) | Hasta borrar KB doc | Hasta embed completo |
| audio | SÍ, chunkeado (ffmpeg) | Segmentos audio | Hasta borrar KB doc | Hasta embed completo |
| video | SÍ solo knowledge | Segmentos video | Hasta borrar KB doc | **NO se guarda** (pesado) |
| sheets | SÍ, como CSV | CSV serializado | Hasta borrar KB doc | Hasta embed completo |
| web | NO (solo URLs) | — | — | — |
| youtube | NO (solo thumbnail b64) | — | — | — |
| drive (metadata) | NO | — | — | — |
| drive (knowledge) | SÍ, descarga archivo | Original del archivo | Hasta borrar KB doc | N/A |
| docx sin imgs | NO | — | — | — |
| docx con imgs | SÍ (como PDF) | PDF convertido | Hasta borrar KB doc | Hasta embed completo |
| slides/pptx | SÍ (como PDF) | PDF convertido/exportado | Hasta borrar KB doc | Hasta embed completo |

### Qué significa "chunkeado"
- **PDF**: el archivo PDF completo se guarda UNA vez, todos los chunks referencian el mismo archivo con `pageRange` en metadata. NO se parte el PDF en mini-PDFs (Gemini embedding acepta el PDF completo y usa pageRange).
- **Audio**: ffmpeg corta el audio en segmentos (60/70s). Cada chunk tiene su propio archivo de audio.
- **Video (knowledge)**: ffmpeg corta en segmentos (50/60s). Cada chunk tiene su propio archivo de video.
- **Image**: 1 imagen = 1 chunk = 1 archivo.
- **Sheets**: 1 CSV por documento (todos los chunks lo referencian).

## Archivos de Plan Detallado

- `PLAN-TRACK-A.md` — Extractors: metadata + LLM dual + sheets + web + routers
- `PLAN-TRACK-B.md` — Smart Chunker: pipeline dual + audio/video temporal
- `PLAN-TRACK-C.md` — Infra: Dockerfile + binary lifecycle
- `PLAN-TRACK-D.md` — Unification: slides→PDF, DOCX→PDF
- `PLAN-TRACK-E.md` — Tests
