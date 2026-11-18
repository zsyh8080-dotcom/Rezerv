import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  isForbiddenFood,
  normalizeForMatch,
  normalizePolicyConfig,
  selectBestMeal,
  verifyCartMatchesSelection,
} from './policy';
import type { MenuItem } from './types';

test('normalizes Persian/Arabic letters, spaces, and ZWNJ for forbidden foods', () => {
  const kw = DEFAULT_POLICY.forbiddenKeywords;

  assert.equal(normalizeForMatch('چلو\u200Cمرغ'), 'چلومرغ');
  assert.equal(isForbiddenFood('چلوکباب كوبيده', kw), true); // Arabic kaf & yeh
  assert.equal(isForbiddenFood('عدس پلو با گوشت', kw), true);
  assert.equal(isForbiddenFood('عدس‌پلو', kw), true);
  assert.equal(isForbiddenFood('عدسپلو', kw), true);
  assert.equal(isForbiddenFood('چلومرغ زعفرانی', kw), true);
  assert.equal(isForbiddenFood('چلو مرغ', kw), true);
  assert.equal(isForbiddenFood('خورش قيمه سیب زمینی', kw), true);
  assert.equal(isForbiddenFood('زرشک‌پلو با اکبرجوجه', kw), false);
});

test('prefers cheapest eligible specific dish <= 35k Toman (350k Rials) over 50k and pay-at-location', () => {
  const menu: MenuItem[] = [
    { id: '1', name: 'عدس پلو', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 280000, available: true },
    { id: '2', name: 'چلوکباب کوبیده', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 320000, available: true },
    { id: '3', name: 'انتخاب و تسویه در محل', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 300000, available: true, isPayAtLocation: true },
    { id: '4', name: 'زرشک‌پلو با ران', diningHall: 'رستوران آسمان', meal: 'lunch', priceRials: 480000, available: true },
    { id: '5', name: 'ماکارونی با سویا', diningHall: 'رستوران مکمل کاج', meal: 'lunch', priceRials: 345000, available: true },
    { id: '6', name: 'خوراک ویژه', diningHall: 'سلف مرکزی', meal: 'lunch', priceRials: 250000, available: true },
  ];

  const decision = selectBestMeal(menu, DEFAULT_POLICY, 2000000);
  assert.equal(decision.ok, true);
  assert.equal(decision.selectedItem?.id, '5'); // ماکارونی 345k Rials beats pay-at-location & 480k
});

test('prioritizes user desired food (preferredKeywords) ahead of cheaper generic items in listed order', () => {
  const menu: MenuItem[] = [
    { id: '1', name: 'ماکارونی با سویا', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 345000, available: true },
    { id: '2', name: 'زرشک‌پلو با اکبرجوجه', diningHall: 'رستوران مکمل کاج', meal: 'lunch', priceRials: 490000, available: true },
    { id: '3', name: 'جوجه‌کباب با برنج', diningHall: 'رستوران آسمان', meal: 'lunch', priceRials: 500000, available: true },
  ];

  // User explicitly wants زرشک‌پلو first
  const d1 = selectBestMeal(
    menu,
    { ...DEFAULT_POLICY, preferredKeywords: ['قورمه‌سبزی', 'زرشک‌پلو', 'ماکارونی'] },
    2000000
  );
  assert.equal(d1.ok, true);
  assert.equal(d1.selectedItem?.id, '2');
  assert.ok(d1.tierLabel?.includes('غذای دلخواه'));

  // When preferred food isn't on menu and onlyReservePreferred is false, falls back safely
  const dFallback = selectBestMeal(
    menu,
    { ...DEFAULT_POLICY, preferredKeywords: ['فسنجان'], onlyReservePreferred: false },
    2000000
  );
  assert.equal(dFallback.ok, true);
  assert.equal(dFallback.selectedItem?.id, '1');

  // When onlyReservePreferred is true and none of desired dishes exist, stops with NO_ELIGIBLE_FOOD
  const dStrict = selectBestMeal(
    menu,
    { ...DEFAULT_POLICY, preferredKeywords: ['فسنجان'], onlyReservePreferred: true },
    2000000
  );
  assert.equal(dStrict.ok, false);
  assert.equal(dStrict.errorCode, 'NO_ELIGIBLE_FOOD');

  // Matches custom/new user-entered dish names even with phrasing variations
  const customMenu: MenuItem[] = [
    { id: 'c1', name: 'ماکارونی با سویا', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 340000, available: true },
    { id: 'c2', name: 'ته چین با مرغ و سالاد', diningHall: 'رستوران مکمل کاج', meal: 'lunch', priceRials: 480000, available: true },
  ];
  const dCustom = selectBestMeal(
    customMenu,
    { ...DEFAULT_POLICY, preferredKeywords: ['ته‌چین مرغ'] },
    2000000
  );
  assert.equal(dCustom.ok, true);
  assert.equal(dCustom.selectedItem?.id, 'c2');
});

test('normalizePolicyConfig safely hydrates legacy partial configs and deduplicates keywords', () => {
  const hydrated = normalizePolicyConfig({
    preferredKeywords: [' زرشک پلو ', 'زرشک‌پلو', 'ماکارونی'],
  });
  assert.deepEqual(hydrated.preferredKeywords, ['زرشک پلو', 'ماکارونی']);
  assert.equal(hydrated.onlyReservePreferred, false);
  assert.deepEqual(hydrated.forbiddenKeywords, DEFAULT_POLICY.forbiddenKeywords);
});

test('accepts 50k Toman (500k Rials) when no <=35k specific dish is available, and beats pay-at-location', () => {
  const menu: MenuItem[] = [
    { id: '1', name: 'انتخاب و تسویه در محل', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 350000, available: true, isPayAtLocation: true },
    { id: '2', name: 'جوجه‌کباب با برنج', diningHall: 'رستوران مکمل کاج', meal: 'lunch', priceRials: 500000, available: true },
  ];

  const decision = selectBestMeal(menu, DEFAULT_POLICY, 1000000);
  assert.equal(decision.ok, true);
  assert.equal(decision.selectedItem?.id, '2');
});

test('respects optional maxPriceToman ceiling when configured', () => {
  const menu: MenuItem[] = [
    { id: '1', name: 'جوجه‌کباب با برنج', diningHall: 'رستوران مکمل کاج', meal: 'lunch', priceRials: 500000, available: true },
  ];

  const decision = selectBestMeal(menu, { ...DEFAULT_POLICY, maxPriceToman: 40000 }, 1000000);
  assert.equal(decision.ok, false);
  assert.equal(decision.errorCode, 'NO_ELIGIBLE_FOOD');
});

test('blocks purchase if university credit is insufficient', () => {
  const menu: MenuItem[] = [
    { id: '1', name: 'ماکارونی', diningHall: 'تریا کاج', meal: 'lunch', priceRials: 350000, available: true },
  ];

  const decision = selectBestMeal(menu, DEFAULT_POLICY, 200000);
  assert.equal(decision.ok, false);
  assert.equal(decision.errorCode, 'INSUFFICIENT_CREDIT');
});

test('cart verification rejects mismatches on date, hall, food, quantity, or price', () => {
  const chosen: MenuItem = {
    id: '1',
    name: 'ماکارونی',
    diningHall: 'تریا کاج',
    meal: 'lunch',
    priceRials: 345000,
    available: true,
  };

  assert.equal(
    verifyCartMatchesSelection(
      {
        targetDateJalali: '1405/09/02',
        meal: 'lunch',
        diningHall: 'تریا کاج',
        foodName: 'ماکارونی',
        quantity: 1,
        priceRials: 345000,
        paymentSource: 'UNIVERSITY_CREDIT',
      },
      chosen,
      '1405/09/02'
    ).ok,
    true
  );

  const wrongQty = verifyCartMatchesSelection(
    {
      targetDateJalali: '1405/09/02',
      meal: 'lunch',
      diningHall: 'تریا کاج',
      foodName: 'ماکارونی',
      quantity: 2,
      priceRials: 690000,
      paymentSource: 'UNIVERSITY_CREDIT',
    },
    chosen,
    '1405/09/02'
  );
  assert.equal(wrongQty.ok, false);
});
