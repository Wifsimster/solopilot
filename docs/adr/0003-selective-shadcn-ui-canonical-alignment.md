# 0003. Selective shadcn/ui canonical alignment

Date: 2026-03-17

## Status

Accepted

## Context

The frontend uses 14 shadcn/ui components that were initially implemented with simplified patterns. Several deviations from canonical shadcn/ui were identified: Button lacked `asChild`/Slot support (preventing composable rendering via `@radix-ui/react-slot`), CardTitle was styled identically to CardDescription (`text-sm font-medium text-muted-foreground`), Card was missing the standard `border` class, and Tabs/Tooltip used legacy `React.forwardRef` wrappers unnecessary in React 19.

The question was whether to fully align all components with canonical shadcn/ui or take a selective approach.

## Decision

We adopt selective alignment: fix components where the deviation creates real functional gaps or styling errors, and skip changes where the current implementation is functionally equivalent (YAGNI principle).

Specifically:
- **Button**: Add `@radix-ui/react-slot` and `asChild` prop support — prevents invalid HTML nesting when composing Button with Link or other elements
- **Card**: Add `border` class, fix CardTitle styling to canonical `font-semibold leading-none tracking-tight`
- **CardDescription**: Render as `<p>` instead of `<div>` for correct semantics
- **Tabs/Tooltip**: Remove `React.forwardRef` wrappers — React 19 passes ref as a regular prop
- **StatCard**: Override CardTitle className to preserve the muted label design

Skip: Label (plain `<label>` sufficient), Separator (not used in codebase), Input (React 19 already forwards ref via props spread).

## Consequences

### Positive
- Button now supports the standard shadcn/ui composition pattern (`<Button asChild><Link>...</Link></Button>`)
- CardTitle and CardDescription are visually distinct as intended
- Consistent React 19 idioms across all components (no mixed forwardRef patterns)

### Negative
- One new dependency (`@radix-ui/react-slot`) added to the bundle
- StatCard requires explicit className override to maintain its muted label design

### Neutral
- Label and Separator remain as plain HTML implementations — revisitable if Radix Form primitives are adopted

## Alternatives Considered

### Full canonical alignment
Install all missing Radix primitives (`react-slot`, `react-label`, `react-separator`) and align every component. Rejected: adds dependencies with no consumer for a 5-page dashboard, violates YAGNI.

### No changes (status quo)
Keep all current implementations unchanged. Rejected: CardTitle styling bug is a real issue (visually identical to CardDescription), and missing `asChild` on Button will cause invalid HTML when composing with routing links.

## Participants

- Pixel-Perfect Hugo (Frontend Engineer) — Advocated for Input ref fix, Card semantics, forwardRef cleanup; opposed gratuitous deps
- Whiteboard Damien (Tech Lead / Architect) — Identified Button asChild as the one real gap; pushed YAGNI on Label/Separator
- Sprint Zero Sarah (Product Owner) — Challenged all changes as zero user value; accepted forwardRef cleanup as low-risk

---
_Decision recorded automatically from fast-meeting analysis._
