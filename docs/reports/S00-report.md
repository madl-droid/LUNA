# INFORME DE CIERRE — Sesión S00: remove-agentid-single-agent
## Branch: codex/remove-agentid-single-agent

### Objetivos definidos
- Ejecutar la migración para normalizar `agent_id` al agente único `luna`.
- Remover `agentId` y `agentSlug` de tipos, firmas, queries y claves Redis donde LUNA ya opera como single-agent.
- Mantener integridad de datos existentes sin borrar columnas.
- Verificar compilación y auditar el código tocado antes de cerrar.

### Completado ✅
- Se agregó la migración [`src/migrations/030_remove-agent-id.sql`](C:\Users\miged\Git\LUNA\src\migrations\030_remove-agent-id.sql) con normalización, deduplicación, defaults, `UNIQUE(contact_id)` y backfill seguro.
- Se removió `agentId` del pipeline principal (`engine`, `memory`, `proactive`, `cortex`) y de sus tipos asociados.
- Se simplificó `memory` para operar por `contactId` y se limpiaron claves Redis y queries PostgreSQL dependientes de `agent_id`.
- Se eliminaron restos de multi-agent plumbing en `lead-scoring`, `marketing-data`, `hitl`, `medilink`, `twilio-voice` y tipos/hook payloads compartidos.
- Se actualizaron docs puntuales de Medilink y voz para reflejar el modelo single-agent.
- Se hizo auditoría con `npm exec tsc -- --noEmit`, búsqueda dirigida de restos de `agentId/agentSlug` y `git diff --check`.

### No completado ❌
- No se ejecutó una suite funcional/e2e completa; en esta sesión solo quedó validado por compilación estática y auditoría de diffs.
- No se eliminan columnas `agent_id` históricas de la base; se dejan con defaults para compatibilidad, como estaba planeado.

### Archivos creados/modificados
- `src/migrations/030_remove-agent-id.sql`
- `src/engine/config.ts`
- `src/engine/engine.ts`
- `src/engine/types.ts`
- `src/engine/phases/phase1-intake.ts`
- `src/engine/phases/phase5-validate.ts`
- `src/engine/proactive/commitment-detector.ts`
- `src/engine/proactive/commitment-validator.ts`
- `src/engine/proactive/jobs/commitment-check.ts`
- `src/engine/proactive/jobs/follow-up.ts`
- `src/engine/proactive/jobs/nightly-batch.ts`
- `src/engine/proactive/jobs/reactivation.ts`
- `src/engine/proactive/proactive-pipeline.ts`
- `src/engine/proactive/tools/create-commitment.ts`
- `src/engine/prompts/context-builder.ts`
- `src/engine/subagent/subagent.ts`
- `src/engine/agentic/agentic-loop.ts`
- `src/kernel/types.ts`
- `src/modules/cortex/trace/context-builder.ts`
- `src/modules/cortex/trace/simulator.ts`
- `src/modules/cortex/trace/tool-sandbox.ts`
- `src/modules/hitl/ticket-store.ts`
- `src/modules/hitl/tool.ts`
- `src/modules/hitl/types.ts`
- `src/modules/lead-scoring/extract-tool.ts`
- `src/modules/lead-scoring/pg-queries.ts`
- `src/modules/marketing-data/campaign-queries.ts`
- `src/modules/memory/compression-worker.ts`
- `src/modules/memory/memory-manager.ts`
- `src/modules/memory/pg-store.ts`
- `src/modules/memory/redis-buffer.ts`
- `src/modules/memory/types.ts`
- `src/modules/medilink/CLAUDE.md`
- `src/modules/medilink/follow-up-scheduler.ts`
- `src/modules/medilink/manifest.ts`
- `src/modules/medilink/pg-store.ts`
- `src/modules/medilink/security.ts`
- `src/modules/medilink/tools.ts`
- `src/modules/medilink/types.ts`
- `src/modules/medilink/working-memory.ts`
- `src/modules/tools/types.ts`
- `src/modules/twilio-voice/call-manager.ts`
- `src/modules/twilio-voice/pg-store.ts`
- `src/modules/twilio-voice/types.ts`
- `src/modules/twilio-voice/voice-engine.ts`
- `docs/architecture/voice-channel-guide.md`

### Interfaces expuestas (exports que otros consumen)
- `ContextBundle`, `SessionInfo`, `EngineConfig` ya no exponen `agentId`/`agentSlug`.
- `StoredMessage`, `SessionMeta`, `SessionSummary`, `AgentContact`, `Commitment`, `ConversationArchive`, `PipelineLogEntry` ya no exponen `agentId`.
- Hook payloads `contact:status_changed`, `call:*` y `ToolExecutionContext` quedan sin `agentId`.
- `memory:manager`, `medilink:auto_link`, `medilink:get_context_line`, `WorkingMemory`, `SecurityService`, `LeadQueries` y utilidades de voz ahora operan por `contactId`.

### Dependencias instaladas
- `npm ci` para materializar dependencias del workspace y poder validar TypeScript localmente.

### Tests (qué tests, si pasan)
- `npm exec tsc -- --noEmit` ✅
- `git diff --check origin/pruebas...HEAD` ✅
- Auditoría dirigida por búsqueda de restos de `agentId`, `agentSlug`, `loadAgentId`, `resolveAgentId` y filtros SQL legacy en archivos tocados ✅

### Decisiones técnicas
- Se mantuvieron columnas `agent_id` en tablas existentes y se delegó el llenado al `DEFAULT` de base de datos para minimizar riesgo operativo.
- Las consultas de dominio se simplificaron a `contact_id` como llave funcional única para LUNA.
- Las claves Redis legacy no se migran: expiran por TTL y las nuevas usan solo `contactId`.
- En Medilink y Twilio Voice se removió el `agentId` operativo sin tocar de forma destructiva el esquema histórico.

### Riesgos o deuda técnica
- `voice_calls.agent_id` y tablas Medilink/HITL todavía conservan columnas legacy no usadas por la aplicación; eliminarlas requerirá una migración posterior si se quiere limpieza total.
- La validación fue estática; conviene hacer una ronda funcional en staging con flujos de intake, follow-ups, Medilink y llamadas.
- Hay migraciones históricas y documentación histórica que aún mencionan `agent_id`; no se tocaron para no reescribir historial.

### Notas para integración
- La rama se construyó encima de `pruebas` actualizada y en commits separados para facilitar revisión:
- `01295d8 feat: add single-agent normalization migration`
- `6e49d57 refactor: remove agent identity from engine and memory`
- `25f16aa refactor: remove single-agent plumbing from remaining modules`
- Tras aplicar la migración, validar en staging creación de contactos nuevos, follow-ups Medilink y persistencia de llamadas para confirmar que los defaults de DB están corriendo como se espera.
