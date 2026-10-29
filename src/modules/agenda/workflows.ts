import type { Workflow } from '../../workflow/types.js';

export const agendaSync: Workflow = {
  id: 'agenda.sync',
  module: 'agenda',
  label: 'Synchroniser l\'agenda (ICS)',
  trigger: { kind: 'cron', expr: '*/30 * * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'agenda.sync' }],
};

export const agendaRappels: Workflow = {
  id: 'agenda.rappels',
  module: 'agenda',
  label: 'Rappels de l\'agenda du jour',
  trigger: { kind: 'cron', expr: '0 7 * * *' },
  version: 1,
  enabled: false,
  steps: [{ use: 'agenda.rappels' }, { use: 'notify.discord' }],
};

export const agendaWorkflows: Workflow[] = [agendaSync, agendaRappels];
