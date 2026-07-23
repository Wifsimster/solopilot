import { z, type ZodIssue } from 'zod';

const configSchema = z.object({
  X_USERNAME: z.string().min(1),

  // Session tokens for web scraping — can come from env vars or settings DB
  X_SESSION_AUTH_TOKEN: z.string().min(1).optional(),
  X_SESSION_CSRF_TOKEN: z.string().min(1).optional(),

  // Optional: override GraphQL operation IDs when X changes them
  X_GQL_USER_BY_SCREEN_NAME_ID: z.string().optional(),
  X_GQL_HOME_TIMELINE_ID: z.string().optional(),

  // AI provider credentials. Solopilot talks to any OpenAI-compatible endpoint.
  // The default provider is GitHub Models (free; needs a fine-grained PAT with
  // the `models:read` scope). To use OpenRouter instead, set AI_BASE_URL +
  // AI_API_KEY below. GITHUB_TOKEN stays optional and, when present, also powers
  // GitHub repo-context enrichment during content generation.
  GITHUB_TOKEN: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().default('https://models.github.ai/inference'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().default('openai/gpt-4.1'),
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

  // Optional: Reddit app-only OAuth credentials (create a "script" app at
  // https://www.reddit.com/prefs/apps). When both are set, the Reddit reader
  // authenticates via oauth.reddit.com — required from datacenter IPs, which
  // Reddit blocks (HTTP 403) on the unauthenticated *.json endpoints. When
  // absent, it falls back to the public *.json endpoints (works from
  // residential IPs only).
  REDDIT_CLIENT_ID: z.string().min(1).optional(),
  REDDIT_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .refine((c) => Boolean(c.AI_API_KEY ?? c.GITHUB_TOKEN), {
    message:
      'Configurez un fournisseur AI : AI_API_KEY (OpenRouter / compatible OpenAI) ou GITHUB_TOKEN (GitHub Models).',
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
    label: 'Fournisseur AI — GitHub Models (par défaut) ou OpenRouter',
    docUrl: 'https://github.com/settings/tokens?type=beta',
    howToFind:
      'Deux options. <strong>GitHub Models (gratuit)</strong> : créez un token sur <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">github.com/settings/tokens</a> (Fine-grained), scope <code>models:read</code>, renseignez <code>GITHUB_TOKEN</code> (commence par <code>github_pat_...</code>). <strong>OpenRouter</strong> : renseignez plutôt <code>AI_BASE_URL=https://openrouter.ai/api/v1</code> + <code>AI_API_KEY=sk-or-...</code> et un <code>AI_MODEL</code> supporté. Un seul des deux suffit.',
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
