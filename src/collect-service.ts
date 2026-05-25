import type { Config } from './config.js';
import { logger } from './logger.js';
import { createXClient } from './x-client.js';
import { storeTweets } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { DEFAULT_PRODUCT_ID } from './db.js';

/**
 * Hourly collection: scrapes the timeline and stores tweets in the DB.
 * No AI call, no summary — just data accumulation with deduplication.
 */
export async function collectTweets(
  config: Config,
  productId: string = DEFAULT_PRODUCT_ID,
): Promise<{ fetched: number; newTweets: number }> {
  const collectionDate = getTodayDateParis();
  logger.info('Starting tweet collection', {
    username: config.X_USERNAME,
    collectionDate,
    productId,
  });

  const xClient = createXClient(config);
  const tweets = await xClient.fetchRecentTweets();

  if (tweets.length === 0) {
    logger.info('No tweets found during collection', { productId });
    return { fetched: 0, newTweets: 0 };
  }

  const newTweets = storeTweets(tweets, collectionDate, productId);

  logger.info('Tweet collection complete', {
    fetched: tweets.length,
    newTweets,
    collectionDate,
    productId,
  });

  return { fetched: tweets.length, newTweets };
}
