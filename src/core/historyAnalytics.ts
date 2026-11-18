import { jalaaliMonthLength, toGregorian } from 'jalaali-js';
import {
  formatJalaliDate,
  getJalaliWeekday,
  jsWeekdayToIranOrder,
  pad2,
  parseJalaliDateString,
  toPersianDigits,
} from './jalali';
import { rialsToToman } from './policy';
import type { ExecutionRecord, ReservedMeal } from './types';

export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

export type CalendarMealStatus = 'reserved' | 'cancelled' | 'missed';

export interface MonthlySpendingPoint {
  monthKey: string; // "1405/08"
  monthLabel: string; // "آبان ۱۴۰۵"
  shortLabel: string; // "آبان"
  totalCostToman: number;
  totalCostRials: number;
  confirmedCount: number;
  cancelledCount: number;
}

export interface SpendingSummaryResult {
  months: MonthlySpendingPoint[];
  totalCostToman: number;
  totalConfirmedMeals: number;
  totalCancelledMeals: number;
}

export interface DayMealRecord {
  dateJalali: string;
  status: CalendarMealStatus;
  foodName?: string;
  diningHall?: string;
  priceToman?: number;
  reservationCode?: string;
  note: string;
}

export interface CalendarDayCell {
  key: string;
  dayNumber: number | null;
  jalaliDate: string | null;
  record: DayMealRecord | null;
}

export function getJalaliMonthLabel(jy: number, jm: number): string {
  const monthName = JALALI_MONTH_NAMES[jm - 1] ?? String(jm);
  return `${monthName} ${toPersianDigits(jy)}`;
}

export function formatJalaliReadable(jalaliDateStr: string): string {
  const parsed = parseJalaliDateString(jalaliDateStr);
  if (!parsed) return jalaliDateStr;
  const weekday = getJalaliWeekday(jalaliDateStr);
  const monthName = JALALI_MONTH_NAMES[parsed.jm - 1] ?? '';
  const dayFa = toPersianDigits(parsed.jd);
  const yearFa = toPersianDigits(parsed.jy);
  return weekday ? `${weekday} ${dayFa} ${monthName} ${yearFa}` : `${dayFa} ${monthName} ${yearFa}`;
}

export function computeMonthlySpendingSummary(
  reservedMeals: ReservedMeal[]
): SpendingSummaryResult {
  const monthMap = new Map<
    string,
    {
      jy: number;
      jm: number;
      totalCostRials: number;
      confirmedCount: number;
      cancelledCount: number;
    }
  >();

  let totalCostRialsAll = 0;
  let totalConfirmedMeals = 0;
  let totalCancelledMeals = 0;

  for (const meal of reservedMeals) {
    const parsed = parseJalaliDateString(meal.targetDateJalali);
    if (!parsed) continue;
    const key = `${parsed.jy}/${pad2(parsed.jm)}`;
    const bucket = monthMap.get(key) ?? {
      jy: parsed.jy,
      jm: parsed.jm,
      totalCostRials: 0,
      confirmedCount: 0,
      cancelledCount: 0,
    };

    if (meal.status === 'CONFIRMED') {
      bucket.totalCostRials += meal.priceRials;
      bucket.confirmedCount += 1;
      totalCostRialsAll += meal.priceRials;
      totalConfirmedMeals += 1;
    } else if (meal.status === 'CANCELLED') {
      bucket.cancelledCount += 1;
      totalCancelledMeals += 1;
    }

    monthMap.set(key, bucket);
  }

  const months: MonthlySpendingPoint[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, b]) => ({
      monthKey,
      monthLabel: getJalaliMonthLabel(b.jy, b.jm),
      shortLabel: JALALI_MONTH_NAMES[b.jm - 1] ?? monthKey,
      totalCostToman: rialsToToman(b.totalCostRials),
      totalCostRials: b.totalCostRials,
      confirmedCount: b.confirmedCount,
      cancelledCount: b.cancelledCount,
    }));

  return {
    months,
    totalCostToman: rialsToToman(totalCostRialsAll),
    totalConfirmedMeals,
    totalCancelledMeals,
  };
}

export function buildDayStatusMap(
  reservedMeals: ReservedMeal[],
  history: ExecutionRecord[]
): Map<string, DayMealRecord> {
  const map = new Map<string, DayMealRecord>();

  // 1. Add missed attempts from execution history first (lowest precedence)
  for (const rec of history) {
    if (rec.trigger === 'LOGIN_TEST' || rec.trigger === 'CONNECTION_TEST') {
      continue;
    }
    if (
      rec.status !== 'FAILED' &&
      rec.status !== 'AMBIGUOUS_RESOLVED_NOT_RESERVED'
    ) {
      continue;
    }
    const parsed = parseJalaliDateString(rec.targetDateJalali);
    if (!parsed) continue;
    const dateKey = formatJalaliDate(parsed.jy, parsed.jm, parsed.jd);
    if (!map.has(dateKey)) {
      map.set(dateKey, {
        dateJalali: dateKey,
        status: 'missed',
        note: rec.message,
      });
    }
  }

  // 2. Add cancelled meals (overrides missed)
  for (const meal of reservedMeals) {
    if (meal.status !== 'CANCELLED') continue;
    const parsed = parseJalaliDateString(meal.targetDateJalali);
    if (!parsed) continue;
    const dateKey = formatJalaliDate(parsed.jy, parsed.jm, parsed.jd);
    const existing = map.get(dateKey);
    if (!existing || existing.status !== 'reserved') {
      map.set(dateKey, {
        dateJalali: dateKey,
        status: 'cancelled',
        foodName: meal.foodName,
        diningHall: meal.diningHall,
        priceToman: rialsToToman(meal.priceRials),
        reservationCode: meal.reservationCode,
        note: `لغو شده · ${meal.foodName} در ${meal.diningHall}`,
      });
    }
  }

  // 3. Add confirmed reservations (highest precedence)
  for (const meal of reservedMeals) {
    if (meal.status !== 'CONFIRMED') continue;
    const parsed = parseJalaliDateString(meal.targetDateJalali);
    if (!parsed) continue;
    const dateKey = formatJalaliDate(parsed.jy, parsed.jm, parsed.jd);
    map.set(dateKey, {
      dateJalali: dateKey,
      status: 'reserved',
      foodName: meal.foodName,
      diningHall: meal.diningHall,
      priceToman: rialsToToman(meal.priceRials),
      reservationCode: meal.reservationCode,
      note: `${meal.foodName} · ${meal.diningHall}`,
    });
  }

  return map;
}

export function buildJalaliMonthCalendar(
  jy: number,
  jm: number,
  dayStatusMap: Map<string, DayMealRecord>
): CalendarDayCell[] {
  const daysInMonth = jalaaliMonthLength(jy, jm);
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  const firstJsWeekday = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay();
  const leadingEmpty = jsWeekdayToIranOrder(firstJsWeekday); // 0=Sat .. 6=Fri

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < leadingEmpty; i++) {
    cells.push({
      key: `empty-${jy}-${jm}-${i}`,
      dayNumber: null,
      jalaliDate: null,
      record: null,
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const jalaliDate = formatJalaliDate(jy, jm, day);
    cells.push({
      key: jalaliDate,
      dayNumber: day,
      jalaliDate,
      record: dayStatusMap.get(jalaliDate) ?? null,
    });
  }

  return cells;
}

export function shiftJalaliMonth(
  jy: number,
  jm: number,
  delta: -1 | 1
): { jy: number; jm: number } {
  let nextMonth = jm + delta;
  let nextYear = jy;
  if (nextMonth < 1) {
    nextMonth = 12;
    nextYear -= 1;
  } else if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return { jy: nextYear, jm: nextMonth };
}
