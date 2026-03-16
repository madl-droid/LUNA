# Kernel — Core del sistema modular

Sistema de carga dinámica de módulos con hooks tipados, inyección de dependencias y config distribuido.

## Archivos
- `types.ts` — HookMap (todos los hooks con payload tipado), ModuleManifest, ApiRoute, ModuleOficinaDef, payloads de mensaje/LLM/contacto
- `config.ts` — **ÚNICO archivo que lee process.env.** Solo infra: DB, Redis, PORT, LOG_LEVEL. Proxy read-only.
- `registry.ts` — bus central: hooks, DI (provide/get), config por módulo, lifecycle de módulos
- `loader.ts` — descubre `src/modules/*/manifest.ts`, sync con tabla kernel_modules, topological sort por depends, activa en orden
- `server.ts` — servidor HTTP nativo. Monta rutas de módulos en `/oficina/api/{moduleName}/{path}`. Endpoint `/health`.
- `db.ts` — pool PostgreSQL + ejecución de migraciones kernel
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
- Loader parsea schemas, guarda resultado en registry
- Módulos leen: `registry.getConfig<MyConfig>('mi-modulo')`
- Nuevos params: agregar al configSchema del módulo + .env.example

## Loader: ciclo de vida

1. `discoverModules()` — escanea src/modules/*/manifest.ts
2. `getDbState()` — lee tabla kernel_modules
3. `syncWithDb()` — inserta módulos nuevos (activateByDefault si aplica)
4. Registra todos en Registry (inactivos)
5. `topologicalSort()` — ordena por depends, detecta ciclos → error
6. Activa en orden: llama `manifest.init(registry)` para cada uno

## Trampas
- **NO leer process.env** fuera de kernel/config.ts. Módulos usan registry.getConfig().
- **NO importar código entre módulos** directamente. Usar hooks o services del registry.
- **Dependencias circulares** causan error en loader. Declararlas en manifest.depends[].
- `callHook` retorna null si ningún listener responde — siempre manejar el caso null.
- Las migraciones kernel corren automáticamente en `createPool()`. Módulos crean sus propias tablas en init().

## Exports consumidos por otros
- `Registry` class — instanciada en src/index.ts, pasada a todos los módulos
- `kernelConfig` — config de infraestructura
- `HookMap`, `ModuleManifest` y types — importados por todos los módulos
- `createPool()`, `createRedis()` — setup de conexiones
- `createServer()`, `startServer()` — servidor HTTP
- `loadModules()` — orquestador de arranque
