import { z } from 'zod';
import type { Item, SourceOpts, SourceReader } from '../ports.js';
import { logger } from '../logger.js';

const USER_AGENT = 'x-ai-weekly-bot/1.0';
const FETCH_TIMEOUT_MS = 30_000;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

const redditChildSchema = z.object({
  kind: z.string().optional(),
  data: z.object({
    id: z.string(),
    title: z.string().default(''),
    selftext: z.string().optional().default(''),
    author: z.string().optional().default(''),
    permalink: z.string(),
    created_utc: z.number(),
    url: z.string().optional(),
    subreddit: z.string().optional(),
  }),
});

const redditListingSchema = z.object({
  data: z.object({
    children: z.array(redditChildSchema).default([]),
  }),
});

export interface RedditReaderOptions {
  /** Subreddit names (without the r/ prefix). Validated against SUBREDDIT_PATTERN. */
  subreddits: string[];
  /** Override the default User-Agent string. */
  userAgent?: string;
}

export function createRedditReader(options: RedditReaderOptions): SourceReader {
  const validSubreddits = options.subreddits.filter((s) => SUBREDDIT_PATTERN.test(s));
  const invalidSubreddits = options.subreddits.filter((s) => !SUBREDDIT_PATTERN.test(s));
  if (invalidSubreddits.length > 0) {
    logger.warn('Reddit: ignoring invalid subreddit names', { invalid: invalidSubreddits });
  }

  const userAgent = options.userAgent ?? USER_AGENT;

  return {
    source: 'reddit',
    fetchSince: (productId, sinceTs, opts) => fetchAllSubreddits(productId, sinceTs, opts),
  };

  async function fetchAllSubreddits(
    productId: string,
    sinceTs: number,
    _opts: SourceOpts,
  ): Promise<Item[]> {
    if (validSubreddits.length === 0) {
      logger.info('Reddit: no subreddits configured for product', { productId });
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const dedup = new Map<string, Item>();

    for (const subreddit of validSubreddits) {
      try {
        const items = await fetchSubreddit(subreddit, productId, sinceTs, fetchedAt);
        for (const item of items) {
          if (!dedup.has(item.id)) dedup.set(item.id, item);
        }
      } catch (err) {
        logger.warn('Reddit: subreddit fetch failed', {
          subreddit,
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const items = Array.from(dedup.values());
    logger.info('Reddit: fetched items', {
      productId,
      count: items.length,
      subreddits: validSubreddits.length,
    });
    return items;
  }

  async function fetchSubreddit(
    subreddit: string,
    productId: string,
    sinceTs: number,
    fetchedAt: string,
  ): Promise<Item[]> {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`;
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status === 429) {
      logger.warn('Reddit: rate limited (HTTP 429)', { subreddit, productId });
      return [];
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Reddit: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await response.json()) as unknown;
    const parsed = redditListingSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn('Reddit: failed to parse listing', {
        subreddit,
        productId,
        errors: parsed.error.issues.map((i) => i.message),
      });
      return [];
    }

    const items: Item[] = [];
    for (const child of parsed.data.data.children) {
      const post = child.data;
      if (sinceTs > 0 && post.created_utc < sinceTs) continue;

      const selftext = (post.selftext ?? '').trim();
      const text = selftext ? `${post.title}\n\n${selftext}` : post.title;
      const externalUrl = post.url && !post.url.includes('reddit.com') ? post.url : undefined;

      items.push({
        id: `reddit:${post.id}`,
        source: 'reddit',
        text,
        author: post.author ? `u/${post.author}` : 'u/unknown',
        url: `https://www.reddit.com${post.permalink}`,
        createdAt: new Date(post.created_utc * 1000).toISOString(),
        fetchedAt,
        productId,
        urls: externalUrl ? [externalUrl] : [],
      });
    }
    return items;
  }
}
