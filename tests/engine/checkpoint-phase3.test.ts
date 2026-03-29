// LUNA — Tests: Phase 3 checkpoint integration
// Tests that completed steps are correctly skipped and validated during resume.

import { describe, it, expect } from 'vitest'
import type { ExecutionStep, StepResult } from '../../src/engine/types.js'

// ─── Extracted logic under test ─────────────
// We test the step-validation logic that Phase 3 uses to decide which
// completed steps to trust. This mirrors the code in phase3-execute.ts
// without needing the full Phase 3 infrastructure.

function validateCompletedSteps(
  executionPlan: ExecutionStep[],
  completedSteps: StepResult[],
): { validIndices: Set<number>; validSteps: StepResult[]; discarded: number } {
  const validIndices = new Set<number>()
  const validSteps: StepResult[] = []
  let discarded = 0

  for (const sr of completedSteps) {
    const planStep = executionPlan[sr.stepIndex]
    if (planStep && planStep.type === sr.type && (planStep.tool ?? undefined) === (sr.tool ?? undefined)) {
      validIndices.add(sr.stepIndex)
      validSteps.push(sr)
    } else {
      discarded++
    }
  }

  return { validIndices, validSteps, discarded }
}

// ─── Test Data ──────────────────────────────

const plan: ExecutionStep[] = [
  { type: 'api_call', tool: 'search_knowledge', description: 'Search KB' },
  { type: 'api_call', tool: 'check_calendar', description: 'Check availability' },
  { type: 'workflow', tool: 'create_event', description: 'Create calendar event', dependsOn: [1] },
]

function makeStepResult(index: number, type: ExecutionStep['type'], success = true, tool?: string): StepResult {
  return { stepIndex: index, type, tool, success, durationMs: 100, data: { mock: true } }
}

// ─── Tests ──────────────────────────────────

describe('Phase 3 checkpoint step validation', () => {

  describe('validateCompletedSteps', () => {
    it('accepts steps whose type and tool match the plan', () => {
      const completed = [
        makeStepResult(0, 'api_call', true, 'search_knowledge'),
        makeStepResult(1, 'api_call', true, 'check_calendar'),
      ]

      const { validIndices, validSteps, discarded } = validateCompletedSteps(plan, completed)

      expect(validIndices.size).toBe(2)
      expect(validIndices.has(0)).toBe(true)
      expect(validIndices.has(1)).toBe(true)
      expect(validSteps).toHaveLength(2)
      expect(discarded).toBe(0)
    })

    it('discards steps whose type does NOT match the plan', () => {
      // Step 0 claims to be 'workflow' but plan has 'api_call' at index 0
      const completed = [
        makeStepResult(0, 'workflow', true, 'search_knowledge'),
        makeStepResult(1, 'api_call', true, 'check_calendar'),
      ]

      const { validIndices, validSteps, discarded } = validateCompletedSteps(plan, completed)

      expect(validIndices.size).toBe(1)
      expect(validIndices.has(0)).toBe(false)
      expect(validIndices.has(1)).toBe(true)
      expect(validSteps).toHaveLength(1)
      expect(discarded).toBe(1)
    })

    it('discards steps with out-of-bounds index', () => {
      const completed = [
        makeStepResult(0, 'api_call', true, 'search_knowledge'),
        makeStepResult(99, 'api_call', true, 'unknown_tool'), // plan only has 3 steps
      ]

      const { validIndices, discarded } = validateCompletedSteps(plan, completed)

      expect(validIndices.size).toBe(1)
      expect(validIndices.has(99)).toBe(false)
      expect(discarded).toBe(1)
    })

    it('handles empty completed steps', () => {
      const { validIndices, validSteps, discarded } = validateCompletedSteps(plan, [])

      expect(validIndices.size).toBe(0)
      expect(validSteps).toHaveLength(0)
      expect(discarded).toBe(0)
    })

    it('handles all steps already completed', () => {
      const completed = [
        makeStepResult(0, 'api_call', true, 'search_knowledge'),
        makeStepResult(1, 'api_call', true, 'check_calendar'),
        makeStepResult(2, 'workflow', true, 'create_event'),
      ]

      const { validIndices, validSteps } = validateCompletedSteps(plan, completed)

      expect(validIndices.size).toBe(3)
      expect(validSteps).toHaveLength(3)
    })

    it('discards steps whose tool does NOT match (same type)', () => {
      // Both are api_call but different tools — should be discarded
      const completed = [
        makeStepResult(0, 'api_call', true, 'wrong_tool'),
        makeStepResult(1, 'api_call', true, 'check_calendar'),
      ]

      const { validIndices, discarded } = validateCompletedSteps(plan, completed)

      expect(validIndices.size).toBe(1)
      expect(validIndices.has(0)).toBe(false) // tool mismatch
      expect(validIndices.has(1)).toBe(true)  // tool matches
      expect(discarded).toBe(1)
    })

    it('discards ALL steps when plan changed completely', () => {
      const newPlan: ExecutionStep[] = [
        { type: 'memory_lookup', description: 'Different plan entirely' },
        { type: 'subagent', description: 'Also different' },
      ]

      const completed = [
        makeStepResult(0, 'api_call', true, 'search_knowledge'),
        makeStepResult(1, 'api_call', true, 'check_calendar'),
      ]

      const { validIndices, discarded } = validateCompletedSteps(newPlan, completed)

      expect(validIndices.size).toBe(0)
      expect(discarded).toBe(2)
    })
  })

  describe('step skipping logic', () => {
    it('independent steps filter out completed indices', () => {
      const completedIndices = new Set([0, 1])
      const independent = [
        { step: plan[0]!, index: 0 },
        { step: plan[1]!, index: 1 },
      ]

      const toRun = independent.filter(({ index }) => !completedIndices.has(index))
      expect(toRun).toHaveLength(0)
    })

    it('dependent steps skip completed indices', () => {
      const completedIndices = new Set([0])
      const dependent = [
        { step: plan[2]!, index: 2 },
      ]

      const toRun = dependent.filter(({ index }) => !completedIndices.has(index))
      expect(toRun).toHaveLength(1)
      expect(toRun[0]!.index).toBe(2)
    })

    it('dependency check works with pre-loaded completed results', () => {
      const completedSteps = [makeStepResult(1, 'api_call', true, 'check_calendar')]
      const results: StepResult[] = [...completedSteps]

      // Step 2 depends on step 1 — check if dependency succeeded
      const step2 = plan[2]!
      const depsFailed = step2.dependsOn?.some(depIdx => {
        const depResult = results.find(r => r.stepIndex === depIdx)
        return depResult && !depResult.success
      })

      expect(depsFailed).toBe(false) // dependency step 1 succeeded
    })

    it('dependency check catches failed pre-loaded steps', () => {
      const completedSteps = [makeStepResult(1, 'api_call', false, 'check_calendar')] // step 1 FAILED
      const results: StepResult[] = [...completedSteps]

      const step2 = plan[2]!
      const depsFailed = step2.dependsOn?.some(depIdx => {
        const depResult = results.find(r => r.stepIndex === depIdx)
        return depResult && !depResult.success
      })

      expect(depsFailed).toBe(true) // dependency step 1 failed
    })
  })
})
