import { z } from 'zod';
import OpenAI from 'openai';
import { getDb, type IntentSignalRecord } from './db.js';
import { getProduct, toProductView } from './product-service.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';

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
  ai_score: number | null;
  ai_explanation: string | null;
  ai_drafted_reply: string | null;
  ai_processed_at: number | null;
  ai_error: string | null;
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
              s.ai_score, s.ai_explanation, s.ai_drafted_reply, s.ai_processed_at, s.ai_error,
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
              s.ai_score, s.ai_explanation, s.ai_drafted_reply, s.ai_processed_at, s.ai_error,
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
    ai_score: row.ai_score ?? null,
    ai_explanation: row.ai_explanation ?? null,
    ai_drafted_reply: row.ai_drafted_reply ?? null,
    ai_processed_at: row.ai_processed_at ?? null,
    ai_error: row.ai_error ?? null,
  };
}

function isIntentStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}

const ANALYZE_AI_TIMEOUT_MS = 60_000;

const analyzeResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1).max(500),
  drafted_reply: z.union([z.string().max(1000), z.null()]),
});

const ANALYZE_SYSTEM_PROMPT = `Tu es un expert marketing produit. Tu analyses un post (X, Reddit, ou Hacker News) pour déterminer s'il représente un signal d'intention d'achat pour un produit donné, et tu rédiges un brouillon de réponse contextuel.

Réponds STRICTEMENT en JSON avec cette structure exacte :
{
  "score": <entier 0-100>,
  "explanation": "<1-2 phrases en français expliquant pourquoi ce post est ou n'est pas un signal pertinent pour ce produit>",
  "drafted_reply": "<brouillon de réponse au post en français, dans la voix demandée. null si score < 40 (pas la peine de répondre).>"
}

Règles :
- score 0-39 = signal non pertinent ou faux positif
- score 40-69 = signal possible, mérite un œil
- score 70-100 = signal fort, à traiter rapidement
- drafted_reply max 280 caractères si source = 'x', max 500 sinon
- drafted_reply utilise le voix demandée (décontractée / professionnelle / directe / aidante)
- Pas d'emojis dans drafted_reply sauf si voix = décontractée
- Pas de mention de IA, de bot, ou de réponse automatique`;

export class IntentSignalNotFoundError extends Error {
  code = 'not_found' as const;
  constructor(id: number) {
    super(`Intent signal ${id} not found`);
    this.name = 'IntentSignalNotFoundError';
  }
}

export async function analyzeIntentSignal(signalId: number): Promise<IntentSignalView> {
  const db = getDb();
  const signal = getIntentSignal(signalId);
  if (!signal) {
    throw new IntentSignalNotFoundError(signalId);
  }

  const productRecord = getProduct(signal.product_id);
  const product = productRecord ? toProductView(productRecord) : null;

  const persistError = (message: string): IntentSignalView => {
    const now = Date.now();
    db.prepare(
      `UPDATE intent_signals
       SET ai_score = NULL, ai_explanation = NULL, ai_drafted_reply = NULL,
           ai_processed_at = ?, ai_error = ?
       WHERE id = ?`,
    ).run(now, message, signalId);
    logger.warn('Intent signal analysis failed', { signalId, error: message });
    return getIntentSignal(signalId)!;
  };

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    return persistError(
      `Configuration AI indisponible : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!config.GITHUB_TOKEN) {
    return persistError('Client AI indisponible : GITHUB_TOKEN manquant.');
  }

  const client = new OpenAI({
    baseURL: 'https://models.github.ai/inference',
    apiKey: config.GITHUB_TOKEN,
    timeout: ANALYZE_AI_TIMEOUT_MS,
  });

  const productName = product?.name ?? signal.product_id;
  const productDescription = product?.product_description ?? null;
  const replyVoice = product?.reply_voice ?? null;

  const userPayload = `PRODUIT
Nom: ${productName}
Description: ${productDescription || '(aucune description fournie)'}
Voix de réponse demandée: ${replyVoice || 'professionnelle'}

POST
Source: ${signal.source}
Auteur: ${signal.author}
URL: ${signal.url}
Pattern matché: "${signal.matched_pattern}"

Texte du post :
"""
${signal.text}
"""`;

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
        { role: 'user', content: userPayload },
      ],
    });
    logger.info('Intent analysis API usage', {
      signalId,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    return persistError(
      `Echec de l'appel AI : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return persistError(
      `Reponse AI non-JSON : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = analyzeResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return persistError(
      `Reponse AI invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  const { score, explanation, drafted_reply } = validated.data;
  const now = Date.now();
  db.prepare(
    `UPDATE intent_signals
     SET ai_score = ?, ai_explanation = ?, ai_drafted_reply = ?,
         ai_processed_at = ?, ai_error = NULL
     WHERE id = ?`,
  ).run(score, explanation, drafted_reply, now, signalId);

  logger.info('Intent signal analyzed', { signalId, score });
  return getIntentSignal(signalId)!;
}
