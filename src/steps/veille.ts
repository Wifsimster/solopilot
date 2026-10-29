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

export const veilleAlertRunStep: Step<VeilleAlertOutput> = {
  use: 'veille.alert-run',
  run: async (ctx) => {
    return sendPendingAlerts(ctx.config, ctx.activityId);
  },
};

export const veilleConsolidatedDigestStep: Step<ConsolidatedDigestResult> = {
  use: 'veille.consolidated-digest-run',
  run: async (ctx) => runConsolidatedDigest(ctx.config, 'cron'),
};

export const veilleRadarProduitStep: Step<RadarResult> = {
  use: 'veille.radar-produit-run',
  run: async (ctx) => runProductRadar(ctx.config, { github: ctx.connectors.githubIssues }),
};
