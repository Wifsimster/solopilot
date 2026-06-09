# 0002. Semantic color tokens and proper Radix primitives for UI components

Date: 2026-03-17

## Status

Accepted

## Context

The frontend dashboard uses shadcn/ui components with Tailwind CSS 4, but several interactive patterns were hand-rolled instead of using proper Radix primitives (custom tab switcher, mobile nav without focus management, inline flash messages). Additionally, semantic status colors (success, warning) were hardcoded using specific Tailwind classes (emerald-*, amber-*) instead of CSS custom properties, making them inconsistent with the theme system and brittle across dark/light modes.

These gaps created accessibility issues (no keyboard navigation on tabs, no focus trap on mobile nav), duplicated state management (6+ identical flash message patterns), and a color system that would break on any theme change.

## Decision

We will:

1. **Add semantic color tokens** (`--success`, `--success-foreground`, `--warning`, `--warning-foreground`) to the CSS theme layer, following the same oklch pattern as the existing `--destructive` token. Badge and alert CVA variants now reference these tokens instead of hardcoded Tailwind color classes.

2. **Replace the custom tab switcher** on the summaries page with `@radix-ui/react-tabs`, providing proper `role="tablist"` semantics, keyboard arrow-key navigation, and `aria-selected` states.

3. **Replace inline flash messages** with Sonner toast notifications. A single `<Toaster>` at the app root replaces 6+ independent `useState`/`setTimeout` patterns across dashboard, summaries, and monthly view.

4. **Convert the mobile navigation** from a conditionally-rendered `<div>` to a Radix Dialog-based Sheet component, providing focus trapping, escape-to-close, and overlay click-to-dismiss.

5. **Add Radix Tooltip** on icon-only buttons (Discord send) for accessibility.

## Consequences

### Positive
- WCAG 2.1 AA keyboard operability for tabs and mobile navigation
- Single source of truth for status colors via CSS custom properties — theme changes propagate automatically
- ~80 lines of duplicated flash message boilerplate removed
- Consistent notification UX across all async actions

### Negative
- Four new dependencies added (`@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`, `sonner`) — ~20KB gzipped
- Settings cards still use inline `CardFlash` for form-level feedback (not migrated to toast, as form feedback is contextual)

### Neutral
- Bundle size increased from ~550KB to ~560KB gzipped — acceptable for an admin dashboard

## Alternatives Considered

### Keep hand-rolled components, just fix colors
Rejected because the tab and mobile nav accessibility gaps are not fixable without proper ARIA management, which Radix provides out of the box. Reimplementing focus trapping and keyboard navigation manually would be more code than using the library.

### Use React Hook Form for settings cards
Rejected as over-engineering — the settings forms are simple enough that the existing controlled pattern works well. The flash message deduplication is better solved by Sonner for transient notifications.

## Participants

- Pixel-Perfect Hugo (Frontend Engineer) — Advocated for Radix Tabs, Sheet, Sonner, and semantic tokens as highest-priority fixes
- Figma Fiona (UX/UI Designer) — Emphasized color token foundation-first approach and WCAG compliance
- Sprint Zero Sarah (Product Owner) — Scoped to minimal high-impact changes, pushed back on over-engineering
- Whiteboard Damien (Tech Lead / Architect) — Recommended tiered approach with hook extraction for async state

---
_Decision recorded automatically from fast-meeting analysis._
