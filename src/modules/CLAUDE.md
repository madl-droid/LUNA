# Módulos LUNA — Reglas de creación

> **OBLIGATORIO:** Antes de crear o modificar un módulo, consultar `docs/architecture/module-system.md` para referencia completa.

## Estructura mínima obligatoria

```
src/modules/{nombre}/
  manifest.ts   ← OBLIGATORIO: exporta ModuleManifest (default export)
  types.ts      ← Recomendado: tipos propios del módulo
  CLAUDE.md     ← OBLIGATORIO: documentación del módulo (< 80 líneas)
  .env.example  ← Si tiene configSchema
```

## Manifest: campos obligatorios

```typescript
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
```

- `name`: kebab-case, único. Ej: `'lead-scoring'`
- `version`: semver. Ej: `'1.0.0'`
- `description`: `{ es: '...', en: '...' }` — bilingüe obligatorio
- `type`: `'core-module'` | `'provider'` | `'channel'` | `'feature'`
- `channelType`: **OBLIGATORIO si type='channel'**: `'instant'` | `'async'` | `'voice'`
  - `instant`: mensajería instantánea (WhatsApp, Google Chat)
  - `async`: comunicación asíncrona (email)
  - `voice`: llamadas de voz (Twilio)
- `console.title`: **OBLIGATORIO si type='channel'**. Nombre corto del canal (ej: "WhatsApp", "Gmail", "Twilio (Voz)").
  Se usa en: sidebar submenu, cards de canales, breadcrumb, titulo de config, status bar. **Fuente única de verdad.**
- `console.icon`: **OBLIGATORIO si type='channel'**. Icono HTML (emoji). Se sobreescribe por SVG en la UI.
- `console.info`: **OBLIGATORIO si type='channel'**. Descripción corta bilingüe del canal.
- `console.connectionWizard`: **OBLIGATORIO si type='channel'**. Define las instrucciones de conexión.
  - Las instrucciones DEBEN venir del módulo (no de la UI). La consola las lee del manifest.
  - Cada paso incluye título + instrucciones HTML bilingües + campos opcionales
  - Links externos DEBEN incluir `target="_blank"` y el SVG de redirect icon
  - El `saveEndpoint` DEBE persistir credenciales en `config_store` (AES-256-GCM)
  - Incluir `operationParams` para parámetros estándar (autoReconnect, maxRetries, retryInterval)
  - **URLs del servidor**: si el canal requiere un webhook o callback URL, usar `{BASE_URL}` como placeholder.
    La UI lo reemplaza con `location.origin`. Ejemplo: `{BASE_URL}/console/api/mi-canal/webhook`
    La URL debe mostrarse en un `.wizard-uri-box` con botón de copiar.
  - **Verificar instrucciones**: al crear/modificar un canal, verificar que las instrucciones estén actualizadas
    y que todos los enlaces a plataformas externas sigan siendo válidos.
  - **Reinicio requerido**: agregar un nuevo canal requiere reiniciar el contenedor para que el wizard se cargue.
- `removable`: `false` solo para core-module
- `init(registry)`: inicialización del módulo
- `stop()`: cleanup de recursos

## Reglas inquebrantables

1. **NO leer `process.env`** — usar `configSchema` (Zod) + `registry.getConfig<T>('nombre')`
2. **NO importar código de otro módulo** — usar hooks (`addHook`/`runHook`/`callHook`) o servicios (`registry.get`/`getOptional`)
3. **NO redefinir helpers HTTP** — importar de `../../kernel/http-helpers.js`: `jsonResponse`, `parseBody`, `parseQuery`, `readBody`
4. **NO redefinir helpers de config** — importar de `../../kernel/config-helpers.js`: `numEnv`, `boolEnv`, `floatEnv`, `numEnvMin`, `floatEnvMin`
5. **Extensión `.js` en imports relativos** — ESM lo requiere aunque el archivo sea `.ts`
6. **Env vars en UPPER_SNAKE_CASE** — prefijo del módulo: `MI_MODULO_VAR`
7. **SQL raw con $1, $2** — NO usar ORM
8. **CLAUDE.md obligatorio** — cada módulo nuevo debe tener su CLAUDE.md y agregarse a la lista en CLAUDE.md raíz
9. **Skill de outreach obligatorio si type='channel'** — crear `instance/prompts/system/skills/{canal}-outreach.md`. Ver `docs/architecture/channel-guide.md` sección "Skill de outreach cross-channel"

## Config schema: usar helpers del kernel

```typescript
import { numEnv, boolEnv, numEnvMin } from '../../kernel/config-helpers.js'

configSchema: z.object({
  MI_MODULO_ENABLED:    boolEnv(true),       // NO: z.string().transform(v => v === 'true')
  MI_MODULO_TIMEOUT_MS: numEnv(5000),        // NO: z.string().transform(Number).pipe(...)
  MI_MODULO_MAX_RETRIES: numEnvMin(1, 3),    // NO: z.coerce.number().min(1)
})
```

## Registry: comunicación entre módulos

```typescript
// Proveer servicio
registry.provide('mi-modulo:api', instancia)

// Consumir servicio (lanza error si no existe)
const svc = registry.get<Tipo>('otro:servicio')

// Consumir opcional (null si no existe)
const svc = registry.getOptional<Tipo>('otro:servicio')

// Escuchar evento
registry.addHook('mi-modulo', 'message:incoming', handler, priority?)

// Disparar evento (todos los listeners)
await registry.runHook('message:send', payload)

// Disparar evento (primera respuesta no-null)
const result = await registry.callHook('llm:chat', payload)
```

## Panel Console

```typescript
console: {
  title: { es: '...', en: '...' },
  info:  { es: '...', en: '...' },
  order: 50,                    // posición en sidebar
  group: 'modules',             // 'channels'|'agent'|'leads'|'data'|'modules'|'system'
  icon: '&#9881;',
  fields: [{ key, type, label, info, ... }],
  apiRoutes: [{ method, path, handler }],
}
```

Tipos de campo: `text`, `textarea`, `secret`, `number`, `boolean`, `select`, `tags`, `duration`, `divider`, `readonly`, `model-select`.

API routes se montan en `/console/api/{moduleName}/{path}`.

## Verificación post-creación

- [ ] Logs: `'Module discovered: mi-modulo'` al arrancar
- [ ] Logs: `'Module activated: mi-modulo'`
- [ ] `GET /health` incluye el módulo
- [ ] Panel visible en `/console`
- [ ] Toggle OFF/ON funciona
- [ ] CLAUDE.md creado y agregado a lista en CLAUDE.md raíz
- [ ] **Si type='channel'**: `connectionWizard` definido con instrucciones, links, y campos
- [ ] **Si type='channel'**: credenciales se guardan en `config_store` (sobrevive reinicios)
- [ ] **Si type='channel'**: `channelType` y `operationParams` definidos
- [ ] **Si type='channel'**: TODOS los params configurables del canal en `console.fields` (no en otra sección)
- [ ] **Si type='channel'**: skill de outreach creado en `instance/prompts/system/skills/{canal}-outreach.md`

## Regla: parámetros de canal solo en su pestaña

**TODOS los parámetros configurables de un canal van EXCLUSIVAMENTE en `console.fields` del manifest del canal.**
No poner params de un canal en otra sección (Pipeline, Naturalidad, etc.). La pestaña de ajustes de cada canal
(`/console/channels/{id}`) debe ser el ÚNICO lugar donde el usuario configura ese canal.

Esto incluye: credenciales, timeouts, mensajes, avisos de naturalidad (ACK_*), reconexión, límites.
