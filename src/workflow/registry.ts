/**
 * Workflow & step registry.
 *
 * Single source of truth for the engine, the scheduler, and the dashboard:
 * which workflows exist, which are enabled, and which steps are available to
 * compose them. In-process and in-memory, matching the single-process SQLite
 * posture of the rest of the app (ADR-0013).
 */
import type { Step, Workflow } from './types.js';

const workflows = new Map<string, Workflow>();
const steps = new Map<string, Step>();

export function registerWorkflow(wf: Workflow): void {
  if (workflows.has(wf.id)) {
    throw new Error(`Workflow already registered: ${wf.id}`);
  }
  workflows.set(wf.id, wf);
}

export function registerStep(step: Step): void {
  if (steps.has(step.use)) {
    throw new Error(`Step already registered: ${step.use}`);
  }
  steps.set(step.use, step);
}

export function getWorkflow(id: string): Workflow | undefined {
  return workflows.get(id);
}

export function getStep(use: string): Step | undefined {
  return steps.get(use);
}

export function listWorkflows(opts?: { enabledOnly?: boolean }): Workflow[] {
  const all = [...workflows.values()];
  return opts?.enabledOnly ? all.filter((w) => w.enabled) : all;
}

/** Test/boot helper — clears the registry. */
export function resetRegistry(): void {
  workflows.clear();
  steps.clear();
}
