# Runbook de operaciones

Guía operacional para monitorear, diagnosticar y mantener LUNA en producción.

## Endpoints de monitoreo

| Endpoint | Descripción |
|----------|-------------|
| `GET /health` | Health check básico: `{ status: 'ok', modules: [...] }` |
| `GET /console/api/cortex/health` | Health completo: PostgreSQL, Redis, WhatsApp, email, colas |
| `GET /console/api/cortex/metrics` | Métricas del sistema: pipeline, LLM, tools |
| `GET /console/api/cortex/alerts/active` | Alertas activas de Reflex |
| `GET /console/api/cortex/alerts/history` | Historial de alertas |
| `GET /console/api/console/modules` | Estado de todos los módulos |
| `GET /console/api/console/version` | Versión del build |

Para monitoreo externo (UptimeRobot, Healthchecks.io, etc.) usar `GET /health`.

## Verificaciones diarias

```bash
# 1. Estado general
curl -s http://localhost:3000/health | jq .

# 2. Health completo
curl -s http://localhost:3000/console/api/cortex/health | jq .

# 3. Alertas activas
curl -s http://localhost:3000/console/api/cortex/alerts/active | jq .

# 4. Logs recientes (últimos errores)
docker logs LUNA --since 1h 2>&1 | grep '"level":50' | tail -20

# 5. Uso de recursos
docker stats LUNA LUNA-postgres LUNA-redis --no-stream
```

## Métricas clave

### Pipeline

```bash
# Métricas agregadas por hora
curl -s http://localhost:3000/console/api/cortex/metrics | jq .
```

Métricas disponibles:
- `pipeline.count` — mensajes procesados
- `pipeline.errors` — errores en pipeline
- `pipeline.latency_avg` / `latency_max` — latencia en ms
- `llm.calls` / `llm.errors` — llamadas y errores de LLM
- `llm.tokens_in` / `tokens_out` — tokens consumidos
- `llm.fallbacks` — veces que se usó el proveedor de fallback
- `tools.calls` / `tools.errors` — uso de herramientas

### Colas (BullMQ)

```bash
# Profundidad de colas principales
docker exec LUNA-redis redis-cli LLEN bull:session-compress:wait
docker exec LUNA-redis redis-cli LLEN bull:embedding-unified:wait
docker exec LUNA-redis redis-cli LLEN bull:luna-scheduled-tasks:wait
docker exec LUNA-redis redis-cli LLEN bull:knowledge-vectorize:wait
docker exec LUNA-redis redis-cli LLEN bull:luna:freshdesk-sync:wait

# Jobs fallidos
docker exec LUNA-redis redis-cli LLEN bull:session-compress:failed
docker exec LUNA-redis redis-cli LLEN bull:embedding-unified:failed
```

Si las colas `*:wait` crecen constantemente, hay un cuello de botella en el procesamiento.

### Redis

```bash
# Memoria usada
docker exec LUNA-redis redis-cli INFO memory | grep used_memory_human

# Número de keys
docker exec LUNA-redis redis-cli DBSIZE

# Keys de Reflex (alertas activas)
docker exec LUNA-redis redis-cli HGETALL reflex:active-alerts
```

### PostgreSQL

```sql
-- Conexiones activas
SELECT count(*) FROM pg_stat_activity WHERE datname = 'luna';

-- Queries lentos (> 1 segundo)
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '1 second'
ORDER BY duration DESC;

-- Tamaño de tablas
SELECT relname AS tabla,
       pg_size_pretty(pg_total_relation_size(relid)) AS tamaño
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

-- Mensajes procesados hoy
SELECT COUNT(*) FROM messages WHERE created_at >= CURRENT_DATE;

-- Contactos activos (últimas 24h)
SELECT COUNT(DISTINCT contact_id) FROM messages WHERE created_at >= NOW() - INTERVAL '24 hours';
```

## Sistema de alertas (Reflex)

Cortex/Reflex evalúa 13 reglas automáticamente sin usar LLM:

| Severidad | Reglas | Intervalo |
|-----------|--------|-----------|
| Critical (6) | Pipeline error rate, LLM down, Redis/PG connection, queue overflow, memory pressure | 60s |
| Degraded (5) | High latency, fallback rate, tool errors, slow queries, disk usage | 5 min |
| Info (2) | Low traffic, new module activated | 15 min |

Las alertas tienen deduplicación (3600s TTL) y estados: `triggered` → `resolved` → `escalated`.

### Redis keys de Reflex

```
reflex:active-alerts     — Hash con alertas activas (por rule.id)
reflex:metrics:*         — Métricas por hora
reflex:dedup:*           — TTLs de deduplicación
reflex:flap_count:*      — Conteo de flapping
```

## Tablas importantes

| Tabla | Contenido |
|-------|-----------|
| `config_store` | Configuración encriptada (API keys, secrets) |
| `kernel_modules` | Estado de módulos (activo/inactivo) |
| `schema_migrations` | Migraciones aplicadas |
| `contacts` | Contactos unificados cross-channel |
| `sessions` | Sesiones de conversación |
| `messages` | Historial de mensajes |
| `pipeline_logs` | Logs de ejecución del pipeline |
| `knowledge_documents` | Documentos de la base de conocimiento |
| `knowledge_chunks` | Chunks vectorizados para búsqueda |
| `wa_auth_creds` | Credenciales de WhatsApp (Baileys) |
| `wa_auth_keys` | Keys de Signal protocol (WhatsApp) |
| `pulse_reports` | Reportes de monitoreo (Cortex) |

## Mantenimiento periódico

### Semanal

```sql
-- Limpiar pipeline logs antiguos (> 30 días)
DELETE FROM pipeline_logs WHERE created_at < NOW() - INTERVAL '30 days';

-- Limpiar session archives antiguos (> 90 días)
DELETE FROM session_archives WHERE created_at < NOW() - INTERVAL '90 days';

-- Vacuum
VACUUM ANALYZE;
```

### Mensual

```sql
-- Limpiar mensajes muy antiguos (ajustar según política de retención)
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '180 days';

-- Verificar tamaño de tablas y decidir si limpiar
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

```bash
# Limpiar jobs BullMQ completados
docker exec LUNA-redis redis-cli EVAL "
  local keys = redis.call('keys', 'bull:*:completed')
  for _,k in ipairs(keys) do redis.call('del', k) end
  return #keys
" 0
```

## Backup

### Base de datos

```bash
# Dump completo (incluye auth de WhatsApp)
docker exec LUNA-postgres pg_dump -U luna -d luna > backup_$(date +%Y%m%d).sql

# Restaurar
docker exec -i LUNA-postgres psql -U luna -d luna < backup_20260414.sql
```

### Archivos críticos

```bash
# Copiar instance/ completo (config.key, knowledge, prompts, config)
tar czf luna-instance-$(date +%Y%m%d).tar.gz instance/

# Copiar .env
cp .env .env.backup.$(date +%Y%m%d)
```

**Archivos que NUNCA deben perderse**:
- `instance/config.key` — sin esto, los secrets en DB son irrecuperables
- `instance/knowledge/` — base de conocimiento y media
- `.env` — configuración del entorno

## Respuesta a incidentes

### LUNA no responde

1. Verificar que el container esté corriendo: `docker ps | grep LUNA`
2. Si está corriendo, verificar health: `curl http://localhost:3000/health`
3. Revisar logs: `docker logs LUNA --tail 200`
4. Si hay OOM: reiniciar con `docker compose restart app`
5. Si PG o Redis están caídos: `docker compose restart postgres redis`

### Pérdida de conexión WhatsApp

1. Verificar en `/console` → WhatsApp → Estado
2. Si hay error de auth: desconectar y reconectar (genera nuevo QR)
3. Si se repite: verificar que el teléfono está activo y conectado a internet
4. La reconexión automática tiene timeout configurable (`WHATSAPP_SESSION_TIMEOUT_HOURS`)

### Ambos proveedores LLM caídos

1. LUNA responde con mensajes de fallback predefinidos (sin LLM)
2. Verificar estado de los providers en `/console/api/cortex/health`
3. Verificar saldo/cuota en las consolas de Anthropic y Google
4. El circuit breaker se resetea automáticamente en 5 minutos
5. Para resetear manualmente, reiniciar el container

### Disco lleno

1. Identificar qué ocupa espacio:
   ```bash
   docker system df
   du -sh /docker/luna-production/instance/*
   ```
2. Limpiar imágenes Docker no usadas: `docker image prune -a`
3. Limpiar media antigua si es necesario: `instance/knowledge/media/`
4. Ejecutar mantenimiento de DB (ver sección anterior)

## Logs

LUNA usa **pino** con logs JSON estructurados en stdout.

### Niveles de log

| Nivel | Valor | Uso |
|-------|-------|-----|
| `fatal` | 60 | Error irrecuperable, proceso termina |
| `error` | 50 | Error que requiere atención |
| `warn` | 40 | Situación inesperada pero manejada |
| `info` | 30 | Operación normal (default) |
| `debug` | 20 | Detalle para desarrollo |
| `trace` | 10 | Máximo detalle |

Configurar con `LOG_LEVEL` en `.env`.

### Filtrar logs

```bash
# Solo errores
docker logs LUNA 2>&1 | grep '"level":50'

# Solo fatales
docker logs LUNA 2>&1 | grep '"level":60'

# Filtrar por módulo
docker logs LUNA 2>&1 | grep '"name":"whatsapp"'

# Logs legibles (requiere pino-pretty)
docker logs LUNA 2>&1 | npx pino-pretty
```

### PII en logs

Los campos `email`, `phone`, `contactPhone`, `document` y `patientId` se redactan automáticamente como `[REDACTED]` en los logs.
