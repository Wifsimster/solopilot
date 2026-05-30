import { z } from 'zod';
import type { Item, SourceOpts, SourceReader } from '../ports.js';
import { logger } from '../logger.js';
import { getProduct, toProductView } from '../product-service.js';

const USER_AGENT = 'x-ai-weekly-bot/1.0';
const FETCH_TIMEOUT_MS = 30_000;
const HITS_PER_PAGE = 50;

const hnHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable().optional(),
  story_text: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  created_at_i: z.number(),
});

const hnSearchSchema = z.object({
  hits: z.array(hnHitSchema).default([]),
});

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&apos;': "'",
  '&#x2F;': '/',
  '&nbsp;': ' ',
};

function sanitizeStoryText(input: string): string {
  let out = input.replace(/<\/?p>/gi, '\n\n');
  out = out.replace(/<[^>]+>/g, '');
  out = out.replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&apos;|&#x2F;|&nbsp;/g, (m) => HTML_ENTITIES[m] ?? m);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

export interface HnReaderOptions {
  userAgent?: string;
}

export function createHnReader(options: HnReaderOptions = {}): SourceReader {
  const userAgent = options.userAgent ?? USER_AGENT;

  return {
    source: 'hn',
    fetchSince: (productId, sinceTs, opts) => fetchAllKeywords(productId, sinceTs, opts),
  };

  async function fetchAllKeywords(
    productId: string,
    sinceTs: number,
    _opts: SourceOpts,
  ): Promise<Item[]> {
    const record = getProduct(productId);
    if (!record) {
      logger.info('Hacker News: product not found', { productId });
      return [];
    }
    const product = toProductView(record);
    const keywords = product.hn_keywords;
    if (!keywords || keywords.length === 0) {
      logger.info('Hacker News: no keywords configured for product', { productId });
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const dedup = new Map<string, Item>();

    for (const keyword of keywords) {
      try {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: paced per-keyword calls against the public HN API to stay within rate limits
        const items = await fetchKeyword(keyword, productId, sinceTs, fetchedAt);
        for (const item of items) {
          if (!dedup.has(item.id)) dedup.set(item.id, item);
        }
      } catch (err) {
        logger.warn('Hacker News: keyword fetch failed', {
          keyword,
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const items = Array.from(dedup.values());
    logger.info('Hacker News: fetched items', {
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
    const numericFilter = sinceTs > 0 ? `&numericFilters=created_at_i>${sinceTs}` : '';
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}&tags=story${numericFilter}&hitsPerPage=${HITS_PER_PAGE}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('Hacker News: HTTP error', {
        keyword,
        productId,
        status: response.status,
        statusText: response.statusText,
        body: body ? body.slice(0, 200) : undefined,
      });
      return [];
    }

    const json = (await response.json()) as unknown;
    const parsed = hnSearchSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn('Hacker News: failed to parse search response', {
        keyword,
        productId,
        errors: parsed.error.issues.map((i) => i.message),
      });
      return [];
    }

    const items: Item[] = [];
    for (const hit of parsed.data.hits) {
      if (sinceTs > 0 && hit.created_at_i < sinceTs) continue;

      const title = hit.title ?? '';
      if (!title && !hit.story_text) continue;
      const storyText = hit.story_text ? sanitizeStoryText(hit.story_text) : '';
      const text = storyText ? `${title}\n\n${storyText}` : title;
      const author = hit.author ?? 'unknown';
      const itemUrl =
        hit.url && hit.url.length > 0
          ? hit.url
          : `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const externalUrls =
        // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- String.includes() substring test on a URL, not an array membership lookup
        hit.url && hit.url.length > 0 && !hit.url.includes('news.ycombinator.com')
          ? [hit.url]
          : [];

      items.push({
        id: `hn:${hit.objectID}`,
        source: 'hn',
        text,
        author: `hn:${author}`,
        url: itemUrl,
        createdAt: new Date(hit.created_at_i * 1000).toISOString(),
        fetchedAt,
        productId,
        urls: externalUrls,
      });
    }
    return items;
  }
}
