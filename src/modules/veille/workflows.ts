/**
 * Veille module — workflow definitions.
 *
 * `veille.collect` / `veille.digest` re-express today's bot on the engine via
 * behaviour-preserving delegations (`veille.collect-run` → `triggerCollect`,
 * `veille.publish-run` → `triggerRun`). They are `enabled: true`, but are ONLY
 * scheduled in production when the `WORKFLOW_SCHEDULER` flag is on (ADR-0020) —
 * the legacy crons remain the default. Schedules here are the defaults; the
 * production scheduler injects the configured CRON/COLLECT schedules.
 */
import type { Workflow } from '../../workflow/types.js';

/** Hourly source collection — delegates to triggerCollect. */
export const veilleCollect: Workflow = {
  id: 'veille.collect',
  module: 'veille',
  label: 'Collecter les sources (X, Reddit, HN)',
  trigger: { kind: 'cron', expr: '0 * * * *' },
  version: 2,
  enabled: true,
  steps: [{ use: 'veille.collect-run' }],
};

/** Daily AI digest at 07:30 — delegates to triggerRun (AI summary + Discord). */
export const veilleDigest: Workflow = {
  id: 'veille.digest',
  module: 'veille',
  label: 'Résumé quotidien de veille',
  trigger: { kind: 'cron', expr: '30 7 * * *' },
  version: 2,
  enabled: true,
  steps: [{ use: 'veille.publish-run' }],
};

export const veilleWorkflows: Workflow[] = [veilleCollect, veilleDigest];
