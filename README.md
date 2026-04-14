# LUNA — Leads Unified Nurturing Agent

Agente de inteligencia artificial que atiende leads y clientes a través de múltiples canales de comunicación: WhatsApp, email, Google Chat y llamadas de voz. Califica prospectos, agenda citas, da seguimiento automático y escala a humanos cuando es necesario.

## Canales soportados

| Canal | Tecnología | Capacidades |
|-------|-----------|-------------|
| **WhatsApp** | Baileys (Web API) | Texto, imágenes, audio, documentos, stickers, grupos |
| **Email** | Gmail API (OAuth2) | Envío, respuesta, reenvío, adjuntos, búsqueda en inbox |
| **Google Chat** | Webhook + Chat API | Mensajes en spaces/rooms, menciones, Service Account |
| **Voz** | Twilio + Gemini Live | Llamadas entrantes/salientes, conversación en tiempo real |

## Funcionalidades principales

- **Conversación inteligente** — respuestas contextuales usando Claude (Anthropic) y Gemini (Google) con fallback automático entre proveedores
- **Calificación de leads** — scoring determinístico (sin LLM) basado en metodologías CHAMP/SPIN con pesos configurables y decay temporal
- **Base de conocimiento** — documentos, FAQs y sync desde Google Drive/URLs con búsqueda híbrida (texto + vectorial via pgvector)
- **Agendamiento** — integración con Google Calendar para disponibilidad y creación de citas
- **Tareas programadas** — seguimiento automático, recordatorios y campañas proactivas via BullMQ
- **Subagentes especializados** — delegación a agentes de investigación web, verificación iterativa y tareas complejas
- **Human-in-the-Loop** — escalamiento a supervisores humanos con cadena configurable por canal
- **Panel de control** — consola web SSR para configuración, monitoreo y gestión del agente
- **Monitoreo (Cortex)** — alertas, métricas, trazas y sistema Reflex de auto-corrección
- **Plantillas de documentos** — generación de comparativos, cotizaciones y presentaciones (Google Docs/Slides)
- **Integraciones** — Freshdesk KB, Medilink/HealthAtom, herramienta de flete (SeaRates + DHL)

## Requisitos

- **Node.js** >= 22
- **PostgreSQL** 16 con [pgvector](https://github.com/pgvector/pgvector)
- **Redis** 7+
- Al menos una API key de LLM: [Anthropic](https://console.anthropic.com/) o [Google AI](https://aistudio.google.com/)

## Inicio rápido

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/madl-droid/luna.git
cd luna
npm install
```

### 2. Levantar PostgreSQL y Redis (Docker)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Esto levanta PostgreSQL 16 + pgvector en `localhost:5432` y Redis 7 en `localhost:6379`.

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` y completar como mínimo:

```env
DB_HOST=localhost
DB_NAME=luna
DB_USER=luna
DB_PASSWORD=luna_dev
REDIS_HOST=localhost
ANTHROPIC_API_KEY=sk-ant-...    # o GOOGLE_AI_API_KEY para usar Gemini
```

### 4. Iniciar en modo desarrollo

```bash
npm run dev
```

En el primer arranque, LUNA ejecuta automáticamente las migraciones SQL y abre el **wizard de instalación** en `http://localhost:3000/setup` para configurar el agente.

### 5. Acceder a la consola

Una vez completado el setup: `http://localhost:3000/console`

## Despliegue en producción

LUNA se despliega como contenedor Docker con CI/CD automático via GitHub Actions.

### Despliegue rápido

```bash
# En el servidor:
mkdir -p /docker/luna-production && cd /docker/luna-production
# Copiar docker-compose.yml desde deploy/production/
cp .../deploy/production/docker-compose.yml .
# Copiar y configurar variables de entorno
cp .../deploy/.env.example .env
# Editar .env: DOMAIN, DB_PASSWORD, API keys...
nano .env
# Iniciar
docker compose up -d
```

### Stack de producción

- **App**: `ghcr.io/madl-droid/luna:latest` (Node.js 22 Alpine + ffmpeg + LibreOffice)
- **BD**: `pgvector/pgvector:pg16` (PostgreSQL 16 + extensión vectorial)
- **Cache**: `redis:7-alpine`
- **Proxy**: Traefik con HTTPS automático (Let's Encrypt)

### CI/CD

| Rama | Entorno | Deploy |
|------|---------|--------|
| `main` | Producción | Automático al push |
| `pruebas` | Staging | Automático al push |

### Backup y migración

Al migrar a un nuevo servidor, copiar:
1. **`instance/`** completo — contiene `config.key` (encriptación de secrets), knowledge base y configuración operacional
2. **Dump de PostgreSQL** — incluye auth de WhatsApp en tablas `wa_auth_*`

> Sin `instance/config.key`, los secrets almacenados en base de datos son irrecuperables.

## Configuración

### Variables de entorno

LUNA usa un sistema de configuración distribuido:
- Las variables de infraestructura (DB, Redis, puerto) se definen en `.env`
- Cada módulo declara sus propias variables con valores por defecto
- Ver [`.env.example`](.env.example) para la referencia completa con documentación inline

### Archivos de configuración (`instance/`)

```
instance/
├── config.json          ← configuración del agente (modelos, canales, comportamiento)
├── prompts/
│   ├── accents/         ← personalidad por región (es-MX, es-CO, en-US...)
│   ├── defaults/        ← templates de relación y rol del agente
│   └── system/          ← prompts del sistema, skills, scoring
├── fallbacks/           ← mensajes predefinidos cuando el LLM no está disponible
├── knowledge/           ← documentos de la base de conocimiento
└── tools/               ← configuración de herramientas externas
```

La configuración operacional se gestiona principalmente desde la **consola web** (`/console`).

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│                    HTTP Server                    │
│                  (Node.js nativo)                 │
├──────────────────────────────────────────────────┤
│                     Kernel                        │
│         Registry · Loader · Hooks · Config        │
├──────┬──────┬──────┬──────┬──────┬───────────────┤
│  WA  │Gmail │GChat │Voice │ ...  │   Módulos     │
├──────┴──────┴──────┴──────┴──────┤   feature:    │
│           Engine (Pipeline)       │  knowledge,   │
│  Phase1 → Effort Router →        │  lead-scoring, │
│  Agentic Loop → Post-process →   │  tools,       │
│  Phase5                          │  subagents,   │
│                                  │  cortex...    │
├──────────────────────────────────┴───────────────┤
│  LLM Gateway    │  Memory (Redis+PG)  │ pgvector │
│  Anthropic ↔ Google (circuit breaker)            │
├──────────────────────────────────────────────────┤
│        PostgreSQL 16 + pgvector  │    Redis 7    │
└──────────────────────────────────────────────────┘
```

### Sistema modular

LUNA usa un kernel que descubre y carga módulos dinámicamente al arrancar. Cada módulo es un directorio en `src/modules/` con un `manifest.ts` que declara:

- **Tipo**: `core-module`, `channel`, `feature` o `provider`
- **Lifecycle**: funciones `init()` y `stop()`
- **Dependencias**: otros módulos requeridos
- **Config schema**: variables de entorno propias (validadas con Zod)
- **UI**: campos para la consola web y rutas API

Los módulos se comunican entre sí exclusivamente via **hooks** (eventos tipados) y **services** del Registry. No hay imports directos entre módulos.

### Pipeline de mensajes

Cada mensaje entrante pasa por un pipeline de 5 fases:

1. **Phase 1** — Recepción y normalización del mensaje
2. **Effort Router** — Clasificación del esfuerzo requerido (low/medium/high)
3. **Agentic Loop** — Loop conversacional con herramientas (tool calling nativo)
4. **Post-process** — Quality gate, compresión, métricas
5. **Phase 5** — Envío de respuesta por el canal correspondiente

El pipeline soporta concurrencia controlada con priority lanes: reactive > proactive > background.

### LLM y fallback

- **Proveedor principal**: Anthropic (Claude)
- **Fallback**: Google (Gemini)
- **Circuit breaker**: 5 fallas en 10 minutos → proveedor marcado DOWN por 5 minutos, tráfico al fallback
- **Modelos por tarea**: cada nivel de esfuerzo y tarea especial (visión, embeddings, quality gate) usa el modelo óptimo

## Módulos incluidos

| Módulo | Tipo | Descripción |
|--------|------|-------------|
| `whatsapp` | channel | Canal WhatsApp via Baileys |
| `gmail` | channel | Canal email via Gmail API |
| `google-chat` | channel | Canal Google Chat |
| `twilio-voice` | channel | Canal de voz (Twilio + Gemini Live) |
| `llm` | provider | Gateway LLM unificado con circuit breaker |
| `memory` | core-module | Memoria conversacional (Redis + PostgreSQL) |
| `engine` | core-module | Pipeline de procesamiento de mensajes |
| `console` | core-module | Panel de control web (SSR) |
| `knowledge` | feature | Base de conocimiento con búsqueda híbrida |
| `lead-scoring` | feature | Calificación determinística de leads |
| `tools` | feature | Herramientas del agente (tool calling) |
| `subagents` | feature | Subagentes especializados |
| `scheduled-tasks` | feature | Tareas programadas y campañas |
| `google-apps` | provider | OAuth2, Drive, Sheets, Docs, Slides, Calendar |
| `prompts` | feature | Gestión centralizada de prompts |
| `cortex` | feature | Monitoreo, alertas y auto-corrección |
| `hitl` | feature | Escalamiento a humanos |
| `templates` | feature | Generación de documentos |
| `tts` | feature | Síntesis de voz (Gemini TTS) |
| `users` | core-module | Usuarios y permisos |
| `freshdesk` | feature | Integración Freshdesk KB |
| `medilink` | feature | Integración Medilink/HealthAtom |
| `freight` | feature | Estimación de flete internacional |

## Scripts disponibles

```bash
npm run dev          # Desarrollo con hot-reload (tsx)
npm run build        # Compilar TypeScript
npm test             # Ejecutar tests (vitest)
npm run test:watch   # Tests en modo watch
npm run lint         # Linter (ESLint)
npm run migrate      # Ejecutar migraciones manualmente
```

## Estructura del proyecto

```
src/
  index.ts              ← entry point
  kernel/               ← core: registry, loader, hooks, config, server HTTP, migraciones
  engine/               ← pipeline de procesamiento (5 fases, agentic loop, concurrencia)
  modules/              ← módulos del sistema (descubiertos automáticamente)
  extractors/           ← extractores globales de contenido (PDF, DOCX, URLs, audio...)
  tools/                ← herramientas externas (flete, Freshdesk)
  migrations/           ← migraciones SQL (auto-ejecutadas al arrancar)
instance/               ← configuración operacional (prompts, knowledge, fallbacks)
deploy/                 ← docker-compose + CI/CD
docs/                   ← documentación de arquitectura
```

## Stack tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Runtime | Node.js 22 (ESM) |
| Lenguaje | TypeScript 5.8 |
| Base de datos | PostgreSQL 16 + pgvector |
| Cache/Queue | Redis 7 + BullMQ |
| LLMs | Anthropic SDK, Google GenAI SDK |
| WhatsApp | Baileys |
| Voz | Twilio + Gemini Live |
| Google | OAuth2, Gmail, Calendar, Drive, Sheets, Docs, Slides, Chat |
| HTTP | Node.js nativo (sin Express/Fastify) |
| Logging | pino (JSON estructurado) |
| Testing | vitest |
| Contenedores | Docker + Traefik |
| CI/CD | GitHub Actions |

## Documentación adicional

### Operaciones
- [`docs/operations/runbook.md`](docs/operations/runbook.md) — Monitoreo, métricas, mantenimiento y respuesta a incidentes
- [`docs/operations/troubleshooting.md`](docs/operations/troubleshooting.md) — Problemas comunes y soluciones

### Arquitectura
- [`docs/architecture/module-system.md`](docs/architecture/module-system.md) — Guía completa del sistema de módulos
- [`docs/architecture/pipeline.md`](docs/architecture/pipeline.md) — Pipeline de procesamiento y modelos LLM
- [`docs/architecture/channel-guide.md`](docs/architecture/channel-guide.md) — Cómo crear un nuevo canal
- [`docs/architecture/lead-status.md`](docs/architecture/lead-status.md) — Máquina de estados de leads
- [`docs/architecture/lead-scoring.md`](docs/architecture/lead-scoring.md) — Sistema de calificación
- [`docs/architecture/knowledge.md`](docs/architecture/knowledge.md) — Base de conocimiento
- [`docs/architecture/concurrency.md`](docs/architecture/concurrency.md) — Control de concurrencia
- [`docs/architecture/prompts.md`](docs/architecture/prompts.md) — Sistema de prompts
- [`docs/architecture/voice-channel-guide.md`](docs/architecture/voice-channel-guide.md) — Canal de voz

### Contribuir
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Setup de desarrollo, convenciones de código y workflow

## Licencia

Proyecto privado. Todos los derechos reservados.
