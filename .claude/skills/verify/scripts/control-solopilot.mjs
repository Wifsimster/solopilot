#!/usr/bin/env node
// control-solopilot — drive a throwaway local Solopilot back-office the way its owner does.
// Agent-facing: JSON on stdout, one object per invocation, exit 0 on success.
// Run `control-solopilot --help` or `control-solopilot <command> --help`.

import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const RUN_DIR = path.join(REPO, '.verify-run');
const STATE_FILE = path.join(RUN_DIR, 'state.json');
const DB_PATH = path.join(RUN_DIR, 'data', 'verify.db');
const EGRESS_LOG = path.join(RUN_DIR, 'egress-blocked.jsonl');
const EVIDENCE_ROOT = process.env.SOLOPILOT_EVIDENCE_DIR || path.join(REPO, '.verify-evidence');

const PORTS = { app: 3310, cdp: 9335 };
const BASE = `http://localhost:${PORTS.app}`;
const require = createRequire(path.join(REPO, 'package.json'));

// ---------- output ----------
function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
class CliError extends Error {
  constructor(message, fix, extra = {}) {
    super(message);
    this.fix = fix;
    this.extra = extra;
  }
}
function fail(message, fix, extra) {
  throw new CliError(message, fix, extra);
}

// ---------- args ----------
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- state ----------
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function writeState(s) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function requireState() {
  const s = readState();
  if (!s) fail('No running verification instance.', 'Run `control-solopilot launch` first (or `control-solopilot doctor` to see what is up).');
  return s;
}
function evidenceDir(state) {
  // launch records the evidence root, so later calls write to the same place even without the env var.
  const dir = path.join(state?.evidenceRoot || EVIDENCE_ROOT, state?.runId || 'adhoc');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}
// Read-only view of the throwaway DB (second read for every mutation).
function dbAll(sql, ...params) {
  if (!fs.existsSync(DB_PATH)) fail('The throwaway DB does not exist.', 'Run `control-solopilot launch` first.');
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
async function waitFor(fn, { timeoutMs, label }) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return Date.now() - start; } catch (e) { last = e; }
    await sleep(500);
  }
  fail(`Timed out after ${timeoutMs}ms waiting for ${label}.`, `Check the logs in ${path.join(RUN_DIR, 'logs')} and run \`control-solopilot doctor\`.`, { lastError: last?.message });
}
function spawnDetached(name, cmd, args, { cwd, env }) {
  const logDir = path.join(RUN_DIR, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return child.pid;
}
function loadPlaywright() {
  try { return require('playwright-core'); } catch {
    fail('Cannot load playwright-core from the repo.', 'Run `npm ci` at the repo root, then `npx playwright-core install chromium`.');
  }
}
async function connect() {
  const state = requireState();
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTS.cdp}`);
  } catch (e) {
    fail('Browser daemon is not reachable on the CDP port.', 'Run `control-solopilot doctor`; if the browser is down, run `control-solopilot teardown` then `control-solopilot launch`.', { error: e.message });
  }
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { browser, ctx, page, state };
}
function shotPath(state, name) {
  const safe = String(name || 'shot').replace(/[^a-z0-9._-]+/gi, '-');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(evidenceDir(state), `${stamp}_${safe}.png`);
}
function saveJson(state, name, data) {
  const file = shotPath(state, name).replace(/\.png$/, '.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
// A fresh browser gets the "Visite guidée" overlay on first visit. Close it the way the owner
// does ("Fermer la visite"); the app then remembers it in localStorage for the rest of the run.
async function closeTour(page) {
  const btn = page.getByRole('button', { name: 'Fermer la visite' });
  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await btn.click();
    await sleep(300);
    return true;
  }
  return false;
}
async function open(page, route) {
  const r = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await closeTour(page);
  return r;
}
const euros = (cents) => `${(cents / 100).toFixed(2)} EUR`;
function isoDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);
}

// ---------- commands ----------
const COMMANDS = {};

COMMANDS.launch = {
  summary: 'Build, seed a throwaway SQLite DB, start the server (egress-guarded) and the browser daemon.',
  help: `control-solopilot launch [--skip-build] [--dry-run]

Starts one isolated verification instance:
  - npm run build (backend tsc + Vite build into dist/frontend); --skip-build reuses dist/
  - a throwaway SQLite DB at .verify-run/data/verify.db (never data/), seeded with 6 fake
    veille items (4 "new", 1 "handled", 1 "ignored") through the app's own store
  - the production entry dist/scheduler.js on :${PORTS.app}, preloaded with scripts/no-egress.mjs:
    every non-localhost HTTP call is refused and logged to .verify-run/egress-blocked.jsonl.
    No X credentials are set, so the server boots "unconfigured" (a fresh install): no cron
    is scheduled. ADMIN_PASSWORD is a random throwaway, so HTTP Basic auth is on.
  - a headless Chromium daemon (CDP :${PORTS.cdp}) logged in with that Basic auth, recording
    console + HTTP to JSONL; third-party requests are aborted and logged as "blocked".
GITHUB_TOKEN, AI_API_KEY, DISCORD_WEBHOOK_URL, STRIPE_*, AGENDA_ICS_URL and X_* are forced empty.
Refuses to start if a port is taken: one instance at a time.

--dry-run   print the plan and touch nothing.`,
  async run(flags) {
    const plan = {
      ports: PORTS,
      db: DB_PATH,
      steps: [flags['skip-build'] ? 'reuse dist/' : 'npm run build', 'node scripts/seed.mjs (6 fake veille items)', 'node --import no-egress.mjs dist/scheduler.js', 'browser daemon'],
      evidenceRoot: EVIDENCE_ROOT,
    };
    if (flags['dry-run']) return { ok: true, dryRun: true, plan };
    if (readState()) fail('A verification instance is already recorded in .verify-run/state.json.', 'Run `control-solopilot doctor` to inspect it, or `control-solopilot teardown` before launching again.');
    const busy = [];
    for (const [k, p] of Object.entries(PORTS)) if (await portInUse(p)) busy.push(`${k}:${p}`);
    if (busy.length) fail(`Ports already in use: ${busy.join(', ')}.`, 'Another app (or a leaked run) owns them. Do not kill it blindly: check `ss -ltnp`, stop your own leftover with `control-solopilot teardown`, or ask the lead.', { busy });

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const adminPassword = crypto.randomBytes(18).toString('base64url');
    const state = { runId, startedAt: new Date().toISOString(), evidenceRoot: EVIDENCE_ROOT, pids: {}, adminPassword, gitSha: sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']) };
    writeState(state);
    const timings = {};
    let t = Date.now();
    const logDir = path.join(RUN_DIR, 'logs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const env = {
      ...process.env,
      NODE_ENV: 'production',
      WEB_PORT: String(PORTS.app),
      DB_PATH,
      ADMIN_PASSWORD: adminPassword,
      SOLOPILOT_EGRESS_LOG: EGRESS_LOG,
      // Never real third parties during verification. No X credentials: the server boots unconfigured.
      X_USERNAME: '', X_SESSION_AUTH_TOKEN: '', X_SESSION_CSRF_TOKEN: '',
      GITHUB_TOKEN: '', AI_API_KEY: '', AI_BASE_URL: '', DISCORD_WEBHOOK_URL: '', VEILLE_DISCORD_WEBHOOK_URL: '',
      STRIPE_API_KEY: '', STRIPE_PUBLISHABLE_KEY: '', AGENDA_ICS_URL: '', WORKFLOW_SCHEDULER: '', DRY_RUN: 'true',
    };
    const steps = flags['skip-build'] ? [] : [['build', 'npm', ['run', 'build']]];
    steps.push(['seed', process.execPath, [path.join(HERE, 'seed.mjs'), REPO]]);
    for (const [name, cmd, args] of steps) {
      try {
        const o = sh(cmd, args, { cwd: REPO, env, maxBuffer: 64 << 20 });
        fs.writeFileSync(path.join(logDir, `${name}.log`), o);
      } catch (e) {
        fs.writeFileSync(path.join(logDir, `${name}.log`), `${e.stdout}\n${e.stderr}`);
        fail(`${name} failed.`, `Read ${path.join(logDir, name + '.log')}, fix the cause, then \`control-solopilot teardown\` and launch again.`);
      }
    }
    if (!fs.existsSync(path.join(REPO, 'dist', 'frontend', 'index.html'))) fail('dist/frontend/index.html is missing.', 'Run launch without --skip-build.');
    timings.buildSeed = Date.now() - t; t = Date.now();

    state.pids.app = spawnDetached('app', process.execPath, ['--import', path.join(HERE, 'no-egress.mjs'), 'dist/scheduler.js'], { cwd: REPO, env });
    writeState(state);
    const auth = 'Basic ' + Buffer.from(`admin:${adminPassword}`).toString('base64');
    await waitFor(async () => (await fetch(`${BASE}/api/setup`, { headers: { authorization: auth } })).ok, { timeoutMs: 60000, label: 'server /api/setup' });
    timings.app = Date.now() - t; t = Date.now();

    state.pids.browser = spawnDetached('browserd', process.execPath, [fileURLToPath(import.meta.url), '__browserd'], { cwd: REPO, env: process.env });
    writeState(state);
    await waitFor(() => portInUse(PORTS.cdp), { timeoutMs: 60000, label: 'browser daemon CDP port' });
    timings.browser = Date.now() - t;
    state.readyAt = new Date().toISOString();
    writeState(state);
    return { ok: true, runId, base: BASE, pids: state.pids, db: DB_PATH, timingsMs: timings, evidenceDir: evidenceDir(state), next: 'control-solopilot doctor' };
  },
};

COMMANDS.doctor = {
  summary: 'Read-only health check: is this instance ours, up, seeded and drivable?',
  help: `control-solopilot doctor

Read-only. Checks: state file, recorded pids alive, /healthz answers (expected "unconfigured":
no X credentials), Basic auth enforced (401 without credentials), SPA served, browser daemon
CDP port, Playwright Chromium installed, DB is the throwaway one with the 6 fake veille items,
outbound calls refused so far (egressBlocked, informational), git sha. Exit 0 only when every
check passes. Run it first whenever anything looks off.`,
  async run() {
    const state = readState();
    const checks = {};
    checks.stateFile = !!state;
    checks.pids = Object.fromEntries(Object.entries(state?.pids || {}).map(([k, p]) => [k, alive(p)]));
    if (state) {
      try {
        const r = await fetch(`${BASE}/healthz`, { headers: { authorization: 'Basic ' + Buffer.from(`admin:${state.adminPassword}`).toString('base64') } });
        checks.healthz = (await r.json()).status;
      } catch { checks.healthz = false; }
    }
    try {
      const r = await fetch(`${BASE}/api/setup`);
      checks.unauthenticated = { status: r.status, wwwAuthenticate: r.headers.get('www-authenticate') };
      checks.basicAuthEnforced = r.status === 401 && !!checks.unauthenticated.wwwAuthenticate;
    } catch { checks.basicAuthEnforced = false; }
    if (state) {
      try {
        const r = await fetch(`${BASE}/`, { headers: { authorization: 'Basic ' + Buffer.from(`admin:${state.adminPassword}`).toString('base64') } });
        checks.spa = r.ok && (await r.text()).includes('<div id="root"');
      } catch { checks.spa = false; }
    }
    checks.browserCdp = await portInUse(PORTS.cdp);
    try { const { chromium } = loadPlaywright(); checks.playwrightChromium = fs.existsSync(chromium.executablePath()); } catch { checks.playwrightChromium = false; }
    try { checks.fakeVeilleItems = dbAll(`SELECT COUNT(*) AS n FROM tweets WHERE id LIKE 'verify-%'`)[0].n === 6; } catch (e) { checks.fakeVeilleItems = false; checks.db = e.message; }
    checks.egressBlocked = fs.existsSync(EGRESS_LOG) ? fs.readFileSync(EGRESS_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
    checks.gitSha = sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']);
    const ok = !!state && Object.values(checks.pids).every(Boolean) && checks.healthz === 'unconfigured' && checks.basicAuthEnforced && checks.spa && checks.browserCdp && checks.playwrightChromium && checks.fakeVeilleItems;
    const hints = [];
    if (!state) hints.push('No instance recorded: run `control-solopilot launch`.');
    if (state && !Object.values(checks.pids).every(Boolean)) hints.push('A recorded process died: read .verify-run/logs/*.log, then `control-solopilot teardown` and launch again.');
    if (checks.healthz === 'ok') hints.push('/healthz says "ok": X credentials reached the server (env or DB settings). The harness expects "unconfigured"; teardown and relaunch from a clean shell.');
    if (checks.unauthenticated?.status === 500) hints.push('Requests without credentials get 500 instead of a 401 Basic-auth challenge: app.onError swallows the HTTPException from basicAuth (see features/README.md, fixed by the onError PR). Browsers cannot log in on such a build.');
    if (!checks.playwrightChromium) hints.push('Run `npx playwright-core install chromium` at the repo root.');
    if (checks.egressBlocked) hints.push(`The server tried ${checks.egressBlocked} outbound call(s); they were refused. See .verify-run/egress-blocked.jsonl.`);
    if (!ok) process.exitCode = 1;
    return { ok: !!ok, runId: state?.runId, checks, hints };
  },
};

COMMANDS.teardown = {
  summary: 'Stop what launch started (by recorded pid); delete the throwaway DB; keep evidence.',
  help: `control-solopilot teardown [--dry-run]

Kills the process groups recorded in .verify-run/state.json (never by name), then deletes
.verify-run/ (throwaway DB included). Before deleting, copies the logs, console/network JSONL
and the egress log into the evidence dir. Evidence under ${EVIDENCE_ROOT} is never deleted.

--dry-run   list what would be stopped/removed and do nothing.`,
  async run(flags) {
    const state = readState();
    const plan = { kill: state?.pids || {}, remove: [RUN_DIR].filter((p) => fs.existsSync(p)), keep: state ? evidenceDir(state) : EVIDENCE_ROOT };
    if (flags['dry-run']) return { ok: true, dryRun: true, plan };
    let saved = null;
    if (state && fs.existsSync(RUN_DIR)) {
      saved = path.join(evidenceDir(state), 'run-logs');
      fs.mkdirSync(saved, { recursive: true });
      for (const f of ['console.jsonl', 'network.jsonl', 'egress-blocked.jsonl']) if (fs.existsSync(path.join(RUN_DIR, f))) fs.copyFileSync(path.join(RUN_DIR, f), path.join(saved, f));
      if (fs.existsSync(path.join(RUN_DIR, 'logs'))) fs.cpSync(path.join(RUN_DIR, 'logs'), path.join(saved, 'logs'), { recursive: true });
    }
    const killed = {};
    for (const [name, pid] of Object.entries(state?.pids || {})) {
      try { process.kill(-pid, 'SIGTERM'); killed[name] = 'SIGTERM'; } catch { killed[name] = 'not running'; }
    }
    await sleep(1500);
    for (const [name, pid] of Object.entries(state?.pids || {})) {
      if (alive(pid)) { try { process.kill(-pid, 'SIGKILL'); killed[name] = 'SIGKILL'; } catch {} }
    }
    fs.rmSync(RUN_DIR, { recursive: true, force: true });
    const portsStillOpen = [];
    for (const [k, p] of Object.entries(PORTS)) if (await portInUse(p)) portsStillOpen.push(`${k}:${p}`);
    return { ok: portsStillOpen.length === 0, killed, savedLogs: saved, evidenceKept: state ? evidenceDir(state) : EVIDENCE_ROOT, portsStillOpen };
  },
};

COMMANDS.info = {
  summary: 'Print the recorded run (ids, pids, url, DB path, evidence dir).',
  help: 'control-solopilot info\n\nRead-only: prints .verify-run/state.json (minus the throwaway admin password) and the evidence dir.',
  async run() {
    const { adminPassword, ...s } = requireState();
    return { ok: true, ...s, base: BASE, db: DB_PATH, basicAuthUser: 'admin', evidenceDir: evidenceDir(s) };
  },
};

COMMANDS.goto = {
  summary: 'Navigate the shared page to a path (e.g. /crm).',
  help: 'control-solopilot goto <path>\n\nNavigates and waits for network idle. Example: control-solopilot goto /facturation',
  async run(_f, pos) {
    if (!pos[0]) fail('Missing path.', 'Example: control-solopilot goto /crm');
    const { browser, page } = await connect();
    const r = await open(page, pos[0].startsWith('/') ? pos[0] : '/' + pos[0]).catch(() => null);
    const res = { ok: true, url: page.url(), status: r?.status(), title: await page.title() };
    await browser.close();
    return res;
  },
};

COMMANDS.screenshot = {
  summary: 'Save a PNG of the current page into the evidence dir.',
  help: 'control-solopilot screenshot [--name <label>] [--full-page]\n\nWrites <evidence>/<timestamp>_<label>.png and prints its path.',
  async run(flags) {
    const { browser, page, state } = await connect();
    const file = shotPath(state, flags.name);
    await page.screenshot({ path: file, fullPage: !!flags['full-page'] });
    const url = page.url();
    await browser.close();
    return { ok: true, file, url };
  },
};

COMMANDS.snapshot = {
  summary: 'ARIA snapshot of the current page (what a screen reader / agent sees).',
  help: 'control-solopilot snapshot [--name <label>] [--selector <css>]\n\nPrints the ARIA tree (YAML) of body or --selector, and saves it as <evidence>/<ts>_<label>.aria.yml.',
  async run(flags) {
    const { browser, page, state } = await connect();
    const yml = await page.locator(flags.selector || 'body').ariaSnapshot({ timeout: 10000 }).catch(async (e) => {
      await browser.close();
      fail(`No element matches "${flags.selector || 'body'}" on ${page.url()}.`, 'Retry without --selector (pages outside the layout, like /setup, have no <main>).', { error: e.message.split('\n')[0] });
    });
    const file = shotPath(state, flags.name || 'snapshot').replace(/\.png$/, '.aria.yml');
    fs.writeFileSync(file, yml);
    const url = page.url();
    await browser.close();
    return { ok: true, url, file, aria: yml };
  },
};

COMMANDS.click = {
  summary: 'Click by role+name (preferred), label, or text.',
  help: 'control-solopilot click (--role <role> --name <regex> | --text <regex> | --label <regex>) [--dry-run]\n\nExample: control-solopilot click --role button --name "^Nouvelle facture$"',
  async run(flags) {
    const { browser, page } = await connect();
    const loc = flags.role ? page.getByRole(flags.role, { name: new RegExp(flags.name || '.', 'i') })
      : flags.label ? page.getByLabel(new RegExp(flags.label, 'i'))
      : flags.text ? page.getByText(new RegExp(flags.text, 'i')) : null;
    if (!loc) { await browser.close(); fail('No locator given.', 'Pass --role button --name "Ajouter" (preferred), --label or --text.'); }
    const count = await loc.count();
    if (count === 0) { await browser.close(); fail('Locator matched nothing.', 'Run `control-solopilot snapshot` and copy the role/name from the ARIA tree.'); }
    if (flags['dry-run']) { await browser.close(); return { ok: true, dryRun: true, matches: count }; }
    await loc.first().click();
    await sleep(500);
    const url = page.url();
    await browser.close();
    return { ok: true, matches: count, url };
  },
};

COMMANDS.key = {
  summary: 'Press a key on the focused element (Enter, Escape, Tab...).',
  help: 'control-solopilot key <Key>\n\nExample: control-solopilot key Escape',
  async run(_f, pos) {
    if (!pos[0]) fail('Missing key.', 'Example: control-solopilot key Enter');
    const { browser, page } = await connect();
    await page.keyboard.press(pos[0]);
    await browser.close();
    return { ok: true, key: pos[0] };
  },
};

// Pick an option in a Radix Select by its trigger label and the option text.
async function selectOption(scope, page, triggerLabel, optionText) {
  await scope.getByLabel(triggerLabel).click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

const CONTACT_STATUS = { lead: 'Lead', active: 'Actif', inactive: 'Inactif' };

COMMANDS.contact = {
  summary: 'CRM contacts through the UI: contact create | contact list.',
  help: `control-solopilot contact create --name <name> [--company <c>] [--email <e>] [--status lead|active|inactive] [--dry-run]
control-solopilot contact list

create  On /crm, click "Nouveau contact", fill "Nom", "Société (optionnel)", "Email (optionnel)",
        pick "Statut", click "Ajouter". Captures POST /api/crm/contacts, checks the new row in the
        Contacts table on the page and in the contacts table of the throwaway DB.
        Side effect: one contacts row.
list    Read-only: contacts rows from the DB.
--dry-run   create: print the steps without touching the browser.`,
  async run(flags, pos) {
    const sub = pos[0];
    const state = requireState();
    if (sub === 'list') return { ok: true, contacts: dbAll(`SELECT name, company, email, status, source FROM contacts ORDER BY created_at`) };
    if (sub !== 'create') fail(`Unknown contact subcommand "${sub ?? ''}".`, 'Use `contact create --name ...` or `contact list`.');
    if (typeof flags.name !== 'string') fail('Missing --name.', 'Example: control-solopilot contact create --name "Fake Client SARL" --company "Fake Corp" --email client@example.invalid');
    const status = flags.status || 'lead';
    if (!CONTACT_STATUS[status]) fail(`Unknown status "${status}".`, 'Use lead, active or inactive.');
    if (flags['dry-run']) return { ok: true, dryRun: true, steps: ['goto /crm', 'click "Nouveau contact"', `fill Nom=${flags.name}`, 'fill Société / Email if given', `Statut=${CONTACT_STATUS[status]}`, 'click "Ajouter"'] };
    const { browser, page } = await connect();
    try {
      await open(page, '/crm');
      const before = dbAll(`SELECT COUNT(*) AS n FROM contacts`)[0].n;
      await page.getByRole('button', { name: /^Nouveau contact$/ }).click();
      const dialog = page.getByRole('dialog', { name: /Nouveau contact/ });
      await dialog.getByLabel(/^Nom$/).fill(flags.name);
      if (typeof flags.company === 'string') await dialog.getByLabel(/^Société/).fill(flags.company);
      if (typeof flags.email === 'string') await dialog.getByLabel(/^Email/).fill(flags.email);
      await selectOption(dialog, page, /^Statut$/, CONTACT_STATUS[status]);
      await page.screenshot({ path: shotPath(state, 'contact-create-dialog') });
      const respP = page.waitForResponse((r) => r.url().includes('/api/crm/contacts') && r.request().method() === 'POST', { timeout: 15000 });
      await dialog.getByRole('button', { name: /^Ajouter$/ }).click();
      const resp = await respP;
      const body = await resp.json().catch(() => null);
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await page.getByRole('cell', { name: flags.name }).first().waitFor({ timeout: 10000 }).catch(() => {});
      const rowText = await page.getByRole('row').filter({ hasText: flags.name }).first().innerText().catch(() => null);
      const file = shotPath(state, 'contact-created');
      await page.screenshot({ path: file, fullPage: true });
      const rows = dbAll(`SELECT name, company, email, status, source FROM contacts WHERE name = ?`, flags.name);
      const after = dbAll(`SELECT COUNT(*) AS n FROM contacts`)[0].n;
      const ok = resp.status() === 201 && after === before + 1 && rows.length === 1 && rows[0].status === status && !!rowText;
      if (!ok) process.exitCode = 1;
      const result = { ok, response: { status: resp.status(), id: body?.id }, rowOnPage: rowText?.replace(/\s+/g, ' ').trim() ?? null, dbRow: rows[0] ?? null, contactsBefore: before, contactsAfter: after, file };
      saveJson(state, 'contact-created', result);
      return result;
    } finally {
      await browser.close();
    }
  },
};

const INVOICE_STATUS = { draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', void: 'Annulée' };
function ledgerTotals() {
  const r = dbAll(`SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents END), 0) AS paid,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN amount_cents END), 0) AS pending,
      COUNT(*) AS n FROM invoices WHERE product_id = 'default'`)[0];
  return { paidCents: r.paid, pendingCents: r.pending, count: r.n };
}
async function shownTotals(page) {
  const card = async (title) => {
    const t = await page.getByText(title, { exact: true }).first().locator('xpath=ancestor::*[contains(@class,"rounded")][1]').innerText().catch(() => null);
    return t?.match(/-?\d+\.\d{2} [A-Z]{3}/)?.[0] ?? null;
  };
  return { caEncaisse: await card('CA encaissé'), enAttente: await card('En attente') };
}

COMMANDS.invoice = {
  summary: 'Invoices through the UI: invoice create | invoice pay | invoice list (with totals check).',
  help: `control-solopilot invoice create --client <name> --amount <euros> [--due <YYYY-MM-DD> | --due-in <days>] [--issued <YYYY-MM-DD>] [--status draft|sent|paid|void] [--dry-run]
control-solopilot invoice pay --number <F-YYYY-NNN> [--dry-run]
control-solopilot invoice list

create  On /facturation, click "Nouvelle facture", fill "Client", "Montant (€)", pick "Statut"
        (default Envoyée), fill "Échéance" (default: in 30 days; --due-in -10 makes it overdue)
        and optionally "Émise le", click "Créer". Captures POST /api/facturation/invoices
        (number F-YYYY-NNN, amount_cents), finds the row in the table, then checks the KPI cards
        "CA encaissé" and "En attente" against SUM(amount_cents) in the throwaway DB.
        Side effect: one invoices row.
pay     Clicks "Marquer payée" on the row with that number, then re-checks the row status and
        both totals. Side effect: status = paid, paid_on = today.
list    Read-only: invoice rows and the ledger totals from the DB.
Solopilot has no invoice PDF: there is nothing to download or check (see features/facturation.md).
--dry-run   create/pay: print the steps without touching the browser.`,
  async run(flags, pos) {
    const sub = pos[0];
    const state = requireState();
    if (sub === 'list') return { ok: true, invoices: dbAll(`SELECT number, client_name, amount_cents, currency, status, issued_on, due_on, paid_on FROM invoices ORDER BY created_at`), totals: ledgerTotals() };
    if (sub === 'create') {
      if (typeof flags.client !== 'string' || !flags.amount) fail('Missing --client or --amount.', 'Example: control-solopilot invoice create --client "Fake Client SARL" --amount 1250.50');
      const status = flags.status || 'sent';
      if (!INVOICE_STATUS[status]) fail(`Unknown status "${status}".`, 'Use draft, sent, paid or void.');
      const due = typeof flags.due === 'string' ? flags.due : isoDate(Number(flags['due-in'] ?? 30));
      const cents = Math.round(Number.parseFloat(String(flags.amount).replace(',', '.')) * 100);
      if (!(cents > 0)) fail(`Bad amount "${flags.amount}".`, 'Pass a positive amount in euros, e.g. --amount 1250.50');
      if (flags['dry-run']) return { ok: true, dryRun: true, expectedCents: cents, due, steps: ['goto /facturation', 'click "Nouvelle facture"', `Client=${flags.client}`, `Montant=${flags.amount}`, `Statut=${INVOICE_STATUS[status]}`, `Échéance=${due}`, 'click "Créer"', 'compare KPI cards with DB sums'] };
      const { browser, page } = await connect();
      try {
        await open(page, '/facturation');
        const totalsBefore = ledgerTotals();
        await page.getByRole('button', { name: /^Nouvelle facture$/ }).click();
        const dialog = page.getByRole('dialog', { name: /Nouvelle facture/ });
        await dialog.getByLabel(/^Client$/).fill(flags.client);
        await dialog.getByLabel(/^Montant/).fill(String(flags.amount));
        await selectOption(dialog, page, /^Statut$/, INVOICE_STATUS[status]);
        if (typeof flags.issued === 'string') await dialog.getByLabel(/^Émise le/).fill(flags.issued);
        await dialog.getByLabel(/^Échéance$/).fill(due);
        await page.screenshot({ path: shotPath(state, 'invoice-create-dialog') });
        const respP = page.waitForResponse((r) => r.url().includes('/api/facturation/invoices') && r.request().method() === 'POST', { timeout: 15000 });
        await dialog.getByRole('button', { name: /^Créer$/ }).click();
        const resp = await respP;
        const body = await resp.json().catch(() => null);
        await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        await page.getByRole('cell', { name: body?.number ?? '__none__' }).first().waitFor({ timeout: 10000 }).catch(() => {});
        await sleep(500);
        const rowText = await page.getByRole('row').filter({ hasText: body?.number ?? '__none__' }).first().innerText().catch(() => null);
        const totalsAfter = ledgerTotals();
        const shown = await shownTotals(page);
        const file = shotPath(state, `invoice-created-${body?.number ?? 'unknown'}`);
        await page.screenshot({ path: file, fullPage: true });
        const dbRow = dbAll(`SELECT number, client_name, amount_cents, currency, status, issued_on, due_on FROM invoices WHERE id = ?`, body?.id ?? '')[0] ?? null;
        const totalsMatch = shown.caEncaisse === euros(totalsAfter.paidCents) && shown.enAttente === euros(totalsAfter.pendingCents);
        const ok = resp.status() === 201 && dbRow?.amount_cents === cents && dbRow?.status === status && !!rowText && rowText.includes(euros(cents)) && totalsMatch;
        if (!ok) process.exitCode = 1;
        const result = { ok, response: { status: resp.status(), number: body?.number, amount_cents: body?.amount_cents }, expectedCents: cents, rowOnPage: rowText?.replace(/\s+/g, ' ').trim() ?? null, dbRow, totals: { before: totalsBefore, after: totalsAfter, shown, expectedShown: { caEncaisse: euros(totalsAfter.paidCents), enAttente: euros(totalsAfter.pendingCents) }, match: totalsMatch }, file };
        saveJson(state, `invoice-created-${body?.number ?? 'unknown'}`, result);
        return result;
      } finally {
        await browser.close();
      }
    }
    if (sub === 'pay') {
      if (typeof flags.number !== 'string') fail('Missing --number.', 'Run `control-solopilot invoice list` and pass the F-YYYY-NNN number.');
      if (flags['dry-run']) return { ok: true, dryRun: true, steps: ['goto /facturation', `row ${flags.number}: click "Marquer payée"`, 'compare KPI cards with DB sums'] };
      const { browser, page } = await connect();
      try {
        await open(page, '/facturation');
        const row = page.getByRole('row').filter({ hasText: flags.number }).first();
        if (!(await row.isVisible().catch(() => false))) fail(`No row ${flags.number} on /facturation.`, 'Run `control-solopilot invoice list` for the numbers.');
        const totalsBefore = ledgerTotals();
        const respP = page.waitForResponse((r) => /\/api\/facturation\/invoices\/[^/]+\/paid$/.test(r.url()), { timeout: 15000 });
        await row.getByRole('button', { name: /payée/i }).click();
        const resp = await respP;
        await sleep(1000);
        const rowText = await page.getByRole('row').filter({ hasText: flags.number }).first().innerText().catch(() => null);
        const totalsAfter = ledgerTotals();
        const shown = await shownTotals(page);
        const file = shotPath(state, `invoice-paid-${flags.number}`);
        await page.screenshot({ path: file, fullPage: true });
        const dbRow = dbAll(`SELECT number, amount_cents, status, paid_on FROM invoices WHERE number = ?`, flags.number)[0] ?? null;
        const totalsMatch = shown.caEncaisse === euros(totalsAfter.paidCents) && shown.enAttente === euros(totalsAfter.pendingCents);
        const ok = resp.ok() && dbRow?.status === 'paid' && !!rowText?.includes('Payée') && totalsMatch;
        if (!ok) process.exitCode = 1;
        const result = { ok, response: { status: resp.status() }, rowOnPage: rowText?.replace(/\s+/g, ' ').trim() ?? null, dbRow, totals: { before: totalsBefore, after: totalsAfter, shown, match: totalsMatch }, file };
        saveJson(state, `invoice-paid-${flags.number}`, result);
        return result;
      } finally {
        await browser.close();
      }
    }
    fail(`Unknown invoice subcommand "${sub ?? ''}".`, 'Use `invoice create`, `invoice pay` or `invoice list`.');
  },
};

const VEILLE_TABS = { new: /^Nouvelles/, handled: /^Traitées/, ignored: /^Ignorées/ };

COMMANDS.veille = {
  summary: 'Veille list on /mentions: veille list | veille mark (handled/ignored) | veille show.',
  help: `control-solopilot veille list [--tab new|handled|ignored]
control-solopilot veille mark --item <text fragment> --as handled|ignored [--dry-run]
control-solopilot veille show

list    Opens /mentions, reads the items shown (optionally after switching tab), screenshots,
        and compares them with GET /api/veille/items for the same status and with the DB.
mark    Clicks the action for one item (found by a fragment of its text) and checks that
        tweets.triage_status changed and the item left the "new" list.
        Side effect: triage_status + triage_status_at on one row.
show    Read-only: the fake veille rows (id, category, urgency, status) from the DB.
--dry-run   mark: print the steps without touching the browser.`,
  async run(flags, pos) {
    const sub = pos[0];
    const state = requireState();
    const rows = () => dbAll(`SELECT id, source, triage_category AS category, triage_urgency AS urgency, triage_status AS status, substr(text, 1, 60) AS text FROM tweets ORDER BY triage_urgency DESC`);
    if (sub === 'show') return { ok: true, items: rows() };
    if (sub === 'list') {
      const tab = flags.tab || 'new';
      const { browser, page } = await connect();
      try {
        await open(page, '/mentions');
        if (tab !== 'new') {
          const t = page.getByRole('tab', { name: VEILLE_TABS[tab] }).or(page.getByRole('button', { name: VEILLE_TABS[tab] })).first();
          await t.click().catch(() => fail(`No "${tab}" tab on /mentions.`, 'Run `control-solopilot snapshot --selector main` to see the real tab names.'));
          await sleep(800);
        }
        const main = await page.locator('main').innerText();
        const api = await page.evaluate(async (s) => (await fetch(`/api/veille/items?status=${s}&limit=100`)).json(), tab);
        const db = rows().filter((r) => r.status === tab);
        const visible = Object.fromEntries(db.map((r) => [r.id, main.includes(r.text.slice(0, 30))]));
        const file = shotPath(state, `veille-${tab}`);
        await page.screenshot({ path: file, fullPage: true });
        const ok = api.length === db.length && Object.values(visible).every(Boolean);
        if (!ok) process.exitCode = 1;
        return { ok, tab, apiCount: api.length, dbCount: db.length, visibleOnPage: visible, order: api.map((i) => `${i.id} (${i.triage_urgency})`), file };
      } finally {
        await browser.close();
      }
    }
    if (sub === 'mark') {
      if (typeof flags.item !== 'string' || !['handled', 'ignored'].includes(flags.as)) fail('Missing --item or --as.', 'Example: control-solopilot veille mark --item "URSSAF" --as handled');
      if (flags['dry-run']) return { ok: true, dryRun: true, steps: ['goto /mentions', `find the item containing "${flags.item}"`, `click its "${flags.as}" action`, 'read tweets.triage_status'] };
      const target = rows().find((r) => r.text.includes(flags.item) || dbAll(`SELECT text FROM tweets WHERE id = ?`, r.id)[0].text.includes(flags.item));
      if (!target) fail(`No veille item contains "${flags.item}".`, 'Run `control-solopilot veille show`.');
      const { browser, page } = await connect();
      try {
        await open(page, '/mentions');
        // Innermost block holding both the item text and its actions (cards have no list role).
        const card = page.getByRole('tabpanel').locator('div').filter({ hasText: flags.item }).filter({ has: page.getByRole('button', { name: /^Traité$/ }) }).last();
        await card.waitFor({ timeout: 10000 }).catch(() => fail('Item not visible on /mentions.', 'It may not be in "new" any more: `control-solopilot veille show`.'));
        const label = flags.as === 'handled' ? /^Traité$/ : /^Ignorer$/;
        await page.screenshot({ path: shotPath(state, `veille-mark-${target.id}-before`) });
        const respP = page.waitForResponse((r) => r.url().includes(`/api/veille/items/${target.id}`) && r.request().method() === 'PATCH', { timeout: 15000 });
        await card.getByRole('button', { name: label }).first().click();
        const resp = await respP;
        await sleep(800);
        const stillListed = await page.getByRole('tabpanel').getByText(flags.item).first().isVisible().catch(() => false);
        const tabs = await page.getByRole('tab').allInnerTexts();
        const file = shotPath(state, `veille-mark-${target.id}-after`);
        await page.screenshot({ path: file, fullPage: true });
        const after = rows().find((r) => r.id === target.id);
        const ok = resp.ok() && after.status === flags.as && !stillListed;
        if (!ok) process.exitCode = 1;
        const result = { ok, item: target.id, response: { status: resp.status() }, statusBefore: target.status, statusAfter: after.status, stillVisibleInNewList: stillListed, tabsAfter: tabs.map((t) => t.replace(/\s+/g, ' ').trim()), file };
        saveJson(state, `veille-mark-${target.id}`, result);
        return result;
      } finally {
        await browser.close();
      }
    }
    fail(`Unknown veille subcommand "${sub ?? ''}".`, 'Use `veille list`, `veille mark` or `veille show`.');
  },
};

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
COMMANDS.console = {
  summary: 'Browser console messages recorded by the daemon (all pages, since launch).',
  help: 'control-solopilot console [--level error|warning|log] [--last N] [--grep <regex>]\n\nReads .verify-run/console.jsonl (copied into evidence on teardown).',
  async run(flags) {
    requireState();
    let r = readJsonl(path.join(RUN_DIR, 'console.jsonl'));
    if (flags.level) r = r.filter((x) => x.type === flags.level);
    if (flags.grep) r = r.filter((x) => new RegExp(flags.grep, 'i').test(x.text));
    const last = parseInt(flags.last || '50', 10);
    return { ok: true, total: r.length, messages: r.slice(-last) };
  },
};
COMMANDS['network-log'] = {
  summary: 'HTTP requests recorded by the daemon (method, url, status, timing).',
  help: 'control-solopilot network-log [--filter <substring>] [--status-min 400] [--last N]\n\nReads .verify-run/network.jsonl. Blocked third-party requests show status "blocked".',
  async run(flags) {
    requireState();
    let r = readJsonl(path.join(RUN_DIR, 'network.jsonl'));
    if (flags.filter) r = r.filter((x) => x.url.includes(flags.filter));
    if (flags['status-min']) r = r.filter((x) => typeof x.status === 'number' && x.status >= parseInt(flags['status-min'], 10));
    const last = parseInt(flags.last || '50', 10);
    return { ok: true, total: r.length, requests: r.slice(-last) };
  },
};

// Internal: the long-lived browser owner, spawned by launch.
async function browserd() {
  const { chromium } = loadPlaywright();
  const state = readState();
  const ctx = await chromium.launchPersistentContext(path.join(RUN_DIR, 'browser-profile'), {
    headless: true,
    viewport: { width: 1360, height: 900 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    serviceWorkers: 'block',
    args: [`--remote-debugging-port=${PORTS.cdp}`],
  });
  const con = fs.createWriteStream(path.join(RUN_DIR, 'console.jsonl'), { flags: 'a' });
  const netw = fs.createWriteStream(path.join(RUN_DIR, 'network.jsonl'), { flags: 'a' });
  // External boundary: no third-party request leaves the browser (Stripe.js, fonts, avatars...).
  await ctx.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => {
    netw.write(JSON.stringify({ ts: new Date().toISOString(), method: route.request().method(), url: route.request().url(), status: 'blocked' }) + '\n');
    return route.abort('blockedbyclient');
  });
  // The owner's browser after answering the Basic-auth prompt: every request to the app carries
  // the credentials. (Context httpCredentials do not reach pages driven over a second CDP client.)
  const authorization = 'Basic ' + Buffer.from(`admin:${state.adminPassword}`).toString('base64');
  await ctx.route((url) => ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === String(PORTS.app), (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization } }),
  );
  const attach = (page) => {
    page.on('console', (m) => con.write(JSON.stringify({ ts: new Date().toISOString(), type: m.type(), text: m.text(), url: page.url() }) + '\n'));
    page.on('pageerror', (e) => con.write(JSON.stringify({ ts: new Date().toISOString(), type: 'pageerror', text: e.message, url: page.url() }) + '\n'));
    page.on('requestfinished', async (req) => {
      const res = await req.response().catch(() => null);
      netw.write(JSON.stringify({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: res?.status() ?? null, ms: Math.round(req.timing().responseEnd) }) + '\n');
    });
    page.on('requestfailed', (req) => netw.write(JSON.stringify({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: null, failure: req.failure()?.errorText }) + '\n'));
  };
  ctx.pages().forEach(attach);
  ctx.on('page', attach);
  if (!ctx.pages().length) await ctx.newPage();
  const stop = async () => { await ctx.close().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  setInterval(() => {}, 1 << 30);
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(12)} ${c.summary}`);
  return `control-solopilot — drive a throwaway local Solopilot back-office like its owner.

Usage: control-solopilot <command> [flags]      (JSON on stdout; exit 1 on failure)

Health:       doctor, info, teardown
Lifecycle:    launch
Navigation:   goto
Interaction:  click, key, contact, invoice, veille
Inspection:   screenshot, snapshot
Streaming:    console, network-log

${lines.join('\n')}

Typical run:
  control-solopilot launch && control-solopilot doctor
  control-solopilot contact create --name "Fake Client SARL" --company "Fake Corp" --status active
  control-solopilot invoice create --client "Fake Client SARL" --amount 1250.50
  control-solopilot invoice pay --number F-$(date +%Y)-001
  control-solopilot veille list && control-solopilot teardown

Evidence goes to ${EVIDENCE_ROOT}/<runId>/ and survives teardown.
\`control-solopilot <command> --help\` for details. Commands with side effects accept --dry-run.`;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '__browserd') return browserd();
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { process.stdout.write(usage() + '\n'); return; }
  const c = COMMANDS[cmd];
  if (!c) {
    out({ ok: false, error: `Unknown command "${cmd}".`, fix: `Run \`control-solopilot --help\`. Commands: ${Object.keys(COMMANDS).join(', ')}` });
    process.exitCode = 1;
    return;
  }
  const { pos, flags } = parseArgs(rest);
  if (flags.help || flags.h) { process.stdout.write(c.help + '\n'); return; }
  try {
    out(await c.run(flags, pos));
  } catch (e) {
    out({ ok: false, command: cmd, error: e.message, fix: e.fix || 'Run `control-solopilot doctor` and read .verify-run/logs/.', ...(e.extra || {}) });
    process.exitCode = 1;
  }
}
main();
