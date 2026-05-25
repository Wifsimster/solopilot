# 0009. Intent signal pattern matching

Date: 2026-05-25

## Status

Accepted

## Context

The original product roundtable framed the platform's painkiller in one sentence: "tell me who is about to need my product today." Three ADRs in, we now collect from X (ADR-0006), Reddit (ADR-0007), and Hacker News (ADR-0008) into a single per-product `Item` stream. That stream is broad-spectrum mention monitoring — useful, but it is still a firehose. The owner does not have time to read a hundred items a day per product to spot the two that say "alternative to figma?" or "anyone using superbase for X?"

Intent phrases like "looking for X", "alternative to Y", "anyone using Z", "recommend a tool for" are the highest-leverage substrings on the public web for an indie-product marketer. They appear in a tiny fraction of items, but every match is a near-warm lead. The next step in the loop is to surface those matches as a triaged list rather than burying them in the daily digest.

ADR-0008 explicitly flagged this as ADR-0009 territory. This ADR is that work.

## Decision

Introduce **intent signals** as a first-class concept: items collected from any source that match user-defined intent phrases for a product. The MVP uses **case-insensitive substring matching** against item text — no AI, no regex, no fuzzy logic. Matches land in a new `intent_signals` table with a status workflow (`new` → `snoozed` / `dismissed` / `replied`) so the owner can triage. The dashboard surfaces matches per product on a new `/leads` page. AI scoring and drafted-reply generation are explicitly deferred to a future ADR.

The matching logic deliberately starts boring. Substring `includes` is dead simple to implement, dead simple for the owner to reason about ("I added the phrase, it matched the item that contains the phrase"), and free to run. The status workflow is the noise filter: false positives get dismissed once and never reappear because the unique constraint on `(item_id, product_id, matched_pattern)` prevents re-insertion.

## Schema changes

```sql
ALTER TABLE products ADD COLUMN intent_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN intent_keywords TEXT;  -- JSON array

CREATE TABLE IF NOT EXISTS intent_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  matched_pattern TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(item_id, product_id, matched_pattern)
);
CREATE INDEX IF NOT EXISTS idx_intent_signals_product_status
  ON intent_signals(product_id, status, created_at DESC);
```

Migration is appended to the existing `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch as ADR-0007 and ADR-0008. Existing products default to `intent_enabled = 0` and stay silent until the owner opts in.

The denormalised `source` column on `intent_signals` is a deliberate redundancy — it is already on the joined `tweets` row, but having it on the signal row means dashboard filters by source do not need the join, and a future cross-source dedup pass (out of scope here) can reason about `intent_signals` in isolation.

## Per-product configuration

Two new fields on the `products` table:

- `intent_enabled` — boolean gate. When `0`, the matcher is skipped for this product even if `intent_keywords` is non-empty.
- `intent_keywords` — JSON array of phrases. Each phrase is trimmed, 2–128 characters, max 30 phrases per product. Validation lives in the Zod schema for product updates, same shape as `reddit_subreddits` and `hn_keywords` validation from ADR-0007 / ADR-0008.

Why a hard cap of 30 phrases: the matcher is O(items × patterns) per collect tick, and the dashboard UI fits ~30 chips before it gets ugly. The cap is product-policy, not technical — easy to lift later.

## Matching strategy

Case-insensitive substring: `text.toLowerCase().includes(pattern.toLowerCase())`. That is the entire match function for MVP. One pattern that matches an item is one trigger; multiple patterns matching the same item produce multiple `intent_signals` rows, one per pattern. The owner sees exactly which phrase fired and can refine the list without guessing.

`INSERT OR IGNORE` on the `UNIQUE(item_id, product_id, matched_pattern)` constraint handles dedup across collect runs the same way it handles tweet dedup in ADR-0001 — re-running the matcher on the same item with the same pattern is a no-op.

Matching runs at the **end** of `collect-service.ts` over the items just inserted in this tick — not over the full history. Retroactive rematch (re-running the matcher on the historical corpus when the owner adds a new phrase) is out of scope for MVP. The owner adds a phrase, it starts catching new items from the next collect tick. Good enough.

## API surface

Two new REST endpoints on the Hono server:

- `GET /api/intent-signals?productId=<id>&status=<status>` — returns joined `IntentSignal[]` with `text`, `author`, `url`, `source`, `created_at` denormalised from the `tweets` row so the UI does not need a second fetch. Default status filter is `new`. Pagination follows the same shape as `GET /api/runs`.
- `PATCH /api/intent-signals/:id` — mutates `status` and/or `notes`. Status transitions are validated against the literal union `'new' | 'snoozed' | 'dismissed' | 'replied'`; any other value is rejected.

No `POST` endpoint: signals are created exclusively by the matcher running inside the collect tick. Manual signal creation is not a user need we have heard.

## Dashboard

New `/leads` page in the React app:

- Per-product feed of intent signals, default to `status = 'new'`.
- Filter chips for status (`new`, `snoozed`, `dismissed`, `replied`) and a multi-select for `source`.
- Each row shows the item text, author, source badge, matched pattern as a highlighted chip, and timestamp.
- Inline actions: snooze, dismiss, mark replied. Free-text notes field that PATCHes on blur.
- Link out to the original item via the denormalised `url`.

The `/leads` route is added to `App.tsx` and the nav. No restructuring of existing pages.

## Not in the Discord digest

Intent signals are **not** part of the daily Discord digest in this ADR. The reasoning is product-discipline: the digest is a broadcast surface the owner has trained themselves to skim. Cramming a lead list into the same message risks training them to skim past leads too. The triage workflow lives in the dashboard, on its own page, where the owner can sit down and process it deliberately.

Discord push for intent signals is a deferred decision pending owner feedback on the dashboard-only loop. Most likely landing as a separate webhook-per-product knob if and when it comes.

## Consequences

### Positive

- Cheap. No LLM cost, no per-tick API spend. Matching is a few microseconds per item per pattern in JS.
- Deterministic and debuggable — the owner can predict exactly what will match and see exactly which pattern fired on which item.
- Reuses the existing item store. The `tweets` table is the source of truth; `intent_signals` is a derived index pointing into it.
- Tiny schema delta — two ALTERs, one new table, one index. Reversible by ignoring the new columns and dropping the table.
- The status workflow makes false positives self-healing: dismiss once, never see it again, the unique constraint enforces it.
- Sets the table shape up to absorb AI scoring later without breaking the wire — future columns like `ai_score`, `ai_explanation`, `ai_drafted_reply` are pure additions.

### Negative / Risks

- Substring matching has no ranking and no semantic understanding. "looking for a" matches "I'm not looking for a fight" as readily as "I'm looking for a replacement for Notion." MVP price. The status workflow is the mitigation: noise gets dismissed and never re-fires.
- Cost grows linearly with `items × patterns` per product per collect tick. Fine at expected scale (30 patterns × ~hundreds of items per tick is sub-millisecond). Becomes worth optimising — Aho-Corasick, pre-lowercased pattern caching — only at much higher volume.
- The matcher runs only on newly-stored items. Adding a new pattern does not surface historical matches. A future "rematch history" admin action is the obvious follow-up.
- Two-phase intent + AI ranking is the most likely future shape. Building substring-only first means the AI second-pass needs a deliberate ADR rather than slipping in incrementally.

### Neutral

- The collect-tick duration grows by O(items × patterns) per product. Negligible at current scale, captured here for completeness.
- The `dev:once` one-shot mode picks up the matcher automatically since it runs the same collect path.
- Per-product `intent_keywords` validation reuses the Zod patterns established for Reddit subreddits and HN keywords — same trim/length/max-count shape, no new validator concepts.

## Explicitly NOT in scope for this ADR

- AI-based intent classification, scoring, or "why this matched" explanations.
- AI-drafted reply generation.
- Retroactive matching when a new pattern is added to a product.
- Notification push (Discord, email, Slack) for intent signals — dashboard-only for MVP.
- Fuzzy matching, Levenshtein distance, embeddings-based similarity.
- Regex pattern support.
- Sentiment analysis on matched items.
- Cross-source intent dedup (same person posting "alternative to X" on both X and HN gets two signals; that is correct for MVP).
- Per-pattern hit-rate analytics on the dashboard.

## Alternatives Considered

### Pure AI classification per item
Send every collected item to the LLM with a "is this someone looking for a product like ours?" prompt. Rejected: expensive at firehose scale (hundreds of items per product per day × N products), slow, and opaque — the owner cannot see why the model decided yes or no. The hybrid path is right: cheap substring match as a first-pass filter, AI as an optional second-pass ranker on the matched set. That hybrid is ADR-0010 territory and depends on the data this ADR produces.

### Regex patterns instead of substrings
Allow the owner to write `/looking for (a|an) \w+/i` style patterns. Rejected: power users want this, the majority will not write a regex correctly on the first try, and a broken regex is a silent zero-match failure mode that the dashboard cannot diagnose without running it. MVP keeps it dead simple. A future `pattern_type` column (`substring` | `regex`) is a clean extension when there is real demand.

### Tag items in-place
Add a `matched_intent` column to the `tweets` table instead of a separate `intent_signals` table. Rejected: items belong to one product, but the same item could in principle match patterns from two different products if the owner runs overlapping niches. A separate table with `(item_id, product_id, matched_pattern)` is the correct shape. It also keeps the `tweets` table read-only after insert, which preserves the simple ingestion model from ADR-0001.

### Separate cron for intent matching
Run the matcher on its own schedule, decoupled from collection. Rejected: matching is fast and only operates on newly-stored items — folding it into the tail of the collect tick is one function call and avoids inventing a second concurrency guard. Same reasoning as ADR-0006's "one cron per phase, not per concern."

### Push leads into the daily Discord digest immediately
Append a "Leads" section to the existing digest. Rejected for now, see "Not in the Discord digest" above — notification fatigue risk on the one broadcast surface that currently works. Revisit after the dashboard loop has been used in anger for a few weeks.

## Future

- ADR-0010 will likely introduce the AI second-pass: take the substring-matched set, score it for actual intent, generate an explanation and a draft reply. The `intent_signals` table is already shaped to absorb this — pure additive columns, no wire-shape break.
- Retroactive rematch (an admin action: "rerun the matcher on the last 30 days for this product") becomes obvious once the owner adds their tenth pattern and asks where the old matches went.
- Discord push for high-confidence signals lands once AI scoring exists — score-gated push avoids the notification-fatigue concern that kept it out of the digest here.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed the separate `intent_signals` table over an in-place column on `tweets`; defended source-prefixed item IDs flowing through to the signal row; advocated the `UNIQUE(item_id, product_id, matched_pattern)` constraint as the dedup primitive.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed the substring-first / AI-later sequencing; vetoed regex support for MVP on UX-failure-mode grounds; approved folding the matcher into the collect tick rather than a separate cron.
- Sprint Zero Sarah (Product Owner) — Cut AI scoring, drafted replies, retroactive rematch, and Discord push from scope; held the line on dashboard-only triage to validate the loop before adding broadcast surfaces.
- Edge-Case Nico (QA Engineer) — Flagged the false-positive substring problem ("looking for a fight") and the linear cost growth with patterns × items; both captured as deferred mitigations with the status workflow as the immediate safety net.

---
_Decision recorded automatically from fast-meeting analysis._
