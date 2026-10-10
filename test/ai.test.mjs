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
const aiSettings = await import('../dist/ai/settings.js');
const { setSetting, deleteSetting } = await import('../dist/settings-service.js');
const { tryLoadConfigWithOverrides } = await import('../dist/config.js');

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
    model: 'claude-haiku-5-5',
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

test('models: Haiku 5.5 default for both classes, foreign-family ids ignored', () => {
  assert.equal(models.DEFAULT_ANTHROPIC_MODEL, 'claude-haiku-5-5');
  assert.equal(models.resolveAiModel({}, 'anthropic'), 'claude-haiku-5-5');
  assert.equal(models.resolveAiModel({}, 'anthropic', 'fast'), 'claude-haiku-5-5');
  // Classes are independent on Anthropic: a pricier main model does not move triage.
  assert.equal(models.resolveAiModel({ AI_MODEL: 'claude-sonnet-5-5' }, 'anthropic', 'fast'), 'claude-haiku-5-5');
  assert.equal(models.resolveAiModel({ AI_MODEL_FAST: 'claude-haiku-4-5' }, 'anthropic', 'fast'), 'claude-haiku-4-5');
  // GitHub Models keeps the historical fast -> main fallback.
  assert.equal(models.resolveAiModel({ AI_MODEL: 'openai/gpt-4o' }, 'github-models', 'fast'), 'openai/gpt-4o');
  // A stored GitHub Models id must not reach the Anthropic API (and vice versa).
  assert.equal(models.resolveAiModel({ AI_MODEL: 'openai/gpt-4.1' }, 'anthropic'), 'claude-haiku-5-5');
  assert.equal(models.resolveAiModel({ AI_MODEL: 'claude-haiku-5-5' }, 'github-models'), 'openai/gpt-4.1');
  const port = createAi({ ...ANTHROPIC, AI_MODEL_FAST: 'claude-haiku-4-5' }, { anthropicClient: fakeAnthropic(message()), aiSettings: () => ({}) });
  assert.equal(port.modelFor('veille.triage'), 'claude-haiku-4-5');
  assert.equal(port.modelFor('veille.digest'), 'claude-haiku-5-5');
});

test('resolution order: Settings > env > default, per class, model and effort', () => {
  const env = { AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT_FAST: 'medium' };
  const sel = (settings, tier) => models.resolveAiSelection(env, settings, 'anthropic', tier);

  assert.deepEqual(sel({}, 'default'), { model: 'claude-sonnet-5-5', modelSource: 'env', effort: undefined, effortSource: 'default' });
  assert.deepEqual(sel({}, 'fast'), { model: 'claude-haiku-5-5', modelSource: 'default', effort: 'medium', effortSource: 'env' });
  assert.deepEqual(sel({ AI_MODEL: 'claude-opus-5-5', AI_EFFORT: 'low' }, 'default'), {
    model: 'claude-opus-5-5',
    modelSource: 'settings',
    effort: 'low',
    effortSource: 'settings',
  });
  assert.equal(sel({ AI_EFFORT_FAST: 'high' }, 'fast').effort, 'high');
  // A foreign or invalid Settings value falls through to the next layer.
  assert.equal(sel({ AI_MODEL: 'openai/gpt-4.1' }, 'default').model, 'claude-sonnet-5-5');
  assert.equal(sel({ AI_EFFORT_FAST: 'turbo' }, 'fast').effort, 'medium');
  assert.equal(models.resolveAiSelection({}, { AI_MODEL: 'openai/gpt-4.1' }, 'anthropic').model, 'claude-haiku-5-5');
});

test('every call reads the Settings layer live (no restart, same resolution for every task)', async () => {
  const client = fakeAnthropic(message());
  // Default deps: the Settings layer comes from the SQLite settings table.
  const port = createAi({ ...ANTHROPIC, AI_MODEL: 'claude-sonnet-5-5' }, { anthropicClient: client, ...recorder() });
  try {
    assert.equal(port.modelFor('content.generate'), 'claude-sonnet-5-5'); // env
    setSetting('AI_MODEL', 'claude-opus-5-5');
    setSetting('AI_EFFORT', 'low');
    setSetting('AI_MODEL_FAST', 'claude-haiku-4-5');
    for (const task of ['veille.digest', 'veille.monthly', 'radar.report', 'intent.analyze', 'intent.replies', 'content.generate', 'content.thread', 'content.suggest']) {
      assert.equal(port.modelFor(task), 'claude-opus-5-5', task);
    }
    for (const task of ['veille.triage', 'radar.score']) assert.equal(port.modelFor(task), 'claude-haiku-4-5', task);

    await port.text(req('veille.digest'));
    assert.equal(client.calls[0].params.model, 'claude-opus-5-5');
    assert.equal(client.calls[0].params.output_config.effort, 'low'); // class effort overrides the report's high
    await port.json(req('veille.triage', { schema: SCHEMA }));
    assert.equal(client.calls[1].params.model, 'claude-haiku-4-5');
    assert.equal(client.calls[1].params.output_config.effort, undefined); // Haiku 4.5: no effort

    deleteSetting('AI_MODEL');
    assert.equal(port.modelFor('content.generate'), 'claude-sonnet-5-5'); // back to env
  } finally {
    for (const k of ['AI_MODEL', 'AI_MODEL_FAST', 'AI_EFFORT', 'AI_EFFORT_FAST']) deleteSetting(k);
  }
});

test('config: DB overrides never carry AI model/effort (env layer only in Config)', () => {
  const saved = { ...process.env };
  try {
    process.env.X_USERNAME = 'me';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AI_MODEL = 'claude-sonnet-5-5';
    const res = tryLoadConfigWithOverrides({ AI_MODEL: 'claude-opus-5-5', AI_EFFORT: 'high', TWEETS_LOOKBACK_DAYS: '3' });
    assert.equal(res.success, true);
    assert.equal(res.config.AI_MODEL, 'claude-sonnet-5-5');
    assert.equal(res.config.AI_EFFORT, undefined);
    assert.equal(res.config.TWEETS_LOOKBACK_DAYS, 3);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
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

test('params: Haiku 5.5 (default) = low effort for triage, no explicit thinking, no fallbacks', () => {
  const p = buildAnthropicParams('claude-haiku-5-5', req('veille.triage', { cacheSystem: true }), {
    type: 'json_schema',
    schema: SCHEMA,
  });
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema'); // structured outputs on Haiku 5.5
  assert.equal(p.thinking, undefined); // adaptive by default on Haiku 5.5, kept short by low effort
  assert.equal(p.fallbacks, undefined); // Haiku 5.5 has no server-side fallback
  assert.equal(p.betas, undefined);
  assert.equal(p.max_tokens, 500 + 2048); // thinking tokens count against max_tokens
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' }); // 512-token minimum on Haiku 5.5
  for (const forbidden of ['temperature', 'top_p', 'top_k']) assert.equal(p[forbidden], undefined);

  const report = buildAnthropicParams('claude-haiku-5-5', req('veille.digest'));
  assert.deepEqual(report.thinking, { type: 'adaptive' });
  assert.equal(report.output_config.effort, 'high');
  assert.equal(report.fallbacks, undefined);
  assert.equal(report.max_tokens, 500 + 8192);

  const studio = buildAnthropicParams('claude-haiku-5-5', req('content.generate'));
  assert.equal(studio.output_config.effort, 'medium');
  assert.equal(studio.thinking, undefined);
  assert.equal(JSON.stringify([p, report, studio]).includes('"disabled"'), false);
});

test('params: fallbacks only where server-side fallback exists; effort gated per model', () => {
  for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5']) {
    const p = buildAnthropicParams(model, req('intent.analyze'));
    assert.equal(p.fallbacks, 'default', model);
    assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01'], model);
    assert.equal(p.output_config.effort, 'medium', model);
  }
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5']) {
    assert.equal(buildAnthropicParams(model, req('intent.analyze')).fallbacks, undefined, model);
  }

  // Haiku 4.5: no effort, no adaptive thinking, no headroom.
  const haiku45 = buildAnthropicParams('claude-haiku-4-5-20251001', req('veille.digest'));
  assert.equal(haiku45.output_config, undefined);
  assert.equal(haiku45.thinking, undefined);
  assert.equal(haiku45.max_tokens, 500);

  // Class effort override: applied when the model accepts it, else the task default.
  assert.equal(buildAnthropicParams('claude-haiku-5-5', req('veille.triage'), undefined, 'xhigh').output_config.effort, 'xhigh');
  assert.equal(buildAnthropicParams('claude-opus-4-6', req('veille.triage'), undefined, 'xhigh').output_config.effort, 'low');
  assert.equal(buildAnthropicParams('claude-haiku-4-5', req('veille.triage'), undefined, 'high').output_config, undefined);

  // Custom id outside the catalogue: conservative request (model defaults).
  const custom = buildAnthropicParams('claude-haiku-6', req('veille.digest'), undefined, 'high');
  assert.equal(custom.output_config, undefined);
  assert.equal(custom.thinking, undefined);
  assert.equal(custom.fallbacks, undefined);
  assert.equal(custom.max_tokens, 500);
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

test('SDK retries 429 then succeeds (real client, mocked fetch); Haiku 5.5 sends no fallback beta', async () => {
  const { seen, fetchImpl } = sdkFetch([429, 200]);
  const port = createAi(ANTHROPIC, {
    anthropicClient: createAnthropicClient(ANTHROPIC, { fetch: fetchImpl }),
    ...recorder(),
    aiSettings: () => ({}),
  });
  assert.deepEqual(await port.json(req('veille.triage', { schema: SCHEMA })), { label: 'bug', score: 80 });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages?beta=true');
  assert.equal(seen[0].headers.get('x-api-key'), 'sk-ant-test');
  assert.equal(seen[0].body.model, 'claude-haiku-5-5');
  assert.equal(seen[0].headers.get('anthropic-beta'), null);
  assert.equal(seen[0].body.fallbacks, undefined);
});

test('SDK: a fallback-capable model from Settings sends fallbacks + beta header', async () => {
  const { seen, fetchImpl } = sdkFetch([200]);
  const port = createAi(ANTHROPIC, {
    anthropicClient: createAnthropicClient(ANTHROPIC, { fetch: fetchImpl }),
    ...recorder(),
    aiSettings: () => ({ AI_MODEL: 'claude-sonnet-5-5' }),
  });
  await port.text(req('content.generate'));
  assert.equal(seen[0].body.model, 'claude-sonnet-5-5');
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

test('cost: price table, dated ids, unknown ids priced by family', () => {
  const tok = (input, output, write = 0, read = 0) => ({ inputTokens: input, outputTokens: output, cacheCreationInputTokens: write, cacheReadInputTokens: read });
  const mtok = tok(1_000_000, 1_000_000, 1_000_000, 1_000_000);
  // Prices per MTok (input + output + 5m write + cache read), pricing page 2026-10-10.
  assert.equal(models.estimateCostUsd('claude-sonnet-5-5', mtok), 2 + 10 + 2.5 + 0.1);
  assert.equal(models.estimateCostUsd('claude-opus-5-5', mtok), 4 + 20 + 5 + 0.2);
  assert.equal(models.estimateCostUsd('claude-fable-5-1', mtok), 10 + 50 + 12.5 + 0.25);
  assert.equal(models.estimateCostUsd('claude-opus-5', mtok), 5 + 25 + 6.25 + 0.5);
  assert.equal(models.estimateCostUsd('claude-sonnet-5', mtok), 2 + 10 + 2.5 + 0.2);
  assert.equal(models.estimateCostUsd('claude-haiku-4-5-20251001', mtok), 1 + 5 + 1.25 + 0.1);
  // Unknown ids: same-family current model, Fable 5.1 when the family is unknown.
  assert.equal(models.priceForModel('claude-unknown-9').known, false);
  assert.equal(models.estimateCostUsd('claude-unknown-9', tok(1_000_000, 1_000_000)), 60);
  assert.equal(models.estimateCostUsd('claude-haiku-6', tok(10_000, 0)), 0.001); // Haiku 5.5 base tier
  // A snapshot suffix must be a date: claude-opus-5-7 is not claude-opus-5.
  assert.equal(models.priceForModel('claude-opus-5-7').known, false);
});

test('cost: Claude Haiku 5.5 prompt-length tiers (<= 100k vs > 100k prompt tokens)', () => {
  const tok = (input, output, write = 0, read = 0) => ({ inputTokens: input, outputTokens: output, cacheCreationInputTokens: write, cacheReadInputTokens: read });
  const cost = (u) => models.estimateCostUsd('claude-haiku-5-5', u);
  // Triage-sized call: base tier ($0.10 in / $0.50 out / $0.125 write / $0.01 read).
  assert.equal(cost(tok(8_000, 2_000)), (8_000 * 0.1 + 2_000 * 0.5) / 1e6);
  assert.equal(cost(tok(1_000, 500, 700, 700)), (1_000 * 0.1 + 500 * 0.5 + 700 * 0.125 + 700 * 0.01) / 1e6);
  // Exactly 100,000 prompt tokens stays on the base tier.
  assert.equal(cost(tok(100_000, 1_000)), (100_000 * 0.1 + 1_000 * 0.5) / 1e6);
  // Over 100,000: every category, output included, switches ($0.50 / $2.50 / $0.625 / $0.05).
  assert.equal(cost(tok(100_001, 1_000)), (100_001 * 0.5 + 1_000 * 2.5) / 1e6);
  // Cache reads and writes count toward the prompt length.
  assert.equal(cost(tok(10_000, 1_000, 10_000, 90_000)), (10_000 * 0.5 + 1_000 * 2.5 + 10_000 * 0.625 + 90_000 * 0.05) / 1e6);
  assert.equal(models.priceForModel('claude-haiku-5-5').known, true);
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
  assert.equal(row.model, 'claude-haiku-5-5');
  assert.equal(row.task, 'veille.triage');
  assert.equal(row.cache_read_input_tokens, 800);
  assert.equal(row.cost_usd, (100 * 0.1 + 50 * 0.5 + 800 * 0.01) / 1e6);
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
      model: 'claude-haiku-5-5',
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

// ---------------------------------------------------------------------------
// Settings: validation + view
// ---------------------------------------------------------------------------

test('settings validation: model id pattern, effort enum, effort supported by the class model', () => {
  const v = (body, current = {}, env = {}) => aiSettings.validateAiSettingsUpdate(body, env, current);

  assert.deepEqual(v({ AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT: 'high' }), {
    ok: true,
    updates: { AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT: 'high' },
  });
  assert.deepEqual(v({ AI_MODEL_FAST: ' claude-haiku-5-5 ', AI_EFFORT_FAST: '' }).updates, { AI_MODEL_FAST: 'claude-haiku-5-5', AI_EFFORT_FAST: '' });
  // Free "autre ID" accepted when it matches ^claude-[a-z0-9-]+$.
  assert.equal(v({ AI_MODEL: 'claude-haiku-5-5-20261007' }).ok, true);
  for (const bad of ['openai/gpt-4.1', 'Claude-Haiku', 'claude-haiku-5.5', 'claude_haiku', 'claude-', 'claude-x y']) {
    assert.equal(v({ AI_MODEL: bad }).ok, false, bad);
  }
  assert.equal(v({ AI_MODEL: 42 }).ok, false);
  assert.equal(v({ AI_EFFORT: 'turbo' }).ok, false);
  // Effort vs the model the class runs on after the update.
  assert.equal(v({ AI_MODEL: 'claude-opus-4-6', AI_EFFORT: 'xhigh' }).ok, false);
  assert.equal(v({ AI_EFFORT: 'xhigh' }, { AI_MODEL: 'claude-opus-4-6' }).ok, false);
  assert.equal(v({ AI_EFFORT_FAST: 'low' }, {}, { AI_MODEL_FAST: 'claude-haiku-4-5' }).ok, false); // env model, no effort
  assert.equal(v({ AI_MODEL: 'claude-haiku-6', AI_EFFORT: 'low' }).ok, false); // custom id: effort unknown
  assert.equal(v({ AI_EFFORT_FAST: 'max' }).ok, true); // default Haiku 5.5 accepts all five levels
  const err = v({ AI_MODEL: 'claude-opus-4-6', AI_EFFORT: 'xhigh' });
  assert.match(err.message, /Modèle principal/);
});

test('settings: apply stores values and an empty value deletes the override', () => {
  try {
    aiSettings.applyAiSettingsUpdate({ AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT_FAST: 'low' });
    assert.deepEqual(aiSettings.readAiModelSettings(), { AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT_FAST: 'low' });
    aiSettings.applyAiSettingsUpdate({ AI_MODEL: '' });
    assert.deepEqual(aiSettings.readAiModelSettings(), { AI_EFFORT_FAST: 'low' });
  } finally {
    aiSettings.applyAiSettingsUpdate({ AI_MODEL: '', AI_MODEL_FAST: '', AI_EFFORT: '', AI_EFFORT_FAST: '' });
  }
});

test('settings view: current catalogue with price hints, effective selection and source', () => {
  const view = aiSettings.getAiModelsView({ ...ANTHROPIC, AI_MODEL_FAST: 'claude-haiku-4-5' }, { AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT: 'low' });
  assert.equal(view.provider, 'anthropic');
  assert.equal(view.defaultModel, 'claude-haiku-5-5');
  assert.deepEqual(view.catalogue.map((m) => m.id), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
  assert.match(view.catalogue[0].priceShort, /^dès 0,10 \$ \/ 0,50 \$/);
  assert.match(view.catalogue[0].priceHint, /100\u202f000|100 000/);
  assert.equal(view.classes.default.model, 'claude-sonnet-5-5');
  assert.equal(view.classes.default.modelSource, 'settings');
  assert.equal(view.classes.default.effort, 'low');
  assert.equal(view.classes.fast.model, 'claude-haiku-4-5');
  assert.equal(view.classes.fast.modelSource, 'env');
  assert.deepEqual(view.classes.fast.effortLevels, []);
  assert.equal(JSON.stringify(view).includes('sk-ant-test'), false);
});
