# 0016. Facturation — local ledger with optional Stripe sync

Date: 2026-06-08

## Status

Accepted

## Context

Invoicing is the highest-ROI administrative chore for an auto-entrepreneur: an
unpaid invoice forgotten is revenue lost. The migration plan put Facturation
right after the Cockpit (Phase 3). The environment exposes a Stripe connector,
but the production app must not _depend_ on Stripe being configured — many
activities invoice by hand, and boot must never require a Stripe key.

The continuity invariant holds: additive, non-regressive, and (per ADR-0013)
Solopilot never acts on the user's behalf without validation — so no invoice is
sent and no reminder is emailed automatically.

## Decision

Build Facturation as a **local invoice ledger** that works standalone, with
Stripe as an **optional read-only sync** that degrades gracefully when absent.

### Data (`db.ts`)

One idempotent `invoices` table, scoped by `product_id`, with a partial unique
index on `stripe_id` (so Stripe upserts are idempotent and manual invoices —
`stripe_id NULL` — are unconstrained). No destructive migration.

### Store (`modules/facturation/store.ts`)

CRUD over the ledger: `createInvoice` (auto-numbered `F-YYYY-NNN`, parses its
input through the Zod schema so defaults always apply), `listInvoices`,
`getInvoice`, `markInvoicePaid`, `listOverdueInvoices` (sent + past due), a
`facturationSummary` (unpaid/overdue/overdue-amount) for the cockpit, and an
idempotent `upsertStripeInvoices`.

### Reminders (`modules/facturation/relance.ts`)

`draftRelance(invoice, today)` produces a **deterministic French reminder** per
overdue invoice — no AI call, fully reproducible. Drafts are **staged, never
sent**. An AI-composed, voice-matched variant can land later behind `ai.compose`.

### Stripe connector (`connectors/stripe.ts`)

Reads `STRIPE_API_KEY` from config (new optional field). `isConfigured()` is
false when absent and `listInvoices()` resolves to `[]`; when present it reads
the Stripe REST `/v1/invoices` endpoint and maps to the core `StripeInvoiceData`
shape. Read-only: Solopilot never creates or sends on Stripe. To keep the
core/module dependency direction clean, the exchanged shape lives in
`workflow/types.ts`, not in the module.

### Workflows (`modules/facturation/workflows.ts`)

- `facturation.relance-impayes` = `[facturation.relance, notify.discord]`, cron
  `0 9`, `enabled: false`. Stages reminders and pushes a summary for validation.
- `facturation.sync-stripe` = `[facturation.sync]`, cron `0 */6`, `enabled:
  false`. The sync step is **degradable** and a no-op when Stripe is absent, so
  a Stripe outage can never fail a run.

### Surfacing

- API: `GET/POST /api/facturation/invoices`, `POST /api/.../:id/paid`,
  `GET /api/facturation/relances` (staged previews).
- UI: `/facturation` page (invoice list + staged reminders) under a new "Gérer"
  nav section.
- Cockpit: facturation flips from `planned` to `live`, surfacing overdue count
  and amount in the daily brief.

## Consequences

### Positive

- Works the day it ships, with zero external setup — Stripe is a bonus, not a
  prerequisite.
- The overdue-reminder loop closes the "forgotten unpaid invoice" gap, the
  module's whole reason to exist.
- Cockpit now aggregates a second live module, proving the cross-module brief.

### Negative / Risks

- **The Stripe REST mapping is unverified against a live account** (no key in
  CI). Mitigated: it runs only when configured, behind a degradable step, and is
  covered structurally; first real use should be validated manually.
- **Numbering `F-YYYY-NNN` is per-activity, count-based.** Fine for one person;
  not a legally-audited sequence. Solopilot prepares, it is not a certified
  invoicing system (stated positioning).

### Neutral

- `markInvoicePaid` is manual today; Stripe sync will reconcile paid status once
  a key is configured.

## Explicitly NOT in scope

- Sending invoices or emailing reminders automatically — staging only.
- Creating invoices _on_ Stripe — read-only sync this phase.
- Quotes (`devis`), credit notes, VAT handling — later.
- Enabling the workflows / scheduling — part of the deferred flip.

## Alternatives Considered

### Stripe as the source of truth (no local table)
Rejected: would make Stripe a hard dependency and break hand-invoicing
activities. Local ledger first, Stripe as optional sync.

### Stripe SDK dependency
Rejected for now: a guarded `fetch` against the REST API avoids a new dependency
and keeps the no-key path dependency-free. Adopt the SDK if the integration
grows.

### AI-composed reminders now
Rejected: deterministic French drafts are free, reproducible, and enough.
AI tone-matching is a later enhancement, not a blocker.

## Participants

- SOLID Alex (Senior Backend Engineer) — Made the ledger standalone and Stripe a
  degradable optional sync; parsed create-input inside `createInvoice` so
  defaults always apply.
- Whiteboard Damien (Tech Lead / Architect) — Put the exchanged Stripe shape in
  core to keep modules depending on core; partial unique index on `stripe_id`.
- Sprint Zero Sarah (Product Owner) — Held "staged, never sent" and the
  "prepares, not a certified invoicing system" positioning; deferred devis/VAT.
- Edge-Case Nico (QA Engineer) — Required the sync step be degradable and a
  no-op without a key; flagged the unverified live-Stripe mapping for manual
  validation on first real use.

---
_Decision recorded automatically from fast-meeting analysis._
