import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Flame,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { StorefrontProductCard } from '../../shared/types';
import { OtlobhaProductCard } from './OtlobhaProductCard';
import { useTypewriterPlaceholder } from '../../hooks/useTypewriterPlaceholder';

type MatchedStoreRecord = {
  id: string;
  business_name_ar: string;
  business_name_en?: string;
  merchant_type?: string;
  description?: string;
  image_url?: string;
  cover_image_url?: string;
  address?: string;
  zone_name?: string;
  rating_avg?: number;
  rating_count?: number;
  is_open?: boolean;
  is_open_now?: boolean;
  products_count: number;
  offers_count?: number;
};

interface Props {
  open: boolean;
  initialQuery?: string;
  cartQtyMap: Record<string, number>;
  onClose: () => void;
  onOpenProduct: (productId: string, orderedList?: StorefrontProductCard[]) => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onDecrementProduct: (productId: string) => void;
  onSelectStore?: (merchantId: string, merchantName: string) => void;
}

export const OtlobhaSmartSearchOverlay: React.FC<Props> = ({
  open,
  initialQuery = '',
  cartQtyMap,
  onClose,
  onOpenProduct,
  onAddProduct,
  onDecrementProduct,
  onSelectStore,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'relevance' | 'price_asc' | 'price_desc' | 'discount'>('relevance');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StorefrontProductCard[]>([]);
  const [matchedStores, setMatchedStores] = useState<MatchedStoreRecord[]>([]);
  const [topOffers, setTopOffers] = useState<StorefrontProductCard[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [stores, setStores] = useState<Array<{ id: string; business_name_ar: string; products_count: number }>>([]);

  const shouldAnimatePlaceholder = open && !isInputFocused && query.length === 0;
  const { text: animatedPlaceholder, isAnimating: isPlaceholderAnimating } = useTypewriterPlaceholder({
    active: shouldAnimatePlaceholder,
    pausedText: 'ابحث عن...',
  });

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(focusTimer);
    } else {
      setIsInputFocused(false);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchStorefront({
          q: query.trim(),
          brand: selectedBrand || undefined,
          merchant_id: selectedStoreId || undefined,
          min_price: minPrice || undefined,
          max_price: maxPrice || undefined,
          sort,
          limit: 30,
        });
        setItems(res.items || []);
        setMatchedStores(res.stores || []);
        setTopOffers(res.top_offers || []);
        setTrending(res.trending_queries || []);
        setBrands(res.facets?.brands || []);
        setStores(res.facets?.stores || []);
      } catch {
        // ignore transient search errors
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, selectedBrand, selectedStoreId, minPrice, maxPrice, sort]);

  if (!open) return null;

  const hasActiveFilter = Boolean(selectedBrand || selectedStoreId || minPrice || maxPrice || sort !== 'relevance');
  const showingResults = Boolean(query.trim() || hasActiveFilter);

  return (
    <div className="fixed inset-0 z-50 bg-[#F6F7F9] flex flex-col" dir="rtl">
      {/* Sticky Search Header */}
      <div className="bg-white border-b border-slate-200 px-3 py-3 space-y-2.5 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="رجوع"
            className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 shrink-0 cursor-pointer"
          >
            <ArrowRight className="w-5 h-5" />
          </button>

          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#A92224] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <input
              ref={inputRef}
              dir="rtl"
              value={query}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="ابحث عن منتج أو متجر"
              placeholder={isInputFocused ? 'ابحث عن...' : ''}
              className="w-full h-11 pr-10 pl-9 rounded-2xl bg-[#F6F7F9] border border-slate-200 focus:border-[#A92224] focus:bg-white focus:outline-none text-sm font-semibold text-slate-900 placeholder:text-slate-400"
            />
            {!query && !isInputFocused && (
              <span
                dir="rtl"
                aria-hidden="true"
                className="pointer-events-none select-none absolute inset-y-0 right-10 left-9 flex items-center overflow-hidden text-sm font-semibold text-slate-400"
              >
                <span className="truncate w-full text-right">
                  {animatedPlaceholder || '\u200B'}
                  {isPlaceholderAnimating && (
                    <span className="inline-block w-[1.5px] h-[1em] align-[-0.15em] mr-0.5 bg-[#A92224]/70 animate-pulse" />
                  )}
                </span>
              </span>
            )}
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="w-7 h-7 rounded-full hover:bg-slate-200 flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((p) => !p)}
            className={`h-11 px-3 rounded-2xl border text-xs font-extrabold flex items-center gap-1.5 shrink-0 cursor-pointer transition ${
              showFilters || hasActiveFilter
                ? 'bg-[#A92224] text-white border-[#A92224]'
                : 'bg-white text-slate-700 border-slate-200 hover:border-[#A92224]/40'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">تصفية</span>
          </button>
        </div>

        {/* Collapsible Price / Store / Brand Filter Bar */}
        {showFilters && (
          <div className="max-w-3xl mx-auto pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
            >
              <option value="relevance">الأكثر صلة</option>
              <option value="price_asc">الأقل سعرًا أولًا</option>
              <option value="price_desc">الأعلى سعرًا</option>
              <option value="discount">أعلى خصم</option>
            </select>

            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
            >
              <option value="">كل المتاجر</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.business_name_ar} ({s.products_count})
                </option>
              ))}
            </select>

            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
            >
              <option value="">كل العلامات</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="من سعر (ج.م)"
              className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold"
            />
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="إلى سعر (ج.م)"
              className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold"
            />

            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setSelectedBrand('');
                  setSelectedStoreId('');
                  setMinPrice('');
                  setMaxPrice('');
                  setSort('relevance');
                }}
                className="col-span-2 sm:col-span-5 text-xs font-bold text-[#A92224] hover:underline text-start cursor-pointer"
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="max-w-3xl mx-auto space-y-6 pb-10">
          {!showingResults ? (
            <>
              {/* Approved Stores Horizontal Discovery Strip */}
              {matchedStores.length > 0 && (
                <section className="space-y-2.5">
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-[#A92224]" />
                    المتاجر المعتمدة
                  </h3>
                  <div className="flex items-stretch gap-2.5 overflow-x-auto no-scrollbar pb-1">
                    {matchedStores.map((st) => {
                      const ratingVal = Number(st.rating_avg || 0);
                      const rawOpen = st.is_open_now !== undefined ? st.is_open_now : st.is_open;
                      const isOpen = rawOpen === true || Number(rawOpen) === 1;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            if (onSelectStore) {
                              onSelectStore(st.id, st.business_name_ar);
                            } else if (typeof window !== 'undefined') {
                              window.location.assign(`/store/${encodeURIComponent(st.id)}`);
                            }
                          }}
                          className="shrink-0 w-[108px] rounded-2xl bg-white border border-slate-200 hover:border-[#A92224]/50 p-2.5 flex flex-col items-center text-center gap-1.5 shadow-xs transition cursor-pointer"
                        >
                          <div className="relative">
                            <div className="w-11 h-11 rounded-xl bg-[#FEF2F2] border border-slate-100 overflow-hidden flex items-center justify-center">
                              {st.image_url ? (
                                <img
                                  src={st.image_url}
                                  alt={st.business_name_ar}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Store className="w-5 h-5 text-[#A92224]" />
                              )}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                isOpen ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                            />
                          </div>
                          <span className="text-[11px] font-extrabold text-slate-900 line-clamp-2 leading-tight">
                            {st.business_name_ar}
                          </span>
                          {ratingVal > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 tabular-nums">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                              {ratingVal.toFixed(1)}
                            </span>
                          ) : (
                            <span className={`text-[10px] font-bold ${isOpen ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {isOpen ? 'مفتوح' : 'مغلق'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Trending Searches */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-[#A92224]" />
                  الأكثر بحثاً حولك
                </h3>
                <div className="flex flex-wrap gap-2">
                  {trending.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQuery(term)}
                      className="px-3.5 py-2 rounded-2xl bg-white border border-slate-200 hover:border-[#A92224] text-xs font-bold text-slate-800 shadow-xs transition cursor-pointer"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </section>

              {/* Smart Suggestions */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#F5A623]" />
                  مقترحات ذكية
                </h3>
                <div className="flex flex-wrap gap-2">
                  {['نسكافيه', 'ألبان وبيض', 'زيت طعام', 'أرز وحبوب', 'منظفات', 'عصائر'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setQuery(s)}
                      className="px-3.5 py-2 rounded-2xl bg-[#FEF2F2] border border-red-200/70 text-xs font-extrabold text-[#A92224] hover:bg-[#A92224] hover:text-white transition cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </section>

              {/* Best Offers Horizontal Strip */}
              {topOffers.length > 0 && (
                <section className="space-y-2.5">
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                    <Flame className="w-4 h-4 text-[#A92224]" />
                    أفضل العروض المتاحة الآن
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {topOffers.slice(0, 6).map((p) => (
                      <OtlobhaProductCard
                        key={p.id}
                        product={p}
                        cartQty={cartQtyMap[p.id] || 0}
                        onOpenDetails={(id) => onOpenProduct(id, topOffers.slice(0, 6))}
                        onAdd={onAddProduct}
                        onDecrement={onDecrementProduct}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="space-y-4">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>
                  {loading
                    ? 'جاري البحث الفوري...'
                    : matchedStores.length > 0 && items.length > 0
                    ? `تم العثور على ${matchedStores.length} متجر و ${items.length} منتج`
                    : matchedStores.length > 0
                    ? `تم العثور على ${matchedStores.length} متجر مطابق`
                    : `تم العثور على ${items.length} منتج`}
                </span>
                {query.trim() && <span className="text-[#A92224]">«{query.trim()}»</span>}
              </div>

              {!loading && items.length === 0 && matchedStores.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                  <Search className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="font-black text-slate-800">لم نعثر على متاجر أو منتجات مطابقة</p>
                  <p className="text-xs text-slate-500">جرّب كتابة اسم متجر أو منتج أقصر أو مسح الفلاتر المحددة.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Matched Approved Stores */}
                  {matchedStores.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        <Store className="w-4 h-4 text-[#A92224]" />
                        المتاجر المعتمدة ({matchedStores.length})
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {matchedStores.map((st) => {
                          const ratingVal = Number(st.rating_avg || 0);
                          const rawOpen = st.is_open_now !== undefined ? st.is_open_now : st.is_open;
                          const isOpen = rawOpen === true || Number(rawOpen) === 1;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => {
                                if (onSelectStore) {
                                  onSelectStore(st.id, st.business_name_ar);
                                } else if (typeof window !== 'undefined') {
                                  window.location.assign(`/store/${encodeURIComponent(st.id)}`);
                                }
                              }}
                              className="w-full text-start rounded-2xl bg-white border border-slate-200 hover:border-[#A92224]/50 p-3 flex items-center gap-3 shadow-xs transition cursor-pointer"
                            >
                              <div className="relative shrink-0">
                                <div className="w-12 h-12 rounded-xl bg-[#FEF2F2] border border-slate-100 overflow-hidden flex items-center justify-center">
                                  {st.image_url ? (
                                    <img
                                      src={st.image_url}
                                      alt={st.business_name_ar}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <Store className="w-5 h-5 text-[#A92224]" />
                                  )}
                                </div>
                                <span
                                  className={`absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                    isOpen ? 'bg-emerald-500' : 'bg-slate-400'
                                  }`}
                                />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-black text-slate-900 truncate">
                                  {st.business_name_ar}
                                </div>
                                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 mt-0.5 flex-wrap">
                                  <span className={isOpen ? 'text-emerald-600' : 'text-slate-400'}>
                                    {isOpen ? 'مفتوح الآن' : 'مغلق'}
                                  </span>
                                  {ratingVal > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-amber-600 tabular-nums">
                                      <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                                      {ratingVal.toFixed(1)}
                                    </span>
                                  )}
                                  {st.products_count > 0 && (
                                    <span className="tabular-nums">{st.products_count} منتج</span>
                                  )}
                                  {st.zone_name && <span className="truncate">{st.zone_name}</span>}
                                </div>
                              </div>

                              <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Matched Products */}
                  {items.length > 0 && (
                    <div className="space-y-2.5">
                      {matchedStores.length > 0 && (
                        <h3 className="text-sm font-black text-slate-900">
                          المنتجات ({items.length})
                        </h3>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {items.map((p) => (
                          <OtlobhaProductCard
                            key={p.id}
                            product={p}
                            cartQty={cartQtyMap[p.id] || 0}
                            onOpenDetails={(id) => onOpenProduct(id, items)}
                            onAdd={onAddProduct}
                            onDecrement={onDecrementProduct}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
