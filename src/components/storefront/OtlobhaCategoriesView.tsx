import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Apple,
  ArrowRight,
  ChevronLeft,
  Coffee,
  Cookie,
  Droplets,
  Egg,
  Fish,
  Flame,
  Home,
  Loader2,
  MapPin,
  Milk,
  Package,
  Pill,
  Search,
  Snowflake,
  Sparkles,
  Star,
  Store,
  Utensils,
  Wheat,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { MerchantRecord, StorefrontCategoryRecord, StorefrontProductCard } from '../../shared/types';
import { OtlobhaProductCard } from './OtlobhaProductCard';
import { useTypewriterPlaceholder } from '../../hooks/useTypewriterPlaceholder';

interface Props {
  categories: StorefrontCategoryRecord[];
  merchants?: Array<MerchantRecord & { rating_avg?: number; is_open?: boolean }>;
  zoneName: string;
  cartQtyMap: Record<string, number>;
  onOpenSearch: () => void;
  onOpenProduct: (productId: string, list: StorefrontProductCard[]) => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onDecrementProduct: (productId: string) => void;
  onSelectGroup?: (groupKey: string) => void;
  onSelectStore?: (merchantId: string, merchantName: string) => void;
  onOpenAllStores?: () => void;
}

const CATEGORY_VISUALS: Record<string, { icon: React.ComponentType<any>; bg: string; fg: string }> = {
  cat_frozen: { icon: Snowflake, bg: 'bg-sky-50', fg: 'text-sky-700' },
  cat_rice_grains: { icon: Wheat, bg: 'bg-amber-50', fg: 'text-amber-700' },
  cat_pasta_canned: { icon: Package, bg: 'bg-orange-50', fg: 'text-orange-700' },
  cat_sauces: { icon: Flame, bg: 'bg-red-50', fg: 'text-[#A92224]' },
  cat_fruits_veg: { icon: Apple, bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  cat_meat_poultry: { icon: Flame, bg: 'bg-rose-50', fg: 'text-rose-700' },
  cat_seafood_fresh: { icon: Fish, bg: 'bg-cyan-50', fg: 'text-cyan-700' },
  cat_seafood: { icon: Fish, bg: 'bg-cyan-50', fg: 'text-cyan-700' },
  cat_dairy_eggs: { icon: Egg, bg: 'bg-yellow-50', fg: 'text-amber-700' },
  cat_dairy: { icon: Milk, bg: 'bg-yellow-50', fg: 'text-amber-700' },
  cat_juices_drinks: { icon: Droplets, bg: 'bg-amber-50', fg: 'text-[#D97706]' },
  cat_snacks_sweets: { icon: Cookie, bg: 'bg-pink-50', fg: 'text-pink-700' },
  cat_coffee_tea: { icon: Coffee, bg: 'bg-stone-100', fg: 'text-[#5C2E1F]' },
  cat_detergents: { icon: Sparkles, bg: 'bg-indigo-50', fg: 'text-indigo-700' },
  cat_home_care: { icon: Home, bg: 'bg-teal-50', fg: 'text-teal-700' },
  cat_kitchen_supplies: { icon: Utensils, bg: 'bg-slate-100', fg: 'text-slate-700' },
  cat_pharma_med: { icon: Pill, bg: 'bg-red-50', fg: 'text-[#A92224]' },
  cat_pharma_care: { icon: Sparkles, bg: 'bg-rose-50', fg: 'text-rose-700' },
};

const GROUP_ORDER = [
  { key: 'groceries', title: 'المقاضي والمواد الغذائية' },
  { key: 'fresh', title: 'المنتجات الطازجة' },
  { key: 'drinks', title: 'المشروبات والقهوة والشاي' },
  { key: 'home_care', title: 'المنظفات والعناية بالمنزل' },
  { key: 'kitchen', title: 'مستلزمات المطبخ' },
];

export const OtlobhaCategoriesView: React.FC<Props> = ({
  categories,
  merchants = [],
  zoneName,
  cartQtyMap,
  onOpenSearch,
  onOpenProduct,
  onAddProduct,
  onDecrementProduct,
  onSelectGroup,
  onSelectStore,
  onOpenAllStores,
}) => {
  // 3-level inline hierarchy state:
  // Level 1 (Root square cards) -> Level 2 (Horizontal bar 1) -> Level 3 (Horizontal bar 2) -> Inline products
  const [selectedL1Id, setSelectedL1Id] = useState<string | null>(null);
  const [selectedL2Id, setSelectedL2Id] = useState<string | null>(null);
  const [selectedL3Id, setSelectedL3Id] = useState<string | null>(null);

  const [products, setProducts] = useState<StorefrontProductCard[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);

  const fetchSeqRef = useRef(0);
  const l2StripRef = useRef<HTMLDivElement | null>(null);
  const l3StripRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, StorefrontCategoryRecord>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, StorefrontCategoryRecord[]>();
    for (const c of categories) {
      const pid = c.parent_id && byId.has(c.parent_id) ? c.parent_id : '__root__';
      const arr = map.get(pid) || [];
      arr.push(c);
      map.set(pid, arr);
    }
    return map;
  }, [categories, byId]);

  const rootCategories = childrenByParent.get('__root__') || [];
  const selectedL1 = selectedL1Id ? byId.get(selectedL1Id) || null : null;
  const l2Children = useMemo(
    () => (selectedL1 ? childrenByParent.get(selectedL1.id) || [] : []),
    [selectedL1, childrenByParent]
  );

  const selectedL2 = selectedL2Id ? byId.get(selectedL2Id) || null : null;
  const l3Children = useMemo(
    () => (selectedL2 ? childrenByParent.get(selectedL2.id) || [] : []),
    [selectedL2, childrenByParent]
  );

  const selectedL3 = selectedL3Id ? byId.get(selectedL3Id) || null : null;

  // Deepest selected category whose products are displayed inline below the horizontal strips
  const activeCategory = selectedL3 || selectedL2 || selectedL1;
  const activeCategoryId = activeCategory?.id || null;
  const { text: searchPlaceholder, isAnimating: isSearchPlaceholderAnimating } = useTypewriterPlaceholder({
    active: !selectedL1,
  });

  // Group root categories when browsing Level 1 squares
  const grouped = useMemo(() => {
    const res = GROUP_ORDER.map((grp) => ({
      ...grp,
      items: rootCategories.filter((c) => {
        if (grp.key === 'groceries') return !c.group_key || c.group_key === 'groceries';
        return c.group_key === grp.key;
      }),
    })).filter((g) => g.items.length > 0);

    const usedIds = new Set(res.flatMap((g) => g.items.map((i) => i.id)));
    const extraCats = rootCategories.filter((c) => !usedIds.has(c.id));
    if (extraCats.length > 0) {
      res.push({ key: 'other', title: 'أقسام أخرى والصيدلية', items: extraCats });
    }
    return res;
  }, [rootCategories]);

  const fetchCategoryProducts = useCallback(
    async (categoryId: string, targetPage: number, append: boolean) => {
      const seq = ++fetchSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setProductsLoading(true);
        setProductsError(null);
      }

      try {
        const res = await api.getStorefrontHome({
          category_id: categoryId,
          page: targetPage,
          limit: 24,
        });
        if (seq !== fetchSeqRef.current) return;

        const nextItems = (res.products || []) as StorefrontProductCard[];
        setProducts((prev) => {
          if (!append) return nextItems;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...nextItems.filter((p) => !seen.has(p.id))];
        });
        setPage(targetPage);
        setHasMore(Boolean(res.pagination?.has_more));
        setTotalProducts(Number(res.pagination?.total ?? nextItems.length));
      } catch (err: any) {
        if (seq !== fetchSeqRef.current) return;
        if (!append) {
          setProductsError(err?.message || 'تعذر تحميل منتجات القسم حاليًا');
          setProducts([]);
        }
      } finally {
        if (seq === fetchSeqRef.current) {
          setProductsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    []
  );

  // Trigger inline product fetch whenever the deepest active category changes
  useEffect(() => {
    if (!activeCategoryId) {
      fetchSeqRef.current += 1;
      setProducts([]);
      setProductsLoading(false);
      setLoadingMore(false);
      setProductsError(null);
      setPage(1);
      setHasMore(false);
      setTotalProducts(0);
      return;
    }
    void fetchCategoryProducts(activeCategoryId, 1, false);
  }, [activeCategoryId, fetchCategoryProducts]);

  const handleSelectL1 = (cat: StorefrontCategoryRecord) => {
    setSelectedL1Id(cat.id);
    setSelectedL2Id(null);
    setSelectedL3Id(null);
    if (l2StripRef.current) l2StripRef.current.scrollTo({ left: 0, behavior: 'auto' });
  };

  const handleSelectL2 = (catId: string | null) => {
    setSelectedL2Id(catId);
    setSelectedL3Id(null);
    if (l3StripRef.current) l3StripRef.current.scrollTo({ left: 0, behavior: 'auto' });
  };

  const handleSelectL3 = (catId: string | null) => {
    setSelectedL3Id(catId);
  };

  const handleBackToRoots = () => {
    setSelectedL1Id(null);
    setSelectedL2Id(null);
    setSelectedL3Id(null);
  };

  const renderRootSquareCard = (cat: StorefrontCategoryRecord) => {
    const vis = CATEGORY_VISUALS[cat.id] || {
      icon: Package,
      bg: 'bg-[#FEF2F2]',
      fg: 'text-[#A92224]',
    };
    const Icon = vis.icon;

    return (
      <button
        key={cat.id}
        type="button"
        onClick={() => handleSelectL1(cat)}
        className="group flex flex-col items-stretch text-center rounded-2xl bg-white border border-slate-200/80 hover:border-[#A92224]/50 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:shadow-md transition-all duration-200 overflow-hidden cursor-pointer focus-visible:outline-2 focus-visible:outline-[#A92224]"
      >
        <div className={`w-full aspect-square ${vis.bg} flex items-center justify-center overflow-hidden`}>
          {cat.image_url ? (
            <img
              src={cat.image_url}
              alt={cat.name_ar}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon className={`w-9 h-9 ${vis.fg} group-hover:scale-110 transition-transform duration-200`} />
            </div>
          )}
        </div>
        <div className="px-2 py-2.5 flex items-center justify-center min-h-[2.85rem] bg-white">
          <span className="text-[12px] font-extrabold text-slate-900 leading-snug line-clamp-2">
            {cat.name_ar}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="pb-24" dir="rtl">
      {/* Top Sticky Header: switches cleanly between Root header and Active L1 + Horizontal Strips */}
      <div className="sticky top-0 z-20 bg-[#F6F7F9]/95 backdrop-blur-md border-b border-slate-200/80">
        {selectedL1 ? (
          <div>
            {/* Compact L1 Context Header */}
            <div className="flex items-center justify-between gap-2 px-1 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={handleBackToRoots}
                  aria-label="العودة للأقسام الرئيسية"
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-xl bg-white border border-slate-200 text-slate-800 hover:border-[#A92224] hover:text-[#A92224] text-xs font-extrabold transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <ArrowRight className="w-4 h-4 shrink-0" />
                  <span>الأقسام</span>
                </button>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-black text-slate-900 truncate leading-tight">
                    {selectedL1.name_ar}
                  </h2>
                  <div className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1.5">
                    {selectedL2 && <span>{selectedL2.name_ar}</span>}
                    {selectedL2 && selectedL3 && <span aria-hidden="true">/</span>}
                    {selectedL3 && <span className="text-[#A92224] font-bold">{selectedL3.name_ar}</span>}
                    {!selectedL2 && <span>{zoneName}</span>}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenSearch}
                aria-label="بحث في المنتجات"
                className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-[#A92224] hover:bg-[#FEF2F2] hover:border-[#A92224]/40 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>

            {/* Horizontal Scrollable Bar 1 — Level 2 Subcategories (Text tabs only, NO squares/icons) */}
            {l2Children.length > 0 && (
              <div
                ref={l2StripRef}
                role="tablist"
                aria-label="الأقسام الفرعية"
                className="flex items-center gap-2 overflow-x-auto no-scrollbar px-1 pb-2.5 pt-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedL2Id === null}
                  onClick={() => handleSelectL2(null)}
                  className={`h-9 px-4 rounded-lg text-xs font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    selectedL2Id === null
                      ? 'bg-[#A92224] text-white shadow-xs'
                      : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  الكل
                </button>
                {l2Children.map((l2) => {
                  const isActive = selectedL2Id === l2.id;
                  return (
                    <button
                      key={l2.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleSelectL2(l2.id)}
                      className={`h-9 px-4 rounded-lg text-xs font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#A92224] text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {l2.name_ar}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Horizontal Scrollable Bar 2 — Level 3 Subcategories directly underneath Bar 1 */}
            {selectedL2 && l3Children.length > 0 && (
              <div
                ref={l3StripRef}
                role="tablist"
                aria-label="أقسام المستوى الثالث"
                className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-1 py-2 border-t border-slate-200/70 bg-white/75"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedL3Id === null}
                  onClick={() => handleSelectL3(null)}
                  className={`h-8 px-3.5 rounded-lg text-[11.5px] font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    selectedL3Id === null
                      ? 'bg-[#FEF2F2] text-[#A92224] border border-[#A92224]'
                      : 'bg-slate-50 text-slate-600 border border-slate-200/90 hover:text-slate-900'
                  }`}
                >
                  الكل
                </button>
                {l3Children.map((l3) => {
                  const isActive = selectedL3Id === l3.id;
                  return (
                    <button
                      key={l3.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleSelectL3(l3.id)}
                      className={`h-8 px-3.5 rounded-lg text-[11.5px] font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#FEF2F2] text-[#A92224] border border-[#A92224]'
                          : 'bg-slate-50 text-slate-600 border border-slate-200/90 hover:text-slate-900'
                      }`}
                    >
                      {l3.name_ar}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Root Level Sticky Header */
          <div className="pt-2 pb-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                  alt="اطلبها"
                  className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border border-slate-200 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-[12px] font-black text-slate-900 truncate">الأقسام الرئيسية</div>
                  <div className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-[#A92224] shrink-0" />
                    <span className="truncate">{zoneName}</span>
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold text-slate-500 tabular-nums shrink-0">
                {rootCategories.length} قسم رئيسي
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenSearch}
              className="w-full h-11 rounded-2xl bg-white border border-slate-200/90 px-3.5 flex items-center gap-2.5 text-slate-500 text-sm shadow-xs hover:border-[#A92224]/40 transition cursor-pointer"
            >
              <Search className="w-4 h-4 text-[#A92224] shrink-0" />
              <span dir="rtl" className="flex-1 min-w-0 text-right font-semibold truncate leading-5">
                {searchPlaceholder || '\u200B'}
                {isSearchPlaceholderAnimating && (
                  <span
                    aria-hidden="true"
                    className="inline-block w-[1.5px] h-[1em] align-[-0.15em] mr-0.5 bg-[#A92224]/75 animate-pulse"
                  />
                )}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {selectedL1 ? (
        /* Inline Products Grid directly underneath the Level 2 & Level 3 Horizontal Strips */
        <div className="pt-3.5 space-y-3.5">
          {/* Clean unboxed context line showing active selection & total count */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-black text-slate-900 truncate">
                {activeCategory?.name_ar}
              </h3>
              {!productsLoading && (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-xs font-bold text-slate-500 tabular-nums shrink-0">
                    {totalProducts.toLocaleString('ar-EG')} منتج
                  </span>
                </>
              )}
            </div>
            {(selectedL2Id || selectedL3Id) && (
              <button
                type="button"
                onClick={() => handleSelectL2(null)}
                className="text-xs font-bold text-[#A92224] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                كل {selectedL1.name_ar}
              </button>
            )}
          </div>

          {/* Loading Skeleton */}
          {productsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden animate-pulse"
                >
                  <div className="aspect-square bg-slate-100" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 w-1/2 bg-slate-100 rounded" />
                    <div className="h-3.5 w-full bg-slate-100 rounded" />
                    <div className="h-4 w-1/3 bg-slate-200/80 rounded mt-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : productsError ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
              <p className="text-sm font-bold text-slate-700">{productsError}</p>
              <button
                type="button"
                onClick={() => activeCategoryId && void fetchCategoryProducts(activeCategoryId, 1, false)}
                className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#FEF2F2] text-[#A92224] mx-auto flex items-center justify-center">
                <Package className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-900">
                  لا توجد منتجات متاحة حاليًا في «{activeCategory?.name_ar}»
                </p>
                <p className="text-xs text-slate-500">
                  يمكنك اختيار قسم فرعي آخر من الشريط أعلاه أو عرض كل منتجات {selectedL1.name_ar}
                </p>
              </div>
              {(selectedL2Id || selectedL3Id) && (
                <button
                  type="button"
                  onClick={() => handleSelectL2(null)}
                  className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
                >
                  عرض كل منتجات {selectedL1.name_ar}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {products.map((prod) => (
                  <OtlobhaProductCard
                    key={prod.id}
                    product={prod}
                    cartQty={cartQtyMap[prod.id] || 0}
                    onOpenDetails={(pid) => onOpenProduct(pid, products)}
                    onAdd={onAddProduct}
                    onDecrement={onDecrementProduct}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() =>
                      activeCategoryId && void fetchCategoryProducts(activeCategoryId, page + 1, true)
                    }
                    className="h-11 px-6 rounded-xl bg-white border border-slate-200 hover:border-[#A92224] text-slate-800 hover:text-[#A92224] text-xs font-extrabold inline-flex items-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-60"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>جاري تحميل المزيد...</span>
                      </>
                    ) : (
                      <span>عرض المزيد من المنتجات</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Level 1 Root Categories: Approved Stores Scrollable Strip Above Root Category Cards */
        <div className="pt-4 space-y-6">
          {merchants.length > 0 && (
            <section className="space-y-3" aria-label="المتاجر المعتمدة">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-[#FEF2F2] text-[#A92224] flex items-center justify-center shrink-0">
                    <Store className="w-4 h-4" />
                  </span>
                  <h3 className="text-[15px] font-black text-slate-900">المتاجر المعتمدة</h3>
                  <span className="text-[11px] font-extrabold text-[#A92224] bg-[#FEF2F2] px-2 py-0.5 rounded-md tabular-nums">
                    {merchants.length}
                  </span>
                </div>
                {onOpenAllStores && (
                  <button
                    type="button"
                    onClick={onOpenAllStores}
                    className="text-xs font-extrabold text-[#A92224] hover:text-[#86191B] flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>عرض الكل</span>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-stretch gap-2.5 overflow-x-auto no-scrollbar pb-1 px-0.5">
                {merchants.map((store) => {
                  const ratingVal = Number(store.rating_avg ?? 0);
                  const rawOpen = store.is_open_now !== undefined ? store.is_open_now : store.is_open;
                  const isOpen = rawOpen === true || Number(rawOpen) === 1;
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => {
                        if (onSelectStore) {
                          onSelectStore(store.id, store.business_name_ar);
                        } else if (typeof window !== 'undefined') {
                          window.location.assign(`/store/${encodeURIComponent(store.id)}`);
                        }
                      }}
                      className="group shrink-0 w-[108px] rounded-2xl bg-white border border-slate-200/80 hover:border-[#A92224]/50 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:shadow-md p-2.5 flex flex-col items-center text-center gap-1.5 transition-all cursor-pointer"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 rounded-2xl bg-[#FEF2F2] border border-slate-100 overflow-hidden flex items-center justify-center">
                          {store.image_url ? (
                            <img
                              src={store.image_url}
                              alt={store.business_name_ar}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <Store className="w-5 h-5 text-[#A92224]" />
                          )}
                        </div>
                        <span
                          title={isOpen ? 'مفتوح الآن' : 'مغلق حاليًا'}
                          className={`absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full border-2 border-white ${
                            isOpen ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                      </div>

                      <span className="text-[11.5px] font-extrabold text-slate-900 leading-tight line-clamp-2 min-h-[2rem] flex items-center">
                        {store.business_name_ar}
                      </span>

                      <div className="flex items-center justify-center gap-1 text-[10px] font-bold">
                        {ratingVal > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 tabular-nums">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                            {ratingVal.toFixed(1)}
                          </span>
                        ) : (
                          <span className={isOpen ? 'text-emerald-600' : 'text-slate-400'}>
                            {isOpen ? 'مفتوح' : 'مغلق'}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {grouped.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[15px] font-black text-slate-900">{group.title}</h3>
                {onSelectGroup && (
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.key)}
                    className="text-xs font-extrabold text-[#A92224] hover:text-[#86191B] flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>عرض الكل</span>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {group.items.map((cat) => renderRootSquareCard(cat))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
