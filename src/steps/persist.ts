import type { Step } from '../workflow/types.js';

export const persistStep: Step<Record<string, unknown>> = {
  use: 'persist',
  run: async (_ctx, input) => input,
};
