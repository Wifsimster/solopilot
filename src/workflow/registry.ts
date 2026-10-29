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

export function resetRegistry(): void {
  workflows.clear();
  steps.clear();
}
