# Plan 08 — Prompts, Guardrails & Skills

**Prioridad:** MEDIUM
**Tipo:** Solo edición de texto (sin cambios de código TypeScript)
**Objetivo:** Corregir alucinaciones, mejorar flujos de interacción, y prevenir contradicciones. Todo en archivos de prompts/instance.

## Archivos target

Todos en `instance/prompts/`:

| Archivo | Scope |
|---------|-------|
| `instance/prompts/system/guardrails.md` | Anti-hallucination de URLs |
| `instance/prompts/system/skills/medilink-lead-scheduling.md` | Búsqueda por documento, loop prevention |
| `instance/prompts/defaults/criticizer.md` | Criterios reducidos (complementa Plan 05) |
| Knowledge docs o prompts de identidad | Teff vs OneScreen |
| `instance/prompts/system/knowledge-mandate.md` | Verificar que existe y funciona |

## Paso 0 — Verificación obligatoria

1. Verificar que cada archivo existe en la ruta indicada
2. Leer el contenido actual de cada archivo para entender el contexto
3. Si `knowledge-mandate.md` no existe, crearlo según el template esperado

## Fixes

### FIX-01: Guardrail anti-alucinación de URLs [HIGH]
**Fuente:** LAB BUG-04 del audit report
**Archivo:** `instance/prompts/system/guardrails.md`
**Bug:** Luna inventó `https://onescreenlatam.com/.../Catalogo-OneScreen-TapSpace.pdf`. El producto "TapSpace" no existe. La URL es fabricada siguiendo un patrón de URLs reales.
**Fix:**
Agregar al archivo `guardrails.md` (en la sección de reglas o al final):

```markdown
## URLs y enlaces
- NUNCA compartas una URL que no provenga LITERALMENTE del resultado de una herramienta (search_knowledge, sheets-read, etc.).
- Si no encontraste la URL exacta en los resultados, NO la inventes ni la extrapoles de un patrón.
- En vez de inventar, di: "Déjame buscar el enlace exacto" o "Te lo envío en un momento".
- Esto aplica a catálogos, documentos, videos, páginas web — cualquier enlace.
```

### FIX-02: Medilink — buscar por documento antes de pedir datos [HIGH]
**Fuente:** LAB BUG-07 del audit report
**Archivo:** `instance/prompts/system/skills/medilink-lead-scheduling.md`
**Bug:** El bot siguió pidiendo email como si fuera paciente nuevo, cuando el usuario ya había dado su cédula y existía en el sistema.
**Fix:**
Agregar regla explícita al inicio del flujo de datos en el skill:

```markdown
## Regla de búsqueda temprana
Cuando el lead proporcione un número de documento (cédula, pasaporte, tarjeta de identidad):
1. PRIMERO ejecutar `medilink-search-patient` con ese documento
2. Si lo encuentra → tratar como paciente conocido, NO pedir datos que ya tiene el sistema (email, nombre)
3. Si NO lo encuentra → seguir flujo normal de paciente nuevo
4. NUNCA pedir email o datos adicionales si el paciente ya existe en el sistema
```

### FIX-03: Anti-loop — instrucción de escucha activa [HIGH]
**Fuente:** LAB BUG-09 del audit report (complemento prompt del fix de código en Plan 05)
**Archivo:** `instance/prompts/system/skills/medilink-lead-scheduling.md`
**Bug:** Bot envió 7 mensajes idénticos pidiendo nombre/documento/correo. La usuaria intentaba explicar una situación compleja.
**Fix:**
Agregar en la sección de recolección de datos:

```markdown
## Situaciones complejas
- Si el usuario no responde directamente a tu pregunta en 2 intentos, PARA.
- Es probable que esté intentando explicar una situación que no encaja en el flujo estándar (múltiples pacientes, intermediarios, menores de edad, cambios de contexto).
- Resume lo que entiendes hasta el momento y pregunta cómo puedes ayudar.
- Ejemplo: "Entiendo que necesitas agendar para varias personas. Hagamos una a la vez. ¿Con quién empezamos?"
- Si sigue sin funcionar después de 1 intento de reformulación, escala a humano.
```

### FIX-04: Identidad Teff / OneScreen [MEDIUM]
**Fuente:** LAB BUG-10 del audit report
**Bug:** Luna dijo "Somos el distribuidor oficial de OneScreen" y después "Somos directamente la marca OneScreen". Contradicción directa.
**Fix:**
1. Buscar el knowledge doc o prompt de identidad de OneScreen. Puede estar en:
   - `instance/prompts/system/identity.md` o `agent-identity.md`
   - Un knowledge item en la DB con categoría "onescreen"
   - Un prompt en `instance/prompts/defaults/`
2. Agregar claramente:

```markdown
## Identidad corporativa — OneScreen
IMPORTANTE: Teff Studio es DISTRIBUIDOR OFICIAL de OneScreen en Latinoamérica.
- Teff Studio NO es la marca OneScreen.
- NUNCA decir "nosotros somos OneScreen" ni "somos la marca".
- Correcto: "Somos Teff Studio, distribuidor oficial de OneScreen para Latinoamérica."
```

3. Si no hay un lugar claro para esto, agregarlo en `guardrails.md` como regla de identidad

### FIX-05: Bot no re-pregunta datos ya recolectados [MEDIUM]
**Fuente:** LAB BUG-12 del audit report
**Archivo:** `instance/prompts/system/skills/medilink-lead-scheduling.md` u otro skill de recolección
**Bug:** El bot preguntó 3 veces el tipo de organización después de que el usuario ya había dicho "clínica estética".
**Fix:**
Agregar regla en el skill de scheduling o en guardrails:

```markdown
## Datos ya recolectados
- Antes de hacer una pregunta, verifica si la respuesta ya está en la conversación o en los datos del contacto (qualification_data, contact_memory).
- Si el usuario ya proporcionó un dato (nombre, tipo de organización, email, etc.), NO volver a preguntarlo.
- Si necesitas confirmar un dato que ya dio, hazlo explícitamente: "Mencionaste que es una clínica estética, ¿correcto?"
```

### FIX-06: Verificar knowledge-mandate.md [LOW]
**Fuente:** LAB PEND-03 del audit report
**Archivo:** `instance/prompts/system/knowledge-mandate.md`
**Bug:** 78 warnings de "System prompt template not found" para `knowledge-mandate.md`.
**Fix:**
1. Verificar que el archivo existe en `instance/prompts/system/knowledge-mandate.md`
2. Si no existe: crearlo. Contenido sugerido basado en el patrón del sistema:
   ```markdown
   ## Mandato de Knowledge
   Antes de responder cualquier pregunta sobre productos, servicios, precios o procedimientos:
   1. Ejecuta `search_knowledge` con los términos relevantes
   2. Basa tu respuesta EXCLUSIVAMENTE en los resultados obtenidos
   3. Si no hay resultados relevantes, indica que vas a buscar la información
   4. NUNCA inventes datos que no provienen de las herramientas
   ```
3. Si existe pero el path en el código es diferente: corregir el path en el código (esto sería un fix de código, delegar al plan correspondiente)
4. Verificar el path exacto que el sistema espera: buscar `knowledge-mandate` en el código del engine/prompts

## Verificación post-fix

- Leer cada archivo editado para verificar que el formato markdown es correcto
- No hay compilación TS necesaria (son solo archivos de texto)
- Los cambios se activan automáticamente al siguiente pipeline (hot-reload de prompts)

## Notas para el ejecutor

- Este plan es 100% edición de archivos de texto markdown
- NO modificar ningún archivo .ts
- Respetar el formato y estilo de los archivos existentes
- Las instrucciones en los prompts deben sonar como directivas claras, no como sugerencias
- Usar español natural latinoamericano en el contenido que verá el usuario final
