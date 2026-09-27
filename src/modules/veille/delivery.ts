/**
 * Veille delivery resolution — where (and how) the daily digest is posted.
 *
 * Pure: takes the environment layer and the global DB settings layer and
 * returns the effective mode + webhook. Same precedence as the rest of the
 * config (env is the base, a non-empty DB setting overrides it). Invalid values
 * never throw — they are ignored with a warning so a typo in Settings can never
 * take the daily digest (or the boot path) down.
 *
 * Consolidated mode posts to VEILLE_DISCORD_WEBHOOK_URL, else the global
 * DISCORD_WEBHOOK_URL, else nothing (skip + warn). Per-product webhooks are
 * deliberately never used in consolidated mode: they belong to per-product mode.
 */
import {
  DEFAULT_VEILLE_DIGEST_MODE,
  discordWebhookUrlSchema,
  veilleDigestModeSchema,
  type VeilleDigestMode,
} from '../../config.js';

export type VeilleDeliveryKey =
  | 'VEILLE_DIGEST_MODE'
  | 'VEILLE_DISCORD_WEBHOOK_URL'
  | 'DISCORD_WEBHOOK_URL';

/** A layer of raw string values (process.env, or the settings table map). */
export type VeilleDeliveryLayer = Partial<Record<VeilleDeliveryKey, string | undefined>>;

export type VeilleWebhookSource = 'VEILLE_DISCORD_WEBHOOK_URL' | 'DISCORD_WEBHOOK_URL' | 'none';

export interface VeilleDelivery {
  mode: VeilleDigestMode;
  /** Webhook for the consolidated digest; undefined when none is configured. */
  webhookUrl?: string;
  webhookSource: VeilleWebhookSource;
  /** Human-readable reasons for ignored values (never contain secrets). */
  warnings: string[];
}

function pick(
  key: VeilleDeliveryKey,
  env: VeilleDeliveryLayer,
  settings: VeilleDeliveryLayer,
  isValid: (value: string) => boolean,
  warnings: string[],
): string | undefined {
  // DB setting first (overrides env), then env. An invalid DB value falls back
  // to env rather than disabling the setting entirely.
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
  const globalWebhook = pick('DISCORD_WEBHOOK_URL', env, settings, isWebhook, warnings);
  if (globalWebhook) {
    return { mode, webhookUrl: globalWebhook, webhookSource: 'DISCORD_WEBHOOK_URL', warnings };
  }
  return { mode, webhookSource: 'none', warnings };
}
