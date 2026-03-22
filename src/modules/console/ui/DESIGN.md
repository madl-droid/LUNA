# Design System: Crystal Light & Tonal Depth

## 1. Overview
Inspired by Apple's Human Interface Guidelines. Clean, airy, tonal layering for depth. No rigid borders — boundaries defined through background shifts. Fox-orange as brand soul.

---

## 2. Colors

### Brand Palette (from Fox logo)
*   **Primary:** `#FF5E0E` — CTAs, active states, brand accents
*   **Secondary:** `#FFB800` — gold highlights, decorative gradients
*   **Tertiary:** `#E62111` — destructive actions, error states
*   **Neutral:** `#F5F5F7` — base surface background

### Surface Hierarchy
*   `surface` (`#f5f5f7`) — page background
*   `surface-container-lowest` (`#ffffff`) — cards, sidebar, elevated panels
*   `surface-container-low` (`#f0f0f2`) — input fills, nested areas
*   `surface-container-high` (`#eaeaec`) — hover states, secondary buttons
*   `surface-container-highest` (`#e0e0e2`) — strong contrast areas

### Text
*   `on-surface` (`#2d2d2d`) — primary text, headings
*   `on-surface-variant` (`#6e6e73`) — secondary text, labels
*   `on-surface-dim` (`#86868b`) — placeholders, captions

### Usage Rules
*   **Active sidebar item:** Filled `--primary` background, white text, left orange border
*   **CTA buttons:** Solid `--primary` background, white text, rounded 1.5rem
*   **Highlight cards:** Full `--primary` background with white content
*   **No-Line Rule:** No 1px borders for sectioning — use tonal background shifts
*   **Ghost Border:** If needed, `rgba(0,0,0,0.06)` only

---

## 3. Typography
**Montserrat** — weights 400, 500, 600, 700. Body at 0.875rem. Headlines at 1.5rem with -0.02em tracking.

---

## 4. Shadows
Subtle only. `--shadow-subtle: 0 1px 4px rgba(0,0,0,0.05)` for hover. `--shadow-float: 0 4px 16px rgba(0,0,0,0.08)` for modals/drawers.

---

## 5. Components
*   **Buttons Primary:** `--primary` solid, rounded 1.5rem, white text
*   **Buttons Secondary:** `surface-container-high`, no border, primary-colored text
*   **Cards:** `surface-container-lowest`, radius 0.5rem, shadow on hover only
*   **Inputs:** `surface-container-low` fill, no border, primary glow on focus
*   **Sidebar Active:** Filled orange pill with white text + left border accent
*   **Fox-Pulse:** Pulsing orange ring for AI activity indicators

---

## 6. Do's and Don'ts
*   **Do** use white space instead of lines for separation
*   **Do** use 0.5rem radius consistently
*   **Don't** use `#000000` — use `#2d2d2d`
*   **Don't** use aggressive shadows — keep them barely perceptible
*   **Don't** use 1px solid dividers
