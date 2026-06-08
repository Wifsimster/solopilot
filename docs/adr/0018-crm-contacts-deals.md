# 0018. CRM — contacts, pipeline and stale-deal follow-ups

Date: 2026-06-08

## Status

Accepted

## Context

The Acquisition module surfaces intent signals and lead replies, but there was
nowhere to track a relationship once it started: who the contacts are, which
opportunities are open, and which ones have gone quiet. This is the fifth module
(migration plan Phase 4), and the natural home for leads once they are qualified.

Same invariants as every phase: additive, non-regressive, single-owner, and no
action taken on the user's behalf without validation.

## Decision

Add a `crm` module: contacts, a deal pipeline, interactions, and a stale-deal
follow-up workflow.

### Data (`db.ts`)

Three idempotent tables scoped by `product_id`: `contacts`, `deals` (with a
`stage` and `amount_cents`), and `interactions`. Timestamps are epoch
milliseconds; `deals.updated_at` is the staleness clock.

### Store (`modules/crm/store.ts`)

CRUD for contacts and deals, `updateDealStage` (sets `closed_at` on
gagne/perdu), `addInteraction`, and the two derived reads that matter:
`listStaleDeals` and `crmSummary` (open count, open value, stale count).

**Staleness** = an open-stage deal (`nouveau | qualifie | proposition`) whose
`updated_at` is older than 14 days. Logging an interaction or moving a stage
bumps `updated_at`, so activity naturally resets the clock. `listStaleDeals`
takes an injectable `now` — which makes it testable without backdating rows.

### Follow-ups (`modules/crm/followup.ts`)

`draftFollowup(staleDeal)` produces a **deterministic French** message per stale
deal — staged for validation, never sent. `summarizeFollowups` returns `null`
when nothing is stale, so the notifier quietly skips.

### Workflow (`enabled: false`)

`crm.followup-stale` (weekly) = `[crm.followup, notify.discord]`.

### Surfacing

- API: contacts/deals/interactions CRUD, `POST /api/crm/deals/:id/stage`, and
  `GET /api/crm/relances` (staged previews).
- UI: `/crm` page with a five-column pipeline and a contacts list, under the
  "Engager" nav section.
- Cockpit: crm flips `planned → live`, surfacing open and stale deal counts.

With this, every business module the Cockpit references (veille, acquisition,
facturation, compta, crm) is live; only Agenda remains planned.

## Consequences

### Positive

- Closes the loop from Acquisition (leads) to a tracked relationship and
  pipeline, with a built-in "you've gone quiet on these" safety net.
- Staleness via injectable `now` is cleanly unit-tested.
- Cockpit is now a near-complete company-of-one picture.

### Negative / Risks

- **Lead → contact promotion is not automated yet** (no event dispatch). Manual
  for now; `crm.promote-lead` lands when the event bus does.
- **Staleness is time-only**, not value- or stage-weighted. Good enough; can be
  refined.
- **No de-duplication of contacts.** One person, low volume — acceptable; revisit
  if it bites.

### Neutral

- The existing `/leads` page (Acquisition) and the new `/crm` page coexist; merging
  them is a later UX decision.

## Explicitly NOT in scope

- Sending follow-ups automatically — staged only.
- Automated lead→contact promotion (needs the event bus).
- Email/calendar sync on contacts — Agenda module (ADR-0019).
- Enabling/scheduling the workflow — part of the deferred flip.

## Alternatives Considered

### Track staleness via the interactions table (last interaction date)
Rejected as the primary mechanism: a denormalized `deals.updated_at` bumped on
interaction/stage-change is simpler to query and index, and the injectable `now`
keeps it testable. Interactions still record the history.

### Reuse the Acquisition `leads`/intent tables as the CRM
Rejected: intent signals are source-scoped, ephemeral marketing data; contacts
and deals are durable relationship data with a different lifecycle. Promotion
(later) bridges them.

### Full Kanban with drag-and-drop now
Rejected for this phase: a read pipeline + stage endpoint delivers the value; the
drag-and-drop UI is a follow-up.

## Participants

- SOLID Alex (Senior Backend Engineer) — Denormalized `updated_at` as the
  staleness clock bumped by interactions/stage moves; injectable `now` for tests.
- Whiteboard Damien (Tech Lead / Architect) — Kept contacts/deals separate from
  Acquisition's intent tables; deferred the event-driven lead promotion.
- Sprint Zero Sarah (Product Owner) — Held "staged follow-ups, never sent";
  scoped the pipeline to a read view + stage endpoint, deferred drag-and-drop.
- Edge-Case Nico (QA Engineer) — Covered fresh-vs-stale, interaction reset, and
  the won-deal-leaves-pipeline path; flagged missing contact de-duplication.

---
_Decision recorded automatically from fast-meeting analysis._
