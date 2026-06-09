import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import {
  PublishError,
  type PlatformSession,
  type PublishInput,
  type PublishResult,
  type PublishTarget,
  type Publisher,
  type SessionCookie,
  type SessionState,
} from '../ports.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// We drive OLD Reddit (old.reddit.com): a stable, plain HTML submit form that
// is far less brittle than the new SPA. This is THE ONE PLACE to fix selectors
// when publishing breaks. The submit form lives at /r/<sub>/submit?selftext=true.
// The only French in this file lives in matched UI strings (rare on Reddit).
// ---------------------------------------------------------------------------
const SELECTORS = {
  // The self/text post tab on the submit page (preselected by ?selftext=true,
  // but we try to click it defensively in case the link tab is active).
  selfTextTabFallbacks: [
    'a.choice[href*="selftext=true"]',
    '.formtabs-content a.choice',
    'li.text-button a',
  ],
  // The title field on the self-post form.
  titleFallbacks: ['textarea[name="title"]', 'input[name="title"]'],
  // The body field (selftext) on the self-post form.
  bodyFallbacks: ['textarea[name="text"]', 'div.usertext-edit textarea'],
  // The submit button at the bottom of the form.
  submitFallbacks: [
    'button[type="submit"]',
    '.submit-page button[type="submit"]',
    'button.btn[type="submit"]',
  ],
  // Login form markers (unauthenticated submit redirects/falls back to login).
  loginFallbacks: ['#login_login-main', 'a.login-required', 'form#login_login-main'],
  // Logged-in markers on old.reddit (username link / logout form in the header).
  loggedInFallbacks: ['#header-bottom-right .user a', 'form.logout', '#header-bottom-right .logout'],
  // Captcha markers — we detect but never solve these.
  captchaFallbacks: ['.g-recaptcha', 'iframe[src*="recaptcha"]'],
  // Inline form error / status containers shown when a submit is rejected.
  errorFallbacks: ['.error', '.status'],
} as const;

// Explicit timeouts (ms). Kept generous because the form + redirect can be slow.
const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 15_000;
const PUBLISH_CONFIRM_TIMEOUT = 30_000;

// Realistic desktop Chrome UA so the fingerprint stays consistent with a human.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const OLD_REDDIT = 'https://old.reddit.com';

/** Minimal structural type for the chromium runtime we dynamically import. */
interface ChromiumLike {
  launch(options: {
    headless: boolean;
    executablePath?: string;
    args: string[];
  }): Promise<Browser>;
}

export class RedditPublisher implements Publisher {
  readonly source: PublishTarget = 'reddit';

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

      await page.goto(`${OLD_REDDIT}/`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      if (await this.isLoggedIn(page)) {
        return 'connected';
      }
      if (this.isLoginUrl(page.url()) || (await this.isLoginVisible(page))) {
        return 'expired';
      }
      return 'expired';
    } catch (error) {
      // checkSession must never throw; treat any failure as "needs re-auth".
      logger.warn('Reddit checkSession failed', { error: errMsg(error) });
      return 'expired';
    } finally {
      await this.safeClose(browser);
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    // A Reddit post requires a target subreddit + a title; validate before we
    // pay the cost of launching a browser.
    const subreddit = this.readSubreddit(input);
    const title = this.readTitle(input);
    if (!subreddit || !title) {
      throw new PublishError('UNKNOWN', 'Reddit requires a subreddit and a title.');
    }

    let browser: Browser | undefined;
    try {
      const launched = await this.launch();
      browser = launched.browser;
      const { context } = launched;
      await this.seedSession(context, input.session);
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      const submitUrl = `${OLD_REDDIT}/r/${subreddit}/submit?selftext=true`;
      await page.goto(submitUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await this.sleep(this.jitter(600, 1500));

      // Detect login/checkpoint state before touching the form.
      if (await this.isCaptchaVisible(page)) {
        throw new PublishError(
          'CHECKPOINT',
          'Reddit presented a captcha challenge; cannot continue.',
        );
      }
      if (this.isLoginUrl(page.url()) || (await this.isLoginVisible(page))) {
        throw new PublishError('SESSION_EXPIRED', 'Reddit session is no longer logged in.');
      }
      if (await this.isRateLimited(page)) {
        throw new PublishError('RATE_LIMITED', 'Reddit says you are doing that too much.');
      }

      // ?selftext=true usually preselects the text tab; click it defensively.
      await this.selectSelfTextTab(page);

      const titleField = await this.getTitleField(page);
      await this.sleep(this.jitter(300, 900));
      await this.humanType(page, titleField, title);

      const bodyField = await this.getBodyField(page);
      await this.sleep(this.jitter(300, 900));
      await this.humanType(page, bodyField, input.text);
      await this.sleep(this.jitter(400, 1200));

      await this.clickSubmit(page);

      const result = await this.confirmPublished(page);

      logger.info('Reddit publish succeeded', {
        subreddit,
        externalId: result.externalId ?? null,
        url: result.url,
        chars: input.text.length,
      });

      return result;
    } catch (error) {
      const publishError = this.toPublishError(error);
      logger.warn('Reddit publish failed', {
        subreddit,
        code: publishError.code,
        error: publishError.message,
      });
      throw publishError;
    } finally {
      await this.safeClose(browser);
    }
  }

  // -------------------------------------------------------------------------
  // Browser lifecycle
  // -------------------------------------------------------------------------

  private async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    // Dynamic import so the module can load in environments without playwright
    // and so we never pay the cost at module init.
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

    // Mask the automation flag so navigator.webdriver reads as undefined.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return { browser, context };
  }

  private async seedSession(context: BrowserContext, session: PlatformSession): Promise<void> {
    if (!session.cookies || session.cookies.length === 0) return;
    // old.reddit.com shares the .reddit.com session cookie, so a single seed
    // covers both the www and old hosts.
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
      logger.warn('Reddit browser close failed', { error: errMsg(error) });
    }
  }

  // -------------------------------------------------------------------------
  // Submit-form flow
  // -------------------------------------------------------------------------

  private async selectSelfTextTab(page: Page): Promise<void> {
    // Best-effort: if the body field is already present we are on the text tab.
    const bodyAlready = await this.firstVisible(
      page,
      SELECTORS.bodyFallbacks.map((sel) => page.locator(sel)),
      1_000,
    );
    if (bodyAlready) return;

    const tab = await this.firstVisible(
      page,
      SELECTORS.selfTextTabFallbacks.map((sel) => page.locator(sel)),
      2_000,
    );
    if (tab) {
      await tab.click({ timeout: ACTION_TIMEOUT }).catch(() => undefined);
      await this.sleep(this.jitter(300, 900));
    }
  }

  private async getTitleField(page: Page): Promise<Locator> {
    const field = await this.firstVisible(
      page,
      SELECTORS.titleFallbacks.map((sel) => page.locator(sel)),
      ACTION_TIMEOUT,
    );
    if (!field) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the title field.');
    }
    return field;
  }

  private async getBodyField(page: Page): Promise<Locator> {
    const field = await this.firstVisible(
      page,
      SELECTORS.bodyFallbacks.map((sel) => page.locator(sel)),
      ACTION_TIMEOUT,
    );
    if (!field) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the post body field.');
    }
    return field;
  }

  private async clickSubmit(page: Page): Promise<void> {
    const roleButton = page.getByRole('button', { name: /^submit$/i });
    const button = await this.firstVisible(page, [
      roleButton,
      ...SELECTORS.submitFallbacks.map((sel) => page.locator(sel)),
    ]);
    if (!button) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the "submit" button.');
    }
    // Some subreddits keep the button disabled until a flair is chosen or rules
    // are acknowledged. We never guess flairs — surface a clear, actionable error.
    const deadline = Date.now() + ACTION_TIMEOUT;
    let enabled = false;
    while (Date.now() < deadline) {
      if (await button.isEnabled().catch(() => false)) {
        enabled = true;
        break;
      }
      await this.sleep(200);
    }
    if (!enabled) {
      throw new PublishError(
        'SELECTOR_DRIFT',
        'Submit button never enabled — the subreddit may require a flair or rule acknowledgement.',
      );
    }
    await button.click({ timeout: ACTION_TIMEOUT });
  }

  /**
   * Confirms the post went live. Old reddit redirects a successful self-post to
   * the new permalink (/r/<sub>/comments/<id>/...). We wait for that URL; if a
   * form error surfaces instead we classify and throw.
   */
  private async confirmPublished(page: Page): Promise<PublishResult> {
    const navigated = page
      .waitForURL(/\/comments\//, { timeout: PUBLISH_CONFIRM_TIMEOUT })
      .then(() => 'navigated' as const)
      .catch(() => undefined);
    const errored = this.waitForFormError(page).then(() => 'errored' as const);

    const outcome = await Promise.race([
      navigated,
      errored,
      this.sleep(PUBLISH_CONFIRM_TIMEOUT).then(() => 'timeout' as const),
    ]);

    if (outcome === 'errored') {
      const text = await this.readFormError(page);
      // Let toPublishError classify the message (rate-limit/login/captcha/etc).
      throw new PublishError('UNKNOWN', text || 'Reddit rejected the submission.');
    }
    if (outcome !== 'navigated' || !/\/comments\//.test(page.url())) {
      throw new PublishError(
        'UNKNOWN',
        'Timed out waiting for publish confirmation (no permalink redirect).',
      );
    }

    const finalUrl = page.url();
    const externalId = this.parseCommentId(finalUrl);
    // Return a canonical www.reddit.com permalink; keep externalId as the id.
    const url = this.toCanonicalUrl(finalUrl);
    return externalId ? { url, externalId } : { url };
  }

  private async waitForFormError(page: Page): Promise<void> {
    for (const sel of SELECTORS.errorFallbacks) {
      const loc = page.locator(sel).first();
      try {
        await loc.waitFor({ state: 'visible', timeout: PUBLISH_CONFIRM_TIMEOUT });
        const text = (await loc.textContent().catch(() => ''))?.trim() ?? '';
        if (text) return;
      } catch {
        // This selector never showed an error — try the next one.
      }
    }
    // No form error appeared within the window; block forever so the caller's
    // Promise.race resolves on the navigation/timeout branch instead.
    await new Promise<void>(() => {});
  }

  private async readFormError(page: Page): Promise<string> {
    for (const sel of SELECTORS.errorFallbacks) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        const text = (await loc.textContent().catch(() => ''))?.trim() ?? '';
        if (text) return text;
      }
    }
    return '';
  }

  /** Extracts the post id from an old/new reddit permalink (/comments/<id>/). */
  private parseCommentId(url: string): string | undefined {
    const match = url.match(/\/comments\/([0-9a-z]+)/i);
    return match ? match[1] : undefined;
  }

  /** Rewrites an old.reddit.com permalink to the canonical www.reddit.com host. */
  private toCanonicalUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hostname = 'www.reddit.com';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  // -------------------------------------------------------------------------
  // Meta parsing
  // -------------------------------------------------------------------------

  /** Reads + normalizes the target subreddit (strips an optional "r/" prefix). */
  private readSubreddit(input: PublishInput): string | undefined {
    const raw = input.meta?.subreddit;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().replace(/^\/?r\//i, '');
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readTitle(input: PublishInput): string | undefined {
    const raw = input.meta?.title;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  // -------------------------------------------------------------------------
  // State detection
  // -------------------------------------------------------------------------

  private isLoginUrl(url: string): boolean {
    return /\/login|\/register/i.test(url);
  }

  private async isLoginVisible(page: Page): Promise<boolean> {
    const candidates = SELECTORS.loginFallbacks.map((sel) => page.locator(sel));
    candidates.push(page.locator('text=/you need to be logged in|must be logged in/i'));
    for (const loc of candidates) {
      if (await loc.first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isCaptchaVisible(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.captchaFallbacks) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isRateLimited(page: Page): Promise<boolean> {
    const loc = page.locator('text=/you are doing that too much|doing that too much/i');
    return loc.first().isVisible().catch(() => false);
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.loggedInFallbacks) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Human-paced helpers
  // -------------------------------------------------------------------------

  /** Types text char-by-char with jittered delays and occasional pauses. */
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
      // Occasional longer human pause (e.g. thinking / after punctuation).
      if (Math.random() < 0.04 || char === '.' || char === '\n') {
        await this.sleep(this.jitter(250, 800));
      }
    }
  }

  /** Returns the first locator that becomes visible, or undefined. */
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private jitter(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min));
  }

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  private toPublishError(error: unknown): PublishError {
    if (error instanceof PublishError) return error;

    const message = errMsg(error);
    const lower = message.toLowerCase();

    if (/authwall|not logged in|must be logged|sign in|log in|connectez-vous/i.test(message)) {
      return new PublishError('SESSION_EXPIRED', message);
    }
    if (/checkpoint|captcha|recaptcha|challenge|vérification/i.test(message)) {
      return new PublishError('CHECKPOINT', message);
    }
    if (
      lower.includes('429') ||
      /doing that too much|rate.?limit|réessayez plus tard|try again later|too many requests/i.test(
        message,
      )
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

export const redditPublisher = new RedditPublisher();

export function createRedditPublisher(): Publisher {
  return new RedditPublisher();
}
