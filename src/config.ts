import { z, type ZodIssue } from 'zod';
import { logger } from './logger.js';

export const AI_SELECTION_SETTING_KEYS = [
  'AI_MODEL',
  'AI_MODEL_FAST',
  'AI_EFFORT',
  'AI_EFFORT_FAST',
] as const;
export type AiSelectionSettingKey = (typeof AI_SELECTION_SETTING_KEYS)[number];

export const AI_PROVIDER_VALUES = ['anthropic', 'github-models'] as const;
export type AiProviderSetting = (typeof AI_PROVIDER_VALUES)[number];

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

  X_SESSION_AUTH_TOKEN: z.string().min(1).optional(),
  X_SESSION_CSRF_TOKEN: z.string().min(1).optional(),

  X_GQL_USER_BY_SCREEN_NAME_ID: z.string().optional(),
  X_GQL_HOME_TIMELINE_ID: z.string().optional(),

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
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  GITHUB_TOKEN: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().default('https://models.github.ai/inference'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_EFFORT: z.string().optional(),
  AI_EFFORT_FAST: z.string().optional(),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().catch(200),
  AI_WEEKLY_RECAP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .catch('true')
    .transform((v) => v === 'true' || v === '1'),
  TWEETS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(1),
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

  VEILLE_DISCORD_WEBHOOK_URL: discordWebhookUrlSchema.optional(),
  VEILLE_DIGEST_MODE: veilleDigestModeSchema.catch(DEFAULT_VEILLE_DIGEST_MODE),

  STRIPE_API_KEY: z.string().min(1).optional(),

  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),

  AGENDA_ICS_URL: z.string().url().optional(),

  YOUTUBE_API_KEY: z.string().min(1).optional(),

  GITHUB_ISSUES_TOKEN: z.string().optional(),
  })
  .refine((c) => Boolean(c.ANTHROPIC_API_KEY ?? c.AI_API_KEY ?? c.GITHUB_TOKEN), {
    message:
      'Configurez un fournisseur AI : ANTHROPIC_API_KEY (Anthropic), AI_API_KEY (OpenRouter / compatible OpenAI) ou GITHUB_TOKEN (GitHub Models).',
    path: ['GITHUB_TOKEN'],
  });

export type Config = z.infer<typeof configSchema>;

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
