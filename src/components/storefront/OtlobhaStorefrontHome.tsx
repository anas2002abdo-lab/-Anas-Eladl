import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Car,
  ChevronDown,
  ChevronLeft,
  LayoutGrid,
  MapPin,
  Menu,
  Navigation,
  Package,
  Pill,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
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
  liveTrackingCount?: number;
  onOpenLiveTracking?: () => void;
  onOpenMenu?: () => void;
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

const FALLBACK_HERO_IMAGES = [
  '/src/assets/images/hero_otlobha_fresh_1795511317922.jpg',
  '/src/assets/images/hero_otlobha_offers_1795511319332.jpg',
];

const FALLBACK_HERO_SLIDES: Array<Partial<StorefrontBannerRecord> & { id: string; title_ar: string }> = [
  {
    id: 'fallback_hero_1',
    title_ar: 'كل احتياجات بيتك بأقل سعر في المنزلة',
    subtitle_ar: 'قارن أسعار السوبر ماركت والمنتجات الطازجة وتصلك لباب البيت في دقائق',
    cta_label: 'اكتشف العروض',
    target_filter: 'offers',
    image_url: FALLBACK_HERO_IMAGES[0],
  },
  {
    id: 'fallback_hero_2',
    title_ar: 'توصيل فوري للمقاضي والصيدليات والمشاوير',
    subtitle_ar: 'منصة واحدة تجمع متاجر مدينتك مع تتبع مباشر حتى لحظة الاستلام',
    cta_label: 'تسوّق الطازج',
    target_filter: 'fresh',
    image_url: FALLBACK_HERO_IMAGES[1],
  },
];

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
  selectedCategoryId,
  selectedBrand,
  selectedMerchantId,
  cartQtyMap,
  unreadNotifCount,
  liveTrackingCount = 0,
  onOpenLiveTracking,
  onOpenMenu,
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
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [floatingOffset, setFloatingOffset] = useState(82);
  const [isSearchPinned, setIsSearchPinned] = useState(false);
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const initialHeroTopRef = useRef<number | null>(null);

  const activeZone = zones.find((z) => z.id === selectedZoneId) || zones[0];
  const heroSlides = useMemo(() => {
    const dbHeroes = banners.filter((b) => b.banner_type === 'hero' || !b.banner_type);
    if (dbHeroes.length > 0) {
      return dbHeroes.map((b, idx) => ({
        ...b,
        resolvedImage: b.image_url || FALLBACK_HERO_IMAGES[idx % FALLBACK_HERO_IMAGES.length],
      }));
    }
    return FALLBACK_HERO_SLIDES.map((b, idx) => ({
      ...b,
      resolvedImage: b.image_url || FALLBACK_HERO_IMAGES[idx % FALLBACK_HERO_IMAGES.length],
    }));
  }, [banners]);

  useEffect(() => {
    setActiveSlideIdx(0);
  }, [heroSlides.length]);

  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveSlideIdx((prev) => (prev + 1) % heroSlides.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [heroSlides.length]);

  useEffect(() => {
    const getRestOffset = () => (window.innerWidth >= 640 ? 90 : 78);

    const updateFloatingPosition = () => {
      const heroEl = heroSectionRef.current;
      const restOffset = getRestOffset();
      if (!heroEl) {
        setFloatingOffset(restOffset);
        setIsSearchPinned(false);
        return;
      }
      const rectTop = heroEl.getBoundingClientRect().top;
      if (initialHeroTopRef.current === null || rectTop > initialHeroTopRef.current) {
        initialHeroTopRef.current = rectTop;
      }
      const scrolled = Math.max(0, initialHeroTopRef.current - rectTop);
      const nextOffset = Math.max(0, restOffset - scrolled);
      setFloatingOffset(nextOffset);
      setIsSearchPinned(nextOffset <= 4);
    };

    updateFloatingPosition();
    window.addEventListener('scroll', updateFloatingPosition, { passive: true, capture: true });
    window.addEventListener('resize', updateFloatingPosition, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateFloatingPosition, true);
      window.removeEventListener('resize', updateFloatingPosition);
    };
  }, []);

  const activeCatObj = categories.find((c) => c.id === selectedCategoryId);
  const activeMerchantObj = merchants.find((m) => m.id === selectedMerchantId);
  const hasScopedFilter = Boolean(selectedCategoryId || selectedBrand || selectedMerchantId);

  const displayCategories = useMemo(() => {
    const allCats = categories || [];
    const catIds = new Set(allCats.map((c) => c.id));
    const rootCats = allCats.filter((c) => !c.parent_id || !catIds.has(c.parent_id));
    return (rootCats.length > 0 ? rootCats : allCats).slice(0, 24);
  }, [categories]);

  const handleBannerClick = (b: Partial<StorefrontBannerRecord>) => {
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

  const currentHero = heroSlides[activeSlideIdx % heroSlides.length] || heroSlides[0];

  const otlobhaServices: Array<{
    id: 'free_order' | 'pharmacy' | 'rides' | 'parcels' | 'market' | 'stores';
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    accentBg: string;
    accentText: string;
  }> = [
    {
      id: 'free_order',
      label: 'طلب نصي حر',
      subtitle: 'اكتب أي طلب',
      icon: Sparkles,
      accentBg: 'bg-[#FEF2F2]',
      accentText: 'text-[#A92224]',
    },
    {
      id: 'pharmacy',
      label: 'الصيدليات',
      subtitle: 'دواء وروشتة',
      icon: Pill,
      accentBg: 'bg-teal-50',
      accentText: 'text-teal-700',
    },
    {
      id: 'rides',
      label: 'اطلبها مشوار',
      subtitle: 'توصيل فوري',
      icon: Car,
      accentBg: 'bg-amber-50',
      accentText: 'text-amber-700',
    },
    {
      id: 'parcels',
      label: 'طرود أي حاجة',
      subtitle: 'استلام وتسليم',
      icon: Package,
      accentBg: 'bg-orange-50',
      accentText: 'text-orange-700',
    },
    {
      id: 'market',
      label: 'سوق اطلبها',
      subtitle: 'إعلانات مدينتك',
      icon: ShoppingBag,
      accentBg: 'bg-indigo-50',
      accentText: 'text-indigo-700',
    },
    {
      id: 'stores',
      label: 'كل المتاجر',
      subtitle: 'تصفح المحلات',
      icon: Store,
      accentBg: 'bg-slate-100',
      accentText: 'text-slate-700',
    },
  ];

  return (
    <div className="relative space-y-5 pb-36" dir="rtl">
      {/* SINGLE TRULY FLOATING OVAL SEARCH BAR (82% width, hovers independently over Hero & stays pinned on scroll while offers scroll behind it) */}
      <div
        className={`sticky top-3 h-0 overflow-visible pointer-events-none flex justify-center !mt-0 !mb-0 ${
          zonePickerOpen ? 'z-10' : 'z-40'
        }`}
      >
        <div
          style={{ transform: `translate3d(0, ${floatingOffset}px, 0)` }}
          className="w-[82%] max-w-[680px] pointer-events-auto will-change-transform"
        >
          <button
            type="button"
            onClick={onOpenSearch}
            className={`w-full rounded-full backdrop-blur-xl px-5 sm:px-7 flex items-center justify-between gap-3 text-slate-500 transition-[height,background-color,box-shadow,border-color] duration-200 cursor-pointer ${
              isSearchPinned
                ? 'h-[56px] sm:h-[64px] bg-white/95 border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.2)]'
                : 'h-[64px] sm:h-[74px] lg:h-[84px] bg-white/92 border border-white/80 ring-4 ring-white/20 shadow-[0_22px_52px_rgba(0,0,0,0.34)] hover:bg-white'
            }`}
          >
            <span className="flex items-center gap-3 min-w-0">
              <span
                className={`rounded-full bg-[#A92224] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 ${
                  isSearchPinned ? 'w-9 h-9' : 'w-10 h-10 sm:w-11 sm:h-11'
                }`}
              >
                <Search className={isSearchPinned ? 'w-4 h-4 stroke-[2.5]' : 'w-5 h-5 stroke-[2.3]'} />
              </span>
              <span className="text-sm sm:text-base font-bold text-slate-700 truncate">
                ابحث عن منتج، ماركة، أو قارن الأسعار...
              </span>
            </span>
            <span className="hidden sm:inline text-xs font-black text-[#A92224] shrink-0">
              بحث ذكي
            </span>
          </button>
        </div>
      </div>

      {/* 1. IMMERSIVE FULL-BLEED HERO BANNER WITH FLOATING HEADER (~612px) */}
      <section
        ref={heroSectionRef}
        className="relative w-full h-[460px] sm:h-[540px] lg:h-[612px] rounded-[28px] sm:rounded-[32px] overflow-hidden shadow-[0_18px_48px_rgba(15,23,42,0.16)] bg-[#1A0D0E] !mt-0"
      >
        {/* Auto-Fading Background Slides */}
        {heroSlides.map((slide, idx) => {
          const isCurrent = idx === activeSlideIdx % heroSlides.length;
          return (
            <div
              key={slide.id || idx}
              aria-hidden={!isCurrent}
              className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
                isCurrent ? 'opacity-100 z-[1]' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              <img
                src={slide.resolvedImage}
                alt={slide.title_ar || 'عروض اطلبها'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover scale-[1.01]"
              />
              {/* Measured Contrast Scrim for Crisp Floating White Overlay Text */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black/80" />
            </div>
          );
        })}

        {/* Floating Overlay Top Row: Store Logo + Delivery Location + Functional Header Actions */}
        <div className="relative z-20 p-4 sm:p-6 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt="شعار اطلبها"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl object-contain bg-white p-1 shadow-[0_6px_20px_rgba(0,0,0,0.28)] ring-2 ring-white/80 shrink-0"
            />
            <button
              type="button"
              onClick={() => setZonePickerOpen((p) => !p)}
              className="min-w-0 text-right bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/20 rounded-2xl px-3.5 py-2 transition-colors cursor-pointer"
            >
              <div className="text-[10.5px] font-bold text-amber-200/95 flex items-center gap-1 leading-none mb-1">
                <span>التوصيل إلى</span>
                <span aria-hidden="true">·</span>
                <span>اطلبها</span>
              </div>
              <div className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-1 truncate">
                <MapPin className="w-3.5 h-3.5 text-[#F5A623] shrink-0" />
                <span className="truncate">{activeZone?.name_ar || 'وسط مدينة المنزلة'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-white/80 shrink-0" />
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenLiveTracking && (
              <button
                type="button"
                onClick={onOpenLiveTracking}
                aria-label="تتبع GPS والشات مع الطيار"
                className="relative w-11 h-11 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <Navigation className="w-4 h-4 text-amber-200" />
                {liveTrackingCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center tabular-nums">
                    {liveTrackingCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onOpenNotifications}
              aria-label="الإشعارات"
              className="relative w-11 h-11 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#A92224] text-white text-[10px] font-black flex items-center justify-center tabular-nums ring-2 ring-white/80">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {onOpenMenu && (
              <button
                type="button"
                onClick={onOpenMenu}
                aria-label="القائمة الجانبية"
                className="w-11 h-11 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Floating Delivery Zone Picker Dropdown */}
        {zonePickerOpen && zones.length > 0 && (
          <div className="absolute top-[82px] right-4 left-4 sm:right-6 sm:left-auto sm:w-80 z-30 bg-white/98 backdrop-blur-xl rounded-2xl border border-slate-200 p-2 shadow-2xl space-y-1 max-h-60 overflow-y-auto">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => {
                  onChangeZone(z.id);
                  setZonePickerOpen(false);
                }}
                className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                  z.id === selectedZoneId
                    ? 'bg-[#FEF2F2] text-[#A92224]'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span>{z.name_ar}</span>
                {z.remote_area_fee > 0 && (
                  <span className="text-[11px] text-slate-400 tabular-nums">+{z.remote_area_fee} ج.م</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Floating Lower Overlay: Editorial Hero Offers Copy (cleanly separated from floating search above) */}
        <div className="absolute inset-x-0 bottom-0 z-20 px-4 sm:px-8 pb-7 sm:pb-10 flex flex-col items-center">
          {/* Active Slide Headline & Action */}
          <div
            onClick={() => handleBannerClick(currentHero)}
            className="w-full max-w-2xl text-center space-y-2.5 cursor-pointer"
          >
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)] text-balance">
              {currentHero?.title_ar || 'كل احتياجات بيتك بأقل سعر في المنزلة'}
            </h1>
            {currentHero?.subtitle_ar && (
              <p className="text-xs sm:text-sm text-white/90 font-medium max-w-xl mx-auto line-clamp-2 drop-shadow-[0_1px_6px_rgba(0,0,0,0.4)]">
                {currentHero.subtitle_ar}
              </p>
            )}
            <div className="pt-1.5 flex items-center justify-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-extrabold shadow-lg transition-colors">
                <span>{currentHero?.cta_label || 'تسوّق الآن'}</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </span>
              {heroSlides.length > 1 && (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {heroSlides.map((s, idx) => (
                    <button
                      key={s.id || idx}
                      type="button"
                      aria-label={`عرض ${idx + 1}`}
                      onClick={() => setActiveSlideIdx(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                        idx === activeSlideIdx % heroSlides.length
                          ? 'w-6 bg-[#F5A623]'
                          : 'w-1.5 bg-white/50 hover:bg-white/80'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 2. SERVICES DIRECTLY BELOW HERO (Ad Banners Permanently Removed — Horizontal Swipeable Cards) */}
      <section aria-label="خدمات اطلبها" className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-black text-slate-900">خدمات اطلبها</h2>
          <button
            type="button"
            onClick={() => onOpenService('hub')}
            className="text-xs font-extrabold text-[#A92224] hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>عرض الكل</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1.5 no-scrollbar snap-x">
          {otlobhaServices.map((srv) => {
            const Icon = srv.icon;
            return (
              <button
                key={srv.id}
                type="button"
                onClick={() => onOpenService(srv.id)}
                className="snap-start shrink-0 min-w-[132px] sm:min-w-[146px] bg-white hover:bg-slate-50/80 rounded-[20px] border border-slate-200/80 p-3.5 flex items-center gap-3 text-right shadow-[0_4px_16px_rgba(15,23,42,0.04)] hover:border-[#A92224]/40 transition-all duration-200 cursor-pointer active:scale-[0.98]"
              >
                <span
                  className={`w-11 h-11 rounded-2xl ${srv.accentBg} ${srv.accentText} flex items-center justify-center shrink-0`}
                >
                  <Icon className="w-5 h-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-black text-slate-900 whitespace-nowrap">
                    {srv.label}
                  </span>
                  <span className="block text-[10.5px] font-medium text-slate-500 whitespace-nowrap mt-0.5">
                    {srv.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active Scoped Filter Summary (Only when Category / Brand / Merchant filter is active) */}
      {hasScopedFilter && (
        <div className="bg-white rounded-2xl border border-red-200/80 px-4 py-3 flex items-center justify-between gap-3 shadow-xs">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-2 flex-wrap">
            <span className="text-[#A92224] font-black">تصفية نشطة</span>
            {activeCatObj && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-slate-900 font-extrabold">{activeCatObj.name_ar}</span>
              </>
            )}
            {selectedBrand && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-amber-800 font-extrabold">{selectedBrand}</span>
              </>
            )}
            {activeMerchantObj && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-slate-900 font-extrabold">{activeMerchantObj.business_name_ar}</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClearAllFilters}
            className="text-xs font-black text-[#A92224] hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>مسح</span>
          </button>
        </div>
      )}

      {/* 3. CATEGORIES HORIZONTAL SCROLLABLE STRIP (EXACT 68px CARD HEIGHT) */}
      <section aria-label="الأقسام" className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-black text-slate-900">تصفح حسب القسم</h2>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            {displayCategories.length} قسم
          </span>
        </div>

        <div className="flex items-center gap-2.5 overflow-x-auto pb-1.5 no-scrollbar snap-x">
          {/* Filter Drawer Trigger Card (68px height) */}
          <button
            type="button"
            onClick={() => setFilterDrawerOpen(true)}
            className={`snap-start h-[68px] px-4 rounded-[18px] border flex items-center gap-2.5 shrink-0 transition-all cursor-pointer ${
              hasScopedFilter
                ? 'bg-[#86191B] border-[#86191B] text-white shadow-sm'
                : 'bg-white border-slate-200/90 text-slate-800 hover:border-[#A92224]/50 shadow-[0_3px_12px_rgba(15,23,42,0.04)]'
            }`}
          >
            <span
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                hasScopedFilter ? 'bg-white/15 text-[#F5A623]' : 'bg-[#FEF2F2] text-[#A92224]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </span>
            <span className="text-right">
              <span className="block text-xs font-black whitespace-nowrap">الفلاتر</span>
              <span
                className={`block text-[10px] font-medium whitespace-nowrap ${
                  hasScopedFilter ? 'text-white/80' : 'text-slate-400'
                }`}
              >
                تخصيص أدق
              </span>
            </span>
          </button>

          {/* "الكل" Category Card (68px height) */}
          <button
            type="button"
            onClick={() => {
              if (hasScopedFilter) onClearAllFilters();
              onSelectCategory('');
            }}
            className={`snap-start h-[68px] px-4 rounded-[18px] border flex items-center gap-2.5 shrink-0 transition-all cursor-pointer ${
              !selectedCategoryId && !selectedBrand && !selectedMerchantId
                ? 'bg-[#A92224] border-[#A92224] text-white shadow-[0_8px_20px_rgba(169,34,36,0.22)]'
                : 'bg-white border-slate-200/90 text-slate-800 hover:border-[#A92224]/50 shadow-[0_3px_12px_rgba(15,23,42,0.04)]'
            }`}
          >
            <span
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                !selectedCategoryId && !selectedBrand && !selectedMerchantId
                  ? 'bg-white/15 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </span>
            <span className="text-xs font-black whitespace-nowrap">الكل</span>
          </button>

          {/* Dynamic Categories Cards (68px height) */}
          {displayCategories.map((cat) => {
            const active = selectedCategoryId === cat.id;
            const thumb = (cat as unknown as { image_url?: string }).image_url;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(active ? '' : cat.id)}
                className={`snap-start h-[68px] px-3.5 rounded-[18px] border flex items-center gap-2.5 shrink-0 transition-all cursor-pointer ${
                  active
                    ? 'bg-[#A92224] border-[#A92224] text-white shadow-[0_8px_20px_rgba(169,34,36,0.22)]'
                    : 'bg-white border-slate-200/90 text-slate-800 hover:border-[#A92224]/50 shadow-[0_3px_12px_rgba(15,23,42,0.04)]'
                }`}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt={cat.name_ar}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-xl object-cover bg-slate-100 shrink-0"
                  />
                ) : (
                  <span
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-black ${
                      active ? 'bg-white/15 text-white' : 'bg-[#FEF2F2] text-[#A92224]'
                    }`}
                  >
                    {cat.name_ar.trim().slice(0, 1)}
                  </span>
                )}
                <span className="text-right">
                  <span className="block text-xs font-extrabold whitespace-nowrap">{cat.name_ar}</span>
                  {typeof cat.products_count === 'number' && cat.products_count > 0 && (
                    <span
                      className={`block text-[10px] font-medium tabular-nums whitespace-nowrap ${
                        active ? 'text-white/80' : 'text-slate-400'
                      }`}
                    >
                      {cat.products_count} منتج
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. PRODUCTS GRID: 2 EQUAL COLUMNS WITH EXACT 16px GAP (gap-4) & LARGE CRISP IMAGES */}
      <section aria-label="المنتجات" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-black text-slate-900">منتجات مختارة لك</h2>
          {!loading && (
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {products.length} منتج
            </span>
          )}
        </div>

        {loading && products.length === 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-[22px] border border-slate-200/80 p-3 space-y-2.5 animate-pulse"
              >
                <div className="aspect-square rounded-2xl bg-slate-100" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
                <div className="h-4 bg-slate-100 rounded w-full" />
                <div className="h-4 bg-slate-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-3">
            <Package className="w-10 h-10 mx-auto text-[#A92224]/40" />
            <h4 className="font-black text-slate-900">لا توجد منتجات في هذا التصنيف حاليًا</h4>
            <p className="text-xs text-slate-500">جرّب تصفح قسم آخر أو استخدم البحث الذكي أو الطلب النصي الحر.</p>
            <div className="flex justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClearAllFilters}
                className="px-4 py-2.5 rounded-xl bg-[#A92224] text-white text-xs font-bold cursor-pointer"
              >
                عرض جميع المنتجات
              </button>
              <button
                type="button"
                onClick={() => onOpenService('free_order')}
                className="px-4 py-2.5 rounded-xl bg-[#FFFBEB] border border-[#F5A623] text-[#92400E] text-xs font-bold cursor-pointer"
              >
                طلب نصي حر
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
              <div className="flex justify-center pt-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="px-7 py-3 rounded-full bg-white border border-slate-300 hover:border-[#A92224] text-xs font-black text-slate-800 shadow-xs cursor-pointer transition-colors"
                >
                  {loading ? 'جاري التحميل...' : 'عرض المزيد من المنتجات'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* FILTER DRAWER MODAL (Preserved 100%) */}
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
                    <option key={m.id} value={m.id}>
                      {m.business_name_ar}
                    </option>
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
                    <option key={c.id} value={c.id}>
                      {c.full_path_ar || c.name_ar}
                    </option>
                  ))}
                </select>
              </div>

              {brands.length > 0 && (
                <div>
                  <label className="text-xs font-black text-slate-700 block mb-1.5">العلامة التجارية</label>
                  <select
                    value={selectedBrand}
                    onChange={(e) => onSelectBrand(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                  >
                    <option value="">كل الماركات</option>
                    {brands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
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
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                مسح الكل
              </button>
              <button
                type="button"
                onClick={() => setFilterDrawerOpen(false)}
                className="flex-[2] py-2.5 rounded-xl bg-[#A92224] text-white text-xs font-black hover:bg-[#86191B] cursor-pointer"
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
