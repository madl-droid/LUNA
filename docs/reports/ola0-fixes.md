# OLA 0 — Reporte de Fixes de Emergencia
## Fecha: 2026-03-26
## Branch: claude/apply-audit-adjustments-H0ud1

### Fixes aplicados
| # | ID | Descripción | Estado | Notas |
|---|---|---|---|---|
| 1 | SEC-3.1 | XSS en flash param | ✅ | `renderFlash()` fallback ahora usa `esc()` para escapar HTML |
| 2 | SEC-4.1 | Medilink webhook acepta todo sin key | ✅ | Invertido: sin key = rechaza con warning log |
| 3 | SEC-4.2 | Google Chat webhook token opcional | ✅ | Sin token configurado = rechaza con warning log |
| 4 | TV-1 | Twilio Voice signature no se invoca | ✅ | `validateSignature()` ahora se llama en `webhook/incoming` antes de procesar |
| 5 | SEC-9.1 | readBody sin límite de tamaño | ✅ | Agregado param `maxBytes` (default 10MB), destruye request al exceder |
| 6 | K-1 | Pool PG sin error handler | ✅ | `pool.on('error')` agregado inmediatamente después de crear el pool |
| 7 | K-2 | Redis sin error handler | ✅ | Agregados handlers `error`, `close`, `reconnecting` |
| 8 | K-3 | Sin handlers de errores globales | ✅ | `uncaughtException` + `unhandledRejection` antes de `main()` |
| 9 | K-5 | Security headers | ✅ | X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy en todas las respuestas |
| 10 | K-6 | HTTP server sin timeouts | ✅ | requestTimeout=30s, headersTimeout=15s, keepAliveTimeout=5s |
| 11 | LLM-1 | Rate limits hardcodeados a 0 | ✅ | `getRpmLimit()`/`getTpmLimit()` ahora leen de config (LLM_RPM_ANTHROPIC, etc.) |
| 12 | — | npm audit fix | ✅ | Resolvió flatted y picomatch. Quedan: eslint/vite (dev), xlsx (sin fix) |
| 13 | — | Patches seguros de dependencias | ✅ | bullmq, ioredis, twilio, ws, varlock actualizados |

### Fixes no aplicados (con razón)
Ninguno. Todos los 13 fixes fueron aplicados exitosamente.

### Archivos modificados
- `src/modules/console/templates.ts` — FIX 1: escape de flash param
- `src/modules/medilink/webhook-handler.ts` — FIX 2: reject sin key
- `src/modules/google-chat/adapter.ts` — FIX 3: reject sin token
- `src/modules/twilio-voice/manifest.ts` — FIX 4: signature validation en webhook/incoming
- `src/kernel/http-helpers.ts` — FIX 5: maxBytes en readBody
- `src/kernel/db.ts` — FIX 6: pool error handler
- `src/kernel/redis.ts` — FIX 7: redis error/close/reconnecting handlers
- `src/index.ts` — FIX 8: uncaughtException + unhandledRejection
- `src/kernel/server.ts` — FIX 9: security headers + FIX 10: timeouts
- `src/modules/llm/llm-gateway.ts` — FIX 11: rate limits desde config
- `package-lock.json` — FIX 12 + 13: dependency updates

### Vulnerabilidades residuales (no resolubles)
- `xlsx` — Prototype Pollution + ReDoS (no fix available, considerar migrar a SheetJS Pro o xlsx-populate)
- `eslint`/`vite`/`vitest` — moderate (dev dependencies, no afectan producción)
- `nodemailer` — fix requiere breaking change (evaluar en update mayor)

### Build: ✅ (errores pre-existentes en src/tools/freight/, src/tools/freshdesk/, src/modules/whatsapp/ — no relacionados)
### Tests: ✅ 49/49 passed
### Lint: no ejecutado (no hay script lint configurado)
