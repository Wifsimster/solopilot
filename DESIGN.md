---
name: Solopilot
source: frontend/src/globals.css
identity: Trajectoire (ADR 0028)
mode: light + dark (class .dark, theme-provider light | dark | system)
colors:
  light:
    background: "#FAFAFD"
    foreground: "#16152A"
    card: "#FFFFFF"
    card-foreground: "#16152A"
    popover: "#FFFFFF"
    popover-foreground: "#16152A"
    primary: "#5134D8"
    primary-foreground: "#FFFFFF"
    secondary: "#F6F6F6"
    secondary-foreground: "#16152A"
    muted: "#F6F6F6"
    muted-foreground: "#5D5B75"
    accent: "#F3F1FC"
    accent-foreground: "#5134D8"
    brand-accent: "#14B891"
    brand-accent-foreground: "#04241C"
    brand-accent-text: "#0B7560"
    destructive: "#C62F2B"
    destructive-foreground: "#FFFFFF"
    success: "#1B7A3E"
    success-foreground: "#FFFFFF"
    warning: "#9E5A00"
    warning-foreground: "#FFFFFF"
    info: "#2560C6"
    info-foreground: "#FFFFFF"
    border: "#E3E2EE"
    input: "#E3E2EE"
    ring: "#5134D8"
    chart: ["var(--primary)", "var(--brand-accent)", "var(--series-3)", "var(--series-4)", "var(--series-5)"]
    sidebar: "#FDFDFE"
    sidebar-foreground: "#16152A"
    sidebar-primary: "#5134D8"
    sidebar-primary-foreground: "#FFFFFF"
    sidebar-accent: "#F3F1FC"
    sidebar-accent-foreground: "#5134D8"
    sidebar-border: "#E3E2EE"
    sidebar-ring: "#5134D8"
  dark:
    background: "#0E0D17"
    foreground: "#ECEBF7"
    card: "#171626"
    card-foreground: "#ECEBF7"
    popover: "#171626"
    popover-foreground: "#ECEBF7"
    primary: "#8C7DFF"
    primary-foreground: "#0E0D17"
    secondary: "#262535"
    secondary-foreground: "#ECEBF7"
    muted: "#262535"
    muted-foreground: "#A09EB9"
    accent: "#2A2649"
    accent-foreground: "#ECEBF7"
    brand-accent: "#3DD9B6"
    brand-accent-foreground: "#04241C"
    brand-accent-text: "#3DD9B6"
    destructive: "#F47A72"
    destructive-foreground: "#0E0D17"
    success: "#55C97F"
    success-foreground: "#0E0D17"
    warning: "#F0B44C"
    warning-foreground: "#0E0D17"
    info: "#6FA6F5"
    info-foreground: "#0E0D17"
    border: "#2A2842"
    input: "#2A2842"
    ring: "#8C7DFF"
    chart: ["var(--primary)", "var(--brand-accent)", "var(--series-3)", "var(--series-4)", "var(--series-5)"]
    sidebar: "#13121F"
    sidebar-foreground: "#ECEBF7"
    sidebar-primary: "#8C7DFF"
    sidebar-primary-foreground: "#0E0D17"
    sidebar-accent: "#2A2649"
    sidebar-accent-foreground: "#ECEBF7"
    sidebar-border: "#2A2842"
    sidebar-ring: "#8C7DFF"
typography:
  sans: "\"Inter Variable\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
  display: "\"Space Grotesk Variable\", var(--font-sans)"
  features: '"cv11", "ss01"'
  body-tracking: -0.011em
  heading-tracking: -0.02em
  h1-tracking: -0.025em
  figures: tabular-nums (font-display)
  extra-steps: { 2xs: 0.6875rem, 3xs: 0.625rem, ui-sm: 0.8125rem, ui-lg: 0.9375rem, title: 1.75rem }
  scale: tailwind-default
rounded:
  base: 0.75rem
  sm: "calc(var(--radius) - 4px)"
  md: "calc(var(--radius) - 2px)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) + 4px)"
  2xl: "calc(var(--radius) + 8px)"
elevation:
  light:
    xs: "0 1px 2px 0 rgb(81 52 216 / 0.05)"
    sm: "0 2px 4px -1px rgb(81 52 216 / 0.06), 0 4px 12px -2px rgb(81 52 216 / 0.08)"
    md: "0 4px 8px -2px rgb(81 52 216 / 0.08), 0 8px 20px -4px rgb(81 52 216 / 0.1)"
    lg: "0 12px 32px -6px rgb(81 52 216 / 0.16), 0 4px 10px -3px rgb(81 52 216 / 0.08)"
  dark:
    xs: "0 1px 2px 0 rgb(0 0 0 / 0.3)"
    sm: "0 2px 6px -1px rgb(0 0 0 / 0.4), 0 6px 16px -4px rgb(0 0 0 / 0.45)"
    md: "0 4px 10px -2px rgb(0 0 0 / 0.45), 0 10px 24px -6px rgb(0 0 0 / 0.5)"
    lg: "0 16px 40px -8px rgb(0 0 0 / 0.6), 0 4px 12px -3px rgb(0 0 0 / 0.45)"
spacing:
  scale: tailwind-default (4px)
  control-h: 40px (h-10)
components:
  style: new-york
  primitives: radix (@radix-ui/react-*)
  icons: lucide-react
  toasts: sonner
  logo: components/brand/logo.tsx (Logo, LogoMark)
---

# Solopilot — DESIGN.md

This file describes the design system **as it exists in the code**. It
proposes nothing. Every value comes from the cited file; where they
disagree, the code wins and the gap goes under [Known Gaps](#known-gaps).
Related decisions: `docs/adr/0002-semantic-color-tokens-and-radix-primitives.md`, `docs/adr/0028-identite-visuelle-trajectoire.md` (identity).

## Overview

Back office for a French auto-entrepreneur (watch, acquisition, CRM,
invoicing, bookkeeping). Visual identity **"Trajectoire"** (ADR 0028):
indigo primary for action, a mint brand accent used sparingly, cool neutrals
tinted toward indigo, 12 px radii, soft indigo-tinted elevation. Inter for the
interface, Space Grotesk for titles and figures. Light and dark are both
first-class.

## Identity

**Concept.** The S of Solopilot is drawn as a planned trajectory, a route,
and ends on a detached dot: the next step, already computed. Sources:
`docs/brand/` (SVG, see its README for the font licences).

**Logo.** `components/brand/logo.tsx`:

- `LogoMark`: the symbol. `Logo`: the symbol plus the lowercase wordmark
  "solopilot" (Space Grotesk 600 converted to outlines; it needs no font).
- `size` is the rendered height in px. At 32 px and below both switch to the
  optical symbol (stroke 8 instead of 6.5, larger dot), the same one as the
  favicon.
- `variant="color"` (default): the S is `--primary` in light mode and
  `currentColor` in dark mode, the dot is `--brand-accent`, and the wordmark
  is `currentColor`. `variant="mono"`: everything is `currentColor`.
- `title` gives the SVG an accessible name. Omit it when the logo sits inside
  a link or next to a label that already names it (the layout sets
  `aria-label` on the link).
- Used in `components/layout.tsx`: `Logo` in the sidebar (26 px) and the mobile
  header (24 px), and `LogoMark` in the mobile navigation drawer.

Do:

- Keep the lowercase wordmark and the detached dot. Clear space around the
  logo is at least the dot's diameter.
- Use the mono variant on photos, coloured fills and anything that is not a
  Solopilot surface.
- Use the tile icons (`favicon.svg`, `app-icon*.svg`) wherever the symbol
  sits on its own: tabs, home screens, avatars.

Don't:

- Recolour the dot with a status colour, or the S with mint.
- Retype the wordmark in a live font, capitalise it, stretch it, or add effects
  (shadow, gradient, outline).
- Put the colour logo on the indigo tile without the tile's white S (use the
  app icon instead).
- Bring back the Lucide `Workflow` icon as a brand mark (it remains the nav icon
  for the Workflows page).

**Icons.** `frontend/public/` holds `favicon.svg` (primary), `favicon.ico`
(16/32/48), `favicon.png`, `apple-touch-icon.png` (180, full-bleed) and the
PWA `pwa-192x192.png`, `pwa-512x512.png` and `pwa-maskable-512x512.png`, all
rendered by `npm run generate:pwa-icons` from `docs/brand/`. `theme-color`
is `#FAFAFD` (light) or `#0E0D17` (dark). The manifest uses `theme_color
#5134D8` and `background_color #0E0D17`.

## Colors

Source: `frontend/src/globals.css` (`@theme inline`, `:root`, `.dark`).
Tailwind v4. Dark is the `.dark` class (`@custom-variant dark`), set by
`components/theme-provider.tsx` (`light` | `dark` | `system`).

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `#FAFAFD` | `#0E0D17` | Canvas |
| `--foreground` | `#16152A` | `#ECEBF7` | Text |
| `--card` / `--popover` | `#FFFFFF` | `#171626` | Cards, menus, dialogs |
| `--primary` | `#5134D8` | `#8C7DFF` | Brand indigo, primary action, links, focus |
| `--primary-foreground` | `#FFFFFF` | `#0E0D17` | |
| `--secondary` / `--muted` | `#F6F6F6` | `#262535` | Secondary buttons, quiet surfaces |
| `--muted-foreground` | `#5D5B75` | `#A09EB9` | Secondary text |
| `--accent` | `#F3F1FC` | `#2A2649` | Hover, selected nav (role unchanged) |
| `--accent-foreground` | `#5134D8` | `#ECEBF7` | Text on accent |
| `--brand-accent` | `#14B891` | `#3DD9B6` | Mint: logo dot, brand washes, live dots |
| `--brand-accent-foreground` | `#04241C` | `#04241C` | Text on a mint fill |
| `--brand-accent-text` | `#0B7560` | `#3DD9B6` | Text in the accent colour |
| `--destructive` | `#C62F2B` | `#F47A72` | Danger |
| `--success` | `#1B7A3E` | `#55C97F` | |
| `--warning` | `#9E5A00` | `#F0B44C` | |
| `--info` | `#2560C6` | `#6FA6F5` | New |
| `--*-foreground` (status) | `#FFFFFF` | `#0E0D17` | Text on a filled status |
| `--border` / `--input` | `#E3E2EE` | `#2A2842` | |
| `--ring` | `#5134D8` | `#8C7DFF` | Focus |
| `--chart-1…5` | aliases: `--primary`, `--brand-accent`, `--series-3…5` | same | Single-series and brand charts |
| `--series-1…8` | `#2a78d6` `#eb6834` `#1baf7a` `#eda100` `#e87ba4` `#008300` `#4a3aa7` `#e34948` | `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#008300` `#9085e9` `#e66767` | Multi-series charts (unchanged) |
| `--sidebar-*` | `#FDFDFE` surface, primary/accent/border/ring as above | `#13121F` surface | Sidebar |

**Mint is brand-only in light mode.** At 2.5:1 on white it never carries a
status, a label or a data mark on its own. Use `--brand-accent-text` for
accent-coloured text. Mint (hue ~170) and the success green (~145) are close,
so a success state always carries an icon and a label.

**Contrast** (WCAG 2.x). The token pairs below were computed from the hex
values. The right-hand column was measured in the running app (Cockpit,
Dépenses IA and Settings at 1280 px), with translucent backgrounds composited.

| Pair | Light | Dark | Measured in the UI (light / dark) |
| --- | --- | --- | --- |
| foreground on background | 17.16 | 16.34 | h1 17.16 / 16.34 |
| muted-foreground on card | 6.52 | 6.86 | 6.52 / 6.86 (5.78 on the dark hero aurora) |
| muted-foreground on background | 6.26 | 7.43 | sidebar nav 6.42 / 7.13 |
| primary-foreground on primary (button) | 7.41 | 5.96 | 7.41 / 5.96 |
| primary on card (link) | 7.41 | 5.51 | 7.41 / 5.51 |
| accent-foreground on accent (active nav) | 6.51 | 9.26 | 6.64 / 12.09 |
| brand-accent-text on card | 5.63 | 10.01 | |
| brand-accent on card (graphic) | 2.53, decorative only | 10.01 | |
| success / warning / danger / info text on card | 5.38 / 5.36 / 5.46 / 5.89 | 8.52 / 9.62 / 6.68 / 7.17 | |
| status foreground on filled status | 5.38–5.89 | 7.23–10.41 | |
| tinted badge / status pill / alert text | 8 % tint | 20 % tint | ≥ 4.63 / ≥ 4.86 |
| hero / eyebrow pill (primary on primary tint) | 8 % tint | 8 % tint | 6.53 / 4.97 |

The light status colours sit around 5.4:1 on white, so tinted status surfaces
(`Badge` success/warning/destructive, `Alert`, the Settings `StatusDot`) use
`bg-*/8` in light mode. A 12–15 % tint drops them below 4.5:1.

Brand decoration (`@layer utilities`): `.bg-brand-aurora` has three radial
washes: indigo from the top-left (10 %, 16 % in dark), mint from the top-right
(9 %) and an info-blue base (5–7 %). `.bg-grid-fade` is a 32 px masked grid.
`.text-gradient-brand` runs from indigo to `--brand-accent-text` (100°), so
the light-mode tail stays readable. All three use `color-mix()` on the tokens
and follow the theme.

Categorical series (`--series-1…8`): a fixed slot order, revalidated on the
new cards (light `#FFFFFF`, dark `#171626`). In the worst case, adjacent
pairs reach a CVD ΔE of 9.1 (light) and 8.4 (dark), and a normal-vision ΔE of
19.6 and 19.3. `--chart-1/2` are brand colours, not a validated sequence: a
chart with three or more touching series uses `--series-*`. In light mode,
slots 3, 4 and 5 fall below 3:1 on white (2.82, 2.17 and 2.69), so every such
chart ships a legend and a data table. A series keeps its slot whatever is
filtered: the colour follows the entity, not its rank.

Platform identity (`components/studio/platform-meta.tsx`, `--color-platform-*`
in `@theme inline`): Reddit `--series-2`, Générique `--series-1`, Instagram
`--series-5`. The `-icon` variants mix in 15 % (Reddit, Instagram) or 10 %
(Générique) `--foreground`. That keeps them at 3:1 or more on white and on the
hovered `--accent`/`--muted` surfaces (about 3.1–4.6 in sRGB estimates), and
above 4:1 on dark cards.

## Typography

Both faces are self-hosted from npm (`src/main.tsx`), with no Google Fonts CDN,
and are under the SIL OFL.

- **Inter** (`@fontsource-variable/inter`), `--font-sans`: the interface.
  Body: `font-feature-settings: "cv11", "ss01"`, `letter-spacing: -0.011em`,
  antialiased. `h2–h4`, card and section titles: Inter, `-0.02em`.
- **Space Grotesk** (`@fontsource-variable/space-grotesk`), `--font-display`,
  utility `font-display`: page titles (every `h1`, via the base layer,
  `-0.025em`), KPI values (`StatCard`, the Cockpit metrics, the Dépenses IA
  KPIs) and amounts. `.font-display` always sets `tabular-nums`; add
  `tabular-nums` to amounts set in Inter (tables) as well.
- `--font-mono` is not part of the identity: it stays the system monospace
  for code identifiers (env vars, task ids, cron strings).

Scale: Tailwind defaults plus two micro steps, `text-2xs` 11 px and
`text-3xs` 10 px, and three off-scale steps, `text-ui-sm` 13 px (Button
`sm`), `text-ui-lg` 15 px (Button `lg`) and `text-title` 28 px; all size
only. Page title: `text-2xl font-semibold tracking-tight sm:text-title
sm:leading-9` (`components/page-header.tsx`). Buttons `text-sm font-medium`.
Custom steps are registered in `extendTailwindMerge` (`lib/utils.ts`); an
unregistered `text-*` name is read as a color and drops the real color class.

## Layout

Tailwind default spacing. Controls 40 px (`h-10`): Button `default` and
`icon`, Input; Button `sm` 36 px, `lg` 44 px. Shell: `components/layout.tsx`
with `mobile-bottom-nav.tsx` on phones; `page-header.tsx`, `page-hero.tsx`,
`stat-card.tsx`, `status-badge.tsx`, `responsive-dialog.tsx` as shared
building blocks.

## Elevation

Tailwind's shadow keys are re-pointed to theme-aware values (`@theme inline`
`--shadow-xs|sm|md|lg` → `--shadow-*-value`): soft and diffuse, tinted with
the primary indigo (`rgb(81 52 216 / …)`) in light mode, black in dark mode
(values in the frontmatter). Card, Input, Button `outline` and `destructive`
use `shadow-xs`. Button `default` uses `shadow-raised`
(`--shadow-raised-value`: `inset 0 1px 0 0 rgb(255 255 255 / 0.14), 0 1px 2px
0 rgb(22 21 42 / 0.16)`, same in both modes). A `shadow-*` class passed to a
`Button` replaces it.

## Shapes

`--radius: 0.75rem`: `sm` 8 px, `md` 10 px, `lg` 12 px, `xl` 16 px, `2xl`
20 px. Button and Input `rounded-lg` (Button `sm` `rounded-md`), Card
`rounded-xl`, scrollbar thumb pill.

## Motion

`tw-animate-css`. Buttons `transition-all duration-150`,
`active:scale-[0.98]` (not on `link`). Card `transition-shadow`.

## Components

shadcn `new-york`, Radix primitives (`@radix-ui/react-alert-dialog`,
`dialog`, `dropdown-menu`, `select`, `slot`, `tabs`, `tooltip`), `lucide-react`
icons, `sonner` toasts (single `<Toaster>` at the root, ADR 0002).

| Component | Conventions | Source |
| --- | --- | --- |
| `Button` | Stock variant names; `default` with inset highlight; focus `ring-2 ring-ring ring-offset-2`; sizes `default` h-10, `sm` h-9, `lg` h-11, `icon` 40 × 40 | `ui/button-variants.ts` |
| `Badge`, `Alert` | `success` / `warning` variants on the semantic tokens (ADR 0002) | `ui/badge.tsx`, `ui/alert.tsx` |
| `Card` | `rounded-xl border bg-card shadow-xs transition-shadow` | `ui/card.tsx` |
| `Input` | `h-10 rounded-lg border-input bg-background shadow-xs` | `ui/input.tsx` |
| Mobile nav | Radix Dialog-based `Sheet` (focus trap) | `ui/sheet.tsx` |
| Also | `chart`, `data-table`, `drawer`, `switch`, `table`, `tabs`, `tooltip`, `skeleton` | `ui/` |

## Do's and Don'ts

**Do**
- Use semantic tokens for status (`success`, `warning`, `destructive`), never `emerald-*` / `amber-*` (ADR 0002).
- Use `text-2xs` / `text-3xs` / `text-ui-sm` / `text-ui-lg` / `text-title` instead of bracketed pixel sizes.
- Use Radix primitives for tabs, dialogs, menus and tooltips; Sonner for transient feedback.
- Keep surfaces on the indigo-tinted neutrals; indigo for action, mint for brand moments only.
- Use `font-display tabular-nums` for KPI figures and amounts.
- Use the `Logo` / `LogoMark` components for the brand, never an icon from Lucide.

**Don't**
- Hand-roll tabs, flash messages or mobile nav.
- Add raw Tailwind palette colors to components.
- Use `--brand-accent` (mint) as a status, as text, or as a data colour in light mode.
- Use a `*-foreground` status token as text on a light surface: it is the text colour for a filled status (white in light mode).

## Responsive

Mobile first, Tailwind default breakpoints; bottom nav on phones, Sheet for
the mobile menu, `responsive-dialog.tsx` for Dialog / Drawer.
`-webkit-tap-highlight-color: transparent` on `html`.

## Known Gaps

Found in the code, not fixed here.

1. **Platform icon contrast measured only by estimate**: the `--color-platform-*-icon` ratios above come from sRGB maths. Tailwind mixes in oklab, so the content studio was not measured in the running UI.

Resolved (2026-10-10, ADR 0028): the raw `pink-*` Instagram colour (now `--series-5`), platform icon contrast on hovered surfaces, `text-warning-foreground` used as body text on the Dépenses IA page, and the 12–15 % status tints that fell below 4.5:1 with the new light status colours, and the sidebar section labels at `text-muted-foreground/70` (3.26:1).
Resolved earlier (2026-10-10): bracketed type sizes in Button and PageHeader, raw orange/blue platform colors, the arbitrary Button `default` shadow, and the hard-coded oklch values in the brand utilities.
