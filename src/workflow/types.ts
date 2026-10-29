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

export interface StepDef {
  use: string;
  with?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  module: ModuleId;
  label: string;
  trigger: Trigger;
  steps: StepDef[];
  version: number;
  enabled: boolean;
}

export interface DiscordConnector {
  send(webhookUrl: string, content: string): Promise<{ success: boolean; error?: string }>;
}

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
  listInvoices(): Promise<StripeInvoiceData[]>;
}

export interface CalendarEventData {
  external_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
}

export interface CalendarConnector {
  isConfigured(): boolean;
  listUpcoming(): Promise<CalendarEventData[]>;
}

export interface GithubIssuesConnector {
  isConfigured(): boolean;
  createIssue(
    owner: string,
    repo: string,
    issue: { title: string; body: string },
  ): Promise<{ number: number; url: string; labeled: boolean }>;
}

export interface ConnectorRegistry {
  discord: DiscordConnector;
  stripe: StripeConnector;
  calendar: CalendarConnector;
  githubIssues: GithubIssuesConnector;
}

export interface StepContext {
  activityId: string;
  config: Config;
  log: typeof logger;
  connectors: ConnectorRegistry;
  emit: (event: string, payload: unknown) => void;
}

export type StepInput = Record<string, unknown>;

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
