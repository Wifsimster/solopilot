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
import { notifyDiscordStep } from '../steps/notify.js';
import { veilleWorkflows } from '../modules/veille/workflows.js';

let bootstrapped = false;

export function registerSolopilot(): void {
  if (bootstrapped) return;

  registerStep(fetchSourcesStep);
  registerStep(persistStep);
  registerStep(notifyDiscordStep);

  for (const wf of veilleWorkflows) {
    if (!getWorkflow(wf.id)) registerWorkflow(wf);
  }

  bootstrapped = true;
}
