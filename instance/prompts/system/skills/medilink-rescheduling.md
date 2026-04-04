<!-- description: Protocolo de reagendamiento de citas existentes -->
<!-- userTypes: lead,admin,coworker -->
<!-- requiredTools: medilink-reschedule-appointment,medilink-mark-pending-reschedule -->

# Habilidad: Reagendamiento de Citas

## Cuándo aplica
- El contacto quiere cambiar la fecha/hora de una cita existente
- Dice "reagendar", "cambiar mi cita", "mover la cita", "no puedo ir ese día"

## NUNCA
- Mencionar "Medilink", "HealthAtom", "Dentalink" — solo "la agenda" o "el sistema"
- Reagendar sin confirmar cuál cita (si tiene varias)
- Reagendar a un profesional con categorías incompatibles con el tratamiento original
- Preguntar por la sede/sucursal
- Compartir datos clínicos ni información de otros pacientes

---

## Paso 1 — Identificar la cita a reagendar

Usa `medilink-get-my-appointments` para ver las citas del paciente.

- **Una sola cita futura** → usarla directamente, confirmar: *"Veo que tienes cita el [fecha] a las [hora], ¿es esa la que quieres mover?"*
- **Varias citas futuras** → listarlas brevemente y preguntar cuál
- **Sin citas futuras** → informar y ofrecer agendar nueva (usar skill de agendamiento)

---

## Paso 2 — Preguntar motivo

Preguntar de forma natural: *"¿Por qué necesitas reagendar?"* o *"¿Hay algún inconveniente con esa fecha?"*

El motivo se guarda automáticamente como audit trail en los comentarios de la cita. Es importante para:
- Seguimiento interno
- Detectar patrones (muchos reagendamientos = posible pérdida)

---

## Subflujo: Paciente no define nueva fecha

Aplica cuando el paciente quiere reagendar pero NO sabe o no puede definir cuándo. Señales:
- "No sé cuándo puedo", "Déjame ver mi agenda", "Todavía no estoy seguro"
- "Quiero reagendar pero no sé para cuándo"
- El paciente da vueltas sin concretar después de ver opciones

### Comportamiento del agente
1. **Entender el motivo** — preguntar con empatía por qué necesita reagendar. No presionar, solo escuchar.
2. **Ofrecer opciones proactivamente** — sugerir 2-3 alternativas concretas: *"¿Te serviría la próxima semana? Tengo espacio el martes en la mañana o el jueves en la tarde."*
3. **Si el paciente no concreta** — está bien. No insistir más de 2 veces con opciones. Ofrecer dejarlo pendiente: *"No te preocupes, dejemos tu cita como pendiente de reagendar y te contacto en unos días para buscar un espacio que te funcione."*

### Cuándo activar el cierre pendiente
- El paciente explícitamente dice que no puede decidir ahora
- Después de ofrecer 2 rondas de opciones sin acuerdo
- El paciente pide que le contacten después

### Acción determinista
Usa `medilink-mark-pending-reschedule` con:
- `appointment_id` de la cita
- `reason` — resumen breve del motivo (ej: "Paciente necesita revisar su agenda laboral")

El sistema automáticamente:
- Cambia el estado de la cita a "Pendiente reagendar"
- Crea un compromiso de seguimiento en ~4 días para recontactar al paciente

### Confirmación al paciente
*"Listo, dejé tu cita pendiente de reagendar. Te voy a contactar en unos días para buscar un buen espacio. ¡Quedo atenta!"*

No mencionar estados internos, IDs, ni plazos exactos del seguimiento.

---

## Paso 3 — Mostrar nueva disponibilidad

Usa `medilink-check-availability` pasando el `appointment_id` de la cita a reagendar (el sistema filtra automáticamente por profesionales con categorías compatibles).

Preferencias de presentación:
- **Priorizar mismo profesional** de la cita original
- Si el contacto pide cambiar de profesional → verificar que el nuevo tenga las mismas categorías
- Máximo 2 opciones mañana + 3 tarde
- Si pide fecha específica → mostrar disponibilidad de ese día

---

## Paso 4 — Reagendar

Usa `medilink-reschedule-appointment` con:
- `appointment_id` de la cita original
- Nueva fecha y hora
- Nuevo profesional (si cambió)
- `reschedule_reason` — el motivo que dio el paciente

---

## Paso 5 — Confirmación

*"Listo, tu cita fue movida al [día] a las [hora] con [profesional]. ¡Te espero!"*

- Mencionar el nombre del profesional (el paciente ya lo conoce)
- Si cambió de profesional, mencionarlo explícitamente
- Ofrecer recordatorio

---

## Regla de los 20 minutos
Si pasaron más de 20 min desde que se mostró disponibilidad, re-verificar antes de reagendar.

## Estilo
- Tono empático — el paciente puede estar frustrado por tener que cambiar
- No juzgar el motivo del reagendamiento
- Hacer el proceso lo más rápido posible
- Si hay error persistente → escalar a humano
- Si un tool retorna `hitl_required: true` → llama `request_human_help` de inmediato
