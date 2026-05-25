import { z } from 'zod';
import OpenAI from 'openai';
import { getDb, type ContentDraftRecord } from './db.js';
import type { ProductView } from './product-service.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';

export type ContentDraftKind = 'post';
export type ContentDraftStatus = 'pending' | 'edited' | 'used' | 'discarded';
export type TargetSource = 'x' | 'reddit' | 'generic';

export const CONTENT_DRAFT_KINDS = ['post'] as const;
export const CONTENT_DRAFT_STATUSES = [
  'pending',
  'edited',
  'used',
  'discarded',
] as const;
export const TARGET_SOURCES = ['x', 'reddit', 'generic'] as const;

export const contentDraftKindSchema = z.enum(CONTENT_DRAFT_KINDS, {
  errorMap: () => ({ message: 'Type de brouillon invalide (post).' }),
});

export const contentDraftStatusSchema = z.enum(CONTENT_DRAFT_STATUSES, {
  errorMap: () => ({
    message: 'Statut invalide (pending, edited, used ou discarded).',
  }),
});

export const targetSourceSchema = z.enum(TARGET_SOURCES, {
  errorMap: () => ({
    message: 'Plateforme cible invalide (x, reddit ou generic).',
  }),
});

export const generatePostsSchema = z.object({
  count: z
    .number({ invalid_type_error: 'Le nombre de brouillons doit etre un entier.' })
    .int({ message: 'Le nombre de brouillons doit etre un entier.' })
    .min(1, { message: 'Il faut au moins 1 brouillon.' })
    .max(10, { message: 'Maximum 10 brouillons par generation.' }),
  targetSource: targetSourceSchema,
});

export const contentDraftListQuerySchema = z.object({
  productId: z.string().min(1).max(64).optional(),
  status: contentDraftStatusSchema.optional(),
  kind: contentDraftKindSchema.optional(),
  limit: z
    .preprocess(
      (v) => (typeof v === 'string' ? Number(v) : v),
      z.number().int().min(1).max(500),
    )
    .optional(),
});

export const contentDraftPatchSchema = z
  .object({
    status: contentDraftStatusSchema.optional(),
    edited_text: z
      .string()
      .max(4000, { message: 'Texte edite trop long (max 4000 caracteres).' })
      .nullable()
      .optional(),
    used_on: z
      .string()
      .max(500, { message: 'Champ used_on trop long (max 500 caracteres).' })
      .nullable()
      .optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.edited_text !== undefined ||
      data.used_on !== undefined,
    { message: 'Au moins un champ a mettre a jour est requis.' },
  );

export type ContentDraftPatch = z.infer<typeof contentDraftPatchSchema>;
export type GeneratePostsInput = z.infer<typeof generatePostsSchema>;

export interface ContentDraftListOptions {
  productId?: string;
  status?: ContentDraftStatus;
  kind?: ContentDraftKind;
  limit?: number;
}

export interface ContentDraftView {
  id: number;
  product_id: string;
  kind: ContentDraftKind;
  target_source: TargetSource | null;
  angle: string | null;
  text: string;
  edited_text: string | null;
  status: ContentDraftStatus;
  used_on: string | null;
  generated_at: number;
  used_at: number | null;
}

function isContentDraftKind(value: string): value is ContentDraftKind {
  return (CONTENT_DRAFT_KINDS as readonly string[]).includes(value);
}

function isContentDraftStatus(value: string): value is ContentDraftStatus {
  return (CONTENT_DRAFT_STATUSES as readonly string[]).includes(value);
}

function isTargetSource(value: string | null): value is TargetSource {
  return value !== null && (TARGET_SOURCES as readonly string[]).includes(value);
}

export function toContentDraftView(row: ContentDraftRecord): ContentDraftView {
  return {
    id: row.id,
    product_id: row.product_id,
    kind: isContentDraftKind(row.kind) ? row.kind : 'post',
    target_source: isTargetSource(row.target_source) ? row.target_source : null,
    angle: row.angle,
    text: row.text,
    edited_text: row.edited_text,
    status: isContentDraftStatus(row.status) ? row.status : 'pending',
    used_on: row.used_on,
    generated_at: row.generated_at,
    used_at: row.used_at,
  };
}

export function listContentDrafts(
  filters: ContentDraftListOptions = {},
): ContentDraftView[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.productId) {
    clauses.push('product_id = ?');
    params.push(filters.productId);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.kind) {
    clauses.push('kind = ?');
    params.push(filters.kind);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT id, product_id, kind, target_source, angle, text, edited_text, status, used_on, generated_at, used_at
       FROM content_drafts
       ${where}
       ORDER BY generated_at DESC
       LIMIT ?`,
    )
    .all(...params) as ContentDraftRecord[];

  return rows.map(toContentDraftView);
}

export function getContentDraft(id: number): ContentDraftRecord | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, product_id, kind, target_source, angle, text, edited_text, status, used_on, generated_at, used_at
       FROM content_drafts WHERE id = ?`,
    )
    .get(id) as ContentDraftRecord | undefined;
}

export function updateContentDraft(
  id: number,
  patch: {
    status?: ContentDraftStatus;
    edited_text?: string | null;
    used_on?: string | null;
  },
): ContentDraftRecord | undefined {
  const existing = getContentDraft(id);
  if (!existing) {
    return undefined;
  }

  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  const explicitStatus = patch.status;
  let resolvedStatus: ContentDraftStatus | undefined = explicitStatus;

  if (
    patch.edited_text !== undefined &&
    patch.edited_text !== null &&
    explicitStatus === undefined
  ) {
    resolvedStatus = 'edited';
  }

  if (patch.edited_text !== undefined) {
    sets.push('edited_text = ?');
    values.push(patch.edited_text);
  }
  if (patch.used_on !== undefined) {
    sets.push('used_on = ?');
    values.push(patch.used_on);
  }
  if (resolvedStatus !== undefined) {
    sets.push('status = ?');
    values.push(resolvedStatus);
    if (resolvedStatus === 'used') {
      sets.push('used_at = ?');
      values.push(Date.now());
    }
  }

  if (sets.length === 0) {
    return existing;
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE content_drafts SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) {
    return undefined;
  }
  logger.info('Content draft updated', {
    id,
    status: resolvedStatus,
    editedTextUpdated: patch.edited_text !== undefined,
    usedOnUpdated: patch.used_on !== undefined,
  });
  return getContentDraft(id);
}

export function deleteContentDraft(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM content_drafts WHERE id = ?`).run(id);
  if (result.changes > 0) {
    logger.info('Content draft deleted', { id });
    return true;
  }
  return false;
}

const GENERATE_AI_TIMEOUT_MS = 60_000;

const generateResponseSchema = z.object({
  drafts: z
    .array(
      z.object({
        angle: z.string().min(1).max(120),
        text: z.string().min(1).max(4000),
      }),
    )
    .min(1),
});

const GENERATE_SYSTEM_PROMPT = `Tu es un marketeur produit expérimenté et un copywriter spécialisé en posts promotionnels courts pour les réseaux sociaux.

On va te demander d'écrire plusieurs posts promotionnels au sujet d'un produit précis. Chaque post DOIT prendre un ANGLE différent. Exemples d'angles à varier :
- preuve sociale (social proof)
- problème / frustration ciblée (problem-focused)
- avant / après (before/after)
- contrarian / opinion forte
- coulisses / behind-the-scenes
- bénéfice tangible / résultat concret
- mini-cas d'usage
- question ouverte ou hook curiosité

Règles :
- Respecte la voix demandée (decontractee, professionnelle, directe, aidante).
- Respecte la langue demandée (fr ou en).
- Respecte les limites de caractères de la plateforme cible :
  * x : MAX 280 caractères, ton percutant, pas de hashtags lourds.
  * reddit : ~500 caractères max, ton conversationnel, première personne, pas de spam évident.
  * generic : ~500 caractères max, ton type LinkedIn, professionnel mais accessible.
- Intègre subtilement un appel à l'action quand pertinent (parmi ceux fournis).
- Pas de mention d'IA, de bot, ou de génération automatique.
- Pas d'emojis sauf si voix = decontractee.
- Chaque draft a un \`angle\` court (2-6 mots) qui résume l'approche.

Réponds STRICTEMENT en JSON avec la structure suivante :
{
  "drafts": [
    { "angle": "<libellé court>", "text": "<le post complet>" }
  ]
}`;

export class ContentStudioError extends Error {
  constructor(message: string) {
    super(message.trim());
    this.name = 'ContentStudioError';
  }
}

function platformConstraints(targetSource: TargetSource): string {
  switch (targetSource) {
    case 'x':
      return 'X (Twitter) — MAX 280 caracteres par post, ton direct et percutant.';
    case 'reddit':
      return 'Reddit — environ 500 caracteres max, ton conversationnel, premiere personne, pas de spam.';
    case 'generic':
    default:
      return 'Generique (LinkedIn-friendly) — environ 500 caracteres max, ton professionnel mais accessible.';
  }
}

export async function generatePosts(
  product: ProductView,
  opts: { count: number; targetSource: TargetSource },
): Promise<ContentDraftRecord[]> {
  const { count, targetSource } = opts;

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la generation : configuration AI indisponible : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!config.GITHUB_TOKEN) {
    throw new ContentStudioError(
      'Echec de la generation : client AI indisponible (GITHUB_TOKEN manquant).',
    );
  }

  const client = new OpenAI({
    baseURL: 'https://models.github.ai/inference',
    apiKey: config.GITHUB_TOKEN,
    timeout: GENERATE_AI_TIMEOUT_MS,
  });

  const language = product.content_language ?? 'fr';
  const voice = product.content_voice ?? product.reply_voice ?? 'professionnelle';
  const valueProps =
    product.value_props.length > 0
      ? product.value_props.map((v, i) => `${i + 1}. ${v}`).join('\n')
      : '(aucune proposition de valeur fournie)';
  const ctas =
    product.call_to_actions.length > 0
      ? product.call_to_actions.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(aucun appel a l\'action fourni)';

  const userPayload = `PRODUIT
Nom: ${product.name}
URL: ${product.product_url || '(aucune URL fournie)'}
Description: ${product.product_description || '(aucune description fournie)'}
Audience cible: ${product.target_audience || '(non specifiee)'}

PROPOSITIONS DE VALEUR
${valueProps}

APPELS A L'ACTION POSSIBLES
${ctas}

PARAMETRES DE GENERATION
Nombre de drafts a produire: ${count}
Plateforme cible: ${targetSource}
Contraintes plateforme: ${platformConstraints(targetSource)}
Voix: ${voice}
Langue: ${language}

Genere exactement ${count} drafts, chacun avec un angle DIFFERENT.`;

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        { role: 'user', content: userPayload },
      ],
    });
    logger.info('Content studio API usage', {
      productId: product.id,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
      count,
      targetSource,
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la generation : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la generation : reponse AI non-JSON : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = generateResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ContentStudioError(
      `Echec de la generation : reponse AI invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO content_drafts (product_id, kind, target_source, angle, text, edited_text, status, used_on, generated_at, used_at)
     VALUES (?, 'post', ?, ?, ?, NULL, 'pending', NULL, ?, NULL)`,
  );

  const insertedIds: number[] = [];
  const insertMany = db.transaction((items: { angle: string; text: string }[]) => {
    const now = Date.now();
    for (const item of items) {
      const result = insert.run(
        product.id,
        targetSource,
        item.angle,
        item.text,
        now,
      );
      insertedIds.push(Number(result.lastInsertRowid));
    }
  });

  insertMany(validated.data.drafts);

  logger.info('Content drafts generated', {
    productId: product.id,
    count: insertedIds.length,
    targetSource,
  });

  const placeholders = insertedIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, product_id, kind, target_source, angle, text, edited_text, status, used_on, generated_at, used_at
       FROM content_drafts
       WHERE id IN (${placeholders})
       ORDER BY generated_at DESC, id DESC`,
    )
    .all(...insertedIds) as ContentDraftRecord[];

  return rows;
}
