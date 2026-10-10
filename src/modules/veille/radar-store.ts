/**
 * Radar produit — persistence (ADR-0026): candidates, dedup ledger, caps.
 */
import { getDb, type RadarProposalRecord, type RadarProposalStatus } from '../../db.js';
import type { CapState } from './radar.js';

/** Triage relevance (0-100) an item needs before the radar spends a call on it. */
export const RADAR_PREFILTER_RELEVANCE = 60;
/** Items older than this are never scanned (no backlog explosion). */
export const RADAR_LOOKBACK_HOURS = 72;
/** Max items scored per sweep (bounds the scoring prompt). */
export const RADAR_MAX_CANDIDATES = 20;

export interface RadarCandidateRow {
  id: string;
  product_id: string;
  source: string;
  author: string;
  url: string;
  text: string;
  created_at: string;
}

export function listRadarCandidates(now: number = Date.now()): RadarCandidateRow[] {
  const since = new Date(now - RADAR_LOOKBACK_HOURS * 3600_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return getDb()
    .prepare(
      `SELECT id, product_id, source, author, url, text, created_at FROM tweets
       WHERE radar_scanned_at IS NULL
         AND triaged_at IS NOT NULL AND triage_error IS NULL
         AND triage_relevance >= ?
         AND origin = 'topic'
         AND collected_at >= ?
       ORDER BY triage_relevance DESC, collected_at DESC
       LIMIT ?`,
    )
    .all(RADAR_PREFILTER_RELEVANCE, since, RADAR_MAX_CANDIDATES) as RadarCandidateRow[];
}

export function markRadarScanned(itemIds: string[], now: number = Date.now()): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE tweets SET radar_scanned_at = ? WHERE id = ?');
  db.transaction((ids: string[]) => {
    for (const id of ids) stmt.run(now, id);
  })(itemIds);
}

export function proposalExists(itemId: string, productId: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM radar_proposals WHERE item_id = ? AND product_id = ?')
    .get(itemId, productId);
}

/** Today's proposals that count toward the caps (everything except 'capped'). */
export function loadCapState(day: string): CapState {
  const rows = getDb()
    .prepare(
      `SELECT product_id, COUNT(*) AS n FROM radar_proposals
       WHERE day = ? AND status != 'capped' GROUP BY product_id`,
    )
    .all(day) as { product_id: string; n: number }[];
  const perProduct = new Map(rows.map((r) => [r.product_id, r.n]));
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return { perProduct, total };
}

/**
 * Claims the (item, product) pair. Returns the new row id, or null when the
 * pair already has a row (dedup — never two proposals for the same pair).
 */
export function claimProposal(input: {
  itemId: string;
  productId: string;
  repo: string;
  score: number;
  reason: string;
  day: string;
  status: RadarProposalStatus;
  now?: number;
}): number | null {
  const now = input.now ?? Date.now();
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO radar_proposals
         (item_id, product_id, repo, score, reason, day, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.itemId,
      input.productId,
      input.repo,
      input.score,
      input.reason,
      input.day,
      input.status,
      now,
      now,
    );
  return result.changes === 1 ? Number(result.lastInsertRowid) : null;
}

export function updateProposal(
  id: number,
  patch: Partial<
    Pick<RadarProposalRecord, 'status' | 'title' | 'body' | 'issue_url' | 'issue_number' | 'error'>
  >,
): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE radar_proposals SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => patch[k] ?? null), Date.now(), id);
}

/**
 * Atomically moves a dry_run/failed proposal to 'creating' (manual creation).
 * Returns false when another request already claimed it or it is not eligible.
 */
export function claimForManualCreate(id: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE radar_proposals SET status = 'creating', error = NULL, updated_at = ?
       WHERE id = ? AND status IN ('dry_run', 'failed') AND body IS NOT NULL AND title IS NOT NULL`,
    )
    .run(Date.now(), id);
  return result.changes === 1;
}

export function getProposal(id: number): RadarProposalRecord | undefined {
  return getDb().prepare('SELECT * FROM radar_proposals WHERE id = ?').get(id) as
    | RadarProposalRecord
    | undefined;
}

export interface RadarProposalView extends RadarProposalRecord {
  product_name: string | null;
  source: string | null;
  source_url: string | null;
}

export function listProposals(limit = 30): RadarProposalView[] {
  return getDb()
    .prepare(
      `SELECT rp.*, p.name AS product_name, t.source AS source, t.url AS source_url
       FROM radar_proposals rp
       LEFT JOIN products p ON p.id = rp.product_id
       LEFT JOIN tweets t ON t.id = rp.item_id
       ORDER BY rp.created_at DESC, rp.id DESC
       LIMIT ?`,
    )
    .all(limit) as RadarProposalView[];
}
