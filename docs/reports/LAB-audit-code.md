# INFORME DE AUDITORIA — Lab: Pruebas E2E con Contactos Reales (Codigo)

**Fecha:** 2026-04-07
**Instancia:** lab (staging)
**Contactos evaluados:** 4 (🎬❤️🎄, Cristian Marin, 𝓢𝓽𝓮𝓯𝓪𝓷𝓲𝓪 🌙, Miguel Diaz OneScreen)
**Mensajes totales:** 108 (54 user + 54 assistant)
**Sesiones:** 4 activas, 0 cerradas

---

## SECCION 1 — BUGS DETECTADOS

### BUG-01: Tool call expuesto como texto al usuario [CRITICO]

**Contacto:** 🎬❤️🎄
**Evidencia:** El mensaje #6 del asistente contiene: `[Tool call: sheets-read({"spreadsheetId":"1eAOr2...","range":"I:L"})]` visible al contacto como texto plano.
**Impacto:** El usuario vio la invocacion de la herramienta en lugar de recibir el precio. La conversacion murio ahi.
**Causa probable:** El post-processor o el delivery no esta limpiando tool call markers del texto final antes de enviar. Posible race condition donde el LLM emite texto con tool call inline y el parser no lo intercepta.
**Sugerencia:** Revisar `post-processor.js` — agregar un sanitizer regex que limpie patrones `[Tool call: ...]` del output final antes de delivery. Tambien verificar que el agentic loop no este mezclando tool_use content blocks con text content blocks.

---

### BUG-02: Criticizer nunca aprueba — 0% tasa de aprobacion [CRITICO]

**Evidencia:** 24 de 24 reviews generaron feedback (0 aprobaciones). Modelo: `gemini-3.1-pro-preview`.
**Impacto:** Cada pipeline que activa el criticizer gasta ~17 segundos extra (9.5s review + 7.9s rewrite) sin garantia de mejora. Peor: la reescritura puede cambiar informacion correcta o alterar el tono.
**Causa raiz:** El prompt del criticizer tiene 10 puntos de evaluacion subjetivos. `gemini-3.1-pro-preview` siempre encuentra algo que criticar en al menos 1 de los 10 puntos.
**Sugerencia:**
1. Cambiar `LLM_CRITICIZER_MODE` a `disabled` temporalmente hasta ajustar
2. Ajustar el prompt del criticizer para que solo rechace respuestas con errores facticos o de tono graves (no estilísticos)
3. Considerar cambiar el modelo de critica a uno menos agresivo
4. Agregar metrica de tasa de aprobacion para monitoreo

---

### BUG-03: Knowledge search no filtra por categoria de contacto [CRITICO]

**Contacto:** Cristian Marin (lead, solo deberia ver Teff)
**Evidencia:** 4 de 8 busquedas usaron `category_hint: "OneScreen"` y todas devolvieron contenido del portafolio OneScreen sin restriccion. La tabla `tool_access_rules` esta vacia.
**Causa raiz:** `KnowledgeSearchEngine.search()` usa `category_hint` como boost (+0.2 al score) pero **nunca excluye** resultados de otras categorias. No hay mapeo `contact_type -> allowed_categories`.
**Impacto:** Los leads de la clinica reciben informacion comercial de pantallas. Fuga de informacion entre lineas de negocio.
**Sugerencia:**
1. Crear mapeo `contact_type -> allowed_knowledge_categories` (en config o en tabla)
2. Modificar `search_knowledge` handler en `manifest.js` para inyectar filtro basado en tipo de contacto
3. Modificar `search-engine.js` para aceptar parametro `allowedCategoryIds` que **excluya** (no solo booste) resultados

---

### BUG-04: Alucinacion de URLs inexistentes [CRITICO]

**Contacto:** Cristian Marin
**Evidencia:** Luna compartio `https://onescreenlatam.com/.../Catalogo-OneScreen-TapSpace.pdf`. El producto "TapSpace" no existe. La URL es fabricada.
**Causa raiz:** El LLM aprendio el patron de URLs reales (`Catalogo-OneScreen-[producto].pdf`) y extrapolo con un nombre plausible pero inexistente.
**Impacto:** Confianza del cliente destruida al recibir links rotos.
**Sugerencia:**
1. Agregar guardrail en el prompt: "NUNCA compartas URLs que no provengan literalmente del resultado de una herramienta. Si no encontraste la URL exacta, di que la vas a buscar."
2. Considerar un post-processor que valide URLs contra la KB antes de enviar
3. Evaluar agregar las URLs reales de catalogos como campos `shareable_url` en los knowledge documents

---

### BUG-05: Alucinacion de composicion de paquetes [ALTO]

**Contacto:** Miguel Diaz (OneScreen)
**Evidencia:** Luna dijo que los paquetes Esencial y Avanzado incluyen radiofrecuencia. Segun los datos del sheet, **solo Premium** incluye radiofrecuencia. Esencial tiene peeling quimico y Avanzado tiene laser facial.
**Causa raiz:** El LLM interpreto mal los datos del sheet o generalizo incorrectamente al ver que la pregunta era sobre radiofrecuencia.
**Impacto:** Cliente paga paquete Esencial esperando radiofrecuencia y no la recibe. Problema legal/comercial.
**Sugerencia:** Mejorar el formato de los datos en el sheet para que sean inequivocos, o agregar un knowledge doc con la composicion exacta de cada paquete.

---

### BUG-06: sheets-read falla en primer intento (3/4 contactos) [MEDIO]

**Evidencia:** El LLM asume nombres de rango como `Sheet1!A1:Z100`, `Sheet1!A:D`, `Sheet1!A1:L30` que fallan con "Unable to parse range". Se recupera llamando `sheets-info` + retry.
**Impacto:** Latencia adicional de ~1-2s por retry. Gasto de tokens innecesario.
**Sugerencia:**
1. Hacer que `sheets-read` llame internamente a `sheets-info` si el rango falla (auto-recovery transparente)
2. O mejor: forzar al LLM a llamar `sheets-info` primero mediante instruccion en la tool description
3. O: el primer llamado sin rango deberia devolver la metadata del sheet + preview de los primeros datos

---

### BUG-07: medilink-search-patient no se ejecuta al recibir documento [MEDIO]

**Contacto:** Miguel Diaz (OneScreen)
**Evidencia:** Miguel dio su cedula (`1233901759`), pero el bot siguio pidiendo email como si fuera paciente nuevo. Solo busco por documento DESPUES de que Miguel se nego a dar el correo.
**Causa raiz:** El prompt `medilink-lead-scheduling.md` sigue el flujo secuencial de lead nuevo (nombre -> documento -> email -> crear) sin verificar si el documento ya existe en el sistema.
**Impacto:** Friccion innecesaria, pide datos que ya tiene el sistema.
**Sugerencia:** Agregar regla explicita en el prompt: "Cuando el lead proporcione un numero de documento, ejecutar `medilink-search-patient` con ese documento ANTES de seguir pidiendo datos. Si lo encuentra, tratar como paciente conocido y saltar a agendar."

---

### BUG-08: HITL no incluye datos de contacto [MEDIO]

**Evidencia:** Las notificaciones HITL al operador solo contienen Type, Summary y Client message. No incluyen nombre, telefono ni tipo de contacto.
**Impacto:** El operador no puede identificar al cliente. Cuando llegaron 2 tickets similares de "direccion" (Cristian y Stefania), el operador los confundio y respondio al ticket de Cristian citando la notificacion de Stefania.
**Sugerencia:**
1. Incluir en la notificacion HITL: `display_name`, `phone`, `contact_type`
2. Agregar un ID corto de ticket legible (ej: `#HITL-042`) para diferenciar tickets
3. Formato sugerido:
```
*HITL -- Coworker Request*
Contacto: Cristian Marin (+573171429276) [lead]
Ticket: #HITL-042
Type: domain_help
Summary: Pregunta por la direccion de la sede
```

---

### BUG-09: Bot entra en loop pidiendo datos (7+ mensajes identicos) [ALTO]

**Contacto:** 𝓢𝓽𝓮𝓯𝓪𝓷𝓲𝓪 🌙
**Evidencia:** Entre 21:00 y 21:07, el bot envio 7 mensajes casi identicos pidiendo nombre/documento/correo. La usuaria intentaba explicar una situacion compleja (3 personas, 2 citas, menor de edad) y el bot no entendia.
**Causa raiz:** El skill de scheduling tiene un flujo rigido de recoleccion de datos que no maneja bien los casos complejos (multiples pacientes, intermediarios, cambios de contexto).
**Impacto:** Experiencia frustrante, cita nunca agendada despues de 71 minutos.
**Sugerencia:**
1. Agregar deteccion de repeticion en el post-processor: si la respuesta es >80% similar a la anterior, forzar una reformulacion o escalar
2. Agregar al prompt del skill de scheduling: "Si el usuario no responde directamente a tu pregunta, es probable que este intentando explicar una situacion compleja. Para, escucha, y resume lo que entiendes antes de seguir pidiendo datos."
3. Implementar un max_retry de 3 para la misma pregunta antes de escalar a HITL

---

### BUG-10: Contradiccion de identidad (distribuidor vs marca) [MEDIO]

**Contacto:** Cristian Marin
**Evidencia:** Mensaje 7: "Teff Studio somos el distribuidor oficial de OneScreen". Mensaje 18: "Nosotros somos directamente la marca OneScreen".
**Causa raiz:** Contexto largo + multiples tool calls hacen que el LLM pierda coherencia con afirmaciones previas.
**Sugerencia:** Agregar en el knowledge de OneScreen: "IMPORTANTE: Teff Studio es DISTRIBUIDOR OFICIAL de OneScreen, NO es la marca. Nunca decir que somos OneScreen directamente."

---

### BUG-11: Perdida de contexto en rafagas de mensajes [MEDIO]

**Contacto:** Cristian Marin
**Evidencia:** Cristian envio 3 mensajes corrigiendo salas (3 -> 5 -> 1). El bot respondio a cada uno por separado: "3 salas, perfecto!" y "5 salas, mejor aun!" cuando el usuario ya habia dicho 1.
**Causa raiz:** Cada mensaje del usuario dispara un pipeline independiente. No hay debounce ni agrupacion de mensajes rapidos.
**Sugerencia:**
1. Implementar debounce de mensajes entrantes (esperar 3-5s despues del ultimo mensaje antes de procesar)
2. O agrupar mensajes del mismo contacto que llegan dentro de una ventana de N segundos

---

### BUG-12: Bot repite preguntas ya respondidas [BAJO]

**Contacto:** Cristian Marin
**Evidencia:** Pregunto 3 veces el tipo de organizacion despues de que Cristian ya habia dicho "clinica estetica". Respuesta del usuario: "Clinica estetica ya te dije".
**Causa raiz:** El `extract_qualification` tool se ejecuta multiples veces sin considerar datos ya recolectados, o el LLM no consulta el qualification_data existente.
**Sugerencia:** Verificar que `extract_qualification` reciba los datos ya extraidos para no re-preguntar.

---

### BUG-13: Encoding UTF-8 corrupto en Medilink [BAJO]

**Contacto:** Miguel Diaz (OneScreen)
**Evidencia:** La cita creada tiene `"Primera valoraciÃ³n"` en lugar de `"Primera valoracion"`.
**Causa raiz:** Doble encoding UTF-8 -> Latin1 -> UTF-8 en algun punto de la cadena LLM -> tool -> API.
**Sugerencia:** Revisar el handler de `medilink-create-appointment` para asegurar que el encoding del body sea UTF-8 consistente.

---

### BUG-14: Error de horarios incorrectos [MEDIO]

**Contacto:** 𝓢𝓽𝓮𝓯𝓪𝓷𝓲𝓪 🌙
**Evidencia:** Luna dijo "Las 12pm no esta disponible... lo mas tarde seria en la manana" cuando segundos antes ella misma habia listado horarios de tarde (2:00, 3:30, 4:00, etc.).
**Causa raiz:** El LLM perdio coherencia con su propia respuesta anterior. Posiblemente el resultado de una reescritura del criticizer que altero el contenido.
**Impacto:** Informacion contradictoria directa al cliente.
**Sugerencia:** Evaluar si este tipo de error se correlaciona con reescrituras del criticizer. Si si, es otro argumento para deshabilitarlo.

---

### BUG-15: Pipeline logs no se guardan cuando hay error (FK violation) [ALTO]

**Evidencia:** 17 errores de FK: `Key (message_id)=(xxx) is not present in table "messages"`. Resultado: 0 errores persistidos en la DB.
**Causa raiz:** Cuando el pipeline falla antes de persistir el mensaje, el `pipeline_log` intenta referenciar un `message_id` que nunca se creo.
**Impacto:** Observabilidad de errores completamente rota. No hay forma de ver errores historicos en la DB.
**Sugerencia:** Hacer `message_id` nullable en `pipeline_logs` cuando el pipeline falla antes de crear el mensaje. O insertar el mensaje primero (incluso si el pipeline falla) y luego referenciar.

---

### BUG-16: trace_id NULL en llm_usage [MEDIO]

**Evidencia:** Todos los registros en `llm_usage` tienen `trace_id = NULL`.
**Impacto:** Imposible correlacionar que llamadas LLM pertenecen a que pipeline/contacto.
**Sugerencia:** Verificar que el trace_id del pipeline se propague a todas las llamadas LLM internas.

---

### BUG-17: Metricas vacias en mensajes [BAJO]

**Evidencia:** `intent`, `emotion`, `tokens_used`, `latency_ms`, `model_used` son NULL en los 108 mensajes. `llm_daily_stats` esta vacia.
**Sugerencia:** Verificar que el persistence layer este poblando estos campos post-pipeline.

---

### BUG-18: Rate limit bloquea delivery pero no el procesamiento [ALTO]

**Evidencia:** 38 eventos de rate limit. El sistema procesa el mensaje completo (gastando tokens LLM) y luego descarta la respuesta al encontrar rate limit en delivery.
**Impacto:** Gasto innecesario de tokens/costo sin entregar nada al usuario.
**Sugerencia:** Verificar rate limit **antes** de entrar al agentic loop, no solo en delivery. Si el contacto esta rate-limited, encolar el mensaje en vez de procesarlo y descartarlo.

---

### BUG-19: Contact lock timeouts de 60s [MEDIO]

**Evidencia:** 13 errores de timeout. Cristian: 6, Stefania: 4, Miguel: 3.
**Causa raiz:** Pipelines lentos (hasta 6 min) bloquean el lock del contacto, causando que pipelines posteriores hagan timeout esperando.
**Sugerencia:** Solucionar la latencia raiz (bugs 02, 03). Considerar aumentar el timeout o implementar un sistema de cola que no bloquee.

---

## SECCION 2 — PENDIENTES DE NUESTRO LADO (Skills / Configuracion / Prompts)

### PEND-01: Crear flujo para menores de edad en Medilink

**Evidencia:** Stefania menciono a su hija menor de edad para valoracion de acne. No existe ningun protocolo.
**Que falta:**
- Cero menciones de "menor", "minor", "edad" en todos los prompts
- `medilink-create-patient` no tiene parametros para acudiente ni edad
- No hay flujo definido para registrar menores con responsable legal
**Accion:** Definir en `medilink-lead-scheduling.md`:
  - Detectar si el paciente es menor
  - Pedir datos del acudiente (nombre, documento, parentesco)
  - Registrar al menor con nota de acudiente
  - Informar que el acudiente debe estar presente
  - Usar "Tarjeta de Identidad" como tipo de documento para menores

---

### PEND-02: Ajustar umbrales del effort-router

**Estado actual:** Una solicitud se marca como `complex` si tiene 3+ tool calls (entre otros criterios). Esto activa el criticizer innecesariamente en flujos normales como buscar precio (search_knowledge + sheets-info + sheets-read = 3 tools).
**Accion:** Subir umbral de tool calls de 3 a 5+, o excluir tool calls de knowledge/sheets del conteo.

---

### PEND-03: Configurar knowledge-mandate.md

**Evidencia:** 78 warnings de "System prompt template not found" para `knowledge-mandate.md`.
**Accion:** Verificar que el archivo existe en `/app/instance/prompts/system/knowledge-mandate.md` en la instancia lab y que el path es correcto.

---

### PEND-04: Limpiar columnas legacy de pipeline_logs

**Evidencia:** `phase2_ms`, `phase3_ms`, `phase4_ms` son NULL en 100% de los registros. El pipeline real es intake -> agentic loop -> delivery.
**Accion:** Migracion para eliminar columnas legacy y actualizar comentarios en `engine.js` (linea 99 dice "5-phase pipeline").

---

### PEND-05: Agregar datos de contacto al HITL

**Accion:** Modificar el template de notificacion HITL para incluir `display_name`, `phone`, `contact_type`, y un ID corto de ticket.

---

### PEND-06: Prompt de identidad Teff/OneScreen

**Accion:** Agregar en el knowledge de OneScreen o en un guardrail: "Teff Studio es DISTRIBUIDOR OFICIAL de OneScreen. NUNCA decir que somos la marca."

---

### PEND-07: Guardrail anti-alucinacion de URLs

**Accion:** Agregar en guardrails.md: "NUNCA compartas URLs que no provengan literalmente del resultado de una herramienta o knowledge. Si no encontraste la URL exacta, ofrece buscarla o escalar."

---

### PEND-08: Debounce de mensajes entrantes

**Estado:** No existe agrupacion de mensajes rapidos. Cada mensaje dispara un pipeline independiente.
**Accion:** Evaluar implementar un debounce de 3-5 segundos para mensajes del mismo contacto.

---

### PEND-09: Compresion por tamano de contexto (ademas de turnos)

**Estado actual:** Compresion inline se activa a los 30 turnos. Si los mensajes son muy largos, el contexto puede ser grande sin llegar a 30 turnos.
**Accion:** Agregar un segundo umbral basado en token count estimado (ej: comprimir si el contexto supera X tokens, independientemente del numero de turnos).

---

## SECCION 3 — VERIFICACIONES ADICIONALES PENDIENTES

### VER-01: Correlacion criticizer <-> errores de contenido

Verificar si los bugs de contenido (horarios incorrectos BUG-14, contradiccion de identidad BUG-10) fueron causados por reescrituras del criticizer. Necesita: habilitar trace_id en llm_usage (BUG-16) y comparar respuesta original vs reescrita.

---

### VER-02: Origen de "ay se me cruzaron los cables"

No se encontro en ninguna parte del sistema (DB, prompts, fallbacks, codigo). Posibilidades:
- Generado espontaneamente por el LLM (personalidad "espanol natural latinoamericano")
- En otra instancia/tenant
- En un mensaje bloqueado por rate limit que no se persistio
**Accion:** Monitorear si aparece en futuras conversaciones. Si es recurrente, agregar a la lista de frases prohibidas.

---

### VER-03: Validar que la compresion inline funciona

Ninguna sesion ha llegado a 30 turnos en esta prueba. La proxima prueba deberia incluir una conversacion de 30+ turnos para verificar que la compresion se activa y reduce latencia.

---

### VER-04: Identificar la fuente del polling agresivo a Postgres

3.9 mil millones de commits en 10 dias (~4,500 TPS). Sin `pg_stat_statements` no se puede determinar que queries son. (Ver informe server-side para mas detalle).

---

### VER-05: Alucinacion de duracion de valoracion

Luna dijo "30 a 45 minutos" para la valoracion de parpados. No esta en ningun knowledge ni tool. Verificar si es correcto y, si si, agregarlo al knowledge. Si no, es un dato medico alucinado que puede generar problemas.

---

### VER-06: Gemini TTS caido

22 errores HTTP 500 en `gemini-2.5-pro-preview-tts` y `gemini-2.5-flash-preview-tts`. Ambos modelos devuelven "An internal error has occurred". Verificar si es un outage temporal de Google o un problema de configuracion/credenciales.

---

### VER-07: BullMQ Custom ID con caracteres invalidos

Error: `Custom Id cannot contain :` al crear follow-up para cita 5761 desde webhook medilink. Verificar el formato del job ID en el modulo medilink.

---

### VER-08: SQL errors en queries internas

- `column cc.channel_contact_id does not exist` — deberia ser `channel_identifier`
- `operator does not exist: uuid = character varying` — 4 ocurrencias de comparaciones de tipo incorrectas
**Accion:** Buscar y corregir estas queries.

---

### VER-09: Error LLM "no low surrogate in string"

2 errores de encoding JSON al serializar contenido con caracteres Unicode malformados (emojis o caracteres especiales de los nombres de contacto: 🎬❤️🎄, 𝓢𝓽𝓮𝓯𝓪𝓷𝓲𝓪 🌙). Verificar sanitizacion de inputs antes de enviar al LLM.

---

## METRICAS GLOBALES DE LA PRUEBA

| Metrica | Valor |
|---------|-------|
| Tasa de resolucion exitosa | 1/4 (25%) — solo Miguel completo el flujo |
| Alucinaciones criticas | 5 instancias |
| Alucinaciones moderadas | 4 instancias |
| Tasa de hallucination sobre info factual | ~27% (9/33 mensajes con claims) |
| Latencia mediana | 60 segundos |
| Latencia P90 | 226 segundos (3.8 min) |
| Latencia maxima | 378 segundos (6.3 min) |
| Criticizer tasa de aprobacion | 0% (24/24 rechazados) |
| Rate limit events | 38 |
| Contact lock timeouts | 13 |
| Pipeline log FK errors | 17 |
| HITL tickets creados | 4 |
| HITL tickets resueltos correctamente | 1/4 |
