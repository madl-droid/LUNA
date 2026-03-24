# LUNA — Guía para crear un canal nuevo

> Referencia técnica para agregar canales de comunicación al sistema.

## Resumen

Un canal es un módulo de tipo `channel` que conecta LUNA con una plataforma de mensajería (WhatsApp, Email, Google Chat, voz, etc.). El engine es agnóstico del canal — toda la lógica específica vive en el módulo.

## Arquitectura

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Módulo de canal         │        │  Engine (pipeline)       │
│                          │        │                          │
│  configSchema (Zod)      │        │  getOptional(            │
│  ↓                       │ svc    │   'channel-config:X'     │
│  registry.provide(       │──────→ │  ).get()                 │
│   'channel-config:X',   │        │                          │
│   { get: () => cfg }    │        │  → aviso timing          │
│  )                       │        │  → rate limits           │
│                          │        │  → session timeout       │
│  hook: message:incoming ─┼──────→ │  → pre-close config     │
│  hook: message:send     ←┼────── │                          │
│  hook: channel:composing←┼────── │                          │
│  hook: channel:send_complete←┼── │                          │
└──────────────────────────┘        └──────────────────────────┘
```

## Paso 1: Crear el módulo

```
src/modules/{mi-canal}/
  manifest.ts      ← OBLIGATORIO
  adapter.ts       ← lógica de conexión con la plataforma
  types.ts         ← tipos propios
  CLAUDE.md        ← documentación
  .env.example     ← env vars del módulo
```

## Paso 2: Manifest básico

```typescript
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { z } from 'zod'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'

const manifest: ModuleManifest = {
  name: 'mi-canal',
  version: '1.0.0',
  description: { es: 'Canal ...', en: 'Channel ...' },
  type: 'channel',
  channelType: 'instant',  // 'instant' | 'async' | 'voice'
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    // ── Channel Runtime Config (leído por el engine) ──
    MICAN_AVISO_TRIGGER_MS:        numEnv(3000),
    MICAN_AVISO_HOLD_MS:           numEnv(2000),
    MICAN_AVISO_MESSAGE:           z.string().default('Un momento...'),
    MICAN_RATE_LIMIT_HOUR:         numEnvMin(1, 30),
    MICAN_RATE_LIMIT_DAY:          numEnvMin(1, 200),
    MICAN_SESSION_TIMEOUT_HOURS:   numEnvMin(1, 24),
    MICAN_BATCH_WAIT_SECONDS:      numEnvMin(0, 0),  // 0 = sin batching
    MICAN_PRECLOSE_FOLLOWUP_HOURS: numEnvMin(0, 1),
    MICAN_PRECLOSE_MESSAGE:        z.string().default('¿Sigues ahí?'),
    // ── Config propio del canal ──
    MICAN_API_KEY:                 z.string().default(''),
    // ... más params específicos
  }),

  // ... console, apiRoutes, init, stop
}
```

## Paso 3: Proveer `channel-config:{nombre}`

Este es el servicio que el engine lee para obtener config de runtime. Definido en `src/channels/types.ts`:

```typescript
interface ChannelRuntimeConfig {
  rateLimitHour: number       // Max msgs/hora/contacto (0 = sin límite)
  rateLimitDay: number        // Max msgs/día/contacto (0 = sin límite)
  avisoTriggerMs: number      // Ms antes de enviar aviso (0 = desactivado)
  avisoHoldMs: number         // Ms de pausa tras enviar aviso
  avisoMessages: string[]     // Pool de mensajes de aviso (se elige uno al azar)
  sessionTimeoutMs: number    // Timeout de inactividad de sesión (ms)
  batchWaitSeconds: number    // Segundos de espera para agrupar mensajes (0 = sin batching)
  precloseFollowupMs: number  // Ms antes de cerrar para enviar follow-up (0 = desactivado)
  precloseFollowupMessage: string  // Texto del follow-up pre-cierre
}
```

En el `init()` del manifest:

```typescript
import type { ChannelRuntimeConfig } from '../../channels/types.js'

async init(registry: Registry) {
  const config = registry.getConfig<MiCanalConfig>('mi-canal')

  // Proveer channel-config service
  registry.provide('channel-config:mi-canal', {
    get: (): ChannelRuntimeConfig => ({
      rateLimitHour: config.MICAN_RATE_LIMIT_HOUR,
      rateLimitDay: config.MICAN_RATE_LIMIT_DAY,
      avisoTriggerMs: config.MICAN_AVISO_TRIGGER_MS,
      avisoHoldMs: config.MICAN_AVISO_HOLD_MS,
      avisoMessages: config.MICAN_AVISO_MESSAGE ? [config.MICAN_AVISO_MESSAGE] : [],
      sessionTimeoutMs: config.MICAN_SESSION_TIMEOUT_HOURS * 3600000,
      batchWaitSeconds: config.MICAN_BATCH_WAIT_SECONDS,
      precloseFollowupMs: config.MICAN_PRECLOSE_FOLLOWUP_HOURS * 3600000,
      precloseFollowupMessage: config.MICAN_PRECLOSE_MESSAGE,
    }),
  })

  // ... resto del init
}
```

**Importante**: `get()` lee del objeto `config` que se actualiza en hot-reload, así el engine siempre obtiene valores frescos.

## Paso 4: Hooks obligatorios

### Escuchar: `message:send`

El engine envía mensajes a través de este hook. Tu canal debe filtrar por su nombre:

```typescript
registry.addHook('mi-canal', 'message:send', async (payload) => {
  if (payload.channel !== 'mi-canal') return
  const result = await adapter.sendMessage(payload.to, payload.content)
  await registry.runHook('message:sent', {
    channel: 'mi-canal',
    to: payload.to,
    channelMessageId: result.channelMessageId,
    success: result.success,
  })
})
```

### Disparar: `message:incoming`

Cuando llega un mensaje de la plataforma:

```typescript
adapter.onMessage(async (msg) => {
  await registry.runHook('message:incoming', {
    id: msg.id,
    channelName: 'mi-canal',
    channelMessageId: msg.channelMessageId,
    from: msg.from,
    timestamp: msg.timestamp,
    content: msg.content,
    raw: msg.raw,
  })
})
```

### Opcional: `channel:composing` y `channel:send_complete`

Si la plataforma soporta indicadores de typing:

```typescript
registry.addHook('mi-canal', 'channel:composing', async (payload) => {
  if (payload.channel !== 'mi-canal') return
  await adapter.showTyping(payload.to)
})

registry.addHook('mi-canal', 'channel:send_complete', async (payload) => {
  if (payload.channel !== 'mi-canal') return
  await adapter.clearTyping(payload.to)
})
```

## Paso 5: Hot-reload

Escuchar `console:config_applied` para que los cambios desde la consola surtan efecto sin reiniciar:

```typescript
registry.addHook('mi-canal', 'console:config_applied', async () => {
  const fresh = registry.getConfig<MiCanalConfig>('mi-canal')
  Object.assign(config, fresh)
  // Actualizar componentes internos si es necesario
  if (batcher) batcher.updateWaitSeconds(fresh.MICAN_BATCH_WAIT_SECONDS)
  logger.info('Config hot-reloaded')
})
```

## Paso 6: Console fields

Definir campos en `console.fields` para que el usuario pueda configurar desde la UI:

```typescript
console: {
  title: { es: 'Mi Canal', en: 'My Channel' },
  info: { es: 'Descripción...', en: 'Description...' },
  icon: '&#128172;',
  fields: [
    // Estado (readonly)
    { key: 'MICAN_CONNECTION_STATUS', type: 'readonly', label: { es: 'Estado', en: 'Status' } },
    // Aviso
    { key: '_divider_aviso', type: 'divider', label: { es: 'Naturalidad', en: 'Naturalness' } },
    { key: 'MICAN_AVISO_TRIGGER_MS', type: 'number', label: { es: 'Trigger aviso (ms)', en: 'Ack trigger (ms)' }, width: 'half' },
    { key: 'MICAN_AVISO_HOLD_MS', type: 'number', label: { es: 'Hold aviso (ms)', en: 'Ack hold (ms)' }, width: 'half' },
    { key: 'MICAN_AVISO_MESSAGE', type: 'text', label: { es: 'Mensaje de aviso', en: 'Ack message' } },
    // Rate limits
    { key: '_divider_rate', type: 'divider', label: { es: 'Límites', en: 'Limits' } },
    { key: 'MICAN_RATE_LIMIT_HOUR', type: 'number', label: { es: 'Max/hora', en: 'Max/hour' }, min: 1, max: 100, width: 'half' },
    { key: 'MICAN_RATE_LIMIT_DAY', type: 'number', label: { es: 'Max/día', en: 'Max/day' }, min: 1, max: 1000, width: 'half' },
    // Sesión
    { key: '_divider_session', type: 'divider', label: { es: 'Sesión', en: 'Session' } },
    { key: 'MICAN_SESSION_TIMEOUT_HOURS', type: 'number', label: { es: 'Timeout (horas)', en: 'Timeout (hours)' }, min: 1, max: 72, width: 'half' },
    { key: 'MICAN_PRECLOSE_FOLLOWUP_HOURS', type: 'number', label: { es: 'Pre-cierre (horas)', en: 'Pre-close (hours)' }, min: 0, max: 23, width: 'half' },
    { key: 'MICAN_PRECLOSE_MESSAGE', type: 'text', label: { es: 'Mensaje pre-cierre', en: 'Pre-close message' } },
    // Config específico del canal...
  ],
}
```

**Regla**: TODOS los params configurables del canal van en su propia sección de console. No poner params de un canal en Pipeline ni en otra sección.

## Paso 7: Registro en `ChannelName`

Agregar el nombre del canal en `src/channels/types.ts`:

```typescript
export type ChannelName = 'whatsapp' | 'email' | 'instagram' | 'messenger' | 'voice' | 'mi-canal'
```

## Cómo lee el engine cada parámetro

| Parámetro | Dónde lo usa el engine | Archivo |
|---|---|---|
| `rateLimitHour/Day` | `checkRateLimit()` — limita envíos por contacto | `phase5-validate.ts` |
| `avisoTriggerMs/HoldMs/Messages` | `getAvisoConfig()` — aviso automático si la respuesta tarda | `engine.ts` |
| `sessionTimeoutMs` | `getChannelSessionTimeout()` — ventana para reabrir sesión | `phase1-intake.ts` |
| `batchWaitSeconds` | Usado por el módulo directamente (no por engine) | `manifest.ts` |
| `precloseFollowupMs/Message` | Usado por el módulo directamente (timer + mensaje) | `manifest.ts` |

El engine **nunca importa código del canal**. Solo lee el servicio `channel-config:{nombre}` via registry. Si el servicio no existe (canal no activo), usa defaults del engine.

## Checklist de verificación

- [ ] `manifest.ts` con configSchema, console fields, connectionWizard
- [ ] Servicio `channel-config:{nombre}` registrado en init()
- [ ] Hook `message:send` escuchado, filtrando por canal
- [ ] Hook `message:incoming` disparado al recibir mensajes
- [ ] Hook `console:config_applied` escuchado para hot-reload
- [ ] `ChannelName` actualizado en `src/channels/types.ts`
- [ ] CLAUDE.md creado y agregado a la lista en CLAUDE.md raíz
- [ ] `.env.example` con todos los env vars del configSchema
- [ ] Credenciales en `config_store` (AES-256-GCM), no en filesystem
- [ ] Todos los defaults definidos en Zod, ningún valor hardcodeado en el engine

## Canales existentes como referencia

| Canal | Módulo | channelType | Channel Config Service |
|---|---|---|---|
| WhatsApp | `src/modules/whatsapp/` | instant | ✅ `channel-config:whatsapp` |
| Google Chat | `src/modules/google-chat/` | instant | ✅ `channel-config:google-chat` |
| Email (Gmail) | `src/modules/gmail/` | async | ❌ (pendiente migración) |
| Voz (Twilio) | `src/modules/twilio-voice/` | voice | ❌ (pendiente migración) |

WhatsApp y Google Chat son las implementaciones de referencia del patrón channel-config para canales `instant`.

## REGLA: Nombre del agente en canales instant

Todos los canales de tipo `channelType: 'instant'` DEBEN obtener el nombre del agente de `prompts:service.getAgentName()`. Esto se usa para:
- Detección de @menciones en grupos/rooms
- Filtrado de mensajes que no van dirigidos al bot

**Patrón estándar:**
```typescript
// En init() del manifest:
const getAgentName = (): string => {
  const svc = registry.getOptional<PromptsService>('prompts:service')
  if (svc) return svc.getAgentName()
  return 'Luna' // fallback
}
// Pasar al adapter
adapter = new MyAdapter(config, db, getAgentName)
```

**NO hardcodear nombres de agente en los canales.** El valor se configura centralizadamente en el módulo `prompts` (`AGENT_NAME` en configSchema, editable desde console).

## REGLA: Rooms/grupos en canales instant

Todos los canales `instant` que soporten conversaciones grupales (WhatsApp grupos, Google Chat rooms) DEBEN seguir el mismo patrón:
1. Detectar si el mensaje viene de un grupo/room
2. Solo procesar si el bot fue @mencionado o llamado por nombre
3. Usar `prompts:service.getAgentName()` para la detección
4. Limpiar la @mención del texto antes de procesar (argumentText o stripMentionTag)
