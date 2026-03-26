# Auditoría: Build, Tests & Calidad de Código
Fecha: 2026-03-26
Auditor: Claude (sesión en server LUNA-S)

## Resumen ejecutivo

El proyecto LUNA compila TypeScript sin errores (0 errores de tipo). ESLint reporta 64 warnings y 0 errores. Los 49 tests existentes pasan al 100%. Sin embargo, la cobertura de tests es extremadamente baja: solo el módulo `tools/freight` tiene tests (4 archivos, 49 tests); los otros 19 módulos tienen 0 tests. Hay 14 vulnerabilidades de seguridad en dependencias (4 high, 10 moderate) y 13 paquetes desactualizados. El tsconfig excluye 5 directorios del chequeo de tipos, lo que oculta posibles errores.

## TypeScript Build
- Estado: ✅ PASS
- Errores de tipo: 0
- Warnings: 0

### tsconfig.json config
| Setting | Valor | Adecuado |
|---------|-------|----------|
| strict | true | ✅ |
| target | ES2022 | ✅ |
| module | NodeNext | ✅ |
| moduleResolution | NodeNext | ✅ |
| noUncheckedIndexedAccess | true | ✅ |
| noUnusedLocals | false | ⚠️ Debería ser true |
| noUnusedParameters | false | ⚠️ Debería ser true |
| skipLibCheck | true | ✅ OK para velocidad |
| declaration | true | ✅ |
| sourceMap | true | ✅ |

### Exclusiones del tsconfig (⚠️ IMPORTANTE)
Los siguientes directorios están **excluidos** del chequeo de tipos:
| Directorio excluido | Impacto |
|---------------------|---------|
| src/config.ts | Bajo |
| src/channels | Medio — lógica de canales sin verificar |
| src/engine | **ALTO** — motor principal sin verificar tipos |
| src/llm | **ALTO** — integración LLM sin verificar tipos |
| src/memory | Medio — sistema de memoria sin verificar |
| src/console | Medio — consola de admin sin verificar |

> Estas exclusiones significan que errores de tipo en el engine, LLM y channels pasan desapercibidos en compilación.

### Errores de compilación
Ninguno (0 errores).

## ESLint
- Estado: ⚠️ PASS con warnings
- Errores: 0
- Warnings: 64

### Configuración
| Regla clave | Estado | Adecuada |
|-------------|--------|----------|
| @typescript-eslint/no-explicit-any | warn | ✅ |
| @typescript-eslint/no-unused-vars | warn (ignora `^_`) | ✅ |
| no-console | warn | ✅ |

> La configuración es minimalista — solo 3 reglas. Podría beneficiarse de reglas adicionales (no-floating-promises, strict-boolean-expressions, etc.)

### Top reglas violadas
| Regla | Count | Severidad |
|-------|-------|-----------|
| @typescript-eslint/no-unused-vars | 62 | warning |
| @typescript-eslint/no-explicit-any | 2 | warning |

### Archivos con más warnings
| Archivo | Warnings | Detalle |
|---------|----------|---------|
| src/modules/console/templates-sections.ts | 7 | Variables no usadas |
| src/modules/llm/llm-gateway.ts | 4 | Variables/parámetros no usados |
| src/modules/twilio-voice/manifest.ts | 3 | Variables no usadas |
| src/modules/console/templates-channel-settings.ts | 3 | Variables no usadas |
| src/modules/knowledge/pg-store.ts | 2 | Import y parámetro no usado |
| src/modules/medilink/manifest.ts | 2 | Import no usado + any |
| src/modules/medilink/tools.ts | 2 | Variables no usadas |
| src/modules/scheduled-tasks/templates.ts | 2 | Parámetro y variable no usados |

## Tests
- Estado: ✅ ALL PASS
- Test Files: 4 passed (4)
- Tests: 49 passed / 0 failed / 0 skipped
- Duración: 1.10s

### Tests existentes
| Suite | Tests | Estado | Duración |
|-------|-------|--------|----------|
| tests/freight/dhl-express-adapter.test.ts | 11 | ✅ Pass | 24ms |
| tests/freight/searates-adapter.test.ts | 13 | ✅ Pass | 23ms |
| tests/freight/freight-tool.test.ts | 16 | ✅ Pass | 18ms |
| tests/freight/freight-router.test.ts | 9 | ✅ Pass | 19ms |

### Tests fallidos
Ninguno.

### vitest.config.ts
| Setting | Valor |
|---------|-------|
| environment | node |
| globals | true |
| testTimeout | 30000ms |
| coverage provider | v8 |
| coverage include | src/**/*.ts |
| coverage exclude | src/index.ts |

## Dependency Security (npm audit)
- Vulnerabilidades: 0 critical / 4 high / 10 moderate / 0 low
- Total: **14 vulnerabilidades**

### Detalle
| Package | Severity | Advisory | Fix available |
|---------|----------|----------|---------------|
| xlsx | high | Prototype Pollution (GHSA-4r6h) | ❌ No fix |
| xlsx | high | ReDoS (GHSA-5pgg) | ❌ No fix |
| nodemailer <=7.0.10 | high | Email domain confusion (GHSA-mm7p) | ✅ Breaking (v8) |
| nodemailer <=7.0.10 | high | DoS en addressparser (GHSA-rcmh) | ✅ Breaking (v8) |
| flatted <=3.4.1 | high | Prototype Pollution (GHSA-rf6f) | ✅ npm audit fix |
| picomatch 4.0.0-4.0.3 | high | ReDoS + Method Injection | ✅ npm audit fix |
| brace-expansion <5.0.5 | moderate | Process hang/memory exhaustion | ✅ Breaking |
| esbuild <=0.24.2 | moderate | Dev server request leak | ✅ Breaking |
| minimatch (vía brace-expansion) | moderate | Transitiva | ✅ Breaking |
| eslint/config-array/eslintrc | moderate | Transitivas | ✅ Breaking |

> **xlsx** no tiene fix disponible y tiene 2 vulnerabilidades high. Considerar reemplazo por `exceljs` o `sheetjs-ce`.

## Outdated Packages
| Package | Current | Wanted | Latest | Tipo |
|---------|---------|--------|--------|------|
| @anthropic-ai/sdk | 0.78.0 | 0.78.0 | 0.80.0 | Major |
| @types/node | 22.19.15 | 22.19.15 | 25.5.0 | Major |
| bullmq | 5.71.0 | 5.71.1 | 5.71.1 | Patch ✅ |
| google-auth-library | 9.15.1 | 9.15.1 | 10.6.2 | Major |
| googleapis | 144.0.0 | 144.0.0 | 171.4.0 | Major |
| ioredis | 5.10.0 | 5.10.1 | 5.10.1 | Patch ✅ |
| nodemailer | 6.10.1 | 6.10.1 | 8.0.4 | Major |
| pino | 9.14.0 | 9.14.0 | 10.3.1 | Major |
| twilio | 5.13.0 | 5.13.1 | 5.13.1 | Patch ✅ |
| uuid | 11.1.0 | 11.1.0 | 13.0.0 | Major |
| varlock | 0.5.0 | 0.5.0 | 0.6.3 | Minor |
| ws | 8.19.0 | 8.20.0 | 8.20.0 | Minor ✅ |
| zod | 3.25.76 | 3.25.76 | 4.3.6 | Major |

> 3 patches seguros (bullmq, ioredis, twilio), 2 minor seguros (ws, varlock). El resto son majors que requieren evaluación.

## Package Analysis
### Dependencias posiblemente no usadas
Todas las dependencias declaradas en package.json se importan en al menos un archivo de src/. No se detectaron dependencias huérfanas.

### ¿devDependencies correctas?
| Package | Ubicación | Correcto |
|---------|-----------|----------|
| @types/* | devDependencies | ✅ |
| typescript | devDependencies | ✅ |
| eslint + plugins | devDependencies | ✅ |
| vitest | devDependencies | ✅ |
| tsx | devDependencies | ✅ |

### Lock file: ✅ Presente (264KB)

## Cobertura de tests por módulo
| Componente | Archivos .ts | Test files | Cobertura estimada | Criticidad |
|------------|-------------|------------|-------------------|------------|
| kernel | 16 | 0 | 0% | **ALTA** |
| engine | 52 | 0 | 0% | **ALTA** |
| llm (core) | 1 | 0 | 0% | **ALTA** |
| memory (core) | 4 | 0 | 0% | **ALTA** |
| channels | 5 | 0 | 0% | **ALTA** |
| modules/llm | 9 | 0 | 0% | **ALTA** |
| modules/memory | 5 | 0 | 0% | ALTA |
| modules/console | 9 | 0 | 0% | MEDIA |
| modules/engine | 1 | 0 | 0% | MEDIA |
| modules/knowledge | 20 | 0 | 0% | ALTA |
| modules/medilink | 10 | 0 | 0% | ALTA |
| modules/users | 11 | 0 | 0% | ALTA |
| modules/whatsapp | 4 | 0 | 0% | MEDIA |
| modules/google-chat | 3 | 0 | 0% | MEDIA |
| modules/gmail | 6 | 0 | 0% | MEDIA |
| modules/google-apps | 9 | 0 | 0% | MEDIA |
| modules/lead-scoring | 11 | 0 | 0% | MEDIA |
| modules/twilio-voice | 10 | 0 | 0% | MEDIA |
| modules/scheduled-tasks | 7 | 0 | 0% | MEDIA |
| modules/tts | 3 | 0 | 0% | BAJA |
| modules/model-scanner | 2 | 0 | 0% | BAJA |
| modules/prompts | 4 | 0 | 0% | BAJA |
| modules/tools | 6 | 0 | 0% | MEDIA |
| modules/freshdesk | 1 | 0 | 0% | BAJA |
| modules/freight | 1 | 0 | 0% | BAJA |
| tools/freight | 12 | 4 | ~33% | BAJA |
| tools/freshdesk | — | 0 | 0% | BAJA |
| **TOTAL** | **223** | **4** | **~1.8%** | — |

### Módulos más críticos sin tests
1. **engine** (52 archivos) — Motor principal de procesamiento de mensajes
2. **kernel** (16 archivos) — Core del sistema, configuración, migraciones
3. **modules/knowledge** (20 archivos) — Base de conocimiento, búsqueda
4. **modules/users** (11 archivos) — Gestión de usuarios
5. **modules/medilink** (10 archivos) — Integración con sistema médico

## Scripts de package.json
| Script | Funciona | Output |
|--------|----------|--------|
| build (`tsc`) | ✅ | Compila sin errores |
| lint (`eslint src/`) | ⚠️ | 0 errores, 64 warnings |
| test (`vitest run`) | ✅ | 49/49 tests pasan en 1.1s |
| dev (`tsx src/index.ts`) | ✅ | Funcional (requiere .env y servicios) |
| migrate (`tsx scripts/migrate.ts`) | N/A | Requiere DB corriendo |

## Estructura del proyecto
### Archivos vacíos encontrados
Ninguno.

### Archivos .js en src/ (deberían ser .ts)
| Archivo | Nota |
|---------|------|
| src/modules/console/ui/js/console-minimal.js | Archivo de frontend — OK como .js |

### Posibles imports circulares
No se detectaron patrones circulares evidentes en el análisis básico.

### Estructura de directorios
- 27 módulos/componentes bajo `src/`
- Organización clara: kernel → engine → modules → tools
- UI embebido en `modules/console/ui/` (HTML/JS/CSS servido por el backend)

## Deuda técnica
| # | Prioridad | Descripción | Esfuerzo estimado |
|---|-----------|-------------|-------------------|
| 1 | 🔴 Crítica | tsconfig excluye engine, llm, memory, channels, console del type-check — errores de tipo pasan desapercibidos | 2-4 días (corregir errores de tipo) |
| 2 | 🔴 Crítica | Cobertura de tests ~1.8% — solo freight tiene tests, 0 tests para kernel, engine, LLM, knowledge, users | Semanas (incremental) |
| 3 | 🟠 Alta | xlsx tiene 2 vulnerabilidades high sin fix — evaluar reemplazo | 1 día |
| 4 | 🟠 Alta | nodemailer tiene 2 vulnerabilidades high — actualizar a v8 (breaking) | 0.5 días |
| 5 | 🟠 Alta | flatted y picomatch vulnerables — fix directo disponible con `npm audit fix` | 10 min |
| 6 | 🟡 Media | 62 variables/imports no usados reportados por ESLint | 1-2 horas |
| 7 | 🟡 Media | noUnusedLocals y noUnusedParameters deshabilitados en tsconfig | 1 hora (activar + limpiar) |
| 8 | 🟡 Media | ESLint con solo 3 reglas — faltan reglas importantes (no-floating-promises, strict-boolean-expressions) | 0.5 días |
| 9 | 🟢 Baja | 5 patches/minor seguros pendientes (bullmq, ioredis, twilio, ws, varlock) | 15 min |
| 10 | 🟢 Baja | 8 majors pendientes — evaluar case-by-case | Variable |

## Score de calidad: 2.5/5

**Justificación:**
- **Build (+1):** Compila sin errores, configuración strict habilitada
- **Tests (-1.5):** Solo 1.8% de cobertura, únicamente freight testeado
- **Seguridad (-0.5):** 14 vulnerabilidades, xlsx sin fix
- **Código (+0.5):** 0 errores ESLint, solo warnings menores
- **Arquitectura (-0.5):** tsconfig excluye componentes críticos del type-check, reduciendo la confiabilidad del build "sin errores"
- **Dependencias (+0.5):** Lock file presente, no hay deps huérfanas, devDeps correctas

## Top 10 acciones prioritarias

1. **Eliminar exclusiones del tsconfig** — Incluir engine, llm, memory, channels y console en el chequeo de tipos. Corregir los errores de tipo que aparezcan. Esto es la acción de mayor impacto.
2. **Agregar tests para engine** — 52 archivos sin ningún test. Empezar con el flujo principal de procesamiento de mensajes.
3. **Agregar tests para kernel** — Config store, loader, migraciones. Son la base del sistema.
4. **Ejecutar `npm audit fix`** — Corrige flatted y picomatch inmediatamente (no breaking).
5. **Evaluar reemplazo de xlsx** — Tiene vulnerabilidades sin fix. Considerar `exceljs` o `xlsx-populate`.
6. **Actualizar nodemailer a v8** — Corrige 2 vulnerabilidades high. Revisar breaking changes.
7. **Agregar tests para modules/knowledge** — 20 archivos, sistema crítico de búsqueda/RAG.
8. **Limpiar 62 unused vars** — Eliminar o prefijar con `_`. Habilitar `noUnusedLocals: true` en tsconfig.
9. **Aplicar patches seguros** — Actualizar bullmq, ioredis, twilio, ws, varlock (sin breaking changes).
10. **Expandir reglas ESLint** — Agregar `@typescript-eslint/no-floating-promises`, `@typescript-eslint/strict-boolean-expressions`, `@typescript-eslint/no-misused-promises`.
