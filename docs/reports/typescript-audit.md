# Auditoría TypeScript — Exclusiones del tsconfig
## Fecha: 2026-03-27

## Resumen
- **Total errores (con exclusiones removidas): 6**
- Exclusiones encontradas: `src/config.ts`, `src/channels`, `src/engine`, `src/llm`, `src/memory`, `src/console`
- Archivos afectados: 5
- **Todos los 6 errores están en archivos de código muerto (legacy, sin imports externos)**

## Exclusiones en tsconfig.json
| Directorio | Mecanismo | Archivos | Estado real |
|---|---|---|---|
| `src/config.ts` | `exclude` | 0 (archivo no existe) | **Eliminado** — exclusión obsoleta |
| `src/channels` | `exclude` | 6 archivos (types.ts, message-batcher.ts, typing-delay.ts, channel-adapter.ts, whatsapp/baileys-adapter.ts) | **Parcialmente activo** — types.ts, message-batcher.ts, typing-delay.ts usados por engine+modules. baileys-adapter.ts es dead code |
| `src/engine` | `exclude` | ~52 archivos | **Activo** — corazón del pipeline, ya compila con tsconfig principal vía módulo engine |
| `src/llm` | `exclude` | 1 archivo (model-scanner.ts) | **Dead code** — reemplazado por src/modules/model-scanner/ |
| `src/memory` | `exclude` | 4 archivos (memory-manager.ts, pg-store.ts, redis-buffer.ts, types.ts) | **Dead code** — reemplazado por src/modules/memory/ |
| `src/console` | `exclude` | 0 (directorio no existe) | **Eliminado** — exclusión obsoleta, console vive en src/modules/console/ |

## Errores por categoría
| Categoría | Count | % |
|---|---|---|
| IMPORT_ERROR (TS2307) | 6 | 100% |

## Errores por impacto
| Impacto | Count | % |
|---|---|---|
| COSMETIC (dead code) | 6 | 100% |
| BUG_REAL | 0 | 0% |
| TYPE_DEBT | 0 | 0% |

## Detalle de errores
| # | Archivo:Línea | Error | Impacto | Nota |
|---|---|---|---|---|
| 1 | src/channels/whatsapp/baileys-adapter.ts:10 | TS2307: Cannot find module '../../config.js' | COSMETIC | Dead code — nadie importa este archivo |
| 2 | src/llm/model-scanner.ts:9 | TS2307: Cannot find module '../config.js' | COSMETIC | Dead code — reemplazado por modules/model-scanner |
| 3 | src/llm/model-scanner.ts:268 | TS2307: Cannot find module '../config.js' | COSMETIC | Mismo archivo, segunda referencia |
| 4 | src/memory/memory-manager.ts:5 | TS2307: Cannot find module '../config.js' | COSMETIC | Dead code — reemplazado por modules/memory |
| 5 | src/memory/pg-store.ts:6 | TS2307: Cannot find module '../config.js' | COSMETIC | Dead code — reemplazado por modules/memory |
| 6 | src/memory/redis-buffer.ts:6 | TS2307: Cannot find module '../config.js' | COSMETIC | Dead code — reemplazado por modules/memory |

## Archivos activos vs dead code en directorios excluidos

### src/channels/ (5 archivos)
| Archivo | Estado | Importado por |
|---|---|---|
| types.ts | **ACTIVO** | engine (7 files), modules/whatsapp, modules/google-chat |
| message-batcher.ts | **ACTIVO** | modules/whatsapp, modules/google-chat |
| typing-delay.ts | **ACTIVO** | engine/phases/phase5-validate |
| channel-adapter.ts | Verificar | - |
| whatsapp/baileys-adapter.ts | **DEAD** | nadie |

### src/llm/ (1 archivo)
| Archivo | Estado | Importado por |
|---|---|---|
| model-scanner.ts | **DEAD** | nadie — reemplazado por modules/model-scanner |

### src/memory/ (4 archivos)
| Archivo | Estado | Importado por |
|---|---|---|
| memory-manager.ts | **DEAD** | nadie — reemplazado por modules/memory |
| pg-store.ts | **DEAD** | nadie — reemplazado por modules/memory |
| redis-buffer.ts | **DEAD** | nadie — reemplazado por modules/memory |
| types.ts | Verificar | posiblemente importado por dead files |

## ESLint — Unused vars
- **Total warnings: 61** (58 no-unused-vars, 2 no-explicit-any, 1 no-console)
- `noUnusedLocals` y `noUnusedParameters` están desactivados en tsconfig

## Dependencias vulnerables
| Paquete | Versión actual | Severidad | Fix disponible | Uso en codebase |
|---|---|---|---|---|
| xlsx | ^0.18.5 | 2 high | **No** (sin fix upstream) | Activo — knowledge extractors, FAQ import |
| nodemailer | ^6.10.1 | 2 high | Sí (v8.0.4) | No encontrado en src/ — posible dependencia indirecta |
| vite/vitest | - | 10 moderate | - | Solo dev dependency |

## Recomendación de orden para Fase B
1. **Eliminar dead code** — borrar src/llm/model-scanner.ts, src/memory/ (4 files), src/channels/whatsapp/baileys-adapter.ts → elimina los 6 errores
2. **Remover exclusiones obsoletas** — quitar del exclude: src/config.ts (no existe), src/console (no existe), src/llm (vacío tras borrar), src/memory (vacío tras borrar)
3. **Limpiar 58 unused vars** — prefijo `_`, eliminar imports, etc.
4. **Actualizar nodemailer** 6→8 (si se usa) o desinstalar
5. **Evaluar reemplazo de xlsx** por exceljs (requiere refactor de extractors)
6. **Expandir ESLint** — agregar no-floating-promises y otras reglas
7. **Habilitar noUnusedLocals/noUnusedParameters** en tsconfig

## Estimación de esfuerzo
- Dead code + exclusiones obsoletas: trivial (borrar archivos, editar tsconfig)
- Unused vars: ~1h (58 warnings, la mayoría automáticos)
- Dependencias: nodemailer upgrade ~30min, xlsx evaluation ~1h
- ESLint expansion: depende del conteo de errores nuevos
- **0 BUG_REAL encontrados** — el código excluido que importaba config.ts nunca se ejecuta
