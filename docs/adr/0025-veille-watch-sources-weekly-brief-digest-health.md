# 0025. Veille — slow-moving watch sources, weekly brief, digest health

Date: 2026-09-26

## Status

Proposed

## Context

OpenClaw's separate "veille" agent has been removed. Three of its useful jobs move
into Solopilot, which already owns per-product veille (ADR-0006/0007/0008):
(1) **slow-moving sources** (app stores, competitor changelogs and pricing, official
API/policy changes, French regulation), which change daily or weekly, not hourly;
(2) **a weekly synthesis brief per product**; (3) **health monitoring of the digests**.

**Motivating incident.** `#veille-copro-pilot` has received no digest since
2026-09-08, and nobody noticed for over two weeks. Code shows several ways a product can go
silent without any alert:

- No unpublished items → warn and return (`src/index.ts:53-56`), run `no_tweets`
  (`src/run-service.ts:99-103`). AI answers `NO_TECH_NEWS_FOUND`
  (`src/ai-filter.ts:153`) → items marked used, nothing sent (`src/index.ts:85-93`),
  run `no_news`.
- No webhook → `notification_status='skipped'` (`run-service.ts:130`); non-2xx →
  `'failed'` (`:116`). Only logged. Invalid `publish_cron` → logged, never scheduled
  (`src/cron-manager.ts:217-219`).
- X failures are only logged (`src/collect-service.ts:72-77`); per-source counts
  (`bySource`, `:52`) are not persisted — `triggerCollect` stores only
  `tweets_fetched` (`run-service.ts:57-60`).
- `POST /api/products` does not re-register publish crons (`src/server.ts:627-648`);
  `PUT` does only when `publish_cron` changes (`:788-792`). A new product gets no
  digest until restart.

Interop's hypotheses are **unverified** (nobody has read the prod DB or logs):
**H1 (~45%)** copro-pilot gets `no_tweets`/`no_news` daily: its sources return nothing
on-theme and the strict prompt drops the rest (plausible trigger: X session dying
around 09-08). Supporting detail: the default digest prompt is AI/tech-oriented and
its empty answer is literally `NO_TECH_NEWS_FOUND` (`src/ai-filter.ts:153`). Without
an `ai_prompt_override`, French condo-law content is likely judged off-topic. No code,
deploy or config change in the repo lines up with 2026-09-08. **H2 (~25%)** webhook deleted or rotated: `success` + notification
`failed`. **H3 (~15%)** `publish_cron` invalid/weekly, or product archived.
**H4 (~15%)** other, incl. items stored under another product (see below).

Read-only diagnostics for the human to run on the homelab:

```sh
sqlite3 -readonly /var/lib/docker/volumes/solopilot_bot-data/_data/bot.db \
 "SELECT id,name,archived_at,publish_cron,x_enabled,reddit_enabled,hn_enabled,youtube_enabled,length(discord_webhook)>0 FROM products;
  SELECT product_id,date(started_at),trigger_type,status,notification_status,tweets_fetched,error_message
    FROM runs WHERE started_at>='2026-09-05' AND trigger_type!='collect' ORDER BY id;
  SELECT product_id,source,collection_date,count(*) FROM tweets WHERE collection_date>='2026-09-01' GROUP BY 1,2,3;"
docker logs solopilot --since 2026-09-07 2>&1 | grep -E 'copro|X collection failed|Discord webhook failed|NO_TECH|No items'
```

The path assumes Compose project `solopilot` (volume `bot-data`, `compose.yml:10-11`);
confirm it with `docker volume ls` first. Reading: `no_tweets`/`no_news` → H1; `success` + `failed` → H2; no rows → H3. Per
interop, Docker logs rotate at 3×10 MB, so 09-07 entries may be gone.

**Existing defect: the item key is global.** `tweets.id` alone is the primary key
(`src/db.ts:732-733`); `product_id` was added later as a plain column (`:224`). The
insert is `INSERT OR IGNORE` (`src/tweet-store.ts:24`). When two products collect the
same item, the first product keeps it and the second silently loses it. Shared
regulation feeds would hit this constantly.

**Scheduling constraint.** The engine scheduler (`src/workflow/scheduler.ts:20`) has
no production caller and runs only for `DEFAULT_PRODUCT_ID` (`:37`). Per-product
veille dispatch lives in `cron-manager.ts` (`runWorkflowById(..., { guard: false })`
under `WORKFLOW_SCHEDULER`, `:23-37`, ADR-0020). The runner guard is keyed
`module:activity` (`src/workflow/runner.ts:48-56`), so guarded `veille.*` runs collide.

## Decision

Add three workflows to `veilleWorkflows` (`src/modules/veille/workflows.ts:51`), each
dispatched per product from `cron-manager.ts` via `runWorkflowById` with
`guard: false` plus its own running flag. Each is one cron task iterating
`listProducts(false)` per tick like `scheduleCollectCron` (`cron-manager.ts:120-142`),
so new products need no restart. Defaults (DB settings, Europe/Paris):

| Workflow              | Setting                    | Default      |
| --------------------- | -------------------------- | ------------ |
| `veille.watch`        | `VEILLE_WATCH_CRON`        | `0 6 * * *`  |
| `veille.health`       | `VEILLE_HEALTH_CRON`       | `15 8 * * *` |
| `veille.weekly-brief` | `VEILLE_WEEKLY_BRIEF_CRON` | `0 18 * * 0` |

`veille.watch` runs before the 07:30 digest, so its items can feed the digest.
`veille.health` runs after the digest and avoids the 08:00 canary slot.

### 1. `veille.watch`: slow-moving sources, separate from the hourly collect

The hourly `veille.collect` is **not** extended. Watch targets have their own cadence
(`daily | weekly`), conditional fetches and a failure budget. The workflow runs daily
and skips any target that is not due (`last_ok_at` plus the cadence).

```ts
// src/ports.ts: ItemSource widened; SourceReader unchanged.
export type ItemSource = 'x' | 'reddit' | 'hn' | 'youtube' | 'feed' | 'github' | 'pagediff' | 'fdroid';
export type ItemKind = 'post' | 'release' | 'changelog' | 'pricing' | 'policy' | 'regulation' | 'status';

export interface WatchTarget {
  id: string; productId: string; source: ItemSource; kind: ItemKind;
  url: string; cadence: 'daily' | 'weekly'; config?: Record<string, unknown>;
}
export interface WatchCursor {
  etag?: string; lastModified?: string; contentHash?: string; lastOkAt: number; failCount: number;
}
export interface WatchReader {
  source: ItemSource;
  /** Conditional fetch. Returns new items (ids `<source>:<productId>:<nativeKey>`) and the next cursor. */
  poll(target: WatchTarget, cursor: WatchCursor | null): Promise<{ items: Item[]; cursor: WatchCursor }>;
}
```

**MVP readers:**

- `feed`: generic RSS/Atom. Native key = entry guid, or the link if there is no guid.
- `github`: GitHub releases. Native key = `<owner>/<repo>:<release.id>`. Uses an
  optional token, with ETag for 304 responses.
- `pagediff`: fetch, extract readable text, normalise, then sha256. No JS rendering.
  **An empty or near-empty extract is an error, not a change.** An item is emitted
  only when the hash changes. Native key = `<targetId>:<sha256>`. `tweets.text`
  holds the diff against the previous snapshot, capped at 4 KB. It never holds the
  full page.
- `fdroid`: releases only; F-Droid has no reviews. Native key = `<pkg>:<versionCode>`.
  The large index is fetched conditionally.

**Later** (each with its own sign-off): Play Developer API reviews for **our own
apps only** (service account); Légifrance via PISTE (OAuth2 client credentials);
Steam `GetNewsForApp`. **Non-goals:** scraping Play Store for competitors, anything
behind a login or paywall, a headless browser.

**Storage.** Emitted items reuse `tweets`, so the daily digest, triage, alerts and the
weekly brief read them with no new read path. Ids are product-scoped from day one.
`tweets` gets a nullable `kind` column; `NULL` means a legacy post.

Product-scoping the legacy sources (x/reddit/hn/youtube) is a **separate follow-up
ADR**, outside this MVP. It needs an id backfill that also touches `intent_signals`
and the other item references.

```sql
ALTER TABLE tweets ADD COLUMN kind TEXT;               -- addColumnIfMissing
ALTER TABLE runs   ADD COLUMN source_counts TEXT;      -- JSON bySource, written by triggerCollect

CREATE TABLE IF NOT EXISTS watch_targets (
  id TEXT PRIMARY KEY,                                 -- `${productId}:${slug}`
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                                -- feed|github|pagediff|fdroid
  kind TEXT NOT NULL,                                  -- release|changelog|pricing|policy|regulation|status
  url TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'daily',               -- daily|weekly
  config TEXT,                                         -- JSON (selector, pkg, locale…)
  enabled INTEGER NOT NULL DEFAULT 1,
  etag TEXT, last_modified TEXT, content_hash TEXT,    -- cursor
  last_ok_at INTEGER, last_attempt_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (product_id, source, url)
);

CREATE TABLE IF NOT EXISTS page_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);                                                     -- keep last N (default 5) per target
CREATE INDEX IF NOT EXISTS idx_page_snapshots_target ON page_snapshots(target_id, fetched_at DESC);
```

**Failure isolation.** Each target runs in its own try/catch. Failure: `fail_count++`,
`last_error` set, cursor not advanced. Success: `fail_count = 0`, `last_ok_at = now`.
A failing target never aborts the others; alerting on it belongs to `veille.health`.

**Policy/regulation alerts.** An item from a `policy`/`regulation` target is alerted
immediately to the product's existing channel through the **existing alert path**
(`sendPendingAlerts` in `src/alert-service.ts`, the `veille.alert` sweep,
`alerted_at`). The watch step stores it pre-triaged without AI (`triaged_at = now`,
`triage_category = kind`, `triage_urgency = 100`, above the default threshold 80,
`alert-service.ts:8`), and `sendPendingAlerts` gains one clause (query at `:100`) so
these kinds are sent even when `alert_enabled` is off (`:86`). Message: `⚠️
Changement détecté`, link, fetch date, raw diff excerpt — **no AI interpretation**.
Dedup by content hash: the id embeds the sha256, so the same content is a no-op
insert and `alerted_at` prevents re-pings. Accepted limitation: a page reverting to
an earlier hash is not re-alerted.

### 2. `veille.weekly-brief`: per product, Sunday 18:00 Europe/Paris

Same webhook/channel as the daily digest (`resolveDiscordWebhook`,
`run-service.ts:24-30`). Inputs: the last 7 days of `tweets` (all sources and kinds,
used flag ignored) plus that week's `success` digest summaries, capped by characters
as in `monthly-summary-service.ts:8-9`. The AI returns **structured JSON**, validated
with Zod:

```ts
const WeeklyFinding = z.object({
  title: z.string().max(120),
  fact: z.string().max(300),            // verifiable, sourced; no interpretation
  sourceUrl: z.string().url(),          // must be one of the input URLs, otherwise dropped
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  implication: z.string().max(300),     // the interpretation, kept separate from the fact
  action: z.enum(['feature', 'positionnement', 'contenu', 'rien']),
});
const WeeklyBrief = z.object({ findings: z.array(WeeklyFinding).max(5) });
```

The brief is rendered in French in the format from the PO:

```
📊 Veille hebdo — {Produit} — semaine du {début} au {fin}
1. {Titre}
   Fait : … / Source : {lien} ({date}) / Implication : … / Action suggérée : …
```

3–5 ranked findings. **0 findings** → `Rien de notable cette semaine. Scanné :
{sources/targets that actually ran}.` — never padded. **1–2 findings** → posted
unpadded plus the "Scanné" line (deviates from the PO's "<3 → Rien de notable"; see
Open questions). **Invalid output** → run `error`, nothing posted, `veille.health`
reports it.

```sql
CREATE TABLE IF NOT EXISTS weekly_briefs (             -- mirrors monthly_summaries
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,                            -- Paris date (Monday) YYYY-MM-DD
  week_end TEXT NOT NULL,
  brief_json TEXT NOT NULL,                            -- validated WeeklyBrief
  rendered TEXT NOT NULL,
  source_run_ids TEXT NOT NULL, item_ids TEXT NOT NULL,
  notification_status TEXT,                            -- sent|failed|skipped
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, week_start)
);
```

Regenerating the brief upserts the row, as `generateMonthlySummary` does
(`monthly-summary-service.ts:49-63`).

### 3. `veille.health`: daily digest health check

Reads `runs` (written on both the legacy and flip paths, ADR-0020), `watch_targets`
and `workflow_runs`. It must tell **legitimate silence** (`no_news`, single
`no_tweets` days) apart from failures.

| Condition          | Fires when                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `publish_stale`    | No finished publish run (`trigger_type` ≠ `collect`) for > `VEILLE_HEALTH_MAX_SILENCE_H` (36h; 192h if custom `publish_cron`)   |
| `publish_error`    | The latest publish run has `status='error'`                                                                                     |
| `notify_failed`    | The latest publish run has `notification_status` of `failed` or `skipped`                                                       |
| `no_tweets_streak` | The last 3 publish runs were all `no_tweets`                                                                                    |
| `target_failing`   | A watch target has `fail_count >= 3` (subject = target id)                                                                      |
| `source_silent`    | Enabled x/reddit/hn/youtube source with 0 `fetched` over 24h (`runs.source_counts`); X is shared, so one `product_id='*'` alert |
| `brief_failed`     | The latest `veille.weekly-brief` workflow run for the product is `error`                                                        |

```sql
CREATE TABLE IF NOT EXISTS veille_health_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,                            -- or '*' for shared sources
  condition TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',                    -- target id / source name
  outage_start TEXT NOT NULL,                          -- last-good timestamp, or first detection
  alerted_at INTEGER, resolved_at INTEGER,
  UNIQUE (product_id, condition, subject, outage_start)
);
```

**Dedup.** At most one open incident exists per (product, condition, subject). An
incident alerts once. When its condition clears, `resolved_at` is set and a single
`✅ rétabli` line is posted. Alerts go to one ops webhook: setting
`VEILLE_OPS_WEBHOOK_URL`, falling back to the global `DISCORD_WEBHOOK_URL`, the same
fallback the canary uses (`cron-manager.ts:168`). The health check is observation
only: no auto-retry or restart.

**Also decided, as small independent changes:**

- **Quiet-day notice.** A per-product flag `digest_quiet_notice` (products column,
  default 0) makes `triggerRun` post `Rien de pertinent aujourd'hui ({n} éléments
  analysés).` on `no_news` days. It is off by default, so there is no behaviour change.
- **Reschedule on create.** `POST /api/products` calls `reschedule(...)` after
  `createProduct`, as the `PUT` branch does (`server.ts:791`).
- **Persist per-source counts.** `triggerCollect` writes `result.bySource` to
  `runs.source_counts`, which `source_silent` needs.

### Per-product watch profile

The weekly brief needs to know what each product is and what matters to it. Without
that, the AI can't say "what it means for the product". The profile lives in
`product_settings` (ADR-0006's escape hatch, no new column) under the key
`VEILLE_WATCH_PROFILE`, as Zod-validated JSON:

```ts
const WatchProfile = z.object({
  positioning: z.string().max(300),     // one line, French
  competitors: z.array(z.string()).max(12),
  axes: z.array(z.string()).max(8),     // watch axes, injected into the weekly prompt
});
```

`watch_targets` holds the *fetchable* part of the axes. The profile holds the
*judgement* part. Initial profiles come from the product sheet that the OpenClaw
veille agent used:

| Product (id to confirm) | Positioning                                              | Competitors / axes                                                                  |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ondes                   | Private open-source Android podcast player, no ads/account | AntennaPod, Pocket Casts, Podcast Addict, Spotify; F-Droid/Play reviews; Podcast Index/RSS |
| Élan                    | 100% offline Android cycling/running/strength tracker    | Strava, Komoot, Garmin/Wahoo, Strong/Hevy; privacy-first fitness                    |
| WAWPTN                  | Group game picker (Steam, Epic, GOG, Discord bot)        | Steam/Epic/GOG API + policy, Discord bot/activity rules, similar pickers            |
| CoproPilot              | French condo management, "10x cheaper", hosted in France | Matera, Bellman; loi ALUR/ELAN, extranet obligations, syndic pricing                |
| Koe                     | Self-hosted in-app support widget                        | Canny, Featurebase, Userback, Fider, Crisp; self-hosting trends                     |
| printcast               | HTTP → ESC/POS bridge for homelab thermal printers       | r/selfhosted, Home Assistant, n8n, ntfy; similar projects                           |
| PlexCord                | Plex playback as Discord Rich Presence (Go + Wails)      | Plex and Discord API/RPC changes, Plexamp, competing presence tools                 |
| Solopilot               | Back-office for French micro-entrepreneurs               | URSSAF, facture électronique 2026-27, indie/AI back-office tools                    |

The same profile should also drive a per-product `ai_prompt_override` for the daily
digest, because the default prompt is AI/tech-only (see H1). That is a config change
per product and is left to the human.

### Seed targets (MVP readers only; **every URL is to verify** before seeding)

| Product    | Target                                                        | Reader               | Kind       | Cadence |
| ---------- | ------------------------------------------------------------- | -------------------- | ---------- | ------- |
| CoproPilot | service-public.fr copropriété pages (ALUR/ELAN, extranet)     | `pagediff`           | regulation | weekly  |
| CoproPilot | Matera, Bellman pricing pages                                 | `pagediff`           | pricing    | weekly  |
| Solopilot  | URSSAF actualités (RSS if it exists)                          | `feed`               | regulation | weekly  |
| Solopilot  | impots.gouv e-invoicing pages; BOFiP actualités               | `pagediff`           | regulation | weekly  |
| Ondes      | AntennaPod on F-Droid; AntennaPod GitHub releases             | `fdroid` / `github`  | release    | weekly  |
| Ondes, Élan | Android Developers Blog (developer verification 2026-27); Play policy updates | `feed` / `pagediff` | policy | weekly |
| Élan       | Strava developers changelog / API terms                       | `pagediff`           | policy     | weekly  |
| Élan       | Hevy, Strong pricing pages                                    | `pagediff`           | pricing    | weekly  |
| WAWPTN, PlexCord | Discord developers change-log; Discord status RSS       | `pagediff` / `feed`  | policy     | daily   |
| WAWPTN     | Epic / GOG store policy pages                                 | `pagediff`           | policy     | weekly  |
| PlexCord   | Plex forum announcements `.rss`; Plex blog RSS                | `feed`               | changelog  | daily   |
| Koe        | Fider GitHub releases; Canny, Featurebase pricing pages       | `github` / `pagediff` | release / pricing | weekly |
| printcast  | Home Assistant, ntfy GitHub releases                          | `github`             | release    | weekly  |

A target shared by several products is stored once per product, because ids are
product-scoped. That duplication is accepted: it keeps each product's cursor and
alert independent.

### Security (outbound fetches)

- **SSRF**: `http(s)` only. Resolve DNS, then block loopback, RFC 1918, link-local,
  CGNAT (100.64/10), ULA `fc00::/7` and metadata IPs; re-check on every redirect
  (max 3). Applies to every user-entered URL.
- **Limits**: 10 s timeout, 5 MB body cap, 1 request per host per run, sequential per
  host. Descriptive User-Agent `Solopilot-Veille/<version> (+contact)`, as the
  reddit/hn readers do. robots.txt honoured for `pagediff` (cached 24h per host).
- **Secrets**: tokens (GitHub; later PISTE, Play) live in settings, masked like other
  credentials. Snapshots stay private, never exposed in API responses.

**External facts disclaimer.** Behaviour of external APIs and sites is specialist
knowledge. It was **not re-verified** for this ADR and must be checked before
acceptance. That covers F-Droid index format, GitHub rate limits, Play Developer API
review window and auth, PISTE OAuth and quotas, Steam limits, RSS availability, and
robots/ToS terms.

## Rollout

1. **Health first.** It is the cheapest phase and would have caught the incident. Ship
   `runs.source_counts`, `veille_health_incidents`, `veille.health`,
   reschedule-on-create and the quiet-day flag. Before that, run the diagnostics above
   and fix copro-pilot.
2. **Watch MVP.** Ship `watch_targets`, `page_snapshots`, `tweets.kind`, the four
   readers and the policy alert clause. Seed one product first (see Open questions),
   observe for a week, then seed the rest.
3. **Weekly brief.** Ship `weekly_briefs` and `veille.weekly-brief`. Run it manually
   (`npm run workflow -- veille.weekly-brief`) for 2 weeks before enabling the cron.

## Consequences

### Positive

- A silent product is detected within ~36h instead of by accident, and failures are
  separated from legitimately quiet days.
- Slow sources get cadence, conditional fetches and a failure budget without touching
  the hourly collect. Watch items reuse `tweets` (no new read path) with
  product-scoped ids. `watch_targets` stops the per-source column sprawl (ADR-0007).

### Negative / Risks

- Page-diff is noisy (layout changes → false diffs; JS-only pages always fail, by
  design). Mitigation: readability extraction + normalisation; `target_failing`
  surfaces dead targets.
- Watch items enter the daily digest pool; the strict prompt may drop them, so the
  weekly brief is their primary consumer. Diff text is capped (token budgets).
- `sendPendingAlerts` gains a kind-based bypass of `alert_enabled`: a real behaviour
  change in a shared path; needs a test.
- Nothing watches `veille.health` itself; the weekly brief is a weak heartbeat.
- The global `tweets.id` defect remains for legacy sources until the follow-up ADR.
- 4 new tables and 3 new columns, all additive and idempotent (`addColumnIfMissing`).

### Neutral

- New workflows go through the engine (`workflow_runs`) with no legacy path and no
  flag, but are dispatched by `cron-manager`, consistent with ADR-0020.

## Explicitly NOT in scope

Product-scoping legacy ids (follow-up ADR); Play/PISTE/Steam readers; the non-goals
listed in §1; auto-remediation of unhealthy digests.

## Alternatives Considered

### Extend the hourly `veille.collect`

Rejected. Hourly polling of weekly pages wastes requests and raises the ban and ToS
risk. It would also add another hard-coded if-block to `collect-service.ts`, and a
slow page would stall the X/Reddit collect. Cadence and cursors do not fit that loop.

### A separate watch service or container

Rejected. It would duplicate config, products, webhooks and the DB. Rule from
ADR-0013: a new capability is a workflow, not a new service.

### Keep the OpenClaw veille agent

Rejected by the human: the agent is already removed. Keeping veille in one place
reuses Solopilot's products, channels, item store and run tracking, and makes health
checkable in one DB.

## Open questions

1. **Ops channel**: dedicated `#veille-ops` webhook, the global webhook, a DM or email?
2. **Brief timing**: Sunday 18:00 or Monday morning? Post 1–2 findings (proposed) or
   fall back to "Rien de notable" (PO spec)?
3. **Play Developer API**: set up service-account access for our own apps? Which apps?
4. **Rollout order**: copro-pilot first (regulation, current incident) or Élan
   (competitor churn)?
5. **PISTE**: will we create a PISTE account and accept the CGU for Légifrance?
6. **Product ids**: confirm the `products.id` of each row in the watch-profile table,
   and whether every product has its own row in production.

## Participants

- Product owner: user stories, MVP scope, weekly brief format, freshness-alert rule.
- Interoperability expert: source adapter survey; read-only investigation of the
  `#veille-copro-pilot` gap (code and git history only; production was not reachable).
- Architect: drafted this ADR.
- Tech lead: reviewed it against the code (the cited `file:line` references were
  spot-checked on `main` @ `c6bc73d`); added the per-product watch profile and the
  real product mapping for the seed targets.
