import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';
import type { NextRunComputed, ScheduleConfig } from './types';

export const TEHRAN_TIMEZONE = 'Asia/Tehran';

export interface IranianWeekdayOption {
  jsWeekday: number; // 0=Sun..6=Sat
  iranOrder: number; // 0=Sat..6=Fri
  label: string;
}

export const IRANIAN_WEEKDAYS: IranianWeekdayOption[] = [
  { jsWeekday: 6, iranOrder: 0, label: 'شنبه' },
  { jsWeekday: 0, iranOrder: 1, label: 'یکشنبه' },
  { jsWeekday: 1, iranOrder: 2, label: 'دوشنبه' },
  { jsWeekday: 2, iranOrder: 3, label: 'سه‌شنبه' },
  { jsWeekday: 3, iranOrder: 4, label: 'چهارشنبه' },
  { jsWeekday: 4, iranOrder: 5, label: 'پنج‌شنبه' },
  { jsWeekday: 5, iranOrder: 6, label: 'جمعه' },
];

export interface TehranDateTimeParts {
  gy: number;
  gm: number;
  gd: number;
  jy: number;
  jm: number;
  jd: number;
  hour: number;
  minute: number;
  second: number;
  jsWeekday: number;
  weekdayLabel: string;
  jalaliDate: string; // YYYY/MM/DD
  gregorianDate: string; // YYYY-MM-DD
  tehranTime: string; // HH:mm
  tehranTimeWithSeconds: string; // HH:mm:ss
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function normalizeAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

export function getWeekdayLabel(jsWeekday: number): string {
  return IRANIAN_WEEKDAYS.find((d) => d.jsWeekday === jsWeekday)?.label ?? '';
}

export function jsWeekdayToIranOrder(jsWeekday: number): number {
  return (jsWeekday + 1) % 7;
}

const tehranFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  weekday: 'short',
});

const WEEKDAY_SHORT_TO_JS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function utcMsToTehranParts(utcMs: number): TehranDateTimeParts {
  const parts = tehranFormatter.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const gy = Number(map.year);
  const gm = Number(map.month);
  const gd = Number(map.day);
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const minute = Number(map.minute);
  const second = Number(map.second);
  const jsWeekday = WEEKDAY_SHORT_TO_JS[map.weekday] ?? 0;

  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  const jalaliDate = `${jy}/${pad2(jm)}/${pad2(jd)}`;
  const gregorianDate = `${gy}-${pad2(gm)}-${pad2(gd)}`;
  const tehranTime = `${pad2(hour)}:${pad2(minute)}`;
  const tehranTimeWithSeconds = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;

  return {
    gy,
    gm,
    gd,
    jy,
    jm,
    jd,
    hour,
    minute,
    second,
    jsWeekday,
    weekdayLabel: getWeekdayLabel(jsWeekday),
    jalaliDate,
    gregorianDate,
    tehranTime,
    tehranTimeWithSeconds,
  };
}

export function parseJalaliDateString(dateStr: string): { jy: number; jm: number; jd: number } | null {
  const normalized = normalizeAsciiDigits(dateStr.trim()).replace(/-/g, '/');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (!isValidJalaaliDate(jy, jm, jd)) {
    return null;
  }
  return { jy, jm, jd };
}

export function isValidJalaliString(dateStr: string): boolean {
  return parseJalaliDateString(dateStr) !== null;
}

export function formatJalaliDate(jy: number, jm: number, jd: number): string {
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

export function jalaliStringToGregorianString(dateStr: string): string | null {
  const parsed = parseJalaliDateString(dateStr);
  if (!parsed) return null;
  const { gy, gm, gd } = toGregorian(parsed.jy, parsed.jm, parsed.jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

export function parseTimeString(timeStr: string): { hour: number; minute: number } | null {
  const normalized = normalizeAsciiDigits(timeStr.trim());
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Converts a Tehran wall-clock date/time (Gregorian y/m/d + h:m) into UTC epoch ms.
 * Uses iterative timezone resolution via Intl.DateTimeFormat('Asia/Tehran') so it
 * never depends on the local machine timezone or hardcodes DST assumptions.
 */
export function gregorianTehranWallTimeToUtcMs(
  gy: number,
  gm: number,
  gd: number,
  hour: number,
  minute: number,
  second = 0
): number {
  const targetAsUtc = Date.UTC(gy, gm - 1, gd, hour, minute, second, 0);
  // Tehran is ~UTC+03:30 (210 minutes)
  let candidate = targetAsUtc - 210 * 60 * 1000;

  for (let i = 0; i < 3; i++) {
    const actual = utcMsToTehranParts(candidate);
    const actualAsUtc = Date.UTC(
      actual.gy,
      actual.gm - 1,
      actual.gd,
      actual.hour,
      actual.minute,
      actual.second,
      0
    );
    const diff = targetAsUtc - actualAsUtc;
    if (diff === 0) break;
    candidate += diff;
  }

  return candidate;
}

export function jalaliTehranWallTimeToUtcMs(
  jalaliDateStr: string,
  timeStr: string
): number | null {
  const jParsed = parseJalaliDateString(jalaliDateStr);
  const tParsed = parseTimeString(timeStr);
  if (!jParsed || !tParsed) return null;
  const { gy, gm, gd } = toGregorian(jParsed.jy, jParsed.jm, jParsed.jd);
  return gregorianTehranWallTimeToUtcMs(gy, gm, gd, tParsed.hour, tParsed.minute, 0);
}

export function addDaysGregorian(
  gy: number,
  gm: number,
  gd: number,
  deltaDays: number
): { gy: number; gm: number; gd: number; jsWeekday: number } {
  const d = new Date(Date.UTC(gy, gm - 1, gd + deltaDays));
  return {
    gy: d.getUTCFullYear(),
    gm: d.getUTCMonth() + 1,
    gd: d.getUTCDate(),
    jsWeekday: d.getUTCDay(),
  };
}

export function getJalaliWeekday(jalaliDateStr: string): string | null {
  const parsed = parseJalaliDateString(jalaliDateStr);
  if (!parsed) return null;
  const { gy, gm, gd } = toGregorian(parsed.jy, parsed.jm, parsed.jd);
  const jsWeekday = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay();
  return getWeekdayLabel(jsWeekday);
}

/**
 * Computes the target meal Jalali date for a given execution timestamp in Tehran.
 * Week starts on Saturday (iranOrder 0..6).
 * weekOffset = 1 means "next Iranian week" (e.g., ناهار دوشنبهٔ هفتهٔ بعد).
 */
export function computeTargetMealDateForRun(
  executionUtcMs: number,
  targetMealJsWeekday: number,
  weekOffset = 1
): { jalaliDate: string; gregorianDate: string; weekdayLabel: string } {
  const execParts = utcMsToTehranParts(executionUtcMs);
  const execIranOrder = jsWeekdayToIranOrder(execParts.jsWeekday);
  const targetIranOrder = jsWeekdayToIranOrder(targetMealJsWeekday);

  // Days from execution day to target day in week + weekOffset Iranian weeks
  let deltaDays = targetIranOrder - execIranOrder + weekOffset * 7;
  // Safety: if weekOffset is 0 and target weekday already passed this week, advance 7 days
  if (weekOffset === 0 && deltaDays <= 0) {
    deltaDays += 7;
  }

  const targetGreg = addDaysGregorian(execParts.gy, execParts.gm, execParts.gd, deltaDays);
  const { jy, jm, jd } = toJalaali(targetGreg.gy, targetGreg.gm, targetGreg.gd);

  return {
    jalaliDate: formatJalaliDate(jy, jm, jd),
    gregorianDate: `${targetGreg.gy}-${pad2(targetGreg.gm)}-${pad2(targetGreg.gd)}`,
    weekdayLabel: getWeekdayLabel(targetGreg.jsWeekday),
  };
}

export function computeNextWeeklyExecutionUtcMs(
  nowUtcMs: number,
  executionJsWeekday: number,
  actionTimeTehran: string
): number {
  const nowParts = utcMsToTehranParts(nowUtcMs);
  const parsedTime = parseTimeString(actionTimeTehran) ?? { hour: 20, minute: 30 };

  let daysUntil = (executionJsWeekday - nowParts.jsWeekday + 7) % 7;
  let candidateUtc = gregorianTehranWallTimeToUtcMs(
    nowParts.gy,
    nowParts.gm,
    nowParts.gd,
    parsedTime.hour,
    parsedTime.minute,
    0
  );

  if (daysUntil > 0) {
    const shifted = addDaysGregorian(nowParts.gy, nowParts.gm, nowParts.gd, daysUntil);
    candidateUtc = gregorianTehranWallTimeToUtcMs(
      shifted.gy,
      shifted.gm,
      shifted.gd,
      parsedTime.hour,
      parsedTime.minute,
      0
    );
  } else if (candidateUtc <= nowUtcMs) {
    const shifted = addDaysGregorian(nowParts.gy, nowParts.gm, nowParts.gd, 7);
    candidateUtc = gregorianTehranWallTimeToUtcMs(
      shifted.gy,
      shifted.gm,
      shifted.gd,
      parsedTime.hour,
      parsedTime.minute,
      0
    );
  }

  return candidateUtc;
}

export function computeTargetMealDatesForRun(
  executionUtcMs: number,
  targetMealJsWeekdays: number[],
  weekOffset = 1
): Array<{ jalaliDate: string; gregorianDate: string; weekdayLabel: string }> {
  const uniqueSorted = Array.from(
    new Set(targetMealJsWeekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ).sort((a, b) => jsWeekdayToIranOrder(a) - jsWeekdayToIranOrder(b));
  const days = uniqueSorted.length > 0 ? uniqueSorted : [1];
  return days.map((wd) => computeTargetMealDateForRun(executionUtcMs, wd, weekOffset));
}

export function computeNextRunDetails(
  schedule: ScheduleConfig,
  nowUtcMs: number
): NextRunComputed {
  const selectedWeekdays =
    Array.isArray(schedule.weeklyTargetMealJsWeekdays) &&
    schedule.weeklyTargetMealJsWeekdays.length > 0
      ? schedule.weeklyTargetMealJsWeekdays
      : [schedule.weeklyTargetMealJsWeekday ?? 1];

  if (!schedule.enabled || schedule.mode === 'now') {
    const fallbackTargets = computeTargetMealDatesForRun(
      nowUtcMs,
      selectedWeekdays,
      schedule.weeklyTargetWeekOffset
    );
    const firstFallback = fallbackTargets[0];
    const onceValid =
      schedule.mode === 'once' && isValidJalaliString(schedule.onceTargetMealDateJalali);
    const onceWeekday = onceValid ? getJalaliWeekday(schedule.onceTargetMealDateJalali) : null;

    return {
      enabled: schedule.enabled,
      mode: schedule.mode,
      nextActionUtcMs: null,
      nextActionJalaliDate: null,
      nextActionTehranTime: null,
      nextActionWeekdayLabel: null,
      earlyLoginUtcMs: null,
      earlyLoginJalaliDate: null,
      earlyLoginTehranTime: null,
      targetMealDateJalali: onceValid
        ? schedule.onceTargetMealDateJalali
        : firstFallback.jalaliDate,
      targetMealDateGregorian: onceValid
        ? jalaliStringToGregorianString(schedule.onceTargetMealDateJalali)
        : firstFallback.gregorianDate,
      targetMealWeekdayLabel: onceValid ? onceWeekday : firstFallback.weekdayLabel,
      targetMealDatesJalali: onceValid
        ? [schedule.onceTargetMealDateJalali]
        : fallbackTargets.map((t) => t.jalaliDate),
      targetMealWeekdayLabels: onceValid
        ? [onceWeekday ?? ''].filter(Boolean)
        : fallbackTargets.map((t) => t.weekdayLabel),
    };
  }

  let nextActionUtcMs: number | null = null;
  let targetMealDateJalali: string | null = null;
  let targetMealDateGregorian: string | null = null;
  let targetMealWeekdayLabel: string | null = null;
  let targetMealDatesJalali: string[] = [];
  let targetMealWeekdayLabels: string[] = [];

  if (schedule.mode === 'once') {
    nextActionUtcMs = jalaliTehranWallTimeToUtcMs(
      schedule.onceActionDateJalali,
      schedule.actionTimeTehran
    );
    if (isValidJalaliString(schedule.onceTargetMealDateJalali)) {
      const parsed = parseJalaliDateString(schedule.onceTargetMealDateJalali)!;
      targetMealDateJalali = formatJalaliDate(parsed.jy, parsed.jm, parsed.jd);
      targetMealDateGregorian = jalaliStringToGregorianString(targetMealDateJalali);
      targetMealWeekdayLabel = getJalaliWeekday(targetMealDateJalali);
      targetMealDatesJalali = [targetMealDateJalali];
      if (targetMealWeekdayLabel) {
        targetMealWeekdayLabels = [targetMealWeekdayLabel];
      }
    }
  } else if (schedule.mode === 'weekly') {
    nextActionUtcMs = computeNextWeeklyExecutionUtcMs(
      nowUtcMs,
      schedule.weeklyExecutionJsWeekday,
      schedule.actionTimeTehran
    );
    const targets = computeTargetMealDatesForRun(
      nextActionUtcMs,
      selectedWeekdays,
      schedule.weeklyTargetWeekOffset
    );
    targetMealDateJalali = targets[0]?.jalaliDate ?? null;
    targetMealDateGregorian = targets[0]?.gregorianDate ?? null;
    targetMealWeekdayLabel = targets[0]?.weekdayLabel ?? null;
    targetMealDatesJalali = targets.map((t) => t.jalaliDate);
    targetMealWeekdayLabels = targets.map((t) => t.weekdayLabel);
  }

  if (nextActionUtcMs === null) {
    return {
      enabled: false,
      mode: schedule.mode,
      nextActionUtcMs: null,
      nextActionJalaliDate: null,
      nextActionTehranTime: null,
      nextActionWeekdayLabel: null,
      earlyLoginUtcMs: null,
      earlyLoginJalaliDate: null,
      earlyLoginTehranTime: null,
      targetMealDateJalali,
      targetMealDateGregorian,
      targetMealWeekdayLabel,
      targetMealDatesJalali,
      targetMealWeekdayLabels,
    };
  }

  const actionParts = utcMsToTehranParts(nextActionUtcMs);
  const leadMs = Math.max(0, schedule.earlyLoginMinutes) * 60 * 1000;
  const earlyLoginUtcMs = nextActionUtcMs - leadMs;
  const earlyParts = utcMsToTehranParts(earlyLoginUtcMs);

  return {
    enabled: schedule.enabled,
    mode: schedule.mode,
    nextActionUtcMs,
    nextActionJalaliDate: actionParts.jalaliDate,
    nextActionTehranTime: actionParts.tehranTime,
    nextActionWeekdayLabel: actionParts.weekdayLabel,
    earlyLoginUtcMs,
    earlyLoginJalaliDate: earlyParts.jalaliDate,
    earlyLoginTehranTime: earlyParts.tehranTime,
    targetMealDateJalali,
    targetMealDateGregorian,
    targetMealWeekdayLabel,
    targetMealDatesJalali,
    targetMealWeekdayLabels,
  };
}
