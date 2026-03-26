# Auditoría: Runtime & Infraestructura
Fecha: 2026-03-26 20:20 UTC
Servidor: de8238cb4655 (contenedor LUNA-S)
Host: AMD EPYC 9354P, 4 vCPU, 15.62 GB RAM
Auditor: Claude (sesión en server)

## Resumen ejecutivo

LUNA-S (staging) está corriendo y operativo. Todos los servicios core (Node.js, PostgreSQL, Redis, HTTP, WhatsApp) están activos y respondiendo. La base de datos tiene 60 tablas pero baja volumetría (staging). Se detectaron **warnings de configuración en WhatsApp** (env vars sin valores mínimos) y **3 módulos referenciados en DB que no existen en filesystem** (email, google-api, attachments). El sistema usa ~200 MB de RAM y los recursos del host están holgados. No se detectaron errores críticos en los logs.

## Estado de servicios
| Servicio | Estado | Versión | Uptime | Notas |
|----------|--------|---------|--------|-------|
| LUNA process | ✅ Running | — | 27 min | PID 1, `node dist/index.js` |
| Node.js | ✅ | v22.22.2 | — | — |
| npm | ✅ | 10.9.7 | — | — |
| PostgreSQL | ✅ | 16.13 | 5 días | pgvector/pgvector:pg16 |
| Redis | ✅ | 7.x | 12 días | Healthy |
| HTTP Server | ✅ | — | 27 min | Puerto 3001 |
| WhatsApp | ✅ Connected | — | 27 min | Número: 573213722484 |

## PostgreSQL
### Conexión: ✅
### Versión: PostgreSQL 16.13 (Debian)
### DB Size: 16 MB

### Tablas encontradas (60 tablas)
| Tabla | Filas | Propósito estimado |
|-------|-------|--------------------|
| wa_auth_keys | 1,429 | Claves de autenticación WhatsApp |
| llm_usage | 964 | Tracking de uso de LLMs |
| messages | 503 | Mensajes de conversaciones |
| sessions | 354 | Sesiones de conversación |
| config_store | 54 | Configuración del sistema |
| tools | 39 | Herramientas registradas |
| kernel_modules | 23 | Módulos del kernel |
| medilink_followup_templates | 9 | Templates de seguimiento Medilink |
| prompt_slots | 8 | Slots de prompts |
| ack_messages | 6 | Mensajes de confirmación |
| user_contacts | 5 | Contactos de usuario |
| email_threads | 5 | Hilos de email |
| user_list_config | 4 | Configuración de listas |
| users | 3 | Usuarios del sistema |
| agents | 1 | Agentes |
| (45 tablas más) | 0 | Sin datos (staging) |

### pgvector: ✅ (v0.8.2)
Nota: Knowledge module reporta "Embeddings disabled — search will use FTS only"

### Indexes más usados
| Index | Scans | Tuples Read |
|-------|-------|-------------|
| wa_auth_keys_pkey | 8,605 | 7,166 |
| email_state_pkey | 3,819 | 3,800 |
| config_store_pkey | 1,498 | 1,444 |
| wa_auth_creds_pkey | 1,285 | 1,220 |
| agents_pkey | 857 | 857 |
| tools_name_key | 696 | 665 |
| idx_users_type | 435 | 140 |
| agents_slug_key | 356 | 355 |

### Extensions
| Extension | Versión |
|-----------|---------|
| plpgsql | 1.0 |
| vector | 0.8.2 |

## Redis
### Conexión: ✅ (PONG)
### Memory usage
| Métrica | Valor |
|---------|-------|
| used_memory_human | 1.86 MB |
| used_memory_rss_human | 9.35 MB |
| used_memory_peak_human | 1.95 MB |
| total_system_memory_human | 15.62 GB |

### Keyspace
- DB0: 20 keys, 18 con TTL, avg_ttl=641737624ms (~7.4 días)

### Keys por patrón
| Patrón | Keys encontradas |
|--------|-----------------|
| bull:* | 2 (luna-scheduled-tasks:meta, luna-scheduled-tasks:stalled-check) |
| luna:* | 0 |

### BullMQ queues
| Queue | Waiting | Active | Failed |
|-------|---------|--------|--------|
| luna-scheduled-tasks | 0 | 0 | 0 |

## HTTP Server
### Puerto: 3001
### Health check: ✅ (200)
Response: `{"status":"ok","modules":["console","engine","freight","google-apps","knowledge","lead-scoring","llm","medilink","memory","model-scanner","prompts","scheduled-tasks","tools","users","whatsapp"]}`

### 15 módulos activos (de 20 total)

### Security headers
| Header | Presente | Valor |
|--------|----------|-------|
| X-Frame-Options | ❌ | — |
| X-Content-Type-Options | ❌ | — |
| Strict-Transport-Security | ❌ | — |
| Content-Security-Policy | ❌ | — |
| X-XSS-Protection | ❌ | — |
| Content-Type | ✅ | application/json |
| Keep-Alive | ✅ | timeout=5 |

**Nota:** No se encontraron headers de seguridad HTTP. Esto es aceptable en staging si está detrás de un reverse proxy (Traefik está corriendo).

## System Resources
| Recurso | Valor | Estado |
|---------|-------|--------|
| Disk total | 193 GB | ✅ OK |
| Disk used | 73 GB (38%) | ✅ OK |
| Disk available | 120 GB | ✅ OK |
| RAM total | 15 GB | ✅ OK |
| RAM used | 3.3 GB | ✅ OK |
| RAM available | 12 GB | ✅ OK |
| LUNA-S memory | 200.5 MB | ✅ OK |
| LUNA-S CPU | 0.00% | ✅ Idle |
| CPU | AMD EPYC 9354P (4 vCPU) | ✅ OK |
| Load average | 1.35, 0.53, 0.30 | ✅ OK |
| Swap | 0 B (no swap) | ⚠️ Sin swap |

## Instance Files
| Path | Existe | Size/Count | Permisos |
|------|--------|------------|----------|
| instance/ | ✅ | — | drwxr-xr-x (root) |
| instance/config.json | ✅ | 1,483 B | -rw-r--r-- |
| instance/config.key | ✅ | 64 B | -rw------- |
| instance/qualifying.json | ✅ | 2,125 B | -rw-r--r-- |
| instance/wa-auth/ | ✅ | 13.2 MB (3,140 archivos) | drwxr-xr-x |
| instance/knowledge/ | ❌ | — | — |
| instance/tools/freight.json | ❌ | — | Log: ENOENT |
| Total archivos | — | 3,143 | — |

## Logs Analysis

### Errores (level 50): Ninguno ✅

### Warnings (level 40):
| # | Componente | Mensaje | Impacto |
|---|-----------|---------|---------|
| 1 | kernel:loader | Módulo "email" en DB pero no en filesystem | Bajo — módulo migrado/renombrado |
| 2 | kernel:loader | Módulo "google-api" en DB pero no en filesystem | Bajo — renombrado a google-apps |
| 3 | kernel:loader | Módulo "attachments" en DB pero no en filesystem | Bajo — módulo migrado/eliminado |
| 4 | kernel:loader | WhatsApp config ZodError: 5 env vars bajo mínimo | Medio — usa defaults |
| 5 | engine:proactive-config | proactive.json not found | Bajo — feature deshabilitada |
| 6 | engine:tool | create_commitment, query_attachment, web_explore no registradas | Medio — tools:registry no disponible al momento |
| 7 | freight:tool | freight.json ENOENT | Bajo — usa defaults |

### Patrones sospechosos
- WhatsApp env vars (WHATSAPP_RATE_LIMIT_HOUR, WHATSAPP_RATE_LIMIT_DAY, WHATSAPP_BATCH_WAIT_SECONDS, WHATSAPP_ATT_MAX_SIZE_MB, WHATSAPP_ATT_MAX_PER_MSG) están en 0 o no configuradas — se usan defaults pero la validación Zod falla
- 3 módulos fantasma en DB (email, google-api, attachments) — referencias huérfanas

## Network Connectivity
| Destino | Accesible | Respuesta |
|---------|-----------|-----------|
| api.anthropic.com | ✅ | HTTP 404 (root, esperado) — DNS: 160.79.104.10, ping 2.8ms |
| generativelanguage.googleapis.com | ✅ | HTTP 404 (root, esperado) |
| api.twilio.com | ✅ | HTTP 200 |

## Problemas encontrados
| # | Severidad | Componente | Descripción | Impacto | Recomendación |
|---|-----------|------------|-------------|---------|---------------|
| 1 | ⚠️ Media | WhatsApp Config | 5 env vars de WhatsApp no cumplen validación Zod (valores 0 o ausentes). El módulo carga con defaults. | Rate limits y configuración de attachments podrían no ser los deseados | Configurar WHATSAPP_RATE_LIMIT_HOUR, WHATSAPP_RATE_LIMIT_DAY, WHATSAPP_BATCH_WAIT_SECONDS, WHATSAPP_ATT_MAX_SIZE_MB, WHATSAPP_ATT_MAX_PER_MSG en el .env |
| 2 | ⚠️ Media | Engine Tools | 3 tools no se registraron (create_commitment, query_attachment, web_explore) porque tools:registry no estaba disponible | Funcionalidad reducida — estas tools no están disponibles para el agente | Revisar orden de carga de módulos: engine carga antes que tools |
| 3 | 🔵 Baja | Kernel Loader | 3 módulos en DB no existen en filesystem (email, google-api, attachments) | Sin impacto funcional — warnings en logs | Limpiar registros huérfanos de kernel_modules en DB |
| 4 | 🔵 Baja | Knowledge | Embeddings deshabilitados, solo FTS | Búsqueda semántica no disponible | Configurar embeddings si se desea búsqueda vectorial (pgvector ya instalado) |
| 5 | 🔵 Baja | Medilink | Token de API no configurado | Medilink tools registradas pero no funcionales | Configurar token desde consola cuando sea necesario |
| 6 | 🔵 Baja | Security Headers | No hay headers de seguridad HTTP | Aceptable si Traefik los añade | Verificar que Traefik inyecta headers de seguridad |
| 7 | 🔵 Baja | Freight | freight.json no encontrado | Usa defaults | Crear instance/tools/freight.json si se necesita config custom |
| 8 | 🔵 Baja | System | No hay swap configurado | Si RAM se agota, OOM killer actuará sin buffer | Considerar añadir swap de 2-4 GB como safety net |
| 9 | 🔵 Info | Instance | 3,140 archivos en wa-auth (13.2 MB) | Normal para Baileys | Monitorear crecimiento |

## Estado de salud general: 4/5

**Justificación:** El sistema está operativo y estable. Todos los servicios core responden correctamente. Las conexiones a APIs externas funcionan. Los recursos del host están holgados. Se pierde un punto por: (1) warnings de configuración WhatsApp que deberían resolverse, (2) 3 tools que no se registran por orden de carga, y (3) módulos huérfanos en DB que generan ruido en logs.

## Acciones inmediatas recomendadas
1. **Configurar env vars de WhatsApp** — Añadir valores válidos para WHATSAPP_RATE_LIMIT_HOUR, WHATSAPP_RATE_LIMIT_DAY, WHATSAPP_BATCH_WAIT_SECONDS, WHATSAPP_ATT_MAX_SIZE_MB, WHATSAPP_ATT_MAX_PER_MSG para eliminar warnings de Zod
2. **Revisar orden de carga de módulos** — Las tools create_commitment, query_attachment y web_explore no se registran porque engine se inicializa antes que tools:registry. Evaluar si es un bug de dependencia
3. **Limpiar módulos huérfanos** — Eliminar registros de email, google-api, attachments de la tabla kernel_modules para reducir ruido en logs
4. **Verificar headers de seguridad en Traefik** — Confirmar que el reverse proxy añade X-Frame-Options, HSTS, etc.
