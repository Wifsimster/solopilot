import { z } from 'zod';
import { getDb, type IntentSignalRecord } from './db.js';
import { getProduct, toProductView } from './product-service.js';
import { logger } from './logger.js';

export const INTENT_STATUSES = ['new', 'snoozed', 'dismissed', 'replied'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const intentStatusSchema = z.enum(INTENT_STATUSES);

export const intentSignalPatchSchema = z.object({
  status: intentStatusSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type IntentSignalPatch = z.infer<typeof intentSignalPatchSchema>;

export const intentSignalListQuerySchema = z.object({
  productId: z.string().min(1).max(64).optional(),
  status: intentStatusSchema.optional(),
  limit: z
    .preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().min(1).max(500))
    .optional(),
});

export interface IntentSignalListOptions {
  productId?: string;
  status?: IntentStatus;
  limit?: number;
}

export interface IntentSignalView {
  id: number;
  item_id: string;
  product_id: string;
  source: string;
  matched_pattern: string;
  status: IntentStatus;
  notes: string | null;
  created_at: number;
  text: string;
  author: string;
  url: string;
}

interface IntentSignalJoinedRow extends IntentSignalRecord {
  text: string | null;
  author: string | null;
  url: string | null;
}

interface TweetTextRow {
  id: string;
  text: string;
  source: string;
}

export interface MatchIntentResult {
  matched: number;
}

export function matchIntentForProduct(
  productId: string,
  newItemIds: string[],
): MatchIntentResult {
  if (newItemIds.length === 0) {
    return { matched: 0 };
  }

  const productRecord = getProduct(productId);
  if (!productRecord) {
    return { matched: 0 };
  }
  const product = toProductView(productRecord);
  if (!product.intent_enabled || product.intent_keywords.length === 0) {
    return { matched: 0 };
  }

  const db = getDb();
  const placeholders = newItemIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, text, source FROM tweets WHERE id IN (${placeholders}) AND product_id = ?`,
    )
    .all(...newItemIds, productId) as TweetTextRow[];

  if (rows.length === 0) {
    return { matched: 0 };
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO intent_signals (item_id, product_id, source, matched_pattern, status, notes, created_at)
     VALUES (?, ?, ?, ?, 'new', NULL, ?)`,
  );

  const insertMany = db.transaction((items: TweetTextRow[]) => {
    let matched = 0;
    const now = Date.now();
    for (const item of items) {
      const lowerText = item.text.toLowerCase();
      for (const kw of product.intent_keywords) {
        const lowerKw = kw.toLowerCase();
        if (lowerKw.length === 0) continue;
        if (lowerText.includes(lowerKw)) {
          const result = insert.run(item.id, productId, item.source, kw, now);
          if (result.changes > 0) matched++;
        }
      }
    }
    return matched;
  });

  const matched = insertMany(rows);
  if (matched > 0) {
    logger.info('Intent signals matched', { productId, matched, items: rows.length });
  }
  return { matched };
}

export function listIntentSignals(opts: IntentSignalListOptions = {}): IntentSignalView[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.productId) {
    clauses.push('s.product_id = ?');
    params.push(opts.productId);
  }
  if (opts.status) {
    clauses.push('s.status = ?');
    params.push(opts.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT s.id, s.item_id, s.product_id, s.source, s.matched_pattern, s.status, s.notes, s.created_at,
              t.text AS text, t.author AS author, t.url AS url
       FROM intent_signals s
       LEFT JOIN tweets t ON t.id = s.item_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(...params) as IntentSignalJoinedRow[];

  return rows.map(mapRowToView);
}

export function getIntentSignal(id: number): IntentSignalView | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.item_id, s.product_id, s.source, s.matched_pattern, s.status, s.notes, s.created_at,
              t.text AS text, t.author AS author, t.url AS url
       FROM intent_signals s
       LEFT JOIN tweets t ON t.id = s.item_id
       WHERE s.id = ?`,
    )
    .get(id) as IntentSignalJoinedRow | undefined;
  return row ? mapRowToView(row) : undefined;
}

export function updateIntentSignal(
  id: number,
  patch: IntentSignalPatch,
): IntentSignalView | undefined {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    values.push(patch.notes);
  }

  if (sets.length === 0) {
    return getIntentSignal(id);
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE intent_signals SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) {
    return undefined;
  }
  logger.info('Intent signal updated', { id, status: patch.status, notesUpdated: patch.notes !== undefined });
  return getIntentSignal(id);
}

function mapRowToView(row: IntentSignalJoinedRow): IntentSignalView {
  const status: IntentStatus = isIntentStatus(row.status) ? row.status : 'new';
  return {
    id: row.id,
    item_id: row.item_id,
    product_id: row.product_id,
    source: row.source,
    matched_pattern: row.matched_pattern,
    status,
    notes: row.notes,
    created_at: row.created_at,
    text: row.text ?? '',
    author: row.author ?? '',
    url: row.url ?? '',
  };
}

function isIntentStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}
