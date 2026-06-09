# 0021. Design system for the new back-office modules

Date: 2026-06-08

## Status

Accepted

## Context

The migration from the X-veille bot to the Solopilot platform (ADR-0013) adds a
wave of data-dense back-office screens: the Cockpit briefing (ADR-0015),
Facturation/Stripe (ADR-0016), Comptabilité/URSSAF (ADR-0017), CRM contacts &
deals (ADR-0018) and Agenda (ADR-0019). These are KPI dashboards, invoice and
transaction tables, a deal pipeline, revenue charts and a calendar — a very
different UI profile from the original five-page dashboard.

The existing frontend is shadcn/ui (hand-curated, no `components.json`), Radix
primitives, Tailwind CSS v4 with OKLCH semantic tokens, the Inter variable font,
Lucide icons, Sonner toasts (ADR-0002, ADR-0003, ADR-0005). ADR-0005 graded that
implementation A/A- on correctness, dark mode and token usage.

The question: do we **keep extending shadcn/ui** for these data-dense modules, or
switch to a batteries-included system (Mantine, Ant Design Pro, MUI) that ships
data grids, date pickers, forms and charts in one package? The decision was
stress-tested with a deliberate devil's-advocate review rather than defaulting to
the status quo.

## Decision

**Stay on shadcn/ui and extend it à la carte**, with focused best-of-breed
libraries for the widgets shadcn deliberately does not ship.

| Need | Choice |
|---|---|
| Base UI / forms / dialogs / cards | **shadcn/ui + Radix** (existing) |
| Data tables (Facturation, CRM, Compta) | **shadcn Data Table on TanStack Table v8** |
| Charts (Cockpit KPIs, CA/cotisations) | **shadcn Charts (Recharts v3)** — token-aware via `--chart-N` |
| CRM deal pipeline (kanban) | **dnd-kit** (dnd-kit + Tailwind + shadcn reference) |
| Agenda calendar view | **Schedule-X** (MIT, Tailwind-friendly) |
| Stripe payment/payout UI | **Stripe Connect embedded components** (themeable) |
| KPI cards | composed in shadcn; copy a Tremor card's MIT source if useful |

### Why this is the right call here (not just path dependence)

- The shadcn integration cost is **already paid** and graded A/A- (ADR-0005); the
  OKLCH semantic tokens (ADR-0002) already drive everything.
- The first cut of every new module is **read-only / cards / tables** (the Cockpit
  aggregates read-only; Facturation/Compta/Agenda ship as `planned` then live).
  The immediate need is KPI cards + tables + one chart, not dense editable grids.
- Ecosystem consolidation: Vercel acquired Tremor (Jan 2025), relicensed it MIT
  and folded the team into shadcn/v0 — net-new dashboard work now lands in shadcn,
  exactly our stack. Lightest bundle, Radix accessibility we already trust, zero
  vendor lock-in, components live in the repo.

### Corrections forced by the devil's-advocate review

- **Tremor is NOT taken as a runtime dependency.** Post-acquisition the repo is in
  maintenance mode (last meaningful activity Oct 2025 was CI teardown). It is
  copy-paste MIT source only: lift a KPI card if wanted, never `npm install` it as
  a pillar.
- **Agenda uses Schedule-X, not FullCalendar.** FullCalendar puts resource/timeline
  views behind a paid licence (~$480/yr) and has no native Tailwind theming
  (long-standing open request), forcing manual vendor-CSS overrides against our
  OKLCH tokens. Schedule-X is MIT and Tailwind-friendly. (This pairs with the ICS,
  dependency-free sync decided in ADR-0019.)
- **"No lock-in" is named honestly as a trade, not a free win.** Owning the
  component source means upstream Radix a11y/security fixes do **not** arrive via
  `npm update`; they must be re-diffed by hand. Accepted consciously as the price
  of control and token coherence.

## Consequences

### Positive

- One coherent Tailwind + Radix + OKLCH design language across every module; the
  new screens inherit existing semantic tokens automatically.
- Smallest dependency surface and bundle; no parallel theming system (Emotion /
  CSS-in-JS) competing with our tokens.
- Each added library (TanStack, dnd-kit, Schedule-X) is headless or
  Tailwind-native, so it themes from the same variables rather than fighting them.

### Negative / Risks

- **Integration/maintenance tax is real and on one person.** shadcn + TanStack +
  dnd-kit + Schedule-X + Recharts are separately versioned with their own bug
  trackers; visual consistency and upstream a11y/security fixes are manual work.
- **Switching cost only grows.** Every module built on shadcn raises the future
  cost of a Mantine/Ant migration. This phase is the cheapest migration window —
  the decision to stay is therefore made deliberately, not by default.

### Neutral

- KPI cards are hand-composed in shadcn rather than imported; a couple may borrow
  Tremor's MIT markup verbatim, which is fine since we own the copy.

## Explicitly NOT in scope

- Adopting an all-in-one system (Mantine / Ant Design Pro / MUI) for this phase.
- Taking Tremor as an installed dependency.
- FullCalendar premium (resource/timeline scheduler) views.
- A `components.json` / shadcn-CLI migration (tracked separately in ADR-0005).

## Alternatives Considered

### Mantine as the single batteries-included system
Genuinely the strongest alternative and steel-manned, not dismissed. Mantine is
MIT, ships DataTable, date/datetime pickers, `useForm`, notifications and charts
in one versioned package — collapsing the multi-library stack into ~1–2 deps,
which suits a solo maintainer optimising for *fewest things to patch*. It **wins
only if** the roadmap turns out to be dominated by dense editable grids and heavy
forms (e.g. manual compta entry, complex URSSAF declarations). Rejected for now
because our first modules are read-only/cards/tables, the shadcn cost is sunk and
graded A, and a switch would discard the OKLCH token foundation. Revisit *before*
building Facturation/Compta if the editable-grid workload materialises.

### Ant Design Pro for finance density
Purpose-built for dense ProTable/ProForm CRUD finance admin. Rejected: heavier
bundle, its own design language clashing with our OKLCH tokens, and full
lock-in — overkill for an internal one-person back-office at this density.

### FullCalendar for the Agenda
Rejected in favour of Schedule-X: premium-gated resource/timeline views and no
native Tailwind theming (manual vendor-CSS overrides). Reconsider only if
iCal/Google two-way sync convenience ever outweighs the licence and theming tax.

### Tailwind Plus / Catalyst
Rejected: paid licence and built on Headless UI rather than Radix — it would fork
our primitive foundation for no gain over what we already run.

## Participants

- Pixel-Perfect Hugo (Frontend Engineer) — Argued to extend shadcn with TanStack Table,
  Recharts and dnd-kit so the new modules inherit the OKLCH tokens unchanged;
  kept every addition headless or Tailwind-native.
- Figma Fiona (UX/UI Designer) — Held the single-design-language line; swapped FullCalendar
  for Schedule-X to avoid vendor-CSS fighting the token system.
- Sprint Zero Sarah (Product Owner) — Anchored the call in the read-only/cards
  shape of the first module cut and the already-sunk shadcn cost; flagged the
  Mantine reconsideration point before Facturation/Compta.
- Devil's-Advocate Nora (Red-team) — Forced the honest naming of the maintenance
  tax and the "no lock-in" trade, killed Tremor as a runtime dependency, exposed
  FullCalendar's paid views, and steel-manned Mantine as the cheapest-now switch.

---
_Decision recorded automatically from fast-meeting analysis._
