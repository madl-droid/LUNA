# Auditoría: Módulos Feature & Tools
Fecha: 2026-03-26
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo

Los módulos feature y tools de LUNA (~15,500 LOC en ~50 archivos) presentan una arquitectura sólida con búsqueda híbrida funcional, scoring determinístico y buena integración de APIs externas. Sin embargo, existen **problemas críticos de seguridad** (SSRF en API connectors, credenciales en logs), **race conditions** en lead scoring y sync, **falta de validación de cron** en scheduled tasks, y **cero tests para Freshdesk**. Knowledge es el módulo más maduro pero tiene gaps en manejo de archivos grandes. Los 4 tests existentes (todos de Freight) son de buena calidad pero cubren solo ~15% del código auditable.

## Inventario

| Módulo/Tool | Archivos | LOC | Type | Estado |
|-------------|----------|-----|------|--------|
| knowledge | 20 | 4,974 | feature | Funcional, gaps en extractors |
| lead-scoring | 11 | 4,476 | feature | Funcional, race condition |
| tools | 6 | 1,240 | feature | Funcional, validación incompleta |
| scheduled-tasks | 7 | 1,641 | feature | Funcional, riesgos operacionales |
| freight (module+tool) | 8 | ~1,500 | feature+tool | Funcional, sin retries |
| freshdesk (module+tool) | 7 | ~850 | feature+tool | Funcional, sin tests |
| **Total** | **~59** | **~14,681** | — | — |

---

## Knowledge Base

### Fortalezas
- Búsqueda híbrida bien implementada: pgvector cosine + FTS PostgreSQL + FAQ FTS con pesos configurables
- Degradación elegante: si embeddings no disponibles → solo FTS con pesos ajustados
- Category boost via searchHint funciona correctamente
- Cache Redis con invalidación en cambios de core/categories/connectors
- Vectorize worker con BullMQ, mutex Redis para bulk, cooldown 1hr
- Sync manager soporta Drive + URLs con detección de cambios por hash
- 8 extractors cubren los formatos principales (md, pdf, docx, xlsx, csv, slides, imágenes)
- Chunking con overlap (1500 chars, 200 overlap) preserva contexto

### Problemas encontrados

**CRÍTICO — SSRF en API Connector** (api-connector.ts:73-74)
- `baseUrl` del connector se usa en fetch sin validar contra IPs privadas/internas
- Impacto: acceso a localhost, Redis, PostgreSQL, metadata de cloud (169.254.169.254)
- Recomendación: validar hostname contra lista de IPs privadas/reservadas

**CRÍTICO — Sin límite de tamaño en extractors** (image.ts:21, pdf.ts:9)
- Image extractor convierte a base64 sin validar tamaño → OOM en imágenes grandes (500MB → 666MB base64)
- PDF extractor no valida buffer antes de parsear → PDF bombs pueden expandir a GB en memoria
- Impacto: crash del servidor por OOM
- Recomendación: validar tamaño antes de cada extractor, no solo en addDocument()

**ALTO — Hash débil para cache de query embeddings** (search-engine.ts:182-191)
- Hash de 32 bits (djb2) para cache key → colisiones probables a escala (birthday paradox)
- Impacto: queries diferentes pueden retornar embeddings cacheados incorrectos
- Recomendación: usar SHA-256 truncado o incluir query completa en key

**ALTO — File orphaning en addDocument** (knowledge-manager.ts:101-126)
- writeFile() en línea 106 guarda archivo a disco, pero si insertDocument() falla después, el archivo queda huérfano
- Impacto: disco se llena con archivos sin referencia en DB
- Recomendación: try/catch con unlink() en caso de error de DB

**ALTO — FAQ import destructivo sin transacción** (faq-manager.ts:92-108)
- deleteAllFAQs() ejecuta antes de bulkInsertFAQs() sin transacción
- Si bulkInsertFAQs() falla, TODOS los FAQs se pierden sin rollback
- Impacto: pérdida total de FAQs en caso de error de inserción
- Recomendación: wrappear en transacción de DB

**ALTO — Vectorization jobs no cancelados al eliminar doc** (knowledge-manager.ts:134-138)
- enqueueDocument() puede tener job pendiente cuando removeDocument() elimina el doc
- Impacto: embeddings generados para documento inexistente, gasto de API innecesario
- Recomendación: cancelar jobs pendientes del docId antes de eliminar

**ALTO — No timeout en búsqueda híbrida** (search-engine.ts:55-61)
- Promise.all espera las 3 búsquedas sin timeout; si pgvector cuelga, toda la búsqueda se bloquea
- Recomendación: Promise.race con timeout de 5s

**MEDIO — categoryId ignorado en GET documents** (manifest.ts:80)
- Línea 80: `category: undefined` hardcodeado, ignora query param categoryId
- Impacto: filtro por categoría no funciona en API de documentos

**MEDIO — ivfflat vs hnsw** (pg-store.ts:93)
- Usa ivfflat para embeddings 1536-dim; hnsw generalmente tiene mejor recall para alta dimensionalidad
- Recomendación: benchmark ambos; considerar hnsw si recall >99% es prioritario

**MEDIO — Normalización de scores inestable** (search-engine.ts:128-138)
- Divide por maxScore, pero category boost (+0.2) se aplica antes → scores no lineales
- Impacto: docs con categoría boosteada pueden dominar resultados irrelevantes

**MEDIO — Rate limit no cuenta batch size** (embedding-service.ts:60,92)
- consumeToken() consume 1 token tanto para single como batch (hasta 100 textos)
- Impacto: rate limiting sub-enforced para batch requests

**BAJO — Modelo de embedding hardcodeado** (embedding-service.ts:8)
- `gemini-embedding-exp-03-07` no configurable; si Google depreca, requiere cambio de código
- Recomendación: agregar KNOWLEDGE_EMBEDDING_MODEL a configSchema

**BAJO — trackHits silencia errores** (knowledge-manager.ts:295)
- `.catch(() => {})` sin logging; si DB falla, métricas se pierden silenciosamente

### Extractors analysis

| Formato | Archivo | LOC | Funcional | Edge cases cubiertos | Issues |
|---------|---------|-----|-----------|---------------------|--------|
| Markdown/TXT/JSON | markdown.ts | 94 | ✓ | Medio | UTF-8 hardcoded, min chunk inconsistente (20 vs 30) |
| PDF | pdf.ts | 60 | ✓ | Bajo | Sin validación de tamaño, páginas cortas saltadas silenciosamente |
| DOCX | docx.ts | 54 | ✓ | Bajo | Regex de headings HTML naive, matching de secciones frágil |
| XLSX/CSV | xlsx.ts | 96 | ✓ | Medio | Sin límite de filas, matching de columnas case-insensitive OK |
| Slides | slides.ts | 76 | ✓ | Medio | Depende de servicio google:slides, marcador "---slide---" frágil |
| Image | image.ts | 80 | ✓ | Bajo | Sin límite de tamaño (CRÍTICO), base64 infla 33%, LLM sin retry |
| Chunker | chunker.ts | 88 | ✓ | Medio | 1500 chars/200 overlap, min 30 chars. Heading regex solo h1-h3 |
| Index | index.ts | 131 | ✓ | Parcial | Fallback a plaintext silencia errores de extracción reales |

### Search quality assessment
- **Hybrid scoring**: Vector (0.6) + FTS (0.3) + FAQ (0.1) — pesos razonables
- **Degraded mode**: FTS (0.8) + FAQ (0.2) — funcional sin embeddings
- **Category boost**: +0.2 al combinedScore — efectivo pero puede dominar
- **FAQ FTS**: tsquery sobre question+answer, sin embeddings — calidad aceptable
- **Cache**: Query embeddings en Redis 10min TTL — bueno para queries repetidas
- **Debilidad principal**: normalización por maxScore hace scores relativos, no absolutos

### Madurez: 3.5/5 (Knowledge)

---

## Lead Scoring

### Fortalezas
- Scoring 100% determinístico (código puro), LLM solo extrae datos
- 3 frameworks preconfigurados: CHAMP B2B, SPIN B2C, CHAMP+Gov B2G
- Criterios totalmente configurables: pesos, tipos (text/boolean/enum), stages
- Validación estricta de config (weights suman 100, enum options no vacías)
- Campaign matcher con fuse.js para fuzzy matching
- State machine de estados correcta con transiciones forward-only
- SQL seguro: todas las queries parametrizadas

### Problemas encontrados

**CRÍTICO — Race condition en scoring concurrente** (extract-tool.ts:200-281)
- Read-modify-write sin transacción ni lock. Dos mensajes simultáneos del mismo lead:
  1. Thread A lee qualification_data = {budget: 'low'}
  2. Thread B lee mismo state
  3. A extrae authority='manager', escribe {budget:'low', authority:'manager'}
  4. B extrae need='critical', escribe {budget:'low', need:'critical'} → PIERDE authority de A
- Impacto: pérdida de datos de calificación en escenarios de alto volumen
- Fix: SELECT ... FOR UPDATE dentro de transacción

**ALTO — Sin historial de scores** (extract-tool.ts, pg-queries.ts)
- Solo se guarda score actual (sobreescrito en cada update)
- Sin audit trail, sin timestamps de cambios, sin trend analysis
- Impacto: no se puede rastrear cómo llegó un lead a su score actual

**ALTO — Framework switch destruye criterios custom** (config-store.ts:122-125)
- applyFramework() reemplaza criteria array completo
- Si usuario tenía criterios custom + aplica CHAMP → custom borrados sin confirmación
- Recomendación: preguntar "¿Mantener criterios custom?" o merge

**MEDIO — Enum scoring asume orden ascendente** (scoring-engine.ts:201-209)
- `ratio = (idx + 1) / options.length` — primer option = peor, último = mejor
- Si usuario define ["high", "low", "medium"], scoring invierte la intención
- Recomendación: documentar claramente o permitir scoring manual por opción

**MEDIO — Campaign dedup falla con session_id NULL** (campaign-queries.ts:82-91)
- UNIQUE (contact_id, campaign_id, session_id) no deduplica si session_id es NULL (NULL ≠ NULL en SQL)
- Impacto: misma campaign se registra múltiples veces para mismo contacto

**BAJO — Errores silenciados en campaign queries** (campaign-queries.ts:47-50)
- `.catch(() => {})` en ALTER TABLE puede esconder errores reales (permisos, disco lleno)
- Recomendación: catch solo errores específicos (duplicate column)

### Madurez: 3.5/5 (Lead Scoring)

---

## Tools Registry

### Fortalezas
- Arquitectura limpia: registry en memoria + sync a DB + catálogo dinámico
- Conversión nativa a formatos Anthropic y Gemini (tool-converter.ts) — funciona con ambos providers
- Ejecución con retry exponencial configurable (tool-executor.ts), timeout por tool (default 30s)
- Access rules por contact_type (deny-list), ejecución paralela con límite de 5 calls por turno
- Sin operaciones peligrosas: no hay file access, shell exec, ni eval

### Problemas encontrados

**ALTO — Validación de inputs incompleta** (tool-registry.ts:365-368)
- validateRequired() solo verifica undefined/null, no valida tipos contra schema JSON
- Impacto: LLM puede pasar string donde se espera number; handler recibe datos inválidos

**ALTO — Timeout no cancela ejecución real** (tool-executor.ts:117-137)
- Promise-based timeout no cancela handler; sigue ejecutando en background
- Impacto: leak de recursos si tool es long-running

**ALTO — Fire-and-forget logging pierde datos** (pg-store.ts:221-240)
- logExecution() no awaited; si DB caída, logs se pierden sin alerta

**MEDIO — Cache de access rules sin invalidación** (tool-registry.ts:329-347)
- Sin TTL ni pub/sub; stale en deployments multi-instancia

### Tools registradas
- `search_knowledge` (knowledge), más tools dinámicas de freight, freshdesk, medilink, etc.

### Madurez: 3/5

---

## Scheduled Tasks

### Fortalezas
- 3 triggers: cron (BullMQ), event (hooks), manual (API)
- Acciones composables: tool, message, hook con placeholder {{result}}
- BullMQ persiste jobs en Redis, delayed jobs con retry exponencial
- Concurrencia configurable (default 3), console UI completa

### Problemas encontrados

**CRÍTICO — Cron no validado** (api-routes.ts:100-105)
- Cron string se guarda sin validar; BullMQ falla silenciosamente si inválido

**CRÍTICO — Sin control de presupuesto LLM** (executor.ts:48-51)
- Timeout 120s pero sin límite de tokens. 3 tasks concurrentes = costo ilimitado

**CRÍTICO — Event cascade infinito** (manifest.ts:117-130)
- Task por contact:new puede disparar otro contact:new → loop infinito

**ALTO — Sin overlap prevention** — cron tasks pueden ejecutar en paralelo sin lock
**ALTO — Delayed jobs huérfanos** (scheduler.ts:77-85) — no validados contra DB en restart
**ALTO — Sin DLQ** (scheduler.ts:42-49) — attempts:1, fallo permanente sin retry
**ALTO — Recipients silenciosamente vacíos** (executor.ts:223) — si users:db no disponible
**MEDIO — Prompt injection** (executor.ts:264-271) — task.name sin escape en prompt LLM

### Jobs definidos
- Dinámicos (creados por usuario), triggers: contact:new, contact:status_changed, message:incoming

### Madurez: 2.5/5

---

## Freight Tool

### Fortalezas
- 2 adapters: SeaRates (GraphQL) + DHL Express (REST) con base abstracta
- Router inteligente: selección de carrier por continente, peso, tipo de flete
- Validación de input con Zod (country codes, pesos, fechas)
- Buffer configurable sobre precio (margen de seguridad)
- Selección automática de container (ST20/ST40/HC40) por volumen
- Promise.allSettled para consulta paralela a carriers
- Health check per adapter

### Problemas encontrados

**ALTO — Sin retry en adapters** (searates-adapter.ts:224, dhl-adapter.ts:107)
- Single fetch attempt; network glitch = fallo inmediato
- Recomendación: exponential backoff (3 retries, 1s/2s/4s)

**ALTO — Credenciales en logs** (searates-adapter.ts:358, dhl-adapter.ts:220-222)
- Bearer token de SeaRates y Basic Auth de DHL pueden aparecer en error context
- Recomendación: redactar credenciales en pino serializer

**ALTO — Sin timeout a nivel de orquestación** (freight-tool.ts:188-208)
- Cada adapter tiene 10s timeout, pero sin timeout global para el tool completo

**MEDIO — Coordinate lookup case-sensitive** (searates-adapter.ts:377)
- known_origins hace match por nombre de ciudad case-sensitive; "São Paulo" ≠ "SAO PAULO"

**MEDIO — Transit days puede ser negativo** (dhl-adapter.ts:184-197)
- Calcula días desde delivery date sin timezone; puede reportar negativos si delivery es pasado

**BAJO — known_origins hardcodeado** (freight-tool.ts:114-119)
- San Diego, Shenzhen, Bogota como defaults; sin UI para agregar orígenes

### Test coverage

| Test file | Tests | Calidad | Cobertura |
|-----------|-------|---------|-----------|
| freight-tool.test.ts | 10 | Buena | Input validation, flujo completo, fallos parciales |
| freight-router.test.ts | 10 | Buena | Mapa continentes, LATAM, selección carrier, límites peso |
| searates-adapter.test.ts | 10 | Buena | canQuote, auto-rates, known_origins, errores, healthCheck |
| dhl-express-adapter.test.ts | 10 | Buena | canQuote, normalización productos, auth, URLs test/prod |

**Gaps**: Sin tests de timeout, concurrencia, floating-point edge cases, coordinate fallback

### Madurez: 3.5/5

---

## Freshdesk Tool

### Fortalezas
- Client HTTP con rate limiter sliding window (100 calls/min)
- Monitoreo de header x-ratelimit-remaining
- Cache de artículos en Redis con TTL configurable
- Sync completo con paginación a Redis pipeline
- Búsqueda in-memory con fuse.js (RAG local)
- Filtro por categorías en sync

### Problemas encontrados

**ALTO — Race condition en rate limiter** (freshdesk-client.ts:92-105)
- Check no atómico; 2 calls concurrentes pueden pasar ambas y exceder límite
- Recomendación: usar Redis INCR + TTL atómico

**ALTO — Event loop bloqueado por rate limit** (freshdesk-client.ts:100-101)
- Sleep lineal sin exponential backoff; bloquea event loop hasta 60s

**MEDIO — Paginación asume 30 items/page** (freshdesk-sync.ts:85)
- `hasMore = pageArticles.length >= 30`; si Freshdesk cambia page size, sync se rompe silenciosamente

**MEDIO — Fuse.js index no atómico** (freshdesk-rag.ts:14-16, 33-36)
- Estado global mutable sin locking; búsqueda durante rebuild puede dar resultados parciales

**MEDIO — Pipeline Redis sin verificación** (freshdesk-sync.ts:96-99)
- exec() no verificado; fallo parcial deja data inconsistente

**BAJO — Score threshold hardcodeado** (freshdesk-rag.ts:46)
- Threshold 0.5 para fuse.js no configurable

### Madurez: 2.5/5

---

## Tests Analysis

| Test file | Tests | Pass/Fail | Coverage | Quality |
|-----------|-------|-----------|----------|---------|
| freight-tool.test.ts | 10 | Asumido pass | ~80% del tool | Buena: valida input, flujo, errores |
| freight-router.test.ts | 10 | Asumido pass | ~90% del router | Buena: todos los paths de selección |
| searates-adapter.test.ts | 10 | Asumido pass | ~70% adapter | Buena: mock GraphQL, edge cases |
| dhl-express-adapter.test.ts | 10 | Asumido pass | ~70% adapter | Buena: mock REST, auth, URLs |

### ¿Qué falta por testear?
- **Freshdesk: 0 tests** — client, search, sync, RAG, get-article sin cobertura alguna
- **Knowledge: 0 tests** — 20 archivos, búsqueda híbrida, extractors, sync, cache sin tests
- **Lead Scoring: 0 tests** — scoring engine, extract tool, campaign matcher sin tests
- **Tools: 0 tests** — registry, executor, converter sin tests
- **Scheduled Tasks: 0 tests** — scheduler, executor, store sin tests
- **Timeouts/retries** no testeados en ningún módulo
- **Concurrencia/race conditions** no testeadas
- **Archivos corruptos** en extractors no testeados

---

## Bugs encontrados

| # | Severidad | Módulo | Archivo:Línea | Descripción | Impacto |
|---|-----------|--------|---------------|-------------|---------|
| 1 | CRÍTICO | knowledge | api-connector.ts:73 | SSRF: baseUrl no validado contra IPs privadas | Acceso a servicios internos |
| 2 | CRÍTICO | knowledge | image.ts:21 | Sin límite de tamaño antes de base64 | OOM en imágenes grandes |
| 3 | CRÍTICO | scheduled-tasks | api-routes.ts:100 | Cron no validado antes de guardar | Tasks que nunca ejecutan |
| 4 | CRÍTICO | scheduled-tasks | manifest.ts:117 | Event cascade sin límite de depth | Loop infinito, system hang |
| 5 | ALTO | lead-scoring | extract-tool.ts:200 | Race condition read-modify-write sin lock | Pérdida de datos de calificación |
| 6 | ALTO | knowledge | faq-manager.ts:92 | deleteAll + insert sin transacción | Pérdida total de FAQs si insert falla |
| 7 | ALTO | knowledge | search-engine.ts:182 | Hash 32-bit para cache key | Colisiones → embeddings incorrectos |
| 8 | ALTO | knowledge | manifest.ts:80 | categoryId hardcodeado a undefined | Filtro por categoría no funciona |
| 9 | ALTO | freight | searates-adapter.ts:358 | Bearer token en error context | Leak de credenciales en logs |
| 10 | ALTO | freshdesk | freshdesk-client.ts:92 | Rate limiter no atómico | Exceder límite de API |
| 11 | ALTO | scheduled-tasks | executor.ts:48 | Sin límite de tokens LLM | Costo ilimitado |
| 12 | ALTO | tools | tool-executor.ts:117 | Timeout no cancela handler | Resource leak |

---

## Riesgos de seguridad

| # | Severidad | Módulo | Descripción | Mitigación |
|---|-----------|--------|-------------|------------|
| 1 | CRÍTICO | knowledge | SSRF via API connectors (fetch a IPs internas) | Validar baseUrl contra privadas/reservadas |
| 2 | ALTO | freight | Credenciales SeaRates/DHL en logs de error | Pino redaction serializer |
| 3 | ALTO | scheduled-tasks | Prompt injection via task.name en system prompt | Escapar/sanitizar inputs en prompts |
| 4 | ALTO | knowledge | PDF bombs → OOM (sin validación de tamaño en extractors) | Validar buffer.length antes de cada extractor |
| 5 | MEDIO | freshdesk | API key en memoria sin rotación | Documentar rotación; considerar vault |
| 6 | MEDIO | scheduled-tasks | Event cascade → DoS interno | Depth limit en recursión de eventos |

---

## Deuda técnica

| # | Prioridad | Módulo | Descripción | Esfuerzo |
|---|-----------|--------|-------------|----------|
| 1 | Alta | todos | 0 tests fuera de freight (40 tests / ~14,600 LOC = 0.3%) | 5-8 días |
| 2 | Alta | knowledge | Extractors sin validación de tamaño por formato | 1 día |
| 3 | Alta | lead-scoring | Sin historial de scores | 1-2 días |
| 4 | Alta | scheduled-tasks | Sin DLQ ni retry para cron tasks | 1 día |
| 5 | Media | knowledge | ivfflat → hnsw benchmark pendiente | 0.5 días |
| 6 | Media | knowledge | Modelo de embedding hardcodeado | 0.5 días |
| 7 | Media | tools | Validación de params contra JSON Schema | 1 día |
| 8 | Media | freight | Retry logic en adapters | 1 día |
| 9 | Baja | knowledge | Encoding detection en extractors (solo UTF-8 hoy) | 1-2 días |
| 10 | Baja | freshdesk | Rate limiter atómico con Redis | 0.5 días |

---

## Madurez general features: 3/5

El sistema es funcional y cubre los casos de uso principales, pero tiene gaps significativos en seguridad (SSRF), resiliencia (sin retries, sin DLQ), y testing (4 tests para ~14,600 LOC). La arquitectura modular es sólida y permite mejoras incrementales.

---

## Top 10 recomendaciones (ordenadas por impacto)

1. **Corregir SSRF en API connectors** — validar baseUrl contra IPs privadas (knowledge/api-connector.ts:73)
2. **Agregar transacción + lock en lead scoring** — prevenir race condition que pierde datos (extract-tool.ts:200)
3. **Validar cron expressions** — usar cron-parser antes de guardar (scheduled-tasks/api-routes.ts:100)
4. **Agregar límite de depth en event cascade** — prevenir loop infinito (scheduled-tasks/manifest.ts:117)
5. **Validar tamaño de archivo en cada extractor** — prevenir OOM en imágenes/PDFs grandes
6. **Wrappear FAQ import en transacción** — prevenir pérdida de FAQs (faq-manager.ts:92)
7. **Redactar credenciales en logs** — prevenir leak de API keys en error context
8. **Agregar retry con backoff en freight adapters** — mejorar resiliencia ante fallos transitorios
9. **Agregar tests para Freshdesk, Knowledge, Lead Scoring** — de 0% a al menos 50% cobertura
10. **Configurar DLQ + retry para scheduled tasks** — prevenir fallos permanentes silenciosos
