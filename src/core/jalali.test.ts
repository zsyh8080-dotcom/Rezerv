import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRunDetails,
  computeTargetMealDateForRun,
  computeTargetMealDatesForRun,
  gregorianTehranWallTimeToUtcMs,
  isValidJalaliString,
  jalaliStringToGregorianString,
  jalaliTehranWallTimeToUtcMs,
  utcMsToTehranParts,
} from './jalali';
import { createInitialScheduleConfig } from './state';

test('validates Jalali dates including leap vs non-leap Esfand', () => {
  assert.equal(isValidJalaliString('1405/09/02'), true);
  assert.equal(isValidJalaliString('۱۴۰۵/۰۹/۰۲'), true); // Persian digits supported
  assert.equal(isValidJalaliString('1405/12/30'), false); // 1405 is not a leap year
  assert.equal(isValidJalaliString('1403/12/30'), true); // 1403 is a leap year
  assert.equal(isValidJalaliString('1405/13/01'), false);
});

test('converts Jalali date and Tehran 20:30 wall-clock to exact UTC and back', () => {
  const greg = jalaliStringToGregorianString('1405/08/27');
  assert.equal(greg, '2026-11-18');

  const utcMs = jalaliTehranWallTimeToUtcMs('1405/08/27', '20:30');
  assert.ok(utcMs !== null);

  const back = utcMsToTehranParts(utcMs);
  assert.equal(back.jalaliDate, '1405/08/27');
  assert.equal(back.tehranTime, '20:30');
  assert.equal(back.weekdayLabel, 'چهارشنبه');

  // Verify UTC offset is +03:30 (17:00 UTC == 20:30 Tehran)
  const utcDate = new Date(utcMs);
  assert.equal(utcDate.getUTCHours(), 17);
  assert.equal(utcDate.getUTCMinutes(), 0);
});

test('computes next Monday lunch in Iranian week and recalculates weekly runs', () => {
  // 2026-11-18 20:30 Tehran = Wednesday 1405/08/27
  const wednesdayRunMs = gregorianTehranWallTimeToUtcMs(2026, 11, 18, 20, 30);
  const nextMonday = computeTargetMealDateForRun(wednesdayRunMs, 1, 1);

  assert.equal(nextMonday.weekdayLabel, 'دوشنبه');
  // Current week Sat is 1405/08/23 -> next week Mon is 1405/09/02 (2026-11-23)
  assert.equal(nextMonday.jalaliDate, '1405/09/02');
  assert.equal(nextMonday.gregorianDate, '2026-11-23');

  // Weekly recalculation one week later (2026-11-25) -> 1405/09/09
  const nextWeekWedMs = gregorianTehranWallTimeToUtcMs(2026, 11, 25, 20, 30);
  const followingMonday = computeTargetMealDateForRun(nextWeekWedMs, 1, 1);
  assert.equal(followingMonday.jalaliDate, '1405/09/09');
  assert.equal(followingMonday.weekdayLabel, 'دوشنبه');
});

test('computes multi-day target meal dates sorted by Iranian week order (Saturday first)', () => {
  // 2026-11-18 20:30 Tehran = Wednesday 1405/08/27
  const wednesdayRunMs = gregorianTehranWallTimeToUtcMs(2026, 11, 18, 20, 30);
  // Select Wednesday (3), Saturday (6), and Monday (1) -> should sort Sat, Mon, Wed
  const targets = computeTargetMealDatesForRun(wednesdayRunMs, [3, 6, 1, 1], 1);

  assert.equal(targets.length, 3);
  assert.deepEqual(
    targets.map((t) => t.weekdayLabel),
    ['شنبه', 'دوشنبه', 'چهارشنبه']
  );
  assert.deepEqual(
    targets.map((t) => t.jalaliDate),
    ['1405/08/30', '1405/09/02', '1405/09/04']
  );
});

test('early login is computed 10 minutes before 20:30 by default and respects custom lead minutes', () => {
  const nowMs = gregorianTehranWallTimeToUtcMs(2026, 11, 18, 12, 0);
  const schedule = createInitialScheduleConfig(nowMs);
  assert.equal(schedule.earlyLoginMinutes, 10);
  schedule.enabled = true;
  schedule.mode = 'once';
  schedule.onceActionDateJalali = '1405/08/27';
  schedule.actionTimeTehran = '20:30';

  const defaultComputed = computeNextRunDetails(schedule, nowMs);
  assert.equal(defaultComputed.nextActionJalaliDate, '1405/08/27');
  assert.equal(defaultComputed.nextActionTehranTime, '20:30');
  assert.equal(defaultComputed.earlyLoginJalaliDate, '1405/08/27');
  assert.equal(defaultComputed.earlyLoginTehranTime, '20:20');

  schedule.earlyLoginMinutes = 5;
  const customComputed = computeNextRunDetails(schedule, nowMs);
  assert.equal(customComputed.earlyLoginTehranTime, '20:25');
});
