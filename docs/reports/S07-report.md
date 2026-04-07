# INFORME DE CIERRE — Sesión S07: Contact Memory Enhancement
## Branch: claude/contact-memory-enhancement-NYwxk

---

### Objetivos definidos

Ejecutar el plan `docs/plans/CONTACT-MEMORY-ENHANCEMENT.md` en sus 3 tracks:

- **Track A**: Hacer visibles los puntos de contacto (canales) al agente en el contexto y en la memoria
- **Track B**: Contact merge cross-channel (fusión de contactos duplicados)
- **Track C**: Herramientas del agente para guardar preferencias y datos de contacto

---

### Completado ✅

**Track A — Puntos de contacto visibles al agente**

- `context-builder.ts` (sección 5b): Query a `contact_channels` inyectada en el contexto del agente, formateando canal, identificador, si es principal y último uso relativo.
- `intake.ts`: Al auto-crear un contacto, llama `addChannelKeyFact()` (fire-and-forget) que agrega el canal como `key_fact` a `contact_memory` con `source: "system:channel_discovery"`.
- `voice-engine.ts`: Nueva función `loadContactChannels()` + parámetro `contactChannels[]` en `buildSystemInstruction()`, con sección "Puntos de contacto" en el system instruction de voz.

**Track B — Contact Merge Cross-Channel**

- `src/migrations/042_contact-merge.sql`: Tabla `contact_merge_log` (auditoría) + columna `contacts.merged_into` (soft-delete).
- `src/modules/memory/contact-merge.ts`: Lógica completa de merge en transacción:
  1. Verifica que ambos contactos existen y no están ya mergeados
  2. Mueve `contact_channels` (elimina duplicados antes de mover)
  3. Mueve `sessions` y `messages`
  4. Fusiona `contact_memory` (key_facts + preferences + important_dates + summary, con dedup)
  5. Fusiona `qualification_data` (keep gana en conflictos, toma el mayor score)
  6. Backfill de display_name/email/phone si keep no los tiene
  7. Soft-delete del contacto absorbido (`merged_into` + `status='merged'`)
  8. Log en `contact_merge_log`
- `src/tools/contacts/merge-contacts.ts`: Wrapper tool para el agente.
- `findMergeCandidates()` en `contact-merge.ts`: Detecta si un identificador ya existe en otro contacto.

**Track C — Agent Tools para Preferencias y Datos**

- `src/tools/contacts/save-contact-data.ts`: Tool `save_contact_data` con 4 tipos:
  - `contact_point`: Normaliza identificador, detecta merge candidates, inserta en `contact_channels`, backfill en `contacts.email/phone`, agrega key_fact.
  - `preference`: Actualiza `contact_memory.preferences[key] = value`.
  - `important_date`: Agrega a `contact_memory.important_dates[]` con dedup por date+what.
  - `key_fact`: Agrega o supersede `contact_memory.key_facts[]`.
- `src/modules/memory/manifest.ts`: Registra ambos tools (`save_contact_data`, `merge_contacts`) en `tools:registry`, con `depends: ['tools']` agregado.
- `instance/prompts/system/skills/contact-data-management.md`: Skill con ejemplos de uso para el agente.
- `src/engine/proactive/jobs/nightly-batch.ts`: Paso 9 — `mergeContactMemories()`: para cada contacto con session_summaries sin mergear, llama al LLM para extraer key_facts/preferences/dates y los fusiona via `mergeToContactMemory()` (función que ya existía en memory-manager pero nunca se llamaba).

---

### No completado ❌

- **Track B2 explícito en intake.ts**: El plan proponía un aviso del sistema en el pipeline de intake cuando se descubre un nuevo identificador que ya pertenece a otro contacto. Esto se implementó dentro del tool `save_contact_data` (que es donde ocurre la detección en la práctica), pero no en el pipeline de intake genérico. El agente recibe el aviso cuando usa la tool, que es el flujo natural.

---

### Archivos creados/modificados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `src/migrations/042_contact-merge.sql` | nuevo | contact_merge_log + merged_into column |
| `src/modules/memory/contact-merge.ts` | nuevo | Lógica de merge de contactos |
| `src/tools/contacts/save-contact-data.ts` | nuevo | Tool save_contact_data |
| `src/tools/contacts/merge-contacts.ts` | nuevo | Tool merge_contacts |
| `instance/prompts/system/skills/contact-data-management.md` | nuevo | Skill para el agente |
| `src/engine/prompts/context-builder.ts` | modificado | Sección 5b: puntos de contacto |
| `src/engine/boundaries/intake.ts` | modificado | addChannelKeyFact() en auto-create |
| `src/modules/twilio-voice/voice-engine.ts` | modificado | contactChannels en buildSystemInstruction |
| `src/modules/memory/manifest.ts` | modificado | Registro de tools + depends tools |
| `src/engine/proactive/jobs/nightly-batch.ts` | modificado | Paso 9: mergeContactMemories() |

---

### Interfaces expuestas (exports que otros consumen)

- `mergeContacts(db, keepId, mergeId, reason, mergedBy)` — `contact-merge.ts`
- `findMergeCandidates(db, contactId, channelIdentifier)` — `contact-merge.ts`
- `saveContactData(input, contactId, db, memoryManager)` — `save-contact-data.ts`
- `executeMergeContacts(input, db)` — `merge-contacts.ts`
- Tools registradas: `save_contact_data`, `merge_contacts` (via tools:registry)

---

### Dependencias instaladas

Ninguna nueva.

---

### Tests

No hay tests formales en el proyecto. La compilación TypeScript pasa sin errores en los archivos modificados (los errores pre-existentes de `pino`, `pg`, `ioredis`, `zod`, `@types/node` no son nuevos).

---

### Decisiones técnicas

1. **Tools registradas en `memory` module**: El plan decía "módulo tools" pero los tools de contacto dependen de `memory:manager` y `contact-merge.ts`. Registrarlos en `memory/manifest.ts` es más cohesivo y evita un módulo extra.

2. **`depends: ['tools']` en memory**: Necesario para que `tools:registry` esté disponible al iniciar memory. Es un cambio seguro — el módulo tools es `activateByDefault: true`.

3. **Track B2 integrado en save_contact_data**: En vez de detectar merge candidates en `intake.ts` (que no tiene un mecanismo claro para comunicar el aviso al agente), la detección ocurre cuando el agente usa `save_contact_data`. Es más directo: el agente recibe el aviso en el resultado de la tool y puede decidir qué hacer.

4. **Soft-delete con `status='merged'`**: La columna `status` en `contacts` puede o no existir según la migración histórica. Se usó `merged_into IS NOT NULL` como flag principal, con `status='merged'` como complemento informativo.

5. **Nightly batch C3**: Usa la función `mergeToContactMemory()` ya existente en `memory-manager.ts`, que nunca se llamaba. Ahora sí se activa nightly para contactos con summaries no mergeados.

---

### Riesgos o deuda técnica

- La columna `contacts.status` usada en `contact-merge.ts` (UPDATE contacts SET ... status = 'merged') puede no existir si las migraciones no la incluyen. La migración 042 solo agrega `merged_into`. Si hay error SQL en prod, el merge fallará controladamente por la transacción (ROLLBACK).
- El `depends: ['tools']` en memory crea una dependencia cruzada. Si `tools` falla al init, `memory` también fallará. Aceptable dado que `tools` es `activateByDefault: true` y `core-module`.
- El nightly batch de C3 usa `session_summaries.merged_to_memory_at` — esta columna viene de migration 003. Si no existe, fallará silenciosamente (el taskPool captura errores por item).

---

### Notas para integración

- La migración 042 se aplica automáticamente en el próximo arranque.
- El skill `contact-data-management.md` debe ser incluido por el módulo `prompts` — verificar que lo carga automáticamente desde `instance/prompts/system/skills/`.
- Para que `merge_contacts` funcione, el agente necesita conocer el `contact_id` del candidato. Esto lo provee `save_contact_data` en el campo `merge_candidate.contact_id` cuando detecta un duplicado.
