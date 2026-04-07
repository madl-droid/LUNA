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
