# LUNA — GUÍA DE IMPLEMENTACIÓN DEFINITIVA
## Organizado por workstreams paralelos para Claude Code

---

## CORRECCIONES APLICADAS

### 1. Contact Unification (cross-channel)

```
ANTES (roto):
  WhatsApp +57300111 → contact_1
  Email juan@gmail  → contact_2    ← ¡MISMO HUMANO, 2 REGISTROS!
  Llamada +57300111 → contact_3

AHORA:
  contacts (la persona)
    id: uuid-juan
    name: "Juan Pérez"
    primary_email: "juan@gmail.com"
    primary_phone: "+57300111222"
    
  contact_channels (sus identidades)
    contact_id: uuid-juan, channel: whatsapp, sender_id: "+57300111222"
    contact_id: uuid-juan, channel: email, sender_id: "juan@gmail.com"
    contact_id: uuid-juan, channel: phone, sender_id: "+57300111222"

Cuando llega un mensaje:
  1. Buscar sender_id en contact_channels
  2. Si existe → ya sé quién es, cargar contact completo
  3. Si NO existe → crear contact nuevo + channel entry
  4. MERGE: si el lead da su email por WhatsApp:
     → Buscar si ese email ya existe en contact_channels
     → Si sí → UNIFICAR: vincular el WA channel al contact existente
     → Si no → agregar el email como nuevo channel del mismo contact
     
Todas las sesiones se vinculan al contact.id (no al sender_id).
Así puedo ver TODO el historial de Juan sin importar por dónde escribió.
```

### 2. Sheets Cache → cada 24h + refresh manual

```
Cron: 1 vez al día a las 3:00 AM
  → Leer cada sheet configurado
  → Guardar en Redis con TTL 25h

Endpoint manual (para dashboard futuro):
  POST /api/cache/refresh?sheet=catalogo
  → Invalidar Redis key
  → Re-leer sheet
  → Poblar cache

Para V1 sin dashboard:
  CLI: npx tsx scripts/refresh-cache.ts --sheet=catalogo
```

### 3. Entry Point (index.ts)

```typescript
// src/index.ts — El "main" que enciende todo

async function main() {
  // 1. Cargar config de /instance
  const config = await loadConfig()
  
  // 2. Conectar PostgreSQL
  const db = await connectDatabase(config.databaseUrl)
  await runMigrations(db)
  
  // 3. Conectar Redis
  const redis = await connectRedis(config.redisUrl)
  
  // 4. Inicializar LLM Router
  const llmRouter = new LLMRouter(config.llm)
  
  // 5. Registrar Tools
  const toolRegistry = new ToolRegistry(config.tools, { db, redis })
  
  // 6. Inicializar Engine (pipeline)
  const engine = new Pipeline({ db, redis, llmRouter, toolRegistry, config })
  
  // 7. Inicializar Message Queue + Workers
  const queue = new MessageQueue(redis)
  const workers = new WorkerPool(queue, engine, { concurrency: 5 })
  
  // 8. Inicializar Gateway (canales)
  const gateway = new Gateway(config.channels, queue)
  await gateway.connect()
  
  // 9. Inicializar Scheduler (proactividad)
  const scheduler = new Scheduler({ db, redis, gateway, config })
  scheduler.start()
  
  // 10. Health check endpoint
  startHealthServer(config.healthPort || 3000, { db, redis, gateway })
  
  // 11. Graceful shutdown
  process.on('SIGTERM', async () => {
    await workers.stop()
    await gateway.disconnect()
    await scheduler.stop()
    await db.end()
    await redis.quit()
  })
  
  log.info('LUNA started', { channels: gateway.activeChannels() })
}
```

---

## SCHEMA DE BASE DE DATOS CORREGIDO

```sql
-- ════════════════════════════════════════
-- CONTACTS: La persona (cross-channel)
-- ════════════════════════════════════════
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200),
  primary_email VARCHAR(200),
  primary_phone VARCHAR(50),
  company_name VARCHAR(200),
  contact_type VARCHAR(30) DEFAULT 'unknown',
    -- unknown, lead_new, lead_qualifying, lead_qualified,
    -- lead_converted, client_active, client_former,
    -- team_internal, provider, blocked
  qualification_score INT DEFAULT 0,
  qualification_status VARCHAR(30) DEFAULT 'new',
  campaign_id VARCHAR(100),
  assigned_to VARCHAR(100),
  profile JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════
-- CONTACT CHANNELS: Identidades por canal
-- ════════════════════════════════════════
CREATE TABLE contact_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  sender_id VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  verified BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel, sender_id)
);

CREATE INDEX idx_channel_lookup ON contact_channels(channel, sender_id);
CREATE INDEX idx_channel_contact ON contact_channels(contact_id);

-- ════════════════════════════════════════
-- SESSIONS: Conversaciones
-- ════════════════════════════════════════
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  channel VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INT DEFAULT 0,
  compressed_summary TEXT,
  status VARCHAR(20) DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_contact ON sessions(contact_id, status);
CREATE INDEX idx_sessions_active ON sessions(status, last_message_at);

-- ════════════════════════════════════════
-- MESSAGES: Historial de conversación
-- ════════════════════════════════════════
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  role VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  channel_message_id VARCHAR(100),
  tools_used JSONB,
  llm_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- ════════════════════════════════════════
-- COMMITMENTS: Promesas y compromisos
-- ════════════════════════════════════════
CREATE TABLE commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  promised_by VARCHAR(100) NOT NULL,
  promised_to VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commitments_pending ON commitments(status, due_at)
  WHERE status = 'pending';

-- ════════════════════════════════════════
-- LEAD INSIGHTS: Objeciones y preguntas
-- ════════════════════════════════════════
CREATE TABLE lead_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  insight_type VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50),
  session_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════
-- INTERACTION ARCHIVE: Backup legal
-- ════════════════════════════════════════
CREATE TABLE interaction_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  session_id UUID,
  channel VARCHAR(20),
  direction VARCHAR(10),
  raw_content TEXT NOT NULL,
  agent_response TEXT,
  tools_log JSONB,
  llm_log JSONB,
  cost_usd DECIMAL(10,6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_archive_date ON interaction_archive(created_at);
CREATE INDEX idx_archive_contact ON interaction_archive(contact_id, created_at);

-- ════════════════════════════════════════
-- OAUTH TOKENS: Google Auth
-- ════════════════════════════════════════
CREATE TABLE oauth_tokens (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  email VARCHAR(200) NOT NULL,
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, email)
);

-- ════════════════════════════════════════
-- Partition de archivado para messages (V2)
-- ════════════════════════════════════════
-- Cuando messages crezca:
-- ALTER TABLE messages RENAME TO messages_old;
-- CREATE TABLE messages (...) PARTITION BY RANGE (created_at);
-- CREATE TABLE messages_2026_q1 PARTITION OF messages
--   FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
```

---

## WORKSTREAMS PARALELOS PARA CLAUDE CODE

```
                    ┌─────────────────────────┐
                    │     TÚ (Director)       │
                    │  Revisas, pruebas,      │
                    │  decides, conectas      │
                    └────────┬────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                   ▼
   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
   │ STREAM A    │  │ STREAM B     │  │ STREAM C     │
   │ Claude Code │  │ Claude Code  │  │ Tu dev       │
   │ Engine +    │  │ Gateway +    │  │ técnico      │
   │ Pipeline    │  │ Channels     │  │ Infra +      │
   └─────────────┘  └──────────────┘  │ Tools        │
                                       └──────────────┘
```

Cada stream trabaja en su propio branch. Tú integras.

---

### STREAM A: ENGINE + PIPELINE (Claude Code instancia 1)

Este stream construye el cerebro del agente: el pipeline de procesamiento, 
los LLM providers, el classifier, el responder, y el complexity router.

#### CLAUDE.md para Stream A

```markdown
# LUNA — Stream A: Engine + Pipeline

## Tu responsabilidad
Construir el motor del agente: el pipeline que procesa mensajes.
NO te preocupes por: canales (WhatsApp/email), tools específicas, 
ni infraestructura (DB/Redis). Esos los construyen otros streams.

## Arquitectura del pipeline
5 pasos + complexity routing:
1. Preprocess (código): recibe NormalizedMessage + carga contexto de DB
2. Classify (LLM barato): clasifica intención, decide tools necesarias
2.5. Complexity Route (código): decide si escalar modelo
3. Tool Execute (código): ejecuta tools y arma contexto resuelto
4. Respond (LLM según complejidad): genera respuesta conversacional
5. Postprocess (código): valida, formatea, guarda, envía

Solo pasos 2 y 4 usan LLM. Todo lo demás es código.

## Interfaces que CONSUMES (otros streams las implementan)
- db: { query, getClient, transaction } (del pool de Postgres)
- redis: conexión ioredis
- toolRegistry: { execute(toolName, input) → ToolResult }
- channelAdapter: { sendText, sendMedia } (para enviar respuestas)

## Interfaces que TÚ PRODUCES (otros consumen)
- Pipeline: { run(message: NormalizedMessage) → PipelineResult }
- LLMRouter: { route(taskType) → { provider, model } }
- LLMProvider: { chat(params) → ChatResponse }

## Dependencias npm que usas
@anthropic-ai/sdk, openai, @google/generative-ai, zod, pino, uuid

## Archivos de config que lees
instance/identity.md, instance/instructions.md, instance/guardrails.md,
instance/response-format.md, instance/company.md,
instance/complexity-rules.json, instance/qualifying.json

## Principio clave
El pipeline NUNCA conoce detalles de tools específicas ni canales.
Habla con abstracciones: toolRegistry.execute("google_calendar", input)
No sabe si es Google Calendar o Medilink detrás.
```

#### Tareas Stream A (en orden)

**A1: LLM Provider Interface + Implementaciones**
```
Crea src/llm/types.ts con las interfaces:
  LLMProvider, ChatParams, ChatResponse, Message, ToolCall, ToolDefinition

Crea src/llm/providers/anthropic.ts:
  Clase AnthropicProvider implements LLMProvider
  - Usa @anthropic-ai/sdk
  - Modelos: claude-haiku-4-5-20251001, claude-sonnet-4-6, claude-opus-4-6
  - chat(params): manejo de streaming opcional, retry en rate limit (429),
    cálculo de costo basado en modelo + tokens
  - Tabla de costos por modelo hardcodeada (actualizable)

Crea src/llm/providers/openai.ts:
  Clase OpenAIProvider implements LLMProvider
  - Misma interfaz, modelos: gpt-4o-mini, gpt-4o
  
Crea src/llm/providers/google.ts:
  Clase GoogleProvider implements LLMProvider
  - Usa @google/generative-ai
  - Modelos: gemini-2.0-flash, gemini-2.5-pro
  - Incluir grounding support para web search

Tests: src/tests/unit/llm-providers.test.ts
  Mock de cada SDK, verificar que retry funciona, costos se calculan bien.
```

**A2: LLM Router + Fallback Chain**
```
Crea src/llm/router.ts:
  Clase LLMRouter
  - Constructor recibe config de modelos (qué modelo para qué tarea)
  - route(taskType: 'classify'|'respond'|'respond_complex'|'compress'|'batch')
    → { provider: LLMProvider, model: string }
  - Mapping default:
    classify → anthropic/haiku-4-5
    respond → anthropic/sonnet-4-6
    respond_complex → anthropic/opus-4-6
    compress → anthropic/haiku-4-5

Crea src/llm/fallback-chain.ts:
  Clase FallbackChain
  - Recibe: primary provider + fallback providers[]
  - execute(params): intenta primary → si falla → next fallback
  - Circuit breaker integrado:
    Track failures por provider en memoria (Map)
    Si 5 failures en 10 min → skip provider por 5 min
    Log cada fallback activation
  - Método: getStatus() → { provider: 'up'|'down'|'degraded' }[]

Tests: verificar que fallback chain rota correctamente cuando un provider falla.
```

**A3: Pipeline Core**
```
Crea src/engine/pipeline.ts:
  Clase Pipeline
  - Constructor: { db, redis, llmRouter, toolRegistry, config }
  - run(message: NormalizedMessage): Promise<PipelineResult>
  - Orquesta los 5 pasos en secuencia
  - Cada paso mide duración con performance.now()
  - Si cualquier paso falla: catch → log → fallback message
  - PipelineResult incluye log estructurado completo de la ejecución

Crea src/engine/types.ts:
  Todas las interfaces del pipeline:
  NormalizedMessage, PreprocessResult, Classification,
  ModelTier, ResolvedContext, AgentResponse, PipelineResult, PipelineLog
```

**A4: Preprocessor (Paso 1)**
```
Crea src/engine/preprocessor.ts:
  Clase Preprocessor
  - run(message, { db, redis, config }) → PreprocessResult
  
  Lógica:
  1. Buscar contact por sender_id+channel en contact_channels
     Si no existe → crear contact + channel entry
  2. Buscar sesión activa del contact en ese channel
     Si última sesión < 24h y status='active' → reabrir
     Si no → crear nueva sesión
  3. Cargar últimos 10 mensajes de la sesión
  4. Detectar quick actions (código, no LLM):
     - Regex: /stop|no me escrib|dejen de/ → quickAction: 'block'
     - Regex: /human|persona|asesor|hablar con/ → quickAction: 'escalate'
     - Respuestas cerradas: sí/no → quickAction: 'confirm_yes'/'confirm_no'
  5. Cargar campaign context del contact
  6. Cargar secciones relevantes de company.md
     (por ahora: cargar completo, optimizar después)
  
  Output: PreprocessResult {
    contact, session, recentMessages, campaignContext,
    companyContext, quickAction?, channel
  }
```

**A5: Classifier (Paso 2)**
```
Crea src/engine/classifier.ts:
  Clase Classifier
  - run(context: PreprocessResult, llmRouter) → Classification
  
  Construye prompt de clasificación (~500 tokens):
  System: "Eres un clasificador de intenciones para un agente de ventas.
  Responde SOLO con un JSON válido."
  
  User: incluir contact_type, qualification_status, últimos 2 mensajes,
  mensaje actual, campaign_id si existe.
  
  JSON esperado (validar con zod):
  {
    intent: string,       // ver catálogo de intents
    sub_intent?: string,
    tools_needed: string[],
    response_type: string,
    sentiment: string,
    escalate: boolean
  }
  
  Catálogo de intents:
  greeting, ask_info, ask_price, ask_availability, ask_comparison,
  objection_price, objection_timing, objection_trust, objection_competition,
  schedule_meeting, confirm, reject, question_technical, question_process,
  complaint, off_topic, farewell, spam
  
  Si JSON inválido → retry 1x con prompt más estricto
  Si retry falla → default: { intent:'unknown', tools_needed:['knowledge_search'], 
    response_type:'informational', sentiment:'neutral', escalate:false }
```

**A6: Complexity Router (Paso 2.5)**
```
Crea src/engine/complexity-router.ts:
  Clase ComplexityRouter
  - Constructor: lee instance/complexity-rules.json
  - evaluate(classification, context) → ModelTier
  
  ModelTier = 'standard' | 'large'
  standard → usa 'respond' task type (Sonnet)
  large → usa 'respond_complex' task type (Opus)
  
  Lógica en orden (primero que matchee gana):
  1. Intent en always_small list → 'standard'
  2. Intent en large_model_intents → 'large'
  3. qualification_score > threshold → 'large'
  4. session message_count > threshold → 'large'
  5. sentiment es 'negative' por N turnos seguidos → 'large'
  6. Default → 'standard'
```

**A7: Prompt Builder + Responder (Paso 4)**
```
Crea src/engine/prompt-builder.ts:
  Clase PromptBuilder
  - build(context, classification, resolvedToolData, config) → Message[]
  
  Construye system prompt dinámico:
  Siempre: identity.md + guardrails.md + response-format.md (sección del canal)
  Si campaign: "[El lead viene de la campaña X interesado en Y]"
  Si tools resueltas: "Datos disponibles: [resultados de tools]"
  Si company context relevante: sección de company.md
  Historial: últimos 3-5 mensajes formateados como user/assistant
  
  REGLA: medir tokens totales. Si > 4000 → comprimir historial primero.

Crea src/engine/responder.ts:
  Clase Responder
  - run(resolvedContext, classification, modelTier, llmRouter) → AgentResponse
  
  1. Usar promptBuilder.build() para armar messages
  2. Usar llmRouter.route(modelTier == 'large' ? 'respond_complex' : 'respond')
  3. Llamar al provider con messages
  4. Validar que la respuesta no viola guardrails (check básico por keywords)
  5. Retornar AgentResponse { text, tokensUsed, model, cost, duration }
```

**A8: Tool Executor (Paso 3)**
```
Crea src/engine/tool-executor.ts:
  Clase ToolExecutor
  - run(toolsNeeded: string[], context, toolRegistry) → ResolvedContext
  
  Para cada tool en toolsNeeded:
  1. Construir input basado en el context + intent
     (mapping hardcodeado: intent → qué datos necesita cada tool)
  2. toolRegistry.execute(toolName, input)
  3. Agregar resultado al ResolvedContext
  
  Si un tool falla (después de retry + fallback):
  → Agregar un flag: toolResults[name] = { status:'degraded', fallbackMessage }
  → El responder sabrá que debe usar el fallback message en vez de datos reales
  
  Ejecutar tools en paralelo cuando sea posible:
  Si tools_needed = ['knowledge_search', 'google_calendar']
  → Promise.allSettled([knowledge.execute(), calendar.execute()])
```

**A9: Postprocessor (Paso 5)**
```
Crea src/engine/postprocessor.ts:
  Clase Postprocessor
  - run(response, context, originalMessage, { db, gateway }) → PostResult
  
  1. Validar respuesta:
     - Largo dentro de límites (configurable por canal en response-format.md)
     - Si vacía o inválida → usar fallback de instance/fallbacks/
  2. Formatear:
     - WhatsApp: split en burbujas ≤300 chars (cortar en oraciones, no en medio)
     - Email: wrap en HTML template
  3. Enviar: gateway.send(channel, contact.sender_id, formattedMessages)
  4. Guardar en DB:
     - INSERT mensaje del lead en messages
     - INSERT respuesta del agente en messages
     - UPDATE session: last_message_at, message_count++
     - UPDATE contact: last_interaction_at
  5. Archive: INSERT en interaction_archive (async, no bloquea)
  6. Insights: si classification.intent incluye 'objection' o 'question'
     → INSERT en lead_insights
  7. Log: emitir log estructurado JSON completo
  8. Sync sheets: encolar job en BullMQ (cola 'sheets-sync')
```

---

### STREAM B: GATEWAY + CHANNELS (Claude Code instancia 2)

Este stream construye la capa de comunicación: adapters para WhatsApp 
y email, normalización, identificación de contactos, y detección de campañas.

#### CLAUDE.md para Stream B

```markdown
# LUNA — Stream B: Gateway + Channels

## Tu responsabilidad
Construir la capa que recibe y envía mensajes por todos los canales.
NO te preocupes por: cómo se procesa el mensaje (eso es el pipeline),
ni qué APIs de negocio se llaman (eso son tools).

## Lo que construyes
1. ChannelAdapter interface + implementaciones (Baileys, Email)
2. Message normalizer
3. User identifier (buscar/crear contacto en DB)
4. Campaign detector
5. Gateway orchestrator (conecta canales con la cola)

## Interfaces que PRODUCES
- ChannelAdapter: { connect, onMessage, sendText, sendMedia, ... }
- Gateway: { connect, send(channel, to, content), activeChannels }
- NormalizedMessage type

## Interfaces que CONSUMES
- MessageQueue: { enqueue(message) } (del stream C)
- db: { query } (del pool de Postgres)
- Tablas: contacts, contact_channels

## Dependencias npm
@whiskeysockets/baileys, googleapis, google-auth-library, nodemailer, pino

## Principio clave
La abstracción del canal es SAGRADA. El ChannelAdapter interface NUNCA cambia.
Migrar de Baileys a Meta Cloud API = crear nuevo archivo, 0 cambios en el resto.

## Contact unification
Un humano puede escribir por WhatsApp Y email. Son el mismo contact.
Buscar por sender_id en contact_channels. Si no existe → crear nuevo.
Si el lead da su email/teléfono durante la conversación → el pipeline
llamará a contactStore.merge() para unificar.
```

#### Tareas Stream B (en orden)

**B1: Channel Adapter Interface + Types**
```
Crea src/gateway/channels/types.ts:

  interface ChannelAdapter {
    readonly channelType: string
    connect(): Promise<void>
    disconnect(): Promise<void>
    isConnected(): boolean
    onDisconnect(handler: (reason: string) => void): void
    onMessage(handler: (msg: IncomingRawMessage) => void): void
    sendText(to: string, text: string): Promise<SendResult>
    sendMedia(to: string, media: MediaPayload): Promise<SendResult>
    markAsRead(messageId: string): Promise<void>
    healthCheck(): Promise<HealthStatus>
  }

  interface IncomingRawMessage { ... }  // lo que sale del adapter
  interface NormalizedMessage { ... }   // lo que entra al pipeline
  interface SendResult { success, messageId?, error? }
  interface MediaPayload { type, url?, buffer?, caption?, mimeType }
  interface HealthStatus { connected, lastActivity, errors }
```

**B2: Baileys Adapter**
```
Crea src/gateway/channels/baileys-adapter.ts:
  Clase BaileysAdapter implements ChannelAdapter
  
  connect():
  - useMultiFileAuthState('./instance/wa-auth/')
  - printQRInTerminal: true
  - Reconnect automático con DisconnectReason handling
  - Log de cada estado de conexión
  
  onMessage(handler):
  - Escuchar 'messages.upsert'
  - Filtrar: !fromMe, no grupo (configurable), mensajes nuevos
  - Construir IncomingRawMessage con todos los datos del mensaje
  
  sendText(to, text):
  - Formatear JID: to.replace('+','') + '@s.whatsapp.net'
  - Delay random 800-2000ms antes de enviar (anti-ban)
  - Si texto > 300 chars: dividir en burbujas inteligentes
    (cortar en punto, coma, o salto de línea, no en medio de palabra)
  - Enviar cada burbuja con delay 500-1000ms entre ellas
  
  sendMedia(to, media):
  - Soportar: image, video, document, audio
  - Leer archivo de ruta local o buffer
  
  Reconexión:
  - loggedOut → log error, necesita QR nuevo
  - connectionClosed → retry con backoff (1s, 2s, 4s, 8s, máx 30s)
  - Máximo 15 intentos → alert (log.error)
  
  Anti-ban:
  - NO enviar más de 30 mensajes por hora (contador en memoria)
  - NO enviar más de 200 mensajes por día
  - Delays aleatorios entre envíos
  - Marcar como "typing" antes de responder (presenceSubscribe)
```

**B3: Email Adapter (Gmail OAuth2)**
```
Crea src/auth/google-oauth.ts:
  - Método estático: getAuthUrl(scopes) → URL de consent
  - Método estático: exchangeCode(code) → tokens
  - Método: getAccessToken() → string (auto-refresh si expiró)
  - Método: getOAuth2Client() → google.auth.OAuth2
  - Guarda/lee tokens de Postgres (tabla oauth_tokens)
  - Scopes: gmail.send, gmail.readonly, gmail.modify,
    calendar, calendar.events, spreadsheets

Crea scripts/google-auth-setup.ts:
  Script interactivo:
  1. Pedir client_id y client_secret (de Google Cloud Console)
  2. Generar URL de consent
  3. Abrir en browser
  4. Pedir el code de callback
  5. Intercambiar por tokens
  6. Guardar en DB
  7. Confirmar que funciona

Crea src/gateway/channels/email-adapter.ts:
  Clase EmailAdapter implements ChannelAdapter
  
  connect():
  - Verificar OAuth tokens válidos
  - Configurar polling interval (30s default)
  
  onMessage(handler) (polling con Gmail API):
  - Cada 30s: gmail.users.messages.list({ q: 'is:unread label:inbox' })
  - Para cada mensaje nuevo:
    → gmail.users.messages.get() para contenido completo
    → Extraer: from, subject, body (text/plain preferido)
    → Construir IncomingRawMessage
    → Marcar como leído
  
  sendText(to, text):
  - Construir email MIME con HTML template
  - Incluir firma de empresa (de instance/templates/email-signature.html)
  - Si es reply → incluir In-Reply-To y References headers
  - gmail.users.messages.send()
  
  sendMedia(to, media):
  - Adjuntar archivo al email
```

**B4: Normalizer + Campaign Detector + User Identifier**
```
Crea src/gateway/normalizer.ts:
  Función: normalize(raw: IncomingRawMessage, channelType) → NormalizedMessage
  
  - Extraer texto (de conversación, caption, o subject+body)
  - Sanitizar: quitar chars invisibles Unicode, trim
  - Detectar tipo de contenido: text, image, video, audio, document, location
  - Detectar idioma (heurística simple: regex español/inglés/portugués)
  - Truncar si > 5000 chars (protección)
  - Timestamp normalizado a UTC

Crea src/gateway/campaign-detector.ts:
  Función: detectCampaign(message: NormalizedMessage, config) → string | null
  
  Lee instance/campaigns.json
  Según canal:
  - whatsapp: match por número destino O keyword en primer mensaje
  - email: match por address suffix O subject tags
  - webhook: match por UTM params
  Return campaign_id o null

Crea src/gateway/user-identifier.ts:
  Clase UserIdentifier
  - identify(senderId, channel, db) → { contact, isNew }
  
  1. SELECT c.* FROM contacts c
     JOIN contact_channels cc ON c.id = cc.contact_id
     WHERE cc.channel = $1 AND cc.sender_id = $2
  2. Si existe → return { contact, isNew: false }
  3. Si no → INSERT contact + INSERT contact_channel
     → return { contact, isNew: true }
  
  - merge(contactId, newChannel, newSenderId) → void
    Cuando el lead da su email por WA:
    → Buscar si newSenderId ya tiene contact
    → Si sí → merge: mover channels del contact viejo al nuevo,
      combinar profiles, mantener el score más alto
    → Si no → INSERT contact_channel nuevo
```

**B5: Gateway Orchestrator**
```
Crea src/gateway/gateway.ts:
  Clase Gateway
  - Constructor: config, messageQueue
  - connect(): inicializar cada adapter habilitado en config
  - Cada adapter.onMessage → normalize → detectCampaign → enqueue
  - send(channel, to, messages[]): buscar adapter → enviar
  - disconnect(): desconectar todos los adapters
  - activeChannels(): lista de canales conectados con health status
```

---

### STREAM C: INFRA + TOOLS (Tu dev técnico)

Este stream construye la base de datos, Redis, las tools concretas, 
el circuit breaker, la cola de mensajes, y el scheduler.

#### CLAUDE.md para Stream C

```markdown
# LUNA — Stream C: Infrastructure + Tools

## Tu responsabilidad
1. PostgreSQL: conexión, migraciones, stores (CRUD para cada tabla)
2. Redis: conexión, cache, rate limiting
3. Message Queue: BullMQ setup, worker registration
4. Tools: cada herramienta externa (Sheets, Calendar, Medilink, etc)
5. Circuit breaker
6. Scheduler (cron jobs)
7. Entry point (index.ts)

## Interfaces que PRODUCES
- db: { query, getClient, transaction }
- redis: ioredis connection
- MessageQueue: { enqueue(message) }
- WorkerPool: { start(handler), stop() }
- ToolRegistry: { register(tool), execute(name, input) }
- BaseTool: clase abstracta con retry + fallback
- CircuitBreaker: { recordSuccess, recordFailure, isOpen }
- Scheduler: { start(), stop(), registerJob() }

## Interfaces que CONSUMES
- Pipeline: { run(message) } (del stream A)
- Gateway: { send(channel, to, content) } (del stream B)
- Config files de /instance

## Dependencias npm
pg, drizzle-orm, ioredis, bullmq, googleapis, fuse.js, pino, zod
```

#### Tareas Stream C (en orden)

**C1: Database + Redis + Stores**
```
Crea src/memory/db.ts:
  Pool de pg con DATABASE_URL de .env
  Funciones: query(sql, params), getClient(), transaction(fn)
  Connection retry on startup (intentar 5 veces con backoff)

Crea src/memory/migrations/001_initial.sql:
  Schema completo (ver sección anterior de este documento)

Crea scripts/migrate.ts:
  Lee archivos .sql de migrations/, ejecuta en orden,
  track de migraciones ejecutadas (tabla schema_migrations)

Crea src/cache/redis.ts:
  Conexión ioredis con REDIS_URL de .env
  Retry on startup

Crea src/memory/contact-store.ts:
  - findBySenderId(channel, senderId) → Contact | null
  - create(data) → Contact
  - update(id, data) → Contact
  - addChannel(contactId, channel, senderId) → void
  - merge(keepId, removeId) → void (unifica 2 contacts)
  - findByPhone(phone) → Contact | null
  - findByEmail(email) → Contact | null

Crea src/memory/session-store.ts:
  - findActive(contactId, channel) → Session | null
  - create(contactId, channel) → Session
  - addMessage(sessionId, role, content, metadata?) → Message
  - getRecentMessages(sessionId, limit=10) → Message[]
  - compress(sessionId, summary) → void
  - close(sessionId) → void

Crea src/memory/commitment-store.ts:
  - create(data) → Commitment
  - findPending() → Commitment[]
  - findOverdue() → Commitment[]
  - markFulfilled(id) → void
  - markOverdue(id) → void

Crea src/memory/archive-store.ts:
  - archive(data) → void (async, no bloquea)

Crea src/memory/insight-store.ts:
  - create(contactId, type, content, sessionId?) → void
  - findByContact(contactId) → Insight[]
```

**C2: Message Queue + Workers**
```
Crea src/queue/message-queue.ts:
  Clase MessageQueue
  - Constructor: redis connection
  - Cola BullMQ: 'incoming-messages'
  - enqueue(message: NormalizedMessage) → jobId
  - Opciones: removeOnComplete: 1000, removeOnFail: 5000

Crea src/queue/lead-lock.ts:
  - acquireLock(senderId, ttlMs=60000) → boolean
    Usa Redis SET NX EX
  - releaseLock(senderId) → void
  - isLocked(senderId) → boolean

Crea src/queue/debounce.ts:
  - addMessage(senderId, text, messageId) → void
    Redis ZADD con timestamp como score
  - flush(senderId, windowMs=3000) → string[]
    Esperar windowMs, luego ZRANGE + ZREM
    Concatenar todos los textos con \n
  - Si solo hay 1 mensaje → return inmediato (no esperar)

Crea src/queue/worker.ts:
  Clase WorkerPool
  - Constructor: queue, concurrency (default 5)
  - Registrar handler: (message) => pipeline.run(message)
  - Para cada job:
    1. Debounce check
    2. Acquire lock por sender
    3. Ejecutar pipeline.run(message)
    4. Release lock
    5. Si error → log + send fallback message
  - Graceful shutdown: wait for active jobs
```

**C3: Base Tool + Circuit Breaker + Registry**
```
Crea src/tools/base-tool.ts:
  Clase abstracta BaseTool
  - abstract name: string
  - abstract description: string
  - abstract execute(input: any): Promise<ToolResult>
  - fallback(input, error): Promise<ToolResult | null> (override opcional)
  - degrade(input): ToolResult (lee de instance/fallbacks/)
  
  run(input):
    if circuitBreaker.isOpen(this.name) → return degrade(input)
    try:
      result = await withRetry(() => this.execute(input), { maxRetries: 1, backoffMs: 2000 })
      circuitBreaker.recordSuccess(this.name)
      return result
    catch:
      circuitBreaker.recordFailure(this.name)
      fallbackResult = await this.fallback(input, error)
      if fallbackResult → return fallbackResult
      return this.degrade(input)

Crea src/tools/circuit-breaker.ts:
  Clase CircuitBreaker
  - Estado en memoria (Map): { failures, lastFailure, state }
  - isOpen(toolName) → boolean
  - recordSuccess(toolName) → void (reset failures)
  - recordFailure(toolName) → void
  - Config: failureThreshold=5, resetTimeMs=300000 (5 min)
  - Si failures >= threshold → state = OPEN
  - Después de resetTimeMs → state = HALF_OPEN (1 probe)
  - Si probe OK → CLOSED. Si probe fail → OPEN otra vez.

Crea src/tools/tool-registry.ts:
  Clase ToolRegistry
  - register(tool: BaseTool) → void
  - execute(name: string, input: any) → ToolResult
  - list() → { name, status }[]
  - Lee instance/tools.json para saber cuáles activar
```

**C4: Google Sheets Tool + Cache**
```
Crea src/tools/sheets/google-sheets.ts:
  Clase GoogleSheetsTool extends BaseTool
  name = 'google_sheets'
  
  Usa OAuth2 de google-oauth.ts (stream B lo crea, tú lo consumes)
  
  execute(input: { action, sheetName, range?, data? }):
  - action='read': leer de cache Redis primero, si miss → API
  - action='update': escribir a Postgres, encolar sync a Sheet
  - action='append': idem
  
  Métodos internos:
  - readSheet(name) → data (de cache o API)
  - updateCell(name, range, value) → void
  - appendRow(name, data) → void
  
  fallback: leer de Postgres si Sheet API falla

Crea src/cache/sheets-cache.ts:
  - loadAll(): lee todos los sheets configurados → Redis
  - get(sheetName) → data | null (de Redis)
  - invalidate(sheetName) → void (borra key Redis)
  - refresh(sheetName) → leer de API → guardar en Redis
  - TTL: 25 horas. Cron diario a las 3AM hace loadAll()

Crea scripts/refresh-cache.ts:
  CLI: npx tsx scripts/refresh-cache.ts --sheet=catalogo
  O: npx tsx scripts/refresh-cache.ts --all
```

**C5: Google Calendar Tool**
```
Crea src/tools/calendar/google-calendar.ts:
  Clase GoogleCalendarTool extends BaseTool
  name = 'google_calendar'
  
  execute(input: { action, ... }):
  - action='check_availability': freeBusy API para un comercial + rango
  - action='get_slots': leer team.json → filtrar por región →
    check_availability de cada uno → return slots disponibles
  - action='book': crear evento en calendar del comercial
  - action='list_upcoming': listar eventos próximas 24h
  
  fallback: degrade con mensaje "No puedo verificar ahora..."
  + crear commitment para retry
```

**C6: Medilink Tool**
```
Crea src/tools/calendar/medilink.ts:
  Clase MedilinkTool extends BaseTool
  name = 'medilink'
  
  Base URL: configurable en .env (MEDILINK_API_URL)
  Auth: Token-based (MEDILINK_TOKEN en .env)
  
  Rate limiter: token bucket en Redis (20 req/min)
  
  execute(input: { action, ... }):
  - action='get_professionals': GET /profesionales
  - action='check_availability': GET /sucursales/{id}/profesionales/{id}/agendas
  - action='book': POST /citas (si endpoint existe)
  - action='get_patient': GET /pacientes con filtro
  
  Cache: disponibilidad en Redis TTL 5 min, profesionales TTL 1 hora
  fallback: degrade con mensaje + escalar a equipo
```

**C7: Knowledge Search + Media + Web Search + Escalation + Team**
```
Crea src/tools/knowledge/knowledge-search.ts:
  name = 'knowledge_search'
  
  Al inicializar: cargar todos los .md de instance/knowledge/ en memoria
  Indexar con fuse.js (fuzzy search)
  
  execute({ query }):
  - Buscar en índice fuse.js
  - Return top 3 secciones más relevantes
  - reloadIndex(): re-cargar archivos (cuando se actualizan)

Crea src/tools/media/media-sender.ts:
  name = 'media_sender'
  
  execute({ mediaName, channel, to }):
  - Buscar archivo en instance/knowledge/media/
  - Enviar via gateway.sendMedia()

Crea src/tools/web/web-search.ts:
  name = 'web_search'
  
  execute({ query }):
  - Usar Google GenAI con grounding
  - Fallback: buscar con Anthropic web search tool
  - Return: array de resultados { title, snippet, url }

Crea src/tools/escalation/escalation.ts:
  name = 'escalation'
  
  execute({ contactId, reason, context }):
  - Leer team.json → encontrar humano por región/disponibilidad
  - Enviar notificación WA al humano (via gateway)
  - Actualizar contact.assigned_to
  - Return: { assignedTo, notified }

Crea src/tools/team/team-directory.ts:
  name = 'team_directory'
  
  Lee instance/team.json
  execute({ action, region?, id? }):
  - action='by_region': filtrar por región
  - action='available': filtrar por horario actual
  - action='get': buscar por id
```

**C8: Scheduler + Proactive Jobs**
```
Crea src/proactive/scheduler.ts:
  Usa BullMQ repeatable jobs
  
  Jobs:
  - 'check-commitments': cada 5 min → commitments.findOverdue()
  - 'process-follow-ups': cada 15 min → buscar leads sin respuesta
  - 'send-reminders': cada 30 min → eventos próximas 2h
  - 'refresh-cache': diario 3AM → sheets-cache.loadAll()
  - 'nightly-batch': diario 2AM → scoring, compresión, reportes
  
  Cada job es idempotente (puede ejecutarse 2 veces sin daño)

Crea src/proactive/follow-ups.ts:
  processFollowUps(db, gateway, config):
  - Query: contacts con last_interaction_at > 4h y status qualifying
  - Contar follow-ups previos
  - Si < 3 → enviar template follow-up-{n}.md personalizado
  - Si >= 3 → marcar como cold

Crea src/proactive/reminders.ts:
  sendReminders(db, gateway, calendarTool):
  - Buscar eventos próximas 2h
  - Enviar recordatorio al lead Y al comercial
  - Template: instance/templates/meeting-reminder.md

Crea src/proactive/commitments.ts:
  checkCommitments(db, gateway):
  - Buscar overdue
  - Notificar al promised_by
  - Actualizar status
```

**C9: Entry Point + Config Loader + Health**
```
Crea src/index.ts:
  El main() como se definió arriba en este documento.
  Inicializa todo en orden, maneja graceful shutdown.

Crea src/config/loader.ts:
  - loadConfig(): lee .env + todos los archivos de instance/
  - Parsea .md como strings, .json con zod validation
  - Retorna objeto Config tipado
  - Si falta un archivo requerido → error claro con instrucciones

Crea src/config/env.ts:
  Validación de variables de entorno con zod:
  DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY,
  GOOGLE_GENAI_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  MEDILINK_API_URL (optional), MEDILINK_TOKEN (optional),
  SHADOW_MODE (boolean, default false),
  LOG_LEVEL (default 'info'),
  WORKER_CONCURRENCY (default 5)

Crea src/observability/logger.ts:
  Usa pino con JSON output
  Niveles: trace, debug, info, warn, error, fatal
  Cada log incluye: timestamp, level, module, message, data

Crea src/observability/health-check.ts:
  Express server mini (o Fastify) en puerto configurable
  GET /health → { status, db, redis, channels, uptime }
  GET /metrics → { messages_today, cost_today, errors_today }
  POST /cache/refresh → invalidar y recargar sheets cache
```

---

## CRONOGRAMA CON STREAMS PARALELOS

```
Día    Stream A (Engine)      Stream B (Gateway)     Stream C (Infra+Tools)
────── ────────────────────── ────────────────────── ──────────────────────
 1     —                      —                      C1: DB+Redis+Stores
 2     A1: LLM Providers      —                      C1: continúa
 3     A2: Router+Fallback    B1: Channel Interface   C2: Queue+Workers
 4     A3: Pipeline Core      B2: Baileys Adapter     C2: continúa
 5     A4: Preprocessor       B2: continúa            C3: BaseTool+Circuit
 6     A5: Classifier         B3: OAuth2+Email        C3: continúa
 7     A6: Complexity Router  B3: continúa            C4: Sheets+Cache
 8     A7: PromptBuilder      B4: Normalizer+         C5: Calendar
       +Responder             Campaign+UserIdent
 9     A8: Tool Executor      B5: Gateway Orch.       C6: Medilink
10     A9: Postprocessor      —                       C7: Knowledge+Media
                                                       +Web+Escalation+Team
────── ─── INTEGRACIÓN DÍA 11-12 ──────────────────────────────────────────
11-12  Conectar los 3 streams. Test end-to-end: WA msg → respuesta.
────── ────────────────────── ────────────────────── ──────────────────────
13     Tests de pipeline      Tests de channels      C8: Scheduler+Proactive
14     Fix bugs integración   Fix bugs integración   C8: continúa
15     —                      —                      C9: Entry point+Config
────── ─── CONFIG + TESTING DÍA 16-20 ──────────────────────────────────────
16-17  Config OneScreen (company.md, identity, instructions, knowledge)
18-19  Config Teff (idem)
20     Config OS Support (idem)
────── ─── SHADOW + PRODUCCIÓN DÍA 21-28 ──────────────────────────────────
21-22  Shadow mode con leads reales (tú revisas TODA respuesta generada)
23-24  Fix prompts, edge cases, ajustar complexity rules
25-26  Go live supervisado (envía respuestas reales, tú monitoras)
27-28  Estabilizar + documentar + handoff al equipo
```

---

## REGLA PARA INTEGRACIÓN

Cuando los 3 streams se juntan (día 11-12), el orden de conexión es:

```
1. Stream C arranca: DB + Redis + Config + Tools registered
2. Stream A se monta: Pipeline recibe db, redis, toolRegistry
3. Stream B se monta: Gateway recibe messageQueue
4. Workers se conectan: Queue → Worker → Pipeline
5. Scheduler se conecta: usa db, redis, gateway
6. index.ts los orquesta a todos
```

Cada stream debe tener tests que funcionen AISLADOS con mocks.
La integración real solo sucede en index.ts.
