import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  Link2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  onRefreshCore: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const STATUS_TABS = [
  { key: 'all', label: 'الكل' },
  { key: 'under_review', label: 'قيد المراجعة' },
  { key: 'needs_completion', label: 'مطلوب استكمال' },
  { key: 'activated', label: 'مقبول ومفعل' },
  { key: 'rejected', label: 'مرفوض' },
  { key: 'draft', label: 'مسودات' },
];

const ACTIVITY_FILTERS = [
  { key: 'all', label: 'كل الأنشطة' },
  { key: 'store', label: 'متاجر وسوبر ماركت' },
  { key: 'restaurant_cafe', label: 'مطاعم وكافيهات' },
  { key: 'pharmacy', label: 'صيدليات' },
  { key: 'other', label: 'أنشطة أخرى' },
];

const TONE_CLS: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  orange: 'bg-orange-50 text-orange-800 border-orange-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export const AdminOnboardingReviewSection: React.FC<Props> = ({
  lang,
  onRefreshCore,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [statusFilter, setStatusFilter] = useState('under_review');
  const [activityFilter, setActivityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [applications, setApplications] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Decision controls
  const [commissionRate, setCommissionRate] = useState<number>(5);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);

  // Protected document preview lightbox
  const [previewDoc, setPreviewDoc] = useState<{
    label: string;
    mime_type: string;
    data_url: string;
    file_name: string;
  } | null>(null);
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAdminOnboardingApplications({
        status: statusFilter,
        activity_category: activityFilter,
        q: search.trim() || undefined,
      });
      setCounts(res.counts || {});
      setApplications(res.applications || []);
      setSelectedId((prev) => {
        if (prev && (res.applications || []).some((a) => a.id === prev)) return prev;
        return res.applications?.[0]?.id || null;
      });
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, activityFilter, search, onNotify]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const selected = applications.find((a) => a.id === selectedId) || null;

  const handleOpenDocument = async (doc: any) => {
    setLoadingDocId(doc.id);
    try {
      const res = await api.getMerchantOnboardingDocument(doc.id);
      setPreviewDoc({
        label: res.document.doc_label_ar || doc.doc_type,
        mime_type: res.document.mime_type,
        data_url: res.document.data_url,
        file_name: res.document.file_name,
      });
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingDocId(null);
    }
  };

  const handleDecision = async (action: 'approve' | 'request_completion' | 'reject') => {
    if (!selected) return;
    if (action === 'request_completion' && !reviewNote.trim()) {
      onNotify('يرجى كتابة الملاحظات أو المستندات المطلوب استكمالها');
      return;
    }
    if (action === 'reject' && !rejectionReason.trim()) {
      onNotify('يرجى كتابة سبب الرفض ليُسجل في سجل المراجعة ويظهر للمتقدم');
      return;
    }

    setDecisionBusy(true);
    try {
      const res = await api.decideAdminOnboardingApplication(selected.id, {
        action,
        review_note: reviewNote.trim() || undefined,
        rejection_reason: action === 'reject' ? rejectionReason.trim() : undefined,
        commission_rate: action === 'approve' ? commissionRate : undefined,
        link_existing_merchant_id:
          action === 'approve' && selected.existing_match_merchant?.id
            ? selected.existing_match_merchant.id
            : undefined,
      });
      setReviewNote('');
      setRejectionReason('');
      onNotify(res.message);
      await loadApplications();
      await onRefreshCore();
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setDecisionBusy(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header & KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            {isAr ? 'مراجعة طلبات انضمام التجار والأنشطة' : 'Merchant Onboarding Review Queue'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            مراجعة البيانات والمستندات المحمية، اعتماد وتفعيل الحسابات الجديدة، أو ربط الطلب بحساب موجود دون تكرار.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
          <div className="text-center px-3">
            <p className="text-slate-500">قيد المراجعة</p>
            <p className="text-xl font-extrabold text-amber-600">{counts.under_review ?? 0}</p>
          </div>
          <div className="w-px h-8 bg-slate-200" />
          <div className="text-center px-3">
            <p className="text-slate-500">مطلوب استكمال</p>
            <p className="text-xl font-extrabold text-orange-600">{counts.needs_completion ?? 0}</p>
          </div>
          <div className="w-px h-8 bg-slate-200" />
          <div className="text-center px-3">
            <p className="text-slate-500">مفعل</p>
            <p className="text-xl font-extrabold text-emerald-600">{counts.activated ?? 0}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadApplications()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === t.key
                  ? 'bg-[#A92224] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label} ({counts[t.key] ?? 0})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم الطلب، اسم النشاط، المالك، الهاتف، أو البريد..."
              className="w-full ps-9 pe-3 py-2 border border-slate-200 rounded-xl text-xs"
            />
          </div>
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white"
          >
            {ACTIVITY_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Split Workspace: Applications Queue + Selected Detail Review */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Queue List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">جاري تحميل طلبات الانضمام...</div>
          ) : applications.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Store className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-800">لا توجد طلبات مطابقة للتصفية الحالية</p>
              <p className="text-xs text-slate-500">جرّب التبديل إلى تبويب «الكل» لعرض جميع الطلبات.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
              {applications.map((app) => {
                const isSelected = app.id === selectedId;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(app.id);
                      setReviewNote(app.review_note || '');
                      setRejectionReason(app.rejection_reason || '');
                    }}
                    className={`w-full text-start p-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-red-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 truncate">
                          {app.business_name_ar || 'مسودة بدون اسم'}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          <span dir="ltr" className="font-mono font-semibold text-slate-700">
                            {app.application_number}
                          </span>{' '}
                          · {app.activity_profile?.short_title_ar}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-bold shrink-0 ${
                          TONE_CLS[app.status_meta?.tone || 'slate']
                        }`}
                      >
                        {app.status_meta?.label_ar}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                      <span>{app.owner_name || '—'}</span>
                      <span className="tabular-nums">{(app.documents || []).length} مستند</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Review Detail Pane */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          {!selected ? (
            <div className="py-16 text-center text-xs text-slate-500">
              اختر طلب انضمام من القائمة لعرض تفاصيله ومستنداته واتخاذ القرار.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span dir="ltr" className="font-mono font-bold text-slate-800">
                      {selected.application_number}
                    </span>
                    <span>·</span>
                    <span>{selected.activity_profile?.title_ar}</span>
                    {selected.custom_activity_label && (
                      <>
                        <span>·</span>
                        <span>{selected.custom_activity_label}</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                    {selected.business_name_ar || 'مسودة قيد الإعداد'}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {selected.branch_name} · {selected.zone_name} · {selected.working_hours}
                  </p>
                </div>
                <span
                  className={`px-3 py-1.5 rounded-lg border text-xs font-extrabold ${
                    TONE_CLS[selected.status_meta?.tone || 'slate']
                  }`}
                >
                  {selected.status_meta?.label_ar}
                </span>
              </div>

              {/* Duplicate / Existing Account Detection Alert */}
              {selected.existing_match_merchant && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 text-xs text-teal-950 flex items-start gap-2.5">
                  <Link2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-extrabold">
                      {selected.linked_merchant_id
                        ? 'مرتبط بحساب تاجر معتمد:'
                        : 'تم اكتشاف حساب تاجر موجود بنفس البريد أو الهاتف:'}
                    </p>
                    <p>
                      <strong>{selected.existing_match_merchant.business_name_ar}</strong> (
                      <span dir="ltr" className="font-mono">
                        {selected.existing_match_merchant.email}
                      </span>{' '}
                      · {selected.existing_match_merchant.phone}) — عند الاعتماد سيتم ربط الطلب بهذا الحساب وتحديثه دون تكرار أو حذف بياناته.
                    </p>
                  </div>
                </div>
              )}

              {/* Owner & Contact Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    المالك: <strong>{selected.owner_name || '—'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    الرقم القومي: <strong dir="ltr" className="font-mono">{selected.owner_national_id || '—'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    الهاتف: <strong dir="ltr" className="font-mono">{selected.phone || '—'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    البريد: <strong dir="ltr" className="font-mono">{selected.email || '—'}</strong>
                  </span>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    الموقع: <strong>{selected.address_detail || '—'}</strong>{' '}
                    {selected.lat != null && selected.lng != null && (
                      <span dir="ltr" className="font-mono text-slate-500">
                        ({Number(selected.lat).toFixed(5)}, {Number(selected.lng).toFixed(5)})
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Activity-Specific Metadata */}
              {selected.activity_details && Object.keys(selected.activity_details).length > 0 && (
                <div className="border border-slate-200 rounded-xl p-3.5 text-xs space-y-1.5">
                  <p className="font-extrabold text-slate-900">تفاصيل النشاط التخصصية:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                    {selected.activity_details.cuisine_type && (
                      <span>نوع المطبخ: <strong>{selected.activity_details.cuisine_type}</strong></span>
                    )}
                    {selected.activity_details.avg_prep_minutes && (
                      <span>متوسط التحضير: <strong>{selected.activity_details.avg_prep_minutes} دقيقة</strong></span>
                    )}
                    {selected.activity_details.pharmacy_license_no && (
                      <span>ترخيص الصيدلية: <strong className="font-mono">{selected.activity_details.pharmacy_license_no}</strong></span>
                    )}
                    {selected.activity_details.pharmacist_name && (
                      <span>الصيدلي المدير: <strong>{selected.activity_details.pharmacist_name}</strong></span>
                    )}
                    {selected.activity_details.syndicate_no && (
                      <span>قيد النقابة: <strong className="font-mono">{selected.activity_details.syndicate_no}</strong></span>
                    )}
                    {selected.commercial_reg_no && (
                      <span>السجل التجاري: <strong className="font-mono">{selected.commercial_reg_no}</strong></span>
                    )}
                    {selected.tax_card_no && (
                      <span>البطاقة الضريبية: <strong className="font-mono">{selected.tax_card_no}</strong></span>
                    )}
                  </div>
                </div>
              )}

              {/* Protected Documents */}
              <div className="space-y-2">
                <p className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <FileCheck2 className="w-4 h-4 text-[#A92224]" />
                  <span>المستندات المرفقة المحمية ({(selected.documents || []).length})</span>
                </p>
                {(selected.documents || []).length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد مستندات مرفقة حتى الآن.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(selected.documents || []).map((doc: any) => (
                      <button
                        key={doc.id}
                        type="button"
                        disabled={loadingDocId === doc.id}
                        onClick={() => void handleOpenDocument(doc)}
                        className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-[#A92224] bg-white text-xs text-start cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{doc.doc_label_ar || doc.doc_type}</p>
                          <p className="text-[11px] text-slate-500 truncate">{doc.file_name}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[#A92224] font-bold shrink-0">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{loadingDocId === doc.id ? '...' : 'عرض'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Admin Decision Panel */}
              {selected.status !== 'activated' && (
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <p className="text-xs font-extrabold text-slate-900">قرار الإدارة</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">نسبة العمولة عند التفعيل (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={35}
                        step={0.5}
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-slate-700 mb-1">ملاحظة المراجعة / طلب الاستكمال</label>
                      <input
                        type="text"
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="تظهر للمتقدم عند طلب الاستكمال أو الاعتماد"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block font-bold text-slate-700 mb-1">سبب الرفض (مطلوب في حالة الرفض فقط)</label>
                      <input
                        type="text"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="مثال: الترخيص غير واضح أو منتهي الصلاحية"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={decisionBusy}
                      onClick={() => void handleDecision('approve')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs font-extrabold cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {selected.existing_match_merchant
                          ? 'اعتماد وربط بالحساب الموجود'
                          : 'اعتماد وإنشاء وتفعيل الحساب'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={decisionBusy}
                      onClick={() => void handleDecision('request_completion')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-xs font-extrabold cursor-pointer"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <span>طلب استكمال بيانات</span>
                    </button>
                    <button
                      type="button"
                      disabled={decisionBusy}
                      onClick={() => void handleDecision('reject')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-xl text-xs font-extrabold cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>رفض الطلب</span>
                    </button>
                  </div>
                </div>
              )}

              {/* History Timeline */}
              {(selected.history || []).length > 0 && (
                <div className="border-t border-slate-100 pt-4 space-y-2">
                  <p className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>سجل القرارات والتعديلات</span>
                  </p>
                  <div className="space-y-1.5">
                    {(selected.history || []).map((h: any) => (
                      <div
                        key={h.id}
                        className="text-[11px] bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          <strong>{h.actor_name}</strong> · {h.note || h.to_status}
                        </span>
                        <span dir="ltr" className="text-slate-400 font-mono tabular-nums">
                          {h.created_at}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Protected Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-extrabold text-slate-900">{previewDoc.label}</p>
                <p className="text-[11px] text-slate-500">{previewDoc.file_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 bg-slate-100 flex items-center justify-center">
              {previewDoc.mime_type === 'application/pdf' ? (
                <iframe
                  title={previewDoc.label}
                  src={previewDoc.data_url}
                  className="w-full h-[70vh] rounded-xl bg-white"
                />
              ) : (
                <img
                  src={previewDoc.data_url}
                  alt={previewDoc.label}
                  className="max-w-full max-h-[72vh] rounded-xl object-contain bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
