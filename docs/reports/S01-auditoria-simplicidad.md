# AUDITORIA DE SIMPLICIDAD — S01

## Objetivo
Reducir complejidad accidental, código muerto, duplicaciones, riesgos y costo operativo del sistema, sin romper la arquitectura modular ni las reglas del kernel.

## Norte de la auditoría
- Código más ligero
- Código más sólido y maduro
- Menos bugs, huérfanos, redundancias, duplicados, excesos y huecos
- Más unificación, seguridad y eficiencia

## Reglas de trabajo
- Avanzar módulo por módulo
- Registrar primero hallazgos, luego decisiones, luego cambios aplicados
- Preferir simplificación real sobre refactors cosméticos
- No romper contratos entre módulos sin dejar nota de migración
- Validar cada simplificación con evidencia: código, tests, métricas o riesgo removido

## Orden sugerido
1. `src/kernel`
2. `src/engine`
3. `src/modules/llm`
4. `src/modules/tools`
5. `src/modules/memory`
6. `src/modules/knowledge`
7. `src/modules/engine`
8. `src/modules/console`
9. `src/modules/whatsapp`
10. `src/modules/gmail`
11. `src/modules/google-chat`
12. `src/modules/google-apps`
13. `src/modules/lead-scoring`
14. `src/modules/users`
15. `src/modules/model-scanner`
16. `src/modules/scheduled-tasks`
17. `src/modules/twilio-voice`

## Checklist por módulo
### Módulo
- Estado: `pendiente | en análisis | en cambios | validado`
- Dueño de la decisión:
- Fecha:

### Hallazgos
- Complejidad innecesaria:
- Código muerto u huérfano:
- Duplicación o redundancia:
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
- Ninguno todavía.

### Verificación
- Tests ejecutados:
- Resultado:
- Riesgos residuales:

---

## Registro global

### Convenciones acordadas
- Pendiente.

### Patrones a eliminar en todo el repo
- Pendiente.

### Utilidades a centralizar
- Pendiente.

### Deuda transversal detectada
- Pendiente.

---

## Auditoría — `src/engine`

### Módulo
- Estado: `validado`
- Dueño de la decisión: Codex + usuario + Claude Code
- Fecha: 2026-04-03

### Contexto observado
- `src/engine` tiene 79 archivos y ~530 KB de código.
- El flujo real ya no es un pipeline clásico de 5 fases: hoy la ruta reactiva efectiva es `phase1 -> agentic loop -> postProcess -> phase5`.
- Aun así, el módulo conserva tipos, config, comentarios y estructuras del pipeline legado de fases 2/3/4.
- Faltan archivos de contexto prometidos por el repo: no existe `src/engine/AGENTS.md` y tampoco existe `src/modules/engine/AGENTS.md`.

### Hallazgos
- `P1` Validación inefectiva en salida.
  En `src/engine/phases/phase5-validate.ts`, la validación sanea `responseText`, pero el envío real usa `composed.formattedParts`, `composed.audioBuffer` y `composed.audioChunks`. Eso significa que una respuesta con leakage de tool calls o secretos puede ser “validada” pero igual salir al usuario sin saneamiento. Referencias: `phase5-validate.ts:67-73`, `phase5-validate.ts:95-127`, `phase5-validate.ts:153-156`.
- `P1` Doble fuente de verdad para config del engine.
  El módulo `src/modules/engine/manifest.ts` expone `configSchema` y console fields, pero `src/engine/config.ts` vuelve a cargar el estado mediante `getEnv()` y no desde `registry.getConfig('engine')`. Esto rompe la idea de config distribuida, duplica defaults y vuelve opaco qué valor manda realmente. Referencias: `src/engine/config.ts:4-45`, `src/engine/engine.ts:43-61`, `src/engine/engine.ts:547-564`, `src/modules/engine/manifest.ts`.
- `P1` Flags/configs prometidas pero sin efecto real.
  `toolDedupEnabled`, `loopDetectionEnabled`, `errorAsContextEnabled`, `partialRecoveryEnabled`, `executionQueueReactiveConcurrency`, `executionQueueProactiveConcurrency` y `executionQueueBackgroundConcurrency` existen en config/tipos/UI, pero en esta auditoría no apareció uso real de varias de esas flags dentro del loop principal. El engine instancia dedup y loop detection siempre, y las concurrencies de execution queue no aparecen conectadas en el núcleo auditado. Referencias: `src/engine/config.ts:149-172`, `src/engine/agentic/agentic-loop.ts`, búsqueda global en `src/engine/**/*.ts`.
- `P1` Duplicación fuerte entre pipeline reactivo y proactivo.
  `src/engine/engine.ts` y `src/engine/proactive/proactive-pipeline.ts` repiten la misma secuencia: selección de esfuerzo/modelo, carga de tool catalog, skill filtering, prompt building, armado de `AgenticConfig`, `runAgenticLoop`, `postProcess`, `phase5Validate`, pipeline log. Esto sube el costo de cambio y aumenta el riesgo de divergencia. Referencias: `engine.ts:389-525`, `proactive-pipeline.ts:127-321`.
- `P2` `types.ts` mezcla contratos vivos con legado amplio.
  `src/engine/types.ts` sigue exportando `EvaluatorOutput`, `ExecutionOutput`, `ExecutionStep`, `ReplanContext`, modelos legacy y varios campos de `PipelineResult` que ya no participan en el flujo reactivo principal. Eso hace más difícil entender qué parte del engine sigue viva y cuál es solo compatibilidad histórica. Referencias: `src/engine/types.ts`.
- `P2` `phase1-intake.ts` concentra demasiadas responsabilidades.
  Resuelve usuario, contacto, sesión, campañas, knowledge, Freshdesk, sheets cache, memoria, attachments, audio preference, auto-link externo y armado final del contexto. Es el mayor punto de acoplamiento del engine y complica pruebas, observabilidad y simplificación. Referencia principal: `src/engine/phases/phase1-intake.ts`.
- `P2` El engine mezcla orchestration con bootstrap operativo.
  `initEngine()` no solo inicializa el pipeline; también registra hooks, carga proactive config, registra tools proactivos, inicializa checkpoints, programa cleanup con `setInterval` y arranca el proactive runner. Es demasiado para un solo orquestador. Referencias: `src/engine/engine.ts:43-128`.
- `P2` Checkpoints conservan semántica vieja.
  El comentario y la estrategia de reanudación siguen hablando de steps completados y Phase 3, pero la reanudación actual solo vuelve a procesar el mensaje completo por el pipeline agentic. Eso genera ruido conceptual y puede inducir mantenimiento equivocado. Referencias: `src/engine/engine.ts:598-672`.
- `P2` `phase5-validate.ts` mezcla demasiados concerns.
  Validación/sanitización, rate limiting, envío de texto/audio, retries, persistencia, cambio de estado del lead, campaign logging, proactive guards y buffer compression viven juntos. Esto dificulta aislar bugs de delivery vs persistencia vs side effects. Referencia principal: `src/engine/phases/phase5-validate.ts`.
- `P3` Superficie documental desalineada.
  `docs/architecture/pipeline.md` todavía describe 5 pasos clásicos con classify/execute/respond, pero la implementación central ya es agentic. Esto aumenta fricción para onboarding y auditoría externa.

### Decisiones propuestas
- Mantener:
  `phase1` como frontera de construcción de contexto y `phase5` como frontera de entrega/persistencia.
- Simplificar:
  Crear un solo runner compartido para agentic reactive/proactive.
- Unificar:
  Una única fuente de config del engine basada en `registry.getConfig('engine')` y servicios derivados.
- Eliminar:
  Tipos, comentarios y campos legacy que ya no representan el flujo real.
- Postergar:
  Reescritura profunda de attachments hasta cerrar primero la simplificación del núcleo reactivo/proactivo.

### Propuestas concretas
- Propuesta A. Crear `runAgenticDeliveryPipeline()` reutilizable.
  Debe encapsular: selección de esfuerzo/modelo, obtención de tools/skills/subagents, build del prompt, `runAgenticLoop`, `postProcess`, `phase5Validate` y `savePipelineLog`. Reactivo y proactivo solo aportarían contexto, guards y bookkeeping específico.
- Propuesta B. Separar `EngineRuntimeConfig` de `EngineLegacyConfig`.
  `src/engine/config.ts` debería dejar de leer env directo para parámetros del módulo. La config viva debe salir del registry o de un provider del módulo `engine`. Luego se puede borrar la duplicación de defaults entre `manifest.ts` y `config.ts`.
- Propuesta C. Corregir el contrato de validación de salida.
  `phase5Validate()` debe trabajar con una estructura mutable segura:
  `validated = sanitizeComposedOutput(composed)` y enviar siempre el resultado saneado. Si hay audio, el texto base que alimenta TTS también debe pasar por el mismo saneamiento.
- Propuesta D. Partir `phase1-intake` en loaders pequeños.
  Sugerencia inicial:
  `resolve-user.ts`, `resolve-contact.ts`, `resolve-session.ts`, `load-knowledge.ts`, `load-memory-context.ts`, `load-attachments.ts`, `build-context-bundle.ts`.
  El objetivo no es “microarchivos por estética”, sino extraer unidades testeables y reemplazables.
- Propuesta E. Partir `phase5-validate` por responsabilidades.
  Separar al menos:
  `validate-output.ts`, `send-delivery.ts`, `persist-conversation.ts`, `post-send-effects.ts`, `rate-limit.ts`.
- Propuesta F. Reducir tipos legacy del engine.
  Mover contratos históricos a `types-legacy.ts` o eliminarlos si no tienen consumidores reales. `PipelineResult` también debería reflejar el flujo actual sin rellenar `phase2/3/4` con ceros salvo donde sea estrictamente necesario por compatibilidad.
- Propuesta G. Convertir bootstrap operativo en subcomponentes.
  `initEngine()` debería coordinar inicializadores pequeños:
  `initRuntime`, `initHooks`, `initCheckpoints`, `initProactive`, `initAttachmentTools`.
- Propuesta H. Completar documentación local del módulo.
  Crear `src/engine/AGENTS.md` y `src/modules/engine/AGENTS.md` con el estado real del engine agentic, no con el pipeline histórico.

### Orden sugerido de ejecución
1. Corregir el bug de saneamiento real en `phase5`.
2. Consolidar el runner agentic compartido entre reactivo y proactivo.
3. Unificar la fuente de config del engine.
4. Extraer loaders de `phase1`.
5. Extraer capas de `phase5`.
6. Limpiar tipos/config/documentación legacy.

### Verificación
- Tests ejecutados:
  `npm test`
- Resultado:
  Suite parcialmente exitosa.
  12 archivos de test pasaron, 1 suite falló.
  157 tests pasaron.
  La falla actual está en `tests/engine/checkpoint-phase3.test.ts` porque importa `src/engine/phases/phase3-execute.js`, archivo que ya no existe.
  Esto confirma una deuda concreta de legado: el suite todavía referencia el pipeline viejo de Phase 3 mientras el engine productivo ya opera sobre flujo agentic.
- Riesgos residuales:
  Falta verificar si algunas flags “huérfanas” sí están conectadas desde archivos no auditados aún, especialmente runners y utilidades periféricas.

### Resultado de tests
- Comando: `npm test`
- Estado general: `FAILED`
- Resumen:
  `Test Files  1 failed | 12 passed (13)`
  `Tests  157 passed (157)`
- Falla detectada:
  `tests/engine/checkpoint-phase3.test.ts`
  Motivo: `Cannot find module '../../src/engine/phases/phase3-execute.js'`
- Lectura de auditoría:
  No parece un bug nuevo del runtime actual, sino una prueba huérfana de una arquitectura previa que ya no coincide con el engine vigente.

### Preguntas abiertas para decidir contigo
- ¿Quieres que el objetivo del engine sea un flujo agentic único y oficial, dejando el modelo “5 fases” solo como compatibilidad mínima, o prefieres preservar esa narrativa y mantener wrappers legacy?
- En mensajes proactivos, ¿quieres que compartan exactamente el mismo runner del flujo reactivo con solo un `mode: proactive`, o te interesa mantener una variante separada por claridad operativa aunque tenga algo más de código?
- Cuando saneemos salida antes de enviar, ¿prefieres política estricta “si hay leakage bloqueamos y regeneramos” o política pragmática “sanear y continuar”?

### Cambios aplicados
- Se agregó esta auditoría al documento vivo.

### Actualización de ejecución
- Se extrajo la sanitización compartida a `src/engine/output-sanitizer.ts`.
- `post-processor.ts` ahora sanea texto antes de format/TTS como defensa en profundidad.
- `phase5-validate.ts` ya sanea las `formattedParts` que realmente se envían, registra `output_leakage` y bloquea audio con leakage para caer a texto limpio.
- Se creó `src/engine/agentic/run-agentic-delivery.ts` para compartir el runner agentic entre reactivo y proactivo.
- `src/engine/config.ts` migró a `registry.getConfig('engine')` los campos propios del módulo engine que estaban duplicados con env vars.
- Se limpiaron tipos y campos legacy en `src/engine/types.ts`, `src/engine/index.ts` y `src/modules/engine/manifest.ts`.
- Se eliminó la prueba huérfana `tests/engine/checkpoint-phase3.test.ts`.
- Se actualizó la documentación base en `src/engine/CLAUDE.md` y `docs/architecture/pipeline.md`.

### Verificación final de esta ronda
- Tests ejecutados:
  `npx tsc --noEmit`
  `npm test`
- Resultado:
  Compilación TypeScript limpia.
  `Test Files  12 passed (12)`
  `Tests  157 passed (157)`
- Riesgos residuales:
  La nomenclatura `phase1` y `phase5` sigue viva aunque el engine real ya es agentic.
  `phase1-intake.ts` y `phase5-validate.ts` siguen demasiado grandes para la siguiente ronda de simplificación.
  `src/engine/config.ts` todavía conserva parte de config global legacy por env vars; la unificación quedó avanzada, no completa.

### Cierre final del engine
- Se renombró `src/engine/phases/` a `src/engine/boundaries/`.
- `phase1-intake.ts` pasó a `src/engine/boundaries/intake.ts` y su export ahora es `intake()`.
- `phase5-validate.ts` pasó a `src/engine/boundaries/delivery.ts` y su export ahora es `delivery()`.
- `PipelineResult` renombró sus timings a `intakeDurationMs` y `deliveryDurationMs`.
- Los logs de pipeline en memoria también quedaron alineados con `intakeMs` y `deliveryMs`.
- Se migraron a `registry.getConfig('engine')` los campos restantes del módulo: session reopen window, pipeline timeout y checkpoints.
- El grep final sobre `src/engine/**/*.ts` ya no devuelve referencias activas a `phase1`, `phase5` o `phases/`.

### Segunda lectura honesta: complejidad útil vs volumen bruto
- En números crudos, la primera ronda del engine fue sobre todo una reorganización estructural y de seguridad, no una reducción material del volumen total.
- Para empezar a bajar complejidad útil de verdad, el siguiente mejor corte no era crear más helpers sino podar ramas legacy que el runtime actual ya no usa.

### Cambios aplicados en esta pasada de reducción útil
- `src/engine/boundaries/delivery.ts` dejó de arrastrar plumbing de evaluación legacy que ya no participaba en el flujo agentic actual.
- `delivery()` eliminó el parámetro `evaluation` y el `run-agentic-delivery.ts` quedó alineado con ese contrato real.
- Se retiraron side-effects ligados a `intent`, `emotion` y objection tracking que dependían de esa evaluación legacy.
- Se compactó el fallback repetido de audio a texto en un helper único para reducir ramas duplicadas sin cambiar comportamiento.
- `src/engine/boundaries/intake.ts` eliminó estado temporal huérfano de attachments que ya no afectaba el contexto final.

### Verificación de esta pasada
- Tests ejecutados:
  `npx tsc --noEmit`
  `npm test`
- Resultado:
  Compilación TypeScript limpia.
  `Test Files  12 passed (12)`
  `Tests  157 passed (157)`
- Diff neto de esta pasada:
  `27 insertions, 57 deletions`
  Balance neto: `-30` líneas en el corte aplicado.

### Conclusión honesta sobre reducción de complejidad
- Sí hubo reducción de complejidad útil en `delivery`: menos contrato muerto, menos ramas duplicadas, menos semántica legacy escondida.
- No, todavía no es la reducción material que cambiaría el peso total del engine.
- El siguiente bloque que realmente puede mover la aguja es `src/engine/boundaries/intake.ts`; fuera de eso, lo demás ya empieza a dar rendimientos mucho menores por riesgo similar.
