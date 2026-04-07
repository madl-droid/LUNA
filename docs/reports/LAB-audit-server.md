# INFORME DE AUDITORIA — Lab: Pruebas E2E con Contactos Reales (Server / Infraestructura)

**Fecha:** 2026-04-07
**Instancia:** lab (staging)
**Servidor:** Docker Compose (app + postgres + redis)
**Branch:** pruebas

---

## SECCION 1 — ESTADO ACTUAL DE RECURSOS

### Contenedores

| Contenedor | CPU | RAM | Limite | Estado |
|------------|-----|-----|--------|--------|
| lab (app) | 132% | 244 MB | 512 MB (48%) | Running |
| lab-postgres | 64-83% | 115 MB | 256 MB (45%) | Running, CPU alta |
| lab-redis | 0.5% | 8 MB | 128 MB (6%) | Running, sin problemas |

### Red

| Contenedor | Input | Output |
|------------|-------|--------|
| lab-postgres | 525 GB | 456 GB |

---

## SECCION 2 — PROBLEMAS DE POSTGRESQL

### PG-01: Polling agresivo — 3.9 mil millones de commits en 10 dias [CRITICO]

**Evidencia:**

| Metrica | Valor |
|---------|-------|
| Total commits | 3,897,759,729 |
| Transacciones/dia | ~390 millones |
| Transacciones/segundo | ~4,500 sostenidas |
| Tuplas retornadas | 664 mil millones |
| Tuplas insertadas | 19,901 |
| Tuplas actualizadas | 31,322 |
| Tuplas eliminadas | 7,415 |

El ratio es absurdo: **664 mil millones de tuplas leidas** vs **58,000 escritas**. Esto indica polling masivo — millones de SELECTs repetitivos por segundo que retornan las mismas filas.

**Causa probable:** La aplicacion hace polling constante para:
- Estado de sesiones/mensajes
- Verificacion de rate limits
- Checks de locks de contacto
- Estado de HITL tickets
- Posiblemente health checks internos

**Impacto:** CPU de Postgres sostenida en 64-83%. Overhead de parsing, planning y execution en cada query, aunque cada una sea rapida.

**Accion requerida:**
1. **URGENTE:** Habilitar `pg_stat_statements` para identificar que queries generan el volumen
2. Mover polling a Redis pub/sub o PostgreSQL LISTEN/NOTIFY
3. Implementar caching a nivel de aplicacion para datos que cambian infrecuentemente
4. Considerar connection pooling con PgBouncer si las conexiones crecen

---

### PG-02: effective_cache_size mal configurado [ALTO]

**Valor actual:** `4 GB`
**Valor correcto:** `~192 MB` (75% del limite de 256 MB del contenedor)

**Impacto:** El query planner de PostgreSQL sobreestima la cache disponible y puede elegir index scans cuando un sequential scan seria mas rapido, o viceversa. Esto afecta la calidad de los planes de ejecucion.

**Accion:** Agregar a `postgresql.conf` o al comando de inicio:
```
postgres -c effective_cache_size=192MB -c max_connections=50
```

---

### PG-03: pg_stat_statements no habilitado [ALTO]

Sin esta extension, es imposible identificar las queries mas costosas historicamente. Es la herramienta mas importante para diagnostico de rendimiento en PostgreSQL.

**Accion:** Agregar al inicio de PostgreSQL:
```yaml
command: postgres -c max_connections=50 -c shared_preload_libraries=pg_stat_statements
```
Y luego: `CREATE EXTENSION pg_stat_statements;`

---

### PG-04: Table bloat moderado [BAJO]

| Tabla | Filas vivas | Filas muertas | % dead |
|-------|-------------|---------------|--------|
| wa_auth_creds | 1 | 24 | 2400% |
| google_oauth_tokens | 1 | 6 | 600% |
| sessions | 5 | 20 | 400% |
| user_contacts | 6 | 15 | 250% |
| agent_contacts | 5 | 12 | 240% |
| tools | 36 | 55 | 153% |

**Impacto:** Minimo en tablas tan pequenas, pero indica que autovacuum no esta limpiando estas tablas (umbral por defecto de 50 dead tuples).

**Accion:**
```sql
VACUUM ANALYZE;
```

---

### PG-05: 30 indices sin uso (0 scans) [BAJO]

Notablemente:
- `idx_knowledge_chunks_embedding_v2` (IVFFlat, 2.5 MB) — 0 escaneos. Con solo 130 chunks, el sequential scan es mas rapido.
- Multiples indices en tablas vacias (`session_summaries_v2`, `session_archives`)

**Impacto:** Minimo en tablas pequenas. Los indices sin uso agregan overhead en writes pero es negligible con este volumen.
**Accion:** No urgente. Monitorear cuando la tabla crezca. El indice IVFFlat necesita `SET ivfflat.probes = X` y posiblemente re-build cuando haya mas datos.

---

### PG-06: Configuracion general

| Parametro | Valor actual | Recomendado | Notas |
|-----------|-------------|-------------|-------|
| shared_buffers | 128 MB | 128 MB | OK (50% del contenedor) |
| work_mem | 4 MB | 4 MB | OK |
| maintenance_work_mem | 64 MB | 64 MB | OK |
| effective_cache_size | **4 GB** | **192 MB** | CORREGIR |
| max_connections | 50 | 50 | OK |
| max_wal_size | 1 GB | 1 GB | OK |

**Conexiones actuales:** 18 idle + 3 active + 5 sin estado = 26/50 (52%)

**Cache hit ratio:** 99.99999998% — perfecto. La base de datos cabe completamente en memoria.

---

## SECCION 3 — PROBLEMAS DE LA APLICACION (RUNTIME)

### APP-01: Gemini TTS completamente caido [ALTO]

**Evidencia:** 22 errores HTTP 500 (INTERNAL) en ambos modelos:
- `gemini-2.5-pro-preview-tts` — 11 errores
- `gemini-2.5-flash-preview-tts` — 11 errores

Ambos devuelven "An internal error has occurred" directamente de la API de Google. El fallback entre pro y flash tampoco funciona.

**Impacto:** Mensajes de voz fallan completamente. Si un usuario envia audio que requiere TTS en la respuesta, falla.

**Accion:**
1. Verificar si es un outage temporal de Google (probablemente modelos preview)
2. Considerar agregar un tercer fallback a otro provider TTS
3. Si el outage persiste, deshabilitar TTS temporalmente o cambiar a modelos estables

---

### APP-02: Rate limiting agresivo — 20/hora [ALTO]

**Configuracion actual:** `limitHour: 20`, `limitDay: 200`
**Evidencia:** 38 eventos de rate limit. Stefania fue la mas afectada con 15+ bloqueos consecutivos.

**Problema:** 20 mensajes/hora es muy bajo para una conversacion activa con un chatbot. Una conversacion de 40 mensajes (como la de Cristian o Stefania) supera el limite en la primera hora.

**Accion:**
1. Evaluar subir el limite a 40-60/hora para el entorno lab
2. Considerar rate limits diferentes por tipo de contacto (leads mas restrictivo, clientes activos mas permisivo)
3. El rate limit debe verificarse ANTES del agentic loop, no solo en delivery (ver BUG-18 en informe de codigo)

---

### APP-03: WhatsApp disconnections [BAJO]

**Evidencia:** 2 warnings de "WhatsApp disconnected, reconnecting" + 2 errores de "stream errored out (code 503)".
**Impacto:** Bajo — se reconecto automaticamente. Pero si la frecuencia aumenta, puede causar perdida de mensajes.
**Accion:** Monitorear frecuencia.

---

### APP-04: System prompt template not found — 78 warnings [MEDIO]

**Evidencia:** `knowledge-mandate.md` no se encuentra en `/app/instance/prompts/system/`. Se reintenta en cada llamada.
**Causa probable:** El archivo no fue desplegado en la instancia lab, o el path esta mal configurado.
**Accion:** Verificar que el archivo existe en la instancia y que el path coincide con lo que espera el template-loader.

---

### APP-05: LLM provider timeout extremo [BAJO]

**Evidencia:** Un pipeline fallo despues de 425,227ms (7+ minutos) con `google/gemini-3-flash-preview failed after retries`.
**Impacto:** Un solo evento, pero consumio recursos durante 7 minutos sin resultado.
**Accion:** Verificar que hay un timeout maximo configurado para llamadas LLM individuales (no solo para el pipeline completo).

---

## SECCION 4 — LATENCIA DEL PIPELINE

### Metricas de latencia

| Metrica | Valor |
|---------|-------|
| Minimo | 21,387 ms (~21s) |
| Promedio | 96,942 ms (~97s) |
| Mediana (P50) | 60,154 ms (~60s) |
| P90 | 225,928 ms (~3.8 min) |
| P95 | 255,578 ms (~4.3 min) |
| Maximo | 378,011 ms (~6.3 min) |

### Desglose del tiempo

| Fase | Tiempo tipico | % del total |
|------|---------------|-------------|
| Intake (phase1) | 10-15s | ~15% |
| Agentic loop (phases 2-4) | Variable, hasta 340s | **~75%** |
| Delivery (phase5) | 6-25s | ~10% |

### Causas de latencia en el agentic loop

1. **Criticizer (0% aprobacion):** +17s por pipeline que lo activa
2. **Multiples tool turns:** hasta 15 turns de herramientas por pipeline
3. **Cascada de modelos:** main (sonnet) -> complex (opus) -> criticizer-review (gemini) -> criticizer-rewrite (gemini)
4. **sheets-read retry:** +1-2s por fallo de rango

### Correlacion latencia vs mensajes en sesion

| Msgs en sesion | Latencia tipica | Contacto |
|----------------|-----------------|----------|
| 2-6 | 30-45s | Todos |
| 10-20 | 60-100s | Cristian, Miguel |
| 20-30 | 100-230s | Cristian, Stefania |
| 30-42 | 230-378s | Stefania |

---

## SECCION 5 — REDIS

Redis esta saludable:
- CPU: 0.5%
- RAM: 8/128 MB (6%)
- Sin problemas detectados
- Se usa para: buffer de conversacion, locks de contacto, compresion inline, colas BullMQ

---

## SECCION 6 — LOGS Y OBSERVABILIDAD

### Resumen de logs

| Nivel | Cantidad | Descripcion |
|-------|----------|-------------|
| Error (50) | 98 | FK violations, TTS, lock timeouts, LLM failures |
| Warning (40) | 193 | Rate limits, template not found, tool failures |
| Info (30) | ~2000+ | LID resolutions, pipeline starts/completions |

### Gaps de observabilidad

| Que falta | Impacto |
|-----------|---------|
| `trace_id` NULL en llm_usage | No se puede correlacionar LLM calls con pipelines |
| `messages.latency_ms` siempre NULL | No hay latencia por mensaje |
| `messages.model_used` siempre NULL | No se sabe que modelo genero cada respuesta |
| `messages.tokens_used` siempre NULL | No hay costo por mensaje |
| `llm_daily_stats` vacia | No hay estadisticas diarias de uso |
| `pipeline_logs.error` siempre NULL | FK violation impide guardar errores |
| Fases 2-4 del pipeline no instrumentadas | No hay visibilidad del agentic loop |

---

## SECCION 7 — VERIFICACIONES ADICIONALES (SERVER-SIDE)

### SVER-01: Identificar fuente del polling a Postgres

**Prioridad:** CRITICA
**Accion:** Habilitar `pg_stat_statements`, esperar 1 hora, luego:
```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```
Esto revelara que queries generan los 4,500 TPS.

---

### SVER-02: Verificar TTS de Google

**Accion:** Hacer un test manual:
```bash
docker exec lab node -e "
  // test TTS call to verify if Google is still down
"
```
O verificar en https://status.cloud.google.com/ si hay outage en Gemini TTS preview.

---

### SVER-03: Verificar memory limits bajo carga

Con 512 MB para la app y 256 MB para Postgres, verificar si hay OOM kills bajo carga real:
```bash
dmesg | grep -i "oom\|killed" | tail -20
docker inspect lab --format='{{.State.OOMKilled}}'
```

---

### SVER-04: Verificar WAL y disk usage

```bash
docker exec lab-postgres du -sh /var/lib/postgresql/data/pg_wal/
docker exec lab-postgres du -sh /var/lib/postgresql/data/
```

---

### SVER-05: Monitorear reconexiones de WhatsApp

Las 2 desconexiones detectadas pueden ser normales, pero si aumentan bajo carga pueden causar perdida de mensajes. Agregar alerta si hay mas de 5 desconexiones en 1 hora.

---

## RESUMEN EJECUTIVO

### Estado general: FUNCIONAL CON DEGRADACION

La instancia lab esta operativa pero con problemas significativos de rendimiento y observabilidad:

1. **PostgreSQL** esta bajo presion por polling agresivo (~4,500 TPS) que es la causa raiz del alto CPU. La solucion es identificar y eliminar el polling.
2. **Latencia del pipeline** es inaceptable (mediana 60s, P90 3.8 min). La causa principal es el agentic loop con criticizer + multiples tool turns, no el tamano del contexto.
3. **Observabilidad** esta severamente limitada por trace_id NULL, metricas vacias en mensajes, y FK violations que impiden guardar errores.
4. **Rate limiting** esta demasiado agresivo para conversaciones activas (20/hora) y se aplica demasiado tarde (en delivery en vez de en intake).
5. **Redis** esta saludable y no es un bottleneck.
6. **TTS** esta completamente caido por outage de Google Gemini preview.
