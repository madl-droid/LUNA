// LUNA — Kernel HTTP server
// Servidor base que monta rutas de módulos dinámicamente.

import * as http from 'node:http'
import type { Socket } from 'node:net'
import pino from 'pino'
import { kernelConfig } from './config.js'
import type { Registry } from './registry.js'
import type { ApiRoute } from './types.js'
import { getSessionToken, validateSession } from './setup/auth.js'
import { createLoginHandler } from './setup/login.js'

const logger = pino({ name: 'kernel:server' })

export interface MountedRoute {
  method: string
  fullPath: string
  moduleName: string
  handler: ApiRoute['handler']
}

export type UpgradeHandler = (req: http.IncomingMessage, socket: Socket, head: Buffer) => void

export class Server {
  private httpServer: http.Server | null = null
  private routes: MountedRoute[] = []
  private registry: Registry
  private upgradeHandlers: Array<{ pathPrefix: string; handler: UpgradeHandler }> = []
  private upgradeAttached = false

  constructor(registry: Registry) {
    this.registry = registry
  }

  /** Register a WebSocket upgrade handler for a URL path prefix */
  registerUpgradeHandler(pathPrefix: string, handler: UpgradeHandler): void {
    this.upgradeHandlers.push({ pathPrefix, handler })
    if (this.httpServer && !this.upgradeAttached) {
      this.attachUpgradeHandlers()
    }
    logger.debug({ pathPrefix }, 'WebSocket upgrade handler registered')
  }

  /** Mount API routes for a module under /console/api/{moduleName}/ */
  mountModuleRoutes(moduleName: string, apiRoutes: ApiRoute[]): void {
    for (const route of apiRoutes) {
      const fullPath = `/console/api/${moduleName}/${route.path}`
      this.routes.push({
        method: route.method,
        fullPath,
        moduleName,
        handler: route.handler,
      })
      logger.debug({ method: route.method, path: fullPath, module: moduleName }, 'Route mounted')
    }
  }

  /** Remove all routes for a module */
  unmountModuleRoutes(moduleName: string): void {
    this.routes = this.routes.filter(r => r.moduleName !== moduleName)
    logger.debug({ module: moduleName }, 'Routes unmounted')
  }

  async start(): Promise<void> {
    const loginHandler = createLoginHandler(this.registry.getDb(), this.registry.getRedis())

    this.httpServer = http.createServer(async (req, res) => {
      const url = req.url ?? '/'
      const method = req.method ?? 'GET'

      // Health check — always available
      if (url === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'ok',
          modules: this.registry.listModules()
            .filter(m => m.active)
            .map(m => m.manifest.name),
        }))
        return
      }

      // ─── Auth: login/logout routes (before auth check) ───
      if (url.startsWith('/console/login') || url.startsWith('/console/logout')) {
        try {
          const handled = await loginHandler(req, res)
          if (handled) return
        } catch (err) {
          logger.error({ err, url }, 'Login handler error')
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal server error')
          return
        }
      }

      // ─── Auth: protect /console routes ───
      // Exempt: static assets, login/logout, external webhooks, OAuth callbacks
      const urlPath0 = url.split('?')[0]!
      const isPublicConsoleRoute =
        url.startsWith('/console/static/') ||
        url.startsWith('/console/login') ||
        url.startsWith('/console/logout') ||
        /^\/console\/api\/[^/]+\/webhook/.test(urlPath0) ||
        /^\/console\/api\/[^/]+\/oauth2callback/.test(urlPath0) ||
        /^\/console\/api\/[^/]+\/auth-callback/.test(urlPath0)
      if (url.startsWith('/console') && !isPublicConsoleRoute) {
        try {
          const token = getSessionToken(req.headers['cookie'])
          const userId = token ? await validateSession(this.registry.getRedis(), token) : null
          if (!userId) {
            // API routes get 401 JSON, browser routes get redirect
            if (url.startsWith('/console/api/')) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end('{"error":"Unauthorized"}')
            } else {
              res.writeHead(302, { Location: '/console/login?expired=1' })
              res.end()
            }
            return
          }
        } catch (err) {
          logger.error({ err, url }, 'Session validation error')
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal server error')
          return
        }
      }

      // Try matched module routes (strip query params for matching)
      // Supports exact match and prefix match (for routes with path params like /ack-messages/:id)
      const urlPath = url.split('?')[0]
      const matched = this.routes.find(r =>
        r.method === method && (urlPath === r.fullPath || urlPath!.startsWith(r.fullPath + '/'))
      )
      if (matched) {
        try {
          await matched.handler(req, res)
        } catch (err) {
          logger.error({ err, path: url }, 'Route handler error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
        return
      }

      // Let modules handle custom URL patterns (console serves HTML at /console)
      // This is done via a special hook
      if (url.startsWith('/console')) {
        const consoleMod = this.registry.getModule('console')
        if (consoleMod?.active) {
          const handler = this.registry.getOptional<(req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>>('console:requestHandler')
          if (handler) {
            const handled = await handler(req, res)
            if (handled) return
          }
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"Not found"}')
    })

    // Attach WebSocket upgrade handlers
    this.attachUpgradeHandlers()

    const port = kernelConfig.port
    return new Promise((resolve) => {
      this.httpServer!.listen(port, () => {
        logger.info({ port }, 'LUNA server started')
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return
    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        logger.info('HTTP server closed')
        resolve()
      })
    })
  }

  getHttpServer(): http.Server | null {
    return this.httpServer
  }

  private attachUpgradeHandlers(): void {
    if (!this.httpServer || this.upgradeAttached) return
    this.upgradeAttached = true

    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '/'
      const urlPath = url.split('?')[0]

      for (const entry of this.upgradeHandlers) {
        if (urlPath!.startsWith(entry.pathPrefix)) {
          entry.handler(req, socket as Socket, head)
          return
        }
      }

      // No handler matched — destroy socket
      socket.destroy()
    })
  }
}
