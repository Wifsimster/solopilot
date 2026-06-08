#!/usr/bin/env node
/**
 * Solopilot CLI — drive the Solopilot HTTP API from the command line.
 *
 * Designed for AI agents and scripting: generic HTTP verbs give full API
 * coverage, plus convenience shortcuts for common endpoints. Uses only the
 * global fetch and node builtins (no extra dependencies, no project logger).
 *
 *   solopilot <command> [args] [flags]
 *   solopilot cockpit
 *   solopilot get /api/runs --query limit=5
 *   solopilot post crm/contacts '{"name":"Ada"}'
 */
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

/** A convenience command maps a single token to a fixed method + path. */
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

/** Embedded endpoint catalog, grouped by module, for the `endpoints` command. */
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
      'GET    /api/comptabilite/ledger — list ledger (?productId)',
      'POST   /api/comptabilite/ledger — add ledger entry (?productId)',
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
  endpoints   print the embedded endpoint catalog (no HTTP call)
  help        print this usage

Flags (may appear anywhere):
  --url <u>        base URL (env SOLOPILOT_API_URL, default ${DEFAULT_URL})
  --password <p>   admin password (env SOLOPILOT_ADMIN_PASSWORD or ADMIN_PASSWORD)
  --product <id>   product scope, sent as ?productId (env SOLOPILOT_PRODUCT_ID)
  --query k=v, -q  extra query param (repeatable)
  --raw            print the response body as-is (no JSON pretty-print)

Examples:
  solopilot cockpit --product prod_123
  solopilot get /api/runs -q limit=5 -q type=publish
  solopilot post crm/contacts '{"name":"Ada","email":"a@b.io"}'
  echo '{"stage":"won"}' | solopilot post crm/deals/42/stage -
`;

/** Manual argv parser: pulls known flags out, leaves the rest as positionals. */
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positionals: [], query: [], raw: false };
  const takesValue = new Set(['--url', '--password', '--product', '--query']);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    let flag = token;
    let inlineValue: string | undefined;

    // Support --flag=value form.
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      flag = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }

    // Normalize the -q alias to --query.
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

/** Normalize a user path into a full API path. */
function normalizePath(path: string): string {
  if (path.startsWith('/')) return path;
  if (path.startsWith('api/')) return `/${path}`;
  return `/api/${path}`;
}

/** Read the entire stdin stream as a UTF-8 string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Pretty-print or pass through a body depending on content type and --raw. */
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

/** Build the full URL with merged query params and optional product scope. */
function buildUrl(base: string, path: string, args: ParsedArgs): string {
  const target = new URL(base);
  target.pathname = normalizePath(path);

  for (const [key, value] of args.query) {
    target.searchParams.append(key, value);
  }

  // Apply product scope unless the caller already set productId via --query.
  const product = args.product ?? process.env.SOLOPILOT_PRODUCT_ID;
  if (product && !target.searchParams.has('productId')) {
    target.searchParams.set('productId', product);
  }

  return target.toString();
}

/** Perform the HTTP request and handle output + exit codes. */
async function request(
  method: string,
  path: string,
  body: string | undefined,
  args: ParsedArgs,
): Promise<never> {
  const base = args.url ?? process.env.SOLOPILOT_API_URL ?? DEFAULT_URL;
  const url = buildUrl(base, path, args);

  const headers: Record<string, string> = {};
  const password =
    args.password ?? process.env.SOLOPILOT_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  }
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

/** Resolve and validate a JSON body positional (or stdin for "-"). */
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args.positionals;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
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
