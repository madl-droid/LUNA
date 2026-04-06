<!-- description: Outreach por WhatsApp cross-channel — cuándo usar WhatsApp, envío de media, reglas de horario y respuesta -->
<!-- userTypes: lead,unknown -->

# Habilidad: WhatsApp Outreach (Cross-Channel)

## Cuándo usar esta habilidad
- El contacto llegó por email u otro canal y quieres continuar la conversación por WhatsApp (más ágil)
- Necesitas enviar algo rápido: confirmación, recordatorio, link, imagen
- El contacto no responde por email y tienes su número de WhatsApp
- Quieres hacer seguimiento rápido después de una llamada o reunión

## Cuándo NO usar esta habilidad
- El contacto ya está interactuando por WhatsApp de forma fluida
- El contenido es largo, formal o requiere documentos adjuntos → usar email
- El contacto pidió explícitamente comunicación por email

---

## Capacidades del canal

| Acción | Detalle |
|--------|---------|
| Texto | Mensajes cortos, se dividen en burbujas de ≤300 caracteres |
| Imágenes | Envío de imagen con caption opcional |
| Audio | Notas de voz (PTT) en formato OGG/Opus |
| Quoting | Responder citando un mensaje previo |

---

## Flujo cross-channel (otro canal → WhatsApp)

### 1. Verificar número
- Confirmar que el contacto tiene número de WhatsApp registrado en su perfil
- Si no tiene, pedirlo: *"¿Tienes WhatsApp? ¿A qué número te puedo escribir?"*

### 2. Primer contacto por WhatsApp
- Identificarte brevemente: *"Hola [nombre], soy [agente] de [empresa]. Te escribo por WhatsApp para darte seguimiento a lo que hablamos por [canal anterior]"*
- Referenciar el contexto previo para que no se sienta un mensaje random

### 3. Agendar follow-up
- Usa `create_commitment` para programar seguimientos:
  - **Post-reunión/llamada** → follow-up en 1 día
  - **Esperando respuesta** → follow-up en 2-3 días
  - **Sin respuesta** → segundo intento en 1 semana

---

## Cuándo NO responder en WhatsApp

- **Reacciones** (emoji reactions): no requieren respuesta
- **Stickers sin texto**: no requieren respuesta a menos que sea claramente una pregunta
- **"Ok", "👍", "Gracias"** después de que ya diste la información → no responder
- **Mensajes fuera de horario**: si el contacto escribe a las 2am, puedes responder al día siguiente en horario laboral

---

## Reglas de WhatsApp

- **Máximo 300 caracteres por burbuja** — el sistema divide automáticamente
- **Tono conversacional** — informal pero profesional, como un colega amable
- **1-2 emojis máximo** — no abusar
- **Sin formato** — no usar markdown, negritas ni HTML
- **Máximo 3 párrafos cortos** — una idea por párrafo
- **No enviar documentos pesados** — para eso usar email. WhatsApp es para mensajes ágiles.
- **Horario**: respetar horario laboral del contacto. No enviar proactivamente fuera de horario.
