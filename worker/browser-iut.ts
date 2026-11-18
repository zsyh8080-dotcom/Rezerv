import {
  launch,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightCookie,
  type PlaywrightPage,
} from '@cloudflare/playwright';
import {
  getJalaliWeekday,
  normalizeAsciiDigits,
  toPersianDigits,
  utcMsToTehranParts,
} from '../src/core/jalali';
import { normalizeForMatch } from '../src/core/policy';
import {
  IUT_URLS,
  type AddToCartResult,
  type ConfirmResult,
  type FetchContextResult,
  type IutCredentials,
  type IutSiteClient,
  type LoginResult,
  type ReservedReportResult,
  type StandbyResult,
} from '../src/core/site';
import type { CartSummary, MenuItem, ReservedMeal } from '../src/core/types';
import type { BrowserWorker } from './env';

function isQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('browser time') ||
    msg.includes('concurrent')
  );
}

function isTransientHangError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('err_connection') ||
    msg.includes('err_network') ||
    msg.includes('net::err') ||
    msg.includes('execution context') ||
    msg.includes('navigation') ||
    msg.includes('target closed') ||
    msg.includes('page crashed') ||
    msg.includes('session closed') ||
    msg.includes('browser has been closed') ||
    msg.includes('detached') ||
    msg.includes('protocol error') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('socket') ||
    msg.includes('aborted') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

function parseRialsFromText(text: string): number {
  const ascii = normalizeAsciiDigits(text).replace(/[,،\s]/g, '');
  const match = /(\d{4,9})/.exec(ascii);
  return match ? Number(match[1]) : 0;
}

async function withHangRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 5,
  baseDelayMs = 450
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || isQuotaError(err) || !isTransientHangError(err)) {
        throw err;
      }
      const exp = Math.min(4500, Math.round(baseDelayMs * Math.pow(1.55, attempt - 1)));
      const jitter = Math.floor(Math.random() * 320);
      await new Promise((resolve) => setTimeout(resolve, exp + jitter));
    }
  }
  throw lastError;
}

interface WarmBrowserHandle {
  browser: PlaywrightBrowser;
  context: PlaywrightBrowserContext;
  page: PlaywrightPage;
  hangToleranceMs: number;
}

export class CloudflareBrowserIutClient implements IutSiteClient {
  private readonly browserBinding: BrowserWorker;
  private standbyHandle: WarmBrowserHandle | null = null;
  private lastCreds: IutCredentials | null = null;

  constructor(browserBinding: BrowserWorker) {
    this.browserBinding = browserBinding;
  }

  private async configureFastPage(page: PlaywrightPage): Promise<void> {
    await page
      .route('**/*', (route) => {
        const type = route.request().resourceType();
        const url = route.request().url().toLowerCase();
        // Skip heavy images/fonts/media & analytics during rush-hour congestion, keep HTML/JS/CSS/XHR intact
        if (
          type === 'image' ||
          type === 'media' ||
          type === 'font' ||
          url.includes('analytics') ||
          url.includes('googletagmanager')
        ) {
          if (!url.includes('captcha')) {
            return route.abort();
          }
        }
        return route.continue();
      })
      .catch(() => undefined);
  }

  private async navigateAndAuthenticate(
    page: PlaywrightPage,
    context: PlaywrightBrowserContext,
    creds: IutCredentials | null,
    hangToleranceMs: number
  ): Promise<{
    ok: boolean;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
    cookies: PlaywrightCookie[];
  }> {
    await withHangRetry(async () => {
      await page.goto(IUT_URLS.RESERVATION_PAGE, {
        waitUntil: 'domcontentloaded',
        timeout: hangToleranceMs,
      });
    }, 5);

    await page.waitForTimeout(1100);

    // Step 1: Dining IdentityServer login page often requires clicking "ورود با احراز هویت مرکزی" (CAS)
    if (page.url().includes('/identity/login')) {
      const casLink = page
        .locator(
          'a:has-text("ورود با احراز هویت مرکزی"), a:has-text("احراز هویت مرکزی"), a[href*="Cas/Login" i], a[href*="provider=CAS" i]'
        )
        .first();
      if ((await casLink.count()) > 0) {
        await withHangRetry(async () => {
          await casLink.click({ timeout: Math.min(hangToleranceMs, 20000) });
        }, 3);
        const deadline = Date.now() + Math.min(hangToleranceMs, 20000);
        while (page.url().includes('/identity/login') && Date.now() < deadline) {
          await page.waitForTimeout(350);
        }
        await page.waitForTimeout(700);
      } else {
        const effectiveCreds = creds || this.lastCreds;
        if (!effectiveCreds || !effectiveCreds.username || !effectiveCreds.password) {
          return {
            ok: false,
            errorCode: 'MISSING_CREDENTIALS',
            errorMessage:
              'صفحه ورود اتوماسیون تغذیه باز شد اما نام کاربری یا رمز عبور در دسترس نیست.',
            cookies: [],
          };
        }
        const userInput = page.locator('input[type="text"], #username, input[name*="user" i]').first();
        const passInput = page.locator('input[type="password"], #password').first();
        const submitBtn = page.locator('button[type="submit"], button:has-text("ورود")').first();
        await userInput.fill(effectiveCreds.username);
        await passInput.fill(effectiveCreds.password);
        await submitBtn.click({ timeout: Math.min(hangToleranceMs, 20000) });
        await page.waitForTimeout(2000);
      }
    }

    // Step 2: Central CAS Login (webauth.iut.ac.ir)
    if (page.url().includes('webauth.iut.ac.ir')) {
      const effectiveCreds = creds || this.lastCreds;
      if (!effectiveCreds || !effectiveCreds.username || !effectiveCreds.password) {
        return {
          ok: false,
          errorCode: 'MISSING_CREDENTIALS',
          errorMessage:
            'نشست فعال نیست و نام کاربری یا رمز عبور برای ورود در webauth.iut.ac.ir در دسترس نیست.',
          cookies: [],
        };
      }

      const captchaCount = await page
        .locator('img[src*="captcha" i], input[name*="captcha" i], #captcha')
        .count();
      if (captchaCount > 0) {
        const captchaVisible = await page
          .locator('img[src*="captcha" i], input[name*="captcha" i], #captcha')
          .first()
          .isVisible();
        if (captchaVisible) {
          return {
            ok: false,
            errorCode: 'CAPTCHA_REQUIRED',
            errorMessage:
              'صفحه ورود مرکزی webauth.iut.ac.ir کپچا درخواست کرده است؛ ورود خودکار متوقف شد.',
            cookies: [],
          };
        }
      }

      const userInput = page.locator('#username, input[name="username"], input[type="text"]').first();
      const passInput = page.locator('#password, input[name="password"], input[type="password"]').first();
      const submitBtn = page
        .locator('button[type="submit"], input[type="submit"], .btn-submit, button:has-text("ورود")')
        .first();

      await userInput.fill(effectiveCreds.username);
      await passInput.fill(effectiveCreds.password);
      await withHangRetry(async () => {
        await submitBtn.click({ timeout: Math.min(hangToleranceMs, 20000) });
      }, 4);

      const casDeadline = Date.now() + Math.min(hangToleranceMs, 20000);
      while (page.url().includes('webauth.iut.ac.ir') && Date.now() < casDeadline) {
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(1400);

      if (page.url().includes('webauth.iut.ac.ir') || page.url().includes('/identity/login')) {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const stillCaptcha = await page
          .locator('img[src*="captcha" i], input[name*="captcha" i]')
          .count();
        if (stillCaptcha > 0) {
          return {
            ok: false,
            errorCode: 'CAPTCHA_REQUIRED',
            errorMessage: 'سامانه ورود مرکزی کپچا نمایش داد.',
            cookies: [],
          };
        }
        return {
          ok: false,
          errorCode: 'AUTH_ERROR',
          errorMessage:
            bodyText.includes('کلمه عبور') ||
            bodyText.includes('نام کاربری') ||
            bodyText.includes('Invalid')
              ? 'نام کاربری یا رمز عبور در webauth.iut.ac.ir اشتباه است.'
              : 'ورود به webauth.iut.ac.ir انجام نشد.',
          cookies: [],
        };
      }

      await withHangRetry(async () => {
        await page.goto(IUT_URLS.RESERVATION_PAGE, {
          waitUntil: 'domcontentloaded',
          timeout: hangToleranceMs,
        });
      }, 5);
      await page.waitForTimeout(1400);
    }

    if (page.url().includes('/identity/login') || page.url().includes('webauth.iut.ac.ir')) {
      return {
        ok: false,
        errorCode: 'AUTH_ERROR',
        errorMessage: 'صفحه همچنان روی صفحه ورود سامانه دانشگاه باقی ماند و به پنل رزرو منتقل نشد.',
        cookies: [],
      };
    }

    const cookies = await context.cookies([IUT_URLS.DINING_BASE, IUT_URLS.WEBAUTH_BASE]);
    return { ok: true, cookies };
  }

  private async openAuthenticatedPage(
    creds: IutCredentials | null,
    existingSessionCookiesJson?: string | null,
    hangToleranceSeconds = 45
  ): Promise<{
    browser: PlaywrightBrowser;
    context: PlaywrightBrowserContext;
    page: PlaywrightPage;
    cookies: PlaywrightCookie[];
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'BROWSER_QUOTA' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
  }> {
    if (creds && creds.username && creds.password) {
      this.lastCreds = creds;
    }

    const hangToleranceMs = Math.max(15, hangToleranceSeconds) * 1000;
    let browser: PlaywrightBrowser;
    try {
      browser = await withHangRetry(async () => launch(this.browserBinding), 3, 700);
    } catch (err) {
      if (isQuotaError(err)) {
        return {
          browser: undefined as unknown as PlaywrightBrowser,
          context: undefined as unknown as PlaywrightBrowserContext,
          page: undefined as unknown as PlaywrightPage,
          cookies: [],
          errorCode: 'BROWSER_QUOTA',
          errorMessage: 'سهمیه اجرای مرورگر Cloudflare Browser Run تکمیل شده است.',
        };
      }
      throw err;
    }

    const context = await browser.newContext({
      locale: 'fa-IR',
      timezoneId: 'Asia/Tehran',
    });

    if (existingSessionCookiesJson) {
      try {
        const parsed = JSON.parse(existingSessionCookiesJson) as PlaywrightCookie[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          await context.addCookies(parsed);
        }
      } catch {
        // Ignore corrupted cookie cache and perform fresh login
      }
    }

    const page = await context.newPage();
    await this.configureFastPage(page);

    try {
      const auth = await this.navigateAndAuthenticate(page, context, creds, hangToleranceMs);
      if (!auth.ok) {
        await browser.close().catch(() => undefined);
        return {
          browser: undefined as unknown as PlaywrightBrowser,
          context: undefined as unknown as PlaywrightBrowserContext,
          page: undefined as unknown as PlaywrightPage,
          cookies: [],
          errorCode: auth.errorCode ?? 'NETWORK_ERROR',
          errorMessage: auth.errorMessage,
        };
      }
      return { browser, context, page, cookies: auth.cookies };
    } catch (err) {
      await browser.close().catch(() => undefined);
      return {
        browser: undefined as unknown as PlaywrightBrowser,
        context: undefined as unknown as PlaywrightBrowserContext,
        page: undefined as unknown as PlaywrightPage,
        cookies: [],
        errorCode: isQuotaError(err) ? 'BROWSER_QUOTA' : 'NETWORK_ERROR',
        errorMessage:
          err instanceof Error
            ? `خطا یا کندی شدید سایت دانشگاه هنگام ورود: ${err.message}`
            : 'خطا یا کندی شدید سایت دانشگاه هنگام ورود',
      };
    }
  }

  private async selectTargetDateOnPage(page: PlaywrightPage, targetDateJalali: string): Promise<void> {
    const weekday = getJalaliWeekday(targetDateJalali) ?? '';
    const persianDate = toPersianDigits(targetDateJalali);
    const shortDate = targetDateJalali.slice(5); // MM/DD
    const shortDateFa = toPersianDigits(shortDate);

    const switched = await page
      .evaluate<boolean, { ascii: string; fa: string; shortAscii: string; shortFa: string; weekday: string }>(
        (args) => {
          const selectors =
            'button, a, [role="tab"], .nav-tabs li, .day-tab, [ng-click*="Day" i], [ng-click*="Date" i], [ng-click*="Select" i]';
          const nodes = Array.from(document.querySelectorAll(selectors));
          for (const el of nodes) {
            const text = ((el as HTMLElement).innerText || '').trim();
            if (!text) continue;
            if (
              text.includes(args.ascii) ||
              text.includes(args.fa) ||
              (args.shortAscii && text.includes(args.shortAscii)) ||
              (args.shortFa && text.includes(args.shortFa)) ||
              (args.weekday && text.includes(args.weekday) && text.length < 40)
            ) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        },
        {
          ascii: targetDateJalali,
          fa: persianDate,
          shortAscii: shortDate,
          shortFa: shortDateFa,
          weekday,
        }
      )
      .catch(() => false);

    if (switched) {
      await page.waitForTimeout(650);
    }
  }

  private async ensureOnDiningPageIfRedirected(handle: {
    page: PlaywrightPage;
    context?: PlaywrightBrowserContext;
    hangToleranceMs: number;
  }): Promise<boolean> {
    try {
      const currentUrl = handle.page.url();
      if (!currentUrl.includes('webauth.iut.ac.ir') && !currentUrl.includes('/identity/login')) {
        return true;
      }
      if (!this.lastCreds || !handle.context) {
        return false;
      }
      const auth = await this.navigateAndAuthenticate(
        handle.page,
        handle.context,
        this.lastCreds,
        handle.hangToleranceMs
      );
      return auth.ok;
    } catch {
      return false;
    }
  }

  async prepareStandbySession(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null,
    opts?: { hangToleranceSeconds?: number }
  ): Promise<StandbyResult> {
    this.lastCreds = creds;
    await this.releaseStandbySession();
    const hangSec = opts?.hangToleranceSeconds ?? 45;
    const opened = await this.openAuthenticatedPage(creds, existingSessionCookiesJson, hangSec);
    if (opened.errorCode) {
      return {
        ok: false,
        errorCode: opened.errorCode,
        message: opened.errorMessage ?? 'خطا در آماده‌سازی نشست داخل سامانه',
      };
    }

    this.standbyHandle = {
      browser: opened.browser,
      context: opened.context,
      page: opened.page,
      hangToleranceMs: Math.max(15, hangSec) * 1000,
    };

    const creditText = await opened.page
      .locator('[ng-bind*="Credit" i], [ng-bind*="Balance" i], .credit, .balance')
      .first()
      .textContent()
      .catch(() => null);

    return {
      ok: true,
      message: 'وارد صفحهٔ رزرو شد و تا زمان اقدام در سایت باقی ماند.',
      sessionCookiesJson: JSON.stringify(opened.cookies),
      availableCreditRials: creditText ? parseRialsFromText(creditText) : undefined,
    };
  }

  async keepAliveStandbySession(creds: IutCredentials): Promise<StandbyResult> {
    this.lastCreds = creds;
    if (!this.standbyHandle) {
      return this.prepareStandbySession(creds, null);
    }

    const { page, context, hangToleranceMs } = this.standbyHandle;
    try {
      // Check liveness & recover automatically if CAS redirected or page stalled
      const alive = await page.evaluate(() => document.readyState).catch(() => null);
      if (!alive) {
        await this.releaseStandbySession();
        return this.prepareStandbySession(creds, null, {
          hangToleranceSeconds: Math.round(hangToleranceMs / 1000),
        });
      }

      if (page.url().includes('webauth.iut.ac.ir')) {
        const auth = await this.navigateAndAuthenticate(page, context, creds, hangToleranceMs);
        if (!auth.ok) {
          return {
            ok: false,
            errorCode: auth.errorCode,
            message: auth.errorMessage ?? 'نشست در زمان انتظار قطع شد.',
          };
        }
        return {
          ok: true,
          message: 'نشست مجدداً بازیابی و زنده نگه داشته شد.',
          sessionCookiesJson: JSON.stringify(auth.cookies),
        };
      }

      const cookies = await context.cookies([IUT_URLS.DINING_BASE, IUT_URLS.WEBAUTH_BASE]);
      return {
        ok: true,
        message: 'نشست داخل صفحهٔ رزرو زنده است.',
        sessionCookiesJson: JSON.stringify(cookies),
      };
    } catch {
      // Attempt full standby recreation on fatal handle failure
      await this.releaseStandbySession();
      return this.prepareStandbySession(creds, null, {
        hangToleranceSeconds: Math.round(hangToleranceMs / 1000),
      });
    }
  }

  async releaseStandbySession(): Promise<void> {
    if (this.standbyHandle) {
      const handle = this.standbyHandle;
      this.standbyHandle = null;
      await handle.browser.close().catch(() => undefined);
    }
  }

  async testLoginAndOpenReservationPage(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null
  ): Promise<LoginResult> {
    this.lastCreds = creds;
    try {
      const opened = await this.openAuthenticatedPage(creds, existingSessionCookiesJson, 45);
      if (opened.errorCode) {
        return {
          ok: false,
          errorCode: opened.errorCode,
          message: opened.errorMessage ?? 'خطای ورود',
          verification: {
            source: 'LIVE_IUT',
            ok: false,
            finalUrl: IUT_URLS.WEBAUTH_BASE,
            pageTitle: 'عدم موفقیت در ورود به سامانه دانشگاه',
          },
        };
      }

      try {
        await opened.page.waitForTimeout(1000);
        const extracted = await opened.page
          .evaluate(() => {
            const title = document.title || '';
            const bodyText = document.body?.innerText || '';
            const headerCandidate =
              document.querySelector(
                '[ng-bind*="FullName" i], [ng-bind*="UserName" i], [ng-bind*="Name" i], .user-name, .navbar-right, header'
              )?.textContent?.trim() || '';
            const creditMatch = /اعتبار[^\d۰-۹]*([\d۰-۹,،]+)/.exec(bodyText);
            const creditRaw = creditMatch ? creditMatch[1].replace(/[,،]/g, '') : '';
            const reservedRows = document.querySelectorAll(
              '.reserved-list tr, [ng-repeat*="Reserved" i]'
            ).length;
            return {
              title,
              headerCandidate: headerCandidate.slice(0, 120),
              creditRaw,
              reservedRows,
            };
          })
          .catch(() => ({
            title: '',
            headerCandidate: '',
            creditRaw: '',
            reservedRows: 0,
          }));

        const finalUrl = opened.page.url();
        const reservationPageOpened =
          finalUrl.includes('dining.iut.ac.ir') && !finalUrl.includes('/identity/login');
        const creditParsed = extracted.creditRaw ? parseRialsFromText(extracted.creditRaw) : undefined;

        return {
          ok: reservationPageOpened,
          message: reservationPageOpened
            ? 'ورود واقعی به سامانه تغذیه دانشگاه (dining.iut.ac.ir) انجام و صفحهٔ رزرو باز شد.'
            : 'پس از ورود، صفحهٔ رزرو باز نشد.',
          sessionCookiesJson: JSON.stringify(opened.cookies),
          availableCreditRials: creditParsed,
          reservationPageOpened,
          verification: {
            source: 'LIVE_IUT',
            ok: reservationPageOpened,
            finalUrl,
            pageTitle: extracted.title || 'سامانه تغذیه دانشگاه صنعتی اصفهان',
            studentBannerText: extracted.headerCandidate || undefined,
            availableCreditRials: creditParsed,
            reservedCountOnSite: extracted.reservedRows,
          },
        };
      } finally {
        await opened.browser.close().catch(() => undefined);
      }
    } catch (err) {
      return {
        ok: false,
        errorCode: isQuotaError(err) ? 'BROWSER_QUOTA' : 'NETWORK_ERROR',
        message: isQuotaError(err)
          ? 'سهمیه مرورگر Cloudflare به پایان رسیده است.'
          : err instanceof Error
            ? err.message
            : 'خطای اتصال به سامانه دانشگاه',
        verification: {
          source: 'LIVE_IUT',
          ok: false,
          finalUrl: IUT_URLS.DINING_BASE,
          pageTitle: 'خطای اتصال به سامانه',
        },
      };
    }
  }

  private async getPageForAction(
    sessionCookiesJson: string,
    hangToleranceSeconds = 45
  ): Promise<{
    page: PlaywrightPage;
    context?: PlaywrightBrowserContext;
    hangToleranceMs: number;
    shouldCloseBrowser: boolean;
    browser?: PlaywrightBrowser;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'BROWSER_QUOTA' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
  }> {
    if (this.standbyHandle) {
      // Self-heal crashed or closed standby tab automatically before doing action
      const alive = await this.standbyHandle.page
        .evaluate(() => document.readyState)
        .catch(() => null);
      if (alive) {
        return {
          page: this.standbyHandle.page,
          context: this.standbyHandle.context,
          hangToleranceMs: Math.max(15, hangToleranceSeconds) * 1000,
          shouldCloseBrowser: false,
        };
      }
      await this.releaseStandbySession();
      if (this.lastCreds) {
        const recovered = await this.prepareStandbySession(this.lastCreds, sessionCookiesJson, {
          hangToleranceSeconds,
        });
        if (recovered.ok && this.standbyHandle) {
          return {
            page: this.standbyHandle.page,
            context: this.standbyHandle.context,
            hangToleranceMs: Math.max(15, hangToleranceSeconds) * 1000,
            shouldCloseBrowser: false,
          };
        }
      }
    }

    const opened = await this.openAuthenticatedPage(
      this.lastCreds,
      sessionCookiesJson,
      hangToleranceSeconds
    );
    if (opened.errorCode) {
      return {
        page: undefined as unknown as PlaywrightPage,
        hangToleranceMs: Math.max(15, hangToleranceSeconds) * 1000,
        shouldCloseBrowser: false,
        errorCode: opened.errorCode,
        errorMessage: opened.errorMessage,
      };
    }
    return {
      page: opened.page,
      context: opened.context,
      hangToleranceMs: Math.max(15, hangToleranceSeconds) * 1000,
      shouldCloseBrowser: true,
      browser: opened.browser,
    };
  }

  async fetchReservationContext(
    sessionCookiesJson: string,
    targetDateJalali: string,
    retryOpts: {
      retryWindowSeconds: number;
      retryIntervalSeconds: number;
      hangToleranceSeconds?: number;
    }
  ): Promise<FetchContextResult> {
    const hangSec = retryOpts.hangToleranceSeconds ?? 45;
    const handle = await this.getPageForAction(sessionCookiesJson, hangSec);
    if (handle.errorCode) {
      return {
        ok: false,
        errorCode: handle.errorCode,
        message: handle.errorMessage ?? 'نشست منقضی شده است.',
        availableCreditRials: 0,
        reservedMeals: [],
        menu: [],
        attemptsUsed: 0,
      };
    }

    try {
      const deadline = Date.now() + Math.max(10, retryOpts.retryWindowSeconds) * 1000;
      const intervalMs = Math.max(1, retryOpts.retryIntervalSeconds) * 1000;
      let attemptsUsed = 0;

      while (true) {
        attemptsUsed += 1;

        const onDining = await this.ensureOnDiningPageIfRedirected(handle);
        if (!onDining) {
          return {
            ok: false,
            errorCode: 'AUTH_ERROR',
            message: 'نشست در حال اجرا منقضی شد و بازگشت خودکار به صفحه رزرو انجام نشد.',
            availableCreditRials: 0,
            reservedMeals: [],
            menu: [],
            attemptsUsed,
          };
        }

        await this.selectTargetDateOnPage(handle.page, targetDateJalali);

        const snapshot = await withHangRetry(async () => {
          return handle.page.evaluate<{
            creditRials: number;
            menu: MenuItem[];
            reservedMeals: ReservedMeal[];
          }, string>((targetDate: string) => {
            const bodyText = document.body.innerText || '';
            const creditMatch = /اعتبار[^\d۰-۹]*([\d۰-۹,،]+)/.exec(bodyText);
            const creditRials = creditMatch ? Number(creditMatch[1].replace(/[,،]/g, '')) : 0;

            const menu: MenuItem[] = [];
            const rows = Array.from(document.querySelectorAll('tr, .food-item, .meal-row'));
            rows.forEach((row, idx) => {
              const text = (row as HTMLElement).innerText || '';
              if (!text.includes('ناهار') && !text.includes('کاج') && !text.includes('آسمان')) {
                return;
              }
              const priceMatch = /([\d۰-۹,،]{5,9})\s*ریال/.exec(text);
              if (!priceMatch) return;
              const priceRials = Number(priceMatch[1].replace(/[,،]/g, ''));
              const hall =
                text.includes('مکمل کاج')
                  ? 'رستوران مکمل کاج'
                  : text.includes('تریا کاج')
                    ? 'تریا کاج'
                    : text.includes('آسمان')
                      ? 'رستوران آسمان'
                      : 'نامشخص';
              const firstLine = text.split('\n')[0]?.trim() || `غذا ${idx + 1}`;
              menu.push({
                id: `dom-${idx}`,
                name: firstLine,
                diningHall: hall,
                meal: 'lunch',
                priceRials,
                available: !text.includes('ناموجود') && !text.includes('تکمیل'),
                isPayAtLocation: text.includes('تسویه در محل'),
              });
            });

            const reservedMeals: ReservedMeal[] = [];
            const reservedRows = Array.from(
              document.querySelectorAll('.reserved-list tr, [ng-repeat*="Reserved" i]')
            );
            reservedRows.forEach((row) => {
              const text = (row as HTMLElement).innerText || '';
              const codeMatch = /([A-Z0-9-]{4,20})/.exec(text);
              if (!codeMatch) return;
              reservedMeals.push({
                reservationCode: codeMatch[1],
                targetDateJalali: targetDate,
                meal: 'lunch',
                mealLabel: 'ناهار',
                diningHall: text.includes('مکمل کاج')
                  ? 'رستوران مکمل کاج'
                  : text.includes('آسمان')
                    ? 'رستوران آسمان'
                    : 'تریا کاج',
                foodName: text.split('\n')[0]?.trim() || 'غذای رزرو شده',
                priceRials: 0,
                reservedAtJalali: targetDate,
                status: 'CONFIRMED',
              });
            });

            return { creditRials, menu, reservedMeals };
          }, targetDateJalali);
        }, 4);

        if (snapshot.menu.length > 0 || Date.now() >= deadline) {
          if (snapshot.menu.length === 0) {
            return {
              ok: false,
              errorCode: 'MENU_NOT_OPEN',
              message: `منوی تازه برای تاریخ ${targetDateJalali} در بازه زمانی ${retryOpts.retryWindowSeconds} ثانیه باز نشد.`,
              availableCreditRials: snapshot.creditRials,
              reservedMeals: snapshot.reservedMeals,
              menu: [],
              attemptsUsed,
            };
          }

          return {
            ok: true,
            message: 'منوی تازه و لیست رزروهای سامانه خوانده شد.',
            availableCreditRials: snapshot.creditRials,
            reservedMeals: snapshot.reservedMeals,
            menu: snapshot.menu,
            attemptsUsed,
          };
        }

        await handle.page.waitForTimeout(intervalMs);

        // Self-heal stalled Angular SPA: reload on even polls, hard hash-bounce #!/Dashboard -> #!/Reservation every 3rd poll
        if (attemptsUsed % 3 === 0) {
          await handle.page
            .goto(`${IUT_URLS.DINING_BASE}/#!/Dashboard`, {
              waitUntil: 'domcontentloaded',
              timeout: handle.hangToleranceMs,
            })
            .catch(() => undefined);
          await handle.page.waitForTimeout(350);
          await handle.page
            .goto(IUT_URLS.RESERVATION_PAGE, {
              waitUntil: 'domcontentloaded',
              timeout: handle.hangToleranceMs,
            })
            .catch(() => undefined);
        } else if (attemptsUsed % 2 === 0) {
          await handle.page
            .reload({ waitUntil: 'domcontentloaded', timeout: handle.hangToleranceMs })
            .catch(() =>
              handle.page.goto(IUT_URLS.RESERVATION_PAGE, {
                waitUntil: 'domcontentloaded',
                timeout: handle.hangToleranceMs,
              })
            );
        }
      }
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) {
        await handle.browser.close().catch(() => undefined);
      }
    }
  }

  async addToCartAndReadSummary(
    sessionCookiesJson: string,
    item: MenuItem,
    targetDateJalali: string
  ): Promise<AddToCartResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, 45);
    if (handle.errorCode) {
      return {
        ok: false,
        errorCode: handle.errorCode,
        message: handle.errorMessage ?? 'خطای نشست هنگام افزودن به سبد',
      };
    }

    try {
      const onDining = await this.ensureOnDiningPageIfRedirected(handle);
      if (!onDining) {
        return {
          ok: false,
          errorCode: 'AUTH_ERROR',
          message: 'نشست حین انتخاب غذا قطع شد و بازگشت خودکار موفق نبود.',
        };
      }

      await this.selectTargetDateOnPage(handle.page, targetDateJalali);

      const normTargetFood = normalizeForMatch(item.name);
      const added = await withHangRetry(async () => {
        return handle.page.evaluate<boolean, string>((targetFoodNorm: string) => {
          const rows = Array.from(document.querySelectorAll('tr, .food-item, .meal-row'));
          for (const row of rows) {
            const text = ((row as HTMLElement).innerText || '').replace(/\s+/g, '');
            if (text.includes(targetFoodNorm)) {
              const btn = row.querySelector('button, input[type="checkbox"], a, [ng-click]');
              if (btn) {
                (btn as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        }, normTargetFood);
      }, 4);

      if (!added) {
        return {
          ok: false,
          errorCode: 'NO_ELIGIBLE_FOOD',
          message: `دکمه انتخاب برای ${item.name} در صفحهٔ رزرو یافت نشد.`,
        };
      }

      await handle.page.waitForTimeout(700);

      const cart: CartSummary = {
        targetDateJalali,
        meal: item.meal,
        diningHall: item.diningHall,
        foodName: item.name,
        quantity: 1,
        priceRials: item.priceRials,
        paymentSource: 'UNIVERSITY_CREDIT',
      };

      return {
        ok: true,
        message: 'غذا به سبد اضافه شد.',
        cart,
      };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) {
        await handle.browser.close().catch(() => undefined);
      }
    }
  }

  async confirmPurchaseWithCredit(
    sessionCookiesJson: string,
    _cart: CartSummary
  ): Promise<ConfirmResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, 45);
    if (handle.errorCode) {
      return {
        ok: false,
        errorCode: handle.errorCode,
        message: handle.errorMessage ?? 'خطا در نشست هنگام تأیید خرید',
      };
    }

    try {
      const confirmBtn = handle.page
        .locator(
          'button:has-text("تایید"), button:has-text("ثبت نهایی"), button:has-text("ثبت"), button:has-text("پرداخت از اعتبار"), button:has-text("رزرو")'
        )
        .first();
      if ((await confirmBtn.count()) === 0) {
        return {
          ok: false,
          ambiguous: true,
          errorCode: 'AMBIGUOUS_NEED_CHECK',
          message: 'دکمه تأیید نهایی سبد یافت نشد؛ وضعیت گزارش رزروها بررسی می‌شود.',
        };
      }
      await confirmBtn.click({ timeout: Math.max(20000, handle.hangToleranceMs) });
      await handle.page.waitForTimeout(2200);
      return {
        ok: true,
        message: 'درخواست ثبت نهایی از محل اعتبار دانشگاه ارسال شد.',
      };
    } catch {
      return {
        ok: false,
        ambiguous: true,
        errorCode: 'AMBIGUOUS_NEED_CHECK',
        message:
          'پاسخ تأیید خرید به دلیل کندی یا هنگ سایت در زمان مقرر دریافت نشد؛ برای جلوگیری از خرید تکراری فقط گزارش رزروها بررسی می‌شود.',
      };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) {
        await handle.browser.close().catch(() => undefined);
      }
    }
  }

  async fetchReservedMealsReport(
    sessionCookiesJson: string,
    targetDateJalali: string
  ): Promise<ReservedReportResult> {
    const res = await this.fetchReservationContext(sessionCookiesJson, targetDateJalali, {
      retryWindowSeconds: 18,
      retryIntervalSeconds: 2,
      hangToleranceSeconds: 45,
    });
    const nowParts = utcMsToTehranParts(Date.now());
    return {
      ok: res.ok,
      errorCode: res.errorCode,
      message: res.ok
        ? `گزارش غذاهای رزرو شده در ساعت ${nowParts.tehranTime} بازخوانی شد.`
        : res.message,
      reservedMeals: res.reservedMeals,
      availableCreditRials: res.availableCreditRials,
    };
  }
}
