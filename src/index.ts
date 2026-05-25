import { loadConfig, type Config } from './config.js';
import { logger } from './logger.js';
import { createXClient } from './x-client.js';
import { createAIFilter } from './ai-filter.js';
import { getCurrentRunId, updateRunStats } from './run-service.js';
import { getUnpublishedTweets, markTweetsAsUsed, storeTweets } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { DEFAULT_PRODUCT_ID } from './db.js';

export async function run(
  config: Config,
  overrideCollectionDate?: string,
  productId: string = DEFAULT_PRODUCT_ID,
) {
  const collectionDate = overrideCollectionDate ?? getTodayDateParis();

  logger.info('Starting daily summary (publish)', {
    username: config.X_USERNAME,
    collectionDate,
    productId,
  });

  const runId = getCurrentRunId(productId);

  // 1. Do a final collection sweep before summarizing (skip for historical re-runs)
  if (!overrideCollectionDate) {
    const xClient = createXClient(config);
    const liveTweets = await xClient.fetchRecentTweets();
    if (liveTweets.length > 0) {
      storeTweets(liveTweets, collectionDate, productId);
    }
  }

  // 2. Read all accumulated tweets for today
  const tweets = getUnpublishedTweets(collectionDate, productId);
  if (runId) updateRunStats(runId, { tweets_fetched: tweets.length });

  if (tweets.length === 0) {
    logger.warn('No tweets found in accumulated collection', { productId });
    return;
  }

  logger.info('Tweets accumulated for summary', { count: tweets.length, productId });

  // 3. Filter and summarize AI news
  const aiFilter = createAIFilter(config);
  const summary = await aiFilter.filterAndSummarize(tweets);
  if (runId && summary) updateRunStats(runId, { summary });

  if (!summary) {
    logger.info('No AI news found — skipping', { productId });
    if (runId) markTweetsAsUsed(tweets.map((t) => t.id), runId);
    return;
  }

  // 4. Mark tweets as consumed by this run
  if (runId) markTweetsAsUsed(tweets.map((t) => t.id), runId);

  logger.info('Summary generated', { length: summary.length, productId });
}

// One-shot mode when run directly
const isDirectRun = process.argv[1]?.endsWith('index.js');
if (isDirectRun) {
  const config = loadConfig();
  const productId = process.argv[2] || DEFAULT_PRODUCT_ID;
  run(config, undefined, productId).catch((err) => {
    logger.error('Fatal error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  });
}
