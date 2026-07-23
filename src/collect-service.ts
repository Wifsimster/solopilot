import type { Config } from './config.js';
import { logger } from './logger.js';
import { createXClient } from './x-client.js';
import { createRedditReader, searchRedditPosts } from './adapters/reddit-reader.js';
import { createHnReader } from './adapters/hn-reader.js';
import { createYoutubeReader } from './adapters/youtube-reader.js';
import type { Item } from './ports.js';
import { storeItems } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { DEFAULT_PRODUCT_ID } from './db.js';
import { getProduct, toProductView } from './product-service.js';
import { matchIntentForProduct } from './intent-service.js';
import { triageNewItems } from './ai-triage.js';
import { sendPendingAlerts } from './alert-service.js';
import { createLeadsFromMentions } from './modules/crm/lead-from-mention.js';

export interface CollectResult {
  fetched: number;
  newTweets: number;
  bySource: Record<string, { fetched: number; new: number }>;
  intentSignals: number;
  triaged: number;
  alerted: number;
  crmLeads: number;
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
    youtubeEnabled: product?.youtube_enabled ?? false,
    youtubeKeywords: product?.youtube_keywords?.length ?? 0,
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
      const redditReader = createRedditReader({
        subreddits: redditSubreddits,
        auth: {
          clientId: config.REDDIT_CLIENT_ID,
          clientSecret: config.REDDIT_CLIENT_SECRET,
        },
      });
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

  const youtubeEnabled = product?.youtube_enabled ?? false;
  const youtubeKeywords = product?.youtube_keywords ?? [];
  const youtubeConfigured = !!config.YOUTUBE_API_KEY;
  if (youtubeEnabled && youtubeKeywords.length > 0 && youtubeConfigured) {
    try {
      const youtubeReader = createYoutubeReader({ apiKey: config.YOUTUBE_API_KEY! });
      const items = await youtubeReader.fetchSince(productId, 0, { productId });
      const stored =
        items.length > 0
          ? storeItems(items, collectionDate, productId)
          : { inserted: 0, insertedIds: [] };
      bySource.youtube = { fetched: items.length, new: stored.inserted };
      totalFetched += items.length;
      totalNew += stored.inserted;
      allNewItemIds.push(...stored.insertedIds);
    } catch (err) {
      logger.error('YouTube collection failed', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      bySource.youtube = { fetched: 0, new: 0 };
    }
  } else if (youtubeEnabled && !youtubeConfigured) {
    logger.info('YouTube enabled but YOUTUBE_API_KEY missing — skipping', { productId });
  }

  // Brand-mention pass (Stalkr-style): sitewide keyword search on Reddit, HN
  // and YouTube for the product's mention keywords (name, aliases, competitors,
  // founder…). Stored with origin='mention' so the digest never filters them
  // out as "not news". An item caught by both passes keeps origin='topic'
  // (INSERT OR IGNORE, topic passes run first). X is not searched: the session
  // scraper only reads the timeline. Zero behaviour change when the list is empty.
  const mentionKeywords = product?.mention_keywords ?? [];
  if (mentionKeywords.length > 0) {
    const mentionItems = new Map<string, Item>();
    for (const keyword of mentionKeywords) {
      try {
        // Sequential by design: Reddit 429s under concurrent load.
        const found = await searchRedditPosts(keyword, productId, {
          auth: {
            clientId: config.REDDIT_CLIENT_ID,
            clientSecret: config.REDDIT_CLIENT_SECRET,
          },
        });
        for (const item of found) if (!mentionItems.has(item.id)) mentionItems.set(item.id, item);
      } catch (err) {
        logger.warn('Mention search failed on Reddit', {
          productId,
          keyword,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      const hnMentionReader = createHnReader({ keywords: mentionKeywords });
      const found = await hnMentionReader.fetchSince(productId, 0, { productId });
      for (const item of found) if (!mentionItems.has(item.id)) mentionItems.set(item.id, item);
    } catch (err) {
      logger.warn('Mention search failed on Hacker News', {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (config.YOUTUBE_API_KEY) {
      try {
        const ytMentionReader = createYoutubeReader({
          apiKey: config.YOUTUBE_API_KEY,
          keywords: mentionKeywords,
        });
        const found = await ytMentionReader.fetchSince(productId, 0, { productId });
        for (const item of found) if (!mentionItems.has(item.id)) mentionItems.set(item.id, item);
      } catch (err) {
        logger.warn('Mention search failed on YouTube', {
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const items = Array.from(mentionItems.values());
    const stored =
      items.length > 0
        ? storeItems(items, collectionDate, productId, 'mention')
        : { inserted: 0, insertedIds: [] };
    bySource.mentions = { fetched: items.length, new: stored.inserted };
    totalFetched += items.length;
    totalNew += stored.inserted;
    allNewItemIds.push(...stored.insertedIds);
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

  // Alerts run every collect (not only when new items arrived) so items left
  // pending by an earlier failed webhook call are retried within the hour.
  let alerted = 0;
  try {
    const result = await sendPendingAlerts(config, productId);
    alerted = result.alerted;
  } catch (err) {
    logger.warn('Urgency alerting failed', {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Like alerts, the CRM bridge sweeps every collect so items skipped by an
  // earlier failure are retried; crm_bridged_at keeps it idempotent.
  let crmLeads = 0;
  try {
    const result = await createLeadsFromMentions(config, productId);
    crmLeads = result.leads;
  } catch (err) {
    logger.warn('CRM lead bridging failed', {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Item collection complete', {
    productId,
    collectionDate,
    totalFetched,
    totalNew,
    bySource,
    intentSignals,
    triaged,
    alerted,
    crmLeads,
  });

  return {
    fetched: totalFetched,
    newTweets: totalNew,
    bySource,
    intentSignals,
    triaged,
    alerted,
    crmLeads,
  };
}
