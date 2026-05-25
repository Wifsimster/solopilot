# 0007. Source abstraction and Reddit adapter

Date: 2026-05-25

## Status

Accepted

## Context

ADR-0006 made the bot multi-product but left source acquisition single-channel: every product still pulls from X via `scraper-reader.ts`. The owner now needs Reddit alongside X for product mentions and intent signals — subreddits are where indie-product audiences ask "what do you use for X" out loud, and the existing X-only stream misses that traffic entirely.

Reddit's official public JSON API is the cheapest possible second source: append `.json` to any URL (`https://www.reddit.com/r/<sub>/new.json?limit=100`), no OAuth, no API key, generous unauthenticated rate limits as long as a real User-Agent is sent. It is the obvious MVP partner for X.

The existing `TweetReader` port in `ports.ts` is a single-method interface (`fetchRecentTweets`). Generalizing it costs almost nothing; the alternative — a second parallel port `RedditReader` — would force every consumer (`collect-service.ts`, the run orchestrator, the AI summarizer) to branch by source, which is exactly what a port is meant to prevent.

ADR-0006 explicitly flagged this generalization as deferred until the second implementation lands. The second implementation is landing now.

## Decision

Rename the port `TweetReader` → `SourceReader` and the data shape `Tweet` → `Item`, with a `source: 'x' | 'reddit'` discriminator and source-prefixed IDs (`x:<tweet_id>`, `reddit:<t3_id>`). Add `reddit-reader.ts` as the second concrete `SourceReader`.

Keep the SQLite table named `tweets`. Add a `source` column with `DEFAULT 'x'` so existing rows backfill silently. The table name is now mildly misleading, but renaming it costs a real migration with foreign-key rewrites in `runs` and `monthly_summaries` for zero behavioural gain. We accept the naming debt.

Per-product source selection lives on the `products` table: `x_enabled`, `reddit_enabled` flags plus `reddit_subreddits` as a JSON array of subreddit names. The collect cron iterates products, then for each product iterates its enabled sources sequentially in-process. Single shared cron, no fan-out per source — same reasoning as ADR-0006's single sweep over products.

The AI summarizer receives a mixed-source `Item[]` for a product and emits one combined digest grouped by source. Same model, same endpoint, prompt gains a "Each item has a source (x or reddit). Group your digest by source." instruction.

## Schema changes

```sql
ALTER TABLE tweets   ADD COLUMN source TEXT NOT NULL DEFAULT 'x';
ALTER TABLE products ADD COLUMN x_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN reddit_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN reddit_subreddits TEXT; -- JSON array, e.g. '["webdev","SaaS"]'
```

Existing rows backfill safely via the `DEFAULT` clauses. Migration is appended to the existing `MIGRATIONS` array in `db.ts`, wrapped in the same `runAlterMigrations` try/catch so re-runs are idempotent.

## Port shape

```ts
export type Item = {
  id: string;           // 'x:1234' or 'reddit:t3_abc'
  source: 'x' | 'reddit';
  text: string;
  author: string;
  url: string;
  created_at: number;   // unix seconds
  fetched_at: number;
  product_id: string;
};

export interface SourceReader {
  source: 'x' | 'reddit';
  fetchSince(productId: string, sinceTs: number, opts: SourceOpts): Promise<Item[]>;
}
```

The existing `fetchRecentTweets()` method becomes `fetchSince(productId, sinceTs, opts)`. The X adapter wraps its current lookback-based logic to honour `sinceTs`; the Reddit adapter implements it natively via `/new.json` pagination.

## Reddit adapter specifics

- Endpoint: `https://www.reddit.com/r/{subreddit}/new.json?limit=100`.
- Unauthenticated. A `User-Agent: x-ai-weekly-bot/<version>` header is **required** to avoid 429s — Reddit aggressively blocks default Node/curl UAs.
- Per-subreddit fetch then merge. Dedup by Reddit `t3_*` ID at insert time via the existing `INSERT OR IGNORE` on the `tweets` primary key (now namespaced by source prefix).
- Field mapping: `title + "\n\n" + selftext` → `text`, `u/<author>` → `author`, `https://reddit.com<permalink>` → `url`, `created_utc` → `created_at`.
- No JS rendering, no cookies, no GraphQL operation ID drift like X. The adapter is roughly a third the size of `scraper-reader.ts`.

## Rate-limiting and resilience

Reddit's unauthenticated quota is sufficient for our cron cadence but a chatty product configuration (10+ subreddits, hourly collection) can trip a 429. The adapter handles this with a simple in-process exponential backoff on 429: first retry after 5s, second after 30s, then give up for this tick and let the next cron run pick up. No retry queue, no Redis, consistent with ADR-0006's "no external job queue" stance.

A persistent rate-limit problem is mitigated by stretching the product's `collect_cron` interval rather than by adding infrastructure. If we hit the wall hard enough that this is not enough, the escape hatch is OAuth-authenticated Reddit (60 requests/minute per user) — captured below as out of scope.

## AI summary impact

The summarizer prompt gains one paragraph:

> Each item has a `source` field (`x` or `reddit`). Structure the digest with one section per source, in the order: X, then Reddit. Within each section, group by author when an author has multiple items.

No model change, no token-budget change of consequence (the source field adds ~10 tokens per item). Per-product `ai_prompt_override` from ADR-0006 still applies and can replace this section entirely if a product wants a different layout.

## Consequences

### Positive

- Owner gets Reddit signal on day one of the marketing-platform pivot. Subreddit intent-mentions are a much higher-converting lead source than X timeline noise.
- The port stays one method. Every existing call site upgrades by adding `source` to the resulting items; no branching by source in business code.
- Schema delta is three `ALTER TABLE`s with safe defaults. Reversible by ignoring the new columns.
- Sets the template for future sources (HN Algolia, Bluesky, ProductHunt) — each is a new file in `adapters/` and a new value in the `source` literal union.
- Reddit is a redundant channel if the X cookie dies, partially mitigating the single-point-of-failure risk flagged in ADR-0006.

### Negative / Risks

- The `tweets` table name is now misleading — it holds X tweets and Reddit posts. Accepted: rename cost > naming clarity.
- Reddit's public JSON API has no SLA and Reddit has historically tightened unauth access without warning (the 2023 API-pricing episode killed third-party apps). Mitigation: OAuth path is well-understood and a one-day swap-in if it happens.
- Combined digests can get noisy when a product enables many subreddits. Mitigation: per-source caps in product settings (e.g. `reddit_max_items_per_run`) — deferred until a product actually hits the limit.

### Neutral

- The `dev:once` one-shot mode still works; it now respects `x_enabled` / `reddit_enabled` on the target product.
- The dashboard's Settings → Product page gains two checkboxes and a subreddit-list editor. No new screens.

## Explicitly NOT in scope for this ADR

- OAuth-authenticated Reddit access — deferred until rate limits actually bite.
- Reddit posting / cross-posting — same anti-feature stance as ADR-0006's auto-posting rejection. We read and summarize; we do not impersonate.
- Comment-thread expansion (fetching replies under a post) — useful for intent signal, separate ADR.
- Bluesky, Hacker News Algolia, ProductHunt adapters — separate ADRs, each lands as one file in `adapters/`.
- Intent-keyword lead extraction (filtering posts containing "anyone know a tool for X") — separate ADR, orthogonal to source acquisition.
- Renaming the `tweets` table to `items` — explicitly rejected here, see Alternatives.

## Alternatives Considered

### Rename `tweets` → `items`
Migrate the table name to match the new `Item` type. Rejected: requires rewriting foreign-key references in `runs` and `monthly_summaries`, breaks every existing query in `tweet-store.ts`, and the dashboard's run history would need a coordinated deploy. The naming debt is a one-line comment in `tweet-store.ts`; the migration is a half-day of churn for zero behavioural improvement.

### One table per source (`tweets`, `reddit_posts`)
Keep `tweets` X-specific and add a parallel `reddit_posts` table. Rejected: cross-source queries (the daily digest, monthly summaries, dashboard "all items for product X") become `UNION ALL` gymnastics. The AI summarizer would need a union-and-sort step. Every new source doubles the join surface. Single table with a `source` column is the standard answer.

### OAuth Reddit from day one
Implement the full OAuth flow (script-type app, refresh tokens, 60 req/min quota). Rejected: public JSON is sufficient for our volume, OAuth adds a credential-management screen to the dashboard and a refresh-token lifecycle in the adapter. Ship the cheap version, upgrade when forced.

### Separate `RedditReader` port alongside `TweetReader`
Keep `TweetReader` as is, add a parallel `RedditReader` interface. Rejected: violates open/closed — every new source forces a new port and a new code path in `collect-service.ts`. One generic `SourceReader<Item>` is the right shape and the rename cost is minimal (one file, four import sites).

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed the `source` column over a new table; defended keeping the `tweets` table name to avoid foreign-key migration; advocated source-prefixed IDs to keep dedup uniform across sources.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed `SourceReader` generalization over parallel ports; approved single-cron sequential source iteration consistent with ADR-0006's per-product sweep.
- Sprint Zero Sarah (Product Owner) — Cut OAuth, comment-thread expansion, and intent-keyword extraction from scope; held the line on "two sources, one digest, ship it."
- Edge-Case Nico (QA Engineer) — Flagged the Reddit 429 risk under chatty configs and the no-SLA exposure on Reddit's unauth API; both captured as deferred mitigations.

---
_Decision recorded automatically from fast-meeting analysis._
