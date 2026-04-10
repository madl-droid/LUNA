# DB Optimization — Verification Report

**Fecha:** 2026-04-10
**Ejecutor:** Opus 4.6
**Branch:** `claude/fix-database-issues-VAj36`

## Compilation

- TypeScript: **PASS** (0 errores)
- Errores iniciales encontrados: 3 (variables no usadas en `knowledge/pg-store.ts` y `llm/llm-gateway.ts`)
- Todos corregidos antes de continuar

## DDL Residual

- CREATE TABLE fuera de migrations: **1** (en `kernel/migrator.ts` — infraestructura del migrador, aceptable)
- ALTER TABLE fuera de migrations: **0**
- CREATE INDEX fuera de migrations: **0**

**Resultado: PASS**

## Tablas eliminadas — referencias residuales

| Tabla eliminada | Refs encontradas | Estado post-fix |
|-----------------|-----------------|-----------------|
| `session_summaries` (v1) | 3 en comentarios (memory module) | OK — solo comentarios descriptivos |
| `conversation_archives` | 1 en `server-helpers.ts` MEMORY_TABLES | **CORREGIDO** — eliminada de MEMORY_TABLES |
| `summary_chunks` | 1 en `server-helpers.ts` MEMORY_TABLES | **CORREGIDO** — eliminada de MEMORY_TABLES |
| `task_checkpoints` | 1 en `server-helpers.ts` MEMORY_TABLES | **CORREGIDO** — eliminada de MEMORY_TABLES |
| `agents` (tabla) | 2 INSERT INTO agents + 1 en MEMORY_TABLES | **CORREGIDO** — eliminados INSERTs y ref de MEMORY_TABLES |

**Resultado: PASS (post-fix)**

## Tabla-Schema Alignment

### Tablas en código sin tabla en migración (bugs encontrados y corregidos)

| Tabla | Archivos afectados | Acción |
|-------|-------------------|--------|
| `agents` | `server-helpers.ts` (INSERT INTO, MEMORY_TABLES) | **CORREGIDO** — eliminados INSERTs y ref |
| `user_lists` | `server-helpers.ts` (DELETE, TRUNCATE), `server.ts` (DELETE) | **CORREGIDO** — tabla fantasma eliminada |

### Tablas en migración no referenciadas en código (informacional)

| Tabla | Razón |
|-------|-------|
| `companies` | Reservada para B2B grouping post-beta |
| `llm_daily_stats` | Pre-agregación para dashboards futuros |

### Tablas de sistema (no en migración, correcto)

| Tabla | Razón |
|-------|-------|
| `information_schema` | Catálogo PostgreSQL built-in |
| `schema_migrations` | Creada por `kernel/migrator.ts` en bootstrap |

## FK Consistency

- FKs que apuntan a tablas no creadas: **0**
- Orden de creación: **Correcto** — usa enfoque dos-fases (CREATE TABLE primero, ALTER TABLE ADD CONSTRAINT después)
- Dependencias circulares: **0**
- Total FKs verificadas: **22**

**Resultado: PASS**

## Seeds

| Seed | Estado | Detalles |
|------|--------|---------|
| `ack_messages` | **PASS** | 10 seeds, código espera 5 defaults + fallback in-memory |
| `subagent_types` | **PASS** | 4 slugs: web-researcher, medilink-scheduler, google-calendar-scheduler, comparativo-researcher |
| Campaign default | **PASS** | Seed con ON CONFLICT DO NOTHING |

**Resultado: PASS**

## Migrator.ts

- Ordena por nombre de archivo: **PASS** (`.sort()` lexicográfico)
- Sin refs hardcoded a migraciones específicas: **PASS**
- `schema_migrations` creada antes de ejecutar: **PASS** (CREATE TABLE IF NOT EXISTS)
- INSERT ON CONFLICT DO NOTHING previene re-ejecución: **PASS**
- Transaccional con ROLLBACK en error: **PASS**

**Resultado: PASS**

## Agent_id Residual

- Referencias a `agent_id` en SQL queries: **0**
- La tabla `agent_contacts` sí existe y se usa correctamente (es diferente de `agents`)

**Resultado: PASS**

## Bugs adicionales encontrados y corregidos

### 1. `reseedSystemSubagents()` — refs a migraciones eliminadas

**Archivo:** `src/modules/console/server-helpers.ts`
**Problema:** Leía archivos `018_subagents-v2.sql` y `032_medilink-scheduler-subagent.sql` que ya no existen (eliminados en Plan 3 — migration squash).
**Fix:** Refactorizado para extraer seeds de `001_beta-schema.sql` dinámicamente via regex.

### 2. Import `pgStore` no usado en `llm-gateway.ts`

**Archivo:** `src/modules/llm/llm-gateway.ts`
**Problema:** `import * as pgStore from './pg-store.js'` sin usar (Plan 4 eliminó el DDL del init).
**Fix:** Import eliminado, parámetro `db` renombrado a `_db`.

### 3. Logger `pino` no usado en `knowledge/pg-store.ts`

**Archivo:** `src/modules/knowledge/pg-store.ts`
**Problema:** Variable `logger` declarada pero nunca usada.
**Fix:** Import de `pino` y declaración de `logger` eliminados.

## Column-Schema Alignment (Paso 5)

Verificación exhaustiva de columnas en 10 tablas críticas. Resultado:

| Tabla | Estado | Detalles |
|-------|--------|---------|
| `contacts` | **CORREGIDO** | `status` no existe — eliminado de UPDATE en contact-merge.ts |
| `sessions` | PASS | Todas las columnas coinciden |
| `messages` | **CORREGIDO** | 5 columnas legacy en fallbacks: channel_name, sender_type, sender_id, content, contact_id |
| `session_memory_chunks` | PASS | Todas las columnas coinciden |
| `session_summaries_v2` | PASS | Todas las columnas coinciden |
| `session_archives` | PASS | Todas las columnas coinciden |
| `agent_contacts` | PASS | Todas las columnas coinciden |
| `commitments` | PASS | Todas las columnas coinciden |
| `pipeline_logs` | **CORREGIDO** | INSERT con trace_id, event_type, payload (no existen) → reemplazado con pino log |
| `knowledge_chunks` | PASS | Todas las columnas coinciden |

### Bugs críticos de columnas (corregidos)

#### 4. `contacts.status` — columna inexistente

**Archivo:** `src/modules/memory/contact-merge.ts:108`
**Problema:** `UPDATE contacts SET merged_into = $1, status = 'merged'` — no hay columna `status`.
**Fix:** Eliminado `status = 'merged'`. `merged_into IS NOT NULL` indica contacto mergeado.

#### 5. `messages` — columnas legacy en fallbacks (5 columnas)

**Archivos:** `engine.ts`, `delivery.ts`, `gmail/manifest.ts`, `orphan-recovery.ts`, `conversation-guard.ts`
**Problema:** Fallbacks de SQL directo usan columnas legacy (`channel_name`, `sender_type`, `sender_id`, `content`, `contact_id`) que no existen en el schema. El path principal (memory:manager → pg-store.ts) usa las correctas (`role`, `content_text`).
**Fix:**
- INSERTs actualizados a `role`, `content_text`, `content_type`
- SELECTs actualizados: `sender_type` → `role`, `content` → `content_text`
- Valores: `'agent'` → `'assistant'` (para coincidir con CHECK constraint)
- `UPDATE messages SET contact_id` eliminado (messages no tiene contact_id; sessions ya movida)

#### 6. `pipeline_logs` — INSERT con columnas inexistentes

**Archivo:** `src/engine/boundaries/delivery.ts:206`
**Problema:** `INSERT INTO pipeline_logs (trace_id, event_type, payload)` — ninguna de estas columnas existe.
**Fix:** Reemplazado con `logger.warn()` de pino (structured logging). El INSERT siempre fallaba silenciosamente.

## Documentación actualizada

| Archivo | Cambio |
|---------|--------|
| `CLAUDE.md` (raíz) | Eliminada ref a tabla `agents` en descripción del migrador |
| `src/modules/memory/CLAUDE.md` | Actualizado a v2-only: tablas, nombres, nota de eliminación de v1 |
| `src/engine/proactive/CLAUDE.md` | Corregida trampa: `sender_type` → `role` con valores correctos |

## Compilación Final

```
npx tsc --noEmit → 0 errores
```

## Overall Status: **PASS** (10 issues encontrados y corregidos)
