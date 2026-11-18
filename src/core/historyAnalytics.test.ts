import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayStatusMap,
  buildJalaliMonthCalendar,
  computeMonthlySpendingSummary,
  formatJalaliReadable,
  shiftJalaliMonth,
} from './historyAnalytics';
import type { ExecutionRecord, ReservedMeal } from './types';

test('calculates monthly spending totals excluding cancelled meals from net cost', () => {
  const meals: ReservedMeal[] = [
    {
      reservationCode: 'IUT-1',
      targetDateJalali: '1405/07/20',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: 'تریا کاج',
      foodName: 'ماکارونی',
      priceRials: 345000,
      reservedAtJalali: '1405/07/16 20:30',
      status: 'CONFIRMED',
    },
    {
      reservationCode: 'IUT-2',
      targetDateJalali: '1405/08/11',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: 'رستوران مکمل کاج',
      foodName: 'زرشک‌پلو با اکبرجوجه',
      priceRials: 490000,
      reservedAtJalali: '1405/08/07 20:30',
      status: 'CONFIRMED',
    },
    {
      reservationCode: 'IUT-3',
      targetDateJalali: '1405/08/18',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: 'تریا کاج',
      foodName: 'خوراک جوجه',
      priceRials: 350000,
      reservedAtJalali: '1405/08/14 20:30',
      status: 'CANCELLED',
    },
  ];

  const summary = computeMonthlySpendingSummary(meals);
  assert.equal(summary.months.length, 2);
  assert.equal(summary.months[0].monthKey, '1405/07');
  assert.equal(summary.months[0].totalCostToman, 34500);
  assert.equal(summary.months[1].monthKey, '1405/08');
  assert.equal(summary.months[1].totalCostToman, 49000);
  assert.equal(summary.months[1].cancelledCount, 1);
  assert.equal(summary.totalCostToman, 83500);
  assert.equal(summary.totalConfirmedMeals, 2);
  assert.equal(summary.totalCancelledMeals, 1);
});

test('builds Jalali month calendar and differentiates Reserved, Cancelled, and Missed meals', () => {
  const meals: ReservedMeal[] = [
    {
      reservationCode: 'IUT-10',
      targetDateJalali: '1405/08/11',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: 'تریا کاج',
      foodName: 'ماکارونی',
      priceRials: 345000,
      reservedAtJalali: '1405/08/07 20:30',
      status: 'CONFIRMED',
    },
    {
      reservationCode: 'IUT-11',
      targetDateJalali: '1405/08/18',
      meal: 'lunch',
      mealLabel: 'ناهار',
      diningHall: 'رستوران آسمان',
      foodName: 'جوجه‌کباب',
      priceRials: 500000,
      reservedAtJalali: '1405/08/14 20:30',
      status: 'CANCELLED',
    },
  ];

  const history: ExecutionRecord[] = [
    {
      id: 'h-1',
      trigger: 'SCHEDULED',
      status: 'FAILED',
      startedAtUtcMs: 1,
      startedAtJalali: '1405/08/21',
      startedAtTehranTime: '20:30:00',
      targetDateJalali: '1405/08/25',
      message: 'غذای مجاز یافت نشد.',
      errorCode: 'NO_ELIGIBLE_FOOD',
    },
  ];

  const map = buildDayStatusMap(meals, history);
  assert.equal(map.get('1405/08/11')?.status, 'reserved');
  assert.equal(map.get('1405/08/18')?.status, 'cancelled');
  assert.equal(map.get('1405/08/25')?.status, 'missed');

  const cells = buildJalaliMonthCalendar(1405, 8, map);
  const day11 = cells.find((c) => c.dayNumber === 11);
  const day18 = cells.find((c) => c.dayNumber === 18);
  const day25 = cells.find((c) => c.dayNumber === 25);

  assert.equal(day11?.record?.status, 'reserved');
  assert.equal(day18?.record?.status, 'cancelled');
  assert.equal(day25?.record?.status, 'missed');
  assert.equal(formatJalaliReadable('1405/09/02'), 'دوشنبه ۲ آذر ۱۴۰۵');
  assert.deepEqual(shiftJalaliMonth(1405, 1, -1), { jy: 1404, jm: 12 });
});
