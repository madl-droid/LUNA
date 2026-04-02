# Console Audit

## Resumen ejecutivo

La consola de LUNA no está “rota” en bloque, pero sí tiene una desalineación clara entre 4 capas:

1. `configSchema` de los módulos
2. campos realmente expuestos en la consola
3. lógica runtime que sí consume esos parámetros
4. documentación `CLAUDE.md`

Lo más relevante:

- Hay toggles de formato “avanzado” que la consola guarda, pero el runtime no lee.
- Hay parámetros runtime reales que existen en `configSchema` y en la documentación, pero nunca aparecen en la consola.
- Hay al menos un parámetro de WhatsApp que sí afecta el runtime, pero la consola lo oculta detrás de una condición incorrecta.
- La documentación de consola ya no refleja la navegación real ni varios parámetros vigentes.

## Hallazgos

### 1. `EMAIL_FORMAT_ADVANCED` y `GOOGLE_CHAT_FORMAT_ADVANCED` son toggles fantasma

- Archivos:
  - `src/modules/gmail/manifest.ts:790`
  - `src/modules/gmail/manifest.ts:1078`
  - `src/modules/google-chat/manifest.ts:319`
  - `src/modules/google-chat/manifest.ts:524`
  - `src/modules/console/ui/js/console-minimal.js:332`
  - `src/engine/prompts/compositor.ts:53`
- Qué pasa:
  - La consola expone y persiste `EMAIL_FORMAT_ADVANCED` y `GOOGLE_CHAT_FORMAT_ADVANCED`.
  - El JS de consola les da comportamiento visual: poblar o limpiar `FORMAT_INSTRUCTIONS_*`.
  - Pero el runtime no lee esos flags. `buildFormatFromForm()` solo consume `*_FORMAT_TONE`, `*_FORMAT_MAX_SENTENCES`, `*_FORMAT_MAX_PARAGRAPHS`, `*_FORMAT_EMOJI_LEVEL`, etc.
- Impacto:
  - El usuario cree que activar “Prompting avanzado” cambia el modo de ejecución, pero en realidad el runtime solo reacciona al contenido final de `FORMAT_INSTRUCTIONS_*`.
- Recomendación:
  - O eliminar esos flags del schema y tratarlos como estado puramente UI.
  - O hacer que el runtime sí use explícitamente `*_FORMAT_ADVANCED`.

### 2. `WHATSAPP_FORMAT_ADVANCED` está documentado y referenciado en JS, pero no existe en el módulo

- Archivos:
  - `src/modules/whatsapp/CLAUDE.md:23`
  - `src/modules/console/ui/js/console-minimal.js:332`
  - `src/modules/whatsapp/manifest.ts:156`
  - `src/modules/whatsapp/manifest.ts:209`
- Qué pasa:
  - La documentación de WhatsApp lista `WHATSAPP_FORMAT_ADVANCED`.
  - El JS compartido de la consola todavía intenta manejar ese flag.
  - Pero el `configSchema` de WhatsApp no lo define y la UI del módulo tampoco lo renderiza.
- Impacto:
  - Hay deuda muerta en documentación y frontend.
  - La consola sugiere que WhatsApp comparte el mismo patrón de “advanced mode” que Gmail y Google Chat, pero no es cierto.
- Recomendación:
  - Limpiar la referencia del JS y la documentación, o reintroducir el parámetro de forma consistente.

### 3. `WHATSAPP_FORMAT_OPENING_SIGNS` sí afecta el runtime, pero la consola lo oculta cuando no debería

- Archivos:
  - `src/modules/whatsapp/manifest.ts:164`
  - `src/modules/whatsapp/manifest.ts:217`
  - `src/engine/prompts/compositor.ts:62`
- Qué pasa:
  - `WHATSAPP_FORMAT_OPENING_SIGNS` se usa siempre al construir el prompt final.
  - En la consola ese campo solo aparece cuando `WHATSAPP_FORMAT_TYPOS_ENABLED=true`.
- Impacto:
  - El parámetro está parcialmente desconectado de la UI.
  - Si alguien quiere controlar signos de apertura sin habilitar typos, no puede hacerlo desde consola aunque el runtime sí lo soporte.
- Recomendación:
  - Quitar el `visibleWhen` dependiente de typos para este campo.

### 4. Google Workspace tiene parámetros runtime reales que no existen en la consola

- Archivos:
  - `src/modules/google-apps/manifest.ts:270`
  - `src/modules/google-apps/manifest.ts:289`
  - `src/modules/google-apps/oauth-manager.ts:96`
  - `src/modules/google-apps/oauth-manager.ts:143`
  - `src/modules/google-apps/drive-service.ts:27`
  - `src/modules/google-apps/CLAUDE.md:19`
- Parámetros afectados:
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_API_TIMEOUT_MS`
  - `GOOGLE_API_RETRY_MAX`
- Qué pasa:
  - Están en `configSchema`.
  - El runtime sí los usa.
  - La consola solo expone `GOOGLE_ENABLED_SERVICES` y `GOOGLE_TOKEN_REFRESH_BUFFER_MS`.
  - La documentación del módulo los sigue presentando como parte de la config disponible.
- Impacto:
  - Hay knobs operativos útiles que no son administrables desde consola.
  - La documentación crea una expectativa falsa.
- Recomendación:
  - Exponerlos en consola, o declararlos explícitamente como runtime-only / hidden.

### 5. Gmail tiene parámetros OAuth reales que no están expuestos en la consola de configuración

- Archivos:
  - `src/modules/gmail/manifest.ts:780`
  - `src/modules/gmail/manifest.ts:820`
  - `src/modules/gmail/manifest.ts:1171`
  - `src/modules/gmail/manifest.ts:1217`
  - `src/modules/gmail/email-oauth.ts:90`
  - `src/modules/gmail/CLAUDE.md:25`
- Parámetros afectados:
  - `GMAIL_REFRESH_TOKEN`
  - `GMAIL_TOKEN_REFRESH_BUFFER_MS`
- Qué pasa:
  - El runtime sí los usa.
  - El wizard solo pide `GMAIL_CLIENT_ID` y `GMAIL_CLIENT_SECRET`.
  - No aparecen como campos normales en la página del canal.
- Impacto:
  - No se pueden inspeccionar ni ajustar desde la UI principal aunque sí condicionan el refresh OAuth.
- Recomendación:
  - Exponerlos en un panel avanzado de Gmail, o documentar que solo se gestionan fuera de consola.

### 6. Scheduled Tasks tiene config global activa en runtime, pero la consola solo deja editar tareas

- Archivos:
  - `src/modules/scheduled-tasks/manifest.ts:38`
  - `src/modules/scheduled-tasks/manifest.ts:44`
  - `src/modules/scheduled-tasks/scheduler.ts:66`
  - `src/modules/scheduled-tasks/executor.ts:51`
  - `src/modules/scheduled-tasks/CLAUDE.md:17`
- Parámetros afectados:
  - `SCHEDULED_TASKS_ENABLED`
  - `SCHEDULED_TASKS_MAX_CONCURRENT`
  - `SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS`
- Qué pasa:
  - La consola renderiza la UI de tareas, pero no expone la configuración global del módulo.
  - El runtime sí usa esos parámetros para habilitar scheduler, concurrencia y timeout.
- Impacto:
  - La página parece completa, pero deja fuera el control operativo más importante del scheduler.
- Recomendación:
  - Añadir un panel “Global settings” en la sección de tareas automáticas.

### 7. Lead Scoring usa `LEAD_SCORING_CONFIG_PATH`, pero la consola no lo muestra en ninguna parte

- Archivos:
  - `src/modules/lead-scoring/manifest.ts:379`
  - `src/modules/lead-scoring/manifest.ts:383`
  - `src/modules/lead-scoring/manifest.ts:400`
  - `src/modules/lead-scoring/CLAUDE.md:21`
- Qué pasa:
  - La ruta del archivo JSON de scoring es parámetro real del módulo.
  - El runtime la usa para cargar `instance/qualifying.json`.
  - La consola no la expone ni como readonly.
- Impacto:
  - El operador no puede ver desde qué archivo está leyendo el módulo.
  - Diagnosticar cambios entre ambientes se vuelve más difícil.
- Recomendación:
  - Mostrarla al menos como campo readonly o moverla a documentación explícita de despliegue.

### 8. `KNOWLEDGE_GOOGLE_AI_API_KEY` pertenece a Knowledge, pero quedó enterrada en la página de LLM

- Archivos:
  - `src/modules/knowledge/manifest.ts:1098`
  - `src/modules/knowledge/manifest.ts:1197`
  - `src/modules/llm/manifest.ts:221`
  - `src/modules/llm/manifest.ts:224`
- Qué pasa:
  - La key vive en el schema del módulo `knowledge` y el runtime de Knowledge la consume.
  - Pero el campo visible está en la UI del módulo `llm`.
- Impacto:
  - No está “desconectada”, pero sí mal ubicada.
  - Complica descubribilidad: el operador busca el ajuste en Knowledge y está en LLM.
- Recomendación:
  - Reubicarla visualmente a Knowledge o duplicar el acceso con una nota clara.

### 9. La documentación de consola ya no describe bien la navegación real

- Archivos:
  - `src/modules/console/CLAUDE.md:4`
  - `src/modules/console/CLAUDE.md:85`
  - `src/modules/console/server.ts:1262`
  - `src/modules/console/server.ts:1315`
  - `src/modules/console/server.ts:1338`
  - `src/modules/console/server.ts:1356`
  - `src/modules/console/server.ts:1536`
- Qué pasa:
  - La documentación sigue presentando ejemplos como `/console/users`, `/console/knowledge` o `/console/tools` como páginas directas de referencia.
  - El servidor ya unificó navegación en `/console/agente/...`, `/console/herramientas/...` y `/console/contacts/...`.
  - `/console` además redirige a `/console/agente`.
- Impacto:
  - La documentación hace más difícil auditar la consola porque no refleja la IA real de navegación.
  - Genera falsas alarmas de “esto ya no existe” cuando en realidad quedó reubicado.
- Recomendación:
  - Actualizar `src/modules/console/CLAUDE.md` para reflejar la arquitectura actual.

## Prioridad sugerida

1. Corregir el toggle fantasma de `*_FORMAT_ADVANCED`.
2. Corregir la visibilidad de `WHATSAPP_FORMAT_OPENING_SIGNS`.
3. Definir qué parámetros runtime deben ser realmente administrables desde consola.
4. Limpiar documentación y JS legado (`WHATSAPP_FORMAT_ADVANCED`).
5. Reubicar o duplicar visualmente la configuración de embeddings de Knowledge.

## Parámetros especialmente sospechosos

### Expuestos o documentados, pero sin efecto runtime claro

- `EMAIL_FORMAT_ADVANCED`
- `GOOGLE_CHAT_FORMAT_ADVANCED`
- `WHATSAPP_FORMAT_ADVANCED` (ni siquiera existe en schema)

### Usados por runtime, pero no visibles en consola

- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_API_TIMEOUT_MS`
- `GOOGLE_API_RETRY_MAX`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_TOKEN_REFRESH_BUFFER_MS`
- `SCHEDULED_TASKS_ENABLED`
- `SCHEDULED_TASKS_MAX_CONCURRENT`
- `SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS`
- `LEAD_SCORING_CONFIG_PATH`

### Visibles, pero ubicados en la sección equivocada

- `KNOWLEDGE_GOOGLE_AI_API_KEY`
