import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ToastNotice, ToastTone } from '../core/upcomingDays';

interface ToastViewportProps {
  toasts: ToastNotice[];
  onDismiss: (id: string) => void;
}

function getToneStyles(tone: ToastTone): {
  container: string;
  iconClass: string;
  Icon: typeof CheckCircle2;
} {
  switch (tone) {
    case 'success':
      return {
        container: 'bg-slate-900 border-emerald-500/40 text-white',
        iconClass: 'text-emerald-400',
        Icon: CheckCircle2,
      };
    case 'warning':
      return {
        container: 'bg-slate-900 border-amber-400/50 text-white',
        iconClass: 'text-amber-300',
        Icon: AlertTriangle,
      };
    case 'error':
      return {
        container: 'bg-red-950 border-red-500/50 text-white',
        iconClass: 'text-red-300',
        Icon: XCircle,
      };
    default:
      return {
        container: 'bg-slate-900 border-slate-700 text-white',
        iconClass: 'text-sky-300',
        Icon: Info,
      };
  }
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-16 left-4 right-4 lg:bottom-5 lg:left-6 lg:right-auto lg:w-[24rem] z-[60] pointer-events-none flex flex-col items-center lg:items-stretch gap-2"
    >
      {toasts.map((toast) => {
        const { container, iconClass, Icon } = getToneStyles(toast.tone);
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto w-full max-w-md rounded-xl border shadow-lg px-3.5 py-2.5 flex items-start justify-between gap-3 transition-all duration-200 ${container}`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs sm:text-sm font-bold leading-snug">{toast.title}</p>
                {toast.message && (
                  <p className="text-[11px] sm:text-xs text-slate-200 leading-relaxed line-clamp-2">
                    {toast.message}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="بستن اعلان"
              className="min-h-[30px] min-w-[30px] rounded-lg text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
