/**
 * Comptabilité module — workflow definitions.
 *
 * `compta.seuils` watches the micro-entreprise plafond and TVA-franchise
 * thresholds and alerts when approaching. `compta.echeance-urssaf` prepares the
 * periodic declaration reminder. Both ship `enabled: false`; reminders and
 * estimates only, no télédéclaration (ADR-0017).
 */
import type { Workflow } from '../../workflow/types.js';

export const comptaSeuils: Workflow = {
  id: 'compta.seuils',
  module: 'compta',
  label: 'Surveiller les plafonds (micro / TVA)',
  trigger: { kind: 'cron', expr: '0 8 * * 1' },
  version: 1,
  enabled: false,
  steps: [{ use: 'compta.seuils' }, { use: 'notify.discord' }],
};

export const comptaEcheanceUrssaf: Workflow = {
  id: 'compta.echeance-urssaf',
  module: 'compta',
  label: 'Rappel de déclaration URSSAF',
  trigger: { kind: 'cron', expr: '0 9 1 * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'compta.echeance' }, { use: 'notify.discord' }],
};

export const comptaWorkflows: Workflow[] = [comptaSeuils, comptaEcheanceUrssaf];
