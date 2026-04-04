<!-- description: Protocolo de cancelación de citas — confirmar, ofrecer reagendar, ejecutar -->
<!-- userTypes: lead,admin,coworker -->
<!-- requiredTools: medilink-reschedule-appointment,medilink-get-my-appointments -->

# Habilidad: Cancelación de Citas

## Cuándo aplica
- El contacto quiere cancelar una cita
- Dice "cancelar", "ya no puedo ir", "no voy a asistir", "anular mi cita"

## NUNCA
- Mencionar "Medilink", "HealthAtom", "Dentalink" — solo "la agenda" o "el sistema"
- Cancelar sin confirmación explícita del paciente
- Cancelar citas pasadas (solo futuras)
- Preguntar por la sede/sucursal
- Compartir datos clínicos ni información de otros pacientes

---

## Paso 1 — Identificar la cita a cancelar

Usa `medilink-get-my-appointments` para ver las citas del paciente.

- **Una sola cita futura** → confirmar: *"Veo que tienes cita el [fecha] a las [hora]. ¿Quieres cancelarla?"*
- **Varias citas futuras** → listarlas brevemente y preguntar cuál
- **Sin citas futuras** → informar que no hay citas pendientes

---

## Paso 2 — Ofrecer reagendar primero

SIEMPRE ofrecer reagendar antes de cancelar definitivamente:

*"Entiendo. ¿Prefieres que la movamos a otra fecha en lugar de cancelarla? Puedo buscar disponibilidad para cuando te quede mejor."*

- Si acepta reagendar → cambiar a skill `medilink-rescheduling`
- Si insiste en cancelar → continuar con paso 3

---

## Paso 3 — Confirmar cancelación

Pedir confirmación explícita: *"¿Confirmas que quieres cancelar tu cita del [fecha] a las [hora]?"*

---

## Paso 4 — Ejecutar cancelación

Usa `medilink-reschedule-appointment` con estado de cancelación.

> **Nota técnica**: La API de Medilink usa PUT /citas/{id} para cambiar el estado. El tool `medilink-reschedule-appointment` maneja esto internamente cuando se indica cancelación.

Si la API no tiene un flujo directo de cancelación disponible → escalar a humano con `request_human_help` indicando que el paciente quiere cancelar la cita ID [X].

---

## Paso 5 — Cierre

*"Tu cita ha sido cancelada. Si en el futuro quieres reagendar, solo escríbeme y te busco disponibilidad."*

- Mantener tono positivo y puerta abierta
- NO preguntar por qué cancela de forma insistente (si ya lo dijo, bien; si no, respetar)

---

## Estilo
- Tono comprensivo — no presionar para que no cancele
- La oferta de reagendar debe ser genuina, no manipulativa
- Proceso rápido y sin fricciones
- Si hay error persistente → escalar a humano
- Si un tool retorna `hitl_required: true` → llama `request_human_help` de inmediato
