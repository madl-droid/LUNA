# PLAN MAESTRO: LUNA → Producto

## Vision
LUNA = plataforma de agente IA multi-negocio. Un core repo + plugins por negocio.
Conectas knowledge + tools → agente listo para cualquier sector.

---

## Clasificacion de modulos

### CORE (repo principal, siempre activos)
Estos son el sistema operativo de LUNA. Sin ellos no procesa un mensaje.

| Modulo | Razon |
|--------|-------|
| **kernel** | Infraestructura, registry, loader, HTTP, migraciones |
| **memory** | 3 tiers de memoria (Redis buffer → PG summaries → contact memory) |
| **llm** | Gateway unificado, circuit breaker, task routing, fallback chain |
| **tools** | Registro central, ejecucion, dedup, loop detection |
| **engine** | Pipeline completo: intake → agentic loop → delivery |
| **users** | Resolucion de tipo de contacto, permisos, listas |
| **console** | Panel de control (configuracion, monitoreo, operacion) |
| **prompts** | Gestion de identidad, job, guardrails, skills |
| **knowledge** | Base de conocimiento, search hibrido, embeddings |

### ENHANCERS (repo principal, opcionales, mejoran el core)
Estos agregan capacidades horizontales utiles para cualquier negocio.

| Modulo | Razon |
|--------|-------|
| **hitl** | Escalamiento a humanos — critico para cualquier negocio |
| **scheduled-tasks** | Automatizacion de tareas — cualquier negocio necesita |
| **subagents** | Agentes especializados (web-researcher, etc.) |
| **cortex** | Monitoreo y alertas — operacion en produccion |
| **tts** | Voice notes de salida — mejora UX en WhatsApp |

### CANALES (repo principal, activar segun necesidad)
Cada uno es independiente. Activas el que necesites.

| Modulo | Razon |
|--------|-------|
| **whatsapp** | Canal principal LATAM |
| **gmail** | Email (depende de google-apps) |
| **google-chat** | Chat corporativo (depende de google-apps) |
| **google-apps** | Provider OAuth2/Drive/Sheets/Calendar (prereq de gmail y google-chat) |
| **twilio-voice** | Llamadas telefonicas |

### PLUGINS DE NEGOCIO (repos separados, uno por vertical)
Estos son especificos de un sector. Van en repos separados.

| Modulo | Sector | Razon |
|--------|--------|-------|
| **medilink** | Salud | Integracion HealthAtom, citas, pacientes |
| **freight** | Logistica | Estimacion de flete (SeaRates + DHL) |
| **freshdesk** | Soporte | KB sync + busqueda |
| **templates** | Ventas | Comparativos, cotizaciones, presentaciones |
| **lead-scoring** | Ventas | Calificacion BANT/CHAMP/SPIN |
| **marketing-data** | Marketing | Campaign tracking, UTM, atribucion |

---

## Arquitectura de plugins

### Como funciona hoy
```
src/modules/          ← UNICO lugar donde el loader busca modulos
  medilink/
  freight/
  freshdesk/
  ...
```

### Como debe funcionar
```
src/modules/          ← Core + Enhancers + Canales (repo principal)
node_modules/
  @luna/medilink/     ← npm install @luna/medilink (repo separado)
  @luna/freight/      ← npm install @luna/freight (repo separado)
  @luna/freshdesk/    ← npm install @luna/freshdesk (repo separado)
```

### Cambio necesario en el kernel
El loader (`src/kernel/loader.ts`) hoy solo escanea `src/modules/`.
Necesita escanear tambien rutas configurables via env:

```
LUNA_PLUGIN_PATHS=node_modules/@luna     ← escanea todos los @luna/*
```

**Esfuerzo: ~50 lineas en loader.ts + 5 en config.ts.**
El registry, hooks y services ya soportan modulos externos sin cambios.

### Estructura de un plugin repo
```
@luna/medilink/
  package.json        ← name: "@luna/medilink", main: "dist/manifest.js"
  manifest.ts         ← mismo ModuleManifest de siempre
  tools.ts            ← tools que registra
  types.ts            ← types internos
  CLAUDE.md           ← contexto para Claude Code
  .env.example        ← config necesaria
```

### Contrato: que necesita exportar un plugin
```typescript
// manifest.ts — UNICO export requerido
const manifest: ModuleManifest = {
  name: 'medilink',
  version: '1.0.0',
  type: 'feature',
  depends: ['tools'],       // solo dependencias del core
  configSchema: z.object({  // config propia
    MEDILINK_DOMAIN: z.string(),
    MEDILINK_API_KEY: z.string(),
  }),
  console: { ... },         // campos para la consola
  async init(registry) { }, // registro de tools y hooks
  async stop() { },
}
export default manifest
```

---

## Plan de sesiones

### FASE 1: Estabilizar (Semanas 1-2)

#### Sesion S30: Tests de integracion basicos
**Objetivo:** Crear red de seguridad minima para no romper cosas.
**Alcance:**
- Crear `tests/` directory con vitest config
- Test 1: Engine procesa mensaje mock end-to-end (intake → agentic → delivery)
- Test 2: LLM gateway — mock providers, verificar routing + fallback + circuit breaker
- Test 3: Tool registry — register, execute, dedup, permissions
- Test 4: Memory — store, retrieve, compress, search summaries
- Test 5: Knowledge search — insert doc, search, verificar relevancia
**Entregable:** `npm test` pasa con 5 tests verdes
**Regla para Claude:** NO tocar codigo de produccion. Solo crear tests contra lo existente.

#### Sesion S31: Knowledge — umbral de relevancia + "no se"
**Objetivo:** Evitar que el agente invente cuando no tiene la respuesta.
**Alcance:**
- En `src/modules/knowledge/search-engine.ts`: agregar score minimo configurable (default 0.35). Si ningun resultado supera el umbral, retornar array vacio.
- En `instance/prompts/system/agentic-system.md` (o donde viva): agregar instruccion explicita: "Si search_knowledge no retorna resultados o los resultados son de baja relevancia, di honestamente que no tienes esa informacion y sugiere contactar al equipo."
- Agregar config `KNOWLEDGE_MIN_RELEVANCE_SCORE` al configSchema del modulo knowledge
- Test: busqueda irrelevante retorna vacio
**Entregable:** Agente dice "no tengo esa informacion" cuando la KB no tiene la respuesta
**Regla para Claude:** Solo tocar search-engine.ts, el prompt file, y manifest.ts del modulo knowledge. Nada mas.

#### Sesion S32: Memory — mejorar retencion y persistencia automatica
**Objetivo:** Que el agente recuerde mejor a largo plazo.
**Alcance:**
- Subir `MEMORY_SUMMARY_RETENTION_DAYS` default de 120 a 730 (2 anos)
- Subir `MEMORY_CONTEXT_SUMMARIES_INSTANT` de 3 a 6
- Subir `MEMORY_CONTEXT_SUMMARIES_ASYNC` de 5 a 8
- En el post-processor o delivery: despues de cada conversacion, hacer que el agente persista automaticamente 2-3 facts clave del contacto via `save_contact_data` (no depender de que "decida" hacerlo)
- Test: verificar que facts se persisten automaticamente
**Entregable:** Memoria a 2 anos, mas contexto inyectado, auto-save de facts
**Regla para Claude:** Solo tocar memory/manifest.ts (defaults), delivery.ts (auto-save), y el test.

#### Sesion S33: Console — arreglar bugs criticos
**Objetivo:** Que la consola funcione sin sorpresas.
**Alcance:**
- Implementar endpoints `channel-connect` y `channel-disconnect` en `server-api.ts`
- Quitar Google Chat de `COMING_SOON_CHANNELS` (ya esta implementado)
- Quitar "Proximamente" de Partners si no se va a implementar pronto (o dejarlo pero con mensaje claro)
- En save handler: si `users:db` no esta activo, mostrar flash message de error en vez de fallar silenciosamente
- Cuando un modulo no esta activo, mostrar "Modulo X desactivado" con link/instruccion para activarlo (no solo "no disponible")
**Entregable:** Console save funciona, canales se conectan, mensajes de error claros
**Regla para Claude:** Solo tocar archivos del modulo console. No tocar otros modulos.

#### Sesion S34: Health endpoint + errores claros
**Objetivo:** Saber si LUNA esta viva y que los leads no vean errores feos.
**Alcance:**
- Crear endpoint `GET /health` en kernel/server: retorna status de DB, Redis, WhatsApp, LLM (ultimo call exitoso), modulos activos
- Revisar fallback messages en `src/engine/fallbacks/` — asegurar que son humanos y utiles, no genericos
- Verificar que cuando LLM falla, el lead recibe un mensaje predefinido amable
- Verificar que cuando una tool falla, el agente dice algo util (no error interno)
**Entregable:** `/health` funciona, errores amables para el lead
**Regla para Claude:** Health en kernel/server.ts. Fallbacks en engine/fallbacks/. No tocar pipeline.

---

### FASE 2: Plugin architecture (Semanas 3-4)

#### Sesion S35: Loader multi-path + plugin discovery
**Objetivo:** Que el kernel pueda cargar modulos de fuera de src/modules/.
**Alcance:**
- Agregar `LUNA_PLUGIN_PATHS` a kernel config (string separado por `:`, default vacio)
- Modificar `loader.ts` `discoverModules()` para escanear multiples directorios
- Agregar deteccion de nombres duplicados (throw error si dos modulos tienen el mismo name)
- Agregar campo `source: 'builtin' | 'plugin'` al meta de `kernel_modules`
- Test: crear modulo mock en /tmp, configurar path, verificar que el loader lo encuentra
**Entregable:** `LUNA_PLUGIN_PATHS=/path/to/plugins` funciona
**Regla para Claude:** Solo tocar loader.ts, config.ts, y el test. No tocar modulos existentes.

#### Sesion S36: Extraer medilink como plugin piloto
**Objetivo:** Demostrar que un modulo de negocio puede vivir fuera del repo.
**Alcance:**
- Crear directorio temporal `plugins/medilink/` (fuera de src/modules/)
- Mover todos los archivos de `src/modules/medilink/` a `plugins/medilink/`
- Mover `src/tools/medilink/` (si existe) al mismo lugar
- Ajustar imports (solo deberian ser de `../../kernel/types.js` → cambiar a import del package)
- Verificar que el loader lo descubre via `LUNA_PLUGIN_PATHS=./plugins`
- Verificar que init, tools, hooks funcionan igual
- Documentar el proceso como guia para futuros plugins
**Entregable:** medilink funciona identico pero desde fuera de src/modules/
**Regla para Claude:** No modificar el core. Solo mover archivos y ajustar imports del plugin.

#### Sesion S37: Plugin template + documentacion
**Objetivo:** Que crear un plugin nuevo sea facil y rapido.
**Alcance:**
- Crear `plugins/_template/` con estructura minima: manifest.ts, types.ts, tools.ts, CLAUDE.md, .env.example, package.json
- Documentar en `docs/architecture/plugin-guide.md`: como crear un plugin, que exportar, como registrar tools, como agregar console fields
- Agregar script `scripts/create-plugin.ts` que genere la estructura de un plugin nuevo (nombre como argumento)
**Entregable:** `npx tsx scripts/create-plugin.ts mi-plugin` genera estructura lista
**Regla para Claude:** Solo crear archivos nuevos. No modificar existentes.

#### Sesion S38: Quick tool registration (sin modulo wrapper)
**Objetivo:** Poder agregar una tool con minimo boilerplate.
**Alcance:**
- Crear mecanismo de "quick tools" en el modulo tools: archivos `.tool.ts` en `instance/tools/` que exportan `{ definition, handler }`
- El modulo tools escanea ese directorio en init() y registra cada tool encontrada
- Documentar formato minimo (~30 lineas por tool vs ~150 del wrapper actual)
- Crear ejemplo: `instance/tools/ejemplo.tool.ts`
**Entregable:** Crear un archivo en instance/tools/ y la tool aparece automaticamente
**Regla para Claude:** Modificar solo tools/manifest.ts para agregar el scan. Crear archivos nuevos en instance/tools/.

---

### FASE 3: Consola nueva (Semanas 5-8)

#### Sesion S39: Redisenar la consola — plan y wireframes
**Objetivo:** Definir que debe tener la consola v2 antes de construirla.
**Alcance:**
- Auditar cada seccion actual: que funciona, que esta roto, que sobra
- Definir las secciones de la consola v2:
  1. **Dashboard** — metricas reales: mensajes hoy, leads activos, LLM cost, canal status
  2. **Canales** — activar/desactivar, conectar (QR WhatsApp, OAuth Gmail), status en vivo
  3. **Conocimiento** — subir docs, ver items, buscar, status de embeddings
  4. **Agente** — identidad (nombre, accent, prompts editables), memoria config, engine config
  5. **Tools** — catalogo, enable/disable, guidance editable, quick tool upload
  6. **Contactos** — listas, CRUD, permisos por lista
  7. **Escalamiento** — **NUEVO: dashboard HITL** con tickets abiertos, asignados, tiempos, reasignar
  8. **Plugins** — **NUEVO:** lista de plugins instalados, activar/desactivar, config
  9. **Sistema** — health, logs recientes, config avanzado, debug
- Documentar wireframes en texto (no se necesitan imagenes)
- NO escribir codigo en esta sesion
**Entregable:** Documento `docs/plans/console-v2/design.md` con todas las secciones definidas
**Regla para Claude:** Solo escribir documentacion. Cero codigo.

#### Sesion S40: Console v2 — layout, routing, CSS base
**Objetivo:** Nueva estructura de la consola limpia.
**Alcance:**
- Refactorizar server.ts: limpiar routing, separar handlers por seccion en archivos dedicados
- Nuevo layout con sidebar navegable (ya existe, pulir)
- Asegurar que cada seccion carga correctamente
- Mobile responsive desde el inicio
- NO reimplementar contenido de secciones — solo estructura
**Entregable:** Navegacion limpia entre todas las secciones, cada una con placeholder
**Regla para Claude:** Solo archivos del modulo console.

#### Sesion S41: Console — Dashboard + Canales
**Objetivo:** Dos secciones completas y pulidas.
**Alcance:**
- Dashboard: metricas reales desde DB (mensajes 24h, leads activos, sessions, LLM cost, canal breakdown)
- Canales: grid de canales, toggle on/off funcional, connect/disconnect funcional, status en vivo
- WhatsApp: QR display + connection status
- Gmail/Google Chat: OAuth flow + status
**Entregable:** Dashboard y Canales funcionan end-to-end
**Regla para Claude:** Solo archivos del modulo console + endpoints de canales necesarios.

#### Sesion S42: Console — Knowledge + Agente
**Objetivo:** Dos secciones completas.
**Alcance:**
- Knowledge: lista de items, upload, buscar, status de embeddings, eliminar
- Agente: editar prompts (identidad, job, guardrails), config de memoria, accent, skills (readonly con explicacion)
**Entregable:** Knowledge y Agente configurables desde consola

#### Sesion S43: Console — Tools + Contactos
**Objetivo:** Dos secciones completas.
**Alcance:**
- Tools: catalogo con toggle, guidance editable inline, quick tools
- Contactos: CRUD por lista, permisos, canales multiples por contacto
**Entregable:** Tools y Contactos operativos

#### Sesion S44: Console — HITL Dashboard + Plugins + Sistema
**Objetivo:** Las tres secciones restantes.
**Alcance:**
- HITL: tickets abiertos con tiempo de espera, asignado a, urgencia. Botones: reasignar, escalar, resolver manual. Historial de ticket.
- Plugins: lista de plugins instalados (builtin + external), activar/desactivar, link a config
- Sistema: health status, logs recientes (ultimos 50), config avanzado (engine limits, circuit breaker)
**Entregable:** Consola v2 completa

---

### FASE 4: Produccion (Semanas 9-10)

#### Sesion S45: Extraer modulos de negocio restantes
**Objetivo:** Limpiar el repo principal.
**Alcance:**
- Mover freight, freshdesk, templates, lead-scoring, marketing-data a plugins/
- Verificar que cada uno funciona via LUNA_PLUGIN_PATHS
- Limpiar src/modules/ — debe quedar solo core + enhancers + canales
- Actualizar CLAUDE.md root con la nueva estructura
**Entregable:** Repo principal limpio, plugins funcionando externamente

#### Sesion S46: Deploy multi-instance
**Objetivo:** Un deploy por negocio con plugins diferentes.
**Alcance:**
- Documentar como hacer deploy de LUNA para negocio A (salud: +medilink) vs negocio B (logistica: +freight)
- Docker compose por instancia con LUNA_PLUGIN_PATHS apuntando a plugins necesarios
- Verificar que instance/ (config, knowledge, prompts) es independiente por deploy
- Script de setup de nueva instancia
**Entregable:** Dos instancias corriendo con plugins diferentes

#### Sesion S47: Stress test + monitoring
**Objetivo:** Verificar que LUNA aguanta uso real.
**Alcance:**
- Test de carga: 50 mensajes concurrentes, verificar pipeline semaphore, contact locks, LLM rate limits
- Verificar reconexion de WhatsApp despues de caida
- Verificar circuit breaker con provider caido
- Configurar alertas basicas (Cortex modulo, o simple log monitoring)
- Documentar runbook: que hacer cuando X falla
**Entregable:** LUNA probada bajo carga, runbook de operaciones

---

## Reglas generales para TODAS las sesiones

1. **Una sesion = un objetivo.** No expandir scope.
2. **Compilar antes de commit.** `npx tsc --noEmit` debe pasar.
3. **Tests existentes deben pasar.** `npm test` verde despues de cada sesion.
4. **No agregar features no pedidas.** Si Claude sugiere "tambien podriamos agregar X", la respuesta es no.
5. **Verificar claims.** Si Claude dice "esto no funciona", pedir que muestre el codigo. Lo de los audios demostro que puede equivocarse.
6. **Commits pequenos.** Un commit por cambio logico, no un mega-commit.
7. **Actualizar CLAUDE.md** del modulo tocado si hubo cambios de API, config, o comportamiento.

## Estimacion total

| Fase | Sesiones | Semanas | Que logras |
|------|----------|---------|------------|
| 1: Estabilizar | S30-S34 (5) | 2 | LUNA confiable, tests, errores claros |
| 2: Plugins | S35-S38 (4) | 2 | Arquitectura de plugins funcionando |
| 3: Consola | S39-S44 (6) | 4 | Consola v2 completa y pulida |
| 4: Produccion | S45-S47 (3) | 2 | Multi-instance, stress tested, operable |
| **Total** | **18 sesiones** | **~10 semanas** | **LUNA = producto** |

## Prioridad si no tienes 10 semanas

**Minimo viable (4 semanas, 9 sesiones):**
- S30 (tests) → S31 (knowledge) → S32 (memory) → S33 (console fixes)
- S35 (loader multi-path) → S36 (medilink como plugin)
- S39 (plan consola) → S40 (layout) → S44 (HITL dashboard)

Esto te da: agente que no inventa, recuerda mejor, consola funcional, y plugins funcionando.
