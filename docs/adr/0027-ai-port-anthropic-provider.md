# 0027. AI port with an Anthropic adapter, usage ledger and monthly budget

Date: 2026-10-10

## Status

Proposed

## Context

Request from the owner (2026-10-10): « Solopilot devrait tourner sur l'API Anthropic,
now that I have 200 $ par mois d'utilisation. »

Follow-up decision from the owner (2026-10-10): « Pas besoin d'Opus pour solopilot,
laisse-moi le paramétrer, et un modèle low comme Haiku 5.5 est largement suffisant. »
Decisions 3, 4, 6, 8 and 9 below reflect it.

Every AI call went through the OpenAI SDK v6 against GitHub Models (or OpenRouter via
`AI_BASE_URL`), from 9 `chat.completions.create` call sites (16 AI functions) in 5 files.
JSON was obtained with `response_format: json_object` plus tolerant parsing. Nothing
recorded token usage or cost. GitHub Models is free; the Anthropic API is billed per
token, so spend has to be visible and bounded.

## Decision

1. **One AI port, two adapters** (`src/ai/`). Business code calls
   `createAi(config).text(req)` or `.json(req)` with a task id from `AI_TASKS`.
   No module outside `src/ai/` imports an AI SDK.
   - `anthropic-adapter.ts`: official `@anthropic-ai/sdk`.
   - `github-models-adapter.ts`: the former behaviour, unchanged (OpenAI SDK, JSON
     mode, tolerant JSON parsing). It also serves OpenRouter.
2. **Provider switch.** `AI_PROVIDER=anthropic|github-models`. When unset: `anthropic`
   if `ANTHROPIC_API_KEY` is set, else `github-models`. The rollback is
   `AI_PROVIDER=github-models`, with no code change. A model id from the other
   provider's family (`openai/...` versus `claude-...`) is ignored with a warning, so a
   stale `AI_MODEL` DB override cannot break a switch.
3. **Task profiles.** Each task has a profile, a model class (tier) and an essential
   flag:
   - `classify` (triage, radar scoring, class `fast`): `output_config.effort: "low"`,
     modest `max_tokens`. `thinking` is left unset: on Claude Haiku 5.5 (and every 5.x
     model) adaptive thinking is on by default, and low effort keeps it short. The
     docs recommend effort over `thinking: {type: "disabled"}`.
   - `generate` (studio, intent replies, class `default`): effort `medium`.
   - `report` (digest, monthly summary, radar report, class `default`):
     `thinking: {type: "adaptive"}`, effort `high`.
   An effort chosen for a class in Settings (`AI_EFFORT`, `AI_EFFORT_FAST`) replaces
   the per-task effort when the model accepts that level; otherwise the per-task
   effort applies. Models that accept adaptive thinking get extra `max_tokens`
   headroom, because thinking tokens count against `max_tokens`. Models without the
   effort parameter (Claude Haiku 4.5, Sonnet 4.5) get neither effort nor thinking.
   `thinking: {type: "disabled"}` is never sent: Opus 5.5, Sonnet 5.5 and Fable
   reject it, and Haiku 5.5 rejects it at `xhigh` and `max`. No `budget_tokens`
   (400 on every 5.x model), no sampling parameters and no assistant prefill (both
   400 on Haiku 5.5).
4. **Models.** Claude Haiku 5.5 (`claude-haiku-5-5`) is the default of both classes:
   `default` (`AI_MODEL`: reports, summaries, studio, intent) and `fast`
   (`AI_MODEL_FAST`: triage, radar scoring). Resolution, per class:
   **Settings > env > code default**. The Settings page ("Modèles IA") offers the
   current Anthropic models from one catalogue in code (`ANTHROPIC_MODELS` in
   `src/ai/models.ts`, with price hints) plus a free "autre ID" validated against
   `^claude-[a-z0-9-]+$`, and an effort selector limited to the levels the model
   accepts. `createAi()` resolves the selection on every call, reading the Settings
   layer from the DB, so every feature uses the same resolution and a change applies
   at the next call without a restart. `Config` carries the env layer only: the
   Settings keys are excluded from the DB-override merge. An id outside the
   catalogue is sent with the conservative request shape (no effort, no explicit
   thinking, no fallbacks) and priced as the current model of its family. On
   GitHub Models the `fast` class keeps its historical fallback to `AI_MODEL`.
5. **Structured outputs.** `.json()` requests carry a JSON Schema
   (`src/ai/schema.ts`). The Anthropic adapter sends it as
   `output_config.format` (built with the SDK's `jsonSchemaOutputFormat`, which
   closes objects and turns bounds and enums into description hints). Callers keep their
   Zod schemas as the authority: the result is validated, as before. Every catalogue
   model supports structured outputs on the Claude API, Haiku 5.5 included (it lacks
   them only on Amazon Bedrock, which Solopilot does not use).
6. **Refusals.** Claude Haiku 5.5 runs safety classifiers but has no server-side
   fallback: with `fallbacks: "default"` a declined request stays declined, and an
   explicit fallback list is a 400. The adapter therefore sends `fallbacks: "default"`
   (beta `server-side-fallback-2026-07-01`) only when the catalogue marks the model as
   supporting it: Sonnet 5.5, Opus 5.5, Opus 5, Fable 5.1 and Fable 5. In the
   TypeScript SDK this parameter exists only on `client.beta.messages.create` (typed
   `BetaFallbacksParam = ... | 'default'`), so the adapter uses the beta Messages
   surface, without `betas` when no fallback is sent. `stop_reason: "refusal"` is
   checked before any content is read. A refusal becomes `AiError('refusal')` with
   the category. `.parse()` is not used: it parses before the stop reason can be
   checked. There is no client-side retry on another model: a refused triage batch
   is marked with `triage_error`, as before.
7. **Errors and retries.** The SDK retries 429, 5xx and connection errors
   (`maxRetries: 2`). Errors that remain are mapped, most specific first, to
   `AiError` codes (`auth`, `permission`, `not_found`, `rate_limit`, `bad_request`,
   `overloaded`, `timeout`, `connection`, `api`) with French messages. Call sites
   persist or display these messages.
8. **Prompt caching.** The system prompt is always the first block, and volatile data
   stays in the user turn. Prompts that repeat within 5 minutes get `cache_control`:
   triage (same per-product system prompt for every batch of 30 items in a run),
   intent analysis and replies, and studio generation. Hourly runs are 60 minutes
   apart, which is outside the 5-minute TTL and at the edge of the 1-hour TTL. A
   1-hour write at 2x would therefore rarely be read, so it is not used. The minimum
   cacheable prefix is 512 tokens on Haiku 5.5 (down from 4,096 on Haiku 4.5), as on
   Sonnet 5.5, Opus 5.5, Opus 5 and Fable; 1,024 on Sonnet 5. The triage prompt
   (about 700 tokens) therefore caches on the default model.
9. **Usage ledger and budget.** Each call writes a row to `ai_usage`: provider,
   model, task, uncached input, cache write, cache read and output tokens, stop
   reason, and estimated USD cost. The cost uses the catalogue prices (pricing page,
   2026-10-10, 5-minute cache writes). Claude Haiku 5.5 is priced by prompt length:
   a request whose prompt (input + cache writes + cache reads) is over 100,000 tokens
   pays $0.50 input / $0.625 cache write / $0.05 cache read / $2.50 output per MTok
   instead of $0.10 / $0.125 / $0.01 / $0.50, output included; each request is
   priced on its own. GitHub Models calls cost 0. `AI_MONTHLY_BUDGET_USD` defaults
   to 200. The month follows the Europe/Paris calendar.
   - At 80 %: one log warning and one Discord embed per month (global webhook, then
     the veille webhook), plus a banner in Settings.
   - At 100 %: non-essential tasks throw `AiError('budget_exceeded')` before the API
     call. Those tasks are radar produit, monthly summary, intent analysis and
     replies, and every content studio action. The radar workflow skips with
     `budget_exceeded` instead of failing.
   - Essential tasks keep running: the veille digest (the production feature) and
     item triage (which feeds urgent mention alerts).
   - The guard applies only to the Anthropic provider.
10. **Secret.** `ANTHROPIC_API_KEY` is read from the environment only. It is not an
    editable or credential setting, it is never written to the DB, and no endpoint
    returns it. `GET /api/ai/usage` returns provider, models and spend only.

11. **Spend analysis (« Dépenses IA »).** Request from the owner (2026-10-10):
    « Et une très bonne analyse des dépenses avec graphique, pour surveiller et
    avoir une overview. » A page (`/depenses-ia`) reads
    `GET /api/ai/usage/report?period=7d|30d|month|prev-month|12m`. `ai_usage`
    gains a `day` column (Europe/Paris date, written at insert, backfilled once)
    with an index, so SQL buckets by Paris day across DST. Projection is linear
    on days elapsed. Cache savings are net: cache reads priced as uncached input
    minus the cache-write premium. Insights are deterministic code. A weekly
    Discord recap (Monday 09:00, `AI_WEEKLY_RECAP_ENABLED`, default on, once per
    week via `ai_usage_recaps`) uses the budget-alert webhook and makes no AI
    call. Charts use Recharts, already in the frontend (ADR-0021).

## Consequences

- Moving to Anthropic is a deploy plus one env variable. Rolling back is one env
  variable.
- New AI features go through the port and get usage, budget and refusal handling for
  free.
- Recorded cost is an estimate. With a server-side fallback (only on models that
  have one) it is priced at the serving model (`message.model`). The Anthropic
  Console stays the billing source of truth.
- On Haiku 5.5 the expected spend is a few dollars a month (the PR gives the
  scenario), far below the 200 USD budget. The 80 % and 100 % alerts matter again
  only after a switch to a pricier model in Settings or a large traffic increase.
  Essential tasks can still overspend after 100 %; the overshoot is bounded by the
  triage and digest volume.
- Claude Haiku 5.5 has no server-side fallback: a refused request fails with
  `AiError('refusal')` instead of being retried on another model.
- Haiku 5.5 counts about 30 % more tokens than Haiku 4.5 for the same text (newer
  tokenizer, as on Opus 5). Token counts in `ai_usage` are what the API bills.
- Digest and report latency increases with reasoning. Report timeouts are raised to
  5 minutes on the Anthropic adapter.

## Sources

Read on 2026-10-10:

- Models overview: https://platform.claude.com/docs/en/models/overview
- Claude Haiku 5.5: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- What's new in Haiku 5.5: https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5
- Haiku 5.5 migration guide: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- Pricing (model table and long context pricing): https://platform.claude.com/docs/en/about-claude/pricing
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Thinking (per-model `thinking` values): https://platform.claude.com/docs/en/build-with-claude/thinking
- Refusals and fallback: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- Structured outputs (supported models): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Prompt caching (minimum cacheable length): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
