# CLAUDE.md

## Project Overview

Solopilot (anciennement « X AI Weekly Bot ») — the autonomous back-office for the company of one. A full-stack TypeScript application that runs an auto-entrepreneur's recurring administrative work as AI-driven **workflows**: veille, acquisition, CRM, invoicing, accounting/URSSAF, and agenda — surfaced as a single daily briefing.

**Migration in progress.** The product is being generalized from a single X-veille bot into a workflow-driven platform. The **Veille** module (hourly X/Reddit/HN collection + daily AI summary to Discord at 07:30) is in production; Cockpit, Facturation (Stripe), Comptabilite/URSSAF, CRM, and Agenda (Google Calendar) are planned. See [docs/vision.md](docs/vision.md), [docs/migration-plan.md](docs/migration-plan.md), [docs/reimplementation-plan.md](docs/reimplementation-plan.md), and [ADR-0013](docs/adr/0013-from-bot-to-solopilot-workflow-platform.md).

**Core principle — everything is a workflow.** The current `cron → run → (collect | publish) → notify` pipeline is being promoted to a generic workflow engine (Trigger, Step, Workflow, Run). Adding a business capability = writing a workflow, not extending the monolith. Today's bot becomes the `veille.collect` / `veille.digest` workflows with zero behavioural change (strangler-fig).

## Tech Stack

- **Runtime:** Node.js >= 24 (ES2024, ESM)
- **Backend:** Hono v4 (HTTP framework), TypeScript strict mode
- **Database:** SQLite via better-sqlite3 (WAL mode)
- **AI:** OpenAI SDK v6 targeting GitHub Models endpoint
- **Scheduling:** node-cron
- **Frontend:** React 19, React Router 7, Vite
- **Styling:** Tailwind CSS 4, Radix UI primitives, Lucide icons
- **Validation:** Zod schemas

## Project Structure

```
src/                        # Backend TypeScript
├── scheduler.ts            # Entry point — boots web server + both crons
├── index.ts                # Publish run (reads accumulated tweets + AI summary)
├── server.ts               # Hono REST API
├── config.ts               # Zod config validation
├── db.ts                   # SQLite schema + initialization (runs, tweets, settings, monthly_summaries)
├── run-service.ts          # Run orchestration + DB tracking (separate collect/publish guards)
├── collect-service.ts      # Hourly tweet collection (scrape + store, no AI)
├── tweet-store.ts          # Tweet persistence, dedup, retrieval
├── date-utils.ts           # Paris timezone date utility
├── ai-filter.ts            # GitHub Models AI integration
├── x-client.ts             # X client factory
├── cron-manager.ts         # Multi-cron manager (collect + publish)
├── settings-service.ts     # DB-backed settings persistence
├── monthly-summary-service.ts # Monthly summary aggregation
├── ports.ts                # Interface definitions (Tweet, TweetReader)
├── logger.ts               # JSON structured logging
└── adapters/
    ├── scraper-reader.ts   # X GraphQL web scraper
    └── discord-notifier.ts # Discord webhook notifications

frontend/                   # React SPA
├── src/
│   ├── App.tsx             # Route definitions
│   ├── pages/              # Dashboard, Runs, Settings, Setup, Summaries
│   ├── components/         # Radix/shadcn-ui components
│   └── hooks/use-api.ts    # API fetching hook
└── vite.config.ts

docs/adr/                   # Architecture Decision Records
.github/workflows/release.yml  # Build + publish image to GHCR (on push to main)
.github/workflows/deploy.yml   # Homelab deploy — pull & reconcile compose stack (workflow_run)
Dockerfile                     # Multi-stage build
compose.yml                    # Docker Compose config
```

## Commands

```bash
npm install          # Install dependencies
npm run build        # Build backend (tsc) + frontend (vite)
npm run dev          # Run scheduler with .env loading
npm run dev:once     # One-shot run (no cron)
npm run lint         # ESLint on src/
npm run format       # Prettier formatting
npm run start        # Production start (scheduler)
```

## Architecture Patterns

- **Two-phase pipeline:** Hourly collection (scrape + store in `tweets` table) and daily publish (AI summary + Discord notification) — see ADR-0001
- **Config merging:** Environment variables are the base; DB settings override them (`tryLoadConfigWithOverrides`)
- **Boot vs full config:** `loadBootConfig()` for web server startup (minimal), `loadConfig()` for full run
- **Run tracking:** Every scrape/filter/publish cycle is a "run" tracked in SQLite with status, metadata, and summary
- **Separate concurrency guards:** `publishRunning` and `collectRunning` flags in `run-service.ts` — collection never blocks publication
- **Tweet deduplication:** `INSERT OR IGNORE` on tweet ID primary key in `tweets` table
- **Adapter pattern:** `TweetReader` interface in `ports.ts`, implemented by `scraper-reader.ts`
- **Frontend served by backend:** Hono serves the built React SPA via `serveStatic`

## Code Conventions

- TypeScript strict mode, ESM imports
- Single quotes, semicolons, 2-space indent (Prettier defaults)
- French user-facing text (AI prompts, UI labels, log messages for users)
- English for code, comments, and variable names
- Zod for all config/input validation
- Structured JSON logging via `logger.ts`
- Credentials are never logged or exposed in API responses (masked to last 4 chars)

## Git Workflow

- Branch: `main` is the production branch
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`)
- CI triggers on push to `main` — auto-detects release type from commit messages
- Version bumps are automated by CI (skip `chore: bump version` commits)

## Key Notes

- X scraping uses session cookies (auth_token + ct0), NOT the official API
- GraphQL operation IDs change periodically — the scraper auto-detects new ones from x.com JS bundles
- The web dashboard works in "setup mode" even without credentials configured
- SQLite database lives in `./data/bot.db` (Docker volume at `/app/data`)
- Docker container runs as non-root user `bot` (uid 1001)
- Two cron schedules: `COLLECT_CRON_SCHEDULE` (default `0 * * * *`) and `CRON_SCHEDULE` (default `30 7 * * *`)
- Workflow engine lives in `src/workflow/` (Trigger/Step/Workflow/Run); business modules in `src/modules/<module>/` are folders of workflows. Run one with `npm run workflow -- <id>`.
- **Veille flip (ADR-0020):** set `WORKFLOW_SCHEDULER=true` to dispatch the veille crons through the engine (behaviour-identical, adds `workflow_runs`). Default off keeps the legacy path.
- All dates use Europe/Paris timezone for consistency
