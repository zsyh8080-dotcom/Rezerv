import {
  addIutCart, authenticateIut, confirmIutCart, readIutContext,
  readIutCredit, readIutReport, selectIutDate,
} from './src/core/iut-dom';
import fs from 'node:fs';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from 'playwright-core';
import {
  getJalaliWeekday,
  normalizeAsciiDigits,
  toPersianDigits,
  utcMsToTehranParts,
} from './src/core/jalali';
import { normalizeForMatch } from './src/core/policy';
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
} from './src/core/site';
import type { CartSummary, MenuItem, ReservedMeal } from './src/core/types';

function findChromiumExecutable(): string | undefined {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const baseDir = '/ms-playwright';
  if (!fs.existsSync(baseDir)) return undefined;

  const candidates = fs.readdirSync(baseDir).sort().reverse();
  for (const dir of candidates) {
    const headlessShell = path.join(
      baseDir,
      dir,
      'chrome-headless-shell-linux64',
      'chrome-headless-shell'
    );
    if (fs.existsSync(headlessShell)) return headlessShell;

    const fullChrome = path.join(baseDir, dir, 'chrome-linux', 'chrome');
    if (fs.existsSync(fullChrome)) return fullChrome;
  }
  return undefined;
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
      if (attempt >= maxAttempts || !isTransientHangError(err)) {
        throw err;
      }
      const exp = Math.min(4500, Math.round(baseDelayMs * Math.pow(1.55, attempt - 1)));
      const jitter = Math.floor(Math.random() * 320);
      await new Promise((resolve) => setTimeout(resolve, exp + jitter));
    }
  }
  throw lastError;
}

interface WarmLocalHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  hangToleranceMs: number;
}

export class LocalBrowserIutClient implements IutSiteClient {
  private standbyHandle: WarmLocalHandle | null = null;
  private lastCreds: IutCredentials | null = null;

  private async launchChromium(): Promise<Browser> {
    const executablePath = findChromiumExecutable();
    return chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  private async configurePage(page: Page, allowImages: boolean): Promise<void> {
    await page
      .route('**/*', (route) => {
        const type = route.request().resourceType();
        const url = route.request().url().toLowerCase();
        if (
          type === 'media' ||
          (!allowImages && type === 'image' && !url.includes('captcha')) ||
          url.includes('analytics') ||
          url.includes('googletagmanager')
        ) {
          return route.abort();
        }
        return route.continue();
      })
      .catch(() => undefined);
  }

  private async navigateAndAuthenticate(
    page: Page, context: BrowserContext, creds: IutCredentials | null, hangToleranceMs: number
  ): Promise<{
    ok: boolean;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
    lastUrl: string;
    lastTitle: string;
    bannerHint?: string;
    cookies: Cookie[];
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
    hangToleranceSeconds = 45,
    allowImages = false
  ): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
    cookies: Cookie[];
    lastUrl?: string;
    lastTitle?: string;
    bannerHint?: string;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
  }> {
    if (creds && creds.username && creds.password) {
      this.lastCreds = creds;
    }

    const hangToleranceMs = Math.max(15, hangToleranceSeconds) * 1000;
    const browser = await withHangRetry(() => this.launchChromium(), 2, 500);
    const context = await browser.newContext({
      locale: 'fa-IR',
      timezoneId: 'Asia/Tehran',
      viewport: { width: 1280, height: 800 },
    });

    if (existingSessionCookiesJson) {
      try {
        const parsed = JSON.parse(existingSessionCookiesJson) as Cookie[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          await context.addCookies(parsed);
        }
      } catch {
        // Ignore bad cached cookies
      }
    }

    const page = await context.newPage();
    await this.configurePage(page, allowImages);

    try {
      const auth = await this.navigateAndAuthenticate(page, context, creds, hangToleranceMs);
      if (!auth.ok) {
        await browser.close().catch(() => undefined);
        return {
          browser: undefined as unknown as Browser,
          context: undefined as unknown as BrowserContext,
          page: undefined as unknown as Page,
          cookies: [],
          lastUrl: auth.lastUrl,
          lastTitle: auth.lastTitle,
          bannerHint: auth.bannerHint,
          errorCode: auth.errorCode ?? 'NETWORK_ERROR',
          errorMessage: auth.errorMessage,
        };
      }
      return {
        browser,
        context,
        page,
        cookies: auth.cookies,
        lastUrl: auth.lastUrl,
        lastTitle: auth.lastTitle,
      };
    } catch (err) {
      await browser.close().catch(() => undefined);
      return {
        browser: undefined as unknown as Browser,
        context: undefined as unknown as BrowserContext,
        page: undefined as unknown as Page,
        cookies: [],
        lastUrl: IUT_URLS.DINING_BASE,
        lastTitle: 'خطای اتصال به سایت دانشگاه',
        errorCode: 'NETWORK_ERROR',
        errorMessage:
          err instanceof Error
            ? `خطای اتصال یا تاخیر شدید سایت دانشگاه: ${err.message}`
            : 'خطای اتصال به سامانه دانشگاه',
      };
    }
  }

  async testLoginAndOpenReservationPage(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null
  ): Promise<LoginResult> {
    this.lastCreds = creds;
    try {
      const opened = await this.openAuthenticatedPage(
        creds,
        existingSessionCookiesJson,
        45,
        true
      );
      if (opened.errorCode) {
        return {
          ok: false,
          errorCode: opened.errorCode,
          message: opened.errorMessage ?? 'خطا در ورود به سامانه دانشگاه',
          verification: {
            source: 'LIVE_IUT',
            ok: false,
            finalUrl: opened.lastUrl ?? IUT_URLS.WEBAUTH_BASE,
            pageTitle: opened.lastTitle || 'عدم موفقیت در ورود به سایت دانشگاه',
            studentBannerText: opened.bannerHint,
          },
        };
      }

      try {
        // Wait for AngularJS view / credit / menu data to hydrate on dining.iut.ac.ir
        await opened.page.waitForTimeout(1600);

        const extracted = await opened.page
          .evaluate(() => {
            const title = document.title || '';
            const bodyText = (document.body?.innerText || '').trim();

            const bannerEl = document.querySelector(
              '[ng-bind*="FullName" i], [ng-bind*="Name" i], [ng-bind*="UserName" i], .user-name, .navbar-right, .user-info, header'
            );
            const bannerRaw = (bannerEl?.textContent || '').replace(/\s+/g, ' ').trim();

            // Setareh shows e.g. "2,530,000 ریال" in navbar/header; support both "اعتبار ..." and "... ریال/تومان"
            const creditElText =
              document
                .querySelector('[ng-bind*="Credit" i], [ng-bind*="Balance" i], .credit, .balance')
                ?.textContent?.trim() || '';
            const rialMatch =
              /([\d۰-۹,،]{4,12})\s*ریال/.exec(bannerRaw) ||
              /([\d۰-۹,،]{4,12})\s*ریال/.exec(bodyText);
            const tomanMatch =
              !rialMatch
                ? /([\d۰-۹,،]{3,9})\s*تومان/.exec(bannerRaw) ||
                  /([\d۰-۹,،]{3,9})\s*تومان/.exec(bodyText)
                : null;
            const labelMatch = /(?:اعتبار|موجودی)[^\d۰-۹]{0,16}([\d۰-۹,،]+)/.exec(bodyText);

            const creditCandidate =
              creditElText ||
              (rialMatch ? rialMatch[1] : '') ||
              (labelMatch ? labelMatch[1] : '');
            const creditIsToman = !creditElText && !rialMatch && Boolean(tomanMatch);
            const creditTomanCandidate = tomanMatch ? tomanMatch[1] : '';

            const reservedRows = document.querySelectorAll(
              '.reserved-list tr, [ng-repeat*="Reserved" i]'
            ).length;

            const dishTexts: string[] = [];
            document.querySelectorAll('tr, .food-item, .meal-row, .card').forEach((node) => {
              if (dishTexts.length >= 4) return;
              const line = ((node as HTMLElement).innerText || '').split('\n')[0]?.trim() || '';
              if (
                line.length >= 4 &&
                line.length <= 60 &&
                (line.includes('چلو') ||
                  line.includes('خورش') ||
                  line.includes('کباب') ||
                  line.includes('مرغ') ||
                  line.includes('ماکارونی') ||
                  line.includes('پلو') ||
                  line.includes('قیمه') ||
                  line.includes('ناهار') ||
                  line.includes('کاج') ||
                  line.includes('آسمان')) &&
                !dishTexts.includes(line)
              ) {
                dishTexts.push(line);
              }
            });

            return {
              title,
              banner: bannerRaw.slice(0, 120),
              creditCandidate,
              creditIsToman,
              creditTomanCandidate,
              reservedRows,
              dishTexts,
              bodyExcerpt: bodyText.slice(0, 160),
            };
          })
          .catch(() => ({
            title: '',
            banner: '',
            creditCandidate: '',
            creditIsToman: false,
            creditTomanCandidate: '',
            reservedRows: 0,
            dishTexts: [] as string[],
            bodyExcerpt: '',
          }));

        const finalUrl = opened.page.url();
        const isOnDining =
          finalUrl.includes('dining.iut.ac.ir') &&
          !finalUrl.includes('/identity/login') &&
          !finalUrl.includes('webauth.iut.ac.ir');

        let screenshotDataUrl: string | undefined;
        if (isOnDining) {
          const buf = await opened.page
            .screenshot({ type: 'jpeg', quality: 65 })
            .catch(() => null);
          if (buf) {
            screenshotDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
        }

        const creditRials = await readIutCredit(opened.page);

        return {
          ok: isOnDining,
          message: isOnDining
            ? 'ورود واقعی به سامانه تغذیه دانشگاه (dining.iut.ac.ir) تأیید شد و صفحهٔ رزرو باز گردید.'
            : 'صفحه به بخش رزرو منتقل نشد.',
          sessionCookiesJson: JSON.stringify(opened.cookies),
          availableCreditRials:
            typeof creditRials === 'number' && creditRials > 0 ? creditRials : undefined,
          reservationPageOpened: isOnDining,
          verification: {
            source: 'LIVE_IUT',
            ok: isOnDining,
            finalUrl,
            pageTitle: extracted.title || 'سامانه تغذیه دانشگاه صنعتی اصفهان',
            studentBannerText:
              extracted.banner ||
              (extracted.bodyExcerpt
                ? extracted.bodyExcerpt.replace(/\s+/g, ' ').slice(0, 90)
                : undefined),
            availableCreditRials:
              typeof creditRials === 'number' && creditRials > 0 ? creditRials : undefined,
            reservedCountOnSite: extracted.reservedRows,
            sampleDishes: extracted.dishTexts.length > 0 ? extracted.dishTexts : undefined,
            screenshotDataUrl,
          },
        };
      } finally {
        await opened.browser.close().catch(() => undefined);
      }
    } catch (err) {
      return {
        ok: false,
        errorCode: 'NETWORK_ERROR',
        message:
          err instanceof Error
            ? `خطای اتصال واقعی به سایت دانشگاه: ${err.message}`
            : 'خطای اتصال واقعی به سامانه دانشگاه',
        verification: {
          source: 'LIVE_IUT',
          ok: false,
          finalUrl: IUT_URLS.DINING_BASE,
          pageTitle: 'خطای اتصال به سایت دانشگاه',
        },
      };
    }
  }

  private async selectTargetDateOnPage(page: Page, targetDateJalali: string): Promise<void> {
    await selectIutDate(page, targetDateJalali);
  }

  private async ensureOnDiningPageIfRedirected(handle: {
    page: Page;
    context?: BrowserContext;
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
    const opened = await this.openAuthenticatedPage(
      creds,
      existingSessionCookiesJson,
      hangSec,
      false
    );
    if (opened.errorCode) {
      return {
        ok: false,
        errorCode: opened.errorCode,
        message: opened.errorMessage ?? 'خطا در آماده‌سازی نشست داخل سامانه دانشگاه',
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
      message: 'وارد صفحهٔ رزرو دانشگاه شد و تا زمان اقدام داخل سایت باقی ماند.',
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
      const alive = await page.evaluate(() => document.readyState).catch(() => null);
      if (!alive) {
        await this.releaseStandbySession();
        return this.prepareStandbySession(creds, null, {
          hangToleranceSeconds: Math.round(hangToleranceMs / 1000),
        });
      }

      if (page.url().includes('webauth.iut.ac.ir') || page.url().includes('/identity/login')) {
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
          message: 'نشست داخل سامانه دانشگاه مجدداً بازیابی شد.',
          sessionCookiesJson: JSON.stringify(auth.cookies),
        };
      }

      const cookies = await context.cookies([IUT_URLS.DINING_BASE, IUT_URLS.WEBAUTH_BASE]);
      return {
        ok: true,
        message: 'نشست داخل صفحهٔ رزرو دانشگاه زنده است.',
        sessionCookiesJson: JSON.stringify(cookies),
      };
    } catch {
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

  private async getPageForAction(
    sessionCookiesJson: string,
    hangToleranceSeconds = 45
  ): Promise<{
    page: Page;
    context?: BrowserContext;
    hangToleranceMs: number;
    shouldCloseBrowser: boolean;
    browser?: Browser;
    errorCode?: 'AUTH_ERROR' | 'CAPTCHA_REQUIRED' | 'MISSING_CREDENTIALS' | 'NETWORK_ERROR';
    errorMessage?: string;
  }> {
    if (this.standbyHandle) {
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
      hangToleranceSeconds,
      false
    );
    if (opened.errorCode) {
      return {
        page: undefined as unknown as Page,
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
