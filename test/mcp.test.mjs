import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const calls = [];
let fake;
let baseUrl;
let authMode = 'ok';

before(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
      const url = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'application/json');
      if (authMode === 'denied') {
        res.statusCode = 403;
        res.end('{"error":"forbidden"}');
      } else if (authMode === 'unauth') {
        res.statusCode = 401;
        res.end('{"error":"unauthorized"}');
      } else if (url.pathname === '/api/cockpit') {
        res.end(JSON.stringify({ greeting: 'bonjour', secret: 'hunter2' }));
      } else if (url.pathname === '/api/crm/deals' && req.method === 'GET') {
        res.end(JSON.stringify([{ id: 'd1', title: 'Refonte' }]));
      } else if (url.pathname === '/api/facturation/invoices' && req.method === 'POST') {
        res.statusCode = 201;
        res.end(raw);
      } else {
        res.end('{"ok":true}');
      }
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${fake.address().port}`;
});

after(() => fake.close());

function startServer(env = {}) {
  const child = spawn(process.execPath, ['dist/cli.js', 'mcp'], {
    env: { PATH: process.env.PATH, SOLOPILOT_URL: baseUrl, SOLOPILOT_TOKEN: 'sp_test_token', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  return { child, rpc, call, close: () => child.stdin.end() };
}

test('initialize, ping and tools/list', async () => {
  const server = startServer();
  const init = await server.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'solopilot');
  assert.ok(init.result.capabilities.tools);
  assert.deepEqual((await server.rpc('ping')).result, {});
  const list = await server.rpc('tools/list');
  const names = list.result.tools.map((tool) => tool.name);
  for (const name of [
    'solopilot_cockpit',
    'solopilot_veille_trigger',
    'solopilot_invoices_create_draft',
    'solopilot_crm_deals_update_stage',
    'solopilot_request',
  ]) {
    assert.ok(names.includes(name), name);
  }
  const cockpit = list.result.tools.find((tool) => tool.name === 'solopilot_cockpit');
  assert.equal(cockpit.annotations.readOnlyHint, true);
  assert.equal(cockpit.inputSchema.type, 'object');
  const request = list.result.tools.find((tool) => tool.name === 'solopilot_request');
  assert.equal(request.annotations.destructiveHint, true);
  assert.equal((await server.rpc('nope')).error.code, -32601);
  server.close();
});

test('read tool sends the token, scopes the product and redacts secrets', async () => {
  const server = startServer({ SOLOPILOT_PRODUCT_ID: 'toko' });
  const result = await server.call('solopilot_cockpit', {});
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /bonjour/);
  assert.doesNotMatch(result.content[0].text, /hunter2/);
  const seen = calls.at(-1);
  assert.equal(seen.method, 'GET');
  assert.equal(seen.url, '/api/cockpit?productId=toko');
  assert.equal(seen.headers.authorization, 'Bearer sp_test_token');
  const got = await server.call('solopilot_crm_deals_get', { id: 'd1' });
  assert.match(got.content[0].text, /Refonte/);
  const missing = await server.call('solopilot_crm_deals_get', { id: 'zzz' });
  assert.equal(missing.isError, true);
  server.close();
});

test('write tool forces draft status and posts JSON', async () => {
  const server = startServer();
  const result = await server.call('solopilot_invoices_create_draft', {
    client_name: 'ACME',
    amount_cents: 120000,
    due_on: '2026-07-01',
    productId: 'toko',
  });
  assert.equal(result.isError, false);
  const seen = calls.at(-1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/facturation/invoices?productId=toko');
  assert.deepEqual(JSON.parse(seen.body), {
    client_name: 'ACME',
    amount_cents: 120000,
    due_on: '2026-07-01',
    status: 'draft',
  });
  const invalid = await server.call('solopilot_invoices_create_draft', { client_name: 'ACME' });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /amount_cents/);
  server.close();
});

test('generic request tool forwards method, query and body', async () => {
  const server = startServer();
  const result = await server.call('solopilot_request', {
    method: 'POST',
    path: '/api/crm/deals/d1/stage',
    query: { dryRun: true },
    body: { stage: 'gagne' },
  });
  assert.equal(result.isError, false);
  const seen = calls.at(-1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/crm/deals/d1/stage?dryRun=true');
  assert.deepEqual(JSON.parse(seen.body), { stage: 'gagne' });
  server.close();
});

test('paths outside /api/ and credential endpoints are refused without any HTTP call', async () => {
  const server = startServer();
  const before = calls.length;
  for (const [method, path] of [
    ['GET', '/healthz'],
    ['GET', '/api/../etc/passwd'],
    ['GET', '/api/%2e%2e/secret'],
    ['GET', '/api/cockpit?x=1'],
    ['POST', '/api/credentials'],
    ['POST', '/api/discord-webhook'],
    ['POST', '/api/tokens'],
    ['DELETE', '/api/tokens/abc'],
  ]) {
    const result = await server.call('solopilot_request', { method, path });
    assert.equal(result.isError, true, `${method} ${path}`);
    assert.match(result.content[0].text, /^Refused/);
  }
  assert.equal(calls.length, before);
  server.close();
});

test('401 and 403 become isError results and the server keeps running', async () => {
  const server = startServer();
  authMode = 'unauth';
  const unauth = await server.call('solopilot_cockpit', {});
  assert.equal(unauth.isError, true);
  assert.match(unauth.content[0].text, /401.*SOLOPILOT_TOKEN/);
  authMode = 'denied';
  const denied = await server.call('solopilot_comptabilite_summary', {});
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /403.*scope/);
  assert.doesNotMatch(unauth.content[0].text + denied.content[0].text, /sp_test_token/);
  authMode = 'ok';
  assert.equal((await server.call('solopilot_cockpit', {})).isError, false);
  server.close();
});

test('unreachable API yields an isError result, not a crash', async () => {
  const server = startServer({ SOLOPILOT_URL: 'http://127.0.0.1:9' });
  const result = await server.call('solopilot_cockpit', {});
  assert.equal(result.isError, true);
  assert.equal((await server.rpc('ping')).result !== undefined, true);
  server.close();
});
