# Reuse Inventory — MANDATORY Reference

> **RULE**: Before creating ANY new function, hook, service, type, or file, check this inventory.
> If it exists here, USE IT. Do not duplicate.

## Registry Services (use registry.get/getOptional)

| Service | Returns | Use for |
|---|---|---|
| `'llm:gateway'` | LLMGateway | All LLM calls |
| `'tools:registry'` | ToolRegistry | Tool execution, catalog, definitions |
| `'prompts:service'` | PromptsService | Load identity/job/guardrails/relationship/criticizer |
| `'memory:manager'` | MemoryManager | Load contact memory, session history |
| `'memory:search'` | HybridSearch | Search memory/summaries |
| `'memory:buffer-turns'` | BufferTurns | Get buffer turns per channel |
| `'memory:context-summaries'` | ContextSummaries | Get relevant summaries for contact |
| `'knowledge:manager'` | KnowledgeManager | Knowledge search |
| `'unified:search'` | UnifiedSearch | Combined knowledge + freshdesk search |
| `'users:resolve'` | resolveUserType fn | Resolve user type from sender |
| `'users:permissions'` | getUserPermissions fn | Get permissions for user type |
| `'tts:service'` | TTSService | Text-to-speech |
| `'subagents:catalog'` | CatalogService | List available subagent types |
| `'hitl:context'` | HITLContext | Get pending HITL ticket context |
| `'hitl:rules'` | HITLRules | Get HITL rules for evaluator |
| `'lead-scoring:queries'` | LeadQueries | Lead qualification data |
| `'marketing-data:match-campaign'` | matchCampaign fn | Campaign matching |
| `'cortex:notifications'` | NotificationService | Send system notifications |
| `'channel-config:{name}'` | ChannelRuntimeConfig | Per-channel runtime config |
| `'engine:attachment-config'` | AttachmentConfig | Attachment processing config |

## Hooks (use registry.addHook/runHook/callHook)

| Hook | Trigger | Payload |
|---|---|---|
| `'message:incoming'` | Channel receives message | `IncomingHookPayload` |
| `'message:send'` | Engine wants to send | `SendPayload` |
| `'message:sent'` | Message was sent | `SentPayload` |
| `'message:classified'` | Intent classified | `ClassifiedHookPayload` |
| `'message:before_respond'` | Before composing response | `BeforeRespondPayload` |
| `'message:response_ready'` | Response composed | `ResponseReadyPayload` |
| `'channel:ack'` | Send ACK signal | `ChannelSignalPayload` |
| `'channel:composing'` | Send typing indicator | `ChannelComposingPayload` |
| `'channel:send_complete'` | Channel finished sending | `ChannelSendCompletePayload` |
| `'console:config_applied'` | Console config changed | `Record<string, never>` |
| `'contact:new'` | New contact created | `{ contactId, channel }` |
| `'contact:status_changed'` | Lead status changed | `{ contactId, from, to }` |
| `'tools:register'` | Tool registered | `{ toolName, moduleName }` |
| `'tools:before_execute'` | Before tool runs | `{ toolName, input, contactType }` |
| `'tools:executed'` | Tool completed | `{ toolName, success, durationMs }` |
| `'llm:chat'` | LLM chat request (filter) | `LLMChatPayload` → `LLMChatResult` |
| `'llm:provider_down'` | Provider circuit open | `{ provider, reason }` |

## Functions to Reuse (NOT recreate)

### LLM Client (`engine/utils/llm-client.ts`)
```typescript
callLLM(options: LLMCallOptions): Promise<LLMCallResult>
callLLMWithFallback(options, fallbackProvider, fallbackModel): Promise<LLMCallResult>
setLLMGateway(gateway): void
```

### Tool System (`modules/tools/`)
```typescript
// ToolRegistry instance (get via registry)
toolRegistry.executeTool(name, input, context): Promise<ToolResult>
toolRegistry.getEnabledToolDefinitions(contactType?): ToolDefinition[]
toolRegistry.getCatalog(contactType?): ToolCatalogEntry[]
toolRegistry.getToolsAsNative(provider, contactType?): unknown[]
toolRegistry.isToolAllowed(name, contactType): boolean

// Converter
toNativeTools(tools, provider): unknown[]
toAnthropicTools(tools): AnthropicToolDef[]
toGeminiTools(tools): GeminiToolDef[]
```

### Prompt System (`modules/prompts/`)
```typescript
// PromptsService instance (get via registry)
promptsService.getCompositorPrompts(userType): Promise<CompositorPrompts>
promptsService.getPrompt(slot, variant?): Promise<string>
promptsService.getSystemPrompt(name, variables?): Promise<string>
promptsService.getAgentName(): string
promptsService.getAgentLastName(): string
promptsService.getAccent(): string
promptsService.getLanguage(): string

// Template loader
loadSystemPrompt(name): Promise<string>
loadDefaultPrompt(name): Promise<string>
renderTemplate(template, variables): string
```

### Formatting (`engine/utils/`)
```typescript
formatForChannel(text, channel, registry?): string[]
normalizeText(text): string
detectMessageType(content): MessageContentType
escapeForPrompt(text, maxLength?): string
escapeDataForPrompt(data, maxLength?): string
wrapUserContent(text, label?): string
escapeHistory(messages, maxPerMessage?): Array<...>
detectInputInjection(text): boolean
detectOutputInjection(text): string[]
calculateTypingDelay(text, ...): number
determineResponseFormat(text, inputType, channelName, channelType, ttsEnabled?): 'audio'|'text'|'auto'
```

### Concurrency (`engine/concurrency/`)
```typescript
PipelineSemaphore(maxConcurrent, maxQueueSize) — global pipeline limiter
ContactLock(timeoutMs?) — per-contact serialization
StepSemaphore(maxConcurrent) — parallel step limiter (reuse for tool parallelism)
```

### Config Store (`kernel/config-store.ts`)
```typescript
configStore.get(pool, key): Promise<string | null>
configStore.set(pool, key, value, isSecret?): Promise<void>
configStore.getAll(pool): Promise<Record<string, string>>
configStore.setMultiple(pool, entries): Promise<void>
```

## Types to Reuse (from `engine/types.ts`)

| Type | Phase | Keep/Extend |
|---|---|---|
| `ContextBundle` | Phase 1 output | **KEEP** — do not modify |
| `HistoryMessage` | Context | **KEEP** |
| `ContactInfo` | Context | **KEEP** |
| `SessionInfo` | Context | **KEEP** |
| `CampaignInfo` | Context | **KEEP** |
| `KnowledgeMatch` | Context | **KEEP** |
| `UserPermissions` | Users | **KEEP** |
| `CompositorOutput` | Phase 4 output | **REUSE** for agentic post-processing output |
| `PipelineResult` | Final result | **EXTEND** with agentic fields |
| `EngineConfig` | Config | **EXTEND** with agentic config |
| `LLMCallOptions` | LLM client | **KEEP** — already supports tools |
| `LLMCallResult` | LLM client | **KEEP** — already has toolCalls |
| `LLMToolDef` | LLM client | **KEEP** |
| `ToolResult` | Tools | **KEEP** |
| `ToolDefinition` | Tools | **EXTEND** with shortDescription |
| `ToolCatalogEntry` | Tools | **KEEP** |
| `ProactiveConfig` | Proactive | **EXTEND** with smart cooldown |
| `ProactiveCandidate` | Proactive | **KEEP** |
| `OutreachLogEntry` | Proactive | **KEEP** |

## Database Tables — DO NOT create new ones

Use existing tables. Key tables:
- `messages` — all messages
- `contacts` / `contact_channels` — contact identity
- `sessions` — conversation sessions
- `pipeline_logs` — pipeline execution logs
- `tool_executions` — tool execution logs (from tools module)
- `commitments` — agent commitments
- `proactive_outreach_log` — proactive message log
- `task_checkpoints` — resumable pipelines
- `config_store` — dynamic config (encrypted)
- `prompt_slots` — editable prompts
- `subagent_types` / `subagent_usage` — subagent config

## Engine Config Keys — Extend these, don't replace

All in `src/engine/config.ts`. Add new keys with `ENGINE_` or `AGENTIC_` prefix.
Existing keys that stay: all `LLM_*`, all `PIPELINE_*`, all `ENGINE_*`.
