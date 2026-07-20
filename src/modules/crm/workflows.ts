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

/**
 * Hourly safety-net sweep for the veille → CRM lead bridge (offset from
 * collect). The primary path runs inline after each collect; this retries
 * items an earlier failure left pending. Idempotent via `crm_bridged_at`.
 */
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
