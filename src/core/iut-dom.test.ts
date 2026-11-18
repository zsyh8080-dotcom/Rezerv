import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIutAmount, parseIutReport } from './iut-dom';

const headers = ['', 'روز', 'تاریخ', 'وعده', 'نام غذا', 'نام سلف', 'تعداد', 'قیمت (ریال)', 'جمع (ریال)', 'کد رزرو'];
const row = ['', 'دوشنبه', '۱۴۰۵/۰۹/۰۲', 'ناهار', 'همبرگر شرکتی (کاج)', 'رستوران مکمل کاج', '۱', '۳۵۰٬۰۰۰', '۳۵۰٬۰۰۰', '۱۲۳۴۵'];

test('reads Persian and Arabic separators in the real IUT amount format', () => {
  assert.equal(parseIutAmount('۳۵۰٬۰۰۰ ریال'), 350000);
  assert.equal(parseIutAmount('500,000'), 500000);
});

test('uses report column headings and matches the exact meal date', () => {
  assert.equal(parseIutReport(headers, [row], '1405/09/02')[0].reservationCode, '12345');
  assert.equal(parseIutReport(headers, [row], '1405/09/03').length, 0);
  const dinner = [...row];
  dinner[3] = 'شام';
  assert.equal(parseIutReport(headers, [dinner], '1405/09/02').length, 0);
});

test('requires a real receipt and detects quantity conflicts before another purchase', () => {
  const missingReceipt = [...row];
  missingReceipt[9] = '0';
  assert.throws(() => parseIutReport(headers, [missingReceipt], '1405/09/02'));
  const multiple = [...row];
  multiple[6] = '۲';
  assert.throws(() => parseIutReport(headers, [multiple], '1405/09/02'));
  assert.throws(() => parseIutReport(['تاریخ', 'غذا'], [], '1405/09/02'));
});
