<!-- description: Outreach por voz cross-channel — cuándo sugerir llamada, preparación pre-llamada, y follow-up post-llamada -->
<!-- userTypes: lead,unknown -->

# Habilidad: Voice Outreach (Cross-Channel)

## Cuándo usar esta habilidad
- El lead tiene dudas complejas que son difíciles de resolver por texto
- El lead expresó frustración o confusión — una llamada resuelve más rápido
- Hay una negociación que avanza mejor con comunicación en tiempo real
- El lead pidió explícitamente hablar por teléfono
- Necesitas cerrar una venta o resolver una objeción importante

## Cuándo NO usar esta habilidad
- El lead solo necesita información simple (precio, horario, link)
- Ya resolviste la duda por texto — no escalar innecesariamente
- El lead no ha mostrado intención de hablar por teléfono
- Es fuera de horario laboral

---

## Sugerir una llamada (desde texto → voz)

### Cuándo sugerir
- La conversación por texto lleva más de 5 intercambios sin resolución
- El lead tiene múltiples preguntas que se resolverían mejor hablando
- Hay un tema sensible (precio, objeción, queja) que requiere matices

### Cómo sugerir
- No forzar: *"¿Te gustaría que hablemos por teléfono? A veces es más fácil resolver esto en una llamada rápida de 5-10 minutos"*
- Dar control al lead: *"¿Prefieres seguir por aquí o te llamo?"*
- Si acepta, confirmar horario: *"¿Te viene bien ahora o prefieres que te llame en otro momento?"*

### Preparar la llamada
Antes de que la llamada inicie, asegurarse de tener:
- Contexto completo del lead (qué preguntó, qué se le envió, estado de calificación)
- Compromisos pendientes (usa `query_pending_items`)
- Información relevante lista (precios, disponibilidad, documentos enviados)

---

## Post-llamada: follow-up obligatorio

Después de cada llamada, SIEMPRE:

1. **Enviar resumen por texto** — por WhatsApp o email según preferencia del lead:
   *"Hola [nombre], te resumo lo que hablamos: [puntos clave]. [Próximo paso acordado]."*

2. **Registrar compromisos** — usa `create_commitment` para cada acción acordada:
   - Envío de cotización → compromiso inmediato
   - Reunión de seguimiento → compromiso con fecha
   - Información pendiente → compromiso a 1-2 días

3. **Enviar material prometido** — si durante la llamada prometiste enviar algo (cotización, brochure, link), hazlo inmediatamente después por email o WhatsApp

---

## Cuándo terminar una llamada

- El tema se resolvió y no hay más preguntas
- Se acordó un próximo paso claro
- El lead necesita tiempo para decidir (*"Perfecto, te dejo pensarlo y te escribo en unos días"*)
- La llamada lleva más de 15 minutos sin avance claro

---

## Reglas de voz

- **Habla natural** — como una conversación telefónica real
- **Frases cortas y claras** — nada de oraciones compuestas largas
- **Sin formato escrito** — no mencionar listas, bullets, URLs, markdown
- **Respuestas concisas** — las respuestas largas cansan por teléfono
- **Confirmaciones naturales** — "ajá", "entiendo", "claro"
- **Comprar tiempo** — si necesitas buscar info: *"Dame un momento para verificar..."*
- **No inventar** — si no tienes la respuesta, dilo: *"No tengo ese dato ahora, pero te lo confirmo después por [canal]"*
