<!-- description: Outreach por email cross-channel — captura de email, envío de material, y reglas de respuesta en canal email -->
<!-- userTypes: lead,unknown -->
<!-- requiredTools: email-read-inbox -->

# Habilidad: Email Outreach (Cross-Channel)

## Cuándo usar esta habilidad
- El contacto en WhatsApp u otro canal pide recibir información por email ("envíamelo al correo")
- El contacto menciona que envió un email y necesitas buscarlo
- Necesitas enviar material (cotización, brochure, propuesta) que es mejor por email
- Recibes un email entrante que requiere respuesta elaborada con documentos

## Cuándo NO usar esta habilidad
- El contacto ya está interactuando por email de forma fluida (no necesitas el protocolo completo)
- Solo necesitas responder un email simple (usa el formato de email normal)

---

## Email tools disponibles

| Tool | Cuándo usarla |
|------|---------------|
| `email-read-inbox` | Ver emails recientes (filter: unread, recent, important, all) |
| `email-search` | Buscar emails específicos con sintaxis Gmail (from:, subject:, has:attachment, newer_than:) |
| `email-get-detail` | Leer contenido completo de un email por ID |
| `send_email` | Enviar email nuevo o responder a un thread |

---

## Flujo cross-channel (otro canal → email)

### 1. Captura de email
Cuando el contacto comparte su email o pide recibir algo por correo:
- Verificar si el contacto ya tiene email registrado (aparece en su perfil)
- Si no tiene, pedirlo: *"¿A qué correo te lo envío?"*
- Actualizar datos del contacto con `update_contact_info` si es nuevo

### 2. Verificar correspondencia previa
Antes de enviar, verifica si ya hay historial por email:
- Usa `email-search` con `from:{email_del_contacto}` para ver si ya te escribió
- Si hay emails previos, revisa contexto con `email-get-detail` para no repetir información

### 3. Enviar material
- Envía con `send_email` — el asunto debe ser descriptivo y específico
- Confirma por el canal original: *"Listo, te acabo de enviar la información a tu correo"*

### 4. Agendar follow-up
- Usa `create_commitment` para programar un seguimiento:
  - **Cotización enviada** → follow-up en 2-3 días
  - **Información general** → follow-up en 1 semana
  - **Sin respuesta al primer follow-up** → segundo intento en 1 semana más

---

## Cuándo NO responder un email

Estas situaciones NO requieren respuesta. Si recibes uno de estos, no generes reply:

- **Acknowledgments**: "Gracias", "Recibido", "Perfecto", "OK" — el contacto confirma recepción, no espera respuesta
- **Cierre de cortesía**: "Excelente, quedo atenta" después de que ya enviaste lo solicitado
- **Ping-pong**: si el contacto dice "gracias" a tu "gracias" → no respondas al "gracias" del "gracias"
- **Conversación cerrada**: el tema se resolvió, no hay pregunta abierta ni acción pendiente
- **Email informativo (FYI)**: te incluyen para información, no esperan acción tuya

**Regla general**: si no hay pregunta, solicitud, ni acción pendiente → no respondas.

---

## Timing de follow-ups por email

| Situación | Primer follow-up | Segundo follow-up |
|-----------|-----------------|-------------------|
| Cotización enviada | 2-3 días | 1 semana después del primero |
| Información general | 1 semana | 1 semana después del primero |
| Sin respuesta después de 2 follow-ups | No contactar más por email — intentar por otro canal o marcar como inactivo |

---

## Formato de email

- NO incluyas firma ni tu nombre al final — la firma se inyecta automáticamente por el sistema
- Sigue las guías de formato del canal email (tono profesional pero cálido, párrafos cortos, CTA claro)
- Asuntos descriptivos: "Cotización servicios X" en vez de "Información solicitada"
- Si adjuntas documentos, menciona qué contiene cada uno
