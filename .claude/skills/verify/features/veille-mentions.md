# Veille / Mentions

Collected items (X, Reddit, HN) that the AI triage scored (category, urgency 0–100) form an inbox. The owner works it like an e-mail inbox: "Nouvelles", "Traitées", "Ignorées" tabs, quick filters, and a "Traité" or "Ignorer" action per item. Urgent new items also show on the dashboard.

## Sub-features

- `veille-inbox` lists new items sorted by urgency, with source, urgency badge, category and author.
- `veille-tabs` switches between "Nouvelles N", "Traitées N" and "Ignorées N".
- `veille-filters` are "Urgentes", "Mentions directes", "Toutes" and one button per category.
- `veille-triage` is "Traité" / "Ignorer" on an item (`PATCH /api/veille/items/<id>`).
- `veille-collect`, `veille-ai-triage` and `veille-digest` (cron, AI and Discord) are not drivable offline.

## How to get to it (user POV)

- The sidebar entry "Mentions", or a direct URL: `/mentions`.
- The dashboard `/` shows urgent new items.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0. The six fake items are seeded: `verify-1` to `verify-4` new (urgency 85, 72, 35, 20), `verify-5` handled, `verify-6` ignored.

- **List.** Run `$C veille list`. Expect `apiCount` = `dbCount` = 4, every `visibleOnPage` true, and `order` sorted by urgency (85, 72, 35, 20).
- **Triage.** Run `$C veille mark --item "URSSAF" --as handled`. Expect `response.status 200`, `statusAfter` "handled", `stillVisibleInNewList: false` and `tabsAfter` ["Nouvelles 3", "Traitées 2", "Ignorées 1"].
- **Other tabs.** Run `$C veille list --tab handled`. Expect 2 items, including `verify-2`.
- **Second read.** Run `$C veille show`.
- **Filters.** Run `$C click --role button --name "^Urgentes$"`, then `$C snapshot --selector main`.
- **Collection, AI triage, digest.** Not drivable: they need X/Reddit/HN, an AI key and a Discord webhook, and the server boots without them. Report as not verified.

## Gotchas

- The seed writes the triage fields directly (category, urgency, `triaged_at`), as the AI triage step would. The proof covers the inbox and the owner actions, not the scoring.
- "Ouvrir la source" links point at `example.invalid`. Do not click them.
- Item cards have no list role. `veille mark` finds the innermost block that holds the text and a "Traité" button.
