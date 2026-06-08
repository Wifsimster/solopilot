# 0014. Workflow engine — in-process runtime

Date: 2026-06-08

## Status

Accepted

## Context

[ADR-0013](0013-from-bot-to-solopilot-workflow-platform.md) decided to promote
the hard-coded `cron → run → (collect | publish) → notify` pipeline into a
generic workflow engine, as the substrate for Solopilot's business modules. This
ADR records the concrete runtime that was built, and the constraints that shaped
it.

The non-negotiable was continuity: production runs today's bot, so the engine
had to land **without changing any observable behaviour**. The strategy is
strangler-fig — ship the engine, register the veille workflows as definitions,
but keep them `enabled: false` and leave the existing crons driving production
until a later, deliberate flip.

## Decision

Build a small, in-process, synchronous workflow runtime under `src/workflow/`,
reusing the existing SQLite/logging/config substrate. No external queue, no new
process — same posture as ADR-0006.

### Four primitives (`types.ts`)

- **Workflow** — `{ id, module, label, trigger, steps, version, enabled }`. A
  declarative definition; `enabled` is the rollout flag.
- **Trigger** — `cron | manual | event | webhook`. Only `cron` and `manual` are
  wired in Phase 1.
- **Step** — `{ use, degradable?, run(ctx, input) }`. The engine passes a single
  merged **input bag** (`def.with` overlaid with the previous step's output) and
  the step narrows it internally. Dropping per-step input generics removed a
  contravariance dead-end and made the registry trivially typeable.
- **Run** — `WorkflowRun`, persisted to `workflow_runs`.

### Engine (`engine.ts`) — pure orchestration

Runs steps in sequence, threading each output into the next, recording a
per-step trace. **Graceful degradation**: a `degradable` step that throws is
recorded as `skipped` and execution continues; a non-degradable throw aborts the
run as `error`; an unknown `use` aborts as `error`. The engine touches no I/O
beyond the steps themselves — it is unit-testable in isolation.

### Runner (`runner.ts`) — the bridge

Resolves the workflow, opens a `workflow_runs` row, builds the `StepContext`
(config + connectors + logger + `emit`), invokes the engine, and closes the run.
Enforces a **per-`(module, activity)` concurrency guard** — the generalization of
the global `publishRunning` / `collectRunning` flags. A defensive outer
try/catch records infrastructure failures so a run is never left stuck in
`running`.

### Persistence (`run-store.ts` + `db.ts`)

A new `workflow_runs` table (idempotent migration, `CREATE TABLE IF NOT EXISTS`,
same pattern as every other migration). The legacy `runs` table is left
untouched; the two coexist during migration. The trace is stored as JSON.
`recoverStaleWorkflowRuns()` mirrors the existing stale-run recovery on boot.

### Connectors (`connectors.ts`) and steps (`src/steps/`)

`buildConnectors(config)` returns a typed `ConnectorRegistry`; Phase 1 wires only
Discord, by delegating to the existing notifier. The base steps are thin
strangler-fig wrappers over existing services — `fetch.sources` → `collectTweets`,
`ai.summarize` → `createAIFilter().filterAndSummarize`, `notify.discord` →
connector, `persist` → pass-through (collection already stores). No business
logic is reimplemented; it is re-exposed.

### Registration & scheduling (`bootstrap.ts`, `scheduler.ts`)

`registerSolopilot()` registers steps and workflow definitions idempotently.
`scheduleWorkflows(config)` schedules only `enabled` cron workflows via node-cron
(Europe/Paris). Because every workflow ships disabled, calling it is a no-op
today — and it is **not yet invoked from the production entrypoint**, so the
existing `cron-manager` remains the sole driver of production.

### Verification

A smoke test (`npm run test:workflow`, `scripts/workflow-smoke.mjs`) exercises
the runtime against a throwaway SQLite DB — 21 assertions covering sequencing,
graceful degradation, fatal and unknown-step failures, run persistence and JSON
trace, listing, and that `registerSolopilot()` makes every veille step resolve
while all veille workflows remain disabled.

## Consequences

### Positive

- The engine is real, typed (strict), linted, and tested end-to-end, yet
  production behaviour is provably unchanged (workflows disabled, prod scheduler
  untouched).
- New capabilities are now "register a step + a workflow", not "edit the
  monolith". The base step catalog already covers fetch / summarize / notify.
- The `workflow_runs` log + trace gives per-step observability the legacy `runs`
  table never had.

### Negative / Risks

- **Two run tables (`runs` + `workflow_runs`) coexist** during migration. Mild
  duplication; resolved when veille flips to workflows and the legacy publish
  path retires (Phase 5).
- **`persist` is currently a pass-through**, because `fetch.sources` stores
  inside `collectTweets`. Honest but slightly hollow; gains a body when fetch is
  split into pure fetch + explicit store.
- **Synchronous, single-process** runtime cannot do durable long-running or
  retried workflows. None of the seed workflows need that; revisit if one does.

### Neutral

- `emit` exists on the context but only logs today — event triggers are
  scaffolded, not yet dispatched.

## Explicitly NOT in scope

- Flipping `veille.*` to `enabled: true`, wiring `scheduleWorkflows()` into the
  entrypoint, and retiring the legacy crons — the behaviour-changing step,
  deferred to its own change once the engine has soaked.
- Dashboard/API surfacing of `workflow_runs` — follow-up.
- Any new module (Cockpit, Facturation, …) — ADR-0015+.

## Alternatives Considered

### Per-step input/output generics on `Step<I, O>`
Rejected: made the registry (`Map<string, Step>`) untypeable without `any` due to
input contravariance. A single generic input bag is simpler and matches how the
engine actually threads data.

### Reuse the `runs` table for workflow runs
Rejected: `runs` is shaped around tweets (`tweets_fetched`, `thread_ids`,
`notification_status`). A workflow-shaped `workflow_runs` with a generic JSON
trace is cleaner and avoids overloading a table the legacy path still writes.

### Wire the scheduler into production now
Rejected: violates the continuity invariant. The engine soaks disabled first; the
flip is a separate, reviewable change.

## Participants

- SOLID Alex (Senior Backend Engineer) — Implemented the steps as strangler-fig
  wrappers over existing services rather than reimplementations; insisted the
  prod scheduler stay untouched.
- Whiteboard Damien (Tech Lead / Architect) — Collapsed `Step<I, O>` to a single
  input bag after the registry typing dead-end; kept `runs` and `workflow_runs`
  separate during migration.
- Sprint Zero Sarah (Product Owner) — Held the line that `veille.*` stays
  `enabled: false` this phase; the flip is its own deliverable.
- Edge-Case Nico (QA Engineer) — Wrote the 21-assertion smoke test; required the
  defensive outer try/catch in the runner so no run is left stuck in `running`.

---
_Decision recorded automatically from fast-meeting analysis._
