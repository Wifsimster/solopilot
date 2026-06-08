# 0019. Agenda — local events with optional ICS calendar sync

Date: 2026-06-08

## Status

Accepted

## Context

The last planned business module. An auto-entrepreneur's day is shaped by
appointments; the Cockpit's morning brief is incomplete without "what's on
today". The environment offers a Google Calendar connector, but — as with Stripe
— the production app must not depend on it, and OAuth is heavy.

## Decision

Add an `agenda` module: a local calendar-event store plus an **optional ICS feed
sync**, the same standalone-first / degrade-gracefully shape as Facturation.

### Why ICS over OAuth

A read-only ICS feed URL (Google Calendar's "secret address in iCal format", or
any provider's) needs no OAuth flow and no dependency — just `fetch` + a minimal
VEVENT parser. It is the pragmatic, dependency-free way to pull a calendar. Full
OAuth/two-way sync can come later if writing back is ever needed.

### Data, store, connector

- `calendar_events` table (idempotent), scoped by `product_id`, with a partial
  unique index on `(product_id, external_id)` for idempotent ICS upserts.
- Store: `createEvent` (manual), `listUpcomingEvents`, `listEventsForDay`,
  `upsertCalendarEvents`, `agendaSummary`.
- `connectors/calendar.ts`: `isConfigured()` false when `AGENDA_ICS_URL` unset
  (then `listUpcoming()` → []); otherwise fetches and parses the feed. The ICS
  parser unfolds lines and maps UID/SUMMARY/DTSTART/DTEND/LOCATION, converting
  ICS date forms to ISO. Read-only.

### Workflows (`enabled: false`)

- `agenda.sync` (every 30 min) = `[agenda.sync]`; degradable, no-op without a feed.
- `agenda.rappels` (07:00) = `[agenda.rappels, notify.discord]`; emits `null`
  content (so notify skips) on an empty day.

### Surfacing

- API: `GET /api/agenda` (summary + today + upcoming), `POST /api/agenda/events`.
- UI: `/agenda` page (today + upcoming) under "Gérer".
- Cockpit: agenda flips `planned → live`. **With this, every business module is
  live** — the Cockpit brief is complete and the migration plan's module roadmap
  is done.

## Consequences

### Positive

- Completes the company-of-one picture: the morning brief now includes the day's
  events alongside veille, leads, invoices, turnover and pipeline.
- ICS sync is real yet dependency-free and degrades to a local store.
- The minimal ICS parser is unit-tested (VEVENT → ISO) without network.

### Negative / Risks

- **The ICS parser is intentionally minimal** — it handles the common VEVENT
  fields and date forms, not recurrence rules (RRULE) or all TZID nuances.
  Recurring events expand only as the feed materializes them. Documented; a
  fuller parser (or a library) is a later option.
- **Read-only** — no writing events back to the calendar. By design this phase.

### Neutral

- Manual events and ICS-synced events coexist (`source` column distinguishes).

## Explicitly NOT in scope

- OAuth / two-way Google Calendar sync; writing events back.
- RRULE recurrence expansion.
- Enabling/scheduling the workflows — part of the deferred flip.

## Alternatives Considered

### Google Calendar OAuth integration
Rejected for now: OAuth flow + token storage + refresh is heavy for a read-only
need. ICS gives 90% of the value with none of the ceremony.

### A third-party ICS library
Rejected: the minimal in-house parser covers our fields without adding a
dependency. Revisit if RRULE/timezone fidelity becomes necessary.

### Persist nothing, render the feed live
Rejected: a local store lets manual events coexist, survives feed outages, and
lets the cockpit aggregate without a network call on every brief.

## Participants

- SOLID Alex (Senior Backend Engineer) — Chose ICS + a minimal in-house parser
  over OAuth and a dependency; kept the connector read-only and degradable.
- Whiteboard Damien (Tech Lead / Architect) — Local store as upsert target with a
  partial unique index on external_id; deferred RRULE and write-back.
- Sprint Zero Sarah (Product Owner) — Scoped to read-only sync + manual events for
  this phase; this closes the module roadmap, leaving only the veille flip.
- Edge-Case Nico (QA Engineer) — Unit-tested the ICS→ISO parse and the no-feed
  graceful no-op; flagged RRULE/TZID as known parser limitations.

---
_Decision recorded automatically from fast-meeting analysis._
