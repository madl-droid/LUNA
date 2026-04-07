# Plan: Audit 2 Fixes — Contact Memory Enhancement

## Hallazgos del segundo audit sobre el commit 9e7ef42

### Batch 1: Bugs (implementar primero)

#### Fix 1A: `normalizeIdentifier` no valida E.164 — BUG-1 (MEDIA)
**Archivo:** `src/tools/contacts/save-contact-data.ts`

Problema: mantiene `+` en cualquier posición. `+57+315...` pasaría como válido.

```typescript
// ANTES:
function normalizeIdentifier(channel: string, value: string): string {
  if (channel === 'email') return value.toLowerCase().trim()
  return value.replace(/[^\d+]/g, '') // mantiene + en cualquier posición
}

// DESPUÉS:
function normalizeIdentifier(channel: string, value: string): string {
  if (channel === 'email') return value.toLowerCase().trim()
  // Strip everything except digits, then add single + prefix
  const digits = value.replace(/\D/g, '')
  if (!digits) return value.trim()
  return `+${digits}`
}
```

Resultado: `+57+315...` → `+57315...`. Siempre E.164 con un solo `+` al inicio.

#### Fix 1B: `handleContactPoint` no guarda dato cuando hay merge candidate — BUG-2 (MEDIA)
**Archivo:** `src/tools/contacts/save-contact-data.ts`

Problema: si detecta merge candidate, retorna `success: false` sin guardar el canal.
El agente puede no re-invocar post-merge, perdiendo el dato.

Fix: guardar el canal SIEMPRE, y adicionalmente avisar del merge candidate.

```typescript
// ANTES: 
if (mergeCandidates.length > 0) {
  return { success: false, message: 'Posible contacto duplicado...', mergeCandidates }
}
// ... INSERT canal ...

// DESPUÉS:
// Guardar canal primero (siempre)
await db.query(
  `INSERT INTO contact_channels (...) VALUES (...) ON CONFLICT DO NOTHING`,
  [contactId, channel, normalized]
)

// Luego avisar de merge candidates (si hay)
if (mergeCandidates.length > 0) {
  return {
    success: true,  // ← dato SÍ guardado
    message: `Canal guardado. ATENCIÓN: este ${channel} ya existe en otro contacto...`,
    mergeCandidates
  }
}
```

#### Fix 1C: `backfillContactInfo` no distingue '' de NULL — BUG-3 (BAJA)
**Archivo:** `src/modules/memory/contact-merge.ts`

```typescript
// ANTES:
UPDATE contacts SET
  display_name = COALESCE(display_name, $2),
  email = COALESCE(email, $3),
  phone = COALESCE(phone, $4)

// DESPUÉS:
UPDATE contacts SET
  display_name = CASE WHEN display_name IS NULL OR display_name = '' THEN $2 ELSE display_name END,
  email = CASE WHEN email IS NULL OR email = '' THEN $3 ELSE email END,
  phone = CASE WHEN phone IS NULL OR phone = '' THEN $4 ELSE phone END
```

### Batch 2: Violaciones arquitecturales

#### Fix 2A: Mover tools/contacts dentro del módulo memory — ARCH-1
**Problema:** `src/tools/contacts/` importa directamente de `src/modules/memory/contact-merge.ts`.
La regla de LUNA es: módulos se comunican via hooks y services, nunca imports directos.

**Opción A (preferida):** Mover `src/tools/contacts/` → `src/modules/memory/tools/`
- `save-contact-data.ts` y `merge-contacts.ts` viven dentro del módulo memory
- El registro de tools en `manifest.ts` de memory ya existe
- Eliminar `src/tools/contacts/` como directorio separado

**Opción B:** Exponer merge como service del registry
- `memory` expone `memory:contact-merge` service
- tools usan `registry.get('memory:contact-merge')` en vez de import directo
- Más desacoplado pero más indirección para algo que es inherentemente de memory

Recomiendo **Opción A** — es más simple y estos tools son 100% del dominio de memory.

#### Fix 2B: Remover `depends: ['tools']` de memory — ARCH-2
**Archivo:** `src/modules/memory/manifest.ts`

Problema: core-module (`memory`) depende de feature-module (`tools`). Invierte la jerarquía.

Fix: El `manifest.ts` ya usa `registry.getOptional('tools:registry')`, lo que significa que
funciona sin el módulo tools. Simplemente eliminar `'tools'` del array `depends`.

### Batch 3: Deudas técnicas

#### Fix 3A: Guard de contactId en merge_contacts — DEBT-4
**Archivo:** `src/tools/contacts/merge-contacts.ts` (o su nueva ubicación post-2A)

```typescript
// Agregar validación:
if (!ctx.contactId) {
  return { success: false, error: 'No hay contacto activo en esta conversación' }
}

// Validar que al menos uno de los IDs sea el contacto actual
const { keep_contact_id, merge_contact_id } = args
if (keep_contact_id !== ctx.contactId && merge_contact_id !== ctx.contactId) {
  return { success: false, error: 'Al menos uno de los contactos debe ser el contacto actual de la conversación' }
}
```

Esto previene que el agente mergee contactos arbitrarios por hallucination.

#### Fix 3B: Nightly batch consulta tabla correcta — DEBT-5
**Archivo:** `src/engine/proactive/jobs/nightly-batch.ts`

Problema: consulta `session_summaries` pero compression v2 escribe a `session_summaries_v2`.

```typescript
// ANTES:
const { rows } = await db.query(
  `SELECT ... FROM session_summaries WHERE ...`
)

// DESPUÉS:
const { rows } = await db.query(
  `SELECT ... FROM session_summaries_v2 WHERE ...`
)
```

Verificar también que los campos consultados existan en v2 (structure puede diferir).

#### Fix 3C: Crear skill contact-data-management — Track C2 no implementado
**Archivo:** `instance/prompts/system/skills/contact-data-management.md`

El audit dice que no se creó la instrucción para el agente. Verificar si el archivo existe
(el informe de implementación dice que sí se creó). Si existe, verificar que esté registrado
en el prompts module para que se inyecte al agente.

Si no está registrado: agregar referencia en el módulo prompts para que lo cargue como skill.

### Orden de ejecución

```
Batch 1 (bugs)           → implementar primero, son correctness issues
Batch 2 (arquitectura)   → segundo, refactor antes de más cambios
Batch 3 (deuda técnica)  → tercero, cleanup final
```

Batches 1 y 3 pueden correr en paralelo. Batch 2 debería ir antes de 3
porque mueve archivos que 3 modifica.
