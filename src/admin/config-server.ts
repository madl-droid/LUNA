import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, reloadInstanceConfig, InstanceConfigSchema } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const token = getConfig().env.admin.token;
  if (!token) return true;
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${token}`) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const method = req.method ?? 'GET';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve UI
  if (method === 'GET' && url.pathname === '/') {
    const html = readFileSync(resolve(__dirname, 'config-ui.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Get current config
  if (method === 'GET' && url.pathname === '/api/config') {
    if (!checkAuth(req, res)) return;
    json(res, 200, getConfig().instance);
    return;
  }

  // Get JSON Schema
  if (method === 'GET' && url.pathname === '/api/schema') {
    if (!checkAuth(req, res)) return;
    const schemaPath = resolve('instance/config.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    json(res, 200, schema);
    return;
  }

  // Update config
  if (method === 'PUT' && url.pathname === '/api/config') {
    if (!checkAuth(req, res)) return;

    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const result = InstanceConfigSchema.safeParse(parsed);
    if (!result.success) {
      json(res, 400, { error: 'Validation failed', details: result.error.issues });
      return;
    }

    const configPath = getConfig().instanceConfigPath;
    writeFileSync(configPath, JSON.stringify(result.data, null, 2) + '\n');
    reloadInstanceConfig();

    json(res, 200, { success: true, config: result.data });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

export function startConfigServer(): void {
  const cfg = getConfig();
  const port = cfg.env.admin.port;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[ConfigServer] Error:', err);
      json(res, 500, { error: 'Internal server error' });
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[ConfigServer] Admin UI running at http://127.0.0.1:${port}`);
  });
}
