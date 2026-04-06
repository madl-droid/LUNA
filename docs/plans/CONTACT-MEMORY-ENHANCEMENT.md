# Plan: Contact Memory Enhancement — Canales, Merge, Preferencias

## Contexto

Actualmente:
- `contact_memory` NO incluye puntos de contacto (teléfono, email, WhatsApp)
- El agente NO puede guardar preferencias ni datos importantes durante la conversación
- NO hay merge de contactos duplicados (email-only + whatsapp-only = 2 contactos separados)
- `mergeToContactMemory()` existe en memory-manager pero NUNCA se llama
- El nightly batch NO extrae key_facts de las sesiones comprimidas

## 3 Tracks

```
Track A: Puntos de contacto en memoria + contexto
Track B: Contact merge cross-channel
Track C: Agent tools para guardar preferencias y datos
```

---

## Track A: Puntos de contacto visibles al agente

### Objetivo
El agente debe saber por qué canales puede contactar a la persona, y esa info
debe persistir en la memoria del contacto.

### A1. Inyectar canales en el contexto del agente

**Archivos:** `src/engine/prompts/context-builder.ts`, `src/modules/twilio-voice/voice-engine.ts`

En `context-builder.ts` (sección de contact memory, ~línea 119), agregar query:
```sql
SELECT channel_type, channel_identifier, is_primary, last_used_at
FROM contact_channels
WHERE contact_id = $1
ORDER BY last_used_at DESC
```

Inyectar en el prompt:
```
## Puntos de contacto
- WhatsApp: +573155524620 (principal, último uso: hace 2 días)
- Voz: +573155524620 (este canal)
- Email: juan@empresa.com (último uso: hace 1 semana)
```

Para voice-engine.ts: similar, en `buildSystemInstruction()` cargar canales
del contacto y agregarlos al system instruction.

### A2. Guardar canales como key_facts en contact_memory

Cuando se crea o descubre un canal nuevo para un contacto, agregar un key_fact:
```typescript
{
  fact: "Contacto disponible por WhatsApp: +573155524620",
  source: "system:channel_discovery",
  confidence: 1.0
}
```

**Dónde:** En `intake.ts:autoCreateContact()` y `ensureVoiceChannel()`, después del INSERT
en contact_channels, llamar `memory:manager.updateContactMemory()` para agregar el fact.

Esto garantiza que incluso si contact_channels no se consulta, la info queda
en la memoria del agente para siempre.

---

## Track B: Contact Merge Cross-Channel

### Objetivo
Si el agente descubre que dos contactos separados son la misma persona
(ej: contacto A solo tiene WhatsApp, contacto B solo tiene email, pero
desde WhatsApp dicen "mándame un email a X" y X ya existe), fusionarlos.

### B1. Tool `merge_contacts` para el agente

**Archivo:** Nuevo tool en `src/tools/contacts/` o en `src/modules/tools/`

```typescript
{
  name: 'merge_contacts',
  description: 'Fusiona dos contactos que son la misma persona. Mantiene el contacto principal y absorbe los canales, memoria y sesiones del otro.',
  parameters: {
    keep_contact_id: { type: 'string', description: 'ID del contacto a mantener' },
    merge_contact_id: { type: 'string', description: 'ID del contacto a absorber' },
    reason: { type: 'string', description: 'Razón del merge (ej: "usuario confirmó que es la misma persona")' }
  }
}
```

**Lógica del merge** (nueva función en `src/modules/memory/contact-merge.ts`):
```
1. Mover contact_channels:
   UPDATE contact_channels SET contact_id = $keep WHERE contact_id = $merge
   (ON CONFLICT: si ya existe ese canal para keep, eliminar el duplicado)

2. Mover sessions:
   UPDATE sessions SET contact_id = $keep WHERE contact_id = $merge

3. Mover messages:
   UPDATE messages SET contact_id = $keep WHERE contact_id = $merge

4. Merge contact_memory:
   - Cargar memory de ambos
   - Concatenar key_facts (dedup por fact text)
   - Merge preferences (keep wins en conflictos)
   - Concatenar important_dates (dedup)
   - Combinar summaries
   - Guardar en agent_contacts del keep

5. Merge qualification data:
   - Si uno está más avanzado (scored > unscored), mantener ese
   - Combinar qualification_data JSONB

6. Update contact info:
   - Si keep no tiene display_name pero merge sí, copiar
   - Si keep no tiene email/phone pero merge sí, copiar

7. Soft-delete contacto merge:
   UPDATE contacts SET merged_into = $keep, status = 'merged' WHERE id = $merge

8. Log del merge:
   INSERT INTO contact_merge_log (keep_id, merge_id, reason, merged_at, merged_by)
```

### B2. Auto-detección de merge candidates

**Archivo:** `src/engine/boundaries/intake.ts` o nuevo `src/modules/memory/contact-dedup.ts`

Cuando el agente descubre un nuevo dato de contacto (email, teléfono) via tool
`save_contact_data` (Track C), verificar:
```sql
SELECT c.id, c.display_name
FROM contacts c
JOIN contact_channels cc ON cc.contact_id = c.id
WHERE cc.channel_identifier = $new_identifier
  AND c.id != $current_contact_id
LIMIT 1
```

Si existe match → el agente recibe:
```
[Sistema: El email/teléfono que proporcionó el usuario ya pertenece a otro
contacto: "{nombre}" (ID: {id}). ¿Es la misma persona? Si sí, usa la
herramienta merge_contacts para unificarlos.]
```

El agente decide si confirmar con el usuario o mergear directamente según
el contexto.

### B3. Migración SQL

```sql
-- contact_merge_log para auditoría
CREATE TABLE IF NOT EXISTS contact_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keep_contact_id UUID NOT NULL,
  merge_contact_id UUID NOT NULL,
  reason TEXT,
  merged_by TEXT DEFAULT 'agent',  -- 'agent', 'system', 'admin'
  merged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Soft-delete field para contactos mergeados
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_into UUID;
```

---

## Track C: Agent Tools para Preferencias y Datos

### Objetivo
El agente debe poder guardar activamente datos del contacto durante la
conversación: preferencias, datos de contacto descubiertos, fechas importantes.

### C1. Tool `save_contact_data`

**Archivo:** Nuevo tool registrado en `src/modules/tools/`

```typescript
{
  name: 'save_contact_data',
  description: 'Guarda información del contacto descubierta durante la conversación: datos de contacto (email, teléfono), preferencias, fechas importantes, o datos clave.',
  parameters: {
    type: {
      type: 'string',
      enum: ['contact_point', 'preference', 'important_date', 'key_fact'],
      description: 'Tipo de dato a guardar'
    },
    // Para contact_point:
    channel?: { type: 'string', enum: ['email', 'whatsapp', 'phone', 'other'] },
    value?: { type: 'string', description: 'Email, teléfono, u otro identificador' },
    // Para preference:
    preference_key?: { type: 'string', description: 'Nombre de la preferencia (ej: "horario_contacto", "idioma", "canal_preferido")' },
    preference_value?: { type: 'string', description: 'Valor de la preferencia' },
    // Para important_date:
    date?: { type: 'string', description: 'Fecha en formato ISO 8601' },
    date_description?: { type: 'string', description: 'Qué fecha es (ej: "Cumpleaños", "Aniversario de empresa")' },
    // Para key_fact:
    fact?: { type: 'string', description: 'Dato clave sobre el contacto' },
  }
}
```

**Lógica por tipo:**

**`contact_point`**: 
1. Normalizar identifier (E.164 para phones, lowercase para email)
2. Verificar si ya existe en contact_channels para este contacto
3. Si no existe: INSERT en contact_channels + agregar key_fact
4. Si existe para OTRO contacto → retornar aviso de posible merge
5. Actualizar contacts.email/phone si aplica

**`preference`**:
1. Cargar contact_memory actual
2. Agregar/actualizar en `preferences[key] = value`
3. Guardar via `updateContactMemory()`

**`important_date`**:
1. Cargar contact_memory
2. Agregar a `important_dates[]` (dedup por date+what)
3. Guardar

**`key_fact`**:
1. Cargar contact_memory
2. Agregar a `key_facts[]` con source `"agent:conversation"`, confidence 0.9
3. Si el fact contradice uno existente, usar `supersedes`
4. Guardar

### C2. Instrucción en system prompt

Agregar al prompt del agente (via prompts module o skills):
```markdown
## Gestión de contacto
Cuando el usuario te comparta datos personales o preferencias importantes,
usa la herramienta `save_contact_data` para guardarlos. Ejemplos:
- "Mi email es juan@empresa.com" → save_contact_data(type: contact_point, channel: email, value: "juan@empresa.com")
- "Prefiero que me contacten por WhatsApp" → save_contact_data(type: preference, key: "canal_preferido", value: "whatsapp")
- "Mi cumpleaños es el 15 de mayo" → save_contact_data(type: important_date, date: "2026-05-15", description: "Cumpleaños")
- "Soy gerente de compras" → save_contact_data(type: key_fact, fact: "Gerente de compras")
```

### C3. Activar el merge workflow de contact_memory en nightly batch

**Archivo:** `src/engine/proactive/jobs/nightly-batch.ts`

Agregar nueva tarea al nightly batch:
```
Para cada contacto con sesiones comprimidas no mergeadas:
1. Cargar session_summaries_v2 recientes
2. LLM call: extraer key_facts, preferences, important_dates del summary
3. Merge con contact_memory existente (dedup, supersede)
4. Guardar via mergeToContactMemory() (que ya existe pero nunca se llama)
5. Marcar summaries como merged
```

Esto complementa el Track C: el agente guarda datos explícitos durante la
conversación, y el nightly batch extrae datos implícitos de las sesiones.

---

## Dependencias entre Tracks

```
Track A (canales en contexto)     → independiente, puede ir primero
Track C (save_contact_data tool)  → independiente, puede ir en paralelo
Track B (merge)                   → depende de C1 para detección de duplicados
```

## Orden recomendado

```
1. Track A  — rápido, alto impacto inmediato (agente ve canales)
2. Track C1 — tool save_contact_data (agente guarda datos)
3. Track B1 — tool merge_contacts (requiere C1 para trigger de detección)
4. Track C3 — nightly batch merge (complemento async)
5. Track B2 — auto-detección de merge candidates
```

## Archivos nuevos

| Archivo | Contenido |
|---------|-----------|
| `src/modules/memory/contact-merge.ts` | Lógica de merge de contactos |
| `src/tools/contacts/save-contact-data.ts` | Tool para guardar datos del contacto |
| `src/tools/contacts/merge-contacts.ts` | Tool para fusionar contactos |
| `src/migrations/0XX_contact-merge.sql` | contact_merge_log + merged_into column |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/engine/prompts/context-builder.ts` | Inyectar canales del contacto |
| `src/modules/twilio-voice/voice-engine.ts` | Inyectar canales en system instruction |
| `src/engine/boundaries/intake.ts` | Trigger de auto-detección de merge |
| `src/engine/proactive/jobs/nightly-batch.ts` | Merge de contact_memory desde summaries |
| `src/modules/memory/memory-manager.ts` | Activar mergeToContactMemory() |
| `instance/prompts/system/skills/` | Skill de gestión de contacto |
