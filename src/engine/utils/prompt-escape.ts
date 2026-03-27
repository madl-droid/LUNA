// LUNA Engine — Prompt Escape Utilities
// FIX: SEC-2.x — Escapado centralizado de prompt injection
//
// Escapa contenido externo para inyección segura en prompts LLM.
// NO es infalible — es una capa de defensa que complementa la detección de injection.
//
// Estrategia:
// 1. Escapar delimitadores que podrían confundir la estructura del prompt
// 2. Envolver en boundary markers que el LLM aprende a tratar como datos
// 3. Truncar para prevenir prompt stuffing

/** Escapa un string para uso dentro de un prompt LLM */
export function escapeForPrompt(text: string, maxLength = 5000): string {
  if (!text) return ''

  const escaped = text
    // Truncar primero para no procesar texto que se va a descartar
    .slice(0, maxLength)
    // Escapar secuencias que podrían ser interpretadas como instrucciones
    .replace(/```/g, '` ` `')           // Romper code fences
    .replace(/<\|/g, '< |')             // Romper tokens especiales de algunos modelos
    .replace(/\|>/g, '| >')
    .replace(/\[INST\]/gi, '[IN ST]')   // Romper marcadores de instrucción
    .replace(/\[\/INST\]/gi, '[/IN ST]')
    .replace(/<<SYS>>/gi, '<< SYS >>')
    .replace(/<<\/SYS>>/gi, '<< /SYS >>')
    // Colapsar múltiples newlines (previene inyección por separación visual)
    .replace(/\n{4,}/g, '\n\n\n')

  return escaped
}

/** Envuelve contenido externo en boundary markers para contexto LLM */
export function wrapUserContent(text: string, label = 'USER_MESSAGE'): string {
  const escaped = escapeForPrompt(text)
  const boundary = `--- BEGIN ${label} ---`
  const endBoundary = `--- END ${label} ---`
  return `${boundary}\n${escaped}\n${endBoundary}`
}

/** Escapa datos estructurados (de DB, tools, etc.) para inyección en prompt */
export function escapeDataForPrompt(data: string, maxLength = 3000): string {
  return escapeForPrompt(data, maxLength)
}

/** Escapa y trunca un array de mensajes de historial */
export function escapeHistory(
  messages: Array<{ role: string; content: string }>,
  maxPerMessage = 500,
): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: escapeForPrompt(m.content, maxPerMessage),
  }))
}
