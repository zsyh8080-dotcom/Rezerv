import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FlaskConical,
  Globe,
  PauseCircle,
  Play,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Utensils,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import { formatJalaliReadable } from '../core/historyAnalytics';
import { toPersianDigits } from '../core/jalali';
import { rialsToToman } from '../core/policy';
import { buildUpcomingDaysSummary } from '../core/upcomingDays';
import type { AppStateSnapshot, ExecutionStatus } from '../core/types';

interface DashboardViewProps {
  snapshot: AppStateSnapshot;
  isBusy: boolean;
  onReserveNow: () => void;
  onStopSchedule: () => void;
  onSync: () => void;
  onOpenAccountModal: () => void;
  onOpenScheduleTab: () => void;
  onOpenSettingsTab: () => void;
  onOpenHistoryTab: () => void;
}

function getStatusMeta(status: ExecutionStatus): {
  label: string;
  toneClass: string;
  surfaceClass: string;
  icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'RESERVED':
    case 'AMBIGUOUS_RESOLVED_RESERVED':
      return {
        label: 'رزرو با موفقیت انجام شد',
        toneClass: 'text-emerald-700',
        surfaceClass: 'bg-emerald-50 border-emerald-200',
        icon: CheckCircle2,
      };
    case 'BLOCKED_DUPLICATE':
      return {
        label: 'رزرو قبلی موجود است',
        toneClass: 'text-amber-700',
        surfaceClass: 'bg-amber-50 border-amber-200',
        icon: ShieldAlert,
      };
    case 'FAILED':
    case 'AMBIGUOUS_RESOLVED_NOT_RESERVED':
      return {
        label: 'رزرو انجام نشد',
        toneClass: 'text-red-700',
        surfaceClass: 'bg-red-50 border-red-200',
        icon: AlertTriangle,
      };
    case 'STANDBY_IN_SITE':
      return {
        label: 'آماده در صفحهٔ رزرو',
        toneClass: 'text-sky-700',
        surfaceClass: 'bg-sky-50 border-sky-200',
        icon: Zap,
      };
    case 'EARLY_LOGIN_READY':
      return {
        label: 'ورود زودهنگام انجام شد',
        toneClass: 'text-blue-800',
        surfaceClass: 'bg-blue-50 border-blue-200',
        icon: Clock,
      };
    case 'PAUSED':
      return {
        label: 'زمان‌بندی متوقف است',
        toneClass: 'text-slate-600',
        surfaceClass: 'bg-slate-50 border-slate-200',
        icon: PauseCircle,
      };
    default:
      return {
        label: 'آمادهٔ رزرو',
        toneClass: 'text-slate-800',
        surfaceClass: 'bg-slate-50 border-slate-200',
        icon: Clock,
      };
  }
}

function formatCountdown(targetUtcMs: number | null, nowUtcMs: number): string | null {
  if (!targetUtcMs || targetUtcMs <= nowUtcMs) return null;
  const totalSec = Math.floor((targetUtcMs - nowUtcMs) / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${toPersianDigits(days)} روز و ${toPersianDigits(pad(hours))}:${toPersianDigits(pad(minutes))}`;
  }
  return `${toPersianDigits(pad(hours))}:${toPersianDigits(pad(minutes))}:${toPersianDigits(pad(seconds))}`;
}

export function DashboardView({
  snapshot,
  isBusy,
  onReserveNow,
  onStopSchedule,
  onSync,
  onOpenAccountModal,
  onOpenScheduleTab,
  onOpenSettingsTab,
  onOpenHistoryTab,
}: DashboardViewProps) {
  const statusMeta = getStatusMeta(snapshot.lastStatus);
  const StatusIcon = statusMeta.icon;
  const { nextRun, lastReceipt, policy, schedule } = snapshot;

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!nextRun.enabled || !nextRun.nextActionUtcMs) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextRun.enabled, nextRun.nextActionUtcMs]);

  const targetDates =
    nextRun.targetMealDatesJalali && nextRun.targetMealDatesJalali.length > 0
      ? nextRun.targetMealDatesJalali
      : nextRun.targetMealDateJalali
        ? [nextRun.targetMealDateJalali]
        : [];

  const targetTitle =
    targetDates.length > 1
      ? `ناهار ${toPersianDigits(targetDates.length)} روز (${nextRun.targetMealWeekdayLabels.join('، ')})`
      : targetDates[0]
        ? `ناهار ${formatJalaliReadable(targetDates[0])}`
        : 'روز غذا تعیین نشده';

  const actionReadable =
    nextRun.enabled && nextRun.nextActionJalaliDate
      ? formatJalaliReadable(nextRun.nextActionJalaliDate)
      : null;

  const countdown = nextRun.enabled ? formatCountdown(nextRun.nextActionUtcMs, nowMs) : null;

  const upcomingDays = useMemo(
    () =>
      buildUpcomingDaysSummary({
        nowUtcMs: snapshot.serverTimeUtcMs,
        reservedMeals: snapshot.reservedMeals,
        history: snapshot.history,
        nextRun: snapshot.nextRun,
        daysCount: 3,
      }),
    [snapshot.serverTimeUtcMs, snapshot.reservedMeals, snapshot.history, snapshot.nextRun]
  );

  return (
    <div className="space-y-5">
      {/* Compact Account Prompt when password is missing */}
      {!snapshot.account.hasStoredPassword && !snapshot.account.usesRuntimeSecrets && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs sm:text-sm font-semibold text-amber-950">
            برای شروع، رمز سامانه تغذیه حساب {toPersianDigits(snapshot.account.username)} را وارد کنید.
          </p>
          <button
            type="button"
            onClick={onOpenAccountModal}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-amber-900 hover:bg-amber-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            ورود به حساب دانشگاه
          </button>
        </section>
      )}

      {/* Priority 1: Focal Hero — Quick Reserve & Next Scheduled Run */}
      <section className="rounded-2xl bg-gradient-to-bl from-slate-900 via-blue-950 to-slate-900 text-white p-5 lg:p-7 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Next Reservation Summary */}
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-sky-200">
              <span className="font-semibold text-white">
                {nextRun.enabled ? 'رزرو بعدی (خودکار)' : 'رزرو دستی'}
              </span>
              <span aria-hidden="true" className="text-white/40">·</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                  snapshot.runtimeMode === 'SANDBOX'
                    ? 'bg-amber-400/20 text-amber-200 border border-amber-300/30'
                    : 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/30'
                }`}
              >
                {snapshot.runtimeMode === 'SANDBOX' ? (
                  <>
                    <FlaskConical className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>حالت آزمایشی (Sandbox)</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>متصل به سایت واقعی دانشگاه</span>
                  </>
                )}
              </span>
              {countdown && (
                <>
                  <span aria-hidden="true" className="text-white/40">·</span>
                  <span className="tabular-nums font-medium">
                    تا اقدام: {countdown}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-white/40">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums text-blue-100">
                <Wallet className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                <span>
                  اعتبار:{' '}
                  {snapshot.availableCreditRials !== null
                    ? `${toPersianDigits(rialsToToman(snapshot.availableCreditRials).toLocaleString('en-US'))} تومان`
                    : 'نامشخص'}
                </span>
              </span>
            </div>

            <h2 className="text-xl lg:text-2xl font-bold leading-snug text-balance">
              {targetTitle}
            </h2>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-blue-100">
              {actionReadable && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Calendar className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
                  <span>
                    زمان اجرا: {actionReadable} ساعت {toPersianDigits(nextRun.nextActionTehranTime ?? '')}
                  </span>
                </span>
              )}
              {actionReadable && <span aria-hidden="true" className="text-white/35">·</span>}
              <span>
                {policy.preferredKeywords.length > 0
                  ? `غذای انتخابی: ${policy.preferredKeywords[0]}${
                      policy.preferredKeywords.length > 1
                        ? ` (+${toPersianDigits(policy.preferredKeywords.length - 1)})`
                        : ''
                    }`
                  : 'انتخاب خودکار ارزان‌ترین غذا'}
              </span>
              <span aria-hidden="true" className="text-white/35">·</span>
              <span>{toPersianDigits(policy.allowedHalls.length)} سلف مجاز</span>
            </div>
          </div>

          {/* Dominant Primary Action + Single Secondary Schedule Action */}
          <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onReserveNow}
              disabled={isBusy}
              className={`min-h-[48px] px-6 py-2.5 rounded-xl disabled:opacity-50 text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors ${
                snapshot.runtimeMode === 'SANDBOX'
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
              }`}
            >
              {snapshot.runtimeMode === 'SANDBOX' ? (
                <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 shrink-0 fill-current" aria-hidden="true" />
              )}
              <span>
                {isBusy
                  ? 'در حال رزرو...'
                  : snapshot.runtimeMode === 'SANDBOX'
                    ? targetDates.length > 1
                      ? `رزرو آزمایشی (${toPersianDigits(targetDates.length)} روز)`
                      : 'رزرو آزمایشی همین حالا'
                    : targetDates.length > 1
                      ? `رزرو واقعی (${toPersianDigits(targetDates.length)} روز)`
                      : 'رزرو واقعی همین حالا'}
              </span>
            </button>

            {schedule.enabled ? (
              <button
                type="button"
                onClick={onStopSchedule}
                disabled={isBusy}
                className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 disabled:opacity-50 text-white text-xs sm:text-sm font-medium flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors"
              >
                <PauseCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>توقف خودکار</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenScheduleTab}
                className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs sm:text-sm font-medium flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>تنظیم برنامه و غذا</span>
              </button>
            )}
          </div>
        </div>

        {/* Clean Footer Links */}
        <div className="pt-3.5 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200">
          <button
            type="button"
            onClick={onOpenScheduleTab}
            className="text-sky-200 hover:text-white font-medium inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>برنامه و غذا</span>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenSettingsTab}
            className="text-blue-200 hover:text-white inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>تنظیمات ضدهنگ و ورود زودتر</span>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* Priority 2: Upcoming 3-Days Reservation Status Summary */}
      <section
        aria-label="وضعیت رزروهای ۳ روز آینده"
        className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-blue-800 shrink-0" aria-hidden="true" />
            <h3 className="text-sm font-bold text-slate-900 truncate">وضعیت رزروهای ۳ روز آینده</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSync}
              disabled={isBusy}
              className="min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-blue-800 shrink-0 ${isBusy ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>همگام‌سازی</span>
            </button>
            <button
              type="button"
              onClick={onOpenScheduleTab}
              className="text-xs font-semibold text-blue-800 hover:text-blue-950 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>تنظیم روزها</span>
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-100">
          {upcomingDays.map((day) => {
            const StatusDayIcon =
              day.status === 'reserved'
                ? CheckCircle2
                : day.status === 'failed'
                  ? XCircle
                  : Clock;
            const iconColorClass =
              day.status === 'reserved'
                ? 'text-emerald-600'
                : day.status === 'failed'
                  ? 'text-red-600'
                  : day.scheduledForRun
                    ? 'text-sky-600'
                    : 'text-amber-600';
            const labelColorClass =
              day.status === 'reserved'
                ? 'text-emerald-700'
                : day.status === 'failed'
                  ? 'text-red-700'
                  : day.scheduledForRun
                    ? 'text-sky-800'
                    : 'text-amber-800';

            return (
              <div key={day.dateJalali} className="p-4 sm:p-5 flex flex-col justify-between gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 tabular-nums">
                    {day.weekdayLabel} {toPersianDigits(day.shortDateLabel)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    {day.relativeLabel}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <StatusDayIcon className={`w-4 h-4 shrink-0 ${iconColorClass}`} aria-hidden="true" />
                  <span className={`text-xs font-bold ${labelColorClass}`}>{day.statusLabel}</span>
                </div>

                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">
                    {toPersianDigits(day.detailText)}
                  </p>
                  {day.status === 'reserved' && (day.diningHall || day.reservationCode) && (
                    <p className="text-[11px] text-slate-500 truncate tabular-nums">
                      {[day.diningHall, day.reservationCode ? `کد ${toPersianDigits(day.reservationCode)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Priority 3: Current Status + Latest Reservation Receipt */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500">وضعیت جاری</h3>
            <div className={`p-3.5 rounded-xl border ${statusMeta.surfaceClass} flex items-start gap-2.5 ${statusMeta.toneClass}`}>
              <StatusIcon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-bold">{statusMeta.label}</p>
                <p className="text-xs text-slate-700 leading-relaxed">{snapshot.lastMessage}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAccountModal}
            className={`w-full min-h-[38px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 cursor-pointer transition-colors ${
              snapshot.account.lastLoginVerification?.source === 'LIVE_IUT' &&
              snapshot.account.lastLoginVerification.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {snapshot.account.lastLoginVerification?.source === 'LIVE_IUT' &&
                snapshot.account.lastLoginVerification.ok
                  ? `ورود واقعی به سایت تأیید شد (${toPersianDigits(snapshot.account.lastLoginVerification.verifiedAtTehranTime)})`
                  : 'بررسی ورود واقعی و دیدن تصویر سایت دانشگاه'}
              </span>
            </span>
            <ChevronLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </button>
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-900">آخرین رزرو ثبت‌شده</h3>
            </div>
            <button
              type="button"
              onClick={onOpenHistoryTab}
              className="text-xs font-semibold text-blue-800 hover:text-blue-950 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>سوابق و نمودار</span>
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {lastReceipt ? (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm pt-1">
              <div>
                <dt className="text-[11px] text-slate-500">کد پیگیری</dt>
                <dd dir="ltr" className="font-mono font-bold text-emerald-700 tabular-nums mt-0.5 text-right inline-block">
                  {lastReceipt.reservationCode}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">غذا</dt>
                <dd className="font-bold text-slate-900 mt-0.5">{lastReceipt.foodName}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">سلف</dt>
                <dd className="font-medium text-slate-800 mt-0.5">{lastReceipt.diningHall}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">تاریخ وعده</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {formatJalaliReadable(lastReceipt.targetDateJalali)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">مبلغ</dt>
                <dd className="font-bold text-blue-900 tabular-nums mt-0.5">
                  {toPersianDigits(lastReceipt.priceToman.toLocaleString('en-US'))} تومان
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">ساعت ثبت</dt>
                <dd className="text-slate-700 tabular-nums mt-0.5">
                  {toPersianDigits(lastReceipt.confirmedAtTehranTime)}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="py-5 flex items-center justify-center gap-2 text-slate-500">
              <Utensils className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <p className="text-xs">هنوز رزروی در این دوره ثبت نشده است.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
