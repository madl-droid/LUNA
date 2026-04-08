# Plan 07b — Cross-Module Fixes (HITL, Users, Medilink, SQL)

**Prioridad:** HIGH
**Módulos:** HITL, Users, Medilink, SQL queries
**Objetivo:** Fixes quirúrgicos en módulos individuales — notificaciones HITL con datos de contacto, user ID seguro, encoding UTF-8, y SQL correcto.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/hitl/notifier.ts` | ~123 | Template de notificación HITL |
| `src/modules/users/webhook-handler.ts` | ~556 | User ID collision, ON CONFLICT |
| `src/modules/medilink/api-client.ts` | ~569 | UTF-8 encoding |
| Varios archivos con SQL errors | — | Column name fixes, type casting |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `notifier.ts:28-38` — que la notificación NO incluye nombre, teléfono ni tipo de contacto
- `webhook-handler.ts:440` — que el User ID usa `crypto.randomBytes(3)` (solo 16M combinaciones)
- `webhook-handler.ts:479` — que ON CONFLICT reasigna el user_id silenciosamente
- `api-client.ts` — buscar dónde puede haber double encoding UTF-8

Para los SQL errors, buscar las queries reportadas:
- `column cc.channel_contact_id does not exist` — debería ser `channel_identifier`
- `operator does not exist: uuid = character varying` — 4 ocurrencias de type mismatch

## Fixes

### FIX-01: HITL notificación con datos de contacto [HIGH]
**Fuente:** LAB BUG-08 del audit report
**Archivo:** `src/modules/hitl/notifier.ts` ~líneas 28-38
**Bug:** Las notificaciones HITL solo contienen Type, Summary y Client message. No incluyen nombre, teléfono ni tipo de contacto. Cuando llegaron 2 tickets similares, el operador los confundió.
**Fix:**
1. Leer el template de notificación (~líneas 28-38)
2. La función debe recibir datos del contacto (o ya los recibe pero no los usa)
3. Agregar al template:
   ```
   *HITL — Coworker Request*
   Contacto: {display_name} ({phone}) [{contact_type}]
   Ticket: #{ticket_id_corto}
   Type: {type}
   Summary: {summary}
   Client message: {message}
   ```
4. Si los datos del contacto no están disponibles en el contexto de la notificación:
   - Buscar cómo se crea el ticket HITL (en `tool.ts` o similar)
   - Agregar `contact_name`, `contact_phone`, `contact_type` al payload del ticket
   - Propagarlos hasta el notifier
5. El `ticket_id_corto` puede ser los últimos 6 chars del UUID o un contador secuencial
6. Verificar que la notificación funciona para TODOS los canales (WhatsApp, Google Chat, etc.)

### FIX-02: User ID con detección de colisión [HIGH]
**Fuente:** Bug #10 del análisis profundo
**Archivo:** `src/modules/users/webhook-handler.ts` ~línea 440
**Bug:** `crypto.randomBytes(3).toString('hex')` genera IDs de 6 hex chars = 16M combinaciones. Con ley del cumpleaños, colisiones probables a ~4K usuarios. Dos usuarios diferentes pueden recibir el mismo ID.
**Fix:**
1. Leer la generación de User ID (~línea 440)
2. Aumentar a 8 bytes (16 hex chars = 4.3 trillones de combinaciones):
   ```typescript
   const userId = `USR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
   ```
3. Agregar detección de colisión: antes de insertar, verificar que el ID no existe
4. Si existe (improbable pero posible): regenerar y reintentar (max 3 intentos)
5. Alternativamente: usar `UNIQUE` constraint en la tabla y manejar el constraint violation con regeneración

### FIX-03: ON CONFLICT no reasignar contacto silenciosamente [HIGH]
**Fuente:** Bug #11 del análisis profundo
**Archivo:** `src/modules/users/webhook-handler.ts` ~línea 479
**Bug:** `ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = $1` — si un contacto ya existe con un user_id diferente, se reasigna silenciosamente al nuevo usuario. Historial perdido.
**Fix:**
1. Leer el contexto completo del INSERT con ON CONFLICT (~línea 479)
2. Cambiar el comportamiento: NO reasignar si ya existe un user_id diferente
   ```sql
   -- Opción A: DO NOTHING si ya existe (mantener el user_id original)
   ON CONFLICT (channel, sender_id) DO NOTHING
   
   -- Opción B: Solo actualizar si el user_id coincide (más seguro)
   ON CONFLICT (channel, sender_id) DO UPDATE SET updated_at = now()
   WHERE contact_channels.user_id = $1
   ```
3. Si se detecta que el contacto ya pertenece a otro usuario: log WARN con ambos user_ids
4. Considerar si este es un caso de contact merge (el mismo contacto se registró 2 veces con usuarios diferentes) — si es así, el merge debería ser explícito, no silencioso

### FIX-04: UTF-8 encoding en Medilink [MEDIUM]
**Fuente:** LAB BUG-13 del audit report
**Archivo:** `src/modules/medilink/api-client.ts`
**Bug:** La cita creada tiene `"Primera valoraciÃ³n"` en lugar de `"Primera valoración"`. Double encoding UTF-8 → Latin1 → UTF-8.
**Fix:**
1. Leer `api-client.ts` completo, buscar:
   - Cómo se construye el body de los requests HTTP (fetch/axios)
   - Si hay algún `Buffer.toString()` sin especificar encoding
   - Si los headers incluyen `Content-Type: application/json; charset=utf-8`
2. Asegurar que TODOS los requests a Medilink API incluyan:
   ```typescript
   headers: {
     'Content-Type': 'application/json; charset=utf-8',
     ...
   }
   ```
3. Si el body se construye con `JSON.stringify()`, verificar que los strings ya son UTF-8 válido
4. Si el body pasa por alguna transformación (Buffer, encoding): asegurar que sea UTF-8 en todo el pipeline
5. Probar con un string que tenga acentos y ñ: `"Valoración médica estándar"`

### FIX-05: SQL column name fixes [MEDIUM]
**Fuente:** VER-08 del LAB audit
**Archivos:** Buscar en todo el codebase
**Bug:** 2 tipos de errores SQL encontrados en logs:
1. `column cc.channel_contact_id does not exist` — debería ser `channel_identifier`
2. `operator does not exist: uuid = character varying` — 4 comparaciones de tipo incorrectas

**Fix:**
1. Buscar todas las ocurrencias de `channel_contact_id` en el código:
   ```bash
   grep -rn "channel_contact_id" src/
   ```
2. Reemplazar por `channel_identifier` (el nombre real de la columna)
3. Para el type mismatch uuid = varchar:
   ```bash
   grep -rn "= \$" src/ | grep -i "uuid\|contact_id\|user_id"
   ```
4. Buscar queries donde se compara un uuid con un string sin cast
5. Agregar cast explícito: `WHERE id = $1::uuid` o asegurar que el parámetro es del tipo correcto
6. Verificar contra el schema de la DB cuáles columnas son uuid y cuáles varchar

### FIX-06: Budget check resiliente [HIGH]
**Fuente:** F12 del análisis profundo
**Archivo:** `src/modules/llm/usage-tracker.ts` ~líneas 156-183
**Bug:** El budget check fails open cuando Redis tiene problemas intermitentes. Si Redis flappea, el gasto se desborda sin control.
**Fix:**
1. Leer `checkBudget()` (~líneas 156-183)
2. El comportamiento actual probablemente es: si Redis falla al leer el budget, retornar "OK" (fail-open)
3. Cambiar a fail-safe con fallback a PG:
   - Intentar leer budget de Redis
   - Si Redis falla: leer budget de PG (`llm_usage` table, SUM de las últimas 24h)
   - Si PG también falla: fail-closed (rechazar la llamada con log CRITICAL)
4. Agregar un cache in-memory del budget con TTL de 60s como fallback de último recurso
5. Log WARN cada vez que se usa el fallback a PG

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/hitl/CLAUDE.md` — documentar: notificación con datos de contacto
- `src/modules/users/CLAUDE.md` — documentar: User ID de 8 bytes, ON CONFLICT seguro
- `src/modules/medilink/CLAUDE.md` — documentar: UTF-8 encoding en API client
