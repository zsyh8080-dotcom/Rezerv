import { decryptSecret, encryptSecret, redactSecrets } from './crypto';
import {
  computeTargetMealDateForRun,
  computeTargetMealDatesForRun,
  jalaliStringToGregorianString,
  utcMsToTehranParts,
} from './jalali';
import { rialsToToman, selectBestMeal, verifyCartMatchesSelection } from './policy';
import type { IutCredentials, IutSiteClient } from './site';
import {
  findConfirmedReservation,
  PersistentBotState,
  releaseReservationLock,
  resolveAmbiguousOutcome,
  tryAcquireReservationLock,
} from './state';
import type {
  ExecutionRecord,
  ExecutionStatus,
  ReservationReceipt,
} from './types';

export interface RunnerContext {
  state: PersistentBotState;
  encryptionKey: string;
  runtimeUsername?: string;
  runtimePassword?: string;
  siteClient: IutSiteClient;
  nowUtcMs?: number;
}

export async function resolveEffectiveCredentials(
  state: PersistentBotState,
  encryptionKey: string,
  runtimeUsername?: string,
  runtimePassword?: string
): Promise<IutCredentials | null> {
  if (runtimeUsername && runtimePassword) {
    return { username: runtimeUsername, password: runtimePassword };
  }
  const username = runtimeUsername || state.username;
  if (!username || !state.encryptedPassword) {
    return null;
  }
  const password = await decryptSecret(state.encryptedPassword, encryptionKey);
  return { username, password };
}

export function resolveTargetMealDatesForExecution(
  state: PersistentBotState,
  nowUtcMs: number
): string[] {
  if (state.schedule.mode === 'once' && state.schedule.onceTargetMealDateJalali) {
    return [state.schedule.onceTargetMealDateJalali];
  }
  const weekdays =
    Array.isArray(state.schedule.weeklyTargetMealJsWeekdays) &&
    state.schedule.weeklyTargetMealJsWeekdays.length > 0
      ? state.schedule.weeklyTargetMealJsWeekdays
      : [state.schedule.weeklyTargetMealJsWeekday];

  return computeTargetMealDatesForRun(
    nowUtcMs,
    weekdays,
    state.schedule.weeklyTargetWeekOffset
  ).map((d) => d.jalaliDate);
}

export function resolveTargetMealDateForExecution(
  state: PersistentBotState,
  nowUtcMs: number
): string {
  const dates = resolveTargetMealDatesForExecution(state, nowUtcMs);
  if (dates.length > 0) return dates[0];
  return computeTargetMealDateForRun(
    nowUtcMs,
    state.schedule.weeklyTargetMealJsWeekday,
    state.schedule.weeklyTargetWeekOffset
  ).jalaliDate;
}

export async function runTestLogin(ctx: RunnerContext): Promise<{
  ok: boolean;
  message: string;
}> {
  const nowUtcMs = ctx.nowUtcMs ?? Date.now();
  const nowParts = utcMsToTehranParts(nowUtcMs);
  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );

  if (!creds) {
    const msg = 'رمز عبور حساب دانشگاه ثبت نشده و در تنظیمات امن سرور هم تعریف نشده است.';
    ctx.state.lastLoginTestOk = false;
    ctx.state.lastLoginTestAtUtcMs = nowUtcMs;
    ctx.state.lastLoginTestMessage = msg;
    ctx.state.lastStatus = 'FAILED';
    ctx.state.lastErrorCode = 'MISSING_CREDENTIALS';
    ctx.state.lastMessage = msg;
    ctx.state.history.unshift({
      id: `exec-${nowUtcMs}`,
      trigger: 'LOGIN_TEST',
      status: 'FAILED',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali: resolveTargetMealDateForExecution(ctx.state, nowUtcMs),
      message: msg,
      errorCode: 'MISSING_CREDENTIALS',
    });
    return { ok: false, message: msg };
  }

  try {
    let existingCookies: string | null = null;
    if (ctx.state.encryptedSession) {
      try {
        existingCookies = await decryptSecret(
          ctx.state.encryptedSession.encryptedCookiesJson,
          ctx.encryptionKey
        );
      } catch {
        existingCookies = null;
      }
    }

    let res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, existingCookies);
    // If cached cookies failed authentication/network, invalidate cache & retry fresh login once
    if (!res.ok && existingCookies && (res.errorCode === 'AUTH_ERROR' || res.errorCode === 'NETWORK_ERROR')) {
      ctx.state.encryptedSession = null;
      res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, null);
    }

    const cleanMsg = redactSecrets(res.message, [creds.password, existingCookies]);

    ctx.state.lastLoginTestOk = res.ok;
    ctx.state.lastLoginTestAtUtcMs = nowUtcMs;
    ctx.state.lastLoginTestMessage = cleanMsg;

    if (res.verification) {
      ctx.state.lastLoginVerification = {
        ...res.verification,
        ok: res.ok,
        verifiedAtUtcMs: nowUtcMs,
        verifiedAtJalali: nowParts.jalaliDate,
        verifiedAtTehranTime: nowParts.tehranTimeWithSeconds,
      };
    }

    if (res.ok && res.sessionCookiesJson) {
      const encCookies = await encryptSecret(res.sessionCookiesJson, ctx.encryptionKey);
      ctx.state.encryptedSession = {
        encryptedCookiesJson: encCookies,
        preparedAtUtcMs: nowUtcMs,
        preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
        username: creds.username,
      };
      if (typeof res.availableCreditRials === 'number') {
        ctx.state.availableCreditRials = res.availableCreditRials;
      }
      if (ctx.state.lastStatus === 'FAILED' || ctx.state.lastStatus === 'IDLE') {
        ctx.state.lastStatus = 'EARLY_LOGIN_READY';
        ctx.state.lastErrorCode = undefined;
        ctx.state.lastMessage = cleanMsg;
      }
    } else if (!res.ok) {
      ctx.state.lastErrorCode = res.errorCode;
    }

    ctx.state.history.unshift({
      id: `exec-${nowUtcMs}`,
      trigger: 'LOGIN_TEST',
      status: res.ok ? 'EARLY_LOGIN_READY' : 'FAILED',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali: resolveTargetMealDateForExecution(ctx.state, nowUtcMs),
      message: cleanMsg,
      errorCode: res.errorCode,
    });

    return { ok: res.ok, message: cleanMsg };
  } catch (err) {
    const cleanErr = redactSecrets(
      err instanceof Error ? err.message : 'خطای پیش‌بینی‌نشده در تست ورود',
      [creds.password]
    );
    ctx.state.lastLoginTestOk = false;
    ctx.state.lastLoginTestAtUtcMs = nowUtcMs;
    ctx.state.lastLoginTestMessage = cleanErr;
    return { ok: false, message: cleanErr };
  }
}

export async function runEarlyLoginPreparation(ctx: RunnerContext): Promise<{
  ok: boolean;
  message: string;
}> {
  const nowUtcMs = ctx.nowUtcMs ?? Date.now();
  const nowParts = utcMsToTehranParts(nowUtcMs);
  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );
  if (!creds) {
    return { ok: false, message: 'اطلاعات ورود برای نشست زودهنگام کامل نیست.' };
  }

  let existingCookies: string | null = null;
  if (ctx.state.encryptedSession) {
    try {
      existingCookies = await decryptSecret(
        ctx.state.encryptedSession.encryptedCookiesJson,
        ctx.encryptionKey
      );
    } catch {
      existingCookies = null;
    }
  }

  let res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, existingCookies);
  if (!res.ok && existingCookies && (res.errorCode === 'AUTH_ERROR' || res.errorCode === 'NETWORK_ERROR')) {
    ctx.state.encryptedSession = null;
    res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, null);
  }

  const cleanMsg = redactSecrets(res.message, [creds.password, existingCookies]);
  if (res.ok && res.sessionCookiesJson) {
    ctx.state.encryptedSession = {
      encryptedCookiesJson: await encryptSecret(res.sessionCookiesJson, ctx.encryptionKey),
      preparedAtUtcMs: nowUtcMs,
      preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
      username: creds.username,
    };
    if (typeof res.availableCreditRials === 'number') {
      ctx.state.availableCreditRials = res.availableCreditRials;
    }
    ctx.state.lastStatus = 'EARLY_LOGIN_READY';
    ctx.state.lastMessage = `ورود زودهنگام انجام شد و نشست زنده برای ماندن داخل سامانه آماده است (${nowParts.tehranTime}).`;
    return { ok: true, message: ctx.state.lastMessage };
  }
  ctx.state.lastStatus = 'FAILED';
  ctx.state.lastErrorCode = res.errorCode;
  ctx.state.lastMessage = cleanMsg;
  return { ok: false, message: cleanMsg };
}

export async function runKeepAliveRefresh(ctx: RunnerContext): Promise<{
  ok: boolean;
  message: string;
}> {
  const nowUtcMs = ctx.nowUtcMs ?? Date.now();
  const nowParts = utcMsToTehranParts(nowUtcMs);
  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );
  if (!creds) {
    return { ok: false, message: 'اطلاعات ورود برای تمدید نشست موجود نیست.' };
  }

  let existingCookies: string | null = null;
  if (ctx.state.encryptedSession) {
    try {
      existingCookies = await decryptSecret(
        ctx.state.encryptedSession.encryptedCookiesJson,
        ctx.encryptionKey
      );
    } catch {
      existingCookies = null;
    }
  }

  let res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, existingCookies);
  if (!res.ok && existingCookies) {
    ctx.state.encryptedSession = null;
    res = await ctx.siteClient.testLoginAndOpenReservationPage(creds, null);
  }

  if (res.ok && res.sessionCookiesJson) {
    ctx.state.encryptedSession = {
      encryptedCookiesJson: await encryptSecret(res.sessionCookiesJson, ctx.encryptionKey),
      preparedAtUtcMs: nowUtcMs,
      preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
      username: creds.username,
    };
    if (typeof res.availableCreditRials === 'number') {
      ctx.state.availableCreditRials = res.availableCreditRials;
    }
    ctx.state.lastStatus = 'EARLY_LOGIN_READY';
    ctx.state.lastMessage = `نشست داخل سامانه تازه نگه داشته شد (${nowParts.tehranTimeWithSeconds})؛ آماده برای اقدام ثانیه‌ای.`;
    return { ok: true, message: ctx.state.lastMessage };
  }

  return {
    ok: false,
    message: redactSecrets(res.message, [creds.password, existingCookies]),
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Opens the reservation page just before targetActionUtcMs, keeps the logged-in
 * browser page warm & alive inside the site, waits down to the exact Tehran second,
 * and triggers execution instantaneously for one or multiple target dates.
 */
export async function runStandbyAndPrecisionExecuteMulti(
  ctx: RunnerContext,
  trigger: 'MANUAL' | 'SCHEDULED',
  targetActionUtcMs: number,
  explicitTargetDatesJalali?: string | string[],
  onStatusUpdate?: () => void
): Promise<ExecutionRecord[]> {
  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );

  let sessionCookiesJson: string | null = null;
  if (creds && ctx.state.encryptedSession?.username === creds.username) {
    try {
      sessionCookiesJson = await decryptSecret(
        ctx.state.encryptedSession.encryptedCookiesJson,
        ctx.encryptionKey
      );
    } catch {
      sessionCookiesJson = null;
    }
  }

  let standbyStarted = false;
  try {
    if (creds && ctx.siteClient.prepareStandbySession) {
      let standby = await ctx.siteClient.prepareStandbySession(creds, sessionCookiesJson, {
        hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
      });

      // Fallback fresh standby login if cached session cookies failed
      if (!standby.ok && sessionCookiesJson && standby.errorCode !== 'CAPTCHA_REQUIRED') {
        ctx.state.encryptedSession = null;
        standby = await ctx.siteClient.prepareStandbySession(creds, null, {
          hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
        });
      }

      if (standby.ok) {
        standbyStarted = true;
        if (standby.sessionCookiesJson) {
          const nowParts = utcMsToTehranParts(Date.now());
          ctx.state.encryptedSession = {
            encryptedCookiesJson: await encryptSecret(standby.sessionCookiesJson, ctx.encryptionKey),
            preparedAtUtcMs: Date.now(),
            preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
            username: creds.username,
          };
        }
        if (typeof standby.availableCreditRials === 'number') {
          ctx.state.availableCreditRials = standby.availableCreditRials;
        }
        ctx.state.lastStatus = 'STANDBY_IN_SITE';
        ctx.state.lastMessage =
          'وارد صفحهٔ رزرو شده و تا رسیدن ثانیهٔ هدف داخل سایت منتظر می‌ماند...';
        onStatusUpdate?.();
      }
    }

    // Wait precisely until targetActionUtcMs (while optionally pinging keep-alive)
    while (Date.now() < targetActionUtcMs) {
      const remaining = targetActionUtcMs - Date.now();
      if (remaining <= 0) break;
      if (remaining > 18000 && standbyStarted && creds && ctx.siteClient.keepAliveStandbySession) {
        await sleepMs(12000);
        await ctx.siteClient.keepAliveStandbySession(creds).catch(() => null);
      } else {
        await sleepMs(Math.min(remaining, 250));
      }
    }

    const targets =
      typeof explicitTargetDatesJalali === 'string'
        ? [explicitTargetDatesJalali]
        : explicitTargetDatesJalali;

    return await executeMultiDayReservationRun(
      { ...ctx, nowUtcMs: ctx.nowUtcMs ?? Date.now() },
      trigger,
      targets,
      standbyStarted
    );
  } finally {
    if (standbyStarted && ctx.siteClient.releaseStandbySession) {
      await ctx.siteClient.releaseStandbySession().catch(() => undefined);
    }
  }
}

export async function runStandbyAndPrecisionExecute(
  ctx: RunnerContext,
  trigger: 'MANUAL' | 'SCHEDULED',
  targetActionUtcMs: number,
  explicitTargetDateJalali?: string,
  onStatusUpdate?: () => void
): Promise<ExecutionRecord> {
  const records = await runStandbyAndPrecisionExecuteMulti(
    ctx,
    trigger,
    targetActionUtcMs,
    explicitTargetDateJalali,
    onStatusUpdate
  );
  return records[0];
}

export async function executeMultiDayReservationRun(
  ctx: RunnerContext,
  trigger: 'MANUAL' | 'SCHEDULED',
  explicitTargetDatesJalali?: string[],
  usingActiveStandby = false
): Promise<ExecutionRecord[]> {
  const baseNowMs = ctx.nowUtcMs ?? Date.now();
  const targets =
    explicitTargetDatesJalali && explicitTargetDatesJalali.length > 0
      ? Array.from(new Set(explicitTargetDatesJalali))
      : resolveTargetMealDatesForExecution(ctx.state, baseNowMs);

  if (targets.length <= 1) {
    const rec = await executeReservationRun(
      ctx,
      trigger,
      targets[0],
      usingActiveStandby
    );
    return [rec];
  }

  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );

  let sessionCookiesJson: string | null = null;
  if (creds && ctx.state.encryptedSession?.username === creds.username) {
    try {
      sessionCookiesJson = await decryptSecret(
        ctx.state.encryptedSession.encryptedCookiesJson,
        ctx.encryptionKey
      );
    } catch {
      sessionCookiesJson = null;
    }
  }

  // Open a single warm standby session shared across all selected weekdays for speed & hang resistance
  let sharedStandbyOpened = false;
  try {
    if (!usingActiveStandby && creds && ctx.siteClient.prepareStandbySession) {
      let warm = await ctx.siteClient.prepareStandbySession(creds, sessionCookiesJson, {
        hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
      });
      if (!warm.ok && sessionCookiesJson && warm.errorCode !== 'CAPTCHA_REQUIRED') {
        ctx.state.encryptedSession = null;
        warm = await ctx.siteClient.prepareStandbySession(creds, null, {
          hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
        });
      }
      if (warm.ok) {
        sharedStandbyOpened = true;
        if (warm.sessionCookiesJson) {
          const nowParts = utcMsToTehranParts(Date.now());
          ctx.state.encryptedSession = {
            encryptedCookiesJson: await encryptSecret(warm.sessionCookiesJson, ctx.encryptionKey),
            preparedAtUtcMs: Date.now(),
            preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
            username: creds.username,
          };
        }
      }
    }

    const results: ExecutionRecord[] = [];
    for (let i = 0; i < targets.length; i++) {
      const targetDate = targets[i];
      const rec = await executeReservationRun(
        {
          ...ctx,
          nowUtcMs: ctx.nowUtcMs !== undefined ? ctx.nowUtcMs + i : Date.now(),
        },
        trigger,
        targetDate,
        usingActiveStandby || sharedStandbyOpened
      );
      results.push(rec);
    }

    // Build clean consolidated summary message across all selected days
    const reserved = results.filter(
      (r) => r.status === 'RESERVED' || r.status === 'AMBIGUOUS_RESOLVED_RESERVED'
    );
    const blocked = results.filter((r) => r.status === 'BLOCKED_DUPLICATE');
    const failed = results.filter(
      (r) => r.status === 'FAILED' || r.status === 'AMBIGUOUS_RESOLVED_NOT_RESERVED'
    );

    let combinedStatus: ExecutionStatus = results[0].status;
    if (reserved.length > 0 && failed.length === 0) {
      combinedStatus = 'RESERVED';
    } else if (reserved.length > 0) {
      combinedStatus = 'RESERVED';
    } else if (blocked.length === results.length) {
      combinedStatus = 'BLOCKED_DUPLICATE';
    } else if (failed.length > 0) {
      combinedStatus = failed[0].status;
    }

    const parts: string[] = [];
    if (reserved.length > 0) {
      parts.push(`${reserved.length} روز رزرو شد (${reserved.map((r) => r.targetDateJalali).join('، ')})`);
    }
    if (blocked.length > 0) {
      parts.push(`${blocked.length} روز قبلاً رزرو شده بود`);
    }
    if (failed.length > 0) {
      parts.push(`${failed.length} روز ناموفق (${failed[0].message})`);
    }
    ctx.state.lastStatus = combinedStatus;
    ctx.state.lastMessage = parts.join(' · ');
    return results;
  } finally {
    if (sharedStandbyOpened && ctx.siteClient.releaseStandbySession) {
      await ctx.siteClient.releaseStandbySession().catch(() => undefined);
    }
  }
}

export async function executeReservationRun(
  ctx: RunnerContext,
  trigger: 'MANUAL' | 'SCHEDULED',
  explicitTargetDateJalali?: string,
  usingActiveStandby = false
): Promise<ExecutionRecord> {
  const nowUtcMs = ctx.nowUtcMs ?? Date.now();
  const nowParts = utcMsToTehranParts(nowUtcMs);
  const targetDateJalali =
    explicitTargetDateJalali || resolveTargetMealDateForExecution(ctx.state, nowUtcMs);

  const creds = await resolveEffectiveCredentials(
    ctx.state,
    ctx.encryptionKey,
    ctx.runtimeUsername,
    ctx.runtimePassword
  );

  const finalize = (record: ExecutionRecord): ExecutionRecord => {
    ctx.state.lastStatus = record.status;
    ctx.state.lastMessage = record.message;
    ctx.state.lastErrorCode = record.errorCode;
    if (record.receipt) {
      ctx.state.lastReceipt = record.receipt;
    }
    ctx.state.history.unshift(record);
    return record;
  };

  if (!creds) {
    return finalize({
      id: `exec-${nowUtcMs}`,
      trigger,
      status: 'FAILED',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali,
      message: 'نام کاربری یا رمز عبور دانشگاه تنظیم نشده است.',
      errorCode: 'MISSING_CREDENTIALS',
    });
  }

  // Shared lock between manual & scheduled execution for the same (date, meal)
  const lockAttempt = tryAcquireReservationLock(
    ctx.state.activeLocks,
    targetDateJalali,
    'lunch',
    trigger,
    nowUtcMs
  );

  if (!lockAttempt.acquired) {
    return finalize({
      id: `exec-${nowUtcMs}`,
      trigger,
      status: 'BLOCKED_DUPLICATE',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali,
      message: `قفل مشترک فعال است: یک عملیات رزرو دیگر (${lockAttempt.existingLock.owner === 'MANUAL' ? 'دستی' : 'زمان‌بندی‌شده'}) برای ناهار ${targetDateJalali} در حال اجراست.`,
      errorCode: 'DUPLICATE_LOCK',
    });
  }

  ctx.state.activeLocks = lockAttempt.nextLocks;

  let ownStandbyOpened = false;
  try {
    // 1. Reuse encrypted early-login session if fresh (< 35 min), otherwise login now
    let sessionCookiesJson: string | null = null;
    if (
      ctx.state.encryptedSession &&
      ctx.state.encryptedSession.username === creds.username &&
      nowUtcMs - ctx.state.encryptedSession.preparedAtUtcMs < 35 * 60 * 1000
    ) {
      try {
        sessionCookiesJson = await decryptSecret(
          ctx.state.encryptedSession.encryptedCookiesJson,
          ctx.encryptionKey
        );
      } catch {
        sessionCookiesJson = null;
      }
    }

    const openFreshSession = async (existingCookies: string | null): Promise<{
      ok: boolean;
      cookies: string | null;
      message?: string;
      errorCode?: ExecutionRecord['errorCode'];
    }> => {
      if (ctx.siteClient.prepareStandbySession) {
        let warm = await ctx.siteClient.prepareStandbySession(creds, existingCookies, {
          hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
        });
        if (!warm.ok && existingCookies && warm.errorCode !== 'CAPTCHA_REQUIRED') {
          ctx.state.encryptedSession = null;
          warm = await ctx.siteClient.prepareStandbySession(creds, null, {
            hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
          });
        }
        if (!warm.ok) {
          return {
            ok: false,
            cookies: null,
            message: redactSecrets(warm.message, [creds.password, existingCookies]),
            errorCode: warm.errorCode ?? 'AUTH_ERROR',
          };
        }
        ownStandbyOpened = true;
        if (warm.sessionCookiesJson) {
          ctx.state.encryptedSession = {
            encryptedCookiesJson: await encryptSecret(warm.sessionCookiesJson, ctx.encryptionKey),
            preparedAtUtcMs: nowUtcMs,
            preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
            username: creds.username,
          };
          return { ok: true, cookies: warm.sessionCookiesJson };
        }
        return { ok: true, cookies: existingCookies };
      }

      let loginRes = await ctx.siteClient.testLoginAndOpenReservationPage(creds, existingCookies);
      if (!loginRes.ok && existingCookies && loginRes.errorCode !== 'CAPTCHA_REQUIRED') {
        ctx.state.encryptedSession = null;
        loginRes = await ctx.siteClient.testLoginAndOpenReservationPage(creds, null);
      }
      if (!loginRes.ok || !loginRes.sessionCookiesJson) {
        return {
          ok: false,
          cookies: null,
          message: redactSecrets(loginRes.message, [creds.password, existingCookies]),
          errorCode: loginRes.errorCode ?? 'AUTH_ERROR',
        };
      }
      ctx.state.encryptedSession = {
        encryptedCookiesJson: await encryptSecret(loginRes.sessionCookiesJson, ctx.encryptionKey),
        preparedAtUtcMs: nowUtcMs,
        preparedAtJalali: `${nowParts.jalaliDate} ${nowParts.tehranTime}`,
        username: creds.username,
      };
      return { ok: true, cookies: loginRes.sessionCookiesJson };
    };

    if (!usingActiveStandby && ctx.siteClient.prepareStandbySession) {
      const opened = await openFreshSession(sessionCookiesJson);
      if (!opened.ok) {
        return finalize({
          id: `exec-${nowUtcMs}`,
          trigger,
          status: 'FAILED',
          startedAtUtcMs: nowUtcMs,
          startedAtJalali: nowParts.jalaliDate,
          startedAtTehranTime: nowParts.tehranTimeWithSeconds,
          targetDateJalali,
          message: opened.message ?? 'خطا در برقراری نشست سامانه دانشگاه',
          errorCode: opened.errorCode ?? 'AUTH_ERROR',
        });
      }
      sessionCookiesJson = opened.cookies;
    } else if (!sessionCookiesJson) {
      const opened = await openFreshSession(null);
      if (!opened.ok) {
        return finalize({
          id: `exec-${nowUtcMs}`,
          trigger,
          status: 'FAILED',
          startedAtUtcMs: nowUtcMs,
          startedAtJalali: nowParts.jalaliDate,
          startedAtTehranTime: nowParts.tehranTimeWithSeconds,
          targetDateJalali,
          message: opened.message ?? 'خطا در ورود به سامانه دانشگاه',
          errorCode: opened.errorCode ?? 'AUTH_ERROR',
        });
      }
      sessionCookiesJson = opened.cookies;
    }

    // 2. Fetch fresh menu + reserved meals + available credit (with resilient retry window & auto session-recovery)
    const retryOpts = {
      retryWindowSeconds: ctx.state.schedule.retryWindowSeconds,
      retryIntervalSeconds: ctx.state.schedule.retryIntervalSeconds,
      hangToleranceSeconds: ctx.state.schedule.hangToleranceSeconds,
    };

    let contextRes = await ctx.siteClient.fetchReservationContext(
      sessionCookiesJson || '{}',
      targetDateJalali,
      retryOpts
    );

    // Self-healing fallback: if cached session dropped or network froze before loading menu, reset session & re-login cleanly once
    if (
      !contextRes.ok &&
      (contextRes.errorCode === 'AUTH_ERROR' || contextRes.errorCode === 'NETWORK_ERROR')
    ) {
      ctx.state.encryptedSession = null;
      const reauth = await openFreshSession(null);
      if (reauth.ok) {
        sessionCookiesJson = reauth.cookies;
        contextRes = await ctx.siteClient.fetchReservationContext(
          sessionCookiesJson || '{}',
          targetDateJalali,
          retryOpts
        );
      }
    }

    if (!contextRes.ok) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: redactSecrets(contextRes.message, [creds.password, sessionCookiesJson]),
        errorCode: contextRes.errorCode ?? 'MENU_NOT_OPEN',
      });
    }

    ctx.state.availableCreditRials = contextRes.availableCreditRials;
    ctx.state.reservedMeals = contextRes.reservedMeals;

    // 3. Pre-purchase check of "غذاهای رزرو شده"
    const alreadyReserved = findConfirmedReservation(
      contextRes.reservedMeals,
      targetDateJalali,
      'lunch'
    );
    if (alreadyReserved) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'BLOCKED_DUPLICATE',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: `رزرو تکراری مسدود شد: ناهار ${targetDateJalali} قبلاً با کد ${alreadyReserved.reservationCode} (${alreadyReserved.foodName} - ${alreadyReserved.diningHall}) رزرو شده است.`,
        errorCode: 'DUPLICATE_LOCK',
      });
    }

    // 4. Rule-based food selection (no AI/LLM)
    const decision = selectBestMeal(
      contextRes.menu,
      ctx.state.policy,
      contextRes.availableCreditRials
    );

    if (!decision.ok || !decision.selectedItem) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: decision.errorMessage ?? 'غذای مناسبی یافت نشد.',
        errorCode: decision.errorCode ?? 'NO_ELIGIBLE_FOOD',
        decisionSummary: {
          excludedCount: decision.excludedItems.length,
        },
      });
    }

    const chosen = decision.selectedItem;
    let activeCookies = sessionCookiesJson || '{}';

    // 5. Add to cart and read back cart details (with idempotent recovery on session drop / hang)
    let cartRes = await ctx.siteClient.addToCartAndReadSummary(
      activeCookies,
      chosen,
      targetDateJalali
    );
    if (
      !cartRes.ok &&
      (cartRes.errorCode === 'AUTH_ERROR' || cartRes.errorCode === 'NETWORK_ERROR')
    ) {
      ctx.state.encryptedSession = null;
      const reauth = await openFreshSession(null);
      if (reauth.ok) {
        activeCookies = reauth.cookies || activeCookies;
        await ctx.siteClient
          .fetchReservationContext(activeCookies, targetDateJalali, retryOpts)
          .catch(() => null);
        cartRes = await ctx.siteClient.addToCartAndReadSummary(
          activeCookies,
          chosen,
          targetDateJalali
        );
      }
    }

    if (!cartRes.ok || !cartRes.cart) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: redactSecrets(cartRes.message, [creds.password, sessionCookiesJson]),
        errorCode: cartRes.errorCode ?? 'NETWORK_ERROR',
      });
    }

    // 6. Strict pre-submit cart verification
    const cartCheck = verifyCartMatchesSelection(cartRes.cart, chosen, targetDateJalali);
    if (!cartCheck.ok) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: `تأیید سبد متوقف شد: ${cartCheck.reason}`,
        errorCode: 'CART_MISMATCH',
      });
    }

    // 7. Confirm purchase strictly from university credit
    const confirmRes = await ctx.siteClient.confirmPurchaseWithCredit(
      activeCookies,
      cartRes.cart
    );

    // 8. Always re-read official "غذاهای رزرو شده" report to verify reservation code!
    // Under heavy load, retry report-reading up to 3 attempts so slow DB commit isn't missed;
    // NEVER re-buy automatically when confirmRes.ambiguous === true!
    let reportRes = await ctx.siteClient.fetchReservedMealsReport(
      activeCookies,
      targetDateJalali
    );
    for (let checkTry = 1; checkTry <= 2; checkTry++) {
      const confirmedNow = findConfirmedReservation(
        reportRes.reservedMeals,
        targetDateJalali,
        'lunch'
      );
      if (reportRes.ok && confirmedNow) break;
      if (!reportRes.ok || confirmRes.ambiguous || confirmRes.ok) {
        await sleepMs(900 * checkTry);
        const nextReport = await ctx.siteClient.fetchReservedMealsReport(
          activeCookies,
          targetDateJalali
        );
        if (nextReport.ok || nextReport.reservedMeals.length > 0) {
          reportRes = nextReport;
        }
      }
    }

    ctx.state.reservedMeals = reportRes.reservedMeals;
    if (typeof reportRes.availableCreditRials === 'number') {
      ctx.state.availableCreditRials = reportRes.availableCreditRials;
    }

    if (confirmRes.ambiguous) {
      const resolved = resolveAmbiguousOutcome(
        reportRes.reservedMeals,
        targetDateJalali,
        'lunch'
      );
      if (resolved.status === 'AMBIGUOUS_RESOLVED_RESERVED' && resolved.foundReservation) {
        const r = resolved.foundReservation;
        const receipt: ReservationReceipt = {
          reservationCode: r.reservationCode,
          targetDateJalali,
          targetDateGregorian: jalaliStringToGregorianString(targetDateJalali) ?? '',
          meal: 'lunch',
          mealLabel: 'ناهار',
          diningHall: r.diningHall,
          foodName: r.foodName,
          quantity: 1,
          priceRials: r.priceRials,
          priceToman: rialsToToman(r.priceRials),
          paymentSource: 'UNIVERSITY_CREDIT',
          confirmedAtUtcMs: nowUtcMs,
          confirmedAtJalali: nowParts.jalaliDate,
          confirmedAtTehranTime: nowParts.tehranTime,
          remainingCreditRials: ctx.state.availableCreditRials ?? 0,
        };
        return finalize({
          id: `exec-${nowUtcMs}`,
          trigger,
          status: 'AMBIGUOUS_RESOLVED_RESERVED',
          startedAtUtcMs: nowUtcMs,
          startedAtJalali: nowParts.jalaliDate,
          startedAtTehranTime: nowParts.tehranTimeWithSeconds,
          targetDateJalali,
          message: `رزرو شد — نتیجهٔ تأیید ابتدا نامشخص بود اما کد رزرو ${r.reservationCode} در گزارش سامانه تأیید گردید.`,
          receipt,
          decisionSummary: {
            selectedFood: chosen.name,
            selectedHall: chosen.diningHall,
            selectedPriceRials: chosen.priceRials,
            tierLabel: decision.tierLabel,
            excludedCount: decision.excludedItems.length,
          },
        });
      }

      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'AMBIGUOUS_RESOLVED_NOT_RESERVED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: 'وضعیت تأیید نامشخص بود؛ گزارش رزروها بررسی شد و کد رزروی ثبت نشده بود. برای جلوگیری از خرید تکراری، خرید خودکار تکرار نشد.',
        errorCode: 'AMBIGUOUS_NEED_CHECK',
      });
    }

    // Normal confirm path: "رزرو شد" ONLY if official reservation code is observed in report!
    const verified = findConfirmedReservation(reportRes.reservedMeals, targetDateJalali, 'lunch');
    if (!confirmRes.ok || !verified) {
      return finalize({
        id: `exec-${nowUtcMs}`,
        trigger,
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs,
        startedAtJalali: nowParts.jalaliDate,
        startedAtTehranTime: nowParts.tehranTimeWithSeconds,
        targetDateJalali,
        message: confirmRes.ok
          ? 'تراکنش ارسال شد اما کد رزرو در گزارش «غذاهای رزرو شده» مشاهده نشد؛ وضعیت «رزرو شد» ثبت نگردید.'
          : redactSecrets(confirmRes.message, [creds.password, sessionCookiesJson]),
        errorCode: confirmRes.errorCode ?? 'AMBIGUOUS_NEED_CHECK',
      });
    }

    const receipt: ReservationReceipt = {
      reservationCode: verified.reservationCode,
      targetDateJalali,
      targetDateGregorian: jalaliStringToGregorianString(targetDateJalali) ?? '',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: verified.diningHall,
      foodName: verified.foodName,
      quantity: 1,
      priceRials: verified.priceRials,
      priceToman: rialsToToman(verified.priceRials),
      paymentSource: 'UNIVERSITY_CREDIT',
      confirmedAtUtcMs: nowUtcMs,
      confirmedAtJalali: nowParts.jalaliDate,
      confirmedAtTehranTime: nowParts.tehranTime,
      remainingCreditRials: ctx.state.availableCreditRials ?? 0,
    };

    return finalize({
      id: `exec-${nowUtcMs}`,
      trigger,
      status: 'RESERVED',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali,
      message: `رزرو شد — ${verified.foodName} در ${verified.diningHall} با کد رزرو ${verified.reservationCode} ثبت گردید.`,
      receipt,
      decisionSummary: {
        selectedFood: chosen.name,
        selectedHall: chosen.diningHall,
        selectedPriceRials: chosen.priceRials,
        tierLabel: decision.tierLabel,
        excludedCount: decision.excludedItems.length,
      },
    });
  } catch (err) {
    const cleanErr = redactSecrets(
      err instanceof Error ? err.message : 'خطای سیستمی در فرآیند رزرو',
      [creds.password]
    );
    return finalize({
      id: `exec-${nowUtcMs}`,
      trigger,
      status: 'FAILED',
      startedAtUtcMs: nowUtcMs,
      startedAtJalali: nowParts.jalaliDate,
      startedAtTehranTime: nowParts.tehranTimeWithSeconds,
      targetDateJalali,
      message: cleanErr,
      errorCode: 'NETWORK_ERROR',
    });
  } finally {
    if (ownStandbyOpened && ctx.siteClient.releaseStandbySession) {
      await ctx.siteClient.releaseStandbySession().catch(() => undefined);
    }
    ctx.state.activeLocks = releaseReservationLock(ctx.state.activeLocks, lockAttempt.key);
  }
}
