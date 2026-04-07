# Plan 3: Subagent de Agendamiento + Skills

**Branch:** `feat/gcal-plan3-subagent` (derivado de `claude/plan-google-calendar-W94gU`)
**Depende de:** Plan 1 + Plan 2 completados
**Paralelo con:** Plan 4

---

## Objetivo

Crear un subagent especializado en agendamiento via Google Calendar, con detección de escenarios y skills por escenario (patrón medilink). Incluye: migration SQL para seed del subagent, 5 skill files, tool de contexto de scheduling, activación/desactivación en manifest.

---

## Patrón de referencia

Seguir exactamente el patrón de medilink:
- `src/migrations/032_medilink-scheduler-subagent.sql` — seed del subagent
- `src/migrations/033_medilink-skills-subagent.sql` — actualización con skills
- `instance/prompts/system/skills/medilink-*.md` — skills por escenario
- `src/modules/medilink/manifest.ts` lines 605-659 — enable/disable en init/stop

---

## Archivos a crear

### `src/migrations/046_gcal-scheduler-subagent.sql`

```sql
-- Google Calendar Scheduler Subagent
INSERT INTO subagent_types (
  slug, name, description, enabled, model_tier, token_budget,
  verify_result, can_spawn_children, is_system, google_search_grounding,
  allowed_tools, system_prompt
) VALUES (
  'google-calendar-scheduler',
  'Agendamiento Google Calendar',
  'Subagente especializado en agendar, reagendar, cancelar y consultar citas via Google Calendar. Usa skills por escenario.',
  false,
  'normal',
  75000,
  true,
  false,
  false,
  false,
  '{calendar-list-events,calendar-get-event,calendar-create-event,calendar-update-event,calendar-delete-event,calendar-add-attendees,calendar-list-calendars,calendar-check-availability,calendar-get-scheduling-context,skill_read}',
  E'Eres el subagente de agendamiento de Google Calendar de Luna.\n\n## Tu rol\nGestionas citas en Google Calendar: agendar nuevas, reagendar, cancelar, consultar disponibilidad y consultar citas existentes.\n\n## PRIMERA ACCIÓN OBLIGATORIA\nAntes de cualquier otra cosa, llama la herramienta `calendar-get-scheduling-context` para obtener:\n- Configuración general (duración, nombre de cita, Meet, etc.)\n- Roles y coworkers habilitados con sus instrucciones\n- Días no laborables\n- Horario laboral\n\nEsta información es ESENCIAL para todas tus acciones.\n\n## Escenarios y skills\n\n| Escenario | Skill a leer |\n|-----------|-------------|\n| Agendar cita nueva | gcal-new-appointment |\n| Reagendar cita existente | gcal-reschedule |\n| Cancelar cita | gcal-cancel |\n| Consultar disponibilidad | gcal-check-availability |\n| Consultar citas existentes | gcal-info |\n\n## Cómo identificar el escenario\n1. Si el contexto dice \"reagendar\", \"mover\", \"cambiar cita\", \"cambiar fecha\" → gcal-reschedule\n2. Si dice \"cancelar\", \"anular\", \"no voy a ir\", \"no puedo asistir\" → gcal-cancel\n3. Si pregunta info (\"¿cuándo es mi cita?\", \"¿qué reuniones tengo?\", \"¿tengo algo agendado?\") → gcal-info\n4. Si solo quiere ver disponibilidad sin agendar aún → gcal-check-availability\n5. Si quiere agendar una cita nueva → gcal-new-appointment\n\n## Protocolo OBLIGATORIO\n1. Llama `calendar-get-scheduling-context` (si no lo has hecho)\n2. Identifica el escenario del contacto\n3. Lee las instrucciones del skill correspondiente con `skill_read`\n4. Sigue las instrucciones AL PIE DE LA LETRA — no improvises\n5. NUNCA agendes fuera del horario laboral ni en días off\n6. NUNCA agendes sin verificar disponibilidad primero\n\n## Reglas de asignación de coworker\n- Revisa los roles habilitados y sus instrucciones\n- Revisa los coworkers habilitados y sus instrucciones específicas\n- Si un coworker tiene instrucción específica que matchea al cliente → asignar ese coworker\n- Si ninguna instrucción específica aplica → round robin entre los habilitados del rol\n- SIEMPRE verifica disponibilidad del coworker antes de agendar\n\n## Formato del nombre de cita\nUsa: \"{eventNamePrefix} - {nombre del cliente} {empresa si la hay}\"\nEjemplo: \"Reunión - Juan Pérez - Acme Corp\"'
) ON CONFLICT (slug) DO UPDATE SET
  allowed_tools = EXCLUDED.allowed_tools,
  system_prompt = EXCLUDED.system_prompt,
  description = EXCLUDED.description,
  token_budget = EXCLUDED.token_budget,
  verify_result = EXCLUDED.verify_result,
  updated_at = now();
```

---

### `instance/prompts/system/skills/gcal-new-appointment.md`

```markdown
<!-- description: Protocolo para agendar una cita nueva en Google Calendar -->
<!-- userTypes: lead,unknown -->
<!-- requiredTools: calendar-create-event,calendar-check-availability -->

# Agendar Cita Nueva en Google Calendar

## Contexto previo requerido
Ya debes haber llamado `calendar-get-scheduling-context` y tener la configuración cargada.

## Pasos obligatorios (en orden estricto)

### Paso 1: Recopilar información del cliente
- Pregunta la fecha y hora deseada
- Si no tiene preferencia clara → proponer 2-3 opciones de horarios disponibles
- Si menciona "mañana", "la próxima semana", etc. → calcular la fecha concreta

### Paso 2: Seleccionar coworker
Consulta la configuración de scheduling que obtuviste:
1. Revisa los **roles habilitados** y lee sus instrucciones
2. Revisa los **coworkers habilitados** dentro de cada rol
3. **Prioridad de asignación:**
   a. Si un coworker tiene instrucciones específicas que matchean al cliente (ej: "clientes en Brasil" y el cliente es de Brasil) → asignar ese coworker
   b. Si hay instrucciones de rol que matchean (ej: "clientes fuera del país") → elegir un coworker de ese rol
   c. Si no hay match específico → round robin entre los coworkers habilitados
4. Si solo hay un coworker habilitado → usar ese directamente

### Paso 3: Verificar disponibilidad
- Usa `calendar-check-availability` con:
  - `date`: la fecha solicitada (YYYY-MM-DD)
  - `emails`: [email del coworker seleccionado]
  - `durationMinutes`: la duración de la config (defaultDurationMinutes)
- **Si la fecha es día off o no laboral:** explicar al cliente y proponer el siguiente día hábil
- **Si el horario pedido está ocupado:** mostrar los slots libres disponibles y dejar que el cliente elija
- **Si no hay slots libres ese día:** proponer los próximos 2-3 días con disponibilidad

### Paso 4: Confirmar con el cliente
Antes de crear, mostrar resumen:
- Fecha y hora
- Duración
- Con quién será la reunión (nombre del coworker)
- Si incluye Google Meet
Esperar confirmación explícita ("sí", "dale", "perfecto", etc.)

### Paso 5: Crear el evento
Usa `calendar-create-event` con:
- `summary`: "{eventNamePrefix} - {nombre del cliente} {empresa si la hay}"
- `startDateTime`: ISO del horario confirmado
- `durationMinutes`: según config
- `attendees`: [email del coworker, email del cliente si lo tienes]
- `description`: seguir las instrucciones de `descriptionInstructions` de la config
- NO usar `force: true` — si hay conflicto, informar y buscar alternativa

### Paso 6: Confirmar al cliente
Informar:
- Fecha y hora confirmada
- Link de Google Meet (si aplica)
- Con quién es la reunión
- "Te llegará una invitación al correo" (si tiene email)

## Reglas inquebrantables
- NUNCA agendar fuera del horario laboral
- NUNCA agendar en días off
- NUNCA agendar sin verificar disponibilidad primero
- NUNCA agendar sin confirmación del cliente
- SIEMPRE respetar las instrucciones específicas de asignación de coworkers
```

---

### `instance/prompts/system/skills/gcal-reschedule.md`

```markdown
<!-- description: Protocolo para reagendar una cita existente en Google Calendar -->
<!-- userTypes: lead,unknown,coworker -->
<!-- requiredTools: calendar-list-events,calendar-update-event,calendar-check-availability -->

# Reagendar Cita en Google Calendar

## Pasos obligatorios

### Paso 1: Identificar la cita
- Si el cliente dice cuál cita → usar `calendar-get-event` con el ID
- Si no especifica → usar `calendar-list-events` para buscar citas próximas del cliente
- Si hay múltiples citas → preguntar cuál quiere reagendar

### Paso 2: Obtener nueva fecha/hora
- Preguntar cuándo prefiere la nueva cita
- Si no tiene preferencia → proponer opciones disponibles

### Paso 3: Verificar disponibilidad
- Usar `calendar-check-availability` con la nueva fecha y los emails de TODOS los attendees actuales
- Si no hay disponibilidad → proponer alternativas

### Paso 4: Confirmar
- Mostrar: fecha anterior → fecha nueva, mismos participantes
- Esperar confirmación

### Paso 5: Actualizar
- Usar `calendar-update-event` con el eventId y las nuevas fechas
- Los attendees reciben notificación automática del cambio

### Paso 6: Confirmar al cliente
- Informar la nueva fecha/hora
- Mencionar que los participantes fueron notificados

## Reglas
- NUNCA reagendar fuera del horario laboral ni días off
- SIEMPRE verificar disponibilidad de TODOS los attendees
- SIEMPRE confirmar antes de ejecutar el cambio
```

---

### `instance/prompts/system/skills/gcal-cancel.md`

```markdown
<!-- description: Protocolo para cancelar una cita en Google Calendar -->
<!-- userTypes: lead,unknown,coworker -->
<!-- requiredTools: calendar-list-events,calendar-delete-event -->

# Cancelar Cita en Google Calendar

## Pasos obligatorios

### Paso 1: Identificar la cita
- Si el cliente dice cuál → buscar con `calendar-list-events` o `calendar-get-event`
- Si no especifica → listar citas próximas y preguntar cuál

### Paso 2: Confirmar cancelación
- Mostrar detalles de la cita (fecha, hora, participantes)
- Preguntar: "¿Estás seguro de que quieres cancelar esta cita?"
- Esperar confirmación explícita

### Paso 3: Cancelar
- Usar `calendar-delete-event` con el eventId
- `notifyAttendees: true` (siempre notificar)

### Paso 4: Post-cancelación
- Confirmar que la cita fue cancelada
- Preguntar: "¿Te gustaría agendar para otra fecha?"
- Si dice que sí → seguir skill gcal-new-appointment

## Reglas
- NUNCA cancelar sin confirmación explícita del cliente
- SIEMPRE notificar a los asistentes
```

---

### `instance/prompts/system/skills/gcal-check-availability.md`

```markdown
<!-- description: Protocolo para consultar disponibilidad de calendario -->
<!-- userTypes: lead,unknown,coworker,admin -->
<!-- requiredTools: calendar-check-availability -->

# Consultar Disponibilidad

## Pasos

### Paso 1: Determinar parámetros
- ¿Qué fecha(s) quiere consultar?
- ¿Con quién necesita reunirse? (si no especifica, consultar el equipo habilitado)
- Si no especifica fecha → consultar hoy y mañana

### Paso 2: Validar fecha
- Verificar que no sea día off ni día no laboral
- Si es no laboral → informar y consultar el siguiente día hábil

### Paso 3: Consultar
- Usar `calendar-check-availability` con:
  - `date`: la fecha a consultar
  - `emails`: emails de los coworkers relevantes
  - `durationMinutes`: según config o lo que pida el cliente

### Paso 4: Presentar resultados
- Listar slots libres de forma clara y legible
- Si hay personas ocupadas en algún horario, mencionarlo
- Si no hay slots libres → sugerir otro día

### Paso 5: Siguiente paso
- Preguntar si quiere agendar en alguno de los slots disponibles
```

---

### `instance/prompts/system/skills/gcal-info.md`

```markdown
<!-- description: Protocolo para consultar citas existentes en Google Calendar -->
<!-- userTypes: lead,unknown,coworker,admin -->
<!-- requiredTools: calendar-list-events,calendar-get-event -->

# Consultar Citas Existentes

## Pasos

### Paso 1: Determinar qué buscar
- "¿Qué reuniones tengo?" → listar citas próximas (hoy + próximos 7 días)
- "¿Cuándo es mi cita con X?" → buscar por query
- "Dame detalles de mi cita del jueves" → buscar por fecha

### Paso 2: Buscar
- Usar `calendar-list-events` con:
  - `timeMin`/`timeMax` según el rango relevante
  - `query` si busca algo específico
- Si necesita detalle de una cita específica → `calendar-get-event`

### Paso 3: Presentar
- Listar citas de forma clara: fecha, hora, título, con quién, Meet link
- Si no hay citas: informar

### Paso 4: Ofrecer acciones
- "¿Te gustaría reagendar o cancelar alguna?"
- "¿Quieres agendar una nueva cita?"
```

---

## Archivos a modificar

### `src/modules/google-apps/tools.ts`

**NUEVO tool `calendar-get-scheduling-context`:**

Este tool es clave — le da al subagent toda la info de configuración que necesita para tomar decisiones de asignación.

```typescript
{
  name: 'calendar-get-scheduling-context',
  displayName: 'Obtener contexto de agendamiento',
  description: 'Obtiene la configuración completa de agendamiento: roles habilitados, coworkers disponibles con instrucciones, días off, horario laboral, y configuración general.',
  category: 'calendar',
  sourceModule: 'google-apps',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const calConfig = getCalendarConfig(registry)
    const bh = getBusinessHours(registry)
    const usersDb = registry.getOptional<UsersDb>('users:db')

    // Obtener coworkers habilitados agrupados por rol
    const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
    const enabledRoles: Array<{
      role: string
      instructions: string
      coworkers: Array<{ name: string; email: string; instructions: string }>
    }> = []

    for (const [roleName, roleConfig] of Object.entries(calConfig.schedulingRoles)) {
      if (!roleConfig.enabled) continue

      const roleCoworkers = allCoworkers
        .filter((u: any) => (u.metadata as any)?.role === roleName)
        .filter((u: any) => {
          const cwConfig = calConfig.schedulingCoworkers[u.id]
          return cwConfig ? cwConfig.enabled !== false : true // default enabled
        })
        .map((u: any) => {
          const email = u.contacts?.find((c: any) => c.channel === 'email')?.senderId ?? ''
          const cwConfig = calConfig.schedulingCoworkers[u.id]
          return {
            name: u.displayName ?? u.id,
            email,
            instructions: cwConfig?.instructions ?? '',
          }
        })

      enabledRoles.push({
        role: roleName,
        instructions: roleConfig.instructions,
        coworkers: roleCoworkers,
      })
    }

    // Formatear output legible
    let output = `## Configuración de agendamiento\n`
    output += `- Google Meet: ${calConfig.meetEnabled ? 'habilitado' : 'deshabilitado'}\n`
    output += `- Duración default: ${calConfig.defaultDurationMinutes} min\n`
    output += `- Nombre de cita: "${calConfig.eventNamePrefix} - [nombre cliente] [empresa]"\n`
    if (calConfig.descriptionInstructions) {
      output += `- Instrucciones para descripción: ${calConfig.descriptionInstructions}\n`
    }

    if (bh) {
      const dayNames = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
      const days = bh.days.map(d => dayNames[d] ?? d).join(', ')
      output += `\n## Horario laboral\n`
      output += `- Horas: ${bh.start}:00 a ${bh.end}:00\n`
      output += `- Días: ${days}\n`
    }

    if (calConfig.daysOff.length > 0) {
      output += `\n## Días no laborables\n`
      for (const d of calConfig.daysOff) {
        if (d.type === 'single') output += `- ${d.date}\n`
        else output += `- ${d.start} al ${d.end}\n`
      }
    }

    if (enabledRoles.length > 0) {
      output += `\n## Roles habilitados para agendamiento\n`
      for (const role of enabledRoles) {
        output += `\n### Rol: ${role.role}\n`
        if (role.instructions) output += `Instrucciones: ${role.instructions}\n`
        output += `Coworkers:\n`
        if (role.coworkers.length === 0) {
          output += `  (ninguno asignado a este rol)\n`
        }
        for (const cw of role.coworkers) {
          output += `  - ${cw.name} (${cw.email})`
          if (cw.instructions) output += ` — INSTRUCCIÓN: ${cw.instructions}`
          output += `\n`
        }
      }
    } else {
      output += `\n## Equipo\nNo hay roles habilitados para agendamiento.\n`
    }

    return { success: true, data: output }
  },
}
```

**Agregar `calendar-get-scheduling-context` a la lista de tools registrados cuando calendar está enabled.**

---

### `src/modules/google-apps/manifest.ts`

**En `init()` — habilitar subagent:**

```typescript
// Después de inicializar calendar service y config
if (enabledServices.has('calendar')) {
  try {
    await db.query(
      `UPDATE subagent_types SET enabled = true, updated_at = now() WHERE slug = 'google-calendar-scheduler'`
    )
    const saCatalog = registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
    await saCatalog?.reload()
    log.info('Google Calendar scheduler subagent enabled')
  } catch (err) {
    log.warn({ err }, 'Could not enable calendar scheduler subagent')
  }
}
```

**En `stop()` — deshabilitar subagent:**

```typescript
try {
  await db.query(
    `UPDATE subagent_types SET enabled = false, updated_at = now() WHERE slug = 'google-calendar-scheduler'`
  )
  const saCatalog = registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
  await saCatalog?.reload()
} catch (err) {
  log.warn({ err }, 'Could not disable calendar scheduler subagent')
}
```

---

## Flujo completo de ejemplo

1. **Cliente:** "Quiero agendar una reunión"
2. **Main LLM (Phase 2):** Detecta intención de agendamiento → `run_subagent(slug="google-calendar-scheduler", task="El usuario quiere agendar una reunión")`
3. **Subagent inicia:**
   - Llama `calendar-get-scheduling-context` → obtiene config completa
   - Lee system prompt → identifica escenario = "nueva cita"
   - Llama `skill_read("gcal-new-appointment")` → obtiene protocolo completo
4. **Subagent ejecuta skill:**
   - Pregunta fecha/hora al cliente
   - Selecciona coworker según instrucciones
   - Llama `calendar-check-availability(date, emails, duration)`
   - Confirma con cliente
   - Llama `calendar-create-event(...)` → evento creado con Meet
5. **Verificador** evalúa: "¿Se creó la cita correctamente?" → accept
6. **Main LLM** recibe resultado, compone respuesta final al cliente

---

## Criterios de aceptación

- [ ] Migración 046 se aplica sin errores (INSERT en subagent_types)
- [ ] ON CONFLICT actualiza si ya existe
- [ ] Subagent `google-calendar-scheduler` aparece en BD
- [ ] Subagent se habilita automáticamente cuando calendar está enabled en google-apps
- [ ] Subagent se deshabilita al parar google-apps o al desactivar calendar
- [ ] 5 skill files creados en `instance/prompts/system/skills/`
- [ ] Skills tienen frontmatter correcto (description, userTypes, requiredTools)
- [ ] Tool `calendar-get-scheduling-context` retorna config formateada legible
- [ ] Tool `calendar-get-scheduling-context` está en allowed_tools del subagent
- [ ] El main LLM puede delegar al subagent via `run_subagent`
- [ ] El subagent puede leer skills via `skill_read`
- [ ] TypeScript compila sin errores

---

## Notas para el ejecutor

- **Leer `src/migrations/032_medilink-scheduler-subagent.sql`** como referencia exacta del formato SQL
- **Leer `instance/prompts/system/skills/medilink-lead-scheduling.md`** como referencia del formato de skills
- **El system prompt en SQL debe usar `E'...'`** para escapar newlines
- **ON CONFLICT** es importante para idempotencia — la migración puede correr múltiples veces
- **allowed_tools** debe incluir `skill_read` (meta-tool para leer skills)
- **allowed_tools** debe incluir `calendar-get-scheduling-context` (nuevo tool de contexto)
- **Verificar que el schema de `subagent_types`** tiene todas las columnas usadas (revisar migraciones 013 y 018)
