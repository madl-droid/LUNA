// ── src/prompts/compressor.ts ── Compresión/resumen de sesión ──

import type { PromptBlock, PromptContext } from './types.js'

export function getCompressorBlock(ctx: PromptContext): PromptBlock {
  const { lead, business } = ctx

  return {
    id: 'compressor',
    priority: 10,
    content: `## INSTRUCCIONES DE COMPRESIÓN DE SESIÓN

Tu tarea es resumir la conversación en un formato estructurado que pueda usarse como contexto en futuras interacciones. El resumen debe leerse de forma natural, no como datos crudos.

### Formato de salida (texto estructurado, NO JSON):

**Lead**: [nombre si se sabe] vía [canal]
**Estado**: [new/qualifying/qualified/scheduled/inactive]

**Datos recopilados**:
${business.qualificationCriteria.map(c => `- ${c.field}: [valor descubierto o "pendiente"]`).join('\n')}

**Interés principal**: [qué producto/servicio le interesa y por qué]

**Objeciones planteadas**:
- [objeción 1]: [cómo se manejó y si se resolvió]
- [ninguna] si no hubo

**Compromisos**:
- Del lead: [qué prometió hacer - confirmar, enviar info, consultar, etc.]
- De ${business.businessName}: [qué prometimos - enviar cotización, llamar, agendar, etc.]

**Cita**: [detalles si se agendó, o "no agendada"]

**Estado emocional**: [cómo terminó el lead - interesado, dudoso, entusiasmado, molesto, neutral]

**Nivel de rapport**: [bajo/medio/alto — qué tan buena fue la conexión]

**Preguntas pendientes**: [lo que el lead preguntó y no se pudo responder]

**Siguiente paso recomendado**: [qué debería hacer ${business.businessName} en el próximo contacto]

### Reglas del resumen:
- Sé conciso pero no pierdas información clave. Cada campo en una línea.
- Si un dato no aplica o no se mencionó, escribe "no mencionado" o "pendiente".
- Captura el TONO de la conversación, no solo los hechos. "El lead estaba muy entusiasmado" vs "El lead respondió de forma cortante".
- Los compromisos son críticos: si alguien prometió algo, DEBE quedar registrado.
- El "siguiente paso recomendado" es tu juicio sobre qué hacer — sé específico.
- Escribe el resumen como si otro vendedor fuera a leerlo para retomar la conversación.
- Lead actual: ${lead.name ?? 'nombre desconocido'} (${lead.contactType}) vía ${lead.channel}.`,
  }
}
