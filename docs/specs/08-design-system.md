# Design system

**Source of truth:** `apps/web/app/globals.css` (Forest map tokens ported from the former `public/style.css`).

## Tokens

- Paper `#e8ece9`, ink `#1a221e`, forest `#1f5c42` / deep `#143d2c`
- Fonts: Fraunces (brand), DM Sans (UI), IBM Plex Mono (meta/coords)
- Elevation: hairline borders + left accent rules — not soft SaaS shadows

## Motion

Framer Motion on the hero savings bars and results enter. Respect `prefers-reduced-motion` (CSS).
