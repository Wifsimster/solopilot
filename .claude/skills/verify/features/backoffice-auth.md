# Back-office access

When `ADMIN_PASSWORD` is set, every route (API, SPA and `/healthz`) requires HTTP Basic auth as `admin:<password>`. The browser shows its native login prompt after a 401 with `WWW-Authenticate`. Mutating requests must also pass an Origin/Referer same-host check (CSRF). Without `ADMIN_PASSWORD` the back-office is open.

## Sub-features

- `basic-auth` is the 401 challenge and the login prompt.
- `csrf-origin` rejects a POST whose Origin or Referer host differs from the request host (403).
- `setup-mode` is `/setup`, and `/healthz` answering HTTP 503 with `status` "unconfigured" and the `missing` list when required credentials are missing.

## How to get to it (user POV)

- Open any URL of the back-office in a browser without saved credentials.
- `/setup` lists the missing credentials.

## Driving it with control-solopilot

Preconditions:

- A fresh `$C launch`, and `$C doctor` exits 0 (it sets a random `ADMIN_PASSWORD`).

- **Challenge.** `$C doctor` reports `checks.unauthenticated` `{ status: 401, wwwAuthenticate: "Basic realm=\"Secure Area\"" }` and `basicAuthEnforced: true`. Raw proof: `curl -si http://localhost:3310/` (401 and the header) and `curl -s -o /dev/null -w "%{http_code}" -u admin:wrong http://localhost:3310/api/setup` (401).
- **Authenticated UI.** Every other recipe runs with the credentials the browser daemon adds, so a passing `contact create` proves the authenticated path.
- **Setup mode.** Run `$C goto /setup`, then `$C snapshot` (no `--selector`: `/setup` sits outside the layout and has no `<main>`). The heading is "Configuration requise" and the four X/GitHub credentials show "Manquant".
- **CSRF.** Not wrapped. `curl -s -u admin:<password> -H "Origin: http://evil.invalid" -H "Content-Type: application/json" -d '{}' http://localhost:3310/api/crm/contacts` must answer 403 (checked in the pilot run). Read the password from `.verify-run/state.json` (`adminPassword`); never paste it into evidence.

## Gotchas

- Before PR #131, `app.onError` turned the 401 into a plain 500, so browsers got "Internal Server Error" and no prompt. `doctor` flags it.
- `/healthz` sits behind the same auth. The image's own `HEALTHCHECK` (`wget --spider`) fails on a 401; the homelab compose overrides it with a check that accepts any HTTP status.
- In setup mode `/healthz` answers 503, not 200. A check on the status code alone reads it as down; read the body.
- `info` never prints the throwaway password.
