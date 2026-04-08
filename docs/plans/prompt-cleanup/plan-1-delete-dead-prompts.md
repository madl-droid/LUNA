# Plan 1: Eliminar 9 archivos .md muertos/obsoletos

## Objetivo
Borrar archivos de prompts en `instance/prompts/system/` que no son referenciados por ningún código TS.

## Archivos a eliminar

| Archivo | Razón |
|---------|-------|
| `instance/prompts/system/evaluator-system.md` | Legacy v1, reemplazado por agentic v2. Sin refs en código. |
| `instance/prompts/system/proactive-evaluator-system.md` | Reemplazado por `proactive-agentic-system.md`. Sin refs. |
| `instance/prompts/system/cold-lead-scoring.md` | Nunca implementado. 0 referencias en todo el repo. |
| `instance/prompts/system/daily-report-narrative.md` | Sin referencias. Nightly batch genera reportes sin este template. |
| `instance/prompts/system/image-extraction.md` | Sin refs directas. El extractor de imágenes usa fallback inline. |
| `instance/prompts/system/channel-format-whatsapp.md` | Fallback Tier 2 nunca usado: `buildFormatFromForm()` en `channel-format.ts` siempre gana. El Tier 3 (hardcoded defaults en líneas 9-12) cubre el caso extremo. |
| `instance/prompts/system/channel-format-email.md` | Mismo caso que WhatsApp. |
| `instance/prompts/system/channel-format-google-chat.md` | Mismo caso. |
| `instance/prompts/system/channel-format-voice.md` | Mismo caso. |

## Pasos

1. Eliminar los 9 archivos listados arriba.
2. No tocar ningún archivo `.ts`.

## Verificación

Después de borrar, confirmar que ningún código los carga directamente por nombre literal:

```bash
grep -r "evaluator-system" src/ --include="*.ts"
grep -r "proactive-evaluator-system" src/ --include="*.ts"
grep -r "cold-lead-scoring" src/ --include="*.ts"
grep -r "daily-report-narrative" src/ --include="*.ts"
grep -r "image-extraction" src/ --include="*.ts"
```

Para los `channel-format-*`: se cargan dinámicamente via `getSystemPrompt(\`channel-format-${channel}\`)` en `src/engine/prompts/channel-format.ts:41`, pero esa es la Tier 2 — si el archivo no existe, cae al Tier 3 (hardcoded defaults en líneas 9-12 del mismo archivo). No hay que tocar código TS.

## Riesgo
Ninguno. Archivos sin referencias o con fallbacks que cubren su ausencia.

## Compilación
No requerida (solo se eliminan archivos .md, no se toca TS).
