# INFORME DE CIERRE — Sesión S07: Proactividad Optimizada
## Branch: claude/plan-luna-proactivity-FxrZb

### Objetivos definidos
- Corregir bugs críticos que impedían el funcionamiento del sistema proactivo (proactive.json missing, cron dummy crash, scheduled-tasks loading all tasks as repeatable)
- Eliminar el commitment auto-detector (ahorro de 1 LLM call por respuesta)
- Hacer commitments auto-contenidos con context summaries para fulfillment confiable
- Habilitar HITL handoff donde humanos asumen responsabilidad de compromisos y Luna les da seguimiento
- Agregar follow-up intensity per-contact (aggressive/normal/gentle/minimal)
- Reemplazar cron libre en scheduled-tasks con presets fijos
- Mover KNOWLEDGE_CONTACT_CATEGORY_MAP a consola como campo configurable
- Auditar y corregir bugs post-ejecución
- Cerrar huecos funcionales y deuda técnica identificados en auditoría

### Completado
- Plan 1: Bugfixes críticos — proactive.json bootstrap, cron dummy safe, scheduled-tasks filter non-cron
- Plan 2: Commitments overhaul — eliminar auto-detector, context_summary en creación, HITL handoff con reasignación de compromisos a humanos
- Plan 3: Follow-up intensity — 4 niveles per-contact, tool set_follow_up_intensity, inyección en context-builder
- Plan 4: Cron presets (13 opciones) + KNOWLEDGE_CONTACT_CATEGORY_MAP en consola
- Plan 5: 6 bugfixes de auditoría (migración duplicada, Cortex SQL, bootstrap source=target, notifyAssignedHuman max_attempts, processed counter, CLAUDE.md duplicado)
- Plan 6: HUECO-1 (humanos cierran commitments asignados), HUECO-2 (JSON validation), DEUDA-1+2 (filtro SQL de intensidad), DEUDA-4 (context_note LLM)
- Fix adicional: update_commitment security check permite assigned humans

### No completado
- DEUDA-3: Cron presets sin escape hatch para horarios custom (trade-off aceptado, bajo riesgo)
- COMPLEJ-1: Inline ToolRegistry type repetido en cada tool file (no bloquea, deuda cosmética)

### Archivos creados/modificados

**Creados:**
- `src/engine/proactive/intensity.ts` — 4 niveles de intensidad + resolveIntensity()
- `src/engine/proactive/tools/set-intensity.ts` — tool set_follow_up_intensity
- `src/migrations/048_commitment-context-summary.sql` — context_summary + follow_up_intensity columns
- `src/modules/scheduled-tasks/types.ts` actualizado con CRON_PRESETS, cronPresetToCron(), cronToPresetValue()

**Modificados (principales):**
- `src/engine/proactive/jobs/follow-up.ts` — filtro SQL por intensidad (CASE WHEN), LIMIT 50 post-filter
- `src/engine/proactive/jobs/commitment-check.ts` — notifyAssignedHuman con max_attempts en try, processed counter, ID en mensaje
- `src/engine/proactive/tools/create-commitment.ts` — context_note param + context_summary mejorado
- `src/engine/proactive/tools/update-commitment.ts` — security check permite assigned humans via contact_channels lookup
- `src/engine/boundaries/intake.ts` — carga assigned commitments para non-lead users
- `src/engine/prompts/context-builder.ts` — sección 6 separa contact vs assigned commitments
- `src/engine/boundaries/delivery.ts` — removido detectCommitments() call
- `src/engine/proactive/proactive-pipeline.ts` — historyLimit 10 para commitments
- `src/modules/scheduled-tasks/scheduler.ts` — guard cron-only, jobId separator fix
- `src/modules/scheduled-tasks/api-routes.ts` — cron dummy safe, cron_preset validation
- `src/modules/scheduled-tasks/templates.ts` — dropdown presets con optgroups
- `src/modules/knowledge/manifest.ts` — KNOWLEDGE_CONTACT_CATEGORY_MAP textarea + .refine() JSON
- `src/modules/memory/pg-store.ts` — getAssignedCommitments()
- `src/modules/memory/memory-manager.ts` — passthrough getAssignedCommitments()
- `src/modules/cortex/trace/context-builder.ts` — ac.follow_up_intensity en SELECT
- `src/kernel/bootstrap.ts` — REQUIRED_FILES vaciado
- `src/modules/hitl/resolver.ts` — reassignCommitmentsToHuman() on full_handoff

**Eliminados:**
- `src/engine/proactive/commitment-detector.ts` — auto-detector de compromisos (1 LLM call/response)
- `src/migrations/048_follow-up-intensity.sql` — migración duplicada

### Interfaces expuestas (exports que otros consumen)
- `resolveIntensity()` desde `src/engine/proactive/intensity.ts` — usado por follow-up.ts y context-builder
- `FollowUpIntensity` type desde `src/engine/proactive/intensity.ts`
- `INTENSITY_LEVELS` desde `src/engine/proactive/intensity.ts`
- `getAssignedCommitments()` en MemoryManager — usado por intake.ts
- Tools registrados: `set_follow_up_intensity`, `create_commitment` (param context_note añadido)

### Dependencias instaladas
Ninguna.

### Tests
No hay test suite en el proyecto. Verificación manual: compilación TypeScript sin errores nuevos.

### Decisiones técnicas
1. **No unificar en módulo**: Proactividad se mantiene en engine (no nuevo módulo) — ya está integrada en pipeline, moverla crearía imports circulares.
2. **Eliminar auto-detector**: Ahorro de ~$0.01-0.03/mensaje. Compromisos se crean solo via tool explícito.
3. **Context summary pragmático**: Raw messages (6 últimos, 200 chars c/u) como fallback, context_note del LLM como primario — zero-cost extra.
4. **Intensidad en SQL**: CASE WHEN hardcoded en query evita filtro post-fetch y double resolveIntensity. Trade-off: valores duplicados en SQL e intensity.ts (documentado con SYNC comment).
5. **Security check update_commitment**: Lookup en contact_channels para verificar assigned_to vs caller — seguro y no requiere cambios en tool context interface.
6. **Bootstrap vaciado**: loadProactiveConfig() ya tiene DEFAULT_CONFIG hardcoded — ensureInstanceFiles con source=target es inútil.

### Riesgos o deuda técnica
- Intensity levels hardcodeados en SQL de follow-up.ts deben mantenerse sincronizados con intensity.ts (comentario SYNC agregado)
- Follow-up LIMIT 50 suficiente para <200 leads activos, podría necesitar cursor para instancias grandes
- ToolRegistry type inline repetido en cada tool file (COMPLEJ-1 de auditoría)
- Cron presets sin escape hatch — si un cliente necesita horario no cubierto, hay que agregar preset

### Notas para integración
- Migración 048 crea columnas nuevas: `commitments.context_summary` y `agent_contacts.follow_up_intensity` — auto-aplicada por migrador
- `instance/proactive.json` sigue siendo requerido para habilitar proactividad, pero el sistema arranca sin él (defaults disabled)
- Los canales con `channelType: 'instant'` no necesitan cambios — la intensidad se resuelve per-contact automáticamente
- El scheduled-tasks module ahora rechaza cron expressions fuera del preset list en la API
