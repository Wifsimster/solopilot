import { getDb, DEFAULT_PRODUCT_ID } from './db.js';
import type { Item, ItemSource, Tweet } from './ports.js';
import { logger } from './logger.js';

/**
 * Stores items with deduplication via INSERT OR IGNORE on item ID (source-prefixed).
 * Returns the count of newly inserted items.
 */
export function storeItems(
  items: Item[],
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tweets (id, text, created_at, urls, collection_date, product_id, source, author, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((rows: Item[]) => {
    let inserted = 0;
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
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(items);
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
  return inserted;
}

/**
 * Backward-compatible alias — see storeItems.
 */
export function storeTweets(
  tweets: Tweet[],
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  return storeItems(tweets, collectionDate, productId);
}

interface ItemQueryOptions {
  source?: ItemSource;
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
 * Returns all items for a given date that haven't been used in a publish run yet.
 * Optionally filter by source.
 */
export function getUnpublishedTweets(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
  options: ItemQueryOptions = {},
): Item[] {
  const db = getDb();
  const clauses = [
    'collection_date = ?',
    'product_id = ?',
    'used_in_run_id IS NULL',
  ];
  const params: unknown[] = [collectionDate, productId];
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
  const clauses = [
    'collection_date = ?',
    'product_id = ?',
    'used_in_run_id IS NULL',
  ];
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

function mapRowToItem(row: ItemRow, productId: string): Item {
  const source: ItemSource =
    row.source === 'reddit' ? 'reddit' : row.source === 'hn' ? 'hn' : 'x';
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
