# 0020. The veille flip — running production through the workflow engine

Date: 2026-06-08

## Status

Accepted

## Context

The workflow engine (ADR-0014) shipped running disabled while the legacy crons
(`cron-manager` → `triggerCollect` / `triggerRun`) drove production veille. With
all six business modules now live, the final migration item is the "flip":
making the engine the execution path for veille, so production runs are recorded
as `workflow_runs` and the engine — not a hard-coded pipeline — is the system of
record.

The catch: production is deployed and working, and the legacy path has subtle,
correct behaviour we must not regress — per-product iteration, three-layer config
merge, hot reschedule from the UI, separate collect/publish concurrency guards,
and the in-publish collect sweep. A naive "replace cron-manager" risks all of it.

## Decision

Flip by **routing the existing cron dispatch through the engine**, gated behind a
default-off flag — not by replacing the scheduler.

### Behaviour-preserving delegation

Two new steps delegate to the exact legacy services:

- `veille.collect-run` → `triggerCollect(ctx.config, activityId)`
- `veille.publish-run` → `triggerRun(ctx.config, 'cron', activityId)`

The veille workflows become `veille.collect = [veille.collect-run]` and
`veille.digest = [veille.publish-run]` (`enabled: true`). Because the same
services are called with the same already-merged config and product, the runs
table, AI summary, Discord notification and tweet bookkeeping are **identical** —
the engine just adds a `workflow_runs` trace on top.

### The flag

`cron-manager` keeps ownership of scheduling, per-product iteration, config
merge, and hot reschedule. Only its dispatch changes:

```
WORKFLOW_SCHEDULER=true  → runWorkflowById('veille.collect'|'veille.digest', …)
default                  → triggerCollect / triggerRun   (unchanged)
```

So production behaviour is **byte-identical by default**; the flip is opt-in via
one env var, reversible by unsetting it.

### No double-guarding

`triggerCollect`/`triggerRun` already own the `collectRunning`/`publishRunning`
guards. The runner's per-`(module, activity)` guard would *over*-serialize collect
vs digest (both module `veille`) and could skip a digest that overlaps a collect
— a regression. So the flip dispatches with `guard: false`, relying on the
services' own, correct guards. The runner gained a `guard?: boolean` option
(default true) for exactly this.

### dev:once for workflows

`node dist/workflow/cli.js <id>` (`npm run workflow -- <id>`) runs any workflow
once, closing the migration-plan item.

## Consequences

### Positive

- Production veille can run entirely through the engine with **zero behavioural
  change**, observable in `workflow_runs` and the `/workflows` UI.
- The flip is a one-variable, reversible decision — safe to enable, observe, and
  roll back.
- cron-manager's hard-won behaviour (per-product, config merge, reschedule) is
  fully preserved because it is reused, not rewritten.

### Negative / Risks

- **Two run logs while flipped** (`runs` + `workflow_runs`) — the legacy `runs`
  table still drives the dashboard; `workflow_runs` is the engine trace.
  Consolidation is Phase 5.
- **The veille workflows' hard-coded cron exprs are ignored** in production (the
  scheduler injects the configured CRON/COLLECT schedules). The exprs are
  defaults for the generic scheduler / CLI only. Documented to avoid confusion.
- `enabled: true` on the veille workflows means the registry/API shows them
  active even when the flag is off and they are dispatched by cron-manager rather
  than the generic scheduler. Acceptable: "enabled" means runnable; scheduling is
  separate.

### Neutral

- Default deployments are unaffected until the owner sets `WORKFLOW_SCHEDULER`.

## Explicitly NOT in scope

- Retiring the legacy `runs` table / cron-manager, and the `product_id` →
  `activity_id` rename — Phase 5 consolidation, once the flip has soaked.
- Per-product schedule overrides and event/webhook triggers — future.

## Alternatives Considered

### Replace cron-manager with a workflow-native scheduler
Rejected (for now): re-implements per-product iteration, three-layer config
merge, and hot reschedule — high risk for no behavioural gain. Reuse beats
rewrite; revisit in Phase 5 once the flip is proven.

### Decompose veille into pure steps (fetch → ai → notify)
Rejected as the production path: the pure decomposition never reproduced
`triggerRun` exactly (tweet mark-as-used, runs tracking, notification_status).
Delegation is the only behaviour-preserving flip. The pure steps remain
registered as building blocks.

### Flip on by default
Rejected: changing a deployed production hot path without an observation window
is irresponsible. Default off, opt-in, reversible.

## Participants

- SOLID Alex (Senior Backend Engineer) — Insisted on delegation over
  decomposition for behaviour parity; added the runner `guard: false` to avoid
  over-serializing collect vs digest.
- Whiteboard Damien (Tech Lead / Architect) — Kept cron-manager as scheduler and
  flipped only the dispatch; deferred the scheduler rewrite to Phase 5.
- Sprint Zero Sarah (Product Owner) — Required the flag default-off with an
  observation window; reversible by one env var.
- Edge-Case Nico (QA Engineer) — Caught the collect/digest guard-collision
  regression; covered the delegating workflows end-to-end against the temp DB.

---
_Decision recorded automatically from fast-meeting analysis._
