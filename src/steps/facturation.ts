/**
 * Facturation steps.
 *
 * `facturation.relance` — finds overdue invoices and drafts a reminder per
 * invoice, returning them staged for validation (never sent automatically) plus
 * a `content` summary for a downstream notifier.
 *
 * `facturation.sync` — pulls invoices from Stripe and upserts the local ledger.
 * Degradable and a no-op when Stripe is not configured, so it can never fail a
 * run. See ADR-0016.
 */
import { listOverdueInvoices } from '../modules/facturation/store.js';
import { upsertStripeInvoices } from '../modules/facturation/store.js';
import { draftRelance, summarizeRelances, type RelanceDraft } from '../modules/facturation/relance.js';
import { getTodayDateParis } from '../date-utils.js';
import type { Step } from '../workflow/types.js';

export interface RelanceOutput {
  drafts: RelanceDraft[];
  content: string;
}

export const facturationRelanceStep: Step<RelanceOutput> = {
  use: 'facturation.relance',
  run: async (ctx) => {
    const today = getTodayDateParis();
    const overdue = listOverdueInvoices(ctx.activityId, today);
    const drafts = overdue.map((inv) => draftRelance(inv, today));
    ctx.log.info('facturation.relance — drafts staged', {
      activity: ctx.activityId,
      count: drafts.length,
    });
    return { drafts, content: summarizeRelances(drafts) };
  },
};

export interface SyncOutput {
  synced: number;
  skipped: boolean;
}

export const facturationSyncStep: Step<SyncOutput> = {
  use: 'facturation.sync',
  degradable: true,
  run: async (ctx) => {
    if (!ctx.connectors.stripe.isConfigured()) {
      ctx.log.info('facturation.sync skipped — Stripe not configured', {
        activity: ctx.activityId,
      });
      return { synced: 0, skipped: true };
    }
    const invoices = await ctx.connectors.stripe.listInvoices();
    const synced = upsertStripeInvoices(ctx.activityId, invoices);
    ctx.log.info('facturation.sync complete', { activity: ctx.activityId, synced });
    return { synced, skipped: false };
  },
};
