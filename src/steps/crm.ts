import { listStaleDeals } from '../modules/crm/store.js';
import { draftFollowup, summarizeFollowups, type FollowupDraft } from '../modules/crm/followup.js';
import { createLeadsFromMentions, type LeadBridgeResult } from '../modules/crm/lead-from-mention.js';
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

export const crmLeadFromMentionStep: Step<LeadBridgeResult> = {
  use: 'crm.leads-from-mentions-run',
  run: async (ctx) => {
    return createLeadsFromMentions(ctx.config, ctx.activityId);
  },
};
