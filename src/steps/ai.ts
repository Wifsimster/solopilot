import { createAIFilter } from '../ai-filter.js';
import { getUnpublishedTweets } from '../tweet-store.js';
import type { Item } from '../ports.js';
import type { Step } from '../workflow/types.js';

export interface SummarizeOutput {
  summary: string | null;
  itemCount: number;
  itemIds: string[];
}

export const aiSummarizeStep: Step<SummarizeOutput> = {
  use: 'ai.summarize',
  run: async (ctx, rawInput) => {
    const provided = rawInput.items as Item[] | undefined;
    const items = provided ?? getUnpublishedTweets(ctx.activityId);

    if (items.length === 0) {
      ctx.log.info('ai.summarize — no items to summarize', { activity: ctx.activityId });
      return { summary: null, itemCount: 0, itemIds: [] };
    }

    const aiFilter = createAIFilter(ctx.config);
    const summary = await aiFilter.filterAndSummarize(items);

    ctx.log.info('ai.summarize complete', {
      activity: ctx.activityId,
      itemCount: items.length,
      hasSummary: summary !== null,
    });

    return { summary, itemCount: items.length, itemIds: items.map((i) => i.id) };
  },
};
