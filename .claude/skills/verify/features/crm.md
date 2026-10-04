# CRM

The owner keeps contacts (leads, active and inactive clients) and drags deals through a pipeline (Nouveau, Qualifié, Proposition, Gagné, Perdu). Dormant deals get follow-up drafts for validation. Everything is scoped to the selected product (activity).

## Sub-features

- `contact-create` adds a contact with "Nouveau contact" (Nom, Société, Statut, Email).
- `contact-table` lists contacts with sorting and the status filter buttons "Lead", "Actif", "Inactif".
- `deal-create` adds a deal with "Nouvelle opportunité" (disabled until a contact exists).
- `deal-move` drags a deal between pipeline columns (`POST /api/crm/deals/<id>/stage`).
- `crm-relances` lists follow-up drafts for dormant deals.

## How to get to it (user POV)

- The sidebar entry for the CRM, or a direct URL: `/crm`.
- Leads promoted from `/leads` (Acquisition) also land in the contact table.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0.

- **Create a contact.** Run `$C contact create --name "Fake Client SARL" --company "Fake Corp" --email client@example.invalid --status active`. Expect `response.status 201`, `rowOnPage` "Fake Client SARL Fake Corp client@example.invalid active", `dbRow.status` "active", `dbRow.source` "manual", and `contactsAfter = contactsBefore + 1`. `contact-create-dialog.png` shows the filled dialog; `contact-created.png` shows the table.
- **Second read.** Run `$C contact list`.
- **Filter.** Run `$C click --role button --name "^Actif$"`, then `$C snapshot --selector main`. Only active contacts stay in the table.
- **Create a deal.** Not wrapped. With a contact present, run `$C click --role button --name "^Nouvelle opportunité$"`, then `$C snapshot` and fill the dialog by its labels. Second read: `node -e` with `better-sqlite3` on `.verify-run/data/verify.db`, table `deals`.
- **Move a deal.** Drag and drop is not wrapped. Prove the stage change by the `POST /api/crm/deals/<id>/stage` line in `$C network-log --filter /api/crm/deals` and the `deals.stage` row.

## Gotchas

- "Nouvelle opportunité" stays disabled while the contact list is empty.
- The status column shows the raw value (`lead`, `active`, `inactive`), while the filter buttons show French labels. Match the raw value in `rowOnPage`.
- Email is optional, but when given it must be a valid address (zod `email()`): the API answers 400 otherwise.
