// LUNA — Kernel config
// SOLO variables de infraestructura. Cada módulo define su propio config schema.
// Este es el ÚNICO archivo que lee process.env directamente.

import dotenv from 'dotenv'
dotenv.config()

import { z } from 'zod'

const boolStr = z.string().transform(v => v === 'true').pipe(z.boolean())
const intStr = z.string().transform(Number).pipe(z.number().int())

const kernelSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'staging', 'test']).default('development'),
  port: intStr.default('3000'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  db: z.object({
    host: z.string().default('localhost'),
    port: intStr.default('5432'),
    name: z.string().default('luna'),
    user: z.string().default('luna'),
    password: z.string().default('luna_dev'),
    maxConnections: intStr.default('20'),
    idleTimeoutMs: intStr.default('30000'),
    connectionTimeoutMs: intStr.default('5000'),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: intStr.default('6379'),
    password: z.string().default(''),
    db: intStr.default('0'),
    maxRetries: intStr.default('3'),
  }),
})

function loadKernelConfig() {
  const env = process.env
  return kernelSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,

    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      maxConnections: env.DB_MAX_CONNECTIONS,
      idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    },

    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      maxRetries: env.REDIS_MAX_RETRIES,
    },
  })
}

let _config = loadKernelConfig()

export const kernelConfig = new Proxy({} as ReturnType<typeof loadKernelConfig>, {
  get(_target, prop) {
    if (typeof prop === 'symbol') return undefined
    return (_config as Record<string, unknown>)[prop]
  },
  ownKeys() {
    return Object.keys(_config)
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'symbol') return undefined
    if (prop in _config) {
      return { configurable: true, enumerable: true, writable: false, value: (_config as Record<string, unknown>)[prop] }
    }
    return undefined
  },
})

export type KernelConfig = ReturnType<typeof loadKernelConfig>

export function reloadKernelConfig(): void {
  dotenv.config({ override: true })
  _config = loadKernelConfig()
}

/**
 * Read a raw env var. Used by modules to read their own config
 * without importing dotenv themselves.
 */
export function getEnv(key: string): string | undefined {
  return process.env[key]
}

/**
 * Returns all current process.env as a plain object.
 * Used by the loader to validate merged module schemas.
 */
export function getAllEnv(): Record<string, string | undefined> {
  return { ...process.env }
}
