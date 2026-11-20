import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Pill,
  RefreshCw,
  ShieldCheck,
  Store,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import type { Language, MerchantRecord, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  merchants: MerchantRecord[];
  zones: ServiceZone[];
  onVerified: (user: MerchantRecord) => void;
  onRefreshCore: () => Promise<void>;
  onNotify: (msg: string) => void;
}

type AuthTab = 'login' | 'register';
type LoginMethod = 'password' | 'otp';

export const MerchantAuthPortal: React.FC<Props> = ({
  lang,
  merchants,
  zones,
  onVerified,
  onRefreshCore,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');

  // Password Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  // OTP Login state
  const [otpEmail, setOtpEmail] = useState('');
  const [otpStep, setOtpStep] = useState<'email' | 'code'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);

  // Full Registration state
  const [entityKind, setEntityKind] = useState<'store' | 'pharmacy'>('store');
  const [regEmail, setRegEmail] = useState('');
  const [regOtpSent, setRegOtpSent] = useState(false);
  const [regOtpCode, setRegOtpCode] = useState('');
  const [regOtpResendIn, setRegOtpResendIn] = useState(0);
  const [regOtpBusy, setRegOtpBusy] = useState(false);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);
  const [verifiedEmailValue, setVerifiedEmailValue] = useState<string | null>(null);
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);

  const [bizNameAr, setBizNameAr] = useState('');
  const [bizNameEn, setBizNameEn] = useState('');
  const [merchantType, setMerchantType] = useState('supermarket');
  const [branchName, setBranchName] = useState('');
  const [zoneName, setZoneName] = useState(zones[0]?.name_ar || 'وسط مدينة المنزلة');
  const [addressDetail, setAddressDetail] = useState('');
  const [storeLat, setStoreLat] = useState<number>(31.1583);
  const [storeLng, setStoreLng] = useState<number>(31.9369);
  const [gpsConfirmed, setGpsConfirmed] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [workingHours, setWorkingHours] = useState('09:00 ص - 12:00 م');
  const [supportsFreeOrder, setSupportsFreeOrder] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');

  const [ownerName, setOwnerName] = useState('');
  const [ownerNationalId, setOwnerNationalId] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [commercialRegNo, setCommercialRegNo] = useState('');
  const [licenseDocUrl, setLicenseDocUrl] = useState('');

  // Pharmacy specific
  const [pharmacyLicenseNo, setPharmacyLicenseNo] = useState('');
  const [pharmacistName, setPharmacistName] = useState('');
  const [syndicateNo, setSyndicateNo] = useState('');

  // Financial payout
  const [payoutMethod, setPayoutMethod] = useState('vodafone_cash');
  const [payoutAccount, setPayoutAccount] = useState('');

  // Terms & Conditions mandatory agreement
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (!zoneName && zones.length > 0) {
      setZoneName(zones[0].name_ar);
    }
  }, [zones, zoneName]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (regOtpResendIn <= 0) return;
    const t = setTimeout(() => setRegOtpResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [regOtpResendIn]);

  const isEmailVerified =
    Boolean(emailVerificationToken) &&
    Boolean(verifiedEmailValue) &&
    verifiedEmailValue === regEmail.trim().toLowerCase();

  const handleSendRegOtp = async () => {
    const cleanEmail = regEmail.trim().toLowerCase();
    if (!cleanEmail) {
      onNotify(isAr ? 'أدخل البريد الإلكتروني أولًا' : 'Enter email first');
      return;
    }
    setRegOtpBusy(true);
    try {
      const res = await api.requestMerchantRegOtp(cleanEmail);
      setRegOtpSent(true);
      setRegOtpCode('');
      setRegOtpResendIn(60);
      onNotify(`تم إرسال رمز التحقق المكون من 6 أرقام إلى بريدك على Gmail: ${res.email}`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setRegOtpBusy(false);
    }
  };

  const handleVerifyRegOtp = async () => {
    const cleanEmail = regEmail.trim().toLowerCase();
    if (regOtpCode.trim().length !== 6) {
      onNotify(isAr ? 'أدخل رمز التحقق المكون من 6 أرقام' : 'Enter 6-digit verification code');
      return;
    }
    setRegOtpBusy(true);
    try {
      const res = await api.verifyMerchantRegOtp(cleanEmail, regOtpCode.trim());
      setEmailVerificationToken(res.email_verification_token);
      setVerifiedEmailValue(res.email.toLowerCase());
      onNotify(isAr ? 'تم التحقق من البريد الإلكتروني بنجاح ✓' : 'Email verified ✓');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setRegOtpBusy(false);
    }
  };

  const handleDetectStoreGps = () => {
    if (!navigator.geolocation) {
      onNotify(isAr ? 'المتصفح لا يدعم GPS — اضغط مباشرة على الخريطة لتحديد الموقع' : 'Geolocation unsupported');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setStoreLat(lat);
        setStoreLng(lng);
        setGpsConfirmed(true);
        setLocatingGps(false);
        onNotify(isAr ? `تم التقاط موقع المتجر بالـ GPS (${lat.toFixed(4)}, ${lng.toFixed(4)}) ✓` : 'Store GPS captured');
      },
      () => {
        setLocatingGps(false);
        onNotify(isAr ? 'تعذر الوصول للـ GPS تلقائيًا — اضغط على الخريطة لتحديد موقع المتجر' : 'Tap map to pick location');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handleImageUpload =
    (setter: (url: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
          const maxW = 900;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            setter(canvas.toDataURL('image/jpeg', 0.8));
          } else {
            setter(raw);
          }
        };
        img.onerror = () => setter(raw);
        img.src = raw;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      onNotify(isAr ? 'أدخل البريد الإلكتروني وكلمة المرور' : 'Enter email and password');
      return;
    }
    setLoggingIn(true);
    try {
      const res = await api.loginMerchant(loginEmail.trim(), loginPassword);
      onNotify(
        isAr
          ? `مرحبًا بك في بوابة ${res.user.business_name_ar}`
          : `Welcome ${res.user.business_name_ar}`
      );
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!otpEmail.trim()) {
      onNotify(isAr ? 'أدخل البريد الإلكتروني أولًا' : 'Enter email first');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await api.requestEmailOtp(otpEmail.trim(), 'merchant');
      setOtpEmail(res.email);
      setOtpCode('');
      setOtpStep('code');
      setResendIn(60);
      onNotify(`تم إرسال رمز الدخول المكون من 6 أرقام إلى بريدك على Gmail: ${res.email}`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.trim().length !== 6) {
      onNotify(isAr ? 'أدخل الرمز المكون من 6 أرقام' : 'Enter 6-digit code');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await api.verifyEmailOtp(otpEmail.trim(), otpCode.trim(), 'merchant');
      onNotify(isAr ? 'تم تأكيد الدخول بنجاح' : 'Signed in successfully');
      onVerified(res.user);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailVerified || !emailVerificationToken) {
      onNotify(
        isAr
          ? 'يجب التحقق من البريد الإلكتروني أولًا عبر رمز التأكيد المرسل إليه'
          : 'Please verify your email via OTP code first'
      );
      return;
    }
    if (!gpsConfirmed) {
      onNotify(
        isAr
          ? 'يرجى تحديد موقع المتجر / الصيدلية على الخريطة أو بالضغط على زر GPS'
          : 'Please pick store location via GPS/Map'
      );
      return;
    }
    if (!termsAccepted) {
      onNotify(
        isAr
          ? 'يجب وضع علامة الموافقة على الاتفاقية أولًا — لا يمكن التسجيل بدون الموافقة'
          : 'You must agree to Agreement before registering'
      );
      return;
    }
    if (regPassword.length < 6) {
      onNotify(isAr ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      onNotify(isAr ? 'تأكيد كلمة المرور غير متطابق' : 'Passwords do not match');
      return;
    }
    if (!/^[0-9]{14}$/.test(ownerNationalId.trim())) {
      onNotify(isAr ? 'الرقم القومي للمالك يجب أن يكون 14 رقمًا' : 'National ID must be 14 digits');
      return;
    }

    const finalType = entityKind === 'pharmacy' ? 'pharmacy' : merchantType;
    if (finalType === 'pharmacy' && (!pharmacyLicenseNo.trim() || !pharmacistName.trim() || !syndicateNo.trim())) {
      onNotify(
        isAr
          ? 'للصيدليات: يجب إدخال رقم ترخيص الصيدلية واسم الصيدلي المدير ورقم قيد النقابة'
          : 'Pharmacy license, pharmacist name, and syndicate number are required'
      );
      return;
    }

    setRegistering(true);
    try {
      const res = await api.registerMerchant({
        email: regEmail.trim(),
        email_verification_token: emailVerificationToken,
        password: regPassword,
        business_name_ar: bizNameAr.trim(),
        business_name_en: bizNameEn.trim() || bizNameAr.trim(),
        merchant_type: finalType,
        branch_name: branchName.trim(),
        zone_name: zoneName,
        phone: phone.trim(),
        whatsapp_phone: whatsappPhone.trim() || phone.trim(),
        owner_name: ownerName.trim(),
        owner_national_id: ownerNationalId.trim(),
        address_detail: addressDetail.trim() || `GPS (${storeLat.toFixed(5)}, ${storeLng.toFixed(5)})`,
        lat: storeLat,
        lng: storeLng,
        commercial_reg_no: commercialRegNo.trim(),
        license_doc_url: licenseDocUrl,
        image_url: logoUrl,
        payout_method: payoutMethod,
        payout_account: payoutAccount.trim() || phone.trim(),
        working_hours: workingHours.trim(),
        supports_free_order: supportsFreeOrder,
        pharmacy_license_no: finalType === 'pharmacy' ? pharmacyLicenseNo.trim() : null,
        pharmacist_name: finalType === 'pharmacy' ? pharmacistName.trim() : null,
        syndicate_no: finalType === 'pharmacy' ? syndicateNo.trim() : null,
        terms_accepted: termsAccepted,
      });

      await onRefreshCore();
      onNotify(
        isAr
          ? `تم التحقق من البريد وتسجيل ${res.merchant.business_name_ar} بنجاح! لن يتم نشر متجرك على المنصة إلا بعد مراجعة وموافقة الإدارة.`
          : 'Merchant registered successfully and awaiting Admin approval before publishing.'
      );
      onVerified(res.merchant);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-5">
      {/* Brand Header */}
      <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] border-b-2 border-[#F5A623]/80 text-white rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <img
            src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
            alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
            className="w-14 h-14 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/70"
          />
          <div>
            <p className="text-xs text-amber-200 font-semibold">
              {isAr ? 'بوابة التجار والصيدليات المعتمدة · المنزلة' : 'Otlobha Merchant & Pharmacy Portal'}
            </p>
            <h2 className="text-xl font-bold mt-0.5">
              {authTab === 'login'
                ? isAr
                  ? 'تسجيل دخول التاجر والصيدلي'
                  : 'Merchant & Pharmacy Sign In'
                : isAr
                ? 'تسجيل وانضمام تاجر أو صيدلية جديدة'
                : 'New Merchant & Pharmacy Registration'}
            </h2>
          </div>
        </div>

        <div className="flex bg-black/20 p-1 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setAuthTab('login')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              authTab === 'login' ? 'bg-white text-[#A92224]' : 'text-white hover:bg-white/10'
            }`}
          >
            {isAr ? 'تسجيل الدخول' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => setAuthTab('register')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              authTab === 'register' ? 'bg-[#F5A623] text-slate-950' : 'text-white hover:bg-white/10'
            }`}
          >
            {isAr ? 'تسجيل حساب جديد' : 'Register Business'}
          </button>
        </div>
      </div>

      {/* LOGIN VIEW */}
      {authTab === 'login' && (
        <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setLoginMethod('password')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                loginMethod === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isAr ? 'البريد وكلمة المرور' : 'Email & Password'}</span>
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod('otp')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                loginMethod === 'otp' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{isAr ? 'رمز تأكيد البريد (OTP)' : 'Email OTP Code'}</span>
            </button>
          </div>

          {loginMethod === 'password' ? (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'البريد الإلكتروني أو اسم المستخدم' : 'Registered Email or Username'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="store@otlobha.eg أو admin"
                    className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'كلمة المرور' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    type={showLoginPw ? 'text' : 'password'}
                    dir="ltr"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full ps-10 pe-10 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPw(!showLoginPw)}
                    className="absolute inset-y-0 end-0 px-3 text-slate-400 hover:text-slate-700"
                  >
                    {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full py-3 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 min-h-[46px]"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{loggingIn ? (isAr ? 'جاري التحقق...' : 'Signing in...') : isAr ? 'دخول للوحة التاجر والصيدلي' : 'Sign In'}</span>
              </button>
            </form>
          ) : otpStep === 'email' ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'البريد الإلكتروني لإرسال رمز الدخول' : 'Merchant Email'}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    dir="ltr"
                    required
                    value={otpEmail}
                    onChange={(e) => setOtpEmail(e.target.value)}
                    placeholder="store@otlobha.eg"
                    className="w-full ps-10 pe-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <button
                type="submit"
                disabled={otpLoading}
                className="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 min-h-[46px]"
              >
                <Mail className="w-4 h-4" />
                <span>{otpLoading ? 'جاري الإرسال...' : isAr ? 'إرسال رمز التأكيد للبريد' : 'Send OTP'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs">
                  <p dir="ltr" className="font-bold text-slate-900 font-mono-num">{otpEmail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOtpStep('email');
                    setOtpCode('');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 rounded-lg text-xs text-slate-700"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تغيير البريد' : 'Change'}</span>
                </button>
              </div>

              <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center gap-2 text-xs text-teal-900">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>تم إرسال رمز التأكيد إلى بريدك على Gmail. يرجى إدخال الكود المكون من 6 أرقام.</span>
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
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-xl tracking-[0.4em] font-mono-num font-bold"
              />

              <button
                type="submit"
                disabled={otpLoading || otpCode.length !== 6}
                className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
              >
                {otpLoading ? 'جاري التحقق...' : 'تأكيد الرمز والدخول'}
              </button>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>لم يصلك الرمز؟</span>
                <button
                  type="button"
                  disabled={resendIn > 0 || otpLoading}
                  onClick={() => handleRequestOtp()}
                  className="inline-flex items-center gap-1 font-bold text-orange-600 disabled:text-slate-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ث` : 'إعادة إرسال الرمز'}</span>
                </button>
              </div>
            </form>
          )}

          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-orange-950">
              <p className="font-bold">{isAr ? 'لديك متجر أو صيدلية جديدة في المنزلة؟' : 'New store or pharmacy?'}</p>
              <p className="text-orange-800">
                {isAr ? 'سجّل بيانات نشاطك بالكامل وانضم لشبكة اطلبها الآن.' : 'Register your business to join Otlobha.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAuthTab('register')}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold whitespace-nowrap"
            >
              {isAr ? 'إنشاء حساب تاجر / صيدلي' : 'Register Now'}
            </button>
          </div>
        </div>
      )}

      {/* COMPREHENSIVE REGISTRATION VIEW */}
      {authTab === 'register' && (
        <form onSubmit={handleRegisterSubmit} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-6 shadow-sm">
          {/* Activity Kind Switch */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              {isAr ? '1. اختر نوع الحساب المطلوب تسجيله في المشروع:' : '1. Business Category:'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setEntityKind('store');
                  if (merchantType === 'pharmacy') setMerchantType('supermarket');
                }}
                className={`p-4 rounded-2xl border-2 text-start flex items-center gap-3 transition-all ${
                  entityKind === 'store'
                    ? 'border-[#A92224] bg-red-50/70'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${entityKind === 'store' ? 'bg-[#A92224] text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">تاجر / متجر / مطعم</p>
                  <p className="text-[11px] text-slate-500">سوبرماركت، مطعم، أسماك، مخبز، حلويات، محلات تجارية</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntityKind('pharmacy');
                  setMerchantType('pharmacy');
                }}
                className={`p-4 rounded-2xl border-2 text-start flex items-center gap-3 transition-all ${
                  entityKind === 'pharmacy'
                    ? 'border-teal-600 bg-teal-50/70'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${entityKind === 'pharmacy' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Pill className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">صيدلية معتمدة</p>
                  <p className="text-[11px] text-slate-500">صرف روشتات، أدوية، مستحضرات طبية (يتطلب ترخيص ونقابة)</p>
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: Login Credentials & Mandatory Email Verification */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <KeyRound className="w-4 h-4 text-[#A92224]" />
                <span>2. بيانات الدخول والتحقق من البريد الإلكتروني</span>
              </div>
              {isEmailVerified ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-100 text-teal-800 rounded-lg text-[11px] font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>تم التحقق من البريد الإلكتروني ✓</span>
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-700">
                  التحقق من البريد إلزامي لإتمام التسجيل
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-3 space-y-2">
                <label className="block font-semibold text-slate-700">البريد الإلكتروني والتحقق منه *</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    dir="ltr"
                    required
                    value={regEmail}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRegEmail(val);
                      if (verifiedEmailValue && val.trim().toLowerCase() !== verifiedEmailValue) {
                        setEmailVerificationToken(null);
                        setVerifiedEmailValue(null);
                        setRegOtpSent(false);
                      }
                    }}
                    placeholder="my-store@gmail.com"
                    className="flex-1 min-w-[220px] px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                  />
                  <button
                    type="button"
                    disabled={regOtpBusy || (regOtpSent && regOtpResendIn > 0 && !isEmailVerified)}
                    onClick={handleSendRegOtp}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>
                      {regOtpBusy
                        ? 'جاري الإرسال...'
                        : isEmailVerified
                        ? 'إعادة التحقق'
                        : regOtpSent && regOtpResendIn > 0
                        ? `إعادة الإرسال (${regOtpResendIn}ث)`
                        : 'إرسال رمز التحقق للبريد'}
                    </span>
                  </button>
                </div>

                {regOtpSent && !isEmailVerified && (
                  <div className="bg-white border border-orange-200 rounded-xl p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-700">
                        أدخل رمز التحقق المكون من 6 أرقام المرسل إلى بريدك على Gmail:{' '}
                        <strong dir="ltr" className="font-mono-num">{regEmail}</strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        dir="ltr"
                        value={regOtpCode}
                        onChange={(e) => setRegOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="w-40 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-center text-sm font-bold tracking-[0.25em] font-mono-num"
                      />
                      <button
                        type="button"
                        disabled={regOtpBusy || regOtpCode.length !== 6}
                        onClick={handleVerifyRegOtp}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold"
                      >
                        تأكيد رمز البريد
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">كلمة المرور (6+ أحرف) *</label>
                <div className="relative">
                  <input
                    type={showRegPw ? 'text' : 'password'}
                    dir="ltr"
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2.5 pe-9 bg-white border border-slate-200 rounded-xl font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPw(!showRegPw)}
                    className="absolute inset-y-0 end-0 px-2.5 text-slate-400"
                  >
                    {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">تأكيد كلمة المرور *</label>
                <input
                  type={showRegPw ? 'text' : 'password'}
                  dir="ltr"
                  required
                  minLength={6}
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Business Information & GPS Map Picker */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <Building2 className="w-4 h-4 text-orange-600" />
              <span>3. بيانات النشاط التجاري وتحديد الموقع بالـ GPS</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {entityKind === 'pharmacy' ? 'اسم الصيدلية بالعربية *' : 'اسم المتجر / المطعم بالعربية *'}
                </label>
                <input
                  type="text"
                  required
                  value={bizNameAr}
                  onChange={(e) => setBizNameAr(e.target.value)}
                  placeholder={entityKind === 'pharmacy' ? 'مثال: صيدلية الرحمة' : 'مثال: سوبرماركت الهدى'}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">الاسم بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  dir="ltr"
                  value={bizNameEn}
                  onChange={(e) => setBizNameEn(e.target.value)}
                  placeholder="Al-Hoda Market"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              {entityKind === 'store' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">تصنيف النشاط الدقيق *</label>
                  <select
                    value={merchantType}
                    onChange={(e) => setMerchantType(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                  >
                    <option value="supermarket">بقالة وسوبرماركت</option>
                    <option value="restaurant">مطعم ومأكولات</option>
                    <option value="fish_grill">أسماك ومشويات</option>
                    <option value="bakery">مخبوزات وحلويات</option>
                    <option value="vegetables_fruits">خضار وفاكهة</option>
                    <option value="butcher">جزارة ودواجن</option>
                    <option value="other">متجر تجاري آخر</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم الفرع *</label>
                <input
                  type="text"
                  required
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="مثال: فرع شارع بورسعيد"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">النطاق / المنطقة *</label>
                <select
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.name_ar}>
                      {z.name_ar}
                    </option>
                  ))}
                  {zones.length === 0 && <option value="وسط مدينة المنزلة">وسط مدينة المنزلة</option>}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">ساعات العمل اليومية *</label>
                <input
                  type="text"
                  required
                  value={workingHours}
                  onChange={(e) => setWorkingHours(e.target.value)}
                  placeholder="مثال: 09:00 ص - 12:00 م (أو 24 ساعة)"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                />
              </div>

              {/* Interactive GPS Store Pin Picker */}
              <div className="sm:col-span-2 lg:col-span-3 bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <MapPin className="w-4 h-4 text-orange-600 shrink-0" />
                    <span>تحديد موقع المتجر / الصيدلية عبر الـ GPS *</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {gpsConfirmed ? (
                      <span className="px-2.5 py-1 bg-teal-50 border border-teal-200 text-teal-800 rounded-lg text-[11px] font-bold font-mono-num" dir="ltr">
                        ✓ GPS: {storeLat.toFixed(5)}, {storeLng.toFixed(5)}
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-amber-700">
                        اضغط على الخريطة أو استخدم زر تحديد موقعي
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={locatingGps}
                      onClick={handleDetectStoreGps}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>{locatingGps ? 'جاري تحديد الموقع...' : 'تحديد موقعي الحالي بالـ GPS'}</span>
                    </button>
                  </div>
                </div>

                <GpsMapPicker
                  heightClass="h-56"
                  pickup={gpsConfirmed ? { lat: storeLat, lng: storeLng, label: 'موقع المتجر (GPS)' } : null}
                  pickTarget="store"
                  center={[storeLat, storeLng]}
                  onMapPick={(lat, lng) => {
                    setStoreLat(lat);
                    setStoreLng(lng);
                    setGpsConfirmed(true);
                  }}
                />

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">
                    وصف / علامة مميزة بجوار الموقع (اختياري)
                  </label>
                  <input
                    type="text"
                    value={addressDetail}
                    onChange={(e) => setAddressDetail(e.target.value)}
                    placeholder="اختياري: مثال الدور الأرضي بجوار مسجد..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supportsFreeOrder}
                  onChange={(e) => setSupportsFreeOrder(e.target.checked)}
                  className="w-4 h-4 accent-orange-600 rounded"
                />
                <span>استقبال الطلبات النصية الحرة (يكتب العميل طلباته غير المدرجة بالقائمة)</span>
              </label>

              <div className="flex items-center gap-2">
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt="Logo Preview"
                    className="w-10 h-10 rounded-full object-cover border border-orange-300 bg-white"
                  />
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold cursor-pointer text-slate-800">
                  <Camera className="w-4 h-4 text-orange-600" />
                  <span>{logoUrl ? 'تغيير صورة / شعار المتجر' : 'رفع صورة / شعار المتجر'}</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload(setLogoUrl)} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          {/* Section 4: Owner & Legal Info */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <UserCheck className="w-4 h-4 text-slate-800" />
              <span>4. بيانات المالك والتوثيق القانوني والتواصل</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم المالك / المدير المسؤول *</label>
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="الاسم الرباعي للمالك"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">الرقم القومي للمالك (14 رقم) *</label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  maxLength={14}
                  value={ownerNationalId}
                  onChange={(e) => setOwnerNationalId(e.target.value.replace(/[^0-9]/g, '').slice(0, 14))}
                  placeholder="29501011234567"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  <Phone className="w-3.5 h-3.5 inline me-1 text-slate-500" />
                  رقم الهاتف الأساسي للطلبات *
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">رقم واتساب / تواصل إضافي</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">رقم السجل التجاري / البطاقة الضريبية</label>
                <input
                  type="text"
                  dir="ltr"
                  value={commercialRegNo}
                  onChange={(e) => setCommercialRegNo(e.target.value)}
                  placeholder="مثال: CR-448120"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold cursor-pointer text-slate-800">
                  <FileCheck2 className="w-4 h-4 text-teal-600" />
                  <span>{licenseDocUrl ? 'تم إرفاق صورة الرخصة/السجل ✓' : 'إرفاق صورة الرخصة أو السجل التجاري'}</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload(setLicenseDocUrl)} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          {/* Section 5: Pharmacy Licenses (Shown when Pharmacy selected) */}
          {entityKind === 'pharmacy' && (
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-950">
                <Pill className="w-4 h-4 text-teal-700" />
                <span>5. التراخيص الصيدلانية الإلزامية (وفق اشتراطات وزارة الصحة)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-teal-900 mb-1">رقم ترخيص الصيدلية *</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={pharmacyLicenseNo}
                    onChange={(e) => setPharmacyLicenseNo(e.target.value)}
                    placeholder="PH-DK-55109"
                    className="w-full px-3 py-2.5 bg-white border border-teal-200 rounded-xl font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-teal-900 mb-1">اسم الصيدلي المدير المسؤول *</label>
                  <input
                    type="text"
                    required
                    value={pharmacistName}
                    onChange={(e) => setPharmacistName(e.target.value)}
                    placeholder="د. محمد أحمد علي"
                    className="w-full px-3 py-2.5 bg-white border border-teal-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-teal-900 mb-1">رقم قيد نقابة الصيادلة *</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={syndicateNo}
                    onChange={(e) => setSyndicateNo(e.target.value)}
                    placeholder="SYN-21450"
                    className="w-full px-3 py-2.5 bg-white border border-teal-200 rounded-xl font-mono-num"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Section 6: Payout Settings */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <Wallet className="w-4 h-4 text-amber-600" />
              <span>{entityKind === 'pharmacy' ? '6.' : '5.'} بيانات التسوية المالية واستلام الأرباح</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">طريقة استلام المستحقات *</label>
                <select
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                >
                  <option value="vodafone_cash">فودافون كاش (Vodafone Cash)</option>
                  <option value="instapay">إنستا باي (InstaPay)</option>
                  <option value="bank">تحويل بنكي (IBAN / حساب)</option>
                  <option value="cash">تسوية نقدية مباشرة بالمقر</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">رقم المحفظة / الحساب البنكي *</label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={payoutAccount}
                  onChange={(e) => setPayoutAccount(e.target.value)}
                  placeholder="01012345678 أو username@instapay"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
            </div>
          </div>

          {/* Mandatory Merchant Agreement Box */}
          <div
            className={`rounded-2xl border-2 p-4 space-y-3 transition-colors ${
              termsAccepted ? 'border-teal-500 bg-teal-50/50' : 'border-amber-400 bg-amber-50/70'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <FileText className="w-4 h-4 text-[#A92224] shrink-0" />
                <span>اتفاقية التعاون والانضمام للتجار والصيدليات — منصة «اطلبها»</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTermsModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>اقرأ الاتفاقية قبل الموافقة</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-700 bg-white/80 border border-slate-200/80 rounded-xl p-3 space-y-1 leading-relaxed">
              <p className="font-bold text-slate-900">ملخص قبل التوقيع:</p>
              <p>• عمولة المنصة 5% من قيمة الطلبات المكتملة قبل رسوم التوصيل وتُخصم بالتسويات الدورية.</p>
              <p>• لا يتم نشر التاجر أو الصيدلية أو متجره ومنتجاته للعملاء على المنصة إلا بعد مراجعة وموافقة الإدارة.</p>
            </div>

            <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="w-5 h-5 mt-0.5 accent-[#A92224] rounded shrink-0"
              />
              <span className="text-xs font-bold text-slate-900 leading-relaxed">
                أقر بأنني قرأت الاتفاقية كاملة وأوافق على كافة بنودها (المواد من الأولى إلى العاشرة)، وبمجرد الموافقة أكون قد وقعت على العقد، وأعلم أنه لن يتم نشر متجري على المنصة إلا بعد موافقة الإدارة.
              </span>
            </label>

            {!termsAccepted && (
              <p className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>تنبيه إلزامي: اضغط على «اقرأ الاتفاقية قبل الموافقة» ثم حدد علامة الموافقة لتفعيل زر التسجيل.</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAuthTab('login')}
              className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700"
            >
              لديك حساب بالفعل؟ تسجيل الدخول
            </button>

            <button
              type="submit"
              disabled={!termsAccepted || !isEmailVerified || !gpsConfirmed || registering}
              className="px-6 py-3 bg-[#A92224] hover:bg-[#8E1B1D] disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold flex items-center gap-2 min-h-[48px] transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {registering
                  ? 'جاري إنشاء الحساب...'
                  : entityKind === 'pharmacy'
                  ? 'إتمام تسجيل الصيدلية الآن'
                  : 'إتمام تسجيل التاجر الآن'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Full Merchant Agreement Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-l from-[#9E1C1E] to-[#C8431D] text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-bold">اتفاقية التعاون للتجار والصيدليات — منصة «اطلبها»</h3>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 font-semibold">
                ملاحظة هامة: لا يتم نشر حساب التاجر أو متجره أو منتجاته على منصة «اطلبها» للعملاء إلا بعد مراجعة البيانات والتراخيص وموافقة الإدارة.
              </div>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الأولى: موضوع الاتفاقية</h4>
                <p>
                  تهدف هذه الاتفاقية إلى تنظيم التعاون بين المنصة والتاجر، بحيث تتيح المنصة للتاجر عرض منتجاته وخدماته من خلال تطبيق «اطلبها»، واستقبال طلبات العملاء وإدارتها من خلال النظام الإلكتروني للمنصة.
                </p>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الثانية: عمولة المنصة</h4>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>يستحق تطبيق «اطلبها» عمولة بنسبة 5% (خمسة بالمائة) من قيمة كل طلب مكتمل يتم استقباله من خلال المنصة.</li>
                  <li>تُحسب العمولة على قيمة المنتجات أو الخدمات المباعة، قبل رسوم التوصيل، ما لم يتفق الطرفان كتابةً على خلاف ذلك.</li>
                  <li>تُستحق العمولة عند اكتمال الطلب وتسليمه للعميل.</li>
                  <li>لا تُحتسب عمولة على الطلبات الملغاة قبل إتمامها.</li>
                  <li>في حالة الاسترداد الجزئي، تُسوّى العمولة بما يتناسب مع القيمة النهائية للطلب.</li>
                  <li>تتم تسوية مستحقات المنصة والتاجر وفق دورة التسوية المتفق عليها بين الطرفين.</li>
                </ol>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الثالثة: التزامات التاجر</h4>
                <p className="font-semibold text-slate-800">يلتزم التاجر بما يلي:</p>
                <ul className="space-y-1 ps-2">
                  <li>1. تقديم منتجات أصلية وسليمة ومطابقة للمواصفات المعلنة.</li>
                  <li>2. الالتزام بالأسعار المتفق عليها والمعلنة داخل التطبيق.</li>
                  <li>3. تحديث المنتجات والأسعار والكميات بصورة مستمرة.</li>
                  <li>5. تجهيز الطلبات في الوقت المتفق عليه.</li>
                  <li>6. تحمل مسؤولية جودة المنتجات وصلاحيتها وسلامتها.</li>
                  <li>7. الالتزام بجميع التراخيص والاشتراطات النظامية الخاصة بنشاطه.</li>
                  <li>8. عدم التلاعب بالطلبات أو تسجيل عمليات وهمية أو التحايل على عمولة المنصة.</li>
                  <li>9. التعامل باحترافية مع العملاء والمحافظة على سمعة المنصة.</li>
                </ul>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الرابعة: التزامات المنصة</h4>
                <p className="font-semibold text-slate-800">تلتزم منصة «اطلبها» بما يلي:</p>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>توفير مساحة إلكترونية لعرض منتجات التاجر.</li>
                  <li>إتاحة استقبال الطلبات وإدارتها من خلال التطبيق.</li>
                  <li>توفير الدعم الفني المتعلق باستخدام المنصة.</li>
                  <li>عرض بيانات المنتجات والأسعار التي يقدمها التاجر وفق النظام.</li>
                  <li>إجراء التسويات المالية وفق الاتفاق.</li>
                  <li>المحافظة على سرية بيانات التاجر وعدم استخدامها خارج نطاق تقديم الخدمة، وفق الأنظمة المعمول بها.</li>
                </ol>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الخامسة: الطلبات والإلغاء والاسترجاع</h4>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>يتحمل التاجر مسؤولية أي خطأ ناتج عن عدم مطابقة المنتج للمواصفات المعلنة.</li>
                  <li>تُعالج طلبات الإلغاء والاسترجاع وفق سياسة المنصة والأنظمة المعمول بها.</li>
                  <li>في حالة وجود نقص أو تلف أو خطأ في تجهيز الطلب، يتحمل الطرف المسؤول عن الخطأ التكاليف المترتبة عليه وفق ما يثبت من الواقعة.</li>
                  <li>لا يجوز تحميل العميل أي رسوم غير معلنة مسبقًا.</li>
                </ol>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة السادسة: التسويات المالية</h4>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>يتم إعداد كشف دوري بالطلبات المكتملة وقيمة المبيعات والعمولات المستحقة.</li>
                  <li>تُخصم عمولة المنصة البالغة 5% من مستحقات التاجر.</li>
                  <li>يتم تحويل صافي المستحقات للتاجر وفق دورة التسوية المتفق عليها.</li>
                  <li>يحق لكل طرف مراجعة كشف الحساب والاعتراض على العمليات خلال مدة يتفق عليها الطرفان.</li>
                </ol>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة السابعة: مدة الاتفاقية وإنهاؤها</h4>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>تبدأ الاتفاقية من تاريخ توقيعها.</li>
                  <li>تكون مدة الاتفاقية سنة واحدة، وتتجدد تلقائيًا ما لم يخطر أحد الطرفين الآخر برغبته في عدم التجديد قبل 30 يومًا.</li>
                  <li>يجوز لأي طرف إنهاء الاتفاقية بإشعار كتابي مسبق مدته 30 يومًا.</li>
                  <li>يحق للمنصة تعليق حساب التاجر عند وجود مخالفة جسيمة أو احتيال أو تهديد لسلامة العملاء، مع إخطار التاجر وبيان أسباب الإجراء.</li>
                  <li>لا يعفي إنهاء الاتفاقية أي طرف من الالتزامات المالية السابقة على تاريخ الإنهاء.</li>
                </ol>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة الثامنة: السرية وحماية البيانات</h4>
                <p>
                  يلتزم الطرفان بالحفاظ على سرية البيانات التجارية وبيانات العملاء التي يطلعان عليها نتيجة التعاون، وعدم الإفصاح عنها أو استخدامها لغير أغراض تنفيذ الاتفاقية، وفق الأنظمة المعمول بها.
                </p>
              </section>

              <section className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900">المادة التاسعة: أحكام عامة</h4>
                <ol className="list-decimal ps-5 space-y-1">
                  <li>لا يجوز تعديل أي بند من بنود الاتفاقية إلا بموافقة كتابية من الطرفين.</li>
                  <li>لا يجوز للتاجر استخدام اسم أو شعار المنصة في إعلانات مستقلة دون موافقة المنصة.</li>
                  <li>لا تنشئ هذه الاتفاقية علاقة عمل أو شراكة في الملكية بين الطرفين.</li>
                  <li>تخضع الاتفاقية للأنظمة والقوانين المعمول بها، ويُختص القضاء المختص بالفصل في أي نزاع ينشأ عن تنفيذها أو تفسيرها.</li>
                </ol>
              </section>

              <section className="p-3.5 bg-slate-900 text-white rounded-xl space-y-1 text-center">
                <h4 className="font-bold text-sm text-amber-300">المادة العاشرة: التوقيعات</h4>
                <p className="font-bold">وبمجرد الموافقة فقد وقعت على العقد</p>
                <p className="text-slate-300">نتمنى تعاونا مفيد للطرفين</p>
              </section>
            </div>
            <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  setTermsAccepted(true);
                  setShowTermsModal(false);
                }}
                className="px-4 py-2 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl text-xs font-bold"
              >
                أوافق على الاتفاقية وأوقّع على العقد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
