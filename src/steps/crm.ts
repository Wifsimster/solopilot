/**
 * `crm.followup` step.
 *
 * Finds open deals that have gone stale (no interaction / stage change in a
 * while) and drafts a follow-up per deal, staged for validation. Emits a
 * `content` summary for a downstream notifier, or `null` (which makes
 * `notify.discord` quietly skip) when nothing is stale. See ADR-0018.
 */
import { listStaleDeals } from '../modules/crm/store.js';
import { draftFollowup, summarizeFollowups, type FollowupDraft } from '../modules/crm/followup.js';
import type { Step } from '../workflow/types.js';

export interface FollowupOutput {
  drafts: FollowupDraft[];
  content: string | null;
}

export const crmFollowupStep: Step<FollowupOutput> = {
  use: 'crm.followup',
  run: async (ctx) => {
    const stale = listStaleDeals(ctx.activityId);
    const drafts = stale.map(draftFollowup);
    ctx.log.info('crm.followup — stale deals', { activity: ctx.activityId, count: drafts.length });
    return { drafts, content: summarizeFollowups(drafts) };
  },
};
