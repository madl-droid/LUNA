# Plan 2 — HITL Quote-Based Redesign
**Items**: B4 (tickets no auto-expiran), B5 (interceptor bloquea conversaciones por sender_id)
**Esfuerzo**: ~3h
**Dependencias externas**: Ninguna

---

## Problema raíz

El interceptor HITL actual (`message-interceptor.ts`) busca tickets abiertos por `sender_id` del remitente. Si un admin/coworker tiene UN ticket abierto, CUALQUIER mensaje que envíe se consume como respuesta al ticket — bloqueando su conversación normal con Luna.

**Bug adicional (B4)**: El job de follow-up/expiración probablemente nunca se registra. El módulo `hitl` tiene `depends: ['tools', 'users']` pero NO depende de `scheduled-tasks`. Cuando hitl hace `registry.runHook('job:register', {...})` durante su `init()`, si `scheduled-tasks` no ha cargado aún, no hay listener — el job se registra en el vacío.

## Diseño: Quote-Based Interception

**Principio**: Solo mensajes que **citen el mensaje de notificación HITL** se tratan como respuestas a tickets. Todo lo demás fluye normal al pipeline.

### Cómo funcionan las citas en WhatsApp

El adapter de WhatsApp (`src/modules/whatsapp/adapter.ts:599-610`) ya procesa mensajes citados:

```typescript
const contextInfo = msg.message?.extendedTextMessage?.contextInfo
const quotedMsg = contextInfo?.quotedMessage
const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || ...

// Prepend al texto del mensaje:
const finalText = `[Citando: "${quotedText.slice(0, 300)}"]\n${cleanText}`
```

**El interceptor recibe el texto YA con el prefijo `[Citando: "..."]`.** No necesita acceder a contextInfo directamente. Esto significa **cero cambios en el adapter de WhatsApp**.

### Detección de citas HITL

La notificación HITL tiene formato distintivo:
```
(!) *HITL — Admin Request*
Contacto: John Doe (+541234567890) [lead]
Ticket: #ABC123
Tipo: domain_help
...
```

El texto `Ticket: #` seguido de 6 chars está en las primeras ~150 chars (bien dentro del límite de 300 del truncado). La detección:

```typescript
const CITE_PREFIX = /^\[Citando: "(.+?)"\]\n?/s
const HITL_TICKET_PATTERN = /Ticket:\s*#([A-Fa-f0-9]{6})/

function parseHitlCitation(text: string): { ticketShortId: string; responseText: string } | null {
  const citeMatch = text.match(CITE_PREFIX)
  if (!citeMatch) return null

  const quotedText = citeMatch[1]!
  const ticketMatch = quotedText.match(HITL_TICKET_PATTERN)
  if (!ticketMatch) return null

  const responseText = text.slice(citeMatch[0].length).trim()
  return { ticketShortId: ticketMatch[1]!, responseText }
}
```

---

## Cambios por archivo

### 1. `src/modules/hitl/message-interceptor.ts` — REESCRIBIR

**Eliminar**: toda la lógica de Hook 1 que busca por `findActiveByResponder(sender_id)`.

**Nuevo Hook 1 (Priority 5)** — flujo quote-based:

```
1. Si HITL_ENABLED=false → return
2. Extraer texto del payload
3. Si texto matchea comando de listado de tickets:
   a. Buscar tickets activos donde el sender es responder
   b. Formatear y enviar lista al sender via message:send
   c. Consumir mensaje (Redis key hitl:consumed:{id})
   d. Return
4. Intentar parsear citación HITL del texto:
   a. Si no hay cita, o la cita no es HITL → return (pasa al pipeline normal)
   b. Extraer ticketShortId del texto citado
   c. Buscar ticket por shortId (últimos 6 chars del UUID) con status activo
   d. Si no se encuentra ticket → return
   e. Verificar que el sender está asignado al ticket (seguridad)
   f. Extraer texto de respuesta (después de la cita)
   g. Consumir mensaje (Redis key hitl:consumed:{id})
   h. Resolver ticket via resolveTicket()
```

**Hook 2 (Priority 4)** — handoff return: **MANTENER como está**. El @mention para devolver control funciona correctamente porque:
- Es un modo explícitamente activado (handoff activo)
- El @agent es una señal clara de retorno
- Solo aplica cuando `ticket.handoffActive === true`

**Detección de comando de listado**:

```typescript
const TICKET_LIST_PATTERNS = [
  /tickets?\s*(abiertos?|pendientes?|activos?)/i,
  /hitl\s*(pendientes?|abiertos?)/i,
  /open\s*tickets?/i,
  /qu[eé]\s*tickets?\s*(hay|tenemos)/i,
]
```

**Formato de respuesta de listado**:

```
📋 *Tickets HITL abiertos ({count}):*

1. #{shortId} — {requestType}
   Contacto: {displayName} ({senderId})
   Hace: {ageHumanReadable}
   "{clientMessage truncado a 80 chars}"

2. ...

↩️ Cita el mensaje original del ticket para responder.
```

Si no hay tickets: "No hay tickets HITL abiertos asignados a ti."

**Clasificación de intent**: ELIMINAR `classifyReplyIntent()` y toda la lógica de handoff-by-text-pattern del Hook 1. En el nuevo diseño, el acto de citar YA es la señal de intención. Si el humano cita un ticket HITL, es una respuesta. No necesitamos clasificar si es "handoff" o "resolve" — eso se determina por el contenido.

Sin embargo, mantener la detección de handoff keywords SOLO dentro del flujo de quote-based. Si el humano cita un ticket HITL y su respuesta contiene keywords de handoff ("voy a contactar", "me hago cargo"), activar handoff. Si no, tratar como resolución.

### 2. `src/modules/hitl/notifier.ts` — Actualizar notificación

**Cambio 1**: Agregar instrucción de cita al mensaje de notificación.

Después de construir el mensaje (alrededor de la línea que forma el `text` final), agregar al final:
```
\n↩️ Cita este mensaje para responder al ticket.
```

**Cambio 2**: Capturar el `messageId` retornado por `message:send` y guardarlo en el ticket.

```typescript
const sendResult = await registry.runHook('message:send', {
  channel: responder.channel,
  to: responder.senderId,
  content: { type: 'text', text: notificationText },
})

// Guardar el message ID de la notificación para matching (si el hook retorna)
if (sendResult?.channelMessageId) {
  await ticketStore.setNotificationMessageId(ticket.id, sendResult.channelMessageId)
}
```

**NOTA**: Verificar si `message:send` retorna un resultado con `channelMessageId`. Si no, el quote-based funciona igualmente basándose en el texto del ticket (Ticket: #shortId). El `notification_message_id` es un bonus para matching más preciso, no un requisito.

### 3. `src/modules/hitl/types.ts` — Agregar campo

Agregar a la interfaz `HitlTicket`:

```typescript
notificationMessageId: string | null
```

### 4. `src/modules/hitl/ticket-store.ts` — Nuevos métodos

**Agregar método `setNotificationMessageId()`**:
```typescript
async setNotificationMessageId(id: string, messageId: string): Promise<void> {
  await this.db.query(
    `UPDATE hitl_tickets SET notification_message_id = $1, updated_at = NOW() WHERE id = $2`,
    [messageId, id],
  )
}
```

**Agregar método `findByShortId()`**:
```typescript
async findByShortId(shortId: string): Promise<HitlTicket | null> {
  const { rows } = await this.db.query(
    `SELECT * FROM hitl_tickets
     WHERE RIGHT(id::text, 6) = $1
       AND status IN ('notified', 'waiting')
     ORDER BY created_at DESC
     LIMIT 1`,
    [shortId.toLowerCase()],
  )
  return rows[0] ? rowToTicket(rows[0]) : null
}
```

**Agregar método `listActiveByResponder()`** (para el comando de listado):
```typescript
async listActiveByResponder(senderId: string, channel: string): Promise<HitlTicket[]> {
  const { rows } = await this.db.query(
    `SELECT * FROM hitl_tickets
     WHERE assigned_sender_id = $1
       AND assigned_channel = $2
       AND status IN ('notified', 'waiting')
     ORDER BY created_at ASC`,
    [senderId, channel],
  )
  return rows.map(rowToTicket)
}
```

**Actualizar `rowToTicket()`**: Mapear el nuevo campo `notification_message_id`.

### 5. `src/modules/hitl/manifest.ts` — Fix dependencia

**Agregar `scheduled-tasks` a depends**:
```typescript
depends: ['tools', 'users', 'scheduled-tasks'],
```

Esto asegura que cuando hitl hace `registry.runHook('job:register', {...})`, el módulo `scheduled-tasks` ya registró su listener. **Este es el probable fix de B4** (tickets que no expiran).

**Si `scheduled-tasks` es opcional** (podría no estar en todas las instancias): usar un patrón diferente. Verificar si el módulo existe antes de depender de él, o registrar el job con un retry/deferred pattern. El ejecutor debe verificar si `scheduled-tasks` es un módulo core siempre presente o removable.

**Alternativa si scheduled-tasks es removable**: En lugar de depends duro, usar `registry.runHook` con un setTimeout fallback:
```typescript
// Intentar registrar inmediatamente
const registered = await registry.runHook('job:register', { ... })
// Si no hay listeners, re-intentar después de que todos los módulos carguen
if (!registered) {
  registry.addHook('hitl', 'kernel:ready', async () => {
    await registry.runHook('job:register', { ... })
  })
}
```

El ejecutor debe investigar cuál patrón es el correcto según la arquitectura del kernel.

### 6. Migración SQL

Crear `src/migrations/{NNN}_hitl-quote-based.sql`:

```sql
-- HITL: Add notification_message_id for quote-based interception
ALTER TABLE hitl_tickets ADD COLUMN IF NOT EXISTS notification_message_id TEXT;

-- Index for potential lookup by notification message ID
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_notification_msg
  ON hitl_tickets (notification_message_id)
  WHERE notification_message_id IS NOT NULL;
```

El ejecutor determina NNN según el estado actual de `src/migrations/`.

---

## Lo que NO hacer

- **NO modificar el adapter de WhatsApp** — el formato `[Citando: "..."]` ya está implementado
- **NO eliminar `findActiveByResponder()`** del ticket-store — lo usa Hook 2 (handoff return) y el listado
- **NO eliminar el mecanismo de handoff** (@agent mention) — funciona correctamente
- **NO agregar dependencia en WhatsApp** — el interceptor parsea texto genérico, funciona con cualquier canal que implemente citas en formato similar
- **NO borrar `classifyReplyIntent` de golpe si Hook 2 lo usa** — verificar antes que Hook 2 no depende de ella (no debería, Hook 2 usa @mention pattern)

---

## Edge cases a considerar

1. **Cita de follow-up** (no de la notificación original): Los follow-ups de `sendFollowup()` también mencionan el ticket. Si el humano cita el follow-up, el parser debería encontrar el `Ticket: #shortId` y funcionar igual.

2. **Shortid colisión**: Improbable con 6 hex chars (16M combinaciones) pero posible. El query filtra por `status IN ('notified', 'waiting')` lo que reduce el espacio. Si hay colisión, toma el más reciente (`ORDER BY created_at DESC`).

3. **Texto de respuesta vacío**: Si el humano cita el ticket pero no escribe nada (solo la cita), `responseText` estará vacío. Tratar como "sin respuesta" — no resolver, enviar mensaje pidiendo respuesta.

4. **Canales sin soporte de citas**: Si un canal (ej: Google Chat) no implementa el formato `[Citando: "..."]`, los mensajes pasarán directo al pipeline. El humano puede usar el comando de listado para ver tickets, pero no puede responder por cita. En esos canales, mantener el @agent mention como alternativa para handoff.

---

## Documentación

### Actualizar `src/modules/hitl/CLAUDE.md`
Reescribir las secciones relevantes:

**Intercepción**: cambiar de "sender-based" a "quote-based":
> El interceptor consume mensajes SOLO cuando citan una notificación HITL (detecta `Ticket: #shortId` en el texto citado). Mensajes normales del humano pasan al pipeline sin interferencia.

**Nuevo**: Comando de listado:
> Patrones: "tickets abiertos", "open tickets", etc. → responde con lista formateada de tickets asignados al sender.

**Fix B4**:
> depends incluye `scheduled-tasks` para asegurar que el job de follow-up/expiración se registra correctamente.

---

## Checklist final
- [ ] `message-interceptor.ts` reescrito: Hook 1 usa quote-based, no sender-based
- [ ] Función `parseHitlCitation()` implementada y funcional
- [ ] Detección de comando de listado con respuesta formateada
- [ ] `classifyReplyIntent()` eliminada (verificar que Hook 2 no la usa)
- [ ] `notifier.ts` agrega instrucción de cita + captura messageId
- [ ] `types.ts` tiene `notificationMessageId: string | null`
- [ ] `ticket-store.ts` tiene `setNotificationMessageId()`, `findByShortId()`, `listActiveByResponder()`
- [ ] `manifest.ts` depends incluye `scheduled-tasks` (o alternativa)
- [ ] Migración SQL creada con `notification_message_id` + índice
- [ ] CLAUDE.md actualizado
- [ ] `tsc --noEmit` pasa sin errores
