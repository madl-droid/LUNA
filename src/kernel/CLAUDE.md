# Kernel — Core del sistema modular

Sistema de carga dinámica de módulos con hooks tipados, inyección de dependencias y config distribuido.

## Archivos
- `types.ts` — HookMap (todos los hooks con payload tipado), ModuleManifest, ApiRoute, ModuleOficinaDef, payloads de mensaje/LLM/contacto
- `config.ts` — **ÚNICO archivo que lee process.env.** Solo infra: DB, Redis, PORT, LOG_LEVEL. Proxy read-only.
- `config-store.ts` — CRUD encriptado para tabla config_store (AES-256-GCM). Secrets se encriptan, non-secrets en texto plano.
- `config-helpers.ts` — helpers Zod para configSchema: `numEnv()`, `numEnvMin()`, `floatEnv()`, `floatEnvMin()`, `boolEnv()`. Evitan repetir `.transform(Number).pipe(...)`.
- `http-helpers.ts` — helpers HTTP compartidos: `readBody()`, `parseBody()`, `jsonResponse()`, `parseQuery()`, `getPathname()`. **Todos los módulos los importan de aquí.**
- `registry.ts` — bus central: hooks, DI (provide/get), config por módulo, lifecycle de módulos
- `loader.ts` — descubre `src/modules/*/manifest.ts`, sync con tabla kernel_modules, topological sort por depends, activa en orden
- `server.ts` — servidor HTTP nativo. `mountModuleRoutes(name, routes)` y `unmountModuleRoutes(name)` para hot-mount/unmount de rutas en `/oficina/api/{moduleName}/{path}`. Endpoint `/health`.
- `db.ts` — pool PostgreSQL + ejecución de migraciones kernel (kernel_modules + config_store)
- `redis.ts` — conexión Redis con lazyConnect
- `migrations/001_modules.sql` — tabla kernel_modules (name, active, activated_at, meta)

## Sistema de hooks

Dos tipos:
- **Actions** (retornan void): `registry.runHook('message:incoming', payload)` — ejecuta todos los listeners
- **Filters** (retornan valor): `registry.callHook('llm:chat', payload)` — primer resultado no-null gana

Hooks principales definidos en HookMap:
- `message:incoming`, `message:classified`, `message:before_respond`, `message:response_ready`, `message:send`, `message:sent`
- `llm:chat`, `llm:models_available`, `llm:provider_down`, `llm:provider_up`
- `module:activated`, `module:deactivated`
- `oficina:config_saved`, `oficina:config_applied`
- `contact:status_changed`, `job:register`

Registrar: `registry.addHook('mi-modulo', 'message:incoming', handler, priority?)`

## Inyección de dependencias

- Registrar: `registry.provide('modulo:servicio', instance)`
- Consumir: `registry.get<T>('modulo:servicio')`
- Convención de nombres: `{moduleName}:{serviceName}`
- Al desactivar módulo, sus servicios con prefijo se limpian automáticamente

## Config distribuido

- `kernel/config.ts`: solo infraestructura (DB host/port/password, Redis, PORT, LOG_LEVEL)
- Cada módulo define `configSchema` (Zod) en su manifest para sus propias env vars
- Loader parsea schemas, guarda resultado en registry (paso 5 del lifecycle)
- `registry.activate()` también parsea configSchema si no se hizo antes (para activaciones en runtime desde oficina)
- Módulos leen: `registry.getConfig<MyConfig>('mi-modulo')`
- Nuevos params: agregar al configSchema del módulo + .env.example

## Loader: ciclo de vida

1. `discoverModules()` — escanea src/modules/*/manifest.ts
2. `getDbState()` — lee tabla kernel_modules
3. `syncWithDb()` — inserta módulos nuevos (activateByDefault si aplica)
4. Registra todos en Registry (inactivos)
5. Parsea `configSchema` de cada módulo contra env vars, guarda config validado en registry
6. `topologicalSort()` — ordena por depends, detecta ciclos → error
7. Activa en orden: llama `manifest.init(registry)` para cada uno

## Regla obligatoria: campos en oficina
Todo módulo que tenga parámetros configurables DEBE definir `manifest.oficina.fields` para que aparezcan en la oficina automáticamente. La UI renderiza paneles dinámicamente desde el registro de módulos — no hay paneles hardcodeados.

## Trampas
- **NO leer process.env** fuera de kernel/config.ts. Módulos usan registry.getConfig().
- **NO importar código entre módulos** directamente. Usar hooks o services del registry.
- **Dependencias circulares** causan error en loader. Declararlas en manifest.depends[].
- `callHook` retorna null si ningún listener responde — siempre manejar el caso null.
- Las migraciones kernel corren automáticamente en `createPool()`. Módulos crean sus propias tablas en init().
- **src/oficina/ es LEGACY** — toda funcionalidad nueva va en src/modules/oficina/.

## Exports consumidos por otros
- `Registry` class — instanciada en src/index.ts, pasada a todos los módulos
- `kernelConfig` — config de infraestructura
- `HookMap`, `ModuleManifest` y types — importados por todos los módulos
- `createPool()`, `createRedis()` — setup de conexiones
- `createServer()`, `startServer()` — servidor HTTP
- `loadModules()` — orquestador de arranque
- `http-helpers.ts` — `readBody`, `parseBody`, `jsonResponse`, `parseQuery`, `getPathname` — usados por todos los módulos con apiRoutes
- `config-helpers.ts` — `numEnv`, `numEnvMin`, `floatEnv`, `floatEnvMin`, `boolEnv` — usados en configSchema de módulos
