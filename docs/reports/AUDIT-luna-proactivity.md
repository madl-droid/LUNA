# AUDITORÍA — Branch `claude/plan-luna-proactivity-FxrZb`
## Fecha: 2026-04-08

**Alcance:** 4 planes ejecutados (bugfixes, commitments overhaul, follow-up intensity, scheduled-tasks presets + knowledge config). 42 archivos modificados, ~1900 líneas netas de cambio.

**Veredicto general:** El trabajo es sólido en concepto y dirección. Los 4 planes atacan problemas reales y las decisiones de diseño son correctas (eliminar auto-detect, intensity per-contact, presets en vez de cron libre). Sin embargo, la ejecución tiene bugs concretos, redundancias, y algunos huecos que necesitan corregirse antes de merge.

---

## BUGS (requieren fix antes de merge)

### BUG-1: Migraciones duplicadas 048_ (CRÍTICO)
**Archivos:** `src/migrations/048_commitment-context-summary.sql` y `src/migrations/048_follow-up-intensity.sql`

Dos archivos con el mismo prefijo `048_`. El migrador los ejecuta en orden alfabético, pero:
- `048_commitment-context-summary.sql` ya incluye el `ALTER TABLE agent_contacts ADD COLUMN IF NOT EXISTS follow_up_intensity` (línea 7)
- `048_follow-up-intensity.sql` hace exactamente lo mismo

**Problema:** Duplicación inofensiva gracias a `IF NOT EXISTS`, pero tener dos migraciones con el mismo número es una violación del contrato del migrador. Si otro desarrollador crea una migración `048_algo.sql` en otro branch, habrá conflicto de merge silencioso.

**Fix:** Eliminar `048_follow-up-intensity.sql` completamente (su contenido ya está en el otro archivo). O renumerar a `049_`.

---

### BUG-2: Cortex `context-builder.ts` lee columna que no pide en SQL (BUG FUNCIONAL)
**Archivo:** `src/modules/cortex/trace/context-builder.ts:180`

El código lee `row.follow_up_intensity` pero la query SQL (línea 157) NO incluye `ac.follow_up_intensity` en el SELECT:
```sql
SELECT c.id, cc.channel_identifier, cc.channel_type, c.display_name, c.contact_type,
       ac.qualification_status, ac.qualification_score, ac.qualification_data,
       ac.contact_memory, ac.lead_status
FROM contacts c ...
```

**Resultado:** `followUpIntensity` siempre será `undefined` (que luego ?? a `null`). No crashea, pero es datos fantasma — el campo existe en el tipo pero nunca tiene valor real en el contexto de Cortex/Trace.

**Fix:** Agregar `ac.follow_up_intensity` al SELECT de la query SQL.

---

### BUG-3: `ensureInstanceFiles()` — source y target son el mismo path (BUG LÓGICO)
**Archivo:** `src/kernel/bootstrap.ts:25-26`

```typescript
const REQUIRED_FILES = [
  { target: 'instance/proactive.json', source: 'instance/proactive.json' },
]
```

La función existe para manejar el caso donde un Docker volume mount sobreescribe `instance/`. Pero si el volume mount borró `instance/proactive.json`, el source **también** fue borrado (es el mismo path). El `fs.access(sourcePath)` falla y se loguea un warn, pero el archivo nunca se restaura.

**Fix:** El source debe apuntar a un template fuera de `instance/`, ej: `defaults/proactive.json` o embeber el JSON default inline. O más simple: que `loadProactiveConfig()` ya tiene defaults hardcoded — evaluar si `ensureInstanceFiles` es necesario del todo.

---

### BUG-4: `notifyAssignedHuman` marca como `failed` incluso si la notificación falló
**Archivo:** `src/engine/proactive/jobs/commitment-check.ts:199-206`

El flujo es:
1. Intentar enviar mensaje al humano
2. Si falla → `catch` loguea warn, no hace return
3. Código continúa al check `if (attemptCount + 1 >= maxAttempts)` → marca `failed`

**Resultado:** Si `message:send` falla (canal caído, humano no existe), el attempt_count NO se incrementa (la query está dentro del try), pero el check de max uses el valor pre-computado `attemptCount + 1`. En la siguiente ejecución del scanner, el attempt_count sigue igual y se vuelve a intentar, lo cual es correcto. **PERO**: si `attemptCount + 1 >= maxAttempts` al momento del fallo, se marca `failed` sin haber logrado notificar nunca.

**Fix:** Mover el check de max_attempts dentro del bloque `try`, después del UPDATE exitoso.

---

### BUG-5: `processed` counter no cuenta commitments humanos
**Archivo:** `src/engine/proactive/jobs/commitment-check.ts:50-54`

Los commitments asignados a humanos se procesan via `notifyAssignedHuman()` y luego `continue`, sin incrementar `processed`. El log final reporta un count incorrecto.

**Fix:** Incrementar `processed` después de `notifyAssignedHuman()`.

---

### BUG-6: CLAUDE.md del engine tiene línea duplicada
**Archivo:** `src/engine/CLAUDE.md:76-77`

```
commitment-validator.ts — valida y clasifica requests de creación de compromisos
commitment-validator.ts — valida y clasifica requests de creación de compromisos
```

Parece que se reemplazó `commitment-detector.ts` por `commitment-validator.ts` pero el reemplazo se hizo mal y quedó la línea original + la nueva.

**Fix:** Eliminar la línea duplicada.

---

## HUECOS (funcionalidad incompleta)

### HUECO-1: No hay tool `update_commitment` con soporte para humanos cerrando compromisos
**Plan 2, Changes 6-7** promete: "allow humans to close commitments" y "show pending commitments in reactive conversations". El diff no muestra cambios al tool `update_commitment` para distinguir si el caller es un humano. El prompt system dice "responde completado → usa update_commitment", pero ¿cómo sabe el pipeline que el humano respondió "completado"?

El `proactive-agentic-system.md` instruye al LLM a usar `update_commitment`, pero la detección de que un mensaje viene de un humano asignado (vs. un contacto regular) no está implementada en el commitment-check flow.

**Impacto:** Medio. El LLM podría interpretar "completado" correctamente en una conversación proactiva, pero no hay mecanismo programático.

---

### HUECO-2: Knowledge `KNOWLEDGE_CONTACT_CATEGORY_MAP` — solo UI, sin configSchema completo
**Archivo:** `src/modules/knowledge/manifest.ts`

El campo se agrega a `console.fields` y al `configSchema` como `z.string().default('')`, pero la lógica de uso (líneas 1402-1464) hace `JSON.parse` directo. Si alguien pone JSON inválido en la consola, ¿qué pasa?

El plan dice "Fail-open: si vacío o JSON inválido, no filtra" — revisando el código, sí hay un try/catch. **Verificado: correcto**, pero habría sido más limpio validar en el schema con un `z.string().refine()` o al menos comentar el comportamiento fail-open.

**Impacto:** Bajo. Funciona pero es frágil.

---

## DEUDA TÉCNICA

### DEUDA-1: Follow-up query sin paginación real
**Archivo:** `src/engine/proactive/jobs/follow-up.ts:38`

La query ahora usa `LIMIT 40` (subió de 20) porque el filtro por intensidad se hace en código. Pero si hay 500 leads activos, solo se procesan 40. No hay offset ni re-ejecución.

**Riesgo:** Con muchos leads, los que están más abajo en el `ORDER BY updated_at ASC` nunca reciben follow-up hasta que los primeros 40 se procesen o transicionen.

**Sugerencia:** O subir el LIMIT significativamente (la query es ligera), o iterar con cursor. Para una instancia típica de LUNA (< 200 leads activos), 40 probablemente es suficiente, pero es una bomba de tiempo.

---

### DEUDA-2: `resolveIntensity()` se llama dos veces por candidato en follow-up
**Archivo:** `src/engine/proactive/jobs/follow-up.ts:51-65`

Se llama una vez en el `.filter()` y otra vez dentro del `for` loop. La función es pura y barata, pero es redundancia innecesaria.

**Fix simple:** Guardar el resultado del filter en un Map o reestructurar para no filtrar+re-calcular.

---

### DEUDA-3: Cron presets no cubren horario personalizado
El plan 4 elimina cron libre y pone 13 presets. Si una instancia necesita "cada martes y jueves a las 3 PM", no puede. El plan reconoce esto como trade-off válido, pero no hay escape hatch (ni API param para pasar cron raw).

**Riesgo:** Bajo a corto plazo. Medio a largo plazo si clientes piden horarios personalizados.

---

### DEUDA-4: Context summary captura mensajes raw, no resumen
**Archivo:** `src/engine/proactive/tools/create-commitment.ts:126-141`

El "context_summary" son los últimos 6 mensajes truncados a 200 chars cada uno, concatenados. No es un resumen — es una transcripción parcial. Para compromisos creados en conversaciones largas, los 6 últimos mensajes pueden no contener el contexto relevante.

**Evaluación:** Funciona para el 80% de los casos (compromisos se crean cerca del contexto relevante). Un resumen LLM sería más costoso y lento. La decisión es pragmática y correcta dado el constraint de no agregar otra llamada LLM.

---

## COMPLEJIDAD INNECESARIA

### COMPLEJ-1: `set-intensity.ts` — inline type para ToolRegistry
**Archivo:** `src/engine/proactive/tools/set-intensity.ts:8-29`

Se redefine un tipo `ToolRegistry` inline con 22 líneas de interfaz. Los otros tools del engine (`create-commitment.ts`, `update-commitment.ts`) probablemente hacen lo mismo. Debería haber un tipo compartido importado del módulo tools o del kernel.

**No bloquea**, pero suma ruido en cada nuevo tool.

---

### COMPLEJ-2: `cronToPresetValue` reverse lookup en templates.ts
Hay una función `cronToPresetValue()` que busca el preset dado un cron expression, y un objeto `CRON_TO_PRESET` inyectado al JS del frontend que hace lo mismo. Dos reverse lookups para lo mismo.

**Evaluación:** El de backend es para SSR (render del badge), el del frontend es para popular el select al editar. Son contextos diferentes. Aceptable.

---

## REDUNDANCIAS Y DUPLICACIONES

### REDUND-1: Migración duplicada (ya reportado como BUG-1)
`048_follow-up-intensity.sql` es 100% redundante con las líneas 6-7 de `048_commitment-context-summary.sql`.

---

### REDUND-2: CLAUDE.md línea duplicada (ya reportado como BUG-6)

---

## VIOLACIONES DE POLÍTICAS

### VIOLACIÓN-1: Ninguna severa detectada

El código:
- ✅ No lee `process.env` directamente
- ✅ Usa `jsonResponse`, `parseBody` del kernel
- ✅ No importa entre módulos directamente (usa hooks y services)
- ✅ SQL parametrizado (no injection)
- ✅ Usa `.js` en imports ESM
- ✅ No usa ORM
- ✅ Los nuevos archivos siguen naming kebab-case

### VIOLACIÓN-MENOR-1: `set-intensity.ts` accede `ctx.db` directamente
El tool `set_follow_up_intensity` ejecuta SQL directo contra `agent_contacts` en vez de usar un service de memory. Los otros tools proactivos (`create-commitment`, `update-commitment`) sí usan `memMgr` del módulo memory. Inconsistencia menor en el patrón de acceso a datos.

---

## EVALUACIÓN POR PLAN

| Plan | Calificación | Notas |
|------|-------------|-------|
| **Plan 1: Bugfixes** | 8/10 | Bugs del cron `31 2` y filtro de non-cron tasks están bien resueltos. El `ensureInstanceFiles` tiene bug lógico (BUG-3). El cambio de `:` a `-` en jobIds con backward compat es correcto. |
| **Plan 2: Commitments** | 7/10 | Eliminación del auto-detector es la decisión correcta (ahorra 1 LLM call por respuesta). Context summary es pragmático. HITL handoff funciona. Pero hay huecos en el flujo de humanos cerrando commitments, y BUG-4 en la lógica de max_attempts. |
| **Plan 3: Intensity** | 8/10 | Diseño limpio: 4 niveles, fallback a global, tool para ajustar. La query sin paginación es deuda menor. BUG-2 en cortex es cosmético. Doble llamada a `resolveIntensity` es inelegante pero no problemático. |
| **Plan 4: Presets + Knowledge** | 9/10 | Los cron presets son la solución correcta para el problema de cron inválido. UI limpia con optgroups. Backward compat con legacy cron expressions. Knowledge config field es mínimo y funcional. |

---

## RESUMEN EJECUTIVO

**Lo bueno:**
- Eliminar el auto-detector de commitments es la decisión más valiosa: ahorra ~$0.01-0.03 USD por mensaje en LLM calls y elimina falsos positivos
- Follow-up intensity per-contact es el feature correcto para personalización sin over-engineering
- Cron presets eliminan una clase entera de bugs (cron inválido) sin perder funcionalidad práctica
- El código es legible y sigue las convenciones del proyecto

**Lo malo:**
- 6 bugs concretos, 2 de ellos funcionales (BUG-2, BUG-4)
- Migración duplicada es descuido
- `ensureInstanceFiles` tiene un bug lógico fundamental que hace que la función no sirva para su propósito declarado

**Lo feo:**
- Nada verdaderamente feo. El código no tiene abstracciones innecesarias ni over-engineering. Es pragmático.

**Recomendación:** Fix de BUG-1 a BUG-6 antes de merge. Los huecos y deuda son aceptables para primera iteración.
