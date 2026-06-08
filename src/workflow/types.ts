/**
 * Workflow engine — core primitives.
 *
 * Solopilot generalizes the current `cron -> run -> (collect | publish) -> notify`
 * pipeline into a declarative workflow engine. See docs/reimplementation-plan.md
 * and ADR-0013.
 *
 * This module defines the four primitives (Workflow, Trigger, Step, Run) only.
 * It is intentionally NOT wired into the scheduler yet — the existing collect /
 * publish crons keep running unchanged until the strangler-fig migration replays
 * them as `veille.collect` / `veille.digest` workflows (migration plan, Phase 1).
 */
import type { Config } from '../config.js';
import { logger } from '../logger.js';

export type ModuleId =
  | 'cockpit'
  | 'veille'
  | 'acquisition'
  | 'crm'
  | 'facturation'
  | 'compta'
  | 'agenda';

export type Trigger =
  | { kind: 'cron'; expr: string }
  | { kind: 'manual' }
  | { kind: 'event'; on: string }
  | { kind: 'webhook'; path: string };

/** A step reference inside a workflow definition. `use` names a registered step. */
export interface StepDef {
  use: string;
  with?: Record<string, unknown>;
}

export interface Workflow {
  /** Stable id, `<module>.<verb-or-object>`, e.g. 'facturation.relance-impayes'. */
  id: string;
  module: ModuleId;
  /** French label for the dashboard. */
  label: string;
  trigger: Trigger;
  steps: StepDef[];
  version: number;
  /** Rollout flag — new workflows ship disabled and are activated after validation. */
  enabled: boolean;
}

/**
 * Placeholder for the connector registry (sources, discord, email, stripe,
 * calendar, ai). Connectors land per-module in later phases; the shape is kept
 * open so steps can be authored against it incrementally without a hard break.
 */
export type ConnectorRegistry = Record<string, unknown>;

export interface StepContext {
  /** Tenancy scope — the activity (formerly product_id). */
  activityId: string;
  config: Config;
  log: typeof logger;
  connectors: ConnectorRegistry;
  /** Emit a domain event other workflows can trigger on. */
  emit: (event: string, payload: unknown) => void;
}

/**
 * A step is a typed orchestration unit. The engine passes the previous step's
 * output as the next step's input. A `degradable` step that throws is skipped
 * rather than failing the whole run (ADR-0013, graceful degradation).
 */
export interface Step<I = unknown, O = unknown> {
  use: string;
  degradable?: boolean;
  run: (ctx: StepContext, input: I) => Promise<O>;
}

export type StepStatus = 'ok' | 'skipped' | 'error';

export interface StepTrace {
  step: string;
  status: StepStatus;
  error?: string;
}

export type RunStatus = 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowRun {
  workflowId: string;
  activityId: string;
  trigger: Trigger['kind'];
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  trace: StepTrace[];
  error: string | null;
}
