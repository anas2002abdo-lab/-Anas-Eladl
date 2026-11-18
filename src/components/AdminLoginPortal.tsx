import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { AdminUserRecord, Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  onSuccess: (user: AdminUserRecord) => Promise<void> | void;
  onNotify: (msg: string) => void;
}

export const AdminLoginPortal: React.FC<Props> = ({ lang, onSuccess, onNotify }) => {
  const isAr = lang === 'ar';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [superAdminReady, setSuperAdminReady] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .getBootstrapStatus()
      .then((res) => setSuperAdminReady(Boolean(res.super_admin_configured)))
      .catch(() => setSuperAdminReady(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password) {
      const msg = isAr ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور' : 'Please enter email and password';
      setErrorMsg(msg);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.adminLogin(email.trim(), password);
      setPassword('');
      onNotify(
        isAr
          ? `تم تسجيل الدخول بنجاح — مرحبًا ${res.user.full_name}`
          : `Signed in successfully — Welcome ${res.user.full_name}`
      );
      await onSuccess(res.user as AdminUserRecord);
    } catch (err) {
      const msg = (err as Error).message || (isAr ? 'فشل تسجيل الدخول' : 'Sign in failed');
      setErrorMsg(msg);
      onNotify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-8">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-600/20 border border-orange-500/40 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold">
              {isAr ? 'بوابة إدارة منصة اطلبها' : 'Otlobha Admin Control Portal'}
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              {isAr
                ? 'الدخول مقتصر على الإدارة المعتمدة عبر الجلسات المحمية'
                : 'Restricted to authorized administrators via protected sessions'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {superAdminReady === false && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs leading-relaxed flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  {isAr ? 'حساب Super Admin غير مهيأ بعد' : 'Super Admin Not Initialized Yet'}
                </p>
                <p className="mt-1">
                  {isAr
                    ? 'أضف SUPER_ADMIN_EMAIL وSUPER_ADMIN_PASSWORD (10 أحرف فأكثر) في إعدادات Secrets / بيئة التشغيل ثم أعد تشغيل الخادم ليتم إنشاء الحساب تلقائيًا.'
                    : 'Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (min 10 chars) in Secrets/Environment and restart the server.'}
                </p>
              </div>
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {isAr ? 'البريد الإلكتروني الإداري' : 'Administrator Email'}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@otlobha.eg"
                className="w-full ps-9 pe-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {isAr ? 'كلمة المرور' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type={showPw ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full ps-9 pe-10 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={isAr ? 'إظهار أو إخفاء كلمة المرور' : 'Toggle password visibility'}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-slate-400 hover:text-slate-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span>
              {submitting
                ? isAr
                  ? 'جاري التحقق من الصلاحيات...'
                  : 'Verifying...'
                : isAr
                ? 'تسجيل الدخول إلى لوحة التحكم'
                : 'Sign In to Control Panel'}
            </span>
          </button>

          <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-1">
            {isAr
              ? 'يتم التحقق من الجلسة على الخادم عبر HttpOnly Cookies وصلاحيات الأدوار (RBAC).'
              : 'Session verified server-side via HttpOnly Cookies and role-based access control.'}
          </p>
        </form>
      </div>
    </div>
  );
};
