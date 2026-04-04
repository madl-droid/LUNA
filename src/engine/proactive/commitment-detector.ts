// LUNA Engine — Commitment Auto-Detector (Via B)
// Scans agent responses for implicit commitments using a fast LLM call.
// Safety net: catches promises the evaluator didn't anticipate.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { ProactiveConfig } from '../types.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import type { EngineConfig } from '../types.js'
import { validateCommitment } from './commitment-validator.js'

const logger = pino({ name: 'engine:commitment-detector' })

// Minimal fallback — full prompt lives in instance/prompts/system/commitment-detector-system.md
const DETECTOR_SYSTEM_FALLBACK = `You are a commitment detector. Respond in JSON: {"has_commitment":true/false,"commitments":[{"type":"...","description":"...","due_within_hours":null}]}`

/**
 * Scan an agent response for implicit commitments.
 * Uses a fast LLM (classify model) to detect promises.
 * Fire-and-forget: errors are logged but don't affect the pipeline.
 */
export async function detectCommitments(
  responseText: string,
  contactId: string,
  sessionId: string,
  registry: Registry,
  engineConfig: EngineConfig,
  proactiveConfig: ProactiveConfig,
): Promise<void> {
  if (!proactiveConfig.commitments.enabled) return
  if (!responseText || responseText.length < 20) return

  const memMgr = registry.getOptional<MemoryManager>('memory:manager')
  if (!memMgr) return

  // Check if any commitments were already created by the tool in this session
  // (don't double-detect what the evaluator already handled)
  try {
    const existing = await memMgr.getPendingCommitments(contactId)
    // If a commitment was created in the last 30 seconds, the tool handled it
    const recentCutoff = Date.now() - 30_000
    const recentlyCreated = existing.some(c => c.createdVia === 'tool' && c.createdAt.getTime() > recentCutoff)
    if (recentlyCreated) {
      logger.debug({ contactId }, 'Skipping auto-detect: tool commitment recently created')
      return
    }
  } catch {
    // Continue anyway
  }

  try {
    const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
    const systemPrompt = promptsSvc
      ? (await promptsSvc.getSystemPrompt('commitment-detector-system')) || DETECTOR_SYSTEM_FALLBACK
      : DETECTOR_SYSTEM_FALLBACK

    const result = await callLLMWithFallback(
      {
        task: 'commitment-detect',
        provider: engineConfig.classifyProvider,
        model: engineConfig.classifyModel,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Agent response:\n"${responseText}"` }],
        maxTokens: 256,
        temperature: 0.1,
      },
      engineConfig.fallbackClassifyProvider,
      engineConfig.fallbackClassifyModel,
    )

    // Parse response
    let jsonStr = result.text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const parsed = JSON.parse(jsonStr) as {
      has_commitment: boolean
      commitments: Array<{ type: string; description: string; due_within_hours?: number | null; scheduled_at_hours?: number | null; category?: string | null }>
    }

    if (!parsed.has_commitment || !Array.isArray(parsed.commitments) || parsed.commitments.length === 0) {
      return
    }

    // Validate and save each detected commitment
    for (const detected of parsed.commitments) {
      const validation = validateCommitment(
        {
          type: detected.type,
          description: detected.description,
          contactId,
          sessionId,
          dueWithinHours: detected.due_within_hours ?? undefined,
          scheduledAtHours: detected.scheduled_at_hours ?? undefined,
          category: detected.category ?? undefined,
        },
        proactiveConfig,
        'auto_detect',
      )

      if (validation.status === 'rejected') {
        logger.debug({ reason: validation.reason, description: detected.description }, 'Auto-detected commitment rejected')
        continue
      }

      const commitmentId = await memMgr.saveCommitment(validation.commitment)
      logger.info({
        commitmentId,
        type: validation.commitment.commitmentType,
        category: validation.status,
        contactId,
        createdVia: 'auto_detect',
      }, 'Commitment auto-detected and saved')
    }
  } catch (err) {
    // Fire-and-forget: log and continue
    logger.warn({ err, contactId }, 'Commitment auto-detection failed')
  }
}
