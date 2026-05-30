import { z } from 'zod';
import OpenAI from 'openai';
import { getDb, type ContentDraftRecord } from './db.js';
import type { ProductView } from './product-service.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { fetchGithubRepoContext } from './github-import.js';

export type ContentDraftKind = 'post';
export type ContentDraftStatus = 'pending' | 'edited' | 'used' | 'discarded';
export type TargetSource = 'x' | 'reddit' | 'generic';

export const CONTENT_DRAFT_KINDS = ['post'] as const;
export const CONTENT_DRAFT_STATUSES = ['pending', 'edited', 'used', 'discarded'] as const;
export const TARGET_SOURCES = ['x', 'reddit', 'generic'] as const;

const contentDraftKindSchema = z.enum(CONTENT_DRAFT_KINDS, {
  errorMap: () => ({ message: 'Type de brouillon invalide (post).' }),
});

const contentDraftStatusSchema = z.enum(CONTENT_DRAFT_STATUSES, {
  errorMap: () => ({
    message: 'Statut invalide (pending, edited, used ou discarded).',
  }),
});

const targetSourceSchema = z.enum(TARGET_SOURCES, {
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
    .preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().min(1).max(500))
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
      data.status !== undefined || data.edited_text !== undefined || data.used_on !== undefined,
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

export function listContentDrafts(filters: ContentDraftListOptions = {}): ContentDraftView[] {
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

const TARGET_AUDIENCE_MAX_LENGTH = 500;

export const suggestAudienceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Le nom du produit est requis.' })
    .max(120, { message: 'Nom du produit trop long (max 120 caracteres).' }),
  product_url: z
    .string()
    .trim()
    .max(2000, { message: 'URL du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  product_description: z
    .string()
    .trim()
    .max(2000, { message: 'Description du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  value_props: z
    .array(z.string().trim().min(1).max(200))
    .max(10, { message: 'Trop de propositions de valeur (max 10).' })
    .optional()
    .nullable(),
  content_language: z.enum(['fr', 'en']).optional().nullable(),
});

export type SuggestAudienceInput = z.infer<typeof suggestAudienceSchema>;

const suggestAudienceResponseSchema = z.object({
  target_audience: z.string().min(1).max(TARGET_AUDIENCE_MAX_LENGTH),
});

const SUGGEST_AUDIENCE_SYSTEM_PROMPT = `Tu es un stratege marketing produit. On te donne les informations d'un produit (nom, URL, description, propositions de valeur) et tu dois proposer une description CONCISE de son audience cible ideale.

Regles :
- Reponds dans la langue demandee (fr ou en).
- Sois concret et specifique : segments, roles, secteurs, niveau de maturite (ex: makers SaaS B2B francophones, PMs scale-up, devs indie).
- Une a deux phrases maximum, style telegraphique accepte (listes de segments separes par des virgules).
- MAXIMUM ${TARGET_AUDIENCE_MAX_LENGTH} caracteres.
- Pas de phrase d'introduction ("Voici", "L'audience cible est...") : donne directement la description.
- Pas de mention d'IA ou de generation automatique.

Reponds STRICTEMENT en JSON avec la structure suivante :
{
  "target_audience": "<description concise de l'audience cible>"
}`;

const SUGGEST_AI_MAX_TOKENS = 1024;

/**
 * Load the AI config and build an OpenAI client for a content-studio
 * suggestion, throwing a French `ContentStudioError` when the config or token
 * is missing. Shared by every suggestion helper.
 */
function createSuggestionClient(): { client: OpenAI; config: ReturnType<typeof loadConfig> } {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la suggestion : configuration AI indisponible : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!config.GITHUB_TOKEN) {
    throw new ContentStudioError(
      'Echec de la suggestion : client AI indisponible (GITHUB_TOKEN manquant).',
    );
  }

  const client = new OpenAI({
    baseURL: 'https://models.github.ai/inference',
    apiKey: config.GITHUB_TOKEN,
    timeout: GENERATE_AI_TIMEOUT_MS,
  });

  return { client, config };
}

/** Numbered list of value props, or a placeholder when none were provided. */
function formatValueProps(valueProps: string[] | null | undefined): string {
  return valueProps && valueProps.length > 0
    ? valueProps.map((v, i) => `${i + 1}. ${v}`).join('\n')
    : '(aucune proposition de valeur fournie)';
}

/**
 * Best-effort GitHub repo context block appended to suggestion prompts so the AI
 * is grounded on the product's actual repository (description + README). Returns
 * an empty string when no URL is given or the repo cannot be fetched.
 */
async function buildRepoContextBlock(
  productUrl: string | null | undefined,
  githubToken?: string,
): Promise<string> {
  if (!productUrl) return '';
  const ctx = await fetchGithubRepoContext(productUrl, githubToken);
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.description) parts.push(`Description du depot: ${ctx.description}`);
  if (ctx.language) parts.push(`Langage principal: ${ctx.language}`);
  if (ctx.topics.length > 0) parts.push(`Topics: ${ctx.topics.join(', ')}`);
  if (ctx.readmeExcerpt) parts.push(`Extrait du README:\n${ctx.readmeExcerpt}`);
  if (parts.length === 0) return '';
  return `\n\nCONTEXTE DU DEPOT GITHUB (source de verite, a privilegier)\n${parts.join('\n')}`;
}

/**
 * Shared executor for content-studio suggestions: builds the AI client, grounds
 * the prompt on the product's GitHub repo when a URL is given, calls the model,
 * then parses and validates the JSON response.
 */
async function runSuggestion<T>(opts: {
  productUrl: string | null | undefined;
  systemPrompt: string;
  userPayload: string;
  responseSchema: z.ZodType<T>;
  logLabel: string;
}): Promise<T> {
  const { client, config } = createSuggestionClient();
  const repoBlock = await buildRepoContextBlock(opts.productUrl, config.GITHUB_TOKEN);

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: SUGGEST_AI_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPayload + repoBlock },
      ],
    });
    logger.info(`${opts.logLabel} API usage`, {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
      grounded: repoBlock.length > 0,
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ContentStudioError(
      `Echec de la suggestion : reponse AI non-JSON : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = opts.responseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ContentStudioError(
      `Echec de la suggestion : reponse AI invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return validated.data;
}

/**
 * Propose a concise target-audience description for a product using the AI
 * model. Works from raw form values (name, URL, description, value props) so it
 * can be called before the product is persisted. Grounded on the GitHub repo
 * when `product_url` points to one.
 */
export async function suggestTargetAudience(input: SuggestAudienceInput): Promise<string> {
  const language = input.content_language ?? 'fr';
  const userPayload = `PRODUIT
Nom: ${input.name}
URL: ${input.product_url || '(aucune URL fournie)'}
Description: ${input.product_description || '(aucune description fournie)'}

PROPOSITIONS DE VALEUR
${formatValueProps(input.value_props)}

PARAMETRES
Langue: ${language}

Propose une description concise de l'audience cible ideale pour ce produit.`;

  const result = await runSuggestion({
    productUrl: input.product_url,
    systemPrompt: SUGGEST_AUDIENCE_SYSTEM_PROMPT,
    userPayload,
    responseSchema: suggestAudienceResponseSchema,
    logLabel: 'Audience suggestion',
  });

  return result.target_audience.trim().slice(0, TARGET_AUDIENCE_MAX_LENGTH);
}

const CTA_MIN_LENGTH = 3;
const CTA_MAX_LENGTH = 200;
const CTAS_MAX_COUNT = 5;

export const suggestCtasSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Le nom du produit est requis.' })
    .max(120, { message: 'Nom du produit trop long (max 120 caracteres).' }),
  product_url: z
    .string()
    .trim()
    .max(2000, { message: 'URL du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  product_description: z
    .string()
    .trim()
    .max(2000, { message: 'Description du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  target_audience: z
    .string()
    .trim()
    .max(500, { message: 'Audience cible trop longue (max 500 caracteres).' })
    .optional()
    .nullable(),
  value_props: z
    .array(z.string().trim().min(1).max(200))
    .max(10, { message: 'Trop de propositions de valeur (max 10).' })
    .optional()
    .nullable(),
  content_language: z.enum(['fr', 'en']).optional().nullable(),
});

export type SuggestCtasInput = z.infer<typeof suggestCtasSchema>;

const suggestCtasResponseSchema = z.object({
  call_to_actions: z.array(z.string().min(1)).min(1),
});

const SUGGEST_CTAS_SYSTEM_PROMPT = `Tu es un copywriter spécialisé en conversion. On te donne les informations d'un produit (nom, URL, description, audience cible, propositions de valeur) et tu dois proposer des appels à l'action (CTA) courts et percutants.

Regles :
- Reponds dans la langue demandee (fr ou en).
- Propose entre 3 et ${CTAS_MAX_COUNT} CTA, varies (essai gratuit, demande de demo, inscription, telechargement, contact...).
- Chaque CTA fait entre ${CTA_MIN_LENGTH} et ${CTA_MAX_LENGTH} caracteres, a l'imperatif, oriente action.
- Pas de numerotation, pas de ponctuation finale superflue, pas d'emojis.
- Pas de mention d'IA ou de generation automatique.

Reponds STRICTEMENT en JSON avec la structure suivante :
{
  "call_to_actions": ["<cta 1>", "<cta 2>", "<cta 3>"]
}`;

/**
 * Propose a short list of calls to action for a product using the AI model.
 * Works from raw form values so it can be called before the product is
 * persisted. The returned CTAs are trimmed, length-clamped, de-duplicated and
 * capped at {@link CTAS_MAX_COUNT}.
 */
export async function suggestCallToActions(input: SuggestCtasInput): Promise<string[]> {
  const language = input.content_language ?? 'fr';
  const userPayload = `PRODUIT
Nom: ${input.name}
URL: ${input.product_url || '(aucune URL fournie)'}
Description: ${input.product_description || '(aucune description fournie)'}
Audience cible: ${input.target_audience || '(non specifiee)'}

PROPOSITIONS DE VALEUR
${formatValueProps(input.value_props)}

PARAMETRES
Langue: ${language}

Propose entre 3 et ${CTAS_MAX_COUNT} appels a l'action courts et varies pour ce produit.`;

  const result = await runSuggestion({
    productUrl: input.product_url,
    systemPrompt: SUGGEST_CTAS_SYSTEM_PROMPT,
    userPayload,
    responseSchema: suggestCtasResponseSchema,
    logLabel: 'CTA suggestion',
  });

  const ctas = dedupeBoundedList(
    result.call_to_actions,
    CTA_MIN_LENGTH,
    CTA_MAX_LENGTH,
    CTAS_MAX_COUNT,
  );
  if (ctas.length === 0) {
    throw new ContentStudioError(
      "Echec de la suggestion : aucun appel a l'action valide propose par l'IA.",
    );
  }
  return ctas;
}

/**
 * Trim, length-clamp (dropping items below `min`), case-insensitively
 * de-duplicate and cap a list of AI-proposed short strings. Shared by the CTA
 * and value-prop suggestion helpers.
 */
function dedupeBoundedList(items: string[], min: number, max: number, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of items) {
    const trimmed = candidate.trim().slice(0, max);
    if (trimmed.length < min) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;

export const suggestDescriptionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Le nom du produit est requis.' })
    .max(120, { message: 'Nom du produit trop long (max 120 caracteres).' }),
  product_url: z
    .string()
    .trim()
    .max(2000, { message: 'URL du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  target_audience: z
    .string()
    .trim()
    .max(500, { message: 'Audience cible trop longue (max 500 caracteres).' })
    .optional()
    .nullable(),
  value_props: z
    .array(z.string().trim().min(1).max(200))
    .max(10, { message: 'Trop de propositions de valeur (max 10).' })
    .optional()
    .nullable(),
  content_language: z.enum(['fr', 'en']).optional().nullable(),
});

export type SuggestDescriptionInput = z.infer<typeof suggestDescriptionSchema>;

const suggestDescriptionResponseSchema = z.object({
  product_description: z.string().min(1).max(PRODUCT_DESCRIPTION_MAX_LENGTH),
});

const SUGGEST_DESCRIPTION_SYSTEM_PROMPT = `Tu es un redacteur produit. On te donne les informations d'un produit (nom, URL, audience, propositions de valeur) et, si disponible, le contenu de son depot GitHub (description + README). Tu dois rediger une DESCRIPTION factuelle et concise du produit, destinee a une IA qui analysera des leads et redigera des reponses.

Regles :
- Reponds dans la langue demandee (fr ou en).
- Explique CE QUE FAIT le produit, POUR QUI, et son modele si pertinent (gratuit, freemium, open-source...).
- 2 a 5 phrases, factuel, sans superlatifs marketing.
- Appuie-toi en priorite sur le contexte du depot GitHub quand il est fourni.
- MAXIMUM ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres.
- Pas de phrase d'introduction ("Voici"), pas de mention d'IA ou de generation automatique.

Reponds STRICTEMENT en JSON avec la structure suivante :
{
  "product_description": "<description factuelle du produit>"
}`;

/**
 * Propose a factual product description (for lead analysis / reply drafting)
 * using the AI model, grounded on the GitHub repo when `product_url` points to
 * one. Works from raw form values so it can be called before the product is
 * persisted.
 */
export async function suggestProductDescription(input: SuggestDescriptionInput): Promise<string> {
  const language = input.content_language ?? 'fr';
  const userPayload = `PRODUIT
Nom: ${input.name}
URL: ${input.product_url || '(aucune URL fournie)'}
Audience cible: ${input.target_audience || '(non specifiee)'}

PROPOSITIONS DE VALEUR
${formatValueProps(input.value_props)}

PARAMETRES
Langue: ${language}

Redige une description factuelle et concise de ce produit.`;

  const result = await runSuggestion({
    productUrl: input.product_url,
    systemPrompt: SUGGEST_DESCRIPTION_SYSTEM_PROMPT,
    userPayload,
    responseSchema: suggestDescriptionResponseSchema,
    logLabel: 'Description suggestion',
  });

  return result.product_description.trim().slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH);
}

const VALUE_PROP_MIN_LENGTH = 3;
const VALUE_PROP_MAX_LENGTH = 200;
const VALUE_PROPS_MAX_COUNT = 10;

export const suggestValuePropsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Le nom du produit est requis.' })
    .max(120, { message: 'Nom du produit trop long (max 120 caracteres).' }),
  product_url: z
    .string()
    .trim()
    .max(2000, { message: 'URL du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  product_description: z
    .string()
    .trim()
    .max(2000, { message: 'Description du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  target_audience: z
    .string()
    .trim()
    .max(500, { message: 'Audience cible trop longue (max 500 caracteres).' })
    .optional()
    .nullable(),
  content_language: z.enum(['fr', 'en']).optional().nullable(),
});

export type SuggestValuePropsInput = z.infer<typeof suggestValuePropsSchema>;

const suggestValuePropsResponseSchema = z.object({
  value_props: z.array(z.string().min(1)).min(1),
});

const SUGGEST_VALUE_PROPS_SYSTEM_PROMPT = `Tu es un stratege marketing produit. On te donne les informations d'un produit (nom, URL, description, audience) et, si disponible, le contenu de son depot GitHub (description + README). Tu dois proposer des PROPOSITIONS DE VALEUR courtes : les benefices concrets pour l'utilisateur.

Regles :
- Reponds dans la langue demandee (fr ou en).
- Propose entre 3 et 6 propositions, distinctes et concretes (benefice utilisateur, pas une simple fonctionnalite brute).
- Chaque proposition fait entre ${VALUE_PROP_MIN_LENGTH} et ${VALUE_PROP_MAX_LENGTH} caracteres.
- Appuie-toi en priorite sur le contexte du depot GitHub quand il est fourni.
- Pas de numerotation, pas d'emojis, pas de mention d'IA ou de generation automatique.

Reponds STRICTEMENT en JSON avec la structure suivante :
{
  "value_props": ["<proposition 1>", "<proposition 2>", "<proposition 3>"]
}`;

/**
 * Propose a short list of value propositions for a product using the AI model,
 * grounded on the GitHub repo when `product_url` points to one. The returned
 * items are trimmed, length-clamped, de-duplicated and capped at
 * {@link VALUE_PROPS_MAX_COUNT}.
 */
export async function suggestValueProps(input: SuggestValuePropsInput): Promise<string[]> {
  const language = input.content_language ?? 'fr';
  const userPayload = `PRODUIT
Nom: ${input.name}
URL: ${input.product_url || '(aucune URL fournie)'}
Description: ${input.product_description || '(aucune description fournie)'}
Audience cible: ${input.target_audience || '(non specifiee)'}

PARAMETRES
Langue: ${language}

Propose entre 3 et 6 propositions de valeur courtes pour ce produit.`;

  const result = await runSuggestion({
    productUrl: input.product_url,
    systemPrompt: SUGGEST_VALUE_PROPS_SYSTEM_PROMPT,
    userPayload,
    responseSchema: suggestValuePropsResponseSchema,
    logLabel: 'Value props suggestion',
  });

  const valueProps = dedupeBoundedList(
    result.value_props,
    VALUE_PROP_MIN_LENGTH,
    VALUE_PROP_MAX_LENGTH,
    VALUE_PROPS_MAX_COUNT,
  );
  if (valueProps.length === 0) {
    throw new ContentStudioError(
      "Echec de la suggestion : aucune proposition de valeur valide proposee par l'IA.",
    );
  }
  return valueProps;
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
      : "(aucun appel a l'action fourni)";

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
      const result = insert.run(product.id, targetSource, item.angle, item.text, now);
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
