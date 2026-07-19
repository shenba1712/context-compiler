# Design System — Demo UI

**Status:** Current  
**Source of truth:** `public/style.css`, `public/index.html`  
**Scope:** Product design tokens for the hosted/local demo — not a multi-app component library.  
**Direction shipped:** Forest map (**H**) — D layout × A ink/forest colors.

---

## 1. Direction

Cool gray-green **paper** with **forest** accent and ink text. Brand signal is the hero wordmark (**Context Compiler**) in Fraunces; pitch is secondary. Visual metaphor: cartographic “token map” — grid wash + angled forest savings plane (Pride bars, labels outside fill).

WCAG AA contrast is a maintained constraint on text/background pairs (`--muted` / `--faint` on paper & surface).

---

## 2. Color tokens (`:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--paper` / `--bg` | `#e8ece9` | Page paper |
| `--ink` / `--text` | `#1a221e` | Primary text |
| `--surface` / `--panel` | `#f3f6f4` | Soft fill token (inputs); blocks prefer transparent |
| `--bg2` | `#dde5e0` | Recessed fills |
| `--panel2` | `#eef2ef` | Secondary panel |
| `--border` / `--border2` | `#c8d2cb` / `#a8b9af` | Borders |
| `--muted` / `--faint` | `#4a5850` / `#5c6b62` | Secondary |
| `--forest` / `--accent` | `#1f5c42` | Brand / primary actions |
| `--forest-deep` / `--accent-dark` | `#143d2c` | Hover / emphasis |
| `--accent-soft` | `#dceae3` | Soft chips / notes |
| `--green` | `= --forest` | Success / savings |
| `--waste` / `--neutral-bar` | `#9aab9f` | “Raw file” wasteful bar |
| `--compiled` | `#8fceb0` | Hero compiled bar (on dark plane) |
| `--red` / `--amber` / `--violet` | format / warning accents | Unchanged roles |
| `--shadow` | `none` | Elevation via hairlines / left accent rules |

Semantic alias: `--blue` equals accent forest (links/focus use brand color). Page background also uses a faint forest **grid** wash.

---

## 3. Typography

| Role | Family | Usage |
| --- | --- | --- |
| Display / brand / section titles | **Fraunces** (serif) | `.brand`, `h2.sec`, budget number, agent meter |
| Body / UI / pitch | **DM Sans** (sans) | `body`, `h1.title`, buttons, labels |
| Mono | **IBM Plex Mono** | Coords, plane captions, token numbers, `kbd`, `<pre>` |

Brand scale: `clamp(40px, 5.8vw, 62px)`. Pitch ~21–28px. Section titles ~24px. Body ~14–16px. Google Fonts loaded under CSP (`fonts.googleapis.com` / `fonts.gstatic.com`).

---

## 4. Spacing and layout

- Content wrap (form/results): `max-width: 1080px`, horizontal padding `20px`.
- Hero: full-bleed two-column grid (copy | forest plane); plane uses `clip-path` map cut on desktop; stacks with no clip under ~860px.
- Pipeline + keynote: slim section **below** the first viewport, above `#try` — flattened (no heavy card chrome).
- Section vertical padding ~`34px` (pipeline tighter).
- Panels: transparent on page grid; hairline top rule; radius `0` (no SaaS card chrome).
- Buttons: square corners (map instrument), not rounded pills.
- Notes / loading: left forest accent rule (same as keynote), not filled rounded banners.
- Stats: one legend row with vertical dividers (mono values/labels), not four dashboard cards.

---

## 5. Components (actual CSS classes)

| Component | Class(es) | Notes |
| --- | --- | --- |
| Brand wordmark | `.brand` | Fraunces; “Compiler” in forest |
| Coords line | `.coords` | Mono meta under brand |
| Primary button | `.btn.primary` | Forest fill |
| Ghost button | `.btn.ghost` | Border, forest-deep text |
| Quiet button | `.btn.quiet` | Underlined power-path (Prove…) |
| Agent button | `.btn.agent` | Distinct CTA for agent path |
| Hero plane | `.plane` | Dark forest savings visual |
| Comparison bars | `.hbar` / `.bar` | Raw vs compiled; label outside fill |
| Stat tiles | `.stat` | Raw / compiled / reduction / cost |
| Badges | `.badge` | Soft-rect, not pills |
| Sample cards | `.scard` | Selectable; `.active` inset green |
| Format chips | `.fmt.pdf/.docx/.xlsx/.md/.pptx` | Color-coded |
| Question chips | `.qchip` | Soft-rect |
| Budget presets | `.bpre` | Soft-rect toggles Quick/Standard/Deep |
| Floor / stale notes | `.floornote` | Left accent border |
| Loading banner | `.loading-banner` + `.spinner` | In-progress wait |
| Expect box | `.expectbox` | Rate-limit disclosure |
| Omitted chips | omit chip row in results | Expand / include controls |
| Skip link / sr-only | `.skip-link`, `.sr-only` | A11y |

Cards are used sparingly as **interactive containers** (sample pickers, hairline result/agent blocks) — never as marketing card grids. Below-fold chrome matches the H hero: paper grid wash, forest mono meta, no cream SaaS elevation.

---

## 6. Motion

| Motion | Behavior |
| --- | --- |
| `.hbar` grow | Scale-X entrance for mock bars |
| Button hover | Background / border shift |
| Sample hover | Slight lift |

`prefers-reduced-motion: reduce` collapses animation/transition durations and disables smooth scroll.

---

## 7. Accessibility

- `:focus-visible` outline in brand color.
- Live regions: polite status + assertive alerts.
- Skip link to compile form (`#try`).
- Form errors use `role="alert"`.
- Contrast maintained on muted text; success green doubles as brand (savings).

---

## 8. What this system is not

- No cream + terracotta editorial default.
- No Inter / purple-gradient SaaS default.
- No large icon-row marketing kits.
- No separate Storybook package — tokens live in one CSS file for the demo.
