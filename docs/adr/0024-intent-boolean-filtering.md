# 0024. Boolean exclude/require filtering for intent matching

Date: 2026-06-18

## Status

Accepted

## Context

A competitive review of the Reddit/X intent-monitoring landscape (Syften, Awario, F5Bot, Octolens, Prowlo) surfaced one capability our matcher lacked and that every serious player above the free tier has: **pre-LLM boolean filtering**. F5Bot is the cheap baseline precisely because it matches raw keywords with no filtering — "track `developer`, get every post that contains the word." Syften's and Awario's whole paid edge is exclude terms and required co-occurring terms that cut the noise *before* anything expensive happens.

Our matcher (`matchIntentForProduct`, ADR-0009) is the F5Bot shape: plain case-insensitive substring matching of each `intent_keyword` against the post text, one signal per hit. ADR-0010 explicitly quantified the cost of that bluntness — *"the owner dismisses ~70% of substring matches in seconds."* Every one of those dismissals is wasted owner attention, and (once analyzed) wasted LLM spend on ICP scoring and taxonomy classification (ADR-0022, ADR-0023). The cheapest possible lever against that 70% is a deterministic gate that never reaches the LLM at all.

## Decision

Add two optional, product-level term lists that refine intent matching, applied **before** the include-keyword pass:

- **`intent_exclude_keywords`** — if the post contains **any** of these (case-insensitive substring), it is skipped entirely; no signals are produced from it.
- **`intent_require_keywords`** — if this list is **non-empty**, the post must contain **at least one** of these terms to be eligible; otherwise it is skipped.

Semantics, per post, in order: `exclude` gate → `require` gate → existing per-keyword include matching (unchanged, still one signal per matching include keyword with `matched_pattern` = that keyword). Both lists default to empty, in which case behaviour is byte-for-byte identical to ADR-0009 — this is a pure refinement, not a rewrite.

Example: include `alternative à notion`, exclude `emploi, recrute, salaire`, require `cherche, recommande, quelqu'un`. A hiring post that mentions Notion is dropped at the exclude gate; a neutral product comparison that matches no require term is dropped at the require gate; "quelqu'un a une **alternative à notion** ? je **cherche** un truc plus simple" passes both and matches.

The gate is plain substring logic — deterministic, synchronous, zero LLM cost, evaluated once per post (the normalized exclude/require lists are computed once per match run, not per keyword). It runs in both the live collect path (`matchIntentForProduct`) and the full rescan (`rematchIntentForProductAll`).

## Schema changes

```sql
ALTER TABLE products ADD COLUMN intent_exclude_keywords TEXT; -- JSON string[]
ALTER TABLE products ADD COLUMN intent_require_keywords TEXT; -- JSON string[]
```

Two additive nullable JSON-array columns, serialized exactly like the existing `intent_keywords` / `reddit_subreddits` / `hn_keywords` columns, via the existing `addColumnIfMissing` path in `db.ts`. `null`/absent means "no filter." Validated with the same `intentKeywordSchema` (2–128 chars) and a 30-term cap each, mirroring `intent_keywords`. Reversible by ignoring the columns.

## Dashboard

The "Détection d'intention" card in the product create/edit dialog gains two `ChipInput` fields under the existing intent-keywords input, in a two-column row:

- **"Exclure si contient"** → `intent_exclude_keywords` (placeholder `emploi, recrute, salaire`).
- **"Exiger au moins un"** → `intent_require_keywords` (placeholder `cherche, recommande, quelqu'un`).

Both are optional, gated behind the same intent-enabled toggle, flushed on submit like the other chip inputs, and sent as `null` when empty so the backend stores "no filter" rather than `[]`.

## Consequences

### Positive

- Attacks the ~70% dismissal rate at its source, deterministically and for free — before any LLM token is spent on ICP scoring or taxonomy classification.
- Closes the one functional gap versus the paid monitoring tools (Syften/Awario) while keeping our self-hosted, no-API-tax model.
- Pure refinement: empty lists reproduce ADR-0009 behaviour exactly, so existing products are unaffected until the owner opts in.
- Compounds the recently merged scoring/taxonomy work — cleaner input means higher-signal output.

### Negative / Risks

- Substring exclusion can over-filter (e.g. excluding `pro` would also drop `problème`). Mitigation: the fields are optional, owner-curated, and documented as substring matches; the require gate is opt-in and only narrows when non-empty.
- Two more columns and two more form fields. Accepted — they follow the established keyword-list pattern exactly, no new abstraction.

### Neutral

- `matched_pattern` and the signal shape are unchanged; the gate only decides whether a post is considered, not how a match is recorded.
- No LLM involvement, no new endpoint — the filter lives entirely in the existing match path and product CRUD.

## Explicitly NOT in scope

- A full boolean query language (parentheses, nested AND/OR, per-keyword operators) — global exclude + require lists cover the 80% at a fraction of the UI/parsing cost. Revisit only if real usage shows it is insufficient.
- AI-suggested exclude/require terms in the "Tout générer" flow — the suggestion endpoint still returns include keywords only.
- Per-source or per-keyword filters — the lists apply product-wide, matching how Syften's global filters work.
- Regex or word-boundary matching — substring only, consistent with ADR-0009's include matching.

## Participants

- Recorded from a competitive review of the Reddit/X intent-monitoring landscape (Syften, Awario, F5Bot) against the Solopilot acquisition pipeline; implemented natively with no third-party dependency.
