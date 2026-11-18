import type { ReactNode } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Home,
  LogIn,
  Settings,
  UtensilsCrossed,
} from 'lucide-react';
import { formatJalaliReadable } from '../core/historyAnalytics';
import { toPersianDigits } from '../core/jalali';
import type { AccountConfigPublic } from '../core/types';

export type NavTab = 'dashboard' | 'schedule' | 'history' | 'settings';

interface AppShellProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  account: AccountConfigPublic;
  onOpenAccountModal: () => void;
  serverTimeJalali: string;
  serverTimeTehran: string;
  children: ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  shortLabel: string;
  icon: typeof Home;
}> = [
  { id: 'dashboard', label: 'داشبورد', shortLabel: 'داشبورد', icon: Home },
  { id: 'schedule', label: 'غذا و زمان‌بندی', shortLabel: 'برنامه', icon: CalendarClock },
  { id: 'history', label: 'گزارش و هزینه', shortLabel: 'گزارش', icon: CalendarDays },
  { id: 'settings', label: 'تنظیمات', shortLabel: 'تنظیمات', icon: Settings },
];

export function AppShell({
  activeTab,
  onSelectTab,
  account,
  onOpenAccountModal,
  serverTimeJalali,
  serverTimeTehran,
  children,
}: AppShellProps) {
  const currentItem = NAV_ITEMS.find((i) => i.id === activeTab) ?? NAV_ITEMS[0];
  const readableDate = formatJalaliReadable(serverTimeJalali);
  const isLoggedConfigured = account.hasStoredPassword || account.usesRuntimeSecrets;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Right Sidebar (RTL) */}
      <aside className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col bg-white border-l border-slate-200">
        <div className="h-14 px-5 border-b border-slate-100 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-blue-900 text-white flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap truncate">
            سلف‌یار صنعتی
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="منوی اصلی">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-blue-900 text-white font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Clean Single-Row Header */}
        <header className="sticky top-0 z-30 h-12 lg:h-14 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-4 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden w-7 h-7 rounded-lg bg-blue-900 text-white flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <h1 className="text-sm lg:text-base font-bold text-slate-900 truncate whitespace-nowrap">
              {currentItem.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-600 tabular-nums whitespace-nowrap">
              <span className="hidden md:inline">{readableDate}</span>
              <span className="hidden md:inline text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-slate-900">
                {toPersianDigits(serverTimeTehran.slice(0, 5))}
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenAccountModal}
              className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                isLoggedConfigured
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                  : 'bg-blue-900 hover:bg-blue-950 text-white'
              }`}
            >
              {isLoggedConfigured ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span className="tabular-nums">حساب {toPersianDigits(account.username)}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>ورود به حساب</span>
                </>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-5 lg:px-8 lg:py-7 space-y-5">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white border-t border-slate-200 grid grid-cols-4 items-center"
        aria-label="ناوبری موبایل"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 text-[11px] whitespace-nowrap transition-colors ${
                active ? 'text-blue-900 font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
