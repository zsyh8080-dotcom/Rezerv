import type {
  AllowedDiningHall,
  CartSummary,
  ExcludedMenuItem,
  MenuItem,
  PolicyConfig,
  PolicyDecision,
} from './types';

export const DEFAULT_ALLOWED_HALLS: AllowedDiningHall[] = [
  'تریا کاج',
  'رستوران مکمل کاج',
  'رستوران آسمان',
];

export const DEFAULT_FORBIDDEN_KEYWORDS: string[] = [
  'کوبیده',
  'عدس‌پلو',
  'چلو مرغ',
  'قیمه',
];

export const PAY_AT_LOCATION_KEYWORDS: string[] = [
  'انتخاب و تسویه در محل',
  'تسویه در محل',
];

export const DEFAULT_POLICY: PolicyConfig = {
  meal: 'lunch',
  quantity: 1,
  preferredKeywords: [],
  onlyReservePreferred: false,
  allowedHalls: [...DEFAULT_ALLOWED_HALLS],
  forbiddenKeywords: [...DEFAULT_FORBIDDEN_KEYWORDS],
  preferredPriceToman: 35000,
  acceptablePriceToman: 50000,
  maxPriceToman: null,
  preferNamedDishOverPayAtLocation: true,
  creditOnly: true,
};

function sanitizeKeywordList(list: unknown, fallback: string[]): string[] {
  if (!Array.isArray(list)) return [...fallback];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    const norm = normalizeForMatch(trimmed);
    if (!trimmed || !norm || seen.has(norm)) continue;
    seen.add(norm);
    result.push(trimmed);
  }
  return result;
}

export function normalizePolicyConfig(policy?: Partial<PolicyConfig> | null): PolicyConfig {
  const allowed = Array.isArray(policy?.allowedHalls) && policy.allowedHalls.length > 0
    ? policy.allowedHalls
    : [...DEFAULT_ALLOWED_HALLS];
  const maxPrice =
    typeof policy?.maxPriceToman === 'number' && Number.isFinite(policy.maxPriceToman) && policy.maxPriceToman > 0
      ? policy.maxPriceToman
      : null;

  return {
    meal: 'lunch',
    quantity: 1,
    preferredKeywords: sanitizeKeywordList(policy?.preferredKeywords, DEFAULT_POLICY.preferredKeywords),
    onlyReservePreferred: Boolean(policy?.onlyReservePreferred),
    allowedHalls: allowed,
    forbiddenKeywords: sanitizeKeywordList(policy?.forbiddenKeywords, DEFAULT_POLICY.forbiddenKeywords),
    preferredPriceToman:
      typeof policy?.preferredPriceToman === 'number' && policy.preferredPriceToman > 0
        ? policy.preferredPriceToman
        : DEFAULT_POLICY.preferredPriceToman,
    acceptablePriceToman:
      typeof policy?.acceptablePriceToman === 'number' && policy.acceptablePriceToman > 0
        ? policy.acceptablePriceToman
        : DEFAULT_POLICY.acceptablePriceToman,
    maxPriceToman: maxPrice,
    preferNamedDishOverPayAtLocation:
      policy?.preferNamedDishOverPayAtLocation ?? DEFAULT_POLICY.preferNamedDishOverPayAtLocation,
    creditOnly: true,
  };
}

/**
 * Normalizes Persian/Arabic letter variants (ي/ى -> ی, ك -> ک, ة -> ه, أ/إ -> ا),
 * strips Arabic diacritics and tatweel, and normalizes whitespace.
 */
export function normalizePersianChars(input: string): string {
  return input
    .replace(/[\u064A\u0649\u06D2\u06D3]/g, 'ی') // Arabic yeh / Alef maksura -> Persian ی
    .replace(/[\u0643\u06AA]/g, 'ک') // Arabic kaf -> Persian ک
    .replace(/\u0629/g, 'ه') // Teh marbuta -> ه
    .replace(/[\u0623\u0625\u0671]/g, 'ا') // Alef with hamza -> ا
    .replace(/\u0624/g, 'و') // Waw with hamza -> و
    .replace(/\u0626/g, 'ی') // Yeh with hamza -> ی
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Harakat, superscript alef, tatweel
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * Normalizes text for resilient food/hall matching by collapsing both regular spaces
 * and zero-width non-joiner (\u200C / نیم‌فاصله) + invisible directional marks.
 */
export function normalizeForMatch(input: string): string {
  return normalizePersianChars(input)
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // ZWNJ, ZWJ, direction marks
    .replace(/[\s\-_.,،؛:()（）]+/g, '')
    .trim()
    .toLowerCase();
}

export function rialsToToman(rials: number): number {
  return Math.round(rials / 10);
}

export function tomanToRials(toman: number): number {
  return Math.round(toman * 10);
}

export function isForbiddenFood(foodName: string, forbiddenKeywords: string[]): boolean {
  const normalizedFood = normalizeForMatch(foodName);
  if (!normalizedFood) return false;
  return forbiddenKeywords.some((kw) => {
    const normalizedKw = normalizeForMatch(kw);
    return normalizedKw.length > 0 && normalizedFood.includes(normalizedKw);
  });
}

export function matchAllowedHallIndex(hallName: string, allowedHalls: string[]): number {
  const normalizedHall = normalizeForMatch(hallName);
  return allowedHalls.findIndex((allowed) => {
    const normalizedAllowed = normalizeForMatch(allowed);
    return (
      normalizedHall === normalizedAllowed ||
      normalizedHall.includes(normalizedAllowed) ||
      normalizedAllowed.includes(normalizedHall)
    );
  });
}

function tokenizePersianFood(input: string): string[] {
  return normalizePersianChars(input)
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .split(/[\s\-_.,،؛:()（）]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
}

export function matchPreferredKeywordIndex(
  foodName: string,
  preferredKeywords: string[]
): number {
  const normalizedFood = normalizeForMatch(foodName);
  if (!normalizedFood) return -1;
  return preferredKeywords.findIndex((kw) => {
    const normalizedKw = normalizeForMatch(kw);
    if (!normalizedKw) return false;
    if (normalizedFood.includes(normalizedKw)) return true;
    if (normalizedFood.length >= 5 && normalizedKw.includes(normalizedFood)) return true;
    const kwTokens = tokenizePersianFood(kw);
    return (
      kwTokens.length >= 2 &&
      kwTokens.every((token) => normalizedFood.includes(token))
    );
  });
}

export function isPayAtLocationDish(item: Pick<MenuItem, 'name' | 'isPayAtLocation'>): boolean {
  if (item.isPayAtLocation) return true;
  const normalizedName = normalizeForMatch(item.name);
  return PAY_AT_LOCATION_KEYWORDS.some((kw) => normalizedName.includes(normalizeForMatch(kw)));
}

function getPriceTierRank(
  priceRials: number,
  preferredPriceToman: number,
  acceptablePriceToman: number
): { rank: number; label: string } {
  const preferredRials = tomanToRials(preferredPriceToman);
  const acceptableRials = tomanToRials(acceptablePriceToman);

  if (priceRials <= preferredRials) {
    return { rank: 0, label: `اولویت اقتصادی (حداکثر ${preferredPriceToman.toLocaleString('fa-IR')} تومان)` };
  }
  if (priceRials <= acceptableRials) {
    return { rank: 1, label: `بازه قابل‌قبول (تا ${acceptablePriceToman.toLocaleString('fa-IR')} تومان)` };
  }
  return { rank: 2, label: `بالاتر از ${acceptablePriceToman.toLocaleString('fa-IR')} تومان (بدون سقف قیمت)` };
}

export function selectBestMeal(
  menu: MenuItem[],
  rawPolicy: PolicyConfig,
  availableCreditRials: number
): PolicyDecision {
  const policy = normalizePolicyConfig(rawPolicy);
  const excludedItems: ExcludedMenuItem[] = [];
  const eligible: Array<{
    item: MenuItem;
    preferredIndex: number;
    isPayAtLoc: boolean;
    tierRank: number;
    tierLabel: string;
    hallIndex: number;
  }> = [];

  const maxCeilingRials =
    policy.maxPriceToman !== null && policy.maxPriceToman > 0
      ? tomanToRials(policy.maxPriceToman)
      : null;

  for (const item of menu) {
    if (item.meal !== policy.meal) {
      excludedItems.push({
        name: item.name,
        diningHall: item.diningHall,
        priceRials: item.priceRials,
        reason: 'وعده غیرناهار',
      });
      continue;
    }

    if (!item.available || (item.remainingCount !== undefined && item.remainingCount <= 0)) {
      excludedItems.push({
        name: item.name,
        diningHall: item.diningHall,
        priceRials: item.priceRials,
        reason: 'ناموجود یا اتمام ظرفیت',
      });
      continue;
    }

    const hallIndex = matchAllowedHallIndex(item.diningHall, policy.allowedHalls);
    if (hallIndex === -1) {
      excludedItems.push({
        name: item.name,
        diningHall: item.diningHall,
        priceRials: item.priceRials,
        reason: 'سلف خارج از فهرست مجاز',
      });
      continue;
    }

    if (isForbiddenFood(item.name, policy.forbiddenKeywords)) {
      excludedItems.push({
        name: item.name,
        diningHall: item.diningHall,
        priceRials: item.priceRials,
        reason: 'در فهرست غذاهای ممنوع',
      });
      continue;
    }

    if (maxCeilingRials !== null && item.priceRials > maxCeilingRials) {
      excludedItems.push({
        name: item.name,
        diningHall: item.diningHall,
        priceRials: item.priceRials,
        reason: `بیش از سقف قیمت (${policy.maxPriceToman?.toLocaleString('fa-IR')} تومان)`,
      });
      continue;
    }

    const preferredIndex = matchPreferredKeywordIndex(item.name, policy.preferredKeywords);
    const isPayAtLoc = isPayAtLocationDish(item);
    const tier = getPriceTierRank(
      item.priceRials,
      policy.preferredPriceToman,
      policy.acceptablePriceToman
    );

    const tierLabel =
      preferredIndex !== -1
        ? `غذای دلخواه (اولویت ${(preferredIndex + 1).toLocaleString('fa-IR')}: ${policy.preferredKeywords[preferredIndex]})`
        : isPayAtLoc
          ? 'انتخاب و تسویه در محل (جایگزین آخر)'
          : tier.label;

    eligible.push({
      item,
      preferredIndex,
      isPayAtLoc,
      tierRank: tier.rank,
      tierLabel,
      hallIndex,
    });
  }

  if (eligible.length === 0) {
    return {
      ok: false,
      errorCode: 'NO_ELIGIBLE_FOOD',
      errorMessage: 'هیچ غذای مجاز و موجودی مطابق قوانین در سلف‌های انتخاب‌شده یافت نشد.',
      excludedItems,
    };
  }

  const hasPreferredMatch = eligible.some((e) => e.preferredIndex !== -1);
  if (policy.preferredKeywords.length > 0 && policy.onlyReservePreferred && !hasPreferredMatch) {
    for (const candidate of eligible) {
      excludedItems.push({
        name: candidate.item.name,
        diningHall: candidate.item.diningHall,
        priceRials: candidate.item.priceRials,
        reason: 'جزو غذاهای دلخواه انتخاب‌شده نیست',
      });
    }
    return {
      ok: false,
      errorCode: 'NO_ELIGIBLE_FOOD',
      errorMessage: 'هیچ‌یک از غذاهای دلخواه شما در منوی موجود سلف‌های مجاز یافت نشد.',
      excludedItems,
    };
  }

  eligible.sort((a, b) => {
    // 1. User-specified preferred foods take top priority in listed order
    const aPref = a.preferredIndex === -1 ? Number.MAX_SAFE_INTEGER : a.preferredIndex;
    const bPref = b.preferredIndex === -1 ? Number.MAX_SAFE_INTEGER : b.preferredIndex;
    if (aPref !== bPref) {
      return aPref - bPref;
    }
    // 2. Specific named dishes strictly beat "انتخاب و تسویه در محل"
    if (policy.preferNamedDishOverPayAtLocation && a.isPayAtLoc !== b.isPayAtLoc) {
      return a.isPayAtLoc ? 1 : -1;
    }
    // 3. Price tier preference (<=35k Toman > <=50k Toman > >50k Toman)
    if (a.tierRank !== b.tierRank) {
      return a.tierRank - b.tierRank;
    }
    // 4. Cheapest price in Rials
    if (a.item.priceRials !== b.item.priceRials) {
      return a.item.priceRials - b.item.priceRials;
    }
    // 5. Dining hall priority order
    return a.hallIndex - b.hallIndex;
  });

  const winner = eligible[0];

  if (policy.creditOnly && availableCreditRials < winner.item.priceRials) {
    return {
      ok: false,
      errorCode: 'INSUFFICIENT_CREDIT',
      errorMessage: `کمبود اعتبار دانشگاه: موجودی ${rialsToToman(availableCreditRials).toLocaleString('fa-IR')} تومان، قیمت غذا ${rialsToToman(winner.item.priceRials).toLocaleString('fa-IR')} تومان.`,
      selectedItem: winner.item,
      tierLabel: winner.tierLabel,
      excludedItems,
    };
  }

  return {
    ok: true,
    selectedItem: winner.item,
    tierLabel: winner.tierLabel,
    excludedItems,
  };
}

export function verifyCartMatchesSelection(
  cart: CartSummary,
  chosen: MenuItem,
  targetDateJalali: string
): { ok: true } | { ok: false; reason: string } {
  if (normalizeForMatch(cart.targetDateJalali) !== normalizeForMatch(targetDateJalali)) {
    return {
      ok: false,
      reason: `مغایرت تاریخ سبد (${cart.targetDateJalali}) با تاریخ هدف (${targetDateJalali})`,
    };
  }
  if (cart.meal !== 'lunch') {
    return {
      ok: false,
      reason: `مغایرت وعده سبد (${cart.meal})؛ فقط ناهار مجاز است.`,
    };
  }
  if (normalizeForMatch(cart.diningHall) !== normalizeForMatch(chosen.diningHall)) {
    return {
      ok: false,
      reason: `مغایرت سلف سبد (${cart.diningHall}) با انتخاب (${chosen.diningHall})`,
    };
  }
  if (normalizeForMatch(cart.foodName) !== normalizeForMatch(chosen.name)) {
    return {
      ok: false,
      reason: `مغایرت نام غذا در سبد (${cart.foodName}) با انتخاب (${chosen.name})`,
    };
  }
  if (cart.quantity !== 1) {
    return {
      ok: false,
      reason: `تعداد پرس در سبد (${cart.quantity}) باید دقیقاً ۱ باشد.`,
    };
  }
  if (cart.priceRials !== chosen.priceRials) {
    return {
      ok: false,
      reason: `مغایرت مبلغ سبد (${cart.priceRials} ریال) با مبلغ منو (${chosen.priceRials} ریال)`,
    };
  }
  if (cart.paymentSource !== 'UNIVERSITY_CREDIT') {
    return {
      ok: false,
      reason: 'روش پرداخت باید صرفاً اعتبار موجود دانشگاه باشد.',
    };
  }

  return { ok: true };
}
