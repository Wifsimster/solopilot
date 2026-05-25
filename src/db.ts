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
