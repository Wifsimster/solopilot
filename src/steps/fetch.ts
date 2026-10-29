import { collectTweets, type CollectResult } from '../collect-service.js';
import type { Step } from '../workflow/types.js';

export const fetchSourcesStep: Step<CollectResult> = {
  use: 'fetch.sources',
  run: async (ctx) => {
    return collectTweets(ctx.config, ctx.activityId);
  },
};
