# Troubleshooting — Problemas comunes

Guía para diagnosticar y resolver los problemas más frecuentes en LUNA.

## Arranque

### LUNA no inicia: "Migration failed, aborting"

**Causa**: Una migración SQL falló (sintaxis, tabla ya existe sin `IF NOT EXISTS`, etc.)

**Solución**:
1. Revisar el log para identificar qué migración falló y el error SQL específico
2. Conectar a PostgreSQL y verificar el estado:
   ```sql
   SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
   ```
3. Si la migración quedó parcialmente aplicada, corregir el SQL manualmente
4. Si quedó registrada en `schema_migrations` pero no se aplicó completa, borrar esa entrada:
   ```sql
   DELETE FROM schema_migrations WHERE name = 'NNN_nombre.sql';
   ```
5. Reiniciar LUNA

### LUNA no inicia: "Setup not completed"

**Causa**: Es el primer arranque o se hizo factory reset.

**Solución**: Acceder a `http://<host>:3000/setup` y completar el wizard de instalación (5 pasos: idioma, admin, agente, API keys, sistema).

### LUNA no inicia: error de conexión a PostgreSQL o Redis

**Causa**: Los servicios no están corriendo o las credenciales son incorrectas.

**Solución**:
```bash
# Verificar que los contenedores estén corriendo
docker ps | grep -E "postgres|redis"

# Probar conexión a PostgreSQL
docker exec LUNA-postgres pg_isready -U luna

# Probar conexión a Redis
docker exec LUNA-redis redis-cli ping
```

Verificar que `.env` tenga los valores correctos de `DB_HOST`, `DB_PASSWORD`, `REDIS_HOST`.

---

## WhatsApp

### QR code no aparece / WhatsApp no conecta

**Causa**: El módulo no está activo, o hay un problema con la sesión existente.

**Solución**:
1. Verificar que el módulo esté activo en `/console` → Módulos
2. Revisar logs buscando errores de Baileys:
   ```bash
   docker logs LUNA 2>&1 | grep -i "whatsapp\|baileys\|qr"
   ```
3. Si hay error de autenticación, limpiar la sesión:
   - Desde la consola: desconectar WhatsApp y reconectar
   - Manualmente en la DB:
     ```sql
     DELETE FROM wa_auth_creds;
     DELETE FROM wa_auth_keys;
     ```
   - Reiniciar LUNA — se generará un nuevo QR code

### WhatsApp se desconecta frecuentemente

**Causa**: El teléfono pierde conexión a internet, o el timeout de sesión es muy corto.

**Solución**:
- Asegurarse de que el teléfono vinculado tenga conexión estable
- Verificar `WHATSAPP_SESSION_TIMEOUT_HOURS` en la configuración (default: 24h)
- Revisar si hay errores `DisconnectReason` en los logs

### Mensajes no se envían / quedan en cola

**Causa**: WhatsApp desconectado, rate limiting, o error en el pipeline.

**Solución**:
1. Verificar estado de conexión en `/console`
2. Revisar `pipeline_logs` para el mensaje específico:
   ```sql
   SELECT * FROM pipeline_logs WHERE contact_id = 'X' ORDER BY created_at DESC LIMIT 5;
   ```
3. Verificar que no haya un circuit breaker abierto en el LLM

---

## LLM y respuestas

### "Provider DOWN" / respuestas de fallback

**Causa**: El circuit breaker se activó por 5+ fallas del proveedor LLM en 10 minutos.

**Solución**:
1. Revisar `/console/api/cortex/health` para ver estado de proveedores
2. Verificar que las API keys sean válidas:
   - Anthropic: `ANTHROPIC_API_KEY` con créditos disponibles
   - Google: `GOOGLE_AI_API_KEY` activa
3. El circuit breaker se resetea automáticamente después de 5 minutos (`LLM_CB_COOLDOWN_MS`)
4. Si ambos proveedores están DOWN, LUNA responde con mensajes de fallback predefinidos (no generados por LLM)

### Respuestas lentas

**Causa**: Modelo pesado, muchas herramientas, o cola saturada.

**Solución**:
1. Revisar métricas de latencia en `/console/api/cortex/metrics`
2. Verificar profundidad de cola:
   ```bash
   docker exec LUNA-redis redis-cli LLEN bull:session-compress:wait
   ```
3. Considerar ajustar:
   - `ENGINE_MAX_CONCURRENT_PIPELINES` (default: 50)
   - `ENGINE_AGENTIC_MAX_TURNS` (default: 15, reducir si las conversaciones son simples)
   - Usar modelos más livianos para tareas de bajo esfuerzo

### El agente no usa el conocimiento / responde genéricamente

**Causa**: Base de conocimiento vacía, embeddings no generados, o búsqueda no devuelve resultados.

**Solución**:
1. Verificar que hay documentos en `/console` → Knowledge
2. Verificar que `KNOWLEDGE_EMBEDDING_ENABLED=true` y `GOOGLE_AI_API_KEY` esté configurada
3. Revisar estado de vectorización:
   ```sql
   SELECT status, COUNT(*) FROM knowledge_chunks GROUP BY status;
   ```
4. Si hay chunks en estado `pending`, verificar que la cola de embeddings esté procesando:
   ```bash
   docker exec LUNA-redis redis-cli LLEN bull:embedding-unified:wait
   ```

---

## Base de datos

### "Invalid encrypted value format"

**Causa**: El archivo `instance/config.key` no coincide con los secrets encriptados en la DB.

**Solución**:
- Si tienes backup de `instance/config.key`: restaurarlo y reiniciar
- Si no tienes backup: los secrets almacenados son irrecuperables. Borrar `instance/config.key`, reiniciar (se genera uno nuevo) y reconfigurar las API keys desde `/console` o `.env`

### Base de datos llena / queries lentos

**Solución**:
```sql
-- Ver tamaño de las tablas principales
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- Limpiar mensajes antiguos (ajustar intervalo según necesidad)
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days';

-- Limpiar logs de pipeline antiguos
DELETE FROM pipeline_logs WHERE created_at < NOW() - INTERVAL '30 days';

-- Vacuum para recuperar espacio
VACUUM ANALYZE;
```

---

## Redis

### Redis sin memoria

**Solución**:
```bash
# Ver uso de memoria
docker exec LUNA-redis redis-cli INFO memory | grep used_memory_human

# Ver las keys más grandes
docker exec LUNA-redis redis-cli --bigkeys

# Limpiar colas BullMQ completadas
docker exec LUNA-redis redis-cli EVAL "
  local keys = redis.call('keys', 'bull:*:completed')
  for _,k in ipairs(keys) do redis.call('del', k) end
  return #keys
" 0
```

### Redis no conecta después de reinicio

**Causa**: Contraseña cambiada o puerto incorrecto.

**Solución**: Verificar `REDIS_HOST`, `REDIS_PORT` y `REDIS_PASSWORD` en `.env`. Si Redis está en Docker, el host dentro de la red Docker es el nombre del servicio (`redis`), no `localhost`.

---

## Deploy y CI/CD

### GitHub Actions falla: "TypeScript compilation error"

**Causa**: Se pusheó código que no compila.

**Solución**:
```bash
# Compilar localmente antes de push
npx tsc --noEmit
# Corregir errores y volver a pushear
```

### Container no arranca después de deploy

**Solución**:
```bash
# Ver logs del container
docker logs LUNA --tail 100

# Verificar que la imagen se descargó correctamente
docker images | grep luna

# Verificar health checks
docker inspect LUNA --format='{{.State.Health}}'

# Forzar recreación
docker compose pull && docker compose up -d --force-recreate
```

### SSL/HTTPS no funciona

**Causa**: Traefik no genera certificado.

**Solución**:
1. Verificar que `DOMAIN` en `.env` apunta al servidor correcto (DNS)
2. Verificar logs de Traefik:
   ```bash
   docker logs traefik --tail 50
   ```
3. Verificar que los labels del container de LUNA son correctos en `docker-compose.yml`
4. El puerto 443 debe estar abierto en el firewall

---

## Google (OAuth2, Gmail, Calendar, Drive)

### "Token has been revoked" / OAuth2 falla

**Causa**: El refresh token expiró o fue revocado manualmente.

**Solución**:
1. Ir a `/console` → Google Apps → Reconectar
2. Completar el flujo OAuth2 para obtener un nuevo refresh token
3. Si el redirect URI no coincide, verificar `GOOGLE_REDIRECT_URI` en `.env`

### Sync con Google Drive no actualiza documentos

**Causa**: El sync es unidireccional (Drive → LUNA). Los cambios en Drive se sincronizan periódicamente.

**Solución**:
1. Forzar sync desde `/console` → Knowledge → Sync Now
2. Verificar que el Service Account o OAuth2 tenga acceso a la carpeta de Drive
3. Revisar logs de sync:
   ```bash
   docker logs LUNA 2>&1 | grep -i "knowledge\|sync\|drive"
   ```
