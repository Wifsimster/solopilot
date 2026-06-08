# 0017. Comptabilité — micro-entreprise thresholds and URSSAF reminders

Date: 2026-06-08

## Status

Accepted

## Context

For a French auto-entrepreneur, the two recurring accounting anxieties are
"am I about to blow through the micro-entreprise ceiling (or the VAT-franchise
threshold)?" and "have I declared my turnover to URSSAF this period?". Both are
deadline- and threshold-driven, which is exactly what a workflow platform is
good at. This is the fourth module and the most differentiating for the target
user, following Cockpit and Facturation.

The hard constraint is **liability**. Accounting features invite "is this
correct/official?" expectations. Per ADR-0013, Solopilot reminds and prepares —
it must not present itself as authoritative, must not télédéclare, and must not
replace an accountant.

## Decision

Add a `compta` module computing turnover, thresholds and URSSAF estimates from
existing data, surfaced as reminders. Everything is explicitly an **estimate**.

### Turnover (CA) on encaissements

Micro turnover is cash-based, so CA = paid invoices (`sumPaidInvoicesCents`,
added to the facturation store) **+** manual `recette` entries in a new `ledger`
table. The plafond is assessed on the **calendar year**.

### Thresholds & rates as constants

Published micro-entreprise values live as constants keyed by activity type
(`services_bnc | services_bic | vente`): plafond, TVA-franchise threshold, and a
social-contribution rate in basis points. They are easy to update when the law
changes. Activity type and declaration period (`monthly | quarterly`) are stored
per activity in `product_settings` (no schema churn).

### Computations (`modules/comptabilite/compta.ts`)

- `comptaStatus` — year CA, plafond %, TVA %, `approachingPlafond` (≥80%),
  `tvaExceeded`.
- `urssafDeclaration` — CA of the period that just closed (handles monthly and
  quarterly, including year boundaries) and an estimated contribution amount.
- Deterministic French renderers for the alert and the reminder, both stamped as
  estimates.

### Workflows (`enabled: false`)

- `compta.seuils` (weekly) — `[compta.seuils, notify.discord]`; the step emits
  `content: null` when below threshold, so `notify.discord` quietly skips (no
  spam).
- `compta.echeance-urssaf` (monthly) — `[compta.echeance, notify.discord]`.

### Surfacing

- API: `GET /api/comptabilite` (status + urssaf + config), `GET/POST
  /api/comptabilite/ledger`, `POST /api/comptabilite/config`.
- UI: `/comptabilite` page with plafond and TVA gauges and the next URSSAF
  estimate, under the "Gérer" nav section.
- Cockpit: compta flips `planned → live`, surfacing CA % of plafond (and a
  warning when approaching/over).

## Consequences

### Positive

- Closes the two real accounting anxieties with zero new infrastructure —
  computed from invoices + a tiny ledger.
- Cockpit now aggregates three live modules; the daily brief is genuinely the
  company-of-one picture.
- Thresholds/rates centralised as constants — a one-line change per legal update.

### Negative / Risks

- **Rates/thresholds drift with the law and are approximations.** Mitigated by
  the explicit "estimate" stamping everywhere and the "not a substitute for an
  accountant / no télédéclaration" positioning, stated in the UI and renderers.
- **CA double-counting risk** if a user logs a manual `recette` for revenue that
  is also an invoice. Documented; the ledger is for non-invoiced revenue. A
  reconciliation view is a later refinement.
- **VAT logic is threshold-only** (franchise crossing), not full VAT accounting —
  intentionally out of scope.

### Neutral

- Quarterly/monthly period math handles year boundaries; first real declaration
  should be eyeballed once against URSSAF.

## Explicitly NOT in scope

- Télédéclaration or any filing — reminders only.
- Authoritative/audited figures, full VAT accounting, expense deductibility.
- Enabling/scheduling the workflows — part of the deferred flip.

## Alternatives Considered

### Pull CA from a bank/accounting integration
Rejected for now: heavy, and invoices + manual ledger already give an accurate
encaissements figure for the micro regime. Bank sync is a future option.

### Hardcode one activity type
Rejected: vente vs services have very different plafonds and rates; per-activity
config is one `product_settings` key and worth it.

### AI-generated accounting advice
Rejected: liability. Deterministic computation against published constants is
defensible; AI "advice" is not, here.

## Participants

- SOLID Alex (Senior Backend Engineer) — Computed CA from paid invoices + a thin
  ledger rather than a new accounting engine; centralised thresholds as constants.
- Whiteboard Damien (Tech Lead / Architect) — Stored activity type/period in
  `product_settings` to avoid schema churn; handled quarter/year-boundary math.
- Sprint Zero Sarah (Product Owner) — Enforced the "estimate / not authoritative /
  no télédéclaration" positioning across UI and renderers; cut VAT to
  threshold-only.
- Edge-Case Nico (QA Engineer) — Covered CA aggregation, plafond switching by
  activity, and the no-alert path in the smoke test; flagged manual/invoice
  double-counting for a future reconciliation view.

---
_Decision recorded automatically from fast-meeting analysis._
