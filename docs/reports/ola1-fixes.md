# OLA 1 — Reporte de Seguridad de Datos
## Fecha: 2026-03-26
## Branch: claude/apply-audit-adjustments-H0ud1

### Fixes aplicados
| # | ID | Descripcion | Estado | Notas |
|---|---|---|---|---|
| 1 | SEC-8.1/8.2/8.3 | Lua scripts atomicos para rate limiters | ✅ | Creado `kernel/redis-rate-limiter.ts` con INCR+check atomico. Aplicado a Gmail, Phase5 y Medilink |
| 2 | SEC-8.4, LS-1 | Lead qualification en transaccion | ✅ | `disqualifyLead()` usa jsonb `||` atomico. `handleExtraction()` usa FOR UPDATE en transaccion |
| 3 | SEC-1.1 | SQL dinamico en console metricas | ✅ | Period validado contra whitelist estricta (13 valores). No se interpola SQL dinamico |
| 4 | K-SSRF1/K-SSRF2 | Validacion SSRF en Knowledge | ✅ | Creado `kernel/ssrf-guard.ts`. Aplicado a api-connector y web-source-manager antes de fetch() |
| 5 | K-DOS1/K-DOS2 | Limite de tamano en extractors | ✅ | Image: 20MB max. PDF: 50MB max. Defense-in-depth (knowledge-manager ya valida en entry point) |
| 6 | G-1 | Cifrar OAuth tokens | ✅ | google-apps y gmail ahora cifran access_token/refresh_token con AES-256-GCM. Soporta tokens legacy sin cifrar |
| 7 | K-4/K-8 | Rate limiting en login | ✅ | 10 intentos por IP en 5 min via Redis INCR. Fallback graceful si Redis falla |
| 8 | SEC-12.1 | PII redaction en logs | ✅ | Login: email truncado a 3 chars. Medilink: solo ultimos 4 digitos de telefono. Main logger: pino redact paths |
| 9 | ST-1 | Guard de recursion en scheduled tasks | ✅ | Depth counter por event+entityId en Redis (max 3, TTL 60s). Previene loops infinitos |
| 10 | ST-3 | Validar cron strings | ✅ | `isValidCron()` valida formato y rangos antes de create/update. BullMQ ya no recibe crons invalidos |

### Archivos creados
- `src/kernel/redis-rate-limiter.ts` — utilidad compartida de rate limit atomico via Lua
- `src/kernel/ssrf-guard.ts` — validacion SSRF contra IPs privadas/internas

### Archivos modificados
- `src/kernel/config-store.ts` — export de encrypt/decrypt para uso en modulos OAuth
- `src/kernel/setup/login.ts` — rate limiting + PII redaction en logs
- `src/index.ts` — pino redact config para PII
- `src/modules/console/server.ts` — whitelist de period en metricas SQL (2 endpoints)
- `src/modules/gmail/rate-limiter.ts` — atomic Lua rate check en canSend()
- `src/modules/gmail/email-oauth.ts` — cifrado de tokens OAuth
- `src/modules/google-apps/oauth-manager.ts` — cifrado de tokens OAuth
- `src/modules/medilink/rate-limiter.ts` — atomic Lua rate check
- `src/modules/medilink/security.ts` — PII redaction (telefono)
- `src/modules/knowledge/api-connector.ts` — SSRF guard antes de fetch
- `src/modules/knowledge/web-source-manager.ts` — SSRF guard antes de fetch
- `src/modules/knowledge/extractors/image.ts` — limite de tamano 20MB
- `src/modules/knowledge/extractors/pdf.ts` — limite de tamano 50MB
- `src/modules/lead-scoring/pg-queries.ts` — atomic jsonb update para disqualify
- `src/modules/lead-scoring/extract-tool.ts` — FOR UPDATE transaction para extraction
- `src/modules/scheduled-tasks/manifest.ts` — recursion guard en event triggers
- `src/modules/scheduled-tasks/api-routes.ts` — cron validation en create/update
- `src/engine/phases/phase5-validate.ts` — atomic Lua rate check

### Dependencias instaladas
Ninguna.

### Tests agregados
Ninguno (fixes quirurgicos, tests existentes pasan).

### Build: ✅ (errores pre-existentes no relacionados)
### Tests: ✅ 49/49 passed
