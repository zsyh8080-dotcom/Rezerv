import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Globe,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { toPersianDigits } from '../core/jalali';
import { rialsToToman } from '../core/policy';
import type { LoginVerificationProof } from '../core/types';

interface LoginProofCardProps {
  verification: LoginVerificationProof | null;
}

export function LoginProofCard({ verification }: LoginProofCardProps) {
  const [expandedImg, setExpandedImg] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (verification?.source === 'LIVE_IUT' && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [verification?.verifiedAtUtcMs, verification?.source]);

  if (!verification) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600 leading-relaxed">
        هنوز بررسی ورود واقعی روی سایت <span dir="ltr" className="font-mono">dining.iut.ac.ir</span> انجام نشده است. برای اطمینان واقعی، دکمه «تست ورود واقعی به سایت دانشگاه» را بزنید.
      </div>
    );
  }

  if (verification.source === 'SANDBOX_SIMULATION') {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold text-amber-950">
          <FlaskConical className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>شبیه‌ساز آزمایشی (اتصال واقعی برقرار نشد)</span>
        </div>
        <p className="text-amber-900 leading-relaxed">
          نتیجهٔ قبلی مربوط به محیط شبیه‌ساز محلی در ساعت{' '}
          <span className="tabular-nums font-semibold">
            {toPersianDigits(verification.verifiedAtTehranTime)}
          </span>{' '}
          است و هنوز هیچ درخواستی به سایت واقعی دانشگاه ارسال نشده است.
        </p>
      </div>
    );
  }

  const isSuccess = verification.ok;

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border p-3.5 space-y-3 text-xs ${
        isSuccess
          ? 'border-emerald-300 bg-emerald-50/70 text-emerald-950'
          : 'border-red-300 bg-red-50/80 text-red-950'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-bold">
          {isSuccess ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-700" aria-hidden="true" />
          )}
          <span>
            {isSuccess
              ? 'تأیید‌شده از سایت واقعی دانشگاه (dining.iut.ac.ir)'
              : 'اتصال واقعی برقرار شد ولی ورود کامل نشد'}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-current/15 text-[11px] font-semibold tabular-nums shrink-0">
          <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{toPersianDigits(verification.verifiedAtTehranTime)}</span>
        </span>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-white/80 rounded-lg p-2.5 border border-black/5">
        <div className="sm:col-span-2 min-w-0">
          <dt className="text-[11px] text-slate-500">آدرس واقعی بازشده</dt>
          <dd dir="ltr" className="font-mono text-[11px] text-slate-900 break-all mt-0.5 text-right">
            {verification.finalUrl}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[11px] text-slate-500">عنوان صفحه در سایت</dt>
          <dd className="font-semibold text-slate-900 mt-0.5">
            {verification.pageTitle || '—'}
          </dd>
        </div>

        {verification.studentBannerText && (
          <div className="sm:col-span-2 min-w-0">
            <dt className="text-[11px] text-slate-500">
              {isSuccess ? 'متن/نام خوانده‌شده از پنل دانشجو' : 'پیام یا خطای صفحهٔ دانشگاه'}
            </dt>
            <dd className="font-medium text-slate-900 break-words mt-0.5 leading-relaxed">
              {verification.studentBannerText}
            </dd>
          </div>
        )}

        {typeof verification.availableCreditRials === 'number' && verification.availableCreditRials > 0 && (
          <div>
            <dt className="text-[11px] text-slate-500">اعتبار واقعی خوانده‌شده از سلف</dt>
            <dd className="font-bold text-emerald-800 tabular-nums mt-0.5">
              {toPersianDigits(rialsToToman(verification.availableCreditRials).toLocaleString('en-US'))}{' '}
              تومان
            </dd>
          </div>
        )}

        {typeof verification.reservedCountOnSite === 'number' && isSuccess && (
          <div>
            <dt className="text-[11px] text-slate-500">تعداد رزروهای دیده‌شده در صفحه</dt>
            <dd className="font-bold text-slate-900 tabular-nums mt-0.5">
              {toPersianDigits(verification.reservedCountOnSite)} مورد
            </dd>
          </div>
        )}

        {verification.sampleDishes && verification.sampleDishes.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-slate-500">موارد خوانده‌شده از جدول منو</dt>
            <dd className="font-medium text-slate-800 mt-0.5">
              {verification.sampleDishes.join(' · ')}
            </dd>
          </div>
        )}
      </dl>

      {verification.screenshotDataUrl && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-emerald-900">
              تصویر واقعی صفحهٔ سلف پس از ورود:
            </span>
            <button
              type="button"
              onClick={() => setExpandedImg((prev) => !prev)}
              className="text-[11px] font-semibold text-blue-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              {expandedImg ? (
                <>
                  <Minimize2 className="w-3 h-3" aria-hidden="true" />
                  <span>کوچک‌تر</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3" aria-hidden="true" />
                  <span>بزرگ‌نمایی</span>
                </>
              )}
            </button>
          </div>
          <img
            src={verification.screenshotDataUrl}
            alt="تصویر واقعی صفحه سامانه تغذیه دانشگاه پس از ورود"
            className={`w-full rounded-lg border border-emerald-200 bg-white object-cover object-top transition-all ${
              expandedImg ? 'max-h-[460px]' : 'max-h-44'
            }`}
          />
        </div>
      )}
    </div>
  );
}
