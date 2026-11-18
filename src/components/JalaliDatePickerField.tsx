import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { toJalaali } from 'jalaali-js';
import {
  buildJalaliMonthCalendar,
  formatJalaliReadable,
  getJalaliMonthLabel,
  shiftJalaliMonth,
} from '../core/historyAnalytics';
import {
  addDaysGregorian,
  formatJalaliDate,
  isValidJalaliString,
  parseJalaliDateString,
  toPersianDigits,
  utcMsToTehranParts,
} from '../core/jalali';

interface JalaliDatePickerFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (nextJalaliDate: string) => void;
  serverTimeUtcMs: number;
  helperPrefix?: string;
}

const WEEKDAY_HEADERS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

export function JalaliDatePickerField({
  id,
  label,
  value,
  onChange,
  serverTimeUtcMs,
  helperPrefix,
}: JalaliDatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  const todayParts = useMemo(() => utcMsToTehranParts(serverTimeUtcMs), [serverTimeUtcMs]);
  const parsedValue = useMemo(() => parseJalaliDateString(value), [value]);

  const [viewMonth, setViewMonth] = useState<{ jy: number; jm: number }>(() =>
    parsedValue
      ? { jy: parsedValue.jy, jm: parsedValue.jm }
      : { jy: todayParts.jy, jm: todayParts.jm }
  );

  const quickPresets = useMemo(() => {
    const offsets = [
      { offset: 0, label: 'امروز' },
      { offset: 1, label: 'فردا' },
      { offset: 2, label: 'پس‌فردا' },
      { offset: 7, label: 'هفتهٔ آینده' },
    ];
    return offsets.map((item) => {
      const g = addDaysGregorian(todayParts.gy, todayParts.gm, todayParts.gd, item.offset);
      const { jy, jm, jd } = toJalaali(g.gy, g.gm, g.gd);
      return {
        label: item.label,
        dateJalali: formatJalaliDate(jy, jm, jd),
      };
    });
  }, [todayParts]);

  const calendarCells = useMemo(
    () => buildJalaliMonthCalendar(viewMonth.jy, viewMonth.jm, new Map()),
    [viewMonth.jy, viewMonth.jm]
  );

  const isValid = isValidJalaliString(value);

  const handleToggleOpen = () => {
    if (!open && parsedValue) {
      setViewMonth({ jy: parsedValue.jy, jm: parsedValue.jm });
    }
    setOpen((prev) => !prev);
  };

  const selectDate = (jalaliDate: string) => {
    onChange(jalaliDate);
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-slate-700">
        {label}
      </label>

      <button
        id={id}
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={open}
        className={`w-full min-h-[44px] px-3 py-2 rounded-xl border bg-white text-right flex items-center justify-between gap-2 cursor-pointer transition-colors hover:bg-slate-50 ${
          isValid ? 'border-slate-300' : 'border-red-400'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-4 h-4 text-blue-800 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
              {isValid
                ? `${helperPrefix ? `${helperPrefix} ` : ''}${formatJalaliReadable(value)}`
                : 'انتخاب تاریخ'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isValid && (
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {toPersianDigits(value)}
            </span>
          )}
          {open ? (
            <ChevronUp className="w-4 h-4 text-slate-500" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />
          )}
        </div>
      </button>

      {open && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {quickPresets.map((preset) => {
              const active = preset.dateJalali === value;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => selectDate(preset.dateJalali)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                    active
                      ? 'bg-blue-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-400'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Month Navigation */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => shiftJalaliMonth(m.jy, m.jm, -1))}
              aria-label="ماه قبل"
              className="min-h-[32px] min-w-[32px] rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-xs font-bold text-slate-900">
              {getJalaliMonthLabel(viewMonth.jy, viewMonth.jm)}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => shiftJalaliMonth(m.jy, m.jm, 1))}
              aria-label="ماه بعد"
              className="min-h-[32px] min-w-[32px] rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-400">
            {WEEKDAY_HEADERS.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell) => {
              if (!cell.dayNumber || !cell.jalaliDate) {
                return <div key={cell.key} className="h-8" aria-hidden="true" />;
              }
              const selected = cell.jalaliDate === value;
              const isToday = cell.jalaliDate === todayParts.jalaliDate;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => selectDate(cell.jalaliDate!)}
                  className={`h-8 rounded-lg text-xs tabular-nums flex items-center justify-center cursor-pointer transition-colors ${
                    selected
                      ? 'bg-blue-900 text-white font-bold'
                      : isToday
                        ? 'bg-sky-100 text-blue-900 font-bold border border-sky-300'
                        : 'bg-white hover:bg-blue-50 text-slate-800 border border-slate-200/70'
                  }`}
                >
                  {toPersianDigits(cell.dayNumber)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
