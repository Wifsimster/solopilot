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
      } else if (url.pathname === '/api/redact') {
        res.end(
          JSON.stringify({
            AI_API_KEY: 'k1',
            REDDIT_SESSION: 's1',
            LINKEDIN_COOKIE: 'c1',
            MY_WEBHOOK_URL: 'w1',
            password: 'p1',
            name: 'visible',
            nested: [{ Token: 't1' }],
          }),
        );
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
    env: {
      PATH: process.env.PATH,
      SOLOPILOT_URL: baseUrl,
      SOLOPILOT_TOKEN: 'sp_test_token',
      ...env,
    },
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
  for (const name of ['solopilot_cockpit', 'solopilot_veille_collect', 'solopilot_request']) {
    assert.ok(names.includes(name), name);
  }
  for (const name of [
    'solopilot_veille_trigger',
    'solopilot_invoices_create_draft',
    'solopilot_crm_deals_create',
    'solopilot_crm_deals_update_stage',
    'solopilot_crm_contacts_create',
    'solopilot_agenda_create',
  ]) {
    assert.ok(!names.includes(name), name);
  }
  const writers = list.result.tools.filter((tool) => tool.annotations.readOnlyHint !== true);
  assert.deepEqual(writers.map((tool) => tool.name).sort(), [
    'solopilot_request',
    'solopilot_veille_collect',
  ]);
  const cockpit = list.result.tools.find((tool) => tool.name === 'solopilot_cockpit');
  assert.equal(cockpit.annotations.readOnlyHint, true);
  assert.equal(cockpit.inputSchema.type, 'object');
  const request = list.result.tools.find((tool) => tool.name === 'solopilot_request');
  assert.equal(request.annotations.destructiveHint, false);
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

test('veille collect tool only hits trigger-collect', async () => {
  const server = startServer();
  const result = await server.call('solopilot_veille_collect', { productId: 'toko' });
  assert.equal(result.isError, false);
  const seen = calls.at(-1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/trigger-collect?productId=toko');
  const extra = await server.call('solopilot_veille_collect', { kind: 'publish' });
  assert.equal(extra.isError, true);
  server.close();
});

test('generic request tool forwards GET with query and the collect trigger', async () => {
  const server = startServer();
  const read = await server.call('solopilot_request', {
    method: 'GET',
    path: '/api/crm/deals',
    query: { stage: 'gagne' },
  });
  assert.equal(read.isError, false);
  assert.equal(calls.at(-1).url, '/api/crm/deals?stage=gagne');
  const collect = await server.call('solopilot_request', {
    method: 'POST',
    path: '/api/trigger-collect',
  });
  assert.equal(collect.isError, false);
  assert.equal(calls.at(-1).method, 'POST');
  assert.equal(calls.at(-1).url, '/api/trigger-collect');
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
    ['POST', '/api/settings'],
    ['PUT', '/api/products/x/settings'],
    ['DELETE', '/api/products/x'],
    ['POST', '/api/products/x/settings'],
    ['GET', '/api/discord-webhook'],
    ['GET', '/api/credentials'],
    ['DELETE', '/api/tokens/abc'],
    ['POST', '/api/trigger'],
    ['POST', '/api/TRIGGER/'],
    ['POST', '/api/%74rigger'],
    ['POST', '/api/facturation/invoices'],
    ['POST', '/api/facturation/invoices/i1/paid'],
    ['POST', '/api/facturation/invoices/i1/checkout'],
    ['POST', '/api/facturation/sync'],
    ['POST', '/api/comptabilite/ledger'],
    ['POST', '/api/crm/deals'],
    ['POST', '/api/crm/deals/d1/stage'],
    ['POST', '/api/agenda/events'],
    ['POST', '/api/content-drafts/c1/publish'],
    ['POST', '/api/publish/x'],
    ['POST', '/api/trigger-collect/extra'],
    ['PUT', '/api/trigger-collect'],
    ['GET', '/api/tokens'],
    ['GET', '/api/tokens/audit'],
    ['GET', '/api/settings'],
    ['GET', '/api/config'],
    ['GET', '/api/products/x/settings'],
    ['GET', '/api/publish/connections'],
    ['GET', '/api/content-drafts/c1/publish-jobs'],
    ['GET', '/api//settings'],
    ['GET', '/api//tokens'],
    ['GET', '/api//config'],
    ['GET', '/api//credentials'],
    ['GET', '/api/products/default//settings'],
    ['GET', '/api/%2Fsettings'],
    ['POST', '/api//trigger'],
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

test('redaction hides any key containing a secret-like word', async () => {
  const server = startServer();
  const result = await server.call('solopilot_request', { method: 'GET', path: '/api/redact' });
  const text = result.content[0].text;
  for (const leaked of ['k1', 's1', 'c1', 'w1', 'p1', 't1'])
    assert.doesNotMatch(text, new RegExp(`"${leaked}"`));
  assert.match(text, /visible/);
  server.close();
});

test('JSON-RPC responses from the client get no reply', async () => {
  const server = startServer();
  const lines = [];
  createInterface({ input: server.child.stdout }).on('line', (line) => lines.push(line));
  server.child.stdin.write(
    '{"jsonrpc":"2.0","id":99,"result":{}}\n{"jsonrpc":"2.0","id":100,"error":{"code":-1,"message":"x"}}\n',
  );
  await server.rpc('ping');
  assert.ok(lines.every((line) => ![99, 100].includes(JSON.parse(line).id)));
  server.close();
});
