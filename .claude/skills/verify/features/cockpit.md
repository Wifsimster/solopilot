# Cockpit

The daily picture of the activity on one page: what needs attention today across invoicing, CRM, accounting, agenda and veille, built by `buildBriefing()` and served read-only by `GET /api/cockpit`.

## Sub-features

- `cockpit-briefing` is the page `/cockpit`.
- `cockpit-api` is `GET /api/cockpit?productId=<id>`.

## How to get to it (user POV)

- The sidebar entry for the cockpit, or a direct URL: `/cockpit`.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0.
- For a meaningful page, first create data: an overdue invoice (`$C invoice create --client "Late SAS" --amount 99.99 --due-in -10`) and a contact.

- **Open.** Run `$C goto /cockpit`, then `$C snapshot --selector main --name cockpit` and `$C screenshot --name cockpit --full-page`. The page has the heading "Votre activité, en un coup d'œil" and one card per module: "Veille", "Acquisition", "Workflows", "Facturation", "Comptabilité", "CRM", "Agenda".
- **Compare with the ledger.** After the facturation recipe (one paid invoice of 1250.50 €, one overdue of 99.99 €), the pilot run showed "Facturation: 1 en attente, 1 facture(s) en retard — 99.99 €" and "Comptabilité: 2% du plafond micro — 1250.50 € CA". Compare with `$C invoice list`.
- **Veille card.** "N en attente" counts items not yet used by a digest (all six seeded items), not the "Nouvelles" tab of `/mentions`.

## Gotchas

- Agenda data comes from `AGENDA_ICS_URL`, which the harness leaves empty; the agenda part stays local.
