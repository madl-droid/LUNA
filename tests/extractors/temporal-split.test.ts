// LUNA — Tests — Temporal Splitter
// Verifica el algoritmo de segmentación temporal de audio/video.
// Config: audio 60/60/10 — video 50/60/10

import { describe, it, expect } from 'vitest'
import {
  calculateSegments,
  AUDIO_SPLIT_CONFIG,
  VIDEO_SPLIT_CONFIG,
} from '../../src/modules/knowledge/extractors/temporal-splitter.js'

describe('calculateSegments', () => {
  // ═══════════════════════════════════════════
  // Audio config: first=60s, subsequent=60s, overlap=10s
  // ═══════════════════════════════════════════

  describe('audio config (60/60/10)', () => {
    it('returns empty for 0 duration', () => {
      expect(calculateSegments(0, AUDIO_SPLIT_CONFIG)).toEqual([])
    })

    it('returns empty for negative duration', () => {
      expect(calculateSegments(-5, AUDIO_SPLIT_CONFIG)).toEqual([])
    })

    it('returns single segment for audio < 60s', () => {
      const segments = calculateSegments(45, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 45 })
    })

    it('returns single segment for exactly 60s', () => {
      const segments = calculateSegments(60, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
    })

    it('splits 130s audio into 3 segments (60/60/10 config)', () => {
      // Algorithm (subsequentSeconds=60, overlap=10):
      // 1. Push {0, 60}. 60 < 130.
      // 2. start=50, end=min(110, 130)=110. Push {50, 110}. 110 < 130.
      // 3. start=100, end=min(160, 130)=130. Push {100, 130}. break.
      const segments = calculateSegments(130, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
      expect(segments[1]).toEqual({ startSeconds: 50, endSeconds: 110 })
      expect(segments[2]).toEqual({ startSeconds: 100, endSeconds: 130 })
    })

    it('splits 200s audio into 4 segments', () => {
      // 1. {0, 60}. start=50.
      // 2. {50, 110}. start=100.
      // 3. {100, 160}. start=150.
      // 4. {150, 200}. break.
      const segments = calculateSegments(200, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(4)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
      expect(segments[1]).toEqual({ startSeconds: 50, endSeconds: 110 })
      expect(segments[2]).toEqual({ startSeconds: 100, endSeconds: 160 })
      expect(segments[3]).toEqual({ startSeconds: 150, endSeconds: 200 })
    })

    it('overlap is exactly 10 seconds between consecutive segments', () => {
      const segments = calculateSegments(300, AUDIO_SPLIT_CONFIG)
      // Check all overlaps
      for (let i = 1; i < segments.length; i++) {
        const overlap = segments[i - 1]!.endSeconds - segments[i]!.startSeconds
        expect(overlap).toBe(10)
      }
    })

    it('all seconds covered (no gaps)', () => {
      const duration = 500
      const segments = calculateSegments(duration, AUDIO_SPLIT_CONFIG)

      // First segment starts at 0
      expect(segments[0]!.startSeconds).toBe(0)
      // Last segment ends at duration
      expect(segments.at(-1)!.endSeconds).toBe(duration)

      // Each segment's start is before the previous segment's end (overlap)
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i]!.startSeconds).toBeLessThan(segments[i - 1]!.endSeconds)
      }
    })

    it('segments start at 0 and end at duration boundary', () => {
      const duration = 750
      const segments = calculateSegments(duration, AUDIO_SPLIT_CONFIG)
      expect(segments[0]!.startSeconds).toBe(0)
      expect(segments.at(-1)!.endSeconds).toBe(duration)
    })

    it('short audio (< firstChunkSeconds) produces exactly 1 segment', () => {
      for (const dur of [1, 10, 30, 59]) {
        const segments = calculateSegments(dur, AUDIO_SPLIT_CONFIG)
        expect(segments).toHaveLength(1)
        expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: dur })
      }
    })
  })

  // ═══════════════════════════════════════════
  // Video config: first=50s, subsequent=60s, overlap=10s
  // ═══════════════════════════════════════════

  describe('video config (50/60/10)', () => {
    it('returns empty for 0 duration', () => {
      expect(calculateSegments(0, VIDEO_SPLIT_CONFIG)).toEqual([])
    })

    it('returns single segment for video <= 50s', () => {
      const segments = calculateSegments(40, VIDEO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 40 })
    })

    it('returns single segment for exactly 50s', () => {
      const segments = calculateSegments(50, VIDEO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 50 })
    })

    it('splits 120s video into 3 segments', () => {
      // 1. {0, 50}. start=40.
      // 2. {40, 100}. start=90.
      // 3. {90, 120}. break.
      const segments = calculateSegments(120, VIDEO_SPLIT_CONFIG)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 50 })
      expect(segments[1]).toEqual({ startSeconds: 40, endSeconds: 100 })
      expect(segments[2]).toEqual({ startSeconds: 90, endSeconds: 120 })
    })

    it('overlap is exactly 10 seconds between consecutive video segments', () => {
      const segments = calculateSegments(250, VIDEO_SPLIT_CONFIG)
      for (let i = 1; i < segments.length; i++) {
        const overlap = segments[i - 1]!.endSeconds - segments[i]!.startSeconds
        expect(overlap).toBe(10)
      }
    })

    it('all seconds covered for long video', () => {
      const duration = 600
      const segments = calculateSegments(duration, VIDEO_SPLIT_CONFIG)
      expect(segments[0]!.startSeconds).toBe(0)
      expect(segments.at(-1)!.endSeconds).toBe(duration)
    })
  })

  // ═══════════════════════════════════════════
  // Config constants
  // ═══════════════════════════════════════════

  describe('config constants', () => {
    it('AUDIO_SPLIT_CONFIG has correct values', () => {
      expect(AUDIO_SPLIT_CONFIG.firstChunkSeconds).toBe(60)
      expect(AUDIO_SPLIT_CONFIG.subsequentSeconds).toBe(60)
      expect(AUDIO_SPLIT_CONFIG.overlapSeconds).toBe(10)
    })

    it('VIDEO_SPLIT_CONFIG has correct values', () => {
      expect(VIDEO_SPLIT_CONFIG.firstChunkSeconds).toBe(50)
      expect(VIDEO_SPLIT_CONFIG.subsequentSeconds).toBe(60)
      expect(VIDEO_SPLIT_CONFIG.overlapSeconds).toBe(10)
    })
  })
})
