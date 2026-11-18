import { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildDayStatusMap,
  buildJalaliMonthCalendar,
  computeMonthlySpendingSummary,
  formatJalaliReadable,
  getJalaliMonthLabel,
  shiftJalaliMonth,
  type CalendarMealStatus,
} from '../core/historyAnalytics';
import { parseJalaliDateString, toPersianDigits } from '../core/jalali';
import { rialsToToman } from '../core/policy';
import type { AppStateSnapshot } from '../core/types';

interface HistoryViewProps {
  snapshot: AppStateSnapshot;
}

type HistoryFilter = 'all' | 'success' | 'issues';

const WEEKDAY_SHORT_HEADERS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const STATUS_DOT_STYLES: Record<
  CalendarMealStatus,
  { dotClass: string; textClass: string; label: string }
> = {
  reserved: {
    dotClass: 'bg-emerald-600',
    textClass: 'text-emerald-700',
    label: 'رزرو شده',
  },
  cancelled: {
    dotClass: 'bg-red-600',
    textClass: 'text-red-700',
    label: 'لغو شده',
  },
  missed: {
    dotClass: 'bg-orange-500',
    textClass: 'text-orange-700',
    label: 'ناموفق',
  },
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      monthLabel: string;
      totalCostToman: number;
      totalCostRials: number;
      confirmedCount: number;
      cancelledCount: number;
    };
  }>;
}

function SpendingChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-md px-3.5 py-2.5 text-xs space-y-1 text-right">
      <p className="font-bold text-slate-900">{item.monthLabel}</p>
      <p className="text-blue-900 font-bold tabular-nums">
        {toPersianDigits(item.totalCostToman.toLocaleString('en-US'))} تومان
      </p>
      <p className="text-slate-600 tabular-nums">
        {toPersianDigits(item.confirmedCount)} پرس موفق
        {item.cancelledCount > 0 ? ` · ${toPersianDigits(item.cancelledCount)} لغو` : ''}
      </p>
    </div>
  );
}

export function HistoryView({ snapshot }: HistoryViewProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const initialMonth = useMemo(() => {
    const parsed = parseJalaliDateString(snapshot.serverTimeJalali);
    return parsed ? { jy: parsed.jy, jm: parsed.jm } : { jy: 1405, jm: 8 };
  }, [snapshot.serverTimeJalali]);

  const [calendarMonth, setCalendarMonth] = useState<{ jy: number; jm: number }>(initialMonth);
  const [selectedDayJalali, setSelectedDayJalali] = useState<string | null>(null);

  const spendingSummary = useMemo(
    () => computeMonthlySpendingSummary(snapshot.reservedMeals),
    [snapshot.reservedMeals]
  );

  const dayStatusMap = useMemo(
    () => buildDayStatusMap(snapshot.reservedMeals, snapshot.history),
    [snapshot.reservedMeals, snapshot.history]
  );

  const calendarCells = useMemo(
    () => buildJalaliMonthCalendar(calendarMonth.jy, calendarMonth.jm, dayStatusMap),
    [calendarMonth.jy, calendarMonth.jm, dayStatusMap]
  );

  const selectedDayRecord = selectedDayJalali ? dayStatusMap.get(selectedDayJalali) ?? null : null;

  const filteredHistory = snapshot.history.filter((rec) => {
    if (filter === 'success') {
      return rec.status === 'RESERVED' || rec.status === 'AMBIGUOUS_RESOLVED_RESERVED';
    }
    if (filter === 'issues') {
      return (
        rec.status === 'FAILED' ||
        rec.status === 'BLOCKED_DUPLICATE' ||
        rec.status === 'AMBIGUOUS_RESOLVED_NOT_RESERVED'
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Clean Single-Elevation 3-Column Summary Strip */}
      <section className="bg-white border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200">
        <div className="p-4 lg:p-5">
          <p className="text-xs text-slate-500">جمع هزینهٔ رزروها</p>
          <p className="text-lg lg:text-xl font-bold text-slate-900 tabular-nums mt-1">
            {toPersianDigits(spendingSummary.totalCostToman.toLocaleString('en-US'))} تومان
          </p>
        </div>

        <div className="p-4 lg:p-5">
          <p className="text-xs text-slate-500">وعده‌های موفق</p>
          <p className="text-lg lg:text-xl font-bold text-emerald-700 tabular-nums mt-1">
            {toPersianDigits(spendingSummary.totalConfirmedMeals)} پرس
          </p>
        </div>

        <div className="p-4 lg:p-5">
          <p className="text-xs text-slate-500">لغو شده</p>
          <p className="text-lg lg:text-xl font-bold text-amber-700 tabular-nums mt-1">
            {toPersianDigits(spendingSummary.totalCancelledMeals)} مورد
          </p>
        </div>
      </section>

      {/* Chart + Visual Jalali Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Monthly Spending Chart */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-900 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">نمودار هزینهٔ ماهانه</h2>
            </div>
            <span className="text-[11px] text-slate-500">تومان</span>
          </div>

          {spendingSummary.months.length === 0 ? (
            <div className="flex-1 min-h-[250px] flex items-center justify-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              داده‌ای برای رسم نمودار وجود ندارد.
            </div>
          ) : (
            <div className="w-full flex-1 min-h-[250px]" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={spendingSummary.months}
                  margin={{ top: 10, right: 16, left: 4, bottom: 8 }}
                >
                  <defs>
                    <linearGradient id="iutBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0284c7" />
                      <stop offset="100%" stopColor="#1e3a8a" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fontSize: 12, fill: '#475569' }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${toPersianDigits(Math.round(v / 1000))}k`}
                  />
                  <Tooltip content={<SpendingChartTooltip />} />
                  <Bar
                    dataKey="totalCostToman"
                    name="هزینه ماهانه (تومان)"
                    fill="url(#iutBarGradient)"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={52}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Visual Monthly Jalali Calendar */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-900 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">تقویم رزروها</h2>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth((m) => shiftJalaliMonth(m.jy, m.jm, -1))
                }
                aria-label="ماه قبل"
                className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="px-2 text-xs sm:text-sm font-bold text-slate-900 min-w-[88px] text-center">
                {getJalaliMonthLabel(calendarMonth.jy, calendarMonth.jm)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth((m) => shiftJalaliMonth(m.jy, m.jm, 1))
                }
                aria-label="ماه بعد"
                className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
            {WEEKDAY_SHORT_HEADERS.map((h) => (
              <div key={h} className="py-1">
                {h}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1" role="grid" aria-label="تقویم شمسی وضعیت رزروها">
            {calendarCells.map((cell) => {
              if (!cell.dayNumber || !cell.jalaliDate) {
                return <div key={cell.key} className="h-10" aria-hidden="true" />;
              }

              const status = cell.record?.status ?? null;
              const style = status ? STATUS_DOT_STYLES[status] : null;
              const isSelected = selectedDayJalali === cell.jalaliDate;
              const isToday = cell.jalaliDate === snapshot.serverTimeJalali;

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDayJalali(cell.jalaliDate)}
                  aria-label={`${formatJalaliReadable(cell.jalaliDate)}${style ? ` - ${style.label}` : ''}`}
                  aria-pressed={isSelected}
                  className={`h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs tabular-nums transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-900 text-white font-bold'
                      : isToday
                        ? 'bg-sky-50 text-blue-900 font-bold border border-sky-300'
                        : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <span>{toPersianDigits(cell.dayNumber)}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      style
                        ? isSelected
                          ? 'bg-white'
                          : style.dotClass
                        : 'bg-transparent'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            {(['reserved', 'cancelled', 'missed'] as const).map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5 font-medium">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT_STYLES[key].dotClass}`}
                  aria-hidden="true"
                />
                <span>{STATUS_DOT_STYLES[key].label}</span>
              </span>
            ))}
          </div>

          {selectedDayJalali && (
            <div className="pt-3 border-t border-slate-100 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-900">
                  {formatJalaliReadable(selectedDayJalali)}
                </p>
                {selectedDayRecord && (
                  <span className={`font-semibold ${STATUS_DOT_STYLES[selectedDayRecord.status].textClass}`}>
                    {STATUS_DOT_STYLES[selectedDayRecord.status].label}
                  </span>
                )}
              </div>
              {selectedDayRecord ? (
                <>
                  <p className="text-slate-700 leading-relaxed">{selectedDayRecord.note}</p>
                  {selectedDayRecord.priceToman !== undefined && (
                    <p className="text-slate-500 tabular-nums">
                      {toPersianDigits(selectedDayRecord.priceToman.toLocaleString('en-US'))} تومان
                      {selectedDayRecord.reservationCode ? ` · کد ${selectedDayRecord.reservationCode}` : ''}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-slate-500">وعده‌ای ثبت نشده است.</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Execution & Reservation History Log */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">فهرست اجراها</h2>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start">
            {(
              [
                { id: 'all', label: 'همه' },
                { id: 'success', label: 'رزرو موفق' },
                { id: 'issues', label: 'خطا و مسدود' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            موردی در این دسته ثبت نشده است.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredHistory.map((rec) => (
              <article key={rec.id} className="py-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2 font-semibold text-slate-700">
                    <span>
                      {rec.trigger === 'MANUAL'
                        ? 'رزرو دستی'
                        : rec.trigger === 'SCHEDULED'
                          ? 'رزرو خودکار'
                          : 'بررسی اتصال'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatJalaliReadable(rec.targetDateJalali)}</span>
                  </div>
                  <span className="tabular-nums">
                    {toPersianDigits(rec.startedAtJalali)} · {toPersianDigits(rec.startedAtTehranTime.slice(0, 5))}
                  </span>
                </div>

                <p className="text-sm text-slate-900 leading-relaxed">{rec.message}</p>

                {rec.receipt && (
                  <p className="text-xs text-emerald-700 font-semibold tabular-nums">
                    کد: <span dir="ltr" className="font-mono inline-block">{rec.receipt.reservationCode}</span> ·{' '}
                    {rec.receipt.foodName} ({rec.receipt.diningHall}) ·{' '}
                    {toPersianDigits(rialsToToman(rec.receipt.priceRials).toLocaleString('en-US'))} تومان
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
