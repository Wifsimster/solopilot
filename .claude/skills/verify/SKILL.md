---
name: verify
description: Launch and drive Solopilot (auto-entrepreneur back-office, React SPA served by a Hono + SQLite server) like its owner, on a throwaway DB with fake veille items, and capture proof (screenshots, ARIA snapshots, API bodies, DB rows, logs). Use to prove any user-visible change (CRM, invoices and totals, veille/mentions, back-office auth) or to reproduce a bug before claiming it fixed.
---

# Verify Solopilot

Primary surface: the web back-office at `http://localhost:3310`, served by the production entry `dist/scheduler.js` (Hono serves the built SPA from `dist/frontend`). The UI is French. Secondary surfaces, not covered by this harness: the `solopilot` CLI (`dist/cli.js`, see the `solopilot` skill), the workflow engine, and every external integration (X, Reddit, HN, GitHub Models / OpenRouter, Discord, Stripe, calendar feed).

Everything goes through one CLI, `control-solopilot`. Each call prints one JSON object (`ok`, data, and on failure `error` + `fix`). Run it from the repo root:

```bash
C=.claude/skills/verify/scripts/control-solopilot.mjs   # or: node $C ...
$C --help                 # command list
$C <command> --help       # flags, side effects, what it proves
```

Prerequisites: `npm ci` at the repo root and the Chromium build that matches the repo's `playwright-core` (`npx playwright-core install chromium`). `doctor` reports a missing browser. No Docker.

## Launch

```bash
export SOLOPILOT_EVIDENCE_DIR=/somewhere/outside/the/checkout   # recommended, see Evidence
$C launch --dry-run   # prints ports, DB path and steps; touches nothing
$C launch             # ~40 s with the build; --skip-build reuses dist/ (~2 s)
```

`launch` does the following, in order:

1. Runs `npm run build` (backend `tsc` and the Vite build into `dist/frontend`). Use `--skip-build` only when `dist/` already matches the checkout.
2. Creates a throwaway SQLite DB at `.verify-run/data/verify.db` (never `data/`) and seeds six fake veille items through the app's own store (`scripts/seed.mjs`): four "new", one "handled", one "ignored", with fake triage categories and urgencies.
3. Starts `dist/scheduler.js` on `:3310` with `scripts/no-egress.mjs` preloaded. It refuses every HTTP(S) call to a host other than localhost and logs it to `.verify-run/egress-blocked.jsonl`.
4. Starts a headless Chromium daemon (CDP on `:9335`) that every later command attaches to. It records console and HTTP traffic to JSONL, adds the Basic-auth header to every request to the app, and aborts every third-party request (logged with status `blocked`).

`launch` is ready when it returns `"ok": true`. It forces `X_*`, `GITHUB_TOKEN`, `AI_API_KEY`, `AI_BASE_URL`, the Discord webhooks, `STRIPE_*` and `AGENDA_ICS_URL` to empty values, and sets a random throwaway `ADMIN_PASSWORD` (HTTP Basic auth, user `admin`).

No X credentials means the server boots in "setup" mode, the state of a fresh install: `/healthz` answers `unconfigured`, and no cron is scheduled (no collection, no digest, no publish queue). The CRM, invoice, cockpit and veille-item routes are the same in both modes. The runs, settings and summaries pages use stub routes in setup mode, so this harness does not cover them.

Isolation: one instance per host. Ports 3310 and 9335 are fixed. `launch` refuses to start when either is busy or when `.verify-run/state.json` exists. Never point the CLI at an instance you did not launch, and never at `data/bot.db`.

## Doctor

```bash
$C doctor   # read-only; exit 0 only if every check passes
```

`doctor` checks:

- the recorded PIDs are alive
- `/healthz` (with credentials) answers `unconfigured`, the expected mode
- a request without credentials gets `401` with a `WWW-Authenticate` challenge (`basicAuthEnforced`)
- the SPA is served, and the CDP port is open
- the Chromium build is installed
- the DB holds the six fake veille items
- `egressBlocked`: how many outbound calls the server tried (informational; read the log when it is not 0)
- the git SHA of the checkout

Run `doctor` first whenever anything looks off, and read its `hints`.

## Drive

Use roles and accessible names. Find them with `$C snapshot` rather than guessing CSS. On the first page load a fresh browser gets the "Visite guidée" overlay. Every command that navigates closes it with "Fermer la visite", as the owner would.

| Goal | Command |
|---|---|
| Create a CRM contact through "Nouveau contact" on `/crm` | `$C contact create --name "Fake Client SARL" --company "Fake Corp" --email client@example.invalid --status active` |
| Contacts from the DB | `$C contact list` |
| Create an invoice through "Nouvelle facture" on `/facturation`, then check the totals | `$C invoice create --client "Fake Client SARL" --amount 1250.50` |
| Create an overdue invoice (feeds "Relances à valider") | `$C invoice create --client "Late SAS" --amount 99.99 --due-in -10` |
| Mark an invoice paid with "Marquer payée", then check the totals | `$C invoice pay --number F-2026-001` |
| Invoices and ledger totals from the DB | `$C invoice list` |
| Veille list on `/mentions`, compared with the API and the DB | `$C veille list [--tab new\|handled\|ignored]` |
| Triage one item ("Traité" / "Ignorer") | `$C veille mark --item "URSSAF" --as handled` |
| Veille rows from the DB | `$C veille show` |
| Navigate | `$C goto /cockpit` |
| Click by role and name | `$C click --role button --name "^Nouvelle opportunité$"` |
| Keyboard | `$C key Escape` |
| ARIA tree (also saved as `.aria.yml`) | `$C snapshot [--name x] [--selector main]` |
| PNG | `$C screenshot --name x [--full-page]` |
| Browser console since launch | `$C console --level error --last 20` |
| HTTP log | `$C network-log --filter /api/facturation --status-min 400` |
| Recorded run, DB path, evidence dir | `$C info` |

Commands with side effects accept `--dry-run`: `launch`, `teardown`, `click`, `contact create`, `invoice create|pay` and `veille mark`.

The totals check: `invoice create` and `invoice pay` read the KPI cards "CA encaissé" and "En attente" on `/facturation` and compare them with `SUM(amount_cents)` of paid and sent invoices in the DB, formatted the way the page formats them (`1250.50 EUR`). `totals.match` must be `true`.

Solopilot has no invoice PDF. There is no route, button or library for it, so a PDF check is not applicable: report it as "feature absent", never as verified.

The feature map in [`features/README.md`](features/README.md) has one recipe per feature. A proof that drives one entry point does not cover the others listed there.

## Evidence

- Location: `$SOLOPILOT_EVIDENCE_DIR/<runId>/`, or `.verify-evidence/<runId>/` at the repo root (gitignored) when the variable is unset. `launch` records the root in `state.json`, so later commands write to the same place. Every file is named `<timestamp>_<label>`. Each `contact`, `invoice` and `veille mark` step writes screenshots and a `.json` with the HTTP response, the row on the page and the DB rows it read back.
- Teardown copies `.verify-run/logs/*.log` (build, seed, app, browser), `console.jsonl`, `network.jsonl` and `egress-blocked.jsonl` into `<runId>/run-logs/` before deleting the scratch state and the throwaway DB.
- Proof standards:
  - Drive the real user path: the dialogs, the table actions and the triage buttons. Do not POST to the API yourself.
  - Capture the action and the resulting state: screenshots plus the HTTP response.
  - Check the side effect with a second read: the `contacts`, `invoices` and `tweets` rows (`contact list`, `invoice list`, `veille show`), and the totals shown against the DB sums.
  - When the safe path skips something (Stripe, the AI triage, Discord delivery), say it was not verified. Never present a stub or a blocked call as proof.
  - For a bug, reproduce it on the same surface first, then show it gone.
- In a git worktree the default evidence dir dies with `git worktree remove`. Set `SOLOPILOT_EVIDENCE_DIR` outside the checkout before `launch`.

## Cleanup

```bash
$C teardown --dry-run   # lists PIDs and paths it would remove
$C teardown
```

`teardown` does the following:

- kills only the process groups recorded in `state.json`, never by process name
- deletes `.verify-run/`, including the throwaway DB
- reports `portsStillOpen`, which must be empty
- never deletes the evidence

Run it after every failed iteration too, so a broken attempt does not leave processes or ports behind.

## Helpers

- `scripts/control-solopilot.mjs` is the CLI. It is a Node ESM script that uses the repo's `playwright-core` and `better-sqlite3` (read-only DB access). Every subcommand has `--help`.
- `scripts/seed.mjs` seeds the fake veille items. It refuses to run unless `DB_PATH` points inside `.verify-run/`.
- `scripts/no-egress.mjs` is preloaded into the server by `launch` (`node --import`). It wraps `fetch`, `http.request/get` and `https.request/get`. Do not import it anywhere else.

## Gotchas

- **Basic auth before PR #131.** `app.onError` turned basicAuth's 401 into a plain 500 without `WWW-Authenticate`, so a browser never got a login prompt. On such a build `doctor` fails `basicAuthEnforced` with a hint. The harness still drives the UI, because the browser daemon sends the credentials up front.
- **Third-party scripts.** The SPA loads Umami analytics (`umami.battistella.ovh`) and Stripe.js. The daemon blocks both, so a verification run never sends analytics to production. Expect `ERR_BLOCKED_BY_CLIENT` console errors for them.
- **Invoice numbers are per year of `issued_on`.** `F-<year>-NNN` counts the invoices already issued that year, so the first invoice of a fresh DB is `F-<current year>-001`.
- **"Relances à valider" counts sent invoices past their due date.** Use `--due-in -10` to create one. The reminder text is drafted, never sent.
- **The CRM status column shows the raw value** (`lead`, `active`, `inactive`), not the French labels used by the filter buttons.
- **`/setup` has no `<main>`.** It sits outside the layout. `snapshot --selector main` fails there after 10 s with a hint; snapshot the whole page instead.
- **Stripe is not drivable.** The page shows "Mode ledger local — Stripe non configuré". Checkout and sync need a Stripe key; report them as not verified.
