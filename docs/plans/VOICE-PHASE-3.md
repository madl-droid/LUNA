# Fase 3: Outbound Mejorado — Business Hours, Rate Limit, Call Reason, Ring Delay

## Objetivo
Llamadas salientes más inteligentes: no llamar fuera de horario, limitar frecuencia por contacto, personalizar el greeting con la razón de llamada, y humanizar con ring delay aleatorio.

## Prerequisitos
- **Fase 0**: conexión Gemini funcional (para que las llamadas outbound funcionen con 3.1)
- **Independiente** de Fases 1 y 2

## Archivos a modificar

### 1. `manifest.ts` — Nuevos configs
**Líneas afectadas**: configSchema (291-331), console fields (345-573)

```
VOICE_BUSINESS_HOURS_ENABLED       boolEnv(true)
VOICE_BUSINESS_HOURS_START         numEnvMin(0, 8)     // hora inicio (0-23)
VOICE_BUSINESS_HOURS_END           numEnvMin(0, 17)    // hora fin (0-23)
VOICE_BUSINESS_HOURS_TIMEZONE      z.string().default('America/Bogota')
VOICE_OUTBOUND_RATE_LIMIT_HOUR     numEnvMin(0, 3)     // max llamadas/hora/contacto (0=sin límite)
VOICE_ANSWER_DELAY_MIN_RINGS       numEnvMin(1, 2)     // mínimo rings antes de contestar
VOICE_ANSWER_DELAY_MAX_RINGS       numEnvMin(1, 5)     // máximo rings antes de contestar
```

**Deprecar**: `VOICE_ANSWER_DELAY_RINGS` (reemplazado por min/max).
**Migración suave**: si existe `VOICE_ANSWER_DELAY_RINGS` y no existen min/max, usar como ambos valores.

Console fields: nueva sección "Llamadas salientes" con business hours, rate limit. Modificar sección de ring delay.

### 2. `types.ts` — OutboundCallInfo
**Agregar**:
```typescript
interface OutboundCallInfo {
  reason: string           // "seguimiento de cotización", "recordatorio de cita"
  contactName: string | null
  contactId: string | null
  requestedAt: Date
}
```

### 3. `call-manager.ts` — Validaciones en outbound + ring delay aleatorio

#### 3A. Business hours check
**Líneas afectadas**: initiateOutboundCall (97-124)

Agregar al inicio de `initiateOutboundCall()`:
```typescript
if (config.businessHoursEnabled) {
  const now = new Date()
  // Convertir a timezone configurada
  const localHour = getLocalHour(now, config.businessHoursTimezone)
  const dayOfWeek = getLocalDayOfWeek(now, config.businessHoursTimezone)

  // Fin de semana (0=domingo, 6=sábado)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { error: 'Fuera de horario laboral (fin de semana)' }
  }

  // Fuera de rango horario
  if (localHour < config.businessHoursStart || localHour >= config.businessHoursEnd) {
    return { error: `Fuera de horario laboral (${config.businessHoursStart}:00-${config.businessHoursEnd}:00)` }
  }
}
```

Helper `getLocalHour(date, timezone)`:
```typescript
function getLocalHour(date: Date, timezone: string): number {
  return parseInt(date.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }))
}

function getLocalDayOfWeek(date: Date, timezone: string): number {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone })).getDay()
}
```

#### 3B. Rate limit por contacto
**Líneas afectadas**: initiateOutboundCall (97-124)

Después de business hours check:
```typescript
if (config.outboundRateLimitHour > 0 && contactId) {
  const recentCalls = await pgStore.countRecentCalls(contactId, 'outbound', 60) // última hora
  if (recentCalls >= config.outboundRateLimitHour) {
    return { error: `Límite alcanzado: ${recentCalls}/${config.outboundRateLimitHour} llamadas/hora a este contacto` }
  }
}
```

#### 3C. Outbound call reason
**Líneas afectadas**: initiateOutboundCall (97-124)

Agregar parámetro `reason?: string` a `initiateOutboundCall()`.

Map temporal para pasar info al greeting:
```typescript
private outboundCallInfo = new Map<string, OutboundCallInfo>()

// En initiateOutboundCall():
if (reason) {
  this.outboundCallInfo.set(callSid, {
    reason,
    contactName,
    contactId,
    requestedAt: new Date()
  })
}
```

Limpiar en `endCall()` o después de 5 minutos (safety).

#### 3D. Ring delay aleatorio
**Líneas afectadas**: handleIncomingCall (58-92)

Cambiar:
```typescript
// Antes: answerDelayRings = config.answerDelayRings (fijo)
// Ahora:
const minRings = config.answerDelayMinRings
const maxRings = config.answerDelayMaxRings
const answerDelayRings = Math.floor(Math.random() * (maxRings - minRings + 1)) + minRings
```

### 4. `voice-engine.ts` — Greeting con razón de llamada
**Líneas afectadas**: buildSystemInstruction (205-273), preloadContext (24-107)

En `buildSystemInstruction()`, si hay outboundCallInfo:
```typescript
const callInfo = callManager.getOutboundCallInfo(callSid)
if (callInfo) {
  // Agregar al system instruction:
  voiceInstructions += `\n\nEsta es una llamada saliente.`
  if (callInfo.contactName) {
    voiceInstructions += ` Estás llamando a ${callInfo.contactName}.`
  }
  voiceInstructions += ` Razón de la llamada: ${callInfo.reason}.`
  voiceInstructions += ` Saluda, confirma que hablas con la persona correcta, y explica la razón.`
}
```

### 5. `pg-store.ts` — Query de rate limit
**Agregar método**:
```typescript
async countRecentCalls(contactId: string, direction: string, minutesBack: number): Promise<number> {
  const { rows } = await this.pool.query(
    `SELECT COUNT(*) FROM voice_calls
     WHERE contact_id = $1 AND direction = $2
     AND started_at > NOW() - make_interval(mins => $3)`,
    [contactId, direction, minutesBack]
  )
  return parseInt(rows[0]?.count ?? '0')
}
```

### 6. `twilio-adapter.ts` — Adaptar pause a rings aleatorios
**Líneas afectadas**: generateInboundTwiml (~línea 32)

Ya calcula `pauseSeconds = (answerDelayRings - 1) * 2.5`. Solo necesita recibir el valor aleatorio calculado en call-manager.

### 7. API Route POST /calls — Pasar reason
**Líneas afectadas**: manifest.ts, API route POST /calls (61-102)

Aceptar `reason` en el body:
```typescript
const { phoneNumber, reason } = await parseBody<{ phoneNumber: string; reason?: string }>(req)
// Pasar a initiateOutboundCall(phoneNumber, reason)
```

## Verificación
- [ ] Llamada outbound fuera de horario → error "Fuera de horario laboral"
- [ ] Llamada outbound en fin de semana → error "fin de semana"
- [ ] 4ta llamada en 1 hora al mismo contacto → error "Límite alcanzado"
- [ ] Llamada outbound con reason → Gemini saluda mencionando la razón
- [ ] Inbound: ring delay varía entre min y max (verificar en logs)
- [ ] Business hours deshabilitado (VOICE_BUSINESS_HOURS_ENABLED=false) → sin restricción
- [ ] Rate limit en 0 → sin restricción
- [ ] Config hot-reload de todos los params nuevos

## Riesgos
- **Timezone incorrecto**: si el operador configura mal la timezone, bloquea/permite llamadas en horarios incorrectos. Mitigación: validar que sea timezone IANA válido.
- **Rate limit por contactId**: requiere que el contacto esté identificado. Si no hay contactId (número desconocido), el rate limit no aplica. Esto es aceptable — rate limit protege al contacto conocido.
- **outboundCallInfo Map memory leak**: si la llamada nunca se establece, el entry queda en el Map. Safety timeout de 5 minutos para limpiar.
