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

export const productCreateSchema = z.object({
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
});

export const productUpdateSchema = productCreateSchema.partial().omit({ id: true });

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

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
    `INSERT INTO products (id, name, x_query, discord_webhook, ai_prompt_override, collect_cron, publish_cron, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.x_query ?? null,
    input.discord_webhook ?? null,
    input.ai_prompt_override ?? null,
    input.collect_cron ?? null,
    input.publish_cron ?? null,
    Date.now(),
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
