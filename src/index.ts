import { loadConfig, type Config } from './config.js';
import { logger } from './logger.js';
import { createAIFilter } from './ai-filter.js';
import { getCurrentRunId, updateRunStats, collectRunning } from './run-state.js';
import { getUnpublishedTweets, markTweetsAsUsed } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { DEFAULT_PRODUCT_ID } from './db.js';
import { collectTweets } from './collect-service.js';
import { getProduct, toProductView } from './product-service.js';

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

  if (!overrideCollectionDate) {
    if (collectRunning.get(productId) === true) {
      logger.info('Collect already running, skipping in-publish sweep', { productId });
    } else {
      collectRunning.set(productId, true);
      try {
        await collectTweets(config, productId);
      } catch (err) {
        logger.warn('Final collection sweep failed before publish', {
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        collectRunning.set(productId, false);
      }
    }
  }

  const items = overrideCollectionDate
    ? getUnpublishedTweets(productId, { collectionDate })
    : getUnpublishedTweets(productId);
  if (runId) updateRunStats(runId, { tweets_fetched: items.length });

  if (items.length === 0) {
    logger.warn('No items found in accumulated collection', { productId });
    return;
  }

  logger.info('Items accumulated for summary', { count: items.length, productId });

  const maxItems = config.VEILLE_DIGEST_MAX_ITEMS;
  const itemsForSummary = items.length > maxItems ? items.slice(-maxItems) : items;
  if (items.length > maxItems) {
    logger.warn('Digest backlog exceeds cap — summarizing newest items, draining the rest', {
      productId,
      total: items.length,
      summarized: itemsForSummary.length,
      dropped: items.length - itemsForSummary.length,
    });
  }

  const productRecord = getProduct(productId);
  const product = productRecord ? toProductView(productRecord) : undefined;

  const aiFilter = createAIFilter(config);
  const summary = await aiFilter.filterAndSummarize(itemsForSummary, { product });
  if (runId && summary) updateRunStats(runId, { summary });

  if (!summary) {
    logger.info('No AI news found — skipping', { productId });
    if (runId)
      markTweetsAsUsed(
        items.map((t) => t.id),
        runId,
      );
    return;
  }

  if (runId)
    markTweetsAsUsed(
      items.map((t) => t.id),
      runId,
    );

  logger.info('Summary generated', { length: summary.length, productId });
}

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
