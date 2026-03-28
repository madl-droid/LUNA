# Console UI — Development Guide

## What it is
Static files (CSS, JS) served from `/console/static/`. HTML is generated server-side by TypeScript templates in the parent directory.

## File Structure
```
ui/
  CLAUDE.md          — this guide
  DESIGN.md          — full design system spec (Crystal Light & Tonal Depth)
  js/
    console-minimal.js — client JS: dropdowns, dirty tracking, save bar state machine,
                         toggle instant-apply, WA polling, model switch, toasts,
                         Google OAuth, notifications API, test mode
  styles/
    base.css         — CSS variables (:root), reset, typography
    layout.css       — header, search, dropdowns, save bar, responsive
    components.css   — panels, fields, toggles, badges, buttons, toasts
    sidebar.css      — sidebar nav, content area, mobile drawer
    whatsapp.css     — WhatsApp panel specifics
  assets/            — static images (mascota, logos)
```

## Architecture (SSR)
- Server generates full HTML with embedded data (templates-*.ts)
- `console-minimal.js` handles client interactivity only
- No SPA, no framework — vanilla JS

## Design System: Crystal Light & Tonal Depth
Full spec in `DESIGN.md`. Key principles:

### Colors
- **Primary:** `#FF5E0E` (Fox orange) — CTAs, active states
- **Secondary:** `#FFB800` (gold) — brand icon gradient
- **Tertiary:** `#E62111` (crimson) — errors, destructive
- **Neutral:** `#E1E1E1` — base surface

### Core Rules
- **No borders for sectioning** — use tonal background shifts only
- **Subtle shadows only** — `0 1px 4px rgba(0,0,0,0.05)` on hover
- **SVG monochrome icons** — all icons are stroke-based SVGs that inherit `currentColor`. Override module emoji icons via `ICON_OVERRIDES` map in `templates.ts`
- **SVG flags** for language selection — emoji flags don't render reliably

### Icons System
Fixed sections and dynamic modules both use monochrome SVG icons:
- `templates.ts` defines `ICONS` object with SVG helper
- `ICON_OVERRIDES` map overrides emoji icons from module manifests
- Icons use `stroke="currentColor"` and `stroke-width="1.8"`
- In sidebar: 20x20px; in header: 16-18px

## Save Bar (Two-Phase State Machine)
1. **Hidden** — no pending changes
2. **Dirty** — text/select field changed → dark bar slides up with "Descartar" + "Guardar"
3. **Saved** — after fetch-based save (no reload) → bar shows "Aplicar cambios" (green)
4. **Applied** — POST hot-reload + redirect

### Key behaviors
- `Guardar` saves via fetch without page reload, then transitions to phase 2
- `Aplicar cambios` does a normal POST that hot-reloads config
- Toggles bypass save bar entirely — they apply instantly via fetch
- If toggle is clicked with dirty fields → confirm dialog warns about unsaved changes

## Header Structure
Single row: Brand | Search | Notifications + Language + Status + User

### Dropdowns
- Any `[data-dropdown="<id>"]` button toggles panel with matching id
- Close on outside click or Escape
- Notification panel: populated via `window.lunaNotifications.add({title, text, type})`
- Language: SVG flag icons, 4 languages (ES/EN/PT/FR)
- User menu: test mode toggle (with confirm) + reset DB (only in test mode) + logout

### Status Dot
CSS classes for JS to set: default (green), `.warning`, `.error`, `.offline`
Tooltip shown on hover via CSS (`.header-status-tooltip`)

## Responsive Breakpoints
| Breakpoint | Changes |
|------------|---------|
| 768px | Sidebar → off-canvas drawer (max 85vw), fields stack, save bar full-width |
| 480px | Brand text hidden, user hidden, save bar wraps, reduced padding |

## Conventions
- CSS: kebab-case classes (`.panel-header`, `.save-bar-phase`)
- CSS variables: `--category-name` (`--primary`, `--on-surface-variant`)
- HTML IDs: kebab-case (`btn-save`, `notif-dot`)
- All colors via CSS variables — never hardcode hex in components
- Border-radius: `0.5rem` for containers, `0.75rem` for elevated cards/modals, `1.5rem` for pill buttons
- Transitions: `0.15s ease` for hover, `0.3s cubic-bezier` for slide animations

## REGLA: Reutilizar clases y variables del design system

**OBLIGATORIO para todo módulo que renderice HTML en la consola.**

### Variables CSS — usar SOLO las de `base.css :root`
- Colores: `--primary`, `--primary-hover`, `--primary-light`, `--primary-medium`, `--primary-focus`
- Superficies: `--surface`, `--surface-container-lowest/low/high/highest`
- Texto: `--on-surface`, `--on-surface-variant`, `--on-surface-dim`
- Semánticos: `--success`, `--warning`, `--error`, `--info`
- Bordes: `--outline-variant`
- Sombras: `--shadow-subtle`, `--shadow-float`
- **NO inventar variables** (`--my-bg`, `--accent`, `--border`) — si falta algo, agregarlo a `base.css`

### Clases CSS — reutilizar antes de crear
- **Paneles**: `.panel`, `.panel-header`, `.panel-body`, `.panel-title`
- **Campos**: `.field`, `.field-label`, `.field input/select`
- **Toggles**: `.toggle`, `.toggle-sm` (iOS style, active = `--success`)
- **Botones**: `.act-btn-add/remove/config/cta`, `.btn-secondary`
- **Tablas**: `.users-table`, `.users-table-head`
- **Filtros**: `.filter-bar`, `.filter-group`, `.filter-label`
- **Dropdowns**: `.custom-select`, `.custom-select-btn/panel/option`
- **Badges**: `.panel-badge`, `.badge-active`, `.badge-soon`
- **Tooltips**: `.info-btn`, `.info-tooltip`
- **Modals**: `.wizard-overlay`, `.wizard-modal`, `.wizard-input`, `.wizard-btn-*`
- **Tabs**: `.chs-tabs`, `.chs-tab`
- **Focus ring**: `box-shadow: 0 0 0 3px var(--primary-focus)` — SIEMPRE igual

### Inline styles — prohibidos para CSS presentacional
- **NO**: `style="display:flex;gap:12px;background:var(--surface-container-lowest);border-radius:0.5rem;padding:14px"`
- **SÍ**: Crear clase en `components.css` o en un `<style>` scoped con prefijo del módulo
- **Excepción**: `style="display:none"` para JS toggles y `style="width:${pct}%"` para valores dinámicos

### Prefijos de módulo para clases scoped
Si un módulo necesita clases propias, usar prefijo corto: `ls-` (lead-scoring), `ki-` (knowledge), `st-` (scheduled-tasks), `ts-` (templates-sections), `freight-`, `fd-` (freshdesk)

## How static files are served
- `server.ts` maps `/console/static/*` to `ui/` (dev) or `dist/console/` (prod)
- `Cache-Control: no-cache, no-store, must-revalidate` — changes reflect on reload
- MIME types: .css, .js, .png, .jpg, .gif, .svg, .ico, .webp

## Traps
- `dist/console/` is checked first — if old build exists, it serves stale files
- Toggles send immediate fetch POST — don't add them to dirty tracking
- `data-original` attributes drive dirty tracking — templates MUST include them
- `ICON_OVERRIDES` in templates.ts must be updated when adding new modules
- SVG flags are inline in templates.ts — emoji flags don't work (Alpine Linux + some browsers)
