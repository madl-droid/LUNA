# Engine — Modelo de concurrencia

El pipeline de mensajes usa **3 capas de control de concurrencia** que operan en serie. Cada capa resuelve un problema distinto.

```
Mensaje entrante
      │
      ▼
┌─────────────────────────────────┐
│  Capa 1: PipelineSemaphore      │  Global — limita pipelines simultáneos
│  (max 50, cola max 200)         │
└─────────────┬───────────────────┘
              │ acquire() → 'ok' | 'queued' | 'rejected'
              ▼
┌─────────────────────────────────┐
│  Capa 2: ContactLock            │  Per-contact — serializa mensajes del mismo contacto
│  (in-memory, Map<contactId>)    │
└─────────────┬───────────────────┘
              │ withLock(contactId, fn)
              ▼
   Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
                          │
                          ▼
              ┌───────────────────────┐
              │  Capa 3: StepSemaphore│  Per-pipeline — limita pasos concurrentes
              │  (max 5)              │  dentro de Phase 3
              └───────────────────────┘
```

## Capa 1: PipelineSemaphore

**Archivo:** `src/engine/concurrency/pipeline-semaphore.ts`
**Propósito:** Limitar el throughput global del sistema para evitar saturar LLMs, DB y Redis.

### Comportamiento

1. `acquire(callerId)` intenta obtener un slot:
   - `'ok'` → slot disponible, continuar
   - `'queued'` → no hay slots, el mensaje se encola (FIFO) y espera
   - `'rejected'` → la cola está llena, se envía mensaje de backpressure al usuario

2. `release()` libera un slot y despierta al siguiente en cola.

3. `stats()` retorna `{ running, queued, maxConcurrent, maxQueue }` para monitoreo.

### Config

| Env var | Default | Descripción |
|---------|---------|-------------|
| `ENGINE_MAX_CONCURRENT_PIPELINES` | 50 | Slots simultáneos |
| `ENGINE_MAX_QUEUE_SIZE` | 200 | Mensajes en espera antes de rechazar |
| `ENGINE_BACKPRESSURE_MESSAGE` | "Estamos atendiendo muchos clientes..." | Texto enviado al rechazar |

### Wiring

- Se crea en `initEngine()` (`src/engine/engine.ts`)
- Se usa en `processMessage()` como primera barrera antes de ejecutar cualquier fase
- Se libera en el bloque `finally` de `processMessage()`
- Stats expuestos via API en `GET /api/engine/stats`

---

## Capa 2: ContactLock

**Archivo:** `src/engine/concurrency/contact-lock.ts`
**Propósito:** Serializar pipelines reactivos del mismo contacto para evitar race conditions en sesión, historial y estado del lead.

### Comportamiento

- `withLock(contactId, fn)` espera a que termine cualquier pipeline previo del mismo contacto, luego ejecuta `fn`.
- Contactos diferentes corren en paralelo (no se bloquean entre sí).
- Limpieza automática: elimina la entrada del Map al terminar.

### Diseño: dos locks de contacto distintos

| Lock | Scope | Storage | Propósito |
|------|-------|---------|-----------|
| **ContactLock** (esta capa) | Reactivo | In-memory Map | Serializar mensajes reactivos del mismo contacto |
| **Redis contact lock** (proactive/guards.ts) | Proactivo | Redis key `contact:active:{id}` | Evitar que jobs proactivos interrumpan pipelines reactivos |

Phase 5 setea el Redis lock después de enviar la respuesta. Los guards proactivos lo verifican antes de ejecutar un job.

### Wiring

- Se crea en `initEngine()`
- Se usa en `processMessage()` después del semáforo global
- `activeCount()` expuesto en `GET /api/engine/stats`

---

## Capa 3: StepSemaphore

**Archivo:** `src/engine/concurrency/step-semaphore.ts`
**Propósito:** Limitar pasos concurrentes dentro de Phase 3 (ejecución del plan) para no saturar backends de tools, LLMs y DB.

### Comportamiento

- Se crea **por pipeline** (no global) con `new StepSemaphore(maxConcurrentSteps)`.
- `run<T>(fn)` adquiere un slot, ejecuta `fn`, libera.
- Phase 3 agrupa pasos en independientes (sin `dependsOn`) y dependientes:
  - **Independientes:** se ejecutan en paralelo via `Promise.allSettled()`, cada uno pasando por el semáforo.
  - **Dependientes:** se ejecutan secuencialmente, también a través del semáforo (para control de recursos).

### Config

| Env var | Default | Descripción |
|---------|---------|-------------|
| `ENGINE_MAX_CONCURRENT_STEPS` | 5 | Pasos simultáneos por pipeline |

### Wiring

- Se instancia al inicio de `phase3Execute()` en `src/engine/phases/phase3-execute.ts`
- Envuelve cada llamada a `executeStep()`

---

## Concurrencia en attachments

**Archivo:** `src/engine/attachments/processor.ts`

Separado de las 3 capas del pipeline, el procesamiento de adjuntos tiene su propio control:

- `parallelWithLimit(items, MAX_CONCURRENT, fn)` — ejecuta hasta 3 adjuntos simultáneamente
- Cada adjunto es una unidad independiente: descarga, extrae, valida, persiste a DB
- Previene spikes de CPU/memoria al procesar múltiples archivos grandes

---

## Monitoreo

```
GET /api/engine/stats
→ {
    semaphore: { running, queued, maxConcurrent, maxQueue },
    activeContacts: number
  }
```

Útil para dashboards y health checks. Los stats del StepSemaphore no se exponen (es per-pipeline, efímero).

---

## Notas de diseño

1. **ContactLock es in-memory:** Funciona para single-instance (el deploy actual). Si se escala a multi-instancia, el Redis contact lock del módulo proactivo cubre el caso cross-instance para proactivo vs reactivo.

2. **Sin backoff adaptativo:** El PipelineSemaphore usa cola FIFO simple. No hay ajuste automático basado en tiempos de respuesta. Suficiente para el volumen actual.

3. **Backpressure message no es hot-reloadable:** Se lee al iniciar el engine. Para cambiarlo hay que reiniciar o agregar hot-reload.

4. **StepSemaphore per-pipeline:** Cada pipeline tiene su propio semáforo. Esto significa que 10 pipelines concurrentes podrían tener hasta 50 pasos simultáneos (10 × 5). El PipelineSemaphore en capa 1 es el que limita esto indirectamente.
