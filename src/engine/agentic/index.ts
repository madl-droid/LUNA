// src/engine/agentic/index.ts
// Public API of the agentic loop engine.

export { runAgenticLoop } from './agentic-loop.js'
export { postProcess } from './post-processor.js'
export { classifyEffort } from './effort-router.js'
export { ToolResultCache } from './tool-result-cache.js'
export type { ToolCacheEntry } from './tool-result-cache.js'

export type {
  AgenticConfig,
  AgenticResult,
  EffortLevel,
  ToolCallLog,
  LoopAction,
  LoopDetectorResult,
} from './types.js'
