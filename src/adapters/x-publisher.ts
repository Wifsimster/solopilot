import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import {
  PublishError,
  type PlatformSession,
  type PostMetrics,
  type PublishInput,
  type PublishResult,
  type PublishTarget,
  type Publisher,
  type SessionCookie,
  type SessionState,
} from '../ports.js';
import { logger } from '../logger.js';

const SELECTORS = {
  tweetTextarea: (i: number) => `[data-testid="tweetTextarea_${i}"]`,
  tweetTextareaEditable: (i: number) =>
    `[data-testid="tweetTextarea_${i}"] [contenteditable="true"]`,
  addButtonFallbacks: ['[data-testid="addButton"]'],
  postButtonFallbacks: ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
  postButtonRole: /^Post$|^Poster$|Post all|Poster tout/i,
  loggedInFallbacks: [
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="AppTabBar_Home_Link"]',
  ],
  loginFallbacks: ['[data-testid="loginButton"]', '[autocomplete="username"]'],
  metricsGroup: '[role="group"]',
  metricLike: '[data-testid="like"]',
  metricReply: '[data-testid="reply"]',
  metricRetweet: '[data-testid="retweet"]',
} as const;

const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 15_000;
const PUBLISH_CONFIRM_TIMEOUT = 30_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const X_BASE = 'https://x.com';

interface ChromiumLike {
  launch(options: {
    headless: boolean;
    executablePath?: string;
    args: string[];
  }): Promise<Browser>;
}

export class XPublisher implements Publisher {
  readonly source: PublishTarget = 'x';

  async checkSession(session: PlatformSession): Promise<SessionState> {
    if (!session.cookies || session.cookies.length === 0) {
      return 'missing';
    }

    let browser: Browser | undefined;
    try {
      const launched = await this.launch();
      browser = launched.browser;
      const { context } = launched;
      await this.seedSession(context, session);
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      await page.goto(`${X_BASE}/home`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT,
      });

      if (await this.isLoggedIn(page)) {
        return 'connected';
      }
      if (this.isLoginUrl(page.url()) || (await this.isLoginVisible(page))) {
        return 'expired';
      }
      return 'expired';
    } catch (error) {
      logger.warn('X checkSession failed', { error: errMsg(error) });
      return 'expired';
    } finally {
      await this.safeClose(browser);
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const tweets = this.resolveTweets(input);

    let browser: Browser | undefined;
    try {
      const launched = await this.launch();
      browser = launched.browser;
      const { context } = launched;
      await this.seedSession(context, input.session);
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      await page.goto(`${X_BASE}/compose/post`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT,
      });
      await this.sleep(this.jitter(600, 1500));

      if (this.isCheckpointUrl(page.url()) || (await this.isCheckpointVisible(page))) {
        throw new PublishError(
          'CHECKPOINT',
          'X presented a security checkpoint/verification challenge; cannot continue.',
        );
      }
      if (this.isLoginUrl(page.url()) || (await this.isLoginVisible(page))) {
        throw new PublishError('SESSION_EXPIRED', 'X session is no longer logged in.');
      }
      if (await this.isRateLimited(page)) {
        throw new PublishError('RATE_LIMITED', 'X says you are doing that too much.');
      }

      const createPromise = this.captureCreateTweetResponse(page);

      const firstEditor = await this.getEditor(page, 0);
      await this.sleep(this.jitter(300, 900));
      await this.humanType(page, firstEditor, tweets[0]);

      for (let j = 1; j < tweets.length; j += 1) {
        await this.sleep(this.jitter(800, 2000));
        await this.clickAddAnother(page);
        const editor = await this.getEditor(page, j);
        await this.sleep(this.jitter(300, 900));
        await this.humanType(page, editor, tweets[j]);
      }

      await this.sleep(this.jitter(400, 1200));
      await this.clickPost(page);

      const externalId = await this.confirmPublished(page, createPromise);

      const url = externalId
        ? `${X_BASE}/i/web/status/${externalId}`
        : `${X_BASE}/home`;

      logger.info('X publish succeeded', {
        tweets: tweets.length,
        externalId: externalId ?? null,
        url,
      });

      return externalId ? { url, externalId } : { url };
    } catch (error) {
      const publishError = this.toPublishError(error);
      logger.warn('X publish failed', {
        tweets: tweets.length,
        code: publishError.code,
        error: publishError.message,
      });
      throw publishError;
    } finally {
      await this.safeClose(browser);
    }
  }

  async fetchMetrics(url: string, session: PlatformSession): Promise<PostMetrics> {
    if (!session.cookies || session.cookies.length === 0) return {};

    let browser: Browser | undefined;
    try {
      const launched = await this.launch();
      browser = launched.browser;
      const { context } = launched;
      await this.seedSession(context, session);
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await this.sleep(this.jitter(800, 1500));

      const fromGroup = await this.parseMetricsFromGroup(page);
      if (
        fromGroup.likes !== undefined ||
        fromGroup.comments !== undefined ||
        fromGroup.reposts !== undefined
      ) {
        return fromGroup;
      }

      return await this.parseMetricsFromButtons(page);
    } catch (error) {
      logger.warn('X fetchMetrics failed', { error: errMsg(error) });
      return {};
    } finally {
      await this.safeClose(browser);
    }
  }

  private async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    const mod = (await import('playwright-core')) as unknown as { chromium: ChromiumLike };
    const chromium = mod.chromium;

    const executablePath =
      process.env.CHROMIUM_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

    const browser = await chromium.launch({
      headless: process.env.PUBLISH_HEADFUL !== 'true',
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      viewport: { width: 1280, height: 800 },
    });
    context.setDefaultTimeout(ACTION_TIMEOUT);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return { browser, context };
  }

  private async seedSession(context: BrowserContext, session: PlatformSession): Promise<void> {
    if (!session.cookies || session.cookies.length === 0) return;
    const cookies = session.cookies.map((c: SessionCookie) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
    }));
    await context.addCookies(cookies);
  }

  private async safeClose(browser: Browser | undefined): Promise<void> {
    if (!browser) return;
    try {
      await browser.close();
    } catch (error) {
      logger.warn('X browser close failed', { error: errMsg(error) });
    }
  }

  private async getEditor(page: Page, index: number): Promise<Locator> {
    const editor = await this.firstVisible(
      page,
      [
        page.locator(SELECTORS.tweetTextareaEditable(index)),
        page.locator(SELECTORS.tweetTextarea(index)),
      ],
      ACTION_TIMEOUT,
    );
    if (!editor) {
      throw new PublishError(
        'SELECTOR_DRIFT',
        `Could not find the composer text area for tweet ${index}.`,
      );
    }
    return editor;
  }

  private async clickAddAnother(page: Page): Promise<void> {
    const button = await this.firstVisible(
      page,
      SELECTORS.addButtonFallbacks.map((sel) => page.locator(sel)),
    );
    if (!button) {
      throw new PublishError(
        'SELECTOR_DRIFT',
        'Could not find the "add another tweet" button to extend the thread.',
      );
    }
    await button.click({ timeout: ACTION_TIMEOUT });
    await this.sleep(this.jitter(300, 900));
  }

  private async clickPost(page: Page): Promise<void> {
    const roleButton = page.getByRole('button', { name: SELECTORS.postButtonRole });
    const button = await this.firstVisible(page, [
      roleButton,
      ...SELECTORS.postButtonFallbacks.map((sel) => page.locator(sel)),
    ]);
    if (!button) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the "Post" button.');
    }
    const deadline = Date.now() + ACTION_TIMEOUT;
    while (Date.now() < deadline) {
      if (await button.isEnabled().catch(() => false)) break;
      await this.sleep(200);
    }
    await button.click({ timeout: ACTION_TIMEOUT });
  }

  private async confirmPublished(
    page: Page,
    createPromise: Promise<string | undefined>,
  ): Promise<string | undefined> {
    const composerClosed = this.waitForComposerHidden(page).then(() => 'composer' as const);
    const createDone = createPromise.then((id) => ({ kind: 'create' as const, id }));

    const result = await Promise.race([
      createDone,
      composerClosed,
      this.sleep(PUBLISH_CONFIRM_TIMEOUT).then(() => 'timeout' as const),
    ]);

    if (result === 'timeout') {
      throw new PublishError(
        'UNKNOWN',
        'Timed out waiting for publish confirmation (no CreateTweet response, composer stayed open).',
      );
    }

    const id =
      typeof result === 'object' && result.kind === 'create'
        ? result.id
        : await Promise.race([
            createPromise.catch(() => undefined),
            this.sleep(2_000).then(() => undefined),
          ]);
    return id ?? undefined;
  }

  private async waitForComposerHidden(page: Page): Promise<void> {
    const textarea = page.locator(SELECTORS.tweetTextarea(0)).first();
    const hidden = textarea
      .waitFor({ state: 'hidden', timeout: PUBLISH_CONFIRM_TIMEOUT })
      .then(() => undefined)
      .catch(() => undefined);
    const navigated = page
      .waitForURL((url) => !url.toString().includes('/compose'), {
        timeout: PUBLISH_CONFIRM_TIMEOUT,
      })
      .then(() => undefined)
      .catch(() => undefined);
    await Promise.race([hidden, navigated]);
  }

  private captureCreateTweetResponse(page: Page): Promise<string | undefined> {
    return page
      .waitForResponse((resp) => resp.url().includes('/CreateTweet'), {
        timeout: PUBLISH_CONFIRM_TIMEOUT,
      })
      .then(async (resp) => {
        try {
          const body = await resp.text();
          const match = body.match(/"rest_id":"(\d+)"/);
          return match ? match[1] : undefined;
        } catch {
          return undefined;
        }
      })
      .catch(() => undefined);
  }

  private resolveTweets(input: PublishInput): string[] {
    const raw = input.meta?.thread;
    if (Array.isArray(raw)) {
      const parts = raw
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length > 0) return parts;
    }
    const split = this.splitIntoTweets(input.text);
    return split.length > 0 ? split : [input.text];
  }

  private splitIntoTweets(text: string, limit = 280): string[] {
    const normalized = text.trim();
    if (normalized.length === 0) return [];
    if (normalized.length <= limit) return [normalized];

    const chunks: string[] = [];
    let remaining = normalized;

    while (remaining.length > limit) {
      const window = remaining.slice(0, limit + 1);
      let cut = this.lastBoundary(window, /\n\s*\n/g, limit);
      if (cut <= 0) cut = this.lastBoundary(window, /[.!?](?:\s|$)/g, limit);
      if (cut <= 0) cut = window.lastIndexOf(' ', limit);

      if (cut <= 0) {
        chunks.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit).trimStart();
        continue;
      }

      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trimStart();
    }

    if (remaining.length > 0) chunks.push(remaining.trim());
    return chunks.filter((c) => c.length > 0);
  }

  private lastBoundary(window: string, pattern: RegExp, limit: number): number {
    let best = -1;
    for (const m of window.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (end <= limit) best = end;
    }
    return best;
  }

  private isLoginUrl(url: string): boolean {
    return /\/login|\/i\/flow\/login/i.test(url);
  }

  private isCheckpointUrl(url: string): boolean {
    if (/\/account\/access/i.test(url)) return true;
    return /\/i\/flow\//i.test(url) && !/\/i\/flow\/login/i.test(url);
  }

  private async isLoginVisible(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.loginFallbacks) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isCheckpointVisible(page: Page): Promise<boolean> {
    const candidates = [
      page.locator('iframe[src*="captcha"]'),
      page.locator('iframe[src*="arkose"]'),
      page.locator('[data-testid="ocfEnterTextTextInput"]'),
      page.locator('text=/activité inhabituelle|unusual activity|vérifier|verify your/i'),
    ];
    for (const loc of candidates) {
      if (await loc.first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isRateLimited(page: Page): Promise<boolean> {
    const loc = page.locator(
      'text=/réessayez plus tard|try again|rate limit|limit|too many/i',
    );
    return loc.first().isVisible().catch(() => false);
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.loggedInFallbacks) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async humanType(page: Page, locator: Locator, text: string): Promise<void> {
    await locator.click({ timeout: ACTION_TIMEOUT });
    await this.sleep(this.jitter(150, 500));

    const usePressSequentially = typeof locator.pressSequentially === 'function';
    for (const char of text) {
      const delay = this.jitter(35, 110);
      if (usePressSequentially) {
        await locator.pressSequentially(char, { delay });
      } else {
        await page.keyboard.type(char, { delay });
      }
      if (Math.random() < 0.04 || char === '.' || char === '\n') {
        await this.sleep(this.jitter(250, 800));
      }
    }
  }

  private async firstVisible(
    _page: Page,
    locators: Locator[],
    timeout = ACTION_TIMEOUT,
  ): Promise<Locator | undefined> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const loc of locators) {
        const first = loc.first();
        if (await first.isVisible().catch(() => false)) return first;
      }
      await this.sleep(150);
    }
    return undefined;
  }

  private async parseMetricsFromGroup(page: Page): Promise<PostMetrics> {
    const groups = page.locator(SELECTORS.metricsGroup);
    const count = await groups.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const label = await groups
        .nth(i)
        .getAttribute('aria-label')
        .catch(() => null);
      if (!label) continue;
      const parsed = this.parseAggregateLabel(label);
      if (
        parsed.likes !== undefined ||
        parsed.comments !== undefined ||
        parsed.reposts !== undefined
      ) {
        return parsed;
      }
    }
    return {};
  }

  private parseAggregateLabel(label: string): PostMetrics {
    const metrics: PostMetrics = {};
    const num = '([\\d.,\\s]+[KkMm]?)';
    const pick = (keyword: string): number | undefined => {
      const re = new RegExp(`${num}\\s*${keyword}`, 'i');
      const m = label.match(re);
      return m ? this.parseCount(m[1]) : undefined;
    };

    const comments = pick('(?:replies|reply|réponses|réponse)');
    const reposts = pick('(?:reposts|repost|retweets|retweet)');
    const likes = pick("(?:likes|like|j'aime|jaime)");

    if (comments !== undefined) metrics.comments = comments;
    if (reposts !== undefined) metrics.reposts = reposts;
    if (likes !== undefined) metrics.likes = likes;
    return metrics;
  }

  private async parseMetricsFromButtons(page: Page): Promise<PostMetrics> {
    const metrics: PostMetrics = {};
    const likes = await this.readButtonCount(page, SELECTORS.metricLike);
    const comments = await this.readButtonCount(page, SELECTORS.metricReply);
    const reposts = await this.readButtonCount(page, SELECTORS.metricRetweet);
    if (likes !== undefined) metrics.likes = likes;
    if (comments !== undefined) metrics.comments = comments;
    if (reposts !== undefined) metrics.reposts = reposts;
    return metrics;
  }

  private async readButtonCount(page: Page, selector: string): Promise<number | undefined> {
    const button = page.locator(selector).first();
    if (!(await button.count().catch(() => 0))) return undefined;

    const label = await button.getAttribute('aria-label').catch(() => null);
    const fromLabel = label ? this.parseCount(this.leadingCountToken(label)) : undefined;
    if (fromLabel !== undefined) return fromLabel;

    const text = await button.innerText().catch(() => '');
    return text ? this.parseCount(this.leadingCountToken(text)) : undefined;
  }

  private leadingCountToken(s: string): string {
    const m = s.match(/[\d][\d.,\s]*[KkMm]?/);
    return m ? m[0] : '';
  }

  private parseCount(s: string): number | undefined {
    const trimmed = s.trim();
    if (!/\d/.test(trimmed)) return undefined;

    const suffixMatch = trimmed.match(/([KkMm])\s*$/);
    const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : '';
    let core = suffix ? trimmed.slice(0, suffixMatch!.index).trim() : trimmed;

    core = core.replace(/\s/g, '');

    let value: number;
    if (suffix) {
      const normalized = core.replace(',', '.');
      value = Number.parseFloat(normalized);
    } else if (/^[\d]+([.,][\d]{3})+$/.test(core)) {
      value = Number.parseInt(core.replace(/[.,]/g, ''), 10);
    } else {
      value = Number.parseInt(core.replace(/[.,]/g, ''), 10);
    }

    if (!Number.isFinite(value)) return undefined;
    if (suffix === 'k') value *= 1_000;
    else if (suffix === 'm') value *= 1_000_000;
    return Math.round(value);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private jitter(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min));
  }

  private toPublishError(error: unknown): PublishError {
    if (error instanceof PublishError) return error;

    const message = errMsg(error);
    const lower = message.toLowerCase();

    if (/authwall|not logged in|sign in|log in|connectez-vous/i.test(message)) {
      return new PublishError('SESSION_EXPIRED', message);
    }
    if (/checkpoint|verify|captcha|unusual activity|vérification/i.test(message)) {
      return new PublishError('CHECKPOINT', message);
    }
    if (
      lower.includes('429') ||
      /rate.?limit|try again later|limit|réessayez plus tard|too many requests/i.test(message)
    ) {
      return new PublishError('RATE_LIMITED', message);
    }
    return new PublishError('UNKNOWN', message);
  }
}

function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

export const xPublisher = new XPublisher();

export function createXPublisher(): Publisher {
  return new XPublisher();
}
