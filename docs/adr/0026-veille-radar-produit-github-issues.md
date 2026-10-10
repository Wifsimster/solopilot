# 0026. Radar produit — veille news become GitHub issue proposals

Date: 2026-10-10

## Status

Proposed

## Context

Request from the owner (2026-10-10): « Quand solopilot report une actualité qui est
très en rapport avec un de mes produits, je veux une proposition des choses à
reprendre et/ou utiliser sous forme d'issue directement dans le repo de mon produit.
Sous forme de rapport marketing avec des idées d'évolution pour améliorer le produit,
avec pour et contre. »

What exists today:

- Hourly collection stores items per product in `tweets`. When `triage_enabled` is set,
  the inline AI triage (`src/ai-triage.ts`) scores each item for its own product:
  `triage_relevance` 0-100, category, urgency.
- Products imported from GitHub (`src/github-import.ts`) keep the repository URL in
  `products.product_url`. `parseGithubRepoUrl` already maps it to `owner/repo`. No
  dedicated repo column is needed.
- `GITHUB_TOKEN` is the GitHub Models inference key (`models:read`). It must not
  gain write access to repositories as a side effect.
- Two veille side-paths (urgent alerts, CRM lead bridge) already consume triaged
  items idempotently through a column stamp plus an hourly sweep workflow.

An item collected for product A can matter to product B. Writing to a public repo is
an irreversible, outward-facing action. News content is attacker-controllable.

## Decision

Add one workflow, `veille.radar-produit` (module `veille`, cron `45 * * * *`, step
`veille.radar-produit-run`). It runs through the workflow engine and is recorded in
`workflow_runs`. `cron-manager` dispatches it every hour after collect and triage
(`guard: false` plus its own running flag, as in ADR-0025). The toggle is read at
each tick, so a disabled radar costs nothing and leaves no run rows. The workflow
can also be run on demand with `npm run workflow -- veille.radar-produit`.

### Pipeline (`src/modules/veille/radar-service.ts`)

1. **Gates.** Feature off, no AI key, or no active product with a GitHub repo: the
   step returns a `skipped` reason and does nothing else.
2. **Candidates.** Items not yet scanned (`tweets.radar_scanned_at IS NULL`) that are
   triaged without error, have `triage_relevance >= 60`, have `origin = 'topic'`
   (brand mentions are owned by alerts and the CRM), were collected in the last 3
   days, and are capped at 20 per sweep, highest relevance first. The existing
   triage is the cheap pre-filter, so the radar requires `triage_enabled` on the
   collecting product.
3. **Scoring.** One AI call per sweep scores every candidate against every
   repo-backed product (name, description, audience, value props, keywords).
   Output is strict JSON `{items:[{id, matches:[{product_id, score 0-1, reason}]}]}`,
   validated with Zod. Unknown item or product ids are dropped. On success all
   candidates are stamped `radar_scanned_at`. A failed call leaves them pending for
   the next sweep.
4. **Selection.** Pairs with `score >= RADAR_SCORE_THRESHOLD` (default **0.8**) that
   have no `radar_proposals` row yet, ordered by score.
5. **Caps.** At most `RADAR_MAX_PER_PRODUCT_PER_DAY` (default **1**) per target product
   and `RADAR_MAX_PER_DAY` (default **3**) overall per Europe/Paris day. Every
   proposal row except `capped` counts toward the caps. Pairs over a cap are
   recorded as `capped` without any AI generation call.
6. **Report.** A second AI call per pair returns structured JSON: short title, news
   summary, relevance for the product, 1-4 ideas (description, pour, contre, effort
   S/M/L, expected impact), and a recommendation. Solopilot renders the Markdown
   itself. The source block (link, date, author, platform) comes from the database,
   not from the model.
7. **Delivery.** The row is claimed first (`INSERT` on `UNIQUE(item_id, product_id)`,
   status `creating`), then:
   - **dry-run** (`RADAR_DRY_RUN`, default **true**, or `GITHUB_ISSUES_TOKEN`
     missing): stored as `dry_run` with the full title and body, nothing sent to
     GitHub.
   - **live**: `POST /repos/{owner}/{repo}/issues` with label `veille`. The label is
     created when missing (`GET`/`POST /labels`). If that is not permitted, the
     issue is created without a label. The result is stored as `created` with the
     URL, or `failed` with the error and the body kept for a manual retry.
8. **Notification.** One best-effort Discord message lists the new proposals (issue
   link or "simulation"). It goes to the veille webhook when set, else the global
   webhook.

### Safeguards

- **Dedup.** `radar_proposals` has `UNIQUE(item_id, product_id)`, and the row is
  claimed before the GitHub call. A crash mid-call leaves `creating`, which is
  never retried automatically. Two issues for the same pair are impossible.
- **Token isolation.** Only `GITHUB_ISSUES_TOKEN` (fine-grained, *Issues: read and
  write* on the product repos) is used for writes. `GITHUB_TOKEN` is never used
  for writes. If the token is missing, the radar runs in dry-run and says so in
  the logs, the UI and Discord.
- **Prompt injection.** News text is wrapped as quoted data, and both prompts state
  that it is untrusted and that instructions inside it must be ignored. Outputs are
  schema-validated and length-bounded. Every model string is sanitised before
  rendering:
  - `@` mentions are neutralised with a zero-width space.
  - `#N`, `owner/repo#N` and `GH-N` references are neutralised.
  - Closing keywords (`fixes #N`, `closes <issue URL>`) are broken.
  - Markdown images and raw HTML are removed. Markdown links are reduced to their
    text.
  The only link that survives is the item's own source URL (http/https only).
- **Data minimisation.** The prompts and the issue contain only the public news item
  and the product's public marketing fields. They never contain CRM data,
  invoices, settings or credentials.
- **Human in the loop.** The Settings card lists recent proposals and offers
  « Créer l'issue » on `dry_run`/`failed` rows. This explicit action bypasses
  dry-run and caps but still requires the token.

### Settings (global, DB overrides env, read at each tick)

| Key | Default | Meaning |
| --- | --- | --- |
| `RADAR_ENABLED` | `false` | Feature toggle (new workflows ship off) |
| `RADAR_DRY_RUN` | `true` | Propose only; never create issues |
| `RADAR_SCORE_THRESHOLD` | `0.8` | Minimum relevance 0-1 for a pair |
| `RADAR_MAX_PER_PRODUCT_PER_DAY` | `1` | Cap per target product per day |
| `RADAR_MAX_PER_DAY` | `3` | Global cap per day |
| `GITHUB_ISSUES_TOKEN` | — | Env only, never stored in DB or returned by the API |

Invalid values fall back to defaults with a warning. They never throw.

### Schema

```sql
ALTER TABLE tweets ADD COLUMN radar_scanned_at INTEGER;
CREATE TABLE radar_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL, product_id TEXT NOT NULL, repo TEXT NOT NULL,
  score REAL NOT NULL, reason TEXT, day TEXT NOT NULL,
  status TEXT NOT NULL,          -- creating | dry_run | created | failed | capped
  title TEXT, body TEXT, issue_url TEXT, issue_number INTEGER, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(item_id, product_id)
);
```

Additive and idempotent (`runRadarMigrations` in `db.ts`).

## Consequences

### Positive

- Relevant news turns into an actionable, reviewable artefact in the product's own
  backlog, with pros and cons, instead of a line in a digest.
- Safe first deploy: the feature is off by default. Once enabled it only
  simulates, until the owner sets the token and turns dry-run off.
- AI cost is bounded: at most 1 scoring call per hour (only when candidates exist)
  and at most `RADAR_MAX_PER_DAY` report calls per day.

### Negative / Risks

- Depends on triage: products without `triage_enabled` contribute no candidates.
- LLM relevance scores are noisy. The high threshold and the caps trade recall for
  precision on purpose.
- GitHub Models free-tier quotas are shared with triage and digest. The cap on
  scoring calls limits the pressure but does not remove it.
- A fine-grained token with write access is a new secret on the host. Scope it to
  *Issues* only, on the product repos only.

### Neutral

- `product_url` is the repo source of truth. Products whose URL is a website, not a
  GitHub repo, are never targeted.

## Explicitly NOT in scope

- Per-product opt-out, editing a proposal before creation, or regenerating a failed
  report. A dry-run proposal is created as-is.
- Commenting on existing issues, assigning, or adding to projects.
- Learning from closed or rejected issues.

## Participants

- Requested by Damien (owner). Designed and implemented on `feat/radar-produit`.
