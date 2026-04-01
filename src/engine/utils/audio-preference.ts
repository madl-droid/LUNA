// LUNA Engine — Per-Contact Audio Preference Learning
// Tracks whether a contact tends to send audio or text, and adjusts the
// audio response probability accordingly. Lightweight Redis-based.

import type { Redis } from 'ioredis'

const KEY_PREFIX = 'audio_pref:'
const MAX_HISTORY = 20       // Track last 20 messages
const TTL_SECONDS = 7 * 86400 // Expire after 7 days of inactivity

/**
 * Record a contact's input type (audio or text).
 * Maintains a sliding window of the last N input types.
 */
export async function recordInputType(
  redis: Redis,
  contactId: string,
  inputType: string,
): Promise<void> {
  if (!contactId) return
  const key = `${KEY_PREFIX}${contactId}`
  const value = inputType === 'audio' ? '1' : '0'
  await redis.lpush(key, value)
  await redis.ltrim(key, 0, MAX_HISTORY - 1)
  await redis.expire(key, TTL_SECONDS)
}

/**
 * Get the audio preference ratio for a contact.
 * Returns a multiplier (0.0 - 2.0) that adjusts the base TTS frequency:
 * - > 1.0: contact prefers audio (sends mostly audio)
 * - 1.0: neutral (no history or balanced)
 * - < 1.0: contact prefers text (sends mostly text)
 *
 * The multiplier is applied to the base frequency in shouldAutoTTS.
 */
export async function getAudioPreferenceMultiplier(
  redis: Redis,
  contactId: string,
): Promise<number> {
  if (!contactId) return 1.0
  const key = `${KEY_PREFIX}${contactId}`
  const history = await redis.lrange(key, 0, -1)
  if (history.length < 3) return 1.0 // Not enough data

  const audioCount = history.filter((v: string) => v === '1').length
  const ratio = audioCount / history.length

  // Map ratio to multiplier:
  // 0% audio → 0.3x (strongly prefer text)
  // 50% audio → 1.0x (neutral)
  // 100% audio → 1.7x (strongly prefer audio)
  return 0.3 + (ratio * 1.4)
}
