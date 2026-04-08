# OVERVIEW — Módulo Templates (Plantillas de Documentos)

## Sesión
Planning session para el módulo `templates` — plantillas de documentos para Luna.

## Problema
Luna necesita crear documentos (comparativos, cotizaciones, presentaciones) a partir de plantillas predefinidas en Google Drive. Las plantillas tienen placeholders `{KEY_NAME}` que Luna llena con datos específicos. El admin controla qué plantillas existen y si Luna puede crear documentos sin plantilla.

## Solución
Módulo `templates` tipo `feature` que depende de `google-apps` y `tools`. Gestión de plantillas via consola, creación de documentos via tools del agente, subagente para investigación de comparativos.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                     Console UI                       │
│  Admin: registra plantillas, configura strict mode   │
│  Pega URL Drive → auto-scan {KEYS} → agregar desc   │
└─────────────┬───────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────┐
│              Módulo templates                         │
│                                                       │
│  Service: CRUD, createDocument, reeditDocument       │
│  Repository: doc_templates, doc_generated (PG)       │
│  FolderManager: resolver patterns, crear carpetas    │
│  Tools: create-from-template, search-generated,      │
│         reedit-document                              │
│  Catalog injection: prompt del agente                │
│                                                       │
│  Subagent: comparativo-researcher                    │
│    - can_spawn_children → web-researcher             │
│    - verify_result: true                             │
│    - complex model tier                              │
└──────┬──────────────────────────┬────────────────────┘
       │                          │
┌──────▼──────┐           ┌──────▼──────┐
│ google-apps │           │    tools    │
│   Drive     │           │  registry   │
│   Docs      │           └─────────────┘
│   Slides    │
│   Sheets    │
└─────────────┘
```

## Decisiones de diseño clave

| Decisión | Elección | Razón |
|----------|----------|-------|
| Módulo propio vs sub-módulo | Módulo propio | Tiene DB, UI, tools propios. Patrón freight. |
| Storage de plantillas | Drive (admin) + metadata en PG | Admin ya tiene archivos en Drive, solo registramos metadata |
| Re-edición | In-place replaceText (mismo link) | Drive crea revisión automática. No cambia el enlace. |
| Re-edición fallback (conflicto) | Regenerar + files.update sobre mismo ID | Caso raro: dos keys con mismo valor. Export→upload como nueva versión. |
| Sharing | Todos "anyone with link" + restricción comportamental | Técnicamente simple. Agente controla a quién envía el link. |
| Keys | Por plantilla (no global) | Cada plantilla tiene su contexto de llenado. Console sugiere keys existentes. |
| Folder dedup | Buscar antes de crear + match exacto | Drive `contains` no es exact match, filtrar client-side. |
| Comparativos subagent | System, can_spawn_children | Delega búsqueda a web-researcher. No tiene tools propios. |
| Strict mode | Toggle en consola | Admin decide: permitir freeform o solo plantillas. |
| No template action | warn / block / hitl | Configurable. Block no dice "contacta humano" (regla: no parecer IA). |

---

## Planes de ejecución

### Plan 1: Fundación
**Scope**: Módulo skeleton, DB, Drive extensions, repository, service, console UI, template CRUD
**Archivos nuevos**: 8 | **Archivos modificados**: 2
**Estimación**: ~800-1200 líneas de código nuevo

### Plan 2: Pipeline de Documentos + Tools
**Scope**: Tools del agente, document creation flow, folder manager, re-edición, sharing, HITL, prompt injection
**Archivos nuevos**: 2 | **Archivos modificados**: 5-6
**Estimación**: ~600-900 líneas de código nuevo

### Plan 3: Subagente Comparativos
**Scope**: Migración seed, system prompt, lifecycle (enable/disable con módulo), dedup, skill, guidance
**Archivos nuevos**: 3 | **Archivos modificados**: 3
**Estimación**: ~300-400 líneas de código nuevo

---

## Estrategia de ejecución

```
Plan 1 ──→ Plan 2 ──→ Plan 3
 (seq)      (seq)      (seq)
```

**100% secuencial.** Cada plan depende del anterior:
- Plan 2 necesita el service, repository y Drive extensions de Plan 1
- Plan 3 necesita los tools y flows de Plan 2

No hay paralelismo real entre planes. Dentro de cada plan, los pasos SÍ pueden ejecutarse en orden sin dependencias conflictivas.

---

## DB Schema

```
doc_templates                       doc_generated
┌────────────────────┐             ┌─────────────────────────┐
│ id (UUID PK)       │←────────────│ template_id (FK)        │
│ name               │             │ id (UUID PK)            │
│ description         │             │ contact_id              │
│ doc_type           │             │ requester_sender_id     │
│ drive_file_id      │             │ requester_channel       │
│ mime_type          │             │ drive_file_id           │
│ keys (JSONB)       │             │ drive_folder_id         │
│ folder_pattern     │             │ web_view_link           │
│ sharing_mode       │             │ doc_name                │
│ enabled            │             │ key_values (JSONB)      │
│ created_at         │             │ doc_type                │
│ updated_at         │             │ status                  │
└────────────────────┘             │ tags (JSONB, GIN idx)   │
                                   │ version                 │
                                   │ created_at              │
                                   │ updated_at              │
                                   └─────────────────────────┘
```

## Migrations
- `048_templates-v1.sql` — tablas doc_templates + doc_generated + índices
- `049_comparativo-subagent.sql` — seed subagent_types (comparativo-researcher)

---

## Flows principales

### Crear documento (cotización/presentación)
```
Contacto: "Hazme una cotización para ACME Corp"
  → Agente busca template tipo cotización
  → Agente llena key_values desde contexto conversacional
  → Tool: create-from-template
    → Copy template → batchEdit {keys} → shareAnyone → organize in folder
  → Agente: "Te comparto la cotización: [link]"
```

### Crear comparativo (con investigación)
```
Contacto: "Necesito un comparativo vs Competitor X"
  → Agente busca comparativos existentes (search-generated-documents)
  → No existe →
  → Agente: run_subagent("comparativo-researcher", task con keys + contexto)
    → Subagente analiza contexto (URLs/PDFs del contacto)
    → Si falta info → spawn web-researcher
    → Retorna key_values investigados
  → Agente: create-from-template con key_values
  → Agente: "Te comparto el comparativo: [link]"
```

### Re-edición (mismo enlace)
```
Contacto: "Cambia el precio en la cotización a $8,000"
  → Agente busca documento generado
  → Tool: reedit-document({ document_id, updated_key_values: { PRICE: "$8,000" } })
    → replaceText(docId, "$5,000", "$8,000") — in-place, mismo file ID
    → DB: version++, key_values actualizado
  → Agente: "Listo, actualicé la cotización. Puedes verlo en el mismo enlace."
```

### Sin plantilla + strict mode
```
Contacto: "Hazme un informe de mercado"
  → Agente busca template tipo "otro" o "informe"
  → No hay plantilla →
  → Si strict + hitl: crea ticket HITL + "Permíteme consultar internamente"
  → Si strict + block: "En este momento no cuento con la plantilla para elaborar ese documento"
  → Si strict + warn: "No tengo plantilla pero puedo intentarlo de otra forma"
  → Si !strict: crea libremente (comportamiento actual)
```
