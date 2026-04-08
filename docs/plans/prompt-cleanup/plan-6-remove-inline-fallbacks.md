# Plan 6: Eliminar todos los fallback inline de prompts

## Objetivo
Eliminar TODOS los strings de fallback inline que duplican contenido de archivos `.md`. El sistema de prompts ya carga los `.md` al boot y los cachea en memoria. Si el servicio no está disponible, el agente tiene problemas más graves. Los fallbacks inline son código muerto que se desincroniza y confunde.

## Regla general del cambio
- Si el `.md` existe → eliminar el fallback, confiar en el `.md`
- Si el `.md` NO existe → crearlo con el contenido del fallback, luego eliminar el fallback
- El patrón resultante debe ser: `const system = await svc.getSystemPrompt('nombre')` sin `|| fallback`

## Caso especial: cold-lead-scoring
El `.md` fue eliminado en Plan 1, pero el código en `nightly-batch.ts` aún lo referencia con fallback inline. Crear el `.md` con template variables y eliminar el fallback.

---

## Archivo 1: `src/engine/agentic/post-processor.ts`

### Cambio A: Criticizer review (línea ~361)
El fallback aquí es diferente: carga del **DB slot** `criticizer` (no de .md). Si el DB slot está vacío, usa el inline. Pero el slot se seedea desde `instance/prompts/defaults/criticizer.md` al boot, así que siempre existe.

**Antes** (líneas ~357-370):
```typescript
const criticizerPrompt = promptsService
  ? await promptsService.getPrompt('criticizer').catch(() => null)
  : null

const system = criticizerPrompt || `You are a quality reviewer...`
```

**Después:**
```typescript
const system = promptsService
  ? await promptsService.getPrompt('criticizer').catch(() => '')
  : ''
```

Si `system` queda vacío, el criticizer no se ejecuta — que es el comportamiento correcto si no hay prompt configurado.

### Cambio B: Criticizer rewrite (línea ~425-434)
`.md` ya existe: `instance/prompts/system/criticizer-rewrite.md`

**Antes:**
```typescript
const svc = registry.getOptional<...>('prompts:service')
const loaded = svc ? await svc.getSystemPrompt('criticizer-rewrite').catch(() => null) : null
const system = loaded || `You are a response editor...`
```

**Después:**
```typescript
const svc = registry.getOptional<...>('prompts:service')
const system = svc ? await svc.getSystemPrompt('criticizer-rewrite') : ''
```

---

## Archivo 2: `src/engine/prompts/agentic.ts`

### Voice TTS fallback (línea ~134-136)
`.md` ya existe: `instance/prompts/system/voice-tts-format.md`

**Antes:**
```typescript
const voiceSection = svc
  ? await svc.getSystemPrompt('voice-tts-format').catch(() => null)
  : null
const voiceFallback = 'Tu respuesta será convertida a nota de voz...'
...
let voiceContent = voiceSection || voiceFallback
```

**Después:**
```typescript
const voiceSection = svc ? await svc.getSystemPrompt('voice-tts-format') : ''
...
let voiceContent = voiceSection
```

Eliminar la constante `voiceFallback`.

---

## Archivo 3: `src/modules/hitl/notifier.ts`

### HITL expire message (línea ~136-145)
`.md` ya existe: `instance/prompts/system/hitl-expire-message.md`

**Antes:**
```typescript
const promptsSvc = registry.getOptional<...>('prompts:service')
const hitlSystem = promptsSvc
  ? await promptsSvc.getSystemPrompt('hitl-expire-message').catch(() => null)
  : null
...
system: hitlSystem || `You are a helpful customer service agent...`,
```

**Después:**
```typescript
const promptsSvc = registry.getOptional<...>('prompts:service')
const hitlSystem = promptsSvc
  ? await promptsSvc.getSystemPrompt('hitl-expire-message')
  : ''
...
system: hitlSystem,
```

---

## Archivo 4: `src/engine/prompts/subagent.ts`

### Dos constantes fallback (líneas ~16-20)
`.md` ya existen: `subagent-system.md` y `spawn-instructions.md`

**Eliminar** las constantes:
```typescript
const SUBAGENT_SYSTEM_FALLBACK = `Eres un agente de ejecución...`
const SPAWN_INSTRUCTIONS_FALLBACK = `\nIMPORTANTE: Solo usa spawn_subagent...`
```

Buscar dónde se usan (probablemente como `|| SUBAGENT_SYSTEM_FALLBACK`) y reemplazar con carga directa sin fallback.

---

## Archivo 5: `src/engine/ack/ack-service.ts`

### ACK system fallback (línea ~36-40)
`.md` ya existe: `ack-system.md`

Eliminar el fallback inline: `system = 'Genera un aviso breve...'`

---

## Archivo 6: `src/engine/proactive/commitment-detector.ts`

### Commitment detector fallback (línea ~16)
`.md` ya existe: `commitment-detector-system.md`

**Eliminar** `DETECTOR_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 7: `src/engine/subagent/verifier.ts`

### Subagent verifier fallback (línea ~18)
`.md` ya existe: `subagent-verifier.md`

**Eliminar** `VERIFIER_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 8: `src/engine/buffer-compressor.ts`

### Buffer compressor fallback (línea ~16)
`.md` ya existe: `buffer-compressor.md`

**Eliminar** `BUFFER_COMPRESS_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 9: `src/modules/memory/session-archiver.ts`

### Session summary fallback (línea ~18)
`.md` ya existe: `session-summary.md`

**Eliminar** `SESSION_SUMMARY_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 10: `src/extractors/pdf.ts`

### PDF OCR fallback (línea ~24)
`.md` ya existe: `pdf-ocr.md`

**Eliminar** `PDF_OCR_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 11: `src/modules/cortex/pulse/analyzer.ts`

### Cortex pulse fallback (línea ~18)
`.md` ya existe: `cortex-pulse-analyzer.md`

**Eliminar** `SYSTEM_PROMPT_FALLBACK` y usar carga directa.

---

## Archivo 12: `src/modules/cortex/trace/analyst.ts`

### Cortex trace analyst fallback (línea ~61)
`.md` ya existe: `cortex-trace-analyst.md`

**Eliminar** `ANALYST_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 13: `src/modules/cortex/trace/synthesizer.ts`

### Cortex trace synthesizer fallback (línea ~66)
`.md` ya existe: `cortex-trace-synthesizer.md`

**Eliminar** `SYNTHESIZER_SYSTEM_FALLBACK` y usar carga directa.

---

## Archivo 14: `src/modules/knowledge/description-generator.ts`

### Knowledge description fallback (línea ~134)
`.md` ya existe: `knowledge-description.md`

**Eliminar** el fallback inline: `'Eres un bibliotecario experto...'` y usar carga desde `.md`.

---

## Archivo 15: `src/modules/twilio-voice/voice-engine.ts`

### Voice system instruction fallback (línea ~243)
`.md` ya existe: `voice-system-instruction.md`

Eliminar el fallback inline que se genera si `.md` no carga.

---

## Archivo 16: `src/engine/proactive/jobs/nightly-batch.ts`

### Cold lead scoring (líneas ~162-181)
El `.md` fue eliminado en Plan 1, pero el código aún lo referencia. **Crear el `.md` con template variables** y eliminar el fallback.

**Crear:** `instance/prompts/system/cold-lead-scoring.md`
```markdown
Lead: {{displayName}}
Datos de calificación:
{{qualificationData}}

Historial de conversaciones:
{{historyStr}}

Evalúa este lead frío. Responde SOLO con JSON:
{ "score": 0-100, "reason": "breve explicación", "recommend_reactivation": true/false }
```

**Después** en nightly-batch.ts (eliminar todo el bloque if/else fallback):
```typescript
const promptsSvc = ctx.registry.getOptional<PromptsService>('prompts:service')
const coldLeadUserContent = promptsSvc
  ? await promptsSvc.getSystemPrompt('cold-lead-scoring', {
      displayName,
      qualificationData: dataStr,
      historyStr,
    })
  : ''
if (!coldLeadUserContent) return  // skip if no prompt available
```

También hay un system prompt inline en línea 185: `'Eres un analista de leads. Evalúa si un lead frío vale la pena reactivar.'`. Este NO tiene `.md`. **Crear:** `instance/prompts/system/nightly-scoring-system.md` con ese contenido, y cargarlo igual.

---

## Archivo 17: `src/engine/prompts/channel-format.ts`

### DEFAULT_CHANNEL_LIMITS (líneas 9-12)
Hardcoded defaults de 1 línea por canal. Con `buildFormatFromForm()` siempre retornando un valor (nunca null — siempre construye algo con defaults internos), estos nunca se alcanzan en práctica.

**Eliminar** el objeto `DEFAULT_CHANNEL_LIMITS`. Cambiar `getChannelLimit()` para retornar string vacío si todo falla:

**Antes:**
```typescript
return DEFAULT_CHANNEL_LIMITS[channel] ?? DEFAULT_CHANNEL_LIMITS.whatsapp ?? ''
```

**Después:**
```typescript
return ''
```

---

## Resumen

| Archivo | Cambio | .md necesario |
|---------|--------|---------------|
| post-processor.ts | Eliminar 2 fallbacks | Ya existen |
| agentic.ts | Eliminar voiceFallback | Ya existe |
| notifier.ts | Eliminar hitlSystem fallback | Ya existe |
| subagent.ts | Eliminar 2 constantes *_FALLBACK | Ya existen |
| ack-service.ts | Eliminar fallback | Ya existe |
| commitment-detector.ts | Eliminar DETECTOR_SYSTEM_FALLBACK | Ya existe |
| verifier.ts | Eliminar VERIFIER_SYSTEM_FALLBACK | Ya existe |
| buffer-compressor.ts | Eliminar BUFFER_COMPRESS_SYSTEM_FALLBACK | Ya existe |
| session-archiver.ts | Eliminar SESSION_SUMMARY_SYSTEM_FALLBACK | Ya existe |
| pdf.ts | Eliminar PDF_OCR_SYSTEM_FALLBACK | Ya existe |
| cortex/pulse/analyzer.ts | Eliminar SYSTEM_PROMPT_FALLBACK | Ya existe |
| cortex/trace/analyst.ts | Eliminar ANALYST_SYSTEM_FALLBACK | Ya existe |
| cortex/trace/synthesizer.ts | Eliminar SYNTHESIZER_SYSTEM_FALLBACK | Ya existe |
| description-generator.ts | Eliminar fallback | Ya existe |
| voice-engine.ts | Eliminar fallback | Ya existe |
| nightly-batch.ts | Eliminar fallback, crear .md | **Crear** cold-lead-scoring.md + nightly-scoring-system.md |
| channel-format.ts | Eliminar DEFAULT_CHANNEL_LIMITS | N/A |

**Total: 17 archivos TS, 2 archivos .md nuevos.**

## Verificación
```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Buscar que no queden `_FALLBACK` constants referenciando prompts LLM:
```bash
grep -rn "_FALLBACK\||| \`" src/engine/ src/modules/ --include="*.ts" | grep -i "prompt\|system\|eres\|you are"
```

## Riesgo
Bajo. Si `prompts:service` no está disponible, los prompts quedan vacíos y el LLM responde sin instrucciones específicas — que es mejor que dar instrucciones desincronizadas de un fallback que nadie mantiene.
