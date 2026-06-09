import { tryLoadConfigWithOverrides, loadBootConfig } from './config.js';
import { logger } from './logger.js';
import { getSettingsMap } from './settings-service.js';
import { startServer } from './server.js';
import { getDb, closeDb } from './db.js';
import {
  schedulePublishCron,
  scheduleCollectCron,
  scheduleCanaryCron,
  schedulePublishQueueCron,
  scheduleMetricsCron,
  stopAll as stopAllCrons,
} from './cron-manager.js';
import { recoverStaleRuns, isAnyRunning, isAnyCollecting } from './run-service.js';
import { buildMergedConfig } from './config-merge.js';
import { registerSolopilot } from './workflow/bootstrap.js';
import { recoverStaleWorkflowRuns } from './workflow/run-store.js';

// Always initialize database and boot the web server
getDb();

// Register workflow definitions and steps. This is inert: it does not schedule
// anything (every workflow ships enabled: false) — it only populates the
// registry so the read-only workflow API can surface them. See ADR-0014.
registerSolopilot();

// Recover any runs stuck in 'running' state from a previous crash
recoverStaleRuns();
recoverStaleWorkflowRuns();

// Graceful shutdown handler
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutdown signal received, draining...', { signal });

  // Stop all cron tasks immediately
  stopAllCrons();

  // Wait for in-flight operations to complete (max 30s)
  const deadline = Date.now() + 30_000;
  const interval = setInterval(() => {
    if ((!isAnyRunning() && !isAnyCollecting()) || Date.now() > deadline) {
      clearInterval(interval);
      if (Date.now() > deadline) {
        logger.warn('Shutdown deadline exceeded, forcing exit');
      }
      closeDb();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    }
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const bootConfig = loadBootConfig();
const dbOverrides = getSettingsMap();
const configResult = tryLoadConfigWithOverrides(dbOverrides);

// Start web server — always, even if config is incomplete
startServer(
  configResult.success ? configResult.config : null,
  configResult.success ? null : configResult.missing,
  bootConfig.CRON_SCHEDULE,
  bootConfig.WEB_PORT,
);

if (configResult.success) {
  const config = configResult.config;
  const publishSchedule = config.CRON_SCHEDULE;
  const collectSchedule = config.COLLECT_CRON_SCHEDULE;

  logger.info('X AI Daily Bot scheduler started', {
    username: config.X_USERNAME,
    publishCron: publishSchedule,
    collectCron: collectSchedule,
    dryRun: config.DRY_RUN,
    webPort: bootConfig.WEB_PORT,
  });

  // Schedule both cron tasks via the manager (supports hot-reload)
  schedulePublishCron(publishSchedule, config, buildMergedConfig);
  scheduleCollectCron(collectSchedule, config, buildMergedConfig);

  // Daily publish-session canary (alerts on Discord when a session expires).
  scheduleCanaryCron(dbOverrides['PUBLISH_CANARY_CRON'] || '0 8 * * *');

  // Drain the scheduled-publish queue every minute ("Publier plus tard").
  schedulePublishQueueCron(dbOverrides['PUBLISH_QUEUE_CRON'] || '* * * * *');

  // Refresh published-post engagement metrics every 6h (feedback loop).
  scheduleMetricsCron(dbOverrides['PUBLISH_METRICS_CRON'] || '0 */6 * * *');
} else {
  logger.warn('X AI Daily Bot started in setup mode — missing credentials', {
    missing: configResult.missing.map((m) => m.key),
    webPort: bootConfig.WEB_PORT,
  });
}
