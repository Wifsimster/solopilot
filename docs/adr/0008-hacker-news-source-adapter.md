# 0008. Hacker News source adapter

Date: 2026-05-25

## Status

Accepted

## Context

The multi-product marketing platform now runs X (ADR-0006) and Reddit (ADR-0007) side by side in production. ADR-0007 generalised the port to `SourceReader` precisely so the third source would cost almost nothing to add. The bill comes due now: the owner wants Hacker News as the third high-signal channel for tech-product audiences, complementing Reddit's intent threads and X's broadcast noise.

Hacker News exposes a free, zero-auth Algolia Search API (`https://hn.algolia.com/api/v1/`) that returns clean JSON and supports keyword queries with a unix-timestamp filter — exactly the shape our `fetchSince(productId, sinceTs)` contract expects. No cookies, no GraphQL operation-ID drift like X, no User-Agent gating like Reddit. It is the cheapest possible third source and the one most likely to surface deep-tech product mentions that never make it to X or Reddit.

This ADR is deliberately the sibling of ADR-0007: same port, same table, same cron, one new file in `adapters/`, two columns on `products`. If the abstraction works, this should read as boring. That is the point.

## Decision

Add `hn-reader.ts` as a third `SourceReader` with `source: 'hn'`. Extend the `Item.source` discriminator union to `'x' | 'reddit' | 'hn'`. IDs are prefixed `hn:<objectID>` to match the source-prefixed scheme established in ADR-0007.

Use Algolia HN Search rather than the official Firebase API. The Firebase API is pull-based (fetch IDs, then fetch each item) and has no keyword index — keyword search on Firebase means dragging the full corpus client-side, which is absurd. Algolia is purpose-built for this and is what every HN third-party reader uses in production.

Per-product configuration uses keywords, not subreddit-style buckets. Each product configures a list of search terms via a new `hn_keywords` JSON column. Reddit's `reddit_subreddits` and HN's `hn_keywords` stay as separate fields rather than collapsing into a generic `topics` concept — subreddits are named buckets, HN keywords are free-form strings, and conflating them in the UI would lie to the owner about what each source actually queries.

The collect loop in `collect-service.ts` already iterates `[x, reddit]` per product gated by enable flags; this ADR extends the iteration to `[x, reddit, hn]`. Single shared cron, sequential per-source fetch per product — same shape as ADR-0007.

## Schema changes

```sql
ALTER TABLE products ADD COLUMN hn_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN hn_keywords TEXT; -- JSON array, e.g. '["typescript","sqlite","claude code"]'
```

Existing rows backfill safely via the `DEFAULT 0` clause — every existing product stays HN-disabled until the owner opts in. Migration is appended to the `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch as ADR-0007's three ALTERs.

No new table. The `tweets` table (already mis-named per ADR-0007) now also holds HN stories. Naming debt stays where it is.

## Adapter specifics

- Endpoint: `https://hn.algolia.com/api/v1/search_by_date?query=<urlencoded>&tags=story&numericFilters=created_at_i>{sinceTs}`.
- One query per keyword per collect tick. Results merged across keywords and deduplicated by `objectID` in-process before insert; the existing `INSERT OR IGNORE` on the source-prefixed primary key catches anything that slips through.
- `tags=story` filters out comments and the Ask HN / Show HN feeds. This is conservative — story posts are the high-signal subset for product discovery. Ask/Show expansion is deferred (see out of scope).
- Field mapping: `title` (plus `story_text` when present, joined with `\n\n`) → `text`, `hn:<author>` → `author`, external `url` when set otherwise `https://news.ycombinator.com/item?id=<objectID>` → `url`, `created_at_i` (unix seconds) → `createdAt`, `objectID` → `id` with `hn:` prefix.
- `User-Agent: x-ai-weekly-bot/<version>` is sent for politeness even though Algolia does not require it. Costs nothing, signals good citizenship if Algolia ever decides to care.
- On HTTP errors (including 429): warn-log the keyword and return an empty array for that query. Never throw out of the per-keyword fetch. Other keywords and other sources keep going — one bad keyword does not kill the product's collect tick.

## AI summary impact

The summarizer prompt gains a third top-level section appended after Reddit:

> Structure the digest with one section per source, in the order: X, then Reddit, then Hacker News. Empty sections are omitted.

No model change, no endpoint change, no measurable token-budget impact. Per-product `ai_prompt_override` from ADR-0006 still applies.

## Source-agnostic flow validation

The real test of this ADR is whether the collect loop needs any structural change. It does not: the loop already takes an array of `SourceReader` instances and iterates them. Adding HN is one new entry in the per-product reader-list builder, gated by `hn_enabled`. Zero new branches in business code. This confirms the ADR-0007 port shape generalises to N sources, not just two.

## Consequences

### Positive

- Zero new architecture. The port did its job.
- Owner gets HN signal for tech-product audiences — the channel where deep-tech mentions and Show HN launches surface before anywhere else.
- Free and zero-auth. No credential to rotate, no OAuth lifecycle, no rate-limit horror.
- Algolia's API is one of the most reliable services on the public web in practice — used by HN itself, by hnrss, by countless readers.
- Sets the template for the next adapters (Bluesky, ProductHunt) — each is now provably one file plus two columns.

### Negative / Risks

- Keyword search is noisier than subreddit fetching. A product configuring a generic term like `ai` will flood its digest with low-signal stories. Mitigation: owner discipline — pick specific terms. No server-side per-keyword cap in this ADR; will revisit if a real product gets buried.
- Algolia has no SLA. Mitigation: collect-tick failure is non-fatal (warn-log, empty result, next tick retries), and the official Firebase API remains as a fallback if Algolia ever disappears.
- Adding a third source per product proportionally increases collect-tick duration. Acceptable at current product count; sequential iteration stays cheap until we have dozens of products.

### Neutral

- The dashboard's product settings page gains one checkbox (`hn_enabled`) and one keyword-list editor. Same shape as Reddit's subreddit editor — copy-paste of the existing component.
- `dev:once` honours `hn_enabled` automatically via the same enable-flag iteration.

## Explicitly NOT in scope for this ADR

- Comment-thread / Ask HN / Show HN expansion (story-only via `tags=story` for now).
- HN front-page scraping. Algolia covers everything front-page does, plus the long tail.
- Per-keyword result caps or cross-product deduplication.
- Trend-detection, point-score thresholds, or any ranking beyond Algolia's `search_by_date` ordering.
- A unified `keywords` first-class concept cross-cutting X / Reddit / HN — that is ADR-0009 territory.

## Alternatives Considered

### HN front-page scraping only
Pull the top 30 from `news.ycombinator.com` and call it a day. Rejected: the front page is great for "what is HN talking about today" but useless for product-specific signal — a niche tool mention in a Tuesday thread never makes the front page. Keyword search is the whole point.

### Official HN Firebase API
Use `https://hacker-news.firebaseio.com/v0/`. Rejected: pull-based with no keyword index. Doing keyword search on Firebase means fetching tens of thousands of item IDs and filtering client-side every collect tick. Algolia is purpose-built for the use case and is what the HN team itself recommends for search.

### Shared topic abstraction with Reddit
Collapse `reddit_subreddits` and `hn_keywords` into one `topics` JSON column with per-source semantics decided at fetch time. Rejected: subreddits are named buckets validated against a 2–21 char pattern, HN keywords are free-form Algolia queries — the validation, UX, and failure modes are different enough that a shared field would lie to the owner about what each source actually does. Keep them separate, accept the slight schema bloat.

### Authenticated HN API
There is no authenticated HN API worth the name. Non-starter.

## Future

- Bluesky and ProductHunt are next in the source queue. Same pattern: one file in `adapters/`, two columns on `products`, one literal added to the `source` union.
- ADR-0009 will likely introduce intent-keyword lead extraction as a cross-source concern — picking up posts on X, Reddit, and HN that contain phrases like "anyone know a tool for X". That changes how items are *filtered*, not how they are *fetched*, so it sits orthogonal to this ADR.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed Algolia over Firebase on the keyword-index argument; advocated `tags=story` as the conservative default; held the line on per-keyword failure isolation so one bad query never kills a product's tick.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed the ADR-0007 port shape covers N sources with no structural change; approved keeping `reddit_subreddits` and `hn_keywords` as separate columns over a generic `topics` field.
- Sprint Zero Sarah (Product Owner) — Cut Ask/Show HN, front-page scraping, and per-keyword caps from scope; flagged the "owner picks specific terms" mitigation as a documentation problem, not a code problem.
- Edge-Case Nico (QA Engineer) — Flagged the noise risk on generic keywords and the no-SLA exposure on Algolia; both captured as deferred mitigations with the warn-log-and-continue fallback as the safety net.

---
_Decision recorded automatically from fast-meeting analysis._
