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
