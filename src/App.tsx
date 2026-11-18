import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from './api';
import { AccountLoginModal } from './components/AccountLoginModal';
import { AppShell, type NavTab } from './components/AppShell';
import { DashboardView } from './components/DashboardView';
import { HistoryView } from './components/HistoryView';
import { SchedulePolicyView } from './components/SchedulePolicyView';
import { SettingsView } from './components/SettingsView';
import { ToastViewport } from './components/ToastViewport';
import { toPersianDigits } from './core/jalali';
import type {
  AppStateSnapshot,
  PolicyConfig,
  SandboxScenario,
  ScheduleConfig,
} from './core/types';
import { deriveToastForReservationResult, type ToastNotice } from './core/upcomingDays';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AppStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const existingTimer = toastTimersRef.current.get(id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addToast = useCallback(
    (notice: Omit<ToastNotice, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { ...notice, id }]);
      const timerId = window.setTimeout(() => {
        dismissToast(id);
      }, 4500);
      toastTimersRef.current.set(id, timerId);
    },
    [dismissToast]
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const timerId of timers.values()) {
        window.clearTimeout(timerId);
      }
      timers.clear();
    };
  }, []);

  const loadState = useCallback(async () => {
    try {
      const data = await api.getState();
      setSnapshot(data);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در دریافت وضعیت سرور');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
    const timer = window.setInterval(() => {
      void loadState();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadState]);

  const runAction = async (
    fn: () => Promise<AppStateSnapshot>,
    resolveToast?: (next: AppStateSnapshot) => Omit<ToastNotice, 'id'> | null
  ) => {
    setIsBusy(true);
    setErrorBanner(null);
    try {
      const next = await fn();
      setSnapshot(next);
      if (resolveToast) {
        const notice = resolveToast(next);
        if (notice) addToast(notice);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطا در انجام عملیات';
      setErrorBanner(msg);
      addToast({ tone: 'error', title: 'خطا در انجام عملیات', message: msg });
    } finally {
      setIsBusy(false);
    }
  };

  if (loading || !snapshot) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-sm w-full text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {errorBanner ? 'خطا در اتصال به سرور برنامه' : 'در حال بارگذاری پنل رزرو غذا...'}
          </p>
          {errorBanner && (
            <>
              <p className="text-xs text-red-700">{errorBanner}</p>
              <button
                type="button"
                onClick={() => void loadState()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold cursor-pointer"
              >
                تلاش مجدد
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const loginTestToast = (next: AppStateSnapshot): Omit<ToastNotice, 'id'> =>
    next.account.lastLoginTestOk
      ? {
          tone: 'success',
          title: 'ورود و اتصال با موفقیت تأیید شد',
          message: next.account.lastLoginTestMessage ?? undefined,
        }
      : {
          tone: 'error',
          title: 'بررسی ورود ناموفق بود',
          message: next.account.lastLoginTestMessage ?? undefined,
        };

  return (
    <>
      <AppShell
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        account={snapshot.account}
        onOpenAccountModal={() => setAccountModalOpen(true)}
        serverTimeJalali={snapshot.serverTimeJalali}
        serverTimeTehran={snapshot.serverTimeTehran}
      >
        {errorBanner && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs lg:text-sm text-red-800 flex items-center justify-between gap-3"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="بستن خطا"
              className="min-h-[32px] min-w-[32px] rounded-lg hover:bg-red-100 flex items-center justify-center text-red-700 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            snapshot={snapshot}
            isBusy={isBusy}
            onReserveNow={() =>
              void runAction(() => api.reserveNow(), deriveToastForReservationResult)
            }
            onStopSchedule={() =>
              void runAction(() => api.stopSchedule(), () => ({
                tone: 'info',
                title: 'زمان‌بندی خودکار متوقف شد',
                message: 'در هر زمان می‌توانید دوباره آن را از بخش برنامه فعال کنید.',
              }))
            }
            onOpenAccountModal={() => setAccountModalOpen(true)}
            onOpenScheduleTab={() => setActiveTab('schedule')}
            onOpenSettingsTab={() => setActiveTab('settings')}
            onOpenHistoryTab={() => setActiveTab('history')}
          />
        )}

        {activeTab === 'schedule' && (
          <SchedulePolicyView
            snapshot={snapshot}
            isBusy={isBusy}
            onSaveSchedule={async (payload: Partial<ScheduleConfig>) => {
              await runAction(
                () => api.saveSchedule(payload),
                (next) => ({
                  tone: 'success',
                  title: 'تنظیمات برنامه و زمان‌بندی ذخیره شد',
                  message: next.schedule.enabled
                    ? `زمان اجرای خودکار: ساعت ${toPersianDigits(next.schedule.actionTimeTehran)}`
                    : 'برنامه در حالت دستی ذخیره شد.',
                })
              );
            }}
            onSavePolicy={async (payload: Partial<PolicyConfig>) => {
              await runAction(
                () => api.savePolicy(payload),
                () => ({
                  tone: 'success',
                  title: 'انتخاب غذا و فیلترها ذخیره شد',
                  message: 'تنظیمات جدید در رزرو بعدی اعمال می‌شود.',
                })
              );
            }}
            onOpenSettingsTab={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'history' && <HistoryView snapshot={snapshot} />}

        {activeTab === 'settings' && (
          <SettingsView
            snapshot={snapshot}
            isBusy={isBusy}
            onOpenAccountModal={() => setAccountModalOpen(true)}
            onTestLogin={async () => {
              await runAction(() => api.testLogin(), loginTestToast);
            }}
            onTestLiveLogin={async () => {
              await runAction(() => api.testLiveLogin(), loginTestToast);
            }}
            onTestConnection={async () => {
              await runAction(() => api.testConnection(), loginTestToast);
            }}
            onSetRuntimeMode={async (liveModeEnabled: boolean) => {
              await runAction(
                () => api.setRuntimeMode(liveModeEnabled),
                (next) => ({
                  tone: 'success',
                  title:
                    next.runtimeMode !== 'SANDBOX'
                      ? 'حالت اجرای واقعی (سایت دانشگاه) فعال شد'
                      : 'حالت آزمایشی (Sandbox) فعال شد',
                })
              );
            }}
            onSaveSchedule={async (payload: Partial<ScheduleConfig>) => {
              await runAction(
                () => api.saveSchedule(payload),
                () => ({
                  tone: 'success',
                  title: 'تنظیمات ضدهنگ و زمان‌بندی ذخیره شد',
                })
              );
            }}
            onSelectScenario={(scenario: SandboxScenario) =>
              void runAction(
                () => api.setSandboxScenario(scenario),
                (next) => ({
                  tone: 'info',
                  title: 'سناریوی آزمایشی تغییر یافت',
                  message: next.lastMessage,
                })
              )
            }
            onResetSandbox={() =>
              void runAction(
                () => api.resetSandbox(),
                () => ({
                  tone: 'info',
                  title: 'داده‌های محیط آزمایشی بازنشانی شد',
                })
              )
            }
          />
        )}

        <AccountLoginModal
          open={accountModalOpen}
          onClose={() => setAccountModalOpen(false)}
          snapshot={snapshot}
          isBusy={isBusy}
          onSaveAccount={async (payload) => {
            await runAction(
              () => api.saveAccount(payload),
              () => ({
                tone: 'success',
                title: 'اطلاعات حساب کاربری ذخیره شد',
              })
            );
          }}
          onTestLogin={async () => {
            await runAction(() => api.testLogin(), loginTestToast);
          }}
          onTestLiveLogin={async () => {
            await runAction(() => api.testLiveLogin(), loginTestToast);
          }}
          onTestConnection={async () => {
            await runAction(() => api.testConnection(), loginTestToast);
          }}
        />
      </AppShell>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
