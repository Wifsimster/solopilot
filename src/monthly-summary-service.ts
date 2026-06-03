import type { Config } from './config.js';
import { getDb, DEFAULT_PRODUCT_ID, type MonthlySummaryRecord } from './db.js';
import { getSuccessfulRunsByMonth } from './run-state.js';
import { createAIFilter } from './ai-filter.js';
import { logger } from './logger.js';
import { utcToParisYearMonth } from './date-utils.js';

const MAX_INPUT_SUMMARIES = 10;
const MAX_INPUT_CHARS = 20000;

export async function generateMonthlySummary(
  config: Config,
  year: number,
  month: number,
  productId: string = DEFAULT_PRODUCT_ID,
): Promise<MonthlySummaryRecord> {
  const runs = getSuccessfulRunsByMonth(year, month, productId);

  if (runs.length === 0) {
    throw new Error(
      `Aucun run réussi avec résumé trouvé pour ${year}-${String(month).padStart(2, '0')}.`,
    );
  }

  const summaries = runs.map((r) => r.summary!).slice(0, MAX_INPUT_SUMMARIES);

  const totalChars = summaries.reduce((sum, s) => sum + s.length, 0);
  if (totalChars > MAX_INPUT_CHARS) {
    logger.warn('Monthly summary input truncated', {
      totalChars,
      maxChars: MAX_INPUT_CHARS,
      summaryCount: summaries.length,
      productId,
    });
  }

  const aiFilter = createAIFilter(config);
  const monthlySummary = await aiFilter.synthesizeMonthlySummary(summaries, year, month);

  if (!monthlySummary) {
    throw new Error(
      `L'IA n'a pas pu générer de résumé mensuel pour ${year}-${String(month).padStart(2, '0')}.`,
    );
  }

  const runIds = runs.map((r) => r.id);
  const db = getDb();

  const existing = db
    .prepare('SELECT id FROM monthly_summaries WHERE product_id = ? AND year = ? AND month = ?')
    .get(productId, year, month) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE monthly_summaries
       SET summary = ?, source_run_ids = ?, generated_at = datetime('now')
       WHERE id = ?`,
    ).run(monthlySummary, JSON.stringify(runIds), existing.id);
  } else {
    db.prepare(
      `INSERT INTO monthly_summaries (year, month, summary, source_run_ids, generated_at, product_id)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    ).run(year, month, monthlySummary, JSON.stringify(runIds), productId);
  }

  logger.info('Monthly summary generated', { year, month, sourceRuns: runIds.length, productId });

  return getMonthlySummary(year, month, productId)!;
}

export function getMonthlySummary(
  year: number,
  month: number,
  productId: string = DEFAULT_PRODUCT_ID,
): MonthlySummaryRecord | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM monthly_summaries WHERE product_id = ? AND year = ? AND month = ?')
    .get(productId, year, month) as MonthlySummaryRecord | undefined;
}

export function listMonthlySummaries(
  limit = 12,
  productId: string = DEFAULT_PRODUCT_ID,
): MonthlySummaryRecord[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM monthly_summaries WHERE product_id = ? ORDER BY year DESC, month DESC LIMIT ?',
    )
    .all(productId, limit) as MonthlySummaryRecord[];
}

/**
 * Deletes any monthly summaries that reference the given run ID in source_run_ids.
 */
export function deleteMonthlySummariesReferencingRun(runId: number): void {
  const db = getDb();
  const all = db.prepare('SELECT id, source_run_ids FROM monthly_summaries').all() as {
    id: number;
    source_run_ids: string;
  }[];
  for (const row of all) {
    let ids: Set<number>;
    try {
      const parsed = JSON.parse(row.source_run_ids) as unknown;
      if (!Array.isArray(parsed)) {
        logger.warn('Monthly summary source_run_ids is not an array', { id: row.id });
        continue;
      }
      ids = new Set(parsed.filter((v): v is number => typeof v === 'number'));
    } catch (err) {
      logger.warn('Failed to parse monthly summary source_run_ids', {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (ids.has(runId)) {
      db.prepare('DELETE FROM monthly_summaries WHERE id = ?').run(row.id);
      logger.info('Deleted stale monthly summary', {
        monthlySummaryId: row.id,
        deletedRunId: runId,
      });
    }
  }
}

export function getAvailableMonths(
  productId: string = DEFAULT_PRODUCT_ID,
): { year: number; month: number; run_count: number }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT started_at FROM runs
       WHERE status = 'success' AND summary IS NOT NULL AND product_id = ?`,
    )
    .all(productId) as { started_at: string }[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    const { year, month } = utcToParisYearMonth(row.started_at);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [y, m] = key.split('-').map(Number);
      return { year: y, month: m, run_count: count };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}
