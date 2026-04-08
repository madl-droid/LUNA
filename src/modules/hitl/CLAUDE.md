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
- `message-interceptor.ts` — hook message:incoming (priority 5), consume replies
- `context-injector.ts` — inyecta contexto HITL pendiente + reglas al evaluador
- `resolver.ts` — entrega resolucion: LLM rephrase + envio al cliente
- `handoff.ts` — logica de handoff por canal (share_contact vs full_handoff)
- `follow-up-job.ts` — BullMQ job: reminders + escalacion a supervisor
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
- `message:incoming` (priority 5) — interceptar replies de humanos
- `console:config_applied` — hot-reload config
- `job:register` — registrar follow-up job

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
3. Humano responde asincrono → interceptor consume → resolver entrega via LLM rephrase
4. Si humano tarda → follow-up reminders → max follow-ups → escala a supervisor

## Handoff triggers (NO automatico por request_type)
1. Instruccion del humano ("voy a contactar al cliente")
2. Repeticion (2+ tickets mismo contacto/sesion)
3. Regla configurable con handoff=true

## Notificación HITL — formato enriquecido
`sendNotification()` en `notifier.ts` incluye:
- `Contacto: {display_name} ({senderId}) [{contact_type}]` — cargado desde tabla `contacts` con `requesterContactId`
- `Ticket: #{últimos-6-chars-UUID}` — ID corto para identificar el ticket en conversaciones
- Si la DB lookup falla, usa `requesterSenderId` como fallback graceful

## Trampas
- El interceptor consume el mensaje del humano (Redis key `hitl:consumed:{msgId}`). Engine lo checkea.
- Handoff en Gmail pausa al agente (Redis key `hitl:handoff:{channel}:{senderId}`).
- Cadena de supervisores: `users.supervisor_id` → walk hasta admin. Max depth 10.
- Contacto compartido NUNCA incluye LID (WhatsApp Local ID) ni IDs internos.
- Reglas son lenguaje natural inyectado al evaluador, no codigo ejecutable.
- Migration 023 agrega supervisor_id a tabla users existente.
