// Integration test for urgent mention alerts vs VEILLE_DIGEST_MODE: throwaway
// SQLite DB, mocked fetch (no network).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-alert-test-')), 'test.db');
// Isolate from the caller's environment: only DB settings drive these tests.
for (const k of ['VEILLE_DIGEST_MODE', 'VEILLE_DISCORD_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL']) delete process.env[k];

const { getDb } = await import('../dist/db.js');
const { setSetting, deleteSetting } = await import('../dist/settings-service.js');
const { sendPendingAlerts } = await import('../dist/alert-service.js');

const VEILLE = 'https://discord.com/api/webhooks/42/veille';
const PRODUCT = 'https://discord.com/api/webhooks/7/product';
const GLOBAL = 'https://discord.com/api/webhooks/8/global';
const PRODUCT_ID = 'acme';
const ITEM_ID = 'item-1';

const posts = [];
globalThis.fetch = async (url, init) => {
  posts.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(null, { status: 204 });
};

function alertedAt() {
  return getDb().prepare('SELECT alerted_at FROM tweets WHERE id = ?').get(ITEM_ID).alerted_at;
}

const db = getDb();
db.prepare(
  `INSERT INTO products (id, name, created_at, x_enabled, discord_webhook, alert_enabled, alert_threshold)
   VALUES (?, ?, ?, 0, ?, 1, 80)`,
).run(PRODUCT_ID, 'Acme Pro', Date.now(), PRODUCT);
db.prepare(
  `INSERT INTO tweets (id, text, created_at, collection_date, product_id, source, author, url,
     triage_category, triage_urgency, triaged_at)
   VALUES (?, 'Urgent: votre app est en panne', datetime('now'), '2026-09-27', ?, 'reddit', 'jdoe',
     'https://reddit.com/r/x/1', 'bug', 92, ?)`,
).run(ITEM_ID, PRODUCT_ID, Date.now());

beforeEach(() => {
  posts.length = 0;
  db.prepare('UPDATE tweets SET alerted_at = NULL').run();
  for (const k of ['VEILLE_DIGEST_MODE', 'VEILLE_DISCORD_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL']) deleteSetting(k);
});

test('per-product mode: product webhook, embed unchanged', async () => {
  setSetting('VEILLE_DISCORD_WEBHOOK_URL', VEILLE);
  const res = await sendPendingAlerts({}, PRODUCT_ID);
  assert.equal(res.alerted, 1);
  assert.equal(res.channel, 'product');
  assert.equal(res.skipped, undefined);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, PRODUCT);
  const [embed] = posts[0].body.embeds;
  assert.equal(embed.title, '🚨 Mention urgente (92/100)');
  assert.equal(
    embed.description,
    '**Source :** Reddit — @jdoe\n**Categorie :** bug\n\nUrgent: votre app est en panne\n\n[Voir le post](https://reddit.com/r/x/1)',
  );
  assert.equal(embed.url, 'https://reddit.com/r/x/1');
  assert.equal(embed.color, 0xed4245);
  assert.ok(alertedAt() !== null);
});

test('consolidated mode: veille webhook (not product/global), product name in the message', async () => {
  setSetting('VEILLE_DIGEST_MODE', 'consolidated');
  setSetting('VEILLE_DISCORD_WEBHOOK_URL', VEILLE);
  setSetting('DISCORD_WEBHOOK_URL', GLOBAL);
  const res = await sendPendingAlerts({ DISCORD_WEBHOOK_URL: GLOBAL }, PRODUCT_ID);
  assert.equal(res.alerted, 1);
  assert.equal(res.channel, 'consolidated');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, VEILLE);
  const [embed] = posts[0].body.embeds;
  assert.equal(embed.title, '🚨 Mention urgente — Acme Pro (92/100)');
  assert.ok(embed.description.startsWith('**Produit :** Acme Pro\n**Source :** Reddit'));
  assert.ok(alertedAt() !== null);
});

test('consolidated mode without veille webhook: skipped, no fetch, alerted_at stays NULL', async () => {
  setSetting('VEILLE_DIGEST_MODE', 'consolidated');
  setSetting('DISCORD_WEBHOOK_URL', GLOBAL); // must NOT be used as a fallback
  const res = await sendPendingAlerts({ DISCORD_WEBHOOK_URL: GLOBAL }, PRODUCT_ID);
  assert.deepEqual(res, { alerted: 0, channel: 'consolidated', skipped: 'no_webhook' });
  assert.equal(posts.length, 0);
  assert.equal(alertedAt(), null);
});

test('mode is read at call time (no restart)', async () => {
  setSetting('VEILLE_DISCORD_WEBHOOK_URL', VEILLE);
  setSetting('VEILLE_DIGEST_MODE', 'consolidated');
  assert.equal((await sendPendingAlerts({}, PRODUCT_ID)).channel, 'consolidated');
  assert.equal(posts.at(-1).url, VEILLE);

  db.prepare('UPDATE tweets SET alerted_at = NULL').run();
  setSetting('VEILLE_DIGEST_MODE', 'per-product');
  assert.equal((await sendPendingAlerts({}, PRODUCT_ID)).channel, 'product');
  assert.equal(posts.at(-1).url, PRODUCT);
  assert.equal(posts.length, 2);
});
