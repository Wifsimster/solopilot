export type ItemSource = 'x' | 'reddit' | 'hn';

export interface Item {
  id: string;
  source: ItemSource;
  text: string;
  author: string;
  url: string;
  createdAt: string;
  fetchedAt: string;
  productId: string;
  urls: string[];
}

export interface SourceOpts {
  productId: string;
  lookbackDays?: number;
}

export interface SourceReader {
  source: ItemSource;
  fetchSince(productId: string, sinceTs: number, opts: SourceOpts): Promise<Item[]>;
}

export type Tweet = Item;
export type TweetReader = SourceReader & {
  fetchRecentTweets(): Promise<Item[]>;
};

export function isXUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'twitter.com' ||
      hostname === 'x.com' ||
      hostname.endsWith('.twitter.com') ||
      hostname.endsWith('.x.com')
    );
  } catch {
    return false;
  }
}

// --- Publishing (auto-post) ports (ADR: content auto-publish) ---
//
// Publishing drives the platform's real web UI as the logged-in user (no
// official API, no clipboard). A Publisher is the per-platform browser adapter;
// the publish-service orchestrates guard/retry/idempotency around it.

/** Platforms a draft can be published to. Mirrors content-studio's TargetSource. */
export type PublishTarget = 'x' | 'reddit' | 'generic' | 'instagram';

/** Whether a stored session can currently act as the logged-in user. */
export type SessionState = 'connected' | 'expired' | 'missing';

/** Minimal cookie shape used to seed a logged-in browser context. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

/** The credentials needed to drive a platform as the user (cookie-based). */
export interface PlatformSession {
  cookies: SessionCookie[];
}

export interface PublishInput {
  /** The exact text to post (already the user-approved/edited version). */
  text: string;
  /** Platform-specific fields (e.g. reddit subreddit/title, X thread parts). */
  meta?: Record<string, unknown>;
  session: PlatformSession;
}

export interface PublishResult {
  /** Permalink to the live post. */
  url: string;
  /** Platform-native id when extractable. */
  externalId?: string;
}

/** Classified failure modes so the orchestrator/UI can react appropriately. */
export type PublishErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'CHECKPOINT'
  | 'SELECTOR_DRIFT'
  | 'UNKNOWN';

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  constructor(code: PublishErrorCode, message: string) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
  }
}

/** Public engagement counts scraped back from a live post (feedback loop). */
export interface PostMetrics {
  likes?: number;
  comments?: number;
  reposts?: number;
}

export interface Publisher {
  readonly source: PublishTarget;
  /** Cheap-ish check that the stored session is still logged in. */
  checkSession(session: PlatformSession): Promise<SessionState>;
  /** Drive the web UI to publish, returning the live post URL. Throws PublishError. */
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Best-effort scrape of a published post's public engagement counts. Optional:
   * platforms that don't implement it are skipped by the metrics refresher.
   * Should resolve to {} rather than throw when counts can't be read.
   */
  fetchMetrics?(url: string, session: PlatformSession): Promise<PostMetrics>;
}
