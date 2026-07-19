import { z } from 'zod';
import { getDb, type IntentSignalRecord, type IntentSignalReplyRecord } from './db.js';
import { getProduct, toProductView, type ProductView } from './product-service.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { createAiClient, resolveAiApiKey, jsonModeParams, parseJsonResponse } from './ai-client.js';

export const INTENT_STATUSES = ['new', 'snoozed', 'dismissed', 'replied'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

// Intent taxonomy (stolen from Buska's 5-category model): every analyzed signal
// is classified into one bucket so the owner can triage by *kind* of signal, not
// just by score. 'autre' is the escape hatch so the model never force-fits.
export const INTENT_CATEGORIES = [
  'demande_active',
  'mention_concurrent',
  'signal_douleur',
  'question',
  'recommandation',
  'autre',
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

const intentStatusSchema = z.enum(INTENT_STATUSES, {
  errorMap: () => ({
    message: 'Statut invalide (new, snoozed, dismissed ou replied).',
  }),
});

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

export interface IntentSignalReplyView {
  id: number;
  angle: string | null;
  text: string;
  used: boolean;
  generated_at: number;
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
  ai_icp_score: number | null;
  ai_icp_reason: string | null;
  ai_intent_category: string | null;
  replies: IntentSignalReplyView[];
}

export const generateRepliesSchema = z.object({
  count: z
    .number({ invalid_type_error: 'Le nombre de variantes doit etre un entier.' })
    .int({ message: 'Le nombre de variantes doit etre un entier.' })
    .min(1, { message: 'Il faut au moins 1 variante.' })
    .max(5, { message: 'Maximum 5 variantes par generation.' })
    .optional(),
});

export const intentReplyPatchSchema = z.object({
  used: z.boolean({
    invalid_type_error: 'Le champ used doit etre un booleen.',
    required_error: 'Le champ used est requis.',
  }),
});

export type GenerateRepliesInput = z.infer<typeof generateRepliesSchema>;
export type IntentReplyPatch = z.infer<typeof intentReplyPatchSchema>;

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

/**
 * Lowercase, trim, and drop empties — used to pre-process exclude/require lists
 * once per match run so the hot per-item loop only does substring checks.
 */
function normalizeFilterTerms(terms: string[]): string[] {
  return terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 0);
}

/**
 * Syften-style boolean gate applied before the include-keyword pass:
 * - reject if the post contains ANY exclude term;
 * - if require terms exist, the post must contain AT LEAST ONE of them.
 * `excludeLower` / `requireLower` are assumed already normalized.
 */
function postPassesFilters(
  lowerText: string,
  excludeLower: string[],
  requireLower: string[],
): boolean {
  for (const ex of excludeLower) {
    if (lowerText.includes(ex)) return false;
  }
  if (requireLower.length > 0) {
    return requireLower.some((rq) => lowerText.includes(rq));
  }
  return true;
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

  const excludeLower = normalizeFilterTerms(product.intent_exclude_keywords);
  const requireLower = normalizeFilterTerms(product.intent_require_keywords);

  const insertMany = db.transaction((items: TweetTextRow[]) => {
    let matched = 0;
    const now = Date.now();
    for (const item of items) {
      const lowerText = item.text.toLowerCase();
      if (!postPassesFilters(lowerText, excludeLower, requireLower)) continue;
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

export interface RematchIntentResult {
  matched: number;
  scanned: number;
}

export function rematchIntentForProductAll(productId: string): RematchIntentResult {
  const productRecord = getProduct(productId);
  if (!productRecord) {
    return { matched: 0, scanned: 0 };
  }
  const product = toProductView(productRecord);
  if (!product.intent_enabled || product.intent_keywords.length === 0) {
    return { matched: 0, scanned: 0 };
  }

  const db = getDb();
  const rows = db
    .prepare(`SELECT id, text, source FROM tweets WHERE product_id = ?`)
    .all(productId) as TweetTextRow[];

  if (rows.length === 0) {
    return { matched: 0, scanned: 0 };
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO intent_signals (item_id, product_id, source, matched_pattern, status, notes, created_at)
     VALUES (?, ?, ?, ?, 'new', NULL, ?)`,
  );

  const excludeLower = normalizeFilterTerms(product.intent_exclude_keywords);
  const requireLower = normalizeFilterTerms(product.intent_require_keywords);

  const insertMany = db.transaction((items: TweetTextRow[]) => {
    let matched = 0;
    const now = Date.now();
    for (const item of items) {
      const lowerText = item.text.toLowerCase();
      if (!postPassesFilters(lowerText, excludeLower, requireLower)) continue;
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
  return { matched, scanned: rows.length };
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
              s.ai_icp_score, s.ai_icp_reason, s.ai_intent_category,
              t.text AS text, t.author AS author, t.url AS url
       FROM intent_signals s
       LEFT JOIN tweets t ON t.id = s.item_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(...params) as IntentSignalJoinedRow[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const repliesBySignal = fetchRepliesForSignals(ids);
  return rows.map((row) => mapRowToView(row, repliesBySignal.get(row.id) ?? []));
}

export function getIntentSignal(id: number): IntentSignalView | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.item_id, s.product_id, s.source, s.matched_pattern, s.status, s.notes, s.created_at,
              s.ai_score, s.ai_explanation, s.ai_drafted_reply, s.ai_processed_at, s.ai_error,
              s.ai_icp_score, s.ai_icp_reason, s.ai_intent_category,
              t.text AS text, t.author AS author, t.url AS url
       FROM intent_signals s
       LEFT JOIN tweets t ON t.id = s.item_id
       WHERE s.id = ?`,
    )
    .get(id) as IntentSignalJoinedRow | undefined;
  if (!row) return undefined;
  const replies = listRepliesForSignal(row.id).map(toReplyView);
  return mapRowToView(row, replies);
}

function fetchRepliesForSignals(signalIds: number[]): Map<number, IntentSignalReplyView[]> {
  const map = new Map<number, IntentSignalReplyView[]>();
  if (signalIds.length === 0) return map;
  const db = getDb();
  const placeholders = signalIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, intent_signal_id, angle, text, used, generated_at
       FROM intent_signal_replies
       WHERE intent_signal_id IN (${placeholders})
       ORDER BY generated_at DESC, id DESC`,
    )
    .all(...signalIds) as IntentSignalReplyRecord[];
  for (const r of rows) {
    const list = map.get(r.intent_signal_id) ?? [];
    list.push(toReplyView(r));
    map.set(r.intent_signal_id, list);
  }
  return map;
}

function toReplyView(row: IntentSignalReplyRecord): IntentSignalReplyView {
  return {
    id: row.id,
    angle: row.angle,
    text: row.text,
    used: row.used === 1,
    generated_at: row.generated_at,
  };
}

export function listRepliesForSignal(signalId: number): IntentSignalReplyRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, intent_signal_id, angle, text, used, generated_at
       FROM intent_signal_replies
       WHERE intent_signal_id = ?
       ORDER BY generated_at DESC, id DESC`,
    )
    .all(signalId) as IntentSignalReplyRecord[];
}

export function getReply(id: number): IntentSignalReplyRecord | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, intent_signal_id, angle, text, used, generated_at
       FROM intent_signal_replies
       WHERE id = ?`,
    )
    .get(id) as IntentSignalReplyRecord | undefined;
}

export function updateReplyUsedFlag(
  id: number,
  used: boolean,
): IntentSignalReplyRecord | undefined {
  const db = getDb();
  const result = db
    .prepare(`UPDATE intent_signal_replies SET used = ? WHERE id = ?`)
    .run(used ? 1 : 0, id);
  if (result.changes === 0) return undefined;
  logger.info('Intent reply updated', { replyId: id, used });
  return getReply(id);
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

function mapRowToView(
  row: IntentSignalJoinedRow,
  replies: IntentSignalReplyView[] = [],
): IntentSignalView {
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
    ai_icp_score: row.ai_icp_score ?? null,
    ai_icp_reason: row.ai_icp_reason ?? null,
    ai_intent_category: row.ai_intent_category ?? null,
    replies,
  };
}

function isIntentStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}

const ANALYZE_AI_TIMEOUT_MS = 60_000;
const DEFAULT_REPLY_COUNT = 3;
const MAX_REPLY_COUNT = 5;
const MIN_REPLY_COUNT = 1;

const replyVariantSchema = z.object({
  angle: z.string().min(2).max(60),
  text: z.string().min(10).max(600),
});

const analyzeResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1).max(500),
  icp_score: z.number().int().min(0).max(100),
  icp_reason: z.string().min(1).max(500),
  intent_category: z.enum(INTENT_CATEGORIES).catch('autre'),
  replies: z.array(replyVariantSchema).min(0).max(MAX_REPLY_COUNT),
});

const repliesOnlyResponseSchema = z.object({
  replies: z.array(replyVariantSchema).min(1).max(MAX_REPLY_COUNT),
});

function clampReplyCount(value: number | undefined): number {
  const v = value ?? DEFAULT_REPLY_COUNT;
  if (!Number.isFinite(v)) return DEFAULT_REPLY_COUNT;
  return Math.min(Math.max(Math.trunc(v), MIN_REPLY_COUNT), MAX_REPLY_COUNT);
}

function characterLimitForSource(source: string): number {
  return source === 'x' ? 280 : 500;
}

function buildAnalyzeSystemPrompt(count: number, charLimit: number, source: string): string {
  return `Tu es un expert marketing produit. Tu analyses un post (X, Reddit, ou Hacker News) pour determiner s'il represente un signal d'intention d'achat pour un produit donne, tu evalues l'adequation de l'auteur avec le profil client ideal (ICP), et tu rediges plusieurs variantes de brouillon de reponse, chacune avec un ANGLE different.

Reponds STRICTEMENT en JSON avec cette structure exacte :
{
  "score": <entier 0-100>,
  "explanation": "<1-2 phrases en francais expliquant pourquoi ce post est ou n'est pas un signal pertinent pour ce produit>",
  "icp_score": <entier 0-100>,
  "icp_reason": "<1-2 phrases en francais expliquant l'adequation entre l'auteur/contexte du post et le profil client ideal>",
  "intent_category": "<une seule valeur parmi: demande_active | mention_concurrent | signal_douleur | question | recommandation | autre>",
  "replies": [
    { "angle": "<libelle court 2-6 mots>", "text": "<le brouillon de reponse>" }
  ]
}

Regles de "intent_category" (le TYPE de signal — choisis la categorie la plus representative) :
- "demande_active" = l'auteur cherche activement un outil/une solution ("quelqu'un connait un outil pour...", "je cherche une alternative a...")
- "mention_concurrent" = l'auteur parle d'un produit concurrent (le nomme, le compare, s'en plaint)
- "signal_douleur" = l'auteur exprime un probleme ou une frustration sans forcement demander de solution
- "question" = l'auteur pose une question generale sur le domaine, sans demande d'achat explicite
- "recommandation" = l'auteur demande ou donne une recommandation de produit
- "autre" = aucune categorie ci-dessus ne convient clairement
Cette categorie est INDEPENDANTE du score : un post peut etre "question" avec un score faible.

Regles de "score" (intention d'achat — le post exprime-t-il un besoin que ce produit resout ?) :
- 0-39 = signal non pertinent ou faux positif → "replies" DOIT etre un tableau vide []
- 40-69 = signal possible, merite un oeil → genere exactement ${count} variantes
- 70-100 = signal fort, a traiter rapidement → genere exactement ${count} variantes

Regles de "icp_score" (adequation avec le profil client ideal — l'auteur RESSEMBLE-t-il au client cible ?) :
- C'est une dimension DISTINCTE du score d'intention. Un post peut avoir une forte intention mais un auteur hors-cible (icp faible), ou un auteur parfaitement cible sans intention immediate.
- Base-toi sur l'audience cible et les propositions de valeur fournies dans la section PRODUIT.
- 0-39 = auteur/contexte hors du profil cible
- 40-69 = adequation partielle ou incertaine
- 70-100 = correspond clairement au profil client ideal
- Si l'audience cible n'est pas fournie, retourne icp_score = 50 et explique dans icp_reason que le profil cible n'est pas defini.

Regles sur les variantes de reponse :
- Chaque variante prend un ANGLE different. Exemples d'angles a varier :
  * question directe
  * preuve sociale (mention discrete d'un cas client)
  * resume probleme → solution
  * expertise discrete (apport de valeur sans pitch)
  * humour leger
  * partage d'experience personnelle
  * recommandation indirecte
- Le champ "angle" est un libelle court (2-6 mots) qui resume l'approche.
- Source = '${source}' → limite stricte de ${charLimit} caracteres par variante (text).
- Utilise la voix demandee (decontractee / professionnelle / directe / aidante).
- Pas d'emojis dans "text" sauf si voix = decontractee.
- Pas de mention d'IA, de bot, ou de reponse automatique.
- Pas de spam ou de pitch agressif.`;
}

function buildRepliesOnlySystemPrompt(count: number, charLimit: number, source: string): string {
  return `Tu es un expert marketing produit. Tu rediges ${count} variantes de brouillon de reponse a un post, chacune avec un ANGLE different.

Reponds STRICTEMENT en JSON avec cette structure exacte :
{
  "replies": [
    { "angle": "<libelle court 2-6 mots>", "text": "<le brouillon de reponse>" }
  ]
}

Regles :
- Genere exactement ${count} variantes.
- Chaque variante prend un ANGLE different. Exemples :
  * question directe
  * preuve sociale (mention discrete d'un cas client)
  * resume probleme → solution
  * expertise discrete (apport de valeur sans pitch)
  * humour leger
  * partage d'experience personnelle
  * recommandation indirecte
- Le champ "angle" est un libelle court (2-6 mots) qui resume l'approche.
- Source = '${source}' → limite stricte de ${charLimit} caracteres par variante (text).
- Utilise la voix demandee (decontractee / professionnelle / directe / aidante).
- Pas d'emojis dans "text" sauf si voix = decontractee.
- Pas de mention d'IA, de bot, ou de reponse automatique.
- Pas de spam ou de pitch agressif.`;
}

function buildUserPayload(signal: IntentSignalView, product: ProductView | null, count: number): string {
  const productName = product?.name ?? signal.product_id;
  const productDescription = product?.product_description ?? null;
  const replyVoice = product?.reply_voice ?? null;
  const targetAudience = product?.target_audience ?? null;
  const valueProps = product?.value_props ?? [];
  return `PRODUIT
Nom: ${productName}
Description: ${productDescription || '(aucune description fournie)'}
Audience cible (profil client ideal): ${targetAudience || '(non definie)'}
Propositions de valeur: ${valueProps.length > 0 ? valueProps.map((v) => `- ${v}`).join('\n') : '(non definies)'}
Voix de reponse demandee: ${replyVoice || 'professionnelle'}

POST
Source: ${signal.source}
Auteur: ${signal.author}
URL: ${signal.url}
Pattern matche: "${signal.matched_pattern}"

Texte du post :
"""
${signal.text}
"""

PARAMETRES DE GENERATION
Nombre de variantes a produire (si score >= 40): ${count}`;
}

export class IntentSignalNotFoundError extends Error {
  code = 'not_found' as const;
  constructor(id: number) {
    super(`Intent signal ${id} not found`);
    this.name = 'IntentSignalNotFoundError';
  }
}

export class IntentReplyGenerationError extends Error {
  constructor(message: string) {
    super(message.trim());
    this.name = 'IntentReplyGenerationError';
  }
}

function insertReplies(
  signalId: number,
  variants: { angle: string; text: string }[],
): IntentSignalReplyRecord[] {
  const db = getDb();
  if (variants.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO intent_signal_replies (intent_signal_id, angle, text, used, generated_at)
     VALUES (?, ?, ?, 0, ?)`,
  );
  const insertedIds: number[] = [];
  const insertMany = db.transaction((items: { angle: string; text: string }[]) => {
    const now = Date.now();
    for (const item of items) {
      const result = insert.run(signalId, item.angle, item.text, now);
      insertedIds.push(Number(result.lastInsertRowid));
    }
  });
  insertMany(variants);

  const placeholders = insertedIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, intent_signal_id, angle, text, used, generated_at
       FROM intent_signal_replies
       WHERE id IN (${placeholders})
       ORDER BY generated_at DESC, id DESC`,
    )
    .all(...insertedIds) as IntentSignalReplyRecord[];
}

export async function analyzeIntentSignal(
  signalId: number,
  opts: { count?: number } = {},
): Promise<IntentSignalView> {
  const db = getDb();
  const signal = getIntentSignal(signalId);
  if (!signal) {
    throw new IntentSignalNotFoundError(signalId);
  }

  const productRecord = getProduct(signal.product_id);
  const product = productRecord ? toProductView(productRecord) : null;
  const count = clampReplyCount(opts.count);

  const persistError = (message: string): IntentSignalView => {
    const now = Date.now();
    const cleaned = message.trim();
    db.prepare(
      `UPDATE intent_signals
       SET ai_score = NULL, ai_explanation = NULL, ai_drafted_reply = NULL,
           ai_processed_at = ?, ai_error = ?,
           ai_icp_score = NULL, ai_icp_reason = NULL, ai_intent_category = NULL
       WHERE id = ?`,
    ).run(now, cleaned, signalId);
    logger.warn('Intent signal analysis failed', { signalId, error: cleaned });
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

  if (!resolveAiApiKey(config)) {
    return persistError('Client AI indisponible : clé AI (AI_API_KEY ou GITHUB_TOKEN) manquante.');
  }

  const client = createAiClient(config, { timeout: ANALYZE_AI_TIMEOUT_MS });

  const charLimit = characterLimitForSource(signal.source);
  const systemPrompt = buildAnalyzeSystemPrompt(count, charLimit, signal.source);
  const userPayload = buildUserPayload(signal, product, count);

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 2048,
      ...jsonModeParams(config),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    });
    logger.info('Intent analysis API usage', {
      signalId,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
      count,
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    return persistError(
      `Echec de l'appel AI : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseJsonResponse(raw);
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

  const { score, explanation, icp_score, icp_reason, intent_category, replies } = validated.data;
  const now = Date.now();
  const lowScore = score < 40;
  const effectiveReplies = lowScore ? [] : replies;
  const draftedReply = effectiveReplies.length > 0 ? effectiveReplies[0].text : null;

  const persist = db.transaction(() => {
    db.prepare(
      `UPDATE intent_signals
       SET ai_score = ?, ai_explanation = ?, ai_drafted_reply = ?,
           ai_processed_at = ?, ai_error = NULL,
           ai_icp_score = ?, ai_icp_reason = ?, ai_intent_category = ?
       WHERE id = ?`,
    ).run(score, explanation, draftedReply, now, icp_score, icp_reason, intent_category, signalId);
    if (effectiveReplies.length > 0) {
      const insert = db.prepare(
        `INSERT INTO intent_signal_replies (intent_signal_id, angle, text, used, generated_at)
         VALUES (?, ?, ?, 0, ?)`,
      );
      for (const variant of effectiveReplies) {
        insert.run(signalId, variant.angle, variant.text, now);
      }
    }
  });
  persist();

  logger.info('Intent signal analyzed', {
    signalId,
    score,
    icpScore: icp_score,
    category: intent_category,
    replies: effectiveReplies.length,
  });
  return getIntentSignal(signalId)!;
}

export async function generateRepliesOnly(
  signal: IntentSignalView,
  product: ProductView | null,
  opts: { count: number },
): Promise<IntentSignalReplyRecord[]> {
  const count = clampReplyCount(opts.count);

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const message = `Configuration AI indisponible : ${err instanceof Error ? err.message : String(err)}`;
    logger.warn('Intent reply generation failed', { signalId: signal.id, error: message.trim() });
    throw new IntentReplyGenerationError(message);
  }

  if (!resolveAiApiKey(config)) {
    const message = 'Client AI indisponible : clé AI (AI_API_KEY ou GITHUB_TOKEN) manquante.';
    logger.warn('Intent reply generation failed', { signalId: signal.id, error: message.trim() });
    throw new IntentReplyGenerationError(message);
  }

  const client = createAiClient(config, { timeout: ANALYZE_AI_TIMEOUT_MS });

  const charLimit = characterLimitForSource(signal.source);
  const systemPrompt = buildRepliesOnlySystemPrompt(count, charLimit, signal.source);
  const userPayload = buildUserPayload(signal, product, count);

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 1500,
      ...jsonModeParams(config),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    });
    logger.info('Intent reply variants API usage', {
      signalId: signal.id,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
      count,
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    const message = `Echec de l'appel AI : ${err instanceof Error ? err.message : String(err)}`;
    logger.warn('Intent reply generation failed', { signalId: signal.id, error: message.trim() });
    throw new IntentReplyGenerationError(message);
  }

  let parsed: unknown;
  try {
    parsed = parseJsonResponse(raw);
  } catch (err) {
    const message = `Reponse AI non-JSON : ${err instanceof Error ? err.message : String(err)}`;
    logger.warn('Intent reply generation failed', { signalId: signal.id, error: message.trim() });
    throw new IntentReplyGenerationError(message);
  }

  const validated = repliesOnlyResponseSchema.safeParse(parsed);
  if (!validated.success) {
    const message = `Reponse AI invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
    logger.warn('Intent reply generation failed', { signalId: signal.id, error: message.trim() });
    throw new IntentReplyGenerationError(message);
  }

  const inserted = insertReplies(signal.id, validated.data.replies);
  logger.info('Intent reply variants generated', {
    signalId: signal.id,
    count: inserted.length,
  });
  return inserted;
}
