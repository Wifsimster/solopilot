// Smoke test for the workflow engine runtime (engine + runner + run-store).
// Runs against a throwaway DB; no network, no prod data. Exits non-zero on failure.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-')), 'smoke.db');

const { registerStep, registerWorkflow, resetRegistry, getStep, listWorkflows } = await import('../dist/workflow/registry.js');
const { runWorkflowById } = await import('../dist/workflow/runner.js');
const { getWorkflowRun, listWorkflowRuns } = await import('../dist/workflow/run-store.js');
const { registerSolopilot } = await import('../dist/workflow/bootstrap.js');
const { buildBriefing, renderBriefingText } = await import('../dist/modules/cockpit/briefing.js');
const facturation = await import('../dist/modules/facturation/store.js');
const { draftRelance } = await import('../dist/modules/facturation/relance.js');

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

console.log('bootstrap (real steps + veille workflows):');
resetRegistry();
registerSolopilot();
for (const use of ['fetch.sources', 'persist', 'ai.summarize', 'notify.discord', 'cockpit.aggregate', 'facturation.relance', 'facturation.sync']) {
  assert(getStep(use) !== undefined, `step registered: ${use}`);
}
const registered = listWorkflows();
const veille = registered.filter((w) => w.module === 'veille');
assert(veille.length === 3, `three veille workflows registered (got ${veille.length})`);
assert(registered.some((w) => w.id === 'cockpit.daily-briefing'), 'cockpit.daily-briefing registered');
assert(registered.filter((w) => w.module === 'facturation').length === 2, 'two facturation workflows registered');
assert(registered.every((w) => !w.enabled), 'every workflow ships disabled (no prod impact)');
const unresolved = registered.flatMap((w) => w.steps).filter((s) => getStep(s.use) === undefined);
assert(unresolved.length === 0, `every step resolves (unresolved: ${unresolved.map((s) => s.use).join(',') || 'none'})`);

console.log('facturation ledger:');
const inv = facturation.createInvoice('default', { client_name: 'Acme SARL', amount_cents: 120000, due_on: '2020-01-01', status: 'sent' });
assert(/^F-\d{4}-\d{3}$/.test(inv.number), `invoice number generated (${inv.number})`);
assert(facturation.listInvoices('default').length === 1, 'invoice listed');
const overdue = facturation.listOverdueInvoices('default', '2026-06-08');
assert(overdue.length === 1, 'overdue invoice detected');
const draft = draftRelance(overdue[0], '2026-06-08');
assert(draft.body.includes('Acme SARL') && draft.body.includes(inv.number), 'relance draft mentions client and number');
const summary = facturation.facturationSummary('default', '2026-06-08');
assert(summary.overdue === 1 && summary.overdueAmountCents === 120000, 'facturation summary aggregates overdue');
assert(facturation.markInvoicePaid(inv.id) === true, 'invoice marked paid');
assert(facturation.listOverdueInvoices('default', '2026-06-08').length === 0, 'paid invoice no longer overdue');

console.log('facturation.sync-stripe (no key → graceful skip):');
const syncRun = await runWorkflowById('facturation.sync-stripe', { config: cfg, trigger: 'manual' });
assert(syncRun.status === 'success', 'sync run succeeds without Stripe configured');
assert(syncRun.trace[0].status === 'ok', 'sync step is a graceful no-op when Stripe absent');

console.log('cockpit briefing:');
const brief = buildBriefing('default');
assert(brief.veille.status === 'live' && brief.facturation.status === 'live', 'briefing reports facturation live');
assert(brief.facturation.unpaid === 0, 'briefing reflects ledger state (paid invoice)');
const text = renderBriefingText(brief);
assert(text.includes('BRIEF DU JOUR') && text.includes('FACTURATION'), 'briefing renders facturation section');

resetRegistry();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
