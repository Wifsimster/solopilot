import { z } from 'zod';
import type { Item, SourceOpts, SourceReader } from '../ports.js';
import { logger } from '../logger.js';
import { getProduct, toProductView } from '../product-service.js';

const FETCH_TIMEOUT_MS = 30_000;
const RESULTS_PER_KEYWORD = 25;
const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

const youtubeSearchItemSchema = z.object({
  id: z.object({ videoId: z.string().optional() }),
  snippet: z
    .object({
      title: z.string().default(''),
      description: z.string().default(''),
      channelTitle: z.string().default(''),
      publishedAt: z.string(),
    })
    .optional(),
});

const youtubeSearchSchema = z.object({
  items: z.array(youtubeSearchItemSchema).default([]),
});

export interface YoutubeReaderOptions {
  /** YouTube Data API v3 key. */
  apiKey: string;
}

/**
 * Veille source reader for YouTube via the Data API v3 `search.list` endpoint
 * (official API, free quota tier — no scraping). One search per configured
 * keyword, deduped by video id; `sinceTs` maps to `publishedAfter`.
 */
export function createYoutubeReader(options: YoutubeReaderOptions): SourceReader {
  const { apiKey } = options;

  return {
    source: 'youtube',
    fetchSince: (productId, sinceTs, opts) => fetchAllKeywords(productId, sinceTs, opts),
  };

  async function fetchAllKeywords(
    productId: string,
    sinceTs: number,
    _opts: SourceOpts,
  ): Promise<Item[]> {
    const record = getProduct(productId);
    if (!record) {
      logger.info('YouTube: product not found', { productId });
      return [];
    }
    const product = toProductView(record);
    const keywords = product.youtube_keywords;
    if (!keywords || keywords.length === 0) {
      logger.info('YouTube: no keywords configured for product', { productId });
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const dedup = new Map<string, Item>();

    for (const keyword of keywords) {
      try {
        // Sequential by design: paced per-keyword calls to stay within the
        // Data API's default quota (search.list costs 100 units per call).
        const items = await fetchKeyword(keyword, productId, sinceTs, fetchedAt);
        for (const item of items) {
          if (!dedup.has(item.id)) dedup.set(item.id, item);
        }
      } catch (err) {
        logger.warn('YouTube: keyword fetch failed', {
          keyword,
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const items = Array.from(dedup.values());
    logger.info('YouTube: fetched items', {
      productId,
      count: items.length,
      keywords: keywords.length,
    });
    return items;
  }

  async function fetchKeyword(
    keyword: string,
    productId: string,
    sinceTs: number,
    fetchedAt: string,
  ): Promise<Item[]> {
    const params = new URLSearchParams({
      part: 'snippet',
      q: keyword,
      type: 'video',
      order: 'date',
      maxResults: String(RESULTS_PER_KEYWORD),
      key: apiKey,
    });
    if (sinceTs > 0) {
      params.set('publishedAfter', new Date(sinceTs * 1000).toISOString());
    }

    const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('YouTube: HTTP error', {
        keyword,
        productId,
        status: response.status,
        statusText: response.statusText,
        body: body ? body.slice(0, 200) : undefined,
      });
      return [];
    }

    const json = (await response.json()) as unknown;
    const parsed = youtubeSearchSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn('YouTube: failed to parse search response', {
        keyword,
        productId,
        errors: parsed.error.issues.map((i) => i.message),
      });
      return [];
    }

    const items: Item[] = [];
    for (const hit of parsed.data.items) {
      const videoId = hit.id.videoId;
      const snippet = hit.snippet;
      if (!videoId || !snippet || !snippet.title) continue;

      const text = snippet.description
        ? `${snippet.title}\n\n${snippet.description}`
        : snippet.title;

      items.push({
        id: `youtube:${videoId}`,
        source: 'youtube',
        text,
        author: snippet.channelTitle ? `youtube:${snippet.channelTitle}` : 'youtube:unknown',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        createdAt: snippet.publishedAt,
        fetchedAt,
        productId,
        urls: [],
      });
    }
    return items;
  }
}
