import { z } from 'zod';
import type { Config } from './config.js';
import { getDb } from './db.js';
import { getProduct, toProductView, type ProductView } from './product-service.js';
import { createAiClient, resolveAiApiKey, jsonModeParams, parseJsonResponse } from './ai-client.js';
import { logger } from './logger.js';

// Default triage taxonomy (stolen from Stalkr's mention categories). A product
// can replace it via `triage_categories`; 'autre' is always kept as the escape
// hatch so the model never force-fits an item into a wrong bucket.
export const DEFAULT_TRIAGE_CATEGORIES = [
  'bug',
  'temoignage',
  'demande_fonctionnalite',
  'objection',
  'question',
  'actualite',
  'autre',
] as const;

export const TRIAGE_FALLBACK_CATEGORY = 'autre';

const TRIAGE_AI_TIMEOUT_MS = 60_000;
const TRIAGE_BATCH_SIZE = 30;
const ITEM_TEXT_MAX_CHARS = 600;

const triagedItemSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1).max(60),
  urgency: z.number().int().min(0).max(100),
  relevance: z.number().int().min(0).max(100),
});

const triageResponseSchema = z.object({
  items: z.array(triagedItemSchema),
});

export interface TriageResult {
  triaged: number;
  failed: number;
}

interface TriageItemRow {
  id: string;
  text: string;
  source: string;
  author: string;
}

/** Effective category list for a product: custom list if set, defaults otherwise. */
export function triageCategoriesForProduct(product: ProductView | null): string[] {
  const custom = product?.triage_categories ?? [];
  const categories = custom.length > 0 ? [...custom] : [...DEFAULT_TRIAGE_CATEGORIES];
  if (!categories.includes(TRIAGE_FALLBACK_CATEGORY)) {
    categories.push(TRIAGE_FALLBACK_CATEGORY);
  }
  return categories;
}

function buildSystemPrompt(product: ProductView, categories: string[]): string {
  return `Tu es un assistant de veille pour UN produit specifique. Tu recois une liste d'items collectes (posts X, Reddit ou Hacker News) et tu classes CHAQUE item individuellement.

PRODUIT
- Nom: ${product.name}
- Description: ${product.product_description ?? '(non fournie)'}
- Audience cible: ${product.target_audience ?? '(non definie)'}

Pour CHAQUE item fourni, determine :
1. "category" — UNE seule valeur parmi : ${categories.join(' | ')}
   Choisis la categorie la plus representative du contenu VIS-A-VIS de ce produit. Si aucune ne convient clairement, utilise "${TRIAGE_FALLBACK_CATEGORY}".
2. "urgency" — entier 0-100 : a quel point ce post demande une attention RAPIDE du proprietaire du produit.
   - 80-100 = critique (plainte qui prend de l'ampleur, fausse information, bug bloquant rapporte publiquement, fil d'achat a forte intention)
   - 40-79 = a regarder bientot (question directe, comparaison concurrent, retour negatif isole)
   - 0-39 = informatif, aucune action rapide requise (actualite, discussion generale)
3. "relevance" — entier 0-100 : pertinence du post pour ce produit, son domaine et son audience (0 = hors sujet, 100 = directement lie).

Reponds STRICTEMENT en JSON avec cette structure exacte :
{
  "items": [
    { "id": "<id de l'item, recopie tel quel>", "category": "<categorie>", "urgency": <entier>, "relevance": <entier> }
  ]
}

Regles :
- Retourne EXACTEMENT un objet par item fourni, avec son "id" recopie a l'identique.
- N'invente aucun id, n'omets aucun item.
- Aucun texte hors du JSON.`;
}

function buildUserPayload(items: TriageItemRow[]): string {
  const lines = items.map((item) => {
    const text =
      item.text.length > ITEM_TEXT_MAX_CHARS
        ? `${item.text.slice(0, ITEM_TEXT_MAX_CHARS)}…`
        : item.text;
    return `ID: ${item.id}\nSource: ${item.source}\nAuteur: ${item.author || '(inconnu)'}\nTexte:\n"""\n${text}\n"""`;
  });
  return `ITEMS A TRIER (${items.length})\n\n${lines.join('\n\n---\n\n')}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function persistBatchError(itemIds: string[], message: string): void {
  const db = getDb();
  const now = Date.now();
  const cleaned = message.trim().slice(0, 500);
  const update = db.prepare(
    `UPDATE tweets SET triage_category = NULL, triage_urgency = NULL, triage_relevance = NULL,
     triaged_at = ?, triage_error = ? WHERE id = ?`,
  );
  const updateMany = db.transaction((ids: string[]) => {
    for (const id of ids) update.run(now, cleaned, id);
  });
  updateMany(itemIds);
}

/**
 * Classifies newly collected items for a product: category, urgency (0-100)
 * and relevance (0-100), persisted on each `tweets` row (Stalkr-style
 * per-mention triage instead of classify-and-discard at digest time).
 *
 * Opt-in per product (`triage_enabled`). Batched AI calls; a failed batch is
 * marked with `triage_error` (and `triaged_at`) so collection never blocks and
 * failed items are not retried forever. Missing AI key = silent skip so items
 * stay pending and can be triaged once a key is configured.
 */
export async function triageNewItems(
  config: Config,
  productId: string,
  itemIds: string[],
): Promise<TriageResult> {
  if (itemIds.length === 0) return { triaged: 0, failed: 0 };

  const productRecord = getProduct(productId);
  if (!productRecord) return { triaged: 0, failed: 0 };
  const product = toProductView(productRecord);
  if (!product.triage_enabled) return { triaged: 0, failed: 0 };

  if (!resolveAiApiKey(config)) {
    logger.info('Item triage skipped: no AI key configured', { productId });
    return { triaged: 0, failed: 0 };
  }

  const db = getDb();
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, text, source, author FROM tweets
       WHERE id IN (${placeholders}) AND product_id = ? AND triaged_at IS NULL`,
    )
    .all(...itemIds, productId) as TriageItemRow[];
  if (rows.length === 0) return { triaged: 0, failed: 0 };

  const categories = triageCategoriesForProduct(product);
  const systemPrompt = buildSystemPrompt(product, categories);
  const client = createAiClient(config, { timeout: TRIAGE_AI_TIMEOUT_MS });

  const persist = db.prepare(
    `UPDATE tweets SET triage_category = ?, triage_urgency = ?, triage_relevance = ?,
     triaged_at = ?, triage_error = NULL WHERE id = ?`,
  );

  let triaged = 0;
  let failed = 0;

  for (const batch of chunk(rows, TRIAGE_BATCH_SIZE)) {
    let raw: string;
    try {
      const response = await client.chat.completions.create({
        model: config.AI_MODEL,
        max_tokens: 4000,
        ...jsonModeParams(config),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildUserPayload(batch) },
        ],
      });
      logger.info('Item triage API usage', {
        productId,
        items: batch.length,
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        model: response.model,
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (err) {
      const message = `Echec de l'appel AI : ${err instanceof Error ? err.message : String(err)}`;
      persistBatchError(
        batch.map((b) => b.id),
        message,
      );
      failed += batch.length;
      logger.warn('Item triage batch failed', { productId, items: batch.length, error: message });
      continue;
    }

    let validated: z.infer<typeof triageResponseSchema>;
    try {
      const parsed = triageResponseSchema.safeParse(parseJsonResponse(raw));
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      }
      validated = parsed.data;
    } catch (err) {
      const message = `Reponse AI invalide : ${err instanceof Error ? err.message : String(err)}`;
      persistBatchError(
        batch.map((b) => b.id),
        message,
      );
      failed += batch.length;
      logger.warn('Item triage batch failed', { productId, items: batch.length, error: message });
      continue;
    }

    const byId = new Map(validated.items.map((item) => [item.id, item]));
    const now = Date.now();
    const missing: string[] = [];
    const persistBatch = db.transaction((items: TriageItemRow[]) => {
      for (const row of items) {
        const result = byId.get(row.id);
        if (!result) {
          missing.push(row.id);
          continue;
        }
        const category = categories.includes(result.category)
          ? result.category
          : TRIAGE_FALLBACK_CATEGORY;
        persist.run(category, result.urgency, result.relevance, now, row.id);
        triaged++;
      }
    });
    persistBatch(batch);

    if (missing.length > 0) {
      persistBatchError(missing, "Item absent de la reponse AI.");
      failed += missing.length;
    }
  }

  logger.info('Item triage complete', { productId, triaged, failed, total: rows.length });
  return { triaged, failed };
}
