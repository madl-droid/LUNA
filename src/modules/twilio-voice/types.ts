// LUNA — Module: twilio-voice — Types
// Tipos para llamadas de voz, estados, eventos Twilio y mensajes Gemini Live.

// ═══════════════════════════════════════════
// Config
// ═══════════════════════════════════════════

export interface TwilioVoiceConfig {
  // Twilio credentials
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  // Gemini Live — API & model
  VOICE_GOOGLE_API_KEY: string
  VOICE_GEMINI_MODEL: string
  VOICE_GEMINI_FALLBACK_MODEL: string
  VOICE_GEMINI_THINKING_LEVEL: string
  VOICE_GEMINI_VOICE: string
  VOICE_GEMINI_LANGUAGE: string
  // Gemini Live — generation config
  VOICE_GEMINI_TEMPERATURE: number
  VOICE_GEMINI_TOP_P: number
  VOICE_GEMINI_TOP_K: number
  VOICE_GEMINI_MAX_OUTPUT_TOKENS: number
  // Gemini Live — VAD (Voice Activity Detection) nativo
  VOICE_VAD_START_SENSITIVITY: string
  VOICE_VAD_END_SENSITIVITY: string
  VOICE_VAD_PREFIX_PADDING_MS: number
  VOICE_VAD_SILENCE_DURATION_MS: number
  VOICE_BARGE_IN_ENABLED: boolean
  VOICE_GEMINI_CONNECTION_TIMEOUT_MS: number
  // Silence detector local (RMS-based)
  VOICE_SILENCE_RMS_THRESHOLD: number
  // Call behavior
  VOICE_PREVIEW_TEXT: string
  VOICE_SILENCE_TIMEOUT_MS: number
  VOICE_POST_GREETING_SILENCE_TIMEOUT_MS: number
  VOICE_SILENCE_MESSAGE: string
  VOICE_GREETING_INBOUND: string
  VOICE_GREETING_OUTBOUND: string
  VOICE_FILLER_MESSAGE: string
  VOICE_GOODBYE_TIMEOUT_MS: number
  VOICE_MAX_CALL_DURATION_MS: number
  VOICE_MAX_CONCURRENT_CALLS: number
  VOICE_ENABLED: boolean
  // Freeze detection
  VOICE_GEMINI_FREEZE_TIMEOUT_MS: number
  // Tool filler + timeout + retry
  VOICE_TOOL_FILLER_DELAY_MS: number
  VOICE_TOOL_TIMEOUT_MS: number
  VOICE_TOOL_MAX_RETRIES: number
  // Channel runtime config (for engine integration)
  VOICE_RATE_LIMIT_HOUR: number
  VOICE_RATE_LIMIT_DAY: number
  VOICE_SESSION_TIMEOUT_HOURS: number
  // Outbound call restrictions
  VOICE_BUSINESS_HOURS_ENABLED: boolean
  VOICE_BUSINESS_HOURS_START: number
  VOICE_BUSINESS_HOURS_END: number
  VOICE_BUSINESS_HOURS_TIMEZONE: string
  VOICE_OUTBOUND_RATE_LIMIT_HOUR: number
  VOICE_INBOUND_RATE_LIMIT_HOUR: number
  // Ring delay range (replaces VOICE_ANSWER_DELAY_RINGS)
  VOICE_ANSWER_DELAY_MIN_RINGS: number
  VOICE_ANSWER_DELAY_MAX_RINGS: number
}

// ═══════════════════════════════════════════
// Call state machine
// ═══════════════════════════════════════════

export type CallDirection = 'inbound' | 'outbound'

export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'no-answer'
  | 'busy'

export type CallEndReason =
  | 'hangup'
  | 'caller-hangup'
  | 'silence'
  | 'goodbye'
  | 'max-duration'
  | 'error'
  | 'busy'
  | 'no-answer'
  | 'gemini_freeze'

export interface ActiveCall {
  callId: string
  callSid: string
  streamSid: string | null
  direction: CallDirection
  from: string
  to: string
  status: CallStatus
  contactId: string | null
  /** Real session ID in the sessions table (set when media stream starts) */
  sessionId: string | null
  startedAt: Date
  connectedAt: Date | null
  geminiVoice: string
  /** Which Gemini model was actually used (primary or fallback) */
  modelUsed: string
  transcript: TranscriptEntry[]
  /** Pre-loaded context (populated during answer delay) */
  preloadedContext: PreloadedContext | null

  // ── Greeting gate ──
  /** false until Gemini completes first turn (inbound). outbound starts as true. */
  greetingDone: boolean

  // ── Freeze detection ──
  /** true while Gemini is producing audio */
  geminiSpeaking: boolean
  /** Timer watching for Gemini freeze (no response after caller speaks) */
  geminiResponseTimer: ReturnType<typeof setTimeout> | null
  /** 0=nothing, 1=re-injected transcript, 2+=hangup */
  geminiFreezeAttempts: number
  /** Last text recognized from caller */
  lastCallerTranscript: string
  /** Timestamp of last raw caller audio chunk */
  lastRawCallerAudioAt: number

  // ── Tool cancel via barge-in ──
  /** IDs of tool calls cancelled by barge-in */
  cancelledToolCalls: Set<string>
}

export interface TranscriptEntry {
  speaker: 'caller' | 'agent' | 'system'
  text: string
  timestampMs: number
}

// ═══════════════════════════════════════════
// Voice engine context
// ═══════════════════════════════════════════

export interface PreloadedContext {
  contactId: string | null
  contactName: string | null
  contactMemory: string | null
  pendingCommitments: string[]
  recentSummaries: string[]
  systemInstruction: string
  tools: GeminiToolDeclaration[]
}

export interface GeminiToolDeclaration {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ═══════════════════════════════════════════
// Twilio Media Stream events
// ═══════════════════════════════════════════

export interface TwilioMediaMessage {
  event: 'media'
  sequenceNumber: string
  streamSid: string
  media: {
    track: 'inbound' | 'outbound'
    chunk: string
    timestamp: string
    payload: string // base64-encoded mulaw audio
  }
}

export interface TwilioStartMessage {
  event: 'start'
  sequenceNumber: string
  streamSid: string
  start: {
    streamSid: string
    accountSid: string
    callSid: string
    tracks: string[]
    mediaFormat: {
      encoding: string
      sampleRate: number
      channels: number
    }
    customParameters: Record<string, string>
  }
}

export interface TwilioStopMessage {
  event: 'stop'
  sequenceNumber: string
  streamSid: string
}

export interface TwilioMarkMessage {
  event: 'mark'
  sequenceNumber: string
  streamSid: string
  mark: { name: string }
}

export type TwilioStreamMessage =
  | TwilioMediaMessage
  | TwilioStartMessage
  | TwilioStopMessage
  | TwilioMarkMessage
  | { event: 'connected'; protocol: string }

// ═══════════════════════════════════════════
// Gemini Live API messages
// ═══════════════════════════════════════════

export interface GeminiLiveConfig {
  apiKey: string
  model: string
  fallbackModel: string
  thinkingLevel: string
  voice: string
  language: string
  systemInstruction: string
  tools: GeminiToolDeclaration[]
  // Generation config
  temperature: number
  topP: number
  topK: number
  maxOutputTokens: number
  // VAD config
  vadStartSensitivity: string
  vadEndSensitivity: string
  vadPrefixPaddingMs: number
  vadSilenceDurationMs: number
  bargeInEnabled: boolean
  connectionTimeoutMs: number
}

export interface GeminiSetupMessage {
  setup: {
    model: string
    generationConfig: {
      responseModalities: string[]
      temperature?: number
      topP?: number
      topK?: number
      maxOutputTokens?: number
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string
          }
        }
        languageCode?: string
      }
      thinkingConfig?: {
        thinkingLevel?: string
        thinkingBudget?: number
      }
    }
    systemInstruction: {
      parts: Array<{ text: string }>
    }
    realtimeInputConfig?: {
      automaticActivityDetection?: {
        disabled?: boolean
        startOfSpeechSensitivity?: string
        endOfSpeechSensitivity?: string
        prefixPaddingMs?: number
        silenceDurationMs?: number
      }
      activityHandling?: string
    }
    outputAudioTranscription?: Record<string, never>
    inputAudioTranscription?: Record<string, never>
    tools?: Array<{
      functionDeclarations: GeminiToolDeclaration[]
    }>
  }
}

export interface GeminiAudioInput {
  realtimeInput: {
    mediaChunks: Array<{
      mimeType: string
      data: string // base64 PCM
    }>
  }
}

export interface GeminiToolResponse {
  toolResponse: {
    functionResponses: Array<{
      id: string
      name: string
      response: Record<string, unknown>
    }>
  }
}

export interface GeminiServerContent {
  serverContent?: {
    modelTurn?: {
      parts: Array<{
        text?: string
        inlineData?: {
          mimeType: string
          data: string // base64 audio
        }
        functionCall?: {
          id: string
          name: string
          args: Record<string, unknown>
        }
      }>
    }
    turnComplete?: boolean
    interrupted?: boolean
    /** Native transcription: what Gemini said (agent audio transcribed) */
    outputTranscription?: {
      text?: string
      finished?: boolean
    }
    /** Native transcription: what the caller said (input audio transcribed) */
    inputTranscription?: {
      text?: string
      finished?: boolean
    }
  }
  toolCall?: {
    functionCalls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
    }>
  }
  /** Tool calls cancelled due to barge-in */
  toolCallCancellation?: {
    ids: string[]
  }
  setupComplete?: Record<string, never>
}

// ═══════════════════════════════════════════
// Database types
// ═══════════════════════════════════════════

export interface VoiceCallRow {
  id: string
  call_sid: string
  direction: CallDirection
  from_number: string
  to_number: string
  status: CallStatus
  contact_id: string | null
  started_at: Date
  connected_at: Date | null
  ended_at: Date | null
  duration_seconds: number | null
  end_reason: string | null
  gemini_voice: string | null
  model_used: string | null
  summary: string | null
  created_at: Date
}

export interface VoiceCallTranscriptRow {
  id: string
  call_id: string
  speaker: 'caller' | 'agent' | 'system'
  text: string
  timestamp_ms: number
  created_at: Date
}

// ═══════════════════════════════════════════
// API types
// ═══════════════════════════════════════════

export interface InitiateCallRequest {
  to: string
  reason?: string
  context?: string
}

export interface VoicePreviewRequest {
  voice: string
  text: string
}

// ═══════════════════════════════════════════
// Gemini voices
// ═══════════════════════════════════════════

/** Half-cascade voices (compatible with gemini-2.5-flash) */
export const GEMINI_VOICES_STANDARD = [
  { value: 'Aoede', label: 'Aoede (femenina, cálida)' },
  { value: 'Charon', label: 'Charon (masculina, profesional)' },
  { value: 'Fenrir', label: 'Fenrir (masculina, enérgica)' },
  { value: 'Kore', label: 'Kore (femenina, profesional)' },
  { value: 'Leda', label: 'Leda (femenina, cálida)' },
  { value: 'Orus', label: 'Orus (masculina, seria)' },
  { value: 'Puck', label: 'Puck (masculina, amigable)' },
  { value: 'Zephyr', label: 'Zephyr (neutro, suave)' },
] as const

/** Native audio voices (for gemini-*-native-audio models) — 30 voices */
export const GEMINI_VOICES_NATIVE = [
  { value: 'Achernar', label: 'Achernar' },
  { value: 'Achird', label: 'Achird' },
  { value: 'Algenib', label: 'Algenib' },
  { value: 'Algieba', label: 'Algieba' },
  { value: 'Alnilam', label: 'Alnilam' },
  { value: 'Aoede', label: 'Aoede' },
  { value: 'Autonoe', label: 'Autonoe' },
  { value: 'Callirrhoe', label: 'Callirrhoe' },
  { value: 'Charon', label: 'Charon' },
  { value: 'Despina', label: 'Despina' },
  { value: 'Enceladus', label: 'Enceladus' },
  { value: 'Erinome', label: 'Erinome' },
  { value: 'Fenrir', label: 'Fenrir' },
  { value: 'Gacrux', label: 'Gacrux' },
  { value: 'Iapetus', label: 'Iapetus' },
  { value: 'Kore', label: 'Kore' },
  { value: 'Laomedeia', label: 'Laomedeia' },
  { value: 'Leda', label: 'Leda' },
  { value: 'Orus', label: 'Orus' },
  { value: 'Puck', label: 'Puck' },
  { value: 'Pulcherrima', label: 'Pulcherrima' },
  { value: 'Rasalgethi', label: 'Rasalgethi' },
  { value: 'Sadachbia', label: 'Sadachbia' },
  { value: 'Sadaltager', label: 'Sadaltager' },
  { value: 'Schedar', label: 'Schedar' },
  { value: 'Sulafat', label: 'Sulafat' },
  { value: 'Umbriel', label: 'Umbriel' },
  { value: 'Vindemiatrix', label: 'Vindemiatrix' },
  { value: 'Zephyr', label: 'Zephyr' },
  { value: 'Zubenelgenubi', label: 'Zubenelgenubi' },
] as const

/** Combined list: standard voices first, then native-only voices */
export const GEMINI_VOICES = [
  ...GEMINI_VOICES_STANDARD,
  ...GEMINI_VOICES_NATIVE.filter(v =>
    !GEMINI_VOICES_STANDARD.some(s => s.value === v.value),
  ),
] as const
