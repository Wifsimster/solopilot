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
 * Connector registry — typed access to external systems from inside steps.
 *
 * Connectors land per-module across the migration phases. Phase 1 ships the
 * Discord connector (wrapping the existing notifier); sources, email, stripe,
 * calendar and ai connectors are added as their modules come online.
 */
export interface DiscordConnector {
  send(webhookUrl: string, content: string): Promise<{ success: boolean; error?: string }>;
}

/** Generic invoice shape exchanged with Stripe — kept core-side so modules depend on core, not the reverse. */
export interface StripeInvoiceData {
  stripe_id: string;
  number: string;
  client_name: string;
  client_email: string | null;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  issued_on: string;
  due_on: string;
  paid_on: string | null;
}

export interface StripeConnector {
  isConfigured(): boolean;
  /** Open/recent invoices from Stripe. Resolves to [] when not configured. */
  listInvoices(): Promise<StripeInvoiceData[]>;
}

export interface ConnectorRegistry {
  discord: DiscordConnector;
  stripe: StripeConnector;
}

export interface StepContext {
  /** Tenancy scope — the activity (formerly product_id). */
  activityId: string;
  config: Config;
  log: typeof logger;
  connectors: ConnectorRegistry;
  /** Emit a domain event other workflows can trigger on. */
  emit: (event: string, payload: unknown) => void;
}

/** The merged input bag a step receives: `def.with` overlaid with the previous step's output. */
export type StepInput = Record<string, unknown>;

/**
 * A step is an orchestration unit. The engine passes the previous step's output
 * (merged with the step's static `with`) as a generic input bag; steps narrow
 * it internally. A `degradable` step that throws is skipped rather than failing
 * the whole run (ADR-0013, graceful degradation).
 */
export interface Step<O = unknown> {
  use: string;
  degradable?: boolean;
  run: (ctx: StepContext, input: StepInput) => Promise<O>;
}

export type StepStatus = 'ok' | 'skipped' | 'error';

export interface StepTrace {
  step: string;
  status: StepStatus;
  error?: string;
}

export type RunStatus = 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowRun {
  /** DB row id, assigned by the run-store once persisted. */
  id?: number;
  workflowId: string;
  activityId: string;
  trigger: Trigger['kind'];
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  trace: StepTrace[];
  error: string | null;
}
