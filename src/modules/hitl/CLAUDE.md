# HITL — Human-in-the-Loop

Sistema unificado de consulta humana y escalamiento. El agente solicita ayuda/autorizacion a Admins o Coworkers, espera respuesta, y la entrega al cliente reformulada via Phase 4.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields, API routes
- `types.ts` — HitlTicket, HitlStatus, HitlConfig, HitlRule, Responder, etc.
- `ticket-store.ts` — CRUD PostgreSQL: hitl_tickets, hitl_ticket_log
- `ticket-machine.ts` — state machine: pending→notified→waiting→resolved/expired/cancelled
- `rules-store.ts` — CRUD para hitl_rules (condiciones naturales para LLM)
- `responder-selector.ts` — seleccion de humano + canal + cadena de supervisores
- `notifier.ts` — envio de notificaciones, follow-ups, datos de contacto
- `tool.ts` — registra `request_human_help` con tools:registry
- `message-interceptor.ts` — hook message:incoming (priority 5), intercepcion quote-based
- `context-injector.ts` — inyecta contexto HITL pendiente + reglas al evaluador
- `resolver.ts` — entrega resolucion: LLM rephrase + envio al cliente
- `handoff.ts` — logica de handoff por canal (share_contact vs full_handoff)
- `follow-up-job.ts` — setInterval job: reminders + escalacion a supervisor
- `render-section.ts` — HTML para panel en Agente > Advanced

## Manifest
- **type**: `feature`
- **depends**: `['tools', 'users']`
- **configSchema**: `HITL_ENABLED`, `HITL_DEFAULT_CHANNEL`, `HITL_TICKET_TTL_HOURS`, `HITL_FOLLOWUP_INTERVAL_MIN`, `HITL_MAX_FOLLOWUPS`, `HITL_AUTO_EXPIRE_NOTIFY`

## Hooks emitidos
- `hitl:ticket_created` — ticket creado
- `hitl:ticket_resolved` — ticket resuelto por humano
- `hitl:ticket_expired` — ticket expirado por TTL
- `hitl:ticket_escalated` — ticket escalado a supervisor
- `hitl:handoff_return` — humano devuelve control al agente

## Hooks consumidos
- `message:incoming` (priority 5) — interceptar replies de humanos (quote-based)
- `console:config_applied` — hot-reload config

## Servicios expuestos
- `hitl:manager` — { createTicket, resolveTicket, getActiveTickets, cancelTicket }
- `hitl:rules` — { getRules, getRulesForEvaluator }
- `hitl:renderSection` — (lang) => string (HTML para console)

## API routes (/console/api/hitl/)
- `GET /rules` — listar reglas
- `POST /rules` — crear regla
- `PUT /rules/:id` — actualizar regla
- `DELETE /rules/:id` — eliminar regla
- `GET /tickets` — listar tickets (filtros: status, role, date)
- `GET /tickets/:id` — detalle + log

## Patron: Deferred Resolution
1. Phase 3: tool crea ticket, notifica humano, retorna `{ status: 'pending' }`
2. Phase 4: compositor dice al cliente "consulte con el equipo"
3. Humano responde citando el mensaje HITL → interceptor consume → resolver entrega via LLM rephrase
4. Si humano tarda → follow-up reminders → max follow-ups → escala a supervisor

## Intercepcion Quote-Based (B5 fix)
El interceptor (Hook 1) consume mensajes SOLO cuando citan una notificación HITL.
Deteccion: busca `Ticket: #XXXXXX` dentro del texto citado (`[Citando: "..."]`).

**Flujo**:
1. Si texto matchea TICKET_LIST_PATTERNS → enviar lista de tickets asignados al sender
2. Si texto contiene `[Citando: "..."]` con `Ticket: #XXXXXX` → procesar como respuesta al ticket
3. Si no → pasar al pipeline normalmente (sin bloquear conversacion)

**Formato de notificacion** (para que la cita funcione):
```
(!) *HITL — Admin Request*
Contacto: Name (phone) [type]
Ticket: #ABC123        ← este campo es el que detecta el interceptor
Type: domain_help
Summary: ...
↩️ Cita este mensaje para responder al ticket.
```

**Comando de listado**: "tickets abiertos", "open tickets", etc. → lista formateada con #shortId, tipo, contacto, edad.

## Follow-up Job (B4 fix)
`follow-up-job.ts` usa `setInterval` directamente (no `job:register` hook).
- Registrado en `manifest.init()` via `registerFollowUpJob()`
- Limpiado en `manifest.stop()` via `stopFollowUpJob()`
- El hook `job:register` no tiene listener en esta arquitectura

## Reasignación de compromisos

Cuando un ticket se resuelve con `handoffMode = 'full_handoff'`, `resolver.ts` llama `reassignCommitmentsToHuman()` que hace UPDATE en `commitments`: pone `assigned_to = assignedSenderId` y agrega `assigned_channel` al metadata.

## Handoff triggers (NO automatico por request_type)
1. Humano cita un ticket HITL y su respuesta contiene keywords de handoff ("voy a contactar", etc.)
2. @agent mention cuando hay handoff activo → retorna control al agente
3. Regla configurable con handoff=true

## Trampas
- El interceptor consume el mensaje (Redis key `hitl:consumed:{msgId}`). Engine lo checkea.
- Handoff en Gmail pausa al agente (Redis key `hitl:handoff:{channel}:{senderId}`).
- Cadena de supervisores: `users.supervisor_id` → walk hasta admin. Max depth 10.
- Contacto compartido NUNCA incluye LID (WhatsApp Local ID) ni IDs internos.
- Reglas son lenguaje natural inyectado al evaluador, no codigo ejecutable.
- `findByShortId()` busca los ultimos 6 chars del UUID en tickets activos (status notified/waiting).
- `listActiveByResponder()` devuelve todos los tickets activos asignados a un sender.
- Si respuesta del humano es vacia (solo cita sin texto), se pide que agregue contenido.
