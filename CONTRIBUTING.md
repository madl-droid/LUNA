# Contribuir a LUNA

Guía para desarrolladores que quieran contribuir al proyecto.

## Requisitos previos

- Node.js >= 22
- Docker (para PostgreSQL y Redis en desarrollo)
- Git
- Una API key de Anthropic o Google AI

## Setup de desarrollo

```bash
# 1. Clonar el repo
git clone https://github.com/madl-droid/luna.git
cd luna

# 2. Instalar dependencias
npm install

# 3. Levantar servicios con Docker
docker compose -f docker-compose.dev.yml up -d

# 4. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus API keys y credenciales

# 5. Iniciar en modo desarrollo (hot-reload)
npm run dev
```

En el primer arranque se ejecuta el **wizard de instalación** en `http://localhost:3000/setup`.

## Estructura de branches

| Rama | Propósito |
|------|-----------|
| `main` | Producción (auto-deploy) |
| `pruebas` | Staging (auto-deploy) |
| `feat/sXX-nombre` | Feature branches por sesión |

Nunca hacer push directo a `main`. Trabajar en feature branches y hacer merge via PR.

## Compilar y verificar

```bash
# Compilar TypeScript (obligatorio antes de push)
npx tsc --noEmit

# Ejecutar tests
npm test

# Linter
npm run lint
```

**Regla obligatoria**: el proyecto debe compilar sin errores antes de cada push. Los errores de TypeScript bloquean el CI y el deploy.

## Convenciones de código

### Naming

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Archivos y carpetas | `kebab-case` | `lead-scoring`, `baileys-adapter.ts` |
| Variables y funciones | `camelCase` | `getLeadScore`, `sessionTtl` |
| Clases, types, interfaces | `PascalCase` | `ModuleManifest`, `LeadStatus` |
| Constantes globales | `UPPER_SNAKE_CASE` | `MAX_RETRIES`, `DEFAULT_TTL` |

### Imports

- Siempre incluir extensión `.js` en imports relativos (requisito ESM)
- Types del kernel: `import type { ModuleManifest } from '../../kernel/types.js'`
- Types de otros módulos: `import type { StoredMessage } from '../memory/types.js'`

### Acceso a arrays

`noUncheckedIndexedAccess` está activo. `arr[0]` es `T | undefined`:
```typescript
// Con guard previo:
if (arr.length > 0) return arr[0]!
// Sin guard:
const first = arr[0]?.prop
```

### Lo que NO hacer

- No usar ORM (raw SQL con `$1`, `$2`)
- No agregar Express ni Fastify (HTTP nativo de Node)
- No importar entre módulos directamente (usar hooks/services del Registry)
- No leer `process.env` fuera de `kernel/config.ts` (usar `registry.getConfig()`)
- No instalar `@google/generative-ai` (deprecado, usar `@google/genai`)
- No crear SPA para console (usar SSR con templates server-side)

## Cómo crear un módulo

Referencia completa: [`docs/architecture/module-system.md`](docs/architecture/module-system.md)

Resumen:

1. Crear directorio `src/modules/{nombre}/`
2. Crear `manifest.ts` exportando `ModuleManifest`:
   ```typescript
   import type { ModuleManifest } from '../../kernel/types.js'
   
   export const manifest: ModuleManifest = {
     name: 'mi-modulo',
     version: '1.0.0',
     description: 'Descripción corta',
     type: 'feature',  // core-module | channel | feature | provider
     depends: [],
     configSchema: z.object({ /* ... */ }),
     init: async (registry) => { /* ... */ },
     stop: async () => { /* ... */ },
   }
   ```
3. Usar helpers del kernel (no redefinir):
   - HTTP: `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`
   - Config: `numEnv`, `boolEnv`, `floatEnv` de `kernel/config-helpers.js`
4. Crear `CLAUDE.md` en el directorio del módulo
5. Si es un canal: crear skill de outreach en `instance/prompts/system/skills/`

## Comunicación entre módulos

Los módulos nunca se importan entre sí. Usan:

- **Hooks** — Eventos tipados (pub/sub via Registry)
- **Services** — Funciones registradas en el Registry (`registry.provide()` / `registry.get()`)

```typescript
// Publicar un hook
registry.emit('message:incoming', { channel: 'whatsapp', text: '...' })

// Escuchar un hook
registry.addHook('mi-modulo', 'message:incoming', async (payload) => { /* ... */ })

// Proveer un servicio
registry.provide('mi-modulo:buscar', miFuncion)

// Consumir un servicio
const buscar = registry.get<typeof miFuncion>('mi-modulo:buscar')
```

## Migraciones SQL

Las migraciones viven en `src/migrations/` y se ejecutan automáticamente al arrancar.

Para agregar una nueva:

1. Crear `src/migrations/{NNN}_{nombre}.sql` (siguiente número secuencial)
2. Usar `IF NOT EXISTS` / `IF EXISTS` para idempotencia
3. El migrador detecta y aplica automáticamente en el siguiente arranque

Si una migración falla: rollback automático. Corregir el SQL, borrar la entrada de `schema_migrations` si quedó parcial, y reiniciar.

## Tests

```bash
npm test              # Ejecutar todos los tests
npm run test:watch    # Modo watch
```

Tests usan [vitest](https://vitest.dev/). Archivos de test junto al código fuente con sufijo `.test.ts`.

## Commits

Usar [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(modulo): descripción corta del cambio
fix(engine): corregir pipeline cuando X
docs: actualizar README
refactor(memory): simplificar compresión de sesiones
```

## Pull Requests

- Título corto (< 70 caracteres)
- Descripción con: qué cambia, por qué, y cómo probar
- El CI debe pasar (TypeScript compila, tests pasan)
- Usar el template de PR proporcionado
