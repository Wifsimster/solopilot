import type { Config } from '../../config.js';
import { buildMergedConfig } from '../../config-merge.js';
import { getDb, type ProductRecord, type VeilleDigestDeliveryRecord } from '../../db.js';
import { logger } from '../../logger.js';
import { listProducts } from '../../product-service.js';
import { getSettingsMap, getProductSettingsMap } from '../../settings-service.js';
import { triggerRun, getLastDigest, getVeilleDelivery } from '../../run-service.js';
import { sendDiscordMessage } from '../../adapters/discord-notifier.js';
import { getTodayDateParis, utcToParisDate } from '../../date-utils.js';
import { buildConsolidatedDigest, extractTopItems, type DigestSection } from './consolidated-digest.js';

export interface ConsolidatedDigestResult {
  status: VeilleDigestDeliveryRecord['status'];
  deliveryId?: number;
  products: number;
  productsWithItems: number;
  messages: number;
  messagesSent: number;
  reason?: string;
}

let consolidatedRunning = false;

export function isConsolidatedDigestRunning(): boolean {
  return consolidatedRunning;
}

function configForProduct(baseConfig: Config, productId: string): Config {
  return buildMergedConfig(baseConfig, { ...getSettingsMap(), ...getProductSettingsMap(productId) });
}

function openDelivery(date: string, trigger: string): number {
  const { lastInsertRowid } = getDb()
    .prepare(`INSERT INTO veille_digest_deliveries (digest_date, trigger_type) VALUES (?, ?)`)
    .run(date, trigger);
  return Number(lastInsertRowid);
}

function closeDelivery(
  id: number,
  fields: Omit<ConsolidatedDigestResult, 'deliveryId' | 'reason'> & {
    webhookSource: string;
    error?: string;
  },
): void {
  getDb()
    .prepare(
      `UPDATE veille_digest_deliveries SET finished_at = datetime('now'), status = ?,
         products_count = ?, products_with_items = ?, messages_count = ?, messages_sent = ?,
         webhook_source = ?, error_message = ?
       WHERE id = ?`,
    )
    .run(
      fields.status,
      fields.products,
      fields.productsWithItems,
      fields.messages,
      fields.messagesSent,
      fields.webhookSource,
      fields.error ?? null,
      id,
    );
}

export type RunNotificationOutcome = 'sent' | 'failed' | 'skipped';

function recordRunOutcomes(
  outcomes: Map<string, RunNotificationOutcome>,
  date: string,
  deliveryId: number,
): number {
  const db = getDb();
  const select = db.prepare(
    `SELECT id, started_at FROM runs
     WHERE product_id = ? AND trigger_type IN ('cron', 'manual')
       AND status NOT IN ('running', 'deleted')
       AND started_at >= datetime('now', '-2 days')`,
  );
  const update = db.prepare(
    'UPDATE runs SET notification_status = ?, digest_delivery_id = ? WHERE id = ?',
  );
  let updated = 0;
  for (const [productId, outcome] of outcomes) {
    const rows = select.all(productId) as { id: number; started_at: string }[];
    for (const row of rows) {
      if (utcToParisDate(row.started_at) !== date) continue;
      update.run(outcome, deliveryId, row.id);
      updated += 1;
    }
  }
  return updated;
}

function sameOutcome(
  products: ProductRecord[],
  outcome: RunNotificationOutcome,
): Map<string, RunNotificationOutcome> {
  return new Map(products.map((p) => [p.id, outcome]));
}

export function listDigestDeliveries(limit = 20): VeilleDigestDeliveryRecord[] {
  return getDb()
    .prepare('SELECT * FROM veille_digest_deliveries ORDER BY id DESC LIMIT ?')
    .all(limit) as VeilleDigestDeliveryRecord[];
}

export async function runConsolidatedDigest(
  baseConfig: Config,
  trigger: 'cron' | 'manual' = 'cron',
): Promise<ConsolidatedDigestResult> {
  const delivery = getVeilleDelivery();
  if (delivery.mode !== 'consolidated') {
    logger.debug('Consolidated digest skipped — per-product mode');
    return { status: 'skipped', products: 0, productsWithItems: 0, messages: 0, messagesSent: 0, reason: 'mode' };
  }
  if (consolidatedRunning) {
    throw new Error('A consolidated digest is already in progress');
  }
  consolidatedRunning = true;

  const date = getTodayDateParis();
  const deliveryId = openDelivery(date, trigger);
  const webhookSource = delivery.webhookSource;

  let products: ProductRecord[] = [];
  try {
    products = listProducts(false);
    logger.info('Consolidated digest started', { date, products: products.length, trigger });

    for (const product of products) {
      if (product.publish_cron?.trim()) continue;
      try {
        const run = await triggerRun(configForProduct(baseConfig, product.id), trigger, product.id);
        logger.info('Consolidated digest — product published', {
          productId: product.id,
          runId: run.id,
          status: run.status,
        });
      } catch (err) {
        logger.error('Consolidated digest — product publish failed', {
          productId: product.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sections: DigestSection[] = products.map((product) => {
      const digest = getLastDigest(product.id);
      const isToday = digest ? utcToParisDate(digest.started_at) === date : false;
      return {
        productId: product.id,
        productName: product.name,
        items: isToday ? extractTopItems(digest?.summary) : [],
      };
    });
    const productsWithItems = sections.filter((s) => s.items.length > 0).length;
    const messages = buildConsolidatedDigest(sections, { date });
    const base = { products: products.length, productsWithItems, messages: messages.length };

    if (!delivery.webhookUrl) {
      logger.warn(
        'Consolidated digest not sent — VEILLE_DISCORD_WEBHOOK_URL is not configured (no fallback)',
        { date },
      );
      recordRunOutcomes(sameOutcome(products, 'skipped'), date, deliveryId);
      closeDelivery(deliveryId, { ...base, status: 'skipped', messagesSent: 0, webhookSource });
      return { ...base, status: 'skipped', messagesSent: 0, deliveryId, reason: 'no_webhook' };
    }
    if (messages.length === 0) {
      closeDelivery(deliveryId, { ...base, status: 'skipped', messagesSent: 0, webhookSource });
      return { ...base, status: 'skipped', messagesSent: 0, deliveryId, reason: 'no_products' };
    }

    const outcomes = new Map<string, RunNotificationOutcome>();
    let sectionIndex = 0;
    let messagesSent = 0;
    let lastError: string | undefined;
    for (const message of messages) {
      const result = await sendDiscordMessage(delivery.webhookUrl, message);
      if (result.success) messagesSent += 1;
      else lastError = result.error;
      for (let i = 0; i < message.embeds.length; i += 1) {
        const section = sections[sectionIndex];
        sectionIndex += 1;
        if (section) outcomes.set(section.productId, result.success ? 'sent' : 'failed');
      }
    }
    const status: ConsolidatedDigestResult['status'] =
      messagesSent === messages.length ? 'sent' : messagesSent === 0 ? 'failed' : 'partial';

    recordRunOutcomes(outcomes, date, deliveryId);
    closeDelivery(deliveryId, { ...base, status, messagesSent, webhookSource, error: lastError });
    logger.info('Consolidated digest finished', { date, status, ...base, messagesSent, webhookSource });
    return { ...base, status, messagesSent, deliveryId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Consolidated digest failed', { date, error: message });
    try {
      recordRunOutcomes(sameOutcome(products, 'failed'), date, deliveryId);
    } catch (recordErr) {
      logger.error('Consolidated digest — could not record run outcomes', {
        date,
        error: recordErr instanceof Error ? recordErr.message : String(recordErr),
      });
    }
    closeDelivery(deliveryId, {
      status: 'error',
      products: 0,
      productsWithItems: 0,
      messages: 0,
      messagesSent: 0,
      webhookSource,
      error: message,
    });
    return { status: 'error', products: 0, productsWithItems: 0, messages: 0, messagesSent: 0, deliveryId, reason: message };
  } finally {
    consolidatedRunning = false;
  }
}
