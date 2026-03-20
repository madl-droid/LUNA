// LUNA — Module: twilio-voice — Types
// Tipos para llamadas de voz, estados, eventos Twilio y mensajes Gemini Live.

// ═══════════════════════════════════════════
// Config
// ═══════════════════════════════════════════

export interface TwilioVoiceConfig {
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  VOICE_GEMINI_VOICE: string
  VOICE_PREVIEW_TEXT: string
  VOICE_ANSWER_DELAY_RINGS: number
  VOICE_SILENCE_TIMEOUT_MS: number
  VOICE_SILENCE_MESSAGE: string
  VOICE_GREETING_INBOUND: string
  VOICE_GREETING_OUTBOUND: string
  VOICE_FILLER_MESSAGE: string
  VOICE_GOODBYE_TIMEOUT_MS: number
  VOICE_MAX_CALL_DURATION_MS: number
  VOICE_MAX_CONCURRENT_CALLS: number
  VOICE_ENABLED: boolean
  VOICE_GOOGLE_API_KEY: string
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

export interface ActiveCall {
  callId: string
  callSid: string
  streamSid: string | null
  direction: CallDirection
  from: string
  to: string
  status: CallStatus
  agentId: string | null
  contactId: string | null
  startedAt: Date
  connectedAt: Date | null
  geminiVoice: string
  transcript: TranscriptEntry[]
  /** Pre-loaded context (populated during answer delay) */
  preloadedContext: PreloadedContext | null
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
  agentId: string
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
  voice: string
  systemInstruction: string
  tools: GeminiToolDeclaration[]
}

export interface GeminiSetupMessage {
  setup: {
    model: string
    generationConfig: {
      responseModalities: string[]
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string
          }
        }
      }
    }
    systemInstruction: {
      parts: Array<{ text: string }>
    }
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
  }
  toolCall?: {
    functionCalls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
    }>
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
  agent_id: string | null
  contact_id: string | null
  started_at: Date
  connected_at: Date | null
  ended_at: Date | null
  duration_seconds: number | null
  end_reason: string | null
  gemini_voice: string | null
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
  agentId?: string
  context?: string
}

export interface VoicePreviewRequest {
  voice: string
  text: string
}

// ═══════════════════════════════════════════
// Gemini voices
// ═══════════════════════════════════════════

export const GEMINI_VOICES = [
  { value: 'Aoede', label: 'Aoede (femenina, c\u00e1lida)' },
  { value: 'Charon', label: 'Charon (masculina, profesional)' },
  { value: 'Fenrir', label: 'Fenrir (masculina, en\u00e9rgica)' },
  { value: 'Kore', label: 'Kore (femenina, profesional)' },
  { value: 'Puck', label: 'Puck (masculina, amigable)' },
] as const
