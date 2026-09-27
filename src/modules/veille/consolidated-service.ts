/**
 * Consolidated daily veille digest (VEILLE_DIGEST_MODE=consolidated).
 *
 * One run, sequenced — never timing-based:
 *   1. publish every active product that follows the GLOBAL publish schedule
 *      (no own `publish_cron`), one after the other, through the exact same
 *      `triggerRun` as per-product mode. In consolidated mode triggerRun stores
 *      the summary but does not post it (notification_status = 'consolidated').
 *   2. build one section per active product from its latest successful digest
 *      of the day (Paris date) → top items, or "Rien de notable".
 *   3. send the fewest Discord messages (buildConsolidatedDigest) to
 *      VEILLE_DISCORD_WEBHOOK_URL, else DISCORD_WEBHOOK_URL, else skip + warn.
 *   4. record the delivery in `veille_digest_deliveries`.
 *
 * Item source: the stored AI digest (`runs.summary`) of each product, i.e. the
 * items the per-product AI already selected as relevant, with their links.
 * Raw collected items (`tweets`) are not used: they include everything the AI
 * discarded and have no reliable relevance ranking.
 *
 * Products with their own `publish_cron` keep their own schedule (their Discord
 * post is suppressed too); their section shows today's digest if it already ran,
 * else "Rien de notable".
 *
 * In per-product mode this is a no-op (status 'skipped'), so the cron tick that
 * dispatches it is harmless and the legacy behaviour is untouched.
 */
import type { Config } from '../../config.js';
import { buildMergedConfig } from '../../config-merge.js';
import { getDb, type VeilleDigestDeliveryRecord } from '../../db.js';
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
  // Same merge as cron-manager's mergeProductConfig: env/base → global → product.
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

  try {
    const products = listProducts(false);
    logger.info('Consolidated digest started', { date, products: products.length, trigger });

    // 1. Sequenced per-product publish (global-schedule products only).
    for (const product of products) {
      if (product.publish_cron?.trim()) continue;
      try {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: one product at a time, then the consolidated send
        const run = await triggerRun(configForProduct(baseConfig, product.id), trigger, product.id);
        logger.info('Consolidated digest — product published', {
          productId: product.id,
          runId: run.id,
          status: run.status,
        });
      } catch (err) {
        // A product already publishing (manual run) or failing must not block
        // the others; its section falls back to today's digest if any.
        logger.error('Consolidated digest — product publish failed', {
          productId: product.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. One section per product, from today's latest successful digest.
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

    // 3. Send.
    if (!delivery.webhookUrl) {
      logger.warn(
        'Consolidated digest not sent — no VEILLE_DISCORD_WEBHOOK_URL nor DISCORD_WEBHOOK_URL configured',
        { date },
      );
      closeDelivery(deliveryId, { ...base, status: 'skipped', messagesSent: 0, webhookSource });
      return { ...base, status: 'skipped', messagesSent: 0, deliveryId, reason: 'no_webhook' };
    }
    if (messages.length === 0) {
      closeDelivery(deliveryId, { ...base, status: 'skipped', messagesSent: 0, webhookSource });
      return { ...base, status: 'skipped', messagesSent: 0, deliveryId, reason: 'no_products' };
    }

    let messagesSent = 0;
    let lastError: string | undefined;
    for (const message of messages) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- ordered pages; Discord must receive them in sequence
      const result = await sendDiscordMessage(delivery.webhookUrl, message);
      if (result.success) messagesSent += 1;
      else lastError = result.error;
    }
    const status: ConsolidatedDigestResult['status'] =
      messagesSent === messages.length ? 'sent' : messagesSent === 0 ? 'failed' : 'partial';

    closeDelivery(deliveryId, { ...base, status, messagesSent, webhookSource, error: lastError });
    logger.info('Consolidated digest finished', { date, status, ...base, messagesSent, webhookSource });
    return { ...base, status, messagesSent, deliveryId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Consolidated digest failed', { date, error: message });
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
