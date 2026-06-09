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

// --- Publisher registry -----------------------------------------------------
// Maps a draft's target_source to its browser adapter. LinkedIn ('generic') and
// Reddit are wired; X is intentionally absent until its adapter lands (the API
// reports it as 'unsupported').
const PUBLISHERS: Partial<Record<PublishTarget, Publisher>> = {
  generic: linkedInPublisher,
  reddit: redditPublisher,
};

export function getPublisher(source: PublishTarget): Publisher | undefined {
  return PUBLISHERS[source];
}

export function isPublishSupported(source: string | null): source is PublishTarget {
  return source !== null && getPublisher(source as PublishTarget) !== undefined;
}

/** Human-facing platform label stored in content_drafts.used_on after posting. */
const PLATFORM_LABEL: Record<PublishTarget, string> = {
  generic: 'linkedin',
  x: 'x',
  reddit: 'reddit',
};

// --- Errors -----------------------------------------------------------------

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

// --- Session building -------------------------------------------------------
// Sessions are cookie-based, mirroring the X scraper. Cookies live in the
// settings table (masked in API responses by the existing credential masking).

/** Build a PlatformSession from stored credentials, or null when not connected. */
export function buildSession(source: PublishTarget): PlatformSession | null {
  if (source === 'generic') {
    const liAt = getSetting('LINKEDIN_LI_AT');
    if (!liAt) return null;
    const jsession = getSetting('LINKEDIN_JSESSIONID');
    const cookies: PlatformSession['cookies'] = [
      { name: 'li_at', value: liAt, domain: '.linkedin.com', path: '/' },
    ];
    if (jsession) {
      // LinkedIn wraps JSESSIONID in quotes; keep whatever the user pasted.
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
  return null;
}

export type ConnectionStatus = 'connected' | 'expired' | 'missing' | 'unsupported';

export interface ConnectionView {
  source: PublishTarget;
  platform: string;
  supported: boolean;
  /** Presence-based status (cheap): whether a session credential is stored. */
  status: ConnectionStatus;
}

/** Cheap, presence-based connection status for every publish target. */
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

/** Live check that actually drives a headless browser. Slow; call on demand. */
export async function testConnection(source: PublishTarget): Promise<SessionState> {
  const publisher = getPublisher(source);
  if (!publisher) return 'missing';
  const session = buildSession(source);
  if (!session) return 'missing';
  return publisher.checkSession(session);
}

// --- Publish orchestration --------------------------------------------------

// Single-flight guard: only one browser publish at a time across the process
// (a real browser is heavy and concurrent posts look bot-like). Mirrors the
// publishRunning/collectRunning guards in run-state.ts.
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

/**
 * Publish a draft by driving the platform's web UI. Enforces single-flight,
 * idempotency (never double-post the same draft text), and fail-closed
 * semantics. Throws PublishBusyError / PublishUnsupportedError /
 * PublishSessionMissingError / PublishError.
 */
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

  // Idempotency: if this exact text already published, return it — never repost.
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

  // One job row per (draft, text) keyed by idempotency_key. Retries reuse the
  // row via upsert — a plain INSERT would collide with the UNIQUE index on a
  // prior failed attempt (which keeps its key). RETURNING gives us the id for
  // both the insert and the update branch.
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

  // Remember where the draft lived so a failed publish returns it there
  // (instead of stranding it in a terminal 'failed' status the UI hides).
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
             publish_attempts = publish_attempts + 1
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
      `UPDATE content_drafts SET status = ?, publish_error = ?, publish_attempts = publish_attempts + 1 WHERE id = ?`,
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
