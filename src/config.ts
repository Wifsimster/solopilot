import { z, type ZodIssue } from 'zod';
import { logger } from './logger.js';

/** Settings keys of the AI model/effort selection (Settings > env > default). */
export const AI_SELECTION_SETTING_KEYS = [
  'AI_MODEL',
  'AI_MODEL_FAST',
  'AI_EFFORT',
  'AI_EFFORT_FAST',
] as const;
export type AiSelectionSettingKey = (typeof AI_SELECTION_SETTING_KEYS)[number];

export const AI_PROVIDER_VALUES = ['anthropic', 'github-models'] as const;
export type AiProviderSetting = (typeof AI_PROVIDER_VALUES)[number];

/** Discord webhook URL — shared by every webhook setting (global, veille). */
export const discordWebhookUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://discord.com/api/webhooks/'), {
    message: 'Must be a Discord webhook URL (https://discord.com/api/webhooks/...)',
  });

export const VEILLE_DIGEST_MODES = ['consolidated', 'per-product'] as const;
export const veilleDigestModeSchema = z.enum(VEILLE_DIGEST_MODES);
export type VeilleDigestMode = z.infer<typeof veilleDigestModeSchema>;
export const DEFAULT_VEILLE_DIGEST_MODE: VeilleDigestMode = 'per-product';

const configSchema = z.object({
  X_USERNAME: z.string().min(1),

  // Session tokens for web scraping — can come from env vars or settings DB
  X_SESSION_AUTH_TOKEN: z.string().min(1).optional(),
  X_SESSION_CSRF_TOKEN: z.string().min(1).optional(),

  // Optional: override GraphQL operation IDs when X changes them
  X_GQL_USER_BY_SCREEN_NAME_ID: z.string().optional(),
  X_GQL_HOME_TIMELINE_ID: z.string().optional(),

  // AI provider (ADR-0027). Two adapters behind one port (src/ai/):
  // - anthropic: official SDK, ANTHROPIC_API_KEY (env only, never stored in DB).
  // - github-models: any OpenAI-compatible endpoint. Default GitHub Models
  //   (fine-grained PAT with `models:read` in GITHUB_TOKEN); OpenRouter via
  //   AI_BASE_URL + AI_API_KEY. GITHUB_TOKEN also powers GitHub repo-context
  //   enrichment during content generation.
  // AI_PROVIDER unset = anthropic when ANTHROPIC_API_KEY is set, else
  // github-models. An unknown value is ignored (warned) rather than failing
  // the whole config.
  AI_PROVIDER: z
    .string()
    .optional()
    .transform((v): AiProviderSetting | undefined => {
      const value = v?.trim();
      if (!value) return undefined;
      if ((AI_PROVIDER_VALUES as readonly string[]).includes(value)) return value as AiProviderSetting;
      logger.warn('AI_PROVIDER ignored: unknown value', { value });
      return undefined;
    }),
  // Empty value (e.g. `ANTHROPIC_API_KEY=` in .env) = unset.
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  GITHUB_TOKEN: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().default('https://models.github.ai/inference'),
  AI_API_KEY: z.string().min(1).optional(),
  // Model ids and effort per class (src/ai/models.ts). AI_MODEL / AI_EFFORT:
  // reports, summaries, studio. AI_MODEL_FAST / AI_EFFORT_FAST: high-volume
  // classification (triage, radar scoring). Unset = claude-haiku-5-5 for both
  // classes on Anthropic (openai/gpt-4.1 on GitHub Models) and per-task effort.
  // The Settings page overrides these env values (read live by src/ai/).
  AI_MODEL: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_EFFORT: z.string().optional(),
  AI_EFFORT_FAST: z.string().optional(),
  // Monthly AI budget in USD (Anthropic only): warning at 80 %, non-essential
  // workflows stopped at 100 %. Invalid/empty = 200.
  AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().catch(200),
  // Weekly « Dépenses IA » recap on Discord (Monday 09:00 Paris, no AI call).
  // The Settings value (AI_WEEKLY_RECAP_ENABLED) wins. Invalid/empty = on.
  AI_WEEKLY_RECAP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .catch('true')
    .transform((v) => v === 'true' || v === '1'),
  TWEETS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(1),
  // Hard cap on the number of accumulated items fed to the AI in a single digest.
  // Bounds the prompt size so a backlog can never inflate the request past the
  // model/provider prompt-token limit (which would 402/413 and stall the digest,
  // leaving items un-consumed and the backlog growing every run). Items beyond
  // the cap are still drained from the queue — only the newest are summarized.
  VEILLE_DIGEST_MAX_ITEMS: z.coerce.number().int().positive().default(300),
  DRY_RUN: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  ADMIN_PASSWORD: z.string().optional(),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  CRON_SCHEDULE: z.string().default('30 7 * * *'),
  COLLECT_CRON_SCHEDULE: z.string().default('0 * * * *'),
  DISCORD_WEBHOOK_URL: discordWebhookUrlSchema.optional(),

  // Veille delivery (consolidated daily digest). VEILLE_DISCORD_WEBHOOK_URL is
  // the dedicated channel for the consolidated digest; VEILLE_DIGEST_MODE picks
  // between one message per product (default, legacy behaviour) and a single
  // consolidated message. An invalid mode degrades to the safe default instead
  // of failing the whole config (see modules/veille/delivery.ts).
  VEILLE_DISCORD_WEBHOOK_URL: discordWebhookUrlSchema.optional(),
  VEILLE_DIGEST_MODE: veilleDigestModeSchema.catch(DEFAULT_VEILLE_DIGEST_MODE),

  // Optional: Stripe secret key for the Facturation module. When absent, the
  // module works as a local invoice ledger and Stripe sync degrades gracefully.
  STRIPE_API_KEY: z.string().min(1).optional(),

  // Optional: Stripe publishable key. Required only to mount the embedded
  // Checkout for collecting payment on an invoice; absent = the "Encaisser"
  // action stays hidden and the ledger works unchanged.
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),

  // Optional: a calendar ICS feed URL (e.g. Google Calendar secret address) for
  // the Agenda module. When absent, Agenda works as a local event store.
  AGENDA_ICS_URL: z.string().url().optional(),

  // Optional: YouTube Data API v3 key for the veille YouTube source. When
  // absent, the YouTube reader is silently skipped (setup-mode friendly).
  YOUTUBE_API_KEY: z.string().min(1).optional(),

  // Optional: fine-grained GitHub token with Issues: read & write on the
  // product repos, used ONLY by the Radar produit to open issues (ADR-0026).
  // Distinct from GITHUB_TOKEN (GitHub Models inference). Env only, never
  // stored in the DB. Absent or empty = the radar stays in dry-run (an empty
  // value must not fail the whole config, hence no min(1)).
  GITHUB_ISSUES_TOKEN: z.string().optional(),
  })
  .refine((c) => Boolean(c.ANTHROPIC_API_KEY ?? c.AI_API_KEY ?? c.GITHUB_TOKEN), {
    message:
      'Configurez un fournisseur AI : ANTHROPIC_API_KEY (Anthropic), AI_API_KEY (OpenRouter / compatible OpenAI) ou GITHUB_TOKEN (GitHub Models).',
    path: ['GITHUB_TOKEN'],
  });

export type Config = z.infer<typeof configSchema>;

// Minimal schema for boot — only needs web server params
const bootSchema = z.object({
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  CRON_SCHEDULE: z.string().default('30 7 * * *'),
  COLLECT_CRON_SCHEDULE: z.string().default('0 * * * *'),
  ADMIN_PASSWORD: z.string().optional(),
});

export type BootConfig = z.infer<typeof bootSchema>;

export const REQUIRED_CREDENTIALS = [
  {
    key: 'X_USERNAME',
    label: 'X (Twitter) Username',
    docUrl: 'https://x.com/',
    howToFind:
      'Votre nom d\'utilisateur X (sans le @), ex: <code>wifsimster</code>. Visible sur <a href="https://x.com/" target="_blank" rel="noopener">votre profil X</a> après le @.',
  },
  {
    key: 'X_SESSION_AUTH_TOKEN',
    label: 'X Session Auth Token (cookie: auth_token)',
    docUrl: 'https://x.com/',
    howToFind:
      'Connectez-vous sur <a href="https://x.com/" target="_blank" rel="noopener">x.com</a>, ouvrez les DevTools (<kbd>F12</kbd>), onglet <strong>Application</strong> (Chrome) ou <strong>Stockage</strong> (Firefox), puis <strong>Cookies</strong> &gt; <code>https://x.com</code> et copiez la valeur du cookie <code>auth_token</code>.',
  },
  {
    key: 'X_SESSION_CSRF_TOKEN',
    label: 'X Session CSRF Token (cookie: ct0)',
    docUrl: 'https://x.com/',
    howToFind:
      'Même endroit que le auth_token : dans les DevTools (<kbd>F12</kbd>), <strong>Cookies</strong> &gt; <code>https://x.com</code>, copiez la valeur du cookie <code>ct0</code>.',
  },
  {
    key: 'GITHUB_TOKEN',
    label: 'Fournisseur AI — Anthropic (recommandé), GitHub Models ou OpenRouter',
    docUrl: 'https://github.com/settings/tokens?type=beta',
    howToFind:
      'Trois options. <strong>Anthropic</strong> : créez une clé sur <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a> et renseignez <code>ANTHROPIC_API_KEY</code> dans le fichier <code>.env</code> (variable d\'environnement uniquement, jamais en base). <strong>GitHub Models (gratuit)</strong> : token Fine-grained sur <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">github.com/settings/tokens</a>, scope <code>models:read</code>, dans <code>GITHUB_TOKEN</code>. <strong>OpenRouter</strong> : <code>AI_BASE_URL=https://openrouter.ai/api/v1</code> + <code>AI_API_KEY=sk-or-...</code>. Une seule option suffit ; <code>AI_PROVIDER</code> force le choix.',
  },
] as const;

export interface ConfigResult {
  success: true;
  config: Config;
}

export interface ConfigError {
  success: false;
  missing: { key: string; label: string; docUrl: string; howToFind: string; message: string }[];
}

function parseConfig(source: Record<string, string | undefined>): ConfigResult | ConfigError {
  const result = configSchema.safeParse(source);
  if (result.success) {
    return { success: true, config: result.data };
  }

  const failedKeys = new Set(result.error.issues.map((i: ZodIssue) => i.path[0] as string));
  const missing = REQUIRED_CREDENTIALS.flatMap((c) =>
    failedKeys.has(c.key)
      ? [
          {
            ...c,
            message:
              result.error.issues.find((i: ZodIssue) => i.path[0] === c.key)?.message || 'Required',
          },
        ]
      : [],
  );

  return { success: false, missing };
}

export function tryLoadConfigWithOverrides(
  overrides: Record<string, string>,
): ConfigResult | ConfigError {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    // AI model/effort settings stay out of Config: the AI port reads them live
    // from the DB on every call, so Config keeps the env layer only.
    if (value && !(AI_SELECTION_SETTING_KEYS as readonly string[]).includes(key)) {
      merged[key] = value;
    }
  }
  return parseConfig(merged);
}

export function loadBootConfig(): BootConfig {
  return bootSchema.parse(process.env);
}

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${missing.join('\n')}`);
  }
  return result.data;
}
