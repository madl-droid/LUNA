# AUDIT REPORT — LUNA

Fecha: 2026-04-02

## Alcance y método
- Barrido inicial del repo completo: estructura, `CLAUDE.md`, `package.json`, `tsconfig.json`, entry points, loader dinámico, tests y workflows.
- Validaciones ejecutadas:
- `npm ci` — OK
- `npx tsc --noEmit` — OK
- `npm test` — FAIL (`3` tests fallando, `165` pasando)
- `npm run lint` — OK con `31` warnings
- El codebase es grande (`326` archivos `.ts`, ~`112k` líneas no vacías). Conceptualmente conviene auditarlo por sesiones temáticas, pero este informe ya cubre los hallazgos estructurales y de mayor señal del barrido completo.

## Resumen Ejecutivo

### Conteo por severidad
| Severidad | Hallazgos |
|---|---:|
| 🔴 CRÍTICO | 3 |
| 🟡 IMPORTANTE | 10 |
| 🟢 MENOR | 1 |

### Conteo por categoría
| Categoría | Hallazgos |
|---|---:|
| 1. Código muerto y archivos huérfanos | 3 |
| 2. Variables y constantes innecesarias | 1 |
| 3. Código duplicado | 1 |
| 4. Tipos y TypeScript | 1 |
| 5. Dependencias | 3 |
| 6. Errores y bugs potenciales | 2 |
| 7. Arquitectura y coherencia | 1 |
| 8. Configuración y DevOps | 3 |

### Validación rápida
- `tsc` compila limpio, así que el repo no está roto a nivel de tipado básico.
- El suite de tests no está sano: hay `3` fallos reales.
- El lint sigue mostrando `31` warnings, casi todos ligados a async/fire-and-forget y `any`.

## Hallazgos

### 1. El deploy de staging apunta a un path distinto al documentado
- Archivo y líneas: `.github/workflows/deploy.yml:53-56`, `deploy/CLAUDE.md:18-24`
- Categoría: 8. Configuración y DevOps
- Severidad: 🔴 CRÍTICO
- Descripción: el workflow hace `cd /docker/lab` para `pruebas`, pero la documentación oficial del repo dice que staging vive en `/docker/luna-staging`. Si el servidor sigue la documentación, el deploy de staging queda roto o despliega en el directorio equivocado.
- Acción recomendada: corregir el path en el workflow o actualizar la documentación, pero dejar una sola fuente de verdad.

### 2. El `docker-compose.dev.yml` usa PostgreSQL sin `pgvector`
- Archivo y líneas: `docker-compose.dev.yml:2-3`, `deploy/CLAUDE.md:30-34`
- Categoría: 8. Configuración y DevOps
- Severidad: 🟡 IMPORTANTE
- Descripción: el entorno dev monta `postgres:16`, mientras la documentación del proyecto exige `pgvector/pgvector:pg16`. Memory v3 y Knowledge v2 dependen de `pgvector`; con este compose, el desarrollo local queda inconsistente con producción y puede fallar al usar embeddings/vector search.
- Acción recomendada: cambiar la imagen a `pgvector/pgvector:pg16` y alinear dev con prod.

### 3. El script `npm run migrate` está roto
- Archivo y líneas: `package.json:10`, `scripts/` (no existe `scripts/migrate.ts`)
- Categoría: 8. Configuración y DevOps
- Severidad: 🟡 IMPORTANTE
- Descripción: `package.json` expone `"migrate": "tsx scripts/migrate.ts"`, pero ese archivo no existe. El script es basura operativa: aparenta ser utilizable y fallará siempre.
- Acción recomendada: eliminar el script o recrear el archivo real y probarlo.

### 4. La tool de freight tiene una firma pública inconsistente y rompe 2 tests
- Archivo y líneas: `src/tools/freight/freight-tool.ts:127-131`, `src/tools/freight/freight-tool.ts:223`, `tests/freight/freight-tool.test.ts:183`, `tests/freight/freight-tool.test.ts:225`
- Categoría: 6. Errores y bugs potenciales
- Severidad: 🔴 CRÍTICO
- Descripción: `handleEstimateFreight()` ahora exige `carrierBuffers`, pero los tests y cualquier consumidor directo la siguen llamando con 3 argumentos. Eso provoca `Cannot read properties of undefined (reading 'searates'/'dhl_express')` al acceder `carrierBuffers[carrierId]`.
- Acción recomendada: hacer `carrierBuffers` opcional con default seguro o encapsularla para que no sea importable externamente.

### 5. El default real de `escapeDataForPrompt()` no coincide con el contrato esperado por tests
- Archivo y líneas: `src/engine/utils/prompt-escape.ts:42`, `tests/engine/prompt-escape.test.ts:75-79`
- Categoría: 4. Tipos y TypeScript
- Severidad: 🟡 IMPORTANTE
- Descripción: el test espera límite por defecto de `3000`, pero la implementación usa `6000`. Eso ya rompe CI y además deja ambiguo cuál es el contrato real del helper.
- Acción recomendada: decidir el límite correcto y alinear código + tests + docs.

### 6. Hay lectura de `process.env` fuera del kernel
- Archivo y líneas: `src/modules/knowledge/manifest.ts:1098`, `CLAUDE.md` (regla de arquitectura), `src/kernel/CLAUDE.md` (regla de arquitectura)
- Categoría: 7. Arquitectura y coherencia
- Severidad: 🟡 IMPORTANTE
- Descripción: `KNOWLEDGE_GOOGLE_AI_API_KEY` hace fallback directo a `process.env['GOOGLE_AI_API_KEY']`, rompiendo la regla central del repo: solo `src/kernel/config.ts` puede leer env directamente. Esto mete una excepción silenciosa al modelo de config distribuido.
- Acción recomendada: mover ese fallback al flujo formal de config o declararlo explícitamente vía schema/config-store sin tocar `process.env` en el módulo.

### 7. WhatsApp importa `@hapi/boom` sin declararlo en `package.json`
- Archivo y líneas: `src/modules/whatsapp/adapter.ts:7`, `package.json:14-37`
- Categoría: 5. Dependencias
- Severidad: 🟡 IMPORTANTE
- Descripción: el código importa `@hapi/boom`, pero el paquete no está declarado. Hoy funciona solo porque viene transitivamente desde otra dependencia. Eso es frágil: basta un cambio aguas arriba para romper instalaciones limpias.
- Acción recomendada: declarar `@hapi/boom` como dependencia directa o eliminar el import si ya no hace falta.

### 8. Hay dependencias directas que no se usan
- Archivo y líneas: `package.json:31-35`
- Categoría: 5. Dependencias
- Severidad: 🟡 IMPORTANTE
- Descripción: `twilio` y `varlock` no tienen referencias en `src/`, `tests/` ni `scripts/`. En particular, el módulo `twilio-voice` usa un cliente propio basado en `fetch`, no el SDK oficial.
- Acción recomendada: eliminar `twilio` y `varlock` del manifest si no existe uso externo real.

### 9. Hay dependencias con vulnerabilidades conocidas, incluyendo una directa y alta en `xlsx`
- Archivo y líneas: `package.json:35`, `package.json:52`
- Categoría: 5. Dependencias
- Severidad: 🔴 CRÍTICO
- Descripción: `npm audit` reportó `8` vulnerabilidades (`2` high, `6` moderate). La más delicada es `xlsx@0.18.5` con advisories de Prototype Pollution y ReDoS, sin fix automático disponible. Además, el stack `vitest`/`vite` arrastra advisories moderados que piden upgrade mayor.
- Acción recomendada: priorizar reemplazo o upgrade de `xlsx`, luego planificar upgrade controlado de `vitest`/`vite`.

### 10. `lead-scoring` conserva lógica legacy de campañas ya movida a `marketing-data`
- Archivo y líneas: `src/modules/lead-scoring/campaign-queries.ts:1`, `src/modules/lead-scoring/campaign-matcher.ts:1`, `src/modules/lead-scoring/CLAUDE.md:14-16`, `src/modules/lead-scoring/CLAUDE.md:26`
- Categoría: 1. Código muerto y archivos huérfanos
- Severidad: 🟡 IMPORTANTE
- Descripción: la propia documentación del módulo marca esos archivos como legacy y dice que campañas viven ahora en `marketing-data`, pero los archivos siguen en el repo. Esto es deuda de duplicación y una fuente clara de confusión al navegar el módulo.
- Acción recomendada: eliminar los archivos legacy una vez confirmado que no existen consumidores externos fuera del repo.

### 11. Quedaron archivos fuente sin inbound references en el grafo real de `src`
- Archivo y líneas: `src/channels/channel-adapter.ts:1`, `src/modules/users/index.ts:1`, `src/modules/tts/types.ts:1`, `src/modules/knowledge/extractors/docx.ts:1`, `src/modules/knowledge/extractors/image.ts:1`, `src/modules/knowledge/extractors/markdown.ts:1`, `src/modules/knowledge/extractors/pdf.ts:1`
- Categoría: 1. Código muerto y archivos huérfanos
- Severidad: 🟡 IMPORTANTE
- Descripción: estos archivos quedaron con `0` referencias entrantes dentro de `src` después de considerar entry point y manifests dinámicos. Algunos son barrels o shims de compatibilidad, pero hoy no participan en el runtime principal.
- Acción recomendada: validar si existen imports externos fuera del repo; si no, eliminarlos o consolidarlos.

### 12. `.env.example` arrastra variables que el código ya no consume
- Archivo y líneas: `.env.example:30-31`, `.env.example:58-59`, `.env.example:96`, `.env.example:148-149`, `.env.example:157-158`
- Categoría: 2. Variables y constantes innecesarias
- Severidad: 🟡 IMPORTANTE
- Descripción: estas claves no aparecen referenciadas por el código del repo: `BULLMQ_DEFAULT_ATTEMPTS`, `BULLMQ_BACKOFF_DELAY_MS`, `WHATSAPP_RECONNECT_INTERVAL_MS`, `WHATSAPP_MAX_RECONNECT_ATTEMPTS`, `LLM_COMPRESS_PROVIDER`, `QUALIFYING_CRITERIA_FILE`, `LEAD_SCORING_ENABLED`, `MEDIA_STORAGE_DIR`, `MEDIA_MAX_FILE_SIZE_MB`.
- Acción recomendada: eliminar las que estén muertas o reconectarlas al código si debían seguir vigentes.

### 13. Persisten hotspots de promesas flotantes y errores tragados en runtime
- Archivo y líneas: `src/modules/knowledge/faq-manager.ts:210-211`, `src/modules/llm/llm-gateway.ts:87-90`, `src/modules/llm/llm-gateway.ts:384-388`, `src/modules/whatsapp/adapter.ts:204-207`, `src/engine/engine.ts:367-378`
- Categoría: 6. Errores y bugs potenciales
- Severidad: 🟡 IMPORTANTE
- Descripción: siguen existiendo callbacks async en timers/eventos y operaciones fire-and-forget sin `await` ni manejo robusto. Algunas solo “mejor esfuerzo”, pero otras son señales de estado (`llm:provider_up`) o reconexiones de canal, así que los fallos pueden perderse silenciosamente.
- Acción recomendada: convertir estos puntos a `void` explícito con `.catch(logger...)` o a flujos awaited donde el orden importe.

### 14. El repo acumulaba varios directorios legacy completamente vacíos
- Archivo y líneas: `src/admin/`, `src/llm/`, `src/memory/`, `src/oficina/`, `src/channels/whatsapp/`, `src/engine/mocks/`, `src/modules/model-scanner/`, `src/modules/oficina/`
- Categoría: 1. Código muerto y archivos huérfanos
- Severidad: 🟢 MENOR
- Descripción: había residuos vacíos de estructuras antiguas o renombradas. No aportaban nada al build ni al loader y solo metían ruido visual.
- Acción recomendada: eliminar.

## Fixes Seguros Aplicados
- `src/kernel/bootstrap.ts:23-33`
- Eliminado contador write-only que no aportaba nada y generaba warning de lint.
- `src/engine/attachments/injection-validator.ts:5`
- Normalizado import de core module de `crypto` a `node:crypto`.
- Directorios vacíos eliminados:
- `src/admin/`
- `src/llm/`
- `src/memory/`
- `src/oficina/`
- `src/channels/whatsapp/`
- `src/engine/mocks/`
- `src/modules/model-scanner/`
- `src/modules/oficina/`

## Top 10 Acciones de Mayor Impacto
1. Corregir `.github/workflows/deploy.yml` para que staging despliegue al path real.
2. Arreglar la firma/default de `handleEstimateFreight()` y dejar `npm test` en verde.
3. Resolver el contrato de `escapeDataForPrompt()` y alinear test + implementación.
4. Reemplazar o aislar `xlsx@0.18.5` por el riesgo de seguridad actual.
5. Declarar `@hapi/boom` explícitamente o eliminarlo del adapter de WhatsApp.
6. Eliminar `twilio` y `varlock` si se confirma que están muertos.
7. Restaurar o borrar el script `npm run migrate`.
8. Quitar el fallback a `process.env` desde `knowledge/manifest.ts`.
9. Borrar los archivos legacy de campañas que siguen en `lead-scoring`.
10. Atacar el bloque de warnings async/fire-and-forget que hoy deja fallos silenciosos.

## Estimación de Líneas que se Pueden Eliminar
- Conservador: ~`600` LOC ya son buenos candidatos de eliminación casi directa.
- Desglose principal:
- `591` LOC en archivos legacy/huérfanos detectados con alta confianza (`lead-scoring` legacy campaigns, barrels/shims sin inbound references, interfaces/types muertos).
- `0` LOC funcionales en directorios vacíos ya eliminados.
- Hay margen adicional si luego se purgan scripts sueltos no conectados y variables de entorno/documentación obsoleta.
