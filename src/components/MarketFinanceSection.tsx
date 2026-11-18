import React, { useEffect, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CategoryRecord, CouponRecord, Language, MarketListingRecord } from '../shared/types.ts';

interface Props {
  lang: Language;
  mode: 'market' | 'finance';
  onNotify: (msg: string) => void;
  onRefreshOverview: () => Promise<void>;
}

export const MarketFinanceSection: React.FC<Props> = ({ lang, mode, onNotify, onRefreshOverview }) => {
  const isAr = lang === 'ar';
  const [listings, setListings] = useState<MarketListingRecord[]>([]);
  const [marketCategories, setMarketCategories] = useState<CategoryRecord[]>([]);
  const [editingMarketId, setEditingMarketId] = useState<string | null>(null);
  const [marketForm, setMarketForm] = useState({
    seller_name: '',
    seller_phone: '',
    category_ar: 'هواتف وإلكترونيات',
    title: '',
    description: '',
    condition: 'used' as 'new' | 'used',
    price: 500,
    quantity: 1,
    zone_name: 'وسط مدينة المنزلة',
    is_negotiable: true,
    image_url: '',
  });

  const [financeData, setFinanceData] = useState<any>(null);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);

  const [adjustForm, setAdjustForm] = useState({
    wallet_id: '',
    direction: 'credit',
    amount: 50,
    reason: '',
  });

  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'fixed',
    discount_value: 15,
    max_discount: 25,
    min_order_amount: 100,
    funded_by: 'platform',
  });

  const loadData = async () => {
    const [m, cats, f, c] = await Promise.all([
      api.getMarket(),
      api.getCategories('market'),
      api.getFinance(),
      api.getCoupons(),
    ]);
    setListings(m);
    setMarketCategories(cats);
    setFinanceData(f);
    setCoupons(c);
    if (!adjustForm.wallet_id && f.wallets.length > 0) {
      setAdjustForm((prev) => ({ ...prev, wallet_id: f.wallets[0].id }));
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const resetMarketForm = () => {
    setEditingMarketId(null);
    setMarketForm({
      seller_name: '',
      seller_phone: '',
      category_ar: marketCategories[0]?.name_ar || 'هواتف وإلكترونيات',
      title: '',
      description: '',
      condition: 'used',
      price: 500,
      quantity: 1,
      zone_name: 'وسط مدينة المنزلة',
      is_negotiable: true,
      image_url: '',
    });
  };

  const handleMarketAdminImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxW = 1000;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setMarketForm((prev) => ({ ...prev, image_url: canvas.toDataURL('image/jpeg', 0.78) }));
        } else {
          setMarketForm((prev) => ({ ...prev, image_url: rawDataUrl }));
        }
      };
      img.onerror = () => setMarketForm((prev) => ({ ...prev, image_url: rawDataUrl }));
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveMarketListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketForm.title.trim()) return;
    if (editingMarketId) {
      await api.updateMarketListing(editingMarketId, marketForm);
      onNotify(isAr ? 'تم تعديل إعلان السوق بنجاح' : 'Market listing updated');
    } else {
      await api.createMarketListing(marketForm);
      onNotify(isAr ? 'تم نشر الإعلان في سوق اطلبها' : 'Market listing published');
    }
    resetMarketForm();
    await Promise.all([loadData(), onRefreshOverview()]);
  };

  const handleEditMarketListing = (item: MarketListingRecord) => {
    setEditingMarketId(item.id);
    setMarketForm({
      seller_name: item.seller_name,
      seller_phone: item.seller_phone,
      category_ar: item.category_ar,
      title: item.title,
      description: item.description,
      condition: item.condition,
      price: item.price,
      quantity: item.quantity,
      zone_name: item.zone_name,
      is_negotiable: item.is_negotiable,
      image_url: item.image_url || '',
    });
  };

  const handleDeleteMarketListing = async (id: string) => {
    await api.deleteMarketListing(id);
    await Promise.all([loadData(), onRefreshOverview()]);
    onNotify(isAr ? 'تم حذف الإعلان من السوق' : 'Market listing deleted');
  };

  const handleModerate = async (id: string, moderation_status: string) => {
    await api.moderateMarket(id, { moderation_status, reason: `إجراء إداري: ${moderation_status}` });
    await Promise.all([loadData(), onRefreshOverview()]);
    onNotify(
      moderation_status === 'sold'
        ? isAr
          ? 'تم إتمام البيع وتحرير الضمان وترحيل عمولة السوق للدفتر المالي'
          : 'Sale completed & market commission posted'
        : isAr
        ? 'تم تحديث حالة إعلان السوق'
        : 'Market listing updated'
    );
  };

  const handleAdjustWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.adjustWallet({
        ...adjustForm,
        idempotency_key: `ui_adj_${adjustForm.wallet_id}_${Date.now()}`,
      });
      setAdjustForm({ ...adjustForm, reason: '' });
      await Promise.all([loadData(), onRefreshOverview()]);
      onNotify(isAr ? 'تم تنفيذ التسوية المالية وتسجيل القيد المزدوج وسبب التعديل' : 'Ledger adjustment posted');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleSettlement = async (id: string, status: string) => {
    await api.updateSettlement(id, { status });
    await Promise.all([loadData(), onRefreshOverview()]);
    onNotify(isAr ? 'تم تحديث حالة التسوية المالية' : 'Settlement updated');
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.code.trim()) return;
    await api.createCoupon({ ...couponForm, applicable_services: ['stores', 'parcels', 'pharmacy'] });
    setCouponForm({ ...couponForm, code: '' });
    await loadData();
    onNotify(isAr ? 'تم إنشاء الكوبون التسويقي بنجاح' : 'Coupon created');
  };

  if (mode === 'market') {
    return (
      <div className="space-y-6">
        <form onSubmit={handleSaveMarketListing} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              {editingMarketId ? (isAr ? 'تعديل إعلان في السوق' : 'Edit Market Listing') : isAr ? 'أضف إعلانًا جديدًا في السوق (Otlobha Market)' : 'Add Market Listing'}
            </h3>
            {editingMarketId && (
              <button type="button" onClick={resetMarketForm} className="text-xs text-slate-600 underline">
                {isAr ? 'إلغاء التعديل' : 'Cancel'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              required
              placeholder={isAr ? 'اسم المنتج / الإعلان' : 'Listing Title'}
              value={marketForm.title}
              onChange={(e) => setMarketForm({ ...marketForm, title: e.target.value })}
              className="sm:col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <select
              value={marketForm.category_ar}
              onChange={(e) => setMarketForm({ ...marketForm, category_ar: e.target.value })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            >
              {marketCategories.map((c) => (
                <option key={c.id} value={c.name_ar}>
                  {c.name_ar}
                </option>
              ))}
            </select>
            <select
              value={marketForm.condition}
              onChange={(e) => setMarketForm({ ...marketForm, condition: e.target.value as 'new' | 'used' })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            >
              <option value="new">{isAr ? 'حالة: جديد' : 'New'}</option>
              <option value="used">{isAr ? 'حالة: مستعمل' : 'Used'}</option>
            </select>

            <input
              type="number"
              required
              placeholder={isAr ? 'السعر (ج.م)' : 'Price'}
              value={marketForm.price}
              onChange={(e) => setMarketForm({ ...marketForm, price: Number(e.target.value) })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
            />
            <input
              type="number"
              placeholder={isAr ? 'الكمية' : 'Quantity'}
              value={marketForm.quantity}
              onChange={(e) => setMarketForm({ ...marketForm, quantity: Number(e.target.value) })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
            />
            <input
              type="text"
              placeholder={isAr ? 'اسم البائع' : 'Seller Name'}
              value={marketForm.seller_name}
              onChange={(e) => setMarketForm({ ...marketForm, seller_name: e.target.value })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <input
              type="text"
              placeholder={isAr ? 'هاتف البائع' : 'Seller Phone'}
              value={marketForm.seller_phone}
              onChange={(e) => setMarketForm({ ...marketForm, seller_phone: e.target.value })}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <input
              type="text"
              placeholder={isAr ? 'وصف المنتج وطريقة التسليم...' : 'Description...'}
              value={marketForm.description}
              onChange={(e) => setMarketForm({ ...marketForm, description: e.target.value })}
              className="sm:col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder={isAr ? 'رابط صورة المنتج (اختياري) أو ارفع/صور من الكاميرا' : 'Image URL (optional)'}
                value={marketForm.image_url}
                onChange={(e) => setMarketForm({ ...marketForm, image_url: e.target.value })}
                className="flex-1 min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
              <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer">
                <Camera className="w-3.5 h-3.5 text-orange-600" />
                <span>{isAr ? 'كاميرا' : 'Camera'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleMarketAdminImagePick} className="hidden" />
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer">
                <ImagePlus className="w-3.5 h-3.5 text-orange-600" />
                <span>{isAr ? 'رفع صورة' : 'Upload'}</span>
                <input type="file" accept="image/*" onChange={handleMarketAdminImagePick} className="hidden" />
              </label>
              {marketForm.image_url && (
                <div className="relative">
                  <img src={marketForm.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => setMarketForm((prev) => ({ ...prev, image_url: '' }))}
                    className="absolute -top-1.5 -end-1.5 p-0.5 rounded-full bg-red-600 text-white"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={marketForm.is_negotiable}
                onChange={(e) => setMarketForm({ ...marketForm, is_negotiable: e.target.checked })}
              />
              {isAr ? 'السعر قابل للتفاوض' : 'Negotiable'}
            </label>
            <button type="submit" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg">
              {editingMarketId ? (isAr ? 'حفظ تعديل الإعلان' : 'Save Listing') : isAr ? 'نشر الإعلان في السوق' : 'Publish Listing'}
            </button>
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'إعلانات السوق (Otlobha Market C2C) والمراجعة والضمان' : 'Otlobha Market Listings & Escrow'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {isAr
                ? 'مراجعة الإعلانات الجديدة والمشبوهة، تعديلها أو إيقافها وتجديدها، وتأكيد التسليم لتحرير مبلغ الضمان (Escrow).'
                : 'Moderate, edit, pause/renew C2C listings and release Escrow upon delivery.'}
            </p>
          </div>

          <div className="divide-y divide-slate-200">
            {listings.map((item) => (
              <div key={item.id} className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-50"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 shrink-0">
                      <ImagePlus className="w-5 h-5" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{item.title}</span>
                      <span className="text-xs text-slate-500">
                        {item.category_ar} · {item.condition === 'new' ? (isAr ? 'جديد' : 'New') : isAr ? 'مستعمل' : 'Used'} · {item.zone_name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{item.description}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {isAr ? 'البائع:' : 'Seller:'} {item.seller_name} ({item.seller_phone}) · {isAr ? 'السعر:' : 'Price:'}{' '}
                      <strong className="text-slate-900">{item.price} ج.م</strong> · {isAr ? 'الكمية:' : 'Qty:'} {item.quantity}
                      {item.reports_count > 0 && (
                        <span className="text-red-600 font-semibold ms-2">
                          · {isAr ? `بلاغات: ${item.reports_count}` : `Reports: ${item.reports_count}`}
                        </span>
                      )}
                      {item.escrow_held_amount > 0 && (
                        <span className="text-teal-700 font-medium ms-2">
                          · {isAr ? `مبلغ محجوز Escrow: ${item.escrow_held_amount} ج.م` : `Escrow: ${item.escrow_held_amount}`}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-slate-700 me-1">{item.moderation_status}</span>
                  <button
                    onClick={() => handleEditMarketListing(item)}
                    className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-xs rounded-lg"
                  >
                    {isAr ? 'تعديل' : 'Edit'}
                  </button>
                  {item.moderation_status !== 'approved' && item.moderation_status !== 'sold' && (
                    <button
                      onClick={() => handleModerate(item.id, 'approved')}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg"
                    >
                      {item.moderation_status === 'paused' ? (isAr ? 'تجديد وتفعيل' : 'Renew') : isAr ? 'اعتماد' : 'Approve'}
                    </button>
                  )}
                  {item.moderation_status === 'approved' && (
                    <>
                      <button
                        onClick={() => handleModerate(item.id, 'paused')}
                        className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-xs rounded-lg"
                      >
                        {isAr ? 'إيقاف مؤقت' : 'Pause'}
                      </button>
                      <button
                        onClick={() => handleModerate(item.id, 'sold')}
                        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded-lg"
                      >
                        {isAr ? 'تأكيد البيع' : 'Mark Sold'}
                      </button>
                    </>
                  )}
                  {item.moderation_status !== 'rejected' && item.moderation_status !== 'sold' && (
                    <button
                      onClick={() => handleModerate(item.id, 'rejected')}
                      className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs rounded-lg"
                    >
                      {isAr ? 'رفض' : 'Reject'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteMarketListing(item.id)}
                    className="px-2.5 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 text-xs rounded-lg"
                  >
                    {isAr ? 'حذف' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {financeData && (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'المصالحة المحاسبية للدفتر المركزي (Double-Entry Ledger)' : 'Central Ledger Reconciliation'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {isAr
                  ? 'كل معاملة مالية تُسجل بقيد مزدوج (مدين ودائن) غير قابل للتعديل مع مفتاح منع التكرار Idempotency.'
                  : 'Immutable double-entry ledger ensuring Debits always equal Credits.'}
              </p>
            </div>
            <div className="flex items-center gap-6 text-xs tabular-nums">
              <span>
                {isAr ? 'إجمالي المدين:' : 'Total Debit:'} <strong>{financeData.reconciliation.total_debit} ج.م</strong>
              </span>
              <span>
                {isAr ? 'إجمالي الدائن:' : 'Total Credit:'} <strong>{financeData.reconciliation.total_credit} ج.م</strong>
              </span>
              <span className={financeData.reconciliation.is_balanced ? 'text-teal-700 font-bold' : 'text-red-600 font-bold'}>
                {financeData.reconciliation.is_balanced ? (isAr ? 'الدفتر متوازن 100% ✓' : 'Balanced ✓') : 'Mismatch'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h4 className="text-sm font-bold text-slate-900">
                {isAr ? 'المحافظ والأرصدة + التعديل الرقابي بالسبب' : 'Wallets & Controlled Manual Adjustment'}
              </h4>
              <div className="divide-y divide-slate-100">
                {financeData.wallets.map((w: any) => (
                  <div key={w.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{w.owner_name}</span>
                      <span className="text-slate-500 ms-2">({w.owner_type})</span>
                    </div>
                    <div className="tabular-nums text-end">
                      <span className="font-bold text-slate-900">{w.available_balance} ج.م</span>
                      {w.pending_balance > 0 && <span className="text-amber-700 ms-2">(معلق: {w.pending_balance})</span>}
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAdjustWallet} className="pt-3 border-t border-slate-200 space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  {isAr ? 'تسوية يدوية مقيدة بالسبب (تُسجل في Audit Log والدفتر):' : 'Audited Manual Wallet Adjustment:'}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={adjustForm.wallet_id}
                    onChange={(e) => setAdjustForm({ ...adjustForm, wallet_id: e.target.value })}
                    className="col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    {financeData.wallets.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.owner_name} ({w.available_balance} ج.م)
                      </option>
                    ))}
                  </select>
                  <select
                    value={adjustForm.direction}
                    onChange={(e) => setAdjustForm({ ...adjustForm, direction: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    <option value="credit">{isAr ? 'إضافة (+)' : 'Credit (+)'}</option>
                    <option value="debit">{isAr ? 'خصم (-)' : 'Debit (-)'}</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    value={adjustForm.amount}
                    onChange={(e) => setAdjustForm({ ...adjustForm, amount: Number(e.target.value) })}
                    className="px-2.5 py-1.5 border border-slate-200 rounded text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder={isAr ? 'السبب الإجباري للتسوية...' : 'Mandatory audit reason...'}
                    value={adjustForm.reason}
                    onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                    className="col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg"
                >
                  {isAr ? 'تنفيذ القيد المالي' : 'Execute Ledger Entry'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h4 className="text-sm font-bold text-slate-900">
                {isAr ? 'تسويات ومستحقات الكباتن والتجار' : 'Captain & Merchant Settlements'}
              </h4>
              <div className="divide-y divide-slate-100">
                {financeData.settlements.map((s: any) => (
                  <div key={s.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">{s.beneficiary_name}</p>
                      <p className="text-slate-500 mt-0.5 tabular-nums">
                        {isAr ? 'صافي المستحق:' : 'Net:'} <strong>{s.net_payout} ج.م</strong> · {s.payout_method} · {s.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.status === 'requested' && (
                        <button
                          onClick={() => handleSettlement(s.id, 'approved')}
                          className="px-2.5 py-1 bg-slate-900 text-white rounded"
                        >
                          {isAr ? 'اعتماد' : 'Approve'}
                        </button>
                      )}
                      {(s.status === 'requested' || s.status === 'approved') && (
                        <button
                          onClick={() => handleSettlement(s.id, 'paid')}
                          className="px-2.5 py-1 bg-teal-600 text-white rounded"
                        >
                          {isAr ? 'تأكيد التحويل' : 'Mark Paid'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800">{isAr ? 'إدارة الكوبونات والعروض' : 'Promotional Coupons'}</h4>
                <form onSubmit={handleCreateCoupon} className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder={isAr ? 'كود (مثال: OTLOB15)' : 'Code'}
                    value={couponForm.code}
                    onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-200 rounded text-xs uppercase"
                  />
                  <input
                    type="number"
                    placeholder={isAr ? 'قيمة الخصم' : 'Value'}
                    value={couponForm.discount_value}
                    onChange={(e) => setCouponForm({ ...couponForm, discount_value: Number(e.target.value) })}
                    className="px-2.5 py-1.5 border border-slate-200 rounded text-xs tabular-nums"
                  />
                  <select
                    value={couponForm.funded_by}
                    onChange={(e) => setCouponForm({ ...couponForm, funded_by: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    <option value="platform">{isAr ? 'تتحمله المنصة' : 'Platform'}</option>
                    <option value="merchant">{isAr ? 'يتحمله التاجر' : 'Merchant'}</option>
                  </select>
                  <button type="submit" className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded">
                    {isAr ? 'إضافة كوبون' : 'Create'}
                  </button>
                </form>
                <div className="divide-y divide-slate-100 text-xs">
                  {coupons.map((c) => (
                    <div key={c.id} className="py-2 flex items-center justify-between">
                      <span className="font-mono-num font-bold text-slate-900">
                        {c.code} · {c.discount_value} ج.م ({c.funded_by})
                      </span>
                      <button
                        onClick={async () => {
                          await api.toggleCoupon(c.id, !c.is_active);
                          await loadData();
                        }}
                        className="text-slate-600 underline"
                      >
                        {c.is_active ? (isAr ? 'تعطيل' : 'Disable') : isAr ? 'تفعيل' : 'Enable'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
            <h4 className="text-sm font-bold text-slate-900 mb-3">
              {isAr ? 'سجل القيود المحاسبية المركزية (Ledger Entries)' : 'Immutable Double-Entry Ledger Entries'}
            </h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start">{isAr ? 'الحساب' : 'Account'}</th>
                  <th className="py-2 text-start">{isAr ? 'الوصف' : 'Description'}</th>
                  <th className="py-2 text-end">{isAr ? 'مدين (Debit)' : 'Debit'}</th>
                  <th className="py-2 text-end">{isAr ? 'دائن (Credit)' : 'Credit'}</th>
                  <th className="py-2 text-end">{isAr ? 'مفتاح عدم التكرار' : 'Idempotency'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {financeData.entries.map((e: any) => (
                  <tr key={e.id}>
                    <td className="py-2 font-mono-num text-slate-800">{e.account_code}</td>
                    <td className="py-2 text-slate-700">{e.description_ar}</td>
                    <td className="py-2 text-end font-medium text-slate-900">{e.debit > 0 ? e.debit : '—'}</td>
                    <td className="py-2 text-end font-medium text-teal-700">{e.credit > 0 ? e.credit : '—'}</td>
                    <td className="py-2 text-end font-mono-num text-slate-400">{e.idempotency_key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
