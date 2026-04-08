// LUNA Engine — Follow-up intensity levels
// Per-contact follow-up configuration. Stored in agent_contacts.follow_up_intensity.

export type FollowUpIntensity = 'aggressive' | 'normal' | 'gentle' | 'minimal'

export interface IntensityConfig {
  inactivityHours: number
  maxAttempts: number
}

export const INTENSITY_LEVELS: Record<FollowUpIntensity, IntensityConfig> = {
  aggressive: { inactivityHours: 2,  maxAttempts: 5 },
  normal:     { inactivityHours: 4,  maxAttempts: 3 },
  gentle:     { inactivityHours: 12, maxAttempts: 2 },
  minimal:    { inactivityHours: 24, maxAttempts: 1 },
}

export const DEFAULT_INTENSITY: FollowUpIntensity = 'normal'

/**
 * Resolve intensity config for a contact.
 * Falls back to global config values if intensity is unknown or null.
 */
export function resolveIntensity(
  intensity: string | null | undefined,
  globalInactivityHours: number,
  globalMaxAttempts: number,
): IntensityConfig {
  if (intensity && intensity in INTENSITY_LEVELS) {
    return INTENSITY_LEVELS[intensity as FollowUpIntensity]
  }
  return { inactivityHours: globalInactivityHours, maxAttempts: globalMaxAttempts }
}
