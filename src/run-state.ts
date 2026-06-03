import { getDb, DEFAULT_PRODUCT_ID, type RunRecord } from './db.js';
import { getParisMonthRangeUtc } from './date-utils.js';

export const publishRunning = new Map<string, boolean>();
export const collectRunning = new Map<string, boolean>();

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

export function getSuccessfulRunsByMonth(
  year: number,
  month: number,
  productId: string = DEFAULT_PRODUCT_ID,
): RunRecord[] {
  const db = getDb();
  const { from, to } = getParisMonthRangeUtc(year, month);
  return db
    .prepare(
      `SELECT * FROM runs WHERE status = 'success' AND summary IS NOT NULL AND product_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at ASC`,
    )
    .all(productId, from, to) as RunRecord[];
}
