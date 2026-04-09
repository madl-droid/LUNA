# AUDITORÍA: Branch `claude/optimize-base-prompts-YdRBn`

**Fecha:** 2026-04-09
**Auditor:** Claude Opus 4.6
**Scope:** 8 planes ejecutados (7 cleanup + 1 optimización), 62 archivos, ~2200 líneas cambiadas

---

## Resumen Ejecutivo

La rama hace dos cosas: (1) limpiar y centralizar prompts eliminando fallbacks inline de 17 archivos TS, y (2) reescribir el contenido de ~18 prompts con "optimizaciones Gemini". La Fase 1 (cleanup) es trabajo sólido de ingeniería. La Fase 2 (reescritura de contenido) tiene problemas serios de sobre-ingeniería y riesgos funcionales.

**Veredicto general:** La arquitectura mejora, pero la ejecución tiene huecos críticos que deben corregirse antes de merge.

---

## BUGS Y HUECOS CRÍTICOS

### BUG-1: Setup wizard ofrece acentos sin archivo .md (CRÍTICO)

**Archivos:** `src/kernel/setup/handler.ts:101`, `src/kernel/setup/templates.ts:239-245`

El Plan 7 redujo los acentos de ~50 a 5 (`es-MX`, `es-CO`, `es-EC`, `es-PE`, `en-US`), creando archivos `.md` solo para esos 5. Pero el setup wizard sigue ofreciendo `es-CL`, `es-CAR` y `en-CAR` como opciones válidas.

Si un usuario nuevo selecciona `es-CL` en el wizard:
1. `generateAccentPrompt()` intenta leer `instance/prompts/accents/es-CL.md`
2. El archivo no existe → `catch` → accent prompt queda vacío
3. El agente funciona **sin acento** aunque el admin cree que configuró Chile

**Impacto:** Falla silenciosa. El admin piensa que tiene acento chileno configurado pero el agente habla neutro.

**Fix:** Actualizar `src/kernel/setup/handler.ts` y `src/kernel/setup/templates.ts` para que solo listen los 5 acentos que tienen archivo `.md`.

### BUG-2: Migración de acentos existentes (CRÍTICO)

No hay migración para instalaciones existentes que ya tenían `es-CL`, `es-AR`, `es-VE`, `pt-BR`, etc. configurados. Al hacer deploy de esta rama, esos acentos dejan de funcionar silenciosamente porque los `ACCENT_TRAIT_PROMPTS` hardcodeados se eliminaron y los archivos `.md` para esos códigos no existen.

**Impacto:** Cualquier instancia en producción con un acento fuera de los 5 nuevos pierde su acento sin aviso.

**Fix:** Crear archivos `.md` para TODOS los acentos que existían antes, o agregar una migración que mapee los viejos a los nuevos (ej: `es-CL` → `es-MX` o clear).

### BUG-3: Eliminación masiva de fallbacks sin safety net (ALTO)

Plan 6 eliminó TODOS los fallback inline de 17 archivos TS. El patrón antiguo:
```ts
const system = promptsSvc ? await promptsSvc.getSystemPrompt('X') || FALLBACK : FALLBACK
```
Fue reemplazado por:
```ts
const system = promptsSvc ? await promptsSvc.getSystemPrompt('X') : ''
```

Si `prompts:service` no está disponible (módulo no cargado, error de init, etc.), o si el archivo `.md` no existe en disco, estas funciones envían LLM calls con `system: ''`. El LLM client tiene `if (options.system)` que descarta strings vacíos, así que el LLM opera **sin system prompt**.

**Funciones afectadas sin fallback:**
- `ack-service.ts` — genera ACKs sin instrucciones → ACKs de baja calidad o genéricos
- `buffer-compressor.ts` — comprime sesiones sin guía → resúmenes pobres
- `commitment-detector.ts` — detecta compromisos sin formato JSON → parsing failures
- `subagent/verifier.ts` — verifica resultados sin criterios → verificación inútil
- `cortex/pulse/analyzer.ts` — analiza métricas sin instrucciones → análisis vacío
- `cortex/trace/analyst.ts` — evalúa simulaciones sin criterios → evaluaciones inútiles
- `cortex/trace/synthesizer.ts` — sintetiza sin formato → output impredecible
- `pdf.ts` — hace OCR sin instrucciones → extracción degradada
- `session-archiver.ts` — resume sesiones sin guía → resúmenes pobres
- `nightly-batch.ts` — scoring de leads sin sistema → scores sin criterio

**La filosofía de CLAUDE.md dice:**
> "Fallback messages son predefinidos, nunca generados por LLM"

Esto no aplica exactamente a system prompts, pero el principio es el mismo: el sistema debe tener comportamiento predecible incluso cuando falla un componente.

**Fix:** Restaurar fallbacks mínimos para las funciones que requieren output estructurado (JSON): `commitment-detector`, `subagent/verifier`, `cortex/*`. Para las que solo necesitan texto libre (`buffer-compressor`, `session-archiver`), el vacío es aceptable.

### BUG-4: `nightly-batch.ts` — early return sin system prompt puede causar silently skip

```ts
const coldLeadUserContent = promptsSvc
  ? await promptsSvc.getSystemPrompt('cold-lead-scoring', { ... })
  : ''
if (!coldLeadUserContent) return  // ← silently skips ALL cold leads if prompt missing
```

Si `cold-lead-scoring.md` se borra o corrompe, el nightly batch entero se salta sin log.

**Fix:** Agregar un `logger.warn` antes del `return`.

---

## DEUDAS TÉCNICAS

### DEUDA-1: 3 nuevos errores de TS introducidos

`src/modules/prompts/manifest.ts` introduce imports dinámicos de `node:fs/promises`, `node:path` y `process` dentro de `generateAccentPrompt()`. Estos generan errores TS en entornos sin `@types/node` (líneas 481-483). Los errores pre-existentes eran 1258, ahora son 1261.

**Fix:** Usar imports estáticos al top del archivo (ya se usan en otros archivos del módulo).

### DEUDA-2: console/templates-section-agent.ts desincronizado con setup wizard

El dropdown de acentos en la consola (Identity section) fue actualizado a los 5 nuevos acentos, pero el setup wizard (`src/kernel/setup/handler.ts`, `src/kernel/setup/templates.ts`) mantiene los viejos. Hay dos fuentes de verdad para la lista de acentos disponibles.

**Fix:** Crear una constante compartida `SUPPORTED_ACCENTS` que ambos consuman.

### DEUDA-3: `criticizer-review` como task name vs file name — confusión

El task name `'criticizer-review'` en `post-processor.ts:362` y `task-router.ts:82` coincide con el archivo `.md` eliminado `criticizer-review.md`. Aunque el plan 4 documentó que esto es correcto (es un task name, no un file name), genera confusión. Un desarrollador futuro verá `criticizer-review` y buscará el archivo que no existe.

**Severidad:** Baja. Solo confusión, no bug.

---

## COMPLEJIDAD INNECESARIA Y SOBRE-INGENIERÍA

### SOBREENG-1: Prompts reescritos con complejidad narrativa excesiva

Los prompts de Fase 2 fueron "optimizados por Gemini" pero en realidad fueron inflados con jerga de consultoría corporativa. Ejemplos:

**identity.md** — Antes: 11 líneas claras y directas. Después: 21 líneas con términos como "Empatía Analítica", "Autoridad Tranquila", "Efecto Espejo", "Brevedad de Alto Impacto", "Fricción y Objeciones".

El cerebro humano funciona con eficiencia porque tiene instrucciones simples y contextuales, no manuales de MBA. Un LLM procesa tokens — más tokens de instrucción = más costo, más latencia, y MÁS probabilidad de que ignore instrucciones porque se diluyen en el texto.

**El prompt viejo decía:** "Empática y resolutiva: escuchas primero, resuelves después"
**El prompt nuevo dice:** "Empatía Analítica: No te limitas a repetir lo que el contacto dice; interpretas la necesidad real detrás de sus palabras. Validas sus preocupaciones antes de ofrecer una solución, demostrando que has procesado la carga emocional o logística de su consulta."

Son 8x más tokens para decir lo mismo. Y el LLM no va a "demostrar que procesó la carga emocional" mejor por tener esa instrucción — eso depende del modelo, no del prompt.

**Archivos afectados:** `identity.md`, `job.md`, `guardrails.md`, `criticizer.md`, `relationship-lead.md`, `relationship-admin.md`, `relationship-coworker.md`, `relationship-unknown.md`, `agentic-system.md`, `criticizer-base.md`

**Recomendación:** Revertir los prompts defaults a versiones concisas. Los prompts de sistema (security-preamble, criticizer-base, agentic-system) sí se benefician de más detalle porque son non-editable. Los defaults son editables por el admin y deberían ser punto de partida simple.

### SOBREENG-2: Accents .md con perfiles lingüísticos de 3 párrafos

Los 5 archivos de acento nuevos son extremadamente detallados con perfiles fonéticos, léxicos y pragmáticos. Ejemplo `es-MX.md`:
> "Ritmo de compás silábico, velocidad moderada-rápida (160-180 BPM), con una cadencia marcadamente melódica y vivaz..."

Esto es innecesario para un agente de texto. Los perfiles fonéticos solo aplican cuando se usa TTS, y aun así, Gemini TTS no necesita BPM ni descripciones de articulación consonántica para producir un acento natural.

**El prompt viejo decía:** "Habla con acento mexicano neutro... Expresiones: 'orale', 'que onda'..."
**El prompt nuevo tiene:** 3 párrafos densos con terminología lingüística.

**Impacto:** Tokens desperdiciados en cada request. Los perfiles viejos eran más eficientes.

### SOBREENG-3: guardrails.md perdió la sección de OneScreen

La sección "Identidad corporativa — OneScreen" fue eliminada del guardrails default. Esto es correcto en principio (es contenido instance-specific), pero si alguna instancia dependía del default sin haberlo customizado, pierde esa instrucción al hacer deploy.

**Severidad:** Baja si las instancias ya tienen prompts customizados. Alta si alguna nunca editó el default.

---

## REDUNDANCIAS Y DUPLICACIONES

### REDUND-1: Contenido de criticizer.md y criticizer-base.md se solapan

`criticizer-base.md` (no editable, sistema) y `criticizer.md` (editable, admin) ahora cubren criterios similares:
- Ambos hablan de "precisión factual / URLs / precios alucinados"
- Ambos hablan de "seguridad / datos internos"
- Ambos hablan de "coherencia / guardrails"

El LLM recibe ambos concatenados en `<quality_checklist>`. Esto duplica instrucciones y desperdicia tokens.

**Fix:** `criticizer-base.md` debería ser solo las reglas hard (formato APPROVED/feedback + las 2-3 reglas que NUNCA deben cambiar). El detalle de criterios debería vivir solo en `criticizer.md` donde el admin puede editarlo.

### REDUND-2: security-preamble.md expandido innecesariamente

La versión nueva tiene 8 directivas con nombres grandiosos ("ABSOLUTE CONFIDENTIALITY", "INJECTION RESISTANCE", "SOCIAL ENGINEERING DEFENSE"). La versión vieja tenía 6 reglas simples.

Las nuevas reglas agregan:
- "PROMPT INTEGRITY" — buena adición
- "MULTI-TURN PERSISTENCE" — buena adición
- "LINK SAFETY" — buena adición

Pero el formato con `**NOMBRES EN MAYÚSCULA:**` es teatro de seguridad — el LLM no obedece mejor por gritar. Las reglas nuevas son útiles, el formato es innecesario.

---

## COSAS QUE ESTÁN BIEN

1. **Plan 1 (eliminar prompts muertos):** Limpio. 9 archivos no referenciados eliminados correctamente.
2. **Plan 2-3 (extraer a .md):** Correcto. `criticizer-rewrite.md` y `hitl-expire-message.md` extraídos de inline a archivo.
3. **Plan 4 (merge criticizer-review):** Correcto. El formato de respuesta fue absorbido en `criticizer-base.md`.
4. **Plan 5 (voice-tts-format):** Correcto. El `buildVoiceSection()` hardcoded fue reemplazado por lectura de `.md`.
5. **Plan 7 (refactor acentos):** La arquitectura es correcta (de hardcoded Record a archivos .md). Solo falla la ejecución (missing files, setup wizard desincronizado).
6. **channel-format.ts:** La eliminación de los `.md` estáticos es correcta porque el formato se construye dinámicamente desde `config_store` fields. Los `.md` eran fallbacks que ya nadie usaba.
7. **Webhook URL fix:** `templates-section-contacts.ts` corrige `/leads/` → `/users/` en el endpoint de webhook. Bug fix legítimo.

---

## VIOLACIONES DE POLÍTICAS

| Política | Violación | Severidad |
|----------|-----------|-----------|
| "Fallback messages son predefinidos, nunca generados por LLM" | Eliminación de fallbacks sin reemplazo | Media |
| "SIEMPRE compilar TypeScript antes de push" | 3 nuevos errores TS introducidos (imports dinámicos) | Baja (pre-existentes dominan) |
| No se encontraron violaciones de: process.env directo, ORM, Express, imports entre módulos | — | — |

---

## RECOMENDACIONES PRIORIZADAS

### P0 — Antes de merge
1. **Crear archivos .md para acentos faltantes** (`es-CL`, `es-CAR`, `en-CAR` como mínimo) o actualizar setup wizard/handler para solo listar los 5 soportados
2. **Restaurar fallbacks mínimos** para funciones que esperan JSON (`commitment-detector`, `subagent/verifier`)
3. **Agregar log warning** en `nightly-batch.ts` cuando `coldLeadUserContent` es vacío
4. **Fix imports dinámicos** en `manifest.ts` (usar imports estáticos)

### P1 — Mejoras post-merge
5. **Simplificar prompts de Fase 2** — reducir verbosidad de `identity.md`, `job.md`, `guardrails.md` a ~60% del tamaño actual
6. **Desduplicar criticizer** — mover criterios detallados solo a `criticizer.md`, dejar `criticizer-base.md` solo con reglas hard
7. **Crear constante compartida** `SUPPORTED_ACCENTS` para console + setup wizard
8. **Considerar restaurar acentos eliminados** como archivos `.md` (Argentina, Venezuela, Chile, etc.) — son mercados reales

### P2 — Nice to have
9. Simplificar formato de `security-preamble.md` (eliminar MAYÚSCULAS innecesarias, mantener contenido)
10. Reducir perfiles de acento a formato más compacto (eliminar BPM y terminología lingüística innecesaria)
