// LUNA — Kernel HTTP server
// Servidor base que monta rutas de módulos dinámicamente.

import * as http from 'node:http'
import pino from 'pino'
import { kernelConfig } from './config.js'
import type { Registry } from './registry.js'
import type { ApiRoute } from './types.js'

const logger = pino({ name: 'kernel:server' })

export interface MountedRoute {
  method: string
  fullPath: string
  moduleName: string
  handler: ApiRoute['handler']
}

export class Server {
  private httpServer: http.Server | null = null
  private routes: MountedRoute[] = []
  private registry: Registry

  constructor(registry: Registry) {
    this.registry = registry
  }

  /** Mount API routes for a module under /oficina/api/{moduleName}/ */
  mountModuleRoutes(moduleName: string, apiRoutes: ApiRoute[]): void {
    for (const route of apiRoutes) {
      const fullPath = `/oficina/api/${moduleName}/${route.path}`
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

      // Try matched module routes (strip query params for matching)
      const urlPath = url.split('?')[0]
      const matched = this.routes.find(r =>
        r.method === method && urlPath === r.fullPath
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

      // Let modules handle custom URL patterns (oficina serves HTML at /oficina)
      // This is done via a special hook
      if (url.startsWith('/oficina')) {
        const oficinaMod = this.registry.getModule('oficina')
        if (oficinaMod?.active) {
          const handler = this.registry.getOptional<(req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>>('oficina:requestHandler')
          if (handler) {
            const handled = await handler(req, res)
            if (handled) return
          }
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"Not found"}')
    })

    const port = kernelConfig.port
    return new Promise((resolve) => {
      this.httpServer!.listen(port, () => {
        logger.info({ port }, 'LUNA server started')
        resolve()
      })
    })
  }

  getHttpServer(): http.Server | null {
    return this.httpServer
  }
}
