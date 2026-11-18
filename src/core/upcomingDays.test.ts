import test from 'node:test';
import assert from 'node:assert/strict';
import { utcMsToTehranParts } from './jalali';
import { createInitialPersistentState, buildPublicSnapshot } from './state';
import {
  buildUpcomingDaysSummary,
  deriveToastForReservationResult,
} from './upcomingDays';
import type { NextRunComputed } from './types';

test('buildUpcomingDaysSummary resolves reserved, failed, and pending across next 3 days', () => {
  const nowUtcMs = Date.UTC(2026, 10, 18, 12, 0, 0); // 1405/08/27
  const day1 = utcMsToTehranParts(nowUtcMs + 1 * 86400_000).jalaliDate;
  const day2 = utcMsToTehranParts(nowUtcMs + 2 * 86400_000).jalaliDate;
  const day3 = utcMsToTehranParts(nowUtcMs + 3 * 86400_000).jalaliDate;

  const nextRun: NextRunComputed = {
    enabled: true,
    mode: 'weekly',
    nextActionUtcMs: nowUtcMs + 3600_000,
    nextActionJalaliDate: utcMsToTehranParts(nowUtcMs).jalaliDate,
    nextActionTehranTime: '20:30',
    nextActionWeekdayLabel: 'چهارشنبه',
    earlyLoginUtcMs: null,
    earlyLoginJalaliDate: null,
    earlyLoginTehranTime: null,
    targetMealDateJalali: day3,
    targetMealDateGregorian: null,
    targetMealWeekdayLabel: null,
    targetMealDatesJalali: [day3],
    targetMealWeekdayLabels: [],
  };

  const summary = buildUpcomingDaysSummary({
    nowUtcMs,
    reservedMeals: [
      {
        reservationCode: 'IUT-9001',
        targetDateJalali: day1,
        meal: 'lunch',
        mealLabel: 'ناهار',
        diningHall: 'تریا کاج',
        foodName: 'ماکارونی با سویا',
        priceRials: 345000,
        reservedAtJalali: day1,
        status: 'CONFIRMED',
      },
    ],
    history: [
      {
        id: 'fail-day1-old',
        trigger: 'MANUAL',
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs - 5000,
        startedAtJalali: day1,
        startedAtTehranTime: '12:00:00',
        targetDateJalali: day1,
        message: 'خطای قدیمی',
      },
      {
        id: 'fail-day2',
        trigger: 'SCHEDULED',
        status: 'FAILED',
        startedAtUtcMs: nowUtcMs - 1000,
        startedAtJalali: day2,
        startedAtTehranTime: '12:00:00',
        targetDateJalali: day2,
        message: 'منو باز نشد',
      },
    ],
    nextRun,
  });

  assert.equal(summary.length, 3);

  // Day 1 has CONFIRMED reservation which takes precedence over older FAILED attempt
  assert.equal(summary[0].dateJalali, day1);
  assert.equal(summary[0].relativeLabel, 'فردا');
  assert.equal(summary[0].status, 'reserved');
  assert.equal(summary[0].statusLabel, 'رزرو شده');
  assert.equal(summary[0].reservationCode, 'IUT-9001');

  // Day 2 has latest FAILED attempt and no confirmed meal
  assert.equal(summary[1].dateJalali, day2);
  assert.equal(summary[1].relativeLabel, 'پس‌فردا');
  assert.equal(summary[1].status, 'failed');
  assert.equal(summary[1].statusLabel, 'ناموفق');
  assert.equal(summary[1].detailText, 'منو باز نشد');

  // Day 3 is pending and matched in nextRun targets
  assert.equal(summary[2].dateJalali, day3);
  assert.equal(summary[2].status, 'pending');
  assert.equal(summary[2].statusLabel, 'در انتظار');
  assert.equal(summary[2].scheduledForRun, true);
  assert.ok(summary[2].detailText.includes('20:30'));
});

test('deriveToastForReservationResult maps RESERVED, BLOCKED_DUPLICATE, and FAILED accurately', () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.lastStatus = 'RESERVED';
  state.lastMessage = 'ثبت شد';
  state.lastReceipt = {
    reservationCode: 'IUT-1234',
    targetDateJalali: '1405/09/02',
    targetDateGregorian: '2026-11-23',
    meal: 'lunch',
    mealLabel: 'ناهار',
    diningHall: 'تریا کاج',
    foodName: 'زرشک‌پلو',
    quantity: 1,
    priceRials: 350000,
    priceToman: 35000,
    paymentSource: 'UNIVERSITY_CREDIT',
    confirmedAtUtcMs: nowMs,
    confirmedAtJalali: '1405/08/27',
    confirmedAtTehranTime: '20:30',
    remainingCreditRials: 1500000,
  };

  const snapOk = buildPublicSnapshot(state, {
    runtimeMode: 'SANDBOX',
    runtimeUsernameConfigured: false,
    runtimePasswordConfigured: false,
    nowUtcMs: nowMs,
  });
  const t1 = deriveToastForReservationResult(snapOk);
  assert.equal(t1.tone, 'success');
  assert.ok(t1.message?.includes('IUT-1234'));

  snapOk.lastStatus = 'BLOCKED_DUPLICATE';
  assert.equal(deriveToastForReservationResult(snapOk).tone, 'warning');

  snapOk.lastStatus = 'FAILED';
  assert.equal(deriveToastForReservationResult(snapOk).tone, 'error');
});
