<!-- description: Protocolo de agendamiento para pacientes conocidos — citas de control, nuevos tratamientos -->
<!-- userTypes: lead,admin,coworker -->
<!-- requiredTools: medilink-search-patient,medilink-create-appointment -->

# Habilidad: Agendamiento de Pacientes Conocidos

## Cuándo aplica
- El contacto ya existe como paciente en el sistema (tiene patient_id)
- Quiere agendar una NUEVA cita (no reagendar una existente)
- Cita de control, nuevo tratamiento, segunda opinión, etc.

## NUNCA
- Mencionar "Medilink", "HealthAtom", "Dentalink" — solo "la agenda" o "el sistema"
- Preguntar por la sede/sucursal — solo hay una
- Compartir datos clínicos, evoluciones ni información de otros pacientes
- Preguntar el número de teléfono — ya lo tienes por WhatsApp
- Listar TODOS los slots disponibles — máximo 5-6 opciones organizadas

---

## Paso 1 — Verificar paciente

Usa `medilink-search-patient` para confirmar que el paciente existe y obtener su ID.

- **Encontrado** → continuar
- **No encontrado** → este skill NO aplica, usa `medilink-lead-scheduling`

---

## Paso 2 — Determinar tipo de cita

Consulta `medilink-get-treatment-plans` para ver si tiene tratamientos activos.

- **Tiene tratamiento activo** → sugerir cita de control con el mismo profesional del plan
- **No tiene tratamiento activo** → preguntar qué necesita
- Si dice algo genérico ("control", "revisión") → usar prestación por defecto
- Si menciona un tratamiento específico → consultar `medilink-get-prestaciones` para matching

---

## Paso 3 — Verificar disponibilidad

Usa `medilink-check-availability` con los parámetros correctos:
- Si tiene tratamiento activo → pasar `appointment_id` de su última cita para filtrar por profesional compatible
- Si es tratamiento nuevo → pasar `treatment_name` para filtrar por categoría
- Si pide un profesional específico → pasar `professional_name`

Presentar horarios organizados:
- **Mañana**: máximo 2-3 opciones
- **Tarde**: máximo 2-3 opciones
- Priorizar horarios con el profesional del tratamiento activo

---

## Paso 4 — Agendar

Usa `medilink-create-appointment` con:
- Fecha y hora confirmadas
- Profesional (si aplica)
- Prestación correcta

---

## Paso 5 — Confirmación

*"Listo, tu cita quedó agendada con [nombre del profesional] el [día] a las [hora]."*

- SÍ mencionar el nombre del profesional (es paciente conocido, ya sabe quién lo atiende)
- Mencionar el tipo de servicio
- Mencionar dirección si la tienes
- Sugerir preparación si aplica al tipo de cita

---

## Restricciones de profesionales
El sistema filtra automáticamente por categorías habilitadas. Si el paciente pide un profesional que no maneja su tratamiento, informarle y ofrecer alternativas.

## Estilo
- Conversación natural y cercana (ya es paciente, usar su nombre)
- No hacer preguntas innecesarias — ya tienes sus datos
- Si hay error persistente → escalar a humano
- Si un tool retorna `hitl_required: true` → llama `request_human_help` de inmediato
