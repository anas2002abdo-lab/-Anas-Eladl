import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Language } from '../shared/types.ts';

interface QuickAccount {
  label: string;
  email: string;
  phone?: string;
}

interface Props {
  role: 'customer' | 'merchant';
  lang: Language;
  quickAccounts?: QuickAccount[];
  onVerified: (user: any) => void;
  onNotify: (msg: string) => void;
}

export const EmailOtpLoginCard: React.FC<Props> = ({ role, lang, quickAccounts = [], onVerified, onNotify }) => {
  const isAr = lang === 'ar';
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [deliveryChannel, setDeliveryChannel] = useState<'smtp' | 'sandbox'>('sandbox');
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) {
      onNotify(isAr ? 'أدخل البريد الإلكتروني أولًا' : 'Enter email address first');
      return;
    }
    setLoading(true);
    try {
      const res = await api.requestEmailOtp(email.trim(), role);
      setEmail(res.email);
      setDeliveryChannel(res.delivery_channel);
      setDemoOtp(res.demo_otp || null);
      setCode('');
      setStep('otp');
      setResendIn(60);
      onNotify(
        res.delivery_channel === 'sandbox' && res.demo_otp
          ? isAr
            ? `تم إنشاء رمز التأكيد للبريد ${res.email} (رمز التجربة: ${res.demo_otp})`
            : `OTP created for ${res.email} (Code: ${res.demo_otp})`
          : isAr
          ? `تم إرسال رسالة برقم التأكيد إلى بريدك ${res.email}`
          : `Confirmation code sent to ${res.email}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      onNotify(isAr ? 'أدخل رمز التأكيد المكون من 6 أرقام' : 'Enter 6-digit OTP code');
      return;
    }
    setLoading(true);
    try {
      const res = await api.verifyEmailOtp(
        email.trim(),
        code.trim(),
        role,
        fullName.trim() || undefined,
        phone.trim() || undefined
      );
      onNotify(isAr ? 'تم تأكيد البريد الإلكتروني وتسجيل الدخول بنجاح' : 'Email verified and signed in');
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-6 space-y-5">
      <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] border-b-2 border-[#F5A623]/80 text-white rounded-2xl p-4 sm:p-5 flex items-center gap-4 shadow-sm">
        <img
          src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
          alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
          className="w-14 h-14 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/70"
        />
        <div>
          <p className="text-xs text-amber-200 font-semibold">
            {role === 'merchant'
              ? isAr
                ? 'بوابة التجار والصيدليات · المنزلة'
                : 'Otlobha Merchant Portal'
              : isAr
              ? 'تطبيق اطلبها للعملاء · المنزلة'
              : 'Otlobha Customer App'}
          </p>
          <h2 className="text-xl font-bold mt-0.5">
            {role === 'merchant'
              ? isAr
                ? 'دخول التاجر بتأكيد البريد الإلكتروني'
                : 'Merchant Email OTP Sign In'
              : isAr
              ? 'تسجيل الدخول بالبريد الإلكتروني'
              : 'Customer Email OTP Sign In'}
          </h2>
        </div>
      </div>

      {step === 'email' ? (
        <form onSubmit={handleRequestOtp} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-900">
              {isAr ? 'أدخل بريدك الإلكتروني لإرسال رمز التأكيد' : 'Enter your email for OTP verification'}
            </p>
            <p className="text-xs text-slate-500">
              {role === 'merchant'
                ? isAr
                  ? 'أدخل البريد الإلكتروني المسجل لمتجرك أو صيدليتك وسنرسل لك كود التأكيد مجانًا.'
                  : 'Enter your registered merchant email to receive a confirmation code.'
                : isAr
                ? 'سيصلك كود تأكيد من 6 أرقام إلى بريدك الإلكتروني لتضعه هنا وتدخل مباشرة.'
                : 'We will send a 6-digit confirmation code to your email.'}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'البريد الإلكتروني (Email)' : 'Email Address'}
              </label>
              <div className="relative">
                <input
                  type="email"
                  dir="ltr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {role === 'customer' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'الاسم (اختياري / للعميل الجديد)' : 'Name (optional)'}
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={isAr ? 'الاسم الكامل' : 'Full Name'}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'رقم الهاتف للتوصيل (اختياري)' : 'Delivery Phone (optional)'}
                  </label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
          >
            <Mail className="w-4 h-4" />
            <span>{loading ? 'جاري الإرسال...' : isAr ? 'إرسال رمز التأكيد إلى البريد الإلكتروني' : 'Send Email Code'}</span>
          </button>

          {quickAccounts.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <p className="text-[11px] font-semibold text-slate-500">
                {isAr ? 'حسابات جاهزة للتجربة السريعة:' : 'Quick test accounts:'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
                      if (role === 'customer') {
                        setFullName(acc.label);
                        if (acc.phone) setPhone(acc.phone);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-orange-50 hover:text-orange-800 border border-slate-200 rounded-lg text-[11px] font-medium"
                  >
                    <span dir="ltr" className="font-mono-num font-bold">{acc.email}</span> · {acc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">
                {isAr ? 'أدخل رمز التأكيد المرسل لبريدك' : 'Enter Verification Code'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                <span dir="ltr" className="font-mono-num font-semibold text-slate-700">
                  {email}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setDemoOtp(null);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>{isAr ? 'تغيير البريد' : 'Change'}</span>
            </button>
          </div>

          {deliveryChannel === 'sandbox' && demoOtp ? (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-900">
                  <Mail className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>{isAr ? 'رسالة البريد الواردة (وضع التجربة قبل ربط Gmail SMTP)' : 'Incoming Email Preview (Sandbox)'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCode(demoOtp)}
                  className="px-2.5 py-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-[11px] font-bold"
                >
                  {isAr ? 'تعبئة الرمز' : 'Auto-fill'}
                </button>
              </div>
              <p className="text-xs text-teal-800 leading-relaxed">
                رمز تأكيد الدخول لمنصة اطلبها هو:{' '}
                <strong dir="ltr" className="font-mono-num text-sm tracking-widest bg-white px-2 py-0.5 rounded border border-teal-200">
                  {demoOtp}
                </strong>
              </p>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>
                {isAr
                  ? `تم إرسال رسالة بريد إلكتروني برقم التأكيد إلى ${email}. راجع البريد الوارد أو الرسائل غير المرغوب فيها (Spam).`
                  : `Verification email sent to ${email}.`}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {isAr ? 'رقم التأكيد (6 أرقام)' : '6-Digit Confirmation Code'}
            </label>
            <input
              type="text"
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="------"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-xl tracking-[0.4em] font-mono-num font-bold"
            />
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{loading ? 'جاري التأكيد...' : isAr ? 'تأكيد الرمز وتسجيل الدخول' : 'Verify & Sign In'}</span>
          </button>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>{isAr ? 'لم تصلك الرسالة؟' : "Didn't receive email?"}</span>
            <button
              type="button"
              disabled={resendIn > 0 || loading}
              onClick={() => handleRequestOtp()}
              className="inline-flex items-center gap-1 font-bold text-orange-600 disabled:text-slate-400"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>
                {resendIn > 0
                  ? isAr
                    ? `إعادة الإرسال بعد ${resendIn} ث`
                    : `Resend in ${resendIn}s`
                  : isAr
                  ? 'إعادة إرسال الرمز'
                  : 'Resend Code'}
              </span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
