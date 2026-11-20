import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Flame,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { StorefrontProductCard } from '../../shared/types';
import { OtlobhaProductCard } from './OtlobhaProductCard';

interface Props {
  open: boolean;
  initialQuery?: string;
  cartQtyMap: Record<string, number>;
  onClose: () => void;
  onOpenProduct: (productId: string, orderedList?: StorefrontProductCard[]) => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onDecrementProduct: (productId: string) => void;
}

export const OtlobhaSmartSearchOverlay: React.FC<Props> = ({
  open,
  initialQuery = '',
  cartQtyMap,
  onClose,
  onOpenProduct,
  onAddProduct,
  onDecrementProduct,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'relevance' | 'price_asc' | 'price_desc' | 'discount'>('relevance');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StorefrontProductCard[]>([]);
  const [topOffers, setTopOffers] = useState<StorefrontProductCard[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [stores, setStores] = useState<Array<{ id: string; business_name_ar: string; products_count: number }>>([]);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setTimeout(() => inputRef.current?.focus(), 60);
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

          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#A92224] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن منتج، علامة تجارية، أو باركود..."
              className="w-full h-11 pr-10 pl-9 rounded-2xl bg-[#F6F7F9] border border-slate-200 focus:border-[#A92224] focus:bg-white focus:outline-none text-sm font-semibold text-slate-900"
            />
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
            <section className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>
                  {loading ? 'جاري البحث الفوري...' : `تم العثور على ${items.length} منتج`}
                </span>
                {query.trim() && <span className="text-[#A92224]">«{query.trim()}»</span>}
              </div>

              {!loading && items.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                  <Search className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="font-black text-slate-800">لم نعثر على منتجات مطابقة</p>
                  <p className="text-xs text-slate-500">جرّب كتابة اسم أقصر أو مسح الفلاتر المحددة.</p>
                </div>
              ) : (
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
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
