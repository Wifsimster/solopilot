// Scoped API tokens + ledger idempotency (ADR-0029). Throwaway SQLite DB, the
// real Hono app via createApp() + app.request(): no port, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-tokens-test-')), 'test.db');
process.env.ADMIN_PASSWORD = 'test-admin-password';

const { getDb } = await import('../dist/db.js');
const { createApp } = await import('../dist/server.js');
const tokens = await import('../dist/api-tokens.js');

const db = getDb();
const insertProduct = db.prepare(
  `INSERT INTO products (id, name, created_at, x_enabled) VALUES (?, ?, ?, 0)`,
);
insertProduct.run('toko', 'Toko', 1);
insertProduct.run('autre', 'Autre', 2);

const app = createApp(null, [], '30 7 * * *');

const ADMIN = { Authorization: `Basic ${Buffer.from('admin:test-admin-password').toString('base64')}` };
const bearer = (secret) => ({ Authorization: `Bearer ${secret}` });
const json = (headers, body) => ({
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function createToken(body) {
  const res = await app.request('/api/tokens', json(ADMIN, body));
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}

beforeEach(() => tokens.resetAuthRateLimit());

const GG1 = {
  kind: 'recette',
  amount_cents: 24,
  label: 'Google Play — versement',
  occurred_on: '2026-06-15',
  external_ref: 'GG104F32CP',
  source: 'agent:budget',
};

// --- Hashing & storage ---

test('token secret format and SHA-256 hashing', () => {
  const secret = tokens.generateTokenSecret();
  assert.match(secret, /^sp_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tokens.generateTokenSecret(), secret);
  assert.match(tokens.hashToken(secret), /^[0-9a-f]{64}$/);
  assert.equal(tokens.hashToken(secret), tokens.hashToken(secret));
});

test('only the hash is stored; the secret is returned once and never listed', async () => {
  const { token, secret } = await createToken({ name: 'budget', scopes: ['comptabilite:read'] });
  assert.match(secret, /^sp_/);
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(token.id);
  assert.equal(row.token_hash, tokens.hashToken(secret));
  assert.ok(!JSON.stringify(row).includes(secret.slice(3)), 'secret must not be stored');
  assert.equal(row.token_prefix, secret.slice(0, 7));

  const list = await (await app.request('/api/tokens', { headers: ADMIN })).json();
  const text = JSON.stringify(list);
  assert.ok(!text.includes(secret.slice(3)));
  assert.ok(!text.includes(row.token_hash));
  assert.ok(list.scopes.some((s) => s.id === 'comptabilite:write'));
});

test('token creation validates scopes and products, admin only', async () => {
  let res = await app.request('/api/tokens', json(ADMIN, { name: 'x', scopes: ['admin:all'] }));
  assert.equal(res.status, 400);
  res = await app.request('/api/tokens', json(ADMIN, { name: 'x', scopes: [] }));
  assert.equal(res.status, 400);
  res = await app.request(
    '/api/tokens',
    json(ADMIN, { name: 'x', scopes: ['comptabilite:read'], productIds: ['nope'] }),
  );
  assert.equal(res.status, 400);
  res = await app.request('/api/tokens', json({}, { name: 'x', scopes: ['comptabilite:read'] }));
  assert.equal(res.status, 401);
});

// --- Scopes: allowed / denied routes ---

test('write token restricted to toko: allowed route works, everything else is 403', async () => {
  const { token, secret } = await createToken({
    name: 'budget-agent',
    scopes: ['comptabilite:write', 'comptabilite:read'],
    productIds: ['toko'],
  });
  const h = bearer(secret);

  let res = await app.request('/api/comptabilite/ledger?productId=toko', json(h, GG1));
  assert.equal(res.status, 201);
  const entry = await res.json();
  assert.equal(entry.product_id, 'toko');
  assert.equal(entry.external_ref, 'GG104F32CP');
  assert.equal(entry.source, 'agent:budget');
  assert.equal(entry.api_token_id, token.id);

  res = await app.request('/api/comptabilite/ledger?productId=toko', { headers: h });
  assert.equal(res.status, 200);
  res = await app.request('/api/comptabilite?productId=toko', { headers: h });
  assert.equal(res.status, 200);

  // Other product, including the implicit default product → 403.
  res = await app.request('/api/comptabilite/ledger?productId=autre', json(h, { ...GG1, external_ref: 'Z1' }));
  assert.equal(res.status, 403);
  res = await app.request('/api/comptabilite/ledger', { headers: h });
  assert.equal(res.status, 403);
  res = await app.request('/api/comptabilite/ledger?activity=autre', { headers: h });
  assert.equal(res.status, 403);

  // Default deny: routes outside the token's scopes.
  for (const [method, url] of [
    ['GET', '/api/tokens'],
    ['POST', '/api/tokens'],
    ['DELETE', `/api/tokens/${token.id}`],
    ['GET', '/api/tokens/audit'],
    ['POST', '/api/comptabilite/config?productId=toko'],
    ['GET', '/api/facturation/invoices?productId=toko'],
    ['GET', '/api/products'],
    ['GET', '/api/products/toko'],
    ['GET', '/api/settings'],
    ['GET', '/api/config'],
    ['GET', '/api/comptabilite/ledger/?productId=toko'],
    ['HEAD', '/api/comptabilite/ledger?productId=toko'],
    ['GET', '/'],
    ['GET', '/healthz'],
  ]) {
    const r = await app.request(url, { method, headers: { ...h, 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 403, `${method} ${url} must be 403, got ${r.status}`);
  }
});

test('read-only token cannot write', async () => {
  const { secret } = await createToken({ name: 'ro', scopes: ['comptabilite:read'] });
  const res = await app.request(
    '/api/comptabilite/ledger?productId=toko',
    json(bearer(secret), { ...GG1, external_ref: 'RO-1' }),
  );
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /comptabilite:write/);
});

test('products:read returns a minimal projection filtered by product restriction', async () => {
  const { secret } = await createToken({
    name: 'p',
    scopes: ['products:read'],
    productIds: ['toko'],
  });
  const res = await app.request('/api/products', { headers: bearer(secret) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ id: 'toko', name: 'Toko', archived: false }]);

  const { secret: all } = await createToken({ name: 'p-all', scopes: ['products:read'] });
  const ids = (await (await app.request('/api/products', { headers: bearer(all) })).json()).map((p) => p.id);
  assert.ok(ids.includes('toko') && ids.includes('autre') && ids.includes('default'));
});

test('X-Api-Token header is accepted (Authorization left to a forward-auth proxy)', async () => {
  const { secret } = await createToken({ name: 'hdr', scopes: ['comptabilite:read'] });
  const res = await app.request('/api/comptabilite/ledger?productId=toko', {
    headers: { 'X-Api-Token': secret, Authorization: 'Basic dGlueTphdXRo' },
  });
  assert.equal(res.status, 200);
});

test('admin Basic auth still reaches everything; no auth is still 401', async () => {
  assert.equal((await app.request('/api/comptabilite/ledger?productId=toko', { headers: ADMIN })).status, 200);
  assert.equal((await app.request('/api/comptabilite/ledger?productId=toko')).status, 401);
  // A non-sp_ bearer is not a token: Basic auth applies and rejects it.
  assert.equal(
    (await app.request('/api/comptabilite/ledger', { headers: { Authorization: 'Bearer abc' } })).status,
    401,
  );
});

// --- Invalid, revoked, rate limit ---

test('unknown and malformed tokens are 401', async () => {
  const fake = tokens.generateTokenSecret();
  assert.equal((await app.request('/api/comptabilite', { headers: bearer(fake) })).status, 401);
  assert.equal((await app.request('/api/comptabilite', { headers: bearer('sp_short') })).status, 401);
});

test('revoked token is rejected and cannot be revoked twice', async () => {
  const { token, secret } = await createToken({ name: 'rev', scopes: ['comptabilite:read'] });
  assert.equal((await app.request('/api/comptabilite?productId=toko', { headers: bearer(secret) })).status, 200);
  let res = await app.request(`/api/tokens/${token.id}`, { method: 'DELETE', headers: ADMIN });
  assert.equal(res.status, 200);
  res = await app.request(`/api/tokens/${token.id}`, { method: 'DELETE', headers: ADMIN });
  assert.equal(res.status, 404);
  assert.equal((await app.request('/api/comptabilite?productId=toko', { headers: bearer(secret) })).status, 401);
  const list = await (await app.request('/api/tokens', { headers: ADMIN })).json();
  assert.ok(list.tokens.find((t) => t.id === token.id).revokedAt > 0);
});

test('repeated failures lock the client out (429), even with a valid token', async () => {
  const { secret } = await createToken({ name: 'rl', scopes: ['comptabilite:read'] });
  for (let i = 0; i < tokens.AUTH_FAILURE_LIMIT; i++) {
    const r = await app.request('/api/comptabilite', { headers: bearer(tokens.generateTokenSecret()) });
    assert.equal(r.status, 401);
  }
  const locked = await app.request('/api/comptabilite?productId=toko', { headers: bearer(secret) });
  assert.equal(locked.status, 429);
  assert.ok(locked.headers.get('retry-after'));
  // Admin Basic auth is not affected by the token lockout.
  assert.equal((await app.request('/api/comptabilite?productId=toko', { headers: ADMIN })).status, 200);
  tokens.resetAuthRateLimit();
  assert.equal((await app.request('/api/comptabilite?productId=toko', { headers: bearer(secret) })).status, 200);
});

test('audit log records who/what/when without bodies; last_used_at is updated', async () => {
  const { token, secret } = await createToken({
    name: 'audit',
    scopes: ['comptabilite:write'],
    productIds: ['toko'],
  });
  assert.equal(token.lastUsedAt, null);
  await app.request(
    '/api/comptabilite/ledger?productId=toko',
    json(bearer(secret), { ...GG1, external_ref: 'AUDIT-1', label: 'secret-label-xyz' }),
  );
  await app.request('/api/settings', { headers: bearer(secret) });
  const res = await app.request(`/api/tokens/audit?tokenId=${token.id}`, { headers: ADMIN });
  const audit = await res.json();
  assert.equal(audit.length, 2);
  assert.deepEqual(
    audit.map((a) => [a.method, a.path, a.status, a.outcome]).toSorted(),
    [
      ['GET', '/api/settings', 403, 'denied_route'],
      ['POST', '/api/comptabilite/ledger', 201, 'allowed'],
    ],
  );
  assert.equal(audit.find((a) => a.outcome === 'allowed').product_id, 'toko');
  const all = JSON.stringify(db.prepare('SELECT * FROM api_token_audit').all());
  assert.ok(!all.includes('secret-label-xyz'), 'bodies must not be audited');
  const row = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(token.id);
  assert.ok(row.last_used_at > 0);
});

// --- Ledger idempotency ---

test('same (product, external_ref) → 409 with the existing entry, nothing written', async () => {
  const body = { ...GG1, external_ref: 'GG104IQZ35', amount_cents: 356, occurred_on: '2026-09-15' };
  const first = await app.request('/api/comptabilite/ledger?productId=toko', json(ADMIN, body));
  assert.equal(first.status, 201);
  const created = await first.json();
  const before = db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n;

  const again = await app.request('/api/comptabilite/ledger?productId=toko', json(ADMIN, { ...body, amount_cents: 999 }));
  assert.equal(again.status, 409);
  const payload = await again.json();
  assert.equal(payload.entry.id, created.id);
  assert.equal(payload.entry.amount_cents, 356);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n, before);

  // Same reference on another product is a different entry.
  const other = await app.request('/api/comptabilite/ledger?productId=autre', json(ADMIN, body));
  assert.equal(other.status, 201);
  // No external_ref: no idempotency, duplicates allowed as before.
  const { external_ref: _omit, ...noRef } = body;
  assert.equal((await app.request('/api/comptabilite/ledger?productId=toko', json(ADMIN, noRef))).status, 201);
  assert.equal((await app.request('/api/comptabilite/ledger?productId=toko', json(ADMIN, noRef))).status, 201);
});

test('ledger: unknown product is 404, bad source/since are 400, since filters', async () => {
  let res = await app.request('/api/comptabilite/ledger?productId=inconnu', json(ADMIN, { ...GG1, external_ref: 'U1' }));
  assert.equal(res.status, 404);
  res = await app.request('/api/comptabilite/ledger?productId=toko', json(ADMIN, { ...GG1, external_ref: 'U2', source: 'Agent Budget!' }));
  assert.equal(res.status, 400);
  res = await app.request('/api/comptabilite/ledger?productId=toko&since=15/09/2026', { headers: ADMIN });
  assert.equal(res.status, 400);
  res = await app.request('/api/comptabilite/ledger?productId=toko&since=2026-09-01', { headers: ADMIN });
  const rows = await res.json();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.occurred_on >= '2026-09-01'));
});

// --- Full-access scope `*` (decision of 2026-10-10) ---

test('full-access scope: alone, every product; combinations are 400', async () => {
  let res = await app.request('/api/tokens', json(ADMIN, { name: 'x', scopes: ['*', 'comptabilite:read'] }));
  assert.equal(res.status, 400);
  res = await app.request('/api/tokens', json(ADMIN, { name: 'x', scopes: ['*'], productIds: ['toko'] }));
  assert.equal(res.status, 400);
  const list = await (await app.request('/api/tokens', { headers: ADMIN })).json();
  assert.equal(list.scopes[0].id, '*');
  assert.match(list.scopes[0].label, /Accès complet/);
});

test('full-access token reaches every route, method and product like the admin', async () => {
  const { token, secret } = await createToken({ name: 'openclaw', scopes: ['*'] });
  assert.deepEqual(token.scopes, ['*']);
  assert.equal(token.productIds, null);
  const h = bearer(secret);

  const cases = [
    ['GET', '/api/settings'],
    ['GET', '/api/config'],
    ['GET', '/api/status'],
    ['GET', '/api/cockpit?productId=autre'],
    ['GET', '/api/facturation/invoices?productId=autre'],
    ['GET', '/api/crm/contacts?productId=toko'],
    ['GET', '/api/agenda?productId=autre'],
    ['GET', '/api/workflows'],
    ['GET', '/api/products/toko'],
    ['GET', '/api/comptabilite?productId=autre'],
    ['GET', '/api/comptabilite/ledger'],
    ['GET', '/api/comptabilite/ledger?activity=autre'],
    ['POST', '/api/comptabilite/config?productId=autre', { activityType: 'bnc', declarationPeriod: 'trimestrielle' }],
    ['POST', '/api/crm/contacts?productId=autre', { name: 'Ada' }],
    ['GET', '/api/tokens/audit'],
    ['GET', '/'],
    ['GET', '/healthz'],
  ];
  for (const [method, url, body] of cases) {
    const init = (headers) =>
      body ? json(headers, body) : { method, headers };
    const asToken = await app.request(url, init(h));
    const asAdmin = await app.request(url, init(ADMIN));
    assert.ok(![401, 403].includes(asToken.status), `${method} ${url} must be allowed, got ${asToken.status}`);
    assert.equal(asToken.status, asAdmin.status, `${method} ${url}: token ${asToken.status} vs admin ${asAdmin.status}`);
  }
  assert.equal((await app.request('/api/settings', { headers: h })).status, 200);
  assert.equal((await app.request('/api/config', { headers: h })).status, 200);

  // Ledger write on any product, stamped with the token id.
  const res = await app.request(
    '/api/comptabilite/ledger?productId=autre',
    json(h, { ...GG1, external_ref: 'FULL-1', source: 'agent:openclaw' }),
  );
  assert.equal(res.status, 201);
  assert.equal((await res.json()).api_token_id, token.id);

  // Products: the admin view (all products, full objects), not the projection.
  const products = await (await app.request('/api/products', { headers: h })).json();
  const adminProducts = await (await app.request('/api/products', { headers: ADMIN })).json();
  assert.deepEqual(products, adminProducts);

  // X-Api-Token works too; audit still records every call.
  assert.equal((await app.request('/api/settings', { headers: { 'X-Api-Token': secret } })).status, 200);
  const audit = await (await app.request(`/api/tokens/audit?tokenId=${token.id}&limit=500`, { headers: ADMIN })).json();
  assert.ok(audit.length >= cases.length);
  assert.ok(audit.every((a) => a.outcome === 'allowed'));
  assert.ok(audit.some((a) => a.path === '/api/comptabilite/ledger' && a.product_id === 'autre' && a.status === 201));
});

test('full-access token manages tokens but never reads a secret or hash', async () => {
  const { token: full, secret } = await createToken({ name: 'full-mgmt', scopes: ['*'] });
  const h = bearer(secret);

  const created = await app.request('/api/tokens', json(h, { name: 'child', scopes: ['comptabilite:read'] }));
  assert.equal(created.status, 201);
  const { token: child, secret: childSecret } = await created.json();

  const listRes = await app.request('/api/tokens', { headers: h });
  assert.equal(listRes.status, 200);
  const text = await listRes.text();
  for (const s of [secret, childSecret]) {
    assert.ok(!text.includes(s.slice(3)), 'secrets are never listed');
    assert.ok(!text.includes(tokens.hashToken(s)), 'hashes are never listed');
  }
  const rows = db.prepare('SELECT * FROM api_tokens WHERE id IN (?, ?)').all(full.id, child.id);
  assert.ok(rows.every((r) => !JSON.stringify(r).includes(secret.slice(3)) && !JSON.stringify(r).includes(childSecret.slice(3))));

  // The child stays scoped: no settings.
  assert.equal((await app.request('/api/settings', { headers: bearer(childSecret) })).status, 403);
  assert.equal((await app.request(`/api/tokens/${child.id}`, { method: 'DELETE', headers: h })).status, 200);
  assert.equal((await app.request('/api/comptabilite?productId=toko', { headers: bearer(childSecret) })).status, 401);
});

test('revoked full-access token is 401 everywhere', async () => {
  const { token, secret } = await createToken({ name: 'full-rev', scopes: ['*'] });
  assert.equal((await app.request('/api/settings', { headers: bearer(secret) })).status, 200);
  assert.equal((await app.request(`/api/tokens/${token.id}`, { method: 'DELETE', headers: ADMIN })).status, 200);
  for (const url of ['/api/settings', '/api/products', '/api/tokens', '/api/comptabilite/ledger?productId=toko']) {
    assert.equal((await app.request(url, { headers: bearer(secret) })).status, 401, url);
  }
});
