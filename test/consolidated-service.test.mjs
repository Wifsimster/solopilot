// Integration test for the consolidated digest service: throwaway SQLite DB,
// mocked fetch (no network), no AI (products have no collectable sources).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-test-')), 'test.db');
const WEBHOOK = 'https://discord.com/api/webhooks/42/veille';
// Isolate from the caller's environment: only DB settings drive these tests.
for (const k of ['VEILLE_DIGEST_MODE', 'VEILLE_DISCORD_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL']) delete process.env[k];

const { getDb } = await import('../dist/db.js');
const { setSetting, deleteSetting } = await import('../dist/settings-service.js');
const { runConsolidatedDigest, listDigestDeliveries } = await import(
  '../dist/modules/veille/consolidated-service.js'
);

const posts = [];
globalThis.fetch = async (url, init) => {
  posts.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(null, { status: 204 });
};

before(() => {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO products (id, name, created_at, x_enabled, publish_cron) VALUES (?, ?, ?, 0, ?)`,
  );
  insert.run('alpha', 'Alpha', Date.now(), null);
  insert.run('beta', 'Beta', Date.now() + 1, '0 9 * * 1'); // own schedule, not re-published
  db.prepare(
    `INSERT INTO runs (started_at, status, trigger_type, product_id, summary)
     VALUES (datetime('now'), 'success', 'cron', 'alpha', ?)`,
  ).run('**REDDIT**\n- [Sujet A](https://reddit.com/a)\n- [Sujet B](https://reddit.com/b)');
  // Yesterday's digest for beta must NOT be reused today.
  db.prepare(
    `INSERT INTO runs (started_at, status, trigger_type, product_id, summary)
     VALUES (datetime('now', '-2 days'), 'success', 'cron', 'beta', '- [Vieux](https://ex.com/old)')`,
  ).run();
});

test('per-product mode (default): no-op, nothing sent', async () => {
  const res = await runConsolidatedDigest({}, 'manual');
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'mode');
  assert.equal(posts.length, 0);
});

test('consolidated mode without any webhook: skipped + recorded', async () => {
  setSetting('VEILLE_DIGEST_MODE', 'consolidated');
  const res = await runConsolidatedDigest({}, 'manual');
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'no_webhook');
  assert.equal(posts.length, 0);
  assert.equal(listDigestDeliveries(1)[0].status, 'skipped');
});

test('consolidated mode: one message, a section per product, recorded as sent', async () => {
  setSetting('VEILLE_DISCORD_WEBHOOK_URL', WEBHOOK);
  const res = await runConsolidatedDigest({}, 'manual');
  assert.equal(res.status, 'sent');
  assert.equal(posts.length, 1, 'exactly one Discord POST');
  assert.equal(posts[0].url, WEBHOOK);
  const byTitle = Object.fromEntries(posts[0].body.embeds.map((e) => [e.title, e.description]));
  assert.match(byTitle.Alpha, /Sujet A/);
  assert.equal(byTitle.Beta, 'Rien de notable');
  assert.equal(posts[0].body.embeds.length, 3, 'default + alpha + beta sections');
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });

  const [delivery] = listDigestDeliveries(1);
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.messages_sent, 1);
  assert.equal(delivery.products_with_items, 1);
  assert.equal(delivery.webhook_source, 'VEILLE_DISCORD_WEBHOOK_URL');

  // Global-schedule products were published in the same run; beta (own cron) was not.
  const runs = getDb()
    .prepare(`SELECT product_id FROM runs WHERE started_at >= datetime('now', '-1 minute') AND summary IS NULL`)
    .all()
    .map((r) => r.product_id);
  assert.ok(runs.includes('alpha') && !runs.includes('beta'));
  deleteSetting('VEILLE_DISCORD_WEBHOOK_URL');
});
