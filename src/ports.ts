export type ItemSource = 'x' | 'reddit' | 'hn' | 'youtube';

export type ItemOrigin = 'topic' | 'mention';

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
  origin?: ItemOrigin;
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

export type PublishTarget = 'x' | 'reddit' | 'generic' | 'instagram';

export type SessionState = 'connected' | 'expired' | 'missing';

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface PlatformSession {
  cookies: SessionCookie[];
}

export interface PublishInput {
  text: string;
  meta?: Record<string, unknown>;
  session: PlatformSession;
}

export interface PublishResult {
  url: string;
  externalId?: string;
}

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

export interface PostMetrics {
  likes?: number;
  comments?: number;
  reposts?: number;
}

export interface Publisher {
  readonly source: PublishTarget;
  checkSession(session: PlatformSession): Promise<SessionState>;
  publish(input: PublishInput): Promise<PublishResult>;
  fetchMetrics?(url: string, session: PlatformSession): Promise<PostMetrics>;
}
