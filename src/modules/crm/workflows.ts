/**
 * CRM module — workflow definitions.
 *
 * `crm.followup-stale` drafts reminders for open deals that have gone quiet and
 * pushes a summary for validation. Ships `enabled: false`; staged drafts only,
 * nothing sent automatically (ADR-0018).
 */
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

export const crmWorkflows: Workflow[] = [crmFollowupStale];
