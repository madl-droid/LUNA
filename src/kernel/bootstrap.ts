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
 * Files that must exist in instance/. If missing (e.g. volume mount overwrote
 * the directory), copy them from the repo template.
 */
const REQUIRED_FILES: Array<{ target: string; source: string }> = [
  { target: 'instance/proactive.json', source: 'instance/proactive.json' },
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

/**
 * Copy required instance files from the repo template if they don't exist.
 * Handles the case where a Docker volume mount overwrites instance/ without
 * including template files like proactive.json.
 */
export async function ensureInstanceFiles(): Promise<void> {
  for (const { target, source } of REQUIRED_FILES) {
    const targetPath = path.resolve(target)
    const sourcePath = path.resolve(source)

    try {
      await fs.access(targetPath)
      // File exists, skip
    } catch {
      // File missing — try to copy from source
      try {
        await fs.access(sourcePath)
        await fs.copyFile(sourcePath, targetPath)
        logger.info({ file: target }, 'Copied missing instance file from template')
      } catch {
        logger.warn({ file: target }, 'Instance file missing and no template source found')
      }
    }
  }
}
