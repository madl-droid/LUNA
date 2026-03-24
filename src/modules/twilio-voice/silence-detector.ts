// LUNA — Module: twilio-voice — Silence Detector
// Monitorea silencio por llamada usando VAD (Voice Activity Detection) simple.
// Dispara prompt cuando el caller no habla por un tiempo configurable.

import pino from 'pino'
import { calculateRms } from './audio-converter.js'

const logger = pino({ name: 'twilio-voice:silence' })

/** RMS threshold below which audio is considered silence */
const SILENCE_RMS_THRESHOLD = 200

export type SilenceState = 'listening' | 'prompting' | 'final-warning'

export type SilenceEvents = {
  onSilenceDetected: (callId: string) => void
  onFinalSilence: (callId: string) => void
}

interface CallSilenceState {
  state: SilenceState
  lastVoiceActivity: number
  timer: ReturnType<typeof setTimeout> | null
}

export class SilenceDetector {
  private calls = new Map<string, CallSilenceState>()
  private timeoutMs: number
  private events: SilenceEvents

  constructor(timeoutMs: number, events: SilenceEvents) {
    this.timeoutMs = timeoutMs
    this.events = events
  }

  /**
   * Start monitoring a call for silence.
   */
  startMonitoring(callId: string): void {
    this.calls.set(callId, {
      state: 'listening',
      lastVoiceActivity: Date.now(),
      timer: this.createTimer(callId),
    })
  }

  /**
   * Feed audio data for VAD analysis.
   * Call this with PCM 16-bit audio from each Twilio media frame.
   */
  feedAudio(callId: string, pcmBuffer: Buffer): void {
    const callState = this.calls.get(callId)
    if (!callState) return

    const rms = calculateRms(pcmBuffer)
    if (rms > SILENCE_RMS_THRESHOLD) {
      // Voice activity detected — reset
      callState.lastVoiceActivity = Date.now()
      if (callState.state !== 'listening') {
        callState.state = 'listening'
        this.resetTimer(callId)
      }
    }
  }

  /**
   * Stop monitoring a call.
   */
  stopMonitoring(callId: string): void {
    const callState = this.calls.get(callId)
    if (callState?.timer) {
      clearTimeout(callState.timer)
    }
    this.calls.delete(callId)
  }

  /**
   * Stop all monitoring (module shutdown).
   */
  stopAll(): void {
    for (const [callId, state] of this.calls) {
      if (state.timer) clearTimeout(state.timer)
      this.calls.delete(callId)
    }
  }

  private createTimer(callId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.handleTimeout(callId)
    }, this.timeoutMs)
  }

  private resetTimer(callId: string): void {
    const callState = this.calls.get(callId)
    if (!callState) return
    if (callState.timer) clearTimeout(callState.timer)
    callState.timer = this.createTimer(callId)
  }

  private handleTimeout(callId: string): void {
    const callState = this.calls.get(callId)
    if (!callState) return

    const silenceDuration = Date.now() - callState.lastVoiceActivity

    if (silenceDuration < this.timeoutMs) {
      // Timer fired but voice was detected since — reschedule
      callState.timer = this.createTimer(callId)
      return
    }

    switch (callState.state) {
      case 'listening':
        callState.state = 'prompting'
        logger.info({ callId, silenceMs: silenceDuration }, 'Silence detected, prompting caller')
        this.events.onSilenceDetected(callId)
        // Set timer for second silence round
        callState.timer = this.createTimer(callId)
        break

      case 'prompting':
        callState.state = 'final-warning'
        logger.info({ callId, silenceMs: silenceDuration }, 'Continued silence after prompt, final warning')
        this.events.onFinalSilence(callId)
        break

      case 'final-warning':
        // Already handled
        break
    }
  }
}
