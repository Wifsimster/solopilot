import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { z } from 'zod';
import { logger } from './logger.js';
import {
  getRunHistory,
  getLastRun,
  isRunning,
  isCollecting,
  triggerRun,
  triggerCollect,
  getSuccessfulSummaries,
  countSuccessfulSummaries,
  getSuccessfulRunsByMonth,
  getRunById,
  updateNotificationStatus,
  deleteSummary,
  triggerRerun,
  countRuns,
} from './run-service.js';
import {
  generateMonthlySummary,
  getMonthlySummary,
  listMonthlySummaries,
  getAvailableMonths,
} from './monthly-summary-service.js';
import {
  getSettings,
  setSetting,
  deleteSetting,
  isEditableKey,
  isCredentialKey,
  getSettingsMap,
  getSetting,
  maskCredential,
  getProductSettings,
  setProductSetting,
  getProductSettingsMap,
} from './settings-service.js';
import { REQUIRED_CREDENTIALS, type Config } from './config.js';
import { countUnpublishedTweets, countTweetsForDate, getTweetsByRunId } from './tweet-store.js';
import { getTodayDateParis } from './date-utils.js';
import { validateXCookies, detectGqlIds, DEFAULT_GQL_IDS } from './adapters/scraper-reader.js';
import { searchSubreddits } from './adapters/reddit-reader.js';
import { testDiscordWebhook, sendDiscordNotification } from './adapters/discord-notifier.js';
import {
  reschedule,
  rescheduleCollect,
  getCurrentSchedule,
  getCollectSchedule,
} from './cron-manager.js';
import { buildMergedConfig } from './config-merge.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  archiveProduct,
  deleteProductHard,
  productCreateSchema,
  productUpdateSchema,
  toProductView,
  type ProductView,
} from './product-service.js';
import { DEFAULT_PRODUCT_ID } from './db.js';
import {
  listIntentSignals,
  getIntentSignal,
  updateIntentSignal,
  analyzeIntentSignal,
  generateRepliesOnly,
  listRepliesForSignal,
  getReply,
  updateReplyUsedFlag,
  rematchIntentForProductAll,
  IntentSignalNotFoundError,
  IntentReplyGenerationError,
  intentSignalListQuerySchema,
  intentSignalPatchSchema,
  generateRepliesSchema,
  intentReplyPatchSchema,
} from './intent-service.js';
import {
  generatePosts,
  listContentDrafts,
  getContentDraft,
  updateContentDraft,
  deleteContentDraft,
  toContentDraftView,
  generatePostsSchema,
  contentDraftListQuerySchema,
  contentDraftPatchSchema,
  ContentStudioError,
  suggestTargetAudience,
  suggestAudienceSchema,
  suggestCallToActions,
  suggestCtasSchema,
  suggestProductDescription,
  suggestDescriptionSchema,
  suggestValueProps,
  suggestValuePropsSchema,
  suggestSubreddits,
  suggestSubredditsSchema,
  suggestHnKeywords,
  suggestHnKeywordsSchema,
} from './content-studio.js';
import {
  fetchGithubRepos,
  bulkImportProducts,
  bulkImportRequestSchema,
  GithubImportError,
} from './github-import.js';

interface MissingCredential {
  key: string;
  label: string;
  docUrl: string;
  message: string;
}

function buildCredentialInfo(config: Config) {
  const authToken = getSetting('X_SESSION_AUTH_TOKEN') ?? config.X_SESSION_AUTH_TOKEN ?? '';
  const csrfToken = getSetting('X_SESSION_CSRF_TOKEN') ?? config.X_SESSION_CSRF_TOKEN ?? '';
  const discordWebhook = getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL ?? '';
  return {
    authTokenMasked: authToken ? maskCredential(authToken) : '',
    csrfTokenMasked: csrfToken ? maskCredential(csrfToken) : '',
    discordWebhookMasked: discordWebhook ? maskCredential(discordWebhook) : '',
    hasAuth: !!process.env.ADMIN_PASSWORD,
  };
}

function buildEnvDefaults(config: Config, cronSchedule: string) {
  const activeCron = getCurrentSchedule() || getSetting('CRON_SCHEDULE') || cronSchedule;
  const activeCollectCron =
    getCollectSchedule() || getSetting('COLLECT_CRON_SCHEDULE') || config.COLLECT_CRON_SCHEDULE;
  return {
    AI_MODEL: config.AI_MODEL,
    TWEETS_LOOKBACK_DAYS: String(config.TWEETS_LOOKBACK_DAYS),
    DRY_RUN: String(config.DRY_RUN),
    CRON_SCHEDULE: activeCron,
    COLLECT_CRON_SCHEDULE: activeCollectCron,
    X_GQL_USER_BY_SCREEN_NAME_ID:
      config.X_GQL_USER_BY_SCREEN_NAME_ID || DEFAULT_GQL_IDS.UserByScreenName,
    X_GQL_HOME_TIMELINE_ID: config.X_GQL_HOME_TIMELINE_ID || DEFAULT_GQL_IDS.HomeLatestTimeline,
  };
}

function resolveProductId(queryValue: string | undefined): string {
  if (queryValue && queryValue.trim()) return queryValue.trim();
  return DEFAULT_PRODUCT_ID;
}

function sameKeywordSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = a.toSorted();
  const sortedB = b.toSorted();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

function maskProduct(product: import('./db.js').ProductRecord): ProductView {
  const view = toProductView(product);
  return {
    ...view,
    discord_webhook: view.discord_webhook ? maskCredential(view.discord_webhook) : null,
  };
}

function buildProductConfig(baseConfig: Config, productId: string): Config {
  const overrides: Record<string, string> = {
    ...getSettingsMap(),
    ...getProductSettingsMap(productId),
  };
  return buildMergedConfig(baseConfig, overrides);
}

export function startServer(
  config: Config | null,
  missingCredentials: MissingCredential[] | null,
  cronSchedule: string,
  port = 3000,
) {
  const app = new Hono();
  const isConfigured = config !== null;

  if (process.env.ADMIN_PASSWORD) {
    app.use(
      '*',
      basicAuth({
        username: 'admin',
        password: process.env.ADMIN_PASSWORD,
      }),
    );
  }

  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    if (c.req.path === '/healthz') {
      return next();
    }
    const origin = c.req.header('origin');
    const referer = c.req.header('referer');
    if (origin) {
      const requestHost = c.req.header('host');
      try {
        const originHost = new URL(origin).host;
        if (originHost !== requestHost) {
          logger.warn('CSRF: Origin mismatch', { origin, host: requestHost });
          return c.json({ success: false, message: 'Forbidden: origin mismatch' }, 403);
        }
      } catch {
        return c.json({ success: false, message: 'Forbidden: invalid origin' }, 403);
      }
    } else if (referer) {
      const requestHost = c.req.header('host');
      try {
        const refererHost = new URL(referer).host;
        if (refererHost !== requestHost) {
          logger.warn('CSRF: Referer mismatch', { referer, host: requestHost });
          return c.json({ success: false, message: 'Forbidden: referer mismatch' }, 403);
        }
      } catch {
        return c.json({ success: false, message: 'Forbidden: invalid referer' }, 403);
      }
    }
    return next();
  });

  app.get('/healthz', (c) => {
    if (isConfigured) {
      return c.json({ status: 'ok' });
    }
    return c.json(
      {
        status: 'unconfigured',
        missing: (missingCredentials || []).map((m) => m.key),
      },
      503,
    );
  });

  app.get('/api/version', (c) => {
    return c.json({
      version: process.env.APP_VERSION || 'dev',
      buildDate: process.env.APP_BUILD_DATE || null,
    });
  });

  app.get('/api/setup', (c) => {
    const credentials = REQUIRED_CREDENTIALS.map((cred) => ({
      ...cred,
      configured: !!process.env[cred.key] || !!getSetting(cred.key),
    }));
    return c.json({ configured: isConfigured, credentials });
  });

  // --- Products API (available in both setup and operational mode) ---

  app.get('/api/products', (c) => {
    const includeArchived = c.req.query('includeArchived') === 'true';
    const products = listProducts(includeArchived).map(maskProduct);
    return c.json(products);
  });

  app.post('/api/products', async (c) => {
    const body = await c.req.json();
    const parsed = productCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de produit invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    if (getProduct(parsed.data.id)) {
      return c.json(
        { success: false, message: 'Un produit avec cet identifiant existe deja.' },
        409,
      );
    }
    const product = createProduct(parsed.data);
    return c.json({ success: true, product: maskProduct(product) });
  });

  app.get('/api/products/:id', (c) => {
    const id = c.req.param('id');
    const product = getProduct(id);
    if (!product) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    return c.json(maskProduct(product));
  });

  app.put('/api/products/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getProduct(id);
    if (!existing) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    const body = await c.req.json();
    const parsed = productUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de produit invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const effectiveXEnabled =
      parsed.data.x_enabled !== undefined ? parsed.data.x_enabled : existing.x_enabled === 1;
    const effectiveRedditEnabled =
      parsed.data.reddit_enabled !== undefined
        ? parsed.data.reddit_enabled
        : existing.reddit_enabled === 1;
    const effectiveHnEnabled =
      parsed.data.hn_enabled !== undefined ? parsed.data.hn_enabled : existing.hn_enabled === 1;
    if (!effectiveXEnabled && !effectiveRedditEnabled && !effectiveHnEnabled) {
      return c.json(
        { success: false, message: 'Active au moins une source (X, Reddit ou Hacker News).' },
        400,
      );
    }
    if (parsed.data.reddit_enabled === true || parsed.data.reddit_subreddits !== undefined) {
      const existingSubs = toProductView(existing).reddit_subreddits;
      const effectiveSubs =
        parsed.data.reddit_subreddits !== undefined
          ? (parsed.data.reddit_subreddits ?? [])
          : existingSubs;
      if (effectiveRedditEnabled && effectiveSubs.length === 0) {
        return c.json(
          {
            success: false,
            message: 'Au moins un subreddit est requis quand Reddit est active.',
          },
          400,
        );
      }
    }
    if (parsed.data.hn_enabled === true || parsed.data.hn_keywords !== undefined) {
      const existingKeywords = toProductView(existing).hn_keywords;
      const effectiveKeywords =
        parsed.data.hn_keywords !== undefined ? (parsed.data.hn_keywords ?? []) : existingKeywords;
      if (effectiveHnEnabled && effectiveKeywords.length === 0) {
        return c.json(
          {
            success: false,
            message: 'Au moins un mot-cle est requis quand Hacker News est active.',
          },
          400,
        );
      }
    }
    const existingView = toProductView(existing);
    const previousIntentKeywords = existingView.intent_keywords;
    const previousIntentEnabled = existingView.intent_enabled;

    const updated = updateProduct(id, parsed.data);

    let rematchScheduled = false;
    if (updated) {
      const updatedView = toProductView(updated);
      const keywordsChanged = !sameKeywordSet(previousIntentKeywords, updatedView.intent_keywords);
      const enabledFlippedOn =
        !previousIntentEnabled &&
        updatedView.intent_enabled &&
        updatedView.intent_keywords.length > 0;

      if (
        updatedView.intent_enabled &&
        updatedView.intent_keywords.length > 0 &&
        (keywordsChanged || enabledFlippedOn)
      ) {
        rematchScheduled = true;
        setImmediate(() => {
          try {
            const result = rematchIntentForProductAll(id);
            logger.info('Intent rematch on keyword update', {
              productId: id,
              matched: result.matched,
              scanned: result.scanned,
            });
          } catch (err) {
            logger.warn('Intent rematch failed', {
              productId: id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }
    }

    return c.json({
      success: true,
      product: updated ? maskProduct(updated) : null,
      rematchScheduled,
    });
  });

  app.delete('/api/products/:id', (c) => {
    const id = c.req.param('id');
    const hard = c.req.query('hard') === 'true';
    if (id === DEFAULT_PRODUCT_ID) {
      return c.json(
        { success: false, message: 'Le produit par defaut ne peut pas etre supprime.' },
        400,
      );
    }
    const existing = getProduct(id);
    if (!existing) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    if (hard) {
      const ok = deleteProductHard(id);
      if (!ok) {
        return c.json({ success: false, message: 'Suppression impossible.' }, 400);
      }
      return c.json({ success: true, message: 'Produit supprime definitivement.' });
    }
    const ok = archiveProduct(id);
    if (!ok) {
      return c.json({ success: false, message: 'Produit deja archive.' }, 400);
    }
    return c.json({ success: true, message: 'Produit archive.' });
  });

  app.get('/api/products/:id/settings', (c) => {
    const id = c.req.param('id');
    if (!getProduct(id)) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    const settings = getProductSettings(id).map((s) =>
      isCredentialKey(s.key) && s.value ? { ...s, value: maskCredential(s.value) } : s,
    );
    return c.json(settings);
  });

  app.put('/api/products/:id/settings', async (c) => {
    const id = c.req.param('id');
    if (!getProduct(id)) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    const body = await c.req.json();
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    const value = body.value === null ? null : typeof body.value === 'string' ? body.value : '';
    if (!key) {
      return c.json({ success: false, message: 'La cle est requise.' }, 400);
    }
    setProductSetting(id, key, value);
    return c.json({ success: true, message: 'Parametre du produit mis a jour.' });
  });

  // --- Reddit subreddit search (available in both setup and operational mode) ---

  app.get('/api/reddit/search-subreddits', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) {
      return c.json({ results: [] });
    }
    if (q.length > 64) {
      return c.json(
        { success: false, message: 'La requete est trop longue (max 64 caracteres).' },
        400,
      );
    }
    const rawLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 25) : 8;
    const includeNsfw = c.req.query('includeNsfw') === 'true';
    try {
      const results = await searchSubreddits(q, { limit, includeNsfw });
      return c.json({ results });
    } catch (err) {
      logger.warn('Reddit subreddit search failed', {
        q,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          message: 'Recherche Reddit indisponible. Reessaie plus tard.',
        },
        502,
      );
    }
  });

  // --- Intent signals API (available in both setup and operational mode) ---

  app.get('/api/intent-signals', (c) => {
    const parsed = intentSignalListQuerySchema.safeParse({
      productId: c.req.query('productId'),
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Parametres de requete invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const signals = listIntentSignals(parsed.data);
    return c.json(signals);
  });

  app.patch('/api/intent-signals/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = intentSignalPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de signal invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const updated = updateIntentSignal(id, parsed.data);
    if (!updated) {
      return c.json({ success: false, message: 'Signal introuvable.' }, 404);
    }
    return c.json(updated);
  });

  app.post('/api/intent-signals/:id/analyze', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateRepliesSchema.safeParse(body && typeof body === 'object' ? body : {});
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de generation invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    try {
      const updated = await analyzeIntentSignal(id, { count: parsed.data.count });
      return c.json(updated);
    } catch (err) {
      if (err instanceof IntentSignalNotFoundError) {
        return c.json({ success: false, message: 'Signal introuvable.' }, 404);
      }
      logger.error('Intent signal analysis error', {
        signalId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ success: false, message: "Erreur interne lors de l'analyse." }, 500);
    }
  });

  app.get('/api/intent-signals/:id/replies', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const signal = getIntentSignal(id);
    if (!signal) {
      return c.json({ success: false, message: 'Signal introuvable.' }, 404);
    }
    return c.json(listRepliesForSignal(id));
  });

  app.post('/api/intent-signals/:id/replies/generate', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const signal = getIntentSignal(id);
    if (!signal) {
      return c.json({ success: false, message: 'Signal introuvable.' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateRepliesSchema.safeParse(body && typeof body === 'object' ? body : {});
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de generation invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const count = parsed.data.count ?? 3;
    const productRecord = getProduct(signal.product_id);
    const product = productRecord ? toProductView(productRecord) : null;
    try {
      const replies = await generateRepliesOnly(signal, product, { count });
      return c.json({ success: true, replies });
    } catch (err) {
      const message =
        err instanceof IntentReplyGenerationError
          ? err.message
          : `Echec de la generation : ${err instanceof Error ? err.message : String(err)}`;
      return c.json({ success: false, message });
    }
  });

  app.patch('/api/intent-signal-replies/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = intentReplyPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de variante invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const existing = getReply(id);
    if (!existing) {
      return c.json({ success: false, message: 'Variante introuvable.' }, 404);
    }
    const updated = updateReplyUsedFlag(id, parsed.data.used);
    if (!updated) {
      return c.json({ success: false, message: 'Variante introuvable.' }, 404);
    }
    return c.json(updated);
  });

  // --- Content Studio API (available in both setup and operational mode) ---

  app.post('/api/content/suggest-audience', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestAudienceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const targetAudience = await suggestTargetAudience(parsed.data);
      return c.json({ success: true, target_audience: targetAudience });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('Audience suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/content/suggest-ctas', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestCtasSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const callToActions = await suggestCallToActions(parsed.data);
      return c.json({ success: true, call_to_actions: callToActions });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('CTA suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/content/suggest-description', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestDescriptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const productDescription = await suggestProductDescription(parsed.data);
      return c.json({ success: true, product_description: productDescription });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('Description suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/content/suggest-value-props', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestValuePropsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const valueProps = await suggestValueProps(parsed.data);
      return c.json({ success: true, value_props: valueProps });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('Value props suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/content/suggest-subreddits', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestSubredditsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const subreddits = await suggestSubreddits(parsed.data);
      return c.json({ success: true, subreddits });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('Subreddits suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/content/suggest-hn-keywords', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = suggestHnKeywordsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees invalides pour la suggestion.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    try {
      const keywords = await suggestHnKeywords(parsed.data);
      return c.json({ success: true, keywords });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la suggestion : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('HN keywords suggestion failed', { error: message });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/products/:id/content/generate-posts', async (c) => {
    const id = c.req.param('id');
    const productRecord = getProduct(id);
    if (!productRecord) {
      return c.json({ success: false, message: 'Produit introuvable.' }, 404);
    }
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = generatePostsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de generation invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    const product = toProductView(productRecord);
    if (!product.target_audience || product.value_props.length === 0) {
      return c.json(
        {
          success: false,
          message:
            "Produit non configure pour le Studio. Renseigne l'audience cible et au moins une proposition de valeur dans la fiche produit avant de generer des posts.",
        },
        400,
      );
    }

    try {
      const drafts = await generatePosts(product, parsed.data);
      return c.json({
        success: true,
        drafts: drafts.map(toContentDraftView),
      });
    } catch (err) {
      const message =
        err instanceof ContentStudioError
          ? err.message
          : `Echec de la generation : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('Content studio generation failed', {
        productId: id,
        count: parsed.data.count,
        targetSource: parsed.data.targetSource,
        error: message,
      });
      return c.json({ success: false, message });
    }
  });

  app.get('/api/content-drafts', (c) => {
    const parsed = contentDraftListQuerySchema.safeParse({
      productId: c.req.query('productId'),
      status: c.req.query('status'),
      kind: c.req.query('kind'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Parametres de requete invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const drafts = listContentDrafts(parsed.data);
    return c.json(drafts);
  });

  app.patch('/api/content-drafts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = contentDraftPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Donnees de brouillon invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const existing = getContentDraft(id);
    if (!existing) {
      return c.json({ success: false, message: 'Brouillon introuvable.' }, 404);
    }
    const updated = updateContentDraft(id, parsed.data);
    if (!updated) {
      return c.json({ success: false, message: 'Brouillon introuvable.' }, 404);
    }
    return c.json(toContentDraftView(updated));
  });

  app.delete('/api/content-drafts/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ success: false, message: 'Identifiant invalide.' }, 400);
    }
    const ok = deleteContentDraft(id);
    if (!ok) {
      return c.json({ success: false, message: 'Brouillon introuvable.' }, 404);
    }
    return c.json({ success: true });
  });

  // --- GitHub Import API (available in both setup and operational mode) ---

  const githubImportQuerySchema = z.object({
    username: z.string().trim().min(1, { message: "Nom d'utilisateur GitHub requis." }),
    includeForks: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  });

  app.get('/api/github-import/repos', async (c) => {
    const parsed = githubImportQuerySchema.safeParse({
      username: c.req.query('username') ?? '',
      includeForks: c.req.query('includeForks'),
      includeArchived: c.req.query('includeArchived'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: 'Parametres de requete invalides.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }

    const githubToken =
      (isConfigured ? config.GITHUB_TOKEN : undefined) ||
      getSetting('GITHUB_TOKEN') ||
      process.env.GITHUB_TOKEN ||
      undefined;

    try {
      const repos = await fetchGithubRepos({
        username: parsed.data.username,
        includeForks: parsed.data.includeForks,
        includeArchived: parsed.data.includeArchived,
        githubToken,
      });
      return c.json({ success: true, repos });
    } catch (err) {
      const message =
        err instanceof GithubImportError
          ? err.message
          : `Echec du chargement : ${err instanceof Error ? err.message : String(err)}`;
      logger.warn('GitHub repos fetch failed', {
        username: parsed.data.username,
        error: message,
      });
      return c.json({ success: false, message });
    }
  });

  app.post('/api/github-import/bulk', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ success: false, message: 'Corps de requete invalide.' }, 400);
    }
    const parsed = bulkImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          message: "Donnees d'import invalides.",
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    }
    const result = bulkImportProducts(parsed.data);
    return c.json(result);
  });

  if (!isConfigured) {
    app.post('/api/trigger', (c) =>
      c.json({
        success: false,
        message: "Configuration incomplète. Configurez les variables d'environnement requises.",
      }),
    );
    app.get('/api/status', (c) =>
      c.json({
        running: false,
        configured: false,
        missing: (missingCredentials || []).map((m) => m.key),
        cronSchedule,
        totalRuns: 0,
      }),
    );
    app.get('/api/runs', (c) => c.json([]));
    app.get('/api/settings', (c) => c.json([]));
    app.get('/api/config', (c) =>
      c.json({
        envDefaults: {},
        credentialInfo: {
          authTokenMasked: '',
          csrfTokenMasked: '',
          discordWebhookMasked: '',
          hasAuth: false,
        },
      }),
    );
  } else {
    app.get('/api/status', (c) => {
      const productId = resolveProductId(c.req.query('productId'));
      const lastRun = getLastRun(productId);
      return c.json({
        running: isRunning(productId),
        collecting: isCollecting(productId),
        configured: true,
        lastRun,
        cronSchedule,
        collectCronSchedule: getCollectSchedule() || config.COLLECT_CRON_SCHEDULE,
        totalRuns: countRuns(productId),
        productId,
      });
    });

    app.get('/api/runs', (c) => {
      const limit = Number(c.req.query('limit') || '20');
      const offset = Number(c.req.query('offset') || '0');
      const type = c.req.query('type');
      const productId = resolveProductId(c.req.query('productId'));
      const runs = getRunHistory(limit, offset, productId);
      const total = countRuns(productId);
      if (type) {
        const filtered = runs.filter((r) => r.trigger_type === type);
        return c.json({ runs: filtered, total });
      }
      return c.json({ runs, total });
    });

    app.get('/api/collect-status', (c) => {
      const today = getTodayDateParis();
      const productId = resolveProductId(c.req.query('productId'));
      return c.json({
        collecting: isCollecting(productId),
        today,
        tweetsCollected: countTweetsForDate(today, productId),
        tweetsUnpublished: countUnpublishedTweets(today, productId),
        collectCronSchedule: getCollectSchedule() || config.COLLECT_CRON_SCHEDULE,
        productId,
      });
    });

    app.get('/api/settings', (c) => {
      const settings = getSettings().map((s) =>
        isCredentialKey(s.key) ? { ...s, value: maskCredential(s.value) } : s,
      );
      return c.json(settings);
    });

    app.get('/api/config', (c) => {
      return c.json({
        envDefaults: buildEnvDefaults(config, cronSchedule),
        credentialInfo: buildCredentialInfo(config),
      });
    });

    app.post('/api/settings', async (c) => {
      const body = await c.req.json();
      let updated = 0;

      for (const [key, value] of Object.entries(body)) {
        if (isEditableKey(key) && typeof value === 'string') {
          setSetting(key, value);
          updated++;
        }
      }

      return c.json({
        success: true,
        message: `${updated} paramètre(s) mis à jour. Les changements seront appliqués au prochain run.`,
      });
    });

    app.post('/api/credentials', async (c) => {
      const body = await c.req.json();
      const authToken =
        typeof body.X_SESSION_AUTH_TOKEN === 'string' ? body.X_SESSION_AUTH_TOKEN.trim() : '';
      const csrfToken =
        typeof body.X_SESSION_CSRF_TOKEN === 'string' ? body.X_SESSION_CSRF_TOKEN.trim() : '';

      if (!authToken || !csrfToken) {
        return c.json({
          success: false,
          message: 'Les deux champs (auth_token et ct0) sont requis.',
        });
      }

      const validation = await validateXCookies(
        authToken,
        csrfToken,
        config.X_USERNAME,
        config.X_GQL_USER_BY_SCREEN_NAME_ID,
      );

      if (!validation.valid) {
        return c.json({
          success: false,
          message: `Cookies invalides : ${validation.error}. Vérifiez les valeurs et réessayez.`,
        });
      }

      setSetting('X_SESSION_AUTH_TOKEN', authToken);
      setSetting('X_SESSION_CSRF_TOKEN', csrfToken);

      return c.json({
        success: true,
        message:
          'Cookies de session mis à jour et validés avec succès. Les prochains runs utiliseront ces valeurs.',
      });
    });

    // --- Summaries API ---

    app.get('/api/summaries', (c) => {
      const limit = Number(c.req.query('limit') || '20');
      const offset = Number(c.req.query('offset') || '0');
      const month = c.req.query('month');
      const search = c.req.query('search');
      const productId = resolveProductId(c.req.query('productId'));
      const filters = {
        ...(month && /^\d{4}-\d{2}$/.test(month) ? { month } : {}),
        ...(search && search.trim() ? { search: search.trim() } : {}),
      };
      const hasFilters = Object.keys(filters).length > 0;
      const summaries = getSuccessfulSummaries(
        limit,
        offset,
        hasFilters ? filters : undefined,
        productId,
      );
      const total = countSuccessfulSummaries(hasFilters ? filters : undefined, productId);
      return c.json({ summaries, total });
    });

    app.get('/api/monthly-summaries', (c) => {
      const productId = resolveProductId(c.req.query('productId'));
      const summaries = listMonthlySummaries(12, productId);
      return c.json(summaries);
    });

    app.get('/api/monthly-summaries/available', (c) => {
      const productId = resolveProductId(c.req.query('productId'));
      return c.json(getAvailableMonths(productId));
    });

    app.get('/api/monthly-summaries/:year/:month', (c) => {
      const year = Number(c.req.param('year'));
      const month = Number(c.req.param('month'));
      const productId = resolveProductId(c.req.query('productId'));
      if (!year || !month || month < 1 || month > 12) {
        return c.json({ error: 'Année et mois invalides.' }, 400);
      }
      const summary = getMonthlySummary(year, month, productId);
      if (!summary) {
        const runs = getSuccessfulRunsByMonth(year, month, productId);
        return c.json({ exists: false, availableRuns: runs.length });
      }
      return c.json({ exists: true, summary });
    });

    app.post('/api/monthly-summaries/generate', async (c) => {
      const body = await c.req.json();
      const year = Number(body.year);
      const month = Number(body.month);
      const productId = resolveProductId(
        typeof body.productId === 'string' ? body.productId : c.req.query('productId'),
      );
      if (!year || !month || month < 1 || month > 12) {
        return c.json({ success: false, message: 'Année et mois invalides.' }, 400);
      }
      try {
        const mergedConfig = buildProductConfig(config, productId);
        const summary = await generateMonthlySummary(mergedConfig, year, month, productId);
        return c.json({ success: true, summary });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, message: msg }, 500);
      }
    });

    app.delete('/api/summaries/:id', (c) => {
      const runId = Number(c.req.param('id'));
      if (!runId || runId < 1) {
        return c.json({ success: false, message: 'ID de run invalide.' }, 400);
      }
      const result = deleteSummary(runId);
      return c.json(result, result.success ? 200 : 400);
    });

    app.post('/api/summaries/:id/rerun', async (c) => {
      const runId = Number(c.req.param('id'));
      if (!runId || runId < 1) {
        return c.json({ success: false, message: 'ID de run invalide.' }, 400);
      }

      const targetRun = getRunById(runId);
      const productId = targetRun?.product_id ?? DEFAULT_PRODUCT_ID;
      const mergedConfig = buildProductConfig(config, productId);
      const result = await triggerRerun(mergedConfig, runId);
      return c.json(result, result.success ? 200 : 400);
    });

    app.post('/api/detect-gql-ids', async (c) => {
      try {
        const ids = await detectGqlIds();
        const saved: Record<string, string> = {};
        if (ids.UserByScreenName) {
          setSetting('X_GQL_USER_BY_SCREEN_NAME_ID', ids.UserByScreenName);
          saved.UserByScreenName = ids.UserByScreenName;
        }
        if (ids.HomeLatestTimeline) {
          setSetting('X_GQL_HOME_TIMELINE_ID', ids.HomeLatestTimeline);
          saved.HomeLatestTimeline = ids.HomeLatestTimeline;
        }
        if (Object.keys(saved).length === 0) {
          return c.json({
            success: false,
            message: 'Aucun ID GraphQL trouvé dans les bundles JS de x.com.',
          });
        }
        return c.json({
          success: true,
          message: 'IDs GraphQL détectés et sauvegardés.',
          ids: saved,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, message: `Erreur de détection : ${msg}` });
      }
    });

    // --- Cron schedule hot-reload ---

    app.get('/api/cron-schedule', (c) => {
      const dbSchedule = getSetting('CRON_SCHEDULE');
      const dbCollectSchedule = getSetting('COLLECT_CRON_SCHEDULE');
      const active = getCurrentSchedule() || cronSchedule;
      const activeCollect = getCollectSchedule() || config.COLLECT_CRON_SCHEDULE;
      return c.json({
        active,
        saved: dbSchedule || cronSchedule,
        envDefault: cronSchedule,
        collect: {
          active: activeCollect,
          saved: dbCollectSchedule || config.COLLECT_CRON_SCHEDULE,
          envDefault: config.COLLECT_CRON_SCHEDULE,
        },
      });
    });

    app.post('/api/cron-schedule', async (c) => {
      const body = await c.req.json();
      const schedule = typeof body.schedule === 'string' ? body.schedule.trim() : '';

      if (!schedule) {
        return c.json({ success: false, message: 'La planification cron est requise.' });
      }

      if (!cron.validate(schedule)) {
        return c.json({
          success: false,
          message: `Expression cron invalide : "${schedule}". Format attendu : minute heure jour mois jour-semaine`,
        });
      }

      setSetting('CRON_SCHEDULE', schedule);
      const ok = reschedule(schedule, config, buildMergedConfig);

      if (ok) {
        return c.json({
          success: true,
          message: 'Planification mise a jour et appliquee immediatement.',
        });
      }
      return c.json({
        success: false,
        message: 'Erreur lors de la replanification.',
      });
    });

    app.post('/api/collect-cron-schedule', async (c) => {
      const body = await c.req.json();
      const schedule = typeof body.schedule === 'string' ? body.schedule.trim() : '';

      if (!schedule) {
        return c.json({
          success: false,
          message: 'La planification cron de collecte est requise.',
        });
      }

      if (!cron.validate(schedule)) {
        return c.json({
          success: false,
          message: `Expression cron invalide : "${schedule}". Format attendu : minute heure jour mois jour-semaine`,
        });
      }

      setSetting('COLLECT_CRON_SCHEDULE', schedule);
      const ok = rescheduleCollect(schedule, config, buildMergedConfig);

      if (ok) {
        return c.json({
          success: true,
          message: 'Planification de collecte mise a jour et appliquee immediatement.',
        });
      }
      return c.json({
        success: false,
        message: 'Erreur lors de la replanification de collecte.',
      });
    });

    app.post('/api/trigger', async (c) => {
      const productId = resolveProductId(c.req.query('productId'));
      if (isRunning(productId)) {
        return c.json({ success: false, message: 'Un run est déjà en cours.' });
      }

      const mergedConfig = buildProductConfig(config, productId);

      triggerRun(mergedConfig, 'manual', productId).catch((err) => {
        logger.error('Manual trigger failed', {
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return c.json({
        success: true,
        message: 'Run lancé ! La page se rafraîchira automatiquement.',
      });
    });

    app.post('/api/trigger-collect', async (c) => {
      const productId = resolveProductId(c.req.query('productId'));
      if (isCollecting(productId)) {
        return c.json({ success: false, message: 'Une collecte est déjà en cours.' });
      }

      const mergedConfig = buildProductConfig(config, productId);

      triggerCollect(mergedConfig, productId).catch((err) => {
        logger.error('Manual collect trigger failed', {
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return c.json({
        success: true,
        message: 'Collecte de tweets lancée !',
      });
    });

    app.post('/api/discord-webhook', async (c) => {
      const body = await c.req.json();
      const url =
        typeof body.DISCORD_WEBHOOK_URL === 'string' ? body.DISCORD_WEBHOOK_URL.trim() : '';

      if (!url) {
        return c.json({ success: false, message: "L'URL du webhook est requise." });
      }

      if (!url.startsWith('https://discord.com/api/webhooks/')) {
        return c.json({
          success: false,
          message: "L'URL doit commencer par https://discord.com/api/webhooks/",
        });
      }

      setSetting('DISCORD_WEBHOOK_URL', url);
      return c.json({
        success: true,
        message: 'Webhook Discord sauvegardé.',
      });
    });

    app.delete('/api/discord-webhook', (c) => {
      deleteSetting('DISCORD_WEBHOOK_URL');
      return c.json({ success: true, message: 'Webhook Discord supprimé.' });
    });

    app.get('/api/runs/:id/tweets', (c) => {
      const runId = Number(c.req.param('id'));
      if (!runId || runId < 1) {
        return c.json({ success: false, message: 'ID de run invalide.' }, 400);
      }

      const targetRun = getRunById(runId);
      if (!targetRun) {
        return c.json({ success: false, message: 'Run introuvable.' }, 404);
      }

      const limit = Math.min(Number(c.req.query('limit') || '50'), 200);
      const offset = Number(c.req.query('offset') || '0');
      const result = getTweetsByRunId(runId, limit, offset);
      return c.json(result);
    });

    app.post('/api/runs/:id/send-discord', async (c) => {
      const runId = Number(c.req.param('id'));
      if (!runId || runId < 1) {
        return c.json({ success: false, message: 'ID de run invalide.' }, 400);
      }

      const targetRun = getRunById(runId);
      if (!targetRun) {
        return c.json({ success: false, message: 'Run introuvable.' }, 404);
      }

      if (!targetRun.summary) {
        return c.json(
          {
            success: false,
            message: 'Ce run ne contient pas de resume a envoyer.',
          },
          400,
        );
      }

      const productId = targetRun.product_id ?? DEFAULT_PRODUCT_ID;
      const product = getProduct(productId);
      const webhookUrl =
        product?.discord_webhook ?? getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        return c.json(
          {
            success: false,
            message: "Aucun webhook Discord configure. Ajoutez l'URL dans les parametres.",
          },
          400,
        );
      }

      const result = await sendDiscordNotification(webhookUrl, targetRun.summary, runId);
      const notifStatus = result.success ? 'sent' : 'failed';
      updateNotificationStatus(runId, notifStatus);

      if (result.success) {
        return c.json({
          success: true,
          message: 'Resume envoye sur Discord avec succes.',
          notification_status: notifStatus,
        });
      }
      return c.json({
        success: false,
        message: `Echec de l'envoi : ${result.error}`,
        notification_status: notifStatus,
      });
    });

    app.post('/api/test-discord', async (c) => {
      const webhookUrl = getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        return c.json({
          success: false,
          message: "Aucun webhook Discord configuré. Ajoutez l'URL dans les paramètres.",
        });
      }

      const result = await testDiscordWebhook(webhookUrl);
      if (result.success) {
        return c.json({
          success: true,
          message: 'Message de test envoyé avec succès sur Discord.',
        });
      }
      return c.json({
        success: false,
        message: `Échec de l'envoi : ${result.error}`,
      });
    });
  }

  app.use('/*', serveStatic({ root: './dist/frontend' }));

  app.get('*', async (c) => {
    try {
      const indexPath = path.join(process.cwd(), 'dist', 'frontend', 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Frontend not built. Run npm run build:frontend', 500);
    }
  });

  app.onError((err, c) => {
    logger.error('HTTP error', { error: err.message, path: c.req.path });
    return c.text('Internal Server Error', 500);
  });

  serve({ fetch: app.fetch, port }, () => {
    logger.info('Back-office server started', {
      port,
      auth: !!process.env.ADMIN_PASSWORD,
      mode: isConfigured ? 'operational' : 'setup',
    });
  });

  return app;
}
