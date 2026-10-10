# 0027. AI port with an Anthropic adapter, usage ledger and monthly budget

Date: 2026-10-10

## Status

Proposed

## Context

Request from the owner (2026-10-10): « Solopilot devrait tourner sur l'API Anthropic,
now that I have 200 $ par mois d'utilisation. »

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
3. **Task profiles.** Each task has a profile, a model tier and an essential flag:
   - `classify` (triage, radar scoring): `output_config.effort: "low"`, modest
     `max_tokens`. `thinking` is left unset: on Claude Opus 5 this runs adaptive
     thinking, which low effort keeps short. The skill recommends lower effort over
     `thinking: disabled`.
   - `generate` (studio, intent replies): effort `medium`.
   - `report` (digest, monthly summary, radar report): `thinking: {type: "adaptive"}`,
     effort `high`.
   Thinking-capable models get extra `max_tokens` headroom, because thinking tokens
   count against `max_tokens`. Haiku 4.5 gets neither effort nor thinking. No
   `budget_tokens`, no sampling parameters and no assistant prefill.
4. **Models.** `AI_MODEL` defaults to `claude-opus-5`. `AI_MODEL_FAST` applies to the
   `fast` tier (triage, radar scoring) and falls back to `AI_MODEL`. Damien decides
   whether to move it to `claude-sonnet-5` or `claude-haiku-4-5`.
5. **Structured outputs.** `.json()` requests carry a JSON Schema
   (`src/ai/schema.ts`). The Anthropic adapter sends it as
   `output_config.format` (built with the SDK's `jsonSchemaOutputFormat`, which
   closes objects and turns bounds and enums into description hints). Callers keep their
   Zod schemas as the authority: the result is validated, as before.
6. **Refusals.** For Claude Opus 5 (also Opus 5.5 and Fable 5.1) the request carries
   `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. In the
   TypeScript SDK this parameter exists only on `client.beta.messages.create`
   (typed `BetaFallbacksParam = ... | 'default'`), so the adapter uses the beta
   Messages surface. `stop_reason: "refusal"` is checked before any content is read,
   because the fallback chain can also refuse and other models have no server-side
   fallback. A refusal becomes `AiError('refusal')` with the category.
   `.parse()` is not used: it parses before the stop reason can be checked.
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
   cacheable prefix is 512 tokens on Opus 5, 1,024 on Sonnet 5 and 4,096 on
   Haiku 4.5. The triage prompt (about 700 tokens) only caches on Opus 5.
9. **Usage ledger and budget.** Each call writes a row to `ai_usage`: provider,
   model, task, uncached input, cache write, cache read and output tokens, stop
   reason, and estimated USD cost. The cost uses the price table in `models.ts`
   (Anthropic pricing page, 2026-10-10, 5-minute cache writes). GitHub Models calls
   cost 0. `AI_MONTHLY_BUDGET_USD` defaults to 200. The month follows the
   Europe/Paris calendar.
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

## Consequences

- Moving to Anthropic is a deploy plus one env variable. Rolling back is one env
  variable.
- New AI features go through the port and get usage, budget and refusal handling for
  free.
- Recorded cost is an estimate. With a server-side fallback it is priced at the
  serving model (`message.model`); Opus 4.8 has the same price as Opus 5. The
  Anthropic Console stays the billing source of truth.
- Essential tasks can still overspend after 100 %. The overshoot is bounded by the
  triage and digest volume. Setting `AI_MODEL_FAST` to a cheaper model reduces it.
- Digest and report latency increases with reasoning. Report timeouts are raised to
  5 minutes on the Anthropic adapter.
