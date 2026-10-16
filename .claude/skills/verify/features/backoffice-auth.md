# Back-office access

When `ADMIN_PASSWORD` is set, every route (API, SPA and `/healthz`) requires HTTP Basic auth as `admin:<password>`. The browser shows its native login prompt after a 401 with `WWW-Authenticate`. A request that carries an API token (`Authorization: Bearer sp_…` or `X-Api-Token: sp_…`) is checked against that token instead and skips Basic auth. Mutating requests must also pass an Origin/Referer same-host check (CSRF), tokens included. Without `ADMIN_PASSWORD` the back-office is open to requests without a token.

## Sub-features

- `basic-auth` is the 401 challenge and the login prompt.
- `csrf-origin` rejects a POST whose Origin or Referer host differs from the request host (403).
- `api-tokens` are the "Jetons d'API" card in Settings and `/api/tokens` (create, list, revoke, audit). A full-access token (scope `*`) reaches the whole API; a scoped token only reaches the routes of its scopes (`comptabilite:read`, `comptabilite:write`, `products:read`) and gets 403 elsewhere. A bad token gets 401 with JSON `{"error":"Jeton API invalide"}` and no `WWW-Authenticate`; repeated failures get 429 with `Retry-After`.
- `setup-mode` is `/setup`, and `/healthz` answering HTTP 503 with `status` "unconfigured" and the `missing` list when required credentials are missing.

## How to get to it (user POV)

- Open any URL of the back-office in a browser without saved credentials.
- `/setup` lists the missing credentials.
- Paramètres → "Jetons d'API" creates and revokes tokens. The secret is shown once.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0 (it sets a random `ADMIN_PASSWORD`).

- **Challenge.** `$C doctor` reports `checks.unauthenticated` `{ status: 401, wwwAuthenticate: "Basic realm=\"Secure Area\"" }` and `basicAuthEnforced: true`. Raw proof: `curl -si http://localhost:3310/` (401 and the header) and `curl -s -o /dev/null -w "%{http_code}" -u admin:wrong http://localhost:3310/api/setup` (401).
- **Authenticated UI.** Every other recipe runs with the credentials the browser daemon adds, so a passing `contact create` proves the authenticated path.
- **Setup mode.** Run `$C goto /setup`, then `$C snapshot` (no `--selector`: `/setup` sits outside the layout and has no `<main>`). The heading is "Configuration requise" and the four X/GitHub credentials show "Manquant".
- **CSRF.** Not wrapped. `curl -s -u admin:<password> -H "Origin: http://evil.invalid" -H "Content-Type: application/json" -d '{}' http://localhost:3310/api/crm/contacts` must answer 403 (checked in the pilot run). Read the password from `.verify-run/state.json` (`adminPassword`); never paste it into evidence.
- **API tokens.** Not wrapped. `curl -si -H "Authorization: Bearer sp_bad" http://localhost:3310/api/setup` answers 401 with `{"error":"Jeton API invalide"}` and no `WWW-Authenticate`. Create a scoped token with `curl -s -u admin:<password> -H 'Content-Type: application/json' -d '{"name":"verify-fake","scopes":["products:read"]}' http://localhost:3310/api/tokens`; the response holds `token` (metadata) and `secret`. With `-H "Authorization: Bearer <secret>"`, `GET /api/products` answers 200 and `GET /api/crm/contacts` answers 403 (gardener run 2026-10-16). Never paste the secret into evidence.

## Gotchas

- Before PR #131, `app.onError` turned the 401 into a plain 500, so browsers got "Internal Server Error" and no prompt. `doctor` flags it.
- `/healthz` sits behind the same auth. The image's own `HEALTHCHECK` (`wget --spider`) fails on a 401; the homelab compose overrides it with a check that accepts any HTTP status.
- In setup mode `/healthz` answers 503, not 200. A check on the status code alone reads it as down; read the body.
- `info` never prints the throwaway password.
