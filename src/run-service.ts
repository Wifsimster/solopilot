import type { Config } from './config.js';
import { getDb, DEFAULT_PRODUCT_ID, type RunRecord } from './db.js';
import { logger } from './logger.js';
import { run } from './index.js';
import { collectTweets } from './collect-service.js';
import { sendDiscordNotification } from './adapters/discord-notifier.js';
import { getSetting, getProductSetting } from './settings-service.js';
import { releaseTweetsForRun, getCollectionDateForRun } from './tweet-store.js';
import { deleteMonthlySummariesReferencingRun } from './monthly-summary-service.js';
import { getProduct } from './product-service.js';

const publishRunning = new Map<string, boolean>();
const collectRunning = new Map<string, boolean>();

export function isRunning(productId: string = DEFAULT_PRODUCT_ID): boolean {
  return publishRunning.get(productId) === true;
}

export function isCollecting(productId: string = DEFAULT_PRODUCT_ID): boolean {
  return collectRunning.get(productId) === true;
}

export function isAnyRunning(): boolean {
  for (const v of publishRunning.values()) if (v) return true;
  return false;
}

export function isAnyCollecting(): boolean {
  for (const v of collectRunning.values()) if (v) return true;
  return false;
}

function resolveDiscordWebhook(config: Config, productId: string): string | undefined {
  const product = getProduct(productId);
  if (product?.discord_webhook) return product.discord_webhook;
  const productSetting = getProductSetting(productId, 'DISCORD_WEBHOOK_URL');
  if (productSetting) return productSetting;
  return getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL;
}

/**
 * Hourly tweet collection — lightweight, no AI, no Discord.
 * Uses a separate concurrency guard per product so it doesn't block publish runs.
 */
export async function triggerCollect(
  config: Config,
  productId: string = DEFAULT_PRODUCT_ID,
): Promise<RunRecord> {
  if (collectRunning.get(productId) === true) {
    throw new Error('A collection is already in progress');
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO runs (started_at, status, trigger_type, product_id)
     VALUES (datetime('now'), 'running', 'collect', ?)`,
  );
  const { lastInsertRowid } = insert.run(productId);
  const runId = Number(lastInsertRowid);

  collectRunning.set(productId, true);

  try {
    const result = await collectTweets(config, productId);

    const status = result.fetched > 0 ? 'success' : 'no_tweets';
    db.prepare(
      `UPDATE runs SET finished_at = datetime('now'), status = ?, tweets_fetched = ? WHERE id = ?`,
    ).run(status, result.fetched, runId);

    return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE runs SET finished_at = datetime('now'), status = 'error', error_message = ? WHERE id = ?`,
    ).run(message, runId);

    logger.error('Collection failed', { runId, productId, error: message });
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
  } finally {
    collectRunning.set(productId, false);
  }
}

export async function triggerRun(
  config: Config,
  trigger: 'cron' | 'manual' = 'manual',
  productId: string = DEFAULT_PRODUCT_ID,
): Promise<RunRecord> {
  if (publishRunning.get(productId) === true) {
    throw new Error('A run is already in progress');
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO runs (started_at, status, trigger_type, product_id)
     VALUES (datetime('now'), 'running', ?, ?)`,
  );
  const { lastInsertRowid } = insert.run(trigger, productId);
  const runId = Number(lastInsertRowid);

  publishRunning.set(productId, true);

  try {
    await run(config, undefined, productId);

    const lastRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
    const status = lastRun.summary
      ? 'success'
      : lastRun.tweets_fetched > 0
        ? 'no_news'
        : 'no_tweets';

    db.prepare(`UPDATE runs SET finished_at = datetime('now'), status = ? WHERE id = ?`).run(
      status,
      runId,
    );

    const finalRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
    if (status === 'success' && finalRun.summary) {
      const webhookUrl = resolveDiscordWebhook(config, productId);
      if (webhookUrl) {
        try {
          const notifResult = await sendDiscordNotification(webhookUrl, finalRun.summary, runId);
          const notifStatus = notifResult.success ? 'sent' : 'failed';
          db.prepare('UPDATE runs SET notification_status = ? WHERE id = ?').run(
            notifStatus,
            runId,
          );
        } catch (notifErr) {
          logger.error('Discord notification unexpected error', {
            runId,
            productId,
            error: String(notifErr),
          });
          db.prepare('UPDATE runs SET notification_status = ? WHERE id = ?').run('failed', runId);
        }
      } else {
        db.prepare('UPDATE runs SET notification_status = ? WHERE id = ?').run('skipped', runId);
      }
    }

    return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE runs SET finished_at = datetime('now'), status = 'error', error_message = ? WHERE id = ?`,
    ).run(message, runId);

    logger.error('Run failed', { runId, productId, error: message });
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
  } finally {
    publishRunning.set(productId, false);
  }
}

export function getRunById(id: number): RunRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined;
}

export function updateNotificationStatus(runId: number, status: string): void {
  const db = getDb();
  db.prepare('UPDATE runs SET notification_status = ? WHERE id = ?').run(status, runId);
}

export function getRunHistory(
  limit = 20,
  offset = 0,
  productId: string = DEFAULT_PRODUCT_ID,
): RunRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM runs WHERE product_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(productId, limit, offset) as RunRecord[];
}

export function countRuns(productId: string = DEFAULT_PRODUCT_ID): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM runs WHERE product_id = ?')
    .get(productId) as { count: number };
  return row.count;
}

/**
 * On startup, mark any runs stuck in 'running' status as 'error'.
 * This handles the case where the process was killed mid-run.
 */
export function recoverStaleRuns(): number {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE runs SET finished_at = datetime('now'), status = 'error', error_message = 'Processus interrompu de manière inattendue' WHERE status = 'running'`,
    )
    .run();
  if (result.changes > 0) {
    logger.info('Recovered stale runs on startup', { count: result.changes });
  }
  return result.changes;
}

export function getLastRun(productId: string = DEFAULT_PRODUCT_ID): RunRecord | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM runs WHERE product_id = ? ORDER BY id DESC LIMIT 1')
    .get(productId) as RunRecord | undefined;
}

export function updateRunStats(
  runId: number,
  updates: Partial<Pick<RunRecord, 'tweets_fetched' | 'tweets_posted' | 'thread_ids' | 'summary'>>,
) {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.tweets_fetched !== undefined) {
    sets.push('tweets_fetched = ?');
    values.push(updates.tweets_fetched);
  }
  if (updates.tweets_posted !== undefined) {
    sets.push('tweets_posted = ?');
    values.push(updates.tweets_posted);
  }
  if (updates.thread_ids !== undefined) {
    sets.push('thread_ids = ?');
    values.push(updates.thread_ids);
  }
  if (updates.summary !== undefined) {
    sets.push('summary = ?');
    values.push(updates.summary);
  }

  if (sets.length > 0) {
    values.push(runId);
    db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function getCurrentRunId(productId: string = DEFAULT_PRODUCT_ID): number | undefined {
  if (publishRunning.get(productId) !== true && collectRunning.get(productId) !== true) {
    return undefined;
  }
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM runs WHERE status = 'running' AND product_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(productId) as { id: number } | undefined;
  return row?.id;
}

/**
 * Soft-deletes a summary: nulls the summary, sets status to 'deleted',
 * releases associated tweets, and cascades to monthly summaries.
 */
export function deleteSummary(runId: number): { success: boolean; message: string } {
  const db = getDb();
  const targetRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
    | RunRecord
    | undefined;
  if (!targetRun) {
    return { success: false, message: 'Run introuvable.' };
  }
  if (targetRun.status !== 'success' || !targetRun.summary) {
    return { success: false, message: 'Ce run ne contient pas de resume a supprimer.' };
  }

  const doDelete = db.transaction(() => {
    db.prepare(
      `UPDATE runs SET summary = NULL, status = 'deleted', notification_status = NULL WHERE id = ?`,
    ).run(runId);
    releaseTweetsForRun(runId);
    deleteMonthlySummariesReferencingRun(runId);
  });
  doDelete();

  logger.info('Summary deleted', { runId });
  return { success: true, message: 'Resume supprime avec succes.' };
}

/**
 * Re-runs the AI summary for a given run's collection date.
 * Soft-deletes the old run, creates a new run, and processes the freed tweets.
 */
export async function triggerRerun(
  config: Config,
  originalRunId: number,
): Promise<{ success: boolean; message: string; run?: RunRecord }> {
  const db = getDb();
  const originalRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(originalRunId) as
    | RunRecord
    | undefined;
  if (!originalRun) {
    return { success: false, message: 'Run introuvable.' };
  }
  if (originalRun.status !== 'success' || !originalRun.summary) {
    return { success: false, message: 'Ce run ne contient pas de resume a regenerer.' };
  }

  const productId = originalRun.product_id ?? DEFAULT_PRODUCT_ID;
  if (publishRunning.get(productId) === true) {
    return { success: false, message: 'Un run est deja en cours.' };
  }

  const collectionDate =
    getCollectionDateForRun(originalRunId) ?? originalRun.started_at.split('T')[0].split(' ')[0];

  if (!collectionDate) {
    return { success: false, message: 'Impossible de determiner la date de collecte.' };
  }

  const doDelete = db.transaction(() => {
    db.prepare(
      `UPDATE runs SET summary = NULL, status = 'deleted', notification_status = NULL WHERE id = ?`,
    ).run(originalRunId);
    releaseTweetsForRun(originalRunId);
    deleteMonthlySummariesReferencingRun(originalRunId);
  });
  doDelete();

  const insert = db.prepare(
    `INSERT INTO runs (started_at, status, trigger_type, product_id)
     VALUES (datetime('now'), 'running', 'manual', ?)`,
  );
  const { lastInsertRowid } = insert.run(productId);
  const runId = Number(lastInsertRowid);

  publishRunning.set(productId, true);

  try {
    await run(config, collectionDate, productId);

    const lastRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
    const status = lastRun.summary
      ? 'success'
      : lastRun.tweets_fetched > 0
        ? 'no_news'
        : 'no_tweets';

    db.prepare(`UPDATE runs SET finished_at = datetime('now'), status = ? WHERE id = ?`).run(
      status,
      runId,
    );

    const finalRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord;
    return { success: true, message: 'Resume regenere avec succes.', run: finalRun };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE runs SET finished_at = datetime('now'), status = 'error', error_message = ? WHERE id = ?`,
    ).run(message, runId);

    logger.error('Rerun failed', { runId, originalRunId, productId, error: message });
    return { success: false, message: `Erreur lors de la regeneration : ${message}` };
  } finally {
    publishRunning.set(productId, false);
  }
}

export interface SummaryFilters {
  month?: string; // YYYY-MM format
  search?: string;
}

export function getSuccessfulSummaries(
  limit = 20,
  offset = 0,
  filters?: SummaryFilters,
  productId: string = DEFAULT_PRODUCT_ID,
): RunRecord[] {
  const db = getDb();
  const clauses = [`status = 'success'`, `summary IS NOT NULL`, `product_id = ?`];
  const params: unknown[] = [productId];

  if (filters?.month) {
    const [year, mon] = filters.month.split('-').map(Number);
    const from = `${year}-${String(mon).padStart(2, '0')}-01`;
    const toMonth = mon === 12 ? 1 : mon + 1;
    const toYear = mon === 12 ? year + 1 : year;
    const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`;
    clauses.push(`started_at >= ?`, `started_at < ?`);
    params.push(from, to);
  }

  if (filters?.search) {
    clauses.push(`summary LIKE ?`);
    params.push(`%${filters.search}%`);
  }

  params.push(limit, offset);
  return db
    .prepare(
      `SELECT * FROM runs WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params) as RunRecord[];
}

export function countSuccessfulSummaries(
  filters?: SummaryFilters,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  const db = getDb();
  const clauses = [`status = 'success'`, `summary IS NOT NULL`, `product_id = ?`];
  const params: unknown[] = [productId];

  if (filters?.month) {
    const [year, mon] = filters.month.split('-').map(Number);
    const from = `${year}-${String(mon).padStart(2, '0')}-01`;
    const toMonth = mon === 12 ? 1 : mon + 1;
    const toYear = mon === 12 ? year + 1 : year;
    const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`;
    clauses.push(`started_at >= ?`, `started_at < ?`);
    params.push(from, to);
  }

  if (filters?.search) {
    clauses.push(`summary LIKE ?`);
    params.push(`%${filters.search}%`);
  }

  const row = db
    .prepare(`SELECT COUNT(*) as count FROM runs WHERE ${clauses.join(' AND ')}`)
    .get(...params) as { count: number };
  return row.count;
}

export function getSuccessfulRunsByMonth(
  year: number,
  month: number,
  productId: string = DEFAULT_PRODUCT_ID,
): RunRecord[] {
  const db = getDb();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const toMonth = month === 12 ? 1 : month + 1;
  const toYear = month === 12 ? year + 1 : year;
  const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`;
  return db
    .prepare(
      `SELECT * FROM runs WHERE status = 'success' AND summary IS NOT NULL AND product_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at ASC`,
    )
    .all(productId, from, to) as RunRecord[];
}
