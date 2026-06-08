/**
 * Workflow runner.
 *
 * Bridges the pure engine to the rest of the app: resolves a workflow, builds a
 * StepContext (config + connectors), persists the run to `workflow_runs`, and
 * enforces a per-(module, activity) concurrency guard — the generalization of
 * the existing `publishRunning` / `collectRunning` guards (ADR-0013).
 */
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { DEFAULT_PRODUCT_ID } from '../db.js';
import { runWorkflow } from './engine.js';
import { getWorkflow } from './registry.js';
import { buildConnectors } from './connectors.js';
import { openWorkflowRun, closeWorkflowRun } from './run-store.js';
import type { StepContext, Trigger, WorkflowRun } from './types.js';

/** key = `${module}:${activityId}` — one workflow per module per activity at a time. */
const moduleGuards = new Map<string, boolean>();

export interface RunWorkflowOptions {
  config: Config;
  activityId?: string;
  trigger?: Trigger['kind'];
  /**
   * Apply the per-(module, activity) concurrency guard. Default true. Set false
   * when the delegated work already has its own guard (e.g. the veille flip,
   * where triggerCollect/triggerRun guard themselves) to preserve exact
   * behaviour and avoid over-serializing collect vs digest (ADR-0020).
   */
  guard?: boolean;
}

export class WorkflowBusyError extends Error {}
export class UnknownWorkflowError extends Error {}

export async function runWorkflowById(
  workflowId: string,
  options: RunWorkflowOptions,
): Promise<WorkflowRun> {
  const wf = getWorkflow(workflowId);
  if (!wf) {
    throw new UnknownWorkflowError(`Unknown workflow: ${workflowId}`);
  }

  const activityId = options.activityId ?? DEFAULT_PRODUCT_ID;
  const trigger = options.trigger ?? 'manual';
  const useGuard = options.guard ?? true;
  const guardKey = `${wf.module}:${activityId}`;

  if (useGuard) {
    if (moduleGuards.get(guardKey) === true) {
      throw new WorkflowBusyError(`A ${wf.module} workflow is already running for ${activityId}`);
    }
    moduleGuards.set(guardKey, true);
  }

  const runId = openWorkflowRun(wf.id, activityId, trigger);

  const ctx: StepContext = {
    activityId,
    config: options.config,
    log: logger,
    connectors: buildConnectors(options.config),
    emit: (event, payload) => logger.debug('Workflow event emitted', { event, workflow: wf.id, payload }),
  };

  try {
    const run = await runWorkflow(wf, ctx, { trigger });
    run.id = runId;
    closeWorkflowRun(runId, run);
    return run;
  } catch (err) {
    // Defensive: the engine catches step errors itself, so reaching here means
    // an infrastructure failure. Record it rather than leaving a stuck run.
    const message = err instanceof Error ? err.message : String(err);
    const failed: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      activityId,
      trigger,
      status: 'error',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      trace: [],
      error: message,
    };
    closeWorkflowRun(runId, failed);
    logger.error('Workflow runner failed', { workflow: wf.id, message });
    return failed;
  } finally {
    if (useGuard) moduleGuards.set(guardKey, false);
  }
}

export function isWorkflowRunning(module: string, activityId: string = DEFAULT_PRODUCT_ID): boolean {
  return moduleGuards.get(`${module}:${activityId}`) === true;
}
