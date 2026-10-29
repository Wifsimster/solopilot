import {
  DEFAULT_VEILLE_DIGEST_MODE,
  discordWebhookUrlSchema,
  veilleDigestModeSchema,
  type VeilleDigestMode,
} from '../../config.js';

export type VeilleDeliveryKey = 'VEILLE_DIGEST_MODE' | 'VEILLE_DISCORD_WEBHOOK_URL';

export type VeilleDeliveryLayer = Partial<Record<VeilleDeliveryKey, string | undefined>>;

export type VeilleWebhookSource = 'VEILLE_DISCORD_WEBHOOK_URL' | 'none';

export interface VeilleDelivery {
  mode: VeilleDigestMode;
  webhookUrl?: string;
  webhookSource: VeilleWebhookSource;
  warnings: string[];
}

function pick(
  key: VeilleDeliveryKey,
  env: VeilleDeliveryLayer,
  settings: VeilleDeliveryLayer,
  isValid: (value: string) => boolean,
  warnings: string[],
): string | undefined {
  for (const [layer, source] of [
    [settings, 'settings'],
    [env, 'env'],
  ] as const) {
    const raw = layer[key]?.trim();
    if (!raw) continue;
    if (isValid(raw)) return raw;
    warnings.push(`${key} invalide (${source}) — valeur ignoree`);
  }
  return undefined;
}

const isWebhook = (v: string) => discordWebhookUrlSchema.safeParse(v).success;
const isMode = (v: string) => veilleDigestModeSchema.safeParse(v).success;

export function resolveVeilleDelivery(
  env: VeilleDeliveryLayer,
  settings: VeilleDeliveryLayer,
): VeilleDelivery {
  const warnings: string[] = [];
  const mode = (pick('VEILLE_DIGEST_MODE', env, settings, isMode, warnings) ??
    DEFAULT_VEILLE_DIGEST_MODE) as VeilleDigestMode;

  const veilleWebhook = pick('VEILLE_DISCORD_WEBHOOK_URL', env, settings, isWebhook, warnings);
  if (veilleWebhook) {
    return { mode, webhookUrl: veilleWebhook, webhookSource: 'VEILLE_DISCORD_WEBHOOK_URL', warnings };
  }
  return { mode, webhookSource: 'none', warnings };
}
