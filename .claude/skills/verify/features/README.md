# Solopilot verification map

This directory is the maintained source for verifying the user-visible behavior of the Solopilot back-office. Read this index before driving the app, then use the matching feature file as the recipe. `C=.claude/skills/verify/scripts/control-solopilot.mjs` throughout.

## Baseline preconditions

- `$C launch` has returned `"ok": true` and `$C doctor` exits 0.
- The database is the throwaway `.verify-run/data/verify.db`. It holds six fake veille items (`verify-1` … `verify-6`) and nothing else: no contacts, deals or invoices.
- The server runs in setup mode (no X credentials): no cron runs. Every third-party key is empty, the server cannot reach any third party (egress guard), and the browser blocks every non-local request.
- HTTP Basic auth is on with a throwaway password. The browser daemon sends it.
- Never drive an instance that this run did not start.

## Driving conventions

- Start from a fresh `launch` when a recipe needs an empty CRM or ledger.
- Prefer ARIA roles and accessible names (`$C snapshot` shows them) over CSS.
- Every command is literal: keep quoted names and flags unchanged.
- Use `--dry-run` first on anything that writes, when you only need to know what would happen.

## Proof and skip reporting

- Capture the user action and the resulting state: a screenshot plus the HTTP response, not just the final screen.
- Every mutation needs a second, read-only view: a DB row (`contact list`, `invoice list`, `veille show`) or the totals compared with the DB.
- Record the feature ID and entry point with every artifact. Evidence lives in `$SOLOPILOT_EVIDENCE_DIR/<runId>/`.
- An entry point you could not reach is reported with the command attempted and the unmet precondition, never as verified through another path.

## Feature entry contract

Each feature file has an H1 and one paragraph, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-solopilot` (opens with `Preconditions:`), `Gotchas`.

## Features

- [CRM](./crm.md) covers contacts and the deal pipeline. Contact creation was **driven end to end in the pilot run**; deals are a recipe only.
- [Facturation](./facturation.md) covers invoice creation, the totals, overdue reminders and "Marquer payée". **Driven end to end in the pilot run.** There is no invoice PDF; Stripe is not drivable.
- [Veille / Mentions](./veille-mentions.md) covers the triaged mention inbox and its "Traité" / "Ignorer" actions. **Driven end to end in the pilot run.** Collection and the AI triage are not drivable offline.
- [Back-office access](./backoffice-auth.md) covers HTTP Basic auth (`ADMIN_PASSWORD`). Checked by `doctor`, curl (401, CSRF 403) and the `/setup` page in the pilot run.
- [Cockpit](./cockpit.md) covers the daily briefing page. Opened and checked against the ledger in the pilot run.
