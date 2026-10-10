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
import { sendPendingAlerts, type AlertResult } from '../alert-service.js';
import {
  runConsolidatedDigest,
  type ConsolidatedDigestResult,
} from '../modules/veille/consolidated-service.js';
import { runProductRadar, type RadarResult } from '../modules/veille/radar-service.js';
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

export type VeilleAlertOutput = AlertResult;

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

/**
 * Consolidated daily digest: sequences every global-schedule product's publish
 * (same triggerRun as veille.publish-run) then posts ONE cross-product digest.
 * `ctx.config` must be the un-merged base config — each product's config is
 * merged inside, exactly like cron-manager does. No-op in per-product mode.
 */
export const veilleConsolidatedDigestStep: Step<ConsolidatedDigestResult> = {
  use: 'veille.consolidated-digest-run',
  run: async (ctx) => runConsolidatedDigest(ctx.config, 'cron'),
};

/**
 * Radar produit (ADR-0026): scores triaged news against every repo-backed
 * product and turns very relevant pairs into GitHub issue proposals (dry-run by
 * default). `ctx.config` is the base config merged with global settings. Not
 * degradable: an AI failure marks the run as error and leaves items pending.
 */
export const veilleRadarProduitStep: Step<RadarResult> = {
  use: 'veille.radar-produit-run',
  run: async (ctx) => runProductRadar(ctx.config, { github: ctx.connectors.githubIssues }),
};
