# Plan 3 — Gmail OAuth Unification
**Items**: B6 (Gmail usa tabla OAuth separada, nunca arranca)
**Esfuerzo**: ~1.5h
**Dependencias externas**: Ninguna

---

## Problema raíz

El módulo `gmail` tiene dos paths de OAuth:
1. **Shared** (preferido): usa `google:oauth-manager` del módulo `google-apps` → tabla `google_oauth_tokens`
2. **Standalone** (fallback): usa `EmailOAuthManager` propio → tabla `email_oauth_tokens`

El problema: `gmail` tiene `depends: []` (vacío), así que puede inicializarse ANTES de que `google-apps` registre su `google:oauth-manager`. Cuando gmail hace `registry.getOptional('google:oauth-manager')` y no lo encuentra, cae al path standalone. La tabla `email_oauth_tokens` está vacía porque el token real está en `google_oauth_tokens` (gestionado por google-apps).

**Resultado**: Gmail polling nunca arranca. Emails no llegan al sistema.

## Diseño: Unificación

Gmail SIEMPRE usa el OAuth de google-apps. Un solo token, una sola tabla, una sola autenticación para todos los servicios Google.

### Justificación
- Gmail ES un servicio de Google. Las credenciales OAuth (client_id, client_secret) son las mismas.
- `google-apps` ya incluye scopes de Gmail (`gmail.readonly`, `gmail.send`, `gmail.modify`).
- No hay caso de uso donde alguien quiera Gmail sin google-apps.
- Tener dos tablas OAuth para la misma cuenta es un bug de diseño.

---

## Cambios por archivo

### 1. `src/modules/gmail/manifest.ts` — Cambio principal

#### a. Agregar dependencia
```typescript
depends: ['google-apps'],  // era: []
```

#### b. Eliminar path standalone de OAuth

En `init()` (alrededor de línea 1441-1482), la lógica actual es:
```typescript
// Actual (ELIMINAR):
const sharedOAuth = registry.getOptional<OAuthManager>('google:oauth-manager')
if (sharedOAuth) {
  // use shared
  this.oauth = sharedOAuth
} else {
  // fallback standalone
  this.emailOAuth = new EmailOAuthManager(...)
  usingStandaloneAuth = true
}
```

**Reemplazar con**:
```typescript
// Nuevo (SIEMPRE compartido):
const oauth = registry.get<OAuthManager>('google:oauth-manager')
// registry.get() lanza error si no existe — pero no debería fallar
// porque google-apps es dependencia dura
```

**NOTA IMPORTANTE**: El ejecutor debe buscar TODAS las referencias a:
- `usingStandaloneAuth` (flag booleano) — eliminar el flag y todas las ramas condicionales
- `EmailOAuthManager` — eliminar todas las instanciaciones
- `email_oauth_tokens` — eliminar las queries de creación de tabla y lectura/escritura
- Rutas de consola para auth standalone de Gmail — eliminar o redirigir a google-apps

#### c. Eliminar creación de tabla `email_oauth_tokens`

Buscar en `init()` el bloque que crea `email_oauth_tokens` con `CREATE TABLE IF NOT EXISTS` y eliminarlo. La tabla puede quedar en la DB (inerte) — no es necesaria una migración para eliminarla.

#### d. Asegurar que EMAIL_ENABLED controla la activación

Verificar que el flujo sea:
```
1. init() → obtener OAuth de google-apps
2. Si OAuth no está conectado → log info, no iniciar polling
3. Si EMAIL_ENABLED=false → log info, no iniciar polling
4. Si OAuth conectado Y EMAIL_ENABLED=true → iniciar polling
```

La diferencia con el estado actual: antes, si el OAuth compartido no estaba disponible, se intentaba standalone. Ahora, si google-apps no tiene OAuth conectado, gmail simplemente espera. El admin conecta OAuth una vez en la página de Google Apps y todos los servicios (Drive, Sheets, Gmail) funcionan.

#### e. Limpiar rutas de API de auth standalone

Buscar en las `apiRoutes` del manifest rutas como:
- POST /auth/connect (standalone)
- POST /auth/disconnect (standalone)
- GET /auth/status (standalone)

Si estas rutas existen Y son específicas del path standalone, eliminarlas. Las rutas de auth deben ser del módulo google-apps. Gmail solo necesita sus rutas operacionales (poll-now, send, etc.).

**CUIDADO**: Verificar qué rutas son standalone vs compartidas. No eliminar rutas que el módulo necesita independientemente de OAuth (ej: GET /status para ver si el polling está activo).

### 2. `src/modules/gmail/email-oauth.ts` — ELIMINAR

Este archivo implementa `EmailOAuthManager` que gestiona tokens en `email_oauth_tokens`. Ya no es necesario.

**Antes de eliminar**, verificar que NINGÚN otro archivo lo importa excepto `manifest.ts`. Buscar:
```
grep -r "email-oauth" src/
grep -r "EmailOAuthManager" src/
```

### 3. `src/modules/gmail/CLAUDE.md` — Actualizar

Actualizar las secciones relevantes:

**Dependencias**: `depends: ['google-apps']` (era vacío)

**OAuth**: 
> Gmail usa EXCLUSIVAMENTE el OAuth compartido del módulo `google-apps`. No existe path standalone. La tabla `google_oauth_tokens` es la única fuente de credenciales. La tabla `email_oauth_tokens` es legacy inerte.

**Activación**:
> El polling se activa si: (1) google-apps tiene OAuth conectado, (2) los scopes incluyen gmail.*, (3) EMAIL_ENABLED=true.

---

## Lo que NO hacer

- **NO migrar tokens de `email_oauth_tokens` a `google_oauth_tokens`** — la tabla email está vacía (el audit lo confirma). No hay nada que migrar.
- **NO eliminar la tabla `email_oauth_tokens` de la DB** — dejarla inerte. Eliminar tablas requiere migración y puede causar errores si el código legacy la referencia en algún test.
- **NO modificar el módulo `google-apps`** — su OAuthManager ya soporta scopes de Gmail. No necesita cambios.
- **NO crear rutas de auth nuevas en gmail** — el admin gestiona OAuth desde google-apps.
- **NO hacer que EMAIL_ENABLED=false impida la carga del módulo** — el módulo se carga siempre (para que aparezca en consola), solo el polling se desactiva.

---

## Flujo post-fix

```
1. Admin va a Consola > Google Apps > Conectar
2. OAuth flow incluye scopes de Gmail (ya configurado)
3. Token guardado en google_oauth_tokens
4. Gmail module en init() obtiene OAuth via registry.get('google:oauth-manager')
5. Verifica EMAIL_ENABLED=true
6. Inicia polling
7. Emails llegan al pipeline
```

---

## Edge cases

1. **google-apps desconectado después de init()**: Si el admin desconecta OAuth mientras gmail está activo, las llamadas a Gmail API fallarán. Gmail debería manejar errores de auth gracefully (ya lo hace con exponential backoff en polling). No se necesita cambio aquí.

2. **EMAIL_FROM vacío**: El audit menciona que EMAIL_FROM está en blanco. Este es un config del módulo gmail. Verificar que si `EMAIL_FROM` está vacío, gmail intente obtener el email desde el token OAuth (el campo `email` en `google_oauth_tokens`). Si no puede, logear warning y no enviar emails salientes.

3. **Hot-reload de config**: Si el admin activa/desactiva EMAIL_ENABLED desde consola, el polling debería arrancar/parar. Verificar que el hook `console:config_applied` maneja esto.

---

## Checklist final
- [ ] `manifest.ts` tiene `depends: ['google-apps']`
- [ ] `init()` usa `registry.get('google:oauth-manager')` sin fallback standalone
- [ ] Flag `usingStandaloneAuth` eliminado + todas sus ramas
- [ ] Creación de tabla `email_oauth_tokens` eliminada del init
- [ ] `email-oauth.ts` eliminado
- [ ] No quedan imports de `email-oauth.ts` ni `EmailOAuthManager`
- [ ] Rutas de auth standalone eliminadas (si existían)
- [ ] EMAIL_ENABLED controla polling correctamente
- [ ] `CLAUDE.md` actualizado
- [ ] `tsc --noEmit` pasa sin errores
