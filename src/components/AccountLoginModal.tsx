import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Globe, KeyRound, ShieldCheck, UserCheck, Wifi, X } from 'lucide-react';
import { toPersianDigits } from '../core/jalali';
import type { AppStateSnapshot } from '../core/types';
import { LoginProofCard } from './LoginProofCard';

interface AccountLoginModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: AppStateSnapshot;
  isBusy: boolean;
  onSaveAccount: (payload: { username: string; password?: string }) => Promise<void>;
  onTestLogin: () => Promise<void>;
  onTestLiveLogin: () => Promise<void>;
  onTestConnection: () => Promise<void>;
}

export function AccountLoginModal({
  open,
  onClose,
  snapshot,
  isBusy,
  onSaveAccount,
  onTestLogin,
  onTestLiveLogin,
  onTestConnection,
}: AccountLoginModalProps) {
  const [username, setUsername] = useState(snapshot.account.username || '40125403');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testingLive, setTestingLive] = useState(false);

  useEffect(() => {
    setUsername(snapshot.account.username || '40125403');
  }, [snapshot.account.username]);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const ensureSavedBeforeTest = async () => {
    if (password.trim() || username.trim() !== snapshot.account.username) {
      await onSaveAccount({
        username: username.trim() || '40125403',
        password: password.trim() ? password : undefined,
      });
      setPassword('');
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    await onSaveAccount({
      username: username.trim() || '40125403',
      password: password.trim() ? password : undefined,
    });
    setPassword('');
    setFeedback('اطلاعات ورود ذخیره شد.');
  };

  const handleSaveAndTest = async () => {
    setFeedback(null);
    await ensureSavedBeforeTest();
    await onTestLogin();
  };

  const handleLiveTest = async () => {
    setFeedback(null);
    setTestingLive(true);
    try {
      await ensureSavedBeforeTest();
      await onTestLiveLogin();
    } finally {
      setTestingLive(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="account-modal-title" className="text-base font-bold text-slate-900 truncate">
                ورود به حساب سامانه تغذیه
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                حساب دانشگاه صنعتی اصفهان ({toPersianDigits(snapshot.account.username)})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره ورود"
            className="min-h-[36px] min-w-[36px] rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {snapshot.account.usesRuntimeSecrets ? (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>نام کاربری و رمز در تنظیمات امن سرور تعریف شده است.</span>
          </div>
        ) : snapshot.account.hasStoredPassword ? (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>
              رمز عبور شما به‌صورت رمزنگاری‌شده ({snapshot.account.encryptionAlgorithm}) روی سرور ذخیره شده و برای استفاده‌های بعدی آماده است.
            </span>
          </div>
        ) : null}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="modal-iut-username" className="block text-xs font-bold text-slate-700">
              شماره دانشجویی
            </label>
            <input
              id="modal-iut-username"
              type="text"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={snapshot.account.runtimeUsernameConfigured}
              placeholder="40125403"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:bg-slate-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="modal-iut-password" className="block text-xs font-bold text-slate-700">
              رمز عبور سامانه دانشگاه
            </label>
            <div className="relative flex items-center">
              <input
                id="modal-iut-password"
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={snapshot.account.runtimePasswordConfigured}
                placeholder={
                  snapshot.account.runtimePasswordConfigured
                    ? 'تنظیم‌شده در سرور'
                    : snapshot.account.hasStoredPassword
                      ? '•••••••••• (ذخیره شده — برای تغییر بنویسید)'
                      : 'رمز عبور را وارد کنید'
                }
                className="w-full min-h-[44px] pl-11 pr-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                className="absolute left-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {feedback && (
            <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2">
              {feedback}
            </p>
          )}

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

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => void handleLiveTest()}
              disabled={isBusy}
              className="w-full min-h-[46px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Globe className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {testingLive
                  ? 'در حال ورود واقعی به dining.iut.ac.ir...'
                  : 'تست ورود واقعی به سایت دانشگاه'}
              </span>
            </button>

            <button
              type="submit"
              disabled={isBusy}
              className="w-full min-h-[42px] px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
            >
              ذخیره اطلاعات ورود
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSaveAndTest()}
                disabled={isBusy}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
              >
                <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>تست حالت فعال</span>
              </button>

              <button
                type="button"
                onClick={() => void onTestConnection()}
                disabled={isBusy}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Wifi className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>تست اتصال</span>
              </button>
            </div>
          </div>
        </form>

        <div className="pt-2 border-t border-slate-100 space-y-2">
          <h3 className="text-xs font-bold text-slate-700">اثبات ورود واقعی به سامانه سلف</h3>
          <LoginProofCard verification={snapshot.account.lastLoginVerification} />
        </div>
      </div>
    </div>
  );
}
