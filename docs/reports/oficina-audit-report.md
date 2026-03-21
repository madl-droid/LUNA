# AUDITORÍA COMPLETA — Módulo Oficina

## Resumen ejecutivo

La oficina es funcional pero tiene problemas estructurales importantes: **1 error de sintaxis que rompe compilación**, **~8 claves i18n faltantes** que muestran nombres crudos en la UI, una **arquitectura de navegación híbrida** (mezcla de páginas hardcodeadas y contenido dinámico de módulos), y **múltiples módulos con UI registrada que nunca se muestra** como sidebar items dedicados.

---

## 1. ERRORES CONFIRMADOS

### 1.1 Error de sintaxis en `templates-sections.ts:366-367` — CRITICO

Falta el `}` de cierre de `renderEngineMetricsSection()`. La función termina en el template literal pero nunca cierra la llave:

```typescript
// Línea 366:
  </div>`                                              // ← cierra template literal
export function renderScheduledTasksSection(...) {      // ← siguiente función SIN } previo
```

**Impacto**: Si TypeScript compila con tsc estricto, esto rompe el build completo. Afecta toda la oficina, no solo lead-scoring.

### 1.2 Claves i18n faltantes — Sección Google (`templates-sections.ts:200-255`)

La sección Google usa claves que **no existen** en `templates-i18n.ts`:

| Clave usada en template | Existe en i18n? | Clave correcta probable |
|---|---|---|
| `googleConnected` | NO | `googleAppsConnected` |
| `googleNotConnected` | NO | `googleAppsNotConnected` |
| `googleConnectBtn` | NO | `googleAppsConnectBtn` |
| `googleDisconnectBtn` | NO | `googleAppsDisconnectBtn` |
| `googleAuthInfo` | NO | `googleAppsAuthInfo` |
| `googleModulesTitle` | NO | `googleAppsServicesTitle` |

**Impacto**: La función `t()` devuelve el nombre de la clave como fallback. El usuario ve `googleConnected` en lugar de "Google Apps conectado".

### 1.3 Claves i18n faltantes — Sección Naturalidad (`templates-sections.ts:174-184`)

El template usa prefijo `ACK_` pero i18n tiene prefijo `AVISO_`:

| Clave usada en template | Existe en i18n? | Clave en i18n |
|---|---|---|
| `sub_ack_whatsapp` | NO | `sub_aviso_whatsapp` |
| `sub_ack_email` | NO | `sub_aviso_email` |
| `f_ACK_WHATSAPP_TRIGGER_MS` | NO | `f_AVISO_WA_TRIGGER_MS` |
| `f_ACK_WHATSAPP_HOLD_MS` | NO | `f_AVISO_WA_HOLD_MS` |
| `f_ACK_WHATSAPP_MESSAGE` | NO | (no existe) |
| `i_ACK_WHATSAPP_TRIGGER_MS` | NO | `i_AVISO_TRIGGER_MS` |
| `i_ACK_WHATSAPP_HOLD_MS` | NO | `i_AVISO_HOLD_MS` |
| `i_ACK_WHATSAPP_MESSAGE` | NO | `i_AVISO_MSG` |
| `f_ACK_EMAIL_TRIGGER_MS` | NO | `f_AVISO_EMAIL_TRIGGER_MS` |
| `f_ACK_EMAIL_HOLD_MS` | NO | `f_AVISO_EMAIL_HOLD_MS` |
| `f_ACK_EMAIL_MESSAGE` | NO | (no existe) |
| `i_ACK_EMAIL_TRIGGER_MS` | NO | (no existe) |
| `i_ACK_EMAIL_HOLD_MS` | NO | (no existe) |
| `i_ACK_EMAIL_MESSAGE` | NO | (no existe) |

**Impacto**: Toda la sección "Naturalidad" muestra nombres de claves crudas como labels.

### 1.4 Claves i18n faltantes — Pipeline tooltips

| Clave usada | Existe? |
|---|---|
| `i_SUBAGENT_ITER` | NO |
| `i_PIPELINE_REPLAN` | NO |

**Impacto**: Info tooltips de subagent y replan muestran el key name.

### 1.5 Strings hardcodeados en JS sin i18n (`oficina-minimal.js`)

```javascript
// Línea 163: No usa i18n
showToast('Connecting...', 'success')

// Línea 168: Diálogo de confirmación hardcodeado en inglés
if (!confirm('Disconnect WhatsApp?')) return

// Línea 176:
showToast('Scanning...', 'success')

// Línea 181:
showToast('Scan complete', 'success')

// Línea 203: Confirmación hardcodeada en inglés
if (!confirm('WARNING: This will delete ALL messages and sessions. Continue?')) return

// Línea 222:
showToast('Opening Google auth...', 'success')

// Línea 230:
showToast('Google connected', 'success')

// Línea 246:
if (!confirm('Disconnect Google?')) return
```

**Impacto**: Usuarios en español ven confirmaciones y toasts en inglés.

---

## 2. ARQUITECTURA — Problemas estructurales

### 2.1 Navegación híbrida: hardcodeada vs dinámica

**Problema central**: La sidebar tiene 17 secciones hardcodeadas en `NAV_SECTIONS` (templates.ts:6-28), pero los módulos registran su propia UI vía `manifest.oficina`. Hay una **desconexión** entre ambos sistemas:

**Secciones hardcodeadas en sidebar** (17):
`whatsapp`, `email`, `google`, `apikeys`, `models`, `llm-limits`, `llm-cb`, `pipeline`, `engine-metrics`, `followup`, `naturalidad`, `lead-scoring`, `scheduled-tasks`, `modules`, `db`, `redis`

**Módulos con UI registrada en manifest** (15):
`oficina`, `prompts`, `llm`, `whatsapp`, `knowledge`, `gmail`, `google-apps`, `google-chat`, `twilio-voice`, `lead-scoring`, `users`, `tools`, `memory`, `model-scanner`, `scheduled-tasks`

**Resultado**: Hay módulos con UI completa que **nunca aparecen como sección propia en la sidebar**:

| Módulo | Tiene oficina.fields | Tiene API routes | Tiene sidebar item? |
|---|---|---|---|
| `users` | 3 fields + 9 API routes | SI | **NO** |
| `knowledge` | 9 fields + 25+ API routes | SI | **NO** |
| `prompts` | 3 textarea fields + 6 API routes | SI | **NO** |
| `tools` | 3 fields + 6 API routes | SI | **NO** |
| `memory` | 14 fields | SI | **NO** |
| `twilio-voice` | 16 fields + 9 API routes | SI | **NO** |
| `google-chat` | 3 fields + 4 API routes | SI | **NO** |
| `gmail` | 11 fields + 9 API routes | SI | **NO** |
| `google-apps` | 7 fields + 5 API routes | SI | **NO** |

Estos módulos **solo** aparecen enterrados en la sección "Módulos Activos", mezclados con toggles de activación. Sus campos de configuración detallados y API routes ricas son **inaccesibles** desde la UI principal.

### 2.2 Mezcla de patrones de rendering

Hay **4 patrones diferentes** de cómo se renderiza una sección:

1. **Hardcodeado en templates-sections.ts** — WhatsApp, API Keys, Models, etc. (12 secciones)
2. **Delegación a servicio** — Scheduled Tasks usa `registry.getOptional('scheduled-tasks:renderSection')`
3. **Redirect externo** — Lead Scoring redirige a `/oficina/api/lead-scoring/ui` (SPA separada)
4. **Dinámico desde manifest** — Módulos en la sección "Módulos" renderizan fields de `manifest.oficina.fields`

Esto genera inconsistencia de UX: unas secciones son pages normales, otra abre una SPA separada, otra delega el HTML a otro módulo.

### 2.3 Secciones que mezclan config del kernel con config de módulos

La sección "API Keys" muestra `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY` — que son config del módulo `llm`. La sección "Models" muestra `LLM_*` — también del módulo `llm`. Pero estas secciones están hardcodeadas en la oficina, no vienen del manifest del módulo `llm`.

**Duplicación**: El módulo `llm` declara 18 campos en su `oficina.fields`, incluyendo las API keys y modelos. Pero la oficina renderiza sus propias versiones hardcodeadas de estos mismos campos.

---

## 3. UI/UX — Problemas y mejoras

### 3.1 Categorías de sidebar mal organizadas

**Problema**: Las categorías no reflejan la estructura real del sistema.

| Categoría actual | Contenido | Problema |
|---|---|---|
| **Channels** | WhatsApp, Email (soon), Google (soon) | Falta Google Chat, Twilio Voice. Email dice "soon" pero el módulo gmail existe |
| **AI** | API Keys, Models, Limits, Circuit Breaker | Todo es config del módulo `llm`, debería ser una sola categoría "LLM" con sub-secciones |
| **Pipeline** | Pipeline, Metrics, Follow-up, Naturalidad | Follow-up y Naturalidad no son "pipeline" conceptualmente |
| **Leads** | Lead Scoring, Scheduled Tasks | Scheduled Tasks no es exclusivo de leads |
| **System** | Modules, DB, Redis | Faltan Prompts, Knowledge, Tools, Users, Memory |

### 3.2 Secciones "Coming Soon" obsoletas

- `email` dice "Coming Soon" → pero el módulo `gmail` está activo, con 11 campos y 9 API routes
- `google` (channels) dice "Coming Soon" → pero `google-chat` existe con webhook, service account, y testing

### 3.3 Lead Scoring — Patrón de redirect roto

Al hacer click en "Lead Scoring" se redirige a `/oficina/api/lead-scoring/ui` — una SPA completamente separada. Esto:
- Sale del layout de la oficina (no hay sidebar, no hay header, no hay save bar)
- No hay forma de volver excepto el botón "back" del browser
- No comparte el sistema de i18n de la oficina
- No comparte el dirty tracking ni el save/apply flow

### 3.4 Save bar siempre visible

La save bar con "Reset DB", "Discard", "Save", "Apply" aparece en **todas** las secciones, incluyendo Engine Metrics (que es solo lectura). "Reset DB" es especialmente peligroso y no debería estar en la barra principal.

### 3.5 Panel collapse state no persiste

Cuando colapsas un panel y cambias de sección o recargas, vuelve a expandirse. No se guarda en localStorage.

### 3.6 Google Auth status no disponible en SSR

El renderizado inicial siempre muestra "not connected". El usuario tiene que hacer click manual en "Refresh status". La sección debería hacer la verificación server-side.

### 3.7 Dirty tracking con doble input para booleans

Cada toggle tiene un `<input type="checkbox">` + `<input type="hidden">` con el mismo `name`. El form submit sync funciona pero es frágil — si el JS falla, se envían valores duplicados.

---

## 4. COSAS HARDCODEADAS QUE DEBERÍAN SER DINÁMICAS

### 4.1 MODEL_NAMES — Duplicado en 2 archivos

Los nombres amigables de modelos están hardcodeados en:
- `templates-fields.ts:61-75` (server-side)
- `oficina-minimal.js:96-110` (client-side)

Ambas listas deben mantenerse sincronizadas manualmente. Cuando se agrega un nuevo modelo, hay que actualizar 2 archivos. Deberían venir del model-scanner o de una sola fuente.

### 4.2 NAV_SECTIONS — Completamente hardcodeado

Las 17 secciones de navegación están definidas estáticamente. Agregar una nueva sección requiere editar `templates.ts`, `templates-sections.ts`, `templates-i18n.ts`, y `server.ts`.

**Propuesta**: Los módulos ya declaran `oficina.title`, `oficina.info`, `oficina.order`, `oficina.fields`. Se podría generar la sidebar dinámicamente desde los manifests.

### 4.3 Secciones AI hardcodeadas

API Keys, Models, Limits, Circuit Breaker — todas son config del módulo `llm` que ya las declara en su manifest. Renderizarlas debería ser automático.

### 4.4 Config defaults duplicados

`DB_HOST: 'localhost', DB_PORT: '5432', ...` aparecen hardcodeados en `server.ts:104-107` Y en `server.ts:414-416`. Los defaults deberían venir de los configSchema de los módulos.

---

## 5. COSAS REDUNDANTES O DESACTUALIZADAS

### 5.1 Sección "Email" (Coming Soon) — Obsoleta
El módulo `gmail` está completamente implementado con 11 config fields y 9 API routes. La sección debería mostrar la configuración real del módulo.

### 5.2 Sección "Google" (Channels, Coming Soon) — Parcialmente obsoleta
`google-chat` existe y funciona. La sección Google actual muestra OAuth pero no la config de Google Chat (service account, webhook token).

### 5.3 Doble representación de WhatsApp
WhatsApp tiene:
1. Su propia sección hardcodeada en el sidebar (`/oficina/whatsapp`)
2. Un panel en "Módulos Activos" con `oficina.fields` del manifest

El usuario puede ver info de WhatsApp en 2 lugares con diferente nivel de detalle.

### 5.4 API routes duplicadas
- `POST /oficina/api/oficina/reset-db` (API JSON)
- `POST /oficina/reset-db` (form POST con redirect)

Ambas hacen lo mismo (truncate + flushdb).

### 5.5 Config read duplicado
`fetchSectionData()` en `server.ts` y el handler `GET /config` en las API routes hacen exactamente lo mismo: leer .env + DB + defaults y mergear.

---

## 6. MÓDULOS CON UI COMPLETA NO MOSTRADA EN SIDEBAR

### 6.1 Users — Listas de usuarios y permisos
- 3 config fields + 9 API routes (CRUD completo, bulk import, Sheets sync)
- **No tiene sección propia** — solo aparece como toggle en "Módulos"
- El usuario preguntó "no veo donde se configuran las tablas de usuarios" — **confirmado, no se muestra**

### 6.2 Knowledge — Base de conocimiento
- 9 config fields + 25+ API routes (docs, FAQs, sync, vectorización, búsqueda)
- Panel de administración completo: subir documentos, gestionar categorías, conectores API, fuentes web, FAQs
- **No tiene sección propia** — enterrado en "Módulos"

### 6.3 Prompts — Prompts del agente
- 3 textarea fields (identidad, trabajo, guardarails) + 6 API routes (slots, campañas)
- **No tiene sección propia** — los textareas son lo más importante para personalizar el agente

### 6.4 Tools — Herramientas del agente
- 3 config fields + 6 API routes (catálogo, settings por tool, control de acceso, historial)
- **No tiene sección propia**

### 6.5 Memory — Sistema de memoria
- 14 config fields (buffer, TTL, compresión, modelo, retención, cron)
- **No tiene sección propia**

### 6.6 Twilio Voice — Llamadas de voz
- 16 config fields + 9 API routes (llamadas, historial, transcripts, preview de voz)
- **No tiene sección propia** — se marca como canal pero no aparece en "Canales"

### 6.7 Google Chat — Canal Google Chat
- 3 config fields + 4 API routes (webhook, validación, test, guía de setup)
- **No tiene sección propia** — debería estar en "Canales"

### 6.8 Gmail — Canal Email
- 11 config fields + 9 API routes (polling, auth, send, reply)
- **No tiene sección propia** — la sección "Email" dice "Coming Soon"

### 6.9 Google Apps — Provider Google
- 7 config fields + 5 API routes (OAuth2, servicios)
- Parcialmente representado en la sección "Google" (solo OAuth), pero no sus config fields

---

## 7. PROPUESTA DE REORGANIZACIÓN

### Sistema de páginas por categoría

En lugar de secciones hardcodeadas, generar la navegación dinámicamente desde los manifests:

```
CANALES
├── WhatsApp          (módulo whatsapp — conexión Baileys, QR, phones)
├── Email             (módulo gmail — polling, auth, config)
├── Google Chat       (módulo google-chat — service account, webhook)
└── Voz               (módulo twilio-voice — credenciales, settings, llamadas)

AGENTE
├── Prompts           (módulo prompts — identidad, trabajo, guardrails, campañas)
├── Tools             (módulo tools — catálogo, settings, acceso, historial)
├── Knowledge         (módulo knowledge — docs, FAQs, sync, búsqueda)
└── Naturalidad       (renderizado custom — delays, avisos por canal)

INTELIGENCIA ARTIFICIAL
├── Proveedores       (módulo llm — API keys, circuit breaker, status)
├── Modelos           (módulo llm — selección por tarea, fallbacks, scanner)
└── Límites           (módulo llm — tokens, temperaturas, timeouts)

LEADS
├── Scoring           (módulo lead-scoring — configuración BANT, stats, detalle)
├── Follow-up         (renderizado custom — enabled, delay, max, cold)
├── Tareas            (módulo scheduled-tasks — cron, acciones, ejecuciones)
└── Usuarios          (módulo users — listas, permisos, sync Sheets)

GOOGLE APPS
├── OAuth & Servicios (módulo google-apps — conexión, servicios activos)
└── [dinámico por servicio activo]

SISTEMA
├── Memoria           (módulo memory — buffer, TTL, compresión, retención)
├── Engine Metrics    (oficina — métricas de rendimiento, solo lectura)
├── Módulos           (oficina — toggle activation, overview)
├── Base de Datos     (kernel — PostgreSQL connection)
└── Redis             (kernel — Redis connection)
```

### Principios de la nueva arquitectura

1. **Cada módulo es una página** — Si un módulo declara `oficina.fields` o `oficina.apiRoutes`, genera automáticamente un item en la sidebar
2. **Categorías dinámicas** — Los módulos declaran `oficina.group` (channel, agent, ai, leads, system) y `oficina.order`
3. **Sin duplicación** — Los campos vienen del manifest, no hardcodeados en templates-sections
4. **Secciones custom** — Para UX especiales (WhatsApp QR, Google OAuth popup), el módulo puede proveer una función `renderSection` vía servicio
5. **Lead Scoring integrado** — En vez de redirect a SPA separada, renderizar inline como los demás

---

## 8. PROCESOS A AUTOMATIZAR/ESTANDARIZAR

### 8.1 Registro automático de secciones
Cuando un módulo se activa, su sección debería aparecer automáticamente en la sidebar. Hoy hay que editar 4 archivos manualmente.

### 8.2 Validación de i18n keys
Crear un script que verifique que toda clave usada en templates exista en ambos idiomas del diccionario. Hoy las claves faltantes pasan silenciosamente.

### 8.3 Generación de campos desde configSchema
Los módulos ya declaran su `configSchema` (Zod). Los `oficina.fields` podrían generarse automáticamente desde el schema en vez de duplicar la definición.

### 8.4 Cache busting para assets estáticos
CSS/JS se cachea 24h sin versionado. Agregar hash o query param al path de los assets.

### 8.5 Google Auth server-side check
Verificar el status de OAuth en `fetchSectionData()` para que el render inicial sea correcto.

### 8.6 Consistencia en patrones de sección
Estandarizar: todas las secciones se renderizan de la misma forma (SSR con datos del módulo), eliminando el patrón de redirect (lead-scoring) y el patrón de delegación (scheduled-tasks).

---

## 9. RESUMEN DE ACCIONES POR PRIORIDAD

### Crítico (rompe funcionalidad)
1. Agregar `}` faltante en `templates-sections.ts:366`
2. Corregir claves i18n de la sección Google (6 claves)
3. Corregir claves i18n de la sección Naturalidad (14 claves)
4. Agregar claves i18n faltantes para pipeline tooltips (2 claves)

### Alto (features invisibles)
5. Crear secciones de sidebar para: Users, Knowledge, Prompts, Tools, Memory, Twilio Voice, Google Chat
6. Reemplazar "Coming Soon" de Email con la config real del módulo gmail
7. Integrar Lead Scoring inline en vez de redirect a SPA externa
8. Internacionalizar strings del JS client-side

### Medio (mejoras de arquitectura)
9. Generar sidebar dinámicamente desde manifests de módulos
10. Unificar MODEL_NAMES en una sola fuente
11. Eliminar duplicación de secciones AI (vienen del módulo llm)
12. Separar "Reset DB" de la save bar general
13. Persistir panel collapse state en localStorage

### Bajo (polish)
14. Validación automática de claves i18n
15. Cache busting para assets
16. Eliminar API routes duplicadas (reset-db form vs API)
17. Google Auth check server-side
