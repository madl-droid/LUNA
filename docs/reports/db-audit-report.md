# INFORME DE CIERRE — Auditoría de Base de Datos
## Branch: claude/audit-database-cleanup-OA4WN

### Objetivos definidos
Auditoría completa de la base de datos: identificar tablas/columnas sin uso, duplicados, queries ineficientes, índices faltantes, y oportunidades de mejora.

### Completado ✅
**Bloque A — Cambios seguros ejecutados:**
1. **Migración SQL de limpieza** (`docs/migrations/s-db-cleanup.sql`):
   - DROP `system_state` (tabla sin uso en código)
   - DROP `user_lists_backup` (remanente de migración completada)
   - 5 índices nuevos para queries frecuentes
2. **Fix N+1 en campaign tags** — `listCampaigns()` pasó de 1+N queries a 1 query con `json_agg`
3. **Fix N+1 en commitment scanner** — eliminado re-fetch individual de `getPendingCommitments()` por cada commitment
4. **Optimización `listLeads()`** — subqueries correlacionadas reemplazadas por LEFT JOIN con sesiones pre-agregadas
5. **Consolidación `getLeadDetail()`** — de 5 queries secuenciales a 3 queries paralelos (`Promise.all`)

### No completado ❌
**Bloque B — Documentado como deuda técnica futura:**
1. **Doble fuente de verdad `contacts.qualification_*` vs `agent_contacts`** — lead-scoring escribe a contacts, memory module escribe a agent_contacts. Requiere migración coordinada.
2. **Dual-write en messages** — columnas viejas (`sender_type`, `sender_id`, `content` JSONB) aún escritas junto a nuevas (`role`, `content_text`). Código de fallback lee las viejas.
3. **`contact_channels` columnas viejas** — `channel_name`/`channel_contact_id` siguen en uso (incluido UNIQUE constraint). Nuevas `channel_type`/`channel_identifier` no adoptadas.
4. **`sessions.compressed_summary`** — aún usada activamente en evaluator prompt y follow-up prompts. No se puede eliminar sin reemplazar por `session_summaries`.
5. **Phase 3 migration** — no ejecutable hasta completar B1-B4.

### Archivos creados/modificados
| Archivo | Cambio |
|---------|--------|
| `docs/migrations/s-db-cleanup.sql` | **NUEVO** — migración: DROP tablas, CREATE INDEX |
| `src/modules/lead-scoring/campaign-queries.ts` | Fix N+1: tags con json_agg inline |
| `src/engine/proactive/jobs/commitment-check.ts` | Fix N+1: commitment data desde row |
| `src/modules/lead-scoring/pg-queries.ts` | Optimizar listLeads + consolidar getLeadDetail |

### Interfaces expuestas (exports que otros consumen)
Ninguna nueva. Los cambios son internos a los módulos existentes.

### Dependencias instaladas
Ninguna.

### Tests (qué tests, si pasan)
- `npx tsc --noEmit` — 0 errores de compilación
- No hay test suite automatizada en el proyecto

### Decisiones técnicas
1. **Bloque A vs B**: Se separó en cambios seguros (optimizaciones de query) vs cambios invasivos (migración de columnas). Solo Bloque A se ejecutó.
2. **commitment-check**: Se construye el objeto `Commitment` directamente desde los campos del query SQL en lugar de hacer un round-trip completo por `getPendingCommitments`. Los campos no presentes en el query (sessionId, scheduledAt, etc.) se dejan como defaults — el evaluator solo usa commitmentType, description, priority, dueAt, requiresTool, attemptCount.
3. **getLeadDetail Promise.all**: Las 3 queries son independientes (solo dependen de contactId) así que se ejecutan en paralelo.

### Riesgos o deuda técnica
1. **Doble fuente de verdad** (B1) es el riesgo principal: `contacts.qualification_*` y `agent_contacts.qualification_*` pueden divergir.
2. **Phase 3 migration** sigue bloqueada hasta que el código migre a columnas nuevas.
3. **`getCampaignStats()`** usa `NOT IN (SELECT DISTINCT contact_id FROM contact_campaigns)` que puede ser lento con muchos registros — candidato a optimización futura con LEFT JOIN.

### Notas para integración
- La migración `s-db-cleanup.sql` debe ejecutarse manualmente en cada entorno (staging, producción).
- Los cambios de código son backward-compatible — funcionan con o sin la migración SQL aplicada.
- Los índices se crean con `IF NOT EXISTS` — seguro ejecutar múltiples veces.
