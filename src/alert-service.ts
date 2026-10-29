import type { Config } from './config.js';
import { getDb } from './db.js';
import { getProduct, toProductView } from './product-service.js';
import { getSetting, getProductSetting } from './settings-service.js';
import { getVeilleDelivery } from './run-service.js';
import { sendDiscordEmbeds, type DiscordEmbed } from './adapters/discord-notifier.js';
import { logger } from './logger.js';

export const DEFAULT_ALERT_THRESHOLD = 80;

const EMBEDS_PER_MESSAGE = 10;
const EXCERPT_MAX_CHARS = 300;

const SOURCE_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  reddit: 'Reddit',
  hn: 'Hacker News',
  youtube: 'YouTube',
};

export interface AlertResult {
  alerted: number;
  channel?: 'consolidated' | 'product';
  skipped?: 'no_webhook';
}

interface AlertItemRow {
  id: string;
  source: string;
  text: string;
  author: string;
  url: string;
  triage_category: string | null;
  triage_urgency: number;
}

export function resolveDiscordWebhook(config: Config, productId: string): string | undefined {
  const product = getProduct(productId);
  if (product?.discord_webhook) return product.discord_webhook;
  const productSetting = getProductSetting(productId, 'DISCORD_WEBHOOK_URL');
  if (productSetting) return productSetting;
  return getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL;
}

function resolveAlertTarget(
  config: Config,
  productId: string,
): { channel: 'consolidated' | 'product'; webhookUrl: string | undefined } {
  const delivery = getVeilleDelivery();
  if (delivery.mode === 'consolidated') {
    return { channel: 'consolidated', webhookUrl: delivery.webhookUrl };
  }
  return { channel: 'product', webhookUrl: resolveDiscordWebhook(config, productId) };
}

function buildAlertEmbed(item: AlertItemRow, productName?: string): DiscordEmbed {
  const excerpt =
    item.text.length > EXCERPT_MAX_CHARS ? `${item.text.slice(0, EXCERPT_MAX_CHARS)}…` : item.text;
  const sourceLabel = SOURCE_LABELS[item.source] ?? item.source;
  const lines = [
    ...(productName ? [`**Produit :** ${productName}`] : []),
    `**Source :** ${sourceLabel}${item.author ? ` — @${item.author}` : ''}`,
    ...(item.triage_category ? [`**Categorie :** ${item.triage_category}`] : []),
    '',
    excerpt,
    ...(item.url ? ['', `[Voir le post](${item.url})`] : []),
  ];
  return {
    title: productName
      ? `🚨 Mention urgente — ${productName} (${item.triage_urgency}/100)`
      : `🚨 Mention urgente (${item.triage_urgency}/100)`,
    ...(item.url ? { url: item.url } : {}),
    description: lines.join('\n'),
    color: 0xed4245,
    timestamp: new Date().toISOString(),
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export async function sendPendingAlerts(config: Config, productId: string): Promise<AlertResult> {
  const productRecord = getProduct(productId);
  if (!productRecord) return { alerted: 0 };
  const product = toProductView(productRecord);
  if (!product.alert_enabled) return { alerted: 0 };

  const threshold = product.alert_threshold ?? DEFAULT_ALERT_THRESHOLD;
  const { channel, webhookUrl } = resolveAlertTarget(config, productId);
  if (!webhookUrl) {
    if (channel === 'consolidated') {
      logger.warn(
        'Urgency alerts skipped — VEILLE_DIGEST_MODE=consolidated but VEILLE_DISCORD_WEBHOOK_URL is not configured (no fallback)',
        { productId },
      );
    } else {
      logger.info('Urgency alerts skipped: no Discord webhook configured', { productId });
    }
    return { alerted: 0, channel, skipped: 'no_webhook' };
  }
  const productName = channel === 'consolidated' ? product.name : undefined;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, source, text, author, url, triage_category, triage_urgency
       FROM tweets
       WHERE product_id = ? AND alerted_at IS NULL
         AND triaged_at IS NOT NULL AND triage_error IS NULL
         AND triage_urgency >= ?
       ORDER BY triage_urgency DESC, created_at ASC`,
    )
    .all(productId, threshold) as AlertItemRow[];
  if (rows.length === 0) return { alerted: 0, channel };

  const markAlerted = db.prepare(`UPDATE tweets SET alerted_at = ? WHERE id = ?`);
  const markBatch = db.transaction((ids: string[], now: number) => {
    for (const id of ids) markAlerted.run(now, id);
  });

  let alerted = 0;
  for (const batch of chunk(rows, EMBEDS_PER_MESSAGE)) {
    const result = await sendDiscordEmbeds(
      webhookUrl,
      batch.map((row) => buildAlertEmbed(row, productName)),
    );
    if (!result.success) {
      logger.warn('Urgency alert send failed', {
        productId,
        items: batch.length,
        error: result.error,
      });
      break;
    }
    markBatch(
      batch.map((r) => r.id),
      Date.now(),
    );
    alerted += batch.length;
  }

  if (alerted > 0) {
    logger.info('Urgency alerts sent', { productId, alerted, threshold, channel });
  }
  return { alerted, channel };
}
