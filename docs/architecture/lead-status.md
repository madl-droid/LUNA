# Lead Status — Qualification

## Qué es
El sistema de calificación de LUNA. Su trabajo es determinar si un lead vale la pena — si tiene presupuesto, si decide, si necesita lo que vendemos, y si lo necesita pronto. Todo esto sin que el lead sienta que lo están evaluando. Para él es una conversación natural con un vendedor atento.

## Por qué existe
Un vendedor humano califica inconscientemente: en 2 minutos de conversación ya sabe si alguien va en serio o está perdiendo el tiempo. LUNA necesita hacer lo mismo pero de forma sistemática, medible y configurable por tenant.

## Framework: BANT adaptado
4 dimensiones universales que aplican a cualquier negocio que venda con leads:
- **Budget** — ¿Tiene capacidad de pago?
- **Authority** — ¿Es quien decide o solo cotiza?
- **Need** — ¿Qué problema quiere resolver?
- **Timeline** — ¿Para cuándo lo necesita?

Cada tenant agrega hasta 6 criterios custom encima (zona geográfica, tamaño de empresa, procedimiento de interés, etc.). Máximo 10 criterios por tenant.

## Cómo califica el agente
- **Extracción natural:** el agente NO hace preguntas tipo encuesta. Extrae info de lo que el lead dice naturalmente. Si dice "somos 50 personas", eso llena company_size.
- **Pursuit activo:** el agente sabe qué le falta y busca la forma natural de obtenerlo. Pero tiene límites — no insiste, no repite, y hay criterios (como budget) que nunca pregunta directo.
- **Tool en fase 3:** la extracción es una tool (`extract_qualification`) que el evaluador (fase 2) activa solo cuando detecta que hay info relevante. No se ejecuta en cada mensaje. Hace una llamada LLM barata enfocada solo en extraer datos estructurados.
- **Score por código:** el código suma pesos, evalúa criterios required/disqualifying, y decide las transiciones de status. El LLM extrae, el código decide.
- **Seguimiento con humano** el agente debe hacer seguimiento con el humano encargado para obtener una calificación del lead por parte del humano.

## Máquina de estados (qualification_status)
```
new → qualifying → qualified → scheduled → attended → converted
         │
         ├→ out_of_zone
         ├→ not_interested
         └→ cold

scheduled → cold
ANY → blocked
```
Todas las transiciones son triggers de código en postprocessor. El LLM nunca cambia el status directamente.

## qualified_action (varía por tenant)
Qué pasa cuando un lead califica depende del negocio:
- `schedule_meeting` — agendar con humano para cerrar (B2B, ticket alto)
- `schedule_appointment` — agendar cita/procedimiento directo (clínicas)
- `transfer_to_sales` — pasar a equipo de ventas sin agendar
- `auto_close` — el agente intenta cerrar solo (bajo ticket)
- `purchase_complete` — el cliente finaliza la compra por la asesoría del agente

## Config
Todo vive en `instance/qualifying.json`. La console lo edita, hot-reload vía Apply.
Los datos extraídos viven en `contacts.qualification_data` (JSONB).
El score vive en `contacts.qualification_score` (INT).

## contact_type vs qualification_status
Son campos SEPARADOS. contact_type dice QUÉ es la persona (lead, cliente, proveedor, equipo interno). qualification_status dice EN QUÉ PUNTO del funnel está el lead.
No confundirlos.