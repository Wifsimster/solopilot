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

const SELECTORS = {
  startPostRole: /Commencer un post|Start a post|Créer un post|Create a post/i,
  startPostFallbacks: [
    'button.share-box-feed-entry__trigger',
    '[data-control-name="share_to_followers"]',
    '.share-box-feed-entry__top-bar button',
  ],
  editorFallbacks: [
    '.share-creation-state__msg-form div[role="textbox"]',
    'div.ql-editor[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ],
  postButtonRole: /^Publier$|^Post$/i,
  postButtonFallbacks: [
    '.share-actions__primary-action',
    'button.share-actions__primary-action',
  ],
  dialogFallbacks: ['div[role="dialog"]', '.share-box', '.share-creation-state'],
  loggedInFallbacks: ['#global-nav', '.global-nav__me', '[data-control-name]'],
} as const;

const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 15_000;
const PUBLISH_CONFIRM_TIMEOUT = 30_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FEED_URL = 'https://www.linkedin.com/feed/';

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

      if (this.isCheckpointUrl(page.url()) || (await this.isCheckpointVisible(page))) {
        throw new PublishError(
          'CHECKPOINT',
          'LinkedIn presented a security checkpoint/challenge; cannot continue.',
        );
      }
      if (this.isAuthWallUrl(page.url()) || (await this.isLoginVisible(page))) {
        throw new PublishError('SESSION_EXPIRED', 'LinkedIn session is no longer logged in.');
      }

      const sharePromise = this.captureShareResponse(page);

      await this.openComposer(page);
      const editor = await this.getEditor(page);

      await this.sleep(this.jitter(300, 900));
      await this.humanType(page, editor, input.text);
      await this.sleep(this.jitter(400, 1200));

      await this.clickPost(page);

      const externalId = await this.confirmPublished(page, sharePromise);

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
      logger.warn('LinkedIn browser close failed', { error: errMsg(error) });
    }
  }

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
    const deadline = Date.now() + ACTION_TIMEOUT;
    while (Date.now() < deadline) {
      if (await button.isEnabled().catch(() => false)) break;
      await this.sleep(200);
    }
    await button.click({ timeout: ACTION_TIMEOUT });
  }

  private async confirmPublished(
    page: Page,
    sharePromise: Promise<string | undefined>,
  ): Promise<string | undefined> {
    const dialogClosed = this.waitForDialogHidden(page).then(() => 'dialog' as const);
    const shareDone = sharePromise.then((id) => ({ kind: 'share' as const, id }));

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
  }

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

  private parseUrn(blob: string): string | undefined {
    const match = blob.match(/urn:li:(?:activity|share|ugcPost|fsd_update):[0-9A-Za-z_-]+/);
    return match ? match[0] : undefined;
  }

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
