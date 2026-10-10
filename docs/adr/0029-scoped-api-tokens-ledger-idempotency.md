# 0029. Scoped API tokens and idempotent ledger writes

Date: 2026-10-10

## Status

Proposed

## Context

The household budget agent must record revenue and expenses in the ledger, for
example Google Play payouts for `toko` (15/06 +0,24 € ref GG104F32CP, 15/09
+3,56 € ref GG104IQZ35). The API had one credential: the admin Basic-auth
password (`ADMIN_PASSWORD`), which opens every route, settings and secrets
included. Giving it to an agent is not acceptable. An agent also retries, so
the same payout must not be written twice.

## Decision

1. **Scoped API tokens** (`src/api-tokens.ts`, tables `api_tokens`,
   `api_token_audit`).
   - Secret `sp_` + 32 random bytes (base64url), shown once at creation. Only
     its SHA-256 is stored, plus a 7-character display prefix. A fast hash is
     enough: the secret is 256-bit random, not a password.
   - Sent as `Authorization: Bearer sp_…` or `X-Api-Token: sp_…`. The second
     header exists for deployments where a forward-auth proxy already uses
     `Authorization`.
   - The token middleware runs before Basic auth. A request that carries a
     token is authenticated by that token only. Requests without a token
     behave as before.
   - **Default deny.** A scope maps to an explicit list of (method, exact path)
     rules (`ROUTE_RULES`). Any other route, including `/api/tokens`, non-API
     paths and `HEAD`, returns 403 for a token. Initial scopes:
     `comptabilite:read`, `comptabilite:write` (not implying read),
     `products:read` (projection `id`, `name`, `archived`). A new scope is a
     label plus rules; no wildcards.
   - Optional product restriction, checked on the same `productId` / `activity`
     query parameter the handlers read (default product included).
   - Unknown, malformed or revoked tokens return a generic 401. Ten failures in
     ten minutes from a client (socket address + right-most `X-Forwarded-For`
     hop) lock token auth for that client for 15 minutes (429). In memory, per
     process.
   - Audit: one row per token request (token id, method, path, product, status,
     outcome, client), never bodies, kept 90 days. `last_used_at` is updated.
   - Management (create, list, revoke, audit) is admin only, in Settings >
     « Jetons d'API ». Revocation is soft so the audit keeps its token.
2. **Idempotent ledger writes.** New nullable columns `external_ref`, `source`,
   `api_token_id` (added by the idempotent `runComptaMigrations`, as in the
   rest of `db.ts`) and a partial unique index on `(product_id, external_ref)
   WHERE external_ref IS NOT NULL`.
   - A POST whose `(product, external_ref)` already exists returns **409** with
     `{ error, entry }`, the existing entry, and writes nothing. We chose 409
     over an idempotent 200 so the caller can tell "created" from "already
     there" and spot a mismatch (same reference, different amount).
   - The unique index is the guard (no check-then-insert race).
   - `source` (e.g. `agent:budget`) is caller-declared and informational; the
     authenticated `api_token_id` is stored separately and cannot be spoofed.
     The ledger is now listed on the Comptabilité page with its origin.
   - Entries without `external_ref` behave as before (no deduplication).
3. **Product addressing.** `productId` is the product slug (`products.id`,
   validated by the slug schema, e.g. `toko`); there is no separate numeric id.
   An unknown product on POST is now a 404 instead of a foreign-key 500.
4. `server.ts` exposes `createApp()` (routes without listening) so tests drive
   the real app through `app.request()`.

## Consequences

- Agents get least-privilege access with an audit trail and can be cut off by
  revoking one token, without rotating `ADMIN_PASSWORD`.
- With `ADMIN_PASSWORD` unset the API is still open to anyone; tokens are then
  restrictions on their holders only. Production must keep `ADMIN_PASSWORD`.
- The rate limiter is in memory: it resets on restart and is per instance.
- Keying on the right-most `X-Forwarded-For` hop assumes one trusted reverse
  proxy in front; behind a chain, clients behind the same edge share a bucket.
