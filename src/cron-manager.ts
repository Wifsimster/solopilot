import cron, { type ScheduledTask } from 'node-cron';
import { logger } from './logger.js';
import { triggerRun, triggerCollect } from './run-service.js';
import { getSettingsMap, getProductSettingsMap } from './settings-service.js';
import { listProducts } from './product-service.js';
import { runWorkflowById } from './workflow/runner.js';
import type { Config } from './config.js';

/**
 * Veille flip (ADR-0020). When WORKFLOW_SCHEDULER=true, the same cron ticks
 * dispatch through the workflow engine (recording workflow_runs) instead of
 * calling the services directly. The workflows delegate to the exact same
 * triggerCollect/triggerRun, so behaviour is identical; `guard: false` avoids
 * double-guarding (the services guard themselves). Default is the legacy path.
 */
function workflowSchedulerEnabled(): boolean {
  return process.env.WORKFLOW_SCHEDULER === 'true';
}

async function dispatchCollect(config: Config, productId: string): Promise<void> {
  if (workflowSchedulerEnabled()) {
    await runWorkflowById('veille.collect', { config, activityId: productId, trigger: 'cron', guard: false });
  } else {
    await triggerCollect(config, productId);
  }
}

async function dispatchPublish(config: Config, productId: string): Promise<void> {
  if (workflowSchedulerEnabled()) {
    await runWorkflowById('veille.digest', { config, activityId: productId, trigger: 'cron', guard: false });
  } else {
    await triggerRun(config, 'cron', productId);
  }
}

const tasks = new Map<string, ScheduledTask>();
const schedules = new Map<string, string>();

function getSchedule(name: string): string {
  return schedules.get(name) || '';
}

export function getCurrentSchedule(): string {
  return getSchedule('publish');
}

export function getCollectSchedule(): string {
  return getSchedule('collect');
}

function mergeProductConfig(
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
  productId: string,
): Config {
  const overrides: Record<string, string> = {
    ...getSettingsMap(),
    ...getProductSettingsMap(productId),
  };
  return buildMergedConfig(baseConfig, overrides);
}

export function schedulePublishCron(
  schedule: string,
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  return scheduleNamedCron('publish', schedule, async () => {
    logger.info('Cron triggered — starting daily summary (publish) for all products');
    const products = listProducts(false);
    for (const product of products) {
      try {
        const mergedConfig = mergeProductConfig(baseConfig, buildMergedConfig, product.id);
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: per-product publish runs must not hammer the shared X session concurrently
        await dispatchPublish(mergedConfig, product.id);
      } catch (err) {
        logger.error('Daily summary failed', {
          productId: product.id,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  });
}

export function scheduleCollectCron(
  schedule: string,
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  return scheduleNamedCron('collect', schedule, async () => {
    logger.info('Cron triggered — starting tweet collection for all products');
    const products = listProducts(false);
    for (const product of products) {
      try {
        const mergedConfig = mergeProductConfig(baseConfig, buildMergedConfig, product.id);
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: per-product collect runs must not hammer the shared X session concurrently
        await dispatchCollect(mergedConfig, product.id);
      } catch (err) {
        logger.error('Tweet collection failed', {
          productId: product.id,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  });
}

function scheduleNamedCron(
  name: string,
  schedule: string,
  handler: () => Promise<void>,
): boolean {
  if (!cron.validate(schedule)) {
    logger.error('Invalid cron expression, not scheduling', { name, schedule });
    return false;
  }

  const existing = tasks.get(name);
  if (existing) {
    existing.stop();
    logger.info('Previous cron task stopped', { name, previous: schedules.get(name) });
  }

  schedules.set(name, schedule);
  tasks.set(name, cron.schedule(schedule, handler, { timezone: 'Europe/Paris' }));

  logger.info('Cron task scheduled', { name, schedule });
  return true;
}

export function reschedule(
  newSchedule: string,
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  if (!cron.validate(newSchedule)) {
    return false;
  }
  return schedulePublishCron(newSchedule, baseConfig, buildMergedConfig);
}

export function stopAll(): void {
  for (const [name, task] of tasks) {
    task.stop();
    logger.info('Cron task stopped', { name });
  }
  tasks.clear();
}

export function rescheduleCollect(
  newSchedule: string,
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  if (!cron.validate(newSchedule)) {
    return false;
  }
  return scheduleCollectCron(newSchedule, baseConfig, buildMergedConfig);
}
