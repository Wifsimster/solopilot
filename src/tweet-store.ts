import { z } from 'zod';
import { getDb, DEFAULT_PRODUCT_ID } from './db.js';
import type { Item, ItemSource } from './ports.js';
import { logger } from './logger.js';

export interface StoreItemsResult {
  inserted: number;
  insertedIds: string[];
}

/**
 * Stores items with deduplication via INSERT OR IGNORE on item ID (source-prefixed).
 * Returns the count and IDs of newly inserted items (duplicates excluded).
 */
export function storeItems(
  items: Item[],
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): StoreItemsResult {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tweets (id, text, created_at, urls, collection_date, product_id, source, author, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((rows: Item[]) => {
    const insertedIds: string[] = [];
    for (const item of rows) {
      const result = insert.run(
        item.id,
        item.text,
        item.createdAt,
        JSON.stringify(item.urls),
        collectionDate,
        productId,
        item.source,
        item.author,
        item.url,
      );
      if (result.changes > 0) insertedIds.push(item.id);
    }
    return insertedIds;
  });

  const insertedIds = insertMany(items);
  const inserted = insertedIds.length;
  const bySource: Record<string, number> = {};
  for (const it of items) {
    bySource[it.source] = (bySource[it.source] ?? 0) + 1;
  }
  logger.info('Items stored', {
    total: items.length,
    new: inserted,
    duplicates: items.length - inserted,
    collectionDate,
    productId,
    bySource,
  });
  return { inserted, insertedIds };
}

interface ItemQueryOptions {
  source?: ItemSource;
  collectionDate?: string;
}

interface ItemRow {
  id: string;
  text: string;
  created_at: string;
  urls: string;
  source: string;
  author: string;
  url: string;
}

/**
 * Returns all items for a product that haven't been used in a publish run yet.
 * Optionally restrict by collection date or source.
 *
 * When no collectionDate is provided, returns every unused item across all dates.
 * This ensures tweets stored between yesterday's publish and today's publish are
 * not stranded by the daily date boundary.
 */
export function getUnpublishedTweets(
  productId: string = DEFAULT_PRODUCT_ID,
  options: ItemQueryOptions = {},
): Item[] {
  const db = getDb();
  const clauses = ['product_id = ?', 'used_in_run_id IS NULL'];
  const params: unknown[] = [productId];
  if (options.collectionDate) {
    clauses.push('collection_date = ?');
    params.push(options.collectionDate);
  }
  if (options.source) {
    clauses.push('source = ?');
    params.push(options.source);
  }
  const rows = db
    .prepare(
      `SELECT id, text, created_at, urls, source, author, url FROM tweets
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at ASC`,
    )
    .all(...params) as ItemRow[];

  return rows.map((row) => mapRowToItem(row, productId));
}

/**
 * Marks items as consumed by a publish run.
 */
export function markTweetsAsUsed(itemIds: string[], runId: number): void {
  const db = getDb();
  const update = db.prepare('UPDATE tweets SET used_in_run_id = ? WHERE id = ?');
  const updateMany = db.transaction((ids: string[]) => {
    for (const id of ids) {
      update.run(runId, id);
    }
  });
  updateMany(itemIds);
}

/**
 * Releases items associated with a run, making them available for re-processing.
 */
export function releaseTweetsForRun(runId: number): void {
  const db = getDb();
  db.prepare('UPDATE tweets SET used_in_run_id = NULL WHERE used_in_run_id = ?').run(runId);
}

/**
 * Returns the collection date for items linked to a given run.
 */
export function getCollectionDateForRun(runId: number): string | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT DISTINCT collection_date FROM tweets WHERE used_in_run_id = ? LIMIT 1')
    .get(runId) as { collection_date: string } | undefined;
  return row?.collection_date;
}

/**
 * Returns the count of items collected today that are not yet used.
 */
export function countUnpublishedTweets(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
  options: ItemQueryOptions = {},
): number {
  const db = getDb();
  const clauses = ['collection_date = ?', 'product_id = ?', 'used_in_run_id IS NULL'];
  const params: unknown[] = [collectionDate, productId];
  if (options.source) {
    clauses.push('source = ?');
    params.push(options.source);
  }
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM tweets WHERE ${clauses.join(' AND ')}`)
    .get(...params) as { count: number };
  return row.count;
}

/**
 * Returns items used in a specific publish run.
 */
export function getTweetsByRunId(
  runId: number,
  limit = 50,
  offset = 0,
): { tweets: Item[]; total: number } {
  const db = getDb();
  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM tweets WHERE used_in_run_id = ?`)
    .get(runId) as { count: number };

  const rows = db
    .prepare(
      `SELECT id, text, created_at, urls, source, author, url, product_id FROM tweets
       WHERE used_in_run_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(runId, limit, offset) as (ItemRow & { product_id: string })[];

  return {
    tweets: rows.map((row) => mapRowToItem(row, row.product_id)),
    total: countRow.count,
  };
}

/**
 * Returns the total count of items collected for a given date.
 */
export function countTweetsForDate(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
  options: ItemQueryOptions = {},
): number {
  const db = getDb();
  const clauses = ['collection_date = ?', 'product_id = ?'];
  const params: unknown[] = [collectionDate, productId];
  if (options.source) {
    clauses.push('source = ?');
    params.push(options.source);
  }
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM tweets WHERE ${clauses.join(' AND ')}`)
    .get(...params) as { count: number };
  return row.count;
}

export const veilleItemListQuerySchema = z.object({
  productId: z.string().min(1).max(64).optional(),
  source: z.enum(['x', 'reddit', 'hn']).optional(),
  category: z
    .string()
    .min(1)
    .max(60)
    .optional(),
  minUrgency: z
    .preprocess(
      (v) => (typeof v === 'string' ? Number(v) : v),
      z.number().int().min(0).max(100),
    )
    .optional(),
  triaged: z.enum(['true', 'false']).optional(),
  limit: z
    .preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().min(1).max(500))
    .optional(),
});

export interface VeilleItemListOptions {
  productId?: string;
  source?: ItemSource;
  category?: string;
  minUrgency?: number;
  triaged?: 'true' | 'false';
  limit?: number;
}

export interface VeilleItemView {
  id: string;
  product_id: string;
  source: string;
  text: string;
  author: string;
  url: string;
  created_at: string;
  collection_date: string;
  triage_category: string | null;
  triage_urgency: number | null;
  triage_relevance: number | null;
  triaged_at: number | null;
  triage_error: string | null;
}

/**
 * Lists collected items with their per-item AI triage fields, filterable by
 * category / minimum urgency / triage state. Backs the veille items API
 * independently of the daily digest.
 */
export function listVeilleItems(opts: VeilleItemListOptions = {}): VeilleItemView[] {
  const db = getDb();
  const clauses = ['product_id = ?'];
  const params: unknown[] = [opts.productId ?? DEFAULT_PRODUCT_ID];

  if (opts.source) {
    clauses.push('source = ?');
    params.push(opts.source);
  }
  if (opts.category) {
    clauses.push('triage_category = ?');
    params.push(opts.category);
  }
  if (opts.minUrgency !== undefined) {
    clauses.push('triage_urgency >= ?');
    params.push(opts.minUrgency);
  }
  if (opts.triaged === 'true') {
    clauses.push('triaged_at IS NOT NULL');
  } else if (opts.triaged === 'false') {
    clauses.push('triaged_at IS NULL');
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(limit);

  return db
    .prepare(
      `SELECT id, product_id, source, text, author, url, created_at, collection_date,
              triage_category, triage_urgency, triage_relevance, triaged_at, triage_error
       FROM tweets
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params) as VeilleItemView[];
}

function mapRowToItem(row: ItemRow, productId: string): Item {
  const source: ItemSource = row.source === 'reddit' ? 'reddit' : row.source === 'hn' ? 'hn' : 'x';
  return {
    id: row.id,
    source,
    text: row.text,
    author: row.author ?? '',
    url: row.url ?? '',
    createdAt: row.created_at,
    fetchedAt: row.created_at,
    productId,
    urls: JSON.parse(row.urls) as string[],
  };
}
