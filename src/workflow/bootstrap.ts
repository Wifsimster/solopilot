/**
 * Workflow bootstrap — registers the built-in steps and workflow definitions.
 *
 * Idempotent and side-effect-free beyond registration. Calling this does NOT
 * schedule anything; the scheduler reads the registry separately. Until the
 * veille workflows are flipped to `enabled: true` (migration plan, Phase 1),
 * registering them is inert.
 */
import { registerStep, registerWorkflow, getWorkflow } from './registry.js';
import { fetchSourcesStep } from '../steps/fetch.js';
import { persistStep } from '../steps/persist.js';
import { aiSummarizeStep } from '../steps/ai.js';
import { notifyDiscordStep } from '../steps/notify.js';
import { cockpitAggregateStep } from '../steps/cockpit.js';
import { facturationRelanceStep, facturationSyncStep } from '../steps/facturation.js';
import { comptaSeuilsStep, comptaEcheanceStep } from '../steps/comptabilite.js';
import { crmFollowupStep } from '../steps/crm.js';
import { veilleWorkflows } from '../modules/veille/workflows.js';
import { cockpitWorkflows } from '../modules/cockpit/workflows.js';
import { facturationWorkflows } from '../modules/facturation/workflows.js';
import { comptaWorkflows } from '../modules/comptabilite/workflows.js';
import { crmWorkflows } from '../modules/crm/workflows.js';

let bootstrapped = false;

export function registerSolopilot(): void {
  if (bootstrapped) return;

  registerStep(fetchSourcesStep);
  registerStep(persistStep);
  registerStep(aiSummarizeStep);
  registerStep(notifyDiscordStep);
  registerStep(cockpitAggregateStep);
  registerStep(facturationRelanceStep);
  registerStep(facturationSyncStep);
  registerStep(comptaSeuilsStep);
  registerStep(comptaEcheanceStep);
  registerStep(crmFollowupStep);

  for (const wf of [
    ...veilleWorkflows,
    ...cockpitWorkflows,
    ...facturationWorkflows,
    ...comptaWorkflows,
    ...crmWorkflows,
  ]) {
    if (!getWorkflow(wf.id)) registerWorkflow(wf);
  }

  bootstrapped = true;
}
