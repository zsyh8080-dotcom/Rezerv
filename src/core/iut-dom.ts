import type { BrowserContext, Page } from 'playwright-core';
import { normalizeAsciiDigits } from './jalali';
import { normalizeForMatch } from './policy';
import { IUT_URLS, type IutCredentials } from './site';
import type { CartSummary, MenuItem, ReservedMeal } from './types';

const DAY_LABELS = 'label[data-toggle="tab"][href^="#tab_day"]';
const MEAL_CARDS = '[ng-repeat="(mealindex,mealitm) in dayitm.Meals"]';

export function parseIutAmount(text: string): number {
  const amount = normalizeAsciiDigits(text).replace(/[,،٬\s]/g, '').match(/\d+/);
  return amount ? Number(amount[0]) : 0;
}

export function parseIutReport(
  headers: string[],
  rows: string[][],
  targetDate: string
): ReservedMeal[] {
  const normalized = headers.map(normalizeForMatch);
  const column = (name: string) => normalized.indexOf(normalizeForMatch(name));
  const indexes = {
    date: column('تاریخ'), meal: column('وعده'), food: column('نام غذا'),
    hall: column('نام سلف'), quantity: column('تعداد'),
    price: column('قیمت (ریال)'), receipt: column('کد رزرو'),
  };
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error('ساختار ستون‌های گزارش رزرو دانشگاه تغییر کرده است.');
  }
  const result: ReservedMeal[] = [];
  for (const cells of rows) {
    if (normalizeAsciiDigits(cells[indexes.date] ?? '').trim() !== targetDate) continue;
    if (normalizeForMatch(cells[indexes.meal] ?? '') !== normalizeForMatch('ناهار')) continue;
    const code = normalizeAsciiDigits(cells[indexes.receipt] ?? '').trim();
    if (!code || !/^[\d-]+$/.test(code) || !/[1-9]/.test(code)) {
      throw new Error('کد رزرو معتبر برای ناهار انتخاب‌شده در گزارش دیده نشد.');
    }
    if (parseIutAmount(cells[indexes.quantity] ?? '') !== 1) {
      throw new Error('برای این ناهار رزرو چندپرسه وجود دارد و به بررسی نیاز دارد.');
    }
    result.push({
      reservationCode: code,
      targetDateJalali: targetDate,
      meal: 'lunch', mealLabel: 'ناهار',
      diningHall: cells[indexes.hall].trim(),
      foodName: cells[indexes.food].trim(),
      priceRials: parseIutAmount(cells[indexes.price] ?? ''),
      reservedAtJalali: targetDate,
      status: 'CONFIRMED',
    });
  }
  return result;
}

export async function readIutCredit(page: Page): Promise<number> {
  const header = await page.getByRole('banner').innerText();
  const amount = normalizeAsciiDigits(header).match(/([\d,،٬]+)\s*ریال/);
  if (!amount) throw new Error('اعتبار حساب از سربرگ دانشگاه خوانده نشد.');
  return parseIutAmount(amount[1]);
}

async function rejectCaptcha(page: Page): Promise<void> {
  const challenge = page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, input[name*="captcha" i]'
  );
  for (const element of await challenge.all()) {
    if (await element.isVisible()) throw new Error('CAPTCHA_REQUIRED: ورود دانشگاه نیاز به تأیید انسانی دارد.');
  }
}

export async function authenticateIut(
  page: Page,
  context: BrowserContext,
  credentials: IutCredentials | null,
  timeout: number
) {
  page.setDefaultTimeout(Math.min(timeout, 15000));
  await page.goto(IUT_URLS.RESERVATION_PAGE, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction(() =>
    Boolean(document.querySelector('label[data-toggle="tab"][href^="#tab_day"]')) ||
    Boolean(document.querySelector('a[href*="/Cas/Login"]')) ||
    (location.origin === 'https://webauth.iut.ac.ir' && Boolean(document.querySelector('input[name="username"]'))),
  undefined, { timeout });

  if (await page.locator(DAY_LABELS).count()) return context.cookies();
  const centralLogin = page.locator('a[href*="/Cas/Login"]');
  if (await centralLogin.count()) {
    await centralLogin.click();
    await page.waitForFunction(() =>
      location.origin === 'https://webauth.iut.ac.ir' ||
      Boolean(document.querySelector('label[data-toggle="tab"][href^="#tab_day"]')),
    undefined, { timeout });
  }
  if (await page.locator(DAY_LABELS).count()) return context.cookies();
  await rejectCaptcha(page);
  if (new URL(page.url()).origin !== 'https://webauth.iut.ac.ir') {
    throw new Error('صفحهٔ احراز هویت مرکزی دانشگاه باز نشد.');
  }
  if (!credentials) throw new Error('MISSING_CREDENTIALS: اطلاعات ورود دانشگاه تنظیم نشده است.');
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.locator('button[name="submitBtn"]').click();
  await page.waitForURL((url) => url.origin === 'https://dining.iut.ac.ir', { timeout });
  if (!page.url().includes('#!/Reservation')) {
    await page.goto(IUT_URLS.RESERVATION_PAGE, { waitUntil: 'domcontentloaded', timeout });
  }
  await page.locator(DAY_LABELS).first().waitFor({ state: 'visible', timeout });
  return context.cookies();
}

export async function selectIutDate(page: Page, targetDate: string): Promise<string> {
  for (let week = 0; week < 12; week++) {
    await page.locator(DAY_LABELS).first().waitFor({ state: 'visible', timeout: 30000 });
    const days = await page.locator(DAY_LABELS).evaluateAll((labels) => labels.map((label) => ({
      text: (label as HTMLElement).innerText,
      href: label.getAttribute('href') ?? '',
    })));
    const dates = days.map((day) => normalizeAsciiDigits(day.text).match(/\d{4}\/\d{2}\/\d{2}/)?.[0]);
    const index = dates.indexOf(targetDate);
    if (index >= 0) {
      const day = days[index];
      if (!/^#tab_day[0-6]$/.test(day.href)) throw new Error('شناسهٔ روز در تقویم معتبر نیست.');
      const label = page.locator(`label[data-toggle="tab"][href="${day.href}"]`);
      await label.click();
      await page.locator(`${day.href}.active`).waitFor({ state: 'visible' });
      return day.href;
    }
    if (!dates[0]) throw new Error('تاریخ‌های تقویم دانشگاه خوانده نشدند.');
    const direction = targetDate > dates[0] ? 'هفته بعد' : 'هفته قبل';
    await page.getByRole('button', { name: direction, exact: true }).click();
    await page.waitForFunction((previous) => {
      const first = document.querySelector('label[data-toggle="tab"][href^="#tab_day"]');
      return Boolean(first && (first as HTMLElement).innerText !== previous);
    }, days[0].text, { timeout: 30000 });
  }
  throw new Error('تاریخ دریافت غذا در تقویم دانشگاه پیدا نشد.');
}

async function lunchCard(page: Page, targetDate: string) {
  const day = await selectIutDate(page, targetDate);
  const cards = page.locator(`${day} ${MEAL_CARDS}`);
  for (const card of await cards.all()) {
    const heading = await card.locator('.box-header').innerText();
    if (normalizeForMatch(heading).includes(normalizeForMatch('ناهار'))) return card;
  }
  throw new Error('کارت ناهار برای تاریخ انتخاب‌شده پیدا نشد.');
}

export async function readIutReport(page: Page, targetDate: string): Promise<ReservedMeal[]> {
  await selectIutDate(page, targetDate);
  await page.locator('label[data-toggle="tab"][href="#tab_Reserved"]').click();
  const table = page.locator('#tab_Reserved.active table');
  await table.waitFor({ state: 'visible' });
  const contents = await table.evaluate((element) => {
    const lines = [...element.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => (cell as HTMLElement).innerText.trim()));
    return { headers: lines[0] ?? [], rows: lines.slice(1) };
  });
  return parseIutReport(contents.headers, contents.rows, targetDate);
}

export async function readIutMenu(page: Page, targetDate: string): Promise<MenuItem[]> {
  const card = await lunchCard(page, targetDate);
  const foods = card.locator('select[id="selectFood"]');
  if (!(await foods.count()) || !(await foods.isVisible())) return [];
  const options = await foods.locator('option').evaluateAll((elements) => elements.map((element) => {
    const option = element as HTMLOptionElement;
    return { value: option.value, text: option.text, disabled: option.disabled };
  }));
  const menu: MenuItem[] = [];
  for (const option of options) {
    const normalized = normalizeForMatch(option.text);
    const venue = normalized.includes('کاج') ? 'کاج' : normalized.includes('اسمان') ? 'آسمان' : null;
    const price = normalizeAsciiDigits(option.text).match(/([\d,،٬]+)\s*ریال/);
    if (!venue || !price || !option.value || option.disabled) continue;
    await foods.selectOption(option.value);
    const selves = card.locator('select[id="selectSelf"]');
    await selves.locator('option').filter({ hasText: venue }).first().waitFor({ state: 'attached' });
    const halls = await selves.locator('option').evaluateAll((elements) => elements.map((element) => {
      const option = element as HTMLOptionElement;
      return { value: option.value, text: option.text, disabled: option.disabled };
    }));
    const hall = halls.find((candidate) => !candidate.disabled && candidate.value &&
      normalizeForMatch(candidate.text).includes(normalizeForMatch(venue)));
    if (!hall) continue;
    menu.push({
      id: JSON.stringify({ food: option.value, hall: hall.value }),
      name: option.text.replace(/\s*\[[^\]]*ریال[^\]]*\]\s*$/, '').trim(),
      diningHall: hall.text.trim(),
      meal: 'lunch', priceRials: parseIutAmount(price[1]), available: true,
      isPayAtLocation: normalized.includes(normalizeForMatch('تسویه در محل')),
    });
  }
  return menu;
}

async function openIutCart(page: Page, targetDate: string) {
  const card = await lunchCard(page, targetDate);
  const label = card.locator('label[title="سبد خرید"]');
  const href = await label.getAttribute('href');
  if (!href || !/^#tab_[\w-]+$/.test(href)) throw new Error('زبانهٔ سبد خرید پیدا نشد.');
  await label.click();
  const pane = card.locator(`${href}.active`);
  await pane.waitFor({ state: 'visible' });
  return { card, pane };
}

export async function readIutCart(page: Page, targetDate: string): Promise<CartSummary | null> {
  const { card, pane } = await openIutCart(page, targetDate);
  const rows = await pane.locator('table tr').evaluateAll((elements) => elements.map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => (cell as HTMLElement).innerText.trim())));
  const headings = (rows[0] ?? []).map(normalizeForMatch);
  const foodColumn = headings.findIndex((text) => text.includes('غذا'));
  const quantityColumn = headings.findIndex((text) => text.includes('تعداد'));
  const amountColumn = headings.findIndex((text) => text.includes('مبلغ') || text.includes('قیمت'));
  if ([foodColumn, quantityColumn, amountColumn].some((index) => index < 0)) {
    const basketLabel = normalizeAsciiDigits(await card.locator('label[title="سبد خرید"]').innerText());
    if (!rows.length && /\(\s*0\s*\)/.test(basketLabel)) return null;
    throw new Error('ستون‌های سبد خرید تغییر کرده‌اند.');
  }
  const dataRows = rows.slice(1).filter((row) =>
    row[foodColumn] && parseIutAmount(row[quantityColumn] ?? '') > 0 &&
    !row.some((cell) => /^(مجموع|جمع کل)$/.test(cell.trim())));
  if (!dataRows.length) return null;
  if (dataRows.length !== 1) throw new Error('سبد بیش از یک غذا دارد و نیاز به بررسی دارد.');
  const cells = dataRows[0];
  const food = cells[foodColumn];
  const hallText = cells.join(' ');
  if (!/کاج|آسمان|اسمان/.test(hallText)) throw new Error('سبد دارای غذا از سلف دیگری است.');
  const bracketedFood = food.match(/^\s*\[([^\]]+)\]/)?.[1];
  const hall = normalizeForMatch(hallText).includes('کاج')
    ? 'رستوران مکمل کاج'
    : 'رستوران آسمان';
  return {
    targetDateJalali: targetDate, meal: 'lunch', diningHall: hall,
    foodName: (bracketedFood ?? food.replace(/\[[^\]]*\]/g, '')).trim(),
    quantity: parseIutAmount(cells[quantityColumn]),
    priceRials: parseIutAmount(cells[amountColumn]),
    paymentSource: 'UNIVERSITY_CREDIT',
  };
}

export async function addIutCart(page: Page, item: MenuItem, targetDate: string): Promise<CartSummary> {
  if (await readIutCart(page, targetDate)) throw new Error('سبد خرید از قبل غذا دارد و نیاز به بررسی دارد.');
  const card = await lunchCard(page, targetDate);
  const values = JSON.parse(item.id) as { food: string; hall: string };
  const food = card.locator('select[id="selectFood"]');
  await food.selectOption(values.food);
  const self = card.locator('select[id="selectSelf"]');
  await self.locator('option').filter({ hasText: item.diningHall }).waitFor({ state: 'attached' });
  await self.selectOption(values.hall);
  const selectedFood = await food.locator('option:checked').innerText();
  const selectedHall = await self.locator('option:checked').innerText();
  if (!normalizeForMatch(selectedFood).includes(normalizeForMatch(item.name)) ||
      normalizeForMatch(selectedHall) !== normalizeForMatch(item.diningHall)) {
    throw new Error('غذا یا سلف انتخاب‌شده با برنامهٔ رزرو یکسان نیست.');
  }
  await card.getByRole('button', { name: 'افزودن به سبد خرید', exact: true }).click();
  await card.locator('label[title="سبد خرید"]').filter({ hasText: /[1۱١]/ }).waitFor({ state: 'visible' });
  const cart = await readIutCart(page, targetDate);
  if (!cart) throw new Error('پس از افزودن، غذای انتخاب‌شده در سبد دیده نشد.');
  return cart;
}

export async function confirmIutCart(page: Page, cart: CartSummary): Promise<void> {
  const actual = await readIutCart(page, cart.targetDateJalali);
  if (!actual || actual.quantity !== 1 || actual.priceRials !== cart.priceRials ||
      normalizeForMatch(actual.foodName) !== normalizeForMatch(cart.foodName) ||
      normalizeForMatch(actual.diningHall) !== normalizeForMatch(cart.diningHall)) {
    throw new Error('سبد خرید پیش از تأیید تغییر کرده است.');
  }
  const { pane } = await openIutCart(page, cart.targetDateJalali);
  const confirm = pane.getByRole('button', { name: /تایید نهایی سبد خرید|تأیید نهایی سبد خرید/ });
  if (await confirm.count() !== 1) throw new Error('دکمهٔ تأیید نهایی سبد مشخص نیست.');
  await confirm.click();
}

export async function readIutContext(page: Page, targetDate: string) {
  const reservedMeals = await readIutReport(page, targetDate);
  const menu = await readIutMenu(page, targetDate);
  const availableCreditRials = await readIutCredit(page);
  return { reservedMeals, menu, availableCreditRials };
}
