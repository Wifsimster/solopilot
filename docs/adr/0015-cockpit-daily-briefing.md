# 0015. Cockpit — the single daily briefing

Date: 2026-06-08

## Status

Accepted

## Context

[ADR-0013](0013-from-bot-to-solopilot-workflow-platform.md) framed Solopilot
around one promise: "the morning, I open one screen, read one brief, and my
admin for the day is set". The workflow engine (ADR-0014) gave us the runtime;
the Cockpit is the first module that delivers that promise to the user, and the
first genuinely new capability built _on_ the engine rather than wrapped from the
legacy bot.

The constraint is the same as every phase: additive and non-regressive. Today
only Veille and Acquisition hold real data; Facturation, Comptabilité and Agenda
do not exist yet. The Cockpit must show the whole company-of-one picture without
fabricating data for modules that aren't built.

## Decision

Add a `cockpit` module with one read-only aggregation and one workflow.

### Aggregation (`modules/cockpit/briefing.ts`)

`buildBriefing(activityId)` reads existing stores **read-only** and returns a
structured `Briefing`:

- **veille** — last run (date/status/summary) + pending unpublished items.
- **acquisition** — count of `new` intent signals.
- **facturation / compta / agenda** — `{ status: 'planned' }`. Honest
  placeholders so the cockpit shows the roadmap, not fake numbers.
- **workflows** — recent `workflow_runs` health, counted by status.

`renderBriefingText(briefing)` turns it into French markdown **deterministically
— no AI call**, so the daily brief is free and reproducible. An AI-composed
variant can land later behind its own step.

### Workflow (`modules/cockpit/workflows.ts`)

`cockpit.daily-briefing` = `[cockpit.aggregate, notify.discord]`, cron `30 7`,
`enabled: false`. It composes the new `cockpit.aggregate` step (which exposes
`content` for the notifier) with the existing `notify.discord`. No new connector,
no AI, fully testable.

### Surfacing

- **API** — `GET /api/cockpit` returns the briefing (read-only).
- **UI** — a `/cockpit` page: a Veille card (digest excerpt + pending), an
  Acquisition card (new leads), a Workflows-health card, and `planned` cards for
  the three future modules. Added to the nav under "Monitorer".

## Consequences

### Positive

- First tangible "go-to" surface: one screen, one brief, the whole activity.
- Pure aggregation + deterministic render → no AI cost, trivially unit-testable
  (covered by the workflow smoke test).
- The `planned` placeholders make the product roadmap visible in the product
  itself, setting expectations honestly.

### Negative / Risks

- **Aggregation reads several stores per request.** Fine at one-person volume;
  if it ever grows, cache the briefing per activity per day.
- **The brief is a snapshot, not yet scheduled.** `cockpit.daily-briefing` ships
  disabled; the morning push only goes live with the scheduler flip.

### Neutral

- The legacy `/` Dashboard stays; Cockpit is a sibling page for now. Whether
  Cockpit becomes the home screen is a later UX call.

## Explicitly NOT in scope

- Enabling/scheduling `cockpit.daily-briefing` — part of the deferred flip.
- AI-composed briefings — deterministic render is enough today.
- Any real facturation/compta/agenda data — those are their own modules
  (ADR-0016+).

## Alternatives Considered

### AI-summarize the briefing
Rejected for now: a deterministic markdown render is free, reproducible, and
sufficient. AI composition adds cost and nondeterminism for marginal gain at this
stage.

### Replace the home Dashboard with the Cockpit
Rejected this phase: more invasive, and the Dashboard still serves its purpose.
Promote Cockpit to home once it carries real cross-module data.

### Store briefings in a table
Rejected: the briefing is derived from existing stores; persisting it would
duplicate state. Recompute on read; persist only if a historical brief view is
ever needed.

## Participants

- SOLID Alex (Senior Backend Engineer) — Kept aggregation read-only over existing
  stores and the render deterministic; refused to persist derived state.
- Whiteboard Damien (Tech Lead / Architect) — Composed the workflow from existing
  steps (`cockpit.aggregate` → `notify.discord`) rather than a bespoke pipeline.
- Sprint Zero Sarah (Product Owner) — Required `planned` placeholders so the
  roadmap shows in-product; deferred making Cockpit the home screen.
- Edge-Case Nico (QA Engineer) — Extended the smoke test to cover briefing
  build, render, and cockpit workflow composability; flagged the per-request
  read cost as a future caching point.

---
_Decision recorded automatically from fast-meeting analysis._
