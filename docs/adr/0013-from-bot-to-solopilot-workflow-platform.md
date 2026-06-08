# 0013. From X AI Weekly Bot to Solopilot — a workflow-driven back-office

Date: 2026-06-08

## Status

Accepted

## Context

The product has been quietly outgrowing its name for months. ADR-0006 widened it
from a single-tenant news bot to a multi-product marketing engine; ADR-0007/0008
added Reddit and Hacker News sources; ADR-0009 through 0012 bolted on intent
signals, AI scoring, a content studio, and lead-reply drafting. The codebase
today already does far more than "scrape X, summarize, post to Discord" — yet it
still presents itself as a weekly Twitter bot.

The owner is a French _auto-entrepreneur_ (sole proprietor). What they actually
need is not "more marketing features" but a single back-office that runs the
recurring administrative work of a one-person company: veille, acquisition, CRM,
invoicing, accounting/URSSAF deadlines, and agenda — surfaced as one daily
briefing instead of seven disconnected tools.

Two observations make this tractable rather than a rewrite:

1. **The pipeline is already a workflow in disguise.** `cron-manager` →
   `run-service` → (`collect-service` | publish) → `discord-notifier`, with the
   `runs` table as the execution log, is a hard-coded two-step workflow. The
   shape — _trigger, steps, run history, notify_ — is exactly a workflow engine
   with N=1 workflow.

2. **The hard parts are reusable.** The cookie-based X scraper, the GitHub
   Models summarizer, the run tracking, the per-product config merge, and the
   React dashboard are not X-or-Discord-shaped. They are "fetch, enrich,
   decide, act, log" shaped. That is the substrate of every back-office process.

The environment also exposes the two connectors that unlock the administrative
domains the bot never touched: **Stripe** (invoicing, payments) and **Google
Calendar** (agenda). The opportunity is to generalize the engine and plug the
business modules on top.

## Decision

Rename the product to **Solopilot** and reframe it from "a bot" to "a
workflow-driven back-office for the company of one". Concretely:

### 1. Promote the hidden pipeline to a first-class workflow engine

Introduce a small in-process workflow runtime. No external job queue, no Redis —
the same posture as ADR-0006. The runtime has four concepts:

- **Workflow** — a named, versioned definition (e.g. `cockpit.daily-briefing`,
  `facturation.relance-impayes`). Declarative: a trigger + an ordered list of
  steps.
- **Trigger** — `cron` | `manual` | `event` | `webhook`. Today's two crons
  become two triggers; nothing else changes about scheduling.
- **Step** — a typed, composable unit with `(ctx, input) => output`. The
  built-in catalog starts as a refactor of what already exists:
  `fetch.sources`, `ai.summarize`, `ai.score`, `persist`, `notify.discord`,
  plus new ones: `notify.email`, `stripe.*`, `calendar.*`, `decide`.
- **Run** — an execution instance. This **is** today's `runs` table,
  generalized to `workflow_runs` with a `workflow_id` and a JSON `steps` trace.

```ts
interface Workflow {
  id: string;                 // 'facturation.relance-impayes'
  module: ModuleId;           // 'facturation'
  trigger: Trigger;           // { kind: 'cron', expr: '0 9 * * *' }
  steps: StepDef[];
  version: number;
}

interface StepDef { use: string; with?: Record<string, unknown>; }

interface StepContext {
  activityId: string;         // formerly product_id
  config: Config;
  log: Logger;
  connectors: ConnectorRegistry; // x, reddit, hn, discord, email, stripe, calendar, ai
}

type Step<I, O> = (ctx: StepContext, input: I) => Promise<O>;
```

The current `collect` and `publish` runs are re-expressed as two workflows
(`veille.collect`, `veille.digest`) with zero behavioural change. This is the
strangler-fig seam: the engine ships running exactly today's logic, then new
workflows land beside it.

### 2. Rename `Product` → `Activity` (conceptually), keep the schema

`products` becomes "activités" (business lines) in the UI and docs. The table
and `product_id` columns stay as-is to avoid a destructive migration; an
`activities` view/alias and UI relabel carry the rename. The `default` product
stays the migration anchor. (Full rename of the column is deferred — see
migration plan Phase 5.)

### 3. Organize features as modules, each a folder of workflows

| Module | Owns | Seed workflows |
|---|---|---|
| **Cockpit** | Daily briefing, the home screen | `cockpit.daily-briefing` |
| **Veille** | Source collection + AI digest (today's bot) | `veille.collect`, `veille.digest`, `veille.monthly` |
| **Acquisition** | Intent signals, content studio, lead replies (exists) | `acquisition.scan-intent`, `acquisition.draft-content` |
| **CRM** | Contacts, deals, interactions | `crm.followup-stale` |
| **Facturation** | Quotes, invoices, Stripe, reminders | `facturation.relance-impayes`, `facturation.sync-stripe` |
| **Comptabilité** | Revenue tracking, micro-entreprise thresholds, URSSAF deadlines | `compta.echeance-urssaf`, `compta.seuils` |
| **Agenda** | Google Calendar sync, reminders, time-blocking | `agenda.sync`, `agenda.rappels` |

New modules add tables (`contacts`, `deals`, `invoices`, `ledger`,
`calendar_events`) following the established idempotent `addColumnIfMissing` /
`CREATE TABLE IF NOT EXISTS` migration pattern in `db.ts`. All scoped by
`product_id` (activity).

### 4. Connectors generalize the adapters

`SourceReader` and the Discord notifier become entries in a `ConnectorRegistry`.
New connectors: `EmailNotifier`, `StripeConnector` (MCP), `CalendarConnector`
(Google Calendar MCP). The `ai-filter` becomes the `AiConnector` behind the
`ai.*` steps. This is the port roadmap ADR-0006 already anticipated, now
realized because the second and third implementations have arrived.

## What stays (non-negotiable continuity)

- **SQLite + WAL.** Volume is one-person scale. Postgres remains the "day we
  need concurrent writers" option, not today.
- **Single owner, no auth/RBAC.** Same as ADR-0006.
- **In-process orchestration.** The workflow runner is a `for`-loop over due
  workflows inside the existing cron ticks, with the existing concurrency
  guards generalized per-module.
- **No acting as the user without validation.** Drafts and reminders, never
  silent sends. Stripe invoices and calendar events created by a workflow are
  staged for one-click approval unless explicitly set to auto.
- **French user-facing, English code.** Unchanged.

## Consequences

### Positive

- Adding a business capability becomes "write a workflow", not "extend the
  monolith". The platform stops being feature-shaped and becomes capability-shaped.
- Today's deployment keeps running: `veille.collect` + `veille.digest` reproduce
  the current bot exactly, so the migration is behaviour-preserving on day one.
- The `runs` history, dashboard, config merge, and adapters are reused, not
  rewritten — same leverage ADR-0006 captured.
- Stripe and Calendar connectors turn the "marketing tool" into a genuine
  back-office, which is the actual unmet need.

### Negative / Risks

- **Scope explosion.** Seven modules is a lot. Mitigated by phasing (see
  migration plan): the engine + Cockpit + Facturation ship first; CRM, Compta,
  Agenda follow. Each module is independently shippable.
- **Compliance expectations.** Accounting features invite "is this URSSAF/TVA
  correct?" liability. Mitigated by positioning: Solopilot _reminds and
  prepares_, it does not télédéclare or certify. Stated in the vision and UI.
- **Connector fragility compounds.** The cookie-X risk from ADR-0006 now joins
  Stripe/Calendar token expiry. Mitigated by per-connector health checks
  surfaced in the cockpit, and workflows degrading gracefully (a dead connector
  skips its step, it does not fail the run).
- **AI cost grows with workflow count.** Same mitigation as ADR-0006:
  per-activity budget + caching, deferred until it hurts.

### Neutral

- `dev:once` keeps working — it runs a single named workflow instead of the
  hard-coded publish.
- The rename is staged: identity/docs first, infra (repo, GHCR, image tags)
  as a deliberate ops step, `product_id` column rename last.

## Explicitly NOT in scope for this ADR

- The actual implementation of any module beyond the engine seam — deferred to
  the reimplementation plan and per-module ADRs (0014+).
- Replacing SQLite, adding auth, external queues, or mobile apps.
- Certified accounting / direct URSSAF or impots.gouv télédéclaration.
- Auto-posting or auto-replying without human validation — rejected, same as
  ADR-0006.

## Alternatives Considered

### Keep bolting features onto the bot
Continue the ADR-0009..0012 trajectory: add invoicing as "just another page".
Rejected: the orchestration logic is already duplicated across collect/publish/
intent/studio, and each new domain would duplicate it again. The workflow engine
pays for itself by the third module.

### Adopt a real workflow engine (Temporal, n8n, Windmill)
Rejected for now: operationally heavy for a one-person, single-process, SQLite
deployment. The in-process runtime is ~300 lines and reuses the existing run
tracking. We revisit if we ever need durable, distributed, long-running
workflows — none of the seed workflows do.

### Build a separate new app and migrate data
Rejected: throws away the scraper, AI layer, dashboard, and run history that are
the moat. The strangler-fig (engine wraps current logic, new workflows land
beside) is lower risk and ships value continuously.

### Rename to a generic "Workspace/ERP" framing
Rejected: too broad, invites multi-user/ERP expectations we explicitly refuse.
"The company of one" is the precise, honest framing.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed for the strangler-fig seam:
  ship the engine running today's exact logic before adding any new workflow;
  vetoed a from-scratch rewrite.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed the in-process runtime
  over Temporal/n8n for a single-process SQLite deployment; defined Workflow /
  Trigger / Step / Run as the four primitives.
- Sprint Zero Sarah (Product Owner) — Cut scope to a phased rollout (Engine +
  Cockpit + Facturation first); insisted on the "reminds, never télédéclare"
  compliance positioning.
- Edge-Case Nico (QA Engineer) — Flagged connector token expiry (Stripe/Calendar
  joining the cookie-X risk) and required graceful per-step degradation so one
  dead connector cannot fail a whole run.

---
_Decision recorded automatically from fast-meeting analysis._
