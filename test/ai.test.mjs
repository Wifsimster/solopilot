// AI port (ADR-0027): adapter selection, structured outputs, refusal, error
// mapping + SDK retries, usage ledger, budget guard. Throwaway SQLite DB; the
// Anthropic client is either a fake object or the real SDK on a mocked fetch.
// No network call is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-ai-test-')), 'test.db');
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.VEILLE_DISCORD_WEBHOOK_URL;
globalThis.fetch = async (url) => {
  throw new Error(`Unexpected network call in test: ${url}`);
};

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const { getDb } = await import('../dist/db.js');
const ai = await import('../dist/ai/index.js');
const models = await import('../dist/ai/models.js');
const usage = await import('../dist/ai/usage.js');
const { buildAnthropicParams, mapAnthropicError } = await import('../dist/ai/anthropic-adapter.js');
const { obj, str, int } = await import('../dist/ai/schema.js');

const { createAi, AiError, isAiConfigured, createAnthropicClient } = ai;

const ANTHROPIC = { ANTHROPIC_API_KEY: 'sk-ant-test', AI_MONTHLY_BUDGET_USD: 200, AI_BASE_URL: 'https://ai.test/v1' };
const GITHUB = { GITHUB_TOKEN: 'ghp-test', AI_MONTHLY_BUDGET_USD: 200, AI_BASE_URL: 'https://ai.test/v1' };
const SCHEMA = obj({ label: str({ minLength: 1 }), score: int(0, 100) });
const NOW = Date.UTC(2031, 0, 15, 12); // 2031-01: a month no other test writes to

function message(overrides = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: '{"label":"bug","score":80}' }],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...overrides,
  };
}

function fakeAnthropic(responder) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params, options) {
          calls.push({ params, options });
          return typeof responder === 'function' ? responder(params) : responder;
        },
      },
    },
  };
}

function recorder() {
  const rows = [];
  return { rows, recordUsage: (u) => rows.push(u), afterUsage: () => {}, assertBudget: () => {} };
}

const req = (task, extra = {}) => ({
  task,
  system: 'SYSTEM',
  user: 'USER',
  maxTokens: 500,
  timeoutMs: 1000,
  ...extra,
});

// ---------------------------------------------------------------------------
// Adapter selection + model resolution
// ---------------------------------------------------------------------------

test('provider: AI_PROVIDER wins, else anthropic iff ANTHROPIC_API_KEY', () => {
  assert.equal(models.resolveAiProvider({}), 'github-models');
  assert.equal(models.resolveAiProvider({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
  assert.equal(models.resolveAiProvider({ ANTHROPIC_API_KEY: 'k', AI_PROVIDER: 'github-models' }), 'github-models');
  assert.equal(models.resolveAiProvider({ AI_PROVIDER: 'anthropic' }), 'anthropic');
  assert.equal(isAiConfigured({ AI_PROVIDER: 'anthropic', GITHUB_TOKEN: 'g' }), false);
  assert.equal(isAiConfigured({ GITHUB_TOKEN: 'g' }), true);
});

test('createAi: one port, adapter picked from config', () => {
  assert.equal(createAi(ANTHROPIC, { anthropicClient: fakeAnthropic(message()) }).provider, 'anthropic');
  assert.equal(createAi({ ...ANTHROPIC, AI_PROVIDER: 'github-models', GITHUB_TOKEN: 'g' }).provider, 'github-models');
  assert.throws(() => createAi({ AI_PROVIDER: 'anthropic', AI_BASE_URL: 'https://x' }), (err) => {
    assert.ok(err instanceof AiError);
    assert.equal(err.code, 'not_configured');
    return true;
  });
});

test('models: defaults, fast tier, foreign-family ids ignored', () => {
  assert.equal(models.resolveAiModel({}, 'anthropic'), 'claude-opus-5');
  assert.equal(models.resolveAiModel({}, 'anthropic', 'fast'), 'claude-opus-5');
  assert.equal(models.resolveAiModel({ AI_MODEL_FAST: 'claude-haiku-4-5' }, 'anthropic', 'fast'), 'claude-haiku-4-5');
  assert.equal(models.resolveAiModel({ AI_MODEL: 'claude-sonnet-5' }, 'anthropic', 'fast'), 'claude-sonnet-5');
  // A stored GitHub Models id must not reach the Anthropic API (and vice versa).
  assert.equal(models.resolveAiModel({ AI_MODEL: 'openai/gpt-4.1' }, 'anthropic'), 'claude-opus-5');
  assert.equal(models.resolveAiModel({ AI_MODEL: 'claude-opus-5' }, 'github-models'), 'openai/gpt-4.1');
  const port = createAi({ ...ANTHROPIC, AI_MODEL_FAST: 'claude-haiku-4-5' }, { anthropicClient: fakeAnthropic(message()) });
  assert.equal(port.modelFor('veille.triage'), 'claude-haiku-4-5');
  assert.equal(port.modelFor('veille.digest'), 'claude-opus-5');
});

// ---------------------------------------------------------------------------
// Request shape (skill rules) + structured outputs
// ---------------------------------------------------------------------------

test('params: Opus 5 classification = low effort, cached system, json_schema, default fallbacks', () => {
  const p = buildAnthropicParams('claude-opus-5', req('veille.triage', { cacheSystem: true }), {
    type: 'json_schema',
    schema: SCHEMA,
  });
  assert.equal(p.model, 'claude-opus-5');
  assert.deepEqual(p.system, [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(p.messages, [{ role: 'user', content: 'USER' }]); // no assistant prefill
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.thinking, undefined); // no explicit thinking for classification
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(p.max_tokens > 500); // thinking headroom
  for (const forbidden of ['temperature', 'top_p', 'top_k']) assert.equal(p[forbidden], undefined);
  assert.equal(JSON.stringify(p).includes('budget_tokens'), false);
});

test('params: reports use adaptive thinking; Haiku gets neither effort, thinking nor fallbacks', () => {
  const report = buildAnthropicParams('claude-opus-5', req('veille.digest'));
  assert.deepEqual(report.thinking, { type: 'adaptive' });
  assert.equal(report.output_config.effort, 'high');
  assert.equal(report.system[0].cache_control, undefined);

  const haiku = buildAnthropicParams('claude-haiku-4-5', req('veille.triage'), { type: 'json_schema', schema: SCHEMA });
  assert.equal(haiku.output_config.effort, undefined);
  assert.equal(haiku.thinking, undefined);
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.betas, undefined);
  assert.equal(haiku.max_tokens, 500);

  const sonnet = buildAnthropicParams('claude-sonnet-5', req('intent.analyze'));
  assert.equal(sonnet.output_config.effort, 'medium');
  assert.equal(sonnet.fallbacks, undefined);
});

test('json(): output_config.format carries a closed JSON schema; answer parsed', async () => {
  const client = fakeAnthropic(message());
  const rec = recorder();
  const port = createAi(ANTHROPIC, { anthropicClient: client, ...rec });
  const out = await port.json(req('veille.triage', { schema: SCHEMA }));
  assert.deepEqual(out, { label: 'bug', score: 80 });
  const { params, options } = client.calls[0];
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.deepEqual(params.output_config.format.schema.required, ['label', 'score']);
  assert.equal(typeof params.output_config.format.parse, 'undefined');
  assert.ok(options.timeout >= 90_000);
});

test('text(): text blocks joined, thinking blocks ignored', async () => {
  const client = fakeAnthropic(
    message({
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: ' Digest ' },
      ],
    }),
  );
  const port = createAi(ANTHROPIC, { anthropicClient: client, ...recorder() });
  assert.equal(await port.text(req('veille.digest')), 'Digest');
});

// ---------------------------------------------------------------------------
// Refusal / truncation
// ---------------------------------------------------------------------------

test('refusal: AiError("refusal") with category, usage still recorded', async () => {
  const rec = recorder();
  const client = fakeAnthropic(
    message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
  );
  const port = createAi(ANTHROPIC, { anthropicClient: client, ...rec });
  await assert.rejects(port.json(req('radar.score', { schema: SCHEMA })), (err) => {
    assert.ok(err instanceof AiError);
    assert.equal(err.code, 'refusal');
    assert.match(err.message, /cyber/);
    return true;
  });
  assert.equal(rec.rows.length, 1);
  assert.equal(rec.rows[0].stopReason, 'refusal');
});

test('max_tokens on structured output: AiError("truncated")', async () => {
  const client = fakeAnthropic(message({ content: [{ type: 'text', text: '{"label":"b' }], stop_reason: 'max_tokens' }));
  const port = createAi(ANTHROPIC, { anthropicClient: client, ...recorder() });
  await assert.rejects(port.json(req('veille.triage', { schema: SCHEMA })), { code: 'truncated' });
});

// ---------------------------------------------------------------------------
// Error mapping + SDK retries
// ---------------------------------------------------------------------------

const apiErr = (Cls, status, type) =>
  new Cls(status, { type: 'error', error: { type, message: type } }, type, new Headers());

test('error mapping: typed SDK errors -> AiError codes', () => {
  const cases = [
    [apiErr(Anthropic.AuthenticationError, 401, 'authentication_error'), 'auth', false],
    [apiErr(Anthropic.PermissionDeniedError, 403, 'permission_error'), 'permission', false],
    [apiErr(Anthropic.NotFoundError, 404, 'not_found_error'), 'not_found', false],
    [apiErr(Anthropic.RateLimitError, 429, 'rate_limit_error'), 'rate_limit', true],
    [apiErr(Anthropic.BadRequestError, 400, 'invalid_request_error'), 'bad_request', false],
    [apiErr(Anthropic.InternalServerError, 529, 'overloaded_error'), 'overloaded', true],
    [new Anthropic.APIConnectionTimeoutError(), 'timeout', true],
    [new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'connection', true],
    [apiErr(Anthropic.APIError, 402, 'billing_error'), 'api', false],
  ];
  for (const [err, code, retryable] of cases) {
    const mapped = mapAnthropicError(err, 'claude-opus-5');
    assert.equal(mapped.code, code, err.constructor.name);
    assert.equal(mapped.retryable, retryable, err.constructor.name);
  }
  assert.match(mapAnthropicError(cases[2][0], 'claude-nope').message, /claude-nope/);
});

function sdkFetch(statuses) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const status = statuses[Math.min(seen.length - 1, statuses.length - 1)];
    if (status === 200) {
      return new Response(JSON.stringify(message()), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
    });
  };
  return { seen, fetchImpl };
}

test('SDK retries 429 then succeeds (real client, mocked fetch)', async () => {
  const { seen, fetchImpl } = sdkFetch([429, 200]);
  const port = createAi(ANTHROPIC, {
    anthropicClient: createAnthropicClient(ANTHROPIC, { fetch: fetchImpl }),
    ...recorder(),
  });
  assert.deepEqual(await port.json(req('veille.triage', { schema: SCHEMA })), { label: 'bug', score: 80 });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages?beta=true');
  assert.equal(seen[0].headers.get('x-api-key'), 'sk-ant-test');
  assert.match(seen[0].headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(seen[0].body.fallbacks, 'default');
  assert.equal(seen[0].body.betas, undefined); // sent as a header, not in the body
});

test('SDK retries exhausted on 529: AiError("overloaded"), 1 + 2 attempts', async () => {
  const { seen, fetchImpl } = sdkFetch([529]);
  const port = createAi(ANTHROPIC, {
    anthropicClient: createAnthropicClient(ANTHROPIC, { fetch: fetchImpl }),
    ...recorder(),
  });
  await assert.rejects(port.text(req('veille.digest')), { code: 'overloaded' });
  assert.equal(seen.length, 3);
});

// ---------------------------------------------------------------------------
// Usage ledger + cost
// ---------------------------------------------------------------------------

test('cost: price table, dated ids, unknown models priced as Opus 5', () => {
  const mtok = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 };
  assert.equal(models.estimateCostUsd('claude-opus-5', mtok), 5 + 25 + 6.25 + 0.5);
  assert.equal(models.estimateCostUsd('claude-sonnet-5', mtok), 2 + 10 + 2.5 + 0.2);
  assert.equal(models.estimateCostUsd('claude-haiku-4-5-20251001', mtok), 1 + 5 + 1.25 + 0.1);
  assert.equal(models.priceForModel('claude-unknown-9').known, false);
  assert.equal(models.estimateCostUsd('claude-unknown-9', mtok), 36.75);
});

test('usage is recorded in SQLite with tokens, model, task and cost', async () => {
  const before = getDb().prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n;
  const client = fakeAnthropic(
    message({ usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 } }),
  );
  // Default recorder (SQLite); budget hooks neutralised.
  const port = createAi(ANTHROPIC, { anthropicClient: client, afterUsage: () => {}, assertBudget: () => {} });
  await port.json(req('veille.triage', { schema: SCHEMA }));
  const row = getDb().prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 1').get();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n, before + 1);
  assert.equal(row.provider, 'anthropic');
  assert.equal(row.model, 'claude-opus-5');
  assert.equal(row.task, 'veille.triage');
  assert.equal(row.cache_read_input_tokens, 800);
  assert.equal(row.cost_usd, (100 * 5 + 50 * 25 + 800 * 0.5) / 1e6);
  assert.match(row.month, /^\d{4}-\d{2}$/);
});

test('GitHub Models adapter: JSON mode, fenced JSON tolerated, usage at cost 0', async () => {
  const sent = [];
  const openaiClient = {
    chat: {
      completions: {
        async create(params) {
          sent.push(params);
          return {
            model: 'openai/gpt-4.1',
            choices: [{ finish_reason: 'stop', message: { content: '```json\n{"label":"x","score":1}\n```' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  };
  const rec = recorder();
  const port = createAi(GITHUB, { openaiClient, ...rec });
  assert.deepEqual(await port.json(req('veille.triage', { schema: SCHEMA })), { label: 'x', score: 1 });
  assert.deepEqual(sent[0].response_format, { type: 'json_object' });
  assert.equal(sent[0].messages[0].role, 'system');
  assert.equal(rec.rows[0].costUsd, 0);
  assert.equal(rec.rows[0].provider, 'github-models');
});

// ---------------------------------------------------------------------------
// Budget guard
// ---------------------------------------------------------------------------

function spend(costUsd, task = 'veille.digest') {
  usage.recordAiUsage(
    {
      provider: 'anthropic',
      model: 'claude-opus-5',
      task,
      stopReason: 'end_turn',
      costUsd,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    NOW,
  );
}

test('budget: warning once at 80 %, stop once at 100 %, essential tasks keep running', async () => {
  const notified = [];
  const deps = { now: NOW, notify: async (url, title, description) => notified.push({ url, title, description }) };
  const cfg = { ...ANTHROPIC, DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x' };

  spend(100);
  assert.equal(await usage.checkBudgetAlerts(cfg, deps), null);
  assert.doesNotThrow(() => usage.assertWithinBudget(cfg, 'anthropic', 'radar.score', NOW));

  spend(61); // 161 / 200 = 80.5 %
  assert.equal(await usage.checkBudgetAlerts(cfg, deps), 'warning');
  assert.equal(await usage.checkBudgetAlerts(cfg, deps), null); // once per month
  assert.equal(notified.length, 1);
  assert.match(notified[0].title, /80 %/);
  assert.doesNotThrow(() => usage.assertWithinBudget(cfg, 'anthropic', 'content.generate', NOW));

  spend(40); // 201 / 200
  assert.equal(await usage.checkBudgetAlerts(cfg, deps), 'exceeded');
  assert.equal(notified.length, 2);
  assert.match(notified[1].description, /Radar produit/);

  for (const task of ['radar.score', 'radar.report', 'veille.monthly', 'intent.analyze', 'content.generate', 'content.suggest']) {
    assert.throws(() => usage.assertWithinBudget(cfg, 'anthropic', task, NOW), { code: 'budget_exceeded' }, task);
  }
  for (const task of ['veille.digest', 'veille.triage']) {
    assert.doesNotThrow(() => usage.assertWithinBudget(cfg, 'anthropic', task, NOW), task);
  }
  // GitHub Models is free: never blocked.
  assert.doesNotThrow(() => usage.assertWithinBudget(cfg, 'github-models', 'radar.score', NOW));

  // Through the port: a blocked task never reaches the API.
  const client = fakeAnthropic(message());
  const port = createAi(cfg, {
    anthropicClient: client,
    recordUsage: () => {},
    afterUsage: () => {},
    assertBudget: (p, t) => usage.assertWithinBudget(cfg, p, t, NOW),
  });
  await assert.rejects(port.json(req('radar.score', { schema: SCHEMA })), (err) => {
    assert.equal(err.code, 'budget_exceeded');
    assert.match(err.message, /Budget IA mensuel atteint/);
    return true;
  });
  assert.equal(client.calls.length, 0);
  assert.equal(await port.text(req('veille.digest')), '{"label":"bug","score":80}');
  assert.equal(client.calls.length, 1);

  const status = usage.getAiBudgetStatus(cfg, NOW);
  assert.equal(status.level, 'exceeded');
  assert.equal(status.spentUsd, 201);
  assert.equal(status.enforced, true);
  assert.equal(JSON.stringify(status).includes('sk-ant-test'), false);
});
