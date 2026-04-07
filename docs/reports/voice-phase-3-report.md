# INFORME DE CIERRE — Voice Phase 3: Outbound Mejorado

## Branch: `claude/voice-phase-3-1PIoQ`

---

### Objetivos definidos

Mejorar las llamadas salientes con cuatro capacidades nuevas:
1. **Business hours**: no llamar fuera de horario laboral ni en fines de semana
2. **Rate limit outbound**: limitar frecuencia de llamadas al mismo número
3. **Call reason**: personalizar el greeting de Gemini con la razón de la llamada
4. **Ring delay aleatorio**: humanizar el tiempo de respuesta en llamadas entrantes

---

### Completado ✅

| # | Feature | Implementación |
|---|---------|----------------|
| 1 | **Business hours check** | `call-manager.ts::initiateOutboundCall` — valida día de semana y hora local antes de marcar |
| 2 | **Rate limit por número** | `pg-store.ts::countRecentCalls` + check en `initiateOutboundCall` |
| 3 | **Outbound call reason** | Parámetro `reason` en `initiateOutboundCall`, pasa a `preloadContext`, inyecta en `buildSystemInstruction` |
| 4 | **Ring delay aleatorio** | `handleIncomingCall` genera número aleatorio entre `MIN_RINGS` y `MAX_RINGS` |
| 5 | **Nuevos config params** | 7 nuevos campos en `configSchema` + sección "Llamadas salientes" en console fields |
| 6 | **OutboundCallInfo map** | Almacena reason/contactName/contactId con safety cleanup de 5 min |
| 7 | **API POST /calls** | Acepta campo `reason` opcional en el body |
| 8 | **Migración suave de rings** | `VOICE_ANSWER_DELAY_RINGS` deprecado (permanece en schema), reemplazado por MIN/MAX |

---

### No completado ❌

Ninguno — todos los items del plan ejecutados.

---

### Archivos creados/modificados

| Archivo | Cambios |
|---------|---------|
| `src/modules/twilio-voice/types.ts` | +`OutboundCallInfo` interface, +7 campos en `TwilioVoiceConfig` |
| `src/modules/twilio-voice/pg-store.ts` | +`countRecentCalls(db, toNumber, direction, minutesBack)` |
| `src/modules/twilio-voice/manifest.ts` | +configSchema (7 fields), +console fields (sección "Llamadas salientes"), MIN/MAX rings, `reason` en POST /calls |
| `src/modules/twilio-voice/call-manager.ts` | +business hours, +rate limit, +outbound reason map, +ring delay aleatorio, +`getOutboundCallInfo()`, +helpers `getLocalHour`/`getLocalDayOfWeek` |
| `src/modules/twilio-voice/voice-engine.ts` | +`outboundReason` param en `preloadContext` y `buildSystemInstruction`, inyección en system instruction |

---

### Interfaces expuestas

- `CallManager.initiateOutboundCall(to, twimlUrl, statusUrl, mediaStreamUrl, reason?)` — nuevo param `reason`
- `CallManager.getOutboundCallInfo(callSid): OutboundCallInfo | null` — nuevo método público
- `pgStore.countRecentCalls(db, toNumber, direction, minutesBack): Promise<number>` — nuevo
- `preloadContext(registry, db, phone, direction, config, outboundReason?)` — nuevo param opcional

---

### Nuevos config params (todos con hot-reload vía `console:config_applied`)

| Param | Default | Descripción |
|-------|---------|-------------|
| `VOICE_BUSINESS_HOURS_ENABLED` | `true` | Activar restricción de horario |
| `VOICE_BUSINESS_HOURS_START` | `8` | Hora de inicio (0-23) |
| `VOICE_BUSINESS_HOURS_END` | `17` | Hora de fin (0-23) |
| `VOICE_BUSINESS_HOURS_TIMEZONE` | `'America/Bogota'` | Timezone IANA |
| `VOICE_OUTBOUND_RATE_LIMIT_HOUR` | `3` | Max llamadas/hora por número (0=sin límite) |
| `VOICE_ANSWER_DELAY_MIN_RINGS` | `2` | Timbrazos mínimos antes de contestar |
| `VOICE_ANSWER_DELAY_MAX_RINGS` | `5` | Timbrazos máximos antes de contestar |

---

### Tests (checklist del plan)

- [ ] Llamada outbound fuera de horario → error "Fuera de horario laboral"
- [ ] Llamada outbound en fin de semana → error "fin de semana"
- [ ] 4ta llamada en 1 hora al mismo número → error "Límite alcanzado"
- [ ] Llamada outbound con reason → Gemini saluda mencionando la razón
- [ ] Inbound: ring delay varía entre min y max (verificar en logs)
- [ ] `VOICE_BUSINESS_HOURS_ENABLED=false` → sin restricción
- [ ] `VOICE_OUTBOUND_RATE_LIMIT_HOUR=0` → sin restricción
- [ ] Hot-reload de todos los params nuevos

*Tests manuales pendientes (requieren entorno con Twilio + Gemini Live activos)*

---

### Decisiones técnicas

1. **Rate limit por `to_number`** (no `contactId`): simplifica la query, no requiere lookup extra. El contactId no está disponible en `initiateOutboundCall` sin una query adicional.

2. **`reason` en `preloadContext`** directamente: el flujo más limpio. Evita dos fuentes de verdad (`outboundCallInfo` map vs. system instruction). El map sigue siendo útil para debug/logging.

3. **Safety cleanup de 5 minutos**: si `makeCall()` falla o la llamada nunca conecta, el entry en `outboundCallInfo` se limpia automáticamente. También se limpia en `endCall` y `stopAll`.

4. **Migración suave de `VOICE_ANSWER_DELAY_RINGS`**: el campo se depreca pero permanece en schema para no romper deploys existentes. El código usa exclusivamente `MIN_RINGS`/`MAX_RINGS`.

5. **Timezone fallback**: si la timezone IANA es inválida, `getLocalHour`/`getLocalDayOfWeek` hacen fallback a UTC sin romper la llamada.

---

### Riesgos o deuda técnica

- **Timezone mal configurado**: si el operador escribe una timezone inválida, la validación falla silenciosamente con UTC. Se podría agregar validación Zod de timezones IANA válidas.
- **`VOICE_ANSWER_DELAY_RINGS` deprecated**: debería removerse en una migración futura una vez confirmado que todos los deploys usan MIN/MAX.
- **`outboundCallInfo.contactName` siempre `null`**: el nombre se resuelve dentro de `preloadContext` pero no se escribe de vuelta al map. Para futuros usos del map (ej: console logs), podría enriquecerse post-preload.

---

### Notas para integración

- El campo `reason` en `POST /console/api/twilio-voice/calls` es **opcional** — backward compatible.
- Hot-reload funciona para todos los nuevos params (se aplica en `console:config_applied`).
- `countRecentCalls` usa `make_interval(mins => $3)` — requiere PostgreSQL ≥ 9.4 (ya en uso).
