import { createHash } from 'node:crypto';
import { getDb, DEFAULT_PRODUCT_ID, type PublishJobRecord } from './db.js';
import { getContentDraft } from './content-studio.js';
import { getSetting } from './settings-service.js';
import { logger } from './logger.js';
import {
  PublishError,
  type Publisher,
  type PublishTarget,
  type PlatformSession,
  type SessionState,
} from './ports.js';
import { linkedInPublisher } from './adapters/linkedin-publisher.js';
import { redditPublisher } from './adapters/reddit-publisher.js';
import { xPublisher } from './adapters/x-publisher.js';

const PUBLISHERS: Partial<Record<PublishTarget, Publisher>> = {
  generic: linkedInPublisher,
  reddit: redditPublisher,
  x: xPublisher,
};

export function getPublisher(source: PublishTarget): Publisher | undefined {
  return PUBLISHERS[source];
}

export function isPublishSupported(source: string | null): source is PublishTarget {
  return source !== null && getPublisher(source as PublishTarget) !== undefined;
}

const PLATFORM_LABEL: Record<PublishTarget, string> = {
  generic: 'linkedin',
  x: 'x',
  reddit: 'reddit',
  instagram: 'instagram',
};

export class PublishBusyError extends Error {
  constructor() {
    super('Une publication est déjà en cours. Réessaie dans un instant.');
    this.name = 'PublishBusyError';
  }
}

export class PublishUnsupportedError extends Error {
  constructor(source: string | null) {
    super(`La publication automatique n'est pas encore disponible pour « ${source ?? '?'} ».`);
    this.name = 'PublishUnsupportedError';
  }
}

export class PublishSessionMissingError extends Error {
  readonly state: SessionState;
  constructor(state: SessionState) {
    super(
      state === 'expired'
        ? 'Session expirée pour cette plateforme. Reconnecte-toi dans les Connexions.'
        : 'Aucune session connectée pour cette plateforme. Connecte-toi dans les Connexions.',
    );
    this.name = 'PublishSessionMissingError';
    this.state = state;
  }
}

export class PublishRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishRateLimitError';
  }
}

const DEFAULT_DAILY_CAP = 5;
const DEFAULT_MIN_SPACING_MINUTES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function getDailyCap(): number {
  const v = Number(getSetting('PUBLISH_DAILY_CAP'));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_DAILY_CAP;
}

function getMinSpacingMs(): number {
  const v = Number(getSetting('PUBLISH_MIN_SPACING_MINUTES'));
  const minutes = Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_SPACING_MINUTES;
  return minutes * 60 * 1000;
}

function enforceRateLimits(productId: string, source: PublishTarget, label: string): void {
  const db = getDb();
  const cap = getDailyCap();
  const since = Date.now() - DAY_MS;
  const todays = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM publish_jobs
         WHERE product_id = ? AND target_source = ? AND status = 'published' AND finished_at >= ?`,
      )
      .get(productId, source, since) as { n: number }
  ).n;
  if (todays >= cap) {
    throw new PublishRateLimitError(
      `Plafond quotidien atteint pour ${label} (${cap}/jour). Réessaie demain ou augmente la limite dans les réglages.`,
    );
  }

  const spacing = getMinSpacingMs();
  if (spacing > 0) {
    const last = (
      db
        .prepare(
          `SELECT MAX(finished_at) AS m FROM publish_jobs
           WHERE product_id = ? AND target_source = ? AND status = 'published'`,
        )
        .get(productId, source) as { m: number | null }
    ).m;
    if (last) {
      const wait = last + spacing - Date.now();
      if (wait > 0) {
        const mins = Math.ceil(wait / 60000);
        throw new PublishRateLimitError(
          `Attends encore ${mins} min avant de republier sur ${label} (espacement minimum).`,
        );
      }
    }
  }
}

export function buildSession(source: PublishTarget): PlatformSession | null {
  if (source === 'generic') {
    const liAt = getSetting('LINKEDIN_LI_AT');
    if (!liAt) return null;
    const jsession = getSetting('LINKEDIN_JSESSIONID');
    const cookies: PlatformSession['cookies'] = [
      { name: 'li_at', value: liAt, domain: '.linkedin.com', path: '/' },
    ];
    if (jsession) {
      cookies.push({ name: 'JSESSIONID', value: jsession, domain: '.linkedin.com', path: '/' });
    }
    return { cookies };
  }
  if (source === 'reddit') {
    const session = getSetting('REDDIT_SESSION');
    if (!session) return null;
    return {
      cookies: [{ name: 'reddit_session', value: session, domain: '.reddit.com', path: '/' }],
    };
  }
  if (source === 'x') {
    const authToken = getSetting('X_SESSION_AUTH_TOKEN');
    const csrf = getSetting('X_SESSION_CSRF_TOKEN');
    if (!authToken || !csrf) return null;
    return {
      cookies: [
        { name: 'auth_token', value: authToken, domain: '.x.com', path: '/' },
        { name: 'ct0', value: csrf, domain: '.x.com', path: '/' },
      ],
    };
  }
  return null;
}

export type ConnectionStatus = 'connected' | 'expired' | 'missing' | 'unsupported';

export interface ConnectionView {
  source: PublishTarget;
  platform: string;
  supported: boolean;
  status: ConnectionStatus;
}

export function listConnections(): ConnectionView[] {
  return (Object.keys(PLATFORM_LABEL) as PublishTarget[]).map((source) => {
    const supported = getPublisher(source) !== undefined;
    const hasSession = supported && buildSession(source) !== null;
    return {
      source,
      platform: PLATFORM_LABEL[source],
      supported,
      status: !supported ? 'unsupported' : hasSession ? 'connected' : 'missing',
    };
  });
}

export async function testConnection(source: PublishTarget): Promise<SessionState> {
  const publisher = getPublisher(source);
  if (!publisher) return 'missing';
  const session = buildSession(source);
  if (!session) return 'missing';
  return publisher.checkSession(session);
}

export interface CanaryResult {
  source: PublishTarget;
  platform: string;
  state: SessionState;
}

export async function runConnectionCanary(): Promise<CanaryResult[]> {
  const results: CanaryResult[] = [];
  for (const conn of listConnections()) {
    if (!conn.supported) continue;
    const session = buildSession(conn.source);
    if (!session) continue;
    const publisher = getPublisher(conn.source);
    if (!publisher) continue;
    let state: SessionState;
    try {
      state = await publisher.checkSession(session);
    } catch {
      state = 'expired';
    }
    results.push({ source: conn.source, platform: conn.platform, state });
  }
  return results;
}

let publishInFlight = false;

export function isPublishInFlight(): boolean {
  return publishInFlight;
}

function idempotencyKey(draftId: number, text: string): string {
  return createHash('sha256').update(`${draftId}:${text}`).digest('hex');
}

export interface PublishJobView {
  id: number;
  draft_id: number;
  product_id: string;
  target_source: string;
  status: string;
  attempt_count: number;
  published_url: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  finished_at: number | null;
}

function toPublishJobView(row: PublishJobRecord): PublishJobView {
  return {
    id: row.id,
    draft_id: row.draft_id,
    product_id: row.product_id,
    target_source: row.target_source,
    status: row.status,
    attempt_count: row.attempt_count,
    published_url: row.published_url,
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

export function listPublishJobs(draftId: number): PublishJobView[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM publish_jobs WHERE draft_id = ? ORDER BY created_at DESC`)
    .all(draftId) as PublishJobRecord[];
  return rows.map(toPublishJobView);
}

export interface PublishOutcome {
  job: PublishJobView;
  published_url: string;
}

export async function publishDraft(
  draftId: number,
  opts: { meta?: Record<string, unknown> } = {},
): Promise<PublishOutcome> {
  const draft = getContentDraft(draftId);
  if (!draft) {
    throw new Error('Brouillon introuvable.');
  }
  const source = draft.target_source;
  if (!isPublishSupported(source)) {
    throw new PublishUnsupportedError(source);
  }
  const publisher = getPublisher(source);
  if (!publisher) {
    throw new PublishUnsupportedError(source);
  }

  const text = draft.edited_text ?? draft.text;
  const key = idempotencyKey(draftId, text);
  const db = getDb();

  const existing = db
    .prepare(`SELECT * FROM publish_jobs WHERE idempotency_key = ? AND status = 'published'`)
    .get(key) as PublishJobRecord | undefined;
  if (existing && existing.published_url) {
    logger.info('Publish skipped — already published (idempotent)', { draftId, jobId: existing.id });
    return { job: toPublishJobView(existing), published_url: existing.published_url };
  }

  if (publishInFlight) {
    throw new PublishBusyError();
  }

  const session = buildSession(source);
  if (!session) {
    throw new PublishSessionMissingError('missing');
  }

  const now = Date.now();
  const productId = draft.product_id || DEFAULT_PRODUCT_ID;

  enforceRateLimits(productId, source, PLATFORM_LABEL[source]);

  const jobRow = db
    .prepare(
      `INSERT INTO publish_jobs
         (draft_id, product_id, target_source, status, attempt_count, idempotency_key, created_at)
       VALUES (?, ?, ?, 'running', 1, ?, ?)
       ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
         status = 'running',
         attempt_count = publish_jobs.attempt_count + 1,
         error_code = NULL,
         error_message = NULL,
         published_url = NULL,
         finished_at = NULL
       RETURNING id`,
    )
    .get(draftId, productId, source, key, now) as { id: number };
  const jobId = jobRow.id;

  const RESTORABLE = ['pending', 'edited', 'used', 'discarded'];
  const restoreStatus = RESTORABLE.includes(draft.status) ? draft.status : 'edited';

  publishInFlight = true;
  db.prepare(`UPDATE content_drafts SET status = 'publishing' WHERE id = ?`).run(draftId);
  logger.info('Publish started', { draftId, jobId, source });

  try {
    const result = await publisher.publish({ text, meta: opts.meta, session });
    const finishedAt = Date.now();
    const meta = opts.meta ? JSON.stringify(opts.meta) : null;
    db.prepare(
      `UPDATE content_drafts
         SET status = 'published', published_url = ?, published_at = ?, used_on = ?, used_at = ?,
             platform_meta = COALESCE(?, platform_meta), publish_error = NULL,
             publish_attempts = publish_attempts + 1, scheduled_for = NULL
       WHERE id = ?`,
    ).run(result.url, finishedAt, PLATFORM_LABEL[source], finishedAt, meta, draftId);
    db.prepare(
      `UPDATE publish_jobs SET status = 'published', published_url = ?, finished_at = ? WHERE id = ?`,
    ).run(result.url, finishedAt, jobId);
    logger.info('Publish succeeded', { draftId, jobId, url: result.url });
    const job = db.prepare(`SELECT * FROM publish_jobs WHERE id = ?`).get(jobId) as PublishJobRecord;
    return { job: toPublishJobView(job), published_url: result.url };
  } catch (err) {
    const finishedAt = Date.now();
    const code = err instanceof PublishError ? err.code : 'UNKNOWN';
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE content_drafts SET status = ?, publish_error = ?, publish_attempts = publish_attempts + 1, scheduled_for = NULL WHERE id = ?`,
    ).run(restoreStatus, message, draftId);
    db.prepare(
      `UPDATE publish_jobs SET status = 'failed', error_code = ?, error_message = ?, finished_at = ? WHERE id = ?`,
    ).run(code, message, finishedAt, jobId);
    logger.warn('Publish failed', { draftId, jobId, code, error: message });
    throw err;
  } finally {
    publishInFlight = false;
  }
}

export class PublishScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishScheduleError';
  }
}

function parseMetaRecord(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function scheduleDraft(
  draftId: number,
  scheduledFor: number,
  opts: { meta?: Record<string, unknown> } = {},
): PublishJobView {
  const draft = getContentDraft(draftId);
  if (!draft) throw new Error('Brouillon introuvable.');
  const source = draft.target_source;
  if (!isPublishSupported(source)) throw new PublishUnsupportedError(source);
  if (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now()) {
    throw new PublishScheduleError('La date de publication doit être dans le futur.');
  }

  const db = getDb();
  const text = draft.edited_text ?? draft.text;
  const key = idempotencyKey(draftId, text);
  const productId = draft.product_id || DEFAULT_PRODUCT_ID;

  const jobRow = db
    .prepare(
      `INSERT INTO publish_jobs
         (draft_id, product_id, target_source, status, scheduled_for, attempt_count, idempotency_key, created_at)
       VALUES (?, ?, ?, 'queued', ?, 0, ?, ?)
       ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
         status = 'queued', scheduled_for = excluded.scheduled_for,
         error_code = NULL, error_message = NULL, published_url = NULL, finished_at = NULL
       RETURNING id`,
    )
    .get(draftId, productId, source, scheduledFor, key, Date.now()) as { id: number };

  const meta = opts.meta ? JSON.stringify(opts.meta) : null;
  db.prepare(
    `UPDATE content_drafts SET status = 'scheduled', scheduled_for = ?,
       platform_meta = COALESCE(?, platform_meta), publish_error = NULL WHERE id = ?`,
  ).run(scheduledFor, meta, draftId);

  logger.info('Draft scheduled', { draftId, jobId: jobRow.id, scheduledFor, source });
  const job = db.prepare(`SELECT * FROM publish_jobs WHERE id = ?`).get(jobRow.id) as PublishJobRecord;
  return toPublishJobView(job);
}

export function cancelSchedule(draftId: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM publish_jobs WHERE draft_id = ? AND status = 'queued'`).run(draftId);
  db.prepare(
    `UPDATE content_drafts SET status = 'edited', scheduled_for = NULL WHERE id = ? AND status = 'scheduled'`,
  ).run(draftId);
  logger.info('Draft schedule cancelled', { draftId });
}

export async function publishDueScheduledJobs(): Promise<void> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT draft_id FROM publish_jobs
       WHERE status = 'queued' AND scheduled_for IS NOT NULL AND scheduled_for <= ?
       ORDER BY scheduled_for ASC`,
    )
    .all(Date.now()) as { draft_id: number }[];
  if (due.length === 0) return;
  logger.info('Draining scheduled publish jobs', { count: due.length });

  for (const { draft_id } of due) {
    const draft = getContentDraft(draft_id);
    if (!draft) continue;
    try {
      await publishDraft(draft_id, { meta: parseMetaRecord(draft.platform_meta) });
    } catch (err) {
      if (err instanceof PublishBusyError || err instanceof PublishRateLimitError) {
        logger.info('Scheduled job deferred', { draftId: draft_id, reason: err.name });
        continue;
      }
      logger.warn('Scheduled publish failed', {
        draftId: draft_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
