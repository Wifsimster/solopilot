import cron, { type ScheduledTask } from 'node-cron';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { listWorkflows } from './registry.js';
import { runWorkflowById } from './runner.js';
import { DEFAULT_PRODUCT_ID } from '../db.js';

const tasks = new Map<string, ScheduledTask>();

export function scheduleWorkflows(config: Config): number {
  let scheduled = 0;
  for (const wf of listWorkflows({ enabledOnly: true })) {
    if (wf.trigger.kind !== 'cron') continue;
    const expr = wf.trigger.expr;
    if (!cron.validate(expr)) {
      logger.error('Invalid cron expression for workflow, skipping', { workflow: wf.id, expr });
      continue;
    }

    tasks.get(wf.id)?.stop();
    tasks.set(
      wf.id,
      cron.schedule(
        expr,
        async () => {
          try {
            await runWorkflowById(wf.id, { config, activityId: DEFAULT_PRODUCT_ID, trigger: 'cron' });
          } catch (err) {
            logger.error('Scheduled workflow failed to start', {
              workflow: wf.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        },
        { timezone: 'Europe/Paris' },
      ),
    );
    scheduled += 1;
  }

  logger.info('Workflow scheduler initialized', { scheduled });
  return scheduled;
}

export function stopWorkflowSchedules(): void {
  for (const [id, task] of tasks) {
    task.stop();
    logger.info('Workflow schedule stopped', { workflow: id });
  }
  tasks.clear();
}
