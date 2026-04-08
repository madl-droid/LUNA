// LUNA — Module: templates — Folder Manager
// Resuelve folder patterns a Drive folder IDs, creando carpetas si no existen, sin duplicados.

import type { DriveService } from '../google-apps/drive-service.js'

export class FolderManager {
  private cache = new Map<string, string>() // path → folder ID

  constructor(
    private drive: DriveService,
    private rootFolderId: string,
  ) {}

  /**
   * Resuelve un folder pattern a un Drive folder ID.
   * Crea carpetas que no existan. Nunca duplica.
   *
   * @param pattern - ej: "Comparativos/{BRAND}/{COMPETITOR}"
   * @param values  - ej: { BRAND: "Nike", COMPETITOR: "Adidas" }
   * @returns Drive folder ID de la carpeta final
   */
  async resolveFolder(pattern: string, values: Record<string, string>): Promise<string> {
    if (!pattern) return this.rootFolderId

    // Replace placeholders: "Comparativos/{BRAND}/{COMPETITOR}" → "Comparativos/Nike/Adidas"
    const resolved = pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? key)

    // Check cache first
    const cacheKey = `${this.rootFolderId}:${resolved}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    // Walk path segments
    const segments = resolved.split('/').filter(s => s.length > 0)
    let currentParentId = this.rootFolderId

    for (const segment of segments) {
      const segmentPath = `${this.rootFolderId}:${segments.slice(0, segments.indexOf(segment) + 1).join('/')}`
      const segmentCached = this.cache.get(segmentPath)
      if (segmentCached) {
        currentParentId = segmentCached
        continue
      }

      // Search for exact-match folder in current parent
      const listResult = await this.drive.listFiles({
        folderId: currentParentId,
        query: segment,
        mimeType: 'application/vnd.google-apps.folder',
        pageSize: 50,
      })

      // Filter exact match client-side (listFiles uses 'contains', not exact)
      const existing = listResult.files.find(f => f.name === segment)

      if (existing) {
        currentParentId = existing.id
      } else {
        // Create folder
        const created = await this.drive.createFolder(segment, currentParentId)
        currentParentId = created.id
      }

      this.cache.set(segmentPath, currentParentId)
    }

    this.cache.set(cacheKey, currentParentId)
    return currentParentId
  }

  /** Invalidate cache (call when root folder config changes) */
  invalidateCache(): void {
    this.cache.clear()
  }
}
