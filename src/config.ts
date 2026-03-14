import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// --- Zod schemas for instance config ---

const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'gemini']),
  model: z.string(),
  maxInputTokens: z.number().int().min(256).max(200_000),
  maxOutputTokens: z.number().int().min(64).max(64_000),
});

const BaileysConfigSchema = z.object({
  printQRInTerminal: z.boolean().default(true),
  syncFullHistory: z.boolean().default(false),
  authDir: z.string().default('instance/wa-auth'),
  allowedEvents: z.array(z.string()).default([
    'messages.upsert',
    'messages.update',
    'connection.update',
    'creds.update',
  ]),
});

const WhatsAppConfigSchema = z.object({
  phoneNumber: z.string().default(''),
  enabled: z.boolean().default(true),
  baileys: BaileysConfigSchema.default(() => BaileysConfigSchema.parse({})),
});

const LLMConfigSchema = z.object({
  primaryProvider: z.enum(['anthropic', 'gemini']).default('anthropic'),
  fallbackProvider: z.enum(['anthropic', 'gemini']).default('gemini'),
  models: z.object({
    classify: ModelConfigSchema,
    respond: ModelConfigSchema,
    complex: ModelConfigSchema,
    compress: ModelConfigSchema,
    fallback: ModelConfigSchema,
  }),
  availableModels: z.object({
    anthropic: z.array(z.string()),
    gemini: z.array(z.string()),
  }),
});

const MemoryConfigSchema = z.object({
  bufferMessageCount: z.number().int().min(10).max(200).default(50),
  sessionInactivityTimeoutMinutes: z.number().int().min(5).max(1440).default(30),
  sessionMaxTTLHours: z.number().int().min(1).max(72).default(24),
  compressionThreshold: z.number().int().min(10).max(100).default(30),
  compressionKeepRecent: z.number().int().min(3).max(30).default(10),
});

const ChannelsConfigSchema = z.object({
  enabledChannels: z.array(z.string()).default(['whatsapp']),
});

const InstanceConfigSchema = z.object({
  whatsapp: WhatsAppConfigSchema.default(() => WhatsAppConfigSchema.parse({})),
  llm: LLMConfigSchema,
  memory: MemoryConfigSchema.default(() => MemoryConfigSchema.parse({})),
  channels: ChannelsConfigSchema.default(() => ChannelsConfigSchema.parse({})),
});

export type InstanceConfig = z.infer<typeof InstanceConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// --- Environment config (from .env via process.env) ---

const EnvConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.string().default('info'),

  postgres: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().default(5432),
    user: z.string().default('luna'),
    password: z.string().default('luna_dev'),
    database: z.string().default('luna'),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().default(6379),
    password: z.string().optional(),
  }),

  apiKeys: z.object({
    anthropic: z.string().default(''),
    googleAI: z.string().default(''),
  }),

  admin: z.object({
    port: z.number().int().default(3001),
    token: z.string().optional(),
  }),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;

// --- Load and validate ---

function loadEnvConfig(): EnvConfig {
  return EnvConfigSchema.parse({
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
    postgres: {
      host: process.env['POSTGRES_HOST'],
      port: process.env['POSTGRES_PORT'] ? Number(process.env['POSTGRES_PORT']) : undefined,
      user: process.env['POSTGRES_USER'],
      password: process.env['POSTGRES_PASSWORD'],
      database: process.env['POSTGRES_DB'],
    },
    redis: {
      host: process.env['REDIS_HOST'],
      port: process.env['REDIS_PORT'] ? Number(process.env['REDIS_PORT']) : undefined,
      password: process.env['REDIS_PASSWORD'] || undefined,
    },
    apiKeys: {
      anthropic: process.env['ANTHROPIC_API_KEY'],
      googleAI: process.env['GOOGLE_AI_API_KEY'],
    },
    admin: {
      port: process.env['ADMIN_PORT'] ? Number(process.env['ADMIN_PORT']) : undefined,
      token: process.env['ADMIN_TOKEN'] || undefined,
    },
  });
}

function loadInstanceConfig(configPath: string): InstanceConfig {
  const raw = readFileSync(configPath, 'utf-8');
  const json: unknown = JSON.parse(raw);
  return InstanceConfigSchema.parse(json);
}

export interface AppConfig {
  env: EnvConfig;
  instance: InstanceConfig;
  instanceConfigPath: string;
}

let _config: AppConfig | null = null;

export function loadConfig(instanceConfigPath?: string): AppConfig {
  const configPath = instanceConfigPath ?? resolve('instance/config.json');
  const env = loadEnvConfig();
  const instance = loadInstanceConfig(configPath);

  _config = { env, instance, instanceConfigPath: configPath };
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return _config;
}

export function reloadInstanceConfig(): InstanceConfig {
  const cfg = getConfig();
  const instance = loadInstanceConfig(cfg.instanceConfigPath);
  _config = { ...cfg, instance };
  return instance;
}

export { InstanceConfigSchema };
