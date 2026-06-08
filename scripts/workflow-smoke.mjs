// Smoke test for the workflow engine runtime (engine + runner + run-store).
// Runs against a throwaway DB; no network, no prod data. Exits non-zero on failure.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-')), 'smoke.db');

const { registerStep, registerWorkflow, resetRegistry } = await import('../dist/workflow/registry.js');
const { runWorkflowById } = await import('../dist/workflow/runner.js');
const { getWorkflowRun, listWorkflowRuns } = await import('../dist/workflow/run-store.js');

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
};

resetRegistry();

// Steps: a pure echo, a degradable failer, and a fatal failer.
registerStep({ use: 'test.echo', run: async (_c, input) => ({ ...input, echoed: true }) });
registerStep({ use: 'test.degradable-fail', degradable: true, run: async () => { throw new Error('boom-degradable'); } });
registerStep({ use: 'test.fatal-fail', run: async () => { throw new Error('boom-fatal'); } });

const base = { module: 'veille', label: 'test', trigger: { kind: 'manual' }, version: 1, enabled: true };
registerWorkflow({ ...base, id: 'test.happy', steps: [{ use: 'test.echo', with: { hello: 'world' } }] });
registerWorkflow({ ...base, id: 'test.degrades', steps: [{ use: 'test.degradable-fail' }, { use: 'test.echo' }] });
registerWorkflow({ ...base, id: 'test.fails', steps: [{ use: 'test.fatal-fail' }, { use: 'test.echo' }] });
registerWorkflow({ ...base, id: 'test.unknownstep', steps: [{ use: 'does.not.exist' }] });

const cfg = {};

console.log('happy path:');
const happy = await runWorkflowById('test.happy', { config: cfg, trigger: 'manual' });
assert(happy.status === 'success', 'run succeeds');
assert(happy.trace.length === 1 && happy.trace[0].status === 'ok', 'step traced as ok');
assert(typeof happy.id === 'number', 'run id assigned');
const persisted = getWorkflowRun(happy.id);
assert(persisted && persisted.status === 'success', 'run persisted to workflow_runs');
assert(JSON.parse(persisted.trace)[0].step === 'test.echo', 'trace persisted as JSON');

console.log('graceful degradation:');
const degr = await runWorkflowById('test.degrades', { config: cfg });
assert(degr.status === 'success', 'degradable failure does not fail the run');
assert(degr.trace[0].status === 'skipped', 'failed degradable step marked skipped');
assert(degr.trace[1].status === 'ok', 'subsequent step still runs');

console.log('fatal failure:');
const fail = await runWorkflowById('test.fails', { config: cfg });
assert(fail.status === 'error', 'fatal step errors the run');
assert(fail.error === 'boom-fatal', 'error message captured');
assert(fail.trace.length === 1, 'run aborts after fatal step');

console.log('unknown step:');
const unk = await runWorkflowById('test.unknownstep', { config: cfg });
assert(unk.status === 'error' && /Unknown step/.test(unk.error), 'unknown step errors the run');

console.log('concurrency + listing:');
const all = listWorkflowRuns(50);
assert(all.length === 4, `all four runs listed (got ${all.length})`);

resetRegistry();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
