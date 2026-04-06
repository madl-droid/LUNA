# Plan Maestro: Extractores y Manejo de Archivos

## Tracks de Ejecución

```
TRACK A (extractors/*.ts)          TRACK B (smart-chunker.ts)         TRACK C (infra)
├─ WP1: Metadata                   ├─ WP2: PDF 3-page chunking       ├─ WP-INFRA: Dockerfile + LibreOffice
├─ WP5: LLM dual description       ├─ WP3: Audio temporal chunking    └─ WP10: Binary lifecycle
├─ WP6: Sheets metadata            ├─ WP4: Video temporal chunking
├─ WP7: Web metadata               └─ (propagate WP1 metadata)
└─ WP9: DOCX router + temp fix
                                    ↓ depends on Track A + B
                              TRACK D (unificación)
                              ├─ WP8: Slides → PDF unification
                              └─ (uses LibreOffice from Track C)
                                    ↓
                              TRACK E (tests)
                              └─ WP11: Tests completos
```

## Paralelización

| Batch | Tracks | Pueden correr simultáneo |
|-------|--------|--------------------------|
| **Batch 1** | A + B + C | SÍ — archivos distintos |
| **Batch 2** | D | NO — depende de A (metadata) y B (PDF chunker) y C (LibreOffice) |
| **Batch 3** | E | NO — depende de todos |

### Track A toca: `src/extractors/*.ts` (todos los extractores)
### Track B toca: `src/modules/knowledge/extractors/smart-chunker.ts`, `src/modules/knowledge/embedding-limits.ts`
### Track C toca: `Dockerfile`, `src/modules/knowledge/embedding-queue.ts`, `src/modules/knowledge/knowledge-manager.ts`
### Track D toca: `src/extractors/slides.ts`, `src/extractors/docx.ts`, nuevo `src/extractors/convert-to-pdf.ts`
### Track E toca: `tests/extractors/`

## Archivos de Plan Detallado

- `PLAN-TRACK-A.md` — Extractors: metadata + LLM dual + sheets + web + DOCX router
- `PLAN-TRACK-B.md` — Smart Chunker: PDF fix + audio/video temporal chunking
- `PLAN-TRACK-C.md` — Infra: Dockerfile + binary lifecycle
- `PLAN-TRACK-D.md` — Unification: slides→PDF, DOCX→PDF
- `PLAN-TRACK-E.md` — Tests

## Decisiones Tomadas

| Pregunta | Decisión | Razón |
|----------|----------|-------|
| PDF páginas por chunk | **3** (con 1 overlap) | Balance costo/contexto. 20 págs = 8 chunks vs 19 con 2 págs |
| DOCX con imágenes | **Convertir a PDF** (Opción A) | Multimodal embedding ve layout+imágenes+texto todo junto |
| DOCX sin imágenes | **Mantener como texto** (mammoth) | Ya funciona bien, no hay downgrade |
| Audio chunking | **STT completo → split transcript post-hoc** | 1 llamada STT, split en background |
| Video chunking | **Gemini multimodal → description → split post-hoc** | 1 llamada LLM, split posterior |
| Temperatura extractores | **Quitar de extractores, usar solo la del router** | Bug actual: extractores sobreescriben router |
| LibreOffice | **Instalar en Dockerfile** | Necesario para DOCX/PPTX→PDF local |
| YouTube + Drive folders | **Diferido** | Requieren más diseño |
| Slides/PPTX | **Unificar con PDF pipeline** | Drive ya exporta como PDF, local con LibreOffice |
| Binario por chunk (knowledge) | **Guardar particionado** | Multimodal embedding necesita chunk+binario |
| Binario attachment | **Mantener hasta embed completo** | No borrar antes del último chunk |
