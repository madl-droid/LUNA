# OLA 4 — Reporte de TypeScript & Calidad
## Fecha: 2026-03-27
## Branch: claude/apply-audit-adjustments-H0ud1

### Exclusiones removidas del tsconfig
| Directorio | Errores encontrados | BUG_REAL | Corregidos | @ts-expect-error |
|---|---|---|---|---|
| src/config.ts | 0 (archivo no existe) | 0 | N/A | 0 |
| src/console | 0 (directorio no existe) | 0 | N/A | 0 |
| src/llm | 2 (dead code) | 0 | Eliminado | 0 |
| src/memory | 3 (dead code) | 0 | Eliminado | 0 |
| src/channels | 1 (dead code) | 0 | Eliminado | 0 |
| src/engine | 0 (ya compilaba bien) | 0 | N/A | 0 |

### Dead code eliminado (7 archivos)
- `src/channels/whatsapp/baileys-adapter.ts` — legacy adapter, reemplazado por modules/whatsapp
- `src/llm/model-scanner.ts` — legacy scanner, reemplazado por modules/model-scanner
- `src/memory/memory-manager.ts` — legacy, reemplazado por modules/memory
- `src/memory/pg-store.ts` — legacy, reemplazado por modules/memory
- `src/memory/redis-buffer.ts` — legacy, reemplazado por modules/memory
- `src/memory/types.ts` — legacy types, sin imports externos
- `src/channels/whatsapp/` directory — vaciado y eliminado
- `src/llm/` directory — vaciado y eliminado
- `src/memory/` directory — vaciado y eliminado

### Unused vars limpiados: 78
- 58 detectados por ESLint (imports, variables, params)
- 20 detectados por tsc con noUnusedLocals/noUnusedParameters (class properties, locals)
- Tipos de fix: removed unused imports, prefixed params with `_`, removed dead variables, removed unused class properties

### tsconfig.json cambios
- Removidas 6 exclusiones obsoletas: src/config.ts, src/channels, src/engine, src/llm, src/memory, src/console
- Habilitado `noUnusedLocals: true` (era false)
- Habilitado `noUnusedParameters: true` (era false)

### Reglas ESLint agregadas
- `@typescript-eslint/no-floating-promises: warn` — detecta Promises sin await/catch (8 warnings)
- `@typescript-eslint/no-misused-promises: warn` — detecta Promises donde no se esperan (18 warnings)
- `@typescript-eslint/await-thenable: warn` — detecta await en no-Promises (0 warnings)
- Habilitado `parserOptions.project` para reglas type-aware

### Errores ESLint: 0 errors, 29 warnings
- 18 no-misused-promises (warn)
- 8 no-floating-promises (warn)
- 2 no-explicit-any (warn)
- 1 no-console (warn)

### Dependencias
| Paquete | Accion | De → A | Notas |
|---|---|---|---|
| nodemailer | **Removido** | ^6.10.1 → N/A | Phantom dependency — 0 imports en src/, eliminaba 2 high vulns |
| @types/nodemailer | **Removido** | ^6.4.17 → N/A | Tipos del paquete removido |
| xlsx | Sin cambio | ^0.18.5 | 1 high vuln sin fix upstream, activamente usado por knowledge extractors |
| vite/vitest | Sin cambio | - | 10 moderate vulns, solo dev deps |

### Estado final
- Build: ✅ (0 errores, 0 exclusiones, strict + noUnused habilitados)
- Lint: 0 errors, 29 warnings
- Tests: ✅ 64/64 passed
- @ts-expect-error temporales: 0
- Vulnerabilities: 11 (10 moderate dev-only, 1 high xlsx sin fix)
