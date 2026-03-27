// ── src/prompts/qualifier.ts ── Calificación de leads (BANT adaptado) ──

import type { PromptBlock, PromptContext } from './types.js'

export function getQualifierBlock(ctx: PromptContext): PromptBlock {
  const { business, lead } = ctx
  const criteria = business.qualificationCriteria
  const qualData = lead.qualificationData ?? {}

  // Construir resumen de progreso
  const progressLines: string[] = []
  const pendingLines: string[] = []

  for (const criterion of criteria) {
    const value = qualData[criterion.field]
    if (value !== undefined && value !== null && value !== '') {
      progressLines.push(`- ✅ **${criterion.field}**: ${String(value)}`)
    } else {
      const reqTag = criterion.required ? ' (REQUERIDO)' : ' (opcional)'
      pendingLines.push(`- ❓ **${criterion.field}**${reqTag}: "${criterion.question}"`)
    }
  }

  const progressSection = progressLines.length > 0
    ? `### Datos ya recopilados:\n${progressLines.join('\n')}`
    : '### Datos ya recopilados:\nNinguno aún — es una conversación nueva.'

  const pendingSection = pendingLines.length > 0
    ? `### Datos pendientes por descubrir:\n${pendingLines.join('\n')}`
    : '### Datos pendientes:\nTodos los criterios están completos. Pivota hacia agendar o cerrar.'

  const validValuesNote = criteria
    .filter(c => c.validValues && c.validValues.length > 0)
    .map(c => `- **${c.field}**: valores válidos → ${c.validValues!.join(', ')}`)

  const validValuesSection = validValuesNote.length > 0
    ? `\n### Valores válidos por campo:\n${validValuesNote.join('\n')}`
    : ''

  return {
    id: 'qualifier',
    priority: 25,
    content: `## CALIFICACIÓN DEL LEAD — BANT Adaptado (Bryan Tracy)

Tu objetivo secundario (mientras conversas) es recopilar la información necesaria para calificar a este lead. NUNCA hagas preguntas tipo formulario. Teje las preguntas de forma natural en la conversación.

### Metodología BANT adaptada:
- **Budget (Presupuesto)**: No preguntes directamente "¿cuánto puedes pagar?". Descubre rango a través de preferencias: "¿Buscas algo más básico o completo?"
- **Authority (Autoridad)**: Identifica si es quien decide: "¿Tú manejas esto directamente o alguien más participa?"
- **Need (Necesidad)**: Ya cubierto por las preguntas SPIN de la metodología Bryan Tracy.
- **Timeline (Tiempo)**: Descubre urgencia: "¿Para cuándo necesitarías esto?" o "¿Es algo que quieres resolver pronto?"

### Priorización:
- Primero los criterios **requeridos** y los que son deal-breaker (ej: zona de servicio fuera de cobertura).
- Después los opcionales que enriquecen el perfil.
- No hagas más de 1 pregunta de calificación por mensaje. Intercala con valor.

${progressSection}

${pendingSection}${validValuesSection}

### Reglas de descubrimiento conversacional:
- Si el lead da información voluntariamente, captúrala aunque no la hayas preguntado.
- Si una respuesta cubre múltiples criterios, no repitas lo que ya sabes.
- Si el lead se resiste a dar un dato, no insistas — pasa al siguiente y vuelve después.
- Cuando todos los criterios requeridos estén completos, el lead está calificado → pivota a agendar o siguiente paso.`,
  }
}
