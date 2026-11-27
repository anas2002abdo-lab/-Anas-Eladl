import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Heart,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Star,
  Store,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify: (msg: string) => void;
}

export const StoreReviewsAdminSection: React.FC<Props> = ({ lang, onNotify }) => {
  const isAr = lang === 'ar';
  const [subTab, setSubTab] = useState<'rankings' | 'reviews' | 'reports' | 'settings'>('rankings');
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);

  // Reviews filters
  const [reviewTypeFilter, setReviewTypeFilter] = useState<'all' | 'store' | 'product'>('all');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [reviewMerchantFilter, setReviewMerchantFilter] = useState('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [reviewSearch, setReviewSearch] = useState('');

  // Reports filter
  const [reportStatusFilter, setReportStatusFilter] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open');

  // Settings form
  const [editWindowHours, setEditWindowHours] = useState(72);
  const [cooldownMinutes, setCooldownMinutes] = useState(120);
  const [maxDailyNotifications, setMaxDailyNotifications] = useState(3);
  const [savingSettings, setSavingSettings] = useState(false);

  // Moderation reason modal
  const [modTarget, setModTarget] = useState<{ type: 'store' | 'product'; id: string; nextStatus: 'visible' | 'hidden' } | null>(null);
  const [modReason, setModReason] = useState('');
  const [modBusy, setModBusy] = useState(false);

  const loadOverview = async () => {
    try {
      const data = await api.getAdminStoreReviewsOverview();
      setOverview(data);
      if (data.settings) {
        setEditWindowHours(Number(data.settings.edit_window_hours || 72));
        setCooldownMinutes(Number(data.settings.notification_cooldown_minutes || 120));
        setMaxDailyNotifications(Number(data.settings.max_daily_store_notifications || 3));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل ملخص التقييمات');
    }
  };

  const loadReviews = async () => {
    try {
      const data = await api.getAdminStoreReviews({
        type: reviewTypeFilter,
        status: reviewStatusFilter,
        merchant_id: reviewMerchantFilter || undefined,
        reported_only: reportedOnly,
        q: reviewSearch.trim() || undefined,
      });
      setReviews(data.reviews || []);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل التقييمات');
    }
  };

  const loadReports = async () => {
    try {
      const data = await api.getAdminReviewReports(reportStatusFilter);
      setReports(data.reports || []);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل البلاغات');
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadOverview(), loadReviews(), loadReports()]);
    setLoading(false);
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [reviewTypeFilter, reviewStatusFilter, reviewMerchantFilter, reportedOnly, reviewSearch]);

  useEffect(() => {
    void loadReports();
  }, [reportStatusFilter]);

  const handleConfirmModerate = async () => {
    if (!modTarget) return;
    setModBusy(true);
    try {
      await api.moderateAdminReview(modTarget.type, modTarget.id, {
        status: modTarget.nextStatus,
        reason: modReason.trim() || undefined,
      });
      onNotify(
        modTarget.nextStatus === 'hidden'
          ? 'تم إخفاء التقييم واستبعاده فورًا من المتوسط'
          : 'تم إعادة إظهار التقييم واحتسابه في المتوسط'
      );
      setModTarget(null);
      setModReason('');
      await refreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تنفيذ إجراء الرقابة');
    } finally {
      setModBusy(false);
    }
  };

  const handleReportDecision = async (id: string, status: 'resolved' | 'dismissed', hideReview: boolean) => {
    try {
      await api.updateAdminReviewReport(id, {
        status,
        hide_review: hideReview,
        hide_reason: hideReview ? 'إخفاء تعليق مخالف بناءً على بلاغ' : undefined,
      });
      onNotify(hideReview ? 'تم إخفاء التعليق وحل البلاغ' : 'تم تحديث حالة البلاغ');
      await refreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحديث البلاغ');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await api.updateAdminStoreReviewsSettings({
        edit_window_hours: editWindowHours,
        notification_cooldown_minutes: cooldownMinutes,
        max_daily_store_notifications: maxDailyNotifications,
      });
      onNotify('تم حفظ إعدادات التقييمات وإشعارات المتابعين بنجاح');
      await loadOverview();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات');
    } finally {
      setSavingSettings(false);
    }
  };

  const kpis = overview?.kpis || {
    visible_store_reviews: 0,
    hidden_store_reviews: 0,
    overall_store_avg: 0,
    visible_product_reviews: 0,
    hidden_product_reviews: 0,
    open_reports_count: 0,
    total_store_follows: 0,
  };
  const stores: any[] = overview?.stores || [];
  const topStores: any[] = overview?.top_rated_stores || [];
  const lowestStores: any[] = overview?.lowest_rated_stores || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            {isAr ? 'تقييمات المتاجر والمنتجات والرقابة' : 'Store & Product Reviews Moderation'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? 'إدارة مستقلة لتقييمات المتاجر والمنتجات، البلاغات، ترتيب المتاجر، وسياسات التعديل — التاجر لا يملك صلاحية التعديل أو الحذف.'
              : 'Independent moderation for store & product reviews, reports, rankings, and anti-spam notification settings.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{isAr ? 'تحديث' : 'Refresh'}</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          {
            label: 'متوسط تقييم المتاجر',
            value: Number(kpis.overall_store_avg || 0).toFixed(2),
            sub: `${kpis.visible_store_reviews} تقييم ظاهر`,
            icon: Star,
            accent: 'text-amber-600',
          },
          {
            label: 'تقييمات المنتجات',
            value: kpis.visible_product_reviews,
            sub: `${kpis.hidden_product_reviews} مخفي`,
            icon: CheckCircle2,
            accent: 'text-teal-700',
          },
          {
            label: 'تقييمات المتاجر المخفية',
            value: kpis.hidden_store_reviews,
            sub: 'مستبعدة من المتوسط',
            icon: EyeOff,
            accent: 'text-slate-600',
          },
          {
            label: 'بلاغات قيد المراجعة',
            value: kpis.open_reports_count,
            sub: 'بلاغات إساءة مفتوحة',
            icon: ShieldAlert,
            accent: kpis.open_reports_count > 0 ? 'text-rose-600' : 'text-slate-500',
          },
          {
            label: 'متابعات المتاجر',
            value: kpis.total_store_follows,
            sub: 'إجمالي المتابعين النشطين',
            icon: Heart,
            accent: 'text-[#A92224]',
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold">{card.label}</span>
                <Icon className={`w-4 h-4 ${card.accent}`} />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1.5 tabular-nums">{card.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{card.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'rankings' as const, label: 'ترتيب المتاجر والأداء', icon: Store },
          { id: 'reviews' as const, label: `مراجعة التقييمات (${reviews.length})`, icon: Star },
          {
            id: 'reports' as const,
            label: `البلاغات الواردة (${kpis.open_reports_count})`,
            icon: Flag,
          },
          { id: 'settings' as const, label: 'إعدادات السياسة والإشعارات', icon: Settings },
        ].map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                active ? 'bg-[#A92224] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: STORE RANKINGS */}
      {subTab === 'rankings' && (
        <div className="space-y-5">
          {(topStores.length > 0 || lowestStores.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-black text-emerald-800">
                  <TrendingUp className="w-4 h-4" />
                  <span>أعلى المتاجر تقييمًا</span>
                </div>
                {topStores.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد تقييمات كافية بعد.</p>
                ) : (
                  topStores.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-t border-slate-100">
                      <span className="font-bold text-slate-800">{s.business_name_ar}</span>
                      <span className="font-black text-amber-700 tabular-nums">
                        {Number(s.rating_avg).toFixed(2)} ★ ({s.rating_count})
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-black text-rose-800">
                  <TrendingDown className="w-4 h-4" />
                  <span>أقل المتاجر تقييمًا (تحتاج متابعة)</span>
                </div>
                {lowestStores.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد تقييمات كافية بعد.</p>
                ) : (
                  lowestStores.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-t border-slate-100">
                      <span className="font-bold text-slate-800">{s.business_name_ar}</span>
                      <span className="font-black text-rose-700 tabular-nums">
                        {Number(s.rating_avg).toFixed(2)} ★ ({s.rating_count})
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-bold">المتجر</th>
                    <th className="py-3 px-3 font-bold">المتوسط</th>
                    <th className="py-3 px-3 font-bold">تقييمات المتجر</th>
                    <th className="py-3 px-3 font-bold">تقييمات المنتجات</th>
                    <th className="py-3 px-3 font-bold">المتابعون</th>
                    <th className="py-3 px-3 font-bold">بلاغات مفتوحة</th>
                    <th className="py-3 px-4 font-bold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {stores.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{s.business_name_ar}</div>
                        <div className="text-[11px] text-slate-500">{s.zone_name || 'المنزلة'}</div>
                      </td>
                      <td className="py-3 px-3 font-black text-slate-900">
                        {Number(s.rating_count) > 0 ? `${Number(s.rating_avg).toFixed(2)} ★` : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-800">{s.rating_count}</span>
                        {s.hidden_reviews_count > 0 && (
                          <span className="text-rose-600 ms-1">({s.hidden_reviews_count} مخفي)</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-700">{s.product_reviews_count}</td>
                      <td className="py-3 px-3 font-semibold text-slate-700">{s.followers_count}</td>
                      <td className="py-3 px-3">
                        <span className={s.open_reports_count > 0 ? 'font-black text-rose-600' : 'text-slate-400'}>
                          {s.open_reports_count}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReviewMerchantFilter(s.id);
                              setSubTab('reviews');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 font-bold text-slate-700"
                          >
                            عرض التقييمات
                          </button>
                          <a
                            href={`/store/${encodeURIComponent(s.id)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-[#A92224] hover:text-[#A92224] font-bold text-slate-700"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>صفحة المتجر</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REVIEWS MODERATION */}
      {subTab === 'reviews' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={reviewSearch}
                onChange={(e) => setReviewSearch(e.target.value)}
                placeholder="بحث في التعليقات أو اسم المتجر أو المنتج..."
                className="w-full pr-9 pl-3 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
            </div>
            <select
              value={reviewTypeFilter}
              onChange={(e) => setReviewTypeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-semibold"
            >
              <option value="all">كل التقييمات (متاجر + منتجات)</option>
              <option value="store">تقييمات المتاجر فقط</option>
              <option value="product">تقييمات المنتجات فقط</option>
            </select>
            <select
              value={reviewStatusFilter}
              onChange={(e) => setReviewStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-semibold"
            >
              <option value="all">كل الحالات</option>
              <option value="visible">ظاهر للعملاء</option>
              <option value="hidden">مخفي إداريًا</option>
            </select>
            <select
              value={reviewMerchantFilter}
              onChange={(e) => setReviewMerchantFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-semibold"
            >
              <option value="">كل المتاجر</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.business_name_ar}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer px-2">
              <input
                type="checkbox"
                checked={reportedOnly}
                onChange={(e) => setReportedOnly(e.target.checked)}
                className="accent-[#A92224]"
              />
              <span>المُبلّغ عنها فقط</span>
            </label>
          </div>

          <div className="space-y-3">
            {reviews.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
                لا توجد تقييمات مطابقة لخيارات التصفية الحالية.
              </div>
            ) : (
              reviews.map((r) => (
                <div
                  key={`${r.review_type}_${r.id}`}
                  className={`bg-white border rounded-xl p-4 space-y-2 ${
                    r.status === 'hidden' ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-black text-slate-900">
                          {r.review_type === 'store' ? 'تقييم متجر' : 'تقييم منتج'}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-bold text-[#A92224]">{r.merchant_name_ar}</span>
                        {r.product_name_ar && (
                          <>
                            <span className="text-slate-400">·</span>
                            <span className="font-bold text-slate-700">{r.product_name_ar}</span>
                          </>
                        )}
                        <span className="text-slate-400">·</span>
                        <span className="font-black text-amber-600 tabular-nums">{r.rating} ★</span>
                        {r.open_reports_count > 0 && (
                          <span className="text-rose-600 font-black tabular-nums">
                            ({r.open_reports_count} بلاغ مفتوح)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        العميل: {r.customer_name_display} · طلب #{r.order_number || r.order_id} · {String(r.created_at || '').slice(0, 16)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {r.status === 'visible' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setModTarget({ type: r.review_type, id: r.id, nextStatus: 'hidden' });
                            setModReason('مخالفة سياسة التعليقات');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>إخفاء التقييم</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setModTarget({ type: r.review_type, id: r.id, nextStatus: 'visible' });
                            setModReason('');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>إعادة إظهار</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {r.comment && <p className="text-xs text-slate-800 leading-relaxed">{r.comment}</p>}

                  {Array.isArray(r.image_urls) && r.image_urls.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      {r.image_urls.map((img: string, idx: number) => (
                        <img
                          key={idx}
                          src={img}
                          alt="صورة تقييم"
                          className="w-14 h-14 rounded-lg object-cover border border-slate-200"
                        />
                      ))}
                    </div>
                  )}

                  {r.status === 'hidden' && (
                    <div className="text-[11px] text-rose-700 font-semibold pt-1 border-t border-rose-100">
                      مخفي إداريًا بواسطة {r.moderated_by || 'الإدارة'} — السبب: {r.hidden_reason || 'مخالفة'}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ABUSE REPORTS */}
      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {[
              { id: 'open' as const, label: 'بلاغات مفتوحة' },
              { id: 'resolved' as const, label: 'تمت المعالجة' },
              { id: 'dismissed' as const, label: 'مرفوضة' },
              { id: 'all' as const, label: 'الكل' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setReportStatusFilter(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  reportStatusFilter === s.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {reports.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
              لا توجد بلاغات في هذه القائمة.
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((rep) => (
                <div key={rep.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-0.5 text-xs">
                      <div className="font-black text-slate-900">
                        بلاغ على {rep.review_type === 'product' ? 'تقييم منتج' : 'تقييم متجر'} · {rep.merchant_name_ar}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        السبب: <strong className="text-rose-700">{rep.reason}</strong> · المُبلّغ: {rep.reporter_name} ({rep.reporter_role})
                      </div>
                    </div>
                    {rep.status === 'open' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReportDecision(rep.id, 'resolved', true)}
                          className="px-3 py-1.5 rounded-lg bg-[#A92224] text-white text-xs font-bold"
                        >
                          إخفاء التعليق وحل البلاغ
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReportDecision(rep.id, 'resolved', false)}
                          className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold"
                        >
                          حل بدون إخفاء
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReportDecision(rep.id, 'dismissed', false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold"
                        >
                          رفض البلاغ
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-500">
                        الحالة: {rep.status === 'resolved' ? 'تمت المعالجة' : 'مرفوض'} ({rep.resolved_by || 'الإدارة'})
                      </span>
                    )}
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs text-slate-700">
                    <div className="font-bold text-slate-900 mb-1">
                      نص التعليق المُبلّغ عنه ({rep.review_rating} ★ — {rep.reviewer_name}):
                    </div>
                    <p>{rep.review_comment || '(بدون تعليق نصي)'}</p>
                    {rep.details && <p className="text-slate-500 mt-1.5">ملاحظة المُبلّغ: {rep.details}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: POLICY & NOTIFICATION SETTINGS */}
      {subTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-xl p-5 max-w-xl space-y-4">
          <h2 className="text-sm font-black text-slate-900">سياسات التقييمات ومنع إزعاج المتابعين</h2>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              فترة السماح بتعديل التقييم بعد النشر (بالساعات)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              value={editWindowHours}
              onChange={(e) => setEditWindowHours(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              فترة التهدئة بين إشعارات المتجر لنفس نوع الحدث (بالدقائق)
            </label>
            <input
              type="number"
              min={1}
              max={10080}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الحد الأقصى اليومي لإشعارات كل متجر لمتابعيه
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxDailyNotifications}
              onChange={(e) => setMaxDailyNotifications(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
            />
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-black"
          >
            {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </form>
      )}

      {/* Moderation Reason Modal */}
      {modTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <h3 className="text-sm font-black text-slate-900">
              {modTarget.nextStatus === 'hidden' ? 'تأكيد إخفاء التقييم' : 'تأكيد إعادة إظهار التقييم'}
            </h3>
            <p className="text-xs text-slate-600">
              {modTarget.nextStatus === 'hidden'
                ? 'سيتم إخفاء هذا التقييم من صفحة المتجر واستبعاده فورًا من المتوسط العام مع تسجيل الإجراء في سجل التدقيق.'
                : 'سيتم إعادة إظهار هذا التقييم للعملاء واحتسابه مجددًا في المتوسط العام.'}
            </p>
            {modTarget.nextStatus === 'hidden' && (
              <input
                type="text"
                value={modReason}
                onChange={(e) => setModReason(e.target.value)}
                placeholder="سبب الإخفاء (مطلوب للتوثيق)"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={modBusy}
                onClick={() => void handleConfirmModerate()}
                className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold"
              >
                {modBusy ? 'جاري التنفيذ...' : 'تأكيد الإجراء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
