/**
 * Veille steps — behaviour-preserving delegations.
 *
 * The flip (ADR-0020) routes production veille through the workflow engine
 * WITHOUT changing behaviour: these steps delegate to the exact same
 * `triggerCollect` / `triggerRun` services the legacy crons call, so the runs
 * table, AI summary, Discord notification and tweet bookkeeping are identical.
 * The only addition is a `workflow_runs` trace on top. `ctx.config` is assumed
 * already merged for the activity by the scheduler (as cron-manager does today).
 */
import { triggerCollect, triggerRun } from '../run-service.js';
import { sendPendingAlerts } from '../alert-service.js';
import type { Step } from '../workflow/types.js';

export interface VeilleCollectOutput {
  status: string;
  tweetsFetched: number;
}

export const veilleCollectRunStep: Step<VeilleCollectOutput> = {
  use: 'veille.collect-run',
  run: async (ctx) => {
    const run = await triggerCollect(ctx.config, ctx.activityId);
    return { status: run.status, tweetsFetched: run.tweets_fetched };
  },
};

export interface VeillePublishOutput {
  status: string;
  hasSummary: boolean;
}

export const veillePublishRunStep: Step<VeillePublishOutput> = {
  use: 'veille.publish-run',
  run: async (ctx) => {
    const run = await triggerRun(ctx.config, 'cron', ctx.activityId);
    return { status: run.status, hasSummary: run.summary !== null };
  },
};

export interface VeilleAlertOutput {
  alerted: number;
}

/**
 * Safety-net sweep for high-urgency alerts. The primary path is inline in
 * collect (immediacy); this step re-runs the same idempotent service so
 * missed items (e.g. webhook down during collect) are picked up, and so the
 * sweep can be run manually via `npm run workflow -- veille.alert`.
 */
export const veilleAlertRunStep: Step<VeilleAlertOutput> = {
  use: 'veille.alert-run',
  run: async (ctx) => {
    return sendPendingAlerts(ctx.config, ctx.activityId);
  },
};
