# AUDITORÍA — Rama `claude/project-planning-session-zUcNe`
**Fecha**: 2026-04-10
**Scope**: 4 planes de ejecución en `docs/plans/audit-fixes/` + código implementado
**Commits auditados**: cab436c → aef5653 (5 commits)
**Archivos cambiados**: 29 archivos, +1423 / -1036 líneas

---

## Veredicto general

La rama contiene **planificación sólida** y **ejecución mayormente correcta**, con algunos bugs reales encontrados y corregidos. Sin embargo, hay **5 problemas concretos** que necesitan atención antes de merge, y **varias observaciones** sobre decisiones de diseño.

**Nota**: Esta auditoría evalúa tanto la calidad de los planes como la calidad del código implementado.

---

## PROBLEMAS QUE BLOQUEAN MERGE

### P1. CRITICO: Conflicto de migraciones SQL (052 duplicada)
**Archivos**: `src/migrations/052_cleanup-dead-config.sql` + `src/migrations/052_hitl-quote-based.sql`

Dos migraciones con el mismo prefijo numérico `052`. El migrador de LUNA lee archivos en orden por nombre. Aunque ambas son idempotentes y no chocan entre sí, esto viola la convención de numeración secuencial y el overview.md explícitamente dice: *"el segundo ajusta su número al hacer merge"*. Nadie lo ajustó.

**Fix**: Renombrar `052_hitl-quote-based.sql` a `053_hitl-quote-based.sql`.

### P2. MEDIO: Ticket list command consume mensajes de leads/clientes
**Archivo**: `src/modules/hitl/message-interceptor.ts:86-110`

El Hook 1 ejecuta la detección de comando de listado de tickets **ANTES** de verificar si el sender es un admin/coworker. Cualquier usuario (incluyendo leads) que escriba "tickets abiertos" (o algo que matchee los patterns) tiene su mensaje consumido silenciosamente (se guarda en `hitl:consumed:{id}`) y recibe la respuesta "No hay tickets HITL abiertos asignados a ti" en vez de que Luna procese su mensaje.

Un lead hablando de "tickets de soporte abiertos" o "open tickets" perdería su mensaje. Esto es un **bug funcional**.

**Fix**: Mover la detección del ticket list command DESPUÉS de verificar que el sender tiene tickets activos como responder, o verificar el `userRelation` del sender antes de activar el listado.

### P3. MEDIO: `setNotificationMessageId()` es dead code
**Archivos**: `src/modules/hitl/ticket-store.ts`, `src/modules/hitl/notifier.ts`, `src/modules/hitl/types.ts`, `src/migrations/052_hitl-quote-based.sql`

El plan especificaba que el notifier debía capturar el `messageId` retornado por `message:send` y guardarlo via `setNotificationMessageId()`. Esto **no se implementó**. El resultado:

- `notificationMessageId` en `HitlTicket` type: existe pero siempre `null`
- `setNotificationMessageId()` en ticket-store: existe pero nunca se llama
- Columna `notification_message_id` en la migración: se crea pero siempre queda vacía
- Indice `idx_hitl_tickets_notification_msg`: se crea pero indexa cero filas

Es infraestructura muerta. El quote-based funciona sin esto (usa el texto `Ticket: #shortId`), así que la columna/método/tipo son innecesarios.

**Fix**: Eliminar `setNotificationMessageId()`, quitar `notificationMessageId` del type, y quitar la columna + índice de la migración. O implementar lo que el plan decía.

### P4. BAJO: Pipeline retry sin guard contra double-delivery
**Archivo**: `src/engine/engine.ts:548-585`

El retry loop envuelve `runAgenticDelivery()` completo, que incluye delivery (Phase 5 — envío del mensaje al usuario). Si `runAgenticDelivery()` **completó** el envío pero luego falla en algo posterior (ej: un log, una métrica), el retry re-ejecutaría todo el pipeline incluyendo un segundo envío.

En la práctica actual esto es improbable porque `savePipelineLog` usa `.catch(() => {})`, pero el guard arquitectural no existe. El plan lo mencionaba explícitamente como algo a resolver.

**Fix**: Agregar un flag `deliveryCompleted = true` dentro de `runAgenticDelivery` después de `delivery()`, y checkear ese flag antes de reintentar. O aceptar el riesgo documentándolo explícitamente.

### P5. BAJO: `MEJORAS-LUNA-AUDIT.md` en la raíz del repo
**Archivo**: `MEJORAS-LUNA-AUDIT.md` (265 líneas)

Un documento de auditoría de 265 líneas en la raíz del repo. El repo tiene `docs/reports/` para esto. El archivo contiene hallazgos operacionales del lab que mezclan issues de servidor, código y calidad de respuesta.

**Fix**: Mover a `docs/reports/` o eliminar (su contenido ya está capturado en los planes).

---

## OBSERVACIONES (no bloquean pero vale la pena notar)

### O1. Plan 2 desvió correctamente del plan — B4 fix es mejor
El plan decía agregar `'scheduled-tasks'` a `depends` del módulo HITL. La implementación eligió reescribir `follow-up-job.ts` para usar `setInterval` directo en vez de `registry.runHook('job:register', ...)`. Esto elimina la dependencia completamente y es una **mejor solución** — no depende de orden de carga de módulos.

### O2. `isRetriableError()` tiene matching frágil
**Archivo**: `src/engine/engine.ts:510-530`

String matching por substrings como `'connection'`, `'not found'`, `'pool'` es inherentemente frágil:
- `msg.includes('connection')` matchea "invalid connection string" (error permanente de config)
- `msg.includes('not found')` bloquea retry en "route not found" (potencialmente transitorio)
- `msg.includes('pool')` matchea "pool size exceeded" (transitorio) pero también "thread pool error" (bug)

Es aceptable como v1 pero tiene riesgo de clasificar mal errores edge-case. **No es un blocker.**

### O3. Gmail auth-status tiene dead code
**Archivo**: `src/modules/gmail/manifest.ts`

Las rutas `auth-status` y `status` usan `registry.getOptional('google:oauth-manager')` con fallbacks para cuando `google-apps` no existe. Pero `depends: ['google-apps']` garantiza que el servicio existe. Los fallbacks son código muerto. **Cosmético, no funcional.**

### O4. Plan 1 B2 — clamping formula edge case
**Archivo**: `src/engine/buffer-compressor.ts:42`

```typescript
const threshold = Math.min(configuredThreshold, Math.max(1, maxPossibleTurns - keepRecent - 2))
```

Si `maxPossibleTurns - keepRecent - 2 <= 0` (ej: buffer de 4 mensajes, keepRecent de 5), el `Math.max(1, ...)` clampea a 1. Esto significa que compresión se dispara con apenas 1 turn, lo cual es correcto (mejor comprimir algo que nada) pero el `-2` magic number no tiene comentario explicando por qué 2 y no 1 o 3.

### O5. Prompt de image-description es bueno
**Archivo**: `instance/prompts/system/image-description.md`

El prompt incluye el formato obligatorio `[DESCRIPCION]`/`[RESUMEN]` que `parseDualDescription()` necesita. Cubre casos médicos, documentos, productos, capturas de pantalla. Instrucción de no diagnosticar es correcta para el dominio clínico. Bien implementado.

### O6. Guardrails visual content — correcto pero genérico
**Archivo**: `instance/prompts/defaults/guardrails.md`

La instrucción de contenido visual es clara y directa. Cumple el objetivo de que Luna deje de hacer comentarios genéricos y referencie lo que la imagen muestra. Correcto.

### O7. Overview.md reclama "100% paralelo" — es casi cierto
El overview dice los 4 planes no comparten archivos. Esto es **mayormente correcto** excepto que:
- Plan 1 y Plan 2 ambos tocan `src/modules/hitl/handoff.ts` (B1 está en Plan 1 pero handoff.ts se modificó en el commit de Plan 2 también)
- Ambos crean migración `052`

La independencia es suficiente para ejecución paralela, pero no es "cero dependencias" estricto.

---

## EVALUACIÓN POR PLAN

### Plan 1: Quick Fixes — **8/10**
- B1 SQL fix: Correcto, usa `contact_channels` como debía
- B2 Clamping: Correcto, `getBufferMessageCount()` agregado, default cambiado a 20
- B3 Prompt: Correcto, formato dual incluido
- Q1 Guardrails: Correcto y conciso
- L1 Dead code: Correctamente eliminado
- L2 Migration: Correcta pero conflicto de número
- Documentación CLAUDE.md: Actualizada

### Plan 2: HITL Redesign — **7/10**
- Quote-based interception: Bien diseñado e implementado
- `parseHitlCitation()`: Correcto
- `classifyReplyIntent()` eliminada: Confirmado
- B4 fix (setInterval): Mejor que el plan, bien ejecutado
- Ticket list command: Bug de consumir mensajes de leads (P2)
- Dead code: `setNotificationMessageId` nunca se usa (P3)
- Security (quote forgery): Mitigado con check de assignee
- Follow-up job: Buena reescritura

### Plan 3: Gmail OAuth — **9/10**
- Unificación completa: Standalone path eliminado
- `email-oauth.ts` eliminado: Confirmado
- `depends: ['google-apps']`: Correcto
- `registry.get()` (no optional): Correcto
- Rutas standalone eliminadas: Correcto
- Limpieza de imports: Completa
- Dead code menor en auth-status routes (O3)

### Plan 4: Pipeline Retry — **7/10**
- Retry loop bien ubicado (solo agentic, no Phase 1)
- ACK no se re-envía: Correcto
- Backoff correcto: 1.5s, 3s
- Log levels correctos: WARN intermedio, ERROR final
- Sin guard contra double-delivery (P4)
- `isRetriableError()` frágil pero aceptable como v1

---

## RESUMEN DE ACCIONES REQUERIDAS

| # | Severidad | Acción | Esfuerzo |
|---|-----------|--------|----------|
| P1 | Critico | Renumerar migración HITL a 053 | 1 min |
| P2 | Medio | Restringir ticket list command a users con tickets activos | 15 min |
| P3 | Medio | Eliminar dead code de notificationMessageId o implementar | 15 min |
| P4 | Bajo | Agregar guard de double-delivery o documentar como riesgo aceptado | 30 min |
| P5 | Bajo | Mover MEJORAS-LUNA-AUDIT.md a docs/reports/ | 1 min |

---

## SOBRE LA CALIDAD DE LOS PLANES

Los planes están bien estructurados:
- Cada uno tiene contexto, bug description, fix detallado, "lo que NO hacer", edge cases, y checklist
- La separación en 4 planes paralelos es pragmática
- Las secciones "Lo que NO hacer" son valiosas — evitan over-engineering

**Critica honesta del approach de planificación**:
- Los planes son excesivamente detallados para fixes puntuales. Plan 1 es 259 líneas para 6 fixes que son mayormente one-liners. La ratio documentación/código es ~5:1. Para un equipo de una persona, esto es overhead.
- El Plan 2 mezcla el rediseño (B5) con el fix de dependencia (B4), que son conceptualmente independientes. B4 era un one-liner (`depends: ['scheduled-tasks']`) que terminó siendo resuelto de otra forma.
- Los planes documentan la implementación con tanta precisión que el ejecutor básicamente copy-pastea. Esto reduce la autonomía del ejecutor para elegir mejores approaches (como efectivamente pasó con B4 donde el ejecutor eligió algo mejor que el plan).

**Veredicto sobre los planes**: Útiles como referencia pero sobre-especificados. Para bugs con fix conocido, un bullet point basta. El nivel de detalle tiene sentido para redesigns (Plan 2) pero no para one-liners (B1, L1, L2).
