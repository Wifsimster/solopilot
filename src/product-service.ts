import { z } from 'zod';
import { getDb, type ProductRecord, DEFAULT_PRODUCT_ID } from './db.js';
import { logger } from './logger.js';

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      "L'identifiant doit etre en minuscules, alphanumerique, avec tirets (pas en debut ni en fin).",
  });

const subredditNameSchema = z.string().regex(/^[A-Za-z0-9_]{2,21}$/, {
  message: 'Nom de subreddit invalide (2-21 caracteres alphanumeriques ou underscore).',
});

const hnKeywordSchema = z
  .string()
  .trim()
  .min(2, { message: 'Mot-cle Hacker News trop court (min 2 caracteres).' })
  .max(64, { message: 'Mot-cle Hacker News trop long (max 64 caracteres).' });

const intentKeywordSchema = z
  .string()
  .trim()
  .min(2, { message: "Mot-cle d'intention trop court (min 2 caracteres)." })
  .max(128, { message: "Mot-cle d'intention trop long (max 128 caracteres)." });

const triageCategorySchema = z
  .string()
  .trim()
  .min(2, { message: 'Categorie de triage trop courte (min 2 caracteres).' })
  .max(40, { message: 'Categorie de triage trop longue (max 40 caracteres).' })
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, {
    message: 'Categorie de triage invalide (minuscules, chiffres et underscores).',
  });

export const REPLY_VOICES = ['decontractee', 'professionnelle', 'directe', 'aidante'] as const;
export type ReplyVoice = (typeof REPLY_VOICES)[number];

const replyVoiceSchema = z.enum(REPLY_VOICES, {
  errorMap: () => ({
    message: 'Voix de reponse invalide (decontractee, professionnelle, directe ou aidante).',
  }),
});

const contentVoiceSchema = z.enum(REPLY_VOICES, {
  errorMap: () => ({
    message: 'Voix de contenu invalide (decontractee, professionnelle, directe ou aidante).',
  }),
});

export const CONTENT_LANGUAGES = ['fr', 'en'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

const contentLanguageSchema = z.enum(CONTENT_LANGUAGES, {
  errorMap: () => ({
    message: 'Langue de contenu invalide (fr ou en).',
  }),
});

const valuePropSchema = z
  .string()
  .trim()
  .min(3, { message: 'Proposition de valeur trop courte (min 3 caracteres).' })
  .max(200, { message: 'Proposition de valeur trop longue (max 200 caracteres).' });

const callToActionSchema = z
  .string()
  .trim()
  .min(3, { message: "Appel a l'action trop court (min 3 caracteres)." })
  .max(200, { message: "Appel a l'action trop long (max 200 caracteres)." });

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
  youtube_enabled: z.boolean().optional(),
  youtube_keywords: z
    .array(hnKeywordSchema)
    .max(20, { message: 'Trop de mots-cles YouTube (max 20).' })
    .optional()
    .nullable(),
  intent_enabled: z.boolean().optional(),
  intent_keywords: z
    .array(intentKeywordSchema)
    .max(30, { message: "Trop de mots-cles d'intention (max 30)." })
    .optional()
    .nullable(),
  intent_exclude_keywords: z
    .array(intentKeywordSchema)
    .max(30, { message: "Trop de mots-cles d'exclusion (max 30)." })
    .optional()
    .nullable(),
  intent_require_keywords: z
    .array(intentKeywordSchema)
    .max(30, { message: 'Trop de mots-cles requis (max 30).' })
    .optional()
    .nullable(),
  product_description: z
    .string()
    .max(2000, { message: 'La description du produit est trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  reply_voice: replyVoiceSchema.optional().nullable(),
  product_url: z
    .string()
    .url({ message: 'URL du produit invalide.' })
    .max(2000, { message: 'URL du produit trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  production_url: z
    .string()
    .url({ message: 'URL de production invalide.' })
    .max(2000, { message: 'URL de production trop longue (max 2000 caracteres).' })
    .optional()
    .nullable(),
  target_audience: z
    .string()
    .max(500, { message: 'Audience cible trop longue (max 500 caracteres).' })
    .optional()
    .nullable(),
  value_props: z
    .array(valuePropSchema)
    .max(10, { message: 'Trop de propositions de valeur (max 10).' })
    .optional()
    .nullable(),
  call_to_actions: z
    .array(callToActionSchema)
    .max(5, { message: "Trop d'appels a l'action (max 5)." })
    .optional()
    .nullable(),
  content_voice: contentVoiceSchema.optional().nullable(),
  content_language: contentLanguageSchema.optional().nullable(),
  triage_enabled: z.boolean().optional(),
  triage_categories: z
    .array(triageCategorySchema)
    .max(20, { message: 'Trop de categories de triage (max 20).' })
    .optional()
    .nullable(),
  alert_enabled: z.boolean().optional(),
  crm_leads_enabled: z.boolean().optional(),
  alert_threshold: z
    .number({ invalid_type_error: "Le seuil d'alerte doit etre un entier." })
    .int({ message: "Le seuil d'alerte doit etre un entier." })
    .min(0, { message: "Le seuil d'alerte doit etre entre 0 et 100." })
    .max(100, { message: "Le seuil d'alerte doit etre entre 0 et 100." })
    .optional()
    .nullable(),
});

export const productCreateSchema = productBaseSchema
  .refine(
    (data) => {
      const x = data.x_enabled !== false;
      const reddit = data.reddit_enabled === true;
      const hn = data.hn_enabled === true;
      const youtube = data.youtube_enabled === true;
      return x || reddit || hn || youtube;
    },
    {
      message: 'Active au moins une source (X, Reddit, Hacker News ou YouTube).',
      path: ['x_enabled'],
    },
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
    if (
      data.youtube_enabled === true &&
      (!data.youtube_keywords || data.youtube_keywords.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtube_keywords'],
        message: 'Au moins un mot-cle est requis quand YouTube est active.',
      });
    }
    if (
      data.intent_enabled === true &&
      (!data.intent_keywords || data.intent_keywords.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intent_keywords'],
        message: "Au moins un mot-cle d'intention est requis quand le matching est active.",
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
        data.hn_enabled === false &&
        data.youtube_enabled === false
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Active au moins une source (X, Reddit, Hacker News ou YouTube).',
      path: ['x_enabled'],
    },
  );

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export interface ProductView extends Omit<
  ProductRecord,
  | 'reddit_subreddits'
  | 'x_enabled'
  | 'reddit_enabled'
  | 'hn_enabled'
  | 'hn_keywords'
  | 'youtube_enabled'
  | 'youtube_keywords'
  | 'intent_enabled'
  | 'intent_keywords'
  | 'intent_exclude_keywords'
  | 'intent_require_keywords'
  | 'value_props'
  | 'call_to_actions'
  | 'content_language'
  | 'triage_enabled'
  | 'triage_categories'
  | 'alert_enabled'
  | 'crm_leads_enabled'
> {
  x_enabled: boolean;
  reddit_enabled: boolean;
  reddit_subreddits: string[];
  hn_enabled: boolean;
  hn_keywords: string[];
  youtube_enabled: boolean;
  youtube_keywords: string[];
  intent_enabled: boolean;
  intent_keywords: string[];
  intent_exclude_keywords: string[];
  intent_require_keywords: string[];
  value_props: string[];
  call_to_actions: string[];
  content_language: ContentLanguage;
  triage_enabled: boolean;
  triage_categories: string[];
  alert_enabled: boolean;
  crm_leads_enabled: boolean;
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

function isContentLanguage(value: string | null): value is ContentLanguage {
  return value !== null && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}

export function toProductView(product: ProductRecord): ProductView {
  return {
    ...product,
    x_enabled: product.x_enabled === 1,
    reddit_enabled: product.reddit_enabled === 1,
    reddit_subreddits: deserializeStringArray(product.reddit_subreddits),
    hn_enabled: product.hn_enabled === 1,
    hn_keywords: deserializeStringArray(product.hn_keywords),
    youtube_enabled: product.youtube_enabled === 1,
    youtube_keywords: deserializeStringArray(product.youtube_keywords),
    intent_enabled: product.intent_enabled === 1,
    intent_keywords: deserializeStringArray(product.intent_keywords),
    intent_exclude_keywords: deserializeStringArray(product.intent_exclude_keywords),
    intent_require_keywords: deserializeStringArray(product.intent_require_keywords),
    value_props: deserializeStringArray(product.value_props),
    call_to_actions: deserializeStringArray(product.call_to_actions),
    content_language: isContentLanguage(product.content_language) ? product.content_language : 'fr',
    triage_enabled: product.triage_enabled === 1,
    triage_categories: deserializeStringArray(product.triage_categories),
    alert_enabled: product.alert_enabled === 1,
    crm_leads_enabled: product.crm_leads_enabled === 1,
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

export function createProduct(input: ProductCreateInput): ProductRecord {
  const db = getDb();
  db.prepare(
    `INSERT INTO products (id, name, x_query, discord_webhook, ai_prompt_override, collect_cron, publish_cron, created_at, x_enabled, reddit_enabled, reddit_subreddits, hn_enabled, hn_keywords, youtube_enabled, youtube_keywords, intent_enabled, intent_keywords, intent_exclude_keywords, intent_require_keywords, product_description, reply_voice, product_url, production_url, target_audience, value_props, call_to_actions, content_voice, content_language, triage_enabled, triage_categories, alert_enabled, alert_threshold, crm_leads_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.hn_keywords && input.hn_keywords.length > 0 ? JSON.stringify(input.hn_keywords) : null,
    input.youtube_enabled === true ? 1 : 0,
    input.youtube_keywords && input.youtube_keywords.length > 0
      ? JSON.stringify(input.youtube_keywords)
      : null,
    input.intent_enabled === true ? 1 : 0,
    input.intent_keywords && input.intent_keywords.length > 0
      ? JSON.stringify(input.intent_keywords)
      : null,
    input.intent_exclude_keywords && input.intent_exclude_keywords.length > 0
      ? JSON.stringify(input.intent_exclude_keywords)
      : null,
    input.intent_require_keywords && input.intent_require_keywords.length > 0
      ? JSON.stringify(input.intent_require_keywords)
      : null,
    input.product_description ?? null,
    input.reply_voice ?? null,
    input.product_url ?? null,
    input.production_url ?? null,
    input.target_audience ?? null,
    input.value_props && input.value_props.length > 0 ? JSON.stringify(input.value_props) : null,
    input.call_to_actions && input.call_to_actions.length > 0
      ? JSON.stringify(input.call_to_actions)
      : null,
    input.content_voice ?? null,
    input.content_language ?? null,
    input.triage_enabled === true ? 1 : 0,
    input.triage_categories && input.triage_categories.length > 0
      ? JSON.stringify(input.triage_categories)
      : null,
    input.alert_enabled === true ? 1 : 0,
    input.alert_threshold ?? null,
    input.crm_leads_enabled === true ? 1 : 0,
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
      patch.hn_keywords && patch.hn_keywords.length > 0 ? JSON.stringify(patch.hn_keywords) : null,
    );
  }
  if (patch.youtube_enabled !== undefined) {
    sets.push('youtube_enabled = ?');
    values.push(patch.youtube_enabled ? 1 : 0);
  }
  if (patch.youtube_keywords !== undefined) {
    sets.push('youtube_keywords = ?');
    values.push(
      patch.youtube_keywords && patch.youtube_keywords.length > 0
        ? JSON.stringify(patch.youtube_keywords)
        : null,
    );
  }
  if (patch.intent_enabled !== undefined) {
    sets.push('intent_enabled = ?');
    values.push(patch.intent_enabled ? 1 : 0);
  }
  if (patch.intent_keywords !== undefined) {
    sets.push('intent_keywords = ?');
    values.push(
      patch.intent_keywords && patch.intent_keywords.length > 0
        ? JSON.stringify(patch.intent_keywords)
        : null,
    );
  }
  if (patch.intent_exclude_keywords !== undefined) {
    sets.push('intent_exclude_keywords = ?');
    values.push(
      patch.intent_exclude_keywords && patch.intent_exclude_keywords.length > 0
        ? JSON.stringify(patch.intent_exclude_keywords)
        : null,
    );
  }
  if (patch.intent_require_keywords !== undefined) {
    sets.push('intent_require_keywords = ?');
    values.push(
      patch.intent_require_keywords && patch.intent_require_keywords.length > 0
        ? JSON.stringify(patch.intent_require_keywords)
        : null,
    );
  }
  if (patch.product_description !== undefined) {
    sets.push('product_description = ?');
    values.push(patch.product_description ?? null);
  }
  if (patch.reply_voice !== undefined) {
    sets.push('reply_voice = ?');
    values.push(patch.reply_voice ?? null);
  }
  if (patch.product_url !== undefined) {
    sets.push('product_url = ?');
    values.push(patch.product_url ?? null);
  }
  if (patch.production_url !== undefined) {
    sets.push('production_url = ?');
    values.push(patch.production_url ?? null);
  }
  if (patch.target_audience !== undefined) {
    sets.push('target_audience = ?');
    values.push(patch.target_audience ?? null);
  }
  if (patch.value_props !== undefined) {
    sets.push('value_props = ?');
    values.push(
      patch.value_props && patch.value_props.length > 0 ? JSON.stringify(patch.value_props) : null,
    );
  }
  if (patch.call_to_actions !== undefined) {
    sets.push('call_to_actions = ?');
    values.push(
      patch.call_to_actions && patch.call_to_actions.length > 0
        ? JSON.stringify(patch.call_to_actions)
        : null,
    );
  }
  if (patch.content_voice !== undefined) {
    sets.push('content_voice = ?');
    values.push(patch.content_voice ?? null);
  }
  if (patch.content_language !== undefined) {
    sets.push('content_language = ?');
    values.push(patch.content_language ?? null);
  }
  if (patch.triage_enabled !== undefined) {
    sets.push('triage_enabled = ?');
    values.push(patch.triage_enabled ? 1 : 0);
  }
  if (patch.triage_categories !== undefined) {
    sets.push('triage_categories = ?');
    values.push(
      patch.triage_categories && patch.triage_categories.length > 0
        ? JSON.stringify(patch.triage_categories)
        : null,
    );
  }
  if (patch.alert_enabled !== undefined) {
    sets.push('alert_enabled = ?');
    values.push(patch.alert_enabled ? 1 : 0);
  }
  if (patch.alert_threshold !== undefined) {
    sets.push('alert_threshold = ?');
    values.push(patch.alert_threshold ?? null);
  }
  if (patch.crm_leads_enabled !== undefined) {
    sets.push('crm_leads_enabled = ?');
    values.push(patch.crm_leads_enabled ? 1 : 0);
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
