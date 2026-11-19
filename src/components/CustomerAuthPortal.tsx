import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { normalizeEmail } from '../shared/email.ts';
import type { Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  openedFromGuest?: boolean;
  onVerified: (user: any) => void;
  onContinueAsGuest: () => void;
  onNotify: (msg: string) => void;
}

type AuthMode = 'login' | 'register' | 'forgot' | 'otp';

export const CustomerAuthPortal: React.FC<Props> = ({
  lang,
  openedFromGuest = false,
  onVerified,
  onContinueAsGuest,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Register state (2-step with email OTP verification)
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPass, setRegConfirmPass] = useState('');
  const [regStep, setRegStep] = useState<'form' | 'verify'>('form');
  const [regCode, setRegCode] = useState('');
  const [regResendIn, setRegResendIn] = useState(0);
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirmPass, setShowRegConfirmPass] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStep, setForgotStep] = useState<'email' | 'reset'>('email');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [showForgotPass, setShowForgotPass] = useState(false);
  const [forgotResendIn, setForgotResendIn] = useState(0);

  // Quick Gmail OTP state
  const [otpEmail, setOtpEmail] = useState('');
  const [otpName, setOtpName] = useState('');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<'email' | 'code'>('email');
  const [otpResendIn, setOtpResendIn] = useState(0);

  useEffect(() => {
    if (regResendIn <= 0) return;
    const t = setTimeout(() => setRegResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [regResendIn]);

  useEffect(() => {
    if (forgotResendIn <= 0) return;
    const t = setTimeout(() => setForgotResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [forgotResendIn]);

  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = setTimeout(() => setOtpResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawIdent = loginIdentifier.trim();
    if (!rawIdent || !loginPassword) {
      onNotify(isAr ? 'يرجى إدخال البريد الإلكتروني أو الهاتف وكلمة المرور' : 'Enter email/phone and password');
      return;
    }
    const cleanedIdent = rawIdent.includes('@') || rawIdent.includes('＠') ? normalizeEmail(rawIdent) : rawIdent;
    if (!cleanedIdent) {
      onNotify(isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Enter a valid email');
      return;
    }
    setLoading(true);
    try {
      const res = await api.loginCustomer(cleanedIdent, loginPassword);
      onNotify(isAr ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully');
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRegisterOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (regName.trim().length < 2) {
      onNotify(isAr ? 'يرجى إدخال الاسم الكامل (حرفين على الأقل)' : 'Enter your full name');
      return;
    }
    const cleanEmail = normalizeEmail(regEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Enter a valid email');
      return;
    }
    if (regPassword.length < 6) {
      onNotify(isAr ? 'كلمة المرور يجب أن لا تقل عن 6 أحرف' : 'Password must be at least 6 characters');
      return;
    }
    if (regPassword !== regConfirmPass) {
      onNotify(isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await api.requestCustomerRegisterOtp({
        full_name: regName.trim(),
        email: cleanEmail,
        phone: regPhone.trim() || undefined,
        password: regPassword,
      });
      setRegEmail(res.email || cleanEmail);
      setRegCode('');
      setRegStep('verify');
      setRegResendIn(60);
      onNotify(
        res.message ||
          (isAr
            ? `تم إرسال رمز تأكيد البريد المكون من 6 أرقام إلى ${res.email || cleanEmail}`
            : `6-digit verification code sent to ${res.email || cleanEmail}`)
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(regEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Enter a valid email');
      return;
    }
    if (regCode.trim().length !== 6) {
      onNotify(isAr ? 'أدخل رمز تأكيد البريد المكون من 6 أرقام' : 'Enter the 6-digit email verification code');
      return;
    }
    setLoading(true);
    try {
      const res = await api.registerCustomer({
        full_name: regName.trim(),
        email: cleanEmail,
        phone: regPhone.trim() || undefined,
        password: regPassword,
        code: regCode.trim(),
      });
      onNotify(isAr ? 'تم تأكيد بريدك الإلكتروني وإنشاء حسابك بنجاح!' : 'Email verified and account created!');
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResetCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = normalizeEmail(forgotEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'أدخل بريدك الإلكتروني المسجل بشكل صحيح أولًا' : 'Enter your registered email');
      return;
    }
    setLoading(true);
    try {
      const res = await api.requestCustomerPasswordReset(cleanEmail);
      setForgotEmail(res.email || cleanEmail);
      setForgotCode('');
      setForgotStep('reset');
      setForgotResendIn(60);
      onNotify(
        res.message ||
          (isAr
            ? `تم إرسال رمز إعادة تعيين كلمة المرور إلى ${res.email || cleanEmail}`
            : `Reset code sent to ${res.email || cleanEmail}`)
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(forgotEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Enter a valid email');
      return;
    }
    if (forgotCode.trim().length !== 6) {
      onNotify(isAr ? 'أدخل رمز التحقق المكون من 6 أرقام' : 'Enter the 6-digit verification code');
      return;
    }
    if (forgotNewPass.length < 6) {
      onNotify(isAr ? 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' : 'New password must be at least 6 characters');
      return;
    }
    if (forgotNewPass !== forgotConfirmPass) {
      onNotify(isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await api.resetCustomerPassword(cleanEmail, forgotCode.trim(), forgotNewPass);
      onNotify(res.message || (isAr ? 'تم تحديث كلمة المرور بنجاح وتسجيل دخولك' : 'Password updated'));
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = normalizeEmail(otpEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'أدخل بريدًا إلكترونيًا صحيحًا أولًا' : 'Enter a valid email');
      return;
    }
    setLoading(true);
    try {
      const res = await api.requestEmailOtp(cleanEmail, 'customer');
      setOtpEmail(res.email || cleanEmail);
      setOtpCode('');
      setOtpStep('code');
      setOtpResendIn(60);
      onNotify(
        isAr
          ? `تم إرسال رمز التأكيد المكون من 6 أرقام إلى ${res.email || cleanEmail}`
          : `Confirmation code sent to ${res.email || cleanEmail}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(otpEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Enter a valid email');
      return;
    }
    if (otpCode.trim().length !== 6) {
      onNotify(isAr ? 'أدخل رمز التأكيد المكون من 6 أرقام' : 'Enter 6-digit code');
      return;
    }
    setLoading(true);
    try {
      const res = await api.verifyEmailOtp(
        cleanEmail,
        otpCode.trim(),
        'customer',
        otpName.trim() || undefined,
        otpPhone.trim() || undefined
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
    <div className="max-w-lg mx-auto py-6 space-y-4">
      {/* Brand Header */}
      <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] border-b-2 border-[#F5A623]/80 text-white rounded-2xl p-4 sm:p-5 flex items-center gap-4 shadow-sm">
        <img
          src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
          alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
          className="w-14 h-14 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/70"
        />
        <div>
          <p className="text-xs text-amber-200 font-semibold">
            {isAr ? 'تطبيق اطلبها للعملاء · المنزلة' : 'Otlobha Customer App'}
          </p>
          <h2 className="text-xl font-bold mt-0.5">
            {mode === 'register'
              ? isAr
                ? 'إنشاء حساب عميل جديد'
                : 'Create Customer Account'
              : mode === 'forgot'
              ? isAr
                ? 'استعادة كلمة السر'
                : 'Reset Password'
              : isAr
              ? 'أهلاً بك في اطلبها'
              : 'Welcome to Otlobha'}
          </h2>
          <p className="text-[11px] text-amber-100/90 mt-0.5">
            {isAr
              ? 'سجّل دخولك أو أنشئ حسابًا جديدًا أو تصفّح التطبيق كزائر'
              : 'Sign in, register, or continue as guest'}
          </p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
        {/* Mode Switcher (Login / Register) */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 ${
                mode === 'login' || mode === 'otp'
                  ? 'bg-[#A92224] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-[#A92224] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>{isAr ? 'إنشاء حساب جديد' : 'Sign Up'}</span>
            </button>
          </div>
        )}

        {/* 1. PASSWORD LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'البريد الإلكتروني أو رقم الهاتف' : 'Email or Phone'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="name@gmail.com / 01xxxxxxxxx"
                  className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                />
                <User className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'كلمة المرور' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type={showLoginPass ? 'text' : 'password'}
                  dir="ltr"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full ps-10 pe-10 py-2.5 border border-slate-200 rounded-xl text-sm"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowLoginPass((v) => !v)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Toggle password visibility"
                >
                  {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  if (loginIdentifier.includes('@') && !forgotEmail) {
                    setForgotEmail(loginIdentifier.trim());
                  }
                  setForgotStep('email');
                  setMode('forgot');
                }}
                className="text-xs font-bold text-[#A92224] hover:underline inline-flex items-center gap-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{isAr ? 'هل نسيت كلمة السر؟' : 'Forgot Password?'}</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? (isAr ? 'جاري تسجيل الدخول...' : 'Signing in...') : isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setOtpStep('email');
                  setMode('otp');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>{isAr ? 'أو تسجيل الدخول السريع برمز البريد (Gmail OTP)' : 'Or quick sign in with Email OTP'}</span>
              </button>
            </div>
          </form>
        )}

        {/* 2. REGISTER FORM (2-step with required Email OTP verification) */}
        {mode === 'register' && regStep === 'form' && (
          <form onSubmit={handleRequestRegisterOtp} className="space-y-3">
            <p className="text-xs text-slate-600 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
              {isAr
                ? 'سيتم إرسال رمز تأكيد مكون من 6 أرقام إلى بريدك الإلكتروني للتحقق منه قبل تفعيل حسابك.'
                : 'A 6-digit verification code will be sent to your email to verify your account.'}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'الاسم الكامل' : 'Full Name'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder={isAr ? 'أدخل اسمك الكامل' : 'Enter full name'}
                  className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm"
                />
                <User className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'البريد الإلكتروني (لإرسال كود التأكيد)' : 'Email Address (for verification)'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    dir="ltr"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="name@gmail.com"
                    className="w-full ps-10 pe-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'رقم الهاتف للتوصيل (اختياري)' : 'Phone (Optional)'}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    dir="ltr"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full ps-10 pe-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'كلمة المرور (6 أحرف على الأقل)' : 'Password (min 6 chars)'}
              </label>
              <div className="relative">
                <input
                  type={showRegPass ? 'text' : 'password'}
                  dir="ltr"
                  required
                  minLength={6}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full ps-10 pe-10 py-2.5 border border-slate-200 rounded-xl text-sm"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowRegPass((v) => !v)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showRegPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
              </label>
              <div className="relative">
                <input
                  type={showRegConfirmPass ? 'text' : 'password'}
                  dir="ltr"
                  required
                  minLength={6}
                  value={regConfirmPass}
                  onChange={(e) => setRegConfirmPass(e.target.value)}
                  placeholder="••••••••"
                  className="w-full ps-10 pe-10 py-2.5 border border-slate-200 rounded-xl text-sm"
                />
                <KeyRound className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowRegConfirmPass((v) => !v)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showRegConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
            >
              <Mail className="w-4 h-4" />
              <span>
                {loading
                  ? isAr
                    ? 'جاري إرسال رمز التأكيد...'
                    : 'Sending verification code...'
                  : isAr
                  ? 'إرسال رمز تأكيد البريد الإلكتروني'
                  : 'Send Email Verification Code'}
              </span>
            </button>
          </form>
        )}

        {mode === 'register' && regStep === 'verify' && (
          <form onSubmit={handleConfirmRegister} className="space-y-3.5">
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>{isAr ? 'تأكيد البريد الإلكتروني' : 'Verify Your Email'}</span>
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setRegStep('form');
                    setRegCode('');
                  }}
                  className="text-[11px] font-bold text-[#A92224] hover:underline"
                >
                  {isAr ? 'تعديل البيانات' : 'Edit details'}
                </button>
              </div>
              <p className="text-xs text-teal-800">
                {isAr
                  ? 'تم إرسال كود تأكيد مكون من 6 أرقام إلى بريدك الإلكتروني:'
                  : 'We sent a 6-digit verification code to:'}
              </p>
              <p className="text-xs font-bold font-mono-num text-slate-900" dir="ltr">
                {regEmail}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isAr ? 'رمز تأكيد البريد الإلكتروني (6 أرقام)' : 'Email Verification Code (6 digits)'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                maxLength={6}
                required
                value={regCode}
                onChange={(e) => setRegCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-3 border-2 border-orange-300 focus:border-orange-600 rounded-xl text-center text-xl font-extrabold tracking-[0.45em] font-mono-num"
              />
            </div>

            <button
              type="submit"
              disabled={loading || regCode.length !== 6}
              className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {loading
                  ? isAr
                    ? 'جاري تأكيد البريد وإنشاء الحساب...'
                    : 'Verifying & creating account...'
                  : isAr
                  ? 'تأكيد البريد وإنشاء الحساب'
                  : 'Verify Email & Create Account'}
              </span>
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={loading || regResendIn > 0}
                onClick={() => handleRequestRegisterOtp()}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-700 hover:text-orange-800 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {regResendIn > 0
                    ? isAr
                      ? `إعادة الإرسال بعد ${regResendIn} ث`
                      : `Resend in ${regResendIn}s`
                    : isAr
                    ? 'إعادة إرسال الرمز'
                    : 'Resend code'}
                </span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setRegStep('form');
                  setRegCode('');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{isAr ? 'الرجوع للبيانات' : 'Back'}</span>
              </button>
            </div>
          </form>
        )}

        {/* 3. FORGOT PASSWORD FLOW */}
        {mode === 'forgot' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#A92224]" />
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr ? 'خدمة استعادة كلمة السر' : 'Password Recovery'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{isAr ? 'رجوع للدخول' : 'Back to Login'}</span>
              </button>
            </div>

            {forgotStep === 'email' ? (
              <form onSubmit={handleRequestResetCode} className="space-y-3.5">
                <p className="text-xs text-slate-600">
                  {isAr
                    ? 'أدخل بريدك الإلكتروني المسجل وسنرسل لك رمز استعادة مكونًا من 6 أرقام عبر Gmail لتعيين كلمة مرور جديدة.'
                    : 'Enter your registered email to receive a 6-digit password reset code.'}
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'البريد الإلكتروني المسجل' : 'Registered Email'}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      dir="ltr"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
                >
                  <Mail className="w-4 h-4" />
                  <span>
                    {loading
                      ? isAr
                        ? 'جاري إرسال الرمز...'
                        : 'Sending code...'
                      : isAr
                      ? 'إرسال رمز الاستعادة إلى Gmail'
                      : 'Send Reset Code'}
                  </span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleConfirmResetPassword} className="space-y-3.5">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs text-teal-900 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <span className="truncate">
                      {isAr ? `الرمز مرسل إلى: ${forgotEmail}` : `Code sent to ${forgotEmail}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForgotStep('email')}
                    className="text-[11px] font-bold text-teal-800 underline shrink-0"
                  >
                    {isAr ? 'تغيير البريد' : 'Change'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'رمز التحقق (6 أرقام)' : '6-Digit Code'}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={forgotCode}
                    onChange={(e) => setForgotCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="------"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-center text-xl tracking-[0.4em] font-mono-num font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'كلمة المرور الجديدة (6 أحرف على الأقل)' : 'New Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showForgotPass ? 'text' : 'password'}
                      dir="ltr"
                      required
                      minLength={6}
                      value={forgotNewPass}
                      onChange={(e) => setForgotNewPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full ps-10 pe-10 py-2.5 border border-slate-200 rounded-xl text-sm"
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                    <button
                      type="button"
                      onClick={() => setShowForgotPass((v) => !v)}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      {showForgotPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'}
                  </label>
                  <input
                    type={showForgotPass ? 'text' : 'password'}
                    dir="ltr"
                    required
                    minLength={6}
                    value={forgotConfirmPass}
                    onChange={(e) => setForgotConfirmPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {loading
                      ? isAr
                        ? 'جاري التحديث...'
                        : 'Updating...'
                      : isAr
                      ? 'حفظ كلمة المرور الجديدة والدخول'
                      : 'Save New Password & Sign In'}
                  </span>
                </button>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <span>{isAr ? 'لم يصلك الرمز؟' : "Didn't receive code?"}</span>
                  <button
                    type="button"
                    disabled={forgotResendIn > 0 || loading}
                    onClick={() => handleRequestResetCode()}
                    className="inline-flex items-center gap-1 font-bold text-orange-600 disabled:text-slate-400"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {forgotResendIn > 0
                        ? isAr
                          ? `إعادة الإرسال بعد ${forgotResendIn} ث`
                          : `Resend in ${forgotResendIn}s`
                        : isAr
                        ? 'إعادة إرسال الرمز'
                        : 'Resend Code'}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* 4. QUICK GMAIL OTP LOGIN (Preserved) */}
        {mode === 'otp' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2 pb-1">
              <span className="text-xs font-bold text-teal-800 inline-flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                <span>{isAr ? 'الدخول السريع برمز البريد (Gmail OTP)' : 'Quick Email OTP Login'}</span>
              </span>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-xs font-bold text-[#A92224] hover:underline"
              >
                {isAr ? 'دخول بكلمة المرور' : 'Use Password'}
              </button>
            </div>

            {otpStep === 'email' ? (
              <form onSubmit={handleRequestOtp} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isAr ? 'البريد الإلكتروني (Gmail)' : 'Email Address'}
                  </label>
                  <input
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    dir="ltr"
                    required
                    value={otpEmail}
                    onChange={(e) => setOtpEmail(e.target.value)}
                    placeholder="name@gmail.com"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={otpName}
                    onChange={(e) => setOtpName(e.target.value)}
                    placeholder={isAr ? 'الاسم (اختياري)' : 'Name (optional)'}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                  <input
                    type="tel"
                    dir="ltr"
                    value={otpPhone}
                    onChange={(e) => setOtpPhone(e.target.value)}
                    placeholder={isAr ? 'رقم الهاتف (اختياري)' : 'Phone (optional)'}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono-num"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
                >
                  <Mail className="w-4 h-4" />
                  <span>{loading ? (isAr ? 'جاري الإرسال...' : 'Sending...') : isAr ? 'إرسال رمز التأكيد إلى Gmail' : 'Send Code'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono-num text-slate-700" dir="ltr">{otpEmail}</span>
                  <button type="button" onClick={() => setOtpStep('email')} className="text-orange-600 font-bold">
                    {isAr ? 'تغيير البريد' : 'Change'}
                  </button>
                </div>
                <input
                  type="text"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="------"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-center text-xl tracking-[0.4em] font-mono-num font-bold"
                />
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{loading ? (isAr ? 'جاري التأكيد...' : 'Verifying...') : isAr ? 'تأكيد الرمز وتسجيل الدخول' : 'Verify & Sign In'}</span>
                </button>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{isAr ? 'لم تصلك الرسالة؟' : "Didn't receive?"}</span>
                  <button
                    type="button"
                    disabled={otpResendIn > 0 || loading}
                    onClick={() => handleRequestOtp()}
                    className="font-bold text-orange-600 disabled:text-slate-400"
                  >
                    {otpResendIn > 0
                      ? isAr
                        ? `إعادة الإرسال بعد ${otpResendIn} ث`
                        : `Resend in ${otpResendIn}s`
                      : isAr
                      ? 'إعادة إرسال الرمز'
                      : 'Resend'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* CONTINUE AS GUEST CARD */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-sm">
        <button
          type="button"
          disabled={loading}
          onClick={onContinueAsGuest}
          className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
        >
          <Compass className="w-4 h-4 text-amber-300" />
          <span>
            {openedFromGuest
              ? isAr
                ? 'العودة للتصفح كزائر'
                : 'Return to Guest Browsing'
              : isAr
              ? 'الدخول كزائر'
              : 'Continue as Guest'}
          </span>
        </button>
        <p className="text-[11px] text-slate-500 text-center">
          {isAr
            ? 'يمكنك تصفح المتاجر والعروض والمنتجات كزائر ثم تسجيل الدخول عند إتمام الطلب'
            : 'Browse stores, offers, and products as a guest, then sign in at checkout'}
        </p>
      </div>
    </div>
  );
};
