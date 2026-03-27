// ── src/prompts/prompt-builder.ts ── Ensamblador de prompts por paso del pipeline ──

import type { AssembledPrompt, PromptBlock, PromptContext } from './types.js'
import { getPersonaBlock } from './persona.js'
import { getClassifierBlock } from './classifier.js'
import { getResponderBlock } from './responder.js'
import { getGuardrailsBlock, getGuardrailsLiteBlock } from './guardrails.js'
import { getCriticizerBlock } from './criticizer.js'
import { getObjectionHandlerBlock } from './objection-handler.js'
import { getQualifierBlock } from './qualifier.js'
import { getFollowUpBlock } from './follow-up.js'
import { getCompressorBlock } from './compressor.js'
import { getTtsVoiceTagsBlock } from './tts-voice-tags.js'

/**
 * Determina qué bloques de prompt incluir según el paso del pipeline y el contexto.
 *
 * Tabla de composición:
 *                  classify  respond  respond_complex  compress  follow_up
 * persona            -        SI        SI               -        SI
 * classifier         SI       -         -                -        -
 * responder          -        SI        SI               -        -
 * guardrails         LITE     SI        SI               -        SI
 * criticizer         -        SI        SI               -        -
 * objection-handler  -        si*       SI*              -        -
 * qualifier          -        si**      si**             -        -
 * follow-up          -        -         -                -        SI
 * compressor         -        -         -                SI       -
 * tts-voice-tags     -        si***     si***            -        si***
 *
 * *  cuando classification.isObjection === true
 * ** cuando lead.qualificationStatus es 'new' o 'qualifying'
 * *** cuando ctx.ttsEnabled === true
 */
function selectBlocks(ctx: PromptContext): PromptBlock[] {
  const blocks: PromptBlock[] = []
  const { step, classification, lead, ttsEnabled } = ctx

  const isObjection = classification?.isObjection === true
  const isQualifying = lead.qualificationStatus === 'new' || lead.qualificationStatus === 'qualifying'

  switch (step) {
    case 'classify':
      blocks.push(getClassifierBlock(ctx))
      blocks.push(getGuardrailsLiteBlock(ctx))
      break

    case 'respond':
      blocks.push(getPersonaBlock(ctx))
      blocks.push(getResponderBlock(ctx))
      blocks.push(getGuardrailsBlock(ctx))
      blocks.push(getCriticizerBlock(ctx))
      if (isObjection) blocks.push(getObjectionHandlerBlock(ctx))
      if (isQualifying) blocks.push(getQualifierBlock(ctx))
      if (ttsEnabled) blocks.push(getTtsVoiceTagsBlock(ctx))
      break

    case 'respond_complex':
      blocks.push(getPersonaBlock(ctx))
      blocks.push(getResponderBlock(ctx))
      blocks.push(getGuardrailsBlock(ctx))
      blocks.push(getCriticizerBlock(ctx))
      if (isObjection) blocks.push(getObjectionHandlerBlock(ctx))
      if (isQualifying) blocks.push(getQualifierBlock(ctx))
      if (ttsEnabled) blocks.push(getTtsVoiceTagsBlock(ctx))
      break

    case 'compress':
      blocks.push(getCompressorBlock(ctx))
      break

    case 'follow_up':
      blocks.push(getPersonaBlock(ctx))
      blocks.push(getFollowUpBlock(ctx))
      blocks.push(getGuardrailsBlock(ctx))
      if (ttsEnabled) blocks.push(getTtsVoiceTagsBlock(ctx))
      break
  }

  return blocks
}

function assembleSystem(blocks: PromptBlock[]): string {
  const sorted = [...blocks].sort((a, b) => a.priority - b.priority)
  return sorted.map(b => b.content).join('\n\n---\n\n')
}

export class PromptBuilder {
  build(ctx: PromptContext): AssembledPrompt {
    const blocks = selectBlocks(ctx)
    const system = assembleSystem(blocks)

    const result: AssembledPrompt = {
      system,
      messages: ctx.conversation.messages,
    }

    // Para classify, el último mensaje del usuario se pone aparte
    if (ctx.step === 'classify' && ctx.conversation.messages.length > 0) {
      const lastMsg = ctx.conversation.messages[ctx.conversation.messages.length - 1]
      if (lastMsg && lastMsg.role === 'user') {
        result.userMessage = lastMsg.content
        // No duplicar: quitar el último del array de messages
        result.messages = ctx.conversation.messages.slice(0, -1)
      }
    }

    return result
  }
}
