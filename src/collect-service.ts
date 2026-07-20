import type { Config } from './config.js';
import { logger } from './logger.js';
import { createXClient } from './x-client.js';
import { createRedditReader } from './adapters/reddit-reader.js';
import { createHnReader } from './adapters/hn-reader.js';
import { storeItems } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { DEFAULT_PRODUCT_ID } from './db.js';
import { getProduct, toProductView } from './product-service.js';
import { matchIntentForProduct } from './intent-service.js';
import { triageNewItems } from './ai-triage.js';

export interface CollectResult {
  fetched: number;
  newTweets: number;
  bySource: Record<string, { fetched: number; new: number }>;
  intentSignals: number;
  triaged: number;
}

/**
 * Hourly collection: runs all enabled sources for a product and stores items.
 * No AI call, no summary — just data accumulation with deduplication.
 * Failure of one source does not abort the others.
 */
export async function collectTweets(
  config: Config,
  productId: string = DEFAULT_PRODUCT_ID,
): Promise<CollectResult> {
  const collectionDate = getTodayDateParis();
  const productRecord = getProduct(productId);
  const product = productRecord ? toProductView(productRecord) : null;

  logger.info('Starting item collection', {
    productId,
    collectionDate,
    xEnabled: product?.x_enabled ?? true,
    redditEnabled: product?.reddit_enabled ?? false,
    redditSubreddits: product?.reddit_subreddits?.length ?? 0,
    hnEnabled: product?.hn_enabled ?? false,
    hnKeywords: product?.hn_keywords?.length ?? 0,
  });

  const bySource: Record<string, { fetched: number; new: number }> = {};
  let totalFetched = 0;
  let totalNew = 0;
  const allNewItemIds: string[] = [];

  const xEnabled = product?.x_enabled ?? true;
  const xConfigured = !!config.X_SESSION_AUTH_TOKEN && !!config.X_SESSION_CSRF_TOKEN;
  if (xEnabled && xConfigured) {
    try {
      const xClient = createXClient(config);
      const items = await xClient.fetchSince(productId, 0, { productId });
      const stored =
        items.length > 0
          ? storeItems(items, collectionDate, productId)
          : { inserted: 0, insertedIds: [] };
      bySource.x = { fetched: items.length, new: stored.inserted };
      totalFetched += items.length;
      totalNew += stored.inserted;
      allNewItemIds.push(...stored.insertedIds);
    } catch (err) {
      logger.error('X collection failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      bySource.x = { fetched: 0, new: 0 };
    }
  } else if (xEnabled && !xConfigured) {
    logger.info('X enabled but session cookies missing — skipping', { productId });
  }

  const redditEnabled = product?.reddit_enabled ?? false;
  const redditSubreddits = product?.reddit_subreddits ?? [];
  if (redditEnabled && redditSubreddits.length > 0) {
    try {
      const redditReader = createRedditReader({ subreddits: redditSubreddits });
      const items = await redditReader.fetchSince(productId, 0, { productId });
      const stored =
        items.length > 0
          ? storeItems(items, collectionDate, productId)
          : { inserted: 0, insertedIds: [] };
      bySource.reddit = { fetched: items.length, new: stored.inserted };
      totalFetched += items.length;
      totalNew += stored.inserted;
      allNewItemIds.push(...stored.insertedIds);
    } catch (err) {
      logger.error('Reddit collection failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      bySource.reddit = { fetched: 0, new: 0 };
    }
  }

  const hnEnabled = product?.hn_enabled ?? false;
  const hnKeywords = product?.hn_keywords ?? [];
  if (hnEnabled && hnKeywords.length > 0) {
    try {
      const hnReader = createHnReader();
      const items = await hnReader.fetchSince(productId, 0, { productId });
      const stored =
        items.length > 0
          ? storeItems(items, collectionDate, productId)
          : { inserted: 0, insertedIds: [] };
      bySource.hn = { fetched: items.length, new: stored.inserted };
      totalFetched += items.length;
      totalNew += stored.inserted;
      allNewItemIds.push(...stored.insertedIds);
    } catch (err) {
      logger.error('Hacker News collection failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      bySource.hn = { fetched: 0, new: 0 };
    }
  }

  let intentSignals = 0;
  if (allNewItemIds.length > 0) {
    try {
      const result = matchIntentForProduct(productId, allNewItemIds);
      intentSignals = result.matched;
    } catch (err) {
      logger.warn('Intent matching failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let triaged = 0;
  if (allNewItemIds.length > 0) {
    try {
      const result = await triageNewItems(config, productId, allNewItemIds);
      triaged = result.triaged;
    } catch (err) {
      logger.warn('Item triage failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Item collection complete', {
    productId,
    collectionDate,
    totalFetched,
    totalNew,
    bySource,
    intentSignals,
    triaged,
  });

  return { fetched: totalFetched, newTweets: totalNew, bySource, intentSignals, triaged };
}
