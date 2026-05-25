import { z } from 'zod';
import { getDb, type ProductRecord, DEFAULT_PRODUCT_ID } from './db.js';
import { logger } from './logger.js';

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'L\'identifiant doit etre en minuscules, alphanumerique, avec tirets (pas en debut ni en fin).',
  });

const subredditNameSchema = z.string().regex(/^[A-Za-z0-9_]{2,21}$/, {
  message: 'Nom de subreddit invalide (2-21 caracteres alphanumeriques ou underscore).',
});

const hnKeywordSchema = z
  .string()
  .trim()
  .min(2, { message: 'Mot-cle Hacker News trop court (min 2 caracteres).' })
  .max(64, { message: 'Mot-cle Hacker News trop long (max 64 caracteres).' });

const productBaseSchema = z.object({
  id: slugSchema,
  name: z.string().min(1).max(120),
  x_query: z.string().max(500).optional().nullable(),
  discord_webhook: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://discord.com/api/webhooks/'), {
      message: 'Doit etre une URL de webhook Discord.',
    })
    .optional()
    .nullable(),
  ai_prompt_override: z.string().max(8000).optional().nullable(),
  collect_cron: z.string().max(120).optional().nullable(),
  publish_cron: z.string().max(120).optional().nullable(),
  x_enabled: z.boolean().optional(),
  reddit_enabled: z.boolean().optional(),
  reddit_subreddits: z
    .array(subredditNameSchema)
    .max(50, { message: 'Trop de subreddits (max 50).' })
    .optional()
    .nullable(),
  hn_enabled: z.boolean().optional(),
  hn_keywords: z
    .array(hnKeywordSchema)
    .max(20, { message: 'Trop de mots-cles Hacker News (max 20).' })
    .optional()
    .nullable(),
});

export const productCreateSchema = productBaseSchema
  .refine(
    (data) => {
      const x = data.x_enabled !== false;
      const reddit = data.reddit_enabled === true;
      const hn = data.hn_enabled === true;
      return x || reddit || hn;
    },
    { message: 'Active au moins une source (X, Reddit ou Hacker News).', path: ['x_enabled'] },
  )
  .superRefine((data, ctx) => {
    if (
      data.reddit_enabled === true &&
      (!data.reddit_subreddits || data.reddit_subreddits.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reddit_subreddits'],
        message: 'Au moins un subreddit est requis quand Reddit est active.',
      });
    }
    if (data.hn_enabled === true && (!data.hn_keywords || data.hn_keywords.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hn_keywords'],
        message: 'Au moins un mot-cle est requis quand Hacker News est active.',
      });
    }
  });

export const productUpdateSchema = productBaseSchema
  .partial()
  .omit({ id: true })
  .refine(
    (data) => {
      if (
        data.x_enabled === false &&
        data.reddit_enabled === false &&
        data.hn_enabled === false
      ) {
        return false;
      }
      return true;
    },
    { message: 'Active au moins une source (X, Reddit ou Hacker News).', path: ['x_enabled'] },
  );

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export interface ProductView
  extends Omit<
    ProductRecord,
    'reddit_subreddits' | 'x_enabled' | 'reddit_enabled' | 'hn_enabled' | 'hn_keywords'
  > {
  x_enabled: boolean;
  reddit_enabled: boolean;
  reddit_subreddits: string[];
  hn_enabled: boolean;
  hn_keywords: string[];
}

function deserializeStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // fall through
  }
  return [];
}

export function toProductView(product: ProductRecord): ProductView {
  return {
    ...product,
    x_enabled: product.x_enabled === 1,
    reddit_enabled: product.reddit_enabled === 1,
    reddit_subreddits: deserializeStringArray(product.reddit_subreddits),
    hn_enabled: product.hn_enabled === 1,
    hn_keywords: deserializeStringArray(product.hn_keywords),
  };
}

export function listProducts(includeArchived = false): ProductRecord[] {
  const db = getDb();
  if (includeArchived) {
    return db.prepare('SELECT * FROM products ORDER BY created_at ASC').all() as ProductRecord[];
  }
  return db
    .prepare('SELECT * FROM products WHERE archived_at IS NULL ORDER BY created_at ASC')
    .all() as ProductRecord[];
}

export function getProduct(id: string): ProductRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRecord | undefined;
}

export function productExists(id: string): boolean {
  return !!getProduct(id);
}

export function isProductActive(id: string): boolean {
  const p = getProduct(id);
  return !!p && p.archived_at === null;
}

export function createProduct(input: ProductCreateInput): ProductRecord {
  const db = getDb();
  db.prepare(
    `INSERT INTO products (id, name, x_query, discord_webhook, ai_prompt_override, collect_cron, publish_cron, created_at, x_enabled, reddit_enabled, reddit_subreddits, hn_enabled, hn_keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.x_query ?? null,
    input.discord_webhook ?? null,
    input.ai_prompt_override ?? null,
    input.collect_cron ?? null,
    input.publish_cron ?? null,
    Date.now(),
    input.x_enabled === false ? 0 : 1,
    input.reddit_enabled === true ? 1 : 0,
    input.reddit_subreddits && input.reddit_subreddits.length > 0
      ? JSON.stringify(input.reddit_subreddits)
      : null,
    input.hn_enabled === true ? 1 : 0,
    input.hn_keywords && input.hn_keywords.length > 0
      ? JSON.stringify(input.hn_keywords)
      : null,
  );
  logger.info('Product created', { productId: input.id });
  return getProduct(input.id)!;
}

export function updateProduct(id: string, patch: ProductUpdateInput): ProductRecord | undefined {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.x_query !== undefined) {
    sets.push('x_query = ?');
    values.push(patch.x_query);
  }
  if (patch.discord_webhook !== undefined) {
    sets.push('discord_webhook = ?');
    values.push(patch.discord_webhook);
  }
  if (patch.ai_prompt_override !== undefined) {
    sets.push('ai_prompt_override = ?');
    values.push(patch.ai_prompt_override);
  }
  if (patch.collect_cron !== undefined) {
    sets.push('collect_cron = ?');
    values.push(patch.collect_cron);
  }
  if (patch.publish_cron !== undefined) {
    sets.push('publish_cron = ?');
    values.push(patch.publish_cron);
  }
  if (patch.x_enabled !== undefined) {
    sets.push('x_enabled = ?');
    values.push(patch.x_enabled ? 1 : 0);
  }
  if (patch.reddit_enabled !== undefined) {
    sets.push('reddit_enabled = ?');
    values.push(patch.reddit_enabled ? 1 : 0);
  }
  if (patch.reddit_subreddits !== undefined) {
    sets.push('reddit_subreddits = ?');
    values.push(
      patch.reddit_subreddits && patch.reddit_subreddits.length > 0
        ? JSON.stringify(patch.reddit_subreddits)
        : null,
    );
  }
  if (patch.hn_enabled !== undefined) {
    sets.push('hn_enabled = ?');
    values.push(patch.hn_enabled ? 1 : 0);
  }
  if (patch.hn_keywords !== undefined) {
    sets.push('hn_keywords = ?');
    values.push(
      patch.hn_keywords && patch.hn_keywords.length > 0
        ? JSON.stringify(patch.hn_keywords)
        : null,
    );
  }

  if (sets.length === 0) {
    return getProduct(id);
  }

  values.push(id);
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  logger.info('Product updated', { productId: id });
  return getProduct(id);
}

export function archiveProduct(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE products SET archived_at = ? WHERE id = ? AND archived_at IS NULL')
    .run(Date.now(), id);
  if (result.changes > 0) {
    logger.info('Product archived', { productId: id });
    return true;
  }
  return false;
}

export function unarchiveProduct(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE products SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL')
    .run(id);
  return result.changes > 0;
}

export function deleteProductHard(id: string): boolean {
  if (id === DEFAULT_PRODUCT_ID) {
    return false;
  }
  const db = getDb();
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (result.changes > 0) {
    logger.info('Product hard-deleted', { productId: id });
    return true;
  }
  return false;
}
