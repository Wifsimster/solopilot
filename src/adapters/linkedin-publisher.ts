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
// LinkedIn DOM drifts frequently (class names are hashed, labels are localized).
// This is THE ONE PLACE to fix selectors when publishing breaks. Prefer the
// role-based locators; the CSS fallbacks exist only as a safety net.
// The only French in this file lives in these matched UI strings.
// ---------------------------------------------------------------------------
const SELECTORS = {
  // The "Start a post" trigger on the feed that opens the composer dialog.
  startPostRole: /Commencer un post|Start a post|Créer un post|Create a post/i,
  startPostFallbacks: [
    'button.share-box-feed-entry__trigger',
    '[data-control-name="share_to_followers"]',
    '.share-box-feed-entry__top-bar button',
  ],
  // The composer rich-text editor (contenteditable) inside the share dialog.
  editorFallbacks: [
    '.share-creation-state__msg-form div[role="textbox"]',
    'div.ql-editor[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ],
  // The final "Post" button in the composer footer.
  postButtonRole: /^Publier$|^Post$/i,
  postButtonFallbacks: [
    '.share-actions__primary-action',
    'button.share-actions__primary-action',
  ],
  // The composer dialog container; used to detect open/close.
  dialogFallbacks: ['div[role="dialog"]', '.share-box', '.share-creation-state'],
  // Logged-in markers on the feed.
  loggedInFallbacks: ['#global-nav', '.global-nav__me', '[data-control-name]'],
} as const;

// Explicit timeouts (ms). Kept generous because the feed + composer can be slow.
const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 15_000;
const PUBLISH_CONFIRM_TIMEOUT = 30_000;

// Realistic desktop Chrome UA so the fingerprint stays consistent with a human.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FEED_URL = 'https://www.linkedin.com/feed/';

/** Minimal structural type for the chromium runtime we dynamically import. */
interface ChromiumLike {
  launch(options: {
    headless: boolean;
    executablePath?: string;
    args: string[];
  }): Promise<Browser>;
}

export class LinkedInPublisher implements Publisher {
  readonly source: PublishTarget = 'generic';

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

      await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      if (this.isAuthWallUrl(page.url())) {
        return 'expired';
      }
      if (await this.isLoginVisible(page)) {
        return 'expired';
      }
      if (await this.isLoggedIn(page)) {
        return 'connected';
      }
      return 'expired';
    } catch (error) {
      // checkSession must never throw; treat any failure as "needs re-auth".
      logger.warn('LinkedIn checkSession failed', { error: errMsg(error) });
      return 'expired';
    } finally {
      await this.safeClose(browser);
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    let browser: Browser | undefined;
    try {
      const launched = await this.launch();
      browser = launched.browser;
      const { context } = launched;
      await this.seedSession(context, input.session);
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await this.sleep(this.jitter(600, 1500));

      // Detect login/checkpoint state before touching the composer.
      if (this.isCheckpointUrl(page.url()) || (await this.isCheckpointVisible(page))) {
        throw new PublishError(
          'CHECKPOINT',
          'LinkedIn presented a security checkpoint/challenge; cannot continue.',
        );
      }
      if (this.isAuthWallUrl(page.url()) || (await this.isLoginVisible(page))) {
        throw new PublishError('SESSION_EXPIRED', 'LinkedIn session is no longer logged in.');
      }

      // Capture the voyager share response (best source of the post urn/id).
      const sharePromise = this.captureShareResponse(page);

      await this.openComposer(page);
      const editor = await this.getEditor(page);

      await this.sleep(this.jitter(300, 900));
      await this.humanType(page, editor, input.text);
      await this.sleep(this.jitter(400, 1200));

      await this.clickPost(page);

      // Confirm success via response and/or dialog close — never a fixed sleep.
      const externalId = await this.confirmPublished(page, sharePromise);

      // The precise permalink is not reliably exposed by the composer flow.
      // When we parse a urn/activity id from the share API we build a permalink;
      // otherwise we fall back to the feed URL. This is a documented limitation.
      const url = externalId
        ? `https://www.linkedin.com/feed/update/${externalId}/`
        : FEED_URL;

      logger.info('LinkedIn publish succeeded', {
        externalId: externalId ?? null,
        url,
        chars: input.text.length,
      });

      return externalId ? { url, externalId } : { url };
    } catch (error) {
      const publishError = this.toPublishError(error);
      logger.warn('LinkedIn publish failed', {
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
      logger.warn('LinkedIn browser close failed', { error: errMsg(error) });
    }
  }

  // -------------------------------------------------------------------------
  // Composer flow
  // -------------------------------------------------------------------------

  private async openComposer(page: Page): Promise<void> {
    const roleTrigger = page.getByRole('button', { name: SELECTORS.startPostRole });
    const trigger = await this.firstVisible(page, [
      roleTrigger,
      ...SELECTORS.startPostFallbacks.map((sel) => page.locator(sel)),
    ]);
    if (!trigger) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the "Start a post" trigger.');
    }
    await trigger.click({ timeout: ACTION_TIMEOUT });
    await this.sleep(this.jitter(500, 1200));
  }

  private async getEditor(page: Page): Promise<Locator> {
    const editor = await this.firstVisible(
      page,
      SELECTORS.editorFallbacks.map((sel) => page.locator(sel)),
      ACTION_TIMEOUT,
    );
    if (!editor) {
      throw new PublishError('SELECTOR_DRIFT', 'Could not find the composer text editor.');
    }
    return editor;
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
    // Wait until enabled (LinkedIn disables it until the editor has content).
    const deadline = Date.now() + ACTION_TIMEOUT;
    while (Date.now() < deadline) {
      if (await button.isEnabled().catch(() => false)) break;
      await this.sleep(200);
    }
    await button.click({ timeout: ACTION_TIMEOUT });
  }

  /**
   * Confirms the post went live. Prefers the captured voyager share response
   * (which also yields the post urn) and/or the composer dialog closing.
   * Returns the parsed external id when available.
   */
  private async confirmPublished(
    page: Page,
    sharePromise: Promise<string | undefined>,
  ): Promise<string | undefined> {
    const dialogClosed = this.waitForDialogHidden(page).then(() => 'dialog' as const);
    const shareDone = sharePromise.then((id) => ({ kind: 'share' as const, id }));

    // Whichever signal arrives first within the window counts as success.
    const result = await Promise.race([
      shareDone,
      dialogClosed,
      this.sleep(PUBLISH_CONFIRM_TIMEOUT).then(() => 'timeout' as const),
    ]);

    if (result === 'timeout') {
      throw new PublishError(
        'UNKNOWN',
        'Timed out waiting for publish confirmation (no share response, dialog stayed open).',
      );
    }

    // Give the share response a brief chance to resolve so we can grab the id
    // even when the dialog closed first.
    const id =
      typeof result === 'object' && result.kind === 'share'
        ? result.id
        : await Promise.race([
            sharePromise.catch(() => undefined),
            this.sleep(2_000).then(() => undefined),
          ]);
    return id ?? undefined;
  }

  private async waitForDialogHidden(page: Page): Promise<void> {
    for (const sel of SELECTORS.dialogFallbacks) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.waitFor({ state: 'hidden', timeout: PUBLISH_CONFIRM_TIMEOUT });
        return;
      }
    }
    // No dialog currently visible — treat as already closed.
  }

  /**
   * Listens for the voyager share API call and tries to extract the post urn.
   * Resolves to the external id (e.g. urn:li:activity:...) or undefined.
   */
  private captureShareResponse(page: Page): Promise<string | undefined> {
    return page
      .waitForResponse(
        (resp) => {
          const u = resp.url();
          return (
            u.includes('/voyager/api/') &&
            (u.includes('shares') ||
              u.includes('ugcPosts') ||
              u.includes('contentcreation'))
          );
        },
        { timeout: PUBLISH_CONFIRM_TIMEOUT },
      )
      .then(async (resp) => {
        try {
          const headerUrn = resp.headers()['x-restli-id'] ?? resp.headers()['x-li-uuid'];
          if (headerUrn) {
            const fromHeader = this.parseUrn(headerUrn);
            if (fromHeader) return fromHeader;
          }
          const body = await resp.text();
          return this.parseUrn(body);
        } catch {
          return undefined;
        }
      })
      .catch(() => undefined);
  }

  /** Extracts an activity/share/ugcPost urn from an arbitrary string blob. */
  private parseUrn(blob: string): string | undefined {
    const match = blob.match(/urn:li:(?:activity|share|ugcPost|fsd_update):[0-9A-Za-z_-]+/);
    return match ? match[0] : undefined;
  }

  // -------------------------------------------------------------------------
  // State detection
  // -------------------------------------------------------------------------

  private isAuthWallUrl(url: string): boolean {
    return /\/login|\/authwall|\/checkpoint/i.test(url);
  }

  private isCheckpointUrl(url: string): boolean {
    return /\/checkpoint/i.test(url);
  }

  private async isLoginVisible(page: Page): Promise<boolean> {
    const candidates = [
      page.locator('input[name="session_key"]'),
      page.locator('#username'),
      page.locator('form.login__form'),
    ];
    for (const loc of candidates) {
      if (await loc.first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isCheckpointVisible(page: Page): Promise<boolean> {
    const candidates = [
      page.locator('iframe[src*="captcha"]'),
      page.locator('[data-test-id="challenge"]'),
      page.locator('text=/vérification de sécurité|security verification/i'),
    ];
    for (const loc of candidates) {
      if (await loc.first().isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    const roleTrigger = page.getByRole('button', { name: SELECTORS.startPostRole });
    if (await roleTrigger.first().isVisible().catch(() => false)) return true;
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

    if (/authwall|session_key|not logged in|sign in|connectez-vous/i.test(message)) {
      return new PublishError('SESSION_EXPIRED', message);
    }
    if (/checkpoint|captcha|challenge|vérification/i.test(message)) {
      return new PublishError('CHECKPOINT', message);
    }
    if (
      lower.includes('429') ||
      /rate.?limit|réessayez plus tard|try again later|too many requests/i.test(message)
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

export const linkedInPublisher = new LinkedInPublisher();

export function createLinkedInPublisher(): Publisher {
  return new LinkedInPublisher();
}
