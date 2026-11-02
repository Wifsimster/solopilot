#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

const DEFAULT_URL = 'http://localhost:3000';

interface ParsedArgs {
  positionals: string[];
  url?: string;
  password?: string;
  product?: string;
  query: [string, string][];
  raw: boolean;
}

interface Shortcut {
  method: string;
  path: string;
}

const SHORTCUTS: Record<string, Shortcut> = {
  cockpit: { method: 'GET', path: '/api/cockpit' },
  status: { method: 'GET', path: '/api/status' },
  health: { method: 'GET', path: '/healthz' },
  version: { method: 'GET', path: '/api/version' },
  setup: { method: 'GET', path: '/api/setup' },
  products: { method: 'GET', path: '/api/products' },
  runs: { method: 'GET', path: '/api/runs' },
  summaries: { method: 'GET', path: '/api/summaries' },
  invoices: { method: 'GET', path: '/api/facturation/invoices' },
  comptabilite: { method: 'GET', path: '/api/comptabilite' },
  deals: { method: 'GET', path: '/api/crm/deals' },
  contacts: { method: 'GET', path: '/api/crm/contacts' },
  agenda: { method: 'GET', path: '/api/agenda' },
  workflows: { method: 'GET', path: '/api/workflows' },
  trigger: { method: 'POST', path: '/api/trigger' },
  collect: { method: 'POST', path: '/api/trigger-collect' },
};

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const ENDPOINT_CATALOG: { group: string; lines: string[] }[] = [
  {
    group: 'System',
    lines: [
      'GET    /healthz — health check',
      'GET    /api/version — app version/build date',
      'GET    /api/setup — required credentials + status',
      'GET    /api/cockpit — daily briefing (?productId)',
    ],
  },
  {
    group: 'Facturation',
    lines: [
      'GET    /api/facturation/invoices — list invoices (?productId,?status=draft|sent|paid|void)',
      'POST   /api/facturation/invoices — create invoice (?productId)',
      'POST   /api/facturation/invoices/:id/paid — mark invoice paid',
      'GET    /api/facturation/relances — overdue reminder drafts (?productId)',
      'GET    /api/facturation/stripe — Stripe connection status (?productId)',
      'POST   /api/facturation/invoices/:id/checkout — create Stripe checkout session (?productId)',
      'POST   /api/facturation/sync — manual Stripe sync (?productId)',
    ],
  },
  {
    group: 'Comptabilite',
    lines: [
      'GET    /api/comptabilite — turnover + URSSAF estimate (?productId)',
      'POST   /api/comptabilite/config — set activityType/declarationPeriod (?productId)',
      'GET    /api/comptabilite/ledger — list ledger (?productId,?since=YYYY-MM-DD)',
      'POST   /api/comptabilite/ledger — add ledger entry (?productId; external_ref → 409 if already recorded)',
      'GET    /api/tokens — list API tokens (admin or full-access token)',
      'POST   /api/tokens — create API token, secret shown once (admin or full-access token)',
      'DELETE /api/tokens/:id — revoke API token (admin or full-access token)',
      'GET    /api/tokens/audit — token audit log (?tokenId,?limit; admin or full-access token)',
    ],
  },
  {
    group: 'CRM',
    lines: [
      'GET    /api/crm/contacts — list contacts (?productId)',
      'POST   /api/crm/contacts — create contact (?productId)',
      'GET    /api/crm/contacts/:id/interactions — list interactions for contact',
      'POST   /api/crm/interactions — log interaction (?productId)',
      'GET    /api/crm/deals — list deals (?productId)',
      'POST   /api/crm/deals — create deal (?productId)',
      'POST   /api/crm/deals/:id/stage — update deal stage ({stage})',
      'GET    /api/crm/relances — follow-up drafts for stale deals (?productId)',
    ],
  },
  {
    group: 'Agenda',
    lines: [
      'GET    /api/agenda — agenda summary+today+upcoming (?productId)',
      'POST   /api/agenda/events — create event (?productId)',
    ],
  },
  {
    group: 'Workflows',
    lines: [
      'GET    /api/workflows — list workflows (?productId)',
      'GET    /api/workflows/:id — workflow detail + runs',
      'GET    /api/workflow-runs — list workflow runs (?limit,?offset,?workflow,?productId)',
      'GET    /api/workflow-runs/:id — workflow run detail',
    ],
  },
  {
    group: 'Products',
    lines: [
      'GET    /api/products — list products (?includeArchived)',
      'POST   /api/products — create product',
      'GET    /api/products/:id — product detail',
      'PUT    /api/products/:id — update product',
      'DELETE /api/products/:id — archive/hard-delete product (?hard)',
      'GET    /api/products/:id/settings — product settings',
      'PUT    /api/products/:id/settings — set product setting ({key,value})',
      'POST   /api/products/:id/content/generate-posts — generate content drafts',
    ],
  },
  {
    group: 'Acquisition',
    lines: [
      'GET    /api/reddit/search-subreddits — subreddit search (?q,?limit,?includeNsfw)',
      'GET    /api/intent-signals — list intent signals (?productId,?status,?limit)',
      'PATCH  /api/intent-signals/:id — update signal',
      'POST   /api/intent-signals/:id/analyze — analyze signal',
      'GET    /api/intent-signals/:id/replies — list reply variants',
      'POST   /api/intent-signals/:id/replies/generate — generate replies',
      'PATCH  /api/intent-signal-replies/:id — mark reply used',
      'POST   /api/content/suggest-* — AI suggestions (audience|ctas|description|value-props|subreddits|hn-keywords)',
      'GET    /api/content-drafts — list drafts (?productId,?status,?kind,?limit)',
      'PATCH  /api/content-drafts/:id — update draft',
      'DELETE /api/content-drafts/:id — delete draft',
      'GET    /api/github-import/repos — list a GitHub user repos (?username,?includeForks,?includeArchived)',
      'POST   /api/github-import/bulk — bulk import products',
    ],
  },
  {
    group: 'Veille / Runs',
    lines: [
      'GET    /api/status — run status (?productId)',
      'GET    /api/runs — run history (?limit,?offset,?type,?productId)',
      'GET    /api/collect-status — collection status (?productId)',
      'GET    /api/runs/:id/tweets — tweets of a run (?limit,?offset)',
      'POST   /api/runs/:id/send-discord — send run summary to Discord',
      'POST   /api/trigger — trigger a publish run (?productId)',
      'POST   /api/trigger-collect — trigger collection (?productId)',
      'POST   /api/detect-gql-ids — detect X GraphQL ids',
    ],
  },
  {
    group: 'Summaries',
    lines: [
      'GET    /api/summaries — list summaries (?limit,?offset,?month,?search,?productId)',
      'GET    /api/monthly-summaries — monthly summaries (?productId)',
      'GET    /api/monthly-summaries/available — months available (?productId)',
      'GET    /api/monthly-summaries/:year/:month — get monthly summary (?productId)',
      'POST   /api/monthly-summaries/generate — generate monthly summary ({year,month,productId?})',
      'DELETE /api/summaries/:id — delete run/summary',
      'POST   /api/summaries/:id/rerun — rerun a run',
    ],
  },
  {
    group: 'Settings',
    lines: [
      'GET    /api/settings — global settings (masked)',
      'POST   /api/settings — update settings ({key:value,...})',
      'POST   /api/credentials — store X cookies ({X_SESSION_AUTH_TOKEN,X_SESSION_CSRF_TOKEN})',
      'GET    /api/cron-schedule — get cron schedules',
      'POST   /api/cron-schedule — set publish cron ({schedule})',
      'POST   /api/collect-cron-schedule — set collect cron ({schedule})',
      'POST   /api/discord-webhook — save Discord webhook ({DISCORD_WEBHOOK_URL})',
      'DELETE /api/discord-webhook — delete Discord webhook',
      'POST   /api/test-discord — test Discord webhook',
    ],
  },
];

const USAGE = `solopilot — CLI client for the Solopilot HTTP API

Usage:
  solopilot <command> [args] [flags]

Generic verbs (full API coverage):
  get <path> [--query k=v...]
  post <path> [jsonBody|-]
  put <path> [jsonBody|-]
  patch <path> [jsonBody|-]
  delete <path>
    Path forms: "cockpit", "api/cockpit", "/api/cockpit", "/healthz".
    jsonBody "-" reads the request body from stdin.

Convenience commands:
  cockpit status health version setup products runs summaries
  invoices comptabilite deals contacts agenda workflows
  trigger collect
  mcp         serve the API as an MCP server over stdio (for AI agents)
  endpoints   print the embedded endpoint catalog (no HTTP call)
  help        print this usage

Flags (may appear anywhere):
  --url <u>        base URL (env SOLOPILOT_URL or SOLOPILOT_API_URL, default ${DEFAULT_URL})
  --password <p>   admin password (env SOLOPILOT_ADMIN_PASSWORD or ADMIN_PASSWORD)
                   (env SOLOPILOT_TOKEN=sp_… uses an API token instead)
  env SOLOPILOT_PROXY_BASIC=user:pass  forward-auth proxy credentials: sent as
                   Authorization: Basic, the API token then travels in X-Api-Token
  --product <id>   product scope, sent as ?productId (env SOLOPILOT_PRODUCT_ID)
  --query k=v, -q  extra query param (repeatable)
  --raw            print the response body as-is (no JSON pretty-print)

Examples:
  solopilot cockpit --product prod_123
  solopilot get /api/runs -q limit=5 -q type=publish
  solopilot post crm/contacts '{"name":"Ada","email":"a@b.io"}'
  echo '{"stage":"won"}' | solopilot post crm/deals/42/stage -
`;

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positionals: [], query: [], raw: false };
  const takesValue = new Set(['--url', '--password', '--product', '--query']);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    let flag = token;
    let inlineValue: string | undefined;

    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      flag = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }

    if (flag === '-q') flag = '--query';

    if (flag === '--raw') {
      result.raw = true;
      continue;
    }

    if (takesValue.has(flag)) {
      const value = inlineValue !== undefined ? inlineValue : argv[++i];
      if (value === undefined) {
        console.error(`Error: flag ${flag} requires a value`);
        process.exit(2);
      }
      if (flag === '--url') result.url = value;
      else if (flag === '--password') result.password = value;
      else if (flag === '--product') result.product = value;
      else if (flag === '--query') {
        const eq = value.indexOf('=');
        if (eq === -1) {
          console.error(`Error: --query expects k=v, got "${value}"`);
          process.exit(2);
        }
        result.query.push([value.slice(0, eq), value.slice(eq + 1)]);
      }
      continue;
    }

    result.positionals.push(token);
  }

  return result;
}

function normalizePath(path: string): string {
  if (path.startsWith('/')) return path;
  if (path.startsWith('api/')) return `/${path}`;
  return `/api/${path}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function formatBody(body: string, contentType: string | null, raw: boolean): string {
  if (raw) return body;
  if (contentType && contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function buildUrl(base: string, path: string, args: ParsedArgs): string {
  const target = new URL(base);
  target.pathname = normalizePath(path);

  for (const [key, value] of args.query) {
    target.searchParams.append(key, value);
  }

  const product = args.product ?? process.env.SOLOPILOT_PRODUCT_ID;
  if (product && !target.searchParams.has('productId')) {
    target.searchParams.set('productId', product);
  }

  return target.toString();
}

function resolveBase(args: ParsedArgs): string {
  return args.url ?? process.env.SOLOPILOT_URL ?? process.env.SOLOPILOT_API_URL ?? DEFAULT_URL;
}

function authHeaders(args: ParsedArgs): Record<string, string> {
  const headers: Record<string, string> = {};
  const password =
    args.password ?? process.env.SOLOPILOT_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  const token = process.env.SOLOPILOT_TOKEN;
  const proxyBasic = process.env.SOLOPILOT_PROXY_BASIC;
  if (token && proxyBasic) {
    headers.Authorization = `Basic ${Buffer.from(proxyBasic).toString('base64')}`;
    headers['X-Api-Token'] = token;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (password) {
    headers.Authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  }
  return headers;
}

async function request(
  method: string,
  path: string,
  body: string | undefined,
  args: ParsedArgs,
): Promise<never> {
  const url = buildUrl(resolveBase(args), path, args);

  const headers = authHeaders(args);
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return process.exit(2);
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type');
  const formatted = formatBody(text, contentType, args.raw);

  if (response.ok) {
    if (formatted.length > 0) console.log(formatted);
    return process.exit(0);
  }

  console.error(`HTTP ${response.status} ${response.statusText}`);
  if (formatted.length > 0) console.error(formatted);
  return process.exit(1);
}

async function resolveBody(raw: string | undefined): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  const text = raw === '-' ? await readStdin() : raw;
  if (text.trim().length === 0) return undefined;
  try {
    JSON.parse(text);
  } catch {
    console.error('Error: request body is not valid JSON');
    process.exit(2);
  }
  return text;
}

function printEndpoints(): void {
  for (const section of ENDPOINT_CATALOG) {
    console.log(`# ${section.group}`);
    for (const line of section.lines) console.log(`  ${line}`);
    console.log('');
  }
}

const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MCP_MAX_OUTPUT = 200_000;
const MCP_TIMEOUT_MS = 60_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Input = Record<string, unknown>;

interface PropSchema {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | { type: string };
}

interface InputSchema {
  type: 'object';
  properties: Record<string, PropSchema>;
  required?: string[];
  additionalProperties: false;
}

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

interface ApiResult {
  status: number;
  ok: boolean;
  text: string;
  contentType: string | null;
}

interface ToolOutcome {
  text: string;
  isError: boolean;
}

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  annotations: ToolAnnotations;
  run: (input: Input, api: ApiCaller) => Promise<ToolOutcome>;
}

type ApiCaller = (
  method: string,
  path: string,
  query: [string, string][],
  body?: unknown,
  productId?: string,
) => Promise<ApiResult>;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const PRODUCT_PROP: PropSchema = {
  type: 'string',
  description:
    'Product/activity id (optional; defaults to SOLOPILOT_PRODUCT_ID or the server default)',
};

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const WRITE_IDEMPOTENT: ToolAnnotations = { ...WRITE, idempotentHint: true };

const BLOCKED_ALL = new Set([
  '/api/credentials',
  '/api/discord-webhook',
  '/api/veille-discord-webhook',
]);
const SECRET_KEY =
  /^(secret|token_?hash|password|api_?key|authorization|discord_webhook_url|veille_discord_webhook_url|x_session_.*)$/i;

function schema(properties: Record<string, PropSchema>, required: string[] = []): InputSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

function withProduct(properties: Record<string, PropSchema>, required: string[] = []): InputSchema {
  return schema({ ...properties, productId: PRODUCT_PROP }, required);
}

function validateInput(def: InputSchema, input: Input): string | null {
  for (const key of def.required ?? []) {
    if (input[key] === undefined || input[key] === null)
      return `Missing required argument "${key}"`;
  }
  for (const [key, value] of Object.entries(input)) {
    const prop = def.properties[key];
    if (!prop) return `Unknown argument "${key}"`;
    if (value === undefined || value === null) continue;
    if (prop.type === 'integer') {
      if (!Number.isInteger(value)) return `Argument "${key}" must be an integer`;
    } else if (prop.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value))
        return `Argument "${key}" must be an object`;
    } else if (typeof value !== prop.type) {
      return `Argument "${key}" must be a ${prop.type}`;
    }
    if (typeof value === 'number') {
      if (prop.minimum !== undefined && value < prop.minimum)
        return `Argument "${key}" must be >= ${prop.minimum}`;
      if (prop.maximum !== undefined && value > prop.maximum)
        return `Argument "${key}" must be <= ${prop.maximum}`;
    }
    if (prop.enum && !prop.enum.includes(String(value))) {
      return `Argument "${key}" must be one of: ${prop.enum.join(', ')}`;
    }
  }
  return null;
}

function checkApiPath(method: string, path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512)
    return 'path must be a non-empty string';
  if (!path.startsWith('/api/'))
    return 'path must start with /api/ (only the Solopilot API is reachable)';
  if (/[?#\\\s]/.test(path) || path.split('').some((ch) => ch.charCodeAt(0) < 32))
    return 'path must not contain query strings, fragments, backslashes or whitespace (use the query argument)';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return 'path is not a valid URI path';
  }
  if (!decoded.startsWith('/api/') || /[?#\\]/.test(decoded)) return 'path must stay under /api/';
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'path must not contain dot segments';
  }
  const normalized = decoded.replace(/\/+$/, '').toLowerCase();
  if (BLOCKED_ALL.has(normalized))
    return 'this endpoint handles credentials and is not exposed over MCP';
  if ((normalized === '/api/tokens' || normalized.startsWith('/api/tokens/')) && method !== 'GET') {
    return 'API token management is not exposed over MCP (read-only access to GET /api/tokens*)';
  }
  return null;
}

function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(inner);
    }
    return out;
  }
  return value;
}

function truncate(text: string): string {
  if (text.length <= MCP_MAX_OUTPUT) return text;
  return `${text.slice(0, MCP_MAX_OUTPUT)}\n[truncated: ${text.length - MCP_MAX_OUTPUT} more characters]`;
}

function describeResult(result: ApiResult): ToolOutcome {
  if (result.status === 401) {
    return {
      isError: true,
      text: 'HTTP 401: not authenticated. Check SOLOPILOT_TOKEN (sp_… API token, possibly revoked or malformed), SOLOPILOT_PROXY_BASIC, or the admin password configured for this MCP server.',
    };
  }
  if (result.status === 403) {
    return {
      isError: true,
      text: 'HTTP 403: forbidden. The API token lacks the scope (or product access) required for this route; use a token with the needed scope or full access (*).',
    };
  }
  let body = result.text;
  if (result.contentType?.includes('application/json')) {
    try {
      body = JSON.stringify(redact(JSON.parse(result.text) as Json), null, 2);
    } catch {
      body = result.text;
    }
  }
  if (!result.ok) return { isError: true, text: truncate(`HTTP ${result.status}\n${body}`) };
  return {
    isError: false,
    text: truncate(body.length > 0 ? body : `HTTP ${result.status} (empty body)`),
  };
}

function pick(input: Input, keys: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null) pairs.push([key, String(value)]);
  }
  return pairs;
}

function without(input: Input, ...keys: string[]): Input {
  const copy: Input = { ...input };
  for (const key of keys) delete copy[key];
  return copy;
}

function productOf(input: Input): string | undefined {
  return typeof input.productId === 'string' ? input.productId : undefined;
}

function readTool(
  name: string,
  title: string,
  description: string,
  path: string,
  properties: Record<string, PropSchema> = {},
  queryKeys: string[] = [],
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: withProduct(properties),
    annotations: READ_ONLY,
    run: async (input, api) =>
      describeResult(await api('GET', path, pick(input, queryKeys), undefined, productOf(input))),
  };
}

function getByIdTool(
  name: string,
  title: string,
  description: string,
  listPath: string,
  idLabel: string,
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: withProduct({ id: { type: 'string', description: idLabel } }, ['id']),
    annotations: READ_ONLY,
    run: async (input, api) => {
      const result = await api('GET', listPath, [], undefined, productOf(input));
      if (!result.ok) return describeResult(result);
      let parsed: Json;
      try {
        parsed = JSON.parse(result.text) as Json;
      } catch {
        return { isError: true, text: 'Unexpected non-JSON response from the list endpoint' };
      }
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed !== null && typeof parsed === 'object'
          ? (Object.values(parsed).find((value): value is Json[] => Array.isArray(value)) ?? [])
          : [];
      const wanted = String(input.id);
      const match = rows.find(
        (row) =>
          row !== null &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          String(row.id) === wanted,
      );
      if (match === undefined)
        return { isError: true, text: `Not found: no entry with id "${wanted}"` };
      return { isError: false, text: JSON.stringify(redact(match), null, 2) };
    },
  };
}

function createTool(
  name: string,
  title: string,
  description: string,
  path: string,
  properties: Record<string, PropSchema>,
  required: string[],
  forced: Input = {},
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: withProduct(properties, required),
    annotations: WRITE,
    run: async (input, api) =>
      describeResult(
        await api(
          'POST',
          path,
          [],
          { ...without(input, 'productId'), ...forced },
          productOf(input),
        ),
      ),
  };
}

const INVOICE_PROPS: Record<string, PropSchema> = {
  client_name: { type: 'string', description: 'Client name' },
  client_email: { type: 'string', description: 'Client email' },
  amount_cents: {
    type: 'integer',
    minimum: 1,
    description: 'Amount in cents (e.g. 120000 = 1200,00)',
  },
  currency: { type: 'string', description: '3-letter currency code, default eur' },
  issued_on: { type: 'string', description: 'Issue date YYYY-MM-DD' },
  due_on: { type: 'string', description: 'Due date YYYY-MM-DD' },
};

const DEAL_STAGES = ['nouveau', 'qualifie', 'proposition', 'gagne', 'perdu'];

const MCP_TOOLS: McpTool[] = [
  readTool(
    'solopilot_cockpit',
    'Cockpit brief',
    "Daily briefing of the activity (Cockpit): what needs attention today across veille, invoices, CRM and agenda. / Brief quotidien de l'activite.",
    '/api/cockpit',
  ),
  readTool(
    'solopilot_veille_status',
    'Veille status',
    'Veille run status (collection and publication state). / Statut des runs de veille.',
    '/api/status',
  ),
  readTool(
    'solopilot_veille_items',
    'Veille items',
    'List triaged veille items (X/Reddit/HN) with optional filters. / Liste les elements de veille tries.',
    '/api/veille/items',
    {
      source: { type: 'string', description: 'Source filter (x, reddit, hn)' },
      category: { type: 'string', description: 'Triage category' },
      minUrgency: { type: 'integer', description: 'Minimum urgency' },
      triaged: { type: 'string', description: 'true or false' },
      status: { type: 'string', description: 'Item status' },
      origin: { type: 'string', description: 'Item origin' },
      sort: { type: 'string', description: 'Sort order' },
      limit: { type: 'integer', minimum: 1, description: 'Max items' },
    },
    ['source', 'category', 'minUrgency', 'triaged', 'status', 'origin', 'sort', 'limit'],
  ),
  readTool(
    'solopilot_veille_runs',
    'Veille runs',
    'Run history of the veille pipeline. / Historique des runs de veille.',
    '/api/runs',
    {
      limit: { type: 'integer', minimum: 1, description: 'Page size (default 20)' },
      offset: { type: 'integer', minimum: 0, description: 'Offset' },
      type: { type: 'string', description: 'Run type (collect or publish)' },
    },
    ['limit', 'offset', 'type'],
  ),
  readTool(
    'solopilot_veille_summaries',
    'Veille summaries',
    'List AI run summaries (digests). / Liste les resumes IA (digests).',
    '/api/summaries',
    {
      limit: { type: 'integer', minimum: 1, description: 'Page size' },
      offset: { type: 'integer', minimum: 0, description: 'Offset' },
      month: { type: 'string', description: 'Month YYYY-MM' },
      search: { type: 'string', description: 'Full-text search' },
    },
    ['limit', 'offset', 'month', 'search'],
  ),
  {
    name: 'solopilot_veille_trigger',
    title: 'Trigger a veille run',
    description:
      'Start a veille run now: "collect" gathers items, "publish" builds and sends the AI digest (may post to Discord and spend AI budget). / Declenche un run de veille.',
    inputSchema: withProduct(
      { kind: { type: 'string', enum: ['collect', 'publish'], description: 'collect or publish' } },
      ['kind'],
    ),
    annotations: { ...WRITE, openWorldHint: true },
    run: async (input, api) =>
      describeResult(
        await api(
          'POST',
          input.kind === 'collect' ? '/api/trigger-collect' : '/api/trigger',
          [],
          undefined,
          productOf(input),
        ),
      ),
  },
  readTool(
    'solopilot_invoices_list',
    'List invoices',
    'List invoices, optionally by status. / Liste les factures.',
    '/api/facturation/invoices',
    {
      status: {
        type: 'string',
        enum: ['draft', 'sent', 'paid', 'void'],
        description: 'Invoice status',
      },
    },
    ['status'],
  ),
  getByIdTool(
    'solopilot_invoices_get',
    'Get invoice',
    "Get one invoice by id. / Detail d'une facture.",
    '/api/facturation/invoices',
    'Invoice id',
  ),
  createTool(
    'solopilot_invoices_create_draft',
    'Create draft invoice',
    'Create an invoice in draft status (never sent). Amounts in cents. / Cree une facture brouillon (montants en centimes).',
    '/api/facturation/invoices',
    INVOICE_PROPS,
    ['client_name', 'amount_cents', 'due_on'],
    { status: 'draft' },
  ),
  readTool(
    'solopilot_comptabilite_summary',
    'Comptabilite / URSSAF summary',
    'Turnover status and URSSAF contribution estimate with the accounting config. / CA et estimation URSSAF.',
    '/api/comptabilite',
  ),
  readTool(
    'solopilot_crm_deals_list',
    'List CRM deals',
    'List CRM deals (pipeline). / Liste les opportunites.',
    '/api/crm/deals',
  ),
  getByIdTool(
    'solopilot_crm_deals_get',
    'Get CRM deal',
    "Get one CRM deal by id. / Detail d'une opportunite.",
    '/api/crm/deals',
    'Deal id',
  ),
  createTool(
    'solopilot_crm_deals_create',
    'Create CRM deal',
    'Create a CRM deal for an existing contact. / Cree une opportunite.',
    '/api/crm/deals',
    {
      contact_id: { type: 'string', description: 'Contact id' },
      title: { type: 'string', description: 'Deal title' },
      stage: { type: 'string', enum: DEAL_STAGES, description: 'Pipeline stage, default nouveau' },
      amount_cents: { type: 'integer', minimum: 0, description: 'Amount in cents' },
    },
    ['contact_id', 'title'],
  ),
  {
    name: 'solopilot_crm_deals_update_stage',
    title: 'Update CRM deal stage',
    description: "Move a CRM deal to another pipeline stage. / Change l'etape d'une opportunite.",
    inputSchema: schema(
      {
        id: { type: 'string', description: 'Deal id' },
        stage: { type: 'string', enum: DEAL_STAGES, description: 'New stage' },
      },
      ['id', 'stage'],
    ),
    annotations: WRITE_IDEMPOTENT,
    run: async (input, api) =>
      describeResult(
        await api('POST', `/api/crm/deals/${encodeURIComponent(String(input.id))}/stage`, [], {
          stage: input.stage,
        }),
      ),
  },
  readTool(
    'solopilot_crm_contacts_list',
    'List CRM contacts',
    'List CRM contacts. / Liste les contacts.',
    '/api/crm/contacts',
  ),
  getByIdTool(
    'solopilot_crm_contacts_get',
    'Get CRM contact',
    "Get one CRM contact by id. / Detail d'un contact.",
    '/api/crm/contacts',
    'Contact id',
  ),
  createTool(
    'solopilot_crm_contacts_create',
    'Create CRM contact',
    'Create a CRM contact. / Cree un contact.',
    '/api/crm/contacts',
    {
      name: { type: 'string', description: 'Contact name' },
      email: { type: 'string', description: 'Email' },
      company: { type: 'string', description: 'Company' },
      phone: { type: 'string', description: 'Phone' },
      status: {
        type: 'string',
        enum: ['lead', 'active', 'inactive'],
        description: 'Status, default lead',
      },
      source: { type: 'string', description: 'Source, default manual' },
      notes: { type: 'string', description: 'Notes' },
    },
    ['name'],
  ),
  readTool(
    'solopilot_agenda_list',
    'List agenda',
    "Agenda summary with today and upcoming events. / Agenda: aujourd'hui et a venir.",
    '/api/agenda',
  ),
  createTool(
    'solopilot_agenda_create',
    'Create agenda event',
    'Create an agenda event. Datetimes are ISO 8601 with offset. / Cree un evenement.',
    '/api/agenda/events',
    {
      title: { type: 'string', description: 'Event title' },
      starts_at: { type: 'string', description: 'ISO 8601 start, e.g. 2026-06-10T14:00:00+02:00' },
      ends_at: { type: 'string', description: 'ISO 8601 end' },
      location: { type: 'string', description: 'Location' },
    },
    ['title', 'starts_at'],
  ),
  readTool(
    'solopilot_workflows_list',
    'List workflows',
    'List workflows with their last run. The API has no endpoint to start an arbitrary workflow; use solopilot_veille_trigger for veille. / Liste les workflows.',
    '/api/workflows',
  ),
  {
    name: 'solopilot_workflows_get',
    title: 'Get workflow',
    description: "Workflow detail with its 10 latest runs. / Detail d'un workflow.",
    inputSchema: withProduct({ id: { type: 'string', description: 'Workflow id' } }, ['id']),
    annotations: READ_ONLY,
    run: async (input, api) =>
      describeResult(
        await api(
          'GET',
          `/api/workflows/${encodeURIComponent(String(input.id))}`,
          [],
          undefined,
          productOf(input),
        ),
      ),
  },
  readTool(
    'solopilot_workflow_runs',
    'Workflow runs',
    'List workflow runs, optionally for one workflow. / Liste les executions de workflow.',
    '/api/workflow-runs',
    {
      workflow: { type: 'string', description: 'Workflow id filter' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size (default 20)' },
      offset: { type: 'integer', minimum: 0, description: 'Offset' },
    },
    ['workflow', 'limit', 'offset'],
  ),
  {
    name: 'solopilot_request',
    title: 'Raw API request',
    description:
      "Generic call to any Solopilot endpoint under /api/ (see docs/api.md). Prefer the typed tools; use this for full coverage. Credential and token-management endpoints are refused. / Appel generique de l'API.",
    inputSchema: schema(
      {
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'HTTP method',
        },
        path: { type: 'string', description: 'Absolute path starting with /api/, no query string' },
        query: {
          type: 'object',
          additionalProperties: true,
          description: 'Query parameters (string, number or boolean values)',
        },
        body: {
          type: 'object',
          additionalProperties: true,
          description: 'JSON body for POST/PUT/PATCH',
        },
        productId: PRODUCT_PROP,
      },
      ['method', 'path'],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    run: async (input, api) => {
      const method = String(input.method);
      const refusal = checkApiPath(method, input.path);
      if (refusal) return { isError: true, text: `Refused: ${refusal}` };
      const query: [string, string][] = [];
      if (input.query && typeof input.query === 'object') {
        for (const [key, value] of Object.entries(input.query)) {
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            query.push([key, String(value)]);
          } else {
            return {
              isError: true,
              text: `Query parameter "${key}" must be a string, number or boolean`,
            };
          }
        }
      }
      const body = method === 'GET' || method === 'DELETE' ? undefined : input.body;
      return describeResult(await api(method, String(input.path), query, body, productOf(input)));
    },
  },
];

function makeApiCaller(args: ParsedArgs): ApiCaller {
  return async (method, path, query, body, productId) => {
    const target = new URL(resolveBase(args));
    target.pathname = path;
    for (const [key, value] of query) target.searchParams.append(key, value);
    const product = productId ?? args.product ?? process.env.SOLOPILOT_PRODUCT_ID;
    if (product && !target.searchParams.has('productId'))
      target.searchParams.set('productId', product);
    const headers = authHeaders(args);
    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(target, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    });
    return {
      status: response.status,
      ok: response.ok,
      text: await response.text(),
      contentType: response.headers.get('content-type'),
    };
  };
}

function serverVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: string;
      version?: unknown;
    };
    if (pkg.name === 'solopilot' && typeof pkg.version === 'string') return pkg.version;
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

function toolDescriptor(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  };
}

async function callTool(
  params: Record<string, unknown> | undefined,
  api: ApiCaller,
): Promise<ToolOutcome> {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === params?.name);
  if (!tool) return { isError: true, text: `Unknown tool: ${String(params?.name)}` };
  const input = params?.arguments ?? {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { isError: true, text: 'Tool arguments must be an object' };
  }
  const problem = validateInput(tool.inputSchema, input as Input);
  if (problem) return { isError: true, text: `Invalid arguments: ${problem}` };
  try {
    return await tool.run(input as Input, api);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { isError: true, text: `Request to the Solopilot API failed: ${reason}` };
  }
}

async function handleMcpMessage(
  message: JsonRpcMessage,
  api: ApiCaller,
): Promise<Json | undefined> {
  const hasId = message.id !== undefined && message.id !== null;
  const reply = (result: Json): Json => ({ jsonrpc: '2.0', id: message.id as Json, result });
  const fail = (code: number, text: string): Json => ({
    jsonrpc: '2.0',
    id: (message.id ?? null) as Json,
    error: { code, message: text },
  });

  if (typeof message.method !== 'string') {
    return hasId ? fail(-32600, 'Invalid request') : undefined;
  }
  if (!hasId) return undefined;

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      const protocolVersion =
        typeof requested === 'string' && MCP_PROTOCOLS.includes(requested)
          ? requested
          : MCP_PROTOCOLS[0];
      return reply({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'solopilot', title: 'Solopilot', version: serverVersion() },
        instructions:
          'Drive the Solopilot back-office (cockpit, veille, invoices, comptabilite, CRM, agenda, workflows). Prefer typed tools; solopilot_request covers every other /api/ endpoint.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: MCP_TOOLS.map(toolDescriptor) as unknown as Json });
    case 'tools/call': {
      const outcome = await callTool(message.params, api);
      return reply({ content: [{ type: 'text', text: outcome.text }], isError: outcome.isError });
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

async function runMcpServer(args: ParsedArgs): Promise<void> {
  const api = makeApiCaller(args);
  const pending = new Set<Promise<void>>();

  const send = (payload: Json): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const handleLine = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
      return;
    }
    try {
      const response = await handleMcpMessage(message as JsonRpcMessage, api);
      if (response !== undefined) send(response);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      send({
        jsonrpc: '2.0',
        id: ((message as JsonRpcMessage).id ?? null) as Json,
        error: { code: -32603, message: 'Internal error' },
      });
    }
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (line.trim().length === 0) return;
    const job = handleLine(line).finally(() => pending.delete(job));
    pending.add(job);
  });

  await new Promise<void>((resolve) => lines.on('close', resolve));
  await Promise.all(pending);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args.positionals;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'mcp') {
    await runMcpServer(args);
    return;
  }

  if (command === 'endpoints') {
    printEndpoints();
    process.exit(0);
  }

  const shortcut = SHORTCUTS[command];
  if (shortcut) {
    await request(shortcut.method, shortcut.path, undefined, args);
    return;
  }

  if (VERBS.has(command)) {
    const path = rest[0];
    if (!path) {
      console.error(`Error: "${command}" requires a <path> argument`);
      process.exit(2);
    }
    const method = command.toUpperCase();
    const body = method === 'GET' || method === 'DELETE' ? undefined : await resolveBody(rest[1]);
    await request(method, path, body, args);
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  console.error(USAGE);
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
