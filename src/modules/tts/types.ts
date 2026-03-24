// LUNA — Module: tts — Types

export interface TTSServiceInterface {
  isEnabledForChannel(channel: string): boolean
  shouldAutoTTS(channel: string, inputContentType: string): boolean
  synthesize(text: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
}
