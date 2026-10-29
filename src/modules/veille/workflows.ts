import type { Workflow } from '../../workflow/types.js';

export const veilleCollect: Workflow = {
  id: 'veille.collect',
  module: 'veille',
  label: 'Collecter les sources (X, Reddit, HN)',
  trigger: { kind: 'cron', expr: '0 * * * *' },
  version: 2,
  enabled: true,
  steps: [{ use: 'veille.collect-run' }],
};

export const veilleDigest: Workflow = {
  id: 'veille.digest',
  module: 'veille',
  label: 'Résumé quotidien de veille',
  trigger: { kind: 'cron', expr: '30 7 * * *' },
  version: 2,
  enabled: true,
  steps: [{ use: 'veille.publish-run' }],
};

export const veilleDigestConsolidated: Workflow = {
  id: 'veille.digest-consolidated',
  module: 'veille',
  label: 'Résumé quotidien de veille consolidé (tous produits)',
  trigger: { kind: 'cron', expr: '30 7 * * *' },
  version: 1,
  enabled: true,
  steps: [{ use: 'veille.consolidated-digest-run' }],
};

export const veilleAlert: Workflow = {
  id: 'veille.alert',
  module: 'veille',
  label: 'Alertes mentions urgentes',
  trigger: { kind: 'cron', expr: '10 * * * *' },
  version: 1,
  enabled: true,
  steps: [{ use: 'veille.alert-run' }],
};

export const veilleRadarProduit: Workflow = {
  id: 'veille.radar-produit',
  module: 'veille',
  label: 'Radar produit : actualités → issues GitHub',
  trigger: { kind: 'cron', expr: '45 * * * *' },
  version: 1,
  enabled: true,
  steps: [{ use: 'veille.radar-produit-run' }],
};

export const veilleWorkflows: Workflow[] = [
  veilleCollect,
  veilleDigest,
  veilleDigestConsolidated,
  veilleAlert,
  veilleRadarProduit,
];
