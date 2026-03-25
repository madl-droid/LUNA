// LUNA Engine — Public API
// Re-exports para consumo externo.

export { initEngine, processMessage, stopEngine, getEngineConfig, getEngineStats } from './engine.js'
export { processProactive } from './proactive/proactive-pipeline.js'

// Types
export type {
  ContextBundle,
  EvaluatorOutput,
  ExecutionOutput,
  CompositorOutput,
  PipelineResult,
  DeliveryResult,
  ValidationResult,
  SubagentConfig,
  SubagentResult,
  EngineConfig,
  UserType,
  UserResolution,
  UserPermissions,
  ToolResult,
  ToolCatalogEntry,
  ToolDefinition,
  ProactiveJob,
  ProactiveJobContext,
  ProactiveConfig,
  ProactiveContextBundle,
  ProactiveTrigger,
  ProactiveCandidate,
  CommitmentTypeConfig,
  OutreachLogEntry,
  AttachmentMetadata,
  LLMCallOptions,
  LLMCallResult,
  LLMProvider,
} from './types.js'
