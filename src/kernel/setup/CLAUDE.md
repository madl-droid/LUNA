# Setup — Wizard de instalacion + Auth

Wizard tipo WordPress que corre en instancias nuevas. Tambien provee login/logout para la consola.

## Archivos
- `detect.ts` — `isSetupCompleted(pool)`: checa `SETUP_COMPLETED` en config_store
- `auth.ts` — hashPassword, verifyPassword (scrypt), sessions Redis (30 dias), CRUD user_credentials
- `i18n.ts` — diccionario ES/EN para wizard y login (~50 keys), `st()` para traducir
- `templates.ts` — SSR templates del wizard (5 pasos), CSS inline, `SetupState` type
- `handler.ts` — HTTP handler del wizard: GET/POST /setup/step/{1-5}, validacion, finalizacion
- `login.ts` — login/logout handler: GET/POST /console/login, POST /console/logout

## Flujo
1. `src/index.ts` llama `isSetupCompleted()` antes de `loadModules()`
2. Si no completado: servidor temporal con wizard en /setup
3. Wizard 5 pasos: idioma -> admin -> agente (nombre, cargo, idioma, acento) -> API keys -> sistema
4. Al finalizar: crea tablas users, admin, credentials, config+agente en config_store, SETUP_COMPLETED=true
5. Servidor temporal se cierra, boot normal continua

## Auth middleware
- `src/kernel/server.ts` checa session cookie en cada request a /console (excepto /login, /static)
- Session: token aleatorio en Redis, cookie HttpOnly, TTL 30 dias
- Credenciales: tabla `user_credentials` (kernel migration en db.ts)

## Factory reset
- `saveFactoryResetPrefill()` en handler.ts guarda config actual en Redis
- Wizard detecta prefill y precarga valores (excepto password)
- Requiere password del admin para iniciar

## Trampas
- El wizard corre ANTES de que los modulos se carguen (chicken-and-egg)
- Las tablas users/user_contacts se crean con CREATE IF NOT EXISTS (idempotente con users module)
- No depende del modulo console — CSS/templates son propios
- La encryption key de config-store se auto-genera al primer uso
