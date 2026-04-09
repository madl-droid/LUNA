# INFORME DE CIERRE — Optimización de Prompts Base
## Branch: claude/optimize-base-prompts-YdRBn

### Objetivos definidos
Optimizar TODOS los prompts de LUNA para crear una base sólida reutilizable por todas las instancias. Tres fases:
1. Cleanup: eliminar prompts muertos, extraer inline a .md, eliminar fallbacks inline, refactorear acentos
2. Optimización de contenido: reescribir 18 prompts + 5 acentos con Gemini como prompt writer
3. Corrección post-auditoría: bugs y deuda técnica identificados por auditoría + informe de testing

### Completado

#### Fase 1 — Cleanup (7 planes)
- Plan 1: Eliminados 9 archivos .md muertos no referenciados por código
- Plan 2: Extraído `criticizer-rewrite` de inline a .md
- Plan 3: Extraído `hitl-expire-message` de inline a .md
- Plan 4: Mergeado `criticizer-review.md` en `criticizer-base.md`
- Plan 5: Extraído `voice-tts-format` de hardcoded a .md
- Plan 6: Eliminados TODOS los fallback inline de 17 archivos TS (prompts ahora vienen de .md)
- Plan 7: Refactoreados acentos de Record hardcodeado a 5 archivos .md editables

#### Fase 2 — Optimización de contenido (18 prompts + 5 acentos)
Todos reescritos con Gemini como prompt writer, Claude coordinando:

**Editables (admin puede modificar):**
| Prompt | Antes | Después | Cambio clave |
|--------|-------|---------|--------------|
| identity.md | 2/5 | 5/5 | Arquetipo de vendedor consultivo con 10 rasgos cognitivos |
| relationship-lead.md | 2/5 | 5/5 | Empatía consultiva, regla de una-pregunta-por-mensaje |
| job.md | 3.5/5 | 5/5 | Jerarquía resolver > calificar > convertir, Bryan Tracy 6 pasos |
| criticizer.md | 2/5 | 5/5 | Auditor con 4 criterios + red flags, formato APPROVED/feedback |
| guardrails.md | 3.5/5 | 5/5 | Jerarquía de 5 fuentes, anti-alucinación, anti-contradicción |
| relationship-unknown.md | 2.5/5 | 4.5/5 | Apertura neutra, identificación orgánica por keywords |
| relationship-admin.md | 3/5 | 4.5/5 | Extensión operativa con scope de autoridad |
| relationship-coworker.md | 3/5 | 4.5/5 | Recurso operativo high-speed con restricciones claras |

**Sistema (no editables):**
| Prompt | Antes | Después | Cambio clave |
|--------|-------|---------|--------------|
| agentic-system.md | 3/5 | 5/5 | Framework de razonamiento + protocolos de tools + uso de adjuntos |
| security-preamble.md | 3/5 | 5/5 | 8 directivas inmutables (prompt integrity, injection resistance) |
| criticizer-base.md | 3/5 | 5/5 | Checklist rápido de auto-corrección (4 checks, sin overlap con criticizer.md) |
| cold-lead-scoring.md | 2/5 | 4.5/5 | Template estructurado con BANT + historial + JSON estricto |
| nightly-scoring-system.md | 1/5 | 5/5 | De 1 línea a analista completo con 4 criterios y rangos de score |
| knowledge-description.md | 1/5 | 4.5/5 | Catalogador RAG con utilidad semántica y keywords |
| scheduled-task-system.md | 2.5/5 | 4.5/5 | Modo background con protocolo y formato estructurado |
| voice-tts-format.md | 2.5/5 | 4.5/5 | Reglas de brevedad extrema + cero formato visual + ritmo |
| hitl-expire-message.md | 2.5/5 | 4.5/5 | Reescrito en español, tono empático sin promesas de timeline |
| pdf-ocr.md | 2.5/5 | 4.5/5 | 6 reglas de extracción: jerarquía, tablas, charts, imágenes |

**Acentos (optimizados para Gemini TTS 2.5 Pro):**
| Acento | Perfil |
|--------|--------|
| es-MX | Compás silábico 160-180 BPM, contorno circunflejo, tuteo |
| es-CO | 130-150 BPM, sobre-articulado, usted formal |
| es-EC | 120-140 BPM, influencia quichua, asibilación de rr |
| es-PE | 140-160 BPM, entonación plana/neutra, tuteo limeño |
| en-US | Stress-timed 150-170 BPM, rhotic, alveolar flapping |

#### Fase 3 — Fixes post-auditoría + testing

**Plan 9 (auditoría — PR #194):**
- FIX-1: Setup wizard sincronizado con 5 acentos soportados
- FIX-2: Guards con logger.warn para commitment-detector, verifier, nightly-batch
- FIX-3: Log warning en nightly-batch early return
- FIX-4: Criticizer.md — eliminado BLOQUEAR, ahora APPROVED/feedback
- FIX-5: Restaurada instrucción de idioma del contacto en agentic-system.md
- FIX-6: Imports estáticos en manifest.ts
- FIX-7: Desduplicación criticizer-base vs criticizer (criterios factuales solo en criticizer.md)

**Hallazgos del informe de testing (lab session 785956cb):**
- Agregada sección "Uso de Adjuntos Procesados" en agentic-system.md
- Agregada regla "Anti-contradicción de Evidencia" en guardrails.md

**Plan inspect_image (PR #193):**
- Nueva tool `inspect_image` para re-consulta visual de imágenes
- Intake modificado para incluir attachment_id en contenido inyectado
- Tool registrado en engine manifest

### No completado
- Auditoría BUG-2 (migración de acentos existentes en producción): decisión pendiente del equipo — crear .md para acentos legacy o mapear a los 5 nuevos
- DEUDA-3 (confusión naming `criticizer-review` task vs file): baja severidad, no se actuó
- Opiniones de sobre-ingeniería (SOBREENG-1/2/3): decisión del equipo — no se simplificaron los prompts de Fase 2

### Archivos creados/modificados

**Prompts creados (5):**
- `instance/prompts/accents/es-MX.md`, `es-CO.md`, `es-EC.md`, `es-PE.md`, `en-US.md`

**Prompts modificados (18):**
- `instance/prompts/defaults/`: identity, job, guardrails, criticizer, relationship-lead, relationship-unknown, relationship-admin, relationship-coworker
- `instance/prompts/system/`: agentic-system, security-preamble, criticizer-base, cold-lead-scoring, nightly-scoring-system, knowledge-description, scheduled-task-system, voice-tts-format, hitl-expire-message, pdf-ocr

**Prompts eliminados (9):**
- channel-format-email/whatsapp/voice/google-chat.md, criticizer-review.md, daily-report-narrative.md, evaluator-system.md, proactive-agentic-system.md, proactive-evaluator-system.md

**TS modificados (clave):**
- `src/engine/attachments/tools/inspect-image.ts` (nuevo)
- `src/engine/boundaries/intake.ts` (attachment_id en inyección)
- `src/engine/proactive/commitment-detector.ts`, `src/engine/subagent/verifier.ts`, `src/engine/proactive/jobs/nightly-batch.ts` (guards)
- `src/kernel/setup/handler.ts`, `src/kernel/setup/templates.ts` (acentos wizard)
- `src/modules/prompts/manifest.ts` (imports estáticos + accent refactor)
- 17 archivos TS con fallbacks inline eliminados (Plan 6)

### Interfaces expuestas
- `inspect_image` tool: re-consulta visual de imágenes via tools:registry
- `generateAccentPrompt()` en prompts manifest: lee .md de disco en vez de Record hardcodeado

### Dependencias instaladas
Ninguna.

### Tests
No hay test suite. Verificación via `tsc --noEmit` (1266 errores, 5 de inspect-image.ts por @types/node en entorno sandbox — no son errores en producción con Docker).

### Decisiones técnicas
1. **Gemini como prompt writer**: Claude coordina, Gemini reescribe — workflow manual por restricción de sandbox (sin acceso a APIs externas)
2. **Acentos reducidos de ~50 a 5**: Solo mercados con archivo .md verificado (MX, CO, EC, PE, US)
3. **Fallbacks eliminados, no reemplazados**: El vacío es aceptable para texto libre; guards con early return para JSON obligatorio
4. **criticizer-base vs criticizer separados**: Base = auto-corrección rápida (identidad, fluidez, coherencia, concisión). Criticizer = reviewer externo completo (factuales, seguridad, datos, formato APPROVED)
5. **inspect_image como tool separada de query_attachment**: Concerns distintos (visual vs textual)

### Riesgos o deuda técnica
1. **BUG-2 sin resolver**: Instancias en producción con acentos fuera de los 5 nuevos perderán su acento silenciosamente al hacer deploy
2. **5 errores TS en inspect-image.ts**: Mismo patrón que el resto del repo (@types/node), no bloquean en Docker
3. **Prompts "sobre-ingenierizados"**: La auditoría los señaló como verbose — el equipo puede decidir simplificarlos post-deploy
4. **Bug naming image-description**: Código busca `image-description`, archivo no existe. Fallback hardcodeado funciona, pero si alguien crea el .md incompleto, rompe parseDualDescription()

### Notas para integración
- Merge a `pruebas` para testing en staging
- Verificar en staging que el caso "piel bonita" ya no se reproduzca (instrucción de adjuntos + anti-contradicción)
- Verificar que el setup wizard solo muestre los 5 acentos
- Verificar que `inspect_image` aparezca en el catálogo de tools del agente
