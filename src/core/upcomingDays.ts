import {
  addDaysGregorian,
  formatJalaliDate,
  getWeekdayLabel,
  normalizeAsciiDigits,
  pad2,
  parseJalaliDateString,
  utcMsToTehranParts,
} from './jalali';
import { toJalaali } from 'jalaali-js';
import { findConfirmedReservation } from './state';
import type {
  AppStateSnapshot,
  ExecutionRecord,
  NextRunComputed,
  ReservedMeal,
} from './types';

export type UpcomingDayStatus = 'reserved' | 'pending' | 'failed';

export interface UpcomingDaySummary {
  offsetDays: number;
  relativeLabel: string;
  dateJalali: string;
  weekdayLabel: string;
  shortDateLabel: string;
  status: UpcomingDayStatus;
  statusLabel: string;
  detailText: string;
  diningHall?: string;
  reservationCode?: string;
  scheduledForRun: boolean;
}

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastNotice {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

const RELATIVE_DAY_LABELS: Record<number, string> = {
  1: 'فردا',
  2: 'پس‌فردا',
  3: '۳ روز دیگر',
};

function normalizeJalaliKey(dateStr: string): string | null {
  const parsed = parseJalaliDateString(normalizeAsciiDigits(dateStr));
  if (!parsed) return null;
  return formatJalaliDate(parsed.jy, parsed.jm, parsed.jd);
}

export function buildUpcomingDaysSummary(opts: {
  nowUtcMs: number;
  reservedMeals: ReservedMeal[];
  history: ExecutionRecord[];
  nextRun: NextRunComputed;
  daysCount?: number;
}): UpcomingDaySummary[] {
  const count = opts.daysCount ?? 3;
  const nowParts = utcMsToTehranParts(opts.nowUtcMs);
  const scheduledSet = new Set<string>();
  if (opts.nextRun.enabled) {
    for (const d of opts.nextRun.targetMealDatesJalali ?? []) {
      const k = normalizeJalaliKey(d);
      if (k) scheduledSet.add(k);
    }
    if (opts.nextRun.targetMealDateJalali) {
      const k = normalizeJalaliKey(opts.nextRun.targetMealDateJalali);
      if (k) scheduledSet.add(k);
    }
  }

  // Index latest execution attempt per targetDateJalali (history is newest-first)
  const latestExecByDate = new Map<string, ExecutionRecord>();
  for (const rec of opts.history) {
    if (rec.trigger === 'LOGIN_TEST' || rec.trigger === 'CONNECTION_TEST') continue;
    const key = normalizeJalaliKey(rec.targetDateJalali);
    if (!key) continue;
    const existing = latestExecByDate.get(key);
    if (!existing || rec.startedAtUtcMs > existing.startedAtUtcMs) {
      latestExecByDate.set(key, rec);
    }
  }

  const results: UpcomingDaySummary[] = [];

  for (let offset = 1; offset <= count; offset++) {
    const g = addDaysGregorian(nowParts.gy, nowParts.gm, nowParts.gd, offset);
    const { jy, jm, jd } = toJalaali(g.gy, g.gm, g.gd);
    const dateJalali = formatJalaliDate(jy, jm, jd);
    const weekdayLabel = getWeekdayLabel(g.jsWeekday);
    const shortDateLabel = `${pad2(jm)}/${pad2(jd)}`;
    const relativeLabel = RELATIVE_DAY_LABELS[offset] ?? `${offset} روز دیگر`;
    const scheduledForRun = scheduledSet.has(dateJalali);

    const confirmed = findConfirmedReservation(opts.reservedMeals, dateJalali, 'lunch');
    if (confirmed) {
      results.push({
        offsetDays: offset,
        relativeLabel,
        dateJalali,
        weekdayLabel,
        shortDateLabel,
        status: 'reserved',
        statusLabel: 'رزرو شده',
        detailText: confirmed.foodName,
        diningHall: confirmed.diningHall,
        reservationCode: confirmed.reservationCode,
        scheduledForRun,
      });
      continue;
    }

    const latestAttempt = latestExecByDate.get(dateJalali);
    if (
      latestAttempt &&
      (latestAttempt.status === 'FAILED' ||
        latestAttempt.status === 'AMBIGUOUS_RESOLVED_NOT_RESERVED')
    ) {
      results.push({
        offsetDays: offset,
        relativeLabel,
        dateJalali,
        weekdayLabel,
        shortDateLabel,
        status: 'failed',
        statusLabel: 'ناموفق',
        detailText: latestAttempt.message,
        scheduledForRun,
      });
      continue;
    }

    results.push({
      offsetDays: offset,
      relativeLabel,
      dateJalali,
      weekdayLabel,
      shortDateLabel,
      status: 'pending',
      statusLabel: 'در انتظار',
      detailText: scheduledForRun
        ? `در صف خودکار ساعت ${opts.nextRun.nextActionTehranTime ?? ''}`.trim()
        : 'رزروی ثبت نشده است',
      scheduledForRun,
    });
  }

  return results;
}

export function deriveToastForReservationResult(snapshot: AppStateSnapshot): {
  tone: ToastTone;
  title: string;
  message?: string;
} {
  if (
    snapshot.lastStatus === 'RESERVED' ||
    snapshot.lastStatus === 'AMBIGUOUS_RESOLVED_RESERVED'
  ) {
    return {
      tone: 'success',
      title: 'رزرو با موفقیت انجام شد',
      message: snapshot.lastReceipt
        ? `${snapshot.lastReceipt.foodName} · کد ${snapshot.lastReceipt.reservationCode}`
        : snapshot.lastMessage,
    };
  }
  if (snapshot.lastStatus === 'BLOCKED_DUPLICATE') {
    return {
      tone: 'warning',
      title: 'رزرو تکراری مسدود شد',
      message: snapshot.lastMessage,
    };
  }
  return {
    tone: 'error',
    title: 'رزرو انجام نشد',
    message: snapshot.lastMessage,
  };
}
