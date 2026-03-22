# Plan: Renombrar Oficina → Console

## Resumen
Renombrar todo lo relacionado a "oficina" por "console" en el codebase. Afecta ~60 archivos en 4 categorías: estructura de archivos, código fuente, rutas HTTP, y documentación.

## Naming convention

| Contexto | Antes | Después |
|----------|-------|---------|
| Directorio módulo | `src/modules/oficina/` | `src/modules/console/` |
| Directorio legacy | `src/oficina/` | `src/console/` |
| Propiedad manifest | `oficina: { ... }` | `console: { ... }` |
| Tipo TS | `ModuleOficinaDef` | `ModuleConsoleDef` |
| Tipo TS | `OficinaField` | `ConsoleField` |
| Tipo TS | `OficinaGroup` | `ConsoleGroup` |
| Hook names | `oficina:config_saved` | `console:config_saved` |
| Hook names | `oficina:config_applied` | `console:config_applied` |
| Rutas HTTP | `/oficina/api/...` | `/console/api/...` |
| Service name | `oficina:requestHandler` | `console:requestHandler` |
| Env var | `OFICINA_ENABLED` | `CONSOLE_ENABLED` |
| JS archivo | `oficina-minimal.js` | `console-minimal.js` |
| Función | `createOficinaHandler` | `createConsoleHandler` |
| Variable | `oficinaMod` | `consoleMod` |
| Logger name | `name: 'oficina'` | `name: 'console'` |

---

## Pasos de ejecución

### Paso 1: Tipos centrales — `src/kernel/types.ts`
- `ModuleOficinaDef` → `ModuleConsoleDef`
- `OficinaField` → `ConsoleField`
- `OficinaGroup` → `ConsoleGroup`
- Propiedad `oficina?: ModuleOficinaDef` → `console?: ModuleConsoleDef` en `ModuleManifest`
- Hooks: `'oficina:config_saved'` → `'console:config_saved'`, `'oficina:config_applied'` → `'console:config_applied'`
- Actualizar comentarios ("oficina" → "console")

### Paso 2: Kernel server — `src/kernel/server.ts`
- Variable `oficinaMod` → `consoleMod`
- Rutas `/oficina/` → `/console/`
- `getModule('oficina')` → `getModule('console')`

### Paso 3: Renombrar directorio del módulo
```bash
git mv src/modules/oficina src/modules/console
```

### Paso 4: Módulo console (archivos internos)
- `manifest.ts`: name `'oficina'` → `'console'`, service names, rutas
- `server.ts`: `createOficinaHandler` → `createConsoleHandler`, logger, rutas internas
- `templates.ts`: URLs `/oficina/` → `/console/`
- `templates-fields.ts`: `OficinaField` → `ConsoleField`
- `templates-sections.ts`: URLs `/oficina/` → `/console/`
- `templates-modules.ts`: referencias a oficina
- `templates-i18n.ts`: strings de UI si los hay
- `ui/js/oficina-minimal.js` → `ui/js/console-minimal.js` (git mv + actualizar contenido)

### Paso 5: Manifests de TODOS los otros módulos (15 módulos)
Cambiar propiedad `oficina: { title, info, fields, apiRoutes }` → `console: { ... }` en cada manifest:
- whatsapp, memory, lead-scoring, scheduled-tasks, prompts, knowledge, llm, tools, users, gmail, google-apps, google-chat, twilio-voice, model-scanner, engine

### Paso 6: Hooks consumers
- `lead-scoring/manifest.ts`: `'oficina:config_applied'` → `'console:config_applied'`
- `prompts/manifest.ts`: `'oficina:config_saved'` → `'console:config_saved'`, `'oficina:config_applied'` → `'console:config_applied'`

### Paso 7: URLs hardcoded en módulos
- `.env.example`: OAuth redirect URIs con `/oficina/api/`
- `lead-scoring/ui/lead-scoring.html`: link a oficina
- Cualquier otro módulo con URLs hardcoded

### Paso 8: Entry point — `src/index.ts`
- Referencias a 'oficina' en imports o module loading

### Paso 9: Config y deploy
- `deploy/.env.example`: `OFICINA_ENABLED` → `CONSOLE_ENABLED`
- `Dockerfile`: `dist/oficina/` → `dist/console/`
- `tsconfig.json`: path mapping si existe

### Paso 10: Directorio legacy
```bash
git mv src/oficina src/console
```

### Paso 11: Documentación (todos los CLAUDE.md + docs)
- `CLAUDE.md` (raíz)
- `src/kernel/CLAUDE.md`
- `src/modules/console/CLAUDE.md` y `ui/CLAUDE.md`, `ui/DESIGN.md`
- CLAUDE.md de cada módulo que mencione oficina
- `deploy/CLAUDE.md`
- `docs/reports/oficina-redesign-report.md` → renombrar
- `docs/reports/oficina-audit-report.md` → renombrar

### Paso 12: Migración de base de datos
- Crear migración SQL para actualizar `kernel_modules` donde `name = 'oficina'` → `'console'`
- Actualizar keys en `config_store` con prefijo oficina si existen

### Paso 13: Verificación final
- `grep -ri oficina src/` → 0 resultados relevantes
- `npx tsc --noEmit` → build exitoso
- Verificar que el módulo carga

---

## Riesgos

1. **URLs externas**: OAuth redirect URIs en Google Cloud Console y webhooks en Twilio/Google Chat apuntan a `/oficina/api/...`. Requieren actualización manual en esas plataformas.

2. **DB migration**: El nombre 'oficina' en `kernel_modules` debe actualizarse antes de deployar el código nuevo.

3. **Backwards compat**: Considerar redirects 301 temporales `/oficina/*` → `/console/*` para bookmarks e integraciones existentes.
