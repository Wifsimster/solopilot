# 0028. Visual identity "Trajectoire"

Date: 2026-10-10

## Status

Accepted

## Context

Solopilot had no identity of its own. The sidebar and mobile header showed
the Lucide `Workflow` icon on an indigo-to-violet tile. The favicon and PWA
icons were a white "X" on slate, left over from the X-veille bot. The palette
was a generic "Linear-like" indigo/violet. The product name was rendered as
plain Inter text.

Three directions were explored (phase 1, 2026-10-10): A Horizon (cobalt and
amber, artificial-horizon mark), B Trajectoire (indigo and mint, an S drawn
as a route) and C Engagé (petrol and coral, an autopilot switch). Damien chose
**B — Trajectoire**.

## Decision

Adopt the Trajectoire identity across the web app:

- **Concept.** The S of Solopilot is drawn as a planned trajectory and ends
  on a detached dot: the next step is already computed. The mark is a stroked
  path plus a circle on a 64-unit grid. An optical variant (thicker stroke,
  larger dot) is used at 32 px and below, including the favicon.
- **Logo.** `frontend/src/components/brand/logo.tsx` exports `LogoMark` (the
  symbol) and `Logo` (symbol plus the lowercase wordmark "solopilot", Space
  Grotesk 600 converted to outlines). Both are inline SVG that follow
  `currentColor`. The `color` variant draws the S in `--primary` (light mode)
  or `currentColor` (dark mode), with the dot in `--brand-accent`. The `mono`
  variant draws everything in `currentColor`. Sources are in `docs/brand/`.
- **Palette.** The primary stays indigo (`#5134D8` light, `#8C7DFF` dark),
  so the hue barely moves from the previous 277. A mint brand accent is added
  (`#14B891` / `#3DD9B6`) as `--brand-accent*`. `--accent` keeps its role as
  the hover and selected-navigation surface. Neutrals are cool and tinted
  indigo. The status colours are re-tuned to reach AA as text on cards, and a
  new `--info` token is added. `--series-1…8` do not change.
- **Mint is brand-only in light mode.** It appears on the logo dot, in brand
  washes and on decorative live dots. Mint never carries a status on its own:
  it is 2.5:1 on white. Text in the accent colour uses `--brand-accent-text`
  (`#0B7560`, 5.6:1).
- **Type.** Inter stays the UI face. Space Grotesk (`@fontsource-variable/space-grotesk`,
  self-hosted, OFL) is used for page titles (`h1`), KPI figures and amounts
  through `--font-display` / `font-display`, always with tabular figures.
  `--font-mono` is unchanged because it renders code identifiers.
- **Shape and elevation.** The radius goes from 10 px to 12 px (`--radius:
  0.75rem`; cards `rounded-xl` = 16 px). Shadows in light mode are soft and
  tinted with the primary indigo.
- **Icons.** `scripts/generate-pwa-icons.mjs` renders `favicon.ico`,
  `favicon.png`, `apple-touch-icon.png` and the PWA 192/512/maskable PNGs from
  the brand SVGs with `@resvg/resvg-js`. `favicon.svg` is served as the
  primary favicon. `theme-color` follows the page background
  (`#FAFAFD` / `#0E0D17`). The manifest uses `theme_color #5134D8` and
  `background_color #0E0D17`.

## Consequences

- Token names and structure do not change. Every component that uses
  `bg-primary`, `text-muted-foreground` or the other semantic tokens picks up
  the new palette with no code change.
- `--chart-1…5` become aliases: `--chart-1` → `--primary`, `--chart-2` →
  `--brand-accent`, `--chart-3…5` → `--series-3…5`. Charts that used
  `--chart-2` as the "violet" now show mint. The Comptabilité reference bars
  move to `--series-*` because light mint is below 3:1.
- Platform colours in the content studio map to the categorical series
  (Reddit `--series-2`, Générique `--series-1`, Instagram `--series-5`). This
  resolves the raw `pink-*` Instagram classes. The icon variants keep 3:1 on
  white and on hovered surfaces.
- The light status colours sit around 5.4:1 on white, so tinted status
  surfaces (badges, alerts, status pills) use an 8 % tint in light mode
  instead of 10–15 % to stay at or above 4.5:1.
- The mint accent and the success green are close in hue. A success state
  always carries an icon and a label.
- The fonts add about 22 kB (Space Grotesk latin woff2, variable). The font
  binaries in the phase-1 kit are not committed: the build uses the npm package.
