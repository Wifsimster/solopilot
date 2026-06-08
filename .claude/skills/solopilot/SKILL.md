---
name: solopilot
description: Use when the user wants to check or operate their Solopilot back-office — daily cockpit briefing, invoicing/facturation, comptabilité/URSSAF, CRM contacts & deals, agenda, or veille runs — via the solopilot CLI. Drives the Solopilot HTTP API over the command line, on production or locally.
---

# Solopilot CLI

Solopilot is a TypeScript back-office (Hono REST API + SQLite) that runs an
auto-entrepreneur's recurring admin work: veille, cockpit (daily briefing),
facturation (invoices/Stripe), comptabilité (URSSAF), CRM (contacts/deals),
agenda, products, and workflows. The `solopilot` CLI is a thin client over its
HTTP API — use it to read and operate any module.

Full endpoint reference: `docs/api.md`.

## Setup / prerequisites

The CLI needs a base URL and (when the server enforces it) the admin password.
Configure via env or flags:

| Setting | Env | Flag | Default |
|---------|-----|------|---------|
| Base URL | `SOLOPILOT_API_URL` | `--url <u>` | `http://localhost:3000` |
| Password | `SOLOPILOT_ADMIN_PASSWORD` (or `ADMIN_PASSWORD`) | `--password <p>` | — |
| Product scope | `SOLOPILOT_PRODUCT_ID` | `--product <id>` | — |

Auth is HTTP Basic `admin:<password>`, only enforced when the server has
`ADMIN_PASSWORD` set. The CLI sends no Origin/Referer header, so the server's
CSRF check passes — Basic auth alone is enough for mutating requests.

### Two production usage patterns

The server runs in Docker (container `solopilot`, port 3000).

1. **Inside the prod host (recommended)** — run against localhost in the container:

   ```bash
   docker exec -e ADMIN_PASSWORD=*** solopilot node dist/cli.js cockpit
   ```

2. **Remotely against the public URL**:

   ```bash
   solopilot cockpit --url https://your-host --password ***
   # or via env:
   export SOLOPILOT_API_URL=https://your-host
   export SOLOPILOT_ADMIN_PASSWORD=***
   solopilot cockpit
   ```

## CLI contract

Invoke as `solopilot`, `npm run cli --`, or `node dist/cli.js`.

**Generic verbs (full API coverage):**

```bash
solopilot get <path> [flags]
solopilot post <path> [json]
solopilot put <path> [json]
solopilot patch <path> [json]
solopilot delete <path>
```

Path normalization: a path starting with `/` is used as-is; one starting with
`api/` gets a leading `/`; anything else is prefixed with `/api/`. So
`cockpit`, `/api/cockpit`, and `/healthz` all resolve correctly.

The JSON body is a positional string; pass `-` to read JSON from stdin.

**Flags:**

- `--url <u>` — base URL
- `--password <p>` — admin password (Basic auth)
- `--product <id>` — appended as `productId` to every request
- `--query k=v` / `-q k=v` — extra query params (repeatable)
- `--raw` — print the response body without JSON pretty-printing

**Convenience commands (GET shortcuts):** `cockpit`, `status`, `health`,
`version`, `setup`, `products`, `runs`, `summaries`, `invoices`,
`comptabilite`, `deals`, `contacts`, `agenda`, `workflows`.

**Action commands:** `trigger` (POST `/api/trigger`), `collect`
(POST `/api/trigger-collect`), `endpoints` (prints the endpoint catalog, no
HTTP call), `help`.

**Exit codes:** `0` success · `1` HTTP non-2xx (body printed to stderr) ·
`2` network error / bad usage.

## Recipes

### Today's briefing

```bash
solopilot cockpit
```

### Facturation — list, create, mark paid

```bash
solopilot invoices
solopilot get facturation/invoices -q status=sent

# Create a manual invoice (amounts in cents, dates YYYY-MM-DD)
solopilot post facturation/invoices '{"client_name":"ACME","amount_cents":120000,"due_on":"2026-07-01"}'

# Mark invoice paid
solopilot post facturation/invoices/INVOICE_ID/paid

# Overdue reminder drafts (preview only — does not send)
solopilot get facturation/relances
```

### Comptabilité — URSSAF status and ledger

```bash
# Turnover + URSSAF estimate + config
solopilot comptabilite

# Configure activity type / declaration period
solopilot post comptabilite/config '{"activityType":"services_bnc","declarationPeriod":"quarterly"}'

# Add a ledger entry (kind is recette|depense, amount in cents)
solopilot post comptabilite/ledger '{"kind":"recette","amount_cents":50000,"label":"Mission X"}'
solopilot get comptabilite/ledger
```

### CRM — contacts, deals, interactions

```bash
solopilot contacts
solopilot post crm/contacts '{"name":"Jane Doe","email":"jane@acme.com","company":"ACME"}'

# Deals pipeline
solopilot deals
solopilot post crm/deals '{"contact_id":"CONTACT_ID","title":"Refonte site","amount_cents":300000}'

# Move a deal stage (nouveau|qualifie|proposition|gagne|perdu)
solopilot post crm/deals/DEAL_ID/stage '{"stage":"proposition"}'

# Stale-deal follow-up drafts (preview)
solopilot get crm/relances

# Log an interaction
solopilot post crm/interactions '{"contact_id":"CONTACT_ID","kind":"call","summary":"Appel de cadrage"}'
solopilot get crm/contacts/CONTACT_ID/interactions
```

### Agenda — summary and events

```bash
solopilot agenda
# starts_at / ends_at are ISO datetimes
solopilot post agenda/events '{"title":"RDV client","starts_at":"2026-06-10T14:00:00+02:00","ends_at":"2026-06-10T15:00:00+02:00","location":"Visio"}'
```

### Veille — trigger runs, read history

```bash
solopilot trigger          # trigger a publish run (AI summary)
solopilot collect          # trigger a tweet collection
solopilot runs             # run history
solopilot summaries        # run summaries
solopilot get summaries -q month=2026-06
```

### Workflows

```bash
solopilot workflows
solopilot get workflows/WORKFLOW_ID         # detail + last 10 runs
solopilot get workflow-runs -q limit=10
solopilot get workflow-runs/RUN_ID
```

## Running a workflow on demand (second CLI)

The `solopilot` CLI above is an HTTP client. Scheduled jobs are **workflows**,
and there is a *separate* CLI that runs one immediately, in-process, instead of
through the API:

```bash
node dist/workflow/cli.js <workflow-id>
# in prod: docker exec solopilot node dist/workflow/cli.js <workflow-id>
# from source: npm run workflow -- <workflow-id>
```

It is a runner, not a help printer — `--help` is treated as a workflow id and
errors. Run it with **no id** to print the available ids. Current workflows:

```
veille.collect          veille.digest           cockpit.daily-briefing
facturation.relance-impayes  facturation.sync-stripe
compta.seuils           compta.echeance-urssaf
crm.followup-stale      agenda.sync             agenda.rappels
```

For publish/collect prefer the main CLI's `trigger` / `collect` commands (they
go through the API and the normal run bookkeeping). Use the workflow runner to
fire the other scheduled jobs manually — e.g. `facturation.relance-impayes` to
generate overdue reminders, or `agenda.rappels` for event reminders. Exit code
is `0` on success, `1` on workflow error or unknown id.

## Anything else

Convenience commands cover the common cases; for anything not listed, use the
generic verbs against any path — the full surface is reachable. Discover it with:

```bash
solopilot endpoints     # prints the endpoint catalog (no HTTP)
solopilot get setup     # which credentials are configured
```

See `docs/api.md` for the complete endpoint reference and request body schemas.

## Gotchas

- **French enum values.** Deal stage: `nouveau | qualifie | proposition |
  gagne | perdu`. Ledger kind: `recette | depense`. Activity type:
  `services_bnc | services_bic | vente`. Declaration period: `monthly |
  quarterly`. Invoice status: `draft | sent | paid | void`.
- **Amounts are in cents** (e.g. 120000 = 1 200,00 €). `amount_cents` is an
  integer.
- **Dates** are `YYYY-MM-DD`; event datetimes are ISO 8601 (`starts_at`,
  `ends_at`).
- **Product / activity scoping.** Most module reads accept `productId` (alias
  `activity` on cockpit). Set `--product <id>` or `SOLOPILOT_PRODUCT_ID` to
  scope every call. List products with `solopilot products`.
- **Setup vs configured mode.** Some veille endpoints (settings mutations,
  triggers, summaries, monthly summaries) only work once credentials are
  configured; in setup mode they return empty/minimal responses.
- **Mutating vs read-only.** GET shortcuts and `*/relances` are read-only
  previews — they never send anything. POST/PUT/PATCH/DELETE mutate state;
  confirm intent before running them.
