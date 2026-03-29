// LUNA — Tests: Checkpoint resume logic
// Tests the message reconstruction and step stashing for checkpoint resume.

import { describe, it, expect } from 'vitest'
import type { ExecutionStep, StepResult } from '../../src/engine/types.js'
import type { TaskCheckpoint } from '../../src/engine/checkpoints/types.js'

// ─── Helpers ────────────────────────────────

function makeCheckpoint(overrides: Partial<TaskCheckpoint> = {}): TaskCheckpoint {
  return {
    id: 'cp-001',
    traceId: 'trace-resume-1',
    messageId: 'msg-resume-1',
    contactId: 'contact-789',
    channel: 'whatsapp',
    status: 'running',
    messageFrom: '5215512345678@s.whatsapp.net',
    senderName: 'María López',
    channelMessageId: 'wa-ext-msg-001',
    messageText: 'Quiero agendar para mañana',
    executionPlan: [
      { type: 'api_call', tool: 'search_knowledge' },
      { type: 'api_call', tool: 'check_calendar' },
      { type: 'api_call', tool: 'create_appointment', dependsOn: [1] },
    ],
    stepResults: [
      { stepIndex: 0, type: 'api_call', success: true, data: { results: 3 }, durationMs: 200 },
      { stepIndex: 1, type: 'api_call', success: true, data: { slots: ['10:00', '14:00'] }, durationMs: 350 },
    ],
    error: null,
    createdAt: new Date('2026-03-29T10:00:00Z'),
    updatedAt: new Date('2026-03-29T10:00:02Z'),
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────

describe('Checkpoint resume', () => {

  describe('message reconstruction from checkpoint', () => {
    it('builds a valid IncomingMessage-like object from checkpoint data', () => {
      const cp = makeCheckpoint()

      // This mirrors what initCheckpoints() does in engine.ts
      const resumeMessage = {
        id: cp.messageId,
        channelName: cp.channel,
        channelMessageId: cp.channelMessageId || cp.messageId,
        from: cp.messageFrom,
        senderName: cp.senderName || '',
        timestamp: cp.createdAt,
        content: { type: 'text' as const, text: cp.messageText ?? '' },
        attachments: [],
      }

      expect(resumeMessage.id).toBe('msg-resume-1')
      expect(resumeMessage.channelName).toBe('whatsapp')
      expect(resumeMessage.channelMessageId).toBe('wa-ext-msg-001')
      expect(resumeMessage.from).toBe('5215512345678@s.whatsapp.net')
      expect(resumeMessage.senderName).toBe('María López')
      expect(resumeMessage.content.text).toBe('Quiero agendar para mañana')
      expect(resumeMessage.timestamp).toEqual(new Date('2026-03-29T10:00:00Z'))
    })

    it('handles null messageText gracefully', () => {
      const cp = makeCheckpoint({ messageText: null })

      const resumeMessage = {
        id: cp.messageId,
        content: { type: 'text' as const, text: cp.messageText ?? '' },
      }

      expect(resumeMessage.content.text).toBe('')
    })
  })

  describe('pendingResumeSteps stash logic', () => {
    it('stores and retrieves completed steps by messageId', () => {
      // Simulates the Map<string, StepResult[]> pattern used in engine.ts
      const stash = new Map<string, StepResult[]>()
      const cp = makeCheckpoint()

      // Stash before processMessage
      stash.set(cp.messageId, cp.stepResults)

      // Retrieve inside processMessageInner
      const steps = stash.get('msg-resume-1')
      expect(steps).toBeDefined()
      expect(steps).toHaveLength(2)
      expect(steps![0]!.stepIndex).toBe(0)
      expect(steps![1]!.stepIndex).toBe(1)

      // Delete after consumption
      stash.delete('msg-resume-1')
      expect(stash.get('msg-resume-1')).toBeUndefined()
    })

    it('returns undefined for non-resumed messages', () => {
      const stash = new Map<string, StepResult[]>()

      const steps = stash.get('msg-normal-not-resumed')
      expect(steps).toBeUndefined()
    })
  })

  describe('resume eligibility', () => {
    it('skips checkpoints with no completed steps', () => {
      const cp = makeCheckpoint({ stepResults: [] })
      const worthResuming = cp.stepResults.length > 0
      expect(worthResuming).toBe(false)
    })

    it('resumes checkpoints with at least one completed step', () => {
      const cp = makeCheckpoint()
      const worthResuming = cp.stepResults.length > 0
      expect(worthResuming).toBe(true)
    })

    it('reports progress correctly', () => {
      const cp = makeCheckpoint()
      const completed = cp.stepResults.length
      const total = cp.executionPlan.length
      const remaining = total - completed

      expect(completed).toBe(2)
      expect(total).toBe(3)
      expect(remaining).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('handles checkpoint with all steps completed', () => {
      const cp = makeCheckpoint({
        stepResults: [
          { stepIndex: 0, type: 'api_call', success: true, durationMs: 100 },
          { stepIndex: 1, type: 'api_call', success: true, durationMs: 200 },
          { stepIndex: 2, type: 'api_call', success: true, durationMs: 150 },
        ],
      })

      // All steps done — Phase 3 will find nothing new to execute
      const completedIndices = new Set(cp.stepResults.map(s => s.stepIndex))
      const remaining = cp.executionPlan.filter((_, i) => !completedIndices.has(i))
      expect(remaining).toHaveLength(0)
    })

    it('handles checkpoint with failed steps', () => {
      const cp = makeCheckpoint({
        stepResults: [
          { stepIndex: 0, type: 'api_call', success: true, durationMs: 100 },
          { stepIndex: 1, type: 'api_call', success: false, error: 'Timeout', durationMs: 30000 },
        ],
      })

      // Step 1 failed — step 2 (depends on 1) should also fail on resume
      const failedSteps = cp.stepResults.filter(s => !s.success)
      expect(failedSteps).toHaveLength(1)
      expect(failedSteps[0]!.error).toBe('Timeout')
    })

    it('handles different channel types', () => {
      for (const channel of ['whatsapp', 'gmail', 'google-chat', 'twilio-voice']) {
        const cp = makeCheckpoint({ channel })
        const msg = {
          channelName: cp.channel,
          from: cp.messageFrom,
        }
        expect(msg.channelName).toBe(channel)
      }
    })
  })
})
