// Unit tests for the veille delivery resolver (runs against dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveVeilleDelivery } = await import('../dist/modules/veille/delivery.js');

const VEILLE = 'https://discord.com/api/webhooks/1/veille';
const VEILLE_DB = 'https://discord.com/api/webhooks/2/veille-db';
const GLOBAL = 'https://discord.com/api/webhooks/3/global';

test('defaults: per-product, no webhook', () => {
  const d = resolveVeilleDelivery({}, {});
  assert.equal(d.mode, 'per-product');
  assert.equal(d.webhookUrl, undefined);
  assert.equal(d.webhookSource, 'none');
  assert.deepEqual(d.warnings, []);
});

test('env sets the mode and veille webhook', () => {
  const d = resolveVeilleDelivery(
    { VEILLE_DIGEST_MODE: 'consolidated', VEILLE_DISCORD_WEBHOOK_URL: VEILLE },
    {},
  );
  assert.equal(d.mode, 'consolidated');
  assert.equal(d.webhookUrl, VEILLE);
  assert.equal(d.webhookSource, 'VEILLE_DISCORD_WEBHOOK_URL');
});

test('DB settings override env', () => {
  const d = resolveVeilleDelivery(
    { VEILLE_DIGEST_MODE: 'consolidated', VEILLE_DISCORD_WEBHOOK_URL: VEILLE },
    { VEILLE_DIGEST_MODE: 'per-product', VEILLE_DISCORD_WEBHOOK_URL: VEILLE_DB },
  );
  assert.equal(d.mode, 'per-product');
  assert.equal(d.webhookUrl, VEILLE_DB);
});

test('empty DB value does not override env', () => {
  const d = resolveVeilleDelivery({ VEILLE_DIGEST_MODE: 'consolidated' }, { VEILLE_DIGEST_MODE: '  ' });
  assert.equal(d.mode, 'consolidated');
});

test('fallback order: veille webhook → global DISCORD_WEBHOOK_URL → none', () => {
  assert.equal(
    resolveVeilleDelivery({ DISCORD_WEBHOOK_URL: GLOBAL }, { VEILLE_DISCORD_WEBHOOK_URL: VEILLE_DB }).webhookUrl,
    VEILLE_DB,
  );
  const g = resolveVeilleDelivery({}, { DISCORD_WEBHOOK_URL: GLOBAL });
  assert.equal(g.webhookUrl, GLOBAL);
  assert.equal(g.webhookSource, 'DISCORD_WEBHOOK_URL');
  // Env global also counts.
  assert.equal(resolveVeilleDelivery({ DISCORD_WEBHOOK_URL: GLOBAL }, {}).webhookSource, 'DISCORD_WEBHOOK_URL');
  assert.equal(resolveVeilleDelivery({}, {}).webhookSource, 'none');
});

test('invalid mode falls back to env, then default, with a warning', () => {
  const fromEnv = resolveVeilleDelivery({ VEILLE_DIGEST_MODE: 'consolidated' }, { VEILLE_DIGEST_MODE: 'weekly' });
  assert.equal(fromEnv.mode, 'consolidated');
  assert.equal(fromEnv.warnings.length, 1);
  const def = resolveVeilleDelivery({ VEILLE_DIGEST_MODE: 'CONSOLIDATED' }, {});
  assert.equal(def.mode, 'per-product');
  assert.equal(def.warnings.length, 1);
});

test('invalid (non-Discord) webhook is ignored, falls through, never leaks the URL', () => {
  const secret = 'https://evil.example.com/hook-secret-token';
  const d = resolveVeilleDelivery(
    { DISCORD_WEBHOOK_URL: GLOBAL },
    { VEILLE_DISCORD_WEBHOOK_URL: secret },
  );
  assert.equal(d.webhookUrl, GLOBAL);
  assert.equal(d.warnings.length, 1);
  assert.ok(!d.warnings.join(' ').includes('secret-token'));
});
