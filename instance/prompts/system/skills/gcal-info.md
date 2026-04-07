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
