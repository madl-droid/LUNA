# INFORME DE CIERRE — Auditoría de Base de Datos
## Branch: claude/audit-database-cleanup-OA4WN

### Objetivos definidos
Auditoría completa de la base de datos: identificar tablas/columnas sin uso, duplicados, queries ineficientes, índices faltantes, y oportunidades de mejora.

### Completado ✅

**Bloque A — Optimizaciones de queries:**
1. **Migración SQL de limpieza** (`docs/migrations/s-db-cleanup.sql`):
   - DROP `system_state` (tabla sin uso en código)
   - DROP `user_lists_backup` (remanente de migración completada)
   - 5 índices nuevos para queries frecuentes
2. **Fix N+1 en campaign tags** — `listCampaigns()` pasó de 1+N queries a 1 query con `json_agg`
3. **Fix N+1 en commitment scanner** — eliminado re-fetch individual por cada commitment
4. **Optimización `listLeads()`** — subqueries correlacionadas → LEFT JOIN pre-agregado
5. **Consolidación `getLeadDetail()`** — de 5 queries secuenciales a 3 paralelos (`Promise.all`)

**Bloque B — Migración de columnas deprecadas:**
1. **B2: Messages dual-write eliminado** — `saveMessage()` solo escribe columnas nuevas (`role`, `content_text`, `agent_id`). Fallbacks en phase1 y proactive usan `role`/`content_text`.
2. **B3: contact_channels migrado** — 11 archivos actualizados de `channel_name`/`channel_contact_id` a `channel_type`/`channel_identifier`. ON CONFLICT actualizado.
3. **B4: compressed_summary reemplazado** — Session loading ahora usa LEFT JOIN LATERAL a `session_summaries`. Evaluator y follow-up prompts no cambian.
4. **B5: Migración SQL extendida** — DROP de columnas deprecadas en messages, contact_channels, sessions. Nuevo UNIQUE constraint.

**Bloque B1 — Unificación qualification_* → agent_contacts:**
1. **B1: Fuente única de verdad en `agent_contacts`** — Todo lead-scoring, engine, proactive jobs y voice ahora leen/escriben `agent_contacts.lead_status/qualification_score/qualification_data` en vez de `contacts.qualification_*`. Se agregó `agentId` a `ToolExecutionContext`. `LeadQueries` recibe agentId en constructor. Migración SQL incluye backfill + DROP columnas.

### No completado ❌
Nada pendiente. Toda la auditoría fue ejecutada.

### Archivos creados/modificados
| Archivo | Cambio |
|---------|--------|
| `docs/migrations/s-db-cleanup.sql` | **NUEVO** — DROP tablas, CREATE INDEX, DROP columnas deprecadas |
| `src/modules/lead-scoring/campaign-queries.ts` | Fix N+1: tags con json_agg inline |
| `src/engine/proactive/jobs/commitment-check.ts` | Fix N+1 + migrar a channel_type/channel_identifier |
| `src/modules/lead-scoring/pg-queries.ts` | Optimizar listLeads, consolidar getLeadDetail, migrar columnas |
| `src/modules/memory/pg-store.ts` | Eliminar dual-write, actualizar CREATE TABLE y queries |
| `src/engine/phases/phase1-intake.ts` | Migrar findContact + ensureVoiceChannel + session loading |
| `src/engine/phases/phase3-execute.ts` | Migrar compressed_summary → session_summaries |
| `src/engine/proactive/proactive-pipeline.ts` | Migrar contact lookup + session loading + history fallback |
| `src/engine/proactive/jobs/follow-up.ts` | Migrar a channel_type/channel_identifier |
| `src/engine/proactive/jobs/reactivation.ts` | Migrar a channel_type/channel_identifier |
| `src/engine/proactive/jobs/reminder.ts` | Migrar a channel_type/channel_identifier |
| `src/modules/twilio-voice/voice-engine.ts` | Migrar voice channel lookup + qualification reads |
| `src/modules/tools/types.ts` | Agregar `agentId` a ToolExecutionContext |
| `src/modules/lead-scoring/extract-tool.ts` | Migrar reads/writes a agent_contacts |
| `src/engine/phases/phase5-validate.ts` | Migrar fallback write a agent_contacts |

### Interfaces expuestas (exports que otros consumen)
Ninguna nueva. Los cambios son internos a los módulos existentes. `SessionInfo.compressedSummary` se mantiene como campo pero ahora se llena desde `session_summaries`.

### Dependencias instaladas
Ninguna.

### Tests (qué tests, si pasan)
- `npx tsc --noEmit` — 0 errores de compilación
- No hay test suite automatizada en el proyecto

### Decisiones técnicas
1. **B1 no migrado**: `contacts.qualification_*` sigue siendo la fuente de verdad para lead-scoring. Migrar a `agent_contacts` requiere que lead-scoring tenga un agentId context y que se sincronicen ambas tablas. Demasiado riesgo para esta sesión.
2. **compressed_summary → LATERAL JOIN**: En vez de cambiar el tipo `SessionInfo`, se mantiene el campo `compressedSummary` pero se puebla desde `session_summaries.summary_text` via LEFT JOIN LATERAL. Cero cambios en consumidores (evaluator, follow-up).
3. **Messages dual-write eliminado**: Los campos legacy (`channelName`, `senderType`, `senderId`, `content`) del tipo `StoredMessage` se mantienen en la interfaz TypeScript pero se derivan de las columnas nuevas (`role` → `senderType`, `content_text` → `content.text`).
4. **ON CONFLICT**: La constraint de contact_channels migra de `(channel_name, channel_contact_id)` a `(channel_type, channel_identifier)`. La migración SQL crea la nueva constraint.

### Riesgos o deuda técnica
1. **Migración SQL es destructiva** — `s-db-cleanup.sql` hace DROP COLUMN en 3 tablas. Debe ejecutarse DESPUÉS de deployar el código nuevo.
2. **`getCampaignStats()`** usa `NOT IN (SELECT DISTINCT ...)` — puede ser lento con muchos registros.
3. **Backfill incluido en migración** — Messages y agent_contacts se backfillean automáticamente.

### Notas para integración
1. **Orden de deploy**: Código primero → backfill SQL → migración `s-db-cleanup.sql`
2. Los cambios de código son backward-compatible durante el período de transición (COALESCE y fallbacks)
3. Los índices se crean con `IF NOT EXISTS` — seguro ejecutar múltiples veces
4. La migración usa `IF EXISTS` para todos los DROP — idempotente
