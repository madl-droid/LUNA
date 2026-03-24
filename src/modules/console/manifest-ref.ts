// LUNA — Console registry reference
// Shared mutable reference so API route handlers can access the registry.
// Set by manifest.init(), read by server.ts route handlers.

import type { Registry } from '../../kernel/registry.js'

let _registry: Registry | null = null

export function setRegistryRef(registry: Registry): void {
  _registry = registry
}

export function getRegistryRef(): Registry | null {
  return _registry
}
