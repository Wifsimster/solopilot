import { buildBriefing, renderBriefingText, type Briefing } from '../modules/cockpit/briefing.js';
import type { Step } from '../workflow/types.js';

export interface CockpitOutput {
  briefing: Briefing;
  content: string;
}

export const cockpitAggregateStep: Step<CockpitOutput> = {
  use: 'cockpit.aggregate',
  run: async (ctx) => {
    const briefing = buildBriefing(ctx.activityId);
    const content = renderBriefingText(briefing);
    ctx.log.info('cockpit.aggregate complete', {
      activity: ctx.activityId,
      pendingItems: briefing.veille.pendingItems,
      newLeads: briefing.acquisition.newLeads,
    });
    return { briefing, content };
  },
};
