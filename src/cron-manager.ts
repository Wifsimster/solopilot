import cron, { type ScheduledTask } from 'node-cron';
import { logger } from './logger.js';
import { triggerRun, triggerCollect, getVeilleDelivery } from './run-service.js';
import { runConsolidatedDigest } from './modules/veille/consolidated-service.js';
import { getSettingsMap, getProductSettingsMap, getSetting } from './settings-service.js';
import { listProducts } from './product-service.js';
import { runWorkflowById } from './workflow/runner.js';
import { runConnectionCanary, publishDueScheduledJobs } from './publish-service.js';
import { refreshPublishedMetrics } from './content-metrics.js';
import { sendDiscordNotification } from './adapters/discord-notifier.js';
import { getRadarSettings, isRadarRunning } from './modules/veille/radar-service.js';
import { veilleRadarProduit } from './modules/veille/workflows.js';
import type { Config } from './config.js';
import { sendWeeklyRecap, WEEKLY_RECAP_CRON } from './ai/usage-recap.js';

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

async function dispatchConsolidatedDigest(baseConfig: Config): Promise<void> {
  if (workflowSchedulerEnabled()) {
    await runWorkflowById('veille.digest-consolidated', {
      config: baseConfig,
      trigger: 'cron',
      guard: false,
    });
  } else {
    await runConsolidatedDigest(baseConfig, 'cron');
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

function clearPublishTasks(): void {
  for (const name of [...tasks.keys()]) {
    if (name === 'publish' || name.startsWith('publish:')) {
      tasks.get(name)?.stop();
      tasks.delete(name);
      schedules.delete(name);
    }
  }
}

export function schedulePublishCron(
  schedule: string,
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  clearPublishTasks();

  const products = listProducts(false);
  let allOk = true;
  for (const product of products) {
    const ownSchedule = Boolean(product.publish_cron?.trim());
    const productSchedule = product.publish_cron?.trim() || schedule;
    const ok = scheduleNamedCron(`publish:${product.id}`, productSchedule, async () => {
      if (!ownSchedule && getVeilleDelivery().mode === 'consolidated') {
        logger.info('Per-product publish skipped — handled by the consolidated digest', {
          productId: product.id,
        });
        return;
      }
      logger.info('Cron triggered — daily summary (publish)', {
        productId: product.id,
        schedule: productSchedule,
      });
      try {
        const mergedConfig = mergeProductConfig(baseConfig, buildMergedConfig, product.id);
        await dispatchPublish(mergedConfig, product.id);
      } catch (err) {
        logger.error('Daily summary failed', {
          productId: product.id,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    });
    allOk = allOk && ok;
  }

  const consolidatedOk = scheduleNamedCron('publish:consolidated', schedule, async () => {
    try {
      await dispatchConsolidatedDigest(baseConfig);
    } catch (err) {
      logger.error('Consolidated digest failed', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  });
  allOk = allOk && consolidatedOk;

  schedules.set('publish', schedule);
  return allOk;
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

export function scheduleCanaryCron(schedule: string): boolean {
  return scheduleNamedCron('publish-canary', schedule, async () => {
    let results;
    try {
      results = await runConnectionCanary();
    } catch (err) {
      logger.error('Publish canary failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const broken = results.filter((r) => r.state === 'expired');
    if (broken.length === 0) {
      logger.info('Publish canary OK', { checked: results.length });
      return;
    }
    logger.warn('Publish canary found expired sessions', {
      platforms: broken.map((b) => b.platform),
    });
    const webhook = getSetting('DISCORD_WEBHOOK_URL');
    if (!webhook) return;
    const platforms = broken.map((b) => b.platform).join(', ');
    await sendDiscordNotification(
      webhook,
      `⚠️ Sessions de publication expirées : ${platforms}. Reconnecte-les dans Solopilot → Studio → Connexions pour continuer à publier automatiquement.`,
      0,
    );
  });
}

export function schedulePublishQueueCron(schedule: string): boolean {
  return scheduleNamedCron('publish-queue', schedule, async () => {
    try {
      await publishDueScheduledJobs();
    } catch (err) {
      logger.error('Publish queue drain failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function scheduleMetricsCron(schedule: string): boolean {
  return scheduleNamedCron('publish-metrics', schedule, async () => {
    try {
      await refreshPublishedMetrics();
    } catch (err) {
      logger.error('Metrics refresh cron failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function scheduleRadarCron(
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  const expr = veilleRadarProduit.trigger.kind === 'cron' ? veilleRadarProduit.trigger.expr : '45 * * * *';
  return scheduleNamedCron('radar-produit', expr, async () => {
    if (!getRadarSettings().enabled || isRadarRunning()) return;
    try {
      const config = buildMergedConfig(baseConfig, getSettingsMap());
      await runWorkflowById(veilleRadarProduit.id, { config, trigger: 'cron', guard: false });
    } catch (err) {
      logger.error('Radar produit failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function scheduleAiRecapCron(
  baseConfig: Config,
  buildMergedConfig: (base: Config, overrides: Record<string, string>) => Config,
): boolean {
  return scheduleNamedCron('ai-weekly-recap', WEEKLY_RECAP_CRON, async () => {
    try {
      const config = buildMergedConfig(baseConfig, getSettingsMap());
      const status = await sendWeeklyRecap(config);
      logger.info('AI weekly recap', { status });
    } catch (err) {
      logger.error('AI weekly recap failed', {
        message: err instanceof Error ? err.message : String(err),
      });
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
