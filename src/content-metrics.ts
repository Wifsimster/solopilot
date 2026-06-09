import { getDb } from './db.js';
import { getPublisher, buildSession } from './publish-service.js';
import type { PublishTarget } from './ports.js';
import { logger } from './logger.js';

// Closes the feedback loop: scrape public engagement counts from published
// posts and aggregate angle performance, so the founder learns which angles
// actually get kept, published, and engaged with.

// Single-flight guard — metrics scraping launches a browser; don't run two at
// once. Independent of the publish guard and cheap.
let metricsRefreshing = false;

export function isMetricsRefreshing(): boolean {
  return metricsRefreshing;
}

/**
 * Refresh engagement metrics for every published draft that has a live URL and
 * a publisher exposing fetchMetrics (only X today). Best-effort: failures per
 * draft are skipped. Returns how many were checked vs updated.
 */
export async function refreshPublishedMetrics(
  productId?: string,
): Promise<{ checked: number; updated: number }> {
  if (metricsRefreshing) return { checked: 0, updated: 0 };
  metricsRefreshing = true;
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, product_id, target_source, published_url FROM content_drafts
         WHERE status = 'published' AND published_url IS NOT NULL
         ${productId ? 'AND product_id = ?' : ''}`,
      )
      .all(...(productId ? [productId] : [])) as {
      id: number;
      product_id: string;
      target_source: string;
      published_url: string;
    }[];

    const upsert = db.prepare(
      `INSERT INTO post_metrics (draft_id, product_id, target_source, likes, comments, reposts, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(draft_id) DO UPDATE SET
         likes = excluded.likes, comments = excluded.comments,
         reposts = excluded.reposts, fetched_at = excluded.fetched_at`,
    );

    let updated = 0;
    for (const r of rows) {
      const source = r.target_source as PublishTarget;
      const publisher = getPublisher(source);
      if (!publisher || !publisher.fetchMetrics) continue;
      const session = buildSession(source);
      if (!session) continue;
      let metrics;
      try {
        metrics = await publisher.fetchMetrics(r.published_url, session);
      } catch {
        continue;
      }
      if (
        !metrics ||
        (metrics.likes === undefined &&
          metrics.comments === undefined &&
          metrics.reposts === undefined)
      ) {
        continue;
      }
      upsert.run(
        r.id,
        r.product_id,
        source,
        metrics.likes ?? null,
        metrics.comments ?? null,
        metrics.reposts ?? null,
        Date.now(),
      );
      updated++;
    }
    logger.info('Published metrics refreshed', { checked: rows.length, updated, productId });
    return { checked: rows.length, updated };
  } finally {
    metricsRefreshing = false;
  }
}

export interface AnglePerformance {
  angle: string;
  total: number;
  published: number;
  used: number;
  discarded: number;
  /** Avg (likes+comments+reposts) across published drafts that have scraped
   *  metrics; null when none of the angle's posts have been scraped yet. */
  avg_engagement: number | null;
}

/**
 * Aggregate the draft lifecycle by angle. published/used are the "kept" signal,
 * discarded the "rejected" signal — a reliable, scrape-free proxy for what
 * works — enriched with average engagement where metrics exist.
 */
export function getAnglePerformance(productId: string): AnglePerformance[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(cd.angle), ''), '(sans angle)') AS angle,
         COUNT(*) AS total,
         SUM(CASE WHEN cd.status = 'published' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN cd.status = 'used' THEN 1 ELSE 0 END) AS used,
         SUM(CASE WHEN cd.status = 'discarded' THEN 1 ELSE 0 END) AS discarded,
         AVG(CASE WHEN cd.status = 'published' AND pm.draft_id IS NOT NULL
             THEN COALESCE(pm.likes, 0) + COALESCE(pm.comments, 0) + COALESCE(pm.reposts, 0)
             END) AS avg_engagement
       FROM content_drafts cd
       LEFT JOIN post_metrics pm ON pm.draft_id = cd.id
       WHERE cd.product_id = ?
       GROUP BY angle
       ORDER BY published DESC, total DESC`,
    )
    .all(productId) as {
    angle: string;
    total: number;
    published: number;
    used: number;
    discarded: number;
    avg_engagement: number | null;
  }[];

  return rows.map((r) => ({
    angle: r.angle,
    total: r.total,
    published: r.published,
    used: r.used,
    discarded: r.discarded,
    avg_engagement: r.avg_engagement != null ? Math.round(r.avg_engagement) : null,
  }));
}
