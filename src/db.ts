import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export const DEFAULT_PRODUCT_ID = 'default';

export interface RunRecord {
  id: number;
  product_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'no_news' | 'no_tweets' | 'error' | 'deleted';
  trigger_type: 'cron' | 'manual' | 'collect';
  tweets_fetched: number;
  tweets_posted: number;
  thread_ids: string | null;
  summary: string | null;
  error_message: string | null;
  notification_status: 'pending' | 'sent' | 'failed' | 'skipped' | null;
}

export interface MonthlySummaryRecord {
  id: number;
  product_id: string;
  year: number;
  month: number;
  summary: string;
  source_run_ids: string;
  generated_at: string;
}

export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  x_query: string | null;
  discord_webhook: string | null;
  ai_prompt_override: string | null;
  collect_cron: string | null;
  publish_cron: string | null;
  created_at: number;
  archived_at: number | null;
  x_enabled: number;
  reddit_enabled: number;
  reddit_subreddits: string | null;
  hn_enabled: number;
  hn_keywords: string | null;
  intent_enabled: number;
  intent_keywords: string | null;
  product_description: string | null;
  reply_voice: string | null;
  product_url: string | null;
  production_url: string | null;
  target_audience: string | null;
  value_props: string | null;
  call_to_actions: string | null;
  content_voice: string | null;
  content_language: string | null;
}

export interface ContentDraftRecord {
  id: number;
  product_id: string;
  kind: string;
  target_source: string | null;
  angle: string | null;
  text: string;
  edited_text: string | null;
  status: string;
  used_on: string | null;
  generated_at: number;
  used_at: number | null;
}

export interface IntentSignalRecord {
  id: number;
  item_id: string;
  product_id: string;
  source: string;
  matched_pattern: string;
  status: string;
  notes: string | null;
  created_at: number;
  ai_score: number | null;
  ai_explanation: string | null;
  ai_drafted_reply: string | null;
  ai_processed_at: number | null;
  ai_error: string | null;
}

export interface IntentSignalReplyRecord {
  id: number;
  intent_signal_id: number;
  angle: string | null;
  text: string;
  used: number;
  generated_at: number;
}

export interface ProductSettingRecord {
  product_id: string;
  key: string;
  value: string | null;
}

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const rows = database
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table) as { name: string }[];
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  if (!columnExists(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Safe ALTER TABLE migration — runs after initial CREATE TABLE migrations.
function runAlterMigrations(database: Database.Database) {
  const alterMigrations = [`ALTER TABLE runs ADD COLUMN notification_status TEXT DEFAULT NULL`];
  for (const sql of alterMigrations) {
    try {
      database.exec(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}

function runProductMigrations(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    x_query TEXT,
    discord_webhook TEXT,
    ai_prompt_override TEXT,
    collect_cron TEXT,
    publish_cron TEXT,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  )`);

  database.exec(`CREATE TABLE IF NOT EXISTS product_settings (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (product_id, key)
  )`);

  addColumnIfMissing(database, 'tweets', 'product_id', `TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}'`);
  addColumnIfMissing(database, 'runs', 'product_id', `TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}'`);
  addColumnIfMissing(
    database,
    'monthly_summaries',
    'product_id',
    `TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}'`,
  );

  addColumnIfMissing(database, 'tweets', 'source', `TEXT NOT NULL DEFAULT 'x'`);
  addColumnIfMissing(database, 'tweets', 'author', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(database, 'tweets', 'url', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(database, 'products', 'x_enabled', `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing(database, 'products', 'reddit_enabled', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing(database, 'products', 'reddit_subreddits', `TEXT`);
  addColumnIfMissing(database, 'products', 'hn_enabled', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing(database, 'products', 'hn_keywords', `TEXT`);
  addColumnIfMissing(database, 'products', 'intent_enabled', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing(database, 'products', 'intent_keywords', `TEXT`);
  addColumnIfMissing(database, 'products', 'product_description', `TEXT`);
  addColumnIfMissing(database, 'products', 'reply_voice', `TEXT`);
  addColumnIfMissing(database, 'products', 'product_url', `TEXT`);
  addColumnIfMissing(database, 'products', 'production_url', `TEXT`);
  addColumnIfMissing(database, 'products', 'target_audience', `TEXT`);
  addColumnIfMissing(database, 'products', 'value_props', `TEXT`);
  addColumnIfMissing(database, 'products', 'call_to_actions', `TEXT`);
  addColumnIfMissing(database, 'products', 'content_voice', `TEXT`);
  addColumnIfMissing(database, 'products', 'content_language', `TEXT`);

  database.exec(`CREATE TABLE IF NOT EXISTS content_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target_source TEXT,
    angle TEXT,
    text TEXT NOT NULL,
    edited_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    used_on TEXT,
    generated_at INTEGER NOT NULL,
    used_at INTEGER
  )`);

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_content_drafts_product_status ON content_drafts(product_id, status, generated_at DESC)`,
  );

  database.exec(`CREATE TABLE IF NOT EXISTS intent_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    matched_pattern TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(item_id, product_id, matched_pattern)
  )`);

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_intent_signals_product_status ON intent_signals(product_id, status, created_at DESC)`,
  );

  addColumnIfMissing(database, 'intent_signals', 'ai_score', `INTEGER`);
  addColumnIfMissing(database, 'intent_signals', 'ai_explanation', `TEXT`);
  addColumnIfMissing(database, 'intent_signals', 'ai_drafted_reply', `TEXT`);
  addColumnIfMissing(database, 'intent_signals', 'ai_processed_at', `INTEGER`);
  addColumnIfMissing(database, 'intent_signals', 'ai_error', `TEXT`);

  database.exec(`CREATE TABLE IF NOT EXISTS intent_signal_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_signal_id INTEGER NOT NULL REFERENCES intent_signals(id) ON DELETE CASCADE,
    angle TEXT,
    text TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    generated_at INTEGER NOT NULL
  )`);

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_isr_signal ON intent_signal_replies(intent_signal_id, generated_at DESC)`,
  );

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_tweets_product_collection ON tweets(product_id, collection_date, used_in_run_id)`,
  );
  database.exec(`CREATE INDEX IF NOT EXISTS idx_runs_product ON runs(product_id)`);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_monthly_summaries_product ON monthly_summaries(product_id)`,
  );

  rebuildMonthlySummariesIfLegacyUnique(database);

  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_summaries_product_year_month ON monthly_summaries(product_id, year, month)`,
  );

  database
    .prepare(
      `INSERT OR IGNORE INTO products (id, name, created_at) VALUES (?, ?, ?)`,
    )
    .run(DEFAULT_PRODUCT_ID, 'Default', Date.now());

  database
    .prepare(`UPDATE tweets SET product_id = ? WHERE product_id IS NULL`)
    .run(DEFAULT_PRODUCT_ID);
  database
    .prepare(`UPDATE runs SET product_id = ? WHERE product_id IS NULL`)
    .run(DEFAULT_PRODUCT_ID);
  database
    .prepare(`UPDATE monthly_summaries SET product_id = ? WHERE product_id IS NULL`)
    .run(DEFAULT_PRODUCT_ID);
}

function rebuildMonthlySummariesIfLegacyUnique(database: Database.Database) {
  const indexes = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'monthly_summaries'`)
    .all() as { name: string }[];
  const hasLegacyUnique = indexes.some((i) => i.name.startsWith('sqlite_autoindex_monthly_summaries_'));
  if (!hasLegacyUnique) return;

  database.exec('BEGIN');
  try {
    database.exec(`CREATE TABLE monthly_summaries_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      summary TEXT NOT NULL,
      source_run_ids TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      product_id TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}'
    )`);
    database.exec(
      `INSERT INTO monthly_summaries_new (id, year, month, summary, source_run_ids, generated_at, product_id)
       SELECT id, year, month, summary, source_run_ids, generated_at, COALESCE(product_id, '${DEFAULT_PRODUCT_ID}')
       FROM monthly_summaries`,
    );
    database.exec('DROP TABLE monthly_summaries');
    database.exec('ALTER TABLE monthly_summaries_new RENAME TO monthly_summaries');
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_monthly_summaries_product ON monthly_summaries(product_id)`,
    );
    database.exec('COMMIT');
    logger.info('Rebuilt monthly_summaries to drop legacy unique constraint');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export interface WorkflowRunRecord {
  id: number;
  workflow_id: string;
  product_id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  trace: string;
  error_message: string | null;
}

// Workflow engine migrations (ADR-0013). Idempotent — generalizes the `runs`
// table into a workflow-aware execution log without touching it.
function runWorkflowMigrations(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    product_id TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}',
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    trace TEXT NOT NULL DEFAULT '[]',
    error_message TEXT
  )`);

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, product_id, started_at DESC)`,
  );
}

export interface InvoiceRecord {
  id: string;
  product_id: string;
  number: string;
  client_name: string;
  client_email: string | null;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  issued_on: string;
  due_on: string;
  paid_on: string | null;
  stripe_id: string | null;
  created_at: number;
}

// Facturation module migrations (ADR-0016). Idempotent. Local invoice ledger;
// Stripe sync is optional and stores its external id in stripe_id.
function runFacturationMigrations(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL DEFAULT '${DEFAULT_PRODUCT_ID}' REFERENCES products(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_email TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'eur',
    status TEXT NOT NULL DEFAULT 'draft',
    issued_on TEXT NOT NULL,
    due_on TEXT NOT NULL,
    paid_on TEXT,
    stripe_id TEXT,
    created_at INTEGER NOT NULL
  )`);

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_invoices_product_status ON invoices(product_id, status, due_on)`,
  );
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices(stripe_id) WHERE stripe_id IS NOT NULL`,
  );
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    trigger_type TEXT NOT NULL DEFAULT 'cron',
    tweets_fetched INTEGER NOT NULL DEFAULT 0,
    tweets_posted INTEGER NOT NULL DEFAULT 0,
    thread_ids TEXT,
    summary TEXT,
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS monthly_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    summary TEXT NOT NULL,
    source_run_ids TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(year, month)
  )`,
  `CREATE TABLE IF NOT EXISTS tweets (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    urls TEXT NOT NULL DEFAULT '[]',
    collected_at TEXT NOT NULL DEFAULT (datetime('now')),
    collection_date TEXT NOT NULL,
    used_in_run_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tweets_collection_date ON tweets(collection_date, used_in_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tweets_used_in_run_id ON tweets(used_in_run_id)`,
];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db');
    mkdirSync(path.dirname(dbPath), { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    for (const sql of MIGRATIONS) {
      db.exec(sql);
    }

    runAlterMigrations(db);
    runProductMigrations(db);
    runWorkflowMigrations(db);
    runFacturationMigrations(db);

    logger.info('Database initialized', { path: dbPath });
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
