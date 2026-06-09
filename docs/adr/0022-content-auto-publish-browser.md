# 0022. Content auto-publish by driving the web UI (LinkedIn first)

Date: 2026-06-08

## Status

Accepted

## Context

ADR-0011 shipped the Content Studio with a **hard line: no auto-publish**. The
owner generates drafts, reviews them, presses Copy, switches tabs, and pastes.
ADR-0006 had flagged auto-publishing as the platform's #1 trap: it kills
accounts (X/Reddit/LinkedIn all detect bot patterns; cookie-based posting
violates ToS faster than scraping), it can hurt brand, and it makes the platform
load-bearing for live ops.

The owner has since asked to remove the copy-paste step: review the draft, then
publish it automatically — explicitly **without** the platforms' official APIs
(cost, gatekeeping, application review) and **without** clipboard. The requested
mechanism is to drive the real platform web UI as a logged-in human, reusing the
same session-cookie approach the project already uses for X scraping.

The owner was presented with the account-suspension risk (X being the strictest
enforcer in 2026) and chose to proceed, LinkedIn first, accepting that risk for
their own low-volume, human-reviewed accounts. This ADR records that decision and
the design that keeps the blast radius small.

## Decision

Add a **publish step** to the Content Studio. When a draft's `target_source` has
a browser adapter and a connected session, the owner gets a **Publier** action;
a confirmation dialog shows the exact text and target account before anything is
posted. The post is published by driving the platform's web UI with
`playwright-core` (system Chromium in Docker), typing character-by-character with
jittered human timing and confirming success from the platform's own network
response — never the official API, never the clipboard.

**The human review gate stays.** ADR-0011's "the owner validates" stance is
preserved; only the final manual copy-paste is automated. There is no
cron/scheduler in this slice — publishing is owner-triggered, one post at a time.

LinkedIn (`generic`) ships first: simplest composer, single text post, no
title/subreddit, lowest velocity. Reddit (needs title + subreddit) and X (needs
threads, highest ban risk) are explicitly deferred to later slices.

## Design

- **`Publisher` port** (`ports.ts`), mirroring `SourceReader`: `checkSession()`
  and `publish()`, throwing a classified `PublishError`
  (`SESSION_EXPIRED` | `RATE_LIMITED` | `CHECKPOINT` | `SELECTOR_DRIFT` |
  `UNKNOWN`). Implemented per platform under `src/adapters/`; the LinkedIn
  adapter centralizes every selector in one `SELECTORS` map (DOM drifts — this
  is the one place to fix it) and prefers role-based locators with fallbacks.
- **`publish-service.ts`** orchestrates: a process-wide single-flight guard
  (one browser publish at a time, like `publishRunning`), **idempotency** via a
  `sha256(draftId + text)` key so the same draft text is never posted twice, and
  **fail-closed** semantics (a failure restores the draft's prior status and
  records `publish_error` for retry; it never silently re-attempts).
- **Schema**: result columns on `content_drafts`
  (`published_url`, `published_at`, `platform_meta`, `publish_error`,
  `publish_attempts`) for cheap list rendering, plus a `publish_jobs` table as
  the per-attempt audit/retry log (one row per `idempotency_key`, reused across
  retries via upsert against a partial unique index). Drafts orphaned in
  `publishing` by a crash are reset to `edited` on boot.
- **Sessions** are cookie-based, stored as masked credentials in `settings`
  (`LINKEDIN_LI_AT`, optional `LINKEDIN_JSESSIONID`), mirroring the X
  `auth_token`/`ct0` flow. A **Connexions** card in the Studio shows per-platform
  status (connecté / session expirée / non connecté) and a connect dialog.
- **API**: `POST /api/content-drafts/:id/publish` (409 busy, 400
  session-missing/unsupported, 502 PublishError), `GET .../publish-jobs`,
  `GET /api/publish/connections`, `POST /api/publish/connections/:platform/test`,
  `POST /api/publish/connections/linkedin`.
- **UI**: a new **Publiées** tab distinct from manually "Utilisées", so
  "Solopilot posted this" is separable from "I posted this by hand". Published
  cards link to the live post; failed publishes stay in place with the error and
  a retry.

## Risk reduction (the constraint, not an afterthought)

Driving the web UI violates these platforms' ToS; the realistic consequence is
**account action, not legal action**. Mitigations baked in: reuse an already
logged-in session (no fresh password login), one action at a time (single-flight,
never tight loops), human-paced jittered typing/timing, confirm each post before
returning, and **surface checkpoints/captchas to the human — never auto-solve**
(`CHECKPOINT` aborts). Phasing puts the riskiest platform (X) last.

## Consequences

- Reverses ADR-0011's "no auto-publish" hard line, with the owner's explicit,
  informed consent for their own accounts. The review gate and on-demand (no
  scheduler) posture remain.
- Adds a heavyweight runtime dependency: Chromium in the Docker image
  (`apk add chromium`, `CHROMIUM_PATH`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
- Selectors will drift; the adapter isolates them and classifies
  `SELECTOR_DRIFT` so breakage is a one-file fix and is visible in `publish_jobs`.
- Future work: a scheduler ("Publier plus tard"), Reddit + X adapters (with the
  draft-model fields they need), a one-click login-capture flow, and lifting the
  publish step into the workflow engine as a `content.publish` workflow.
