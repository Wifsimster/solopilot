/**
 * Cockpit module — workflow definitions.
 *
 * `cockpit.daily-briefing` aggregates the state of every active module into one
 * French markdown brief and pushes it. It composes existing steps
 * (`cockpit.aggregate` → `notify.discord`), so it needs no AI call. Ships
 * `enabled: false` until the cockpit is wired into the scheduler (ADR-0015).
 */
import type { Workflow } from '../../workflow/types.js';

export const cockpitDailyBriefing: Workflow = {
  id: 'cockpit.daily-briefing',
  module: 'cockpit',
  label: 'Brief quotidien',
  trigger: { kind: 'cron', expr: '30 7 * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'cockpit.aggregate' }, { use: 'notify.discord' }],
};

export const cockpitWorkflows: Workflow[] = [cockpitDailyBriefing];
