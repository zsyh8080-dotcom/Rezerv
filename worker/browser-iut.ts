import {
  addIutCart, authenticateIut, confirmIutCart, readIutContext,
  readIutCredit, readIutReport, selectIutDate,
} from '../src/core/iut-dom';
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
    page: PlaywrightPage, context: PlaywrightBrowserContext, creds: IutCredentials | null, hangToleranceMs: number
  ): Promise<{
    ok: boolean;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
    lastUrl: string;
    lastTitle: string;
    bannerHint?: string;
    cookies: PlaywrightCookie[];
  }> {
    try {
      const cookies = await authenticateIut(page, context, creds, hangToleranceMs);
      return {
        ok: true, cookies,
        lastUrl: IUT_URLS.RESERVATION_PAGE,
        lastTitle: await page.title(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'اتصال دانشگاه برقرار نشد.';
      const errorCode = message.includes('CAPTCHA_REQUIRED') ? 'CAPTCHA_REQUIRED'
        : message.includes('MISSING_CREDENTIALS') ? 'MISSING_CREDENTIALS'
        : new URL(page.url()).origin === 'https://webauth.iut.ac.ir' ? 'AUTH_ERROR'
        : 'NETWORK_ERROR';
      return {
        ok: false, errorCode,
        errorMessage: message.replace(/https?:\/\/[^\s]+/g, '[نشانی سامانه]'),
        cookies: [], lastUrl: IUT_URLS.DINING_BASE,
        lastTitle: await page.title().catch(() => ''),
      };
    }
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
    await selectIutDate(page, targetDateJalali);
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
        const creditParsed = await readIutCredit(opened.page);

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
    retryOpts: { retryWindowSeconds: number; retryIntervalSeconds: number; hangToleranceSeconds?: number }
  ): Promise<FetchContextResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, retryOpts.hangToleranceSeconds ?? 45);
    if (handle.errorCode) {
      return { ok: false, errorCode: handle.errorCode, message: handle.errorMessage ?? 'نشست ورود معتبر نیست.',
        availableCreditRials: 0, reservedMeals: [], menu: [], attemptsUsed: 0 };
    }
    let attemptsUsed = 0;
    try {
      const deadline = Date.now() + Math.max(0, retryOpts.retryWindowSeconds) * 1000;
      while (true) {
        attemptsUsed += 1;
        if (!await this.ensureOnDiningPageIfRedirected(handle)) {
          return { ok: false, errorCode: 'AUTH_ERROR', message: 'نشست دانشگاه منقضی شده است.',
            availableCreditRials: 0, reservedMeals: [], menu: [], attemptsUsed };
        }
        const snapshot = await readIutContext(handle.page, targetDateJalali);
        if (snapshot.menu.length || snapshot.reservedMeals.length) {
          return { ok: true, message: 'منوی انتخابی و گزارش رزرو دانشگاه خوانده شد.', ...snapshot, attemptsUsed };
        }
        if (Date.now() >= deadline) {
          return { ok: false, errorCode: 'MENU_NOT_OPEN', message: 'منوی ناهار تاریخ انتخاب‌شده هنوز باز نشده است.',
            ...snapshot, attemptsUsed };
        }
        await handle.page.waitForTimeout(Math.max(4000, retryOpts.retryIntervalSeconds * 1000));
        await handle.page.reload({ waitUntil: 'domcontentloaded', timeout: handle.hangToleranceMs });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خواندن برنامهٔ غذا ناموفق بود.';
      return { ok: false, errorCode: 'NETWORK_ERROR',
        message: message.replace(/https?:\/\/[^\s]+/g, '[نشانی سامانه]'),
        availableCreditRials: 0, reservedMeals: [], menu: [], attemptsUsed };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) await handle.browser.close().catch(() => undefined);
    }
  }

  async addToCartAndReadSummary(
    sessionCookiesJson: string, item: MenuItem, targetDateJalali: string
  ): Promise<AddToCartResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, 45);
    if (handle.errorCode) return { ok: false, errorCode: handle.errorCode, message: handle.errorMessage ?? 'نشست ورود معتبر نیست.' };
    try {
      const cart = await addIutCart(handle.page, item, targetDateJalali);
      return { ok: true, message: 'غذای انتخاب‌شده در سبد دانشگاه دیده شد.', cart };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'نتیجهٔ افزودن به سبد مشخص نیست.';
      return { ok: false, errorCode: 'AMBIGUOUS_NEED_CHECK',
        message: message.replace(/https?:\/\/[^\s]+/g, '[نشانی سامانه]') };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) await handle.browser.close().catch(() => undefined);
    }
  }

  async confirmPurchaseWithCredit(sessionCookiesJson: string, cart: CartSummary): Promise<ConfirmResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, 45);
    if (handle.errorCode) return { ok: false, errorCode: handle.errorCode, message: handle.errorMessage ?? 'نشست ورود معتبر نیست.' };
    try {
      await confirmIutCart(handle.page, cart);
      return { ok: true, message: 'درخواست تأیید ارسال شد و رسید دانشگاه بررسی می‌شود.' };
    } catch {
      return { ok: false, ambiguous: true, errorCode: 'AMBIGUOUS_NEED_CHECK',
        message: 'نتیجهٔ تأیید مشخص نیست. وضعیت فقط از گزارش رزروهای دانشگاه بررسی می‌شود.' };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) await handle.browser.close().catch(() => undefined);
    }
  }

  async fetchReservedMealsReport(sessionCookiesJson: string, targetDateJalali: string): Promise<ReservedReportResult> {
    const handle = await this.getPageForAction(sessionCookiesJson, 45);
    if (handle.errorCode) return { ok: false, errorCode: handle.errorCode, message: handle.errorMessage ?? 'نشست ورود معتبر نیست.', reservedMeals: [] };
    try {
      const reservedMeals = await readIutReport(handle.page, targetDateJalali);
      return { ok: true, message: 'گزارش واقعی رزروهای دانشگاه خوانده شد.', reservedMeals,
        availableCreditRials: await readIutCredit(handle.page) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'گزارش دانشگاه خوانده نشد.';
      return { ok: false, errorCode: 'NETWORK_ERROR', reservedMeals: [],
        message: message.replace(/https?:\/\/[^\s]+/g, '[نشانی سامانه]') };
    } finally {
      if (handle.shouldCloseBrowser && handle.browser) await handle.browser.close().catch(() => undefined);
    }
  }
}
