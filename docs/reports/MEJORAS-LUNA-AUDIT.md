# AUDITORÍA LUNA AI — Consolidado de Mejoras
**Fecha**: 2026-04-09
**Alcance**: Interacciones de testing en lab, bugs, servidor, calidad de respuesta

---

## BUGS CRÍTICOS — Rompen funcionalidad

### B1. HITL SQL type mismatch
- **Archivo**: `luna-repo/src/engine/agentic/hitl/handoff.ts:49`
- **Qué pasa**: Query `SELECT c.phone FROM contacts c JOIN user_contacts uc ON c.id = uc.user_id WHERE uc.sender_id = $1` falla con `operator does not exist: uuid = character varying`. Esto mató el único pipeline que falló durante testing.
- **Impacto**: Cualquier mensaje que active HITL crashea el pipeline completo. No hay retry, el mensaje se pierde.
- **Fix**: Agregar cast explícito `$1::text` o `uc.user_id::uuid` en la cláusula WHERE.

### B2. Buffer compression nunca se ejecuta
- **Archivo**: `luna-repo/src/engine/buffer-compressor.ts`
- **Qué pasa**: `MEMORY_BUFFER_MESSAGE_COUNT=50` limita Redis a ~50 mensajes (~25 turns). `MEMORY_COMPRESSION_THRESHOLD=30` requiere 30 turns para comprimir. 25 < 30, entonces la condición `turnCount <= threshold` siempre es true y la compresión nunca arranca.
- **Impacto**: En conversaciones largas, el contexto crece sin control hasta llenar la ventana del modelo. Luna pierde coherencia o el request falla por exceso de tokens.
- **Fix**: Subir `MEMORY_BUFFER_MESSAGE_COUNT=150` O bajar `MEMORY_COMPRESSION_THRESHOLD=20` en manifest.ts y config_store.

### B3. Image prompt key mismatch
- **Archivo**: `luna-repo/src/extractors/image.ts`
- **Qué pasa**: El código busca el prompt `image-description` pero el archivo se llama `image-extraction.md`. Logs muestran 5 veces "System prompt template not found". Cae al fallback hardcoded que incluye formato `[DESCRIPCIÓN]/[RESUMEN]`.
- **Impacto**: Bajo en producción (el fallback funciona mejor que el prompt incompleto del archivo). Pero genera warnings innecesarios y si alguien "arregla" el nombre sin el formato dual, rompe `parseDualDescription()`.
- **Fix**: Renombrar `lab/instance/prompts/system/image-extraction.md` a `image-description.md` Y actualizar su contenido para incluir el formato `[DESCRIPCIÓN]/[RESUMEN]` obligatorio.

### B4. HITL tickets no auto-expiran
- **Tabla**: `hitl_tickets`
- **Qué pasa**: Se encontraron 2 tickets de tipo `escalation` con status `notified` que llevan +19 horas pasados de su `expires_at`. El job de expiración no los limpia.
- **Impacto**: Tickets zombis bloquean conversaciones de contactos que comparten el sender_id (ver caso Cristian Marin).
- **Fix**: Revisar y corregir el cron/job de expiración de tickets. Se mitiga con el rediseño quote-based (sección HITL).

### B5. HITL interceptor matchea por sender_id, no por contexto
- **Archivo**: `luna-repo/src/modules/hitl/message-interceptor.ts`
- **Qué pasa**: El interceptor busca tickets abiertos por `requester_sender_id`. CUALQUIER mensaje del humano asignado se consume como respuesta al ticket, bloqueando su conversación normal con Luna.
- **Impacto**: Cristian Marin no puede hablar con Luna porque sus mensajes se interpretan como resoluciones de tickets ajenos. Cualquier coworker con un ticket abierto pierde acceso a Luna hasta que el ticket se resuelva o expire.
- **Fix**: Rediseño completo a quote-based (ver sección REDISEÑO HITL). Solo mensajes que citen la notificación HITL se tratan como respuestas.

### B6. Gmail module usa tabla OAuth separada — nunca arranca
- **Archivos**: `src/modules/gmail/` + `src/modules/google-apps/`
- **Qué pasa**: El módulo `gmail` busca credenciales en `email_oauth_tokens` (vacía). El módulo `google-apps` tiene un token válido en `google_oauth_tokens` con scopes de Gmail (`gmail.readonly`, `gmail.send`, `gmail.modify`). Son dos sistemas OAuth separados para la misma cuenta (`luna@clinicateff.com`).
- **Impacto**: El polling de email nunca arranca. Emails enviados a Luna no llegan al sistema. Además `EMAIL_FROM` está en blanco.
- **Fix (unificar OAuth)**: El módulo `gmail` debe usar la misma tabla `google_oauth_tokens` del módulo `google-apps`. Una sola autenticación OAuth de Google para todos los servicios (Drive, Sheets, Gmail, etc). Eliminar `email_oauth_tokens` como tabla separada.
- **Fix (control de activación)**: Si `EMAIL_ENABLED=false` o el módulo gmail está desactivado, Luna simplemente no debe hacer polling ni responder emails — pero NO por falta de OAuth, sino por configuración explícita. El estado correcto es: OAuth unificado siempre disponible, el flag `EMAIL_ENABLED` controla si el canal está activo o no.

---

## CALIDAD DE RESPUESTA — Luna responde mal o incompleto

### Q1. Luna ignora las descripciones de imágenes ("piel bonita")
- **Síntoma**: Usuario envía foto con acné. Gemini Vision describe correctamente "piel con lesiones de acné". Luna ve la descripción en su contexto pero responde con halagos genéricos ("qué bonita piel").
- **Causa raíz**: No es el extractor (funciona perfecto). Es que el system prompt no tiene instrucción de USAR las descripciones visuales. Luna trata la descripción como metadata ignorable.
- **Fix**: Agregar en system prompt: "Cuando el usuario envíe una imagen y recibas una descripción visual, DEBES referenciar lo que se describe en tu respuesta. No hagas halagos genéricos — responde sobre lo que ves."

### Q2. Guardrails de lab desactualizados
- **Archivo lab**: `lab/instance/prompts/defaults/guardrails.md` (10 líneas)
- **Archivo producción**: `luna-repo/instance/prompts/defaults/guardrails.md` (30 líneas)
- **Qué falta en lab**: Jerarquía de fuentes (5 tiers), validación de URLs, reglas de identidad OneScreen, anti-alucinación para datos de negocio, prohibición de usar training data para info comercial.
- **Impacto**: Luna en lab puede alucinar precios, inventar URLs, dar info de negocio sin verificar fuentes.
- **Fix**: Copiar el archivo de producción al lab.

### Q3. Knowledge chunking malo para precios
- **Síntoma**: Luna busca precios, encuentra 74 hits en 28 chunks, pero no logra dar el precio de un tratamiento específico.
- **Causa raíz**: El documento de precios está mal segmentado. Nombres de tratamientos y sus precios caen en chunks distintos. La búsqueda semántica encuentra el chunk del nombre pero no el del precio, o viceversa.
- **Fix**: Re-procesar el documento de precios para que cada chunk sea una unidad atómica: nombre del tratamiento + precio + descripción breve juntos.

### Q4. Sin retry para mensajes reactivos
- **Qué pasa**: El pipeline de mensajes de usuario es fire-and-forget. Si falla (como con B1), el mensaje se pierde. Solo existe orphan recovery como safety net pasivo que corre periódicamente.
- **Impacto**: Si hay un error transitorio (red, timeout, bug), el usuario no recibe respuesta y no hay segundo intento.
- **Fix**: Implementar retry con backoff exponencial (max 2 reintentos) para pipelines que fallen en fases 1-4. No reintentar si ya se entregó respuesta parcial en fase 5.

---

## SERVIDOR — Recursos para soportar 100 usuarios

### S1. RAM del container: 512 MB → 1.5 GB
- **Estado actual**: 512 MB límite, usando 225 MB (44%) solo con testing.
- **Problema**: Con 100 conversaciones concurrentes el heap se llena → OOM kill.
- **Host disponible**: 16 GB RAM total, 13 GB libres.
- **Comando**: `docker update --memory=1536m --memory-swap=3g lab`

### S2. CPU del container: 1 vCPU → 2 vCPUs
- **Estado actual**: 1 vCPU, corriendo al 105% en idle/testing.
- **Problema**: Node.js necesita CPU para JSON parsing, prompt building, serialización. Con 100 usuarios el event loop se satura.
- **Host disponible**: 4 CPUs totales.
- **Comando**: `docker update --cpus=2 lab`

### S3. Node.js heap: 259 MB → 1024 MB
- **Estado actual**: Sin `NODE_OPTIONS`, V8 auto-limita a 259 MB dentro de un container de 512 MB.
- **Problema**: Heap insuficiente para mantener 100 contextos de conversación simultáneos.
- **Comando**: Agregar variable de entorno `NODE_OPTIONS=--max-old-space-size=1024` al container.

### S4. DB pool (aplicación): 20 → 50 conexiones
- **Estado actual**: `DB_MAX_CONNECTIONS=20` en env del container. Las 20 conexiones ya están reservadas (20 idle).
- **Problema**: Cada pipeline usa 2-3 queries simultáneas. 20 conexiones saturan con ~8-10 pipelines paralelos.
- **Comando**: Cambiar env `DB_MAX_CONNECTIONS=50` y reiniciar container.

### S5. PostgreSQL max_connections: 50 → 100
- **Estado actual**: PG server permite 50 conexiones. App usa 21 de 50.
- **Problema**: Si subimos el pool a 50 (S4), PG necesita margen para conexiones de sistema + otros servicios.
- **Comando**: `docker exec lab-postgres psql -U luna -d luna_lab -c "ALTER SYSTEM SET max_connections = 100;"` + restart PG.

### S6. Verificar tier de API Anthropic
- **Estado actual**: 3 keys separadas (engine, memory, cortex). Tier desconocido.
- **Necesario**: ≥400 RPM combinadas entre las 3 keys.
- **Acción**: Revisar en console.anthropic.com el rate limit de cada key.

---

## REDISEÑO HITL — Interceptor basado en citas (quote-based)

### Problema actual
El interceptor HITL decide si un mensaje es "respuesta humana" buscando tickets abiertos por `requester_sender_id`. Si el humano (coworker/admin) tiene UN ticket abierto y envía CUALQUIER mensaje, ese mensaje se consume como respuesta al ticket. Esto bloquea la conversación normal del humano con Luna.

**Caso real encontrado**: Cristian Marin no puede hablar con Luna porque hay 2 tickets zombis de escalation (vencidos hace 19+ horas) asociados a su sender_id. Cada mensaje que envía se interpreta como resolución de ticket en vez de llegar al pipeline.

### Rediseño propuesto: Quote-based HITL

**Principio**: Solo los mensajes que **citen (quoten) el mensaje de notificación HITL** se tratan como respuestas a tickets. Todo lo demás fluye normal al pipeline de Luna.

#### Cambios en `message-interceptor.ts`

**Flujo actual (a eliminar)**:
1. Mensaje llega → buscar tickets abiertos por sender_id → si hay ticket → clasificar intent → consumir

**Flujo nuevo**:
1. Mensaje llega → verificar si **cita un mensaje** (`quotedMessage` en contextInfo)
2. Si NO cita nada → pasa directo al pipeline de Luna (sin importar si hay tickets abiertos)
3. Si cita un mensaje → verificar si el mensaje citado es una **notificación HITL** (matchear por formato o por ID almacenado)
4. Si es cita de HITL → extraer ticket_id del mensaje citado → procesar como respuesta al ticket
5. Si es cita de otro mensaje → pasa al pipeline normal

#### Cambios en `notifier.ts`

**Al enviar la notificación HITL al humano**:
1. Guardar el `messageId` del mensaje de notificación enviado en la tabla `hitl_tickets` (nuevo campo `notification_message_id`)
2. También guardar en Redis: `hitl:notification:{messageId} → ticketId` (TTL = ticket expiry)
3. Esto permite identificar rápidamente si un quoted message es una notificación HITL

**Formato de notificación (mantener actual + agregar instrucción)**:
```
(!) *HITL — Admin Request*
Contacto: John Doe (+541234567890) [lead]
Ticket: #ABC123
Tipo: domain_help
Resumen: Usuario pregunta por envíos a Argentina

Mensaje del cliente: "¿Cuánto sale enviar a Argentina?"

↩️ Cita este mensaje para responder al ticket.
```

#### Nuevo comando: "qué tickets tenemos abiertos"

**En el interceptor, agregar detección de comando** (antes del check de quote):
1. Si el mensaje del humano matchea patrones como: "tickets abiertos", "tickets pendientes", "hitl pendientes", "qué tickets hay", "open tickets"
2. Consultar `hitl_tickets` con status IN ('notified', 'waiting') donde el responder es el sender actual
3. Responder con lista formateada:

```
📋 *Tickets HITL abiertos (3):*

1. #ABC123 — domain_help
   Contacto: John Doe (+54...)
   Hace: 2h 15min
   "¿Cuánto sale enviar a Argentina?"

2. #DEF456 — authorization
   Contacto: María López (+57...)
   Hace: 45min
   "Necesito aprobar descuento del 20%"

3. #GHI789 — escalation
   Contacto: Pedro Ruiz (+52...)
   Hace: 10min
   "Quiere hablar con un gerente"

↩️ Cita el mensaje original del ticket para responder.
```

4. Este mensaje de lista NO se consume — el humano puede seguir hablando con Luna normalmente.

#### Flujo de respuesta ticket por ticket

1. Humano ve la lista (o recuerda la notificación original)
2. Humano **cita** el mensaje de notificación del ticket #ABC123
3. Escribe su respuesta: "El envío a Argentina cuesta $150 USD, tarda 5-7 días"
4. Interceptor detecta la cita → identifica ticket → resuelve con la respuesta
5. Luna reformula vía LLM y envía al cliente (flujo existente de `resolver.ts`)
6. **La conversación normal del humano con Luna NO se interrumpe en ningún momento**

#### Cambios en handoff (mantener igual)

El handoff completo (`@Luna` para devolver control) sigue funcionando igual. El quote-based solo aplica al flujo de respuesta a tickets individuales.

#### Migración necesaria

```sql
ALTER TABLE hitl_tickets ADD COLUMN IF NOT EXISTS notification_message_id TEXT;
```

#### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/modules/hitl/message-interceptor.ts` | Reescribir lógica: quote-based en vez de sender-based |
| `src/modules/hitl/notifier.ts` | Guardar message_id de notificación, actualizar texto instrucción |
| `src/modules/hitl/types.ts` | Agregar `notification_message_id` a HitlTicket |
| `src/modules/hitl/ticket-store.ts` | Método `findByNotificationMessageId()`, método `listActiveByResponder()` |
| Nueva migración SQL | Campo `notification_message_id` en hitl_tickets |

#### Bugs relacionados que se resuelven con este rediseño

- **B4 (tickets no auto-expiran)**: Aunque se implemente expiración, el rediseño hace que tickets vencidos ya no bloqueen conversaciones porque solo se activan por cita explícita.
- **B5 (matcheo por sender_id)**: Eliminado por completo. Ya no se busca por sender_id sino por mensaje citado.
- **Caso Cristian**: Se desbloquea inmediatamente sin necesidad de expirar tickets manualmente.

---

## LIMPIEZA — Código muerto

### L1. ExecutionQueue es código huérfano
- **Archivos**: `luna-repo/src/engine/concurrency/execution-queue.ts`
- **Qué pasa**: `createExecutionQueue()` nunca se llama. El engine usa `PipelineSemaphore` (50 slots) + `ContactLock`. Todo el sistema de lanes (reactive=8/proactive=3/background=2/globalMax=12) no existe en runtime.
- **Acción**: Eliminar o marcar como futuro. No afecta funcionamiento actual.

### L2. Config store con keys que nadie lee
- **Keys**: `EXECUTION_QUEUE_REACTIVE_CONCURRENCY=8`, `EXECUTION_QUEUE_PROACTIVE_CONCURRENCY=3`, `EXECUTION_QUEUE_BACKGROUND_CONCURRENCY=2`
- **Qué pasa**: Están en config_store pero ningún código las consume. El manifest del engine no las declara.
- **Acción**: Eliminar de config_store para evitar confusión.

---

## LO QUE FUNCIONA BIEN

- **PipelineSemaphore**: 50 pipelines concurrentes + cola de 200. Capacidad de software sobra para 100 usuarios.
- **ContactLock**: Serialización por contacto correcta. Fallos no bloquean mensajes siguientes.
- **Circuit breaker**: Escalante por provider:model. 2 fallos en 30min → abre. Recovery 1h→3h→6h. Bien diseñado.
- **Effort router**: Clasificación determinista <5ms. normal→Sonnet, complex→Opus. Correcto y rápido.
- **Extractor de imágenes**: Gemini Vision describe con precisión. El problema es Q1 (Luna ignora), no el extractor.
- **Redis**: 128 MB, 6% uso. Suficiente para 100+ usuarios.
- **3 API keys Anthropic**: Distribuyen carga entre engine, memory y cortex. Buen diseño.
- **Delays intencionales**: Correcto para naturalidad del bot. No son demoras innecesarias.
- **Dedup in-memory**: LRU de 10K entradas como fallback si Redis cae. Bien pensado.

---

## ORDEN DE EJECUCIÓN SUGERIDO

| Prioridad | ID | Descripción | Esfuerzo | Downtime |
|---|---|---|---|---|
| 1 | B1 | Fix HITL SQL cast | 1 línea | No |
| 2 | B4+B5 | **Rediseño HITL quote-based** (interceptor + notifier + comando de lista) | Desarrollo medio (~4 archivos + migración) | No |
| 3 | S1+S2 | RAM y CPU del container | Docker update | No |
| 4 | S3 | Node.js heap size | Env var | Restart app |
| 5 | Q1 | Prompt para usar descripciones de imagen | 1 párrafo en prompt | No |
| 6 | Q2 | Sincronizar guardrails lab ↔ prod | Copiar archivo | No |
| 7 | S4+S5 | DB pool + PG max_connections | Config + restart PG | ~10s PG restart |
| 8 | B2 | Fix compression threshold | 1 valor en config | No |
| 9 | Q3 | Re-chunking documento precios | Re-procesar knowledge | No |
| 10 | B3 | Renombrar prompt imagen | Renombrar + editar archivo | No |
| 11 | Q4 | Retry para mensajes reactivos | Desarrollo nuevo | No |
| 12 | B6 | Unificar OAuth Google (gmail + google-apps = 1 sola tabla) | Desarrollo medio | Restart app |
| 13 | L1+L2 | Limpieza código/config muerta | Opcional | No |
| 14 | S6 | Verificar tier API Anthropic | Manual en console | No |
