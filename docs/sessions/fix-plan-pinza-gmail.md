# Fix Plan — Auditoría Gmail/Pinza (branch: claude/review-pinza-prototype-8kg1G)

> **Executor**: Sonnet · **Audit branch**: `claude/audit-pinza-gmail` · **Code branch**: `claude/review-pinza-prototype-8kg1G`
> **Target PR**: code branch → `pruebas`

---

## Instrucciones generales para el executor

1. Trabajar en el **code branch** (`claude/review-pinza-prototype-8kg1G`).
2. Cada grupo es un commit separado con prefijo `fix(gmail):` o `refactor(gmail):`.
3. Compilar con `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit` después de cada grupo.
4. NO modificar archivos fuera del módulo gmail, email-triage.ts y email-cleaner.ts salvo donde se indique explícitamente.
5. Los items marcados SKIP se ignoran — no hacer nada.

---

## Grupo A — Bugs críticos (B-01 a B-05)

### A1: `escapeGapName` / sender identification XSS + injection (B-01, B-02, S-01, item #24)

**Archivos**: `src/modules/gmail/manifest.ts`

**Problema**: `persistGapMessages` inyecta `fromName` del email directamente en el contenido del mensaje de sesión sin sanitizar. Un sender malicioso podría inyectar contenido que el LLM interprete como instrucciones.

**Fix**:
1. Crear una función helper `sanitizeSenderName(name: string): string` que:
   - Strip HTML tags
   - Limite a 100 chars
   - Remueva caracteres de control
   - Escape `<`, `>`, `{`, `}` (para evitar confusión con XML tags del prompt)
2. Aplicar `sanitizeSenderName()` en `persistGapMessages` al construir el texto de cada gap message.
3. Aplicar también al campo `from` / `fromName` cuando se construya el preamble de gap context.
4. Mantener la identificación del sender (nombre + email) — solo sanitizar, NO remover.

### A2: Thread gap — timeout ilimitado en fetch (B-03)

**Archivos**: `src/modules/gmail/manifest.ts` (función `detectThreadGap` o el bloque que hace fetch de gap messages)

**Problema**: Al detectar un gap en el thread y hacer fetch de los mensajes intermedios, no hay timeout ni límite. Si el thread tiene 100 mensajes intermedios, se fetchean todos.

**Fix**:
1. Ya existe `EMAIL_GAP_CONTEXT_MAX` (default 5). Verificar que se aplica ANTES del fetch (no después). Es decir, limitar las llamadas a `getFullMessage()`, no truncar después.
2. Agregar un `AbortSignal.timeout(10_000)` (10s) al bloque de fetch de gap messages para que no bloquee el polling indefinidamente. Si el timeout salta, loguear warning y continuar con los mensajes que se hayan obtenido.

### A3: Regex `WROTE_LINE` — false positives con body content (B-04)

**Archivos**: `src/modules/gmail/email-cleaner.ts`

**Problema**: El regex `WROTE_LINE` que detecta "On ... wrote:" puede hacer match en el body del email (no solo en quoted replies), cortando contenido válido.

**Fix**:
1. Hacer el regex más estricto: debe estar precedido por una línea vacía O ser la primera línea, Y la siguiente línea debe empezar con `>` o ser una línea de quoted content.
2. Alternativamente, solo aplicar `stripQuotedReplies` después de haber identificado la posición del delimitador de cita (línea vacía + "On...wrote:" + "> quoted content").
3. Agregar test cases como comentario inline mostrando qué debería y qué NO debería matchear.

### A4: `compactForwardHeaders` — preservar cuerpo del forward (B-05)

**Archivos**: `src/modules/gmail/email-cleaner.ts`

**Problema**: `compactForwardHeaders` puede ser demasiado agresivo y eliminar contenido del forward que es relevante para la conversación.

**Fix**:
1. Revisar que `compactForwardHeaders` solo compacte los headers del forward ("From:", "Date:", "Subject:", "To:") pero preserve el body que viene después.
2. Si actualmente elimina todo después de "---------- Forwarded message ----------", cambiar para que solo colapse los headers en una línea tipo `[Forwarded from: sender@email.com — subject]` y deje el body intacto.

---

## Grupo B — Integridad de datos (I-01 a I-03)

### B1: Signature dedup — firma duplicada en body (I-01)

**Archivos**: `src/modules/gmail/gmail-adapter.ts` (método `buildRawEmail` o donde se inyecta la firma)

**Problema**: Si el LLM incluye la firma en su respuesta Y el adapter la inyecta también, la firma aparece duplicada.

**Fix**:
1. Buscar en el método que inyecta la firma (probablemente `buildRawEmail` o el hook `message:send`) la lógica de dedup existente.
2. Si ya existe dedup, verificar que funciona correctamente comparando el texto plain de la firma (sin HTML) contra el body.
3. Si no existe, agregar: antes de inyectar la firma, verificar si el body ya contiene un substring significativo de la firma (ej: las primeras 2 líneas no-vacías). Si ya está, no inyectar.

### B2: `cleanEmailBody` pierde contexto de forwards (I-02)

**Archivos**: `src/modules/gmail/email-cleaner.ts`

**Problema**: La cadena `stripQuotedReplies → stripThirdPartySignatures → stripDisclaimers` puede eliminar demasiado contexto cuando el email es un forward con información relevante.

**Fix**:
1. Considerar no aplicar `stripQuotedReplies` si el email es un forward (detectado por presencia de "Forwarded message" header).
2. O preservar al menos N líneas (ej: 10) del contenido forwarded como contexto, truncando el resto.
3. Aplicar solo `stripDisclaimers` y `compactForwardHeaders` a forwards, no `stripQuotedReplies`.

### B3: Label sync — `console:config_applied` timing (I-03)

**Archivos**: `src/modules/gmail/manifest.ts` (hook `console:config_applied`)

**Problema**: Cuando se cambian labels desde console, el hook `console:config_applied` re-sincroniza labels pero podría haber race condition si se aplica mientras el poller está procesando.

**Fix**:
1. Verificar que `ensureLabel` / label re-creation dentro del hook `console:config_applied` usa el mismo mutex o lock que el poller.
2. Si no hay lock, agregar un flag `labelsRefreshing: boolean` que el poller chequee antes de aplicar labels.
3. Si ya es seguro (Gmail API es idempotente para `ensureLabel`), documentar con un comentario por qué no hay race condition.

---

## Grupo C — Seguridad / Hardening (S-03, H-01 a H-04)

### C1: Filtrar emails de trash/spam/drafts (S-03, H-04, item #19)

**Archivos**: `src/modules/gmail/manifest.ts` (polling query) o `src/modules/gmail/gmail-adapter.ts` (`fetchNewMessages`)

**Problema**: El poller no excluye explícitamente emails de Trash, Spam ni Drafts. Podría procesar emails de esas carpetas.

**Fix**:
1. En la query del poller (donde se llama a `gmail.users.messages.list` o `gmail.users.history.list`), agregar filtros: `-in:trash -in:spam -is:draft`.
2. Si se usa history API, los history records incluyen el `labelId` — filtrar records que contengan `TRASH`, `SPAM`, o `DRAFT` label.
3. Loguear si se filtra un mensaje de estas categorías (debug level).

### C2: Hardening del address check en triage (H-01, H-03, item #18)

**Archivos**: `src/engine/agentic/email-triage.ts`

**Problema**: El triage usa `ownAddress` para detectar CC-only. Si `ownAddress` está vacío o mal configurado, el triage no funciona correctamente.

**Fix**:
1. Agregar fallback: si `ownAddress` es vacío, intentar obtenerlo del perfil de Gmail (ya debería estar en `detectedOwnAddress` del manifest).
2. Si aún está vacío, loguear warning una vez y tratar el email como RESPOND (fail-open, no fail-closed para no perder emails).
3. Normalizar `ownAddress` y los campos To/CC del email a lowercase antes de comparar.

### C3: Rate limiter — log cuando se acerca al límite (H-02, item #17)

**Archivos**: `src/modules/gmail/rate-limiter.ts`

**Problema**: El rate limiter solo bloquea cuando se alcanza el límite, pero no avisa cuando se está cerca.

**Fix**:
1. Usar el rate limit global de tools si existe (registry `tools:rate-limiter` o similar). Verificar si ya hay un rate limiter global configurable.
2. Si no hay uno global aplicable, agregar log level `warn` cuando el uso está al 80% del límite por hora o por día.
3. El log debe incluir: remaining sends, limit, window.

### C4: Concurrency limit en poll (DT-04, item #15)

**Archivos**: `src/modules/gmail/manifest.ts` (función de polling)

**Problema**: Si llegan muchos emails de golpe, el poller los procesa todos sin límite de concurrencia.

**Fix**:
1. Agregar un `concurrencyLimit` al procesamiento de mensajes en el poll cycle.
2. Usar `Promise.all` con chunks (ej: procesar en batches de 5) en vez de procesar todos los mensajes en paralelo.
3. Esto protege tanto el rate limit de Gmail API como la concurrencia del engine.
4. Valor por defecto: 5 concurrent. Configurar via `EMAIL_POLL_CONCURRENCY` (opcional, puede ser hardcodeado como constante si se prefiere simplicidad).

---

## Grupo D — Robustez (R-01 a R-03)

### D1: Manejo de attachment failures en polling (R-01)

**Archivos**: `src/modules/gmail/manifest.ts` o `src/modules/gmail/gmail-adapter.ts`

**Problema**: Si la descarga de un adjunto falla durante el parsing de un email, podría fallar todo el procesamiento del mensaje.

**Fix**:
1. Envolver el procesamiento de cada adjunto en try/catch individual.
2. Si un adjunto falla, loguear warning con `{ messageId, attachmentId, error }` y continuar con los demás.
3. Incluir el adjunto fallido en la lista con un flag `error: true` o excluirlo de la lista y agregar una nota al body como `[Adjunto no disponible: filename.pdf]`.

### D2: Retry en polling tras error transitorio (R-02)

**Archivos**: `src/modules/gmail/manifest.ts` (poller)

**Problema**: Si el poll falla (ej: 429, network timeout), no hay backoff y el siguiente poll es al intervalo normal.

**Fix**:
1. Agregar exponential backoff al poller: si falla, duplicar el intervalo del próximo intento (hasta un máximo de 5 minutos).
2. Resetear el backoff cuando un poll succeeds.
3. Loguear el backoff: `{ nextRetryMs, consecutiveErrors }`.

### D3: `detectedOwnAddress` — SKIP

**Nota**: Item #12 — "esto aun se queda". No modificar la detección de `ownAddress`. Dejar como está.

---

## Grupo E — Deuda técnica (DT-02, DT-03)

### E1: `stripHtml` duplicado — single source (DT-02, item #13)

**Archivos**: `src/modules/gmail/email-cleaner.ts`, y cualquier otro archivo que tenga su propio `stripHtml`.

**Problema**: `stripHtml` podría estar duplicado entre `email-cleaner.ts` y otro lugar (ej: extractors o helpers).

**Fix**:
1. Buscar todas las implementaciones de `stripHtml` en el repo: `grep -r "function stripHtml\|const stripHtml\|export.*stripHtml" src/`.
2. Si hay duplicados, elegir la implementación más completa y exportarla desde un único lugar.
3. Si `email-cleaner.ts` es la única implementación, dejarlo como está.
4. Si el extractor tiene una versión diferente, consolidar en `email-cleaner.ts` y re-exportar.

**Nota**: Este commit ya se hizo parcialmente en el branch (commit `5509231`). Verificar si ya está resuelto. Si ya lo está, solo confirmar y skip.

### E2: Unify polling error handling (DT-03, item #14)

**Archivos**: `src/modules/gmail/manifest.ts` (poller)

**Problema**: El manejo de errores en el poller está disperso — algunos errores se loguean, otros se silencian, `pollerState` no siempre se actualiza.

**Fix**:
1. Centralizar el manejo de errores del poller en un solo bloque try/catch.
2. Siempre actualizar `pollerState.lastError` y `pollerState.errors` counter.
3. Distinguir entre errores recuperables (429, 5xx, network) y fatales (401 = auth revoked).
4. Para 401: marcar `pollerState.status = 'auth_error'` y detener polling.

---

## Grupo F — Clean code y nits (C-01, C-02, X-01, X-02, items 20-23, 25-32)

### F1: Logging consistente — usar pino con nombre (C-01, item #20)

**Archivos**: `src/modules/gmail/manifest.ts`, `src/modules/gmail/gmail-adapter.ts`

**Fix**:
1. Verificar que todos los `logger.xxx()` usan el logger con name `gmail` (no console.log ni logger sin name).
2. Si hay `console.log` o `console.warn` residuales, reemplazar por `logger.warn`/`logger.info`.
3. Agregar structured fields a logs que solo tengan un string message (ej: agregar `{ threadId, messageId }` donde sea relevante).

### F2: Unused imports / dead code cleanup (C-02, item #21)

**Archivos**: Todos los archivos del módulo gmail.

**Fix**:
1. Buscar imports no usados con el compilador de TS (`tsc --noEmit` ya los reporta como warnings en algunos configs).
2. Remover imports que no se usen.
3. Remover funciones privadas que no se llamen desde ningún lugar.
4. NO remover exports públicos a menos que se confirme que no tienen callers fuera del módulo.

### F3: `X-01` — SKIP

**Nota**: Item #22 — "dejemoslo". No tocar.

### F4: Config validation on init (X-02, item #23)

**Archivos**: `src/modules/gmail/manifest.ts` (función `init`)

**Fix**:
1. Al iniciar, validar que las combinaciones de config sean coherentes.
2. Si `EMAIL_TRIAGE_ENABLED=true` pero no hay OAuth conectado, loguear warning.
3. Si `EMAIL_CUSTOM_LABELS` tiene JSON inválido, loguear error y usar `[]` en vez de crashear.
4. Si `EMAIL_REPLY_MODE` no es uno de los valores válidos, loguear warning y usar `reply-sender` como default.

### F5: Nits restantes (items #25-32)

**Archivos**: Varios archivos del módulo gmail.

Aplicar los siguientes nits que el auditor identificó. Cada uno es menor pero mejora la calidad:

25. Verificar que `EMAIL_BATCH_WAIT_MS=0` desactiva batching correctamente (no timer residual).
26. Agregar type annotation explícito al `pendingBatch` Map si falta.
27. Verificar que `markAsRead` en auto-mark-read no falla silently si el messageId es inválido.
28. Constantes mágicas (hardcoded numbers) — extraer a constantes con nombre descriptivo donde haya números sueltos en el poller/adapter.
29. Verificar que el retry en `sendEmail` (3 max) no incluya errores 4xx que no sean 429 (ej: 400 bad request no debería retryarse).
30. Verificar que el footer se agrega solo una vez (similar a signature dedup).
31. Verificar que `EMAIL_ONLY_FIRST_IN_THREAD` funciona correctamente cuando hay batching activo.
32. Verificar que `EMAIL_IGNORE_SUBJECTS` patterns son case-insensitive.

Para cada uno: si ya está correcto, no hacer nada. Solo fixear si hay un problema real.

---

## Orden de ejecución recomendado

1. **Grupo A** (bugs) — prioridad máxima
2. **Grupo C** (seguridad) — antes de merge
3. **Grupo B** (integridad) — puede ir en paralelo con C
4. **Grupo D** (robustez) — después de A
5. **Grupo E** (tech debt) — verificar si ya resuelto
6. **Grupo F** (nits) — al final, un solo commit

---

## Compilación y verificación

Después de TODOS los grupos, ejecutar:

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Si hay errores, corregir antes de hacer PR.

---

## PR final

- **Title**: `fix(gmail): audit fixes — triage, cleaner, security, robustness`
- **Target**: `claude/review-pinza-prototype-8kg1G` (code branch)
- **Squash**: NO — mantener commits por grupo para trazabilidad
