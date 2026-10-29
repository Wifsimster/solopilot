import type { Workflow } from '../../workflow/types.js';

export const crmFollowupStale: Workflow = {
  id: 'crm.followup-stale',
  module: 'crm',
  label: 'Relancer les opportunités dormantes',
  trigger: { kind: 'cron', expr: '0 9 * * 2' },
  version: 1,
  enabled: false,
  steps: [{ use: 'crm.followup' }, { use: 'notify.discord' }],
};

export const crmLeadFromMention: Workflow = {
  id: 'crm.lead-from-mention',
  module: 'crm',
  label: 'Leads depuis les mentions à forte intention',
  trigger: { kind: 'cron', expr: '20 * * * *' },
  version: 1,
  enabled: true,
  steps: [{ use: 'crm.leads-from-mentions-run' }],
};

export const crmWorkflows: Workflow[] = [crmFollowupStale, crmLeadFromMention];
