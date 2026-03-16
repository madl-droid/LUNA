// LUNA — Module: memory
// Sistema de memoria: Redis buffer (rápido) + PostgreSQL (persistencia).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { MemoryManager } from './memory-manager.js'

let manager: MemoryManager | null = null

const manifest: ModuleManifest = {
  name: 'memory',
  version: '1.0.0',
  description: {
    es: 'Sistema de memoria: Redis (buffer) + PostgreSQL (persistencia)',
    en: 'Memory system: Redis (buffer) + PostgreSQL (persistence)',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    MEMORY_BUFFER_MESSAGE_COUNT: z.string().transform(Number).pipe(z.number().int()).default('50'),
    MEMORY_SESSION_INACTIVITY_TIMEOUT_MIN: z.string().transform(Number).pipe(z.number().int()).default('30'),
    MEMORY_SESSION_MAX_TTL_HOURS: z.string().transform(Number).pipe(z.number().int()).default('24'),
    MEMORY_COMPRESSION_THRESHOLD: z.string().transform(Number).pipe(z.number().int()).default('30'),
    MEMORY_COMPRESSION_KEEP_RECENT: z.string().transform(Number).pipe(z.number().int()).default('10'),
  }),

  oficina: {
    title: { es: 'Memoria', en: 'Memory' },
    info: {
      es: 'Buffer de mensajes en Redis + persistencia en PostgreSQL.',
      en: 'Message buffer in Redis + persistence in PostgreSQL.',
    },
    order: 40,
    fields: [
      { key: 'MEMORY_BUFFER_MESSAGE_COUNT', type: 'number', label: { es: 'Mensajes en buffer', en: 'Buffer message count' } },
      { key: 'MEMORY_SESSION_MAX_TTL_HOURS', type: 'number', label: { es: 'TTL sesión (horas)', en: 'Session TTL (hours)' } },
      { key: 'MEMORY_COMPRESSION_THRESHOLD', type: 'number', label: { es: 'Umbral de compresión', en: 'Compression threshold' } },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      MEMORY_BUFFER_MESSAGE_COUNT: number
      MEMORY_SESSION_MAX_TTL_HOURS: number
      MEMORY_COMPRESSION_THRESHOLD: number
      MEMORY_COMPRESSION_KEEP_RECENT: number
    }>('memory')

    manager = new MemoryManager(registry.getDb(), registry.getRedis(), config)
    await manager.initialize()

    // Expose as service
    registry.provide('memory:manager', manager)
  },

  async stop() {
    if (manager) {
      await manager.shutdown()
      manager = null
    }
  },
}

export default manifest
