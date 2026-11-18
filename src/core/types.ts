export type ScheduleMode = 'now' | 'once' | 'weekly';

export type MealType = 'lunch';

export type AllowedDiningHall =
  | 'تریا کاج'
  | 'رستوران مکمل کاج'
  | 'رستوران آسمان';

export type ErrorCode =
  | 'AUTH_ERROR'
  | 'CAPTCHA_REQUIRED'
  | 'INSUFFICIENT_CREDIT'
  | 'NO_ELIGIBLE_FOOD'
  | 'BROWSER_QUOTA'
  | 'MENU_NOT_OPEN'
  | 'DUPLICATE_LOCK'
  | 'CART_MISMATCH'
  | 'AMBIGUOUS_NEED_CHECK'
  | 'MISSING_CREDENTIALS'
  | 'NETWORK_ERROR';

export type ExecutionStatus =
  | 'IDLE'
  | 'EARLY_LOGIN_READY'
  | 'STANDBY_IN_SITE'
  | 'RUNNING'
  | 'RESERVED'
  | 'BLOCKED_DUPLICATE'
  | 'FAILED'
  | 'AMBIGUOUS_RESOLVED_RESERVED'
  | 'AMBIGUOUS_RESOLVED_NOT_RESERVED'
  | 'PAUSED';

export type SandboxScenario =
  | 'normal'
  | 'only_50k_available'
  | 'pay_at_location_only'
  | 'forbidden_only'
  | 'insufficient_credit'
  | 'captcha_required'
  | 'auth_error'
  | 'menu_delayed'
  | 'ambiguous_timeout_success'
  | 'ambiguous_timeout_failed'
  | 'browser_quota';

export interface MenuItem {
  id: string;
  name: string;
  diningHall: string;
  meal: MealType;
  priceRials: number;
  available: boolean;
  isPayAtLocation?: boolean;
  remainingCount?: number;
}

export interface ReservedMeal {
  reservationCode: string;
  targetDateJalali: string;
  meal: MealType;
  mealLabel: string;
  diningHall: string;
  foodName: string;
  priceRials: number;
  reservedAtJalali: string;
  status: 'CONFIRMED' | 'CANCELLED';
}

export interface CartSummary {
  targetDateJalali: string;
  meal: MealType;
  diningHall: string;
  foodName: string;
  quantity: number;
  priceRials: number;
  paymentSource: 'UNIVERSITY_CREDIT' | 'ONLINE_GATEWAY';
}

export interface ReservationReceipt {
  reservationCode: string;
  targetDateJalali: string;
  targetDateGregorian: string;
  meal: MealType;
  mealLabel: string;
  diningHall: string;
  foodName: string;
  quantity: number;
  priceRials: number;
  priceToman: number;
  paymentSource: 'UNIVERSITY_CREDIT';
  confirmedAtUtcMs: number;
  confirmedAtJalali: string;
  confirmedAtTehranTime: string;
  remainingCreditRials: number;
}

export interface PolicyConfig {
  meal: MealType;
  quantity: 1;
  preferredKeywords: string[];
  onlyReservePreferred: boolean;
  allowedHalls: AllowedDiningHall[];
  forbiddenKeywords: string[];
  preferredPriceToman: number; // 35000
  acceptablePriceToman: number; // 50000
  maxPriceToman: number | null; // Optional ceiling, default null (empty)
  preferNamedDishOverPayAtLocation: boolean;
  creditOnly: true;
}

export interface ScheduleConfig {
  enabled: boolean;
  mode: ScheduleMode;
  actionTimeTehran: string; // "HH:mm", default "20:30"
  onceActionDateJalali: string; // "YYYY/MM/DD"
  onceTargetMealDateJalali: string; // "YYYY/MM/DD"
  weeklyExecutionJsWeekday: number; // 0=Sun..6=Sat
  weeklyTargetMealJsWeekday: number; // default 1 (Monday / دوشنبه) - first selected day
  weeklyTargetMealJsWeekdays: number[]; // multi-day selection [1] by default
  weeklyTargetWeekOffset: number; // default 1 (هفتهٔ بعد)
  earlyLoginMinutes: number; // default 10
  keepSessionWarm: boolean; // default true
  subsecondExecution: boolean; // default true
  hangToleranceSeconds: number; // default 45
  retryWindowSeconds: number; // default 90
  retryIntervalSeconds: number; // default 2
}

export interface LoginVerificationProof {
  source: 'LIVE_IUT' | 'SANDBOX_SIMULATION';
  ok: boolean;
  verifiedAtUtcMs: number;
  verifiedAtJalali: string;
  verifiedAtTehranTime: string;
  finalUrl: string;
  pageTitle: string;
  studentBannerText?: string;
  availableCreditRials?: number;
  reservedCountOnSite?: number;
  sampleDishes?: string[];
  screenshotDataUrl?: string;
}

export interface AccountConfigPublic {
  username: string; // default "40125403"
  hasStoredPassword: boolean;
  usesRuntimeSecrets: boolean;
  runtimeUsernameConfigured: boolean;
  runtimePasswordConfigured: boolean;
  encryptionAlgorithm: 'AES-256-GCM';
  encryptedSessionActive: boolean;
  sessionPreparedAtUtcMs: number | null;
  sessionPreparedAtJalali: string | null;
  lastLoginTestOk: boolean | null;
  lastLoginTestAtUtcMs: number | null;
  lastLoginTestMessage: string | null;
  lastLoginVerification: LoginVerificationProof | null;
}

export interface ExcludedMenuItem {
  name: string;
  diningHall: string;
  priceRials: number;
  reason: string;
}

export interface PolicyDecision {
  ok: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
  selectedItem?: MenuItem;
  tierLabel?: string;
  excludedItems: ExcludedMenuItem[];
}

export interface ExecutionRecord {
  id: string;
  trigger: 'MANUAL' | 'SCHEDULED' | 'LOGIN_TEST' | 'CONNECTION_TEST';
  status: ExecutionStatus;
  startedAtUtcMs: number;
  startedAtJalali: string;
  startedAtTehranTime: string;
  targetDateJalali: string;
  message: string;
  errorCode?: ErrorCode;
  receipt?: ReservationReceipt;
  decisionSummary?: {
    selectedFood?: string;
    selectedHall?: string;
    selectedPriceRials?: number;
    tierLabel?: string;
    excludedCount: number;
  };
}

export interface ActiveLock {
  key: string; // `${targetDateJalali}::${meal}`
  owner: 'MANUAL' | 'SCHEDULED';
  acquiredAtUtcMs: number;
  expiresAtUtcMs: number;
}

export interface NextRunComputed {
  enabled: boolean;
  mode: ScheduleMode;
  nextActionUtcMs: number | null;
  nextActionJalaliDate: string | null;
  nextActionTehranTime: string | null;
  nextActionWeekdayLabel: string | null;
  earlyLoginUtcMs: number | null;
  earlyLoginJalaliDate: string | null;
  earlyLoginTehranTime: string | null;
  targetMealDateJalali: string | null;
  targetMealDateGregorian: string | null;
  targetMealWeekdayLabel: string | null;
  targetMealDatesJalali: string[];
  targetMealWeekdayLabels: string[];
}

export interface AppStateSnapshot {
  runtimeMode: 'SANDBOX' | 'LIVE_LOCAL_BROWSER' | 'CLOUDFLARE_BROWSER_RUN';
  liveModeEnabled: boolean;
  sandboxScenario: SandboxScenario;
  account: AccountConfigPublic;
  schedule: ScheduleConfig;
  policy: PolicyConfig;
  nextRun: NextRunComputed;
  lastStatus: ExecutionStatus;
  lastMessage: string;
  lastErrorCode?: ErrorCode;
  lastReceipt: ReservationReceipt | null;
  availableCreditRials: number | null;
  reservedMeals: ReservedMeal[];
  history: ExecutionRecord[];
  activeLocks: ActiveLock[];
  serverTimeUtcMs: number;
  serverTimeJalali: string;
  serverTimeTehran: string;
}
