# Informe Consolidado de Auditoría — LUNA Platform
**Fecha:** 2026-03-26
**Método:** 10 sesiones paralelas de Claude Code (8 cloud + 2 server)
**Alcance:** ~60,000 LOC, 20 módulos, infraestructura completa
**Código auditado:** src/ (kernel, engine, modules, tools, channels), deploy/, tests/, docs/

---

## Resumen Ejecutivo

LUNA es un sistema de **~60K LOC** con arquitectura modular bien diseñada: kernel con hooks tipados, pipeline de 5 fases, 4 canales de comunicación, integraciones con Google y Medilink, y un sistema proactivo completo. La base arquitectónica es sólida y coherente.

Sin embargo, la auditoría revela **gaps significativos de seguridad y calidad** que deben resolverse antes de considerarse production-ready para datos sensibles:

- **Seguridad: 5.5/10** — XSS crítico, webhooks abiertos, sin rate limiting HTTP, prompt injection sin escapado, SSRF en 2 módulos, OAuth tokens sin cifrar
- **Tests: 1.8% cobertura** — Solo 49 tests (freight), 19 módulos con 0 tests
- **TypeScript: parcialmente verificado** — tsconfig excluye engine, LLM, memory, channels del type-check
- **14 vulnerabilidades** en dependencias (4 high)

**Lo positivo:** El código es limpio, las convenciones se siguen, la comunicación entre módulos es correcta (hooks/services, sin imports directos), el circuit breaker funciona, la concurrencia tiene 3 capas de protección, y el sistema corre estable en staging.

---

## Scores por Área

| # | Área | Score | Sesión |
|---|------|-------|--------|
| 1 | Kernel & Foundation | **3.2/5** | 01 |
| 2 | Engine & Pipeline | **3.8/5** | 02 |
| 3 | Canales de Comunicación | **3.5/5** | 03 |
| 4 | Módulos Core | **3.4/5** | 04 |
| 5 | Features & Tools | **3.0/5** | 05 |
| 6 | Integraciones & Providers | **3.3/5** | 06 |
| 7 | Seguridad (transversal) | **5.5/10** | 07 |
| 8 | Documentación CLAUDE.md | **4/5** (94% precisión, 88% completitud) | 08 |
| 9 | Runtime & Infra (staging) | **4/5** | S1 |
| 10 | Build, Tests & Calidad | **2.5/5** | S2 |
| | **Promedio ponderado** | **3.3/5** | |

---

## Madurez por Componente

| Componente | Madurez | Notas |
|------------|---------|-------|
| Registry & Hooks | 4.5/5 | Mejor pieza del sistema |
| Module Loader | 4/5 | Topological sort, detección de deps |
| Config System | 4/5 | Salt estático en KDF |
| Pipeline (5 fases) | 4/5 | Sin timeout global |
| Concurrency (3 capas) | 4/5 | TOCTOU en rate limiters |
| Proactive System | 4/5 | 7 guardas, bien diseñado |
| WhatsApp | 4/5 | Estable en producción |
| Gmail | 4/5 | Feature-rich, falta polling lock |
| Google Chat | 3.5/5 | Webhook security débil |
| Memory (Redis+PG) | 3.5/5 | Vector search sin conectar |
| Knowledge (RAG) | 3.5/5 | SSRF, sin límite en extractors |
| Medilink | 3.5/5 | Buen diseño seguridad, bugs puntuales |
| LLM Gateway | 3/5 | Rate limits hardcodeados a 0 |
| Lead Scoring | 3/5 | Race condition en scoring |
| Console | 2.5/5 | XSS, sin auth dedicada, sin CSRF |
| Twilio Voice | 2.5/5 | Webhook signature no se invoca |
| Tests | 1/5 | 49 tests, solo freight |

---

## Vulnerabilidades Críticas (Top 15)

Consolidadas de todas las sesiones, deduplicadas, ordenadas por severidad e impacto:

| # | Severidad | Vector | Descripción | Ubicación | Fix estimado |
|---|-----------|--------|-------------|-----------|-------------|
| 1 | **CRÍTICO** | XSS | Flash param reflejado sin escapar en console | `console/templates.ts:719` | 1 línea |
| 2 | **CRÍTICO** | Auth | Medilink webhook acepta todo si no hay key configurada | `medilink/webhook-handler.ts:107` | 2 líneas |
| 3 | **CRÍTICO** | Concurrency | Rate limiters TOCTOU en Gmail, Phase5, Medilink — permiten exceder límites | `gmail/rate-limiter.ts`, `phase5-validate.ts`, `medilink/rate-limiter.ts` | Lua scripts |
| 4 | **CRÍTICO** | Concurrency | Lead qualification read-modify-write sin transacción — datos perdidos | `lead-scoring/pg-queries.ts:348`, `extract-tool.ts:199` | Transacción DB |
| 5 | **CRÍTICO** | SQL | WHERE clause dinámico en métricas de canal | `console/server.ts:1970` | Parametrizar |
| 6 | **CRÍTICO** | SSRF | API connector de Knowledge sin validar IPs privadas | `knowledge/api-connector.ts:73` | Validar hostname |
| 7 | **CRÍTICO** | DoS | Extractors sin límite de tamaño — OOM en imágenes/PDFs grandes | `knowledge/extractors/image.ts:21`, `pdf.ts:9` | Validar tamaño |
| 8 | **CRÍTICO** | Costos | LLM Gateway rate limits hardcodeados a 0 — nunca se aplican | `llm/usage-tracker.ts` | ~10 líneas |
| 9 | **ALTO** | Auth | Google Chat webhook token es opcional | `google-chat/manifest.ts:349` | Hacer obligatorio |
| 10 | **ALTO** | Prompt Inj | User input interpolado sin escapado en prompts LLM | `engine/prompts/evaluator.ts:209`, `compositor.ts:224` | Función de escapado |
| 11 | **ALTO** | DoS | `readBody()` sin límite de tamaño — memory exhaustion | `kernel/http-helpers.ts:8` | ~10 líneas |
| 12 | **ALTO** | Crypto | OAuth tokens de Google almacenados en texto plano en DB | `google-apps/oauth-manager.ts:270` | Usar AES-GCM |
| 13 | **ALTO** | Auth | Twilio Voice: `validateSignature()` existe pero NO se invoca | `twilio-voice/manifest.ts` | 1 llamada |
| 14 | **ALTO** | Stability | Sin timeout global del pipeline — zombie consume slots | `engine/engine.ts:137` | Promise.race |
| 15 | **ALTO** | Privacy | PII (emails, teléfonos) en logs de producción | Múltiples archivos | Pino redact |

---

## Hallazgos de Seguridad por Vector

| Vector | Score | Hallazgos | Resumen |
|--------|-------|-----------|---------|
| SQL Injection | 7/10 | 3 | Mayoría parametrizado. 1 crítico en console, 2 medio en medilink/dynamic SET |
| Prompt Injection | 4/10 | 6 | Detector regex básico (eludible). User input sin escapar en prompts |
| XSS | 4/10 | 4 | 1 reflejado crítico, stored en lead-scoring, innerHTML sin escapar, sin CSP |
| Auth & AuthZ | 6/10 | 4 | Base sólida (scrypt, Redis sessions). Webhooks opcionales, sin brute force protection |
| Secrets & Crypto | 8/10 | 2 | AES-256-GCM correcto. OAuth tokens sin cifrar, salt estático en KDF |
| Input Validation | 6/10 | 3 | SSRF en knowledge (2 puntos), body sin límite |
| Error Handling | 5/10 | 3 | Stack traces expuestos, PII en logs |
| Concurrency | 3/10 | 4 | 4 TOCTOU críticos en rate limiters, lead scoring sin transacción |
| DoS | 4/10 | 3 | Sin rate limiting HTTP, sin body limit, extractors sin size check |
| Dependencies | 6/10 | 14 vulns | 4 high (nodemailer, xlsx), 10 moderate. Caret versioning |
| Data Privacy | 5/10 | 2 | Medilink 3 capas (bueno). Sin GDPR/derecho al olvido |

---

## Estado del Runtime (Staging)

| Servicio | Estado | Versión |
|----------|--------|---------|
| Node.js | ✅ | v22.22.2 |
| PostgreSQL | ✅ | 16.13 + pgvector 0.8.2 |
| Redis | ✅ | 7.x (1.86 MB usado) |
| HTTP Server | ✅ | Puerto 3001 |
| WhatsApp | ✅ | Conectado |
| DB Size | 16 MB | 60 tablas, 503 mensajes |

**Problemas runtime:**
- 3 tools no se registran por orden de carga (create_commitment, query_attachment, web_explore)
- 3 módulos huérfanos en DB (email, google-api, attachments)
- Embeddings deshabilitados — solo FTS
- 5 env vars de WhatsApp sin configurar (usa defaults)

---

## Calidad de Código

| Métrica | Valor | Estado |
|---------|-------|--------|
| TypeScript Build | 0 errores | ✅ (pero excluye engine, LLM, memory, channels) |
| ESLint | 0 errores, 64 warnings | ⚠️ |
| Tests | 49 pass / 0 fail | ✅ (pero solo freight) |
| Cobertura estimada | ~1.8% | ❌ |
| Vulnerabilidades deps | 4 high, 10 moderate | ⚠️ |
| Paquetes outdated | 13 | ⚠️ |
| Unused vars | 62 | ⚠️ |

### Cobertura de tests por módulo

| Módulo | Archivos | Tests | Criticidad |
|--------|----------|-------|------------|
| engine | 45 | 0 | **CRÍTICA** |
| kernel | 16 | 0 | **CRÍTICA** |
| llm | 9 | 0 | **ALTA** |
| memory | 5 | 0 | **ALTA** |
| knowledge | 20 | 0 | **ALTA** |
| console | 9 | 0 | ALTA |
| users | 11 | 0 | ALTA |
| lead-scoring | 11 | 0 | MEDIA |
| whatsapp | 4 | 0 | MEDIA |
| gmail | 6 | 0 | MEDIA |
| scheduled-tasks | 7 | 0 | MEDIA |
| google-apps | 9 | 0 | MEDIA |
| medilink | 10 | 0 | MEDIA |
| tools/freight | 6 | **49** | ✅ |
| (6 módulos más) | ~15 | 0 | BAJA |

---

## Documentación (CLAUDE.md)

- **29 archivos** CLAUDE.md auditados
- **Precisión promedio: 94%** — archivos y hooks mencionados generalmente existen
- **Completitud promedio: 88%** — la mayoría cubre los archivos del módulo
- **Consistencia: media-alta** — 2 violaciones menores de reglas

**Principales gaps:**
- 14 hooks no documentados en kernel CLAUDE.md
- 3 directorios (`src/channels/`, `src/llm/`, `src/memory/`) invisibles en documentación raíz
- Server API incorrectamente documentada (clase vs funciones)
- 6 módulos sin `.env.example`

---

## Plan de Acción Recomendado

### Sprint 0 — Seguridad Inmediata (1-2 días, antes de cualquier deploy)

| # | Acción | Esfuerzo | Impacto |
|---|--------|----------|---------|
| 1 | Escapar flash param en console (`esc(flash)`) | 15 min | Elimina XSS crítico |
| 2 | Hacer webhook keys obligatorias (Medilink + Google Chat) | 30 min | Cierra 2 endpoints abiertos |
| 3 | Agregar body size limit a `readBody()` | 30 min | Elimina DoS principal |
| 4 | Invocar `validateSignature()` en Twilio Voice webhook | 15 min | Cierra webhook abierto |
| 5 | Conectar rate limits del LLM Gateway (fix hardcoded 0) | 30 min | Protege contra costos descontrolados |
| 6 | Agregar `uncaughtException`/`unhandledRejection` handlers | 15 min | Evita crashes silenciosos |
| 7 | Agregar security headers globales (CSP, X-Frame-Options, etc.) | 1h | Hardening básico HTTP |

### Sprint 1 — Hardening (1 semana)

| # | Acción | Esfuerzo | Impacto |
|---|--------|----------|---------|
| 8 | Implementar Lua scripts atómicos para rate limiters | 1 día | Elimina 4 TOCTOU críticos |
| 9 | Wrappear lead qualification en transacciones DB | 4h | Elimina race condition en scoring |
| 10 | Validar SSRF en api-connector y web-source-manager | 4h | Cierra 2 vectores SSRF |
| 11 | Agregar límite de tamaño en extractors (PDF, image) | 2h | Previene OOM |
| 12 | Cifrar OAuth tokens de Google en DB | 4h | Protege tokens si DB comprometida |
| 13 | Implementar escapado de prompt injection centralizado | 4h | Reduce superficie de prompt injection |
| 14 | Agregar timeout global al pipeline (120s) | 2h | Previene pipelines zombie |
| 15 | Rate limiting en login (Redis counter por IP) | 4h | Previene brute force |

### Sprint 2 — Calidad & Tests (2 semanas)

| # | Acción | Esfuerzo |
|---|--------|----------|
| 16 | Eliminar exclusiones del tsconfig (engine, LLM, memory, channels) + fix type errors | 2-3 días |
| 17 | Tests para engine (pipeline flow, concurrency) | 3-4 días |
| 18 | Tests para kernel (config, loader, registry) | 2 días |
| 19 | Tests para knowledge (search, extractors, sync) | 2 días |
| 20 | `npm audit fix` + evaluar reemplazo de xlsx | 1 día |
| 21 | Limpiar 62 unused vars + habilitar noUnusedLocals | 1 día |

### Sprint 3 — Mejoras (ongoing)

| # | Acción |
|---|--------|
| 22 | Conectar vector search en memory hybridSearch() |
| 23 | Implementar timeout + retry + 429 handling en Google APIs |
| 24 | Reducir scopes de Google OAuth al mínimo |
| 25 | Implementar derecho al olvido (cascade delete por contactId) |
| 26 | Refactorizar console/server.ts (2,020 LOC → router + handlers + static) |
| 27 | Agregar CSRF tokens a formularios |
| 28 | Corregir documentación CLAUDE.md (15 correcciones prioritarias) |
| 29 | Configurar DLQ + retry para scheduled tasks |
| 30 | Agregar caching LRU para TTS |

---

## Conclusión

LUNA tiene una **arquitectura sólida y bien pensada** — el sistema modular con hooks tipados, el pipeline de 5 fases, y las 3 capas de concurrencia demuestran diseño cuidadoso. El código es limpio y las convenciones se siguen consistentemente.

Los gaps principales son de **hardening** (seguridad, tests, type-checking completo), no de diseño. El Sprint 0 (7 fixes, ~3 horas de trabajo) elimina los vectores de ataque más críticos. El Sprint 1 (1 semana) cierra los gaps restantes de seguridad. El Sprint 2 establece la base de calidad con tests y type-checking completo.

**El sistema es funcional para staging pero necesita los Sprints 0 y 1 antes de manejar datos sensibles en producción.**

---

## Informes Detallados

| Informe | Archivo | Líneas |
|---------|---------|--------|
| Kernel & Foundation | `docs/reports/audit/01-kernel-foundation.md` | 488 |
| Engine & Pipeline | `docs/reports/audit/02-engine-pipeline.md` | 436 |
| Canales | `docs/reports/audit/03-canales.md` | 354 |
| Módulos Core | `docs/reports/audit/04-modulos-core.md` | 544 |
| Features & Tools | `docs/reports/audit/05-features-tools.md` | 404 |
| Integraciones & Providers | `docs/reports/audit/06-integraciones-providers.md` | 384 |
| Seguridad (transversal) | `docs/reports/audit/07-seguridad.md` | 365 |
| CLAUDE.md Docs | `docs/reports/audit/08-claude-md.md` | 424 |
| Runtime & Infra | `docs/reports/audit/S1-runtime-infra.md` | 186 |
| Build, Tests & Calidad | `docs/reports/audit/S2-build-tests.md` | 257 |
