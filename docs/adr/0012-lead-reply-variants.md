# 0012. Lead Reply Variants — From Single Drafted Reply to N Angles

Date: 2026-05-25

## Status

Accepted

## Context

ADR-0010 shipped on-demand AI analysis of intent signals: one click on a lead row produced a score, an explanation, and one drafted reply in the product's configured voice. Verification on PR #32 confirmed the loop works end-to-end — owner sees a substring-matched signal, presses "Analyser", gets a score and a paste-ready response in French. The painkiller landed.

What it did not do is give the owner anything to **choose from**. A single drafted reply forces a binary: paste it, or regenerate it and lose the previous draft. There is no "the first one was almost right but I prefer the second one's hook." There is no comparison surface. The owner who edits heavily ends up writing the reply themselves with the model's draft as a stepping stone — which is fine, but it is not the leverage the analyze flow was supposed to unlock.

ADR-0011 just shipped the Content Studio with the **N drafts with different angles** pattern for proactive promotional posts. One LLM call, JSON-mode response, an array of `{angle, text}` objects, persisted as first-class artifacts in `content_drafts`. The owner picks the strongest, edits if needed, copies it out. Verification on PR #33 showed the model produces meaningfully different content when the prompt asks explicitly for distinct angles — "annonce" vs "objection-handling" vs "social-proof" come back as genuinely different drafts, not paraphrases of each other.

This ADR brings the same pattern to the reactive side of the loop. Replies on Leads get the N-variants treatment that posts in Studio already have.

## Decision

The `POST /api/intent-signals/:id/analyze` endpoint now generates **3 reply variants per call** (configurable, default 3, range 1–5). Each variant has a short `angle` label — French strings like `"question directe"`, `"preuve sociale"`, `"résumé du problème + solution"` — and a `text` body in the product's `reply_voice`. Variants persist in a new `intent_signal_replies` table linked to the signal by foreign key. A new `POST /api/intent-signals/:id/replies/generate` endpoint lets the owner regenerate variants without re-running the scoring pass, and a "Générer 3 autres" button on the Lead card surfaces it.

Same one-call-N-outputs LLM shape as ADR-0011's Studio generator. Same JSON-mode + Zod contract. Same 200-with-success-flag failure semantics as ADR-0010. The reply prompt from ADR-0010 is reused, multiplexed for N outputs with an explicit "use a different angle" instruction borrowed byte-for-byte from the Studio prompt.

## Why a new table instead of widening `ai_drafted_reply` to JSON

- **Audit trail per variant.** Each variant gets its own `generated_at` and `used` flag. The model rev that produced a variant, the timestamp it landed at, and whether the owner shipped it are all queryable independently.
- **Per-variant `used` tracking.** The owner can mark which variant they actually pasted. Future outcome-tracking work (ADR-0013 territory) needs that primitive; bolting it onto a JSON blob later is more migration work than adding the table now.
- **Cleaner queries.** `GET /api/intent-signals/:id/replies` returns rows, not a parsed blob. No JSON_EXTRACT, no in-app parsing of a column on the hot list path.
- **The old `ai_drafted_reply` column stays populated** with `variants[0].text` for backwards compatibility and for quick-display contexts (Discord push when it arrives, list-view summary). Cleanup ADR can drop it once nothing reads it.

This is the same separate-table-over-in-place-column reasoning ADR-0009 used for `intent_signals` vs a column on `tweets`, and the same audit-trail-via-row-not-blob shape ADR-0011 used for `content_drafts`.

## Schema

```sql
CREATE TABLE IF NOT EXISTS intent_signal_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_signal_id INTEGER NOT NULL REFERENCES intent_signals(id) ON DELETE CASCADE,
  angle TEXT,                                  -- short label, e.g. "question directe", "preuve sociale"
  text TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  generated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_isr_signal
  ON intent_signal_replies(intent_signal_id, generated_at DESC);
```

Migration appended to the existing `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch used by ADR-0007 through ADR-0011. The `ON DELETE CASCADE` keeps the table clean when a product is removed and its signals are deleted by ADR-0009's cascade.

`ai_drafted_reply` on `intent_signals` is **not** dropped in this ADR. It is written on every analyze call with `variants[0].text` and the new table is written alongside it. That dual-write keeps the older signals (created before this ADR's PR) renderable without a backfill migration, and gives the frontend a single fallback path during rollout.

## API surface

Three endpoint changes, two new endpoints:

- **Modified** `POST /api/intent-signals/:id/analyze` — same shape, accepts an optional `count` body field (1–5, default 3). The returned `IntentSignalView` now includes a `replies` array of `{ id, angle, text, used, generated_at }` rows. The legacy `ai_drafted_reply` field on the view stays populated with the first variant's text.
- **New** `POST /api/intent-signals/:id/replies/generate` — generates N more variants without re-running scoring. Cheaper LLM call (no scoring prompt overhead, smaller input, smaller output schema). Accepts optional `count` (1–5, default 3). Returns the newly inserted rows. Same 5-minute server-side cooldown as `analyze` to prevent click-spam.
- **New** `GET /api/intent-signals/:id/replies` — list all variants for a signal, ordered by `generated_at DESC`. Used by the Lead card on initial load when the signal already has variants.
- **New** `PATCH /api/intent-signal-replies/:id` — body `{ used: boolean }`. Toggles the `used` flag. Setting `used=true` on one variant does **not** auto-unset others — the owner may have posted the reply on X and a slight variant on Reddit, and both are legitimately "used." Multi-used is allowed by design.

The existing `PATCH /api/intent-signals/:id` for status/notes from ADR-0009 is untouched. No breaking change to the signal-list shape — `replies` is purely additive on the view object.

## LLM call strategy

One JSON-mode call returns `{ replies: [{angle, text}, ...] }` of length N. The existing reply prompt from ADR-0010 is reused as the per-variant template; the system prompt gains one instruction lifted from the Studio prompt: `"Génère N variantes avec des angles distincts. Chaque variante doit avoir un angle différent (ex: question directe, preuve sociale, résumé du problème + solution)."` Per-source character limits still apply per variant (X: 280, Reddit / HN: 500), validated server-side after the JSON parse.

**Required JSON shape on the `replies/generate` endpoint:**

```json
{
  "replies": [
    {
      "angle": "question directe | preuve sociale | résumé du problème + solution | ...",
      "text": "La réponse en français dans le ton demandé, sous la limite de caractères de la source."
    }
  ]
}
```

Zod validates with `z.object({ replies: z.array(z.object({ angle: z.string().max(60), text: z.string().min(1).max(500) })).min(1).max(5) })`. The server caps `count` at 5; anything higher is rejected before the LLM call.

The `analyze` endpoint returns the same `replies` array nested inside the score / explanation envelope from ADR-0010 — one LLM call still does score + explanation + N drafts, the only delta is the drafts field is now an array instead of a single string. JSON-mode keeps the contract bounded.

## Failure semantics

Consistent with ADR-0010 and ADR-0011: every owner-triggered LLM endpoint returns **HTTP 200** with `{ success: boolean, message?: string, ... }`. LLM 429s, JSON parse errors, Zod mismatches, and network failures all land as `{ success: false, message: '...' }` with **no partial inserts** — the N row INSERTs run inside one transaction after JSON validation succeeds, so either all variants persist or none do.

Status codes stay reserved for client errors (400 on bad input, 404 on unknown signal, 429 on the 5-minute cooldown). Same uniform shape across all three LLM endpoints in the codebase.

## Dashboard

The Lead card on `/leads` from ADR-0009 / ADR-0010 grows a variants surface inside the AI block:

- When `replies` is non-empty, the card renders a **vertical stack of variant cards** instead of the single textarea pattern. Each variant card shows the `angle` as a small chip badge at the top, an editable textarea pre-filled with `text`, a character count with platform-limit indicator, and two action buttons: **Copier** (copies the current textarea content) and **Marquer utilisée** (PATCHes `used=true`). Variants already marked used get a subtle "Utilisée" badge and a lighter background.
- A **"Générer 3 autres"** button at the bottom of the stack triggers the regenerate endpoint. Disabled while a call is in flight. Newly returned variants prepend to the stack since `generated_at DESC` is the order.
- The legacy single-textarea pattern from ADR-0010 is gone for new signals. `ai_drafted_reply` is still rendered as a fallback **only** when `intent_signal_replies` has zero rows for the signal — i.e. signals analyzed before this ADR's PR. New analyses always populate both, so this fallback path only exists for pre-PR-34 historical data.
- The "Suggestion — relisez avant d'envoyer" label from ADR-0010 stays, lifted verbatim above the variant stack.

No new route, no new nav entry. This is an additive change to the existing `/leads` card.

## Cost discipline

- **One analyze call now produces N variants** rather than one. Same input tokens (score + explanation overhead is unchanged), slightly more output tokens (3x the reply body in the typical N=3 case). Net per-click cost is ~1.5–2x ADR-0010's per-click cost, not 3x, because the score + explanation tokens dominate the output for short replies.
- **Default N=3 is the chosen balance** — enough variants to pick from, not enough to multiply spend per lead. Same N=3 default ADR-0011's Studio settled on for the same reason.
- **Regenerate is a separate user click** — predictable cost, same gate as the original analyze. The owner who wants twelve variants pays for four clicks; the owner who is happy with the first three pays for one.
- No new model tier, no new env var, no new endpoint shape. Token usage logged via the same `logger.info('Intent analysis API usage', ...)` pattern from ADR-0010, with `variantCount` added to the structured payload so per-call output volume is visible.

## Consequences

### Positive

- Closes the loop on the original roundtable's painkiller: the owner now **picks the best reply** rather than reroll-or-commit. The leverage step ADR-0010 was missing.
- Same UX pattern as Studio (ADR-0011) — vertical stack of variant cards with angle chip + edit + copy actions. Consistent mental model across reactive replies and proactive posts.
- Per-variant `used` flag is the primitive any future outcome-tracking ADR needs. "Which angle converted" becomes a SQL query, not a schema migration.
- Reuses 100% of the LLM plumbing from ADR-0010 and ADR-0011: same client, same endpoint, same env var, same JSON-mode + Zod contract, same 200-with-success-flag failure shape.
- Schema delta is one new table with one index. Reversible by ignoring the new table.

### Negative / Risks

- Schema grows by one table plus FK and index. `intent_signals` is no longer the single source of truth for "what the owner sees on a lead" — the variant rows have to be joined in. Mitigation: the `GET /api/intent-signals` list endpoint can keep returning the legacy `ai_drafted_reply` for list-view summaries without joining; the join only happens on the detail/card view.
- Lead cards become visually denser — three variant cards instead of one textarea. Mitigation: the AI block collapses by default when the signal has no `ai_processed_at`, and the variant stack only renders inside the expanded block.
- The deprecated `ai_drafted_reply` column stays around with dual-write logic. Small technical debt until a future cleanup ADR drops it. Accepted: removing it now would force a frontend release-coupling that this ADR is choosing not to take on.
- Per-variant length validation has to apply to every row, not just the canonical one. Mitigation: same server-side truncation + `ai_error` soft-warning shape from ADR-0010, applied per-variant inside the transaction.

### Neutral

- `dev:once` is unaffected — variants are dashboard-driven, not cron-driven. No new cron, no new concurrency guard.
- The `runs` table is not touched. Variants are per-signal mutations, not pipeline runs.
- The Studio `/studio` page from ADR-0011 is unchanged. Reply variants and content drafts share a prompt convention but not a code path.

## Explicitly NOT in scope for this ADR

- A/B-test outcome tracking per variant — no replies, clicks, or engagement signals captured. The `used` flag is the only outcome primitive in MVP.
- Per-platform style tuning beyond character limits (Reddit casual vs X punchy vs HN formal). One `reply_voice` per product, same as ADR-0010.
- Auto-pick "best" variant via a secondary LLM judge call. The owner picks. Opaque automation is exactly the kind of thing ADR-0006 and ADR-0011 drew lines around.
- Posting / Buffer / Typefully connector — separate ADR, same hard line as ADR-0011's "no auto-publish."
- Multi-language variants beyond the product's `content_language` setting from ADR-0011 (which `reply_voice` does not yet read — that is its own future cleanup).
- Backfilling variants for pre-PR-34 signals — those keep their single `ai_drafted_reply` forever unless re-analyzed.
- Per-variant Discord push.

## Alternatives Considered

### Single reply, regenerate as overwrite
Keep the ADR-0010 shape, add a "Régénérer" button that overwrites `ai_drafted_reply` in place. Rejected: loses history, no comparison surface, the owner cannot say "I liked the second-to-last one better." The whole point of this ADR is the comparison surface; overwriting throws it away.

### Widen `ai_drafted_reply` to a JSON array on `intent_signals`
One column, JSON-encoded `[{angle, text, used}, ...]`. Rejected: no per-variant audit trail, harder to query (every list endpoint either parses the blob or carries it through opaque), and harder to migrate to a real table later if outcome tracking lands. Same reasoning ADR-0011 used for `content_drafts` over a JSON column on `products`.

### Generate N variants in N separate LLM calls
Loop the existing single-reply endpoint N times client-side. Rejected: 3x cost and 3x latency for marginal quality gain. The single-call-N-outputs JSON shape worked in ADR-0011 and works here. The model has enough context to enumerate N distinct angles in one pass.

### Auto-pick "best" variant via a secondary LLM judge call
After generating N variants, run a second LLM call that picks the strongest and surfaces it as the default. Rejected: opaque to the owner ("why this one?"), hard to learn from (the owner cannot tell if the model picked the angle they would have), removes user agency on the exact step this ADR exists to give them. The owner picks. The variant cards are equal-weighted in the UI.

### Reuse `content_drafts` from ADR-0011 with a `kind = 'reply'` discriminator
Cram reply variants into the existing draft table. Rejected: `content_drafts` rows hang off `products`, not signals. The foreign-key story is wrong — a reply variant is meaningless without its signal context. Same separate-table-over-discriminator reasoning ADR-0011 used to reject reusing `intent_signals` for content drafts. Symmetry across the two pivot decisions.

## Future

- **ADR-0013:** outcome tracking per variant. Mark a variant as "replied → engagement received" with link or screenshot attachment. Schema extension on `intent_signal_replies` for `outcome`, `outcome_at`, `outcome_url`. Deferred until at least 30 variants are in `used=1` to analyze.
- **ADR-0014 (possible):** per-platform style profiles. Reddit casual vs X punchy vs HN formal. Either a per-platform `reply_voice` enum or a per-platform prompt template selector on the product. Only lands if owner edits show consistent per-platform drift that the single-voice setting cannot capture.
- **Cleanup ADR:** drop the deprecated `ai_drafted_reply` column on `intent_signals` once the frontend stops reading it and pre-PR-34 signals have aged out of the active triage window.
- Score-gated auto-generate-on-collect for the top-percentile leads — same instinct ADR-0010 rejected, revisitable once usage data shows which patterns are worth the unconditional spend.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed the separate `intent_signal_replies` table over a JSON column on `intent_signals`; defended the dual-write to the legacy `ai_drafted_reply` column as the no-backfill rollout primitive; advocated reusing ADR-0010's 200-with-success-flag failure shape and ADR-0011's one-call-N-outputs JSON shape over inventing new contracts.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed reuse of the existing GitHub Models pipeline byte-for-byte; vetoed any auto-judge or auto-pick layer in MVP; approved the multi-used variant model (no auto-unset on `used=true`) as the cross-platform correctness primitive.
- Sprint Zero Sarah (Product Owner) — Cut outcome tracking, per-platform style tuning, auto-best-pick, posting connectors, and per-variant Discord push from scope; held the line on N=3 default and 1–5 range as the cost-discipline ceiling; held the line on owner picks the variant, not a model.
- Edge-Case Nico (QA Engineer) — Flagged the per-variant length-overshoot risk under multiplexed generation and the dual-write divergence risk between `ai_drafted_reply` and `intent_signal_replies`; both captured as deferred mitigations with the per-variant server-side truncation and the single-transaction insert as the immediate safety nets.

---
_Decision recorded automatically from fast-meeting analysis._
