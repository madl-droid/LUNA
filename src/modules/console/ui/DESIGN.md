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
| `--surface` | `#f5f5f7` | Page background |
| `--surface-container-lowest` | `#ffffff` | Cards, sidebar, header, elevated panels |
| `--surface-container-low` | `#f0f0f2` | Input fills, nested areas, search bar |
| `--surface-container-high` | `#eaeaec` | Hover states, secondary buttons, avatar bg |
| `--surface-container-highest` | `#e0e0e2` | Strong contrast areas |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `--on-surface` | `#2d2d2d` | Primary text, headings, save bar bg |
| `--on-surface-variant` | `#6e6e73` | Secondary text, labels, descriptions |
| `--on-surface-dim` | `#86868b` | Placeholders, captions, muted icons |

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
- **Headings:** 1.5rem, weight 700, letter-spacing -0.02em
- **Group titles:** 11px, weight 700, uppercase, 0.08em tracking
- **Monospace:** SF Mono, Fira Code (inputs, code)
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
- Mobile: off-canvas drawer, max 85vw

### Content Area
- Padding: 28px 36px, max-width 860px
- Bottom padding 100px (clearance for save bar)

---

## 6. Components

### Buttons
- **Primary (CTA):** `--primary` solid, white text, rounded 1.5rem
- **Secondary:** `surface-container-high`, no border
- **Destructive:** `--error` color text, transparent bg
- **Save bar Aplicar:** `--success` bg, white text

### Cards / Panels
- `surface-container-lowest` bg, radius 0.5rem
- No border, no static shadow
- `--shadow-subtle` on hover only

### Input Fields
- `surface-container-low` fill, no border, radius 0.5rem
- Focus: `box-shadow: 0 0 0 3px var(--primary-light)`
- Modified: `box-shadow: 0 0 0 2px rgba(255,149,0,0.3)`

### Toggles (switches)
- iOS style, 51x31px
- **Apply immediately** via fetch — do NOT go through save flow
- If dirty text fields exist when toggling, show confirm dialog

### Icons
- All sidebar/UI icons: **SVG monochrome**, stroke-based, inherit `currentColor`
- No colored emoji icons — override with SVG in `ICON_OVERRIDES` map
- Stroke-width 1.8, 20x20px in sidebar, 16-18px in header

### Dropdowns
- `surface-container-lowest` bg, `--shadow-float`, radius 0.5rem
- Animate in with opacity + translateY
- Close on outside click or Escape key

### Toasts
- Fixed top-right, `max-width: calc(100vw - 24px)`
- Auto-dismiss 3.5s, slide-in animation

---

## 7. Save Bar

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

---

## 8. Responsive Breakpoints

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

## 9. Do's and Don'ts

### Do
- Use white space as structure — increase spacing, not add lines
- Use 0.5rem radius consistently for all containers
- Keep shadows barely perceptible
- Use SVG monochrome icons that inherit `currentColor`
- Use SVG flags for language selection (not emoji — they don't render in all environments)

### Don't
- Use `#000000` — use `--on-surface` (#2d2d2d)
- Use colored emoji icons in sidebar or navigation
- Use 1px solid borders for sectioning
- Use aggressive drop shadows
- Use gradients on backgrounds (only on brand icon)
- Put toggles through the save flow — they apply instantly
