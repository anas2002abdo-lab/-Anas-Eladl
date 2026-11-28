import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Coffee,
  Copy,
  FileCheck2,
  FileText,
  KeyRound,
  MapPin,
  Navigation,
  Pill,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  UtensilsCrossed,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import {
  MERCHANT_ACTIVITY_REGISTRY,
  ONBOARDING_STATUS_META,
  type MerchantActivityCategory,
  type OnboardingApplicationStatus,
} from '../shared/merchantActivities.ts';
import type { Language, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  zones: ServiceZone[];
  initialMode?: 'apply' | 'track';
  onBackToLogin: () => void;
  onNotify: (msg: string) => void;
}

const DRAFT_STORAGE_KEY = 'otlobha_merchant_onboarding_saved_draft_v1';

interface SavedDraftRef {
  application_number: string;
  applicant_secret: string;
  business_name_ar?: string;
  updated_at?: string;
}

function readSavedDraftRef(): SavedDraftRef | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDraftRef;
    if (parsed?.application_number && parsed?.applicant_secret) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeSavedDraftRef(ref: SavedDraftRef | null): void {
  try {
    if (!ref) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } else {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(ref));
    }
  } catch {
    // ignore storage errors
  }
}

const ACTIVITY_ICONS: Record<MerchantActivityCategory, React.ComponentType<{ className?: string }>> = {
  store: Store,
  restaurant_cafe: UtensilsCrossed,
  pharmacy: Pill,
  other: Briefcase,
};

const STATUS_BADGE_CLS: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  orange: 'bg-orange-50 text-orange-800 border-orange-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export const MerchantJoinWizard: React.FC<Props> = ({
  lang,
  zones,
  initialMode = 'apply',
  onBackToLogin,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [mode, setMode] = useState<'apply' | 'track'>(initialMode);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Active Draft / Application reference
  const [savedDraftRef, setSavedDraftRef] = useState<SavedDraftRef | null>(() => readSavedDraftRef());
  const [appNumber, setAppNumber] = useState<string>('');
  const [appSecret, setAppSecret] = useState<string>('');
  const [appStatus, setAppStatus] = useState<OnboardingApplicationStatus>('draft');
  const [submittedReceipt, setSubmittedReceipt] = useState<any | null>(null);
  const [adminReviewNote, setAdminReviewNote] = useState<string>('');
  const [requestedChanges, setRequestedChanges] = useState<string[]>([]);

  // Form fields
  const [activityCategory, setActivityCategory] = useState<MerchantActivityCategory>('store');
  const [merchantType, setMerchantType] = useState<string>('supermarket');
  const [customActivityLabel, setCustomActivityLabel] = useState<string>('');
  const [businessNameAr, setBusinessNameAr] = useState<string>('');
  const [businessNameEn, setBusinessNameEn] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('');
  const [zoneName, setZoneName] = useState<string>(zones[0]?.name_ar || 'وسط مدينة المنزلة');
  const [addressDetail, setAddressDetail] = useState<string>('');
  const [lat, setLat] = useState<number>(31.1583);
  const [lng, setLng] = useState<number>(31.9369);
  const [gpsConfirmed, setGpsConfirmed] = useState<boolean>(false);
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [workingHours, setWorkingHours] = useState<string>('09:00 ص - 12:00 م');
  const [descriptionAr, setDescriptionAr] = useState<string>('');

  const [ownerName, setOwnerName] = useState<string>('');
  const [ownerNationalId, setOwnerNationalId] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [hasServerPassword, setHasServerPassword] = useState<boolean>(false);

  const [commercialRegNo, setCommercialRegNo] = useState<string>('');
  const [taxCardNo, setTaxCardNo] = useState<string>('');
  const [payoutMethod, setPayoutMethod] = useState<string>('vodafone_cash');
  const [payoutAccount, setPayoutAccount] = useState<string>('');
  const [supportsFreeOrder, setSupportsFreeOrder] = useState<boolean>(true);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  // Activity-specific details
  const [cuisineType, setCuisineType] = useState<string>('');
  const [avgPrepMinutes, setAvgPrepMinutes] = useState<number>(20);
  const [healthCertNo, setHealthCertNo] = useState<string>('');
  const [pharmacyLicenseNo, setPharmacyLicenseNo] = useState<string>('');
  const [pharmacistName, setPharmacistName] = useState<string>('');
  const [syndicateNo, setSyndicateNo] = useState<string>('');
  const [supportsPrescriptions, setSupportsPrescriptions] = useState<boolean>(true);
  const [hasExcelCatalog, setHasExcelCatalog] = useState<boolean>(false);
  const [supportsWeightedItems, setSupportsWeightedItems] = useState<boolean>(true);

  // Uploaded documents metadata
  const [documents, setDocuments] = useState<Array<any>>([]);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadingDraft, setLoadingDraft] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // Status Tracker state
  const [trackAppNo, setTrackAppNo] = useState<string>('');
  const [trackContact, setTrackContact] = useState<string>('');
  const [trackSecret, setTrackSecret] = useState<string>('');
  const [trackingBusy, setTrackingBusy] = useState<boolean>(false);
  const [trackedApp, setTrackedApp] = useState<any | null>(null);

  const activeProfile = useMemo(
    () => MERCHANT_ACTIVITY_REGISTRY[activityCategory],
    [activityCategory]
  );

  useEffect(() => {
    if (!zoneName && zones.length > 0) {
      setZoneName(zones[0].name_ar);
    }
  }, [zones, zoneName]);

  const hydrateFromApplication = (app: any, secretToKeep?: string) => {
    const cat = (app.activity_category || 'store') as MerchantActivityCategory;
    setAppNumber(String(app.application_number || ''));
    if (secretToKeep) setAppSecret(secretToKeep);
    setAppStatus((app.status || 'draft') as OnboardingApplicationStatus);
    setActivityCategory(cat);
    setMerchantType(String(app.merchant_type || MERCHANT_ACTIVITY_REGISTRY[cat].default_merchant_type));
    setCustomActivityLabel(String(app.custom_activity_label || ''));
    setBusinessNameAr(String(app.business_name_ar || ''));
    setBusinessNameEn(String(app.business_name_en || ''));
    setBranchName(String(app.branch_name || ''));
    setZoneName(String(app.zone_name || zones[0]?.name_ar || 'وسط مدينة المنزلة'));
    setAddressDetail(String(app.address_detail || ''));
    if (app.lat != null && app.lng != null) {
      setLat(Number(app.lat));
      setLng(Number(app.lng));
      setGpsConfirmed(true);
    }
    setWorkingHours(String(app.working_hours || '09:00 ص - 12:00 م'));
    setDescriptionAr(String(app.description_ar || ''));
    setOwnerName(String(app.owner_name || ''));
    setOwnerNationalId(String(app.owner_national_id || ''));
    setPhone(String(app.phone || ''));
    setWhatsappPhone(String(app.whatsapp_phone || ''));
    setEmail(String(app.email || ''));
    setHasServerPassword(Boolean(app.has_password));
    setCommercialRegNo(String(app.commercial_reg_no || ''));
    setTaxCardNo(String(app.tax_card_no || ''));
    setPayoutMethod(String(app.payout_method || 'vodafone_cash'));
    setPayoutAccount(String(app.payout_account || ''));
    setSupportsFreeOrder(app.supports_free_order !== false);
    setTermsAccepted(Boolean(app.terms_accepted));
    setAdminReviewNote(String(app.review_note || ''));
    setRequestedChanges(Array.isArray(app.requested_changes) ? app.requested_changes : []);

    const details = (app.activity_details || {}) as Record<string, any>;
    setCuisineType(String(details.cuisine_type || ''));
    setAvgPrepMinutes(Number(details.avg_prep_minutes || 20));
    setHealthCertNo(String(details.health_cert_no || ''));
    setPharmacyLicenseNo(String(details.pharmacy_license_no || ''));
    setPharmacistName(String(details.pharmacist_name || ''));
    setSyndicateNo(String(details.syndicate_no || ''));
    setSupportsPrescriptions(details.supports_prescriptions !== false);
    setHasExcelCatalog(Boolean(details.has_excel_catalog));
    setSupportsWeightedItems(details.supports_weighted_items !== false);
    setDocuments(Array.isArray(app.documents) ? app.documents : []);
  };

  const buildPayload = () => {
    const activityDetails: Record<string, unknown> =
      activityCategory === 'restaurant_cafe'
        ? {
            cuisine_type: cuisineType.trim(),
            avg_prep_minutes: avgPrepMinutes,
            health_cert_no: healthCertNo.trim(),
          }
        : activityCategory === 'pharmacy'
        ? {
            pharmacy_license_no: pharmacyLicenseNo.trim(),
            pharmacist_name: pharmacistName.trim(),
            syndicate_no: syndicateNo.trim(),
            supports_prescriptions: supportsPrescriptions,
          }
        : {
            has_excel_catalog: hasExcelCatalog,
            supports_weighted_items: supportsWeightedItems,
          };

    return {
      activity_category: activityCategory,
      merchant_type: merchantType,
      custom_activity_label: customActivityLabel.trim(),
      business_name_ar: businessNameAr.trim(),
      business_name_en: businessNameEn.trim(),
      branch_name: branchName.trim(),
      zone_name: zoneName,
      address_detail: addressDetail.trim(),
      lat: gpsConfirmed ? lat : null,
      lng: gpsConfirmed ? lng : null,
      working_hours: workingHours.trim(),
      description_ar: descriptionAr.trim(),
      owner_name: ownerName.trim(),
      owner_national_id: ownerNationalId.trim(),
      phone: phone.trim(),
      whatsapp_phone: whatsappPhone.trim() || phone.trim(),
      email: email.trim().toLowerCase(),
      ...(password.length >= 6 ? { password } : {}),
      commercial_reg_no: commercialRegNo.trim(),
      tax_card_no: taxCardNo.trim(),
      payout_method: payoutMethod,
      payout_account: payoutAccount.trim() || phone.trim(),
      supports_free_order: supportsFreeOrder,
      activity_details: activityDetails,
      terms_accepted: termsAccepted,
    };
  };

  const ensureDraftExists = async (): Promise<{ number: string; secret: string }> => {
    if (appNumber && appSecret) {
      await api.updateMerchantOnboardingApplication(appNumber, buildPayload(), appSecret);
      const ref: SavedDraftRef = {
        application_number: appNumber,
        applicant_secret: appSecret,
        business_name_ar: businessNameAr.trim(),
        updated_at: new Date().toISOString(),
      };
      writeSavedDraftRef(ref);
      setSavedDraftRef(ref);
      return { number: appNumber, secret: appSecret };
    }
    const created = await api.createMerchantOnboardingDraft(buildPayload());
    setAppNumber(created.application_number);
    setAppSecret(created.applicant_secret);
    setAppStatus((created.application?.status || 'draft') as OnboardingApplicationStatus);
    if (password.length >= 6) setHasServerPassword(true);
    const ref: SavedDraftRef = {
      application_number: created.application_number,
      applicant_secret: created.applicant_secret,
      business_name_ar: businessNameAr.trim(),
      updated_at: new Date().toISOString(),
    };
    writeSavedDraftRef(ref);
    setSavedDraftRef(ref);
    return { number: created.application_number, secret: created.applicant_secret };
  };

  const handleSaveDraft = async () => {
    setFormErrors([]);
    if (password && password.length < 6) {
      onNotify('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (password && confirmPassword && password !== confirmPassword) {
      onNotify('تأكيد كلمة المرور غير متطابق');
      return;
    }
    setSavingDraft(true);
    try {
      const ref = await ensureDraftExists();
      onNotify(`تم حفظ المسودة بنجاح برقم ${ref.number} — يمكنك استكمالها في أي وقت.`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleResumeDraft = async (numberToLoad: string, secretToLoad: string) => {
    setLoadingDraft(true);
    setFormErrors([]);
    try {
      const res = await api.getMerchantOnboardingApplication(numberToLoad.trim(), secretToLoad.trim());
      hydrateFromApplication(res.application, secretToLoad.trim());
      setMode('apply');
      if (res.application.status === 'draft' || res.application.status === 'needs_completion') {
        setSubmittedReceipt(null);
        setStep(2);
        onNotify(`تم استعادة الطلب #${res.application.application_number} بنجاح`);
      } else {
        setSubmittedReceipt(res.application);
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleUploadDocument =
    (docType: string, docLabelAr: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        onNotify('حجم الملف يتجاوز 5 ميجابايت — اختر صورة أو ملفًا أصغر');
        return;
      }

      setUploadingDocType(docType);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
          reader.onload = () => {
            const raw = String(reader.result || '');
            if (file.type === 'application/pdf') {
              resolve(raw);
              return;
            }
            const img = new Image();
            img.onload = () => {
              const maxW = 1280;
              const scale = img.width > maxW ? maxW / img.width : 1;
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
              } else {
                resolve(raw);
              }
            };
            img.onerror = () => resolve(raw);
            img.src = raw;
          };
          reader.readAsDataURL(file);
        });

        const ref = await ensureDraftExists();
        const uploaded = await api.uploadMerchantOnboardingDocument(
          ref.number,
          {
            doc_type: docType,
            doc_label_ar: docLabelAr,
            file_name: file.name,
            data_url: dataUrl,
          },
          ref.secret
        );
        setDocuments((prev) => [uploaded.document, ...prev.filter((d) => d.doc_type !== docType)]);
        onNotify(`تم إرفاق «${docLabelAr}» وحفظه بشكل آمن ✓`);
      } catch (err) {
        onNotify((err as Error).message);
      } finally {
        setUploadingDocType(null);
      }
    };

  const handleDeleteDocument = async (docId: string) => {
    if (!appNumber || !appSecret) return;
    try {
      await api.deleteMerchantOnboardingDocument(appNumber, docId, appSecret);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      onNotify('تم حذف المستند من المسودة');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      onNotify('المتصفح لا يدعم GPS — اضغط على الخريطة لتحديد الموقع');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setGpsConfirmed(true);
        setLocatingGps(false);
        onNotify('تم التقاط موقع المنشأة عبر GPS بنجاح ✓');
      },
      () => {
        setLocatingGps(false);
        onNotify('تعذر الوصول للـ GPS تلقائيًا — اضغط مباشرة على الخريطة');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handleSubmitFinal = async () => {
    setFormErrors([]);
    if (!hasServerPassword && password.length < 6) {
      setFormErrors(['يرجى تعيين كلمة مرور لا تقل عن 6 أحرف للحساب']);
      return;
    }
    if (password && password !== confirmPassword) {
      setFormErrors(['كلمة المرور وتأكيد كلمة المرور غير متطابقين']);
      return;
    }
    setSubmitting(true);
    try {
      const ref = await ensureDraftExists();
      const res = await api.submitMerchantOnboardingApplication(ref.number, ref.secret);
      setSubmittedReceipt(res.application);
      setAppStatus(res.application.status);
      onNotify(res.message);
    } catch (err: any) {
      const msg = err?.message || 'تعذر إرسال الطلب، يرجى مراجعة البيانات المطلوبة';
      setFormErrors([msg]);
      onNotify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackAppNo.trim() || !trackContact.trim()) {
      onNotify('أدخل رقم الطلب ورقم الهاتف أو البريد الإلكتروني');
      return;
    }
    setTrackingBusy(true);
    setTrackedApp(null);
    try {
      const isEmailVal = trackContact.includes('@');
      const res = await api.checkMerchantOnboardingStatus({
        application_number: trackAppNo.trim(),
        ...(isEmailVal ? { email: trackContact.trim() } : { phone: trackContact.trim() }),
      });
      setTrackedApp(res.application);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setTrackingBusy(false);
    }
  };

  const copyText = (val: string, label: string) => {
    try {
      navigator.clipboard?.writeText(val);
      onNotify(`تم نسخ ${label}`);
    } catch {
      onNotify(val);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Top Mode Switch: New Application vs Track/Resume */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('apply');
              setSubmittedReceipt(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'apply'
                ? 'bg-[#A92224] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            طلب انضمام جديد
          </button>
          <button
            type="button"
            onClick={() => setMode('track')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'track'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            متابعة / استكمال طلب سابق
          </button>
        </div>

        <div className="flex items-center gap-2">
          {savedDraftRef && mode === 'apply' && !appNumber && (
            <button
              type="button"
              disabled={loadingDraft}
              onClick={() => void handleResumeDraft(savedDraftRef.application_number, savedDraftRef.applicant_secret)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDraft ? 'animate-spin' : ''}`} />
              <span>استكمال المسودة ({savedDraftRef.application_number})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onBackToLogin}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة لتسجيل الدخول</span>
          </button>
        </div>
      </div>

      {/* TRACK / RESUME VIEW */}
      {mode === 'track' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">متابعة حالة طلب الانضمام أو استكمال مسودة</h3>
            <p className="text-xs text-slate-500 mt-1">
              أدخل رقم الطلب مع رقم الهاتف أو البريد الإلكتروني المسجل للاستعلام الفوري عن حالة المراجعة.
            </p>
          </div>

          <form onSubmit={handleCheckStatus} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              dir="ltr"
              value={trackAppNo}
              onChange={(e) => setTrackAppNo(e.target.value)}
              placeholder="مثال: OTL-2026-123456"
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono tabular-nums"
            />
            <input
              type="text"
              dir="ltr"
              value={trackContact}
              onChange={(e) => setTrackContact(e.target.value)}
              placeholder="رقم الهاتف أو البريد الإلكتروني"
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm"
            />
            <button
              type="submit"
              disabled={trackingBusy}
              className="px-4 py-2.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>{trackingBusy ? 'جاري البحث...' : 'الاستعلام عن الحالة'}</span>
            </button>
          </form>

          {savedDraftRef && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-700">
                <span className="font-bold">مسودة محفوظة على هذا الجهاز: </span>
                <span dir="ltr" className="font-mono font-bold text-slate-900">{savedDraftRef.application_number}</span>
                {savedDraftRef.business_name_ar && <span> · {savedDraftRef.business_name_ar}</span>}
              </div>
              <button
                type="button"
                disabled={loadingDraft}
                onClick={() => void handleResumeDraft(savedDraftRef.application_number, savedDraftRef.applicant_secret)}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                فتح واستكمال الآن
              </button>
            </div>
          )}

          {trackedApp && (
            <div className="border border-slate-200 rounded-2xl p-5 space-y-4 bg-slate-50/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">
                    رقم الطلب:{' '}
                    <span dir="ltr" className="font-mono font-bold text-slate-900">
                      {trackedApp.application_number}
                    </span>
                  </p>
                  <h4 className="text-base font-extrabold text-slate-900 mt-0.5">
                    {trackedApp.business_name_ar || 'نشاط بدون اسم بعد'}
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {trackedApp.activity_profile?.title_ar} · {trackedApp.zone_name || 'المنزلة'}
                  </p>
                </div>
                <span
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
                    STATUS_BADGE_CLS[trackedApp.status_meta?.tone || 'slate']
                  }`}
                >
                  {trackedApp.status_meta?.label_ar || trackedApp.status}
                </span>
              </div>

              <p className="text-xs text-slate-700 bg-white border border-slate-200 rounded-xl p-3">
                {trackedApp.status_meta?.description_ar}
              </p>

              {trackedApp.review_note && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-950 space-y-1">
                  <p className="font-bold">ملاحظة إدارة اطلبها:</p>
                  <p>{trackedApp.review_note}</p>
                </div>
              )}

              {trackedApp.rejection_reason && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-900 space-y-1">
                  <p className="font-bold">سبب الرفض:</p>
                  <p>{trackedApp.rejection_reason}</p>
                </div>
              )}

              {(trackedApp.status === 'draft' || trackedApp.status === 'needs_completion') && (
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <p className="text-xs font-bold text-slate-800">استكمال وتعديل الطلب (أدخل رمز المتابعة السري):</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      value={
                        trackSecret ||
                        (savedDraftRef && savedDraftRef.application_number === trackedApp.application_number
                          ? savedDraftRef.applicant_secret
                          : '')
                      }
                      onChange={(e) => setTrackSecret(e.target.value)}
                      placeholder="رمز المتابعة السري المحفوظ عند إنشاء الطلب"
                      className="flex-1 min-w-[220px] px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={loadingDraft}
                      onClick={() => {
                        const sec =
                          trackSecret.trim() ||
                          (savedDraftRef && savedDraftRef.application_number === trackedApp.application_number
                            ? savedDraftRef.applicant_secret
                            : '');
                        if (!sec) {
                          onNotify('يرجى إدخال رمز المتابعة السري للوصول للتعديل');
                          return;
                        }
                        void handleResumeDraft(trackedApp.application_number, sec);
                      }}
                      className="px-4 py-2 bg-[#A92224] text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      فتح النموذج للاستكمال
                    </button>
                  </div>
                </div>
              )}

              {trackedApp.status === 'activated' && (
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  حسابك مفعل الآن — اضغط لتسجيل الدخول
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUBMITTED RECEIPT VIEW */}
      {mode === 'apply' && submittedReceipt && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-extrabold text-slate-900">
                تم استلام طلب الانضمام بنجاح
              </h3>
              <p className="text-xs text-slate-600">
                حسابك لن يتم تفعيله أو نشره إلا بعد مراجعة وموافقة إدارة اطلبها. احتفظ برقم الطلب ورمز المتابعة السري للاستعلام أو استكمال أي مستندات عند الطلب.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs">
            <div className="space-y-1">
              <p className="text-slate-500">رقم الطلب</p>
              <div className="flex items-center gap-2">
                <span dir="ltr" className="font-mono font-extrabold text-slate-900 text-sm">
                  {submittedReceipt.application_number}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(submittedReceipt.application_number, 'رقم الطلب')}
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-slate-500">الحالة الحالية</p>
              <span
                className={`inline-block px-2.5 py-1 rounded-lg border font-bold ${
                  STATUS_BADGE_CLS[submittedReceipt.status_meta?.tone || 'amber']
                }`}
              >
                {submittedReceipt.status_meta?.label_ar || 'قيد المراجعة'}
              </span>
            </div>

            {appSecret && (
              <div className="space-y-1">
                <p className="text-slate-500">رمز المتابعة والاستكمال السري</p>
                <div className="flex items-center gap-2">
                  <span dir="ltr" className="font-mono font-bold text-slate-800 truncate max-w-[160px]">
                    {appSecret}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(appSecret, 'رمز المتابعة السري')}
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setTrackAppNo(submittedReceipt.application_number);
                setTrackContact(phone || email);
                setTrackedApp(submittedReceipt);
                setMode('track');
              }}
              className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              متابعة حالة الطلب
            </button>
            <button
              type="button"
              onClick={onBackToLogin}
              className="px-4 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer"
            >
              العودة لشاشة الدخول
            </button>
          </div>
        </div>
      )}

      {/* MULTI-STEP APPLICATION WIZARD */}
      {mode === 'apply' && !submittedReceipt && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-6">
          {/* Needs Completion Notice from Admin */}
          {appStatus === 'needs_completion' && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-1.5 text-xs text-orange-950">
              <div className="flex items-center gap-2 font-extrabold">
                <AlertCircle className="w-4 h-4 text-orange-600 shrink-0" />
                <span>مطلوب استكمال بيانات الطلب #{appNumber}</span>
              </div>
              {adminReviewNote && <p>{adminReviewNote}</p>}
              {requestedChanges.length > 0 && (
                <ul className="list-disc ps-5 space-y-0.5">
                  {requestedChanges.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Stepper Header */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 1 as const, label: '1. نوع النشاط' },
              { id: 2 as const, label: '2. المالك والموقع' },
              { id: 3 as const, label: '3. تفاصيل ومستندات' },
              { id: 4 as const, label: '4. مراجعة وإرسال' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(s.id)}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold text-center border transition-colors cursor-pointer ${
                  step === s.id
                    ? 'bg-[#A92224] text-white border-[#A92224]'
                    : step > s.id
                    ? 'bg-teal-50 text-teal-800 border-teal-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {appNumber && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2">
              <span>
                رقم المسودة الحالي:{' '}
                <strong dir="ltr" className="font-mono text-slate-900">
                  {appNumber}
                </strong>
              </span>
              <span className="font-bold text-slate-700">
                الحالة: {ONBOARDING_STATUS_META[appStatus]?.label_ar || appStatus}
              </span>
            </div>
          )}

          {formErrors.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-900 space-y-1">
              {formErrors.map((err, idx) => (
                <p key={idx} className="font-semibold">
                  • {err}
                </p>
              ))}
            </div>
          )}

          {/* STEP 1: Activity Type Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">اختر نوع نشاطك التجاري</h3>
                <p className="text-xs text-slate-500 mt-1">
                  تتغير الحقول والمستندات المطلوبة ولوحة التحكم داخل تطبيق التاجر تلقائيًا وفق نوع النشاط.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(Object.keys(MERCHANT_ACTIVITY_REGISTRY) as MerchantActivityCategory[]).map((catKey) => {
                  const prof = MERCHANT_ACTIVITY_REGISTRY[catKey];
                  const Icon = ACTIVITY_ICONS[catKey];
                  const selected = activityCategory === catKey;
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => {
                        setActivityCategory(catKey);
                        setMerchantType(prof.default_merchant_type);
                      }}
                      className={`p-4 rounded-2xl border-2 text-start flex items-start gap-3.5 transition-all cursor-pointer ${
                        selected
                          ? 'border-[#A92224] bg-red-50/40'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                          selected ? 'bg-[#A92224] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900">{prof.title_ar}</p>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{prof.subtitle_ar}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">التصنيف الفرعي للنشاط</label>
                  <select
                    value={merchantType}
                    onChange={(e) => setMerchantType(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white"
                  >
                    {activeProfile.subtypes.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label_ar}
                      </option>
                    ))}
                  </select>
                </div>

                {activityCategory === 'other' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">وصف النشاط التجاري *</label>
                    <input
                      type="text"
                      value={customActivityLabel}
                      onChange={(e) => setCustomActivityLabel(e.target.value)}
                      placeholder="مثال: مكتبة أدوات مدرسية / متجر عطور"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Owner, Contact, Account Password & GPS Location */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">بيانات المالك والمنشأة والموقع</h3>
                <p className="text-xs text-slate-500 mt-1">
                  إذا كان لديك حساب سابق على اطلبها بنفس البريد أو الهاتف، ستقوم الإدارة بربطه دون تكرار الحسابات.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم المنشأة بالعربية *</label>
                  <input
                    type="text"
                    value={businessNameAr}
                    onChange={(e) => setBusinessNameAr(e.target.value)}
                    placeholder={
                      activityCategory === 'pharmacy'
                        ? 'مثال: صيدلية الشفاء'
                        : activityCategory === 'restaurant_cafe'
                        ? 'مثال: مطعم وكافيه النخبة'
                        : 'مثال: سوبر ماركت البركة'
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الاسم بالإنجليزية (اختياري)</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={businessNameEn}
                    onChange={(e) => setBusinessNameEn(e.target.value)}
                    placeholder="Business Name"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم الفرع *</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="مثال: فرع شارع البحر"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم المالك / المدير المسؤول *</label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="الاسم الرباعي"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرقم القومي (14 رقمًا) *</label>
                  <input
                    type="text"
                    dir="ltr"
                    maxLength={14}
                    inputMode="numeric"
                    value={ownerNationalId}
                    onChange={(e) => setOwnerNationalId(e.target.value.replace(/[^0-9]/g, '').slice(0, 14))}
                    placeholder="29001011234567"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف الأساسي *</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01012345678"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">واتساب التواصل</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="نفس رقم الهاتف إذا تُرك فارغًا"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني للحساب *</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@example.com"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">النطاق / المنطقة *</label>
                  <select
                    value={zoneName}
                    onChange={(e) => setZoneName(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white"
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
                  <label className="block font-bold text-slate-700 mb-1">
                    كلمة مرور الدخول بعد التفعيل {hasServerPassword ? '(محفوظة — اتركها فارغة للإبقاء)' : '(6+ أحرف) *'}
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تأكيد كلمة المرور</label>
                  <input
                    type="password"
                    dir="ltr"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ساعات العمل اليومية</label>
                  <input
                    type="text"
                    value={workingHours}
                    onChange={(e) => setWorkingHours(e.target.value)}
                    placeholder="09:00 ص - 12:00 م"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              {/* GPS Map Picker */}
              <div className="border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-slate-900">
                    <MapPin className="w-4 h-4 text-[#A92224]" />
                    <span>تحديد موقع المنشأة على الخريطة (GPS) *</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {gpsConfirmed && (
                      <span dir="ltr" className="text-[11px] font-mono font-bold text-teal-700">
                        {lat.toFixed(5)}, {lng.toFixed(5)}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={locatingGps}
                      onClick={handleDetectGps}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>{locatingGps ? 'جاري التحديد...' : 'تحديد موقعي الحالي'}</span>
                    </button>
                  </div>
                </div>

                <GpsMapPicker
                  heightClass="h-52"
                  pickup={gpsConfirmed ? { lat, lng, label: businessNameAr || 'موقع المنشأة' } : null}
                  pickTarget="store"
                  center={[lat, lng]}
                  onMapPick={(pickedLat, pickedLng) => {
                    setLat(pickedLat);
                    setLng(pickedLng);
                    setGpsConfirmed(true);
                  }}
                />

                <input
                  type="text"
                  value={addressDetail}
                  onChange={(e) => setAddressDetail(e.target.value)}
                  placeholder="العنوان التفصيلي وعلامة مميزة قريبة..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                />
              </div>
            </div>
          )}

          {/* STEP 3: Activity-Specific Requirements & Protected Documents */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  متطلبات نشاط «{activeProfile.title_ar}» والمستندات الرسمية
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  جميع المستندات المرفوعة محفوظة بشكل خاص ولا يطّلع عليها إلا فريق المراجعة المعتمد بإدارة اطلبها.
                </p>
              </div>

              {/* Dynamic Activity Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl p-4">
                {activityCategory === 'restaurant_cafe' && (
                  <>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">نوع المطبخ / المشروبات *</label>
                      <input
                        type="text"
                        value={cuisineType}
                        onChange={(e) => setCuisineType(e.target.value)}
                        placeholder="مثال: مشويات وشرقي / قهوة مختصة وحلويات"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">متوسط وقت التحضير (بالدقائق)</label>
                      <input
                        type="number"
                        min={5}
                        max={120}
                        value={avgPrepMinutes}
                        onChange={(e) => setAvgPrepMinutes(Number(e.target.value) || 20)}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">رقم رخصة التشغيل / الشهادة الصحية</label>
                      <input
                        type="text"
                        value={healthCertNo}
                        onChange={(e) => setHealthCertNo(e.target.value)}
                        placeholder="اختياري إن وُجد"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                  </>
                )}

                {activityCategory === 'pharmacy' && (
                  <>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">رقم ترخيص الصيدلية *</label>
                      <input
                        type="text"
                        value={pharmacyLicenseNo}
                        onChange={(e) => setPharmacyLicenseNo(e.target.value)}
                        placeholder="رقم الترخيص الصادر من وزارة الصحة"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">اسم الصيدلي المدير المسؤول *</label>
                      <input
                        type="text"
                        value={pharmacistName}
                        onChange={(e) => setPharmacistName(e.target.value)}
                        placeholder="د. الاسم الكامل"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">رقم قيد نقابة الصيادلة *</label>
                      <input
                        type="text"
                        value={syndicateNo}
                        onChange={(e) => setSyndicateNo(e.target.value)}
                        placeholder="رقم القيد النقابي"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                  </>
                )}

                {(activityCategory === 'store' || activityCategory === 'other') && (
                  <>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">رقم السجل التجاري (إن وُجد)</label>
                      <input
                        type="text"
                        value={commercialRegNo}
                        onChange={(e) => setCommercialRegNo(e.target.value)}
                        placeholder="رقم السجل التجاري"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">رقم البطاقة الضريبية (اختياري)</label>
                      <input
                        type="text"
                        value={taxCardNo}
                        onChange={(e) => setTaxCardNo(e.target.value)}
                        placeholder="رقم التسجيل الضريبي"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block font-bold text-slate-700 mb-1">طريقة استلام المستحقات المالية</label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl"
                  >
                    <option value="vodafone_cash">فودافون كاش (Vodafone Cash)</option>
                    <option value="instapay">إنستاباي (InstaPay)</option>
                    <option value="bank_transfer">تحويل بنكي</option>
                    <option value="cash_settlement">تسوية نقدية مباشرة</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم المحفظة / الحساب البنكي</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={payoutAccount}
                    onChange={(e) => setPayoutAccount(e.target.value)}
                    placeholder="010XXXXXXXX أو عنوان InstaPay"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block font-bold text-slate-700 mb-1">نبذة مختصرة عن المنشأة (تظهر للعملاء)</label>
                  <textarea
                    rows={2}
                    value={descriptionAr}
                    onChange={(e) => setDescriptionAr(e.target.value)}
                    placeholder="وصف مختصر لأهم المنتجات أو الخدمات ومواعيد التوصيل..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl"
                  />
                </div>

                {activityCategory === 'store' && (
                  <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-4 pt-1">
                    <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supportsWeightedItems}
                        onChange={(e) => setSupportsWeightedItems(e.target.checked)}
                        className="w-4 h-4 accent-[#A92224]"
                      />
                      <span>بيع منتجات بالوزن (كجم / ربع / نصف)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasExcelCatalog}
                        onChange={(e) => setHasExcelCatalog(e.target.checked)}
                        className="w-4 h-4 accent-[#A92224]"
                      />
                      <span>لدي قائمة منتجات بملف Excel لرفعها بعد التفعيل</span>
                    </label>
                  </div>
                )}

                {activityCategory === 'pharmacy' && (
                  <div className="sm:col-span-2 lg:col-span-3 pt-1">
                    <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supportsPrescriptions}
                        onChange={(e) => setSupportsPrescriptions(e.target.checked)}
                        className="w-4 h-4 accent-teal-600"
                      />
                      <span>استقبال ومراجعة الروشتات والوصفات الطبية المصورة</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Protected Document Uploads */}
              <div className="space-y-3">
                <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-[#A92224]" />
                  <span>المستندات المطلوبة (صور JPG/PNG/WEBP أو PDF بحد أقصى 5 ميجابايت)</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {activeProfile.documents.map((docSpec) => {
                    const existingDoc = documents.find((d) => d.doc_type === docSpec.doc_type);
                    const isUploading = uploadingDocType === docSpec.doc_type;
                    return (
                      <div
                        key={docSpec.doc_type}
                        className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 ${
                          existingDoc
                            ? 'bg-teal-50/40 border-teal-200'
                            : docSpec.required
                            ? 'bg-white border-slate-200'
                            : 'bg-slate-50/60 border-slate-200'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-slate-900">{docSpec.label_ar}</span>
                            <span
                              className={`text-[11px] font-bold ${
                                existingDoc
                                  ? 'text-teal-700'
                                  : docSpec.required
                                  ? 'text-rose-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {existingDoc ? 'مرفق ✓' : docSpec.required ? 'إلزامي' : 'اختياري'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{docSpec.hint_ar}</p>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-300 hover:border-[#A92224] text-xs font-bold text-slate-800 cursor-pointer">
                            <Upload className="w-3.5 h-3.5 text-[#A92224]" />
                            <span>
                              {isUploading
                                ? 'جاري الرفع...'
                                : existingDoc
                                ? 'تغيير الملف'
                                : 'إرفاق مستند'}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              className="hidden"
                              disabled={isUploading}
                              onChange={handleUploadDocument(docSpec.doc_type, docSpec.label_ar)}
                            />
                          </label>
                          {existingDoc && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteDocument(existingDoc.id)}
                              title="حذف المستند"
                              className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Final Review & Submission */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">مراجعة البيانات والإرسال للاعتماد</h3>
                <p className="text-xs text-slate-500 mt-1">
                  راجع بياناتك قبل الإرسال؛ بعد الإرسال ستحصل على رقم طلب لمتابعة حالة المراجعة حتى التفعيل.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div>
                  <span className="text-slate-500">نوع النشاط: </span>
                  <strong className="text-slate-900">{activeProfile.title_ar}</strong>
                </div>
                <div>
                  <span className="text-slate-500">اسم المنشأة: </span>
                  <strong className="text-slate-900">{businessNameAr || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">اسم المالك: </span>
                  <strong className="text-slate-900">{ownerName || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">الهاتف / البريد: </span>
                  <strong dir="ltr" className="text-slate-900 font-mono">
                    {phone || '—'} · {email || '—'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">المنطقة والفرع: </span>
                  <strong className="text-slate-900">
                    {zoneName} — {branchName || '—'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">المستندات المرفقة: </span>
                  <strong className="text-slate-900 tabular-nums">{documents.length} مستند</strong>
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-4 rounded-2xl border border-slate-200 bg-white text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[#A92224]"
                />
                <span>
                  أقر بصحة جميع البيانات والمستندات المقدمة، وأوافق على شروط واتفاقية الانضمام لمنصة «اطلبها»، وأتفهم أن الحساب لن يُفعّل إلا بعد المراجعة والاعتماد الرسمي من الإدارة.
                </span>
              </label>
            </div>
          )}

          {/* Wizard Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
              )}
              <button
                type="button"
                disabled={savingDraft}
                onClick={() => void handleSaveDraft()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingDraft ? 'جاري الحفظ...' : 'حفظ كمسودة'}</span>
              </button>
            </div>

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-bold cursor-pointer"
              >
                <span>التالي</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmitFinal()}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'جاري إرسال الطلب...'
                    : appStatus === 'needs_completion'
                    ? 'إعادة إرسال الطلب بعد الاستكمال'
                    : 'إرسال طلب الانضمام للاعتماد'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
