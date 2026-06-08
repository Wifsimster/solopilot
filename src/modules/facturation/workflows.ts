/**
 * Facturation module — workflow definitions.
 *
 * `facturation.relance-impayes` drafts reminders for overdue invoices and pushes
 * a summary for validation. `facturation.sync-stripe` keeps the local ledger in
 * sync with Stripe (no-op when Stripe is not configured). Both ship
 * `enabled: false` (ADR-0016).
 */
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
