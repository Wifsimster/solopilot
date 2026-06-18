# 0022. ICP fit scoring on intent signals

Date: 2026-06-18

## Status

Accepted

## Context

A competitive review of [Buska](https://www.buska.io/fr) — a social-listening-for-lead-gen SaaS whose feature set overlaps heavily with our acquisition pipeline (ADR-0006 through ADR-0012) — surfaced one capability we had not built: **ICP (Ideal Customer Profile) matching**. Buska's whole positioning ("finds buyers, not mentions") rests on scoring two independent dimensions per lead: *intent* (does this post express a need?) and *fit* (does the author look like our target customer?). It surfaces the leads that score high on both.

Our `analyzeIntentSignal` flow (ADR-0010, ADR-0012) only produced the first dimension: a 0–100 intent `score`, an explanation, and N reply variants. It ignored fit entirely. Worse, the product model already carried the inputs needed to score fit — `target_audience` and `value_props` (added for the Content Studio, ADR-0011) — but the leads prompt never read them. A lead from a perfectly-on-profile author with mild intent looked identical to a lead from an off-profile author with loud intent. The owner had to infer fit by hand from the post text.

This ADR steals the ICP-matching idea and closes that gap, reusing fields we already collect.

## Decision

Add a second scoring dimension to the existing single analyze call. `analyzeIntentSignal` now returns, alongside the intent `score`/`explanation`/`replies` it already produced, an `ai_icp_score` (0–100) and an `ai_icp_reason` (1–2 French sentences). The two scores are explicitly **independent** — the prompt instructs the model that a post can be high-intent / low-fit or low-intent / high-fit, and to score each on its own axis.

The ICP score is grounded in the product's `target_audience` and `value_props`, which are now injected into the analyze user payload (they were previously omitted). When `target_audience` is undefined, the model returns `icp_score = 50` and says so in `icp_reason`, so the column is never silently misleading.

No new LLM call, no new endpoint, no new env var. Same one-JSON-object-per-click contract, same JSON-mode + Zod validation, same 200-with-`ai_error` failure semantics as ADR-0010. The reply-variant gating is unchanged — variants still gate on intent `score < 40`, not on ICP fit. ICP is a triage signal, not a generation gate.

## Schema changes

```sql
ALTER TABLE intent_signals ADD COLUMN ai_icp_score INTEGER;
ALTER TABLE intent_signals ADD COLUMN ai_icp_reason TEXT;
```

Two additive nullable columns, appended via the existing `addColumnIfMissing` path in `db.ts` next to the ADR-0010 `ai_*` columns. Rows analyzed before this ADR keep `NULL` and render as "fit not scored yet"; the wire shape from ADR-0010/0012 is otherwise untouched. Reversible by ignoring the columns.

## Dashboard

The Lead card AI block (`lead-card-sections.tsx`) gains:

- A **"Profil cible : N/100"** badge next to the existing **"Intention : N/100"** badge (the intent badge was relabelled from the generic "Score IA" to disambiguate the two axes), color-coded on the same 0–39 / 40–69 / 70–100 thresholds.
- A **"🎯 Prioritaire"** badge that appears only when both scores are ≥ 70 — the high-intent-AND-high-fit quadrant Buska sells. This is the payoff: the owner sees at a glance which leads are worth answering first.
- An **`ai_icp_reason`** block mirroring the existing explanation block.

## Consequences

### Positive

- Closes the one real capability gap the Buska review identified, by reusing `target_audience` / `value_props` that were already collected but unused in the leads pipeline.
- Sharper triage: the "Prioritaire" quadrant collapses a two-number scan into one glance, without any new automation or opaque ranking.
- Zero marginal cost — same single LLM call, a few hundred more output tokens for the second score + reason.

### Negative / Risks

- ICP score quality depends entirely on the owner filling in `target_audience` and `value_props`. Mitigation: the `icp_score = 50` fallback plus an explicit `icp_reason` make the "no profile defined" case visible rather than a misleadingly precise number.
- Two scores invite over-interpretation of small deltas. Accepted: same stance as ADR-0010 — the scores are rough triage signals, not metrics we dashboard over time.

### Neutral

- The `replies/generate` path (ADR-0012) is untouched — it never scored, and still does not.
- No backfill: pre-ADR signals keep `NULL` ICP columns until re-analyzed.

## Explicitly NOT in scope

- ICP-driven reply gating or Discord push — intent `score` remains the only gate.
- A combined/weighted single score — the two axes stay separate by design; the owner combines them visually.
- Per-source ICP weighting, ICP-score history, or calibration tracking.

## Participants

- Recorded from a competitive review of Buska.io against the Solopilot acquisition pipeline.
