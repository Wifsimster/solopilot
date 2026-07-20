/**
 * CRM bridge — high-intent mentions become CRM leads (ADR-0018 extension).
 *
 * Where mention-monitoring tools stop at an alert email, Solopilot routes the
 * signal into its own CRM: a triaged item flagged `triage_high_intent` creates
 * a contact (status lead, source 'veille') for its author, plus an interaction
 * carrying the excerpt and permalink. Author+product dedup: a returning author
 * gets a new interaction on the existing contact, never a duplicate lead.
 *
 * Idempotent via `crm_bridged_at`: each item is consumed exactly once, so the
 * inline collect path and the safety-net workflow can both run. Opt-in per
 * product (`crm_leads_enabled`); requires triage to have flagged the items.
 */
import type { Config } from '../../config.js';
import { getDb, type ContactRecord } from '../../db.js';
import { getProduct, toProductView } from '../../product-service.js';
import { createContact, addInteraction } from './store.js';
import { resolveDiscordWebhook } from '../../alert-service.js';
import { sendDiscordEmbeds } from '../../adapters/discord-notifier.js';
import { logger } from '../../logger.js';

const EXCERPT_MAX_CHARS = 300;
const NOTIFY_BATCH = 10;

const SOURCE_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  reddit: 'Reddit',
  hn: 'Hacker News',
  youtube: 'YouTube',
};

export interface LeadBridgeResult {
  leads: number;
  interactions: number;
}

interface BridgeItemRow {
  id: string;
  source: string;
  text: string;
  author: string;
  url: string;
  triage_category: string | null;
  triage_urgency: number | null;
}

function excerpt(text: string): string {
  return text.length > EXCERPT_MAX_CHARS ? `${text.slice(0, EXCERPT_MAX_CHARS)}…` : text;
}

function findVeilleContact(productId: string, name: string): ContactRecord | undefined {
  return getDb()
    .prepare(`SELECT * FROM contacts WHERE product_id = ? AND source = 'veille' AND name = ?`)
    .get(productId, name) as ContactRecord | undefined;
}

export async function createLeadsFromMentions(
  config: Config,
  productId: string,
): Promise<LeadBridgeResult> {
  const productRecord = getProduct(productId);
  if (!productRecord) return { leads: 0, interactions: 0 };
  const product = toProductView(productRecord);
  if (!product.crm_leads_enabled) return { leads: 0, interactions: 0 };

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, source, text, author, url, triage_category, triage_urgency
       FROM tweets
       WHERE product_id = ? AND crm_bridged_at IS NULL
         AND triage_high_intent = 1 AND triage_error IS NULL
       ORDER BY created_at ASC`,
    )
    .all(productId) as BridgeItemRow[];
  if (rows.length === 0) return { leads: 0, interactions: 0 };

  const markBridged = db.prepare(`UPDATE tweets SET crm_bridged_at = ? WHERE id = ?`);

  let leads = 0;
  let interactions = 0;
  const newLeadRows: BridgeItemRow[] = [];

  for (const row of rows) {
    const name = row.author || 'Anonyme';
    try {
      let contact = findVeilleContact(productId, name);
      if (!contact) {
        contact = createContact(productId, {
          name,
          status: 'lead',
          source: 'veille',
          notes: `Lead détecté par la veille (${SOURCE_LABELS[row.source] ?? row.source}).`,
        });
        leads++;
        newLeadRows.push(row);
      }
      addInteraction(productId, {
        contact_id: contact.id,
        kind: 'note',
        summary: `Mention à forte intention (${SOURCE_LABELS[row.source] ?? row.source}) : « ${excerpt(row.text)} »${row.url ? `\n${row.url}` : ''}`,
      });
      interactions++;
      markBridged.run(Date.now(), row.id);
    } catch (err) {
      // Leave crm_bridged_at NULL — the item is retried on the next run.
      logger.warn('CRM lead bridge failed for item', {
        productId,
        itemId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (newLeadRows.length > 0) {
    const webhookUrl = resolveDiscordWebhook(config, productId);
    if (webhookUrl) {
      for (let i = 0; i < newLeadRows.length; i += NOTIFY_BATCH) {
        const batch = newLeadRows.slice(i, i + NOTIFY_BATCH);
        const result = await sendDiscordEmbeds(
          webhookUrl,
          batch.map((row) => ({
            title: `🎯 Nouveau lead détecté — ${row.author || 'Anonyme'}`,
            ...(row.url ? { url: row.url } : {}),
            description: [
              `**Source :** ${SOURCE_LABELS[row.source] ?? row.source}`,
              ...(row.triage_category ? [`**Categorie :** ${row.triage_category}`] : []),
              '',
              excerpt(row.text),
              ...(row.url ? ['', `[Voir le post](${row.url})`] : []),
            ].join('\n'),
            color: 0x57f287, // Discord green
            timestamp: new Date().toISOString(),
          })),
        );
        if (!result.success) {
          // Leads are already in the CRM; the notification is best-effort.
          logger.warn('CRM lead notification failed', {
            productId,
            leads: batch.length,
            error: result.error,
          });
          break;
        }
      }
    }
  }

  if (leads > 0 || interactions > 0) {
    logger.info('CRM leads bridged from mentions', { productId, leads, interactions });
  }
  return { leads, interactions };
}
