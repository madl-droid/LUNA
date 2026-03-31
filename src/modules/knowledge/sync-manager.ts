// LUNA — Module: knowledge — Sync Manager
// Sincronización periódica desde Google Drive y URLs.
// Timer único global controlado por KNOWLEDGE_SYNC_FREQUENCY.

import pino from 'pino'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeManager } from './knowledge-manager.js'
import type { KnowledgeSyncSource } from './types.js'
import { SYNC_FREQUENCY_MS, type KnowledgeConfig } from './types.js'
import { isSupportedMimeType, GOOGLE_NATIVE_TYPES, resolveMimeType } from './extractors/index.js'
import { isSlidesAvailable, extractSlides } from './extractors/slides.js'
import { chunkDocs, linkChunks } from './extractors/smart-chunker.js'

const logger = pino({ name: 'knowledge:sync' })

export class SyncManager {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private pgStore: KnowledgePgStore,
    private knowledgeManager: KnowledgeManager,
    private config: KnowledgeConfig,
    private registry: Registry,
    _redis: Redis,
  ) {}

  /**
   * Start a single global sync timer for all knowledge sources.
   * Frequency is controlled by KNOWLEDGE_SYNC_FREQUENCY config.
   */
  async startAll(): Promise<void> {
    if (!this.config.KNOWLEDGE_SYNC_ENABLED) {
      logger.info('Sync disabled by config')
      return
    }

    const intervalMs = SYNC_FREQUENCY_MS[this.config.KNOWLEDGE_SYNC_FREQUENCY]

    this.timer = setInterval(() => {
      this.runAllSyncs().catch(err => {
        logger.error({ err }, 'Sync cycle failed')
      })
    }, intervalMs)
    this.timer.unref()

    logger.info({ frequency: this.config.KNOWLEDGE_SYNC_FREQUENCY, intervalMs }, 'Global sync timer started')
  }

  /**
   * Stop the global sync timer.
   */
  stopAll(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Run sync for all configured sources.
   */
  async runAllSyncs(): Promise<void> {
    const sources = await this.pgStore.listSyncSources()
    for (const source of sources) {
      try {
        await this.runSync(source.id)
      } catch (err) {
        logger.error({ sourceId: source.id, err }, 'Sync failed for source')
      }
    }
  }

  /**
   * Run sync for a specific source immediately.
   */
  async runSync(sourceId: string): Promise<{ synced: number; errors: number }> {
    const source = await this.pgStore.getSyncSource(sourceId)
    if (!source) throw new Error(`Sync source "${sourceId}" not found`)

    logger.info({ id: source.id, type: source.type, label: source.label }, 'Starting sync')

    try {
      let result: { synced: number; errors: number }

      switch (source.type) {
        case 'drive':
          result = await this.syncDrive(source)
          break
        case 'url':
          result = await this.syncUrl(source)
          break
        default:
          throw new Error(`Unknown sync type: ${source.type}`)
      }

      await this.pgStore.updateSyncStatus(source.id, `ok: ${result.synced} synced, ${result.errors} errors`, result.synced)
      logger.info({ id: source.id, ...result }, 'Sync completed')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.pgStore.updateSyncStatus(source.id, `error: ${msg}`, 0)
      logger.error({ id: source.id, err }, 'Sync failed')
      throw err
    }
  }

  // ─── Drive sync ────────────────────────────

  private async syncDrive(source: KnowledgeSyncSource): Promise<{ synced: number; errors: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const driveService = this.registry.getOptional<any>('google:drive')
    if (!driveService) {
      throw new Error('Google Drive service not available. Enable google-apps module with drive service.')
    }

    let synced = 0
    let errors = 0
    let pageToken: string | undefined

    do {
      const result = await driveService.listFiles({
        folderId: source.ref,
        pageSize: 50,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      })

      for (const file of result.files) {
        try {
          await this.syncDriveFile(file, source.autoCategoryId)
          synced++
        } catch (err) {
          logger.warn({ fileId: file.id, fileName: file.name, err }, 'Failed to sync Drive file')
          errors++
        }
      }

      pageToken = result.nextPageToken
    } while (pageToken)

    return { synced, errors }
  }

  private async syncDriveFile(
    file: { id: string; name: string; mimeType: string; modifiedTime?: string },
    autoCategoryId: string | null,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const driveService = this.registry.get<any>('google:drive')

    // Check if this is a Google native type
    const exportType = GOOGLE_NATIVE_TYPES[file.mimeType]

    if (exportType === 'slides') {
      // Slides: requires google:slides
      if (!isSlidesAvailable(this.registry)) {
        logger.debug({ fileName: file.name }, 'Skipping slides — google:slides not available')
        return
      }

      const existing = await this.pgStore.getDocumentBySourceRef(file.id)
      if (existing && existing.metadata.driveModifiedTime === file.modifiedTime) {
        return  // No changes
      }

      const extracted = await extractSlides(file.id, this.registry)
      if (!extracted) return

      const chunks = chunkDocs(extracted.sections.map(s => (s.title ? `## ${s.title}\n` : '') + s.content).join('\n\n'))
      if (existing) {
        // Update existing document
        const { createHash } = await import('node:crypto')
        const newHash = createHash('sha256').update(extracted.text).digest('hex')
        await this.pgStore.updateDocumentHash(existing.id, newHash, chunks.length)
        await this.pgStore.insertLinkedChunks(existing.id, linkChunks(existing.id, chunks))
      } else {
        const buffer = Buffer.from(extracted.text, 'utf-8')
        await this.knowledgeManager.addDocument(buffer, file.name, {
          categoryIds: autoCategoryId ? [autoCategoryId] : [],
          sourceType: 'drive',
          sourceRef: file.id,
          mimeType: 'text/plain',
          metadata: { driveModifiedTime: file.modifiedTime },
        })
      }
      return
    }

    // Determine if we can handle this file type
    const effectiveMime = exportType ?? file.mimeType
    if (!isSupportedMimeType(effectiveMime) && !isSupportedMimeType(resolveMimeType(file.name))) {
      logger.debug({ fileName: file.name, mimeType: file.mimeType }, 'Skipping unsupported file type')
      return
    }

    // Check if already synced and unchanged
    const existing = await this.pgStore.getDocumentBySourceRef(file.id)
    if (existing && existing.metadata.driveModifiedTime === file.modifiedTime) {
      return  // No changes
    }

    // Download/export the file
    let buffer: Buffer
    if (exportType && typeof exportType === 'string' && exportType !== 'slides') {
      // Google native type → export
      const text = await driveService.exportFile(file.id, exportType)
      buffer = Buffer.from(text, 'utf-8')
    } else {
      // Regular file → download
      buffer = await driveService.downloadFile(file.id)
    }

    if (existing) {
      // Re-process existing document
      const { createHash } = await import('node:crypto')
      const newHash = createHash('sha256').update(buffer).digest('hex')
      if (newHash === existing.contentHash) return  // Content unchanged

      const { extractContent } = await import('./extractors/index.js')
      const extracted = await extractContent(buffer, file.name, effectiveMime, this.registry)
      const chunks = chunkDocs(extracted.sections.map(s => (s.title ? `## ${s.title}\n` : '') + s.content).join('\n\n'))

      await this.pgStore.updateDocumentHash(existing.id, newHash, chunks.length)
      await this.pgStore.insertLinkedChunks(existing.id, linkChunks(existing.id, chunks))

      logger.info({ id: existing.id, title: file.name }, 'Drive document updated')
    } else {
      // New document
      await this.knowledgeManager.addDocument(buffer, file.name, {
        categoryIds: autoCategoryId ? [autoCategoryId] : [],
        sourceType: 'drive',
        sourceRef: file.id,
        mimeType: effectiveMime,
        metadata: { driveModifiedTime: file.modifiedTime },
      })
    }
  }

  // ─── URL sync ──────────────────────────────

  private async syncUrl(source: KnowledgeSyncSource): Promise<{ synced: number; errors: number }> {
    try {
      const response = await fetch(source.ref, {
        headers: { 'User-Agent': 'LUNA-Agent/1.0' },
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') ?? 'text/plain'
      const buffer = Buffer.from(await response.arrayBuffer())

      // Extract file name from URL
      const urlPath = new URL(source.ref).pathname
      const fileName = urlPath.split('/').pop() ?? 'url-content.txt'

      // Determine MIME type
      const mimeType = contentType.split(';')[0]!.trim()

      const existing = await this.pgStore.getDocumentBySourceRef(source.ref)

      const { createHash } = await import('node:crypto')
      const newHash = createHash('sha256').update(buffer).digest('hex')

      if (existing && newHash === existing.contentHash) {
        return { synced: 0, errors: 0 }  // No changes
      }

      if (existing) {
        // Update
        const { extractContent } = await import('./extractors/index.js')
        const extracted = await extractContent(buffer, fileName, mimeType, this.registry)
        const chunks = chunkDocs(extracted.sections.map(s => (s.title ? `## ${s.title}\n` : '') + s.content).join('\n\n'))

        await this.pgStore.updateDocumentHash(existing.id, newHash, chunks.length)
        await this.pgStore.insertLinkedChunks(existing.id, linkChunks(existing.id, chunks))
      } else {
        // New
        await this.knowledgeManager.addDocument(buffer, fileName, {
          categoryIds: source.autoCategoryId ? [source.autoCategoryId] : [],
          sourceType: 'url',
          sourceRef: source.ref,
          mimeType,
        })
      }

      return { synced: 1, errors: 0 }
    } catch (err) {
      logger.error({ url: source.ref, err }, 'URL sync failed')
      return { synced: 0, errors: 1 }
    }
  }
}
