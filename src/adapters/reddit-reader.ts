import { z } from 'zod';
import type { Item, SourceOpts, SourceReader } from '../ports.js';
import { logger } from '../logger.js';

const USER_AGENT = 'web:solopilot:1.0 (by /u/solopilot)';
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

const subredditSearchChildSchema = z.object({
  kind: z.string().optional(),
  data: z.object({
    display_name: z.string(),
    title: z.string().optional().default(''),
    public_description: z.string().optional().default(''),
    subscribers: z.number().nullable().optional(),
    over18: z.boolean().optional(),
    over_18: z.boolean().optional(),
    icon_img: z.string().optional().default(''),
    community_icon: z.string().optional().default(''),
    subreddit_type: z.string().optional(),
  }),
});

const subredditSearchListingSchema = z.object({
  data: z.object({
    children: z.array(subredditSearchChildSchema).default([]),
  }),
});

export interface SubredditSearchResult {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  over18: boolean;
  iconUrl: string | null;
}

type SubredditSearchChild = z.infer<typeof subredditSearchChildSchema>;

async function fetchSubredditChildren(
  url: string,
  userAgent: string,
  query: string,
): Promise<SubredditSearchChild[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status === 429) {
    logger.warn('Reddit: subreddit search rate limited (HTTP 429)', { query, url });
    return [];
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Reddit: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }

  const json = (await response.json()) as unknown;
  const parsed = subredditSearchListingSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Reddit: failed to parse subreddit search listing', {
      query,
      url,
      errors: parsed.error.issues.map((i) => i.message),
    });
    return [];
  }
  return parsed.data.data.children;
}

function mapSubredditResults(children: SubredditSearchChild[]): SubredditSearchResult[] {
  const results: SubredditSearchResult[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    const sub = child.data;
    if (!SUBREDDIT_PATTERN.test(sub.display_name)) continue;
    if (
      sub.subreddit_type &&
      sub.subreddit_type !== 'public' &&
      sub.subreddit_type !== 'restricted'
    ) {
      continue;
    }
    const key = sub.display_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawIcon = sub.community_icon || sub.icon_img || '';
    const iconUrl = rawIcon ? rawIcon.split('?')[0] || null : null;

    results.push({
      name: sub.display_name,
      title: sub.title ?? '',
      description: sub.public_description ?? '',
      subscribers: typeof sub.subscribers === 'number' ? sub.subscribers : 0,
      over18: Boolean(sub.over18 ?? sub.over_18),
      iconUrl,
    });
  }
  return results;
}

export async function searchSubreddits(
  query: string,
  options: { limit?: number; userAgent?: string; includeNsfw?: boolean } = {},
): Promise<SubredditSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
  const userAgent = options.userAgent ?? USER_AGENT;
  const includeNsfw = options.includeNsfw ?? false;

  const autocompleteParams = new URLSearchParams({
    query: trimmed,
    limit: String(limit),
    include_over_18: includeNsfw ? 'true' : 'false',
    include_profiles: 'false',
    typeahead_active: 'true',
  });
  const searchParams = new URLSearchParams({
    q: trimmed,
    limit: String(limit),
    include_over_18: includeNsfw ? 'on' : 'off',
    sort: 'relevance',
  });
  const candidateUrls = [
    `https://www.reddit.com/api/subreddit_autocomplete_v2.json?${autocompleteParams.toString()}`,
    `https://www.reddit.com/subreddits/search.json?${searchParams.toString()}`,
  ];

  let lastError: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const children = await fetchSubredditChildren(url, userAgent, trimmed);
      const mapped = mapSubredditResults(children);
      if (mapped.length > 0) return mapped;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn('Reddit: subreddit search endpoint failed, trying fallback', {
        query: trimmed,
        url,
        error: lastError.message,
      });
    }
  }

  if (lastError) throw lastError;
  return [];
}

const subredditAboutSchema = z.object({
  data: z.object({
    display_name: z.string(),
    subreddit_type: z.string().optional(),
    over18: z.boolean().optional().default(false),
  }),
});

export async function verifySubredditsExist(
  names: string[],
  options: { userAgent?: string; includeNsfw?: boolean } = {},
): Promise<string[]> {
  const userAgent = options.userAgent ?? USER_AGENT;
  const includeNsfw = options.includeNsfw ?? false;
  const verified: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const name = raw.trim();
    if (!SUBREDDIT_PATTERN.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const url = `https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 429) {
        logger.warn('Reddit: about lookup rate limited (HTTP 429)', { subreddit: name });
        verified.push(name);
        continue;
      }
      if (response.status === 404 || response.status === 403) {
        continue;
      }
      if (!response.ok) continue;

      const json = (await response.json()) as unknown;
      const parsed = subredditAboutSchema.safeParse(json);
      if (!parsed.success) continue;
      const sub = parsed.data.data;
      if (
        sub.subreddit_type &&
        sub.subreddit_type !== 'public' &&
        sub.subreddit_type !== 'restricted'
      ) {
        continue;
      }
      if (sub.over18 && !includeNsfw) continue;
      verified.push(sub.display_name);
    } catch (err) {
      logger.warn('Reddit: about lookup failed', {
        subreddit: name,
        error: err instanceof Error ? err.message : String(err),
      });
      verified.push(name);
    }
  }
  return verified;
}

type RedditChild = z.infer<typeof redditChildSchema>;

function mapRedditChildren(
  children: RedditChild[],
  productId: string,
  sinceTs: number,
  fetchedAt: string,
): Item[] {
  const items: Item[] = [];
  for (const child of children) {
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

export async function searchRedditPosts(
  keyword: string,
  productId: string,
  options: { userAgent?: string; sinceTs?: number; limit?: number } = {},
): Promise<Item[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const userAgent = options.userAgent ?? USER_AGENT;
  const sinceTs = options.sinceTs ?? 0;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const params = new URLSearchParams({
    q: `"${trimmed}"`,
    sort: 'new',
    limit: String(limit),
    type: 'link',
  });
  const url = `https://www.reddit.com/search.json?${params.toString()}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status === 429) {
    logger.warn('Reddit: mention search rate limited (HTTP 429)', { keyword: trimmed, productId });
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
    logger.warn('Reddit: failed to parse mention search listing', {
      keyword: trimmed,
      productId,
      errors: parsed.error.issues.map((i) => i.message),
    });
    return [];
  }

  return mapRedditChildren(parsed.data.data.children, productId, sinceTs, new Date().toISOString());
}

export interface RedditReaderOptions {
  subreddits: string[];
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

    return mapRedditChildren(parsed.data.data.children, productId, sinceTs, fetchedAt);
  }
}
