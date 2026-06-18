# 0023. Intent taxonomy classification on leads

Date: 2026-06-18

## Status

Accepted

## Context

The same Buska competitive review that produced ADR-0022 (ICP fit scoring) flagged a second idea worth stealing: a **fixed intent taxonomy**. Buska classifies every detected signal into one of five buckets — active demand, competitor mention, pain-point signal, question, brand/recommendation — and lets the user triage by *kind* of signal, not just by score.

Our signals carried only `matched_pattern`: the raw substring keyword that triggered the match (ADR-0009). That string answers "which of my keywords fired" but not "what kind of signal is this." Two leads matched on the keyword `"alternative"` could be a buyer actively shopping or someone idly complaining about a competitor — the owner had to read each post to tell them apart. There was no structured, enumerable signal *type* to group, filter, or reason over.

The product owner does not want to use Buska itself (no third-party dependency). This ADR steals only the idea — a clean taxonomy — and implements it natively in the existing analyze pass.

## Decision

Add an `ai_intent_category` field to intent-signal analysis, produced by the **same single LLM call** that already returns intent score, ICP score, and reply variants (ADR-0010, ADR-0012, ADR-0022). The model classifies each signal into one fixed bucket:

| Value | Meaning |
|---|---|
| `demande_active` | Author is actively shopping for a tool/solution |
| `mention_concurrent` | Author names/compares/complains about a competitor |
| `signal_douleur` | Author voices a problem or frustration, no explicit ask |
| `question` | General domain question, no explicit buying intent |
| `recommandation` | Author asks for or gives a product recommendation |
| `autre` | None of the above fits cleanly (escape hatch) |

The taxonomy is deliberately a **closed enum with an `autre` fallback**, validated server-side with `z.enum(INTENT_CATEGORIES).catch('autre')` so a model that returns an unknown label degrades to `autre` rather than failing the whole analysis. Classification is **independent of score** — a `question` can have a low intent score; the prompt says so explicitly.

No new LLM call, no new endpoint, no new env var. Same JSON-mode + Zod + `200`-with-`ai_error` contract as ADR-0010/0022.

## Schema changes

```sql
ALTER TABLE intent_signals ADD COLUMN ai_intent_category TEXT;
```

One additive nullable column via the existing `addColumnIfMissing` path in `db.ts`, next to the ADR-0022 ICP columns. Pre-existing rows stay `NULL` ("not classified yet") and are re-classified the next time they are analyzed. Reversible by ignoring the column.

## Dashboard

The Lead card header (`leads.tsx`) renders the category as a secondary badge next to the existing `motif :` (matched_pattern) badge — `Demande active`, `Mention concurrent`, etc. via a `CATEGORY_LABELS` map. The badge only appears once the signal has been analyzed.

A **single-select category filter bar** sits under the status tabs. Its chips and counts reflect the **active tab only** (computed from that tab's loaded signals, ordered canonically via `CATEGORY_ORDER`), and it renders nothing until at least one lead in the tab is classified. Selecting a chip filters the visible list client-side; the filter resets to "Toutes" on tab change so a category present in one tab never leaves another tab showing an empty list with no highlighted chip. This is purely a frontend concern — the backend list endpoint stays a thin per-status filter, consistent with the existing tab-per-status fetch model.

## Consequences

### Positive

- Turns the freeform `matched_pattern` into a structured, enumerable signal *type* — the primitive needed for future filtering, grouping, and per-category routing.
- Zero marginal cost: one extra short enum field on a call that already runs.
- `matched_pattern` is untouched — the keyword that fired is still shown; the category sits alongside it, not on top of it.

### Negative / Risks

- Category quality depends on the model. Mitigation: the `autre` bucket plus `.catch('autre')` keep a bad classification cheap and contained; the category is a triage hint, not a metric.
- The five buckets are opinionated and may not fit every product's funnel. Accepted for MVP; the enum is one edit away from extension if real usage shows a missing bucket.

### Neutral

- The substring matcher (`matchIntentForProduct`) is unchanged — categorization is an analyze-time concern, not a collect-time one. Collection stays cheap and deterministic.
- Signals collected but never analyzed have no category, consistent with how `ai_score` already works.

## Explicitly NOT in scope

- **Server-side** category filtering — the filter is client-side over already-loaded signals; the list endpoint is unchanged. A `?category=` query param can be added later if pagination ever makes client-side filtering insufficient.
- Per-category reply-voice or routing (e.g. auto-Discord-push only for `demande_active`).
- Categorizing at collect time, or back-filling historical signals.
- Making the taxonomy product-configurable.

## Participants

- Recorded from a competitive review of Buska.io against the Solopilot acquisition pipeline; second of two ideas adopted (after ADR-0022), implemented natively with no Buska dependency.
