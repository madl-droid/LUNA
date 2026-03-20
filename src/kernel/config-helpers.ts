// LUNA — Kernel config schema helpers
// Helpers para Zod configSchema en módulos. Evita repetir .transform(Number).pipe(...).

import { z } from 'zod'

/** Env var numérica entera. Usa: `numEnv()` o `numEnv(3000)` para default. */
export function numEnv(defaultValue?: number) {
  const base = z.string().transform(Number).pipe(z.number().int())
  return defaultValue !== undefined ? base.default(String(defaultValue)) : base
}

/** Env var numérica entera con min. Usa: `numEnvMin(1)` o `numEnvMin(1, 5)` */
export function numEnvMin(min: number, defaultValue?: number) {
  const base = z.string().transform(Number).pipe(z.number().int().min(min))
  return defaultValue !== undefined ? base.default(String(defaultValue)) : base
}

/** Env var numérica (float). Usa: `floatEnv()` o `floatEnv(0.5)` */
export function floatEnv(defaultValue?: number) {
  const base = z.string().transform(Number).pipe(z.number())
  return defaultValue !== undefined ? base.default(String(defaultValue)) : base
}

/** Env var numérica (float) con min. Usa: `floatEnvMin(0)` o `floatEnvMin(0, 1.5)` */
export function floatEnvMin(min: number, defaultValue?: number) {
  const base = z.string().transform(Number).pipe(z.number().min(min))
  return defaultValue !== undefined ? base.default(String(defaultValue)) : base
}

/** Env var booleana ('true'/'false'). Usa: `boolEnv()` o `boolEnv(false)` */
export function boolEnv(defaultValue?: boolean) {
  const base = z.string().transform((v: string) => v === 'true').pipe(z.boolean())
  return defaultValue !== undefined ? base.default(String(defaultValue)) : base
}
