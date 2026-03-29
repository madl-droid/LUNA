# LUNA — Sistema Proactivo: Arquitectura

> Automatización de outreach con 6 tipos de job, 7 guardas de protección, y pipeline reutilizado (Phases 2-5).

## Principio central

**NO_ACTION es el default seguro.** Si el LLM no está seguro, no envía nada. Cero falsos positivos.

## Componentes

```
src/engine/proactive/
├── proactive-pipeline.ts    — pipeline proactivo: Phase 1 simplificado + Phases 2-5
├── proactive-runner.ts      — BullMQ runner con priority lanes
├── proactive-config.ts      — carga instance/proactive.json
├── guards.ts                — 7 guardas de protección
├── triggers.ts              — definiciones de triggers
├── commitment-detector.ts   — auto-detecta compromisos en respuestas
├── commitment-validator.ts  — valida y clasifica compromisos
└── jobs/
    ├── follow-up.ts         — scanner de leads inactivos
    ├── reminder.ts          — scanner de eventos próximos
    ├── commitment-check.ts  — scanner de compromisos vencidos
    ├── reactivation.ts      — scanner de leads fríos
    ├── nightly-batch.ts     — batch nocturno (scoring, compresión, reportes)
    └── cache-refresh.ts     — refresco de caches

instance/proactive.json      — configuración centralizada
```

## 6 tipos de job

| Job | Frecuencia | Prioridad | Descripción |
|-----|-----------|-----------|-------------|
| commitment-scanner | 5 min | 2 (alta) | Compromisos vencidos: auto-cancel, mark overdue, fulfill |
| reminder-scanner | 30 min | 3 | Eventos en próximas 2h: enviar recordatorio |
| follow-up-scanner | 15 min | 5 | Leads inactivos >4h: reengage, cross-channel |
| reactivation-scanner | Cron 9 AM L-V | 8 | Leads fríos >7 días: reactivar suavemente |
| cache-refresh | Cron 3 AM | 10 (baja) | Refrescar cache de Google Sheets |
| nightly-batch | Cron 2 AM | 10 (baja) | Scoring, compresión memoria, reporte diario |

### BullMQ Config
- Queue: `luna:proactive`
- Concurrency: 5 workers
- Rate limit: 10 jobs / 60s
- Retry: 3 intentos con backoff exponencial (5s inicial)

## 7 guardas de protección

Ejecutadas en orden antes de cada candidato. Primera falla bloquea.

| # | Guarda | Qué hace | Resultado si falla |
|---|--------|----------|-------------------|
| 1 | Idempotency | Redis NX key per trigger/day | Skip |
| 2 | Business Hours | Horario laboral (timezone, días) | Requeue |
| 3 | Contact Lock | No molestar si hay conversación activa | Requeue 5min |
| 4 | Outreach Dedup | Mismo trigger en últimas 4h | Skip |
| 5 | Cooldown | Espaciado entre outreach | Requeue |
| 6 | Rate Limit | Cap diario por contacto (default 3) | Skip |
| 7 | Conversation Guard | Respeto señal de despedida | Requeue |

**Excepciones**: Compromisos overdue bypasean guardas 4 (dedup) y 7 (farewell).

## Pipeline proactivo

Reutiliza Phases 2-5 del pipeline reactivo con Phase 1 simplificado:

```
BullMQ Job → Scan DB → For each candidate:
  ├── 7 Guards → [blocked? requeue/skip]
  ├── Phase 1: Cargar contexto (contacto, memoria, compromisos)
  ├── Phase 2: Evaluar con LLM → [no_action? stop]
  ├── Phase 3: Ejecutar plan (tools, búsquedas)
  ├── Phase 4: Componer respuesta (LLM + formato canal)
  └── Phase 5: Validar + enviar + log
       ├── Auto-detect compromisos (fire-and-forget)
       ├── Set cooldown + increment daily count
       └── Log en proactive_outreach_log
```

## Sistema de compromisos

### Ciclo de vida

```
Auto-detect (Phase 5)  o  create_commitment tool (Phase 3)
    ↓
Validar (commitment-validator)
    ├── Known Type → deadline del config, requires_tool
    ├── Generic → 24h default
    └── Rejected → descartar
    ↓
Guardar en memoria (commitments table)
    ↓
Commitment Scanner (cada 5 min)
    ├── Auto-cancel si auto_cancel_at <= now
    ├── Mark overdue si due_at < now
    ├── Process via proactive pipeline
    └── Retry hasta max_attempts (5), luego status='failed'
```

### Auto-detección

Phase 5 detecta compromisos implícitos en respuestas del agente via LLM rápido (classify model). Fire-and-forget — si falla, no bloquea. Solo detecta promesas del AGENTE, no del contacto.

### Tipos de compromiso (instance/proactive.json)

| Tipo | Deadline | Tool requerida | Auto-cancel |
|------|----------|----------------|-------------|
| send_quote | 24h | null (hooks) | 48h |
| send_info | 4h | null (hooks) | 24h |
| follow_up | 72h | null | 96h |
| check_availability | 2h | calendar-check-availability | 6h |
| schedule_meeting | 24h | calendar-create-event | 48h |

## Follow-up con cross-channel

Cuando `cross_channel: true` y el canal primario agota `max_attempts`:
1. Consultar canales secundarios del contacto
2. Verificar en outreach_log cuáles ya se intentaron
3. Verificar si el lead respondió en algún canal desde último outreach
4. Intentar canales en `channel_fallback_order` (default: whatsapp→email→google-chat)
5. Solo transicionar a `cold` cuando TODOS los canales se agotan

## Nightly batch (2 AM)

3 sub-tareas con idempotencia via Redis key `batch:completed:{date}`:

1. **Score cold leads**: Recalificar leads fríos, actualizar qualification_score
2. **Compress sessions**: Sesiones con 30+ mensajes → resumir y guardar en session_summaries
3. **Daily report**: Métricas agregadas → Google Sheet (si configurado)

## Redis keys

| Key | TTL | Propósito |
|-----|-----|-----------|
| `proactive:idem:{contactId}:{trigger}:{date}` | 24h | Idempotencia |
| `proactive:cooldown:{contactId}` | config.cooldown_minutes | Espaciado |
| `proactive:rate:{contactId}:{date}` | 24h | Conteo diario |
| `contact:active:{contactId}` | 5-30 min | Lock de conversación activa |
| `conversation:farewell:{contactId}` | 24h | Señal de despedida |
| `batch:completed:{date}` | 24h | Idempotencia nightly batch |

## Config: instance/proactive.json

```json
{
  "enabled": true,
  "business_hours": { "start": 8, "end": 17, "timezone": "America/Bogota", "days": [1,2,3,4,5] },
  "follow_up": {
    "enabled": true, "scan_interval_minutes": 15,
    "inactivity_hours": 4, "max_attempts": 3,
    "cross_channel": false, "channel_fallback_order": ["whatsapp","email","google-chat"]
  },
  "reminders": { "enabled": true, "scan_interval_minutes": 30, "hours_before_event": 2 },
  "commitments": {
    "enabled": true, "scan_interval_minutes": 5, "max_attempts": 5,
    "commitment_types": [...]
  },
  "reactivation": { "enabled": false, "cron": "0 9 * * 1-5", "days_inactive": 7 },
  "guards": { "max_proactive_per_day_per_contact": 3, "cooldown_minutes": 60, "conversation_guard_hours": 4 }
}
```

## Decisiones de diseño clave

1. **NO_ACTION default**: Si el LLM no está seguro, no se envía nada
2. **Fire-and-forget**: Auto-detección de compromisos no bloquea el pipeline
3. **Overdue bypass**: Compromisos vencidos saltan guardas 4 y 7 (son time-sensitive)
4. **Cross-channel**: Agotar canal primario antes de probar secundarios
5. **Priority lanes**: Compromisos (5 min) más frecuentes que follow-ups (15 min)
6. **Requeue vs Skip**: Guardas distinguen entre fallas transitorias (requeue) y permanentes (skip)
7. **Config cacheado**: proactive.json se cachea al arrancar, se recarga en cambio de console
