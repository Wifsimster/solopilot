---
name: Solopilot
source: frontend/src/globals.css
mode: light + dark (class .dark, theme-provider light | dark | system)
colors:
  light:
    background: "oklch(1 0 0)"
    foreground: "oklch(0.21 0.02 277)"
    card: "oklch(1 0 0)"
    card-foreground: "oklch(0.21 0.02 277)"
    popover: "oklch(1 0 0)"
    popover-foreground: "oklch(0.21 0.02 277)"
    primary: "oklch(0.545 0.218 277.2)"
    primary-foreground: "oklch(0.985 0 0)"
    secondary: "oklch(0.968 0.005 277)"
    secondary-foreground: "oklch(0.27 0.02 277)"
    muted: "oklch(0.972 0.004 277)"
    muted-foreground: "oklch(0.552 0.022 277)"
    accent: "oklch(0.96 0.018 277)"
    accent-foreground: "oklch(0.42 0.16 277.2)"
    destructive: "oklch(0.585 0.227 27.2)"
    destructive-foreground: "oklch(0.985 0 0)"
    success: "oklch(0.58 0.16 152)"
    success-foreground: "oklch(0.985 0 0)"
    warning: "oklch(0.72 0.16 70)"
    warning-foreground: "oklch(0.27 0.05 70)"
    border: "oklch(0.922 0.005 277)"
    input: "oklch(0.922 0.005 277)"
    ring: "oklch(0.545 0.218 277.2)"
    chart: ["oklch(0.545 0.218 277.2)", "oklch(0.66 0.18 292)", "oklch(0.7 0.15 230)", "oklch(0.72 0.16 70)", "oklch(0.62 0.18 162)"]
    sidebar: "oklch(0.985 0.003 277)"
    sidebar-foreground: "oklch(0.21 0.02 277)"
    sidebar-primary: "oklch(0.545 0.218 277.2)"
    sidebar-primary-foreground: "oklch(0.985 0 0)"
    sidebar-accent: "oklch(0.96 0.018 277)"
    sidebar-accent-foreground: "oklch(0.42 0.16 277.2)"
    sidebar-border: "oklch(0.922 0.005 277)"
    sidebar-ring: "oklch(0.545 0.218 277.2)"
  dark:
    background: "oklch(0.165 0.008 277)"
    foreground: "oklch(0.965 0.004 277)"
    card: "oklch(0.205 0.01 277)"
    card-foreground: "oklch(0.965 0.004 277)"
    popover: "oklch(0.215 0.011 277)"
    popover-foreground: "oklch(0.965 0.004 277)"
    primary: "oklch(0.64 0.19 277.5)"
    primary-foreground: "oklch(0.99 0 0)"
    secondary: "oklch(0.26 0.012 277)"
    secondary-foreground: "oklch(0.965 0.004 277)"
    muted: "oklch(0.255 0.012 277)"
    muted-foreground: "oklch(0.7 0.02 277)"
    accent: "oklch(0.3 0.04 277)"
    accent-foreground: "oklch(0.92 0.04 277)"
    destructive: "oklch(0.68 0.2 25)"
    destructive-foreground: "oklch(0.99 0 0)"
    success: "oklch(0.7 0.16 152)"
    success-foreground: "oklch(0.145 0.01 152)"
    warning: "oklch(0.78 0.15 75)"
    warning-foreground: "oklch(0.21 0.04 75)"
    border: "oklch(1 0 0 / 9%)"
    input: "oklch(1 0 0 / 12%)"
    ring: "oklch(0.64 0.19 277.5)"
    chart: ["oklch(0.64 0.19 277.5)", "oklch(0.72 0.17 292)", "oklch(0.74 0.14 230)", "oklch(0.78 0.15 75)", "oklch(0.7 0.16 162)"]
    sidebar: "oklch(0.185 0.009 277)"
    sidebar-foreground: "oklch(0.965 0.004 277)"
    sidebar-primary: "oklch(0.64 0.19 277.5)"
    sidebar-primary-foreground: "oklch(0.99 0 0)"
    sidebar-accent: "oklch(0.3 0.04 277)"
    sidebar-accent-foreground: "oklch(0.92 0.04 277)"
    sidebar-border: "oklch(1 0 0 / 9%)"
    sidebar-ring: "oklch(0.64 0.19 277.5)"
typography:
  sans: "\"Inter Variable\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
  features: '"cv11", "ss01"'
  body-tracking: -0.011em
  heading-tracking: -0.02em
  extra-steps: { 2xs: 0.6875rem, 3xs: 0.625rem, ui-sm: 0.8125rem, ui-lg: 0.9375rem, title: 1.75rem }
  scale: tailwind-default
rounded:
  base: 0.625rem
  sm: "calc(var(--radius) - 4px)"
  md: "calc(var(--radius) - 2px)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) + 4px)"
  2xl: "calc(var(--radius) + 8px)"
elevation:
  light:
    xs: "0 1px 2px 0 oklch(0.21 0.02 277 / 0.04)"
    sm: "0 1px 2px 0 oklch(0.21 0.02 277 / 0.05), 0 1px 3px 0 oklch(0.21 0.02 277 / 0.04)"
    md: "0 2px 4px -1px oklch(0.21 0.02 277 / 0.06), 0 4px 12px -2px oklch(0.21 0.02 277 / 0.08)"
    lg: "0 8px 24px -4px oklch(0.21 0.02 277 / 0.12), 0 2px 6px -2px oklch(0.21 0.02 277 / 0.08)"
  dark:
    xs: "0 1px 2px 0 oklch(0 0 0 / 0.3)"
    sm: "0 1px 2px 0 oklch(0 0 0 / 0.35), 0 1px 3px 0 oklch(0 0 0 / 0.3)"
    md: "0 2px 6px -1px oklch(0 0 0 / 0.4), 0 6px 16px -4px oklch(0 0 0 / 0.45)"
    lg: "0 12px 32px -6px oklch(0 0 0 / 0.55), 0 4px 10px -3px oklch(0 0 0 / 0.4)"
spacing:
  scale: tailwind-default (4px)
  control-h: 40px (h-10)
components:
  style: new-york
  primitives: radix (@radix-ui/react-*)
  icons: lucide-react
  toasts: sonner
---

# Solopilot — DESIGN.md

This file describes the design system **as it exists in the code**. It
proposes nothing. Every value comes from the cited file; where they
disagree, the code wins and the gap goes under [Known Gaps](#known-gaps).
Related decision: `docs/adr/0002-semantic-color-tokens-and-radix-primitives.md`.

## Overview

Back office for a French auto-entrepreneur (watch, acquisition, CRM,
invoicing, bookkeeping). The header comment of `globals.css` names the
direction: **"Modern SaaS / Linear-like"** — cool neutrals tinted toward
indigo (hue 277), one indigo/violet brand accent, tight radii, subtle layered
elevation. Light and dark are both first-class.

## Colors

Source: `frontend/src/globals.css` (`@theme inline` l. 6–60, `:root`
l. 67–113, `.dark` l. 115–160). Tailwind v4. Dark is the `.dark` class
(`@custom-variant dark`), set by `components/theme-provider.tsx` (`light` |
`dark` | `system`).

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.165 0.008 277)` | Canvas |
| `--foreground` | `oklch(0.21 0.02 277)` | `oklch(0.965 0.004 277)` | Text |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0.01 277)` | Cards |
| `--popover` | `oklch(1 0 0)` | `oklch(0.215 0.011 277)` | Menus, dialogs |
| `--primary` | `oklch(0.545 0.218 277.2)` | `oklch(0.64 0.19 277.5)` | Brand indigo, primary action |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.99 0 0)` | |
| `--secondary` | `oklch(0.968 0.005 277)` | `oklch(0.26 0.012 277)` | Secondary buttons |
| `--secondary-foreground` | `oklch(0.27 0.02 277)` | `oklch(0.965 0.004 277)` | |
| `--muted` | `oklch(0.972 0.004 277)` | `oklch(0.255 0.012 277)` | Quiet surfaces |
| `--muted-foreground` | `oklch(0.552 0.022 277)` | `oklch(0.7 0.02 277)` | Secondary text |
| `--accent` | `oklch(0.96 0.018 277)` | `oklch(0.3 0.04 277)` | Hover, selected nav (tinted indigo) |
| `--accent-foreground` | `oklch(0.42 0.16 277.2)` | `oklch(0.92 0.04 277)` | Indigo text on accent |
| `--destructive` | `oklch(0.585 0.227 27.2)` | `oklch(0.68 0.2 25)` | |
| `--success` / `-foreground` | `oklch(0.58 0.16 152)` / `oklch(0.985 0 0)` | `oklch(0.7 0.16 152)` / `oklch(0.145 0.01 152)` | ADR 0002 |
| `--warning` / `-foreground` | `oklch(0.72 0.16 70)` / `oklch(0.27 0.05 70)` | `oklch(0.78 0.15 75)` / `oklch(0.21 0.04 75)` | ADR 0002 |
| `--border` / `--input` | `oklch(0.922 0.005 277)` | `oklch(1 0 0 / 9%)` / `/ 12%` | |
| `--ring` | `oklch(0.545 0.218 277.2)` | `oklch(0.64 0.19 277.5)` | Focus |
| `--chart-1…5` | indigo 277.2, violet 292, blue 230, amber 70, green 162 (see frontmatter) | lighter twins | Charts |
| `--series-1…8` | `#2a78d6` `#eb6834` `#1baf7a` `#eda100` `#e87ba4` `#008300` `#4a3aa7` `#e34948` | `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#008300` `#9085e9` `#e66767` | Multi-series charts (Dépenses IA) |
| `--sidebar-*` | `oklch(0.985 0.003 277)` surface, primary/accent/border/ring as above | `oklch(0.185 0.009 277)` surface | Sidebar |

Brand decoration (`@layer utilities`): `.bg-brand-aurora` (three radial
washes: indigo 277, violet 292, blue 230 at 5–16 %), `.bg-grid-fade` (32 px
grid, masked), `.text-gradient-brand` (135°, indigo → violet). All three read
`var(--primary)`, `var(--chart-2)`, `var(--chart-3)` and `var(--foreground)`
through `color-mix()`, so they follow the theme.

Categorical series (`--series-1…8`): a fixed slot order, validated with
the dataviz palette checker against the card surfaces (light `#ffffff`, dark
`oklch(0.205 0.01 277)` = `#16171c`): adjacent pairs keep CVD ΔE ≥ 8.4 and
normal-vision ΔE ≥ 19.3 in both modes. `--chart-1…5` fail that check for
stacks (indigo↔violet normal-vision ΔE 13.2, green↔amber CVD ΔE 6.2), so a
chart with three or more touching series uses `--series-*`. In light mode,
slots 3, 4 and 5 are below 3:1 on white: every such chart ships a legend and
a data table. A series keeps its slot whatever is filtered (colour follows
the entity, not its rank).

Platform identity (`components/studio/platform-meta.tsx`): Reddit maps to
`--chart-4`, Générique to `--chart-3` (`--color-platform-*` in `@theme
inline`). The `-icon` variants mix in 10 % `--foreground`: light 3.09:1
(Reddit) and 3.11:1 (Générique) on white, dark ≥ 8.6:1 on cards.

## Typography

`@fontsource-variable/inter` imported in `src/main.tsx`; `--font-sans`
`"Inter Variable", ui-sans-serif, system-ui, …`. Body: `font-feature-settings:
"cv11", "ss01"`, `letter-spacing: -0.011em`, antialiased. `h1–h4`:
`letter-spacing: -0.02em`.

Scale: Tailwind defaults plus two micro steps, `text-2xs` 11 px (13 uses) and
`text-3xs` 10 px (24 uses), and three off-scale steps, `text-ui-sm` 13 px
(Button `sm`), `text-ui-lg` 15 px (Button `lg`) and `text-title` 28 px; all
size only. Page title: `text-2xl font-semibold tracking-tight
sm:text-title sm:leading-9` (`components/page-header.tsx`). Buttons `text-sm
font-medium`. Custom steps are registered in `extendTailwindMerge`
(`lib/utils.ts`); an unregistered `text-*` name is read as a color and drops
the real color class.

## Layout

Tailwind default spacing. Controls 40 px (`h-10`): Button `default` and
`icon`, Input; Button `sm` 36 px, `lg` 44 px. Shell: `components/layout.tsx`
with `mobile-bottom-nav.tsx` on phones; `page-header.tsx`, `page-hero.tsx`,
`stat-card.tsx`, `status-badge.tsx`, `responsive-dialog.tsx` as shared
building blocks.

## Elevation

Tailwind's shadow keys are re-pointed to theme-aware values (`@theme inline`
`--shadow-xs|sm|md|lg` → `--shadow-*-value`), indigo-tinted in light, black
in dark (values in the frontmatter). Card, Input, Button `outline` and
`destructive` use `shadow-xs`. Button `default` uses `shadow-raised`
(`--shadow-raised-value`: `inset 0 1px 0 0 oklch(1 0 0/0.14), 0 1px 2px 0
oklch(0 0 0/0.12)`, same in both modes). A `shadow-*` class passed to a
`Button` replaces it.

## Shapes

`--radius: 0.625rem`: `sm` 6 px, `md` 8 px, `lg` 10 px, `xl` 14 px, `2xl`
18 px. Button and Input `rounded-lg` (Button `sm` `rounded-md`), Card
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
- Keep surfaces on the 277-hue neutrals and the indigo accent.

**Don't**
- Hand-roll tabs, flash messages or mobile nav.
- Add raw Tailwind palette colors to components.

## Responsive

Mobile first, Tailwind default breakpoints; bottom nav on phones, Sheet for
the mobile menu, `responsive-dialog.tsx` for Dialog / Drawer.
`-webkit-tap-highlight-color: transparent` on `html`.

## Known Gaps

Found in the code, not fixed here.

1. **Instagram platform color is raw**: `components/studio/platform-meta.tsx` still uses `bg-pink-500`, `text-pink-600 dark:text-pink-400`, `border-l-pink-500`. The palette has no pink token; choosing one is a palette decision.
2. **Platform icon contrast on hover**: the light `-icon` variants reach 3:1 on white but about 2.9:1 on `--accent`/`--muted` (hovered outline buttons). The label next to the icon carries the meaning.

Resolved (2026-10-10): bracketed type sizes in Button and PageHeader, raw orange/blue platform colors, the arbitrary Button `default` shadow, and the hard-coded oklch values in `.bg-brand-aurora`, `.bg-grid-fade` and `.text-gradient-brand` (which now has a dark variant).
