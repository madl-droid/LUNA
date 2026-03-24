# LUNA — Sistema de Módulos: Guía de Desarrollo

> Referencia técnica para el equipo de desarrollo — Versión 1.0 (Marzo 2026)

## 1. ¿Qué es el sistema de módulos?

LUNA usa una arquitectura modular inspirada en el sistema de plugins de WordPress, pero con type-safety completo de TypeScript. El motor central (kernel) es pequeño y estable, y toda la funcionalidad se agrega, activa o desactiva mediante módulos independientes.

**Analogía:** El kernel es la carcasa de un teléfono. Los módulos son las apps. Puedes instalar, desinstalar y activar apps sin cambiar el teléfono.

### 1.1 Arquitectura general

Cada módulo es un directorio dentro de `src/modules/` con un archivo `manifest.ts` que exporta un `ModuleManifest`. El kernel descubre, registra y activa módulos automáticamente al arrancar.

#### Archivos del kernel

| Archivo | Propósito |
|---------|-----------|
| `src/kernel/types.ts` | Interfaces: ModuleManifest, HookMap, OficinaField, ApiRoute, LoadedModule |
| `src/kernel/registry.ts` | Bus central: hooks, DI, config por módulo, lifecycles |
| `src/kernel/loader.ts` | Descubrimiento, sync con DB, topological sort, activación |
| `src/kernel/server.ts` | HTTP server con mount/unmount dinámico de rutas |
| `src/kernel/config.ts` | ÚNICO archivo que lee process.env. Exporta kernelConfig |
| `src/kernel/config-store.ts` | CRUD config en PostgreSQL con AES-256-GCM para secrets |
| `src/kernel/db.ts` | createPool() — pool PostgreSQL + migraciones kernel |
| `src/kernel/redis.ts` | createRedis() — conexión ioredis |
| `src/kernel/http-helpers.ts` | jsonResponse(), parseBody(), parseQuery(), readBody() |

### 1.2 Secuencia de arranque

Cuando LUNA inicia, el kernel ejecuta estos pasos en orden:

1. `createPool()` — PostgreSQL + migración kernel_modules + config_store
2. `createRedis()` — conexión ioredis
3. `new Registry(db, redis)`
4. `loadModules(registry)` — descubre, sincroniza DB, ordena deps, activa
5. `new Server(registry)` — HTTP server base
6. Montar API routes de módulos activos
7. Hooks auto-mount/unmount para módulos activados/desactivados en runtime
8. `server.start()`
9. SIGTERM/SIGINT → `registry.stopAll()` → shutdown limpio

## 2. Tipos de módulo

Cada módulo declara su tipo en el campo `type` del ModuleManifest. El tipo determina el comportamiento por defecto y si el módulo puede desactivarse.

| Tipo | Descripción | removable | activateByDefault | Ejemplo |
|------|-------------|-----------|-------------------|---------|
| `core-module` | Funcionalidad esencial del engine | false | true | engine, memory, llm |
| `provider` | Proveedor externo de servicios | true | varía | google-apps |
| `channel` | Canal de mensajes entrantes/salientes | true | varía | whatsapp, gmail |
| `feature` | Funcionalidad opcional adicional | true | varía | lead-scoring, tools |

**Regla:** Un módulo `core-module` (`removable: false`) nunca puede desactivarse desde la Console. Si se intenta, el kernel lo rechaza.

### 2.1 Módulos existentes

| Módulo | Tipo | Depends | Por defecto | Ruta |
|--------|------|---------|-------------|------|
| engine | core-module | memory, llm | activo | src/modules/engine/ |
| memory | core-module | — | activo | src/modules/memory/ |
| llm | core-module | — | activo | src/modules/llm/ |
| whatsapp | channel | — | activo | src/modules/whatsapp/ |
| gmail | channel | — | inactivo | src/modules/gmail/ |
| google-chat | channel | — | inactivo | src/modules/google-chat/ |
| google-apps | provider | — | inactivo | src/modules/google-apps/ |
| tools | feature | — | activo | src/modules/tools/ |
| knowledge | feature | — | inactivo | src/modules/knowledge/ |
| lead-scoring | feature | — | inactivo | src/modules/lead-scoring/ |
| users | feature | — | activo | src/modules/users/ |
| prompts | feature | — | inactivo | src/modules/prompts/ |
| scheduled-tasks | feature | llm | activo | src/modules/scheduled-tasks/ |
| model-scanner | feature | llm | inactivo | src/modules/model-scanner/ |
| twilio-voice | channel | — | inactivo | src/modules/twilio-voice/ |
| console | feature | — | activo | src/modules/console/ |

## 3. Ciclo de vida de un módulo

### 3.1 Descubrimiento

El loader escanea `src/modules/*/manifest.ts` (o `.js` en producción). Cada directorio debe tener un `manifest.ts` que exporte el `ModuleManifest` como default o como export nombrado `manifest`.

### 3.2 Sincronización con DB

- Módulo nuevo en filesystem → INSERT en `kernel_modules` con `active = activateByDefault`
- Módulo en DB pero no en filesystem → warning en logs (no se borra automáticamente)
- Estado de activación persiste en PostgreSQL → sobrevive reinicios

### 3.3 Ordenamiento topológico

Los módulos se activan en orden de dependencias. Si A depende de B, B se activa primero. El loader detecta dependencias circulares y lanza error.

**Ejemplo:** engine depende de memory y llm. LUNA siempre activa memory y llm antes de engine, sin importar el orden en que aparecen en el filesystem.

### 3.4 Activación

1. Verificar que todas las dependencias estén activas
2. Parsear configSchema contra las variables de entorno
3. Llamar `manifest.init(registry)`
4. Marcar `active = true` en tabla `kernel_modules`
5. Disparar hook `module:activated`

### 3.5 Desactivación

1. Verificar que ningún módulo activo depende de este
2. Llamar `manifest.stop()` si existe
3. Remover hooks registrados por este módulo
4. Remover servicios provistos por este módulo
5. Marcar `active = false` en `kernel_modules`
6. Disparar hook `module:deactivated`

### 3.6 Shutdown global

En orden inverso de activación, el kernel llama `stop()` de cada módulo activo. Esto garantiza que un módulo del que otros dependen se detenga al final.

## 4. Interfaz ModuleManifest

El contrato que todo módulo debe implementar. Se define en `src/kernel/types.ts`.

| Campo | Descripción |
|-------|-------------|
| `name: string` | ID único del módulo. Usar kebab-case. Ej: `'whatsapp'`, `'lead-scoring'` |
| `version: string` | Versión semver. Ej: `'1.0.0'` |
| `description: {es, en}` | Descripción bilingüe obligatoria |
| `type: ModuleType` | `'core-module'` \| `'provider'` \| `'channel'` \| `'feature'` |
| `removable: boolean` | `false` → no se puede desactivar desde Console |
| `activateByDefault?: boolean` | `true` → se activa automáticamente al descubrirse por primera vez |
| `depends?: string[]` | Nombres de módulos que deben estar activos antes de `init()` |
| `configSchema?: ZodObject` | Schema Zod con las env vars que el módulo necesita |
| `oficina?: ModuleOficinaDef` | Panel UI en la Console (campos, API routes, etc.) |
| `init: (registry) => Promise<void>` | Se llama al activar. Aquí se inicializa todo el módulo |
| `stop?: () => Promise<void>` | Se llama al desactivar. Aquí se limpian recursos |

## 5. Registry: el bus central

El Registry es el objeto que se pasa a `init(registry)`. Es el único canal de comunicación entre módulos. Tiene cuatro responsabilidades principales.

### 5.1 Hooks (sistema de eventos)

Los hooks permiten que módulos reaccionen a eventos del sistema sin acoplarse directamente.

**Registrar un hook:**
```typescript
registry.addHook('mi-modulo', 'message:incoming', async (payload) => {
  // payload es type-safe según HookMap
}, priority?) // menor número = ejecuta primero (default: 10)
```

**Disparar hooks:**
```typescript
// runHook: fire-and-forget, ejecuta TODOS los listeners
await registry.runHook('message:incoming', payload)

// callHook: retorna la PRIMERA respuesta no-null
const result = await registry.callHook('llm:chat', payload)
```

**Hooks disponibles:**

| Grupo | Hooks disponibles |
|-------|-------------------|
| Lifecycle | `module:activated`, `module:deactivated` |
| Mensajes | `message:incoming`, `message:classified`, `message:before_respond`, `message:response_ready`, `message:send`, `message:sent` |
| LLM | `llm:chat`, `llm:models_available`, `llm:provider_down`, `llm:provider_up` |
| Console | `oficina:config_saved`, `oficina:config_applied` |
| Contactos | `contact:new`, `contact:status_changed` |
| Usuarios | `user:resolved` |
| Jobs | `job:register`, `job:run` |
| Tools | `tools:register`, `tools:before_execute`, `tools:executed` |
| Llamadas | `call:incoming`, `call:outgoing`, `call:connected`, `call:ended`, `call:transcript` |

### 5.2 Dependency Injection (servicios)

Los módulos exponen servicios para que otros módulos los consuman. La convención de nombres es: `{moduleName}:{serviceName}`

```typescript
// Proveer un servicio
registry.provide('mi-modulo:api', instancia)

// Consumir (lanza error si no existe)
const svc = registry.get<MiTipo>('mi-modulo:api')

// Consumir opcional (retorna null si no existe)
const svc = registry.getOptional<MiTipo>('otro-modulo:servicio')
```

**Servicios que exponen los módulos existentes:**

| Servicio | Módulo que lo provee |
|----------|---------------------|
| `whatsapp:adapter` | whatsapp — BaileysAdapter |
| `llm:gateway` | llm — LLMGateway |
| `oficina:requestHandler` | console — handler HTTP de la Console |
| `users:db` | users — acceso a listas de usuarios |
| `tools:registry` | tools — catálogo de tools |
| `kernel:server` | (kernel) — instancia del Server HTTP |

### 5.3 Config por módulo

El kernel parsea el `configSchema` del módulo contra las variables de entorno al activarse y guarda el resultado. El módulo lee su config en `init()`:

```typescript
const config = registry.getConfig<MiConfig>('mi-modulo')
```

### 5.4 Infraestructura

```typescript
registry.getDb()     // Pool PostgreSQL
registry.getRedis()  // Instancia ioredis
```

## 6. Config Schema (env vars con Zod)

Cada módulo declara qué variables de entorno necesita mediante un schema Zod. El kernel valida estas variables al activar el módulo — si falta una variable requerida, el módulo no se activa y lanza error descriptivo.

### 6.1 Helpers disponibles

| Helper | Produce |
|--------|---------|
| `numEnv(default?)` | Entero (int) con valor por defecto |
| `numEnvMin(min, default?)` | Entero con valor mínimo y defecto |
| `floatEnv(default?)` | Decimal (float) con valor por defecto |
| `floatEnvMin(min, default?)` | Decimal con valor mínimo y defecto |
| `boolEnv(default?)` | Booleano ('true'/'false' en .env) |
| `z.string().default('')` | String con valor por defecto |

### 6.2 Ejemplo de configSchema

```typescript
import { z } from 'zod'
import { numEnv, boolEnv, numEnvMin } from '../../kernel/config-helpers.js'

configSchema: z.object({
  MI_MODULO_ENABLED:      boolEnv(true),
  MI_MODULO_TIMEOUT_MS:   numEnv(5000),
  MI_MODULO_MAX_RETRIES:  numEnvMin(1, 3),
  MI_MODULO_API_KEY:      z.string().default(''),
}),
```

**Convención de nombres:** `MI_MODULO_NOMBRE_VAR` — siempre en UPPER_SNAKE_CASE con el prefijo del nombre del módulo en mayúsculas.

## 7. Panel en la Console (oficina)

Cada módulo puede declarar un panel en la Console de LUNA mediante el campo `oficina` en su manifest. Esto incluye campos de configuración editables y endpoints HTTP propios.

### 7.1 Estructura del panel

```typescript
oficina: {
  title: { es: 'Mi Módulo', en: 'My Module' },
  info:  { es: 'Descripción...', en: 'Description...' },
  order: 50,         // Posición en sidebar (menor = más arriba)
  group: 'modules',  // 'channels' | 'agent' | 'leads' | 'data' | 'modules' | 'system'
  icon: '&#9881;',   // HTML entity o emoji
  fields: [...],
  apiRoutes: [...],
}
```

### 7.2 Tipos de campo

| Tipo | Qué renderiza en la Console |
|------|----------------------------|
| `text` | Input de texto simple |
| `textarea` | Área de texto multilínea (con propiedad `rows`) |
| `secret` | Input tipo password (valor oculto) |
| `number` | Input numérico (con min, max, step, unit) |
| `boolean` | Toggle switch on/off |
| `select` | Dropdown con opciones predefinidas |
| `tags` | Input con chips para agregar/remover valores |
| `duration` | Número + unidad visual (ms, min, h) |
| `divider` | Separador visual entre secciones |
| `readonly` | Valor solo lectura, no editable |
| `model-select` | Doble dropdown provider + modelo LLM |

### 7.3 Definir un campo

```typescript
{
  key: 'MI_MODULO_TIMEOUT_MS',
  type: 'number',
  label: { es: 'Timeout', en: 'Timeout' },
  info: { es: 'Tiempo máximo de espera', en: 'Max wait time' },
  min: 1000, step: 1000, unit: 'ms',
}
```

### 7.4 API Routes

Cada módulo puede declarar endpoints HTTP propios. Se montan automáticamente bajo `/oficina/api/{moduleName}/{path}` cuando el módulo se activa, y se desmontan cuando se desactiva.

```typescript
apiRoutes: [
  {
    method: 'GET',
    path: 'status',
    // Acceso: GET /oficina/api/mi-modulo/status
    handler: async (req, res) => {
      jsonResponse(res, 200, { status: 'running' })
    },
  },
]
```

### 7.5 WebSocket (real-time)

Para funcionalidades en tiempo real (logs en vivo, QR de WhatsApp), se puede registrar un handler de WebSocket upgrade:

```typescript
const server = registry.get<Server>('kernel:server')
server.registerUpgradeHandler('/ws/mi-modulo', (req, socket, head) => {
  // Manejar upgrade de WebSocket
})
```

## 8. Cómo crear un módulo nuevo

### Paso 1 — Crear la estructura de archivos

```
src/modules/mi-modulo/
  manifest.ts   ← OBLIGATORIO
  types.ts      ← Recomendado (tipos del módulo)
  CLAUDE.md     ← OBLIGATORIO (ver template en CLAUDE.md raíz)
  ...otros.ts   ← Lógica del módulo
```

### Paso 2 — Crear el manifest.ts mínimo

```typescript
import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv } from '../../kernel/config-helpers.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import pino from 'pino'

const logger = pino({ name: 'mi-modulo' })

const manifest: ModuleManifest = {
  name: 'mi-modulo',
  version: '1.0.0',
  description: { es: 'Descripción', en: 'Description' },
  type: 'feature',
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    MI_MODULO_ENABLED:     boolEnv(true),
    MI_MODULO_INTERVAL_MS: numEnv(60000),
  }),

  oficina: { ... },   // ver sección 7

  async init(registry: Registry) {
    const config = registry.getConfig<{ ... }>('mi-modulo')
    const db    = registry.getDb()
    const redis = registry.getRedis()

    // Exponer servicios
    registry.provide('mi-modulo:api', { ... })

    // Escuchar eventos
    registry.addHook('mi-modulo', 'message:incoming', async (p) => {
      logger.info({ from: p.from }, 'Mensaje recibido')
    })

    logger.info('mi-modulo inicializado')
  },

  async stop() {
    // Limpiar intervalos, cerrar conexiones
    logger.info('mi-modulo detenido')
  },
}

export default manifest
```

### Paso 3 — Agregar variables de entorno

Si el módulo tiene configSchema, agregar las variables al `.env` del servidor:

```env
MI_MODULO_ENABLED=true
MI_MODULO_INTERVAL_MS=60000
```

### Paso 4 — Compilar y desplegar

1. Commit y push del nuevo módulo
2. El CI/CD reconstruye la imagen Docker (`npm run build` incluido)
3. El deploy reinicia el container
4. El módulo aparece automáticamente en la Console

### Paso 5 — Activar desde la Console

En la sección Modules de la Console, usar el toggle ON/OFF para activar el módulo. La Console usa `POST /oficina/modules/toggle` internamente.

## 9. Patrones comunes

### Patrón: Módulo con cleanup limpio

```typescript
let _servicio: MiServicio | null = null

async init(registry) {
  _servicio = new MiServicio(...)
  registry.provide('mi-modulo:servicio', _servicio)
},

async stop() {
  if (_servicio) { await _servicio.close(); _servicio = null }
},
```

### Patrón: Escuchar mensajes por canal

```typescript
registry.addHook('mi-modulo', 'message:incoming', async (payload) => {
  if (payload.channelName !== 'whatsapp') return
  // procesar solo mensajes de WhatsApp
})
```

### Patrón: Enviar un mensaje

```typescript
await registry.runHook('message:send', {
  channel: 'whatsapp',
  to: '+5215512345678',
  content: { type: 'text', text: 'Hola!' },
})
```

### Patrón: Llamar al LLM

```typescript
const result = await registry.callHook('llm:chat', {
  task: 'classify',
  messages: [{ role: 'user', content: 'Quiero agendar una cita' }],
  system: 'Clasifica la intención...',
  maxTokens: 200,
})
// result: { text, provider, model, inputTokens, outputTokens }
```

### Patrón: Consumir servicio de otro módulo (opcional)

```typescript
const usersDb = registry.getOptional<UsersDb>('users:db')
if (usersDb) {
  const users = await usersDb.listUsers('admins')
}
```

### Patrón: Crear tablas propias

```typescript
async init(registry) {
  const db = registry.getDb()
  await db.query(`
    CREATE TABLE IF NOT EXISTS mi_modulo_data (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}
```

## 10. Qué es automático y qué no

### 10.1 Automático (el kernel lo hace solo)

- Descubrimiento de módulos al arrancar (escaneo de filesystem)
- Registro en tabla `kernel_modules` (sincronización automática)
- Activación según `activateByDefault`
- Ordenamiento por dependencias (topological sort)
- Montaje y desmontaje de API routes
- Parseo y validación del configSchema contra env vars
- Cleanup de hooks y servicios al desactivar

### 10.2 Manual (requiere intervención)

| Acción manual | Detalle |
|---------------|---------|
| Copiar archivos del módulo | No hay marketplace. El módulo debe existir en `src/modules/{nombre}/` |
| Recompilar TypeScript | `npm run build` — se hace automáticamente en el CI/CD |
| Rebuild de Docker image | Dockerfile incluye build. Nuevo módulo = nuevo push = rebuild |
| Agregar env vars al .env | Si tiene configSchema, las variables deben estar en el .env del servidor |
| Migraciones de DB propias | Si el módulo crea tablas, debe llamar `ensureTables()` en su `init()` |
| Instalar dependencias npm | Si el módulo necesita paquetes nuevos, agregarlos al `package.json` |

## 11. Referencia de imports

Todos los imports que un módulo típicamente necesita:

```typescript
// Tipos del kernel
import type { ModuleManifest, ApiRoute, OficinaField } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'

// Config helpers (Zod)
import { numEnv, boolEnv, floatEnv, numEnvMin, floatEnvMin }
  from '../../kernel/config-helpers.js'

// HTTP helpers (para apiRoutes)
import { jsonResponse, parseBody, parseQuery, readBody }
  from '../../kernel/http-helpers.js'

// Config store (leer/escribir en DB)
import * as configStore from '../../kernel/config-store.js'

// Logger
import pino from 'pino'
const logger = pino({ name: 'mi-modulo' })
```

**Regla ESM:** Siempre usar extensión `.js` en paths relativos, aunque el archivo sea `.ts`. Node.js ESM lo requiere.

## 12. Verificación: ¿el módulo funciona?

Checklist para confirmar que un módulo nuevo está funcionando correctamente:

| Verificación | Cómo confirmarlo |
|-------------|-----------------|
| Módulo descubierto | Logs al arrancar: `'Module discovered: mi-modulo'` |
| Módulo activado | Logs al arrancar: `'Module activated: mi-modulo'` |
| Health check | `GET /health` — el módulo aparece en la lista de módulos activos |
| Panel en Console | Ir a `/oficina` — el módulo tiene su sección con campos y toggle |
| API route propia | `GET /oficina/api/mi-modulo/status` — responde 200 |
| Desactivación | Toggle OFF en Console → logs: `'Module deactivated: mi-modulo'` |
| Reactivación | Toggle ON en Console → módulo se re-inicializa correctamente |
