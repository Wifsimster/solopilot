/**
 * Veille module — workflow definitions.
 *
 * These re-express today's hourly-collect / daily-publish bot as declarative
 * workflows on the new engine. They are DEFINITIONS ONLY: the steps they
 * reference (`fetch.sources`, `persist`, `ai.summarize`, `notify.discord`) are
 * implemented and registered during migration Phase 1, at which point these
 * replace the hard-coded crons with zero behavioural change (strangler-fig,
 * ADR-0013). Until then they ship `enabled: false` and are not scheduled.
 */
import type { Workflow } from '../../workflow/types.js';

/** Hourly source collection — replaces the COLLECT_CRON_SCHEDULE tick. */
export const veilleCollect: Workflow = {
  id: 'veille.collect',
  module: 'veille',
  label: 'Collecter les sources (X, Reddit, HN)',
  trigger: { kind: 'cron', expr: '0 * * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'fetch.sources' }, { use: 'persist' }],
};

/** Daily AI digest at 07:30 — replaces the CRON_SCHEDULE publish tick. */
export const veilleDigest: Workflow = {
  id: 'veille.digest',
  module: 'veille',
  label: 'Résumé quotidien de veille',
  trigger: { kind: 'cron', expr: '30 7 * * *' },
  version: 1,
  enabled: false,
  steps: [
    { use: 'fetch.sources' },
    { use: 'ai.summarize' },
    { use: 'notify.discord' },
  ],
};

/** Monthly aggregation of daily digests. */
export const veilleMonthly: Workflow = {
  id: 'veille.monthly',
  module: 'veille',
  label: 'Synthèse mensuelle',
  trigger: { kind: 'cron', expr: '0 8 1 * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'ai.summarize' }, { use: 'persist' }],
};

export const veilleWorkflows: Workflow[] = [veilleCollect, veilleDigest, veilleMonthly];
