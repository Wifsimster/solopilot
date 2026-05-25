import { getDb, DEFAULT_PRODUCT_ID } from './db.js';
import type { Tweet } from './ports.js';
import { logger } from './logger.js';

/**
 * Stores tweets with deduplication via INSERT OR IGNORE on tweet ID.
 * Returns the count of newly inserted tweets.
 */
export function storeTweets(
  tweets: Tweet[],
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tweets (id, text, created_at, urls, collection_date, product_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((items: Tweet[]) => {
    let inserted = 0;
    for (const tweet of items) {
      const result = insert.run(
        tweet.id,
        tweet.text,
        tweet.createdAt,
        JSON.stringify(tweet.urls),
        collectionDate,
        productId,
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(tweets);
  logger.info('Tweets stored', {
    total: tweets.length,
    new: inserted,
    duplicates: tweets.length - inserted,
    collectionDate,
    productId,
  });
  return inserted;
}

/**
 * Returns all tweets for a given date that haven't been used in a publish run yet.
 */
export function getUnpublishedTweets(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): Tweet[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, text, created_at, urls FROM tweets
       WHERE collection_date = ? AND product_id = ? AND used_in_run_id IS NULL
       ORDER BY created_at ASC`,
    )
    .all(collectionDate, productId) as {
    id: string;
    text: string;
    created_at: string;
    urls: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    urls: JSON.parse(row.urls) as string[],
  }));
}

/**
 * Marks tweets as consumed by a publish run.
 */
export function markTweetsAsUsed(tweetIds: string[], runId: number): void {
  const db = getDb();
  const update = db.prepare('UPDATE tweets SET used_in_run_id = ? WHERE id = ?');
  const updateMany = db.transaction((ids: string[]) => {
    for (const id of ids) {
      update.run(runId, id);
    }
  });
  updateMany(tweetIds);
}

/**
 * Releases tweets associated with a run, making them available for re-processing.
 */
export function releaseTweetsForRun(runId: number): void {
  const db = getDb();
  db.prepare('UPDATE tweets SET used_in_run_id = NULL WHERE used_in_run_id = ?').run(runId);
}

/**
 * Returns the collection date(s) for tweets linked to a given run.
 */
export function getCollectionDateForRun(runId: number): string | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT DISTINCT collection_date FROM tweets WHERE used_in_run_id = ? LIMIT 1')
    .get(runId) as { collection_date: string } | undefined;
  return row?.collection_date;
}

/**
 * Returns the count of tweets collected today that are not yet used.
 */
export function countUnpublishedTweets(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM tweets
       WHERE collection_date = ? AND product_id = ? AND used_in_run_id IS NULL`,
    )
    .get(collectionDate, productId) as { count: number };
  return row.count;
}

/**
 * Returns tweets used in a specific publish run.
 */
export function getTweetsByRunId(
  runId: number,
  limit = 50,
  offset = 0,
): { tweets: Tweet[]; total: number } {
  const db = getDb();
  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM tweets WHERE used_in_run_id = ?`)
    .get(runId) as { count: number };

  const rows = db
    .prepare(
      `SELECT id, text, created_at, urls FROM tweets
       WHERE used_in_run_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(runId, limit, offset) as {
    id: string;
    text: string;
    created_at: string;
    urls: string;
  }[];

  return {
    tweets: rows.map((row) => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      urls: JSON.parse(row.urls) as string[],
    })),
    total: countRow.count,
  };
}

/**
 * Returns the total count of tweets collected for a given date.
 */
export function countTweetsForDate(
  collectionDate: string,
  productId: string = DEFAULT_PRODUCT_ID,
): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM tweets WHERE collection_date = ? AND product_id = ?`)
    .get(collectionDate, productId) as { count: number };
  return row.count;
}
