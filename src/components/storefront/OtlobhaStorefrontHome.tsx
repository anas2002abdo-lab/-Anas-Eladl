import React, { useState } from 'react';
import {
  Bell,
  Car,
  ChevronDown,
  ChevronLeft,
  Flame,
  Gift,
  Leaf,
  MapPin,
  Package,
  Pill,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Truck,
  X,
} from 'lucide-react';
import type {
  MerchantRecord,
  ServiceZone,
  StorefrontBannerRecord,
  StorefrontCategoryRecord,
  StorefrontProductCard,
} from '../../shared/types';
import { OtlobhaProductCard } from './OtlobhaProductCard';

interface Props {
  zones: ServiceZone[];
  selectedZoneId: string;
  onChangeZone: (zoneId: string) => void;
  merchants: MerchantRecord[];
  banners: StorefrontBannerRecord[];
  categories: StorefrontCategoryRecord[];
  products: StorefrontProductCard[];
  brands: string[];
  loading: boolean;
  hasMore: boolean;
  activeFilter: 'for_you' | 'fresh' | 'groceries' | 'offers' | 'free_delivery';
  selectedCategoryId: string;
  selectedBrand: string;
  selectedMerchantId: string;
  cartQtyMap: Record<string, number>;
  unreadNotifCount: number;
  onChangeFilter: (f: 'for_you' | 'fresh' | 'groceries' | 'offers' | 'free_delivery') => void;
  onSelectCategory: (catId: string) => void;
  onSelectBrand: (brand: string) => void;
  onSelectMerchant: (merchantId: string) => void;
  onClearAllFilters: () => void;
  onLoadMore: () => void;
  onOpenSearch: () => void;
  onOpenProduct: (productId: string) => void;
  onOpenNotifications: () => void;
  onOpenService: (service: 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order' | 'stores' | 'hub') => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onDecrementProduct: (productId: string) => void;
}

export const OtlobhaStorefrontHome: React.FC<Props> = ({
  zones,
  selectedZoneId,
  onChangeZone,
  merchants,
  banners,
  categories,
  products,
  brands,
  loading,
  hasMore,
  activeFilter,
  selectedCategoryId,
  selectedBrand,
  selectedMerchantId,
  cartQtyMap,
  unreadNotifCount,
  onChangeFilter,
  onSelectCategory,
  onSelectBrand,
  onSelectMerchant,
  onClearAllFilters,
  onLoadMore,
  onOpenSearch,
  onOpenProduct,
  onOpenNotifications,
  onOpenService,
  onAddProduct,
  onDecrementProduct,
}) => {
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const activeZone = zones.find((z) => z.id === selectedZoneId) || zones[0];
  const heroBanners = banners.filter((b) => b.banner_type === 'hero');
  const stripBanners = banners.filter((b) => b.banner_type === 'strip');

  const activeCatObj = categories.find((c) => c.id === selectedCategoryId);
  const activeMerchantObj = merchants.find((m) => m.id === selectedMerchantId);
  const hasScopedFilter = Boolean(selectedCategoryId || selectedBrand || selectedMerchantId);

  const handleBannerClick = (b: StorefrontBannerRecord) => {
    const tf = String(b.target_filter || '').trim();
    const serviceKey = (b.target_service || (tf.startsWith('service:') ? tf.slice('service:'.length) : '')).trim();
    if (serviceKey) {
      if (
        serviceKey === 'pharmacy' ||
        serviceKey === 'rides' ||
        serviceKey === 'parcels' ||
        serviceKey === 'market' ||
        serviceKey === 'free_order' ||
        serviceKey === 'stores' ||
        serviceKey === 'hub'
      ) {
        onOpenService(serviceKey);
        return;
      }
      onOpenService('hub');
      return;
    }
    if (b.target_category_id) {
      onSelectCategory(b.target_category_id);
      return;
    }
    if (b.target_merchant_id) {
      onSelectMerchant(b.target_merchant_id);
      return;
    }
    if (tf === 'fresh') onChangeFilter('fresh');
    else if (tf === 'groceries') onChangeFilter('groceries');
    else if (tf === 'free_delivery') onChangeFilter('free_delivery');
    else if (tf === 'for_you') onChangeFilter('for_you');
    else onChangeFilter('offers');
  };

  return (
    <div className="space-y-4 pb-28" dir="rtl">
      {/* 1. STICKY TOP BAR: Otlobha Logo, Delivery Address, Notifications, Search Input */}
      <div className="sticky top-0 z-20 bg-[#F6F7F9]/95 backdrop-blur-md pt-2 pb-2.5 space-y-2.5 border-b border-slate-200/70">
        <div className="flex items-center justify-between gap-2">
          {/* Address Selector + Otlobha Logo */}
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt="اطلبها Otlobha"
              className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 border border-slate-200 shadow-xs shrink-0"
            />
            <button
              type="button"
              onClick={() => setZonePickerOpen((p) => !p)}
              className="text-right min-w-0 cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                <span>التوصيل إلى</span>
                <span className="text-[#A92224] font-black">• اطلبها</span>
              </div>
              <div className="text-xs font-black text-slate-900 flex items-center gap-1 truncate">
                <MapPin className="w-3.5 h-3.5 text-[#A92224] shrink-0" />
                <span className="truncate">{activeZone?.name_ar || 'وسط مدينة المنزلة'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenNotifications}
            aria-label="الإشعارات"
            className="relative w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 hover:border-[#A92224]/40 shrink-0 cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#A92224] text-white text-[10px] font-black flex items-center justify-center">
                {unreadNotifCount}
              </span>
            )}
          </button>
        </div>

        {/* Inline Zone Selector Dropdown */}
        {zonePickerOpen && zones.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-lg space-y-1 max-h-56 overflow-y-auto">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => {
                  onChangeZone(z.id);
                  setZonePickerOpen(false);
                }}
                className={`w-full text-right px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${
                  z.id === selectedZoneId
                    ? 'bg-[#FEF2F2] text-[#A92224]'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span>{z.name_ar}</span>
                {z.remote_area_fee > 0 && (
                  <span className="text-[10px] text-slate-400">+{z.remote_area_fee} ج.م</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Search Input Bar */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full h-11 rounded-2xl bg-white border border-slate-200/90 px-3.5 flex items-center justify-between gap-2 text-slate-400 text-sm shadow-xs hover:border-[#A92224]/50 transition cursor-pointer"
        >
          <span className="flex items-center gap-2.5 truncate">
            <Search className="w-4 h-4 text-[#A92224] shrink-0" />
            <span className="truncate">ابحث عن منتج، علامة تجارية، أو متجر...</span>
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-[#FEF2F2] text-[#A92224] text-[10px] font-black shrink-0">
            بحث ذكي
          </span>
        </button>
      </div>

      {/* 2. PROMOTIONAL HERO BANNERS CAROUSEL (Otlobha Official Palette) */}
      {!hasScopedFilter && heroBanners.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar snap-x">
          {heroBanners.map((b, idx) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleBannerClick(b)}
              className={`min-w-[88%] sm:min-w-[360px] snap-center rounded-3xl p-5 text-right text-white relative overflow-hidden shadow-md cursor-pointer transition hover:brightness-[1.03] ${
                idx % 2 === 0
                  ? 'bg-gradient-to-l from-[#A92224] via-[#8E1B1D] to-[#631214]'
                  : 'bg-gradient-to-l from-[#5C2E1F] via-[#86191B] to-[#A92224]'
              }`}
            >
              {b.image_url && (
                <img
                  src={b.image_url}
                  alt={b.title_ar}
                  className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
                />
              )}
              <div className="relative z-10 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {b.badge_ar && (
                    <span className="inline-block px-2.5 py-0.5 rounded-lg bg-white/15 border border-[#F5A623]/50 text-[#FDE68A] text-[10px] font-black">
                      {b.badge_ar}
                    </span>
                  )}
                  <h2 className="text-base sm:text-lg font-black leading-snug line-clamp-2">{b.title_ar}</h2>
                  {b.subtitle_ar && (
                    <p className="text-xs text-white/85 leading-relaxed line-clamp-2">{b.subtitle_ar}</p>
                  )}
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 px-3.5 py-2.5 rounded-2xl bg-[#F5A623] text-[#3B180E] text-xs font-black shadow-md whitespace-nowrap">
                  <span>{b.cta_label || 'تسوّق الآن'}</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="absolute -left-6 -bottom-6 w-28 h-28 rounded-full bg-[#F5A623]/15 pointer-events-none" />
            </button>
          ))}
        </div>
      )}

      {/* 2B. PROMOTIONAL STRIP BANNERS (Supports Services, Categories, Merchants & Offers) */}
      {!hasScopedFilter && stripBanners.length > 0 && (
        <div className="space-y-2">
          {stripBanners.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleBannerClick(b)}
              className="w-full rounded-2xl bg-gradient-to-l from-[#FFFBEB] to-white border border-[#F5A623]/40 px-4 py-3 flex items-center justify-between gap-3 text-right shadow-xs hover:border-[#A92224]/50 transition cursor-pointer"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  {b.badge_ar && (
                    <span className="px-2 py-0.5 rounded-md bg-[#A92224] text-white text-[10px] font-black shrink-0">
                      {b.badge_ar}
                    </span>
                  )}
                  <span className="font-black text-xs text-slate-900 truncate">{b.title_ar}</span>
                </div>
                {b.subtitle_ar && (
                  <p className="text-[11px] text-slate-600 truncate">{b.subtitle_ar}</p>
                )}
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-black text-[#A92224] shrink-0">
                <span>{b.cta_label || 'افتح الآن'}</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Compact Otlobha Multi-Services Access Row (Zero Feature Loss!) */}
      {!hasScopedFilter && (
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'free_order', label: 'طلب نصي حر', icon: Sparkles },
            { id: 'pharmacy', label: 'الصيدليات (فارما)', icon: Pill },
            { id: 'rides', label: 'اطلبها مشوار', icon: Car },
            { id: 'parcels', label: 'أي حاجة (طرود)', icon: Package },
            { id: 'market', label: 'سوق اطلبها', icon: ShoppingBag },
          ].map((srv) => {
            const Icon = srv.icon;
            return (
              <button
                key={srv.id}
                type="button"
                onClick={() => onOpenService(srv.id as any)}
                className="px-3 py-2 rounded-2xl bg-white border border-slate-200 hover:border-[#A92224]/50 text-xs font-extrabold text-slate-800 flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
              >
                <Icon className="w-3.5 h-3.5 text-[#A92224]" />
                <span>{srv.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Scoped Filter Banner (Category / Brand / Merchant) */}
      {hasScopedFilter && (
        <div className="bg-white rounded-2xl border border-red-200 px-3.5 py-2.5 flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-2 flex-wrap">
            <span className="text-[#A92224] font-black">تصفية نشطة:</span>
            {activeCatObj && <span className="px-2 py-0.5 rounded-lg bg-[#FEF2F2] text-[#A92224]">{activeCatObj.name_ar}</span>}
            {selectedBrand && <span className="px-2 py-0.5 rounded-lg bg-[#FFFBEB] text-[#92400E]">علامة: {selectedBrand}</span>}
            {activeMerchantObj && (
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 flex items-center gap-1">
                <Store className="w-3 h-3" /> {activeMerchantObj.business_name_ar}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClearAllFilters}
            className="text-xs font-black text-[#A92224] hover:underline flex items-center gap-0.5 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" /> إلغاء
          </button>
        </div>
      )}

      {/* 4. QUICK FILTER BUTTONS & TRENDING CATEGORIES (الأقسام الأكثر رواجًا) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => setFilterDrawerOpen(true)}
          className="h-10 px-3.5 rounded-2xl bg-white border border-slate-200 hover:border-[#A92224] text-xs font-extrabold text-slate-800 flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#A92224]" />
          <span>الفلاتر</span>
        </button>

        {/* زر الكل */}
        <button
          type="button"
          onClick={() => {
            if (hasScopedFilter) onClearAllFilters();
            onSelectCategory('');
          }}
          className={`h-10 px-4 rounded-2xl text-xs font-extrabold shrink-0 transition cursor-pointer ${
            !selectedCategoryId && !selectedBrand && !selectedMerchantId
              ? 'bg-[#A92224] text-white shadow-sm'
              : 'bg-white border border-slate-200 text-slate-700 hover:border-[#A92224]/40'
          }`}
        >
          الكل
        </button>

        {/* مستطيلات الأقسام الأكثر رواجًا */}
        {(categories || []).slice(0, 12).map((cat) => {
          const active = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                if (active) {
                  onSelectCategory('');
                } else {
                  onSelectCategory(cat.id);
                }
              }}
              className={`h-10 px-4 rounded-2xl text-xs font-extrabold shrink-0 transition cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#A92224] text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-700 hover:border-[#A92224]/40'
              }`}
            >
              {cat.name_ar}
            </button>
          );
        })}
      </div>

      {/* 5. 2-COLUMN PRODUCT GRID (Responsive up to 4 cols on desktop) */}
      {loading && products.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200/80 p-3 space-y-2 animate-pulse">
              <div className="aspect-square rounded-xl bg-slate-100" />
              <div className="h-3 bg-slate-100 rounded w-1/2" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2.5">
          <Package className="w-10 h-10 mx-auto text-[#A92224]/40" />
          <h4 className="font-black text-slate-900">لا توجد منتجات في هذا التصنيف حاليًا</h4>
          <p className="text-xs text-slate-500">جرّب تصفح قسم آخر أو استخدم البحث الذكي أو الطلب النصي الحر.</p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClearAllFilters}
              className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold cursor-pointer"
            >
              عرض جميع المنتجات
            </button>
            <button
              type="button"
              onClick={() => onOpenService('free_order')}
              className="px-4 py-2 rounded-xl bg-[#FFFBEB] border border-[#F5A623] text-[#92400E] text-xs font-bold cursor-pointer"
            >
              طلب نصي حر
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {products.map((product) => (
              <OtlobhaProductCard
                key={product.id}
                product={product}
                cartQty={cartQtyMap[product.id] || 0}
                onOpenDetails={onOpenProduct}
                onAdd={onAddProduct}
                onDecrement={onDecrementProduct}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loading}
                className="px-6 py-2.5 rounded-2xl bg-white border border-slate-300 hover:border-[#A92224] text-xs font-black text-slate-800 shadow-xs cursor-pointer"
              >
                {loading ? 'جاري التحميل...' : 'عرض المزيد من المنتجات'}
              </button>
            </div>
          )}
        </>
      )}

      {/* FILTER DRAWER MODAL */}
      {filterDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setFilterDrawerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">تصفية منتجات المتجر</h3>
              <button
                type="button"
                onClick={() => setFilterDrawerOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-black text-slate-700 block mb-1.5">المتجر</label>
                <select
                  value={selectedMerchantId}
                  onChange={(e) => onSelectMerchant(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  <option value="">كل المتاجر المتاحة</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>{m.business_name_ar}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-black text-slate-700 block mb-1.5">القسم</label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => onSelectCategory(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  <option value="">كل الأقسام</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name_ar}</option>
                  ))}
                </select>
              </div>

              {brands.length > 0 && (
                <div>
                  <label className="text-xs font-black text-slate-700 block mb-1.5">العلامة التجارية</label>
                  <div className="flex flex-wrap gap-1.5">
                    {brands.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => onSelectBrand(selectedBrand === b ? '' : b)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                          selectedBrand === b
                            ? 'bg-[#A92224] text-white border-[#A92224]'
                            : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClearAllFilters();
                  setFilterDrawerOpen(false);
                }}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-700 text-xs font-black cursor-pointer"
              >
                إعادة ضبط
              </button>
              <button
                type="button"
                onClick={() => setFilterDrawerOpen(false)}
                className="flex-1 py-2.5 rounded-2xl bg-[#A92224] text-white text-xs font-black cursor-pointer"
              >
                تطبيق الفلاتر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
