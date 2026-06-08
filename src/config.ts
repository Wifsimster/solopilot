import { z, type ZodIssue } from 'zod';

const configSchema = z.object({
  X_USERNAME: z.string().min(1),

  // Session tokens for web scraping — can come from env vars or settings DB
  X_SESSION_AUTH_TOKEN: z.string().min(1).optional(),
  X_SESSION_CSRF_TOKEN: z.string().min(1).optional(),

  // Optional: override GraphQL operation IDs when X changes them
  X_GQL_USER_BY_SCREEN_NAME_ID: z.string().optional(),
  X_GQL_HOME_TIMELINE_ID: z.string().optional(),

  GITHUB_TOKEN: z.string().min(1),
  AI_MODEL: z.string().default('openai/gpt-4.1'),
  TWEETS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(1),
  DRY_RUN: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  ADMIN_PASSWORD: z.string().optional(),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  CRON_SCHEDULE: z.string().default('30 7 * * *'),
  COLLECT_CRON_SCHEDULE: z.string().default('0 * * * *'),
  DISCORD_WEBHOOK_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://discord.com/api/webhooks/'), {
      message: 'Must be a Discord webhook URL (https://discord.com/api/webhooks/...)',
    })
    .optional(),

  // Optional: Stripe secret key for the Facturation module. When absent, the
  // module works as a local invoice ledger and Stripe sync degrades gracefully.
  STRIPE_API_KEY: z.string().min(1).optional(),

  // Optional: a calendar ICS feed URL (e.g. Google Calendar secret address) for
  // the Agenda module. When absent, Agenda works as a local event store.
  AGENDA_ICS_URL: z.string().url().optional(),
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
    label: 'GitHub Personal Access Token',
    docUrl: 'https://github.com/settings/tokens?type=beta',
    howToFind:
      'Créez un token sur <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">github.com/settings/tokens</a> (Fine-grained token). Activez le scope <code>models:read</code>. Le token commence par <code>github_pat_...</code>.',
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
    if (value) merged[key] = value;
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
