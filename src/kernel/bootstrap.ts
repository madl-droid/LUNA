// LUNA — Instance directory bootstrapper
// Ensures required instance/ directories exist on boot (fresh containers).

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import pino from 'pino'

const logger = pino({ name: 'kernel:bootstrap' })

const REQUIRED_DIRS = [
  'instance/knowledge/media',
  'instance/fallbacks/whatsapp',
  'instance/fallbacks/email',
  'instance/tools',
  'instance/wa-auth',
  'instance/system',
]

/**
 * Create instance/ subdirectories if they don't exist.
 * Safe to call on every boot — uses recursive mkdir.
 */
export async function ensureInstanceDirs(): Promise<void> {
  for (const dir of REQUIRED_DIRS) {
    const absPath = path.resolve(dir)
    try {
      await fs.mkdir(absPath, { recursive: true })
    } catch {
      // Should not happen with recursive: true, but log just in case
      logger.warn({ dir: absPath }, 'Could not create instance directory')
    }
  }
  logger.info({ dirs: REQUIRED_DIRS.length }, 'Instance directories ensured')
}
