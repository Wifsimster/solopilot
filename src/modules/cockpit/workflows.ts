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
