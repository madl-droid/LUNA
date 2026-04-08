# Plan 13b — Medilink: Agendamiento para Terceros

**Prioridad:** HIGH
**Objetivo:** Permitir que un contacto agende citas para terceros (hijos, padres, pareja, etc.), recordando la relacion entre contacto y cada tercero. Adaptable a canal Gmail.

## Contexto

Hoy el sistema asume 1 contacto = 1 paciente Medilink. El `id_paciente` viene de `secCtx.medilinkPatientId` y esta hardcodeado en `create-appointment` (tools.ts:845). No hay soporte para que un contacto maneje multiples pacientes.

El flujo deseado:
1. Usuario escribe "quiero agendar a mi hijo y a mi mama"
2. El agente identifica 2 terceros y su relacion (hijo, mama)
3. Sigue el proceso normal de agendamiento UNO POR UNO para cada tercero
4. Guarda en el contacto: datos del tercero, ID Medilink, relacion
5. Si el usuario vuelve y dice "reagendame la cita de mi hijo" → el agente ya sabe quien es

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/modules/medilink/types.ts` | Nuevos types: `MedilinkDependent`, `SecurityContext` extendido |
| `src/modules/medilink/security.ts` | CRUD de dependientes en `agent_data`, resolucion de contexto |
| `src/modules/medilink/tools.ts` | Nuevas tools + actualizar create/reschedule para aceptar terceros |
| `src/modules/medilink/working-memory.ts` | Tracking de "para quien estoy agendando" |
| `src/modules/medilink/manifest.ts` | Registrar nuevas tools |
| `instance/prompts/system/skills/medilink-lead-scheduling.md` | Actualizar skill con flujo de terceros |
| `instance/prompts/system/skills/medilink-dependent-scheduling.md` | Nuevo skill para terceros (o merge con el existente) |

## Cambios previos relevantes (Plan 11 ya ejecutado)

**CRITICO — Plan 11 ya modifico `security.ts` y `manifest.ts`:**
- `SecurityService` constructor ahora recibe 4 parametros: `(apiClient, db, config, registry)` — `registry` ya esta disponible como `this.registry`
- `linkContactToPatient()` ya incluye `medilink_is_lead: false` en el merge JSONB
- `linkContactToPatient()` ya captura `result.rowCount` y dispara `registry.runHook('contact:type_changed', ...)` si hubo cambio
- `manifest.ts` ya instancia con `new SecurityService(apiClient, db, config, registry)`
- `src/kernel/types.ts` ya tiene `contact:type_changed` en `HookMap`

**Impacto en este plan:**
- FIX-02: NO necesita agregar `registry` al constructor de SecurityService — ya existe. Los metodos nuevos (`addDependent`, `findDependent`) pueden usar `this.registry` directamente.
- FIX-01: Los nuevos campos en `SecurityContext` deben coexistir con los existentes. Leer la interfaz ACTUAL (post-Plan 11) antes de modificar.
- Hacer `git pull` o merge del branch con Plan 11 antes de empezar.

## Paso 0 — Verificacion obligatoria

1. **PRIMERO:** Merge o pull del branch con Plan 11 (`claude/fix-bugs-implementation-a8Cvm`) para tener los cambios recientes
2. Leer `types.ts` completo — mapear `SecurityContext` ACTUAL (post-Plan 11), `MedilinkPatient`, `AppointmentSnapshot`
3. Leer `security.ts` completo — verificar que el constructor ya tiene 4 params y que `this.registry` esta disponible
4. Leer `tools.ts` lineas 744-927 — entender `create-appointment`, especificamente linea 845 donde hardcodea `id_paciente`
5. Leer `working-memory.ts` — entender campos actuales y como se usan
6. Leer `instance/prompts/system/skills/medilink-lead-scheduling.md` — el prompt actual de agendamiento
7. Verificar que la API de Medilink acepta `id_paciente` de cualquier paciente (no solo el vinculado al contacto) — ya confirmado en api-client.ts

---

## FIX-01: Modelo de datos — Dependientes [FOUNDATION]
**Archivo:** `src/modules/medilink/types.ts`

### Nuevo type MedilinkDependent
```typescript
export interface MedilinkDependent {
  /** ID del paciente en Medilink */
  medilinkPatientId: number
  /** Nombre del tercero como lo conoce el contacto */
  displayName: string
  /** Relacion: hijo, hija, mama, papa, esposo/a, hermano/a, abuelo/a, otro */
  relationship: string
  /** Numero de documento del tercero (RUT, CI, etc.) — para re-verificacion */
  documentNumber?: string
  /** Tipo de documento */
  documentType?: string
  /** Fecha de registro */
  registeredAt: string
}
```

### Actualizar SecurityContext
```typescript
export interface SecurityContext {
  contactId: string
  contactPhone: string | null
  medilinkPatientId: number | null
  verificationLevel: VerificationLevel
  // NUEVO: dependientes del contacto
  dependents: MedilinkDependent[]
  // NUEVO: si estamos agendando para un tercero, cual
  activeTargetPatientId: number | null
  activeTargetName: string | null
  activeTargetRelationship: string | null
}
```

### Estructura en agent_data (JSONB)
```json
{
  "medilink_patient_id": "12345",
  "medilink_verified": "document_verified",
  "medilink_dependents": [
    {
      "medilinkPatientId": 67890,
      "displayName": "Sofia",
      "relationship": "hija",
      "documentNumber": "12.345.678-9",
      "documentType": "RUT",
      "registeredAt": "2026-04-08T12:00:00Z"
    }
  ]
}
```

---

## FIX-02: CRUD de dependientes en SecurityService [CORE]
**Archivo:** `src/modules/medilink/security.ts`

### Leer dependientes
En `resolveContext()`, despues de cargar `medilink_patient_id`:
```typescript
const dependents: MedilinkDependent[] = agentData.medilink_dependents ?? []
// Incluir en SecurityContext
return { ...ctx, dependents }
```

### Agregar dependiente
Nuevo metodo:
```typescript
async addDependent(contactId: string, dep: MedilinkDependent): Promise<void> {
  // Leer dependientes actuales
  const { rows } = await this.db.query(
    `SELECT agent_data->'medilink_dependents' AS deps FROM agent_contacts WHERE contact_id = $1`,
    [contactId]
  )
  const current: MedilinkDependent[] = rows[0]?.deps ?? []
  
  // Verificar que no exista duplicado (por medilinkPatientId)
  if (current.some(d => d.medilinkPatientId === dep.medilinkPatientId)) {
    return // Ya existe, skip
  }
  
  current.push(dep)
  
  await this.db.query(
    `UPDATE agent_contacts SET agent_data = agent_data || $1::jsonb WHERE contact_id = $2`,
    [JSON.stringify({ medilink_dependents: current }), contactId]
  )
}
```

### Buscar dependiente por relacion/nombre
```typescript
findDependent(ctx: SecurityContext, hint: string): MedilinkDependent | null {
  const lower = hint.toLowerCase()
  // Buscar por relacion: "mi hijo", "mi mama"
  const byRelation = ctx.dependents.find(d => lower.includes(d.relationship))
  if (byRelation) return byRelation
  // Buscar por nombre: "Sofia"
  const byName = ctx.dependents.find(d => d.displayName.toLowerCase().includes(lower))
  return byName ?? null
}
```

**NOTA:** `findDependent` es un helper para el LLM, pero la resolucion principal la hace el agente via tools (FIX-03). Este helper es para el skill prompt.

---

## FIX-03: Tools para terceros [MAIN]
**Archivo:** `src/modules/medilink/tools.ts`

### Tool nueva: `medilink-list-dependents`
```
Nombre: medilink-list-dependents
Descripcion: Lista los terceros/dependientes registrados de este contacto
Parametros: ninguno
Retorna: Array de { displayName, relationship, medilinkPatientId }
```
**Implementacion:**
1. Leer `secCtx.dependents` del SecurityContext
2. Retornar lista formateada: `"Sofia (hija, ID: 67890), Juan (papa, ID: 11111)"`
3. Si no hay dependientes: `"No tienes terceros registrados"`

### Tool nueva: `medilink-register-dependent`
```
Nombre: medilink-register-dependent
Descripcion: Registra un tercero/dependiente del contacto para agendar citas
Parametros:
  - name: string (nombre del tercero)
  - relationship: string (relacion: hijo, hija, mama, papa, esposo/a, etc.)
  - document_type: string (RUT, CI, Pasaporte, Tarjeta de Identidad)
  - document_number: string (numero de documento)
Retorna: { success, message, medilinkPatientId }
```
**Implementacion:**
1. Buscar paciente en Medilink por documento: `api.findPatientByDocument(document_number)`
2. Si existe:
   - Obtener `medilinkPatientId` del resultado
   - Llamar `securityService.addDependent(contactId, { medilinkPatientId, displayName, relationship, documentNumber, documentType, registeredAt })`
   - Retornar exito con datos del paciente
3. Si NO existe:
   - Crear paciente nuevo: `api.createPatient({ nombre, documento, tipo_documento, ... })`
   - Necesita datos minimos del paciente (nombre, documento). Email y telefono pueden ser del contacto principal o quedar vacios
   - Llamar `securityService.addDependent()` con el ID creado
   - Retornar exito
4. Si falla: retornar error descriptivo

### Actualizar: `medilink-create-appointment`
**Linea clave:** tools.ts:845 — `id_paciente: secCtx.medilinkPatientId!`

Agregar parametro opcional `dependent_patient_id`:
```
Parametros actuales + nuevo:
  - dependent_patient_id?: number (ID del dependiente. Si no se pasa, agenda para el contacto principal)
```

**Implementacion:**
1. Si `dependent_patient_id` esta presente:
   - Verificar que el ID esta en `secCtx.dependents` (seguridad: no agendar para cualquiera)
   - Usar `dependent_patient_id` en vez de `secCtx.medilinkPatientId`
   - Incluir nombre del dependiente en el comentario de la cita
2. Si NO esta presente:
   - Comportamiento actual (agenda para el contacto principal)

```typescript
// Linea 845 actualizada:
const targetPatientId = input.dependent_patient_id
  ? (() => {
      const dep = secCtx.dependents.find(d => d.medilinkPatientId === input.dependent_patient_id)
      if (!dep) throw new Error('Dependent not registered for this contact')
      return dep.medilinkPatientId
    })()
  : secCtx.medilinkPatientId!

const appointment = await api.createAppointment({
  id_paciente: targetPatientId,
  // ... resto igual
  comentario: input.dependent_patient_id
    ? `Cita agendada por ${contactName} para ${depName} (${depRelationship}). ${input.comentario ?? ''}`
    : input.comentario,
})
```

### Actualizar: `medilink-reschedule-appointment`
Mismo patron: agregar `dependent_patient_id` opcional. Si presente, verificar que la cita pertenece al dependiente. Actualizar `ownsAppointment()` para aceptar dependientes:

```typescript
ownsOrDependentAppointment(ctx: SecurityContext, appt: MedilinkAppointment): boolean {
  if (ctx.medilinkPatientId === appt.id_paciente) return true
  return ctx.dependents.some(d => d.medilinkPatientId === appt.id_paciente)
}
```

---

## FIX-04: Working Memory — Target de agendamiento [SUPPORT]
**Archivo:** `src/modules/medilink/working-memory.ts`

Agregar campos nuevos:
```typescript
const ML = {
  // ... existentes
  SCHEDULING_TARGET: 'scheduling_target',  // 'self' | dependent medilinkPatientId
  SCHEDULING_TARGET_NAME: 'scheduling_target_name',
  SCHEDULING_QUEUE: 'scheduling_queue',    // Array de targets pendientes si agenda para varios
}
```

**Uso:**
- Cuando el usuario dice "quiero agendar a mi hijo y a mi mama":
  1. El agente llama `medilink-list-dependents` para ver si ya estan registrados
  2. Si no, registra cada uno con `medilink-register-dependent`
  3. Guarda en working memory: `scheduling_queue: [67890, 11111]` (los IDs)
  4. Procesa uno a uno: `scheduling_target: 67890`, `scheduling_target_name: "Sofia"`
  5. Al terminar con Sofia, pasa al siguiente en la queue
  6. Al terminar todos, limpia la queue

---

## FIX-05: Prompt — Skill de agendamiento para terceros [PROMPT]
**Archivo:** `instance/prompts/system/skills/medilink-lead-scheduling.md`

### Actualizar el skill existente (no crear uno nuevo)

Agregar seccion al prompt de scheduling:

```markdown
## Agendamiento para terceros (dependientes)

Si el usuario dice que quiere agendar para otra persona (hijo, mama, pareja, etc.):

1. **Identificar al tercero:**
   - Primero usa `medilink-list-dependents` para ver si ya esta registrado
   - Si ya existe, confirma: "Perfecto, vamos a agendar para {nombre} ({relacion})"
   - Si NO existe, pide datos: nombre completo, tipo de documento, numero de documento
   - Registra con `medilink-register-dependent`

2. **Proceso de agendamiento:**
   - Sigue el mismo flujo normal (buscar disponibilidad, confirmar horario, crear cita)
   - Al crear la cita, pasa `dependent_patient_id` con el ID del tercero
   - Confirma mencionando el nombre del tercero: "Listo, la cita de {nombre} queda agendada para..."

3. **Multiples terceros:**
   - Si pide agendar para varios, procesalos UNO A UNO
   - Confirma cada uno antes de pasar al siguiente
   - "Listo con la cita de Sofia. Ahora vamos con la de tu mama, como se llama?"

4. **Reagendamiento de terceros:**
   - Si dice "reagenda la cita de mi hijo", usa `medilink-list-dependents` para encontrarlo
   - Busca las citas del tercero y ofrece reagendar

5. **REGLAS:**
   - NUNCA agendes para un tercero sin registrarlo primero
   - SIEMPRE confirma la relacion antes de registrar
   - El contacto principal debe estar verificado (phone_matched minimo) para registrar terceros
   - Los datos de documento del tercero son OBLIGATORIOS (para vincular con Medilink)
```

---

## FIX-06: Adaptacion a Gmail [SMALL]
**Archivos:** `instance/prompts/system/skills/medilink-lead-scheduling.md`

El canal Gmail ya pasa por el mismo engine y tiene acceso a las mismas tools. La adaptacion es solo de prompt:

1. En el skill, agregar nota: "Este flujo aplica tanto para WhatsApp como para email. En email, puedes solicitar todos los datos del tercero en un solo mensaje."
2. NO se necesitan cambios de codigo — las tools son channel-agnostic
3. El `SecurityContext` se resuelve por `contactId`, que existe en ambos canales
4. Si el contacto de Gmail ya esta vinculado a Medilink (por cross-channel linking), los dependientes ya estan disponibles

---

## Verificacion post-fix

1. Contacto dice "quiero agendar a mi hijo" → agente pide datos → registra dependiente → agenda cita con `dependent_patient_id`
2. Contacto vuelve y dice "reagendame la cita de mi hijo" → agente encuentra al hijo por relacion → reagenda
3. Contacto dice "agenda para mi hijo y mi mama" → agente procesa uno a uno → 2 citas creadas
4. `agent_data` contiene `medilink_dependents` con los terceros registrados
5. Tool `create-appointment` con `dependent_patient_id` que NO esta en dependientes → error de seguridad
6. Contacto no verificado intenta registrar tercero → rechazado
7. Mismo flujo funciona por email (Gmail)
8. Compilar: `npx tsc --noEmit` — 0 errores nuevos

## Notas

- Este plan es mas complejo que los anteriores. Recomiendo ejecutarlo como UN SOLO agente (no dividir)
- Las tools nuevas se registran automaticamente al cargar el modulo medilink
- No se necesita migracion SQL — los dependientes viven en `agent_data` (JSONB existente)
- La API de Medilink ya soporta `id_paciente` de cualquier paciente (confirmado)
- **Plan 11 ya se ejecuto** — `security.ts` tiene constructor con `registry`, `linkContactToPatient` ya limpia `medilink_is_lead` y dispara hook. NO duplicar esos cambios
- **Plan 13b NO puede ejecutarse en paralelo con Plan 13a** si 13a toca knowledge/pg-store. En la practica son independientes (medilink vs knowledge/tts) pero coordinar merge
