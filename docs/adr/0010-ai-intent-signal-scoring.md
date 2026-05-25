# 0010. AI intent signal scoring and drafted replies

Date: 2026-05-25

## Status

Accepted

## Context

ADR-0009 landed substring intent-signal matching and explicitly punted on the AI second pass: "ADR-0010 will likely introduce the AI second-pass: take the substring-matched set, score it for actual intent, generate an explanation and a draft reply." This ADR is that work.

Pattern matching gives the owner a list, but a list of thirty leads is still triage work. The product owner needs to know three things about that list: which two or three rows are actually worth answering today, why each one is a real lead and not a "looking for a fight" false positive, and what to actually type back. AI sits exactly at that gap. Substring matching cannot rank, cannot explain, and cannot draft — those are language tasks.

Auto-analyzing every match at collect time was the first instinct and the wrong one. It would (a) make AI cost grow with the firehose rather than with owner attention, (b) burn tokens on leads the owner would have dismissed in two seconds anyway, and (c) couple a slow LLM round-trip into the hot collect path where a single 429 could stall the tick. On-demand — one analysis per click on a "Analyser" button — is the right MVP shape. It caps spend at the rate the owner can actually consume the output, which is the spend ceiling that matters.

## Decision

Add an AI scoring pass over `intent_signals`, triggered explicitly by the owner from the `/leads` dashboard. One click on a lead row → one `POST /api/intent-signals/:id/analyze` call → one LLM round-trip → three structured outputs written back to the row: a `0-100` score, a one-or-two-sentence French explanation, and a French drafted reply written in the product's configured voice. Reuse the same OpenAI SDK client and GitHub Models endpoint already wired in `src/ai-filter.ts` — no new model config, no new env var, no new ops surface.

The drafted reply is intentionally hard-gated on score: below 40, the model is instructed to return `null` for `drafted_reply`. Drafting a polished response for an obvious false positive wastes tokens and trains the owner to ignore the output. The threshold is documented in the prompt and enforced server-side (if the model returns a reply for a low score, we drop it).

Single LLM call per click, single JSON object back. No multi-step chain-of-thought, no separate score-then-explain-then-reply pipeline. JSON mode (`response_format: { type: 'json_object' }`) bounds the parse and lets Zod validate the shape before persistence.

## Schema changes

```sql
ALTER TABLE intent_signals ADD COLUMN ai_score INTEGER;
ALTER TABLE intent_signals ADD COLUMN ai_explanation TEXT;
ALTER TABLE intent_signals ADD COLUMN ai_drafted_reply TEXT;
ALTER TABLE intent_signals ADD COLUMN ai_processed_at INTEGER;
ALTER TABLE intent_signals ADD COLUMN ai_error TEXT;

ALTER TABLE products ADD COLUMN product_description TEXT;
ALTER TABLE products ADD COLUMN reply_voice TEXT;
```

Five additive columns on `intent_signals`, two on `products`. Every column is nullable with no default — rows backfill silently as "not analyzed yet" and the wire shape from ADR-0009 stays intact. Migration is appended to the existing `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch used by ADR-0007, ADR-0008, and ADR-0009. ADR-0009 explicitly anticipated this addition ("pure additive columns, no wire-shape break"); this ADR cashes that anticipation in.

`reply_voice` is an enum: `'decontractee' | 'professionnelle' | 'directe' | 'aidante'`, validated by Zod on the product update endpoint. `product_description` is free-form text, 0–500 characters, owner-supplied. Both feed the prompt; both default to null, in which case the prompt uses a generic fallback.

## Service shape

A new `intent-service.ts` (sibling of the existing `monthly-summary-service.ts`) owns:

- The OpenAI client construction (reusing the existing `baseURL` and `GITHUB_TOKEN` from `ai-filter.ts`).
- The prompt builder, which assembles product metadata + lead context into a single user message.
- The JSON parse and Zod validation step.
- The DB write back to the `intent_signals` row.
- On any failure — network, 429, JSON parse, Zod mismatch — populate `ai_error` with a short message, leave the three output columns null, still stamp `ai_processed_at`. The endpoint always returns 200 with the updated row; failures are surfaced in the response body, not the HTTP status. The UI handles errors uniformly that way: render the row, show `ai_error` if present, offer a "Réanalyser" button.

## Prompt shape

Illustrative — the canonical version lives in `intent-service.ts`:

- **System:** `Tu es un expert marketing produit. On te donne un produit et un post public qui mentionne potentiellement un besoin pour ce produit. Analyse l'adéquation. Réponds en JSON strict, sans markdown, sans texte hors JSON.`
- **User (structured):** product name, `product_description` (or fallback), `reply_voice` (or "neutre"), then the lead: `source`, `author`, `text`, `url`, `matched_pattern`.
- **Required JSON shape:**

```json
{
  "score": 0-100,
  "explanation": "1-2 phrases en français expliquant pourquoi ce lead est ou n'est pas pertinent.",
  "drafted_reply": "Réponse en français dans le ton demandé, ou null si score < 40. Max 280 caractères si source='x', sinon 500."
}
```

Validated server-side with Zod (`z.object({ score: z.number().int().min(0).max(100), explanation: z.string().min(1).max(500), drafted_reply: z.string().max(500).nullable() })`) before persisting. The character-cap on the reply is also enforced server-side — model overshoots are truncated and `ai_error` is set to a soft warning, the row still saves.

## API surface

One new endpoint:

- `POST /api/intent-signals/:id/analyze` — synchronous, single-shot. Returns 200 with the full updated `IntentSignalView` (including the new `ai_*` fields). If the signal is in `dismissed` status, returns 400 — no point analyzing a dismissed lead. If already analyzed within the last 5 minutes, returns 429 with `Retry-After` to prevent click-spam. Otherwise runs the analysis and writes the row.

Existing `GET /api/intent-signals` and `PATCH /api/intent-signals/:id` endpoints from ADR-0009 are unchanged in shape; the response body gains the five `ai_*` fields, all nullable. No breaking change. The `IntentSignalView` TypeScript type in the shared types module gains the same five optional fields.

## Dashboard

The `/leads` page from ADR-0009 grows three UI affordances per row:

- An "Analyser" button on rows where `ai_processed_at` is null.
- A score badge (color-coded: 0–39 grey, 40–69 amber, 70–100 green) plus the explanation rendered as a one-line subhead, on rows where it has run.
- A "Réponse suggérée" expandable block showing `ai_drafted_reply` when present, with a copy-to-clipboard button. Spelled out in the UI: "Suggestion — relisez et adaptez avant d'envoyer."

Analyzed rows show "Analysé il y a X min" so the owner sees they do not need to re-run. The "Réanalyser" button is always available but secondary — the freshness signal is enough most of the time.

The product settings page gains a `product_description` textarea and a `reply_voice` select. Both are optional; both feed the prompt.

## Cost discipline

One LLM call per owner click. No batching, no auto-run, no cron-driven sweep. The same small model that powers the daily digest (`config.AI_MODEL`) handles this — payload is tiny (one item plus product context, well under 1k tokens in, a few hundred tokens out), no need for a bigger tier.

GitHub Models is already paid for and rate-limited at the account level; this ADR does not introduce a new billing line item. Token usage is logged the same way `ai-filter.ts` logs it (`logger.info('Intent analysis API usage', { inputTokens, outputTokens, model })`) so cost is visible in the existing log stream.

## Consequences

### Positive

- Predictable spend. LLM cost scales with owner attention, not with the firehose volume.
- Drafted replies turn the platform from "alerting" ("here is a lead") to "doing" ("here is what to say") — the leverage step the dashboard was missing.
- The explanation field makes false positives obvious without re-reading the post. Owner skims the explanation, dismisses the row, moves on.
- Reuses the existing GitHub Models pipeline byte-for-byte. No new SDK, no new endpoint, no new env var, no new ops failure mode.
- Schema delta is seven additive columns with safe nullable defaults. Reversible by ignoring them.

### Negative / Risks

- GitHub Models has account-level rate limits. Bursting twenty analyses in a minute can 429. Mitigation: the front-end disables the button while a call is in flight and shows the 429 in `ai_error` if it lands. The 5-minute server-side cooldown per signal prevents accidental double-clicks.
- The drafted reply is suggestive, not authoritative. A model that hallucinates a feature claim about the owner's product could embarrass them if pasted blind. Mitigation: the UI prominently labels the reply as a suggestion and the copy-to-clipboard flow forces a manual paste — no auto-send anywhere.
- Score calibration depends on the model. A score of 70 from today's model is not necessarily a 70 from the next model rev. Accepted: the score is a rough triage signal, not a metric we will dashboard over time.

### Neutral

- `dev:once` is unaffected — this is dashboard-driven, not cron-driven.
- The existing run-tracking machinery (`runs` table) is not touched; analyses are not "runs," they are per-signal mutations.

## Explicitly NOT in scope for this ADR

- Auto-analyze on collect.
- Batch analyze (one LLM call covering N leads).
- Multi-language drafted replies — French only, matches the rest of the platform.
- Reply posting / sending — the platform reads and suggests; humans copy-paste manually. Same anti-feature stance as ADR-0006 and ADR-0007.
- A/B testing of reply variants.
- Embedding-based "is this really an intent signal" second-pass before the LLM call.
- Caching or dedup of analyses across products — the same post matched for two different products legitimately gets two analyses with different product context.
- Score-driven Discord push for high-confidence leads.
- Per-product analysis-volume caps or budgets.

## Alternatives Considered

### Auto-analyze every match at collect time
Run the LLM on every signal as it is inserted. Rejected: cost grows with the firehose, not with attention. The owner dismisses ~70% of substring matches in seconds — paying to score and draft for those is pure waste. On-demand keeps the spend ceiling at "what the owner can actually use."

### Async batch via cron
Sweep unanalyzed signals every 15 minutes in batches. Rejected: adds infrastructure (a third cron, batching logic, partial-failure handling) and adds latency between "owner sees lead" and "owner sees score." On-demand is simpler and the per-click LLM latency (1–3 seconds) is acceptable UX. Revisit if owner volume forces it.

### Local model via Ollama
Run a small open model on the deployment box. Rejected: the production deployment is a hosted Docker container with no GPU; CPU inference of anything useful would dominate the request latency. GitHub Models is already paid for and the round-trip is faster than local CPU inference would be.

### Three separate LLM calls (score, then explain, then reply)
Decompose the task into a chain. Rejected: one JSON-mode call is faster, cheaper, and the model has enough context to do all three in one shot. The "chain of thought" gains are not worth the 3x cost and 3x latency for a task this scoped.

### Re-analyze automatically when `product_description` or `reply_voice` changes
Invalidate every analysis when the product context changes. Rejected: the owner edits product metadata occasionally and rarely wants every old lead's draft regenerated en masse. The `ai_processed_at` timestamp plus a "Réanalyser" button on each row is the user-driven path — the owner reanalyzes the specific leads they still care about.

### Store analyses in a separate `intent_analyses` table
History-table the analyses, one row per analysis with `signal_id` foreign key. Rejected: ADR-0009 set the precedent of additive columns on `intent_signals` for exactly this case. A separate table doubles the read surface (every lead-list query becomes a join) for no clear gain — we are not preserving analysis history beyond "the latest one." If we later need history, the additive columns become the "current" cache and a history table can be layered on without breaking the wire.

## Future

- ADR-0011 territory: auto-analyze gated by a "high-value pattern" flag on the intent keyword. Once usage data shows which patterns are worth the unconditional spend, opt those in. Out of scope here because we have no usage data yet.
- Score-gated Discord push for leads — the missing piece from ADR-0009's "not in the digest" stance. Lands once the score signal exists and owner trust in it is established.
- Per-source reply-voice conventions — X replies and HN replies have different tonal norms, and a future ADR may split `reply_voice` into per-source variants.
- Reply posting with hard confirmation — only after Discord push exists and the owner explicitly asks for the shortcut. Default stays manual copy-paste.
- Analysis-cost dashboard panel showing token usage per product per week, once the per-product spend variance becomes a real question.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed the single-JSON-call shape over a three-step chain; defended on-demand-only against the auto-analyze instinct; advocated additive columns on `intent_signals` over a separate `intent_analyses` table to match ADR-0009's wire-shape promise.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed reuse of the existing GitHub Models client over a parallel pipeline; approved the score-gated `drafted_reply` null contract as the cost discipline; held the line on returning 200 with `ai_error` over surfacing failures as 5xx.
- Sprint Zero Sarah (Product Owner) — Cut auto-analyze, batch analyze, multi-language replies, and auto-posting from scope; held the line on "humans always paste manually" consistent with ADR-0006 and ADR-0007's anti-impersonation stance.
- Edge-Case Nico (QA Engineer) — Flagged the GitHub Models 429 risk under click-burst and the model-hallucination risk in drafted replies; both captured as deferred mitigations with the 5-minute cooldown and the prominent "suggestion only" UI label as the immediate safety nets.

---
_Decision recorded automatically from fast-meeting analysis._
