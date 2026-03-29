// LUNA Engine — Proactive Config Loader
// Loads and validates instance/proactive.json.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pino from 'pino'
import type { ProactiveConfig } from '../types.js'

const logger = pino({ name: 'engine:proactive-config' })

const CONFIG_PATH = resolve('instance/proactive.json')

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  business_hours: { start: 8, end: 17, timezone: 'America/Bogota', days: [1, 2, 3, 4, 5] },
  follow_up: { enabled: false, scan_interval_minutes: 15, inactivity_hours: 4, max_attempts: 3, cross_channel: false, channel_fallback_order: ['whatsapp', 'email', 'google-chat'] },
  reminders: { enabled: false, scan_interval_minutes: 30, hours_before_event: 2, notify_salesperson: true },
  commitments: { enabled: false, scan_interval_minutes: 5, max_attempts: 5, generic_auto_cancel_hours: 24, commitment_types: [] },
  reactivation: { enabled: false, cron: '0 9 * * 1-5', days_inactive: 7, max_attempts: 2, max_per_run: 20 },
  guards: { max_proactive_per_day_per_contact: 3, cooldown_minutes: 60, conversation_guard_hours: 4 },
}

let cached: ProactiveConfig | null = null

/**
 * Load proactive config from instance/proactive.json.
 * Returns defaults (everything disabled) if file doesn't exist or is invalid.
 */
export function loadProactiveConfig(): ProactiveConfig {
  if (cached) return cached

  if (!existsSync(CONFIG_PATH)) {
    logger.warn('instance/proactive.json not found, proactive system disabled')
    cached = DEFAULT_CONFIG
    return cached
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    const config: ProactiveConfig = {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_CONFIG.enabled,
      business_hours: {
        ...DEFAULT_CONFIG.business_hours,
        ...(typeof parsed.business_hours === 'object' && parsed.business_hours !== null
          ? parsed.business_hours as Record<string, unknown>
          : {}),
      } as ProactiveConfig['business_hours'],
      follow_up: {
        ...DEFAULT_CONFIG.follow_up,
        ...(typeof parsed.follow_up === 'object' && parsed.follow_up !== null
          ? parsed.follow_up as Record<string, unknown>
          : {}),
      } as ProactiveConfig['follow_up'],
      reminders: {
        ...DEFAULT_CONFIG.reminders,
        ...(typeof parsed.reminders === 'object' && parsed.reminders !== null
          ? parsed.reminders as Record<string, unknown>
          : {}),
      } as ProactiveConfig['reminders'],
      commitments: {
        ...DEFAULT_CONFIG.commitments,
        ...(typeof parsed.commitments === 'object' && parsed.commitments !== null
          ? parsed.commitments as Record<string, unknown>
          : {}),
      } as ProactiveConfig['commitments'],
      reactivation: {
        ...DEFAULT_CONFIG.reactivation,
        ...(typeof parsed.reactivation === 'object' && parsed.reactivation !== null
          ? parsed.reactivation as Record<string, unknown>
          : {}),
      } as ProactiveConfig['reactivation'],
      guards: {
        ...DEFAULT_CONFIG.guards,
        ...(typeof parsed.guards === 'object' && parsed.guards !== null
          ? parsed.guards as Record<string, unknown>
          : {}),
      } as ProactiveConfig['guards'],
    }

    // Validate commitment_types array
    if (Array.isArray(config.commitments.commitment_types)) {
      config.commitments.commitment_types = config.commitments.commitment_types.filter(
        (ct) => typeof ct === 'object' && ct !== null && typeof ct.type === 'string',
      )
    } else {
      config.commitments.commitment_types = []
    }

    cached = config
    logger.info({ enabled: config.enabled }, 'Proactive config loaded')
    return config
  } catch (err) {
    logger.error({ err }, 'Failed to parse instance/proactive.json, using defaults')
    cached = DEFAULT_CONFIG
    return cached
  }
}

/**
 * Force reload (e.g., when console saves new config).
 */
export function reloadProactiveConfig(): ProactiveConfig {
  cached = null
  return loadProactiveConfig()
}

/**
 * Find a commitment type config by type name.
 */
export function findCommitmentTypeConfig(
  config: ProactiveConfig,
  typeName: string,
): ProactiveConfig['commitments']['commitment_types'][number] | null {
  return config.commitments.commitment_types.find(ct => ct.type === typeName) ?? null
}
