/**
 * Workflow engine — sequential, in-process executor.
 *
 * Runs a workflow's steps in order, threading each step's output into the next,
 * and records a per-step trace on the run. A `degradable` step that throws is
 * skipped (a dead connector must not fail the whole run — ADR-0013); a
 * non-degradable failure aborts the run with an error.
 *
 * Persistence of the run to `workflow_runs` is intentionally left to the runner
 * (migration plan, Phase 1) — this module is the pure orchestration core.
 */
import { getStep } from './registry.js';
import type { StepContext, Trigger, Workflow, WorkflowRun } from './types.js';

export interface RunOptions {
  trigger?: Trigger['kind'];
}

export async function runWorkflow(
  wf: Workflow,
  ctx: StepContext,
  options: RunOptions = {},
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    workflowId: wf.id,
    activityId: ctx.activityId,
    trigger: options.trigger ?? 'manual',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trace: [],
    error: null,
  };

  ctx.log.info('Workflow started', { workflow: wf.id, activity: ctx.activityId });

  let data: unknown = undefined;
  for (const def of wf.steps) {
    const step = getStep(def.use);
    if (!step) {
      run.status = 'error';
      run.error = `Unknown step: ${def.use}`;
      run.finishedAt = new Date().toISOString();
      ctx.log.error('Workflow aborted — unknown step', { workflow: wf.id, step: def.use });
      return run;
    }

    const input = { ...def.with, ...toObject(data) };
    try {
      // Steps run sequentially by design: each consumes the previous step's output.
      data = await step.run(ctx, input);
      run.trace.push({ step: def.use, status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (step.degradable) {
        run.trace.push({ step: def.use, status: 'skipped', error: message });
        ctx.log.warn('Step skipped (degradable)', { workflow: wf.id, step: def.use, message });
        continue;
      }
      run.status = 'error';
      run.error = message;
      run.trace.push({ step: def.use, status: 'error', error: message });
      run.finishedAt = new Date().toISOString();
      ctx.log.error('Workflow failed', { workflow: wf.id, step: def.use, message });
      return run;
    }
  }

  run.status = 'success';
  run.finishedAt = new Date().toISOString();
  ctx.log.info('Workflow finished', { workflow: wf.id, activity: ctx.activityId });
  return run;
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
