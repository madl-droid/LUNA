# Plan 7: Refactor completo de acentos

## Objetivo
Mover los accent traits de un diccionario hardcoded de ~50 entradas en TypeScript a archivos `.md` editables. Reducir a los 5 acentos requeridos. Limpiar código legacy.

## Estado actual (problemas)
1. `ACCENT_TRAIT_PROMPTS` en `src/modules/prompts/manifest.ts:418-490` tiene ~50 acentos (es, en, pt, fr, de, it) cuando solo se necesitan 5
2. Los trait prompts son strings largos hardcoded — para editar un acento hay que recompilar
3. `src/engine/prompts/accent.ts` es un no-op legacy que retorna `''`
4. `ACCENT_MAP` en `src/modules/console/templates-section-agent.ts:656-669` tiene 8 entradas (incluye es-CL, es-CAR, en-CAR que no se necesitan)
5. `CODE_TZ` en el mismo archivo (línea 817-826) también tiene las 8

## Acentos requeridos (solo estos 5)
| Código | País | Timezone |
|--------|------|----------|
| `en-US` | Estados Unidos (neutro) | America/New_York |
| `es-MX` | México | America/Mexico_City |
| `es-CO` | Colombia | America/Bogota |
| `es-EC` | Ecuador | America/Guayaquil |
| `es-PE` | Perú | America/Lima |

## Pasos

### Paso 1: Crear directorio y archivos `.md` de acentos

Crear `instance/prompts/accents/` con 5 archivos. Cada archivo tiene DOS secciones separadas por un divisor `---`: la parte de identidad (texto escrito) y la parte de TTS (audio hablado).

**Crear:** `instance/prompts/accents/en-US.md`
```markdown
Speak with a standard American English accent (General American, Midwest neutral). Clear pronunciation, rhotic 'r' (pronounce all r's). Natural contractions: "gonna", "wanna", "gotta", "y'all" (informal). Fillers: "like", "you know", "I mean", "basically", "so", "right?". Expressions: "awesome", "cool", "sounds good", "for sure", "no worries", "gotcha" (=got you), "my bad" (=sorry), "heads up" (=warning). Warm and professional tone. Moderate pace with slight upward inflection on questions.
```

**Crear:** `instance/prompts/accents/es-MX.md`
```markdown
Habla con acento mexicano neutro (zona centro/Ciudad de Mexico). Entonacion melodica y amable. Tuteo natural. Pronuncia las 's' claramente. Las 'd' intervocalicas se suavizan en habla casual ("cansado" suena mas como "cansao"). Muletillas: "o sea", "bueno pues", "este...", "no?", "fijate que", "mira". Expresiones: "orale" (=genial/OK), "que onda" (=que tal), "padre/padrisimo" (=genial), "chido", "neta" (=verdad), "a poco" (=en serio?), "sale" (=OK). Tono calido y cercano, ritmo moderado.
```

**Crear:** `instance/prompts/accents/es-CO.md`
```markdown
Habla con acento colombiano (Bogota/zona andina). Entonacion suave y melodica. Usa "usted" en contextos formales o con desconocidos, tuteo con confianza. Pronunciacion clara y pausada, todas las letras se articulan. Muletillas: "pues" (al final: "si pues", "bueno pues"), "o sea", "digamos", "listo?". Expresiones: "con mucho gusto" (respuesta a gracias), "a la orden", "parce/parcero" (=amigo informal), "bacano/chevere" (=genial), "berraco" (=impresionante o dificil), "de una" (=de inmediato). NUNCA uses "que pena" ni variantes — suena insegura; usa "disculpa" o "perdona" en su lugar. Tono muy amable y servicial, ritmo moderado-pausado.
```

**Crear:** `instance/prompts/accents/es-EC.md`
```markdown
Habla con acento ecuatoriano (Sierra/Quito). Entonacion pausada y melodica con influencia quichua. Pronuncia todas las letras claramente, especialmente las 's'. Usa "usted" mas que tuteo, incluso entre amigos. Muletillas: "pues" (al final: "si pues"), "ve" (llamar atencion: "ve, escucha"), "no cierto?", "verás". Expresiones: "que fue" (=que tal, saludo informal), "ahi nos vemos" (=nos vemos), "chuta" (=sorpresa), "de ley" (=seguro/obligatorio), "bacán" (=genial), "achachay" (=que frio), "arrarray" (=que calor), "mande" (=digame?). Tono amable y respetuoso, ritmo moderado-pausado.
```

**Crear:** `instance/prompts/accents/es-PE.md`
```markdown
Habla con acento peruano (Lima). Entonacion clara y neutra, sin melodia marcada. Tuteo en Lima, "usted" en sierra. Pronunciacion limpia de todas las consonantes. Muletillas: "pe" (al final: "ya pe", "claro pe", "no pe"), "pues", "oe" (llamar atencion), "manyas?" (=entiendes?). Expresiones: "chevere" (=genial), "causa" (=amigo), "al toque" (=rapido), "jato" (=casa), "pituco" (=elegante/fresa), "misio" (=sin dinero), "yapa" (=extra gratis). Tono respetuoso y amable, ritmo moderado.
```

### Paso 2: Modificar `src/modules/prompts/manifest.ts`

#### 2a: Eliminar `ACCENT_TRAIT_PROMPTS` completo (líneas ~418-490)
Borrar todo el objeto `const ACCENT_TRAIT_PROMPTS: Record<string, string> = { ... }` (~70 líneas).

#### 2b: Reescribir `generateAccentPrompt()` (línea ~547)
En lugar de buscar en el diccionario hardcoded, cargar el `.md` del acento.

**Después:**
```typescript
async function generateAccentPrompt(registry: Registry): Promise<void> {
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()
  const accent = await configStore.get(db, 'AGENT_ACCENT').catch(() => '')

  if (!accent) {
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', '', false).catch(() => {})
    return
  }

  // Load trait from .md file
  const promptsSvc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  // Use a helper or direct file read from instance/prompts/accents/{accent}.md
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const accentPath = join(process.cwd(), 'instance', 'prompts', 'accents', `${accent}.md`)
  let traitPrompt = ''
  try {
    traitPrompt = (await readFile(accentPath, 'utf-8')).trim()
  } catch {
    logger.warn({ accent, path: accentPath }, 'Accent .md file not found')
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', '', false).catch(() => {})
    return
  }

  await configStore.set(db, 'AGENT_ACCENT_PROMPT', buildIdentityAccentPrompt(accent, traitPrompt), false).catch(() => {})
  await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', buildTtsAccentPrompt(accent, traitPrompt), false).catch(() => {})
  logger.info({ accent }, 'Accent prompt loaded from .md file')
}
```

#### 2c: Mantener `buildIdentityAccentPrompt()` y `buildTtsAccentPrompt()` intactos
Estas funciones son lógica pura que envuelven el trait con instrucciones de scope (idioma, escritura vs audio, dirección). Se quedan en código. Solo cambia la fuente del `traitPrompt`: de diccionario hardcoded a archivo `.md`.

### Paso 3: Actualizar ACCENT_MAP en console

**Archivo:** `src/modules/console/templates-section-agent.ts`

#### 3a: Actualizar `ACCENT_MAP` (líneas ~656-669)

**Antes:**
```typescript
const ACCENT_MAP: Record<string, Array<{ code: string; country: string }>> = {
  es: [
    { code: 'es-CL', country: 'Chile' },
    { code: 'es-CO', country: 'Colombia' },
    { code: 'es-CAR', country: isEs ? 'Caribe' : 'Caribbean' },
    { code: 'es-EC', country: 'Ecuador' },
    { code: 'es-MX', country: isEs ? 'Mexico' : 'Mexico' },
    { code: 'es-PE', country: isEs ? 'Peru' : 'Peru' },
  ],
  en: [
    { code: 'en-CAR', country: isEs ? 'Caribe' : 'Caribbean' },
    { code: 'en-US', country: isEs ? 'Estados Unidos' : 'United States' },
  ],
}
```

**Después:**
```typescript
const ACCENT_MAP: Record<string, Array<{ code: string; country: string }>> = {
  es: [
    { code: 'es-MX', country: isEs ? 'México' : 'Mexico' },
    { code: 'es-CO', country: 'Colombia' },
    { code: 'es-EC', country: 'Ecuador' },
    { code: 'es-PE', country: isEs ? 'Perú' : 'Peru' },
  ],
  en: [
    { code: 'en-US', country: isEs ? 'Estados Unidos (Neutro)' : 'United States (Neutral)' },
  ],
}
```

#### 3b: Actualizar `CODE_TZ` (líneas ~817-826)

**Después:**
```javascript
var CODE_TZ = {
  'es-MX':'America/Mexico_City',
  'es-CO':'America/Bogota',
  'es-EC':'America/Guayaquil',
  'es-PE':'America/Lima',
  'en-US':'America/New_York'
};
```

### Paso 4: Eliminar `src/engine/prompts/accent.ts`

Este archivo es un no-op legacy:
```typescript
export async function buildAccentSection(registry: Registry): Promise<string> {
  void registry
  return ''
}
```

**Eliminar** el archivo completo.

**Buscar y eliminar imports:**
```bash
grep -rn "accent" src/engine/prompts/ --include="*.ts"
grep -rn "buildAccentSection" src/ --include="*.ts"
```

Si `buildAccentSection` se importa en algún lado (probablemente `agentic.ts`), eliminar el import y cualquier llamada.

### Paso 5: Limpiar el campo `AGENT_ACCENT` en `src/modules/prompts/manifest.ts`

El campo `AGENT_ACCENT` está definido como `type: 'text'` (línea ~236-244) con una nota diciendo que se gestiona desde la Identity page. Verificar que esto siga correcto — el select real vive en `templates-section-agent.ts`. El campo en prompts es solo almacenamiento.

**No cambiar** el tipo del campo en manifest.ts — es storage, no UI. La UI viene del select en templates-section-agent.ts.

---

## Verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Verificar que no quedan referencias a acentos eliminados:
```bash
grep -rn "es-CL\|es-CAR\|es-AR\|es-VE\|es-ES\|es-BO\|es-CR\|es-CU\|es-DO\|es-SV\|es-GT\|es-HN\|es-NI\|es-PA\|es-PY\|es-PR\|es-UY\|es-GQ\|en-CAR\|en-GB\|en-AU\|en-CA\|en-IN\|en-IE\|en-JM\|en-TT\|en-KE\|en-NZ\|en-NG\|en-PH\|en-SG\|en-ZA\|en-GH\|pt-BR\|pt-PT\|pt-AO\|pt-MZ\|pt-CV\|fr-FR\|fr-CA\|fr-BE\|fr-CH\|fr-SN\|fr-CM\|fr-CD\|fr-CI\|fr-HT\|de-DE\|de-AT\|de-CH\|de-LI\|de-LU\|it-IT\|it-CH\|it-SM" src/ --include="*.ts"
```

Verificar que los 5 `.md` existen:
```bash
ls instance/prompts/accents/
```

## Riesgo
Medio. Toca UI (console), lógica de generación de acentos, y eliminación de archivo. Pero no cambia el flujo: los builders `buildIdentityAccentPrompt` y `buildTtsAccentPrompt` siguen igual, solo cambia la fuente del trait de diccionario a archivo.

## Archivos tocados
| Archivo | Cambio |
|---------|--------|
| `instance/prompts/accents/en-US.md` | **Crear** |
| `instance/prompts/accents/es-MX.md` | **Crear** |
| `instance/prompts/accents/es-CO.md` | **Crear** |
| `instance/prompts/accents/es-EC.md` | **Crear** |
| `instance/prompts/accents/es-PE.md` | **Crear** |
| `src/modules/prompts/manifest.ts` | Eliminar ~70 líneas de ACCENT_TRAIT_PROMPTS, reescribir generateAccentPrompt() |
| `src/modules/console/templates-section-agent.ts` | Actualizar ACCENT_MAP (8→5 entries) y CODE_TZ (8→5 entries) |
| `src/engine/prompts/accent.ts` | **Eliminar** archivo completo |
