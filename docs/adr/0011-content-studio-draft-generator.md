# 0011. Content Studio for AI-generated promotional drafts

Date: 2026-05-25

## Status

Accepted

## Context

Four ADRs in, the platform has shipped the multi-product pivot (ADR-0006, PR #29), Reddit and Hacker News source adapters (ADR-0007 / ADR-0008, PRs #29 #30), substring intent-signal matching (ADR-0009, PR #31), and AI scoring with drafted replies on those leads (ADR-0010, PR #32). The whole stack today is a listening machine: it pulls items from public sources, surfaces the ones that match owner-defined intent phrases, and tells the owner what to say back when a lead lands.

What the platform does not yet do is **speak proactively** for the owner's products. The marketing loop has two sides — listen-and-react (now done) and post-and-promote (not done). The owner currently writes promotional posts for Toko, Wawptn, The-Box, and the rest of the portfolio by hand, in a separate editor, copy-pasting product context every time. The LLM plumbing built for ADR-0010 already knows the product, the voice, and the audience; not reusing it to generate promotional drafts would be leaving the highest-leverage extension on the table.

The original roundtable in ADR-0006 explicitly flagged auto-publishing AI-generated content as the platform's **#1 trap**: it kills accounts (X/Reddit/HN all detect bot patterns; cookie-based posting violates ToS faster than scraping), it kills brand (followers detect AI tone and churn), and the platform becomes load-bearing for live ops the moment the scheduler is running unattended. ADR-0006's anti-feature stance — "we summarize and notify; we do not impersonate" — is the constraint. This ADR finds the design that delivers the marketing-velocity gain without crossing it.

## Decision

Add a **Content Studio**: a per-product workspace where the owner generates AI-drafted promotional posts on demand, reviews and edits them in a queue, and copies them out for manual publication. Drafts are first-class persisted artifacts with a status workflow (`pending` → `edited` → `used` / `discarded`). The generation pipeline is the same OpenAI SDK + GitHub Models call shape introduced in ADR-0010, with a different prompt and a different output schema.

**Hard line: no auto-publish, no scheduler, no third-party publishing connector in MVP.** The Studio writes drafts. The owner presses Copy, switches tabs, and pastes. That manual step is the feature, not friction to remove.

Like ADR-0010, generation is owner-triggered, not cron-driven. One click on "Générer des brouillons" produces N drafts (N=1–10) in a single LLM call. Cost scales with owner attention, not with calendar time, which is the same spend-ceiling that worked for intent-signal scoring.

## Per-product configuration additions

Six new columns on `products`:

- `product_url` — main landing page, used in the prompt as the canonical destination the post should drive to.
- `target_audience` — free-form text, 0–500 chars. "indie hackers building B2B SaaS", "freelance designers using Figma", etc.
- `value_props` — JSON array, max 10 entries, each 0–200 chars. The bullet list the model will draw from.
- `call_to_actions` — JSON array, max 5 entries, each 0–120 chars. "Essaie gratuitement", "Lis le changelog", etc.
- `content_voice` — same enum as `reply_voice` from ADR-0010 (`'decontractee' | 'professionnelle' | 'directe' | 'aidante'`) but a **separate column**. Post voice and reply voice are deliberately distinct: a product can be aidante in DMs and directe in a launch post.
- `content_language` — `'fr' | 'en'`, default `'fr'`. The platform's user-facing strings are French, but promotional posts often target English-speaking communities (HN, indie Twitter). One knob, one row, no per-draft override in MVP.

All six are nullable with safe defaults. The prompt builder falls back to "voix neutre" / "français" / empty-list-as-no-bullets when fields are empty.

## Schema

```sql
CREATE TABLE IF NOT EXISTS content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- 'post' in MVP, 'comment' reserved for ADR-0012
  target_source TEXT,                       -- 'x' | 'reddit' | 'generic'
  angle TEXT,                               -- short label, e.g. "objection-handling", "annonce", "social proof"
  text TEXT NOT NULL,                       -- the AI output, never mutated
  edited_text TEXT,                         -- owner override, nullable
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | edited | used | discarded
  used_on TEXT,                             -- free-form, e.g. "x.com/.../status/..." after manual post
  generated_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_product_status
  ON content_drafts(product_id, status, generated_at DESC);

ALTER TABLE products ADD COLUMN product_url TEXT;
ALTER TABLE products ADD COLUMN target_audience TEXT;
ALTER TABLE products ADD COLUMN value_props TEXT;        -- JSON array
ALTER TABLE products ADD COLUMN call_to_actions TEXT;    -- JSON array
ALTER TABLE products ADD COLUMN content_voice TEXT;
ALTER TABLE products ADD COLUMN content_language TEXT;
```

Migration is appended to the existing `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch used by ADR-0007 through ADR-0010. The `text` column is preserved verbatim once written; `edited_text` is the mutation surface. That split keeps "what the AI generated" auditable independent of "what the owner shipped" — a property ADR-0010's overwrite-on-reanalyze pattern does not have, and which we want here because content drafts have longer life-cycles than lead analyses.

## Generation pipeline

The shape mirrors ADR-0010's `intent-service.ts`. A new `content-service.ts` (sibling of `intent-service.ts` and `monthly-summary-service.ts`) owns:

- The OpenAI client construction, reusing `baseURL` and `GITHUB_TOKEN` from `ai-filter.ts`. No new env vars.
- The prompt builder, which assembles product metadata (`name`, `product_description`, `product_url`, `target_audience`, `value_props`, `call_to_actions`, `content_voice`, `content_language`) + a target source (`x` | `reddit` | `generic`) + a requested count N into a single user message.
- One LLM call per "Générer" click, JSON-mode response, Zod-validated.
- Bulk insert of N rows into `content_drafts` with `status='pending'`, `generated_at = now`, `text` from the model.

**Per-platform length constraints are baked into the prompt and re-checked server-side:**

- `target_source = 'x'`: max 280 chars per draft.
- `target_source = 'reddit'`: ~500 chars, conversational tone, no link spam.
- `target_source = 'generic'`: ~500 chars, LinkedIn-friendly framing.

Server-side overshoots are not auto-truncated (that ruins the post mid-sentence) — instead the row saves with a flag in `text` and the UI shows a "Dépasse la limite" warning so the owner can edit it down. Same soft-fail philosophy as ADR-0010's drafted-reply length guard.

**Required JSON shape:**

```json
{
  "drafts": [
    {
      "angle": "annonce | social-proof | objection-handling | curiosity-hook | ...",
      "text": "Le brouillon dans la langue et le ton demandés."
    }
  ]
}
```

Zod validates with `z.object({ drafts: z.array(z.object({ angle: z.string().max(60), text: z.string().min(1).max(2000) })).min(1).max(10) })`. The server caps the request N at 10; any higher is rejected before the LLM call.

## Failure semantics

Consistent with ADR-0010's `POST /api/intent-signals/:id/analyze` shape: the endpoint always returns **HTTP 200** with `{ success: boolean, message?: string, drafts?: ContentDraft[] }`. LLM 429s, JSON parse errors, Zod mismatches, and network failures all land as `{ success: false, message: '...' }` with no rows persisted. The UI surfaces the message inline and offers a retry button. Status codes stay reserved for client errors (400 on bad input, 404 on unknown product).

This is deliberate symmetry with ADR-0010: every owner-triggered LLM action in the codebase returns 200 with a structured success flag, so the dashboard can render uniformly.

## API surface

Three new endpoints on the Hono server:

- `POST /api/products/:id/content-drafts/generate` — body `{ targetSource: 'x' | 'reddit' | 'generic', count: 1-10 }`. Runs the LLM call synchronously, persists drafts, returns the new rows.
- `GET /api/products/:id/content-drafts?status=<status>` — paginated list, default `status=pending`, same pagination shape as `GET /api/runs` and `GET /api/intent-signals`.
- `PATCH /api/content-drafts/:id` — mutates `status`, `edited_text`, and/or `used_on`. Status transitions validated against the literal union `'pending' | 'edited' | 'used' | 'discarded'`. Setting `status='used'` stamps `used_at = now`.

No DELETE endpoint: discarded drafts stay in the DB with `status='discarded'` so the angle-history is preserved. Cheap rows, no PII, easy to query later for "which angles converted."

## Dashboard

New `/studio` page in the React app, added to `App.tsx` and the nav alongside `/leads`:

- Product picker at the top (same component as `/leads`).
- Generation panel: target-source select (`x` / `reddit` / `generic`), count slider (1–10), big "Générer des brouillons" button. Disabled while a call is in flight.
- Drafts list below, default filter `status=pending`. Each card shows: `angle` chip, character count with platform-limit indicator, the `text` (or `edited_text` if set), inline edit toggle, and four actions:
  - **Copier** — copies `edited_text || text` to clipboard. Does **not** change status — copying is not committing.
  - **Marquer publié** — sets `status='used'`, prompts for optional `used_on` URL.
  - **Modifier** — inline textarea, save sets `status='edited'` and writes `edited_text`.
  - **Écarter** — sets `status='discarded'`.
- Filter chips for status (`pending`, `edited`, `used`, `discarded`).
- A discreet "Suggestion — relisez avant de publier" banner under the generation panel, lifted verbatim from ADR-0010's drafted-reply disclaimer pattern.

The product settings page from ADR-0010 gains a "Contenu" section for the six new fields. Existing `product_description` and `reply_voice` from ADR-0010 stay where they are.

## Why NOT auto-publish

This is the load-bearing decision in this ADR, so it gets spelled out rather than assumed.

**The case for auto-publish (the temptation):**

- Zero copy-paste friction.
- Scheduler can space posts across the day for engagement-algorithm optimization.
- The same LLM call could fire on a cron — "publish 1 post per product per day."

**The case against, in concrete cost-benefit terms:**

| Concern | Reality |
|---|---|
| **Account bans** | X, Reddit, and HN all run bot-pattern detection on posting cadence, time-of-day distribution, and content fingerprints. Posting via cookies (the only way without official API access we have) violates ToS faster than scraping does — read-only scraping is tolerated, automated posting is the line. One ban kills the channel permanently. |
| **Reputation damage** | Followers detect AI tone within 3–5 posts on average. Once "this account is AI-generated" lands as a perception, churn is immediate and the recovery curve is months of manual posting with the same handle. |
| **No undo** | A discovered auto-bot reputation is a brand event, not a software event. There is no rollback. Compare to a bad drafted reply in ADR-0010, which the owner simply does not paste. |
| **Compliance complexity** | Reddit has per-subreddit karma thresholds, posting frequency rules, and self-promotion ratios. X has rate limits and content-policy review surface. HN has the showdead penalty box for promotional patterns. Encoding all of this into a scheduler is a quarter of engineering work for a feature that ships the trap. |
| **Concentration risk** | Jules' point from the ADR-0006 roundtable: the moment the platform is publishing live, every outage is a marketing outage. The platform stops being a tool and starts being load-bearing infrastructure for the brand. |

**The human-gated alternative — what this ADR ships:**

- ~90% of the velocity gain: drafts land in ~30 seconds instead of the 10–30 minutes it takes to write from scratch.
- Zero ban risk: every post still goes through the owner's hands and the platform's UI.
- Brand integrity preserved: the owner edits tone, fixes hallucinations, swaps CTAs before anything ships.
- Drafts can be A/B-tested cheaply: generate 5 angles, pick the strongest, post one. The discarded ones cost a handful of tokens.

The 10% velocity left on the table (the copy-paste step) is the price of the safety net. The ADR pays it.

## Cost discipline

One LLM call per "Générer" click, N drafts per call. Same model (`config.AI_MODEL`) as ADR-0010, payload comparable in size, no new model tier. Token usage logged via the existing `logger.info('Content generation API usage', { inputTokens, outputTokens, model })` pattern.

No per-product quota or daily budget in MVP — the owner self-regulates via the manual workflow. If usage data later shows runaway generation per product, a `content_draft_limit_per_day` knob on `product_settings` is the obvious next move.

## Consequences

### Positive

- Marketing velocity unlocked without crossing the auto-publish line ADR-0006 drew.
- Reuses 100% of the LLM plumbing built for ADR-0010: same client, same endpoint, same env var, same logging shape, same JSON-mode + Zod contract, same 200-with-success-flag failure semantics.
- The per-product content config (`product_url`, `target_audience`, `value_props`, `call_to_actions`, `content_voice`, `content_language`) is the same metadata a future auto-publish connector would need anyway. We are building the input scaffold now and earning the right to bolt on a connector later if and when human-gated workflows prove the safety case.
- Each draft is an isolated, persistable artifact — easy to keep, edit, delete, query, and later score for outcome.
- Studies the prompt + voice configuration in production, on real owner edits, so any future automation has empirical ground to stand on.

### Negative / Risks

- Per-product config surface grows. `products` already has 14+ columns after ADR-0007 through ADR-0010; this adds 6 more. The settings UI becomes denser and the product-update Zod schema gets longer. Mitigation: group the new fields under a "Contenu" section in the UI, and keep all six nullable so the schema growth is opt-in for the owner.
- LLM cost per generation is real. No caching, no per-product quota in MVP. One owner clicking "Générer N=10" ten times in a row is 100 drafts of token spend. Mitigation: deferred — surface token usage in logs first, add quotas only if the bill actually moves.
- Manual copy-paste workflow has human friction. The per-draft "Copier" button and the inline edit affordance are the mitigation; the friction itself is the safety feature and is not going away.
- Drafts can hallucinate feature claims about the owner's product. Same risk class as ADR-0010's drafted replies. Same mitigation: prominent "relisez avant de publier" labelling, manual paste forced, no auto-anywhere.

### Neutral

- `dev:once` is unaffected — Studio is dashboard-driven, not cron-driven. No new cron, no new concurrency guard.
- The `runs` table is not touched; generations are per-product mutations, not pipeline runs.
- Existing `/leads` and dashboard pages are unchanged in shape; Studio is an additive route.

## Explicitly NOT in scope for this ADR

- Comment-variant generation on Leads (extending the existing single `ai_drafted_reply` on `intent_signals` to N variants). Planned for ADR-0012.
- Auto-publish, scheduler, or third-party publishing connectors (Buffer, Typefully, Hypefury, Make, Zapier). Hard line.
- Per-platform hashtag intelligence ("which #tags are trending for indie-SaaS this week").
- A/B-test outcome tracking — measuring which `angle` converts. The schema preserves the data, the analysis is deferred.
- Multi-language beyond `fr` / `en`.
- Per-product cost tracking, token budgets, or daily generation quotas.
- Image / video / thread generation. MVP is single-post text.
- Reposting an existing `used` draft to a different platform — copy-paste covers it manually for MVP.

## Alternatives Considered

### Auto-publish to X via cookie session
Reuse the X cookie already authenticated for scraping to also POST tweets. Rejected, in detail, in the "Why NOT auto-publish" section above. Short form: ban risk, brand risk, no undo, compliance load. Same anti-feature stance as ADR-0006.

### Schedule drafts to a queue with a "publish at" timestamp, but require manual confirmation per draft
A middle ground where the platform queues drafts to fire on a schedule and pings Discord for one-click approval. Rejected for MVP: the per-draft confirmation surface (Discord buttons or a magic-link approval page) is real infrastructure, and the owner is one tab-switch away from the same outcome already. Revisit only if the copy-paste step proves to be a real bottleneck in usage.

### Generate drafts via a single endpoint that also analyzes leads
Bundle the Studio generation and the ADR-0010 lead analysis into one `POST /api/products/:id/llm` polymorphic endpoint. Rejected: the two flows have different inputs (leads vs product context), different outputs (one analysis row vs N draft rows), and different UI consumers. Splitting them keeps each endpoint shaped to its consumer, matching the precedent set in ADR-0010.

### Store drafts in `intent_signals` with a `kind` discriminator
Reuse the existing table by adding a `kind = 'draft'` row variant. Rejected: `intent_signals` rows are derived from a source item; content drafts have no source-item ancestor. Cramming them into the same table breaks the foreign-key story to `tweets` and forces every lead-list query to filter `kind`. A separate `content_drafts` table with its own foreign key to `products` is the correct shape, same reasoning as ADR-0009's separate-table-over-in-place-column decision.

### One LLM call per draft (loop N times client-side)
Issue N separate LLM calls to get N angles. Rejected: 5x cost and 5x latency for what is a one-shot enumeration task. The single-call-N-drafts JSON shape is the same model-as-batcher pattern that worked in ADR-0010, just with an array output.

### Skip the `edited_text` column and mutate `text` in place
One column, the owner overwrites it. Rejected: drafts have longer life-cycles than lead analyses, and "what did the model originally say" is useful both for future angle-effectiveness analysis and for the obvious "undo my edit" UI affordance. The two-column split is cheap and unlocks both.

## Future

- **ADR-0012 (likely):** comment-variant generation on Leads. Extend the existing single `ai_drafted_reply` on `intent_signals` to N variants — same one-call-N-outputs shape as this ADR, layered on top of ADR-0010's per-signal analyze flow. Schema delta: an `ai_drafted_replies` JSON column or a sibling `intent_signal_reply_drafts` table; decision deferred to that ADR.
- **ADR-0013 (possible):** Buffer / Typefully / Hypefury connector. The point of a third-party publishing tool is that the human gate stays AT the connector (Buffer's review queue, Typefully's approval step), not in this codebase. That keeps the auto-publish trap contained behind a vendor we did not have to build. Only lands if the manual copy-paste step is empirically a bottleneck.
- **ADR-0014 (further out):** outcome tracking per draft. Requires the owner to share UTM-stamped URLs or wire a click-tracker. Schema extension on `content_drafts` for `clicks`, `replies`, `impressions`. Deferred until at least 50 drafts in `status='used'` exist to analyze.
- Per-platform hashtag intelligence and trending-topic injection, if and when the prompt's "current context" signal proves to be the missing ingredient.
- Multi-language beyond `fr` / `en`, when a product targets a third-language community in earnest.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed the separate `content_drafts` table over reusing `intent_signals`; defended the two-column `text` / `edited_text` split as cheap audit primitive; advocated reusing ADR-0010's 200-with-success-flag failure shape over inventing a new error contract.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed reuse of the existing GitHub Models pipeline byte-for-byte; vetoed any form of scheduler or auto-publish in MVP; approved the single-call-N-drafts JSON shape over a per-draft loop.
- Sprint Zero Sarah (Product Owner) — Cut auto-publish, scheduler, third-party connectors, outcome tracking, hashtag intelligence, image generation, and per-product quotas from scope; held the line on the manual copy-paste workflow as the safety feature, not a friction to remove.
- Edge-Case Nico (QA Engineer) — Flagged the LLM-hallucinated feature-claim risk and the runaway-generation-cost risk; both captured as deferred mitigations with the prominent "relisez avant de publier" label and the logged token usage as the immediate safety nets.

---
_Decision recorded automatically from fast-meeting analysis._
