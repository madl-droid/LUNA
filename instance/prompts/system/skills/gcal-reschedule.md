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
