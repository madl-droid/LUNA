# Plan 9: Fixes post-auditoría

Corrige los bugs y deudas técnicas identificados en `docs/reports/audit-optimize-base-prompts.md`.

## Contexto

La auditoría identificó 6 bugs, 3 deudas técnicas, y 2 redundancias. Este plan aborda los fixes objetivos (bugs y deuda). Las opiniones sobre "sobre-ingeniería" de prompts no se abordan aquí — es decisión del equipo.

---

## FIX-1: Sincronizar setup wizard con los 5 acentos soportados (BUG-1 + DEUDA-2)

**Archivos:** `src/kernel/setup/handler.ts`, `src/kernel/setup/templates.ts`

**Problema:** El setup wizard ofrece `es-CL`, `es-CAR`, `en-CAR` que no tienen archivo `.md`. El dropdown de consola ya está correcto (5 acentos).

**Acción:**
1. En `src/kernel/setup/templates.ts`: actualizar las opciones del select de acento a solo los 5 soportados: `es-MX`, `es-CO`, `es-EC`, `es-PE`, `en-US` (+ opción vacía "sin acento")
2. En `src/kernel/setup/handler.ts`: si hay validación de acento, actualizar la lista permitida
3. Verificar que el dropdown de consola (`src/modules/console/templates-section-agent.ts`) ya esté correcto

---

## FIX-2: Restaurar fallbacks para funciones que esperan JSON (BUG-3 parcial)

**Archivos afectados:** Solo los que parsean la respuesta como JSON y fallarían con system prompt vacío:
- `src/engine/proactive/commitment-detector.ts` — espera JSON `{commitments: [...]}`
- `src/engine/subagent/verifier.ts` — espera `ACCEPT`/`RETRY`/`FAIL`
- `src/engine/proactive/jobs/nightly-batch.ts` — espera JSON `{score, reason, recommend_reactivation}`

**Acción:** Agregar un guard con `logger.warn` y early return cuando el system prompt está vacío, en vez de enviar al LLM sin instrucciones. NO restaurar inline prompts — solo prevenir la llamada LLM sin sentido.

Patrón:
```typescript
const system = promptsSvc ? await promptsSvc.getSystemPrompt('X') : ''
if (!system) {
  logger.warn({ template: 'X' }, 'System prompt missing — skipping LLM call')
  return DEFAULT_SAFE_VALUE
}
```

---

## FIX-3: Agregar log warning en nightly-batch early return (BUG-4)

**Archivo:** `src/engine/proactive/jobs/nightly-batch.ts`

**Problema:** Si `cold-lead-scoring.md` falta, el batch entero se salta silenciosamente.

**Acción:** Agregar `logger.warn` antes del early return cuando `coldLeadUserContent` es vacío.

---

## FIX-4: Alinear criticizer.md con código — eliminar "BLOQUEAR" (BUG-5)

**Archivo:** `instance/prompts/defaults/criticizer.md`

**Problema:** El prompt usa semántica "BLOQUEAR/APROBAR" pero el código solo busca "APPROVED" en `post-processor.ts`.

**Acción:** Reemplazar "BLOQUEAR si" / "APROBAR si" por la semántica que el código espera:
- Si pasa → responde exactamente: `APPROVED`
- Si no pasa → responde con feedback correctivo (máx 3 puntos)

Mantener los criterios de decisión pero cambiar los verbos.

---

## FIX-5: Restaurar instrucción de idioma (BUG-6)

**Problema:** "Responder en el idioma del contacto" fue eliminada de `job.md` y de `agentic-system.md`.

**Acción:** Verificar si esta instrucción existe en algún otro prompt del pipeline (`identity.md`, `guardrails.md`, `relationship-*.md`, `channel-format`). Si no existe en ninguno, agregarla en `agentic-system.md` en la sección "Composición de Salida Final".

---

## FIX-6: Corregir imports dinámicos en manifest.ts (DEUDA-1)

**Archivo:** `src/modules/prompts/manifest.ts`

**Problema:** `generateAccentPrompt()` usa `await import('node:fs/promises')` y `await import('node:path')` dinámicamente, causando 3 errores TS.

**Acción:** Mover los imports a la parte superior del archivo como imports estáticos:
```typescript
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
```

---

## FIX-7: Desduplicar criticizer-base.md vs criticizer.md (REDUND-1)

**Archivos:** `instance/prompts/system/criticizer-base.md`, `instance/prompts/defaults/criticizer.md`

**Problema:** Ambos cubren los mismos criterios (precisión factual, seguridad, coherencia). Se concatenan en `<quality_checklist>`, duplicando instrucciones.

**Acción:** Separar responsabilidades:
- `criticizer-base.md` (sistema, no editable): Solo el checklist rápido de auto-corrección (lo que ya tiene — preguntas mentales antes de enviar). NO incluir formato APPROVED/feedback (eso es para el reviewer externo).
- `criticizer.md` (editable): Prompt completo del reviewer externo con criterios, red flags, ejemplos, y formato APPROVED/feedback.

Revisar que `criticizer-base.md` actual ya no tenga APPROVED/feedback (fue removido en la optimización Gemini — verificar).

---

## Orden de ejecución

Todos los fixes son independientes y pueden ejecutarse en paralelo.

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Verificar que no se introduzcan nuevos errores TS.
