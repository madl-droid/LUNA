# Auditoría Exhaustiva — Módulos Core de LUNA

**Fecha**: 2026-03-26
**Alcance**: 6 módulos core (~14,900 LOC, ~41 archivos)
**Método**: Lectura completa de cada archivo en bloques ≤200 líneas, análisis estático manual

---

## 1. Resumen Ejecutivo

Se auditaron los 6 módulos que forman la columna vertebral de LUNA: **LLM Gateway**, **Memory**, **Users**, **Console**, **Prompts** y **Model Scanner**. En total ~14,900 líneas de TypeScript distribuidas en ~41 archivos.

**Hallazgos principales:**

- **2 vulnerabilidades de seguridad críticas**: consola sin autenticación/CSRF y comparación de tokens webhook vulnerable a timing attacks.
- **1 bug crítico**: los rate limits del LLM Gateway están hardcodeados a 0 — nunca se aplican los límites configurados por env vars.
- **1 SQL injection potencial**: interpolación de string en intervalo temporal en `llm/pg-store.ts` (riesgo mitigado por mapping interno, pero patrón peligroso).
- **Búsqueda vectorial infrautilizada**: `memory-manager.ts` no invoca `searchSummariesVector()` a pesar de que existe en pg-store.
- **HTML escaping incompleto**: la función `esc()` de console no escapa `>` ni `'`, dejando superficie para XSS en edge cases.
- **Buenas prácticas generales**: queries SQL parametrizadas ($1, $2), comunicación entre módulos vía hooks/services (sin imports directos entre módulos), circuit breaker bien implementado, arquitectura modular sólida.

**Madurez global estimada**: **3.4 / 5** — Arquitectura madura con gaps importantes en seguridad de la consola y enforcement de límites.

---

## 2. Inventario de Archivos

| Módulo | Archivos | LOC aprox. | Tipo |
|--------|----------|------------|------|
| **LLM Gateway** | 9 | 2,666 | `provider` |
| **Memory** | 5 | 1,747 | `core-module` |
| **Users** | 11 | 2,979 | `core-module` |
| **Console** | 9 | 6,504 | `core-module` |
| **Prompts** | 4 | 635 | `core-module` |
| **Model Scanner** | 2 | 383 | `feature` |
| **TOTAL** | **40** | **~14,914** | — |

### Detalle por módulo

**LLM Gateway** (src/modules/llm/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| types.ts | 325 | Tipos, interfaces, DEFAULT_COST_TABLE |
| circuit-breaker.ts | 212 | Circuit breaker con rolling window |
| security.ts | 130 | Detección inyección, sanitización |
| task-router.ts | 297 | Routing por tarea con fallback chain |
| providers.ts | 345 | Adapters Anthropic + Google |
| usage-tracker.ts | 310 | Rate limits Redis + costos PG |
| pg-store.ts | 239 | Persistencia SQL de uso/stats |
| llm-gateway.ts | 495 | Orquestador principal |
| manifest.ts | 313 | Config, console, API routes, init |

**Memory** (src/modules/memory/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| types.ts | 266 | StoredMessage, SessionSummary, ContactMemory, Commitment |
| manifest.ts | 132 | Config (20+ params), init/stop |
| redis-buffer.ts | 155 | Buffer circular, metadata, cache |
| memory-manager.ts | 393 | Orquestador Redis-first + PG |
| pg-store.ts | 801 | CRUD completo, FTS, vector search |

**Users** (src/modules/users/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| types.ts | 164 | UserType, UserResolution, permisos |
| manifest.ts | 168 | Init, 5 services expuestos |
| resolver.ts | 165 | Cache → DB → lead fallback |
| permissions.ts | 82 | Permisos por tipo de usuario |
| cache.ts | 85 | Redis cache con SCAN invalidation |
| db.ts | 715 | DDL, migrations, CRUD transaccional |
| webhook-handler.ts | 556 | Registro de leads vía webhook |
| sync/api-handler.ts | 628 | 12+ API routes CRUD |
| sync/csv-import.ts | 190 | Parser CSV con quoted fields |
| sync/sheet-sync.ts | 205 | Sync Google Sheets |

**Console** (src/modules/console/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| manifest.ts | 40 | Registro de service |
| manifest-ref.ts | 15 | Singleton mutable de Registry |
| server.ts | 2,020 | Router HTTP, POST handlers, static |
| templates.ts | 722 | Layout, sidebar, header |
| templates-fields.ts | 216 | Render de campos + esc() |
| *(+4 archivos adicionales de templates/assets)* | ~3,491 | Templates de páginas específicas |

**Prompts** (src/modules/prompts/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| types.ts | 39 | PromptSlot, PromptsService |
| manifest.ts | 255 | Console fields, sync bidireccional |
| prompts-service.ts | 248 | Cache in-memory, seed, evaluator |
| pg-queries.ts | 93 | CRUD prompt_slots |

**Model Scanner** (src/modules/model-scanner/)
| Archivo | LOC | Descripción |
|---------|-----|-------------|
| scanner.ts | 286 | Scan APIs, auto-replace, .env update |
| manifest.ts | 98 | Config, API routes, init/stop |

---

## 3. Análisis por Módulo

### 3.1 LLM Gateway (`src/modules/llm/`)

**Propósito**: Gateway unificado para LLM providers (Anthropic, Google). Routing por tarea, circuit breaker, rate limiting, tracking de uso/costos, seguridad de prompts.

#### Fortalezas

1. **Circuit breaker robusto** (`circuit-breaker.ts`): Implementación correcta con 3 estados (closed/open/half-open), rolling window para tracking de fallas, y CircuitBreakerManager que gestiona instancias por provider. Configuración por env vars (umbrales, timeouts).

2. **Task router con fallback chain** (`task-router.ts`): Cada tarea (classify, respond, complex, tools, compress, proactive) mapea a provider+modelo específico con fallback configurable. Deduplicación de providers en la cadena de intento.

3. **Tracking de uso completo** (`usage-tracker.ts`): Contadores Redis para RPM/TPM en tiempo real + persistencia en PG para historial. Cálculo de costos por modelo con DEFAULT_COST_TABLE. Cleanup periódico de contadores expirados.

4. **Seguridad de prompts** (`security.ts`): Detección de patrones de inyección (role manipulation, system override, jailbreak), sanitización de respuestas (remoción de datos sensibles como SSN, tarjetas, emails internos), preamble de seguridad inyectado en requests.

5. **Providers bien abstraídos** (`providers.ts`): Interface `ProviderAdapter` con implementaciones para Anthropic y Google. Timeout via AbortController. Soporte multimodal (imágenes en content).

6. **Console UI completa** (`manifest.ts`): 8 API routes para status, stats, modelos, budgets. Console fields para todas las config vars.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| L1 | **CRÍTICO** | llm-gateway.ts:481-488 | `getRpmLimit()` y `getTpmLimit()` retornan `0` hardcodeado. Los rate limits configurados por env vars (`LLM_RPM_ANTHROPIC`, `LLM_TPM_ANTHROPIC`, etc.) se parsean en configSchema pero **nunca se leen**. El usage-tracker recibe limit=0 y lo interpreta como "sin límite". |
| L2 | **MEDIO** | pg-store.ts:117 | SQL con interpolación de string: `` WHERE timestamp >= now() - interval '${interval}' ``. El valor viene de un mapping interno (`1h`, `24h`, `7d`, `30d`) por lo que no hay input externo, pero el patrón es peligroso y viola la convención del proyecto de usar solo queries parametrizadas. |
| L3 | **BAJO** | providers.ts | Sin retry logic en llamadas a APIs de providers. Una falla transitoria (timeout, 503) causa fallback inmediato al siguiente provider en vez de reintentar. El circuit breaker mitiga parcialmente pero no reintenta la request individual. |
| L4 | **BAJO** | types.ts | `DEFAULT_COST_TABLE` está hardcodeado con precios que pueden desactualizarse. No hay mecanismo de actualización dinámica. |
| L5 | **INFO** | security.ts | Los regex de `INJECTION_PATTERNS` son heurísticos — pueden tener falsos positivos en conversaciones legítimas sobre IA/prompting. No hay mecanismo de bypass para contextos confiables. |

#### Services Expuestos
- `llm:gateway` — Interface principal: `request(req: LLMRequest): Promise<LLMResponse>`
- `llm:usage` — Consulta de uso y presupuestos

#### Hooks Consumidos
- `llm:request` — Intercepta requests para pre/post procesamiento
- `config:changed` — Recarga config en caliente

#### Hooks Emitidos
- Ninguno directo; los módulos consumidores invocan el service

#### Madurez: 3.5/5
Arquitectura sólida con circuit breaker y task routing bien diseñados. El bug de rate limits (L1) es el gap más importante — sin enforcement, un spike de uso puede generar costos inesperados.

---

### 3.2 Memory (`src/modules/memory/`)

**Propósito**: Sistema de memoria de 3 niveles (hot/warm/cold) para conversaciones. Redis como buffer rápido, PostgreSQL para persistencia, pgvector para búsqueda semántica.

#### Fortalezas

1. **Arquitectura de 3 niveles bien definida**: Hot (Redis buffer circular con LTRIM), warm (session_summaries en PG con embeddings), cold (contact_memory JSONB en agent_contacts). Cada nivel tiene propósito y ciclo de vida claros.

2. **Redis-first reads** (`memory-manager.ts`): Las lecturas van primero a Redis (baja latencia) con fallback a PG. Las escrituras a PG son fire-and-forget (no bloquean el flujo de mensajes). Patrón correcto para un sistema de mensajería.

3. **FTS con diccionario dinámico** (`pg-store.ts`): Full-text search usa `plainto_tsquery` con diccionario configurable por idioma (spanish/english). Implementación correcta con ranking por `ts_rank`.

4. **Vector search implementado** (`pg-store.ts`): `searchSummariesVector()` usa pgvector con distancia coseno (`<=>`) sobre columna `embedding` de session_summaries. Índice IVFFlat presente.

5. **Buffer circular robusto** (`redis-buffer.ts`): LPUSH + LTRIM mantiene ventana fija de mensajes recientes. Metadata de sesión vía HSET con TTL. Cache de lead status con 12h TTL y context cache de 5min.

6. **Tipos exhaustivos** (`types.ts`): StoredMessage con dual-write (columnas old+new para migración), Commitment con 30+ campos para tracking de compromisos del agente.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| M1 | **ALTO** | memory-manager.ts | `hybridSearch()` ejecuta FTS + recency pero **NO invoca** `searchSummariesVector()` que existe en pg-store.ts. La búsqueda semántica por embeddings está implementada en la capa de storage pero el orquestador no la usa. Esto degrada significativamente la calidad de recall en contextos conversacionales. |
| M2 | **MEDIO** | memory-manager.ts | Las escrituras fire-and-forget a PG (`void pg.save(...)`) no tienen mecanismo de retry ni dead-letter queue. Si PG está temporalmente inaccesible, los mensajes se pierden silenciosamente (solo quedan en Redis con TTL). |
| M3 | **MEDIO** | pg-store.ts | Las migraciones DDL se ejecutan en `init()` con `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No hay versionamiento de schema — si una migración falla a mitad, no hay rollback ni tracking de qué columnas se agregaron. |
| M4 | **BAJO** | redis-buffer.ts | El tamaño del buffer circular (LTRIM) es configurable pero no hay validación de que sea razonable. Un valor muy alto podría consumir excesiva memoria Redis. |
| M5 | **BAJO** | types.ts | `StoredMessage` mantiene columnas legacy (`text`, `sender`) junto a las nuevas (`role`, `content`). La migración dual-write agrega complejidad — eventualmente debería limpiarse. |

#### Services Expuestos
- `memory:manager` — Interface principal: getMessages(), saveMessage(), hybridSearch(), getContext()
- `memory:pg` — Acceso directo a PG store (usado por otros módulos para queries especializadas)

#### Hooks Consumidos
- `message:received` — Persiste mensajes entrantes
- `message:sent` — Persiste respuestas del agente

#### Hooks Emitidos
- `memory:context-ready` — Notifica cuando el contexto está listo para el pipeline

#### Madurez: 3.5/5
Arquitectura de 3 niveles bien pensada con buen rendimiento (Redis-first). El gap principal es la búsqueda vectorial sin usar (M1) — la infraestructura está lista pero el orquestador no la aprovecha. Las escrituras fire-and-forget son un trade-off aceptable pero necesitan monitoring.

---

### 3.3 Users (`src/modules/users/`)

**Propósito**: Gestión de usuarios, resolución de tipo (admin/team/client/lead/unregistered), permisos, cache, importación CSV/Sheets, registro de leads vía webhook con verificación WhatsApp.

#### Fortalezas

1. **Resolución de usuario en cascada** (`resolver.ts`): Cache Redis → DB lookup → lead detection → unregistered fallback. Resultado tipado como `UserResolution` con `type`, `user`, `permissions`. Patrón eficiente que minimiza queries a DB.

2. **Webhook de registro robusto** (`webhook-handler.ts`): Soporta registro de leads externos con normalización de teléfono (E.164), verificación WhatsApp (checkNumberStatus vía Baileys), unificación cross-channel (email + phone), atribución de campaña (utm params). Código defensivo con validaciones exhaustivas.

3. **Migración automática** (`db.ts`): Auto-migra desde esquema anterior (user_lists) al nuevo (users + user_contacts). Detección de formato legacy con migración transparente. LID (Luna ID) auto-asignado para contactos sin ID.

4. **Transacciones en operaciones críticas** (`db.ts`): CRUD de usuarios usa `BEGIN/COMMIT/ROLLBACK` para operaciones que tocan múltiples tablas (users + user_contacts). Correcto para mantener consistencia.

5. **Bulk import flexible** (`csv-import.ts`, `sheet-sync.ts`): Parser CSV propio con soporte de quoted fields, detección automática de delimitador. Sync con Google Sheets unidireccional (Sheets → PG). Ambos flujos usan upsert para idempotencia.

6. **API handler completo** (`sync/api-handler.ts`): 12+ endpoints CRUD para usuarios, contactos, listas, importación, sheets, webhooks. Respuestas consistentes con jsonResponse del kernel.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| U1 | **ALTO** | webhook-handler.ts | Comparación de token Bearer via `===` (no timing-safe). Un atacante podría explotar timing side-channel para derivar el token carácter por carácter. Debería usar `crypto.timingSafeEqual()`. |
| U2 | **ALTO** | resolver.ts:156-165 | `isCacheEnabled()` ejecuta `SELECT value FROM config_store WHERE key = 'users:cache_enabled'` en **cada llamada** a `resolveUserType()`. Esto es una query a PG en cada mensaje entrante, anulando parcialmente el beneficio del cache Redis. Debería leerse una vez al init y actualizarse vía hook `config:changed`. |
| U3 | **MEDIO** | db.ts | Generación de user ID usa `Math.random().toString(36).slice(2, 10)`. No es criptográficamente seguro y tiene riesgo de colisión (~2.8 trillones de combinaciones, pero sin verificación de unicidad previa al INSERT). Debería usar `crypto.randomUUID()` o un SERIAL/BIGSERIAL de PG. |
| U4 | **MEDIO** | webhook-handler.ts | La verificación WhatsApp (`checkNumberStatus`) se hace sincrónicamente durante el request del webhook. Si Baileys está lento o desconectado, el webhook timeout. Debería ser async con respuesta inmediata + verificación en background. |
| U5 | **BAJO** | sync/csv-import.ts | Parser CSV custom sin soporte de newlines dentro de campos quoted. Edge case poco probable en datos de usuarios pero es una limitación conocida. |
| U6 | **BAJO** | cache.ts | Invalidación de cache usa `SCAN` para encontrar keys por patrón. En Redis con muchas keys esto puede ser lento. Actualmente aceptable dado el volumen esperado. |

#### Services Expuestos
- `users:resolver` — resolveUserType(channelType, channelId): UserResolution
- `users:db` — CRUD completo de usuarios y contactos
- `users:permissions` — getUserPermissions(userId): UserPermissions
- `users:cache` — Invalidación manual de cache
- `users:webhook` — Registro de leads vía webhook

#### Hooks Consumidos
- `config:changed` — Recarga config de listas
- `whatsapp:connected` — Habilita verificación de números

#### Hooks Emitidos
- `user:resolved` — Después de resolver tipo de usuario
- `lead:registered` — Nuevo lead registrado vía webhook

#### Madurez: 3.5/5
Módulo funcional y completo con buen manejo de edge cases (migración legacy, cross-channel unification). Los issues de seguridad (U1, U3) y performance (U2) necesitan atención. El webhook handler es el componente más maduro con lógica de negocio bien estructurada.

---

### 3.4 Console (`src/modules/console/`)

**Propósito**: Panel de control web SSR (server-side rendered) para gestión del sistema. Templates HTML generados en servidor, POST handlers para configuración, static file serving.

#### Fortalezas

1. **SSR puro sin SPA**: Toda la UI se genera server-side con template strings de TypeScript. Sin framework frontend, sin build step, sin dependencias de bundler. Coherente con la filosofía del proyecto.

2. **Protección de path traversal** (`server.ts`): El servicio de archivos estáticos normaliza paths y verifica que estén dentro del directorio permitido. Previene ataques `../../etc/passwd`.

3. **Uso consistente de `esc()`** (`templates-fields.ts`): La función de escaping HTML se usa en todos los templates para valores dinámicos. Previene la mayoría de XSS reflected.

4. **Descubrimiento dinámico de módulos**: La consola descubre automáticamente los campos y API routes de cada módulo vía el manifest `console` property. No hay acoplamiento directo — nuevos módulos aparecen automáticamente.

5. **Internacionalización**: Soporte bilingüe (es/en) en labels, descriptions y mensajes. Selector de idioma en el header.

6. **API routes delegadas**: Cada módulo define sus propias `apiRoutes` en el manifest; la consola solo las proxea. Buen separation of concerns.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| C1 | **CRÍTICO** | server.ts | **Sin autenticación**: No hay login, sesiones, ni middleware de auth en ninguna ruta. Cualquier persona con acceso a la URL puede: cambiar configuración, ver API keys, habilitar/deshabilitar módulos, resetear la base de datos. En producción, la seguridad depende enteramente de la red (Traefik + firewall). |
| C2 | **CRÍTICO** | server.ts | **Sin protección CSRF**: Los POST handlers (`/save`, `/reset-db`, `/modules/toggle`) no validan tokens CSRF. Un atacante podría ejecutar acciones administrativas via CSRF si un admin visita un sitio malicioso mientras tiene la consola abierta. |
| C3 | **ALTO** | server.ts | `POST /reset-db` trunca TODAS las tablas de datos sin confirmación server-side. El único check es un `confirm()` en el cliente (JavaScript), que un request directo puede omitir. |
| C4 | **ALTO** | server.ts | `POST /save` escribe directamente a config_store en DB Y al archivo `.env` del servidor. Un atacante con acceso a la consola puede inyectar valores arbitrarios en .env, potencialmente ejecutando código si algún módulo evalúa valores de config. |
| C5 | **MEDIO** | templates-fields.ts | La función `esc()` escapa `&`, `"`, `<` pero **no escapa `>` ni `'`**. Mientras que `>` es menor riesgo, la falta de `'` permite XSS en atributos delimitados por comilla simple (ej: `onclick='...'`). Los templates actuales usan comillas dobles consistentemente, mitigando el riesgo. |
| C6 | **MEDIO** | server.ts | Archivos estáticos se sirven sin headers de cache (`Cache-Control`, `ETag`). Cada recarga descarga todos los assets de nuevo. Impacto en rendimiento, no en seguridad. |
| C7 | **MEDIO** | server.ts | `POST /modules/toggle` puede habilitar/deshabilitar cualquier módulo sin validar dependencias. Deshabilitar un módulo core del que otros dependen puede causar cascada de fallos. |
| C8 | **BAJO** | templates.ts | El archivo server.ts tiene 2,020 líneas — monolito difícil de mantener. La lógica de routing, handlers, y static serving deberían separarse. |

#### Services Expuestos
- `console:requestHandler` — Handler HTTP principal para requests a la consola

#### Hooks Consumidos
- `module:registered` — Descubre console fields y API routes de módulos
- `config:changed` — Refresca vista de configuración

#### Hooks Emitidos
- `config:changed` — Después de guardar configuración via POST /save

#### Madurez: 2.5/5
Funcional y con buen SSR pattern, pero la ausencia total de autenticación y CSRF la convierte en el módulo con mayor superficie de ataque. En entornos donde la consola es accesible desde internet (incluso con Traefik), el riesgo es muy alto. La UI y el descubrimiento dinámico de módulos son puntos fuertes arquitectónicos.

---

### 3.5 Prompts (`src/modules/prompts/`)

**Propósito**: Gestión centralizada de prompts del agente. Sistema de slots (identity, job, guardrails, relationship, evaluator), cache in-memory, persistencia en PG, edición vía consola.

#### Fortalezas

1. **Sistema de slots bien diseñado** (`types.ts`): 5 slots tipados (identity, job, guardrails, relationship, evaluator) con separación clara de responsabilidades. Cada slot es un prompt independiente que se compone en el pipeline.

2. **Sync bidireccional config↔DB** (`manifest.ts`): Los prompts se pueden editar tanto desde la consola (config_store) como directamente en DB (prompt_slots). El init() sincroniza ambas fuentes con prioridad configurable.

3. **Cache in-memory eficiente** (`prompts-service.ts`): Map<string, string> en memoria evita queries a DB en cada request del pipeline. Invalidación por hook `config:changed`.

4. **Seed desde archivos** (`prompts-service.ts`): Los prompts iniciales se cargan desde archivos Markdown en `instance/`, permitiendo versionamiento y edición offline.

5. **Generación de evaluator via LLM** (`prompts-service.ts`): El prompt evaluator (usado para auto-evaluación de respuestas) se genera dinámicamente invocando el LLM gateway. Patrón interesante de meta-prompting.

6. **Queries parametrizadas** (`pg-queries.ts`): Todo el CRUD usa $1, $2. Sin excepciones.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| P1 | **MEDIO** | prompts-service.ts | Durante invalidación de cache, hay una ventana breve donde el cache está vacío (entre `clear()` y `reload()`). Requests concurrentes en esa ventana irán a DB. En alta concurrencia, esto podría causar un thundering herd momentáneo. |
| P2 | **BAJO** | manifest.ts | La sync bidireccional entre config_store y prompt_slots no tiene mecanismo de resolución de conflictos. Si ambas fuentes se editan simultáneamente, gana la última escritura sin merge. |
| P3 | **BAJO** | prompts-service.ts | La generación del evaluator via LLM se hace en init() de forma síncrona. Si el LLM gateway no está listo (depende del orden de carga de módulos), la generación falla silenciosamente y usa un default. |

#### Services Expuestos
- `prompts:service` — getSlot(name), setSlot(name, content), getAgentName(), compose()

#### Hooks Consumidos
- `config:changed` — Invalida cache y recarga desde DB

#### Hooks Emitidos
- Ninguno

#### Madurez: 4.0/5
Módulo pequeño, cohesivo y bien implementado. El sistema de slots es elegante y la sync bidireccional cubre los casos de uso principales. Los issues son menores (ventana de cache, conflictos teóricos). Es el módulo más maduro de los 6 auditados.

---

### 3.6 Model Scanner (`src/modules/model-scanner/`)

**Propósito**: Escaneo periódico de APIs de providers LLM para descubrir modelos disponibles, detectar modelos deprecados y auto-reemplazarlos en configuración.

#### Fortalezas

1. **Auto-reemplazo inteligente** (`scanner.ts`): Cuando un modelo configurado ya no está disponible en la API del provider, busca el modelo más reciente de la misma familia (haiku→haiku, sonnet→sonnet) y lo reemplaza automáticamente. Actualiza tanto `instance/config.json` como `.env`.

2. **Detección de familias** (`scanner.ts`): Clasificación automática de modelos por familia (haiku/sonnet/opus para Anthropic, flash/pro para Google) basada en el ID del modelo.

3. **Scan periódico configurable** (`scanner.ts`): Default cada 6 horas con scan inmediato al iniciar. Intervalo configurable vía `MODEL_SCAN_INTERVAL_MS`.

4. **API routes útiles** (`manifest.ts`): GET /status para último resultado, GET /models para lista de modelos, POST /scan para trigger manual. Respuestas incluyen errores y reemplazos realizados.

5. **Graceful degradation**: Si una API key no está configurada, ese provider se omite sin error. Si el fetch falla, retorna array vacío y continúa con el otro provider.

#### Problemas Encontrados

| # | Severidad | Archivo:Línea | Descripción |
|---|-----------|---------------|-------------|
| S1 | **ALTO** | scanner.ts:8 | `import { getEnv } from '../../kernel/config.js'` — **violación de la regla de config distribuido**. El scanner lee env vars directamente via `getEnv()` (líneas 220-225: `getEnv(key)` para cada MODEL_CONFIG_KEY) en vez de usar `registry.getConfig()`. Esto bypasea la validación Zod y el sistema de config del kernel. |
| S2 | **MEDIO** | scanner.ts:152-166 | `updateEnvFile()` modifica el archivo `.env` directamente con regex. Esto es frágil: si el .env tiene formato inusual (espacios, comentarios inline), la regex puede fallar o corromper el archivo. Además, la escritura no es atómica — un crash mid-write puede dejar el .env truncado. |
| S3 | **MEDIO** | scanner.ts:126-146 | `updateInstanceConfigModels()` lee y escribe `instance/config.json` sin locking. Si dos scans ejecutan concurrentemente (improbable pero posible via POST /scan + timer), pueden producir una race condition con pérdida de datos. |
| S4 | **BAJO** | scanner.ts:86 | API key de Google se envía como query parameter en la URL: `?key=${apiKey}`. Esto puede quedar registrado en logs de proxy/CDN. Es el método oficial de la API de Google, pero es una consideración de seguridad. |
| S5 | **BAJO** | scanner.ts:172 | `_lastScanResult` es un singleton en memoria. Si el servidor se reinicia, se pierde el último resultado hasta el próximo scan. No hay persistencia del resultado. |

#### Services Expuestos
- Ninguno registrado formalmente (los datos se acceden via API routes)

#### Hooks Consumidos
- Ninguno

#### Hooks Emitidos
- Ninguno

#### Madurez: 3.0/5
Módulo útil con buena lógica de auto-reemplazo, pero tiene la violación más clara de la regla de config distribuido (S1). La escritura directa a .env (S2) es un patrón riesgoso. Falta integración vía hooks/services con el resto del sistema — opera como isla independiente.

---

## 4. Análisis Inter-Módulo

### 4.1 Comunicación entre módulos

**Resultado positivo**: No se encontraron imports directos entre módulos. Todas las interacciones pasan por hooks y services del registry, respetando la regla arquitectónica.

Verificación realizada:
- `grep` recursivo de imports relativos `from '../otro-modulo/'` en los 6 módulos → 0 resultados
- Todos los módulos importan solo de: `../../kernel/` (types, registry, http-helpers, config-helpers) y de sus propios archivos internos

### 4.2 Violaciones de reglas del proyecto

| Regla | Módulo | Detalle |
|-------|--------|---------|
| Config distribuido (no leer process.env) | Model Scanner | `getEnv()` directo en scanner.ts para leer MODEL_CONFIG_KEYS |
| Config distribuido | Console | `import { reloadKernelConfig, kernelConfig }` desde kernel/config.js — acceso directo a config del kernel, no via registry |

### 4.3 Mapa de dependencias vía services

```
Pipeline (engine) ──→ llm:gateway ──→ [Anthropic API, Google API]
                  ──→ memory:manager ──→ memory:pg ──→ [PostgreSQL]
                  │                  ──→ [Redis]
                  ──→ users:resolver ──→ users:db ──→ [PostgreSQL]
                  │                  ──→ users:cache ──→ [Redis]
                  ──→ prompts:service ──→ [PostgreSQL]

Console ──→ (todos los módulos via manifest.console)
Model Scanner ──→ (independiente, sin services consumidos ni expuestos)
```

### 4.4 Puntos de acoplamiento implícito

1. **Memory ↔ LLM**: memory-manager podría usar llm:gateway para generar embeddings (vector search), pero no lo hace — gap funcional.
2. **Prompts → LLM**: prompts-service genera el evaluator via hook `llm:request`. Dependencia implícita del orden de init (LLM debe iniciar antes que Prompts).
3. **Console → Todos**: La consola tiene acceso amplio via manifest discovery, pero no hay granularidad de permisos — o ves todo o nada.
4. **Model Scanner → .env**: Escribe directamente al filesystem, bypaseando el sistema de config. Otros módulos no se enteran del cambio hasta restart.

---

## 5. Tabla Consolidada de Bugs

| ID | Módulo | Severidad | Descripción | Archivo | Impacto |
|----|--------|-----------|-------------|---------|---------|
| L1 | LLM | **CRÍTICO** | Rate limits hardcodeados a 0, config ignorada | llm-gateway.ts:481-488 | Sin protección contra spikes de uso/costos |
| M1 | Memory | **ALTO** | hybridSearch() no usa vector search | memory-manager.ts | Recall degradado en búsqueda contextual |
| U2 | Users | **ALTO** | isCacheEnabled() query DB en cada resolución | resolver.ts:156-165 | Latencia innecesaria en cada mensaje |
| C7 | Console | **MEDIO** | Toggle módulos sin validar dependencias | server.ts | Posible cascada de fallos |
| P1 | Prompts | **MEDIO** | Thundering herd durante invalidación de cache | prompts-service.ts | Spike de queries a DB bajo concurrencia |
| S3 | Scanner | **MEDIO** | Race condition en escritura de config.json | scanner.ts:126-146 | Posible pérdida de datos de config |

---

## 6. Tabla de Riesgos de Seguridad

| ID | Módulo | Severidad | Descripción | Vector de ataque | Mitigación actual |
|----|--------|-----------|-------------|-----------------|-------------------|
| C1 | Console | **CRÍTICO** | Sin autenticación en ninguna ruta | Acceso directo a URL | Red (Traefik/firewall) |
| C2 | Console | **CRÍTICO** | Sin protección CSRF | Sitio malicioso + admin autenticado en red | Ninguna |
| U1 | Users | **ALTO** | Token webhook: comparación no timing-safe | Timing side-channel | Token largo reduce viabilidad práctica |
| C3 | Console | **ALTO** | POST /reset-db sin confirmación server-side | Request directo (no necesita browser) | confirm() client-side (bypasseable) |
| C4 | Console | **ALTO** | POST /save escribe a .env sin restricciones | Acceso a consola → env injection | Depende de C1 |
| L2 | LLM | **MEDIO** | SQL string interpolation en pg-store.ts | Teórico (mapping interno controla valores) | Mapping cerrado, no hay input externo |
| C5 | Console | **MEDIO** | esc() incompleta (falta `>` y `'`) | XSS en atributos con comilla simple | Templates usan comillas dobles |
| U3 | Users | **MEDIO** | User ID con Math.random() | Colisión/predicción de IDs | IDs no usados para auth |
| S4 | Scanner | **BAJO** | API key Google en URL query param | Log exposure en proxies | Método oficial de Google API |

---

## 7. Tabla de Deuda Técnica

| ID | Módulo | Prioridad | Descripción | Esfuerzo estimado |
|----|--------|-----------|-------------|-------------------|
| DT1 | Console | Alta | server.ts monolito de 2,020 LOC — separar routing, handlers, static | 1-2 días |
| DT2 | Memory | Alta | Integrar vector search en hybridSearch() | 0.5 días |
| DT3 | LLM | Alta | Conectar rate limits de config a getRpmLimit()/getTpmLimit() | 0.5 días |
| DT4 | Memory | Media | Agregar retry/DLQ para escrituras fire-and-forget a PG | 1 día |
| DT5 | Scanner | Media | Migrar getEnv() → registry.getConfig() | 0.5 días |
| DT6 | Memory | Media | Versionamiento de schema DDL (migraciones numeradas) | 1-2 días |
| DT7 | Users | Media | Reemplazar Math.random() por crypto.randomUUID() | 0.5 horas |
| DT8 | Console | Media | Agregar auth básica (al menos Basic Auth o session tokens) | 1-2 días |
| DT9 | Memory | Baja | Limpiar dual-write columns legacy en StoredMessage | 0.5 días |
| DT10 | Prompts | Baja | Resolver race condition en invalidación de cache (swap atómico) | 0.5 días |
| DT11 | Scanner | Baja | Persistir último scan result en DB | 0.5 días |
| DT12 | Console | Baja | Agregar Cache-Control headers para static assets | 0.5 horas |

---

## 8. Madurez Global

| Módulo | Seguridad | Rendimiento | Arquitectura | Mantenibilidad | Promedio |
|--------|-----------|-------------|--------------|----------------|----------|
| LLM Gateway | 3.5 | 3.0 | 4.0 | 3.5 | **3.5** |
| Memory | 4.0 | 3.5 | 4.0 | 3.0 | **3.6** |
| Users | 3.0 | 3.0 | 4.0 | 3.5 | **3.4** |
| Console | 1.5 | 3.0 | 3.5 | 2.5 | **2.6** |
| Prompts | 4.0 | 4.0 | 4.5 | 4.0 | **4.1** |
| Model Scanner | 3.0 | 4.0 | 2.5 | 3.5 | **3.3** |
| **PROMEDIO GLOBAL** | **3.2** | **3.4** | **3.8** | **3.3** | **3.4** |

**Escala**: 1=deficiente, 2=básico, 3=aceptable, 4=bueno, 5=excelente

**Observaciones**:
- **Arquitectura es el punto más fuerte (3.8)**: El sistema modular con hooks/services funciona bien. No hay imports directos entre módulos. El descubrimiento dinámico es elegante.
- **Seguridad es el punto más débil (3.2)**: Arrastrado por la consola sin auth (1.5). Los demás módulos son razonables.
- **Rendimiento es aceptable (3.4)**: Los patrones Redis-first y fire-and-forget son correctos. El bug de rate limits (L1) y la query innecesaria en resolver (U2) son los gaps principales.

---

## 9. Top 10 Recomendaciones

Ordenadas por impacto × urgencia:

### 1. Agregar autenticación a la consola [CRÍTICO — Seguridad]
**Módulo**: Console
**Problema**: C1, C2
**Acción**: Implementar al menos Basic Auth o session-based auth con tokens CSRF. Considerar integración con el módulo users para permisos granulares. Como mínimo inmediato: middleware de auth con password configurable vía env var.

### 2. Conectar rate limits del LLM Gateway [CRÍTICO — Costos]
**Módulo**: LLM
**Problema**: L1
**Acción**: En `getRpmLimit()` y `getTpmLimit()`, leer los valores de config (`LLM_RPM_ANTHROPIC`, etc.) en vez de retornar 0. Fix de ~10 líneas que habilita protección contra spikes de costos.

### 3. Integrar vector search en hybridSearch() [ALTO — Funcionalidad]
**Módulo**: Memory
**Problema**: M1
**Acción**: Agregar llamada a `searchSummariesVector()` en `hybridSearch()` y mergear resultados con FTS+recency. Requiere generar embeddings via llm:gateway (o un service dedicado). La infraestructura pgvector ya está lista.

### 4. Usar comparación timing-safe para tokens webhook [ALTO — Seguridad]
**Módulo**: Users
**Problema**: U1
**Acción**: Reemplazar `===` por `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` en la verificación de Bearer token del webhook handler. Fix de ~3 líneas.

### 5. Eliminar query DB en isCacheEnabled() [ALTO — Rendimiento]
**Módulo**: Users
**Problema**: U2
**Acción**: Leer `users:cache_enabled` una vez en init() y guardar en variable. Actualizar vía hook `config:changed`. Elimina una query PG por cada mensaje entrante.

### 6. Confirmar reset-db server-side [ALTO — Seguridad]
**Módulo**: Console
**Problema**: C3
**Acción**: Agregar token de confirmación server-side (ej: requiere re-ingresar password o token temporal) antes de truncar tablas. El confirm() de JavaScript no es suficiente.

### 7. Completar función esc() de templates [MEDIO — Seguridad]
**Módulo**: Console
**Problema**: C5
**Acción**: Agregar escaping de `>` (→ `&gt;`) y `'` (→ `&#39;`) a la función `esc()`. Aunque los templates actuales usan comillas dobles, prevenir regresiones futuras.

### 8. Migrar Model Scanner a registry.getConfig() [MEDIO — Arquitectura]
**Módulo**: Model Scanner
**Problema**: S1
**Acción**: Reemplazar `getEnv()` por `registry.getConfig()` para leer las config keys de modelos. Alinear con la regla de config distribuido del proyecto.

### 9. Reemplazar Math.random() por crypto.randomUUID() [MEDIO — Seguridad]
**Módulo**: Users
**Problema**: U3
**Acción**: Usar `crypto.randomUUID()` para generación de user IDs. Elimina riesgo de colisión y predicción. Fix de ~1 línea.

### 10. Refactorizar server.ts de console [MEDIO — Mantenibilidad]
**Módulo**: Console
**Problema**: DT1
**Acción**: Separar el monolito de 2,020 LOC en: router.ts (matching de rutas), handlers.ts (lógica POST), static.ts (serving de archivos). Facilita testing y revisión de seguridad.

---

## 10. Conclusión

Los módulos core de LUNA tienen una **arquitectura modular sólida** — el sistema de hooks/services funciona correctamente y no hay imports directos entre módulos. Los patrones de rendimiento (Redis-first, fire-and-forget, circuit breaker) están bien elegidos.

Los **gaps principales** son:
1. **Seguridad de la consola** — sin auth ni CSRF, es el eslabón más débil
2. **Rate limits del LLM muertos** — bug que expone a costos descontrolados
3. **Vector search sin usar** — infraestructura lista pero no conectada

Las recomendaciones 1-5 deberían implementarse antes del próximo deploy a producción. Las recomendaciones 6-10 pueden programarse en sprints posteriores.

**Total de hallazgos**: 6 bugs, 9 riesgos de seguridad, 12 items de deuda técnica.
**Archivos leídos**: 40 archivos, ~14,914 LOC analizadas.
