# OVERVIEW — Google Apps Improvements (Sheets + Docs + Slides)

**Fecha:** 2026-04-08
**Branch planner:** `claude/plan-google-apps-improvements-0dfMU`
**Objetivo:** Cerrar gaps funcionales de Sheets, Docs y Slides comparando con implementación Valeria. Preparar infraestructura para futuro módulo de plantillas (batch edit + find-replace en las 3 apps).

---

## Planes

| Plan | Contenido | Peso | Estado |
|------|-----------|------|--------|
| [01.md](./01.md) | **Sheets** — paginación, auto-detect tab, protección, validaciones, find-replace, batch edit | Heavy (~2.5h) | Pendiente |
| [02.md](./02.md) | **Docs + Auth** — truncation, word count, batch edit, retry OAuth init | Medium (~1.5h) | Pendiente |
| [03.md](./03.md) | **Slides** — speaker notes, add-slide tool, update-notes, batch edit | Medium (~2h) | Pendiente |

---

## Estrategia de ejecución

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Plan 01    │   │  Plan 02    │   │  Plan 03    │
│  SHEETS     │   │  DOCS+AUTH  │   │  SLIDES     │
│             │   │             │   │             │
│  tools.ts   │   │  tools.ts   │   │  tools.ts   │
│  L381-503   │   │  L505-601   │   │  L603-701   │
│             │   │             │   │             │
│  sheets-svc │   │  docs-svc   │   │  slides-svc │
│  manifest   │   │  oauth-mgr  │   │             │
│  types.ts   │   │  types.ts   │   │  types.ts   │
│  CLAUDE.md  │   │  CLAUDE.md  │   │  CLAUDE.md  │
└─────────────┘   └─────────────┘   └─────────────┘
      ↕                 ↕                 ↕
   PARALELO          PARALELO          PARALELO
```

### Los 3 planes se ejecutan en PARALELO

**Justificación:** Cada plan toca secciones completamente distintas de `tools.ts` (~120 líneas de separación entre secciones). Los archivos de servicio son independientes. Git auto-merge funciona limpio.

### Archivos compartidos — análisis de conflictos

| Archivo | Plan 01 | Plan 02 | Plan 03 | Riesgo conflicto |
|---------|---------|---------|---------|-------------------|
| `tools.ts` | Sección Sheets (L381-503) | Sección Docs (L505-601) | Sección Slides (L603-701) | **Bajo** — secciones separadas |
| `types.ts` | Agrega después de L110 (Sheets types) | Agrega después de L122 (Docs types) | Agrega después de L133 (Slides types) | **Bajo** — secciones separadas |
| `CLAUDE.md` | Actualiza lista de Tools | Actualiza lista de Tools + Auth | Actualiza lista de Tools | **Medio** — misma sección, merge manual posible |
| `manifest.ts` | Agrega configSchema param (L393) | Modifica init() (L443-451) | No toca | **Bajo** — zonas distintas |
| `sheets-service.ts` | Modifica | — | — | Ninguno |
| `docs-service.ts` | — | Modifica | — | Ninguno |
| `slides-service.ts` | — | — | Modifica | Ninguno |
| `oauth-manager.ts` | — | Modifica | — | Ninguno |

### Orden de merge

No hay dependencias entre planes. Merge en cualquier orden. Si CLAUDE.md genera conflicto, resolución trivial (combinar las 3 listas de tools).

### Validación post-merge

Después de mergear los 3 branches:
```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

---

## Scope completo (14 items)

### Sheets (6 items)
| # | ID | Descripción | Prioridad |
|---|-----|-------------|-----------|
| 1 | S1+S4 | Paginación + output formateado en `sheets-read` | P0 |
| 2 | S5 | Auto-detect primer tab cuando no se especifica rango | P1 |
| 3 | S2 | Protección contra escritura en sheets del sistema | P1 |
| 4 | S3 | Restaurar data validations (dropdowns) post-append | P3 |
| 5 | NEW | `findReplace()` servicio + tool `sheets-find-replace` | P1 |
| 6 | NEW | Tool `sheets-batch-edit` (write/append/clear/findReplace en 1 call) | P2 |

### Docs (3 items) + Auth (1 item)
| # | ID | Descripción | Prioridad |
|---|-----|-------------|-----------|
| 7 | D2 | Content truncation (30K chars) con indicador en `docs-read` | P1 |
| 8 | D3 | Word count en respuesta de `docs-read` | P1 |
| 9 | D1 | `batchEdit()` servicio + tool `docs-batch-edit` | P2 |
| 10 | A1 | Retry con exponential backoff en OAuth init | P1 |

### Slides (4 items)
| # | ID | Descripción | Prioridad |
|---|-----|-------------|-----------|
| 11 | SL1 | Speaker notes en lectura (`slides-read`) | P1 |
| 12 | SL2 | Tool `slides-add-slide` (servicio ya existe) | P2 |
| 13 | SL3 | `updateSpeakerNotes()` servicio + tool `slides-update-notes` | P2 |
| 14 | SL4 | `batchEdit()` servicio + tool `slides-batch-edit` | P2 |
