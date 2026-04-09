# DB Optimization — Overview

**Sesion:** db-optimization
**Objetivo:** Consolidar ~51 migraciones SQL + ~52 tablas de modulos en UNA sola migracion canonica para beta. Eliminar tablas muertas, corregir tipos, agregar constraints faltantes, y consolidar el sistema de memoria v1/v2.
**Branch base:** `claude/plan-db-optimization-zVAc6`

---

## Contexto

El schema actual tiene:
- **51 archivos de migracion** en `src/migrations/` con 4 pares de numeros duplicados (014, 015, 025, 048)
- **~52 tablas** creadas por modulos en `init()` fuera de migraciones
- **Tablas muertas**: `agents`, `task_checkpoints`, `session_summaries` (v1), `conversation_archives` (v1), `summary_chunks` (absorbida)
- **Dual-write** activo en el sistema de memoria (v1 + v2 simultaneo)
- **Tipos incorrectos**: 7+ columnas TEXT/VARCHAR donde deberia ser UUID
- **FK faltantes**: 5+ relaciones sin constraint de integridad
- **CHECK constraints faltantes**: 12+ columnas de estado/tipo sin validacion

## Decisiones tomadas

| Decision | Resultado |
|----------|-----------|
| `companies` table | **MANTENER** — se implementara B2B grouping post-beta |
| Session tables | **Solo v2** — `session_summaries_v2`, `session_archives`, `session_memory_chunks` |
| `agents` table | **DROP** — vestigial, config vive en `config_store` |
| `task_checkpoints` | **DROP** — feature cancelada |
| `llm_daily_stats` | **MANTENER** — pre-agregacion para dashboards livianos |
| `campaigns` ownership | **Modulo** (marketing-data) es canonico, pero va en el squash |
| Scope del squash | **TODAS las tablas** — migraciones + modulos en un solo SQL |
| Module `init()` CREATE TABLE | **ELIMINAR** — una sola fuente de verdad en la migracion |
| `summary_chunks` + `session_memory_chunks` | **CONSOLIDAR** en `session_memory_chunks` con `source_type` discriminador |
| `knowledge_chunks` | **SEPARADA** — lifecycle permanente, document-scoped, sin contact_id |
| Deploy | **Fresh** — no hay datos que preservar, squash destructivo OK |

---

## Planes de ejecucion

### Plan 1: Canonical Schema Blueprint
**Tipo:** Investigacion + documentacion
**Dependencias:** Ninguna
**Descripcion:** Producir el documento de referencia con CADA tabla, columna, tipo, constraint, indice y FK del schema final beta. Este documento es la "constitucion" que todos los demas planes implementan. El ejecutor debe leer TODOS los archivos fuente (migraciones + modulos) y producir el schema target definitivo.

### Plan 2: v1→v2 Memory Consolidation
**Tipo:** Refactor de codigo (TypeScript)
**Dependencias:** Plan 1 (necesita el schema target)
**Descripcion:** Eliminar el dual-write v1/v2. Modificar el memory module para que compression, search, merge y archiving usen SOLO tablas v2. Absorber `summary_chunks` dentro de `session_memory_chunks`. Las tablas v1 (`session_summaries`, `conversation_archives`, `summary_chunks`) quedan sin codigo que las referencie.

**Archivos principales:**
- `src/modules/memory/pg-store.ts` — queries SQL
- `src/modules/memory/memory-manager.ts` — compression + search
- `src/engine/proactive/jobs/nightly-batch.ts` — embedding + merge
- `src/engine/boundaries/intake.ts` — hybrid search call

### Plan 3: Migration Squash
**Tipo:** SQL + infraestructura
**Dependencias:** Plan 1 (schema target), Plan 2 (v1 tables ya no tienen codigo)
**Descripcion:** Eliminar los 51 archivos de migracion. Escribir un unico `001_beta-schema.sql` que cree TODAS las tablas (~80+), indices, constraints, FKs, triggers, y seeds. Incluye extension pgvector, funciones de trigger (updated_at, FTS), y datos iniciales.

### Plan 4: Module Init Cleanup
**Tipo:** Refactor de codigo (TypeScript)
**Dependencias:** Plan 3 (la migracion ya crea todas las tablas)
**Descripcion:** Eliminar TODOS los `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, y `ALTER TABLE ADD COLUMN` de los modulos. Los archivos `pg-store.ts`, `manifest.ts`, y `db.ts` de cada modulo solo conservan funciones de query. Actualizar imports y tipos si columnas cambiaron de nombre/tipo.

**Modulos afectados (~19):**
- `src/kernel/db.ts`
- `src/kernel/setup/handler.ts`
- `src/modules/users/db.ts`
- `src/modules/whatsapp/pg-auth-state.ts`
- `src/modules/gmail/manifest.ts`
- `src/modules/google-apps/manifest.ts`
- `src/modules/google-chat/manifest.ts`
- `src/modules/prompts/pg-queries.ts`
- `src/modules/scheduled-tasks/store.ts`
- `src/modules/llm/pg-store.ts`
- `src/modules/tools/pg-store.ts`
- `src/modules/twilio-voice/pg-store.ts`
- `src/modules/cortex/pulse/store.ts`
- `src/modules/marketing-data/campaign-queries.ts`
- `src/modules/engine/manifest.ts`
- `src/modules/knowledge/pg-store.ts`
- `src/modules/medilink/pg-store.ts`
- `src/modules/users/webhook-handler.ts`

### Plan 5: Diagnostic Verification
**Tipo:** Verificacion + testing
**Dependencias:** Planes 2, 3, 4 (todo completado)
**Descripcion:** Verificar que TODO el codigo SQL en el proyecto referencia columnas, tablas y tipos que existen en el schema final. Compilar TypeScript. Verificar que un bootstrap fresh (migracion + init de modulos) no falla. Producir reporte de discrepancias.

---

## Estrategia de ejecucion

```
Plan 1 (schema blueprint)
    |
    v
Plan 2 (v1->v2 code)  ──┐
                         ├── PARALELO
Plan 3 (SQL squash)    ──┘
    |
    v
Plan 4 (module cleanup)
    |
    v
Plan 5 (verification)
```

**Secuencial obligatorio:**
- Plan 1 PRIMERO (es la referencia para todo)
- Plan 4 DESPUES de 2+3 (necesita que ambos esten completos)
- Plan 5 ULTIMO (verifica el resultado final)

**Paralelo:**
- Plan 2 y Plan 3 pueden ejecutarse simultaneamente ya que tocan areas diferentes:
  - Plan 2: codigo TypeScript del memory module
  - Plan 3: archivos SQL de migracion
  - No hay solapamiento de archivos

---

## Tablas a ELIMINAR (DROP)

| Tabla | Razon |
|-------|-------|
| `agents` | Vestigial — single agent, config en config_store |
| `task_checkpoints` | Feature cancelada, nunca integrada |
| `session_summaries` (v1) | Reemplazada por session_summaries_v2 |
| `conversation_archives` (v1) | Reemplazada por session_archives (v2) |
| `summary_chunks` | Absorbida en session_memory_chunks |

## Columnas a ELIMINAR

| Tabla.Columna | Razon |
|---------------|-------|
| `contacts.company_id` | Se mantiene (companies table se mantiene) |

## Tipos a CORREGIR

| Tabla.Columna | Actual | Correcto |
|---------------|--------|----------|
| `session_archives.session_id` | TEXT | UUID |
| `session_summaries_v2.session_id` | TEXT | UUID |
| `session_memory_chunks.session_id` | TEXT | UUID |
| `hitl_tickets.requester_contact_id` | VARCHAR | UUID |
| `hitl_tickets.session_id` | VARCHAR | UUID |
| `calendar_follow_ups.contact_id` | TEXT | UUID |

## FKs a AGREGAR

| Columna | Referencia |
|---------|-----------|
| `sessions.campaign_id` | campaigns(id) |
| `session_archives.contact_id` | contacts(id) |
| `session_summaries_v2.contact_id` | contacts(id) |
| `session_memory_chunks.contact_id` | contacts(id) |
| `calendar_follow_ups.contact_id` | contacts(id) |

## Documentacion a actualizar

- `CLAUDE.md` raiz — seccion de migraciones, lista de tablas
- `src/modules/memory/CLAUDE.md` — nuevo schema v2-only
- `src/engine/CLAUDE.md` — referencias a tablas actualizadas
- CLAUDE.md de cada modulo afectado si referencia tablas
