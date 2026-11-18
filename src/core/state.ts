import {
  computeNextRunDetails,
  computeTargetMealDateForRun,
  isValidJalaliString,
  jsWeekdayToIranOrder,
  parseTimeString,
  utcMsToTehranParts,
} from './jalali';
import { DEFAULT_POLICY, normalizeForMatch, normalizePolicyConfig } from './policy';
import type {
  ActiveLock,
  AppStateSnapshot,
  ExecutionRecord,
  ExecutionStatus,
  LoginVerificationProof,
  MealType,
  PolicyConfig,
  ReservationReceipt,
  ReservedMeal,
  SandboxScenario,
  ScheduleConfig,
} from './types';

export const DEFAULT_USERNAME = '40125403';
export const LOCK_TTL_MS = 120 * 1000; // 2 minutes max execution lock

export interface StoredEncryptedSession {
  encryptedCookiesJson: string;
  preparedAtUtcMs: number;
  preparedAtJalali: string;
  username: string;
}

export interface PersistentBotState {
  sandboxScenario: SandboxScenario;
  liveModeEnabled?: boolean;
  username: string;
  encryptedPassword: string | null;
  encryptedSession: StoredEncryptedSession | null;
  lastLoginTestOk: boolean | null;
  lastLoginTestAtUtcMs: number | null;
  lastLoginTestMessage: string | null;
  lastLoginVerification?: LoginVerificationProof | null;
  schedule: ScheduleConfig;
  policy: PolicyConfig;
  lastStatus: ExecutionStatus;
  lastMessage: string;
  lastErrorCode?: AppStateSnapshot['lastErrorCode'];
  lastReceipt: ReservationReceipt | null;
  availableCreditRials: number | null;
  reservedMeals: ReservedMeal[];
  history: ExecutionRecord[];
  activeLocks: ActiveLock[];
}

export function makeReservationLockKey(targetDateJalali: string, meal: MealType): string {
  return `${normalizeForMatch(targetDateJalali)}::${meal}`;
}

export function pruneExpiredLocks(locks: ActiveLock[], nowUtcMs: number): ActiveLock[] {
  return locks.filter((l) => l.expiresAtUtcMs > nowUtcMs);
}

export function tryAcquireReservationLock(
  locks: ActiveLock[],
  targetDateJalali: string,
  meal: MealType,
  owner: 'MANUAL' | 'SCHEDULED',
  nowUtcMs: number,
  ttlMs = LOCK_TTL_MS
): { acquired: true; nextLocks: ActiveLock[]; key: string } | { acquired: false; existingLock: ActiveLock } {
  const active = pruneExpiredLocks(locks, nowUtcMs);
  const key = makeReservationLockKey(targetDateJalali, meal);
  const existing = active.find((l) => l.key === key);
  if (existing) {
    return { acquired: false, existingLock: existing };
  }
  const newLock: ActiveLock = {
    key,
    owner,
    acquiredAtUtcMs: nowUtcMs,
    expiresAtUtcMs: nowUtcMs + ttlMs,
  };
  return {
    acquired: true,
    nextLocks: [...active, newLock],
    key,
  };
}

export function releaseReservationLock(locks: ActiveLock[], key: string): ActiveLock[] {
  return locks.filter((l) => l.key !== key);
}

export function findConfirmedReservation(
  reservedMeals: ReservedMeal[],
  targetDateJalali: string,
  meal: MealType
): ReservedMeal | undefined {
  const normDate = normalizeForMatch(targetDateJalali);
  return reservedMeals.find(
    (r) =>
      r.status === 'CONFIRMED' &&
      normalizeForMatch(r.targetDateJalali) === normDate &&
      r.meal === meal &&
      r.reservationCode.trim().length > 0
  );
}

/**
 * When a confirm click ends with an ambiguous timeout/network error,
 * re-read the official reserved meals list instead of buying again!
 */
export function resolveAmbiguousOutcome(
  reservedMealsAfterRecheck: ReservedMeal[],
  targetDateJalali: string,
  meal: MealType
): {
  status: 'AMBIGUOUS_RESOLVED_RESERVED' | 'AMBIGUOUS_RESOLVED_NOT_RESERVED';
  foundReservation?: ReservedMeal;
} {
  const found = findConfirmedReservation(reservedMealsAfterRecheck, targetDateJalali, meal);
  if (found) {
    return { status: 'AMBIGUOUS_RESOLVED_RESERVED', foundReservation: found };
  }
  return { status: 'AMBIGUOUS_RESOLVED_NOT_RESERVED' };
}

export function createInitialScheduleConfig(nowUtcMs: number): ScheduleConfig {
  const todayParts = utcMsToTehranParts(nowUtcMs);
  const nextMonday = computeTargetMealDateForRun(nowUtcMs, 1, 1);

  return {
    enabled: false,
    mode: 'weekly',
    actionTimeTehran: '20:30',
    onceActionDateJalali: todayParts.jalaliDate,
    onceTargetMealDateJalali: nextMonday.jalaliDate,
    weeklyExecutionJsWeekday: 6, // Saturday / شنبه
    weeklyTargetMealJsWeekday: 1, // Monday / دوشنبه
    weeklyTargetMealJsWeekdays: [1],
    weeklyTargetWeekOffset: 1, // Next week / هفتهٔ بعد
    earlyLoginMinutes: 10,
    keepSessionWarm: true,
    subsecondExecution: true,
    hangToleranceSeconds: 45,
    retryWindowSeconds: 90,
    retryIntervalSeconds: 2,
  };
}

export function normalizeScheduleConfig(
  raw?: Partial<ScheduleConfig> | null,
  nowUtcMs = Date.now()
): ScheduleConfig {
  const base = createInitialScheduleConfig(nowUtcMs);
  if (!raw) return base;

  const early = Number(raw.earlyLoginMinutes);
  const hang = Number(raw.hangToleranceSeconds);
  const retryWin = Number(raw.retryWindowSeconds);
  const retryInt = Number(raw.retryIntervalSeconds);

  const singleDay =
    typeof raw.weeklyTargetMealJsWeekday === 'number' &&
    raw.weeklyTargetMealJsWeekday >= 0 &&
    raw.weeklyTargetMealJsWeekday <= 6
      ? raw.weeklyTargetMealJsWeekday
      : base.weeklyTargetMealJsWeekday;

  const rawList = Array.isArray(raw.weeklyTargetMealJsWeekdays)
    ? raw.weeklyTargetMealJsWeekdays.filter(
        (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6
      )
    : [];
  const normalizedDays = Array.from(new Set(rawList.length > 0 ? rawList : [singleDay])).sort(
    (a, b) => jsWeekdayToIranOrder(a) - jsWeekdayToIranOrder(b)
  );

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    mode: raw.mode === 'now' || raw.mode === 'once' || raw.mode === 'weekly' ? raw.mode : base.mode,
    actionTimeTehran:
      typeof raw.actionTimeTehran === 'string' && parseTimeString(raw.actionTimeTehran)
        ? raw.actionTimeTehran
        : base.actionTimeTehran,
    onceActionDateJalali:
      typeof raw.onceActionDateJalali === 'string' && isValidJalaliString(raw.onceActionDateJalali)
        ? raw.onceActionDateJalali
        : base.onceActionDateJalali,
    onceTargetMealDateJalali:
      typeof raw.onceTargetMealDateJalali === 'string' &&
      isValidJalaliString(raw.onceTargetMealDateJalali)
        ? raw.onceTargetMealDateJalali
        : base.onceTargetMealDateJalali,
    weeklyExecutionJsWeekday:
      typeof raw.weeklyExecutionJsWeekday === 'number' &&
      raw.weeklyExecutionJsWeekday >= 0 &&
      raw.weeklyExecutionJsWeekday <= 6
        ? raw.weeklyExecutionJsWeekday
        : base.weeklyExecutionJsWeekday,
    weeklyTargetMealJsWeekday: normalizedDays[0] ?? singleDay,
    weeklyTargetMealJsWeekdays: normalizedDays,
    weeklyTargetWeekOffset:
      typeof raw.weeklyTargetWeekOffset === 'number' && raw.weeklyTargetWeekOffset >= 0
        ? raw.weeklyTargetWeekOffset
        : base.weeklyTargetWeekOffset,
    earlyLoginMinutes: Number.isFinite(early)
      ? Math.max(0, Math.min(30, Math.round(early)))
      : base.earlyLoginMinutes,
    keepSessionWarm:
      typeof raw.keepSessionWarm === 'boolean' ? raw.keepSessionWarm : base.keepSessionWarm,
    subsecondExecution:
      typeof raw.subsecondExecution === 'boolean'
        ? raw.subsecondExecution
        : base.subsecondExecution,
    hangToleranceSeconds: Number.isFinite(hang)
      ? Math.max(15, Math.min(120, Math.round(hang)))
      : base.hangToleranceSeconds,
    retryWindowSeconds: Number.isFinite(retryWin)
      ? Math.max(15, Math.min(300, Math.round(retryWin)))
      : base.retryWindowSeconds,
    retryIntervalSeconds: Number.isFinite(retryInt)
      ? Math.max(1, Math.min(10, Math.round(retryInt)))
      : base.retryIntervalSeconds,
  };
}

export function createInitialPersistentState(nowUtcMs: number): PersistentBotState {
  return {
    sandboxScenario: 'normal',
    liveModeEnabled: false,
    username: DEFAULT_USERNAME,
    encryptedPassword: null,
    encryptedSession: null,
    lastLoginTestOk: null,
    lastLoginTestAtUtcMs: null,
    lastLoginTestMessage: null,
    lastLoginVerification: null,
    schedule: createInitialScheduleConfig(nowUtcMs),
    policy: normalizePolicyConfig(DEFAULT_POLICY),
    lastStatus: 'IDLE',
    lastMessage: 'آمادهٔ اتصال و بررسی سامانه تغذیه دانشگاه صنعتی اصفهان.',
    lastReceipt: null,
    availableCreditRials: null,
    reservedMeals: [],
    history: [],
    activeLocks: [],
  };
}

export function buildPublicSnapshot(
  state: PersistentBotState,
  opts: {
    runtimeMode: 'SANDBOX' | 'LIVE_LOCAL_BROWSER' | 'CLOUDFLARE_BROWSER_RUN';
    runtimeUsernameConfigured: boolean;
    runtimePasswordConfigured: boolean;
    nowUtcMs: number;
  }
): AppStateSnapshot {
  const nowParts = utcMsToTehranParts(opts.nowUtcMs);
  const normalizedSchedule = normalizeScheduleConfig(state.schedule, opts.nowUtcMs);
  const normalizedPolicy = normalizePolicyConfig(state.policy);
  const nextRun = computeNextRunDetails(normalizedSchedule, opts.nowUtcMs);

  return {
    runtimeMode: opts.runtimeMode,
    liveModeEnabled: Boolean(state.liveModeEnabled),
    sandboxScenario: state.sandboxScenario,
    account: {
      username: state.username || DEFAULT_USERNAME,
      hasStoredPassword: Boolean(state.encryptedPassword),
      usesRuntimeSecrets: opts.runtimeUsernameConfigured && opts.runtimePasswordConfigured,
      runtimeUsernameConfigured: opts.runtimeUsernameConfigured,
      runtimePasswordConfigured: opts.runtimePasswordConfigured,
      encryptionAlgorithm: 'AES-256-GCM',
      encryptedSessionActive: Boolean(state.encryptedSession),
      sessionPreparedAtUtcMs: state.encryptedSession?.preparedAtUtcMs ?? null,
      sessionPreparedAtJalali: state.encryptedSession?.preparedAtJalali ?? null,
      lastLoginTestOk: state.lastLoginTestOk,
      lastLoginTestAtUtcMs: state.lastLoginTestAtUtcMs,
      lastLoginTestMessage: state.lastLoginTestMessage,
      lastLoginVerification: state.lastLoginVerification ?? null,
    },
    schedule: normalizedSchedule,
    policy: normalizedPolicy,
    nextRun,
    lastStatus: state.lastStatus,
    lastMessage: state.lastMessage,
    lastErrorCode: state.lastErrorCode,
    lastReceipt: state.lastReceipt,
    availableCreditRials: state.availableCreditRials,
    reservedMeals: state.reservedMeals,
    history: state.history.slice(0, 25),
    activeLocks: pruneExpiredLocks(state.activeLocks, opts.nowUtcMs),
    serverTimeUtcMs: opts.nowUtcMs,
    serverTimeJalali: nowParts.jalaliDate,
    serverTimeTehran: nowParts.tehranTimeWithSeconds,
  };
}
