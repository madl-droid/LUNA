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

## Documentación actualizada

| Archivo | Cambio |
|---------|--------|
| `CLAUDE.md` (raíz) | Eliminada ref a tabla `agents` en descripción del migrador |
| `src/modules/memory/CLAUDE.md` | Actualizado a v2-only: tablas, nombres, nota de eliminación de v1 |

## Compilación Final

```
npx tsc --noEmit → 0 errores
```

## Overall Status: **PASS** (7 issues encontrados y corregidos)
