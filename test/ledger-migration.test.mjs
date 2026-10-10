// Ledger migration (ADR-0029): a database created before external_ref/source
// existed is upgraded in place, keeps its rows, and gets the partial UNIQUE
// index. Runs on a throwaway DB built with the pre-0029 schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'solopilot-ledger-mig-')), 'old.db');
process.env.DB_PATH = dbPath;

// Pre-ADR-0029 schema (ADR-0017 ledger) with one existing row.
const old = new Database(dbPath);
old.exec(`CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, x_query TEXT, discord_webhook TEXT,
  ai_prompt_override TEXT, collect_cron TEXT, publish_cron TEXT,
  created_at INTEGER NOT NULL, archived_at INTEGER)`);
old.exec(`INSERT INTO products (id, name, created_at) VALUES ('default', 'Défaut', 0)`);
old.exec(`CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL DEFAULT 'default' REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, label TEXT NOT NULL,
  occurred_on TEXT NOT NULL, created_at INTEGER NOT NULL)`);
old.exec(`INSERT INTO ledger VALUES ('old-1', 'default', 'recette', 1000, 'Ancienne', '2026-01-02', 1)`);
old.close();

const { getDb } = await import('../dist/db.js');
const compta = await import('../dist/modules/comptabilite/compta.js');

test('migration adds the columns, keeps old rows, creates the unique index', () => {
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(ledger)').all().map((c) => c.name);
  for (const c of ['external_ref', 'source', 'api_token_id']) assert.ok(cols.includes(c), c);
  const row = db.prepare("SELECT * FROM ledger WHERE id = 'old-1'").get();
  assert.equal(row.amount_cents, 1000);
  assert.equal(row.external_ref, null);
  assert.equal(row.source, null);
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_ledger_external_ref'").get();
  assert.match(idx.sql, /UNIQUE INDEX/);
  assert.match(idx.sql, /WHERE external_ref IS NOT NULL/);
  for (const t of ['api_tokens', 'api_token_audit']) {
    assert.ok(db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(t), t);
  }
});

test('addLedgerEntry raises LedgerDuplicateError carrying the existing entry', () => {
  const input = { kind: 'recette', amount_cents: 24, label: 'GP', occurred_on: '2026-06-15', external_ref: 'GG104F32CP' };
  const first = compta.addLedgerEntry('default', input);
  assert.throws(
    () => compta.addLedgerEntry('default', { ...input, amount_cents: 1 }),
    (err) => err instanceof compta.LedgerDuplicateError && err.existing.id === first.id,
  );
  // Raw SQL also refuses the duplicate: the index, not the code, is the guard.
  assert.throws(() =>
    getDb()
      .prepare(`INSERT INTO ledger (id, product_id, kind, amount_cents, label, occurred_on, created_at, external_ref)
                VALUES ('x', 'default', 'recette', 1, 'x', '2026-06-15', 1, 'GG104F32CP')`)
      .run(),
  );
});
