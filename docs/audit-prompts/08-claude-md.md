# Auditoría: CLAUDE.md Files

Eres un auditor de documentación técnica senior. Tu tarea es auditar TODOS los archivos CLAUDE.md del proyecto LUNA, verificando precisión, completitud, consistencia y utilidad como guía para agentes IA. NO hagas cambios, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Son 29 archivos CLAUDE.md + 6 docs de arquitectura. Para evitar colapsar el contexto:
- Lee cada CLAUDE.md completo (la mayoría son cortos, <80 líneas)
- Para verificar precisión, NO leas archivos de código completos — usa glob/search para confirmar existencia de archivos, hooks, services mencionados
- Trabaja en fases: primero lee el CLAUDE.md, luego verifica contra el código real
- El CLAUDE.md raíz es el más largo — léelo en bloques de 200 líneas
- Los docs de arquitectura son largos — lee solo secciones relevantes para comparar

### Fase 1: CLAUDE.md raíz (el más importante)
- Lee: CLAUDE.md (raíz del proyecto) — en bloques si es largo
- Verifica: ¿la estructura de directorios documentada coincide con la real? (usa ls/glob)
- Verifica: ¿los módulos listados en "Módulos documentados" coinciden con src/modules/?
- Verifica: ¿las reglas ("Lo que NO hacer") se cumplen buscando en el código?

### Fase 2: Kernel CLAUDE.md files
- Lee: src/kernel/CLAUDE.md
- Verifica contra archivos reales en src/kernel/
- Lee: src/kernel/setup/CLAUDE.md
- Verifica contra archivos reales en src/kernel/setup/

### Fase 3: Módulos CLAUDE.md (reglas generales)
- Lee: src/modules/CLAUDE.md
- Este define reglas para crear módulos — verificar que los módulos las siguen

### Fase 4: CLAUDE.md de cada módulo (uno por uno)
Para cada uno: lee el CLAUDE.md, luego verifica archivos mencionados existen, hooks/services existen, config vars existen en manifest:
- src/modules/console/CLAUDE.md
- src/modules/console/ui/CLAUDE.md
- src/modules/engine/CLAUDE.md
- src/modules/freight/CLAUDE.md
- src/modules/freshdesk/CLAUDE.md
- src/modules/gmail/CLAUDE.md
- src/modules/google-apps/CLAUDE.md
- src/modules/google-chat/CLAUDE.md
- src/modules/knowledge/CLAUDE.md
- src/modules/lead-scoring/CLAUDE.md
- src/modules/llm/CLAUDE.md
- src/modules/medilink/CLAUDE.md
- src/modules/memory/CLAUDE.md
- src/modules/model-scanner/CLAUDE.md
- src/modules/prompts/CLAUDE.md
- src/modules/scheduled-tasks/CLAUDE.md
- src/modules/tools/CLAUDE.md
- src/modules/tts/CLAUDE.md
- src/modules/twilio-voice/CLAUDE.md
- src/modules/users/CLAUDE.md
- src/modules/whatsapp/CLAUDE.md

### Fase 5: Tools y Engine CLAUDE.md
- src/tools/freight/CLAUDE.md
- src/tools/freshdesk/CLAUDE.md
- src/engine/CLAUDE.md

### Fase 6: Deploy CLAUDE.md
- deploy/CLAUDE.md

### Fase 7: Docs de arquitectura (comparar consistencia)
- Lee secciones clave de: docs/architecture/module-system.md
- Lee secciones clave de: docs/architecture/channel-guide.md
- Lee secciones clave de: docs/architecture/pipeline.md
- Compara con lo que dicen los CLAUDE.md correspondientes

## Qué auditar para CADA CLAUDE.md:

### 1. Precisión vs código real
- Para cada archivo mencionado en "Archivos": ¿existe realmente? ¿El nombre es correcto?
- Para cada hook/service documentado: ¿existe en el código? ¿La firma es correcta?
- Para cada dependencia listada: ¿está en el manifest?
- Para cada config var documentada: ¿existe en el configSchema?
- Para cada API route documentada: ¿existe?
- Busca archivos que EXISTEN en el directorio pero NO están documentados en el CLAUDE.md

### 2. Completitud
- ¿Cubre todos los archivos del módulo?
- ¿Documenta todos los hooks emitidos y consumidos?
- ¿Documenta todos los services expuestos?
- ¿Documenta las trampas/gotchas importantes?
- ¿Tiene sección de patrones?
- ¿Sigue el template recomendado en CLAUDE.md raíz?

### 3. Consistencia entre archivos
- ¿El CLAUDE.md raíz lista todos los módulos que existen?
- ¿Los módulos documentados coinciden con los que tienen CLAUDE.md?
- ¿Las reglas de la raíz se reflejan en módulos?
- ¿Hay contradicciones entre lo que dice la raíz y un módulo?
- ¿Los docs de arquitectura son consistentes con los CLAUDE.md?

### 4. Información obsoleta
- ¿Hay referencias a archivos/módulos que ya no existen?
- ¿Hay features documentadas que no están implementadas?
- ¿Hay patrones obsoletos?

### 5. Calidad como guía para IA
- ¿Un agente IA que lea solo el CLAUDE.md puede trabajar correctamente en el módulo?
- ¿Hay ambigüedades que llevarían a decisiones incorrectas?
- ¿Las reglas son claras y no contradictorias?
- ¿Falta contexto crítico?

## Formato del informe

Genera el archivo: docs/reports/audit/08-claude-md.md

```markdown
# Auditoría: CLAUDE.md Files
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
- Total CLAUDE.md auditados: 29
- Precisión promedio: X%
- Completitud promedio: X%
- Consistencia: [alta/media/baja]

## Estado por archivo

### CLAUDE.md (raíz)
- Líneas: N
- Precisión: X% (archivos/módulos mencionados que existen / total mencionados)
- Completitud: X% (módulos reales documentados / total módulos reales)
- Issues:
  | # | Tipo | Descripción | Línea aprox |
  |---|------|-------------|-------------|
  | 1 | OBSOLETO | ... | ... |
  | 2 | FALTANTE | ... | ... |
  | 3 | INCORRECTO | ... | ... |
  | 4 | AMBIGUO | ... | ... |

### src/kernel/CLAUDE.md
(mismo formato)

### src/kernel/setup/CLAUDE.md
(mismo formato)

### src/modules/CLAUDE.md
(mismo formato)

### src/modules/console/CLAUDE.md
(mismo formato)

(... CADA CLAUDE.md con su evaluación individual ...)

## Módulos/directorios sin CLAUDE.md que deberían tenerlo
| Directorio | Razón por la que necesita CLAUDE.md |
|------------|-------------------------------------|

## Contradicciones encontradas
| # | Archivo 1 | Dice... | Archivo 2 | Dice... | Cuál es correcto |
|---|-----------|---------|-----------|---------|------------------|

## Información obsoleta
| # | Archivo | Línea | Qué dice | Realidad en código |
|---|---------|-------|----------|--------------------|

## Archivos reales no documentados
| # | Directorio | Archivo existente | CLAUDE.md no lo menciona |
|---|------------|-------------------|--------------------------|

## Gaps críticos (info que un agente IA necesitaría y no está)
| # | Módulo | Qué falta | Impacto para agente IA |
|---|--------|-----------|------------------------|

## Reglas del CLAUDE.md raíz — cumplimiento real
| Regla | Se cumple | Evidencia |
|-------|-----------|-----------|
| No ORM | ✅/❌ | ... |
| No Express/Fastify | ✅/❌ | ... |
| ESM imports con .js | ✅/❌ | ... |
| No process.env fuera de kernel | ✅/❌ | ... |
| (cada regla) | ... | ... |

## Score de documentación: X/5
(justificación)

## Top 15 correcciones prioritarias
1. ...
```

IMPORTANTE: Para CADA CLAUDE.md, verifica contra el código real. No confíes en lo que dice el documento — usa glob y grep para confirmar. Esta auditoría es sobre la CALIDAD DE LA DOCUMENTACIÓN, no del código.
