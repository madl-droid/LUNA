// LUNA — Tests: CheckpointManager
// Unit tests for checkpoint CRUD, step tracking, resume queries, and cleanup.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CheckpointManager } from '../../src/engine/checkpoints/checkpoint-manager.js'
import type { ExecutionStep, StepResult } from '../../src/engine/types.js'

// ─── Mock DB Pool ───────────────────────────

interface MockQuery {
  sql: string
  params: unknown[]
}

function createMockPool() {
  const queries: MockQuery[] = []
  let nextRows: Record<string, unknown>[] = []
  let nextRowCount = 0

  const pool = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] })
      const result = { rows: nextRows, rowCount: nextRowCount }
      // Reset after consumption
      nextRows = []
      nextRowCount = 0
      return Promise.resolve(result)
    }),
  }

  return {
    pool: pool as unknown as import('pg').Pool,
    queries,
    setNextResult(rows: Record<string, unknown>[], rowCount = rows.length) {
      nextRows = rows
      nextRowCount = rowCount
    },
  }
}

// ─── Test Data ──────────────────────────────

const samplePlan: ExecutionStep[] = [
  { type: 'api_call', tool: 'search_knowledge', description: 'Search KB' },
  { type: 'api_call', tool: 'check_calendar', description: 'Check availability', dependsOn: [0] },
]

const sampleStepResult: StepResult = {
  stepIndex: 0,
  type: 'api_call',
  success: true,
  data: { found: true },
  durationMs: 150,
}

const sampleCheckpointRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  trace_id: 'trace-abc',
  message_id: 'msg-123',
  contact_id: 'contact-456',
  channel: 'whatsapp',
  status: 'running',
  message_from: '5215512345678@s.whatsapp.net',
  message_text: 'Quiero agendar una cita',
  execution_plan: samplePlan,
  step_results: [sampleStepResult],
  error: null,
  created_at: new Date('2026-03-29T10:00:00Z'),
  updated_at: new Date('2026-03-29T10:00:01Z'),
}

// ─── Tests ──────────────────────────────────

describe('CheckpointManager', () => {
  let mgr: CheckpointManager
  let mock: ReturnType<typeof createMockPool>

  beforeEach(() => {
    mock = createMockPool()
    mgr = new CheckpointManager(mock.pool)
  })

  // ─── create() ───────────────────────

  describe('create', () => {
    it('inserts checkpoint and returns id', async () => {
      mock.setNextResult([{ id: 'new-uuid' }])

      const id = await mgr.create({
        traceId: 'trace-1',
        messageId: 'msg-1',
        contactId: 'contact-1',
        channel: 'whatsapp',
        messageFrom: '5215500000000@s.whatsapp.net',
        senderName: 'Juan',
        channelMessageId: 'wa-msg-1',
        messageText: 'Hola quiero info',
        executionPlan: samplePlan,
      })

      expect(id).toBe('new-uuid')
      expect(mock.queries).toHaveLength(1)

      const q = mock.queries[0]!
      expect(q.sql).toContain('INSERT INTO task_checkpoints')
      expect(q.params[0]).toBe('trace-1')        // trace_id
      expect(q.params[1]).toBe('msg-1')           // message_id
      expect(q.params[2]).toBe('contact-1')       // contact_id
      expect(q.params[3]).toBe('whatsapp')        // channel
      expect(q.params[4]).toBe('5215500000000@s.whatsapp.net') // message_from
      expect(q.params[5]).toBe('Juan')             // sender_name
      expect(q.params[6]).toBe('wa-msg-1')         // channel_message_id
      expect(q.params[7]).toBe('Hola quiero info') // message_text
      expect(JSON.parse(q.params[8] as string)).toHaveLength(2) // execution_plan
    })

    it('truncates message_text to 1000 chars', async () => {
      mock.setNextResult([{ id: 'uuid-2' }])
      const longText = 'x'.repeat(2000)

      await mgr.create({
        traceId: 't', messageId: 'm', contactId: null, channel: 'gmail',
        messageFrom: 'user@test.com', senderName: '', channelMessageId: '',
        messageText: longText, executionPlan: [],
      })

      const savedText = mock.queries[0]!.params[7] as string
      expect(savedText.length).toBe(1000)
    })

    it('handles null messageText', async () => {
      mock.setNextResult([{ id: 'uuid-3' }])

      await mgr.create({
        traceId: 't', messageId: 'm', contactId: null, channel: 'whatsapp',
        messageFrom: 'from', senderName: '', channelMessageId: '',
        messageText: null, executionPlan: [],
      })

      // null stays null (preserve semantic distinction)
      expect(mock.queries[0]!.params[7]).toBeNull()
    })

    it('returns empty string if INSERT returns no rows', async () => {
      mock.setNextResult([]) // no RETURNING

      const id = await mgr.create({
        traceId: 't', messageId: 'm', contactId: null, channel: 'whatsapp',
        messageFrom: 'f', senderName: '', channelMessageId: '',
        messageText: null, executionPlan: [],
      })

      expect(id).toBe('')
    })
  })

  // ─── appendStep() ──────────────────

  describe('appendStep', () => {
    it('appends step result as JSONB array', async () => {
      await mgr.appendStep('cp-1', sampleStepResult)

      expect(mock.queries).toHaveLength(1)
      const q = mock.queries[0]!
      expect(q.sql).toContain('step_results = step_results || $2::jsonb')
      expect(q.sql).toContain("status = 'running'")
      expect(q.params[0]).toBe('cp-1')

      // Should be wrapped in array for jsonb concat
      const parsed = JSON.parse(q.params[1] as string)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].stepIndex).toBe(0)
      expect(parsed[0].success).toBe(true)
    })

    it('serializes step data correctly', async () => {
      const step: StepResult = {
        stepIndex: 2,
        type: 'workflow',
        success: false,
        error: 'Tool not found',
        durationMs: 50,
      }

      await mgr.appendStep('cp-2', step)

      const parsed = JSON.parse(mock.queries[0]!.params[1] as string)
      expect(parsed[0].type).toBe('workflow')
      expect(parsed[0].error).toBe('Tool not found')
      expect(parsed[0].data).toBeUndefined()
    })
  })

  // ─── complete() / fail() ───────────

  describe('complete', () => {
    it('sets status to completed', async () => {
      await mgr.complete('cp-done')

      const q = mock.queries[0]!
      expect(q.sql).toContain("status = 'completed'")
      expect(q.params[0]).toBe('cp-done')
    })
  })

  describe('fail', () => {
    it('sets status and error', async () => {
      await mgr.fail('cp-err', 'Pipeline timeout after 120000ms')

      const q = mock.queries[0]!
      expect(q.sql).toContain("status = 'failed'")
      expect(q.params[1]).toBe('Pipeline timeout after 120000ms')
    })

    it('truncates error to 2000 chars', async () => {
      const longError = 'E'.repeat(5000)
      await mgr.fail('cp-err', longError)

      const savedError = mock.queries[0]!.params[1] as string
      expect(savedError.length).toBe(2000)
    })
  })

  // ─── findIncomplete() ─────────────

  describe('findIncomplete', () => {
    it('queries running checkpoints within time window', async () => {
      mock.setNextResult([sampleCheckpointRow])

      const results = await mgr.findIncomplete(300000)

      expect(mock.queries).toHaveLength(1)
      const q = mock.queries[0]!
      expect(q.sql).toContain("status = 'running'")
      expect(q.sql).toContain('milliseconds')
      expect(q.params[0]).toBe('300000')
      expect(results).toHaveLength(1)
    })

    it('maps DB row to TaskCheckpoint correctly', async () => {
      mock.setNextResult([sampleCheckpointRow])

      const results = await mgr.findIncomplete(300000)
      const cp = results[0]!

      expect(cp.id).toBe(sampleCheckpointRow.id)
      expect(cp.traceId).toBe('trace-abc')
      expect(cp.messageId).toBe('msg-123')
      expect(cp.contactId).toBe('contact-456')
      expect(cp.channel).toBe('whatsapp')
      expect(cp.status).toBe('running')
      expect(cp.messageFrom).toBe('5215512345678@s.whatsapp.net')
      expect(cp.messageText).toBe('Quiero agendar una cita')
      expect(cp.executionPlan).toEqual(samplePlan)
      expect(cp.stepResults).toEqual([sampleStepResult])
      expect(cp.error).toBeNull()
    })

    it('returns empty array when no incomplete checkpoints', async () => {
      mock.setNextResult([])
      const results = await mgr.findIncomplete(300000)
      expect(results).toEqual([])
    })
  })

  // ─── expireStale() ────────────────

  describe('expireStale', () => {
    it('marks old running checkpoints as failed', async () => {
      mock.setNextResult([], 3)

      const count = await mgr.expireStale(300000)

      expect(count).toBe(3)
      const q = mock.queries[0]!
      expect(q.sql).toContain("status = 'failed'")
      expect(q.sql).toContain("status = 'running'")
      expect(q.sql).toContain('milliseconds')
    })

    it('returns 0 when nothing to expire', async () => {
      mock.setNextResult([], 0)
      const count = await mgr.expireStale(300000)
      expect(count).toBe(0)
    })
  })

  // ─── cleanup() ────────────────────

  describe('cleanup', () => {
    it('deletes old completed/failed checkpoints', async () => {
      mock.setNextResult([], 12)

      const count = await mgr.cleanup(7)

      expect(count).toBe(12)
      const q = mock.queries[0]!
      expect(q.sql).toContain('DELETE FROM task_checkpoints')
      expect(q.sql).toContain("('completed', 'failed')")
      expect(q.sql).toContain('days')
      expect(q.params[0]).toBe('7')
    })
  })
})
