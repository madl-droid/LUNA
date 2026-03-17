// LUNA Engine — Public API
// Re-exports para consumo externo.

export { initEngine, processMessage, stopEngine, getEngineConfig } from './engine.js'

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
  LLMCallOptions,
  LLMCallResult,
  LLMProvider,
} from './types.js'
