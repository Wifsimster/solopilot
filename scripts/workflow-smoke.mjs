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
const compta = await import('../dist/modules/comptabilite/compta.js');
const crm = await import('../dist/modules/crm/store.js');
const { draftFollowup } = await import('../dist/modules/crm/followup.js');

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
for (const use of ['fetch.sources', 'persist', 'ai.summarize', 'notify.discord', 'cockpit.aggregate', 'facturation.relance', 'facturation.sync', 'compta.seuils', 'compta.echeance', 'crm.followup']) {
  assert(getStep(use) !== undefined, `step registered: ${use}`);
}
const registered = listWorkflows();
const veille = registered.filter((w) => w.module === 'veille');
assert(veille.length === 3, `three veille workflows registered (got ${veille.length})`);
assert(registered.some((w) => w.id === 'cockpit.daily-briefing'), 'cockpit.daily-briefing registered');
assert(registered.filter((w) => w.module === 'facturation').length === 2, 'two facturation workflows registered');
assert(registered.filter((w) => w.module === 'compta').length === 2, 'two compta workflows registered');
assert(registered.filter((w) => w.module === 'crm').length === 1, 'one crm workflow registered');
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

console.log('comptabilité (CA, seuils, URSSAF):');
// The paid invoice above (1200.00) plus a manual recette (500.00) form the year CA.
compta.addLedgerEntry('default', { kind: 'recette', amount_cents: 50000, label: 'Prestation conseil' });
const cs = compta.comptaStatus('default');
assert(cs.caCents === 170000, `year CA aggregates paid invoice + ledger (got ${cs.caCents})`);
assert(cs.plafondCents === 7770000 && cs.activityType === 'services_bnc', 'default plafond is services BNC');
assert(compta.renderSeuilsAlert(cs) === null, 'no seuils alert below threshold');
const decl = compta.urssafDeclaration('default');
assert(decl.isEstimate === true && /\d/.test(decl.periodLabel), 'urssaf declaration is an estimate with a period');
assert(compta.renderUrssafReminder(decl).includes('URSSAF'), 'urssaf reminder renders');
compta.setComptaConfig('default', { activityType: 'vente' });
assert(compta.comptaStatus('default').plafondCents === 18870000, 'config switches plafond to vente');
compta.setComptaConfig('default', { activityType: 'services_bnc' });

console.log('CRM (contacts, pipeline, stale follow-ups):');
const contact = crm.createContact('default', { name: 'Jane Doe', company: 'Globex' });
assert(crm.listContacts('default').length === 1, 'contact created and listed');
const deal = crm.createDeal('default', { contact_id: contact.id, title: 'Refonte site', stage: 'qualifie', amount_cents: 500000 });
const sum = crm.crmSummary('default');
assert(sum.openDeals === 1 && sum.openValueCents === 500000, 'crm summary counts open deals and value');
assert(crm.listStaleDeals('default', Date.now()).length === 0, 'fresh deal is not stale');
const future = Date.now() + 20 * 86400000;
const stale = crm.listStaleDeals('default', future);
assert(stale.length === 1, 'deal becomes stale after the threshold');
const fdraft = draftFollowup(stale[0]);
assert(fdraft.message.includes('Jane Doe') && fdraft.message.includes('Refonte site'), 'follow-up draft mentions contact and deal');
const inter = crm.addInteraction('default', { contact_id: contact.id, summary: 'Appel de cadrage' });
assert(inter.id !== undefined && crm.getDeal(deal.id).updated_at >= deal.updated_at, 'interaction touches the deal');
assert(crm.updateDealStage(deal.id, 'gagne').stage === 'gagne', 'deal stage moved to gagne');
assert(crm.crmSummary('default').openDeals === 0, 'won deal leaves the open pipeline');

console.log('cockpit briefing:');
const brief = buildBriefing('default');
assert(brief.veille.status === 'live' && brief.facturation.status === 'live', 'briefing reports facturation live');
assert(brief.facturation.unpaid === 0, 'briefing reflects ledger state (paid invoice)');
assert(brief.compta.status === 'live' && brief.compta.caCents === 170000, 'briefing reports compta live with CA');
assert(brief.crm.status === 'live', 'briefing reports crm live');
const text = renderBriefingText(brief);
assert(['BRIEF DU JOUR', 'FACTURATION', 'COMPTABILITÉ', 'CRM'].every((s) => text.includes(s)), 'briefing renders all live sections');

resetRegistry();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
