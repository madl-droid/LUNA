// LUNA Engine — Tool Dedup Cache
// Per-pipeline in-memory cache that prevents identical tool calls within a single run.
// Lifecycle: create at loop start, discard after loop ends. No Redis, no persistence.

/** Cached result shape (mirrors what executeTool returns, minus metadata) */
type CachedResult = { data: unknown; success: boolean; error?: string; durationMs: number }

/**
 * Per-pipeline dedup cache for tool calls.
 * Lifecycle: create at loop start, discard after loop ends. No Redis, no persistence.
 *
 * Skips caching for write operations (tools that have side effects).
 */
export class ToolDedupCache {
  /**
   * Set of tool names that should never be cached (write operations / side-effects).
   *
   * MANTENIMIENTO: Agregar aquí cualquier tool nueva que tenga side-effects
   * (escribe datos, manda mensajes, crea recursos, etc.). Si no se agrega,
   * el cache podría devolver un resultado anterior y evitar que la acción se ejecute.
   */
  private static readonly WRITE_TOOLS: ReadonlySet<string> = new Set([
    'create_commitment',
    'send_email',
    'create_event',
    'update_event',
    'delete_event',
    'create_contact',
    'update_contact',
    'write_sheet',
    'update_sheet',
    'create_ticket',
    'update_ticket',
    'escalate_to_human',
    'spawn_subagent',
    'schedule_follow_up',
  ])

  private cache = new Map<string, CachedResult>()

  /**
   * Build the cache key: hash of tool name + serialized input.
   * Truncated at 10KB to guard against pathologically large inputs.
   */
  private buildKey(toolName: string, input: Record<string, unknown>): string {
    const serialized = JSON.stringify(input)
    const truncated = serialized.length > 10240 ? serialized.slice(0, 10240) : serialized
    return `${toolName}:${truncated}`
  }

  /**
   * Check if a cached result exists for this tool call.
   * Returns null if not cached or if the tool is a write operation.
   */
  get(toolName: string, input: Record<string, unknown>): CachedResult | null {
    if (ToolDedupCache.WRITE_TOOLS.has(toolName)) return null
    const key = this.buildKey(toolName, input)
    return this.cache.get(key) ?? null
  }

  /**
   * Store a tool result in the cache.
   * No-op for write operations.
   */
  set(toolName: string, input: Record<string, unknown>, result: CachedResult): void {
    if (ToolDedupCache.WRITE_TOOLS.has(toolName)) return
    const key = this.buildKey(toolName, input)
    this.cache.set(key, result)
  }

  /**
   * Number of cached entries (for logging).
   */
  get size(): number {
    return this.cache.size
  }
}
