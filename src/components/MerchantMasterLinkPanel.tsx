import React, { useEffect, useState } from 'react';
import {
  Barcode,
  CheckCircle2,
  Gift,
  Layers,
  Link2,
  PackagePlus,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { CategoryPathPicker } from './CategoryPathPicker';
import type {
  CategoryRecord,
  MasterProductMatchCandidate,
  ProductMatchingRequestRecord,
  ProductRecord,
} from '../shared/types';

interface Props {
  merchantId: string;
  categories: CategoryRecord[];
  merchantProducts: ProductRecord[];
  onRefresh: () => void;
  onToast: (msg: string) => void;
}

export const MerchantMasterLinkPanel: React.FC<Props> = ({
  merchantId,
  categories,
  merchantProducts,
  onRefresh,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<'match' | 'requests' | 'deals'>('match');

  // Smart matching search state
  const [queryName, setQueryName] = useState('');
  const [queryBrand, setQueryBrand] = useState('');
  const [querySize, setQuerySize] = useState('');
  const [queryBarcode, setQueryBarcode] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<{
    match_status: 'exact' | 'possible' | 'none';
    exact_match: MasterProductMatchCandidate | null;
    candidates: MasterProductMatchCandidate[];
    size_conflict_warning?: string | null;
  } | null>(null);

  // Selected master for linking
  const [selectedMaster, setSelectedMaster] = useState<MasterProductMatchCandidate | null>(null);
  const [linkForm, setLinkForm] = useState({
    base_price: '',
    sale_price: '',
    stock_quantity: '20',
    min_order_qty: '1',
    merchant_sku: '',
    category_id: '',
  });
  const [savingLink, setSavingLink] = useState(false);

  // Request new product form (when not found)
  const [reqForm, setReqForm] = useState({
    category_id: 'cat_grocery',
    category_path: '',
    proposed_price: '',
    proposed_stock: '15',
    image_url: '',
    description: '',
  });
  const [myRequests, setMyRequests] = useState<ProductMatchingRequestRecord[]>([]);

  // Deals state
  const [deals, setDeals] = useState<any[]>([]);
  const [dealForm, setDealForm] = useState({
    product_id: '',
    deal_type: 'free_gift' as 'buy_x_get_y' | 'bundle_discount' | 'free_gift' | 'tier_qty' | 'free_delivery',
    title_ar: '',
    subtitle_ar: '',
    required_qty: '1',
    free_qty: '1',
    discount_amount: '0',
    discount_percent: '0',
    gift_product_id: '',
  });

  const loadMyRequests = async () => {
    try {
      const rows = await api.getMerchantMatchingRequests(merchantId);
      setMyRequests(rows || []);
    } catch {
      // ignore
    }
  };

  const loadDeals = async () => {
    try {
      const rows = await api.getProductDeals({ merchant_id: merchantId });
      setDeals(rows || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (subTab === 'requests') void loadMyRequests();
    if (subTab === 'deals') void loadDeals();
  }, [subTab, merchantId]);

  const handleRunMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryName.trim() && !queryBarcode.trim()) {
      onToast('أدخل اسم المنتج أو الباركود أولاً للبحث في الكتالوج المركزي');
      return;
    }
    setMatching(true);
    setSelectedMaster(null);
    try {
      const res = await api.matchMasterCatalog({
        name_ar: queryName.trim(),
        brand: queryBrand.trim(),
        size_label: querySize.trim(),
        barcode: queryBarcode.trim(),
      });
      setMatchResult(res);
      if (res.exact_match) {
        setSelectedMaster(res.exact_match);
        setLinkForm((prev) => ({ ...prev, category_id: res.exact_match?.category_id || prev.category_id }));
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setMatching(false);
    }
  };

  const handleLinkListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaster) return;
    if (!linkForm.base_price || Number(linkForm.base_price) <= 0) {
      onToast('أدخل سعر المتجر بشكل صحيح');
      return;
    }
    setSavingLink(true);
    try {
      const res = await api.linkMerchantMasterListing({
        merchant_id: merchantId,
        master_product_id: selectedMaster.id,
        category_id: linkForm.category_id || selectedMaster.category_id || 'cat_grocery',
        base_price: Number(linkForm.base_price),
        sale_price: linkForm.sale_price ? Number(linkForm.sale_price) : null,
        stock_quantity: Number(linkForm.stock_quantity || 10),
        min_order_qty: Number(linkForm.min_order_qty || 1),
        merchant_sku: linkForm.merchant_sku.trim(),
        is_available: true,
      });
      onToast(
        res.updated_existing
          ? 'تم تحديث سعر ومخزون متجرك لهذا المنتج المركزي بنجاح'
          : 'تم ربط المنتج بمتجرك بنجاح وسيظهر الآن في مقارنة الأسعار!'
      );
      setSelectedMaster(null);
      setMatchResult(null);
      setQueryName('');
      setQueryBarcode('');
      setLinkForm({ base_price: '', sale_price: '', stock_quantity: '20', min_order_qty: '1', merchant_sku: '', category_id: '' });
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingLink(false);
    }
  };

  const handleSubmitNewRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryName.trim() || !reqForm.proposed_price) {
      onToast('اسم المنتج والسعر المقترح مطلوبان');
      return;
    }
    try {
      await api.requestNewMasterProduct({
        merchant_id: merchantId,
        product_name_ar: queryName.trim(),
        brand: queryBrand.trim(),
        size_label: querySize.trim(),
        barcode: queryBarcode.trim() || null,
        category_id: reqForm.category_id,
        category_path: reqForm.category_path.trim() || undefined,
        proposed_price: Number(reqForm.proposed_price),
        proposed_stock: Number(reqForm.proposed_stock || 10),
        image_url: reqForm.image_url.trim(),
        description: reqForm.description.trim(),
      });
      onToast('تم إرسال طلب إضافة المنتج للإدارة بنجاح — سيتم ربطه بمتجرك فور الاعتماد');
      setSubTab('requests');
      await loadMyRequests();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealForm.product_id || !dealForm.title_ar.trim()) {
      onToast('اختر المنتج وأدخل عنوان عرض التوفير');
      return;
    }
    try {
      await api.createProductDeal({
        merchant_id: merchantId,
        product_id: dealForm.product_id,
        deal_type: dealForm.deal_type,
        title_ar: dealForm.title_ar.trim(),
        subtitle_ar: dealForm.subtitle_ar.trim(),
        required_qty: Number(dealForm.required_qty || 1),
        free_qty: Number(dealForm.free_qty || 0),
        discount_amount: Number(dealForm.discount_amount || 0),
        discount_percent: Number(dealForm.discount_percent || 0),
        gift_product_ids: dealForm.gift_product_id ? [dealForm.gift_product_id] : [],
      });
      onToast('تم إنشاء عرض التوفير بنجاح وسيظهر للعملاء داخل بطاقة المنتج!');
      setDealForm({
        product_id: '',
        deal_type: 'free_gift',
        title_ar: '',
        subtitle_ar: '',
        required_qty: '1',
        free_qty: '1',
        discount_amount: '0',
        discount_percent: '0',
        gift_product_id: '',
      });
      await loadDeals();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const availableCategories = categories.filter((c) => !c.merchant_id || c.merchant_id === merchantId);

  return (
    <div className="bg-white rounded-3xl border border-red-200/80 shadow-sm overflow-hidden" dir="rtl">
      <div className="bg-gradient-to-l from-[#A92224] to-[#86191B] text-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-[#F5A623] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            الكتالوج المركزي الموحّد للتاجر
          </div>
          <h3 className="font-black text-base mt-0.5">
            ربط منتجات متجرك بالكتالوج المركزي وعروض التوفير
          </h3>
        </div>
        <div className="flex items-center gap-1.5 bg-white/10 p-1 rounded-2xl">
          {[
            { id: 'match', label: 'بحث وربط منتج', icon: Link2 },
            { id: 'requests', label: 'طلبات المنتجات الجديدة', icon: PackagePlus },
            { id: 'deals', label: 'عروض التوفير والهدايا', icon: Gift },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  subTab === t.id ? 'bg-[#F5A623] text-[#3B180E]' : 'text-white/90 hover:bg-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* SUBTAB 1: SEARCH & LINK FROM MASTER CATALOG */}
        {subTab === 'match' && (
          <>
            <form onSubmit={handleRunMatch} className="grid grid-cols-1 md:grid-cols-5 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <div className="md:col-span-2">
                <label className="text-[11px] font-bold text-slate-600">اسم المنتج</label>
                <input
                  value={queryName}
                  onChange={(e) => setQueryName(e.target.value)}
                  placeholder="مثال: نسكافيه كلاسيك 200 جرام"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600">العلامة التجارية</label>
                <input
                  value={queryBrand}
                  onChange={(e) => setQueryBrand(e.target.value)}
                  placeholder="نسكافيه"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600">الوزن / الحجم</label>
                <input
                  value={querySize}
                  onChange={(e) => setQuerySize(e.target.value)}
                  placeholder="200 جرام / 1 لتر"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                  <Barcode className="w-3 h-3" /> الباركود (اختياري)
                </label>
                <input
                  value={queryBarcode}
                  onChange={(e) => setQueryBarcode(e.target.value)}
                  placeholder="622103..."
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white font-mono"
                />
              </div>
              <div className="md:col-span-5 flex justify-end">
                <button
                  type="submit"
                  disabled={matching}
                  className="px-5 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  {matching ? 'جاري البحث والمطابقة الذكية...' : 'بحث في الكتالوج المركزي'}
                </button>
              </div>
            </form>

            {matchResult?.size_conflict_warning && (
              <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 font-bold">
                {matchResult.size_conflict_warning}
              </div>
            )}

            {matchResult && matchResult.candidates.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#F5A623]" />
                  {matchResult.match_status === 'exact'
                    ? 'تم العثور على تطابق تام في الكتالوج المركزي — اختره لربط سعرك ومخزونك فورًا:'
                    : 'منتجات مطابقة محتملة — اختر المنتج المطابق في العلامة والحجم أو أرسل طلب منتج جديد:'}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {matchResult.candidates.map((c) => {
                    const isPicked = selectedMaster?.id === c.id;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setSelectedMaster(c);
                          setLinkForm((prev) => ({ ...prev, category_id: c.category_id || prev.category_id }));
                        }}
                        className={`text-right p-3 rounded-2xl border-2 transition cursor-pointer flex items-center gap-3 ${
                          isPicked
                            ? 'border-[#A92224] bg-red-50/70'
                            : 'border-slate-200 hover:border-red-300 bg-white'
                        }`}
                      >
                        {c.image_url ? (
                          <img src={c.image_url} alt={c.canonical_name_ar} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-[#A92224] font-black shrink-0">
                            {c.confidence_score}%
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 text-sm truncate">{c.canonical_name_ar}</div>
                          <div className="text-xs text-slate-500">
                            {c.brand || 'بدون علامة'} · <b className="text-[#A92224]">{c.size_label || 'حجم قياسي'}</b>
                          </div>
                          <div className="text-[11px] text-emerald-700 font-bold mt-0.5">
                            {c.match_tier === 'exact' ? 'تطابق تام ✓' : `تطابق ${c.confidence_score}%`} · {c.stores_count} متجر
                            {c.lowest_price !== null ? ` · أقل سعر ${c.lowest_price} ج.م` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Store-specific Price & Stock Form for Selected Master */}
            {selectedMaster && (
              <form onSubmit={handleLinkListing} className="rounded-2xl border-2 border-[#A92224] bg-red-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[#A92224]">الخطوة 2: تسعير متجرك المستقل لهذا المنتج</div>
                    <div className="font-black text-slate-900">
                      {selectedMaster.canonical_name_ar} ({selectedMaster.size_label || 'قياسي'})
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                    لا يؤثر على أسعار المتاجر الأخرى
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">السعر الأساسي (ج.م) *</label>
                    <input
                      required
                      type="number"
                      step="0.5"
                      value={linkForm.base_price}
                      onChange={(e) => setLinkForm({ ...linkForm, base_price: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">سعر العرض (اختياري)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={linkForm.sale_price}
                      onChange={(e) => setLinkForm({ ...linkForm, sale_price: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">المخزون المتاح</label>
                    <input
                      type="number"
                      value={linkForm.stock_quantity}
                      onChange={(e) => setLinkForm({ ...linkForm, stock_quantity: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">أقل كمية طلب</label>
                    <input
                      type="number"
                      min={1}
                      value={linkForm.min_order_qty}
                      onChange={(e) => setLinkForm({ ...linkForm, min_order_qty: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">كود SKU بمتجرك</label>
                    <input
                      value={linkForm.merchant_sku}
                      onChange={(e) => setLinkForm({ ...linkForm, merchant_sku: e.target.value })}
                      placeholder="اختياري"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingLink}
                    className="px-5 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-black flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {savingLink ? 'جاري الربط...' : 'حفظ وربط المنتج بمتجري'}
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: If not found or none match, allow submitting request to Admin */}
            {matchResult && !selectedMaster && (
              <form onSubmit={handleSubmitNewRequest} className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 space-y-3">
                <div className="font-black text-amber-950 text-sm flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-[#A92224]" />
                  المنتج غير موجود في الكتالوج المركزي؟ أرسل طلب إضافة للإدارة
                </div>
                <p className="text-xs text-amber-900">
                  سيتم مراجعة الطلب واعتماده كمنتج مركزي رسمي وربط متجرك به تلقائيًا دون تكرار.
                </p>
                <CategoryPathPicker
                  categories={availableCategories}
                  valueCategoryId={reqForm.category_id}
                  valueCategoryPath={reqForm.category_path}
                  compact
                  label="مسار الصنف في الأقسام (رئيسي ← فرعي ← القسم الأخير)"
                  onChange={({ category_id, category_path }) =>
                    setReqForm((prev) => ({ ...prev, category_id, category_path }))
                  }
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <input
                    required
                    type="number"
                    step="0.5"
                    value={reqForm.proposed_price}
                    onChange={(e) => setReqForm({ ...reqForm, proposed_price: e.target.value })}
                    placeholder="سعرك المقترح (ج.م) *"
                    className="px-3 py-2 rounded-xl border border-amber-200 text-sm bg-white"
                  />
                  <input
                    type="number"
                    value={reqForm.proposed_stock}
                    onChange={(e) => setReqForm({ ...reqForm, proposed_stock: e.target.value })}
                    placeholder="المخزون"
                    className="px-3 py-2 rounded-xl border border-amber-200 text-sm bg-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    إرسال للمراجعة
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* SUBTAB 2: MY SUBMITTED REQUESTS */}
        {subTab === 'requests' && (
          <div className="space-y-2">
            {myRequests.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">
                لم ترسل أي طلبات منتجات جديدة بعد.
              </div>
            ) : (
              myRequests.map((r) => (
                <div key={r.id} className="rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-black text-slate-900 text-sm">{r.product_name_ar}</span>
                    {r.size_label && <span className="mr-2 text-[#A92224] font-bold">({r.size_label})</span>}
                    <div className="text-slate-500 mt-0.5">
                      السعر المقترح: {r.proposed_price} ج.م · {r.admin_note || 'بانتظار مراجعة الإدارة'}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full font-bold ${
                    r.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : r.status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {r.status === 'pending'
                      ? 'قيد المراجعة'
                      : r.status === 'approved_new'
                      ? 'تم الاعتماد والربط ✓'
                      : r.status === 'linked_existing'
                      ? 'تم الربط بمنتج موجود ✓'
                      : 'مرفوض'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* SUBTAB 3: SAVINGS DEALS & GIFTS */}
        {subTab === 'deals' && (
          <div className="space-y-4">
            <form onSubmit={handleCreateDeal} className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <select
                required
                value={dealForm.product_id}
                onChange={(e) => setDealForm({ ...dealForm, product_id: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="">اختر المنتج المشمول بالعرض *</option>
                {merchantProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_ar} ({p.sale_price ?? p.base_price} ج.م)
                  </option>
                ))}
              </select>
              <select
                value={dealForm.deal_type}
                onChange={(e) => setDealForm({ ...dealForm, deal_type: e.target.value as any })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="free_gift">هدية مجانية مع المنتج</option>
                <option value="buy_x_get_y">اشترِ منتجًا واحصل على إضافي</option>
                <option value="bundle_discount">عرض باقة / توفير عند إكمال مجموعة</option>
                <option value="tier_qty">خصم عند شراء كمية</option>
                <option value="free_delivery">توصيل مجاني مع المنتج</option>
              </select>
              <input
                required
                value={dealForm.title_ar}
                onChange={(e) => setDealForm({ ...dealForm, title_ar: e.target.value })}
                placeholder="عنوان العرض (مثال: هدية مجانية مع هذا المنتج)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <input
                type="number"
                min={1}
                value={dealForm.required_qty}
                onChange={(e) => setDealForm({ ...dealForm, required_qty: e.target.value })}
                placeholder="العدد المطلوب (مثال: 2)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <input
                type="number"
                value={dealForm.discount_amount}
                onChange={(e) => setDealForm({ ...dealForm, discount_amount: e.target.value })}
                placeholder="قيمة التوفير (ج.م)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <select
                value={dealForm.gift_product_id}
                onChange={(e) => setDealForm({ ...dealForm, gift_product_id: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="">منتج الهدية / المكمل (اختياري)</option>
                {merchantProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name_ar}</option>
                ))}
              </select>
              <div className="md:col-span-3 flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Tag className="w-3.5 h-3.5" />
                  تفعيل عرض التوفير
                </button>
              </div>
            </form>

            {deals.length > 0 && (
              <div className="space-y-2">
                {deals.map((d) => (
                  <div key={d.id} className="rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{d.title_ar}</div>
                      <div className="text-slate-500">
                        {d.product_name_ar} · توفير {d.discount_amount} ج.م · مطلوب {d.required_qty}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteProductDeal(d.id);
                        onToast('تم حذف العرض');
                        await loadDeals();
                      }}
                      className="p-2 rounded-xl text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
