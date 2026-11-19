import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  MapPin,
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

type AuthScreenMode = 'login' | 'register' | 'verify_link_sent' | 'forgot' | 'forgot_sent' | 'complete_profile';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

function GoogleGlyph() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.22 7.22 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.94 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1C6.23 6.87 8.88 4.76 12 4.76Z"
      />
    </svg>
  );
}

export const CustomerAuthPortal: React.FC<Props> = ({
  lang,
  openedFromGuest = false,
  onVerified,
  onContinueAsGuest,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [mode, setMode] = useState<AuthScreenMode>('login');
  const [loading, setLoading] = useState(false);

  // Google Web Client ID (loaded dynamically from backend)
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleReady, setGoogleReady] = useState<boolean>(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Manual registration (link-based, no OTP)
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPass, setRegConfirmPass] = useState('');
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirmPass, setShowRegConfirmPass] = useState(false);
  const [regResendIn, setRegResendIn] = useState(0);

  // Forgot password (link-based, no OTP)
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotResendIn, setForgotResendIn] = useState(0);

  // Onboarding / Complete Profile state (shown after Google Sign-In or first-time email verify)
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [profName, setProfName] = useState('');
  const [profAge, setProfAge] = useState('');
  const [profCountry, setProfCountry] = useState('مصر');
  const [profCity, setProfCity] = useState('المنزلة');
  const [profAddress, setProfAddress] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profSecondaryPhone, setProfSecondaryPhone] = useState('');
  const [profLat, setProfLat] = useState<number | undefined>(undefined);
  const [profLng, setProfLng] = useState<number | undefined>(undefined);
  const [locatingGps, setLocatingGps] = useState(false);

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

  const enterAuthenticatedUser = (user: any, needsCompletion?: boolean) => {
    const shouldComplete =
      typeof needsCompletion === 'boolean'
        ? needsCompletion
        : user?.needs_profile_completion === true ||
          user?.profile_completed === false ||
          !String(user?.phone || '').trim();

    if (shouldComplete) {
      setPendingUser(user);
      setProfName(String(user?.full_name || regName || ''));
      setProfAge(user?.age ? String(user.age) : '');
      setProfCountry(String(user?.country || 'مصر'));
      setProfCity(String(user?.city || 'المنزلة'));
      setProfAddress(String(user?.address_landmark || ''));
      setProfPhone(String(user?.phone || ''));
      setProfSecondaryPhone(String(user?.secondary_phone || ''));
      setMode('complete_profile');
      return;
    }
    onVerified(user);
  };

  // Load Google Web Client ID & GIS script
  useEffect(() => {
    let cancelled = false;
    api
      .getAuthPublicConfig()
      .then((cfg) => {
        if (!cancelled && cfg?.google_web_client_id) {
          setGoogleClientId(cfg.google_web_client_id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || (mode !== 'login' && mode !== 'register')) return;
    const handleCredentialResponse = async (response: { credential?: string }) => {
      const idToken = response?.credential;
      if (!idToken) {
        onNotify(isAr ? 'لم يتم استلام رمز جوجل، حاول مرة أخرى' : 'Google sign-in token missing');
        return;
      }
      setLoading(true);
      try {
        const res = await api.loginCustomerWithGoogle(idToken);
        onNotify(
          res.needs_profile_completion
            ? isAr
              ? 'تم الدخول عبر جوجل بنجاح — يرجى إكمال بياناتك الشخصية'
              : 'Signed in with Google — please complete your profile'
            : isAr
            ? 'أهلاً بك! تم تسجيل الدخول بحساب جوجل بنجاح'
            : 'Signed in with Google'
        );
        enterAuthenticatedUser(res.user, res.needs_profile_completion);
      } catch (err) {
        onNotify((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    const initGsi = () => {
      const gsi = window.google?.accounts?.id;
      if (!gsi) return;
      gsi.initialize({
        client_id: googleClientId,
        callback: handleCredentialResponse,
        auto_select: false,
      });
      if (googleBtnRef.current) {
        googleBtnRef.current.innerHTML = '';
        gsi.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          locale: isAr ? 'ar' : 'en',
          width: Math.min(380, googleBtnRef.current.offsetWidth || 340),
        });
      }
      setGoogleReady(true);
    };

    if (window.google?.accounts?.id) {
      initGsi();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-otlobha-gsi="1"]');
    if (existing) {
      existing.addEventListener('load', initGsi, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.otlobhaGsi = '1';
    script.onload = initGsi;
    document.head.appendChild(script);
  }, [googleClientId, mode, isAr]);

  const handleFallbackGoogleClick = () => {
    if (googleReady && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
      return;
    }
    onNotify(
      isAr
        ? 'زر تسجيل الدخول بجوجل جاهز بالكامل داخل تطبيق Android، وللمتصفح يلزم إضافة GOOGLE_WEB_CLIENT_ID في إعدادات الخادم.'
        : 'Google Sign-In is ready on Android; configure GOOGLE_WEB_CLIENT_ID for Web.'
    );
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawIdent = loginIdentifier.trim();
    if (!rawIdent || !loginPassword) {
      onNotify(isAr ? 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور' : 'Enter email/phone and password');
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
      enterAuthenticatedUser(res.user, res.user?.needs_profile_completion);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendVerificationLink = async (e?: React.FormEvent) => {
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
      const res = await api.sendCustomerVerificationLink({
        full_name: regName.trim(),
        email: cleanEmail,
        password: regPassword,
      });
      setRegEmail(res.email || cleanEmail);
      setRegResendIn(60);
      setMode('verify_link_sent');
      onNotify(
        res.message ||
          (isAr
            ? `تم إرسال رابط تأكيد الحساب إلى ${res.email || cleanEmail}`
            : `Verification link sent to ${res.email || cleanEmail}`)
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmailVerified = async () => {
    const cleanEmail = normalizeEmail(regEmail);
    if (!cleanEmail) return;
    setLoading(true);
    try {
      const res = await api.checkCustomerEmailVerified(cleanEmail, regPassword);
      if (res.verified && res.user) {
        onNotify(isAr ? 'تم تأكيد بريدك الإلكتروني بنجاح! أكمل بياناتك الآن.' : 'Email verified! Complete your profile.');
        enterAuthenticatedUser(res.user, res.needs_profile_completion);
      } else {
        onNotify(
          res.message ||
            (isAr
              ? 'لم يتم تأكيد البريد بعد. افتح رسالة Gmail واضغط على زر «تأكيد الحساب» ثم اضغط هنا.'
              : 'Email not yet confirmed. Click the verification link in your email first.')
        );
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = normalizeEmail(forgotEmail);
    if (!cleanEmail) {
      onNotify(isAr ? 'أدخل بريدك الإلكتروني المسجل بشكل صحيح' : 'Enter your registered email');
      return;
    }
    setLoading(true);
    try {
      const res = await api.sendCustomerPasswordResetLink(cleanEmail);
      setForgotEmail(res.email || cleanEmail);
      setForgotResendIn(60);
      setMode('forgot_sent');
      onNotify(
        res.message ||
          (isAr
            ? `تم إرسال رابط تغيير كلمة المرور إلى ${res.email || cleanEmail}`
            : `Password reset link sent to ${res.email || cleanEmail}`)
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      onNotify(isAr ? 'المتصفح لا يدعم تحديد الموقع تلقائيًا' : 'Geolocation not supported');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setProfLat(pos.coords.latitude);
        setProfLng(pos.coords.longitude);
        setLocatingGps(false);
        onNotify(isAr ? 'تم تحديد إحداثيات موقعك بنجاح ✓' : 'GPS location captured');
      },
      () => {
        setLocatingGps(false);
        onNotify(isAr ? 'تعذر تحديد الموقع تلقائيًا، يمكنك كتابة العنوان يدويًا' : 'Could not detect GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profName.trim().length < 2) {
      onNotify(isAr ? 'يرجى إدخال الاسم الكامل' : 'Enter your full name');
      return;
    }
    const parsedAge = Number(profAge);
    if (!profAge.trim() || !Number.isFinite(parsedAge) || parsedAge < 10 || parsedAge > 110) {
      onNotify(isAr ? 'يرجى إدخال السن بشكل صحيح (بين 10 و 110)' : 'Enter a valid age');
      return;
    }
    if (profCountry.trim().length < 2) {
      onNotify(isAr ? 'يرجى إدخال البلد' : 'Enter your country');
      return;
    }
    if (profAddress.trim().length < 3) {
      onNotify(isAr ? 'يرجى إدخال الموقع أو العنوان التفصيلي' : 'Enter your address/location');
      return;
    }
    const cleanPhone = profPhone.trim();
    if (cleanPhone.length < 8) {
      onNotify(isAr ? 'يرجى إدخال رقم هاتف صحيح' : 'Enter a valid primary phone');
      return;
    }
    setLoading(true);
    try {
      const res = await api.updateCustomerProfile({
        full_name: profName.trim(),
        age: Math.round(parsedAge),
        country: profCountry.trim(),
        city: profCity.trim() || 'المنزلة',
        address_landmark: profAddress.trim(),
        phone: cleanPhone,
        secondary_phone: profSecondaryPhone.trim(),
        last_lat: profLat,
        last_lng: profLng,
        profile_completed: true,
      });
      const finalUser = res.customer || {
        ...(pendingUser || {}),
        full_name: profName.trim(),
        age: Math.round(parsedAge),
        country: profCountry.trim(),
        city: profCity.trim() || 'المنزلة',
        address_landmark: profAddress.trim(),
        phone: cleanPhone,
        secondary_phone: profSecondaryPhone.trim(),
        profile_completed: true,
      };
      onNotify(isAr ? 'تم حفظ بياناتك بنجاح! مرحبًا بك في اطلبها.' : 'Profile saved! Welcome to Otlobha.');
      onVerified(finalUser);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== ONBOARDING / COMPLETE PROFILE SCREEN ====================
  if (mode === 'complete_profile') {
    return (
      <div className="max-w-xl mx-auto py-6 px-2">
        <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-[#9E1C1E] text-white px-6 py-5 border-b-2 border-[#F5A623]">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-amber-200" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  {isAr ? 'أكمل ملفك الشخصي للمتابعة' : 'Complete Your Profile'}
                </h2>
                <p className="text-xs text-rose-100 mt-0.5">
                  {isAr
                    ? 'بياناتك تساعدنا على توصيل طلباتك بدقة وسرعة في منطقتك'
                    : 'Your details help us deliver orders accurately to your location'}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleCompleteProfile} className="p-6 space-y-4">
            {/* Name & Age */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'الاسم الكامل *' : 'Full Name *'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={profName}
                    onChange={(e) => setProfName(e.target.value)}
                    placeholder={isAr ? 'اكتب اسمك الثلاثي' : 'Your full name'}
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'السن *' : 'Age *'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={10}
                    max={110}
                    required
                    value={profAge}
                    onChange={(e) => setProfAge(e.target.value)}
                    placeholder="25"
                    className="w-full ps-10 pe-3 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Calendar className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            {/* Country & City */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'البلد *' : 'Country *'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={profCountry}
                    onChange={(e) => setProfCountry(e.target.value)}
                    placeholder={isAr ? 'مصر' : 'Egypt'}
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <Globe className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'المدينة / المركز *' : 'City / Area *'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={profCity}
                    onChange={(e) => setProfCity(e.target.value)}
                    placeholder={isAr ? 'المنزلة - الدقهلية' : 'El Manzala'}
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <MapPin className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            {/* Location / Address + GPS button */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  {isAr ? 'الموقع والعنوان التفصيلي *' : 'Location & Detailed Address *'}
                </label>
                <button
                  type="button"
                  onClick={handleDetectGps}
                  disabled={locatingGps}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#0F766E] hover:underline"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>
                    {locatingGps
                      ? isAr
                        ? 'جاري تحديد موقعك...'
                        : 'Locating...'
                      : profLat
                      ? isAr
                        ? 'تم حفظ إحداثيات GPS ✓'
                        : 'GPS Saved ✓'
                      : isAr
                      ? 'تحديد موقعي الحالي GPS'
                      : 'Use Current GPS'}
                  </span>
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={profAddress}
                  onChange={(e) => setProfAddress(e.target.value)}
                  placeholder={isAr ? 'الشارع، رقم العمارة، أقرب معلم مميز' : 'Street, building, nearest landmark'}
                  className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                />
                <MapPin className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Primary Phone & Secondary Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'رقم الهاتف الأساسي *' : 'Primary Phone *'}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'رقم هاتف آخر (اختياري)' : 'Secondary Phone (Optional)'}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    dir="ltr"
                    value={profSecondaryPhone}
                    onChange={(e) => setProfSecondaryPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {loading
                  ? isAr
                    ? 'جاري حفظ بياناتك...'
                    : 'Saving profile...'
                  : isAr
                  ? 'حفظ البيانات والدخول إلى اطلبها'
                  : 'Save & Enter Otlobha'}
              </span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==================== MAIN AUTH EXPERIENCE ====================
  return (
    <div className="max-w-md mx-auto py-6 px-2 space-y-4">
      {/* Clean Brand Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] text-white px-6 py-5 border-b-2 border-[#F5A623]">
          <div className="flex items-center gap-4">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
              className="w-14 h-14 rounded-xl bg-white object-contain p-1 shrink-0 shadow-sm"
            />
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold tracking-tight leading-tight">
                {mode === 'register' || mode === 'verify_link_sent'
                  ? isAr
                    ? 'إنشاء حساب جديد'
                    : 'Create Account'
                  : mode === 'forgot' || mode === 'forgot_sent'
                  ? isAr
                    ? 'استعادة كلمة المرور'
                    : 'Reset Password'
                  : isAr
                  ? 'أهلاً بك في اطلبها'
                  : 'Welcome to Otlobha'}
              </h2>
              <p className="text-xs text-amber-100/95 mt-1">
                {isAr
                  ? 'توصيل الطلبات، الصيدليات، والمشاوير في المنزلة'
                  : 'Food, pharmacy & rides across El Manzala'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Mode Tabs (Login / Register) */}
          {(mode === 'login' || mode === 'register') && (
            <>
              {/* PRIMARY GOOGLE SIGN-IN SECTION */}
              <div className="space-y-3">
                {googleClientId ? (
                  <div className="flex flex-col items-center">
                    <div ref={googleBtnRef} className="w-full flex justify-center min-h-[46px]" />
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleFallbackGoogleClick}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 min-h-[50px] transition shadow-xs"
                  >
                    <GoogleGlyph />
                    <span>
                      {isAr ? 'المتابعة السريعة باستخدام حساب جوجل' : 'Continue with Google'}
                    </span>
                  </button>
                )}

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="shrink mx-3 text-xs font-semibold text-slate-400">
                    {isAr ? 'أو بالبريد الإلكتروني' : 'or with email'}
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>
              </div>

              {/* Clean Segmented Switcher */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 min-h-[44px] ${
                    mode === 'login'
                      ? 'bg-white text-[#A92224] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 min-h-[44px] ${
                    mode === 'register'
                      ? 'bg-white text-[#A92224] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isAr ? 'حساب جديد' : 'Sign Up'}</span>
                </button>
              </div>
            </>
          )}

          {/* 1. LOGIN FORM */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
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
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    {isAr ? 'كلمة المرور' : 'Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (loginIdentifier.includes('@') && !forgotEmail) {
                        setForgotEmail(loginIdentifier.trim());
                      }
                      setMode('forgot');
                    }}
                    className="text-xs font-bold text-[#A92224] hover:underline"
                  >
                    {isAr ? 'هل نسيت كلمة المرور؟' : 'Forgot password?'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showLoginPass ? 'text' : 'password'}
                    dir="ltr"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full ps-10 pe-11 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPass((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                    aria-label="Toggle password visibility"
                  >
                    {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {loading
                    ? isAr
                      ? 'جاري تسجيل الدخول...'
                      : 'Signing in...'
                    : isAr
                    ? 'تسجيل الدخول'
                    : 'Sign In'}
                </span>
              </button>
            </form>
          )}

          {/* 2. MANUAL EMAIL REGISTRATION (LINK-BASED — NO OTP CODE) */}
          {mode === 'register' && (
            <form onSubmit={handleSendVerificationLink} className="space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                {isAr
                  ? 'سنرسل لك رابط تأكيد مباشر إلى بريدك الإلكتروني (بدون كود). بمجرد الضغط على الرابط يتم تفعيل حسابك فورًا.'
                  : 'We will send a clickable confirmation link to your email (no code required).'}
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'الاسم الكامل' : 'Full Name'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder={isAr ? 'أدخل اسمك الكامل' : 'Enter full name'}
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'البريد الإلكتروني (Gmail)' : 'Email Address'}
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
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
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
                    className="w-full ps-10 pe-11 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowRegPass((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                  >
                    {showRegPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
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
                    className="w-full ps-10 pe-11 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm min-h-[48px]"
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowRegConfirmPass((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                  >
                    {showRegConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
              >
                <Mail className="w-4 h-4" />
                <span>
                  {loading
                    ? isAr
                      ? 'جاري إرسال رابط التأكيد...'
                      : 'Sending verification link...'
                    : isAr
                    ? 'إرسال رابط تأكيد الحساب إلى البريد'
                    : 'Send Verification Link'}
                </span>
              </button>
            </form>
          )}

          {/* 2B. VERIFICATION LINK SENT WAITING SCREEN */}
          {mode === 'verify_link_sent' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto">
                <Mail className="w-8 h-8 text-teal-700" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900">
                  {isAr ? 'تم إرسال رابط تأكيد حسابك!' : 'Verification Link Sent!'}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {isAr
                    ? 'افتح بريدك الإلكتروني واضغط على زر «تأكيد الحساب وتفعيله الآن»، ثم عد هنا واضغط متابعة:'
                    : 'Open your inbox, click the verification link, then return here and press Continue:'}
                </p>
                <p className="text-xs font-bold font-mono-num text-slate-900 bg-slate-100 rounded-lg py-1.5 px-3 inline-block" dir="ltr">
                  {regEmail}
                </p>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleCheckEmailVerified}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>
                  {loading
                    ? isAr
                      ? 'جاري التحقق من التأكيد...'
                      : 'Checking verification...'
                    : isAr
                    ? 'تم التأكيد في البريد — متابعة'
                    : 'I Clicked the Link — Continue'}
                </span>
              </button>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <button
                  type="button"
                  disabled={loading || regResendIn > 0}
                  onClick={() => handleSendVerificationLink()}
                  className="inline-flex items-center gap-1.5 font-bold text-[#A92224] disabled:text-slate-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>
                    {regResendIn > 0
                      ? isAr
                        ? `إعادة الإرسال بعد ${regResendIn} ث`
                        : `Resend in ${regResendIn}s`
                      : isAr
                      ? 'إعادة إرسال الرابط'
                      : 'Resend link'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setMode('register')}
                  className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تعديل البريد' : 'Edit email'}</span>
                </button>
              </div>
            </div>
          )}

          {/* 3. FORGOT PASSWORD (LINK-BASED — NO OTP CODE) */}
          {mode === 'forgot' && (
            <form onSubmit={handleSendResetLink} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#A92224]" />
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {isAr ? 'تغيير كلمة المرور عبر البريد' : 'Reset Password via Email'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>{isAr ? 'رجوع' : 'Back'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                {isAr
                  ? 'أدخل بريدك الإلكتروني المسجل وسنرسل لك رابطًا مباشرًا على Gmail، عند الضغط عليه يمكنك كتابة كلمة مرور جديدة فورًا.'
                  : 'Enter your registered email and we will send you a direct password reset link.'}
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
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
                    className="w-full ps-10 pe-3.5 py-3 border border-slate-300 focus:border-[#A92224] focus:outline-none rounded-xl text-sm font-mono-num min-h-[48px]"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
              >
                <Mail className="w-4 h-4" />
                <span>
                  {loading
                    ? isAr
                      ? 'جاري إرسال الرابط...'
                      : 'Sending reset link...'
                    : isAr
                    ? 'إرسال رابط تغيير كلمة المرور إلى Gmail'
                    : 'Send Password Reset Link'}
                </span>
              </button>
            </form>
          )}

          {/* 3B. FORGOT LINK SENT SCREEN */}
          {mode === 'forgot_sent' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-8 h-8 text-[#A92224]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900">
                  {isAr ? 'تم إرسال رابط تغيير كلمة المرور!' : 'Password Reset Link Sent!'}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {isAr
                    ? 'افتح رسالة اطلبها في بريدك الإلكتروني واضغط على زر «تغيير كلمة المرور الآن» لإدخال كلمة المرور الجديدة، ثم عد لتسجيل الدخول.'
                    : 'Open the email from Otlobha and click the reset button to set your new password, then return here to sign in.'}
                </p>
                <p className="text-xs font-bold font-mono-num text-slate-900 bg-slate-100 rounded-lg py-1.5 px-3 inline-block" dir="ltr">
                  {forgotEmail}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setLoginIdentifier(forgotEmail);
                  setMode('login');
                }}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl text-sm font-extrabold min-h-[50px] transition"
              >
                <LogIn className="w-4 h-4" />
                <span>{isAr ? 'العودة لتسجيل الدخول بكلمة المرور الجديدة' : 'Back to Sign In'}</span>
              </button>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <button
                  type="button"
                  disabled={loading || forgotResendIn > 0}
                  onClick={() => handleSendResetLink()}
                  className="inline-flex items-center gap-1.5 font-bold text-[#A92224] disabled:text-slate-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>
                    {forgotResendIn > 0
                      ? isAr
                        ? `إعادة الإرسال بعد ${forgotResendIn} ث`
                        : `Resend in ${forgotResendIn}s`
                      : isAr
                      ? 'إعادة إرسال الرابط'
                      : 'Resend link'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="font-semibold text-slate-600 hover:text-slate-900"
                >
                  {isAr ? 'تغيير البريد' : 'Change email'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Continue as Guest */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <button
          type="button"
          disabled={loading}
          onClick={onContinueAsGuest}
          className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[48px] transition"
        >
          <Compass className="w-4 h-4 text-amber-300" />
          <span>
            {openedFromGuest
              ? isAr
                ? 'العودة للتصفح كزائر'
                : 'Return to Guest Browsing'
              : isAr
              ? 'التصفح كزائر بدون تسجيل'
              : 'Browse as Guest'}
          </span>
        </button>
      </div>
    </div>
  );
};
