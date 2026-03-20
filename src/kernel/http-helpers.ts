// LUNA — Kernel HTTP helpers
// Utilidades compartidas para handlers de API routes en módulos.
// Evita duplicar readBody/jsonResponse/parseQuery en cada manifest.

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Lee el body de un request como string UTF-8 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

/** Lee y parsea el body como JSON. Retorna {} si el body está vacío. */
export async function parseBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  if (!raw || raw.trim() === '') return {} as T
  return JSON.parse(raw) as T
}

/** Envía una respuesta JSON con status code */
export function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/** Parsea query params de un request usando la API URL estándar */
export function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.searchParams
}

/** Extrae el pathname sin query string */
export function getPathname(req: IncomingMessage): string {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.pathname
}
