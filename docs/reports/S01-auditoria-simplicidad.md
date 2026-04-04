# AUDITORIA DE SIMPLICIDAD - S01

## Objetivo
Convertir esta rama en una bitacora viva para simplificar el sistema modulo por modulo sin romper la arquitectura modular ni las reglas del kernel.

## Norte de la auditoria
- Codigo mas ligero.
- Codigo mas solido y maduro.
- Menos bugs, huerfanos, redundancias, duplicados, excesos y huecos.
- Menos complejidad inutil.
- Mas unificacion, seguridad y eficiencia.

## Reglas de trabajo
- Auditar un modulo a la vez.
- Registrar primero hallazgos, luego decisiones, luego cambios aplicados.
- Priorizar simplificacion real sobre refactors cosmeticos.
- No romper contratos entre modulos sin dejar nota de migracion.
- Validar cada corte con evidencia: codigo, tests, diff, riesgo removido o mejora de comportamiento.

## Estados por modulo
- `pendiente`: aun no revisado.
- `en-analisis`: estamos leyendo y acotando problemas.
- `en-cambios`: ya estamos aplicando simplificaciones.
- `validado`: cambios cerrados y verificados.
- `postergado`: detectamos trabajo util, pero no entra en esta ronda.

## Tablero de auditoria
| Modulo | Estado | Prioridad | Nota |
| --- | --- | --- | --- |
| `src/kernel` | pendiente | alta | Nucleo transversal del sistema modular. |
| `src/engine` | validado | alta | Primera ronda ya ejecutada; quedan boundaries grandes para otra pasada. |
| `src/modules/llm` | pendiente | alta | Gateway critico para costos, fallback y resiliencia. |
| `src/modules/tools` | pendiente | alta | Superficie amplia de ejecucion y posibles duplicaciones. |
| `src/modules/memory` | pendiente | alta | Impacta contexto, rendimiento y consistencia. |
| `src/modules/knowledge` | pendiente | alta | Riesgo de retrieval pesado y acoplamiento. |
| `src/modules/engine` | pendiente | media | Wrapper del engine para kernel/config. |
| `src/modules/console` | en-analisis | media | Auditoria activa sobre UI desconectada, hardcodes y enlaces legacy. |
| `src/modules/whatsapp` | pendiente | media | Canal grande, sensible a errores operativos. |
| `src/modules/gmail` | pendiente | media | Revisar duplicacion con Google Apps y solidez de envio. |
| `src/modules/google-chat` | pendiente | media | Canal adicional para revisar consistencia. |
| `src/modules/google-apps` | pendiente | media | Posible superficie grande de helpers y cache. |
| `src/modules/lead-scoring` | pendiente | media | Buscar reglas duplicadas y scoring disperso. |
| `src/modules/users` | pendiente | media | Punto central de permisos y listas. |
| `src/modules/model-scanner` | pendiente | baja | Revisar si hay complejidad util o accidental. |
| `src/modules/scheduled-tasks` | pendiente | media | Riesgo de cron jobs huerfanos y trabajos redundantes. |
| `src/modules/twilio-voice` | pendiente | media | Flujo sensible por costo y complejidad de tiempo real. |

## Plantilla por modulo
Copiar este bloque cuando arranquemos una nueva auditoria:

```md
## Auditoria - `ruta/modulo`

### Modulo
- Estado:
- Fecha:
- Objetivo de esta pasada:

### Hallazgos
- Complejidad innecesaria:
- Codigo muerto u huerfano:
- Duplicacion o redundancia:
- Riesgos de bugs:
- Riesgos de seguridad:
- Ineficiencias:
- Deuda de tests:

### Decisiones
- Mantener:
- Simplificar:
- Unificar:
- Eliminar:
- Postergar:

### Cambios aplicados
- Ninguno todavia.

### Verificacion
- Tests ejecutados:
- Resultado:
- Riesgos residuales:
```

## Registro global

### Convenciones acordadas
- Un solo documento vivo para registrar hallazgos, decisiones y cambios por modulo.
- Cada corte debe apuntar a bajar complejidad util, no solo mover codigo.
- Antes de tocar comportamiento, dejar claro cual es la fuente de verdad de config, contratos y ownership.

### Patrones a eliminar en todo el repo
- Config duplicada entre manifest, runtime y utilidades locales.
- Contratos legacy que ya no representan el flujo real.
- Flags o opciones de consola sin efecto real en runtime.
- Plumbing repetido entre rutas similares.
- Helpers locales que ya existen en kernel.

### Utilidades a centralizar
- Pendiente de auditoria transversal.

### Deuda transversal detectada
- Hay documentos previos de auditoria con sesgo a sesiones puntuales; esta bitacora pasa a ser la referencia principal.
- Hay archivos con problemas de encoding en reportes viejos; conviene normalizarlos si vuelven a tocarse.
- Falta una linea base comun de metricas simples por modulo: tamano, tests, dependencias criticas, hotspots y contratos.

---

## Auditoria - `src/engine`

### Modulo
- Estado: `validado`
- Fecha: 2026-04-03 / 2026-04-04
- Objetivo de esta pasada: cerrar la primera ronda de simplificacion util del engine y dejar una base limpia para seguir con `intake` y `delivery`.

### Hallazgos
- La salida validada no era exactamente la salida enviada; habia riesgo real de leakage en delivery.
- Reactivo y proactivo repetian gran parte del mismo pipeline agentic.
- La config del engine estaba partida entre runtime legacy y el manifest del modulo.
- Persistian tipos, tests y nomenclatura legacy que ya no describian el flujo actual.
- `intake` y `delivery` siguen siendo los dos focos principales de acoplamiento y peso.

### Decisiones
- Mantener el engine como flujo predominantemente agentic.
- Unificar reactivo y proactivo sobre un runner compartido.
- Mover la config propia del modulo hacia `registry.getConfig('engine')`.
- Podar contratos, flags y pruebas huerfanas cuando no tengan consumidores reales.
- Dejar la particion profunda de `intake` y `delivery` para la siguiente pasada.

### Cambios aplicados
- Se saneo la salida real que viaja al usuario y se reforzo la defensa en profundidad del post-processing.
- Se extrajo un runner agentic compartido para delivery reactivo y proactivo.
- Se avanzo la unificacion de config del engine con el registry del modulo.
- Se limpiaron tipos legacy, flags huerfanas y una prueba obsoleta del pipeline anterior.
- Se renombro la frontera conceptual de `phases` a `boundaries`.

### Verificacion
- Tests ejecutados: `npx tsc --noEmit`, `npm test`
- Resultado: TypeScript limpio y `157` tests pasando en `12` archivos.
- Riesgos residuales: `src/engine/boundaries/intake.ts` y `src/engine/boundaries/delivery.ts` siguen siendo el mejor siguiente corte para bajar complejidad real.

---

## Auditoria - `src/modules/console`

### Modulo
- Estado: `en-analisis`
- Fecha: 2026-04-04
- Objetivo de esta pasada: identificar controles de UI que no gobiernan nada real, hardcodes que pisan la configuracion, duplicaciones de parametros y acoplamientos a semantica legacy del engine.

### Hallazgos
- `P1` Toggles agentic muertos en la UI.
  `ENGINE_TOOL_DEDUP`, `ENGINE_LOOP_DETECTION`, `ENGINE_ERROR_AS_CONTEXT` y `ENGINE_PARTIAL_RECOVERY` se renderizan en [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L974) pero no tienen consumidores reales fuera de `console`; no aparecen en `src/engine` ni en manifests activos. Hoy el usuario puede guardarlos, pero el runtime no cambia.
- `P1` Parametros legacy del panel `pipeline` sin efecto real.
  `PIPELINE_MAX_CONVERSATION_TURNS`, `PIPELINE_SESSION_TTL_MS` y todo el bloque `FOLLOWUP_*` aparecen en [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L296), pero en el repo solo llegan a [src/engine/config.ts](C:/Users/miged/Git/LUNA/src/engine/config.ts) y no se usan en el flujo actual. Son controles vivos en UI para comportamiento muerto o no conectado.
- `P1` Canales reales bloqueados por hardcode de "Proximamente".
  [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L1318) fuerza `google-chat` y `twilio-voice` a `COMING_SOON_CHANNELS`, deshabilitando toggle y acceso a settings aunque ambos modulos existen como canales funcionales con `connectionWizard` y APIs propias en [google-chat/manifest.ts](C:/Users/miged/Git/LUNA/src/modules/google-chat/manifest.ts) y [twilio-voice/manifest.ts](C:/Users/miged/Git/LUNA/src/modules/twilio-voice/manifest.ts).
- `P1` Gmail puede quedar oculto aunque el modulo funcione.
  [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L1247) solo muestra la card de Gmail si `google-apps` esta activo. Pero [gmail/manifest.ts](C:/Users/miged/Git/LUNA/src/modules/gmail/manifest.ts) soporta OAuth standalone y no depende del modulo `google-apps`. La UI puede esconder un canal operativo por una suposicion hardcodeada.
- `P1` Duplicacion silenciosa de `LLM_CRITICIZER_MODE` en la misma pagina.
  `renderAdvancedAgentSection()` pinta dos controles con el mismo `name`: uno en la tabla de modelos [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L785) y otro en el panel agentic [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L999). Luego [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L307) colapsa `URLSearchParams` a un objeto y se queda con el ultimo valor del mismo key. Uno de los dos controles siempre queda ignorado.
- `P2` Panel de subagentes con estado visual contradictorio.
  En [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L4091), `allSaAccess = isAdmin || allowedSa.length === 0` marca todos los checkboxes de subagentes como seleccionados aunque `perms.subagents` este apagado. Resultado: el toggle principal puede decir "no permitido" mientras la grilla visual sugiere acceso total.
- `P2` Deuda documental y semantica legacy visible en `console`.
  No existe [src/modules/console/AGENTS.md](C:/Users/miged/Git/LUNA/src/modules/console/AGENTS.md) aunque el repo lo declara obligatorio. Ademas, el panel avanzado sigue hablando de `Response (Phase 4)` en [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L723), lo que mantiene viva en la UI una narrativa vieja del engine.

### Decisiones
- Mantener por ahora la estructura SSR del modulo; el problema principal no es el render, sino el contrato entre UI y runtime.
- Simplificar primero controles sin efecto y hardcodes que bloquean comportamiento real.
- Unificar fuentes de verdad tomando manifests y servicios activos antes que listas hardcodeadas en templates.
- Eliminar duplicaciones de fields con el mismo `name` dentro de una misma pagina.
- Postergar cambios cosmeticos o de diseño hasta cerrar la coherencia funcional.

### Cambios aplicados
- Se saco de `console` la UI muerta del panel agentic: `AGENTIC_EFFORT_DEFAULT`, `ENGINE_TOOL_DEDUP`, `ENGINE_LOOP_DETECTION`, `ENGINE_ERROR_AS_CONTEXT`, `ENGINE_PARTIAL_RECOVERY`, `AGENTIC_LOOP_*` y `EXECUTION_QUEUE_*`.
- `PIPELINE_MAX_TOOL_CALLS_PER_TURN` y `PIPELINE_SESSION_TTL_MS` quedaron visibles en `Agente > Avanzado`; el panel `pipeline` legacy se elimino.
- Se resolvio la duplicacion de `LLM_CRITICIZER_MODE`; ahora solo existe un control real.
- Se limpiaron labels legacy de la tabla de modelos y se agrego contexto para dejar claro que esos slots son de subsistemas especializados, no del loop principal.
- `subagents` dejo de colarse en `Herramientas`.
- `engine-metrics` quedo expuesto como subtab real bajo `Agente`.
- Se elimino `SECTION_REDIRECTS` vacio y se reemplazo por redirects explicitos de compatibilidad.
- Se removieron tres POST handlers muertos de `/console/users/*`: `add-contact`, `remove-contact` y `merge`.
- Se limpiaron keys i18n huerfanas del modulo `console`.
- En runtime se podaron campos muertos de `src/engine/config.ts`, `src/engine/types.ts` y `src/modules/engine/manifest.ts`, manteniendo vivos `PIPELINE_MAX_TOOL_CALLS_PER_TURN` y `PIPELINE_SESSION_TTL_MS`.

### Verificacion
- Tests ejecutados: `npx tsc --noEmit`
- Resultado: compilacion limpia despues de la capa 1 (`console`) y de la capa 2 (`engine/runtime`).
- Verificaciones funcionales estaticas:
  - `subagents` ya no entra a los subtabs dinamicos de `Herramientas`.
  - Solo queda un `name="LLM_CRITICIZER_MODE"` en `templates-sections.ts`.
  - `PIPELINE_MAX_TOOL_CALLS_PER_TURN` sigue vivo y visible en `console`.
  - `renderPipelineUnifiedSection()` y `case 'pipeline'` ya no existen.
  - No quedaron referencias a `PIPELINE_MAX_CONVERSATION_TURNS`, `PIPELINE_MAX_REPLAN_ATTEMPTS`, `FOLLOWUP_*`, `AGENTIC_LOOP_*` ni `SUBAGENT_MAX_ITERATIONS` en `src/`.
- Riesgos residuales:
  - `parseFormBody()` sigue vivo y no se toco, pero conviene revisar su superficie cuando auditemos mas POST handlers del modulo.
  - `src/modules/console/AGENTS.md` sigue faltando; queda como deuda documental visible.

---

## Proxima pasada sugerida
1. `src/kernel`
2. `src/modules/llm`
3. `src/modules/tools`
4. `src/modules/memory`

## Criterio de exito de esta auditoria
- Menos ramas condicionales sin valor.
- Menos codigo duplicado entre modulos o flujos.
- Menos superficie muerta o no conectada.
- Menos carga eager innecesaria.
- Contratos mas claros y fuentes de verdad unicas.
- Suite de tests igual o mejor que la linea base.
