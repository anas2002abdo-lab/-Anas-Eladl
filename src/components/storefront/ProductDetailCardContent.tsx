import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Gift,
  Heart,
  Info,
  Minus,
  Package,
  Percent,
  Plus,
  Share2,
  ShoppingCart,
  Store,
  TrendingDown,
  X,
  ZoomIn,
} from 'lucide-react';
import type {
  StoreComparisonOption,
  StorefrontProductDetailsResponse,
} from '../../shared/types';

export interface SwipeProductPreview {
  id: string;
  name_ar: string;
  name_en?: string;
  brand?: string;
  size_label?: string;
  image_url?: string;
  base_price: number;
  sale_price?: number | null;
  effective_price?: number;
  discount_percent?: number;
  merchant_id?: string;
  merchant_name?: string;
  is_available?: boolean;
  stores_count?: number;
}

export interface ProductCardLocalState {
  qty: number;
  selectedStoreProductId: string;
  activeImage: string;
  selectedGiftId: string;
  bundleSelectedIds: string[];
}

interface Props {
  productId: string;
  preview?: SwipeProductPreview;
  details?: StorefrontProductDetailsResponse;
  loading: boolean;
  error?: string | null;
  isActive: boolean;
  isFavorite: boolean;
  cartCount: number;
  savedState?: ProductCardLocalState;
  onSaveState: (productId: string, state: ProductCardLocalState) => void;
  onToggleFavorite: (productId: string) => void;
  onClose: () => void;
  onOpenCart: () => void;
  onOpenProduct: (productId: string, listHint?: SwipeProductPreview[]) => void;
  onSelectBrand: (brand: string) => void;
  onSelectStore: (merchantId: string, merchantName: string) => void;
  onAddToCart: (item: {
    id: string;
    merchant_id: string;
    merchant_name: string;
    name_ar: string;
    price: number;
    image_url: string;
    quantity: number;
    giftNote?: string;
  }) => void;
  onNotify: (msg: string) => void;
  onZoomImage: (imageUrl: string, title: string) => void;
  onSelectCard?: () => void;
}

export const ProductDetailCardContent: React.FC<Props> = memo(
  ({
    productId,
    preview,
    details,
    loading,
    error,
    isActive,
    isFavorite,
    cartCount,
    savedState,
    onSaveState,
    onToggleFavorite,
    onClose,
    onOpenCart,
    onOpenProduct,
    onSelectBrand,
    onSelectStore,
    onAddToCart,
    onNotify,
    onZoomImage,
    onSelectCard,
  }) => {
    const [qty, setQty] = useState<number>(savedState?.qty ?? 1);
    const [selectedStoreProductId, setSelectedStoreProductId] = useState<string>(
      savedState?.selectedStoreProductId ?? ''
    );
    const [activeImage, setActiveImage] = useState<string>(
      savedState?.activeImage || preview?.image_url || ''
    );
    const [selectedGiftId, setSelectedGiftId] = useState<string>(savedState?.selectedGiftId ?? '');
    const [bundleSelectedIds, setBundleSelectedIds] = useState<string[]>(
      savedState?.bundleSelectedIds ?? []
    );
    const [justAdded, setJustAdded] = useState(false);
    const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initializedForDetailsRef = useRef<string>('');

    useEffect(() => {
      return () => {
        if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      };
    }, []);

    // Hydrate defaults once full details arrive for this exact productId (without overwriting user's saved choices)
    useEffect(() => {
      if (!details || details.product.id !== productId) return;
      if (initializedForDetailsRef.current === productId) return;
      initializedForDetailsRef.current = productId;

      const resolvedImg =
        savedState?.activeImage ||
        details.product.image_url ||
        details.product.images?.[0] ||
        preview?.image_url ||
        '';
      if (resolvedImg) setActiveImage(resolvedImg);

      if (!savedState?.selectedStoreProductId) {
        const currentInAvail = details.comparison.available_stores.find(
          (s) => s.product_id === details.product.id
        );
        const preferred = details.comparison.available_stores[0] || currentInAvail || null;
        if (preferred) setSelectedStoreProductId(preferred.product_id);
      }

      if (!savedState?.selectedGiftId) {
        const giftDeal = details.deals?.find((d) => d.gift_products?.length > 0);
        if (giftDeal && giftDeal.gift_products[0]) {
          setSelectedGiftId(giftDeal.gift_products[0].id);
        }
      }
    }, [details, productId, preview?.image_url, savedState]);

    // Persist per-product local selections back to the pager map so swiping away & back preserves state
    useEffect(() => {
      onSaveState(productId, {
        qty,
        selectedStoreProductId,
        activeImage,
        selectedGiftId,
        bundleSelectedIds,
      });
    }, [productId, qty, selectedStoreProductId, activeImage, selectedGiftId, bundleSelectedIds, onSaveState]);

    const product = details?.product;
    const selectedStore: StoreComparisonOption | null =
      details?.comparison.available_stores.find((s) => s.product_id === selectedStoreProductId) ||
      details?.comparison.available_stores[0] ||
      null;

    const displayName = product?.name_ar || preview?.name_ar || 'منتج في اطلبها';
    const displayBrand = product?.brand || preview?.brand || '';
    const displaySize = product?.size_label || preview?.size_label || '';
    const displayImage = activeImage || product?.image_url || preview?.image_url || '';

    const fallbackEffectivePrice =
      preview?.effective_price ??
      (preview?.sale_price !== null &&
      preview?.sale_price !== undefined &&
      preview.sale_price < (preview.base_price ?? 0)
        ? Number(preview.sale_price)
        : Number(preview?.base_price ?? 0));

    const activeEffectivePrice = selectedStore
      ? selectedStore.effective_price
      : product?.effective_price ?? fallbackEffectivePrice;
    const activeBasePrice = selectedStore
      ? selectedStore.base_price
      : product?.base_price ?? Number(preview?.base_price ?? activeEffectivePrice);
    const activeMerchantName = selectedStore
      ? selectedStore.merchant_name
      : product?.merchant_name || preview?.merchant_name || '';
    const activeMerchantId = selectedStore
      ? selectedStore.merchant_id
      : product?.merchant_id || preview?.merchant_id || '';
    const activeListingId = selectedStore ? selectedStore.product_id : product?.id || productId;
    const activeAvailable = selectedStore
      ? selectedStore.is_available
      : product
      ? Boolean(product.is_available)
      : preview?.is_available ?? true;

    const hasDiscount = activeBasePrice > activeEffectivePrice;
    const discountPct =
      hasDiscount && activeBasePrice > 0
        ? Math.round(((activeBasePrice - activeEffectivePrice) / activeBasePrice) * 100)
        : preview?.discount_percent || 0;

    const totalLinePrice = Math.round(activeEffectivePrice * qty * 100) / 100;
    const totalBasePrice = Math.round(activeBasePrice * qty * 100) / 100;
    const selectedGiftCount = selectedGiftId ? 1 : 0;

    const handleShare = async () => {
      const text = `${displayName} — بسعر ${activeEffectivePrice} ج.م عبر تطبيق اطلبها Otlobha`;
      try {
        if (navigator.share) {
          await navigator.share({ title: displayName, text });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          onNotify('تم نسخ تفاصيل المنتج للمشاركة');
        }
      } catch {
        onNotify('تم نسخ رابط ومعلومات المنتج');
      }
    };

    const handleConfirmAdd = () => {
      if (!activeAvailable) return;
      onAddToCart({
        id: activeListingId,
        merchant_id: activeMerchantId,
        merchant_name: activeMerchantName,
        name_ar: displayName,
        price: activeEffectivePrice,
        image_url: displayImage,
        quantity: qty,
        giftNote: selectedGiftId ? 'شامل الهدية المجانية' : undefined,
      });
      onNotify(`تمت إضافة ${qty} × ${displayName}${activeMerchantName ? ` من ${activeMerchantName}` : ''} للسلة`);
      setJustAdded(true);
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      addedTimerRef.current = setTimeout(() => setJustAdded(false), 1600);
    };

    const renderMiniHorizontalList = (title: string, list: Array<Record<string, any>>) => {
      if (!list || list.length === 0) return null;
      const listAsPreviews: SwipeProductPreview[] = list.map((item) => {
        const eff =
          item.sale_price !== null && item.sale_price !== undefined && item.sale_price < item.base_price
            ? Number(item.sale_price)
            : Number(item.base_price);
        return {
          id: String(item.id),
          name_ar: String(item.name_ar || ''),
          brand: item.brand ? String(item.brand) : undefined,
          size_label: item.size_label ? String(item.size_label) : undefined,
          image_url: item.image_url ? String(item.image_url) : undefined,
          base_price: Number(item.base_price || eff),
          sale_price: item.sale_price !== undefined ? item.sale_price : null,
          effective_price: eff,
          merchant_id: item.merchant_id ? String(item.merchant_id) : undefined,
          merchant_name: item.merchant_name ? String(item.merchant_name) : undefined,
          is_available: item.is_available !== false,
        };
      });

      return (
        <section className="space-y-2.5">
          <h4 className="text-sm font-black text-slate-900">{title}</h4>
          <div
            data-horizontal-scroll="true"
            className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar touch-pan-x"
          >
            {list.map((item) => {
              const eff =
                item.sale_price !== null &&
                item.sale_price !== undefined &&
                item.sale_price < item.base_price
                  ? Number(item.sale_price)
                  : Number(item.base_price);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenProduct(item.id, listAsPreviews)}
                  className="w-32 shrink-0 bg-white rounded-2xl border border-slate-200 p-2 text-right hover:border-[#A92224]/50 transition cursor-pointer flex flex-col gap-1.5"
                >
                  <div className="aspect-square rounded-xl bg-[#F9FAFB] flex items-center justify-center overflow-hidden p-1.5">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name_ar}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Package className="w-6 h-6 text-[#A92224]/40" />
                    )}
                  </div>
                  <div className="text-[11px] font-bold text-slate-900 line-clamp-2 min-h-[2rem] leading-tight">
                    {item.name_ar}
                  </div>
                  <div className="text-xs font-black text-[#A92224] tabular-nums">
                    {eff} <span className="text-[10px]">ج.م</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      );
    };

    return (
      <div
        className={`relative w-full h-full bg-[#F6F7F9] rounded-[28px] flex flex-col overflow-hidden border transition-shadow duration-300 ${
          isActive
            ? 'border-white/80 shadow-[0_24px_60px_rgba(15,23,42,0.38)]'
            : 'border-white/40 shadow-[0_12px_32px_rgba(15,23,42,0.22)]'
        }`}
        dir="rtl"
      >
        {/* Non-active peeking card click interceptor so tapping a peeking card glides straight to it */}
        {!isActive && onSelectCard && (
          <button
            type="button"
            aria-label={`الانتقال إلى ${displayName}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCard();
            }}
            className="absolute inset-0 z-30 bg-slate-950/[0.06] hover:bg-slate-950/[0.02] transition-colors cursor-pointer"
          />
        )}

        {/* Top Handle Strip */}
        <div className="bg-white pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>

        {/* Vertically Scrollable Body — isolated from horizontal swipe via touch-pan-y */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain touch-pan-y">
          <div className="space-y-3 pb-6">
            {/* 1. HERO IMAGE & FLOATING ACTIONS */}
            <div className="relative bg-white px-4 pt-2 pb-5 rounded-b-3xl shadow-xs">
              {/* Floating Close Button (Top-Left in RTL) */}
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق تفاصيل المنتج"
                className="absolute top-2 left-4 z-10 w-10 h-10 rounded-full bg-white/95 border border-slate-200 shadow-md flex items-center justify-center text-slate-700 hover:bg-slate-50 hover:text-[#A92224] transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Floating Action Stack (Top-Right in RTL: Cart, Favorite, Share) */}
              <div className="absolute top-2 right-4 z-10 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCart();
                  }}
                  aria-label="السلة"
                  className="relative w-10 h-10 rounded-full bg-white/95 border border-slate-200 shadow-md flex items-center justify-center text-slate-700 hover:text-[#A92224] transition cursor-pointer"
                >
                  <ShoppingCart className="w-4 h-4" />
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#A92224] text-white text-[10px] font-black flex items-center justify-center tabular-nums">
                      {cartCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(productId)}
                  aria-label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                  className={`w-10 h-10 rounded-full bg-white/95 border shadow-md flex items-center justify-center cursor-pointer transition ${
                    isFavorite
                      ? 'border-red-300 text-[#A92224]'
                      : 'border-slate-200 text-slate-600 hover:text-[#A92224]'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isFavorite ? 'fill-[#A92224]' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  aria-label="مشاركة المنتج"
                  className="w-10 h-10 rounded-full bg-white/95 border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:text-[#A92224] transition cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </div>

              {/* Main Zoomable Product Image */}
              <div
                onClick={() => isActive && displayImage && onZoomImage(displayImage, displayName)}
                className="h-56 sm:h-60 flex items-center justify-center relative cursor-zoom-in select-none"
              >
                {displayImage ? (
                  <img
                    src={displayImage}
                    alt={displayName}
                    draggable={false}
                    referrerPolicy="no-referrer"
                    className="max-h-52 sm:max-h-56 max-w-[74%] object-contain select-none"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-3xl bg-[#FEF2F2] text-[#A92224]/50 flex items-center justify-center">
                    <Package className="w-14 h-14" />
                  </div>
                )}
                {displayImage && isActive && (
                  <span className="absolute bottom-1 left-2 px-2.5 py-1 rounded-full bg-slate-900/70 text-white text-[10px] font-bold flex items-center gap-1">
                    <ZoomIn className="w-3 h-3" /> تكبير
                  </span>
                )}
              </div>

              {/* Extra gallery thumbnails */}
              {product?.images && product.images.length > 1 && (
                <div
                  data-horizontal-scroll="true"
                  className="flex justify-center gap-2 mt-2 overflow-x-auto no-scrollbar"
                >
                  {product.images.map((imgUrl) => (
                    <button
                      key={imgUrl}
                      type="button"
                      onClick={() => setActiveImage(imgUrl)}
                      className={`w-12 h-12 rounded-xl border-2 p-1 bg-white shrink-0 cursor-pointer transition ${
                        displayImage === imgUrl ? 'border-[#A92224]' : 'border-slate-200'
                      }`}
                    >
                      <img
                        src={imgUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* 2. PRODUCT CORE INFO */}
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                  {discountPct > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-[#A92224] text-white text-[11px] font-black tabular-nums">
                      خصم {discountPct}%
                    </span>
                  )}
                  {displayBrand && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectBrand(displayBrand);
                      }}
                      className="font-extrabold text-[#A92224] hover:underline cursor-pointer"
                    >
                      {displayBrand}
                    </button>
                  )}
                  {displaySize && (
                    <>
                      {displayBrand && <span className="text-slate-300" aria-hidden="true">·</span>}
                      <span className="text-slate-600 font-bold">{displaySize}</span>
                    </>
                  )}
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span
                    className={`font-extrabold ${
                      activeAvailable ? 'text-emerald-700' : 'text-[#A92224]'
                    }`}
                  >
                    {activeAvailable ? 'متوفر الآن' : 'غير متوفر حاليًا'}
                  </span>
                </div>

                <h2 className="text-lg font-black text-slate-950 leading-snug text-balance">
                  {displayName}
                </h2>

                <div className="flex items-end justify-between gap-2 pt-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-slate-950 tabular-nums">
                      {activeEffectivePrice.toLocaleString('ar-EG')}
                      <span className="text-xs font-bold text-slate-600 mr-1">ج.م</span>
                    </span>
                    {hasDiscount && (
                      <span className="text-sm text-slate-400 line-through tabular-nums">
                        {activeBasePrice.toLocaleString('ar-EG')} ج.م
                      </span>
                    )}
                  </div>
                  {(product?.purchase_count ?? 0) > 0 && (
                    <span className="text-xs font-bold text-slate-500 tabular-nums">
                      اشتراه +{product?.purchase_count} عميل
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Secondary sections: show lightweight skeleton while full details load */}
            {loading && !details ? (
              <div className="px-3.5 space-y-3">
                <div className="bg-white rounded-3xl border border-slate-200/80 p-4 space-y-3 animate-pulse">
                  <div className="h-4 w-44 rounded bg-slate-200" />
                  <div className="h-14 rounded-2xl bg-slate-100" />
                  <div className="h-14 rounded-2xl bg-slate-100" />
                </div>
                <div className="bg-white rounded-3xl border border-slate-200/80 p-4 space-y-2 animate-pulse">
                  <div className="h-4 w-32 rounded bg-slate-200" />
                  <div className="h-3 w-full rounded bg-slate-100" />
                  <div className="h-3 w-3/4 rounded bg-slate-100" />
                </div>
              </div>
            ) : error && !details ? (
              <div className="px-3.5">
                <div className="bg-white rounded-3xl border border-red-200 p-5 text-center space-y-1.5">
                  <p className="text-xs font-black text-[#A92224]">{error}</p>
                  <p className="text-[11px] text-slate-500">يمكنك السحب للانتقال للمنتج التالي أو إضافة المنتج مباشرة.</p>
                </div>
              </div>
            ) : details ? (
              <div className="px-3.5 space-y-3">
                {/* 3. MULTI-STORE PRICE COMPARISON */}
                <section className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-xs space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        <TrendingDown className="w-4 h-4 text-[#A92224]" />
                        {details.comparison.has_multi_store
                          ? `مقارنة الأسعار بين المتاجر (${details.comparison.stores_count} متاجر)`
                          : 'المتجر الموفّر للمنتج'}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {details.comparison.has_multi_store
                          ? 'مرتّبة تلقائيًا من الأقل سعرًا للأعلى لنفس العلامة والحجم بالضبط'
                          : 'سعر وتوفر هذا المنتج في المتجر المعتمد'}
                      </p>
                    </div>
                    {details.comparison.max_savings > 0 && (
                      <span className="px-2.5 py-1 rounded-xl bg-[#FFFBEB] border border-[#F5A623]/60 text-[#92400E] text-[11px] font-black shrink-0 tabular-nums">
                        وفّر حتى {details.comparison.max_savings} ج.م
                      </span>
                    )}
                  </div>

                  {/* Available Stores List */}
                  <div className="space-y-2">
                    {details.comparison.available_stores.map((st) => {
                      const isSelected = selectedStore?.product_id === st.product_id;
                      return (
                        <button
                          key={st.product_id}
                          type="button"
                          onClick={() => setSelectedStoreProductId(st.product_id)}
                          className={`w-full text-right rounded-2xl border-2 p-3 transition cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'border-[#A92224] bg-[#FEF2F2]/60'
                              : 'border-slate-200 hover:border-red-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                              {st.image_url ? (
                                <img
                                  src={st.image_url}
                                  alt={st.merchant_name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-contain p-0.5"
                                />
                              ) : (
                                <Store className="w-5 h-5 text-[#A92224]" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-extrabold text-sm text-slate-900 truncate">
                                  {st.merchant_name}
                                </span>
                                {st.is_lowest && details.comparison.available_stores.length > 1 && (
                                  <span className="text-[10px] font-black text-emerald-700">
                                    · أقل سعر متاح
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                <span>{st.size_label || details.product.size_label || 'نفس العبوة'}</span>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-bold tabular-nums">
                                  متوفر ({st.stock_quantity})
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="text-left shrink-0">
                            <div className="text-base font-black text-[#A92224] tabular-nums">
                              {st.effective_price} <span className="text-[10px]">ج.م</span>
                            </div>
                            {st.is_lowest && (st.savings_vs_highest ?? 0) > 0 ? (
                              <div className="text-[10px] font-black text-emerald-700 tabular-nums">
                                توفّر {st.savings_vs_highest} ج.م
                              </div>
                            ) : (st.price_diff_from_lowest ?? 0) > 0 ? (
                              <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                                +{st.price_diff_from_lowest} ج.م فرق
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Unavailable Stores */}
                  {details.comparison.unavailable_stores.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-400">غير متوفر حاليًا في:</div>
                      {details.comparison.unavailable_stores.map((st) => (
                        <div
                          key={st.product_id}
                          className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2 flex items-center justify-between text-xs text-slate-400"
                        >
                          <span className="font-bold">{st.merchant_name}</span>
                          <span className="tabular-nums">غير متاح · {st.effective_price} ج.م</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* 4. SAVINGS DEALS & FREE GIFTS */}
                {details.deals && details.deals.length > 0 && (
                  <section className="space-y-2.5">
                    {details.deals.map((deal) => {
                      const reqQty = Math.max(1, deal.required_qty || 1);
                      const chosenCount =
                        deal.bundle_products?.length > 0
                          ? bundleSelectedIds.length
                          : Math.min(qty, reqQty);
                      const remaining = Math.max(0, reqQty - chosenCount);
                      const pct = Math.min(100, Math.round((chosenCount / reqQty) * 100));

                      return (
                        <div
                          key={deal.id}
                          className="bg-white rounded-3xl border border-[#F5A623]/50 p-4 shadow-xs space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-[#FEF2F2] text-[#A92224] flex items-center justify-center shrink-0">
                                {deal.deal_type === 'free_gift' ? (
                                  <Gift className="w-4 h-4" />
                                ) : (
                                  <Percent className="w-4 h-4" />
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-black text-slate-900">{deal.title_ar}</div>
                                {deal.subtitle_ar && (
                                  <div className="text-[11px] text-slate-500">{deal.subtitle_ar}</div>
                                )}
                              </div>
                            </div>
                            {deal.discount_amount > 0 && (
                              <span className="px-2 py-0.5 rounded-lg bg-[#A92224] text-white text-[11px] font-black shrink-0 tabular-nums">
                                وفّر {deal.discount_amount} ج.م
                              </span>
                            )}
                          </div>

                          {reqQty > 1 && (
                            <div className="space-y-1.5 bg-slate-50 rounded-2xl p-3">
                              <div className="flex items-center justify-between text-[11px] font-bold">
                                <span className="text-slate-700 tabular-nums">
                                  المختار: {chosenCount} من {reqQty}
                                </span>
                                <span className="text-[#A92224]">
                                  {remaining === 0 ? 'اكتمل العرض ✓' : `المتبقي ${remaining} لإكمال العرض`}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-l from-[#A92224] to-[#F5A623] transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {deal.gift_products && deal.gift_products.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-extrabold text-slate-700">
                                اختر هديتك المجانية مع هذا المنتج:
                              </div>
                              <div className="space-y-1.5">
                                {deal.gift_products.map((gift: any) => {
                                  const picked = selectedGiftId === gift.id;
                                  return (
                                    <button
                                      key={gift.id}
                                      type="button"
                                      onClick={() => setSelectedGiftId(gift.id)}
                                      className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-2xl border text-right cursor-pointer transition ${
                                        picked
                                          ? 'border-[#A92224] bg-[#FEF2F2]/60'
                                          : 'border-slate-200 bg-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        {gift.image_url ? (
                                          <img
                                            src={gift.image_url}
                                            alt={gift.name_ar}
                                            referrerPolicy="no-referrer"
                                            className="w-9 h-9 rounded-lg object-contain bg-white"
                                          />
                                        ) : (
                                          <Gift className="w-5 h-5 text-[#A92224]" />
                                        )}
                                        <span className="text-xs font-bold text-slate-900 truncate">
                                          {gift.name_ar}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-[11px] font-black text-emerald-700">مجانًا</span>
                                        <CheckCircle2
                                          className={`w-4 h-4 ${picked ? 'text-[#A92224]' : 'text-slate-300'}`}
                                        />
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {deal.bundle_products && deal.bundle_products.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-xs font-extrabold text-slate-700">
                                اختر منتجات الباقة:
                              </div>
                              {deal.bundle_products.map((bp: any) => {
                                const picked = bundleSelectedIds.includes(bp.id);
                                return (
                                  <button
                                    key={bp.id}
                                    type="button"
                                    onClick={() =>
                                      setBundleSelectedIds((prev) =>
                                        prev.includes(bp.id)
                                          ? prev.filter((x) => x !== bp.id)
                                          : [...prev, bp.id]
                                      )
                                    }
                                    className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl border text-right cursor-pointer transition ${
                                      picked
                                        ? 'border-[#A92224] bg-[#FEF2F2]/60'
                                        : 'border-slate-200 bg-white'
                                    }`}
                                  >
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {bp.name_ar}
                                    </span>
                                    <CheckCircle2
                                      className={`w-4 h-4 shrink-0 ${
                                        picked ? 'text-[#A92224]' : 'text-slate-300'
                                      }`}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                )}

                {/* 5. DESCRIPTION & SPECIFICATIONS */}
                {(details.product.description ||
                  details.product.usage_notes ||
                  details.product.ingredients ||
                  details.attributes.length > 0) && (
                  <section className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-[#A92224]" />
                      وصف المنتج والمواصفات
                    </h4>
                    {details.product.description && (
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {details.product.description}
                      </p>
                    )}
                    {details.product.usage_notes && (
                      <div className="text-xs text-slate-600">
                        <b className="text-slate-800">الاستخدامات: </b>
                        {details.product.usage_notes}
                      </div>
                    )}
                    {details.product.ingredients && (
                      <div className="text-xs text-slate-600">
                        <b className="text-slate-800">المكونات: </b>
                        {details.product.ingredients}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {details.product.size_label && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <span className="text-slate-400 block text-[10px]">الحجم / الوزن</span>
                          <span className="font-bold text-slate-800">{details.product.size_label}</span>
                        </div>
                      )}
                      {details.product.barcode && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <span className="text-slate-400 block text-[10px]">الباركود</span>
                          <span className="font-mono font-bold text-slate-800">
                            {details.product.barcode}
                          </span>
                        </div>
                      )}
                      {details.attributes.map((attr) => (
                        <div key={attr.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <span className="text-slate-400 block text-[10px]">{attr.attr_key}</span>
                          <span className="font-bold text-slate-800">{attr.attr_value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 6. BRAND & STORE NAVIGATION CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {details.product.brand && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectBrand(details.product.brand!);
                      }}
                      className="bg-white rounded-2xl border border-slate-200 p-3.5 flex items-center justify-between hover:border-[#A92224]/50 transition cursor-pointer text-right"
                    >
                      <div>
                        <div className="text-[10px] font-bold text-slate-400">العلامة التجارية</div>
                        <div className="text-sm font-black text-slate-900">{details.product.brand}</div>
                        <div className="text-[11px] font-bold text-[#A92224] mt-0.5">اكتشف المزيد</div>
                      </div>
                      <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </button>
                  )}

                  {activeMerchantName && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectStore(activeMerchantId, activeMerchantName);
                      }}
                      className="bg-white rounded-2xl border border-slate-200 p-3.5 flex items-center justify-between hover:border-[#A92224]/50 transition cursor-pointer text-right"
                    >
                      <div>
                        <div className="text-[10px] font-bold text-slate-400">المتجر المختار</div>
                        <div className="text-sm font-black text-slate-900">{activeMerchantName}</div>
                        <div className="text-[11px] font-bold text-[#A92224] mt-0.5">تصفّح منتجات المتجر</div>
                      </div>
                      <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </button>
                  )}
                </div>

                {/* 7. ALTERNATIVE & COMPLEMENTARY PRODUCTS */}
                {renderMiniHorizontalList('بدائل مشابهة بسعر أقل', details.cheaper_alternatives)}
                {renderMiniHorizontalList(
                  `منتجات أخرى من ${details.product.brand || 'نفس العلامة'}`,
                  details.same_brand_products
                )}
                {renderMiniHorizontalList(
                  'منتجات مكملة يمكنك شراؤها معًا',
                  details.complementary_products
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* 8. STICKY BOTTOM ADD-TO-CART BAR */}
        <div className="bg-white border-t border-slate-200 px-3.5 py-3 flex items-center gap-2.5 shrink-0 shadow-[0_-4px_18px_rgba(15,23,42,0.06)]">
          {/* Quantity Stepper */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-2xl p-1 shrink-0">
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              aria-label="زيادة الكمية"
              className="w-9 h-9 rounded-xl bg-white text-[#A92224] shadow-xs flex items-center justify-center font-black cursor-pointer hover:bg-[#FEF2F2] transition"
            >
              <Plus className="w-4 h-4" />
            </button>
            <span className="w-7 text-center text-sm font-black tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="تقليل الكمية"
              className="w-9 h-9 rounded-xl bg-white text-slate-700 shadow-xs flex items-center justify-center font-black cursor-pointer hover:bg-slate-50 transition"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Add CTA */}
          <button
            type="button"
            disabled={!activeAvailable || (!details && loading && activeEffectivePrice <= 0)}
            onClick={handleConfirmAdd}
            className={`flex-1 h-12 rounded-2xl px-3.5 font-black text-sm flex items-center justify-between transition shadow-md cursor-pointer ${
              !activeAvailable
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none'
                : justAdded
                ? 'bg-emerald-600 text-white'
                : 'bg-[#A92224] hover:bg-[#86191B] text-white active:scale-[0.99]'
            }`}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {justAdded ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>تمت الإضافة</span>
                </>
              ) : (
                <>
                  <span>{activeAvailable ? 'أضف إلى السلة' : 'غير متوفر'}</span>
                  {selectedGiftCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-md bg-[#F5A623] text-[#3B180E] text-[10px] font-black">
                      +{selectedGiftCount} هدية
                    </span>
                  )}
                </>
              )}
            </span>
            <span className="flex items-baseline gap-1.5 tabular-nums whitespace-nowrap">
              <span>{totalLinePrice.toLocaleString('ar-EG')} ج.م</span>
              {hasDiscount && (
                <span className="text-[11px] line-through text-white/65">
                  {totalBasePrice.toLocaleString('ar-EG')}
                </span>
              )}
            </span>
          </button>
        </div>
      </div>
    );
  }
);

ProductDetailCardContent.displayName = 'ProductDetailCardContent';
