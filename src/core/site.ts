import { utcMsToTehranParts } from './jalali';
import type {
  CartSummary,
  ErrorCode,
  ExecutionRecord,
  LoginVerificationProof,
  MenuItem,
  ReservedMeal,
  SandboxScenario,
} from './types';

export const IUT_URLS = {
  DINING_BASE: 'https://dining.iut.ac.ir',
  RESERVATION_PAGE: 'https://dining.iut.ac.ir/#!/Reservation',
  WEBAUTH_BASE: 'https://webauth.iut.ac.ir',
} as const;

export interface IutCredentials {
  username: string;
  password: string;
}

export interface LoginResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message: string;
  sessionCookiesJson?: string;
  availableCreditRials?: number;
  reservationPageOpened?: boolean;
  verification?: Omit<
    LoginVerificationProof,
    'verifiedAtUtcMs' | 'verifiedAtJalali' | 'verifiedAtTehranTime'
  >;
}

export interface FetchContextResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message: string;
  availableCreditRials: number;
  reservedMeals: ReservedMeal[];
  menu: MenuItem[];
  attemptsUsed: number;
}

export interface AddToCartResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message: string;
  cart?: CartSummary;
}

export interface ConfirmResult {
  ok: boolean;
  ambiguous?: boolean;
  errorCode?: ErrorCode;
  message: string;
}

export interface ReservedReportResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message: string;
  reservedMeals: ReservedMeal[];
  availableCreditRials?: number;
}

export interface StandbyResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message: string;
  sessionCookiesJson?: string;
  availableCreditRials?: number;
}

export interface IutSiteClient {
  testLoginAndOpenReservationPage(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null
  ): Promise<LoginResult>;

  prepareStandbySession?(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null,
    opts?: { hangToleranceSeconds?: number }
  ): Promise<StandbyResult>;

  keepAliveStandbySession?(creds: IutCredentials): Promise<StandbyResult>;

  releaseStandbySession?(): Promise<void>;

  fetchReservationContext(
    sessionCookiesJson: string,
    targetDateJalali: string,
    retryOpts: {
      retryWindowSeconds: number;
      retryIntervalSeconds: number;
      hangToleranceSeconds?: number;
    }
  ): Promise<FetchContextResult>;

  addToCartAndReadSummary(
    sessionCookiesJson: string,
    item: MenuItem,
    targetDateJalali: string
  ): Promise<AddToCartResult>;

  confirmPurchaseWithCredit(
    sessionCookiesJson: string,
    cart: CartSummary
  ): Promise<ConfirmResult>;

  fetchReservedMealsReport(
    sessionCookiesJson: string,
    targetDateJalali: string
  ): Promise<ReservedReportResult>;
}

export interface SandboxLedger {
  scenario: SandboxScenario;
  creditRials: number;
  reservedMeals: ReservedMeal[];
}

export function createSandboxSeedHistory(): {
  reservedMeals: ReservedMeal[];
  history: ExecutionRecord[];
} {
  return {
    reservedMeals: [
      {
        reservationCode: 'IUT-1405-71204',
        targetDateJalali: '1405/07/21',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'تریا کاج',
        foodName: 'ماکارونی با سویا و سالاد',
        priceRials: 345000,
        reservedAtJalali: '1405/07/17 20:30',
        status: 'CONFIRMED',
      },
      {
        reservationCode: 'IUT-1405-72891',
        targetDateJalali: '1405/07/28',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'رستوران مکمل کاج',
        foodName: 'زرشک‌پلو با اکبرجوجه',
        priceRials: 490000,
        reservedAtJalali: '1405/07/24 20:30',
        status: 'CONFIRMED',
      },
      {
        reservationCode: 'IUT-1405-80112',
        targetDateJalali: '1405/08/05',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'تریا کاج',
        foodName: 'لوبیاپلو با ماست',
        priceRials: 340000,
        reservedAtJalali: '1405/08/01 20:30',
        status: 'CONFIRMED',
      },
      {
        reservationCode: 'IUT-1405-81450',
        targetDateJalali: '1405/08/12',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'رستوران آسمان',
        foodName: 'جوجه‌کباب با برنج',
        priceRials: 500000,
        reservedAtJalali: '1405/08/08 20:30',
        status: 'CONFIRMED',
      },
      {
        reservationCode: 'IUT-1405-82219',
        targetDateJalali: '1405/08/16',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'تریا کاج',
        foodName: 'دمپختک با سالاد',
        priceRials: 330000,
        reservedAtJalali: '1405/08/12 20:30',
        status: 'CANCELLED',
      },
      {
        reservationCode: 'IUT-1405-83904',
        targetDateJalali: '1405/08/19',
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'تریا کاج',
        foodName: 'ماکارونی با سویا و سالاد',
        priceRials: 345000,
        reservedAtJalali: '1405/08/15 20:30',
        status: 'CONFIRMED',
      },
    ],
    history: [
      {
        id: 'seed-missed-0825',
        trigger: 'SCHEDULED',
        status: 'FAILED',
        startedAtUtcMs: Date.UTC(2026, 10, 12, 17, 0, 0),
        startedAtJalali: '1405/08/21',
        startedAtTehranTime: '20:30:02',
        targetDateJalali: '1405/08/25',
        message: 'غذای مجاز در سلف‌های انتخابی یافت نشد (غذاهای موجود در فهرست ممنوع بودند).',
        errorCode: 'NO_ELIGIBLE_FOOD',
      },
      {
        id: 'seed-ok-0819',
        trigger: 'SCHEDULED',
        status: 'RESERVED',
        startedAtUtcMs: Date.UTC(2026, 10, 6, 17, 0, 0),
        startedAtJalali: '1405/08/15',
        startedAtTehranTime: '20:30:04',
        targetDateJalali: '1405/08/19',
        message: 'ناهار ماکارونی با سویا و سالاد در تریا کاج با کد IUT-1405-83904 ثبت شد.',
      },
    ],
  };
}

export function buildSandboxMenuForScenario(scenario: SandboxScenario): MenuItem[] {
  if (scenario === 'forbidden_only') {
    return [
      {
        id: 'f-1',
        name: 'چلوکباب کوبیده',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 350000,
        available: true,
      },
      {
        id: 'f-2',
        name: 'عدس پلو با گوشت',
        diningHall: 'رستوران مکمل کاج',
        meal: 'lunch',
        priceRials: 320000,
        available: true,
      },
      {
        id: 'f-3',
        name: 'چلومرغ زعفرانی',
        diningHall: 'رستوران آسمان',
        meal: 'lunch',
        priceRials: 450000,
        available: true,
      },
      {
        id: 'f-4',
        name: 'خورش قيمه سیب زمینی',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 340000,
        available: true,
      },
    ];
  }

  if (scenario === 'only_50k_available') {
    return [
      {
        id: 'e-1',
        name: 'چلوکباب کوبیده',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 350000,
        available: true,
      },
      {
        id: 'e-2',
        name: 'جوجه‌کباب با برنج',
        diningHall: 'رستوران مکمل کاج',
        meal: 'lunch',
        priceRials: 500000,
        available: true,
      },
      {
        id: 'e-3',
        name: 'زرشک‌پلو با ران بوقلمون',
        diningHall: 'رستوران آسمان',
        meal: 'lunch',
        priceRials: 580000,
        available: true,
      },
      {
        id: 'e-4',
        name: 'انتخاب و تسویه در محل',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 350000,
        available: true,
        isPayAtLocation: true,
      },
    ];
  }

  if (scenario === 'pay_at_location_only') {
    return [
      {
        id: 'p-1',
        name: 'چلو‌مرغ',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 350000,
        available: true,
      },
      {
        id: 'p-2',
        name: 'انتخاب و تسویه در محل',
        diningHall: 'تریا کاج',
        meal: 'lunch',
        priceRials: 350000,
        available: true,
        isPayAtLocation: true,
      },
    ];
  }

  return [
    {
      id: 'm-1',
      name: 'چلوکباب کوبیده',
      diningHall: 'تریا کاج',
      meal: 'lunch',
      priceRials: 330000,
      available: true,
    },
    {
      id: 'm-2',
      name: 'عدس‌پلو',
      diningHall: 'رستوران مکمل کاج',
      meal: 'lunch',
      priceRials: 280000,
      available: true,
    },
    {
      id: 'm-3',
      name: 'چلو مرغ',
      diningHall: 'رستوران آسمان',
      meal: 'lunch',
      priceRials: 340000,
      available: true,
    },
    {
      id: 'm-4',
      name: 'خورش قیمه',
      diningHall: 'تریا کاج',
      meal: 'lunch',
      priceRials: 310000,
      available: true,
    },
    {
      id: 'm-5',
      name: 'زرشک‌پلو با اکبرجوجه',
      diningHall: 'رستوران مکمل کاج',
      meal: 'lunch',
      priceRials: 490000,
      available: true,
    },
    {
      id: 'm-6',
      name: 'ماکارونی با سویا و سالاد',
      diningHall: 'تریا کاج',
      meal: 'lunch',
      priceRials: 345000,
      available: true,
    },
    {
      id: 'm-7',
      name: 'خوراک شنیسل مرغ',
      diningHall: 'سلف مرکزی (غیرمجاز)',
      meal: 'lunch',
      priceRials: 290000,
      available: true,
    },
    {
      id: 'm-8',
      name: 'انتخاب و تسویه در محل',
      diningHall: 'تریا کاج',
      meal: 'lunch',
      priceRials: 350000,
      available: true,
      isPayAtLocation: true,
    },
  ];
}

export class SandboxIutSiteClient implements IutSiteClient {
  private ledger: SandboxLedger;
  private delayedPollCount = 0;
  private standbyActive = false;

  constructor(ledger: SandboxLedger) {
    this.ledger = ledger;
  }

  async prepareStandbySession(
    creds: IutCredentials,
    existingSessionCookiesJson?: string | null
  ): Promise<StandbyResult> {
    const login = await this.testLoginAndOpenReservationPage(creds, existingSessionCookiesJson);
    if (!login.ok) {
      this.standbyActive = false;
      return {
        ok: false,
        errorCode: login.errorCode,
        message: login.message,
      };
    }
    this.standbyActive = true;
    return {
      ok: true,
      message: 'نشست در صفحهٔ رزرو باز شد و در حالت آماده‌باش باقی ماند.',
      sessionCookiesJson: login.sessionCookiesJson,
      availableCreditRials: login.availableCreditRials,
    };
  }

  async keepAliveStandbySession(creds: IutCredentials): Promise<StandbyResult> {
    if (!this.standbyActive) {
      return this.prepareStandbySession(creds, null);
    }
    return {
      ok: true,
      message: 'نشست داخل سامانه زنده است و صفحهٔ رزرو فعال باقی ماند.',
      availableCreditRials:
        this.ledger.scenario === 'insufficient_credit' ? 120000 : this.ledger.creditRials,
    };
  }

  async releaseStandbySession(): Promise<void> {
    this.standbyActive = false;
  }

  async testLoginAndOpenReservationPage(
    creds: IutCredentials,
    _existingSessionCookiesJson?: string | null
  ): Promise<LoginResult> {
    if (!creds.username.trim() || !creds.password.trim()) {
      return {
        ok: false,
        errorCode: 'MISSING_CREDENTIALS',
        message: 'نام کاربری یا رمز عبور سامانه دانشگاه وارد نشده است.',
        verification: {
          source: 'SANDBOX_SIMULATION',
          ok: false,
          finalUrl: 'sandbox://webauth.iut.ac.ir',
          pageTitle: 'شبیه‌ساز محلی (Sandbox)',
        },
      };
    }

    if (this.ledger.scenario === 'auth_error') {
      return {
        ok: false,
        errorCode: 'AUTH_ERROR',
        message: 'نام کاربری یا رمز عبور سامانه دانشگاه اشتباه است (شبیه‌ساز).',
        verification: {
          source: 'SANDBOX_SIMULATION',
          ok: false,
          finalUrl: 'sandbox://webauth.iut.ac.ir/cas/login',
          pageTitle: 'شبیه‌ساز خطای احراز هویت',
        },
      };
    }

    if (this.ledger.scenario === 'captcha_required') {
      return {
        ok: false,
        errorCode: 'CAPTCHA_REQUIRED',
        message: 'سامانه ورود مرکزی درخواست کپچا کرده است؛ ورود خودکار متوقف شد (شبیه‌ساز).',
        verification: {
          source: 'SANDBOX_SIMULATION',
          ok: false,
          finalUrl: 'sandbox://webauth.iut.ac.ir/cas/login',
          pageTitle: 'شبیه‌ساز کپچا',
        },
      };
    }

    if (this.ledger.scenario === 'browser_quota') {
      return {
        ok: false,
        errorCode: 'BROWSER_QUOTA',
        message: 'سهمیه اجرای مرورگر سرور موقتاً پر شده است (شبیه‌ساز).',
        verification: {
          source: 'SANDBOX_SIMULATION',
          ok: false,
          finalUrl: 'sandbox://quota-limit',
          pageTitle: 'شبیه‌ساز محدودیت مرورگر',
        },
      };
    }

    const credit =
      this.ledger.scenario === 'insufficient_credit'
        ? 120000 // 12,000 Toman
        : this.ledger.creditRials;

    const sampleMenu = buildSandboxMenuForScenario(this.ledger.scenario)
      .slice(0, 3)
      .map((m) => m.name);

    return {
      ok: true,
      message:
        'تست در حالت شبیه‌ساز آزمایشی (Sandbox) موفق بود — توجه: هنوز به سایت واقعی دانشگاه متصل نشده است.',
      sessionCookiesJson: JSON.stringify({
        sandboxSession: true,
        user: creds.username,
        issuedAt: Date.now(),
      }),
      availableCreditRials: credit,
      reservationPageOpened: true,
      verification: {
        source: 'SANDBOX_SIMULATION',
        ok: true,
        finalUrl: 'sandbox://dining.iut.ac.ir/#!/Reservation',
        pageTitle: 'شبیه‌ساز محلی سلف‌یار (آزمایشی)',
        studentBannerText: `حساب آزمایشی ${creds.username} (متصل به سایت واقعی نیست)`,
        availableCreditRials: credit,
        reservedCountOnSite: this.ledger.reservedMeals.length,
        sampleDishes: sampleMenu,
      },
    };
  }

  async fetchReservationContext(
    _sessionCookiesJson: string,
    _targetDateJalali: string,
    retryOpts: { retryWindowSeconds: number; retryIntervalSeconds: number }
  ): Promise<FetchContextResult> {
    if (this.ledger.scenario === 'browser_quota') {
      return {
        ok: false,
        errorCode: 'BROWSER_QUOTA',
        message: 'سهمیه مرورگر Cloudflare در حال خواندن منو به پایان رسید.',
        availableCreditRials: this.ledger.creditRials,
        reservedMeals: this.ledger.reservedMeals,
        menu: [],
        attemptsUsed: 1,
      };
    }

    if (this.ledger.scenario === 'menu_delayed') {
      this.delayedPollCount += 1;
      if (this.delayedPollCount < 2) {
        // Simulate polling inside the short retry window until menu opens
        const maxAttempts = Math.max(
          2,
          Math.min(4, Math.floor(retryOpts.retryWindowSeconds / Math.max(1, retryOpts.retryIntervalSeconds)))
        );
        return {
          ok: true,
          message: 'منوی تازه پس از ۲ بار بازخوانی دریافت شد.',
          availableCreditRials: this.ledger.creditRials,
          reservedMeals: [...this.ledger.reservedMeals],
          menu: buildSandboxMenuForScenario('normal'),
          attemptsUsed: Math.min(2, maxAttempts),
        };
      }
    }

    const credit =
      this.ledger.scenario === 'insufficient_credit'
        ? 120000
        : this.ledger.creditRials;

    return {
      ok: true,
      message: 'منوی تازه و فهرست غذاهای رزرو شده با موفقیت خوانده شد.',
      availableCreditRials: credit,
      reservedMeals: [...this.ledger.reservedMeals],
      menu: buildSandboxMenuForScenario(this.ledger.scenario),
      attemptsUsed: 1,
    };
  }

  async addToCartAndReadSummary(
    _sessionCookiesJson: string,
    item: MenuItem,
    targetDateJalali: string
  ): Promise<AddToCartResult> {
    return {
      ok: true,
      message: 'غذا به سبد خرید اضافه شد و مشخصات سبد برای تطبیق خوانده شد.',
      cart: {
        targetDateJalali,
        meal: item.meal,
        diningHall: item.diningHall,
        foodName: item.name,
        quantity: 1,
        priceRials: item.priceRials,
        paymentSource: 'UNIVERSITY_CREDIT',
      },
    };
  }

  async confirmPurchaseWithCredit(
    _sessionCookiesJson: string,
    cart: CartSummary
  ): Promise<ConfirmResult> {
    if (this.ledger.scenario === 'ambiguous_timeout_success') {
      // Simulate that the server actually recorded the reservation despite client timeout
      const nowParts = utcMsToTehranParts(Date.now());
      const code = `IUT-${nowParts.jy}-${Math.floor(10000 + Math.random() * 89999)}`;
      this.ledger.creditRials = Math.max(0, this.ledger.creditRials - cart.priceRials);
      this.ledger.reservedMeals.unshift({
        reservationCode: code,
        targetDateJalali: cart.targetDateJalali,
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: cart.diningHall,
        foodName: cart.foodName,
        priceRials: cart.priceRials,
        reservedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
        status: 'CONFIRMED',
      });
      return {
        ok: false,
        ambiguous: true,
        errorCode: 'AMBIGUOUS_NEED_CHECK',
        message: 'پاسخ تأیید نهایی به دلیل وقفه شبکه نامشخص بود؛ خرید مجدد متوقف شد و گزارش رزروها بازخوانی می‌شود.',
      };
    }

    if (this.ledger.scenario === 'ambiguous_timeout_failed') {
      return {
        ok: false,
        ambiguous: true,
        errorCode: 'AMBIGUOUS_NEED_CHECK',
        message: 'پاسخ تأیید نهایی نامشخص بود؛ برای جلوگیری از رزرو تکراری فقط گزارش رزروها بررسی می‌شود.',
      };
    }

    const nowParts = utcMsToTehranParts(Date.now());
    const code = `IUT-${nowParts.jy}-${Math.floor(10000 + Math.random() * 89999)}`;
    this.ledger.creditRials = Math.max(0, this.ledger.creditRials - cart.priceRials);
    this.ledger.reservedMeals.unshift({
      reservationCode: code,
      targetDateJalali: cart.targetDateJalali,
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: cart.diningHall,
      foodName: cart.foodName,
      priceRials: cart.priceRials,
      reservedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
      status: 'CONFIRMED',
    });

    return {
      ok: true,
      message: 'درخواست ثبت با اعتبار دانشگاه ارسال شد؛ در حال بررسی کد رزرو در گزارش سامانه.',
    };
  }

  async fetchReservedMealsReport(
    _sessionCookiesJson: string,
    _targetDateJalali: string
  ): Promise<ReservedReportResult> {
    return {
      ok: true,
      message: 'گزارش «غذاهای رزرو شده» بازخوانی شد.',
      reservedMeals: [...this.ledger.reservedMeals],
      availableCreditRials: this.ledger.creditRials,
    };
  }
}
