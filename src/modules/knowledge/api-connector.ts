import pino from 'pino'
import type { KnowledgeApiConnector, ApiAuthType, ApiAuthConfig } from './types.js'

const log = pino({ name: 'knowledge:api-connector' })

const MAX_CONNECTORS = 10

interface PgStore {
  insertApiConnector(data: Omit<KnowledgeApiConnector, 'id' | 'createdAt' | 'active'>): Promise<string>
  updateApiConnector(id: string, updates: Partial<KnowledgeApiConnector>): Promise<void>
  deleteApiConnector(id: string): Promise<void>
  listApiConnectors(): Promise<KnowledgeApiConnector[]>
  getApiConnector(id: string): Promise<KnowledgeApiConnector | null>
  countApiConnectors(): Promise<number>
}

export class ApiConnectorManager {
  private pgStore: PgStore

  constructor(pgStore: PgStore) {
    this.pgStore = pgStore
  }

  async create(data: {
    title: string
    description: string
    baseUrl: string
    authType: ApiAuthType
    authConfig: ApiAuthConfig
    queryInstructions: string
  }): Promise<string> {
    const count = await this.pgStore.countApiConnectors()
    if (count >= MAX_CONNECTORS) {
      throw new Error(`Maximum of ${MAX_CONNECTORS} API connectors reached`)
    }

    const id = await this.pgStore.insertApiConnector(data)
    log.info({ id, title: data.title }, 'api connector created')
    return id
  }

  async update(id: string, updates: Partial<KnowledgeApiConnector>): Promise<void> {
    await this.pgStore.updateApiConnector(id, updates)
    log.info({ id }, 'api connector updated')
  }

  async remove(id: string): Promise<void> {
    await this.pgStore.deleteApiConnector(id)
    log.info({ id }, 'api connector removed')
  }

  async list(): Promise<KnowledgeApiConnector[]> {
    return this.pgStore.listApiConnectors()
  }

  async get(id: string): Promise<KnowledgeApiConnector | null> {
    return this.pgStore.getApiConnector(id)
  }

  async queryApi(
    connectorId: string,
    query: string
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const connector = await this.pgStore.getApiConnector(connectorId)
    if (!connector) {
      return { success: false, error: `Connector ${connectorId} not found` }
    }

    if (!connector.active) {
      return { success: false, error: `Connector ${connectorId} is not active` }
    }

    const url = new URL(connector.baseUrl)
    url.searchParams.set('q', query)

    // FIX: K-SSRF1 — Validar URL antes de fetch para prevenir SSRF
    const { assertNotPrivateUrl } = await import('../../kernel/ssrf-guard.js')
    assertNotPrivateUrl(url.toString())

    const headers: Record<string, string> = {}
    buildAuthHeaders(connector.authType, connector.authConfig, headers)

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        log.warn({ connectorId, status: res.status }, 'api connector request failed')
        return { success: false, error: `HTTP ${res.status}: ${text}` }
      }

      const data: unknown = await res.json().catch(async () => {
        return await res.text()
      })

      log.info({ connectorId, status: res.status }, 'api connector query ok')
      return { success: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ connectorId, err: message }, 'api connector query error')
      return { success: false, error: message }
    }
  }
}

function buildAuthHeaders(
  authType: ApiAuthType,
  authConfig: ApiAuthConfig,
  headers: Record<string, string>
): void {
  switch (authType) {
    case 'bearer':
      if (authConfig.token) {
        headers['Authorization'] = `Bearer ${authConfig.token}`
      }
      break
    case 'api_key': {
      const headerName = authConfig.apiKeyHeader ?? 'X-API-Key'
      if (authConfig.apiKey) {
        headers[headerName] = authConfig.apiKey
      }
      break
    }
    case 'basic':
      if (authConfig.username && authConfig.password) {
        const encoded = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
        headers['Authorization'] = `Basic ${encoded}`
      }
      break
    case 'none':
      break
  }
}
