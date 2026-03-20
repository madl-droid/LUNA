# Users — Listas de usuarios y permisos

Resuelve QUIÉN es cada contacto (admin, coworker, lead, custom) y QUÉ puede hacer el agente con él.

## Archivos
- `types.ts` — UserType, UserResolution, UserPermissions, UserListEntry, UserListConfig
- `index.ts` — exports públicos (resolveUserType, getUserPermissions, invalidateUserCache)
- `manifest.ts` — ModuleManifest, configSchema, init/stop, oficina fields
- `resolver.ts` — resolveUserType() con cache Redis → DB lookup → lead fallback
- `permissions.ts` — getUserPermissions(), ensureAdminHasAccess()
- `cache.ts` — UserCache: get/set/invalidate en Redis (key: user_type:{senderId}:{channel})
- `db.ts` — UsersDb: DDL, CRUD, resolución SQL, config de listas
- `sync/sheet-sync.ts` — Skeleton para Google Sheets (requiere módulo Google OAuth)
- `sync/csv-import.ts` — Parser CSV manual + import masivo
- `sync/api-handler.ts` — API routes CRUD bajo /oficina/api/users/

## Manifest
- **type:** core-module
- **depends:** [] (ninguna)
- **activateByDefault:** true
- **config:** USER_TYPE_CACHE_TTL (43200s), USER_LISTS_ENABLED (true), SHEET_SYNC_INTERVAL (3600000ms)

## Hooks
- **Fires:** `user:resolved` — al resolver un tipo de usuario (senderId, channel, userType, listName)

## Servicios expuestos
- `users:db` — instancia UsersDb
- `users:cache` — instancia UserCache
- `users:resolve` — función resolveUserType
- `users:permissions` — función getUserPermissions
- `users:invalidate` — función invalidateUserCache

## API Routes (bajo /oficina/api/users/)
- `GET status` — estado del módulo y conteos
- `POST create` — crear usuario en lista
- `POST update` — actualizar usuario
- `POST deactivate` — soft delete
- `POST list` — listar usuarios de una lista
- `POST bulk-import` — importar CSV o JSON array
- `POST trigger-sync` — disparar sync desde Google Sheet
- `POST config-list` — get/get-all/upsert config de listas
- `POST resolve` — test de resolución (debug)

## Algoritmo de resolución
1. Cache Redis (TTL configurable, default 12h)
2. DB: admin → coworker → custom (ORDER BY CASE, LIMIT 1)
3. Si no match: lead (si enabled) o _unregistered:{behavior}
4. Cache resultado + fire hook `user:resolved`

## Tablas
- `user_lists` — usuarios registrados (sender_id, channel, list_type, UNIQUE constraint)
- `user_list_config` — config por tipo de lista (permisos, sync, behavior)

## Trampas
- Admin IDs se agregan desde oficina POR CANAL (WhatsApp=número, email=correo, etc.)
- Máximo 5 tipos de lista (admin + 4 configurables)
- Admin máximo 5 usuarios por instancia
- Sheet sync solo funciona si hay módulo Google OAuth activo
- Al cambiar permisos de una lista, llamar cache.invalidateAll()
- **Helpers HTTP y config**: `sync/api-handler.ts` usa `jsonResponse`, `parseBody` de `kernel/http-helpers.js`. configSchema usa `numEnv`, `boolEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
