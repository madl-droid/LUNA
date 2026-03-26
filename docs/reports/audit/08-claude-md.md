# Auditoria: CLAUDE.md Files
Fecha: 2026-03-26
Auditor: Claude (sesion automatizada)

## Resumen ejecutivo
- Total CLAUDE.md auditados: 29
- Lineas totales: 1,958
- Precision promedio: 94%
- Completitud promedio: 88%
- Consistencia: **media-alta** (2 violaciones menores a reglas, 2 docs de arquitectura no referenciados)

---

## Estado por archivo

### CLAUDE.md (raiz)
- Lineas: 224
- Precision: 95% (estructura de directorios casi completa, reglas verificadas)
- Completitud: 90% (falta modulo prompts en directorio, faltan 2 docs de arquitectura, faltan 3 dirs src/)
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Modulo `prompts` no aparece en seccion "Estructura de directorios" (si aparece en "Modulos documentados") | 20-53 |
| 2 | FALTANTE | `src/channels/` no documentado en estructura de directorios (contiene channel-adapter.ts, message-batcher.ts, types.ts, typing-delay.ts, whatsapp/) | 20-53 |
| 3 | FALTANTE | `src/llm/` no documentado en estructura (contiene model-scanner.ts) | 20-53 |
| 4 | FALTANTE | `src/memory/` no documentado en estructura (contiene memory-manager.ts, pg-store.ts, redis-buffer.ts, types.ts) | 20-53 |
| 5 | FALTANTE | `docs/architecture/concurrency.md` existe pero no esta referenciado en "Docs de referencia" | 220-224 |
| 6 | FALTANTE | `docs/architecture/voice-channel-guide.md` existe pero no esta referenciado en "Docs de referencia" | 220-224 |
| 7 | FALTANTE | `src/engine/attachments/` listado en "Modulos documentados" como si tuviera CLAUDE.md propio, pero no lo tiene (esta documentado inline en src/engine/CLAUDE.md) | 210 |
| 8 | OBSOLETO | Ejemplo en "Cuando crear uno nuevo" menciona `src/modules/llm-anthropic/` que no existe y no es un patron real del proyecto | 184 |

---

### src/kernel/CLAUDE.md
- Lineas: 78
- Precision: 95%
- Completitud: 80%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | INCORRECTO | Documenta `createServer()` y `startServer()` como funciones factory, pero server.ts exporta `class Server` con metodos `.start()` y `.stop()` | ~30 |
| 2 | FALTANTE | 14 hooks no documentados: `call:incoming`, `call:outgoing`, `call:connected`, `call:ended`, `call:transcript`, `channel:composing`, `channel:send_complete`, `contact:new`, `job:run`, `tools:register`, `tools:before_execute`, `tools:executed`, `user:resolved` | ~45-65 |
| 3 | FALTANTE | Exports `buildBaseUrl()` y `oauthCallbackPage()` de http-helpers.ts no documentados | ~25 |
| 4 | FALTANTE | Metodo `registry.hasHookListeners(hookName)` no documentado | ~50 |

---

### src/kernel/setup/CLAUDE.md
- Lineas: 34
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Todos los archivos, exports y funcionalidades documentados coinciden con el codigo real.

---

### src/modules/CLAUDE.md
- Lineas: 132
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Reglas de creacion de modulos correctas y completas.

---

### src/modules/console/CLAUDE.md
- Lineas: 102
- Precision: 89%
- Completitud: 89%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Archivo `templates-channel-settings.ts` (21KB) existe pero no esta documentado | — |

---

### src/modules/console/ui/CLAUDE.md
- Lineas: 101
- Precision: 86%
- Completitud: 86%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | INCORRECTO | Referencia directorio `assets/` (mascota, logos) que no existe en disco | ~21 |

---

### src/modules/engine/CLAUDE.md
- Lineas: 16
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Wrapper minimalista documentado correctamente.

---

### src/modules/whatsapp/CLAUDE.md
- Lineas: 63
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 15 config vars verificadas, todos los archivos y hooks correctos.

---

### src/modules/memory/CLAUDE.md
- Lineas: 49
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 21 config vars verificadas, todos los archivos correctos.

---

### src/modules/llm/CLAUDE.md
- Lineas: 57
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 25 config vars verificadas, 10 archivos documentados y presentes.

---

### src/modules/gmail/CLAUDE.md
- Lineas: 62
- Precision: 95%
- Completitud: 83%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Archivo `signature-parser.ts` existe en el directorio pero no esta documentado | — |

---

### src/modules/google-apps/CLAUDE.md
- Lineas: 66
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 9 archivos, 7 services, config vars — todo verificado.

---

### src/modules/google-chat/CLAUDE.md
- Lineas: 65
- Precision: 100%
- Completitud: 95%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | `.env.example` existe pero no se menciona | — |

---

### src/modules/knowledge/CLAUDE.md
- Lineas: 56
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Todos los archivos (incluyendo 8 extractors) verificados.

---

### src/modules/lead-scoring/CLAUDE.md
- Lineas: 114
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 11 archivos, 5 services, hooks verificados.

---

### src/modules/model-scanner/CLAUDE.md
- Lineas: 29
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Conciso pero completo para un modulo simple.

---

### src/modules/users/CLAUDE.md
- Lineas: 77
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 11 archivos (incluyendo subdirectorio sync/), 5 services verificados.

---

### src/modules/tools/CLAUDE.md
- Lineas: 55
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Los 3 hooks documentados (`tools:register`, `tools:before_execute`, `tools:executed`) SI existen en `tool-registry.ts` (no en manifest.ts, pero estan en el modulo).

---

### src/modules/prompts/CLAUDE.md
- Lineas: 34
- Precision: 95%
- Completitud: 85%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Hooks `console:config_saved` y `console:config_applied` implementados en manifest.ts pero no documentados | — |
| 2 | FALTANTE | `.env.example` existe pero no se menciona | — |

---

### src/modules/scheduled-tasks/CLAUDE.md
- Lineas: 59
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 7 archivos, 5 hooks, 2 services, 3 config vars — todo verificado.

---

### src/modules/tts/CLAUDE.md
- Lineas: 30
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 4 archivos, 8 config vars verificados exactamente.

---

### src/modules/twilio-voice/CLAUDE.md
- Lineas: 60
- Precision: 100%
- Completitud: 90%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Hook `console:config_applied` (manifest.ts:704) implementado pero no documentado | — |
| 2 | FALTANTE | `.env.example` existe pero no se menciona | — |

Nota: Los 3 hooks de call (`call:connected`, `call:ended`, `call:transcript`) SI existen en `call-manager.ts`.

---

### src/modules/freight/CLAUDE.md
- Lineas: 23
- Precision: 100%
- Completitud: 95%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | `.env.example` existe pero no se menciona | — |

---

### src/modules/freshdesk/CLAUDE.md
- Lineas: 26
- Precision: 100%
- Completitud: 95%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | `.env.example` existe pero no se menciona | — |

---

### src/modules/medilink/CLAUDE.md
- Lineas: 53
- Precision: 100%
- Completitud: 85%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | Hooks `message:incoming` y `console:config_applied` implementados en manifest.ts pero no documentados | — |
| 2 | FALTANTE | `.env.example` existe pero no se menciona | — |

---

### src/tools/freight/CLAUDE.md
- Lineas: 42
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 6 archivos fuente + 4 tests — todo verificado.

---

### src/tools/freshdesk/CLAUDE.md
- Lineas: 42
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** 6 archivos, config, Redis keys, flujo — todo verificado y correcto.

---

### src/engine/CLAUDE.md
- Lineas: 143
- Precision: 98%
- Completitud: 95%
- Issues:

| # | Tipo | Descripcion | Linea aprox |
|---|------|-------------|-------------|
| 1 | FALTANTE | `fallbacks/error-defaults.ts` existe pero solo `fallback-loader.ts` esta documentado en la seccion fallbacks/ | 44-45 |

---

### deploy/CLAUDE.md
- Lineas: 66
- Precision: 100%
- Completitud: 100%
- Issues: **Ninguna.** Archivos docker-compose, .env.example, y referencias a GitHub Actions verificados.

---

## Modulos/directorios sin CLAUDE.md que deberian tenerlo

| Directorio | Razon por la que necesita CLAUDE.md |
|------------|-------------------------------------|
| `src/llm/` | Contiene `model-scanner.ts` (12KB) — utilidad core usada por el modulo LLM. Sin documentacion, un agente no sabria que existe ni su relacion con `src/modules/llm/` |
| `src/memory/` | Contiene 4 archivos (`memory-manager.ts`, `pg-store.ts`, `redis-buffer.ts`, `types.ts`) — capa de implementacion de memoria. Sin documentacion, no es claro como se relaciona con `src/modules/memory/` |
| `src/channels/` | Contiene adaptadores base de canales (`channel-adapter.ts`, `message-batcher.ts`, `typing-delay.ts`, `types.ts`, `whatsapp/baileys-adapter.ts`). Aunque es una libreria utilitaria, un agente que trabaje en canales necesita saber que existe |

---

## Contradicciones encontradas

| # | Archivo 1 | Dice... | Archivo 2 | Dice... | Cual es correcto |
|---|-----------|---------|-----------|---------|------------------|
| 1 | src/kernel/CLAUDE.md | Server se crea con `createServer()` / `startServer()` (funciones factory) | server.ts (codigo) | Exporta `class Server` con `.start()` / `.stop()` | **Codigo** (class Server) |
| 2 | CLAUDE.md raiz | "Estructura de directorios" lista 18 modulos | src/modules/ real | 20 modulos (falta `prompts`) | **Codigo** (20 modulos) |
| 3 | CLAUDE.md raiz L210 | `src/engine/attachments/` listado como si tuviera CLAUDE.md propio | Disco | No existe CLAUDE.md en attachments/, se documenta inline en src/engine/CLAUDE.md | **Disco** (inline) |

---

## Informacion obsoleta

| # | Archivo | Linea | Que dice | Realidad en codigo |
|---|---------|-------|----------|--------------------|
| 1 | CLAUDE.md raiz | 184 | Ejemplo: "Al crear un nuevo modulo en `src/modules/` (ej: `src/modules/llm-anthropic/`)" | `llm-anthropic` no existe y nunca existio; el LLM gateway es `src/modules/llm/` |
| 2 | console/ui/CLAUDE.md | ~21 | Referencia directorio `assets/` con mascota y logos | El directorio `assets/` no existe en disco |

---

## Archivos reales no documentados

| # | Directorio | Archivo existente | CLAUDE.md no lo menciona |
|---|------------|-------------------|--------------------------|
| 1 | src/modules/console/ | `templates-channel-settings.ts` (21KB) | console/CLAUDE.md |
| 2 | src/modules/gmail/ | `signature-parser.ts` | gmail/CLAUDE.md |
| 3 | src/engine/fallbacks/ | `error-defaults.ts` | engine/CLAUDE.md |
| 4 | src/modules/google-chat/ | `.env.example` | google-chat/CLAUDE.md |
| 5 | src/modules/prompts/ | `.env.example` | prompts/CLAUDE.md |
| 6 | src/modules/twilio-voice/ | `.env.example` | twilio-voice/CLAUDE.md |
| 7 | src/modules/freight/ | `.env.example` | freight/CLAUDE.md |
| 8 | src/modules/freshdesk/ | `.env.example` | freshdesk/CLAUDE.md |
| 9 | src/modules/medilink/ | `.env.example` | medilink/CLAUDE.md |

---

## Gaps criticos (info que un agente IA necesitaria y no esta)

| # | Modulo | Que falta | Impacto para agente IA |
|---|--------|-----------|------------------------|
| 1 | kernel | 14 hooks no documentados (call, tools, channel, contact, user, job) | Un agente creando un modulo que necesite escuchar estos hooks no sabria que existen |
| 2 | raiz | Directorios `src/channels/`, `src/llm/`, `src/memory/` no documentados | Un agente no sabria que la logica core de canales, LLM y memoria esta fuera de modules/ |
| 3 | raiz | `docs/architecture/concurrency.md` no referenciado | Un agente trabajando en engine/concurrency no encontraria la guia de 3 capas de concurrencia |
| 4 | raiz | `docs/architecture/voice-channel-guide.md` no referenciado | Un agente creando un canal de voz no encontraria la guia especifica |
| 5 | kernel | Server API documentada incorrectamente (factory vs class) | Un agente intentaria usar `createServer()` que no existe |
| 6 | console | `templates-channel-settings.ts` no documentado (21KB) | Un agente trabajando en console UI para canales no sabria que este archivo existe |
| 7 | prompts | Hooks implementados no documentados | Un agente no sabria que prompts reacciona a config_saved y config_applied |

---

## Reglas del CLAUDE.md raiz — cumplimiento real

| Regla | Se cumple | Evidencia |
|-------|-----------|-----------|
| No ORM (Drizzle, Prisma, TypeORM) | SI | No hay dependencias ORM en package.json ni imports en codigo |
| No Express ni Fastify | SI | No hay dependencias en package.json; servidor HTTP nativo en kernel/server.ts |
| No importar codigo entre modulos directamente | PARCIAL | 2 imports `type`-only entre modulos (google-chat→prompts, gmail→google-apps). Runtime usa registry correctamente. Violacion tecnica menor. |
| No process.env fuera de kernel/config.ts | NO (2 violaciones) | `src/modules/whatsapp/manifest.ts:424`: `process.env.INSTANCE_ID`; `src/modules/engine/manifest.ts:455`: `process.env['LOG_LEVEL']` |
| ESM imports con .js | SI | Verificacion por muestreo: todos los imports relativos incluyen extension .js |
| No pgvector externo | SI | No hay imports de Pinecone, Weaviate u otros en el codigo |
| No SPA para console | SI | Console usa SSR con templates server-side |
| No sync bidireccional Sheets | SI | Postgres es fuente de verdad, writes a Sheets son async |
| noUncheckedIndexedAccess | SI | Activo en tsconfig; codigo usa `!` o `?.` en accesos por indice |
| Modulos declaran configSchema | SI | Todos los modulos auditados tienen configSchema en manifest.ts |
| Helpers HTTP del kernel (no redefinir) | SI | No se encontraron redefiniciones de readBody/jsonResponse/parseBody/parseQuery en modulos |
| Config helpers del kernel (numEnv, boolEnv) | SI | Modulos usan los helpers correctamente |

---

## Score de documentacion: 4/5

**Justificacion:**

La documentacion es **notablemente buena** para un proyecto de este tamano:
- **29 CLAUDE.md** cubriendo kernel, 20 modulos, 2 tools, engine, y deploy
- **Precision alta** (94%): la gran mayoria de archivos, hooks, services y config vars documentados coinciden con el codigo real
- **Template consistente**: la mayoria de modulos siguen el formato recomendado (proposito, archivos, manifest, hooks, patrones, trampas)
- **Reglas bien definidas** y mayoritariamente cumplidas (solo 2 violaciones menores de process.env)

Pierde 1 punto por:
- 14 hooks no documentados en kernel (gap critico para agentes)
- 3 directorios src/ completamente invisibles en la documentacion
- 2 docs de arquitectura no referenciados
- Patron sistematico de omitir `.env.example` en 6 modulos
- Server API incorrectamente documentada

---

## Top 15 correcciones prioritarias

1. **kernel/CLAUDE.md**: Corregir Server API — documentar `class Server` con `.start()`/`.stop()` en vez de `createServer()`/`startServer()`
2. **kernel/CLAUDE.md**: Agregar los 14 hooks faltantes al listado de HookMap (call:*, tools:*, channel:*, contact:new, job:run, user:resolved)
3. **CLAUDE.md raiz**: Agregar `prompts/` a la seccion "Estructura de directorios"
4. **CLAUDE.md raiz**: Agregar `src/channels/`, `src/llm/`, `src/memory/` a la estructura de directorios
5. **CLAUDE.md raiz**: Agregar referencias a `docs/architecture/concurrency.md` y `docs/architecture/voice-channel-guide.md` en "Docs de referencia"
6. **CLAUDE.md raiz**: Corregir entrada de `src/engine/attachments/` en "Modulos documentados" — aclarar que se documenta inline en src/engine/CLAUDE.md
7. **console/CLAUDE.md**: Documentar `templates-channel-settings.ts`
8. **gmail/CLAUDE.md**: Documentar `signature-parser.ts`
9. **engine/CLAUDE.md**: Documentar `fallbacks/error-defaults.ts`
10. **whatsapp/manifest.ts**: Mover `process.env.INSTANCE_ID` al configSchema (violacion de regla maxima)
11. **engine/manifest.ts**: Eliminar lectura directa de `process.env['LOG_LEVEL']` (violacion de regla maxima)
12. **prompts/CLAUDE.md**: Documentar hooks `console:config_saved` y `console:config_applied`
13. **medilink/CLAUDE.md**: Documentar hooks `message:incoming` y `console:config_applied`
14. **console/ui/CLAUDE.md**: Corregir o eliminar referencia a directorio `assets/` inexistente
15. **CLAUDE.md raiz**: Cambiar ejemplo `src/modules/llm-anthropic/` por un nombre realista como `src/modules/mi-modulo/`
