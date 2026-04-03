// LUNA Engine — Skill Read Tool
// Built-in tool that fetches full skill instructions on demand.
// Follows the same pattern as subagent-delegation.ts.

import type { LLMToolDef } from '../types.js'
import { loadSkillDetail } from '../prompts/skills.js'

export const SKILL_READ_TOOL_NAME = 'skill_read'

export function buildSkillReadToolDef(skillNames: string[]): LLMToolDef | null {
  if (skillNames.length === 0) return null
  return {
    name: SKILL_READ_TOOL_NAME,
    description: 'Obtiene las instrucciones completas de una habilidad especializada. Úsala cuando vayas a aplicar un protocolo de interacción específico.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        skill_name: {
          type: 'string',
          enum: skillNames,
          description: 'Nombre de la habilidad cuyas instrucciones completas necesitas.',
        },
      },
      required: ['skill_name'],
    },
  }
}

export async function executeSkillReadTool(
  input: Record<string, unknown>,
): Promise<{ success: boolean; data: unknown; error?: string; durationMs: number }> {
  const start = Date.now()
  const skillName = typeof input['skill_name'] === 'string' ? input['skill_name'] : ''
  if (!skillName) {
    return { success: false, data: null, error: 'Missing skill_name', durationMs: 0 }
  }
  const content = await loadSkillDetail(skillName)
  const durationMs = Date.now() - start
  if (!content) {
    return { success: false, data: null, error: `Habilidad '${skillName}' no encontrada`, durationMs }
  }
  return { success: true, data: content, durationMs }
}
