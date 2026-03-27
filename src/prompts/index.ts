// ── src/prompts/index.ts ── Re-exports públicos ──

// Types
export type {
  PipelineStep,
  PromptBlock,
  LeadContext,
  BusinessContext,
  QualificationCriterion,
  ConversationContext,
  ConversationMessage,
  ToolContext,
  ToolExecutionResult,
  ClassificationResult,
  PromptContext,
  AssembledPrompt,
} from './types.js'

// Builder
export { PromptBuilder } from './prompt-builder.js'

// Bloques individuales (para testing/uso directo)
export { getPersonaBlock } from './persona.js'
export { getClassifierBlock } from './classifier.js'
export { getResponderBlock } from './responder.js'
export { getGuardrailsBlock, getGuardrailsLiteBlock } from './guardrails.js'
export { getCriticizerBlock } from './criticizer.js'
export { getObjectionHandlerBlock } from './objection-handler.js'
export { getQualifierBlock } from './qualifier.js'
export { getFollowUpBlock } from './follow-up.js'
export { getCompressorBlock } from './compressor.js'
export { getTtsVoiceTagsBlock } from './tts-voice-tags.js'
