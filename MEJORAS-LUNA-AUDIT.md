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
| 2 | S1+S2 | RAM y CPU del container | Docker update | No |
| 3 | S3 | Node.js heap size | Env var | Restart app |
| 4 | Q1 | Prompt para usar descripciones de imagen | 1 párrafo en prompt | No |
| 5 | Q2 | Sincronizar guardrails lab ↔ prod | Copiar archivo | No |
| 6 | S4+S5 | DB pool + PG max_connections | Config + restart PG | ~10s PG restart |
| 7 | B2 | Fix compression threshold | 1 valor en config | No |
| 8 | Q3 | Re-chunking documento precios | Re-procesar knowledge | No |
| 9 | B3 | Renombrar prompt imagen | Renombrar + editar archivo | No |
| 10 | Q4 | Retry para mensajes reactivos | Desarrollo nuevo | No |
| 11 | L1+L2 | Limpieza código/config muerta | Opcional | No |
| 12 | S6 | Verificar tier API Anthropic | Manual en console | No |
