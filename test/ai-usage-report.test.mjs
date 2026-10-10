// « Dépenses IA » report: Paris-day bucketing across DST (insert path and the
// backfill migration), periods, projection, cache rate and savings, insights,
// API validation and the weekly Discord recap. Throwaway SQLite DB; no network
// call and no AI call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-usage-report-')), 'test.db');
process.env.DB_PATH = dbPath;
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.VEILLE_DISCORD_WEBHOOK_URL;
globalThis.fetch = async (url) => {
  throw new Error(`Unexpected network call in test: ${url}`);
};

// A ledger written before the `day` column existed: the migration must
// backfill the Paris date, DST included (2026-03-29: 02:00 CET -> 03:00 CEST).
const legacy = [
  ['2026-03-28T22:59:00Z', 0.01], // 28 Mar 23:59 CET
  ['2026-03-28T23:00:00Z', 0.02], // 29 Mar 00:00 CET
  ['2026-03-29T21:59:00Z', 0.04], // 29 Mar 23:59 CEST
  ['2026-03-29T22:00:00Z', 0.08], // 30 Mar 00:00 CEST
];
{
  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, month TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0, cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
    stop_reason TEXT, cost_usd REAL NOT NULL DEFAULT 0)`);
  const insert = raw.prepare(
    `INSERT INTO ai_usage (created_at, month, provider, model, task, cost_usd)
     VALUES (?, '2026-03', 'anthropic', 'claude-haiku-5-5', 'veille.digest', ?)`,
  );
  for (const [iso, cost] of legacy) insert.run(Date.parse(iso), cost);
  raw.close();
}

const { getDb } = await import('../dist/db.js');
const usage = await import('../dist/ai/usage.js');
const report = await import('../dist/ai/usage-report.js');
const recap = await import('../dist/ai/usage-recap.js');
const { registerAiUsageReportRoutes } = await import('../dist/ai/usage-report-routes.js');
const { getSetting, setSetting, deleteSetting } = await import('../dist/settings-service.js');
const { Hono } = await import('hono');

const CFG = { ANTHROPIC_API_KEY: 'sk-ant-test', AI_MONTHLY_BUDGET_USD: 200, AI_WEEKLY_RECAP_ENABLED: true };
const WEBHOOK = 'https://discord.com/api/webhooks/1/x';

function record(iso, { task = 'veille.triage', model = 'claude-haiku-5-5', cost = 0.01, input = 1000, output = 100, cw = 0, cr = 0, provider = 'anthropic' } = {}) {
  usage.recordAiUsage(
    {
      provider,
      model,
      task,
      stopReason: 'end_turn',
      costUsd: cost,
      inputTokens: input,
      outputTokens: output,
      cacheCreationInputTokens: cw,
      cacheReadInputTokens: cr,
    },
    Date.parse(iso),
  );
}

// Formatted amounts use no-break spaces (`0,77\u00a0$`); compare with plain spaces.
const plain = (text) => text.replace(/\u00a0/g, ' ');
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('migration: day column backfilled in Paris time across the March DST switch', () => {
  const rows = getDb().prepare("SELECT day, cost_usd FROM ai_usage WHERE month = '2026-03' ORDER BY created_at").all();
  assert.deepEqual(
    rows.map((r) => r.day),
    ['2026-03-28', '2026-03-29', '2026-03-29', '2026-03-30'],
  );
  const idx = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_usage_day'").get();
  assert.ok(idx, 'day index created');
});

test('insert path: Paris day stored, October DST end (25 h day) buckets correctly', () => {
  record('2026-10-24T21:59:00Z', { cost: 0.001 }); // 24 Oct 23:59 CEST
  record('2026-10-24T22:30:00Z', { cost: 0.002 }); // 25 Oct 00:30 CEST
  record('2026-10-25T22:30:00Z', { cost: 0.004 }); // 25 Oct 23:30 CET
  record('2026-10-25T23:30:00Z', { cost: 0.008 }); // 26 Oct 00:30 CET
  const now = Date.parse('2026-10-31T12:00:00Z');
  const r = report.buildUsageReport(CFG, report.resolveUsageRange('month', now), { now });
  const by = Object.fromEntries(r.series.map((p) => [p.bucket, p.costUsd]));
  assert.equal(r.series.length, 31);
  close(by['2026-10-24'], 0.001);
  close(by['2026-10-25'], 0.006);
  close(by['2026-10-26'], 0.008);
  // March report (prev-month seen from April) uses the backfilled days.
  const april = Date.parse('2026-04-02T10:00:00Z');
  const m = report.buildUsageReport(CFG, report.resolveUsageRange('prev-month', april), { now: april });
  const mar = Object.fromEntries(m.series.map((p) => [p.bucket, p.costUsd]));
  close(mar['2026-03-29'], 0.06);
  assert.equal(m.month.month, '2026-03');
  assert.equal(m.month.complete, true);
  close(m.month.projectedUsd, 0.15);
});

test('periods: Paris calendar ranges and their comparison ranges', () => {
  // 10 Oct 2026 00:30 Paris = 9 Oct 22:30 UTC: "today" is the Paris date.
  const now = Date.parse('2026-10-09T22:30:00Z');
  const r7 = report.resolveUsageRange('7d', now);
  assert.deepEqual([r7.from, r7.to, r7.days, r7.bucket], ['2026-10-04', '2026-10-10', 7, 'day']);
  assert.deepEqual([r7.previous.from, r7.previous.to], ['2026-09-27', '2026-10-03']);
  const r30 = report.resolveUsageRange('30d', now);
  assert.deepEqual([r30.from, r30.days], ['2026-09-11', 30]);
  const month = report.resolveUsageRange('month', now);
  assert.deepEqual([month.from, month.to, month.previous.from, month.previous.to], [
    '2026-10-01', '2026-10-10', '2026-09-01', '2026-09-10',
  ]);
  const prev = report.resolveUsageRange('prev-month', now);
  assert.deepEqual([prev.from, prev.to, prev.previous.from, prev.previous.to], [
    '2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31',
  ]);
  const y = report.resolveUsageRange('12m', now);
  assert.deepEqual([y.from, y.to, y.bucket, y.previous.from], ['2025-11-01', '2026-10-10', 'month', '2024-11-01']);
  // 31 March: the previous month has 28/29 days, clamped.
  const endMarch = Date.parse('2027-03-31T10:00:00Z');
  assert.equal(report.resolveUsageRange('month', endMarch).previous.to, '2027-02-28');
  // Weekly recap: Monday 12 Oct 09:00 Paris -> Mon 5 .. Sun 11 Oct.
  const w = report.previousWeekRange(Date.parse('2026-10-12T07:00:00Z'));
  assert.deepEqual([w.from, w.to, w.previous.from], ['2026-10-05', '2026-10-11', '2026-09-28']);
});

test('projection: linear on days elapsed (today included)', () => {
  assert.equal(report.projectMonthEnd(10, 10, 31), 31);
  assert.equal(report.projectMonthEnd(0, 5, 30), 0);
  assert.equal(report.projectMonthEnd(5, 0, 30), 0);
  const daily = new Map([['2026-10-01', 1], ['2026-10-05', 3]]);
  const m = report.buildMonthBlock('2026-10', '2026-10-10', daily, 200);
  assert.equal(m.spentUsd, 4);
  assert.equal(m.daysElapsed, 10);
  close(m.projectedUsd, 12.4);
  assert.equal(m.points[9].cumulativeUsd, 4);
  assert.equal(m.points[10].cumulativeUsd, null);
  close(m.points[30].projectedUsd, 12.4);
  assert.equal(m.points[8].projectedUsd, null);
  assert.equal(m.level, 'ok');
  // Budget states: >= 80 % warning, >= 100 % exceeded (projected too).
  const hot = report.buildMonthBlock('2026-10', '2026-10-10', new Map([['2026-10-02', 70]]), 200);
  assert.equal(hot.level, 'ok');
  assert.equal(hot.projectedLevel, 'exceeded');
  assert.equal(report.buildMonthBlock('2026-10', '2026-10-10', new Map([['2026-10-02', 160]]), 200).level, 'warning');
});

test('cache rate and net cache savings (Haiku 5.5 prices, long-context tier, GitHub Models)', () => {
  assert.equal(report.cacheRate({ inputTokens: 300, cacheWriteTokens: 100, cacheReadTokens: 600, outputTokens: 50 }), 0.6);
  assert.equal(report.cacheRate({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 }), null);
  // 1 MTok read saves 0.10 - 0.01; 1 MTok written costs 0.125 - 0.10 extra.
  close(report.cacheSavingsUsd('anthropic', 'claude-haiku-5-5', { cacheReadTokens: 1e6, cacheWriteTokens: 0 }), 0.09);
  close(report.cacheSavingsUsd('anthropic', 'claude-haiku-5-5', { cacheReadTokens: 0, cacheWriteTokens: 1e6 }), -0.025);
  close(report.cacheSavingsUsd('anthropic', 'claude-haiku-5-5', { cacheReadTokens: 1e6, cacheWriteTokens: 0 }, true), 0.45);
  close(report.cacheSavingsUsd('anthropic', 'claude-sonnet-5-5', { cacheReadTokens: 1e6, cacheWriteTokens: 0 }), 1.9);
  assert.equal(report.cacheSavingsUsd('github-models', 'openai/gpt-4.1', { cacheReadTokens: 1e6, cacheWriteTokens: 0 }), 0);
});

test('report: totals, KPIs, breakdowns, top calls (no content), savings', () => {
  // 2027-02: a month no other test writes to. Now = 10 Feb.
  record('2027-02-02T09:00:00Z', { task: 'veille.triage', cost: 0.30, input: 1000, cr: 3000, cw: 500, output: 200 });
  record('2027-02-03T09:00:00Z', { task: 'veille.triage', cost: 0.30, input: 1000, cr: 3000, output: 200 });
  record('2027-02-04T09:00:00Z', { task: 'veille.digest', cost: 0.20, input: 5000, output: 900 });
  record('2027-02-05T09:00:00Z', { task: 'content.thread', cost: 0.20, model: 'claude-sonnet-5-5', input: 800, output: 400 });
  record('2027-01-05T09:00:00Z', { task: 'veille.triage', cost: 0.50 }); // previous period
  const now = Date.parse('2027-02-10T11:00:00Z');
  const r = report.buildUsageReport(CFG, report.resolveUsageRange('month', now), { now, webhookConfigured: true });

  close(r.totals.costUsd, 1.0);
  assert.equal(r.totals.calls, 4);
  close(r.totals.avgCostPerCall, 0.25);
  close(r.totals.avgCostPerDay, 0.1);
  assert.equal(r.totals.cacheReadTokens, 6000);
  close(r.totals.cacheRate, 6000 / (7800 + 500 + 6000));
  close(r.previous.costUsd, 0.5);
  close(r.deltaRatio, 1);
  close(r.month.spentUsd, 1.0);
  close(r.month.projectedUsd, 2.8);

  assert.deepEqual(r.byClass.map((c) => c.id), ['triage', 'digest', 'studio']);
  close(r.byClass[0].share, 0.6);
  const thread = r.byTask.find((t) => t.task === 'content.thread');
  assert.equal(thread.label, 'Studio : threads');
  assert.equal(thread.classId, 'studio');
  close(thread.costPerCall, 0.2);
  assert.equal(r.byModel[0].model, 'claude-haiku-5-5');
  assert.equal(r.byModel[1].label, 'Claude Sonnet 5.5');
  close(r.byModel[1].callShare, 0.25);

  assert.equal(r.topCalls.length, 4);
  assert.equal(r.topCalls[0].task, 'veille.triage');
  for (const call of r.topCalls) {
    assert.deepEqual(
      Object.keys(call).sort(),
      ['cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'createdAt', 'id', 'inputTokens', 'model', 'modelLabel', 'outputTokens', 'task', 'taskLabel'],
    );
  }
  close(r.cacheSavingsUsd, (6000 * 0.09 - 500 * 0.025) / 1e6);
  assert.equal(r.series.find((p) => p.bucket === '2027-02-02').byClass.triage, 0.3);
  assert.equal(r.classes.length, 7);
  assert.equal(r.recap.webhookConfigured, true);
  assert.equal(JSON.stringify(r).includes('sk-ant-test'), false);

  const texts = r.insights.map((i) => plain(i.text));
  assert.ok(r.insights.length >= 3 && r.insights.length <= 5, texts.join('\n'));
  assert.match(texts[0], /^À ce rythme, fin février 2027 ≈ 2,80 \$ \(1 % du budget de 200,00 \$\), projection linéaire sur 10 jours écoulés\.$/);
  assert.ok(texts.includes('Le tri des mentions représente 60 % des dépenses de la période (0,60 $, 2 appels).'), texts.join('\n'));
  assert.ok(texts.some((t) => /^Dépense en hausse de 100 % vs la même période du mois précédent/.test(t)), texts.join('\n'));
  assert.ok(texts.some((t) => /^Le cache a économisé ~0,00053 \$/.test(t)), texts.join('\n'));
});

test('report: 12 months = monthly buckets; empty period = no insights', () => {
  const now = Date.parse('2027-02-10T11:00:00Z');
  const r = report.buildUsageReport(CFG, report.resolveUsageRange('12m', now), { now });
  assert.equal(r.series.length, 12);
  assert.equal(r.series[0].bucket, '2026-03');
  assert.equal(r.series[11].bucket, '2027-02');
  close(r.series[11].costUsd, 1.0);
  close(r.series[10].costUsd, 0.5);

  const empty = Date.parse('2031-06-15T10:00:00Z');
  const e = report.buildUsageReport(CFG, report.resolveUsageRange('7d', empty), { now: empty });
  assert.equal(e.totals.calls, 0);
  assert.equal(e.totals.cacheRate, null);
  assert.equal(e.totals.avgCostPerCall, null);
  assert.equal(e.hasUsage, true);
  assert.deepEqual(e.insights, []);
});

test('insights: trend down, cache loss, model skew, spike day, GitHub Models (deterministic)', () => {
  const base = {
    range: { bucket: 'day', days: 7, period: '7d', previous: { label: 'les 7 jours précédents' } },
    enforced: true,
    totals: { costUsd: 1, calls: 10, inputTokens: 1000, cacheWriteTokens: 1000, cacheReadTokens: 0, outputTokens: 10, cacheRate: 0, avgCostPerCall: 0.1, avgCostPerDay: 1 / 7 },
    previousCostUsd: 2,
    deltaRatio: -0.5,
    cacheSavingsUsd: -0.01,
    byClass: [{ id: 'digest', label: 'Digest', calls: 2, costUsd: 0.7, share: 0.7 }],
    byModel: [
      { model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', calls: 9, costUsd: 0.2, share: 0.2, callShare: 0.9 },
      { model: 'claude-opus-5-5', label: 'Claude Opus 5.5', calls: 1, costUsd: 0.8, share: 0.8, callShare: 0.1 },
    ],
    series: [{ bucket: '2026-10-01', costUsd: 0.1 }, { bucket: '2026-10-02', costUsd: 0.1 }, { bucket: '2026-10-03', costUsd: 0.8 }],
    month: { complete: false, daysElapsed: 1, daysInMonth: 31, projectedUsd: 250, projectedRatio: 1.25, budgetUsd: 200, label: 'octobre 2026' },
  };
  const a = report.buildInsights(base).map((i) => ({ ...i, text: plain(i.text) }));
  assert.deepEqual(a.map((i) => i.id), ['projection', 'top-class', 'trend', 'cache', 'model-skew']);
  assert.equal(a[0].tone, 'critical');
  assert.match(a[0].text, /1 jour écoulé\.$/);
  assert.equal(a[1].text, 'Le digest de veille représente 70 % des dépenses de la période (0,70 $, 2 appels).');
  assert.equal(a[2].text, 'Dépense en baisse de 50 % vs les 7 jours précédents (1,00 $ contre 2,00 $).');
  assert.equal(a[2].tone, 'good');
  assert.match(a[3].text, /^Le cache a coûté 0,01 \$ de plus qu'il n'a rapporté/);
  assert.equal(a[4].text, 'Claude Opus 5.5 : 10 % des appels mais 80 % du coût.');
  assert.deepEqual(report.buildInsights(base), report.buildInsights(base), 'deterministic');

  const single = report.buildInsights({ ...base, byModel: [base.byModel[0]] });
  assert.equal(plain(single.at(-1).text), 'Pic le 3 oct. : 0,80 $, 2,4× la moyenne quotidienne.');

  const gh = report.buildInsights({ ...base, enforced: false, totals: { ...base.totals, costUsd: 0 } });
  assert.deepEqual(gh.map((i) => i.id), ['top-class']);
  assert.equal(plain(gh[0].text), 'Le digest de veille représente 20 % des appels de la période.');
});

test('API: period validated with zod, default = current month, recap toggle validated', async () => {
  const app = new Hono();
  const now = Date.parse('2027-02-10T11:00:00Z');
  registerAiUsageReportRoutes(app, () => CFG, { now: () => now });

  const bad = await app.request('/api/ai/usage/report?period=year');
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.success, false);
  assert.match(badBody.message, /Période invalide/);

  const def = await app.request('/api/ai/usage/report');
  assert.equal(def.status, 200);
  const body = await def.json();
  assert.equal(body.period, 'month');
  assert.equal(body.range.from, '2027-02-01');
  close(body.totals.costUsd, 1.0);

  for (const period of ['7d', '30d', 'month', 'prev-month', '12m']) {
    const res = await app.request(`/api/ai/usage/report?period=${period}`);
    assert.equal(res.status, 200, period);
  }

  const put = (b) => app.request('/api/ai/usage/recap', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: b });
  assert.equal((await put('{"enabled":"yes"}')).status, 400);
  assert.equal((await put('{"enabled":true,"x":1}')).status, 400);
  assert.equal((await put('not json')).status, 400);
  const off = await put('{"enabled":false}');
  assert.equal(off.status, 200);
  assert.equal(getSetting('AI_WEEKLY_RECAP_ENABLED'), 'false');
  assert.equal((await (await app.request('/api/ai/usage/report')).json()).recap.enabled, false);
  await put('{"enabled":true}');
  assert.equal(getSetting('AI_WEEKLY_RECAP_ENABLED'), 'true');
  deleteSetting('AI_WEEKLY_RECAP_ENABLED');
});

test('weekly recap: embed content, sent once per week, toggle, webhook, provider', async () => {
  // Week Mon 2027-03-08 .. Sun 2027-03-14; previous week has one call.
  record('2027-03-03T10:00:00Z', { task: 'veille.digest', cost: 0.10 });
  record('2027-03-09T10:00:00Z', { task: 'veille.triage', cost: 0.12, input: 500, cr: 1500 });
  record('2027-03-10T10:00:00Z', { task: 'veille.triage', cost: 0.12, input: 500, cr: 1500 });
  record('2027-03-12T10:00:00Z', { task: 'veille.digest', cost: 0.06 });
  const monday = Date.parse('2027-03-15T08:00:00Z'); // 09:00 Paris
  const r = report.buildUsageReport(CFG, report.previousWeekRange(monday), { now: monday });
  const embed = recap.buildWeeklyRecapEmbed(r);
  assert.equal(embed.title, '📊 Dépenses IA — semaine du 8 mars au 14 mars');
  const lines = plain(embed.description).split('\n');
  assert.equal(lines[0], '**Semaine** : 0,30 $ · 3 appels, ▲ 200 % vs semaine précédente');
  assert.match(lines[1], /^\*\*Mars 2027\*\* : 0,40 \$ sur 200,00 \$ \(< 1 % du budget\) · fin de mois ≈ 0,83 \$$/);
  assert.equal(lines[2], '**Coût moyen** : 0,04 $ / jour · 0,10 $ / appel');
  assert.match(lines[3], /^\*\*Cache\*\* : 60 % des tokens d'entrée/);
  assert.match(lines.at(-1), /^💡 Le tri des mentions représente 80 % des dépenses/);
  assert.equal(embed.color, 0x16a34a);

  const sent = [];
  const deps = { now: monday, notify: async (url, e) => { sent.push({ url, e }); return { success: true }; } };
  assert.equal(await recap.sendWeeklyRecap(CFG, deps), 'no_webhook');
  const cfg = { ...CFG, DISCORD_WEBHOOK_URL: WEBHOOK };
  setSetting('AI_WEEKLY_RECAP_ENABLED', 'false');
  assert.equal(await recap.sendWeeklyRecap(cfg, deps), 'disabled');
  deleteSetting('AI_WEEKLY_RECAP_ENABLED');
  assert.equal(await recap.sendWeeklyRecap({ ...cfg, AI_WEEKLY_RECAP_ENABLED: false }, deps), 'disabled');
  assert.equal(await recap.sendWeeklyRecap({ ...cfg, ANTHROPIC_API_KEY: undefined, GITHUB_TOKEN: 'x' }, deps), 'not_anthropic');
  assert.equal(await recap.sendWeeklyRecap(cfg, deps), 'sent');
  assert.equal(await recap.sendWeeklyRecap(cfg, deps), 'already_sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, WEBHOOK);
  assert.equal(getDb().prepare("SELECT status FROM ai_usage_recaps WHERE week = '2027-03-08'").get().status, 'sent');
  // A quiet week sends nothing.
  assert.equal(await recap.sendWeeklyRecap(cfg, { ...deps, now: Date.parse('2031-06-16T07:00:00Z') }), 'no_usage');
  assert.equal(recap.WEEKLY_RECAP_CRON, '0 9 * * 1');
});
