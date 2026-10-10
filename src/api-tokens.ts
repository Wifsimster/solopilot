/**
 * Scoped API tokens (ADR-0029).
 *
 * A token lets an external agent (e.g. the household budget agent) reach a
 * narrow slice of the API without the admin password. Design:
 * - secret = `sp_` + 32 random bytes (base64url), shown once at creation;
 *   only its SHA-256 is stored (the secret is high-entropy, so a fast hash is
 *   enough and lookup by hash avoids timing comparisons);
 * - the full-access scope `*` reaches every route, method and product, like
 *   the admin password (decision of 2026-10-10: OpenClaw gets full access);
 * - other scopes map to an explicit allow-list of (method, path) rules;
 *   anything else is 403 for those tokens (default deny), including token
 *   management;
 * - optional product restriction (scoped tokens only), checked on the same
 *   `productId` the route handlers read;
 * - failed token attempts are rate-limited per client and every
 *   token-authenticated request is audited (no bodies).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import { getDb, DEFAULT_PRODUCT_ID, type ApiTokenAuditRecord, type ApiTokenRecord } from './db.js';
import { logger } from './logger.js';

// --- Scopes & route rules ---

/** Full-access scope: every route and method, every product, like the admin. */
export const FULL_ACCESS_SCOPE = '*';

export const API_TOKEN_SCOPES = {
  [FULL_ACCESS_SCOPE]:
    "Accès complet : toutes les routes et méthodes, tous les produits, comme l'administrateur",
  'comptabilite:read': 'Lire la comptabilité (statut, journal des écritures)',
  'comptabilite:write': 'Ajouter des écritures au journal comptable',
  'products:read': 'Lister les produits (identifiant et nom uniquement)',
} as const;

export type ApiTokenScope = keyof typeof API_TOKEN_SCOPES;
export const API_TOKEN_SCOPE_IDS = Object.keys(API_TOKEN_SCOPES) as [
  ApiTokenScope,
  ...ApiTokenScope[],
];

interface RouteRule {
  method: string;
  path: RegExp;
  scope: ApiTokenScope;
  /** Route acts on `?productId`: the token's product restriction applies. */
  productScoped: boolean;
}

// The only routes a scoped token can reach (a full-access token skips these
// rules). Add a scope = add rules here + a label above.
const ROUTE_RULES: readonly RouteRule[] = [
  { method: 'GET', path: /^\/api\/comptabilite$/, scope: 'comptabilite:read', productScoped: true },
  {
    method: 'GET',
    path: /^\/api\/comptabilite\/ledger$/,
    scope: 'comptabilite:read',
    productScoped: true,
  },
  {
    method: 'POST',
    path: /^\/api\/comptabilite\/ledger$/,
    scope: 'comptabilite:write',
    productScoped: true,
  },
  // The handler returns a minimal projection (id, name) filtered by the
  // token's product restriction.
  { method: 'GET', path: /^\/api\/products$/, scope: 'products:read', productScoped: false },
];

export function findRouteRule(method: string, path: string): RouteRule | undefined {
  return ROUTE_RULES.find((r) => r.method === method && r.path.test(path));
}

/** Same resolution as the module route handlers (`productId`, alias `activity`). */
export function requestProductId(c: Context): string {
  return c.req.query('productId') || c.req.query('activity') || DEFAULT_PRODUCT_ID;
}

// --- Token store ---

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  productIds: string[] | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface AuthenticatedToken {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  productIds: string[] | null;
}

export type ApiAuthVariables = { apiToken?: AuthenticatedToken };

export const apiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(API_TOKEN_SCOPE_IDS)).min(1),
    // null / omitted = every product.
    productIds: z.array(z.string().min(1)).min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.scopes.includes(FULL_ACCESS_SCOPE)) return;
    if (data.scopes.some((s) => s !== FULL_ACCESS_SCOPE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: "L'accès complet ne se combine pas avec d'autres portées",
      });
    }
    if (data.productIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: "L'accès complet couvre tous les produits",
      });
    }
  });
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

const TOKEN_RE = /^sp_[A-Za-z0-9_-]{43}$/;

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateTokenSecret(): string {
  return `sp_${randomBytes(32).toString('base64url')}`;
}

function parseJsonArray(v: string | null): string[] | null {
  if (v === null) return null;
  try {
    const arr = JSON.parse(v) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function knownScopes(raw: string): ApiTokenScope[] {
  return (parseJsonArray(raw) ?? []).filter((s): s is ApiTokenScope => s in API_TOKEN_SCOPES);
}

export function toApiTokenView(r: ApiTokenRecord): ApiTokenView {
  return {
    id: r.id,
    name: r.name,
    prefix: r.token_prefix,
    scopes: knownScopes(r.scopes),
    productIds: parseJsonArray(r.product_ids),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

/** Create a token. The secret is returned once and never stored. */
export function createApiToken(input: ApiTokenCreateInput): {
  token: ApiTokenView;
  secret: string;
} {
  const data = apiTokenCreateSchema.parse(input);
  const secret = generateTokenSecret();
  const id = randomUUID();
  const scopes = [...new Set(data.scopes)];
  const productIds = data.productIds ? [...new Set(data.productIds)] : null;
  getDb()
    .prepare(
      `INSERT INTO api_tokens (id, name, token_hash, token_prefix, scopes, product_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      hashToken(secret),
      secret.slice(0, 7),
      JSON.stringify(scopes),
      productIds ? JSON.stringify(productIds) : null,
      Date.now(),
    );
  logger.info('API token created', { tokenId: id, name: data.name, scopes, productIds });
  return { token: getApiToken(id)!, secret };
}

export function getApiToken(id: string): ApiTokenView | undefined {
  const r = getDb().prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as
    | ApiTokenRecord
    | undefined;
  return r ? toApiTokenView(r) : undefined;
}

export function listApiTokens(): ApiTokenView[] {
  return (
    getDb()
      .prepare('SELECT * FROM api_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC')
      .all() as ApiTokenRecord[]
  ).map(toApiTokenView);
}

/** Revoke (soft): the row stays for the audit trail. False if unknown/already revoked. */
export function revokeApiToken(id: string): boolean {
  const res = getDb()
    .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(Date.now(), id);
  if (res.changes > 0) logger.info('API token revoked', { tokenId: id });
  return res.changes > 0;
}

type VerifyResult =
  | { ok: true; token: AuthenticatedToken }
  | { ok: false; reason: 'malformed' | 'unknown' | 'revoked'; tokenId?: string };

export function verifyApiToken(secret: string): VerifyResult {
  if (!TOKEN_RE.test(secret)) return { ok: false, reason: 'malformed' };
  const r = getDb()
    .prepare('SELECT * FROM api_tokens WHERE token_hash = ?')
    .get(hashToken(secret)) as ApiTokenRecord | undefined;
  if (!r) return { ok: false, reason: 'unknown' };
  if (r.revoked_at !== null) return { ok: false, reason: 'revoked', tokenId: r.id };
  const view = toApiTokenView(r);
  return {
    ok: true,
    token: { id: r.id, name: r.name, scopes: view.scopes, productIds: view.productIds },
  };
}

export function isFullAccess(token: Pick<AuthenticatedToken, 'scopes'>): boolean {
  return token.scopes.includes(FULL_ACCESS_SCOPE);
}

export function tokenAllowsProduct(token: AuthenticatedToken, productId: string): boolean {
  if (isFullAccess(token)) return true;
  return token.productIds === null || token.productIds.includes(productId);
}

// --- Audit ---

const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
let lastAuditPrune = 0;

export function recordAudit(entry: Omit<ApiTokenAuditRecord, 'id' | 'at'> & { at?: number }) {
  const at = entry.at ?? Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO api_token_audit (at, token_id, method, path, product_id, status, outcome, client)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    at,
    entry.token_id,
    entry.method,
    entry.path.slice(0, 200),
    entry.product_id,
    entry.status,
    entry.outcome,
    entry.client,
  );
  if (at - lastAuditPrune > 60 * 60 * 1000) {
    lastAuditPrune = at;
    db.prepare('DELETE FROM api_token_audit WHERE at < ?').run(at - AUDIT_RETENTION_MS);
  }
}

export function listAudit(opts: { tokenId?: string; limit?: number } = {}): ApiTokenAuditRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  if (opts.tokenId) {
    return getDb()
      .prepare('SELECT * FROM api_token_audit WHERE token_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(opts.tokenId, limit) as ApiTokenAuditRecord[];
  }
  return getDb()
    .prepare('SELECT * FROM api_token_audit ORDER BY at DESC, id DESC LIMIT ?')
    .all(limit) as ApiTokenAuditRecord[];
}

// --- Failure rate limiting (in memory, per client) ---

export const AUTH_FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;

interface FailureState {
  count: number;
  windowStart: number;
  lockedUntil: number;
}
const failures = new Map<string, FailureState>();

export function resetAuthRateLimit(): void {
  failures.clear();
}

function isLockedOut(client: string, now: number): boolean {
  const s = failures.get(client);
  return !!s && s.lockedUntil > now;
}

function recordFailure(client: string, now: number): void {
  if (failures.size >= MAX_TRACKED_CLIENTS) {
    for (const [k, v] of failures) {
      if (v.lockedUntil <= now && now - v.windowStart > FAILURE_WINDOW_MS) failures.delete(k);
    }
    if (failures.size >= MAX_TRACKED_CLIENTS) failures.clear();
  }
  let s = failures.get(client);
  if (!s || now - s.windowStart > FAILURE_WINDOW_MS) {
    s = { count: 0, windowStart: now, lockedUntil: 0 };
    failures.set(client, s);
  }
  s.count += 1;
  if (s.count >= AUTH_FAILURE_LIMIT) {
    s.lockedUntil = now + LOCKOUT_MS;
    logger.warn('API token auth: client locked out after repeated failures', { client });
  }
}

/**
 * Client key for rate limiting: socket address plus the right-most
 * X-Forwarded-For hop (the one appended by our own reverse proxy). Left-most
 * hops are client-controlled and would let an attacker rotate keys.
 */
function clientKey(c: Context): string {
  let remote = 'unknown';
  try {
    remote = getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // Not running on the Node adapter (tests use app.request()).
  }
  const xff = c.req.header('x-forwarded-for');
  const lastHop = xff ? xff.split(',').at(-1)?.trim() : undefined;
  return lastHop ? `${remote}|${lastHop}` : remote;
}

/** Token secret from `Authorization: Bearer sp_…` or `X-Api-Token: sp_…`. */
export function extractTokenSecret(c: Context): string | undefined {
  const header = c.req.header('x-api-token')?.trim();
  if (header) return header;
  const auth = c.req.header('authorization');
  const m = auth?.match(/^Bearer\s+(sp_\S*)\s*$/i);
  return m ? m[1] : undefined;
}

/**
 * Token authentication + authorization. Runs before Basic auth:
 * - no token header → `next()` untouched (Basic auth / open mode as before);
 * - token header → the request is token-authenticated only: invalid → 401,
 *   locked-out client → 429; a full-access token then reaches every route like
 *   the admin; a scoped token gets 403 outside its scopes or products.
 */
export function apiTokenAuth(): MiddlewareHandler<{ Variables: ApiAuthVariables }> {
  return async (c, next) => {
    const secret = extractTokenSecret(c);
    if (secret === undefined) return next();

    const now = Date.now();
    const client = clientKey(c);
    const method = c.req.method;
    const path = c.req.path;

    if (isLockedOut(client, now)) {
      c.header('Retry-After', String(Math.ceil(LOCKOUT_MS / 1000)));
      return c.json({ error: "Trop d'échecs d'authentification, réessayez plus tard" }, 429);
    }

    const verified = verifyApiToken(secret);
    if (!verified.ok) {
      recordFailure(client, now);
      recordAudit({
        token_id: verified.tokenId ?? null,
        method,
        path,
        product_id: null,
        status: 401,
        outcome: `invalid_${verified.reason}`,
        client,
      });
      return c.json({ error: 'Jeton API invalide' }, 401);
    }

    const token = verified.token;
    getDb().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, token.id);

    if (isFullAccess(token)) {
      c.set('apiToken', token);
      await next();
      recordAudit({
        token_id: token.id,
        method,
        path,
        product_id: c.req.query('productId') || c.req.query('activity') || null,
        status: c.res.status,
        outcome: 'allowed',
        client,
      });
      return;
    }

    const rule = findRouteRule(method, path);
    const productId = rule?.productScoped ? requestProductId(c) : null;
    const deny = (outcome: string, message: string) => {
      recordAudit({
        token_id: token.id,
        method,
        path,
        product_id: productId,
        status: 403,
        outcome,
        client,
      });
      return c.json({ error: message }, 403);
    };
    if (!rule) return deny('denied_route', 'Route non autorisée pour un jeton API');
    if (!token.scopes.includes(rule.scope)) {
      return deny('denied_scope', `Portée manquante : ${rule.scope}`);
    }
    if (productId !== null && !tokenAllowsProduct(token, productId)) {
      return deny('denied_product', `Produit non autorisé pour ce jeton : ${productId}`);
    }

    c.set('apiToken', token);
    await next();
    recordAudit({
      token_id: token.id,
      method,
      path,
      product_id: productId,
      status: c.res.status,
      outcome: 'allowed',
      client,
    });
  };
}
