// LUNA — Module: twilio-voice — Silence Detector
// Monitorea silencio por llamada usando VAD (Voice Activity Detection) simple.
// Solo reacciona a silencio real del usuario: el countdown solo corre cuando
// es el turno del usuario de hablar (Gemini ya terminó su turno).

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
  /** Timestamp of last detected voice activity from the caller */
  lastVoiceActivity: number
  /** Silence countdown timer — only runs when it's the user's turn */
  timer: ReturnType<typeof setTimeout> | null
  /** true once the caller has spoken at least once */
  callerHasSpoken: boolean
  /** true while Gemini is producing audio — timer is paused during this */
  agentSpeaking: boolean
}

export class SilenceDetector {
  private calls = new Map<string, CallSilenceState>()
  private timeoutMs: number
  private rmsThreshold: number
  private events: SilenceEvents

  constructor(
    timeoutMs: number,
    _postGreetingTimeoutMs: number, // kept for API compat, no longer used
    rmsThreshold: number,
    events: SilenceEvents,
  ) {
    this.timeoutMs = timeoutMs
    this.rmsThreshold = rmsThreshold || DEFAULT_SILENCE_RMS_THRESHOLD
    this.events = events
  }

  /**
   * Start monitoring a call for silence.
   * No timer starts here — the countdown only begins after the agent finishes
   * a turn AND the caller has spoken at least once.
   */
  startMonitoring(callId: string): void {
    this.calls.set(callId, {
      state: 'listening',
      lastVoiceActivity: 0,
      timer: null,
      callerHasSpoken: false,
      agentSpeaking: false,
    })
    logger.info({ callId }, 'Silence monitoring registered (waiting for conversation to start)')
  }

  /**
   * Notify that the agent started producing audio.
   * Pauses the silence countdown — caller shouldn't be expected to talk
   * while the agent is speaking.
   */
  agentStartedSpeaking(callId: string): void {
    const state = this.calls.get(callId)
    if (!state) return
    state.agentSpeaking = true
    // Clear any running timer — don't count silence while agent talks
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
  }

  /**
   * Notify that the agent finished its turn.
   * NOW it's the user's turn — start the silence countdown.
   */
  agentTurnComplete(callId: string): void {
    const state = this.calls.get(callId)
    if (!state) return
    state.agentSpeaking = false
    state.state = 'listening'
    // Start the silence countdown: it's the user's turn to speak
    state.lastVoiceActivity = Date.now()
    this.resetTimer(callId)
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

      // First voice from caller
      if (!callState.callerHasSpoken) {
        callState.callerHasSpoken = true
        logger.info({ callId }, 'Caller spoke for the first time')
      }

      // Reset escalation state if caller was being prompted
      if (callState.state !== 'listening') {
        callState.state = 'listening'
      }

      // Restart the silence countdown (only if agent isn't speaking)
      if (!callState.agentSpeaking) {
        this.resetTimer(callId)
      }
    }
  }

  /**
   * @deprecated Use agentTurnComplete() instead. Kept for API compat.
   */
  resetState(callId: string): void {
    this.agentTurnComplete(callId)
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

  private resetTimer(callId: string): void {
    const callState = this.calls.get(callId)
    if (!callState) return
    if (callState.timer) clearTimeout(callState.timer)
    callState.timer = setTimeout(() => {
      this.handleTimeout(callId)
    }, this.timeoutMs)
  }

  private handleTimeout(callId: string): void {
    const callState = this.calls.get(callId)
    if (!callState) return

    // Don't trigger if agent is speaking — the user is just listening
    if (callState.agentSpeaking) return

    // Safety check: verify silence actually exceeds threshold
    const msSinceVoice = Date.now() - callState.lastVoiceActivity
    if (msSinceVoice < this.timeoutMs) {
      this.resetTimer(callId)
      return
    }

    switch (callState.state) {
      case 'listening':
        callState.state = 'prompting'
        logger.info({ callId, silenceMs: msSinceVoice }, 'User silence detected, prompting caller')
        this.events.onSilenceDetected(callId)
        // Set timer for second silence round
        this.resetTimer(callId)
        break

      case 'prompting':
        callState.state = 'final-warning'
        logger.info({ callId, silenceMs: msSinceVoice }, 'Continued silence after prompt, final warning')
        this.events.onFinalSilence(callId)
        break

      case 'final-warning':
        // Already handled
        break
    }
  }
}
