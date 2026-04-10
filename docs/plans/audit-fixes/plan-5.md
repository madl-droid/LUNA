# Plan 5 — Audit Fixes (post-ejecucion)
**Items**: P1 (migracion duplicada), P2 (ticket list consume leads), P3 (dead code notificationMessageId), P4 (double-delivery guard), P5 (archivo suelto en raiz)
**Esfuerzo**: ~30min
**Dependencias**: Ejecutar sobre `claude/project-planning-session-zUcNe` despues de los 4 PRs mergeados

---

## P1 — CRITICO: Renumerar migracion duplicada

Dos archivos con prefijo `052`: `052_cleanup-dead-config.sql` y `052_hitl-quote-based.sql`.

**Fix**: Renombrar `052_hitl-quote-based.sql` a `053_hitl-quote-based.sql`. El contenido no cambia.

---

## P2 — MEDIO: Ticket list command consume mensajes de leads

**Archivo**: `src/modules/hitl/message-interceptor.ts:86-117`

El bloque de deteccion de comando de listado (linea 86) activa para CUALQUIER usuario que escriba "tickets abiertos", incluyendo leads. Un lead que diga "tengo tickets abiertos de soporte" pierde su mensaje.

**Fix**: Hacer el query de `listActiveByResponder` ANTES de consumir, y si no hay tickets asignados al sender, return (pasar al pipeline). Solo responders activos ven la funcionalidad de listado.

```typescript
// Linea 86 — reemplazar:
if (TICKET_LIST_PATTERNS.some(p => p.test(text))) {
  const tickets = await ticketStore.listActiveByResponder(payload.from, payload.channelName)

// Por:
if (TICKET_LIST_PATTERNS.some(p => p.test(text))) {
  const tickets = await ticketStore.listActiveByResponder(payload.from, payload.channelName)
  if (tickets.length === 0) return  // No es responder activo — pasar al pipeline
```

El query ya se hacia (linea 87). Solo se agrega el early return en linea 88. La respuesta "No hay tickets" se elimina — si no sos responder, el comando no existe para vos.

---

## P3 — MEDIO: Dead code notificationMessageId

El plan 2 especificaba que `notifier.ts` debia capturar el `messageId` retornado por `message:send` y guardarlo via `setNotificationMessageId()`. No se implemento. El resultado:

- `setNotificationMessageId()` en `ticket-store.ts:324-329` — nunca se llama
- `notificationMessageId` en `types.ts:53` — siempre null
- `notification_message_id` columna + indice en `052_hitl-quote-based.sql` — siempre vacios
- `r.notification_message_id` en `rowToTicket()` linea 48 — siempre null

El quote-based funciona perfectamente sin esto (usa texto `Ticket: #shortId`). Es infraestructura muerta.

**Fix**: Eliminar todo. La migracion ya se renombra en P1 — aprovechar para limpiarla.

1. **`ticket-store.ts`**: Eliminar `setNotificationMessageId()` (lineas 324-329)
2. **`ticket-store.ts`**: Eliminar `notificationMessageId: r.notification_message_id ?? null` de `rowToTicket()` (linea 48)
3. **`types.ts`**: Eliminar `notificationMessageId: string | null` (linea 53) y su comentario (linea 52)
4. **`053_hitl-quote-based.sql`** (ya renombrada): Eliminar las 2 lineas de ALTER TABLE + indice. Si la migracion queda vacia, eliminar el archivo entero (no se necesita migracion si no hay cambios SQL de este plan).

**NOTA**: Si la migracion 052/053 ya se aplico en algun ambiente, la columna queda inerte en la DB — no hace falta DROP. Solo eliminar del codigo.

---

## P4 — BAJO: Guard contra double-delivery en pipeline retry

**Archivo**: `src/engine/boundaries/delivery.ts:134-140`

El riesgo: `delivery()` envia el mensaje (linea 107), luego ejecuta `Promise.all([persistMessages, updateLeadQualification, updateSession])` (linea 136). Si alguno de esos throws, `delivery()` throws, `runAgenticDelivery()` throws, y el retry loop re-ejecuta todo — incluyendo re-enviar el mensaje.

`savePipelineLog` en `run-agentic-delivery.ts:166` ya tiene `.catch(() => {})`. Pero el `Promise.all` de post-send en delivery.ts NO tiene guard.

**Fix**: Envolver el `Promise.all` de post-send operations en try-catch. Si la persistencia falla despues de enviar, loggear error pero no crashear el pipeline.

```typescript
// delivery.ts linea 134-140 — reemplazar:
  // 5. Post-send operations (parallel — all are independent)
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null
  await Promise.all([
    persistMessages(ctx, responseText, db, memoryManager),
    updateLeadQualification(ctx, registry, db, memoryManager),
    updateSession(ctx, db),
  ])

// Por:
  // 5. Post-send operations (parallel — all are independent)
  // Wrapped in try-catch: if persistence fails after message was sent,
  // we must NOT let the error propagate — the retry loop would re-send the message.
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null
  try {
    await Promise.all([
      persistMessages(ctx, responseText, db, memoryManager),
      updateLeadQualification(ctx, registry, db, memoryManager),
      updateSession(ctx, db),
    ])
  } catch (postSendErr) {
    logger.error({ postSendErr, traceId: ctx.traceId }, 'Post-send persistence failed — message was already delivered, not rethrowing')
  }
```

**Por que en delivery.ts y no en engine.ts**: El guard pertenece donde esta el riesgo. `delivery()` ya envio el mensaje; sus operaciones de persistencia no deben crashear al caller. Esto es correcto independientemente del retry — un pipeline sin retry tampoco deberia fallar por un error de persistencia post-envio.

---

## P5 — BAJO: Mover MEJORAS-LUNA-AUDIT.md

**Fix**: `git mv MEJORAS-LUNA-AUDIT.md docs/reports/MEJORAS-LUNA-AUDIT.md`

---

## CLAUDE.md updates

- **`src/engine/CLAUDE.md`**: En la seccion "Pipeline Retry", cambiar la linea sobre double-delivery:
  > ~~Guard de side effects: ...~~
  
  Agregar: "Guard de double-delivery: `delivery.ts` envuelve post-send operations en try-catch para que errores de persistencia no propaguen al retry loop."

- **`src/modules/hitl/CLAUDE.md`**: Actualizar el flujo del comando de listado:
  > "tickets abiertos", "open tickets", etc. → **solo si el sender tiene tickets activos asignados** → lista formateada. Leads/usuarios sin tickets asignados no activan el comando.

---

## Checklist
- [ ] `052_hitl-quote-based.sql` renombrada a `053` (o eliminada si queda vacia)
- [ ] Ticket list command solo se activa para responders con tickets activos
- [ ] `setNotificationMessageId()` eliminado de ticket-store.ts
- [ ] `notificationMessageId` eliminado de types.ts y rowToTicket()
- [ ] `delivery.ts` post-send operations envueltas en try-catch
- [ ] `MEJORAS-LUNA-AUDIT.md` movido a docs/reports/
- [ ] CLAUDE.md de engine y hitl actualizados
- [ ] `tsc --noEmit` pasa sin errores
