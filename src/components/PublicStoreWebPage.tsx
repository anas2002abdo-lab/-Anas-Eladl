import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  Clock,
  ExternalLink,
  Flag,
  Heart,
  MapPin,
  Package,
  Plus,
  Search,
  Share2,
  ShoppingCart,
  Smartphone,
  Star,
  Store,
  Tag,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';

interface PublicStoreWebPageProps {
  merchantId: string;
  embedded?: boolean;
  cart?: Record<string, number>;
  onAddProduct?: (product: any, delta: number) => void;
  onOpenCart?: () => void;
  onBack?: () => void;
  onOpenPlatform?: () => void;
  onNotify?: (msg: string) => void;
}

export const PublicStoreWebPage: React.FC<PublicStoreWebPageProps> = ({
  merchantId,
  embedded = false,
  cart = {},
  onAddProduct,
  onOpenCart,
  onBack,
  onOpenPlatform,
  onNotify,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeData, setStoreData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'products' | 'reviews' | 'about'>('products');

  // Products state
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [offersOnly, setOffersOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('default');

  // Reviews state
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsSummary, setReviewsSummary] = useState<any>(null);
  const [reviewSort, setReviewSort] = useState<'newest' | 'highest' | 'lowest'>('newest');
  const [loadingReviews, setLoadingReviews] = useState(false);

  // Follow & Notification Prefs
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [prefs, setPrefs] = useState({
    notify_new_offers: true,
    notify_discounts: true,
    notify_new_products: true,
    notify_back_in_stock: true,
  });

  // Review composer modal
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [reviewOrderId, setReviewOrderId] = useState('');
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Report modal
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('تعليق مسيء أو غير لائق');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const [localToast, setLocalToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    if (onNotify) {
      onNotify(msg);
      return;
    }
    setLocalToast(msg);
    setTimeout(() => setLocalToast(null), 3500);
  };

  const loadStore = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStorePage(merchantId);
      setStoreData(data);
      const s = data.store || {};
      const cs = data.customer_state || {};
      setFollowing(Boolean(cs.is_following));
      setFollowersCount(Number(s.followers_count || 0));
      if (cs.notification_prefs) {
        setPrefs({
          notify_new_offers: Boolean(cs.notification_prefs.notify_new_offers),
          notify_discounts: Boolean(cs.notification_prefs.notify_discounts),
          notify_new_products: Boolean(cs.notification_prefs.notify_new_products),
          notify_back_in_stock: Boolean(cs.notification_prefs.notify_back_in_stock),
        });
      }
      if (!embedded && typeof document !== 'undefined' && s.business_name_ar) {
        document.title = `${s.business_name_ar} – اطلبها Otlobha`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل صفحة المتجر');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async (reset: boolean) => {
    const nextPage = reset ? 1 : page + 1;
    setLoadingProducts(true);
    try {
      const res = await api.getStoreProducts(merchantId, {
        category_id: selectedCategoryId || undefined,
        offers_only: offersOnly,
        q: searchQuery.trim() || undefined,
        sort: sortBy,
        page: nextPage,
        limit: 24,
      });
      setProducts((prev) => (reset ? res.products || [] : [...prev, ...(res.products || [])]));
      setPage(nextPage);
      setHasMore(Boolean(res.pagination?.has_more));
      setTotalProducts(Number(res.pagination?.total || 0));
    } catch {
      // keep existing products
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadReviews = async () => {
    setLoadingReviews(true);
    try {
      const res = await api.getStoreReviews(merchantId, { sort: reviewSort, page: 1, limit: 25 });
      setReviews(res.reviews || []);
      setReviewsSummary(res.summary || null);
    } catch {
      // ignore
    } finally {
      setLoadingReviews(false);
    }
  };

  useEffect(() => {
    void loadStore();
  }, [merchantId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadProducts(true);
    }, 180);
    return () => clearTimeout(t);
  }, [merchantId, selectedCategoryId, offersOnly, searchQuery, sortBy]);

  useEffect(() => {
    void loadReviews();
  }, [merchantId, reviewSort]);

  const handleToggleFollow = async () => {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      if (following) {
        const res = await api.unfollowStore(merchantId);
        setFollowing(false);
        setFollowersCount(Number(res.followers_count ?? Math.max(0, followersCount - 1)));
        showToast('تم إلغاء متابعة المتجر');
      } else {
        const res = await api.followStore(merchantId, prefs);
        setFollowing(true);
        setFollowersCount(Number(res.followers_count ?? followersCount + 1));
        showToast('تمت متابعة المتجر — ستصلك إشعارات أحدث العروض والمنتجات');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'يرجى تسجيل الدخول كعميل لمتابعة المتجر');
    } finally {
      setFollowBusy(false);
    }
  };

  const handleSavePrefs = async () => {
    try {
      await api.updateStoreFollowPreferences(merchantId, prefs);
      setShowPrefsModal(false);
      showToast('تم حفظ تفضيلات إشعارات المتجر');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ التفضيلات');
    }
  };

  const handleShareStore = async () => {
    const shareUrl =
      storeData?.store?.share_url ||
      (typeof window !== 'undefined' ? `${window.location.origin}/store/${encodeURIComponent(merchantId)}` : '');
    const storeName = storeData?.store?.business_name_ar || 'متجر في اطلبها';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `${storeName} – اطلبها`, url: shareUrl });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('تم نسخ رابط المتجر للمشاركة');
    } catch {
      showToast(shareUrl);
    }
  };

  const openWriteReview = (existing?: any) => {
    const eligible = storeData?.customer_state?.eligible_orders_for_review || [];
    if (existing) {
      setEditingReviewId(existing.id);
      setReviewStars(Number(existing.rating || 5));
      setReviewComment(String(existing.comment || ''));
      setReviewOrderId('');
      setShowReviewModal(true);
      return;
    }
    if (!eligible.length) {
      showToast('يمكن تقييم المتجر فقط بعد إتمام واستلام طلب فعلي منه');
      return;
    }
    setEditingReviewId(null);
    setReviewOrderId(eligible[0].order_id);
    setReviewStars(5);
    setReviewComment('');
    setShowReviewModal(true);
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingReview(true);
    try {
      if (editingReviewId) {
        await api.updateStoreReview(merchantId, editingReviewId, {
          rating: reviewStars,
          comment: reviewComment.trim(),
        });
        showToast('تم تعديل تقييمك بنجاح');
      } else {
        await api.submitStoreReview(merchantId, {
          order_id: reviewOrderId,
          rating: reviewStars,
          comment: reviewComment.trim(),
        });
        showToast('تم نشر تقييمك للمتجر بنجاح');
      }
      setShowReviewModal(false);
      await Promise.all([loadStore(), loadReviews()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ التقييم');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTargetId) return;
    setSubmittingReport(true);
    try {
      await api.reportReview({
        review_type: 'store',
        review_id: reportTargetId,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setReportTargetId(null);
      setReportDetails('');
      showToast('تم إرسال البلاغ لمراجعة الإدارة');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'يرجى تسجيل الدخول للإبلاغ عن تعليق');
    } finally {
      setSubmittingReport(false);
    }
  };

  const store = storeData?.store;
  const storeCategories: any[] = storeData?.categories || [];
  const deals: any[] = storeData?.deals || [];
  const eligibleOrders: any[] = storeData?.customer_state?.eligible_orders_for_review || [];
  const summary = reviewsSummary || {
    rating_avg: store?.rating_avg || 0,
    rating_count: store?.rating_count || 0,
    distribution: store?.rating_distribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  };
  const cartTotalCount = Object.values(cart).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#FAF9F7] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-2 border-[#A92224] border-t-transparent animate-spin" />
          <p className="text-sm font-semibold text-slate-600">جاري تحميل صفحة المتجر...</p>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#FAF9F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
          <Store className="w-12 h-12 text-[#A92224] mx-auto" />
          <h1 className="text-lg font-black text-slate-900">{error || 'المتجر غير موجود'}</h1>
          <p className="text-sm text-slate-500">تأكد من صحة رابط المتجر أو تصفح المتاجر المتاحة على منصة اطلبها.</p>
          <div className="flex items-center justify-center gap-3 pt-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                رجوع
              </button>
            )}
            {onOpenPlatform && (
              <button
                type="button"
                onClick={onOpenPlatform}
                className="px-5 py-2 rounded-xl bg-[#A92224] text-white text-sm font-bold hover:bg-[#8E1B1D]"
              >
                فتح منصة اطلبها
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const deepLinkHref = store.deep_link_url || `otlobha://store/${encodeURIComponent(store.id)}`;

  return (
    <div dir="rtl" className={`${embedded ? 'bg-[#FAF9F7] min-h-full' : 'min-h-screen bg-[#FAF9F7]'} text-slate-900`}>
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-700 shrink-0"
                aria-label="رجوع"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
              <img
                src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                alt="اطلبها"
                className="w-8 h-8 rounded-lg object-contain border border-slate-200 bg-white shrink-0"
              />
            )}
            <div className="min-w-0">
              <div className="text-sm font-black text-slate-900 truncate">{store.business_name_ar}</div>
              <div className="text-[11px] text-slate-500 truncate">متجر معتمد على منصة اطلبها – المنزلة</div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleShareStore}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">مشاركة</span>
            </button>
            {embedded && onOpenCart ? (
              <button
                type="button"
                onClick={onOpenCart}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#A92224] text-white text-xs font-bold"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span className="tabular-nums">السلة ({cartTotalCount})</span>
              </button>
            ) : (
              <a
                href={deepLinkHref}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-bold"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>فتح في التطبيق</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {localToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg">
          {localToast}
        </div>
      )}

      {/* Store Hero Cover & Identity */}
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-12 space-y-5">
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="relative h-44 sm:h-56 bg-gradient-to-l from-[#7F1517] via-[#A92224] to-[#C2410C]">
            {store.cover_image_url ? (
              <img
                src={store.cover_image_url}
                alt={store.business_name_ar}
                className="w-full h-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-4 right-5 left-5 flex items-end justify-between gap-4">
              <div className="flex items-end gap-3.5 min-w-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white border-2 border-white shadow-md overflow-hidden flex items-center justify-center shrink-0">
                  {store.image_url ? (
                    <img src={store.image_url} alt={store.business_name_ar} className="w-full h-full object-cover" />
                  ) : (
                    <Store className="w-8 h-8 text-[#A92224]" />
                  )}
                </div>
                <div className="text-white min-w-0 pb-0.5">
                  <h1 className="text-xl sm:text-2xl font-black truncate">{store.business_name_ar}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/90 mt-1">
                    <span className="inline-flex items-center gap-1 font-bold">
                      <span
                        className={`w-2 h-2 rounded-full ${store.is_open_now ? 'bg-emerald-400' : 'bg-rose-400'}`}
                      />
                      {store.is_open_now ? 'مفتوح الآن' : 'مغلق حاليًا'}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Star className="w-3.5 h-3.5 fill-[#F5A623] text-[#F5A623]" />
                      <strong className="font-black">
                        {Number(summary.rating_count || 0) > 0 ? Number(summary.rating_avg || 0).toFixed(1) : 'جديد'}
                      </strong>
                      <span>({Number(summary.rating_count || 0)} تقييم)</span>
                    </span>
                    <span className="tabular-nums">{followersCount} متابع</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {store.description_ar && (
              <p className="text-sm text-slate-600 leading-relaxed">{store.description_ar}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
              {store.working_hours && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#A92224]" />
                  <span>ساعات العمل: {store.working_hours}</span>
                </span>
              )}
              {(store.address_detail || store.zone_name) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-[#A92224]" />
                  <span>{store.address_detail || store.zone_name}</span>
                </span>
              )}
            </div>

            {/* Primary Action Row */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={followBusy}
                onClick={handleToggleFollow}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                  following
                    ? 'bg-rose-50 text-[#A92224] border border-rose-200 hover:bg-rose-100'
                    : 'bg-[#A92224] text-white hover:bg-[#8E1B1D]'
                }`}
              >
                <Heart className={`w-4 h-4 ${following ? 'fill-[#A92224]' : ''}`} />
                <span>{following ? 'متابَع' : 'متابعة المتجر'}</span>
              </button>

              {following && (
                <button
                  type="button"
                  onClick={() => setShowPrefsModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Bell className="w-4 h-4 text-amber-600" />
                  <span>تفضيلات الإشعارات</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleShareStore}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Share2 className="w-4 h-4" />
                <span>مشاركة رابط المتجر</span>
              </button>

              {!embedded && onOpenPlatform && (
                <button
                  type="button"
                  onClick={onOpenPlatform}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 ms-auto"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>تصفح منصة اطلبها</span>
                </button>
              )}
            </div>
          </div>

          {/* Section Tabs */}
          <div className="border-t border-slate-200 px-5 flex items-center gap-6 bg-slate-50/70">
            {[
              { id: 'products' as const, label: `المنتجات (${totalProducts})` },
              { id: 'reviews' as const, label: `التقييمات (${Number(summary.rating_count || 0)})` },
              { id: 'about' as const, label: 'عن المتجر' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`py-3 text-sm font-bold border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-[#A92224] text-[#A92224]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* TAB 1: PRODUCTS */}
        {activeTab === 'products' && (
          <div className="space-y-4">
            {/* Active Deals Strip */}
            {deals.length > 0 && (
              <section className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-amber-900 font-black text-sm mb-2.5">
                  <Tag className="w-4 h-4" />
                  <span>عروض وتخفيضات المتجر الحالية</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {deals.map((d: any) => (
                    <div key={d.id} className="bg-white border border-amber-200/80 rounded-xl p-3">
                      <div className="text-xs font-black text-slate-900">{d.title_ar}</div>
                      {d.subtitle_ar && <div className="text-[11px] text-slate-600 mt-0.5">{d.subtitle_ar}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Search, Sort & Internal Store Categories (reusing existing categories) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث داخل منتجات المتجر..."
                    className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#A92224]"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white text-slate-700"
                >
                  <option value="default">الترتيب الافتراضي</option>
                  <option value="price_asc">الأقل سعرًا</option>
                  <option value="price_desc">الأعلى سعرًا</option>
                  <option value="offers">العروض أولًا</option>
                  <option value="newest">الأحدث</option>
                </select>
                <button
                  type="button"
                  onClick={() => setOffersOnly((prev) => !prev)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
                    offersOnly
                      ? 'bg-[#A92224] text-white border-[#A92224]'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  العروض فقط
                </button>
              </div>

              {storeCategories.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId('')}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      selectedCategoryId === ''
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    كل الأقسام
                  </button>
                  {storeCategories.map((cat: any) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.id === selectedCategoryId ? '' : cat.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        selectedCategoryId === cat.id
                          ? 'bg-[#A92224] text-white border-[#A92224]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cat.name_ar} <span className="opacity-75 tabular-nums">({cat.products_count})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Products Grid */}
            {loadingProducts && products.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">جاري تحميل المنتجات...</div>
            ) : products.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
                <Package className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="text-sm font-bold text-slate-700">لا توجد منتجات مطابقة حاليًا</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {products.map((p: any) => {
                    const qty = cart[p.id] || 0;
                    const hasDisc = p.sale_price != null && Number(p.sale_price) < Number(p.base_price);
                    return (
                      <article
                        key={p.id}
                        className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col hover:border-slate-300 transition-colors"
                      >
                        <div className="relative aspect-[4/3] bg-slate-50 flex items-center justify-center p-3">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name_ar} className="w-full h-full object-contain" />
                          ) : (
                            <Package className="w-10 h-10 text-slate-300" />
                          )}
                          {p.discount_percent > 0 && (
                            <span className="absolute top-2 right-2 bg-[#A92224] text-white text-[10px] font-black px-2 py-0.5 rounded-md tabular-nums">
                              -{p.discount_percent}%
                            </span>
                          )}
                          {!p.is_available && (
                            <span className="absolute inset-0 bg-white/75 flex items-center justify-center text-xs font-black text-slate-700">
                              غير متوفر حاليًا
                            </span>
                          )}
                        </div>
                        <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                          <div>
                            <div className="text-[11px] text-slate-500 truncate">{p.category_name_ar || ''}</div>
                            <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2 mt-0.5 leading-snug">
                              {p.name_ar}
                            </h3>
                            {p.is_weighted && (
                              <div className="text-[10.5px] font-semibold text-teal-700 mt-1">
                                يُباع بالوزن ({p.weight_step} {p.weight_unit})
                              </div>
                            )}
                            {Number(p.product_rating_count || 0) > 0 && (
                              <div className="inline-flex items-center gap-1 text-[11px] text-slate-600 mt-1 tabular-nums">
                                <Star className="w-3 h-3 fill-[#F5A623] text-[#F5A623]" />
                                <span className="font-bold">{Number(p.product_rating_avg).toFixed(1)}</span>
                                <span>({p.product_rating_count})</span>
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-end justify-between gap-2">
                            <div className="tabular-nums">
                              <div className="text-sm font-black text-slate-900">
                                {Number(p.effective_price).toFixed(p.effective_price % 1 === 0 ? 0 : 2)} ج.م
                              </div>
                              {hasDisc && (
                                <div className="text-[11px] text-slate-400 line-through">
                                  {Number(p.base_price).toFixed(p.base_price % 1 === 0 ? 0 : 2)} ج.م
                                </div>
                              )}
                            </div>

                            {onAddProduct && p.is_available ? (
                              qty > 0 ? (
                                <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg px-1.5 py-1">
                                  <button
                                    type="button"
                                    onClick={() => onAddProduct(p, 1)}
                                    className="w-6 h-6 rounded-md bg-[#A92224] text-white flex items-center justify-center text-xs font-black"
                                  >
                                    +
                                  </button>
                                  <span className="text-xs font-black text-slate-900 px-1 tabular-nums">{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() => onAddProduct(p, -1)}
                                    className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center justify-center text-xs font-black"
                                  >
                                    -
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onAddProduct(p, 1)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-bold"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>أضف</span>
                                </button>
                              )
                            ) : (
                              <a
                                href={deepLinkHref}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-[#A92224] hover:text-[#A92224] text-[11px] font-bold text-slate-700"
                              >
                                اطلب الآن
                              </a>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="text-center pt-2">
                    <button
                      type="button"
                      disabled={loadingProducts}
                      onClick={() => void loadProducts(false)}
                      className="px-6 py-2.5 rounded-xl border border-[#A92224] text-[#A92224] hover:bg-rose-50 text-xs font-black"
                    >
                      {loadingProducts ? 'جاري التحميل...' : 'عرض المزيد من المنتجات'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 2: STORE REVIEWS */}
        {activeTab === 'reviews' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Summary Column */}
            <aside className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 h-fit">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-black text-slate-900 tabular-nums">
                    {Number(summary.rating_count || 0) > 0 ? Number(summary.rating_avg || 0).toFixed(1) : '0.0'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    من 5 · {Number(summary.rating_count || 0)} تقييم موثق
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-4 h-4 ${
                        s <= Math.round(Number(summary.rating_avg || 0))
                          ? 'fill-[#F5A623] text-[#F5A623]'
                          : 'text-slate-200'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                {[5, 4, 3, 2, 1].map((star) => {
                  const cnt = Number(summary.distribution?.[star] || 0);
                  const pct = Number(summary.rating_count || 0) > 0 ? Math.round((cnt / summary.rating_count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs tabular-nums">
                      <span className="w-8 font-bold text-slate-700">{star} ★</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#F5A623]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-left text-slate-500">{cnt}</span>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => openWriteReview()}
                className="w-full py-2.5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-black"
              >
                {eligibleOrders.length > 0 ? 'أضف تقييمك للمتجر' : 'تقييم المتجر (للمشترين فقط)'}
              </button>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                التقييمات مقتصرة على العملاء أصحاب الطلبات المكتملة فقط لضمان الشفافية ومنع التقييمات الوهمية.
              </p>
            </aside>

            {/* Reviews Feed */}
            <div className="lg:col-span-2 space-y-3">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900">آراء العملاء</span>
                <div className="flex items-center gap-1.5">
                  {[
                    { id: 'newest' as const, label: 'الأحدث' },
                    { id: 'highest' as const, label: 'الأعلى تقييمًا' },
                    { id: 'lowest' as const, label: 'الأقل تقييمًا' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setReviewSort(s.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold ${
                        reviewSort === s.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {loadingReviews ? (
                <div className="py-10 text-center text-sm text-slate-500">جاري تحميل التقييمات...</div>
              ) : reviews.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
                  لا توجد تعليقات منشورة لهذا المتجر بعد.
                </div>
              ) : (
                reviews.map((r: any) => (
                  <article key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-900">{r.customer_name_display}</span>
                          <span className="text-[11px] font-semibold text-emerald-700">شراء موثق</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <Star
                              key={i}
                              className={`w-3.5 h-3.5 ${
                                i <= Number(r.rating) ? 'fill-[#F5A623] text-[#F5A623]' : 'text-slate-200'
                              }`}
                            />
                          ))}
                          <span className="text-[11px] text-slate-400 ms-2 tabular-nums">
                            {String(r.created_at || '').slice(0, 10)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {r.is_mine && r.can_edit && (
                          <button
                            type="button"
                            onClick={() => openWriteReview(r)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            تعديل
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setReportTargetId(r.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          title="الإبلاغ عن تعليق مسيء"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {r.comment && <p className="text-sm text-slate-700 leading-relaxed">{r.comment}</p>}
                  </article>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ABOUT STORE */}
        {activeTab === 'about' && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-black text-slate-900">معلومات المتجر</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <dt className="text-xs text-slate-500">الحالة الحالية</dt>
                <dd className="font-bold text-slate-900 mt-1">{store.is_open_now ? 'مفتوح ويستقبل الطلبات' : 'مغلق حاليًا'}</dd>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <dt className="text-xs text-slate-500">ساعات العمل</dt>
                <dd className="font-bold text-slate-900 mt-1">{store.working_hours || 'غير محددة'}</dd>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <dt className="text-xs text-slate-500">العنوان والمنطقة</dt>
                <dd className="font-bold text-slate-900 mt-1">{store.address_detail || store.zone_name || 'المنزلة'}</dd>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <dt className="text-xs text-slate-500">رابط المتجر المباشر</dt>
                <dd dir="ltr" className="font-mono text-xs text-slate-700 mt-1 break-all">
                  {store.share_url}
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>

      {/* Notification Preferences Modal */}
      {showPrefsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">تفضيلات إشعارات المتجر</h3>
              <button type="button" onClick={() => setShowPrefsModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              {[
                { key: 'notify_new_offers' as const, label: 'تنبيهات العروض الجديدة' },
                { key: 'notify_discounts' as const, label: 'التخفيضات المؤقتة' },
                { key: 'notify_new_products' as const, label: 'إضافة منتجات جديدة' },
                { key: 'notify_back_in_stock' as const, label: 'عودة المنتجات غير المتوفرة' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50"
                >
                  <span className="font-semibold text-slate-800">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={prefs[item.key]}
                    onChange={(e) => setPrefs((p) => ({ ...p, [item.key]: e.target.checked }))}
                    className="w-4 h-4 accent-[#A92224]"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPrefsModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSavePrefs}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold"
              >
                <Check className="w-4 h-4" />
                <span>حفظ التفضيلات</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Store Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitReview} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                {editingReviewId ? 'تعديل تقييم المتجر' : `تقييم ${store.business_name_ar}`}
              </h3>
              <button type="button" onClick={() => setShowReviewModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            {!editingReviewId && eligibleOrders.length > 1 && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">اختر الطلب المكتمل</label>
                <select
                  value={reviewOrderId}
                  onChange={(e) => setReviewOrderId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
                >
                  {eligibleOrders.map((o: any) => (
                    <option key={o.order_id} value={o.order_id}>
                      طلب #{o.order_number}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => setReviewStars(s)} className="p-1">
                  <Star className={`w-8 h-8 ${s <= reviewStars ? 'fill-[#F5A623] text-[#F5A623]' : 'text-slate-200'}`} />
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              maxLength={1000}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="شاركنا تجربتك مع المتجر (التغليف، سرعة التحضير، جودة المنتجات)..."
              className="w-full p-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#A92224]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submittingReview}
                className="px-5 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold disabled:opacity-60"
              >
                {submittingReview ? 'جاري الحفظ...' : 'حفظ التقييم'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Review Modal */}
      {reportTargetId && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitReport} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">الإبلاغ عن تعليق مخالف</h3>
              <button type="button" onClick={() => setReportTargetId(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
            >
              <option value="تعليق مسيء أو غير لائق">تعليق مسيء أو غير لائق</option>
              <option value="تقييم وهمي أو مضلل">تقييم وهمي أو مضلل</option>
              <option value="محتوى غير متعلق بالمتجر">محتوى غير متعلق بالمتجر</option>
            </select>
            <textarea
              rows={2}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="تفاصيل إضافية للإدارة (اختياري)"
              className="w-full p-3 text-sm border border-slate-200 rounded-xl"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTargetId(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submittingReport}
                className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold"
              >
                {submittingReport ? 'جاري الإرسال...' : 'إرسال البلاغ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
