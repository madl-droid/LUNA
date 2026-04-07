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
