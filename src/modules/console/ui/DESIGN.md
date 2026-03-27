# Design System: Crystal Light & Tonal Depth

## 1. North Star
Apple Human Interface Guidelines adapted for web+mobile. Clean, airy, editorial. No visual noise. Depth through tonal layering, not borders or shadows.

---

## 2. Color Palette (Fox Logo)

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#FF5E0E` | CTAs, active states, brand accents, sidebar active pill |
| `--primary-hover` | `#e85400` | Hover on primary buttons |
| `--primary-light` | `rgba(255,94,14,0.08)` | Light tint backgrounds (badges, unread items) |
| `--primary-medium` | `rgba(255,94,14,0.15)` | Hover on tinted backgrounds |
| `--secondary` | `#FFB800` | Gold highlights, brand icon gradient |
| `--tertiary` / `--error` | `#E62111` | Destructive actions, errors, alerts |
| `--success` | `#34c759` | Connected, healthy, apply button |
| `--warning` | `#ff9500` | Warnings, intermediate states |
| `--info` | `#007aff` | Links, informational |

### Surface Hierarchy (Tonal Foundation)
| Token | Value | Usage |
|-------|-------|-------|
| `--surface` | `#e2e2e6` | Page background |
| `--surface-container-lowest` | `#fafafc` | Cards, sidebar, header, elevated panels |
| `--surface-container-low` | `#f0f0f4` | Input fills, nested areas, search bar |
| `--surface-container-high` | `#d4d4da` | Hover states, secondary buttons, avatar bg |
| `--surface-container-highest` | `#e0e0e4` | Strong contrast areas |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `--on-surface` | `#1A1A1A` | Primary text, headings, save bar bg, dark table headers |
| `--on-surface-variant` | `#6e6e73` | Secondary text, labels, descriptions |
| `--on-surface-dim` | `#86868b` | Placeholders, captions, muted icons, filter labels |

---

## 3. Core Rules

### The No-Line Rule
**No 1px solid borders for sectioning.** Boundaries are defined exclusively through tonal background shifts. A card is `surface-container-lowest` on a `surface` page. A sidebar is `surface-container-lowest` against `surface` content.

### Ghost Borders
If a border is absolutely required for accessibility: `rgba(0,0,0,0.06)` only.

### Shadows — Subtle Only
- `--shadow-subtle: 0 1px 4px rgba(0,0,0,0.05)` — hover on cards
- `--shadow-float: 0 4px 16px rgba(0,0,0,0.08)` — modals, drawers, dropdowns
- **Never** use aggressive/large shadows on hover

### Glassmorphism
Floating menus and nav use: `backdrop-filter: blur(20px) saturate(180%)` + `rgba(255,255,255,0.75)`.

---

## 4. Typography
- **Font:** Montserrat (Google Fonts), weights 400/500/600/700
- **Body:** 0.875rem (14px)
- **Section titles:** 1.65rem, weight 700, letter-spacing -0.02em
- **Group titles:** 11px, weight 700, uppercase, 0.08em tracking
- **Monospace:** SF Mono, Fira Code (inputs, code, IDs, counters)
- **Anti-aliasing:** `-webkit-font-smoothing: antialiased`

---

## 5. Layout

### Header (single row)
Left: Brand icon (dark bg, robot SVG) + L.U.N.A + "Console v{version}"
Center: Search bar
Right: Notification bell (dropdown) → Language (SVG flags dropdown) → Status dot (tooltip) → User avatar (dropdown with test mode + logout)

### Sidebar (1/5 viewport)
- Width: `calc(100vw / 5)`, min 230px, max 280px
- Background: `surface-container-lowest`
- Group titles: muted gray (`--on-surface-dim`), uppercase
- Items: 15px text, 20px SVG monochrome icons (gray, inherit color)
- Active item: **filled orange pill** (`--primary` bg, white text, orange shadow `0 2px 8px rgba(255,94,14,0.25)`)
- **Submenu:** Collapsible under parent items (Canales, Contactos). Shows sub-items with smaller icons, badge counts (grey `badge-soon`), status dots.
- Mobile: off-canvas drawer, max 85vw

### Section Header (standardized across all tabs)
- **Breadcrumb:** `Consola > Section` (2 levels) or `Consola > Section > Subpage` (3 levels). Light grey text, `>` separator.
- **Title:** 1.65rem, weight 700. Same size across all tabs.
- **Description:** 0.875rem, `--on-surface-variant`, line-height 1.55. Clamped to 2 lines (`-webkit-line-clamp: 2`). Target 80-200 chars to always fill 2 lines.
- **Filter bar** (optional): Appears below description when the section has filterable content. Dashed border, same style everywhere.

### Content Area
- Padding: 28px 36px, max-width 860px
- Bottom padding 100px (clearance for save bar)

---

## 6. Components

### Unified Action Buttons (`act-btn`)
All action buttons across channels AND contacts share the same system. Same height, pill shape, icon+text.

| Variant | Class | Background | Color | Usage |
|---------|-------|-----------|-------|-------|
| **Add/Connect** | `act-btn-add` | `rgba(52,199,89,0.12)` | `#1a8f3a` | Add user, connect channel |
| **Remove/Disconnect** | `act-btn-remove` | `rgba(230,33,17,0.08)` | `var(--error)` | Deactivate, disconnect, delete |
| **Configure** | `act-btn-config` | `var(--surface-container-high)` | `var(--on-surface-variant)` | Settings, cancel, pagination |
| **CTA** | `act-btn-cta` | `var(--primary)` | `#fff` | Save in modals, primary actions |

Base: `font-size: 12px; font-weight: 600; padding: 7px 16px; border-radius: 1.5rem;`

### Secondary Button
`btn-secondary`: Neutral background (`surface-container-high`), no border, 0.5rem radius. For inline secondary actions.

### Cards / Panels
- `surface-container-lowest` bg, radius 0.5rem
- No border, no static shadow
- `--shadow-subtle` on hover only
- **Panel body padding:** `16px 20px 20px` (standardized with channel settings)

### Input Fields
- `surface-container-low` fill, no border, radius 0.5rem
- Focus: `box-shadow: 0 0 0 3px var(--primary-light)`
- Modified: `box-shadow: 0 0 0 2px rgba(255,149,0,0.3)`

### Toggles (switches)
- iOS style, 51x31px
- **Apply immediately** via POST to `/console/apply` with `X-Instant-Toggle` header
- If dirty text fields exist when toggling, show confirm dialog

### Icons
- All sidebar/UI icons: **SVG monochrome**, stroke-based, inherit `currentColor`
- No colored emoji icons — override with SVG in `ICON_OVERRIDES` map
- Stroke-width 1.8, 20x20px in sidebar, 16-18px in header, 14px in contact badges, 16px in action buttons

### Info Tooltips (`(i)` button)
- Dark bubble hover tooltip (same style everywhere: fields AND channel cards)
- Structure: `<span class="info-wrap"><button class="info-btn">i</button><div class="info-tooltip">text</div></span>`
- Button: 16x16px circle, serif italic "i", `--surface-container-high` bg
- Tooltip: absolute positioned above, dark bg (`--on-surface`), white text, 11px, arrow pointing down
- Shows on hover (CSS only, no JS)
- Fields use `info` or `description` property in manifest — both work via `infoBtnWithTip()`

### Dropdowns (Custom Select)
- Any `<select class="js-custom-select">` auto-converts to styled dropdown
- `surface-container-lowest` bg, `--shadow-float`, radius 0.5rem
- Animate in with opacity + translateY
- Close on outside click or Escape key
- `initCustomSelects()` exposed globally — call after dynamic content load

### Toasts
- Fixed top-right, `max-width: calc(100vw - 24px)`
- Auto-dismiss 3.5s, slide-in animation

### Wizard Modal (connection wizard, user edit/add)
- Overlay: fixed, dark backdrop with blur (`wizard-overlay`)
- Modal: white bg, 0.75rem radius, 560px max-width, shadow (`wizard-modal`)
- Close button top-right (`wizard-close`)
- Content area: 24px 28px padding (`wizard-steps`)
- Title: centered, 1.15rem bold (`wizard-title`)
- Labels: `wizard-label` — 0.8rem bold, above input
- Inputs: `wizard-input` — full width, 1.5px border, 6px radius, focus = orange border
- Error: `wizard-error` — red bg tint, red text, 6px radius
- Field errors: `wizard-field-error` — red text under input, shown when input has `.invalid` class
- Footer: flex right-aligned, Cancel (config style) + Save (CTA style)

---

## 7. Data Tables (standardized template)

All contact/user tables use the same template across all list types.

### Structure
```
<table class="users-table">
  <thead><tr class="users-table-head">  ← dark bg, white text, rounded top corners
    <th>☐</th>  ← select-all checkbox
    <th>ID</th>
    <th>Nombre</th>
    <th>Datos de contacto</th>
    <th>Fuente</th>
    <th>Estado</th>
  </tr></thead>
  <tbody>
    <tr data-user-id="..." data-user-name="..." data-contacts="{json}" ...>
      <td>☐</td>  ← per-row checkbox
      <td><code>USR-XXXXX</code></td>
      <td>Name</td>
      <td><contact badges></td>
      <td><source badge></td>
      <td><status></td>
    </tr>
  </tbody>
</table>
```

### Header Row
- Background: `--on-surface` (dark), white text
- Top corners rounded: 0.5rem
- Select-all checkbox: centered, 36px wide column

### Contact Badges
- `user-contact-badge`: inline-flex, 4px 10px padding, 0.5rem radius, `--surface-container-low` bg
- SVG channel icon (14px) + sender ID text (11px)
- Truncated at 22 chars with ellipsis

### Source Badge
- `user-source-badge`: 10px text, `--surface-container-high` bg, 0.5rem radius

### Status Column
- Active: monospace placeholder `—` (future: last interaction timestamp `hh:mm dd/mm/aa`)
- Inactive: red "Desactivado" text + green "Reactivar" mini-button

### Deactivated Rows
- `opacity: 0.5`, hover `opacity: 0.75`
- Tracked via `data-user-active="false"` attribute

### Footer Row
- Left: Add button (`act-btn-add`) — hidden for agent-managed lists (leads)
- Right: Selection action bar (visible when checkboxes checked)
  - Edit (`act-btn-config`) — shown only when exactly 1 selected
  - Deactivate (`act-btn-remove`)
  - Delete (`act-btn-remove`) — only for custom lists, only if user is deactivated
- Selection bar uses `visibility: hidden/visible` (not display) to prevent layout shift

---

## 8. Filter Bar

Dashed border container, same style across Canales and Contactos.

### Structure
```
<div class="filter-bar">
  <div class="filter-group"><span class="filter-label">LABEL</span> <select class="js-custom-select">...</select></div>
  ...
  <div class="user-filter-search"><svg>🔍</svg><input placeholder="Buscar contacto"></div>
</div>
```

### Contacts Filters
| Filter | Type | Options |
|--------|------|---------|
| Nombre | Single select | A→Z, Z→A |
| Canal | **Multi-select** (checkboxes in dropdown) | All channels, select any combination |
| Fuente | Single select | Todos, Manual, Automatico |
| Ultima interaccion | Single select | Todos, 1h, 12h, 24h, 7d, 30d, 90d |

### Search Bar
- Styled to match filter dropdowns: white bg, subtle border, 0.5rem radius, focus = orange shadow
- SVG search icon left-aligned inside input
- Searches across name + all contact IDs in all visible lists

### Pagination (outside panel)
- Counter: monospace, `--on-surface-variant` (e.g. "1-10 / 42")
- Per-page selector: 10 (default), 50, 100, 500
- Previous/Next buttons: `act-btn-config` style
- Located below the panel, not inside it

---

## 9. Save Bar

### Behavior (two-phase state machine)
1. **Hidden** — no changes pending
2. **Dirty** — user changed a text/select field → bar slides up:
   `⚠ Cambios sin guardar` (left) | `Descartar` + `Guardar` (right)
3. **Saved** — after Guardar succeeds via fetch (no page reload):
   `✓ Guardado correctamente` (left) | `Aplicar cambios` (right, green)
4. Aplicar → POST that hot-reloads config and redirects

### Style
- Dark background (`--on-surface`), white text
- Slide-up animation from bottom, centered, 620px wide
- `box-shadow: 0 -4px 20px rgba(0,0,0,0.15)`
- Mobile: full-width, no border-radius

### What triggers it
- Any `input`, `select`, or `textarea` with `data-original` attribute that differs from current value
- Toggles are excluded (they apply instantly)
- Permission checkboxes sync to hidden inputs with `data-original` for tracking

### Architecture rule
The console NEVER uses internal API endpoints for config/CRUD operations. The save bar flow goes through `POST /console/save` (DB + .env) then `POST /console/apply` (hot-reload). User CRUD uses dedicated form POST handlers (e.g. `/console/users/add`) that redirect with flash messages.

---

## 10. Responsive Breakpoints

| Breakpoint | Target | Key Changes |
|------------|--------|-------------|
| **768px** | Tablets | Sidebar → drawer, fields stack, search shrinks, save bar full-width |
| **480px** | Phones | User avatar hidden, brand text hidden, padding reduced, save bar wraps |

### Mobile-first rules
- Sidebar drawer: `min(280px, 85vw)` width
- Toast: `right: max(12px, 2vw)`, `max-width: calc(100vw - 24px)`
- QR images: `max-width: min(260px, 85vw)`
- Save bar: full-width on mobile, wraps label above buttons at 480px

---

## 11. Do's and Don'ts

### Do
- Use white space as structure — increase spacing, not add lines
- Use 0.5rem radius consistently for all containers
- Keep shadows barely perceptible
- Use SVG monochrome icons that inherit `currentColor`
- Use SVG flags for language selection (not emoji — they don't render in all environments)
- Use `act-btn` system for all action buttons (not ad-hoc styles)
- Use `wizard-overlay` + `wizard-modal` for all modals (not custom modal CSS)
- Use `js-custom-select` for all dropdowns (not native `<select>` styling)
- Use `data-original` for dirty tracking on config fields
- Show validation errors inline under the field (red border + message), not browser tooltips
- Standardize section headers: breadcrumb + title (1.65rem) + description (2 lines clamped)

### Don't
- Use `#000000` — use `--on-surface` (#1A1A1A)
- Use colored emoji icons in sidebar or navigation
- Use 1px solid borders for sectioning
- Use aggressive drop shadows
- Use gradients on backgrounds (only on brand icon)
- Put toggles through the save flow — they apply instantly
- Use internal API endpoints (`/console/api/`) for config or CRUD from the console UI — APIs are for external systems only
- Create custom button styles — use `act-btn-*` variants
- Create custom modal CSS — use wizard classes
- Use browser-native form validation tooltips — use `wizard-field-error` inline messages
