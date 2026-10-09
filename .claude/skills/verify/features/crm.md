# CRM

The owner keeps contacts (leads, active and inactive clients) and drags deals through a pipeline (Nouveau, Qualifié, Proposition, Gagné, Perdu). Dormant deals get follow-up drafts, served by the API and the CLI only. Everything is scoped to the selected product (activity).

## Sub-features

- `contact-create` adds a contact with "Nouveau contact" (Nom, Société, Statut, Email).
- `contact-table` lists contacts with sorting and the status filter buttons "Lead", "Actif", "Inactif".
- `deal-create` adds a deal with "Nouvelle opportunité" (disabled until a contact exists).
- `deal-move` drags a deal between pipeline columns (`POST /api/crm/deals/<id>/stage`).
- `crm-relances` drafts follow-ups for dormant deals: `GET /api/crm/relances` and the CLI only. The `/crm` page has no list for them; only its description mentions them.

## How to get to it (user POV)

- The sidebar entry for the CRM, or a direct URL: `/crm`.
- Contacts also arrive from the veille: when a product has `crm_leads_enabled`, the collection creates a `lead` contact with `source` "veille" (`src/modules/crm/lead-from-mention.ts`). Not drivable offline. `/leads` ("Opportunités") does not create contacts.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0.

- **Create a contact.** Run `$C contact create --name "Fake Client SARL" --company "Fake Corp" --email client@example.invalid --status active`. Expect `response.status 201`, `rowOnPage` "Fake Client SARL Fake Corp client@example.invalid active", `dbRow.status` "active", `dbRow.source` "manual", and `contactsAfter = contactsBefore + 1`. `contact-create-dialog.png` shows the filled dialog; `contact-created.png` shows the table.
- **Second read.** Run `$C contact list`.
- **Filter.** Run `$C click --role button --name "^Actif$"`, then `$C snapshot --selector main`. Only active contacts stay in the table.
- **Create a deal.** Not wrapped, and there is no fill command: type with `key`, one character per call. With a contact present, run `$C click --role button --name "^Nouvelle opportunité$"`, `$C click --label "^Intitulé$"`, then `for k in F a k e D e a l; do $C key $k; done`, `$C click --role combobox --name "^Contact"`, `$C click --role option --name "Fake Client SARL"` and `$C click --role button --name "^Créer$"`. Expect `POST /api/crm/deals` 201 in `$C network-log --filter /api/crm/deals` and the card "FakeDeal Fake Client SARL" under "Nouveau 1". Second read: `node -e` with `better-sqlite3` on `.verify-run/data/verify.db`, table `deals` (`stage` "nouveau").
- **Move a deal.** Use the board's keyboard drag: `$C click --role button --name "^FakeDeal"`, `$C key Space`, ten times `$C key ArrowRight` (each press moves the card 25 px; one press is not enough to reach the next column), then `$C key Space`. Expect `POST /api/crm/deals/<id>/stage` 200 in `$C network-log --filter /stage`, the columns reading "Nouveau 0 Qualifié 1", and `deals.stage` "qualifie".

## Gotchas

- "Nouvelle opportunité" stays disabled while the contact list is empty.
- The status column shows the raw value (`lead`, `active`, `inactive`), while the filter buttons show French labels. Match the raw value in `rowOnPage`.
- The dialog labels are "Société (optionnel)" and "Email (optionnel)"; anchor `--label` regexes on the start only.
- Email is optional, but when given it must be a valid address (zod `email()`): the API answers 400 otherwise.
