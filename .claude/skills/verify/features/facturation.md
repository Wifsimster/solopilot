# Facturation

A local invoice ledger. The owner enters invoices by hand (client, amount in euros, status, issue and due dates). The page shows the cash collected ("CA encaissé"), the amount still pending ("En attente"), reminders for overdue invoices ("Relances à valider", drafted, never sent) and a monthly chart. Stripe sync and Checkout are optional and need a Stripe key.

## Sub-features

- `invoice-create` adds an invoice with "Nouvelle facture"; the number `F-<year>-NNN` is assigned by the server.
- `invoice-totals` are the KPI cards "CA encaissé" (paid) and "En attente" (sent).
- `invoice-pay` is "Marquer payée" on a row (status paid, `paid_on` today).
- `invoice-relances` drafts a reminder for each sent invoice past its due date.
- `invoice-chart` is "CA encaissé par mois". Despite its subtitle ("sur les 6 derniers mois"), it groups paid invoices by issue month (`issued_on`, not `paid_on`) and keeps the 6 most recent months that have data.
- `stripe-sync` and `stripe-checkout` ("Encaisser") need `STRIPE_API_KEY` / `STRIPE_PUBLISHABLE_KEY`.
- There is **no invoice PDF** in the product.

## How to get to it (user POV)

- The sidebar entry for invoicing, or a direct URL: `/facturation`.
- The cockpit Facturation card shows the overdue count and amount, as plain text (no link).

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0. The ledger is empty.

- **Create.** Run `$C invoice create --client "Fake Client SARL" --amount 1250.50`. Expect `response.status 201`, `number` `F-<year>-001`, `amount_cents` 125050 (`expectedCents` equal), `rowOnPage` with "1250.50 EUR Envoyée", and `totals.shown` = `totals.expectedShown` = `{ caEncaisse: "0.00 EUR", enAttente: "1250.50 EUR" }` with `totals.match: true`.
- **Overdue reminder.** Run `$C invoice create --client "Overdue Fake SAS" --amount 99.99 --due-in -10`. "En attente" becomes the sum of both (1350.49 EUR). Then run `$C goto /facturation` (the card does not refresh by itself, see Gotchas) and `$C snapshot --selector main`: it shows "Relances à valider" = 1 and the drafted text for that invoice ("10 j de retard").
- **Pay.** Run `$C invoice pay --number F-<year>-001`. Expect `dbRow.status` "paid" with `paid_on` today, the row showing "Payée", and the totals moving: "CA encaissé" 1250.50 EUR, "En attente" 99.99 EUR, `match: true`.
- **Second read.** Run `$C invoice list`.
- **PDF.** Not applicable: Solopilot has no PDF route, button or library. Report "feature absent".
- **Stripe.** Not drivable without a Stripe key. The page shows "Mode ledger local — Stripe non configuré", and Stripe.js is blocked by the daemon. Report as not verified.

## Gotchas

- The totals cover every invoice of the product, not only the current year, and use the first invoice's currency label. Mixed currencies would add up wrongly; the dialog only creates EUR invoices.
- "Relances à valider" only refreshes on a page load: after creating an invoice (or "Marquer payée") the page refetches invoices, not reminders, so the card shows stale counts until reload. Product bug, [#133](https://github.com/Wifsimster/solopilot/issues/133). Reload before reading it, and remove this note once #133 is fixed.
- The amount field takes euros (`1250.50` or `1250,50`); the API stores cents.
- `--due-in` is relative to today in UTC; the overdue logic compares with today's date in Paris. Avoid a run that crosses midnight Paris time.
