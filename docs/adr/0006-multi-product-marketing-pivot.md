# 0006. Multi-product marketing intelligence pivot

Date: 2026-05-25

## Status

Accepted

## Context

The bot today is a single-tenant pipeline: one X timeline scraped hourly, one AI summary published daily to one Discord webhook. The owner runs multiple indie products and needs the same intelligence loop — what is being said, what matters, push the digest — for each of them, without standing up a separate deployment per product.

The existing stack is the moat: the cookie-based X scraper (`scraper-reader.ts`), the GitHub Models summarizer (`ai-filter.ts`), the Discord notifier (`adapters/discord-notifier.ts`), the run tracking, and the dashboard all work. None of them are X-or-Discord-shaped in a way that prevents reuse — they are shaped around "fetch sources, summarize, notify, log." What is missing is a tenancy boundary so the same pipeline can be pointed at N independent configurations.

The unmet need is marketing tooling for an indie multi-product portfolio. We are not pivoting away from the bot; we are widening its waist.

## Decision

Introduce `Product` as the multi-tenant unit. Every existing piece of data (`tweets`, `runs`, `monthly_summaries`) becomes scoped by `product_id`. A `default` product is created at migration time and existing rows are backfilled to it, so the current single-tenant deployment keeps working with zero behavioural change.

We deliberately call it `Product` and not `Workspace` or `Brand`:

- `Workspace` implies team membership and shared resources — we have one user.
- `Brand` implies marketing-as-content — too narrow, the unit also covers internal/dev products.
- `Product` matches how the owner already thinks and talks about the portfolio.

This stays single-owner. No RBAC, no auth, no multi-user login. Tenancy is a data scoping concern, not an identity concern.

The four core adapters transfer 1:1 from the single-tenant bot:

- `scraper-reader.ts` — X scraping logic unchanged, gets a per-product query/handle injected.
- `ai-filter.ts` — same prompt template, optional per-product override.
- `discord-notifier.ts` — same webhook POST, per-product webhook URL.
- The React dashboard — gains a product selector and a products CRUD page; everything else is the same screens with a `?productId=` filter.

## Schema changes

New `products` table and `product_id` columns on the three existing data tables, plus a per-product settings table that mirrors the existing global `settings` table:

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY,           -- slug
  name TEXT NOT NULL,
  x_query TEXT,                  -- timeline handle, list ID, or search query
  discord_webhook TEXT,
  ai_prompt_override TEXT,
  collect_cron TEXT,
  publish_cron TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
ALTER TABLE tweets             ADD COLUMN product_id TEXT REFERENCES products(id);
ALTER TABLE runs               ADD COLUMN product_id TEXT REFERENCES products(id);
ALTER TABLE monthly_summaries  ADD COLUMN product_id TEXT REFERENCES products(id);
CREATE TABLE product_settings (
  product_id TEXT NOT NULL REFERENCES products(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (product_id, key)
);
```

Migration steps, executed in the existing `MIGRATIONS` array in `db.ts`:

1. Create `products` and `product_settings` tables.
2. `INSERT OR IGNORE INTO products (id, name, created_at) VALUES ('default', 'Default', strftime('%s','now')*1000)`.
3. `ALTER TABLE` each of `tweets`, `runs`, `monthly_summaries` to add `product_id` (wrapped in the existing `runAlterMigrations` try/catch so re-runs are safe).
4. Backfill: `UPDATE <table> SET product_id = 'default' WHERE product_id IS NULL`.

`product_id` stays nullable at the SQL layer to keep the ALTER cheap, but the application code treats it as required and never writes null after migration.

## Config resolution order

Per product, the existing `tryLoadConfigWithOverrides` chain extends from two layers to three:

1. **Environment variables** — base (unchanged).
2. **Global `settings` table** — existing override layer, still applies to fields not bound to a specific product (e.g. session cookies, model name).
3. **`product_settings` table** — new, highest priority, only consulted when a `productId` is in scope.

The fields on `products` (x_query, discord_webhook, ai_prompt_override, cron schedules) are first-class columns rather than rows in `product_settings` because they are queried on every cron tick. `product_settings` is the escape hatch for everything else without forcing an `ALTER TABLE` per new knob.

## Cron strategy

Keep exactly **one** collect cron and **one** publish cron in `cron-manager.ts`. On each tick:

```
for (const product of listActiveProducts()) {
  await runForProduct(product);   // sequential, in-process
}
```

A small in-process queue (just an `async` for-of) is enough. We do **not** spawn a `node-cron` entry per product, because:

- N cron entries firing at the same minute mark create thundering-herd writes on SQLite.
- Per-product schedule overrides (`products.collect_cron`, `products.publish_cron`) are stored but not honoured in v1 — the global cron drives, products opt out by being archived. We will revisit if a product genuinely needs an off-cycle schedule.

The existing `publishRunning` and `collectRunning` concurrency guards stay global. They guard the whole sweep, not per-product, which is correct: a long-running publish for product A should defer product B's publish to the next tick rather than running them in parallel and racing on the AI API.

## Port roadmap (future work, not in this ADR)

The pivot makes it natural to pluralize the adapter ports. Out of scope to implement now, in scope to keep in mind so we do not paint ourselves into a corner:

- **`Notifier`** — `discord-notifier.ts` becomes one implementation of a `Notifier` interface. Slack and email notifiers slot in behind the same port. `products.discord_webhook` generalizes to a `notifiers` JSON column or a `product_notifiers` join table when we add the second channel.
- **`SourceReader`** — `TweetReader` in `ports.ts` generalizes to `SourceReader<T>` so Bluesky, Hacker News, and Reddit readers can land later. The X scraper stays the only in-house implementation; the others will be third-party APIs.

We do not refactor the interfaces today. We add `product_id` plumbing and stop. The rename happens when the second implementation lands.

## Consequences

### Positive

- Reuses the scraper, AI summarizer, Discord notifier, run tracking, and dashboard with no rewrites — only scoping changes.
- Schema delta is four `ALTER TABLE`s and two new tables. Migration is idempotent and reversible by dropping the `product_id` filter.
- Sequential per-product iteration on a single cron avoids SQLite write contention and AI rate-limit bursts.
- SQLite stays. WAL mode handles 100+ products comfortably for our write volume (one collect/hour, one publish/day per product).
- The `default` product backfill means the existing deployment keeps working through the migration with no config change.

### Negative / Risks

- **Cookie-based X scraping becomes load-bearing for multiple product launches.** If the session cookie dies, every product's collection stops. Mitigation deferred to a future ADR — options include multiple cookie pools, official API fallback, and a Bluesky `SourceReader` as a redundant channel.
- **AI cost grows linearly with product count.** Each product is one summary per day plus the monthly aggregate. Mitigation: per-product budget setting in `product_settings` and a response cache for identical tweet corpora. Deferred until the bill actually hurts.
- **Run history grows N times faster.** Existing dashboard pagination handles it, but the monthly summary aggregation needs a `product_id` filter or it will mix products.

### Neutral

- The `dev:once` one-shot mode keeps working — it operates on the `default` product by default and accepts a `--product` flag later.
- Settings UI gains a product picker; the existing global settings page stays for cross-product knobs.

## Explicitly NOT in scope for this ADR

- Intent-keyword lead scraping (people asking "anyone know a tool for X" on X) — deferred to a future ADR.
- Auto-posting / auto-replying — rejected as an anti-feature. We summarize and notify; we do not impersonate.
- Multi-user, RBAC, login — not now.
- Postgres migration — not now.
- External job queue (BullMQ, Redis, etc.) — not now.
- LinkedIn scraping — not now.
- Notion / Airtable sync — not now.
- Multi-product monthly summaries UI — deferred; the data is scoped correctly, the screen is a follow-up.

## Alternatives Considered

### Workspace abstraction with team users
Introduce `Workspace` as the tenancy unit and `User` membership tables. Rejected: premature. There is one user and no plan to add a second. Workspace tenancy can be added later as a layer above `Product` without breaking the schema.

### One SQLite database file per product
Each product gets its own `bot-<slug>.db`. Rejected: cron coordination nightmare, no atomic cross-product queries, backup gets ugly, and the dashboard would need to multiplex connections. The shared-DB-with-`product_id`-column model is the obvious right answer for our volume.

### Postgres now
Migrate to Postgres before adding tenancy. Rejected: WAL-mode SQLite handles our projected 100+ products without breaking a sweat. Postgres is a real option the day we need concurrent writers from multiple processes or proper full-text search, neither of which the pivot itself requires.

### External job queue
Run per-product jobs through BullMQ or similar. Rejected: a sequential `for` loop over active products inside the existing cron tick is enough. Adding Redis to deploy increases ops surface for zero current benefit.

## Participants

- SOLID Alex (Senior Backend Engineer) — Pushed for `product_id` as a nullable column with backfill rather than a hard schema break; advocated keeping the adapter interfaces untouched in v1.
- Whiteboard Damien (Tech Lead / Architect) — Confirmed `Product` as the tenancy unit over `Workspace`; vetoed per-product cron entries in favour of a single sequential sweep.
- Sprint Zero Sarah (Product Owner) — Defined the scope cut: tenancy only, no new sources, no new notifiers, no auth. Pushed intent-keyword scraping and multi-channel notifiers to follow-up ADRs.
- Edge-Case Nico (QA Engineer) — Flagged the cookie-as-single-point-of-failure risk across multiple products and the AI cost scaling; both captured as deferred mitigations.

---
_Decision recorded automatically from fast-meeting analysis._
