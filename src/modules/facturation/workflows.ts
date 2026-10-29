import type { Workflow } from '../../workflow/types.js';

export const facturationRelanceImpayes: Workflow = {
  id: 'facturation.relance-impayes',
  module: 'facturation',
  label: 'Relancer les factures impayées',
  trigger: { kind: 'cron', expr: '0 9 * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'facturation.relance' }, { use: 'notify.discord' }],
};

export const facturationSyncStripe: Workflow = {
  id: 'facturation.sync-stripe',
  module: 'facturation',
  label: 'Synchroniser les factures Stripe',
  trigger: { kind: 'cron', expr: '0 */6 * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'facturation.sync' }],
};

export const facturationWorkflows: Workflow[] = [
  facturationRelanceImpayes,
  facturationSyncStripe,
];
