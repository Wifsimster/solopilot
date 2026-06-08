/**
 * `persist` step.
 *
 * In the strangler-fig phase, source collection (`fetch.sources`) already
 * stores items inside `collectTweets`, so for the veille workflows `persist`
 * is a pass-through that forwards the previous step's output. It exists so the
 * declarative workflow definitions stay runnable and honest about their shape;
 * when steps are split into pure fetch + explicit store (Phase 5), this gains a
 * real body.
 */
import type { Step } from '../workflow/types.js';

export const persistStep: Step<Record<string, unknown>> = {
  use: 'persist',
  run: async (_ctx, input) => input,
};
