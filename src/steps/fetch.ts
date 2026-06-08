/**
 * `fetch.sources` step.
 *
 * Strangler-fig wrapper: delegates to the existing `collectTweets` service,
 * which fetches every enabled source for the activity, stores items with
 * deduplication, and runs intent matching. Behaviour is identical to today's
 * hourly collect tick — this step just exposes it to the workflow engine.
 */
import { collectTweets, type CollectResult } from '../collect-service.js';
import type { Step } from '../workflow/types.js';

export const fetchSourcesStep: Step<CollectResult> = {
  use: 'fetch.sources',
  run: async (ctx) => {
    return collectTweets(ctx.config, ctx.activityId);
  },
};
