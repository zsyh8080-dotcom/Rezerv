import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Heart,
  Plus,
  Save,
  ShieldBan,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeNextWeeklyExecutionUtcMs,
  computeTargetMealDateForRun,
  IRANIAN_WEEKDAYS,
  isValidJalaliString,
  jsWeekdayToIranOrder,
  normalizeAsciiDigits,
  pad2,
  parseTimeString,
  toPersianDigits,
} from '../core/jalali';
import { normalizeForMatch } from '../core/policy';
import type {
  AllowedDiningHall,
  AppStateSnapshot,
  PolicyConfig,
  ScheduleConfig,
  ScheduleMode,
} from '../core/types';
import { JalaliDatePickerField } from './JalaliDatePickerField';

interface SchedulePolicyViewProps {
  snapshot: AppStateSnapshot;
  isBusy: boolean;
  onSaveSchedule: (payload: Partial<ScheduleConfig>) => Promise<void>;
  onSavePolicy: (payload: Partial<PolicyConfig>) => Promise<void>;
  onSaveAll?: (schedulePayload: Partial<ScheduleConfig>, policyPayload: Partial<PolicyConfig>) => Promise<void>;
  onOpenSettingsTab: () => void;
}

const ALL_ALLOWED_HALLS: AllowedDiningHall[] = [
  'تریا کاج',
  'رستوران مکمل کاج',
  'رستوران آسمان',
];

const QUICK_PREFERRED_FOODS = [
  'زرشک‌پلو',
  'ماکارونی',
  'جوجه‌کباب',
  'لوبیاپلو',
  'فسنجان',
];

const PRICE_PRESETS_TOMAN: Array<{ value: number | null; label: string }> = [
  { value: 35000, label: '۳۵,۰۰۰ تومان' },
  { value: 50000, label: '۵۰,۰۰۰ تومان' },
  { value: 65000, label: '۶۵,۰۰۰ تومان' },
  { value: null, label: 'بدون سقف' },
];

function parseTomanInput(raw: string): number | null {
  const digitsOnly = normalizeAsciiDigits(raw).replace(/[^\d]/g, '');
  if (!digitsOnly) return null;
  const num = Number(digitsOnly);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function SchedulePolicyView({
  snapshot,
  isBusy,
  onSaveSchedule,
  onSavePolicy,
  onSaveAll,
  onOpenSettingsTab,
}: SchedulePolicyViewProps) {
  const [schedule, setSchedule] = useState<ScheduleConfig>(snapshot.schedule);
  const [policy, setPolicy] = useState<PolicyConfig>(snapshot.policy);

  useEffect(() => {
    setSchedule(snapshot.schedule);
  }, [snapshot.schedule]);

  useEffect(() => {
    setPolicy(snapshot.policy);
  }, [snapshot.policy]);

  // Food preference state
  const [newPreferred, setNewPreferred] = useState('');

  // Schedule state
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Advanced menu filters (prices + forbidden foods) state inside Schedule/Program
  const [priceText, setPriceText] = useState(
    snapshot.policy.maxPriceToman ? String(snapshot.policy.maxPriceToman) : ''
  );
  const [forbiddenKeywords, setForbiddenKeywords] = useState<string[]>(
    snapshot.policy.forbiddenKeywords
  );
  const [newForbidden, setNewForbidden] = useState('');

  useEffect(() => {
    setPriceText(snapshot.policy.maxPriceToman ? String(snapshot.policy.maxPriceToman) : '');
    setForbiddenKeywords(snapshot.policy.forbiddenKeywords);
  }, [snapshot.policy.maxPriceToman, snapshot.policy.forbiddenKeywords]);

  const parsedPriceToman = parseTomanInput(priceText);
  const onceActionValid = isValidJalaliString(schedule.onceActionDateJalali);
  const onceTargetValid = isValidJalaliString(schedule.onceTargetMealDateJalali);

  const selectedWeekdays = useMemo(() => {
    const raw =
      Array.isArray(schedule.weeklyTargetMealJsWeekdays) &&
      schedule.weeklyTargetMealJsWeekdays.length > 0
        ? schedule.weeklyTargetMealJsWeekdays
        : [schedule.weeklyTargetMealJsWeekday];
    return Array.from(new Set(raw)).sort(
      (a, b) => jsWeekdayToIranOrder(a) - jsWeekdayToIranOrder(b)
    );
  }, [schedule.weeklyTargetMealJsWeekdays, schedule.weeklyTargetMealJsWeekday]);

  // Compute preview execution UTC so each weekday tile shows its actual Jalali target date
  const previewExecutionUtcMs = useMemo(() => {
    return computeNextWeeklyExecutionUtcMs(
      snapshot.serverTimeUtcMs,
      schedule.weeklyExecutionJsWeekday,
      parseTimeString(schedule.actionTimeTehran) ? schedule.actionTimeTehran : '20:30'
    );
  }, [
    snapshot.serverTimeUtcMs,
    schedule.weeklyExecutionJsWeekday,
    schedule.actionTimeTehran,
  ]);

  const parsedTime = parseTimeString(schedule.actionTimeTehran) ?? { hour: 20, minute: 30 };

  const updateHourMinute = (nextHour: number, nextMinute: number) => {
    const wrappedHour = ((nextHour % 24) + 24) % 24;
    const wrappedMin = ((nextMinute % 60) + 60) % 60;
    setSchedule((prev) => ({
      ...prev,
      actionTimeTehran: `${pad2(wrappedHour)}:${pad2(wrappedMin)}`,
    }));
  };

  const handleModeChange = (mode: ScheduleMode) => {
    setSchedule((prev) => ({
      ...prev,
      mode,
      enabled: mode === 'now' ? false : true,
    }));
  };

  const toggleTargetWeekday = (jsWeekday: number) => {
    setSchedule((prev) => {
      const current =
        Array.isArray(prev.weeklyTargetMealJsWeekdays) &&
        prev.weeklyTargetMealJsWeekdays.length > 0
          ? prev.weeklyTargetMealJsWeekdays
          : [prev.weeklyTargetMealJsWeekday];
      const exists = current.includes(jsWeekday);
      let next: number[];
      if (exists) {
        if (current.length <= 1) return prev; // Keep at least 1 day selected
        next = current.filter((d) => d !== jsWeekday);
      } else {
        next = [...current, jsWeekday];
      }
      next.sort((a, b) => jsWeekdayToIranOrder(a) - jsWeekdayToIranOrder(b));
      return {
        ...prev,
        weeklyTargetMealJsWeekdays: next,
        weeklyTargetMealJsWeekday: next[0] ?? prev.weeklyTargetMealJsWeekday,
      };
    });
  };

  const handleScheduleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setScheduleError(null);

    if (schedule.mode === 'once' && (!onceActionValid || !onceTargetValid)) {
      setScheduleError('تاریخ‌ها را به فرمت درست شمسی انتخاب کنید.');
      return;
    }

    try {
      await onSaveSchedule({
        mode: schedule.mode,
        enabled: schedule.enabled,
        actionTimeTehran: schedule.actionTimeTehran,
        onceActionDateJalali: schedule.onceActionDateJalali,
        onceTargetMealDateJalali: schedule.onceTargetMealDateJalali,
        weeklyExecutionJsWeekday: schedule.weeklyExecutionJsWeekday,
        weeklyTargetMealJsWeekday: selectedWeekdays[0] ?? schedule.weeklyTargetMealJsWeekday,
        weeklyTargetMealJsWeekdays: selectedWeekdays,
      });
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'خطا در ذخیره زمان‌بندی');
    }
  };

  const parseFoodTokens = (raw: string): string[] =>
    raw
      .split(/[,،؛\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const mergeFoods = (existing: string[], raw: string): string[] => {
    const incoming = parseFoodTokens(raw);
    if (incoming.length === 0) return existing;
    const next = [...existing];
    for (const item of incoming) {
      const norm = normalizeForMatch(item);
      if (norm && !next.some((k) => normalizeForMatch(k) === norm)) {
        next.push(item);
      }
    }
    return next;
  };

  const addPreferredFood = (rawName?: string) => {
    const raw = rawName ?? newPreferred;
    const nextList = mergeFoods(policy.preferredKeywords, raw);
    if (nextList.length !== policy.preferredKeywords.length) {
      setPolicy((prev) => ({
        ...prev,
        preferredKeywords: nextList,
      }));
    }
    if (!rawName) setNewPreferred('');
  };

  const movePreferredFood = (index: number, delta: -1 | 1) => {
    setPolicy((prev) => {
      const next = [...prev.preferredKeywords];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, preferredKeywords: next };
    });
  };

  const removePreferredFood = (kw: string) => {
    setPolicy((prev) => ({
      ...prev,
      preferredKeywords: prev.preferredKeywords.filter((item) => item !== kw),
    }));
  };

  const toggleHall = (hall: AllowedDiningHall) => {
    setPolicy((prev) => {
      const exists = prev.allowedHalls.includes(hall);
      const next = exists
        ? prev.allowedHalls.filter((h) => h !== hall)
        : [...prev.allowedHalls, hall];
      if (next.length === 0) return prev;
      return { ...prev, allowedHalls: next };
    });
  };

  const handlePolicySubmit = async (e: FormEvent) => {
    e.preventDefault();
    const mergedPreferred = mergeFoods(policy.preferredKeywords, newPreferred);
    if (mergedPreferred.length !== policy.preferredKeywords.length) {
      setPolicy((prev) => ({ ...prev, preferredKeywords: mergedPreferred }));
    }
    setNewPreferred('');

    await onSavePolicy({
      preferredKeywords: mergedPreferred,
      onlyReservePreferred: policy.onlyReservePreferred,
      allowedHalls: policy.allowedHalls,
    });
  };

  const addForbiddenKeyword = () => {
    const next = mergeFoods(forbiddenKeywords, newForbidden);
    if (next.length !== forbiddenKeywords.length) {
      setForbiddenKeywords(next);
    }
    setNewForbidden('');
  };

  const removeForbiddenKeyword = (kw: string) => {
    setForbiddenKeywords((prev) => prev.filter((item) => item !== kw));
  };

  const handleFiltersSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const mergedForbidden = mergeFoods(forbiddenKeywords, newForbidden);
    if (mergedForbidden.length !== forbiddenKeywords.length) {
      setForbiddenKeywords(mergedForbidden);
    }
    setNewForbidden('');
    await onSavePolicy({
      maxPriceToman: parsedPriceToman,
      forbiddenKeywords: mergedForbidden,
    });
  };

  const isPolicyDirty = useMemo(() => {
    return (
      JSON.stringify(policy.preferredKeywords) !== JSON.stringify(snapshot.policy.preferredKeywords) ||
      policy.onlyReservePreferred !== snapshot.policy.onlyReservePreferred ||
      JSON.stringify(policy.allowedHalls) !== JSON.stringify(snapshot.policy.allowedHalls) ||
      newPreferred.trim().length > 0
    );
  }, [policy, snapshot.policy, newPreferred]);

  const isFiltersDirty = useMemo(() => {
    return (
      parsedPriceToman !== snapshot.policy.maxPriceToman ||
      JSON.stringify(forbiddenKeywords) !== JSON.stringify(snapshot.policy.forbiddenKeywords) ||
      newForbidden.trim().length > 0
    );
  }, [parsedPriceToman, forbiddenKeywords, snapshot.policy.maxPriceToman, snapshot.policy.forbiddenKeywords, newForbidden]);

  const isScheduleDirty = useMemo(() => {
    return (
      schedule.mode !== snapshot.schedule.mode ||
      schedule.enabled !== snapshot.schedule.enabled ||
      schedule.actionTimeTehran !== snapshot.schedule.actionTimeTehran ||
      schedule.onceActionDateJalali !== snapshot.schedule.onceActionDateJalali ||
      schedule.onceTargetMealDateJalali !== snapshot.schedule.onceTargetMealDateJalali ||
      schedule.weeklyExecutionJsWeekday !== snapshot.schedule.weeklyExecutionJsWeekday ||
      JSON.stringify(selectedWeekdays) !== JSON.stringify(snapshot.schedule.weeklyTargetMealJsWeekdays)
    );
  }, [schedule, snapshot.schedule, selectedWeekdays]);

  const hasUnsavedChanges = isPolicyDirty || isFiltersDirty || isScheduleDirty;

  const handleSaveAllChanges = async () => {
    setScheduleError(null);
    if (schedule.mode === 'once' && (!onceActionValid || !onceTargetValid)) {
      setScheduleError('تاریخ‌ها را به فرمت درست شمسی انتخاب کنید.');
      return;
    }

    const mergedPreferred = mergeFoods(policy.preferredKeywords, newPreferred);
    const mergedForbidden = mergeFoods(forbiddenKeywords, newForbidden);
    setNewPreferred('');
    setNewForbidden('');
    setPolicy((prev) => ({ ...prev, preferredKeywords: mergedPreferred }));
    setForbiddenKeywords(mergedForbidden);

    const schedulePayload: Partial<ScheduleConfig> = {
      mode: schedule.mode,
      enabled: schedule.enabled,
      actionTimeTehran: schedule.actionTimeTehran,
      onceActionDateJalali: schedule.onceActionDateJalali,
      onceTargetMealDateJalali: schedule.onceTargetMealDateJalali,
      weeklyExecutionJsWeekday: schedule.weeklyExecutionJsWeekday,
      weeklyTargetMealJsWeekday: selectedWeekdays[0] ?? schedule.weeklyTargetMealJsWeekday,
      weeklyTargetMealJsWeekdays: selectedWeekdays,
    };

    const policyPayload: Partial<PolicyConfig> = {
      preferredKeywords: mergedPreferred,
      onlyReservePreferred: policy.onlyReservePreferred,
      allowedHalls: policy.allowedHalls,
      maxPriceToman: parsedPriceToman,
      forbiddenKeywords: mergedForbidden,
    };

    if (onSaveAll) {
      await onSaveAll(schedulePayload, policyPayload);
    } else {
      await onSavePolicy(policyPayload);
      await onSaveSchedule(schedulePayload);
    }
  };

  const forbiddenConflict = policy.preferredKeywords.find((kw) =>
    forbiddenKeywords.some((fk) => {
      const a = normalizeForMatch(kw);
      const b = normalizeForMatch(fk);
      return a && b && (a.includes(b) || b.includes(a));
    })
  );

  return (
    <div className="space-y-5">
      {hasUnsavedChanges && (
        <div
          role="region"
          aria-label="ذخیره تغییرات ذخیره‌نشده"
          className="sticky top-14 lg:top-16 z-20 bg-slate-900 text-white rounded-2xl border border-slate-700 shadow-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-xs sm:text-sm font-medium">
            تغییراتی در این صفحه اعمال شده و هنوز ذخیره نشده‌اند.
          </p>
          <button
            type="button"
            onClick={() => void handleSaveAllChanges()}
            disabled={isBusy}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>ذخیره همهٔ تغییرات</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 1. Desired Foods & Allowed Dining Halls */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <Heart className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">غذای دلخواه و سلف</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                هر غذای دلخواه (حتی جدید) را به ترتیب اولویت بنویسید
              </p>
            </div>
          </div>

          <form onSubmit={handlePolicySubmit} className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="add-preferred-input" className="text-xs font-bold text-slate-700">
                  نام غذای دلخواه (جدید یا پیشنهادی)
                </label>
                <span className="text-[11px] text-slate-500">به ترتیب اولویت</span>
              </div>

              <div className="flex gap-2 w-full">
                <input
                  id="add-preferred-input"
                  type="text"
                  value={newPreferred}
                  onChange={(e) => setNewPreferred(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addPreferredFood();
                    }
                  }}
                  placeholder="نام غذای دلخواه را بنویسید (مثلاً: ته‌چین...)"
                  className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
                <button
                  type="button"
                  onClick={() => addPreferredFood()}
                  aria-label="افزودن غذای دلخواه"
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>افزودن</span>
                </button>
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 ml-1">پیشنهاد سریع:</span>
                {QUICK_PREFERRED_FOODS.map((dish) => {
                  const alreadyAdded = policy.preferredKeywords.some(
                    (k) => normalizeForMatch(k) === normalizeForMatch(dish)
                  );
                  return (
                    <button
                      key={dish}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addPreferredFood(dish)}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        alreadyAdded
                          ? 'bg-emerald-50 text-emerald-800 cursor-default'
                          : 'bg-slate-50 border border-slate-200 hover:border-blue-400 text-slate-700'
                      }`}
                    >
                      {alreadyAdded ? `✓ ${dish}` : `+ ${dish}`}
                    </button>
                  );
                })}
              </div>

              {/* Ordered Preferred List */}
              {policy.preferredKeywords.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  غذایی اضافه نشده؛ ربات خودکار ارزان‌ترین غذای مجاز را رزرو می‌کند.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {policy.preferredKeywords.map((kw, idx) => (
                    <div
                      key={kw}
                      className="px-3 py-2 bg-white flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-bold text-blue-900 tabular-nums shrink-0">
                          {toPersianDigits(idx + 1)}.
                        </span>
                        <span className="text-sm font-semibold text-slate-900 truncate">{kw}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => movePreferredFood(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`افزایش اولویت ${kw}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => movePreferredFood(idx, 1)}
                          disabled={idx === policy.preferredKeywords.length - 1}
                          aria-label={`کاهش اولویت ${kw}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePreferredFood(kw)}
                          aria-label={`حذف غذای دلخواه ${kw}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {forbiddenConflict && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  غذای «{forbiddenConflict}» در فهرست غذاهای ممنوع پایین همین صفحه است؛ برای رزرو آن، ابتدا از لیست ممنوع حذف کنید.
                </p>
              )}

              {policy.preferredKeywords.length > 0 && (
                <label className="flex items-center gap-2.5 pt-1 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.onlyReservePreferred}
                    onChange={(e) =>
                      setPolicy((p) => ({ ...p, onlyReservePreferred: e.target.checked }))
                    }
                    className="w-4 h-4 accent-blue-900 rounded cursor-pointer"
                  />
                  <span>فقط همین غذاها رزرو شوند (در صورت نبود، رزرو انجام نشود)</span>
                </label>
              )}
            </div>

            {/* Allowed Halls */}
            <div className="space-y-2 pt-3 border-t border-slate-100">
              <span className="block text-xs font-bold text-slate-700">سلف‌های مجاز</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {ALL_ALLOWED_HALLS.map((hall) => {
                  const selected = policy.allowedHalls.includes(hall);
                  return (
                    <button
                      key={hall}
                      type="button"
                      onClick={() => toggleHall(hall)}
                      aria-pressed={selected}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                        selected
                          ? 'bg-blue-50 border-blue-700 text-blue-900 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5 shrink-0 text-blue-700" aria-hidden="true" />}
                      <span className="truncate">{hall}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={isBusy}
              className="w-full min-h-[44px] px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-bold cursor-pointer transition-colors"
            >
              {isPolicyDirty ? 'ذخیره انتخاب غذا (تغییر دارد)' : 'ذخیره انتخاب غذا'}
            </button>
          </form>
        </section>

        {/* 2. Core Schedule Card */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <Clock className="w-5 h-5 text-blue-900 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">زمان‌بندی رزرو</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                انتخاب روزها، ساعت اقدام و حالت اجرا
              </p>
            </div>
          </div>

          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-bold text-slate-700">حالت اجرا</span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'now', label: 'فقط دستی' },
                    { id: 'once', label: 'یک‌بار' },
                    { id: 'weekly', label: 'هر هفته' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModeChange(m.id)}
                    className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      schedule.mode === m.id
                        ? 'bg-white text-blue-900 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {schedule.mode !== 'now' && (
              <>
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <label htmlFor="schedule-enabled-toggle" className="text-sm font-semibold text-slate-800">
                    فعال بودن رزرو خودکار
                  </label>
                  <input
                    id="schedule-enabled-toggle"
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(e) => setSchedule((p) => ({ ...p, enabled: e.target.checked }))}
                    className="w-5 h-5 accent-blue-900 cursor-pointer"
                  />
                </div>

                {/* Time Spinner with ":" separator and Hour/Minute up/down arrows */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700">ساعت اقدام (تهران)</span>
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                      {toPersianDigits(schedule.actionTimeTehran)}
                    </span>
                  </div>

                  <div
                    dir="ltr"
                    className="inline-flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3"
                  >
                    {/* Hour Spinner */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-semibold text-slate-500">ساعت</span>
                      <button
                        type="button"
                        onClick={() => updateHourMinute(parsedTime.hour + 1, parsedTime.minute)}
                        aria-label="افزایش ساعت"
                        className="w-12 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <input
                        id="action-hour-input"
                        type="number"
                        min={0}
                        max={23}
                        aria-label="ساعت اقدام"
                        value={pad2(parsedTime.hour)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) updateHourMinute(v, parsedTime.minute);
                        }}
                        className="w-14 h-11 rounded-xl border border-slate-300 bg-white font-mono text-lg font-bold text-center text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                      <button
                        type="button"
                        onClick={() => updateHourMinute(parsedTime.hour - 1, parsedTime.minute)}
                        aria-label="کاهش ساعت"
                        className="w-12 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                      >
                        <ChevronDown className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Prominent Separator */}
                    <span
                      aria-hidden="true"
                      className="text-2xl font-bold text-slate-400 pt-4 select-none"
                    >
                      :
                    </span>

                    {/* Minute Spinner */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-semibold text-slate-500">دقیقه</span>
                      <button
                        type="button"
                        onClick={() => updateHourMinute(parsedTime.hour, parsedTime.minute + 1)}
                        aria-label="افزایش دقیقه"
                        className="w-12 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <input
                        id="action-minute-input"
                        type="number"
                        min={0}
                        max={59}
                        aria-label="دقیقه اقدام"
                        value={pad2(parsedTime.minute)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) updateHourMinute(parsedTime.hour, v);
                        }}
                        className="w-14 h-11 rounded-xl border border-slate-300 bg-white font-mono text-lg font-bold text-center text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                      <button
                        type="button"
                        onClick={() => updateHourMinute(parsedTime.hour, parsedTime.minute - 1)}
                        aria-label="کاهش دقیقه"
                        className="w-12 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                      >
                        <ChevronDown className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {schedule.mode === 'once' && (
              <div className="grid grid-cols-1 gap-3 pt-2 border-t border-slate-100">
                <JalaliDatePickerField
                  id="once-action-date"
                  label="تاریخ اقدام (شمسی)"
                  value={schedule.onceActionDateJalali}
                  onChange={(nextDate) =>
                    setSchedule((p) => ({ ...p, onceActionDateJalali: nextDate }))
                  }
                  serverTimeUtcMs={snapshot.serverTimeUtcMs}
                />

                <JalaliDatePickerField
                  id="once-target-date"
                  label="می‌خوای غذات چه روزی باشه؟"
                  value={schedule.onceTargetMealDateJalali}
                  onChange={(nextDate) =>
                    setSchedule((p) => ({ ...p, onceTargetMealDateJalali: nextDate }))
                  }
                  serverTimeUtcMs={snapshot.serverTimeUtcMs}
                  helperPrefix="ناهار"
                />
              </div>
            )}

            {schedule.mode === 'weekly' && (
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <label htmlFor="weekly-exec-day" className="block text-xs font-bold text-slate-700">
                  روز اجرای هفتگی (روزی که ربات رزرو را می‌زند)
                </label>
                <select
                  id="weekly-exec-day"
                  value={schedule.weeklyExecutionJsWeekday}
                  onChange={(e) =>
                    setSchedule((p) => ({
                      ...p,
                      weeklyExecutionJsWeekday: Number(e.target.value),
                    }))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  {IRANIAN_WEEKDAYS.map((d) => (
                    <option key={d.jsWeekday} value={d.jsWeekday}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Multi-day Checkable Meal Days — always visible in both manual ('now') and weekly modes */}
            {schedule.mode !== 'once' && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    می‌خوای غذات چه روزی باشه؟ (تیک بزنید — یک یا چند روز)
                  </span>
                  <span className="text-[11px] font-semibold text-blue-900 tabular-nums">
                    {toPersianDigits(selectedWeekdays.length)} روز انتخابی
                  </span>
                </div>

                {schedule.mode === 'now' && (
                  <p className="text-[11px] text-slate-500">
                    دکمهٔ «رزرو همین حالا» در داشبورد برای همین روزهای انتخاب‌شده اجرا می‌شود.
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {IRANIAN_WEEKDAYS.map((d) => {
                    const checked = selectedWeekdays.includes(d.jsWeekday);
                    const targetInfo = computeTargetMealDateForRun(
                      previewExecutionUtcMs,
                      d.jsWeekday,
                      schedule.weeklyTargetWeekOffset
                    );
                    return (
                      <button
                        key={d.jsWeekday}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleTargetWeekday(d.jsWeekday)}
                        className={`min-h-[48px] px-3 py-2 rounded-xl border text-right flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          checked
                            ? 'bg-blue-50 border-blue-700 text-blue-950'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className={`text-xs ${checked ? 'font-bold' : 'font-medium'}`}>
                            {d.label}
                          </p>
                          <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">
                            {toPersianDigits(targetInfo.jalaliDate.slice(5))}
                          </p>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                            checked
                              ? 'bg-blue-900 border-blue-900 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {scheduleError && (
              <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2">
                {scheduleError}
              </p>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="w-full min-h-[44px] px-6 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <CalendarCheck2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{isScheduleDirty ? 'ذخیره زمان‌بندی (تغییر دارد)' : 'ذخیره زمان‌بندی'}</span>
            </button>
          </form>
        </section>
      </div>

      {/* 3. Advanced Menu Filters inside Program/Schedule (Prices + Forbidden Foods) */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-5">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <ShieldBan className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-slate-900">فیلترهای پیشرفته منو (قیمت‌ها و غذاهای ممنوع)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعیین سقف قیمت به تومان و فهرست غذاهایی که نباید رزرو شوند
            </p>
          </div>
        </div>

        <form onSubmit={handleFiltersSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Toman Price Section */}
          <div className="lg:col-span-5 space-y-3">
            <label htmlFor="max-price-toman" className="block text-xs font-bold text-slate-700">
              سقف قیمت غذا (تومان)
            </label>

            <div className="relative flex items-center">
              <input
                id="max-price-toman"
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="مثلاً 50000"
                className="w-full min-h-[46px] pl-3.5 pr-16 py-2 rounded-xl border border-slate-300 bg-white font-mono text-base font-bold text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              <span className="absolute right-3.5 text-xs font-bold text-slate-500 select-none">
                تومان
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PRICE_PRESETS_TOMAN.map((preset) => {
                const active = parsedPriceToman === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPriceText(preset.value ? String(preset.value) : '')}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-900 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              {parsedPriceToman
                ? `سقف انتخابی: حداکثر ${toPersianDigits(parsedPriceToman.toLocaleString('en-US'))} تومان (همچنان اولویت هوشمند با غذاهای ارزان‌تر تا ۳۵,۰۰۰ تومان و سپس تا سقف شماست).`
                : 'بدون سقف اضافه (اولویت هوشمند: ابتدا تا ۳۵,۰۰۰ تومان، در نبود آن تا ۵۰,۰۰۰ تومان)'}
            </p>
          </div>

          {/* Forbidden Foods Section */}
          <div className="lg:col-span-7 space-y-3">
            <label htmlFor="forbidden-food-input" className="block text-xs font-bold text-slate-700">
              غذاهای ممنوع (هیچ‌وقت رزرو نشوند)
            </label>
            <div className="flex gap-2 w-full">
              <input
                id="forbidden-food-input"
                type="text"
                value={newForbidden}
                onChange={(e) => setNewForbidden(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addForbiddenKeyword();
                  }
                }}
                placeholder="مثلاً: قیمه، عدس‌پلو..."
                className="flex-1 min-w-0 min-h-[46px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              <button
                type="button"
                onClick={addForbiddenKeyword}
                aria-label="افزودن غذای ممنوع"
                className="min-h-[46px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>افزودن</span>
              </button>
            </div>

            {forbiddenKeywords.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {forbiddenKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs font-medium"
                  >
                    <span>{kw}</span>
                    <button
                      type="button"
                      onClick={() => removeForbiddenKeyword(kw)}
                      aria-label={`حذف ${kw} از فهرست ممنوع`}
                      className="w-5 h-5 rounded-md hover:bg-rose-200/70 flex items-center justify-center text-rose-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-12 space-y-3 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={isBusy}
              className="min-h-[44px] px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap cursor-pointer transition-colors"
            >
              {isFiltersDirty ? 'ذخیره فیلترها و قیمت (تغییر دارد)' : 'ذخیره فیلترها و قیمت'}
            </button>
          </div>
        </form>
      </section>

      {/* Quiet Footer Link to Settings */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <span>
          ورود زودهنگام ({toPersianDigits(snapshot.schedule.earlyLoginMinutes)} دقیقه قبل)
          {' · '}
          مهلت صبر ضدهنگ: {toPersianDigits(snapshot.schedule.hangToleranceSeconds)} ثانیه
        </span>
        <button
          type="button"
          onClick={onOpenSettingsTab}
          className="text-blue-800 hover:text-blue-950 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <span>ویرایش در تنظیمات</span>
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
