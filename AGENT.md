# AGENT.md

## Project Summary

Solopilot (anciennement « X AI Weekly Bot ») est le back-office autonome de l'auto-entrepreneur : une application full-stack TypeScript qui fait tourner le quotidien administratif d'une entreprise d'une personne sous forme de **workflows** pilotes par IA (veille, acquisition, CRM, facturation, comptabilite, agenda). Le module Veille (collecte X/Reddit/HN toutes les heures + resume IA quotidien via Discord a 07:30, dashboard React) est en production ; les autres modules sont planifies. Voir `docs/vision.md`, `docs/migration-plan.md`, `docs/reimplementation-plan.md`, `docs/adr/0013-*`.

**Principe directeur :** tout est un workflow. Le pipeline actuel (cron → run → collecte/publication → notification) est generalise en un moteur de workflows (Trigger, Step, Workflow, Run). Ajouter une capacite = ecrire un workflow.

## Essential Commands

```bash
npm install          # Install dependencies
npm run build        # Build backend + frontend (required before running)
npm run dev          # Run with .env loading (scheduler mode)
npm run dev:once     # Single run (no cron, for testing)
npm run lint         # ESLint
npm run format       # Prettier
```

## Project Structure

- `src/` — Backend TypeScript (Hono server, scraper, AI filter, DB)
- `frontend/` — React 19 SPA (dashboard, settings, setup wizard)
- `src/scheduler.ts` — Production entry point (web server + both crons)
- `src/server.ts` — REST API endpoints
- `src/collect-service.ts` — Hourly tweet collection (no AI)
- `src/tweet-store.ts` — Tweet storage, dedup, retrieval
- `src/index.ts` — Publish run (reads accumulated tweets + AI summary)
- `src/cron-manager.ts` — Multi-cron manager (collect + publish)
- `src/adapters/scraper-reader.ts` — X GraphQL web scraper
- `src/config.ts` — Zod-based config validation
- `src/db.ts` — SQLite schema and initialization
- `docs/adr/` — Architecture Decision Records

## Code Conventions

- TypeScript strict mode, ESM modules
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`)
- French for user-facing text; English for code and comments
- Zod for all validation
- No credentials in logs or API responses

## Development Workflow

1. Create a feature branch from `main`
2. Use conventional commit messages
3. Push to `main` triggers CI: lint → build → Docker → deploy
4. CI auto-detects release type (major/minor/patch) from commits

## Important Notes

- **Never commit `.env`** — contains real credentials
- **Never modify `data/`** — contains the SQLite database (gitignored)
- **Always run `npm run build`** after modifying TypeScript or React code
- **Always run `npm run lint`** before committing
- X scraping uses session cookies, not the official API — handle auth_token and ct0 carefully
- GraphQL IDs change periodically — the scraper handles this automatically
- The web dashboard must work in "setup mode" (no credentials) — don't break the boot path
- Two-phase architecture: hourly collection (no AI) + daily publish (AI summary at 07:30) — see ADR-0001
- Separate concurrency guards for collect and publish runs
