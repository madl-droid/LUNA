// LUNA — Module: twilio-voice — Silence Detector
// Monitorea silencio por llamada usando VAD (Voice Activity Detection) simple.
// Dispara prompt cuando el caller no habla por un tiempo configurable.

import pino from 'pino'
import { calculateRms } from './audio-converter.js'

const logger = pino({ name: 'twilio-voice:silence' })

/** Default RMS threshold below which audio is considered silence */
const DEFAULT_SILENCE_RMS_THRESHOLD = 200

export type SilenceState = 'listening' | 'prompting' | 'final-warning'

export type SilenceEvents = {
  onSilenceDetected: (callId: string) => void
  onFinalSilence: (callId: string) => void
}

interface CallSilenceState {
  state: SilenceState
  lastVoiceActivity: number
  timer: ReturnType<typeof setTimeout> | null
  isPostGreeting: boolean // true until caller speaks for the first time
}

export class SilenceDetector {
  private calls = new Map<string, CallSilenceState>()
  private timeoutMs: number
  private postGreetingTimeoutMs: number
  private rmsThreshold: number
  private events: SilenceEvents

  constructor(
    timeoutMs: number,
    postGreetingTimeoutMs: number,
    rmsThreshold: number,
    events: SilenceEvents,
  ) {
    this.timeoutMs = timeoutMs
    this.postGreetingTimeoutMs = postGreetingTimeoutMs
    this.rmsThreshold = rmsThreshold || DEFAULT_SILENCE_RMS_THRESHOLD
    this.events = events
  }

  /**
   * Start monitoring a call for silence.
   * Always starts in post-greeting mode (extended timeout) until caller first speaks.
   */
  startMonitoring(callId: string): void {
    this.calls.set(callId, {
      state: 'listening',
      lastVoiceActivity: Date.now(),
      timer: null,
      isPostGreeting: true,
    })
    const state = this.calls.get(callId)!
    state.timer = this.createTimer(callId)
  }

  /**
   * Feed audio data for VAD analysis.
   * Call this with PCM 16-bit audio from each Twilio media frame.
   */
  feedAudio(callId: string, pcmBuffer: Buffer): void {
    const callState = this.calls.get(callId)
    if (!callState) return

    const rms = calculateRms(pcmBuffer)
    if (rms > this.rmsThreshold) {
      // Voice activity detected — update timestamp
      callState.lastVoiceActivity = Date.now()

      // First voice from caller → switch from post-greeting to normal timeout
      if (callState.isPostGreeting) {
        callState.isPostGreeting = false
        logger.debug({ callId }, 'Caller spoke, switching to normal silence timeout')
      }

      if (callState.state !== 'listening') {
        callState.state = 'listening'
        this.resetTimer(callId)
      }
    }
  }

  /**
   * Reset state machine to 'listening' and restart timer.
   * Call this when Gemini completes a turn (conversation flowing normally)
   * to prevent stale state accumulation between turns.
   */
  resetState(callId: string): void {
    const state = this.calls.get(callId)
    if (!state) return
    state.state = 'listening'
    this.resetTimer(callId)
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
    const state = this.calls.get(callId)
    const timeout = state?.isPostGreeting ? this.postGreetingTimeoutMs : this.timeoutMs
    return setTimeout(() => {
      this.handleTimeout(callId)
    }, timeout)
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

    // DEBOUNCE: if there was recent voice activity, restart timer instead of escalating
    const msSinceVoice = Date.now() - callState.lastVoiceActivity
    const currentTimeout = callState.isPostGreeting ? this.postGreetingTimeoutMs : this.timeoutMs

    if (callState.lastVoiceActivity > 0 && msSinceVoice < currentTimeout) {
      callState.timer = this.createTimer(callId)
      return
    }

    const silenceDuration = Date.now() - callState.lastVoiceActivity

    switch (callState.state) {
      case 'listening':
        callState.state = 'prompting'
        // After first prompt, switch to normal timeout (post-greeting window is over)
        callState.isPostGreeting = false
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
