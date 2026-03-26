# Auditoría: Runtime & Infraestructura (REQUIERE SERVER CORRIENDO)

Eres un auditor de infraestructura y runtime. El sistema LUNA está corriendo en este server. Tu tarea es verificar el estado REAL del sistema en ejecución. NO hagas cambios en la configuración ni el código, solo analiza y genera un informe.

## REGLA DE EJECUCIÓN

IMPORTANTE: Esta auditoría ejecuta comandos reales en el server.
- Ejecuta cada grupo de comandos por separado, no todos de golpe
- Si un comando falla, documenta el error y sigue con el siguiente
- No modifiques nada — solo observa y reporta
- Si un servicio no está accesible, documéntalo y continúa
- Trabaja fase por fase

### Fase 1: Estado del proceso LUNA
Ejecuta:
```bash
# ¿El proceso está corriendo?
ps aux | grep -E "node|tsx|luna" | grep -v grep
# Docker containers (si aplica)
docker ps 2>/dev/null || echo "Docker no disponible"
# Node.js version
node --version
# npm version
npm --version
# Uptime del sistema
uptime
```

### Fase 2: PostgreSQL
Ejecuta:
```bash
# ¿PostgreSQL accesible? (ajustar credenciales según .env)
# Lee primero las credenciales de DB desde el .env o config
cat deploy/.env.example | grep -E "^(DB_|PG_|DATABASE)" || true
# Intenta conectar
psql "$DATABASE_URL" -c "SELECT version();" 2>/dev/null || echo "No se pudo conectar a PostgreSQL"
# Si se puede conectar:
psql "$DATABASE_URL" -c "\dt" 2>/dev/null  # Listar tablas
psql "$DATABASE_URL" -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;" 2>/dev/null  # Filas por tabla
psql "$DATABASE_URL" -c "SELECT indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes ORDER BY idx_scan DESC LIMIT 20;" 2>/dev/null  # Uso de indexes
psql "$DATABASE_URL" -c "SELECT extname, extversion FROM pg_extension;" 2>/dev/null  # Extensions (pgvector?)
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null  # DB size
```

### Fase 3: Redis
Ejecuta:
```bash
# ¿Redis accesible?
redis-cli ping 2>/dev/null || echo "Redis no accesible"
# Info general
redis-cli info memory 2>/dev/null | head -20
redis-cli info keyspace 2>/dev/null
# Keys por patrón
redis-cli --scan --pattern "bull:*" 2>/dev/null | head -20
redis-cli --scan --pattern "luna:*" 2>/dev/null | head -20
# Keys sin TTL (potencial leak)
redis-cli dbsize 2>/dev/null
```

### Fase 4: HTTP Server
Ejecuta:
```bash
# ¿En qué puerto escucha?
ss -tlnp | grep -E "node|tsx" 2>/dev/null || netstat -tlnp 2>/dev/null | grep -E "node|tsx"
# Health check (ajustar puerto)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "No responde"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "No health endpoint"
# Headers de seguridad
curl -sI http://localhost:3000/ 2>/dev/null | head -20
```

### Fase 5: Archivos de instancia
Ejecuta:
```bash
# Config
ls -la instance/ 2>/dev/null || echo "No instance/ directory"
ls -la instance/config.json 2>/dev/null
# Knowledge base
du -sh instance/knowledge/ 2>/dev/null || echo "No knowledge dir"
du -sh instance/knowledge/media/ 2>/dev/null || echo "No media dir"
find instance/ -type f 2>/dev/null | wc -l
# Permisos
ls -la instance/ 2>/dev/null
```

### Fase 6: System resources
Ejecuta:
```bash
# Disk
df -h /
du -sh /home/user/LUNA/
# Memory
free -h
# CPU
cat /proc/cpuinfo | grep "model name" | head -1
nproc
# Load
cat /proc/loadavg
```

### Fase 7: Logs
Ejecuta:
```bash
# Buscar archivos de log
find /home/user/LUNA -name "*.log" -type f 2>/dev/null
# Docker logs (si aplica)
docker logs luna 2>/dev/null | tail -50 || echo "No docker logs"
# PM2 logs (si aplica)
pm2 logs --lines 50 2>/dev/null || echo "No pm2"
# journalctl (si aplica)
journalctl -u luna --no-pager -n 50 2>/dev/null || echo "No systemd service"
```

### Fase 8: BullMQ / Jobs
Si Redis está accesible:
```bash
# Queues de BullMQ
redis-cli keys "bull:*:id" 2>/dev/null
redis-cli keys "bull:*:waiting" 2>/dev/null
redis-cli keys "bull:*:active" 2>/dev/null
redis-cli keys "bull:*:failed" 2>/dev/null
# Jobs failed
redis-cli llen "bull:*:failed" 2>/dev/null
```

### Fase 9: Network connectivity
Ejecuta:
```bash
# ¿Puede llegar a APIs externas?
curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" https://generativelanguage.googleapis.com 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" https://api.twilio.com 2>/dev/null
# DNS resolution
nslookup api.anthropic.com 2>/dev/null | tail -3
```

### Fase 10: Package integrity
Ejecuta:
```bash
# ¿node_modules existe y es consistente?
ls -la /home/user/LUNA/node_modules/ | head -5
npm ls --depth=0 2>/dev/null | tail -20
# ¿Lock file?
ls -la /home/user/LUNA/package-lock.json 2>/dev/null
```

## Formato del informe

Genera el archivo: docs/reports/audit/S1-runtime-infra.md

```markdown
# Auditoría: Runtime & Infraestructura
Fecha: [fecha de ejecución]
Servidor: [hostname del server]
Auditor: Claude (sesión en server)

## Resumen ejecutivo
(estado general del runtime en 3-5 líneas)

## Estado de servicios
| Servicio | Estado | Versión | Uptime | Notas |
|----------|--------|---------|--------|-------|
| LUNA process | ✅/❌ | ... | ... | ... |
| Node.js | ✅/❌ | ... | ... | ... |
| PostgreSQL | ✅/❌ | ... | ... | ... |
| Redis | ✅/❌ | ... | ... | ... |
| HTTP Server | ✅/❌ | Puerto: ... | ... | ... |

## PostgreSQL
### Conexión: ✅/❌
### Tablas encontradas
| Tabla | Filas | Propósito estimado |
### pgvector: ✅/❌
### Indexes más usados
### DB size
### Migrations: ¿al día?

## Redis
### Conexión: ✅/❌
### Memory usage
### Keys por patrón
| Patrón | Count | TTL |
### BullMQ queues
| Queue | Waiting | Active | Failed |

## HTTP Server
### Puerto: N
### Health check: ✅/❌
### Security headers
| Header | Presente | Valor |

## System Resources
| Recurso | Valor | Estado |
|---------|-------|--------|
| Disk total / used / available | ... | ... |
| RAM total / used / available | ... | ... |
| CPU | ... | ... |
| Load average | ... | ... |

## Instance Files
| Path | Existe | Size | Permisos |
|------|--------|------|----------|

## Logs Analysis
### Últimos errores
### Warnings recurrentes
### Patrones sospechosos

## Network Connectivity
| Destino | Accesible | Latencia |
|---------|-----------|----------|

## Problemas encontrados
| # | Severidad | Componente | Descripción | Impacto | Recomendación |
|---|-----------|------------|-------------|---------|---------------|

## Estado de salud general: X/5
(justificación)

## Acciones inmediatas recomendadas
1. ...
```

IMPORTANTE: Ejecuta TODOS los comandos. No asumas que algo funciona — verifícalo. Si un comando falla, documenta el error exacto. Este informe es sobre el estado REAL del sistema corriendo, no sobre el código.
