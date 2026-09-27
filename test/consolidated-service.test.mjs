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

const GLOBAL = 'https://discord.com/api/webhooks/7/global';
const posts = [];
let httpStatus = 204;
globalThis.fetch = async (url, init) => {
  posts.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(httpStatus === 204 ? null : 'boom', { status: httpStatus });
};

/** notification_status / digest_delivery_id of today's publish runs, per product. */
function todaysRuns(productId) {
  return getDb()
    .prepare(
      `SELECT id, notification_status, digest_delivery_id FROM runs
       WHERE product_id = ? AND trigger_type IN ('cron', 'manual')
         AND started_at >= datetime('now', '-1 hour') ORDER BY id`,
    )
    .all(productId);
}

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

test('consolidated mode without VEILLE webhook: skipped, no fallback to DISCORD_WEBHOOK_URL, runs marked skipped', async () => {
  setSetting('VEILLE_DIGEST_MODE', 'consolidated');
  // The global webhook is configured, but must NOT be used.
  setSetting('DISCORD_WEBHOOK_URL', GLOBAL);
  const res = await runConsolidatedDigest({}, 'manual');
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'no_webhook');
  assert.equal(posts.length, 0, 'nothing posted anywhere');
  const [delivery] = listDigestDeliveries(1);
  assert.equal(delivery.status, 'skipped');
  assert.equal(delivery.webhook_source, 'none');
  const alpha = todaysRuns('alpha');
  assert.ok(alpha.length >= 2, 'seeded run + run published by the consolidated digest');
  for (const run of alpha) {
    assert.equal(run.notification_status, 'skipped');
    assert.equal(run.digest_delivery_id, delivery.id);
  }
  deleteSetting('DISCORD_WEBHOOK_URL');
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

  // Outcome written on every participating run of the day (never 'consolidated').
  for (const run of todaysRuns('alpha')) {
    assert.equal(run.notification_status, 'sent');
    assert.equal(run.digest_delivery_id, delivery.id);
  }
  // beta has no run today (only a 2-day-old one): untouched.
  assert.equal(todaysRuns('beta').length, 0);
});

test('consolidated mode, webhook rejects: runs marked failed', async () => {
  httpStatus = 500;
  posts.length = 0;
  const res = await runConsolidatedDigest({}, 'manual');
  assert.equal(res.status, 'failed');
  assert.equal(posts.length, 1);
  const [delivery] = listDigestDeliveries(1);
  assert.equal(delivery.status, 'failed');
  const alpha = todaysRuns('alpha');
  assert.ok(alpha.length >= 3);
  for (const run of alpha) {
    assert.equal(run.notification_status, 'failed');
    assert.equal(run.digest_delivery_id, delivery.id);
  }
  httpStatus = 204;
  deleteSetting('VEILLE_DISCORD_WEBHOOK_URL');
});
