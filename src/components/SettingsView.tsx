import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Clock,
  FlaskConical,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Wifi,
  Zap,
} from 'lucide-react';
import { parseTimeString, toPersianDigits } from '../core/jalali';
import type {
  AppStateSnapshot,
  SandboxScenario,
  ScheduleConfig,
} from '../core/types';
import { LoginProofCard } from './LoginProofCard';

interface SettingsViewProps {
  snapshot: AppStateSnapshot;
  isBusy: boolean;
  onOpenAccountModal: () => void;
  onTestLogin: () => Promise<void>;
  onTestLiveLogin: () => Promise<void>;
  onTestConnection: () => Promise<void>;
  onSetRuntimeMode: (liveModeEnabled: boolean) => Promise<void>;
  onSaveSchedule: (payload: Partial<ScheduleConfig>) => Promise<void>;
  onSelectScenario: (scenario: SandboxScenario) => void;
  onResetSandbox: () => void;
}

const EARLY_LOGIN_PRESETS = [5, 10, 15, 20];

const SCENARIO_OPTIONS: Array<{ value: SandboxScenario; label: string }> = [
  { value: 'normal', label: 'منوی عادی (غذای مجاز زیر ۳۵ هزار تومان + غذاهای ممنوع)' },
  { value: 'only_50k_available', label: 'فقط غذای ۵۰ هزار تومانی موجود' },
  { value: 'pay_at_location_only', label: 'فقط غذای ممنوع + «تسویه در محل»' },
  { value: 'forbidden_only', label: 'فقط غذاهای ممنوع (کوبیده، عدس‌پلو، چلومرغ، قیمه)' },
  { value: 'insufficient_credit', label: 'کمبود اعتبار دانشگاه (۱۲ هزار تومان)' },
  { value: 'captcha_required', label: 'نیاز به کپچا هنگام ورود' },
  { value: 'auth_error', label: 'خطای نام کاربری یا رمز عبور' },
  { value: 'menu_delayed', label: 'تأخیر باز شدن منو و تکرار خودکار' },
  { value: 'ambiguous_timeout_success', label: 'تأیید نامشخص (رزرو ثبت شده بود)' },
  { value: 'ambiguous_timeout_failed', label: 'تأیید نامشخص (رزرو ثبت نشده بود)' },
  { value: 'browser_quota', label: 'اتمام سهمیه مرورگر سرور' },
];

function subtractMinutesFromTime(timeStr: string, deltaMinutes: number): string | null {
  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;
  const total = ((parsed.hour * 60 + parsed.minute - deltaMinutes) % 1440 + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function SettingsView({
  snapshot,
  isBusy,
  onOpenAccountModal,
  onTestLogin,
  onTestLiveLogin,
  onTestConnection,
  onSetRuntimeMode,
  onSaveSchedule,
  onSelectScenario,
  onResetSandbox,
}: SettingsViewProps) {
  const [earlyLoginMinutes, setEarlyLoginMinutes] = useState(snapshot.schedule.earlyLoginMinutes);
  const [keepSessionWarm, setKeepSessionWarm] = useState(snapshot.schedule.keepSessionWarm);
  const [subsecondExecution, setSubsecondExecution] = useState(snapshot.schedule.subsecondExecution);
  const [hangToleranceSeconds, setHangToleranceSeconds] = useState(
    snapshot.schedule.hangToleranceSeconds
  );
  const [retryWindowSeconds, setRetryWindowSeconds] = useState(snapshot.schedule.retryWindowSeconds);
  const [antiHangFeedback, setAntiHangFeedback] = useState<string | null>(null);

  useEffect(() => {
    setEarlyLoginMinutes(snapshot.schedule.earlyLoginMinutes);
    setKeepSessionWarm(snapshot.schedule.keepSessionWarm);
    setSubsecondExecution(snapshot.schedule.subsecondExecution);
    setHangToleranceSeconds(snapshot.schedule.hangToleranceSeconds);
    setRetryWindowSeconds(snapshot.schedule.retryWindowSeconds);
  }, [snapshot.schedule]);

  const previewEarlyTime = useMemo(
    () => subtractMinutesFromTime(snapshot.schedule.actionTimeTehran, earlyLoginMinutes),
    [snapshot.schedule.actionTimeTehran, earlyLoginMinutes]
  );

  const handleAntiHangSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAntiHangFeedback(null);
    await onSaveSchedule({
      earlyLoginMinutes,
      keepSessionWarm,
      subsecondExecution,
      hangToleranceSeconds,
      retryWindowSeconds,
    });
    setAntiHangFeedback('تنظیمات ضدهنگ و ورود زودتر ذخیره شد.');
  };

  const applyHeavyHangPreset = async () => {
    setAntiHangFeedback(null);
    const heavy = {
      earlyLoginMinutes: 15,
      keepSessionWarm: true,
      subsecondExecution: true,
      hangToleranceSeconds: 60,
      retryWindowSeconds: 150,
      retryIntervalSeconds: 2,
    };
    setEarlyLoginMinutes(heavy.earlyLoginMinutes);
    setKeepSessionWarm(heavy.keepSessionWarm);
    setSubsecondExecution(heavy.subsecondExecution);
    setHangToleranceSeconds(heavy.hangToleranceSeconds);
    setRetryWindowSeconds(heavy.retryWindowSeconds);
    await onSaveSchedule(heavy);
    setAntiHangFeedback('حالت حداکثر پایداری (مقاوم در برابر هنگ شدید سایت) فعال و ذخیره شد.');
  };

  const accountReady = snapshot.account.hasStoredPassword || snapshot.account.usesRuntimeSecrets;

  return (
    <div className="max-w-4xl space-y-6">
      {/* 1. University Account Compact Summary & Connection Test */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">
                حساب دانشگاه ({toPersianDigits(snapshot.account.username)})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                {accountReady ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>اطلاعات ورود ذخیره شده و آماده استفاده است</span>
                  </>
                ) : (
                  <span className="text-amber-700 font-medium">
                    رمز عبور هنوز ثبت نشده است
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void onTestLiveLogin()}
              disabled={isBusy}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Globe className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>تست ورود واقعی به سایت</span>
            </button>

            <button
              type="button"
              onClick={onOpenAccountModal}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer transition-colors"
            >
              {accountReady ? 'تغییر حساب / رمز' : 'ورود به حساب'}
            </button>

            <button
              type="button"
              onClick={() => void onTestLogin()}
              disabled={isBusy}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>تست حالت فعال</span>
            </button>

            <button
              type="button"
              onClick={() => void onTestConnection()}
              disabled={isBusy}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>تست اتصال</span>
            </button>
          </div>
        </div>

        {snapshot.account.lastLoginTestMessage && (
          <p
            className={`text-xs leading-relaxed font-medium px-3.5 py-2 rounded-xl border ${
              snapshot.account.lastLoginTestOk === true
                ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                : 'text-red-800 bg-red-50 border-red-200'
            }`}
          >
            {snapshot.account.lastLoginTestMessage}
          </p>
        )}

        <LoginProofCard verification={snapshot.account.lastLoginVerification} />
      </section>

      {/* 1.5 Runtime Mode Switch (Sandbox vs Live Site) */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">محیط اجرای رزروها</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعیین کنید دکمهٔ «رزرو همین حالا» و زمان‌بندی خودکار روی شبیه‌ساز اجرا شوند یا مستقیماً وارد سایت دانشگاه شوند.
            </p>
          </div>
        </div>

        {snapshot.runtimeMode === 'CLOUDFLARE_BROWSER_RUN' ? (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>حالت ابری Cloudflare Browser Run فعال و به سایت واقعی دانشگاه متصل است.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void onSetRuntimeMode(false)}
              disabled={isBusy}
              aria-pressed={!snapshot.liveModeEnabled}
              className={`min-h-[56px] p-3.5 rounded-xl border text-right transition-colors cursor-pointer ${
                !snapshot.liveModeEnabled
                  ? 'border-amber-500 bg-amber-50/70 text-amber-950'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                <FlaskConical className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
                <span>شبیه‌ساز آزمایشی (Sandbox)</span>
              </div>
              <p className="text-[11px] opacity-80 mt-1">
                بدون اتصال به سایت واقعی و بدون کسر اعتبار دانشجویی
              </p>
            </button>

            <button
              type="button"
              onClick={() => void onSetRuntimeMode(true)}
              disabled={isBusy}
              aria-pressed={snapshot.liveModeEnabled}
              className={`min-h-[56px] p-3.5 rounded-xl border text-right transition-colors cursor-pointer ${
                snapshot.liveModeEnabled
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                <Globe className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span>اتصال واقعی به سایت دانشگاه (Live)</span>
              </div>
              <p className="text-[11px] opacity-80 mt-1">
                ورود واقعی با مرورگر سرور به dining.iut.ac.ir و ثبت سفارش واقعی
              </p>
            </button>
          </div>
        )}
      </section>

      {/* 2. Anti-Hang & Extreme Robustness Settings */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-blue-900 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">ورود زودتر و مقاومت در برابر هنگ شدید</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                جلوگیری از خطای وقفه، تمدید خودکار نشست و تلاش مجدد در شلوغی سامانه
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void applyHeavyHangPreset()}
            disabled={isBusy}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Zap className="w-3.5 h-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>حالت حداکثر پایداری (هنگ شدید)</span>
          </button>
        </div>

        <form onSubmit={handleAntiHangSubmit} className="space-y-5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="early-login-minutes" className="text-xs font-bold text-slate-700">
                چند دقیقه زودتر وارد سایت شود؟
              </label>
              {previewEarlyTime && snapshot.schedule.mode !== 'now' && (
                <span className="text-xs font-semibold text-blue-900 tabular-nums">
                  ورود ساعت {toPersianDigits(previewEarlyTime)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {EARLY_LOGIN_PRESETS.map((mins) => {
                const active = earlyLoginMinutes === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setEarlyLoginMinutes(mins)}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-900 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {toPersianDigits(mins)} دقیقه{mins === 10 ? ' (استاندارد)' : ''}
                  </button>
                );
              })}

              <div className="flex items-center gap-1.5 sm:mr-auto">
                <input
                  id="early-login-minutes"
                  type="number"
                  min={0}
                  max={30}
                  dir="ltr"
                  value={earlyLoginMinutes}
                  onChange={(e) => setEarlyLoginMinutes(Number(e.target.value))}
                  className="w-16 min-h-[40px] px-2 py-1 rounded-xl border border-slate-300 bg-white font-mono text-sm text-center font-bold tabular-nums"
                />
                <span className="text-xs text-slate-600">دقیقه</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
            <div className="space-y-1.5">
              <label htmlFor="hang-tolerance-sec" className="block text-xs font-bold text-slate-700">
                مهلت انتظار در هنگ شدید سایت (۱۵ تا ۱۲۰ ثانیه)
              </label>
              <input
                id="hang-tolerance-sec"
                type="number"
                min={15}
                max={120}
                dir="ltr"
                value={hangToleranceSeconds}
                onChange={(e) => setHangToleranceSeconds(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-sm tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="retry-window-sec" className="block text-xs font-bold text-slate-700">
                بازهٔ تلاش مجدد تا باز شدن منو (۱۵ تا ۳۰۰ ثانیه)
              </label>
              <input
                id="retry-window-sec"
                type="number"
                min={15}
                max={300}
                dir="ltr"
                value={retryWindowSeconds}
                onChange={(e) => setRetryWindowSeconds(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer min-h-[36px]">
              <input
                type="checkbox"
                checked={keepSessionWarm}
                onChange={(e) => setKeepSessionWarm(e.target.checked)}
                className="w-4 h-4 accent-blue-900 rounded cursor-pointer"
              />
              <span>تا لحظهٔ رزرو داخل صفحه بماند و نشست را زنده نگه دارد</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer min-h-[36px]">
              <input
                type="checkbox"
                checked={subsecondExecution}
                onChange={(e) => setSubsecondExecution(e.target.checked)}
                className="w-4 h-4 accent-blue-900 rounded cursor-pointer"
              />
              <span>اقدام ثانیه‌ای سر ساعت + بازیابی خودکار صفحهٔ قفل‌شده</span>
            </label>
          </div>

          {antiHangFeedback && (
            <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2">
              {antiHangFeedback}
            </p>
          )}

          <button
            type="submit"
            disabled={isBusy}
            className="min-h-[44px] px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap cursor-pointer transition-colors"
          >
            ذخیره تنظیمات ضدهنگ
          </button>
        </form>
      </section>

      {/* 3. Hidden / Collapsible Developer & Security Drawer */}
      <details className="bg-white border border-slate-200 rounded-2xl p-4 lg:p-5">
        <summary className="text-xs sm:text-sm font-bold text-slate-700 cursor-pointer select-none flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <span>جزئیات امنیتی نشست و محیط آزمایشی (Sandbox)</span>
        </summary>
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between gap-4 py-1">
              <dt className="text-slate-500">رمزنگاری سمت سرور</dt>
              <dd className="font-mono text-slate-800">{snapshot.account.encryptionAlgorithm}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1">
              <dt className="text-slate-500">وضعیت نشست آماده</dt>
              <dd className="text-slate-800 tabular-nums">
                {snapshot.account.encryptedSessionActive && snapshot.account.sessionPreparedAtJalali
                  ? `فعال (${toPersianDigits(snapshot.account.sessionPreparedAtJalali)})`
                  : 'نشست فعالی ذخیره نشده'}
              </dd>
            </div>
          </dl>

          {snapshot.runtimeMode === 'SANDBOX' && (
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
              <div className="flex-1 min-w-0">
                <label htmlFor="sandbox-scenario-select" className="block text-xs text-slate-500 mb-1.5">
                  سناریوی شبیه‌ساز محلی
                </label>
                <select
                  id="sandbox-scenario-select"
                  value={snapshot.sandboxScenario}
                  onChange={(e) => onSelectScenario(e.target.value as SandboxScenario)}
                  className="w-full min-h-[42px] px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
                >
                  {SCENARIO_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={onResetSandbox}
                disabled={isBusy}
                className="min-h-[42px] px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-800 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>بازنشانی آزمایش</span>
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
