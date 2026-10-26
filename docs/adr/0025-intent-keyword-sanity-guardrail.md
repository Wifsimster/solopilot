# 0025. Intent keyword sanity guardrail

Date: 2026-07-23

## Status

Accepted

## Context

Production incident: the Acquisition module produced **zero** leads for every
product. Investigation (see repo issue #119) found the `toko` product was the
only one with `intent_enabled = true`, and its `intent_keywords` were written as
full natural-language sentences, e.g.:

> `"outil pour suivre les symptômes TDAH de mon enfant"`
> `"application mobile TDAH adaptée aux familles"`

ADR-0009 deliberately chose **case-insensitive substring matching**
(`text.includes(keyword)`) for intent signals — boring, cheap, deterministic,
and easy for the owner to reason about. That decision stands. But it has a sharp
edge: a keyword written as a whole sentence will essentially never appear
verbatim as a substring of a real post, so it matches nothing — **silently**.
Nothing in the logs, the collect summary, or the cockpit indicated the keywords
themselves were the problem. The owner sees "0 leads" and cannot tell whether
the sources are dry or the config is broken.

This is the exact silent-zero-match failure mode ADR-0009 flagged for regex
("a broken pattern is a silent zero-match failure mode that the dashboard cannot
diagnose"), reappearing for substring keywords.

## Decision

Keep the substring matcher unchanged (ADR-0009 is **not** superseded). Add a
**guardrail** that makes the sentence-as-keyword misconfiguration visible
instead of silent. A keyword is "sentence-like" when its word count exceeds a
threshold (`maxWords = 6`); short intent phrases like `"looking for X"`,
`"alternative to Y"`, `"anyone using Z"` stay well under it.

One pure helper, `findSentenceLikeKeywords(keywords, maxWords = 6)` in
`intent-service.ts`, powers three surfaces:

1. **Collect logs** — when `matchIntentForProduct` scans a non-empty batch and
   matches nothing while sentence-like keywords exist, it emits a `logger.warn`
   naming the offending keywords. The warning is gated on the actual symptom
   (scanned > 0, matched == 0) so it never fires as noise on a healthy product.
2. **Cockpit briefing** — `buildBriefing` reports `acquisition.suspiciousKeywords`
   (a count), rendered as a ⚠️ line in the daily French brief and in the web
   cockpit's Acquisition card.

The helper does not touch matching behaviour: it only reads the configured
keywords and reports. No matched signal changes as a result of this ADR.

## Why not change the matcher

Token-based / fuzzy matching was considered and rejected for the same reasons
ADR-0009 rejected regex and embeddings: it trades the owner's ability to predict
exactly what matches for recall the owner cannot audit. The real fix for the
incident is configuration (short keywords + query-driven sources); the guardrail
exists so the next misconfiguration is caught in minutes, not by a production
"why are leads empty?" investigation.

## Consequences

### Positive

- The silent failure becomes loud at three touchpoints (logs, brief, cockpit).
- Zero behavioural change to matching — no risk of new false positives, no ADR-0009 regression.
- Pure, dependency-free helper; trivial to reason about and reuse.

### Negative / Risks

- The word-count heuristic is coarse: a legitimate 7-word phrase would be flagged. It only warns (never blocks or drops the keyword), so a false flag costs nothing but a dismissible notice.
- The collect-time warning only fires when a batch matched nothing; a product with a mix of good and sentence keywords that still matches on the good ones won't warn from collect (but the cockpit count still shows the sentence-like keywords).

### Neutral

- `maxWords` is a policy constant, easy to tune. Not exposed as per-product config — no demand.

## Related

- ADR-0009 — the substring matcher this guardrail protects.
- Issue #119 — the production incident that motivated it, plus the `toko` config fix (short keywords, Reddit FR subs, retuned HN keywords, CRM lead bridge enabled).

---
_Recorded as part of issue #119 implementation._
