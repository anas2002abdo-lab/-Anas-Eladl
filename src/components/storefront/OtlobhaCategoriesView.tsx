import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Apple,
  ArrowRight,
  Fish,
  Flame,
  Home,
  LayoutGrid,
  Loader2,
  MapPin,
  Package,
  Search,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Star,
  Store,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type {
  MainCategoryExploreMerchant,
  MainCategoryInternalNode,
  MerchantRecord,
  PlatformMainCategory,
  StorefrontCategoryRecord,
  StorefrontProductCard,
} from '../../shared/types';
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

const MAIN_CAT_ICONS: Record<string, React.ComponentType<any>> = {
  shopping_basket: ShoppingBasket,
  meat: Flame,
  produce: Apple,
  fish: Fish,
  detergents: Sparkles,
  electronics: Smartphone,
  perfumes: Sparkles,
  restaurants: UtensilsCrossed,
  home: Home,
  clothing: Shirt,
  general: LayoutGrid,
};

export const OtlobhaCategoriesView: React.FC<Props> = ({
  zoneName,
  cartQtyMap,
  onOpenSearch,
  onOpenProduct,
  onAddProduct,
  onDecrementProduct,
}) => {
  // Step 1: Platform Main Categories
  const [mainCategories, setMainCategories] = useState<PlatformMainCategory[]>([]);
  const [loadingMainCats, setLoadingMainCats] = useState(true);
  const [mainCatsError, setMainCatsError] = useState<string | null>(null);

  // Step 2: Active Main Category -> Linked Merchants Strip -> Selected Store -> Internal L1/L2/L3+ Hierarchy -> Products
  const [selectedMainCat, setSelectedMainCat] = useState<PlatformMainCategory | null>(null);
  const [linkedMerchants, setLinkedMerchants] = useState<MainCategoryExploreMerchant[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);

  const [internalCategories, setInternalCategories] = useState<MainCategoryInternalNode[]>([]);
  // Supports unlimited depth via breadcrumb path of selected internal category IDs [L1, L2, L3, ...]
  const [internalPathIds, setInternalPathIds] = useState<string[]>([]);

  const [products, setProducts] = useState<StorefrontProductCard[]>([]);
  const [loadingExplore, setLoadingExplore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);

  const fetchSeqRef = useRef(0);

  const { text: searchPlaceholder, isAnimating: isSearchPlaceholderAnimating } = useTypewriterPlaceholder({
    active: !selectedMainCat,
  });

  const loadMainCategories = useCallback(async () => {
    setLoadingMainCats(true);
    setMainCatsError(null);
    try {
      const res = await api.getMainCategories();
      setMainCategories(res.main_categories || []);
    } catch (err: any) {
      setMainCatsError(err?.message || 'تعذر تحميل الأقسام الرئيسية حاليًا');
    } finally {
      setLoadingMainCats(false);
    }
  }, []);

  useEffect(() => {
    void loadMainCategories();
  }, [loadMainCategories]);

  const activeInternalCategoryId =
    internalPathIds.length > 0 ? internalPathIds[internalPathIds.length - 1] : null;

  const fetchExplore = useCallback(
    async (
      mainCatId: string,
      merchantId: string | null,
      internalCatId: string | null,
      targetPage: number,
      append: boolean
    ) => {
      const seq = ++fetchSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingExplore(true);
        setExploreError(null);
      }
      try {
        const res = await api.exploreMainCategory(mainCatId, {
          merchant_id: merchantId,
          internal_category_id: internalCatId,
          page: targetPage,
          limit: 24,
        });
        if (seq !== fetchSeqRef.current) return;

        setLinkedMerchants(res.merchants || []);
        setInternalCategories(res.internal_categories || []);
        const nextProducts = (res.products || []) as StorefrontProductCard[];
        setProducts((prev) => {
          if (!append) return nextProducts;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...nextProducts.filter((p) => !seen.has(p.id))];
        });
        setPage(targetPage);
        setHasMore(Boolean(res.pagination?.has_more));
        setTotalProducts(Number(res.pagination?.total ?? nextProducts.length));
      } catch (err: any) {
        if (seq !== fetchSeqRef.current) return;
        if (!append) {
          setExploreError(err?.message || 'تعذر تحميل محتوى القسم حاليًا');
          setProducts([]);
        }
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoadingExplore(false);
          setLoadingMore(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedMainCat) {
      fetchSeqRef.current += 1;
      setLinkedMerchants([]);
      setInternalCategories([]);
      setProducts([]);
      setTotalProducts(0);
      setHasMore(false);
      setPage(1);
      setExploreError(null);
      return;
    }
    void fetchExplore(selectedMainCat.id, selectedMerchantId, activeInternalCategoryId, 1, false);
  }, [selectedMainCat, selectedMerchantId, activeInternalCategoryId, fetchExplore]);

  // Build parent -> children map for internal categories (preserves L1 -> L2 -> L3+ hierarchy)
  const internalTree = useMemo(() => {
    const byId = new Map<string, MainCategoryInternalNode>();
    const childrenByParent = new Map<string, MainCategoryInternalNode[]>();
    for (const c of internalCategories) {
      byId.set(c.id, c);
    }
    for (const c of internalCategories) {
      const pid = c.parent_id && byId.has(c.parent_id) ? c.parent_id : '__root__';
      const arr = childrenByParent.get(pid) || [];
      arr.push(c);
      childrenByParent.set(pid, arr);
    }
    return { byId, childrenByParent };
  }, [internalCategories]);

  // Compute dynamic horizontal strips for each level in the active path:
  // Level 0 = roots; Level 1 = children of path[0]; Level 2 = children of path[1]; etc.
  const categoryLevels = useMemo(() => {
    const levels: Array<{
      depth: number;
      parentId: string | null;
      selectedId: string | null;
      items: MainCategoryInternalNode[];
    }> = [];
    const roots = internalTree.childrenByParent.get('__root__') || [];
    if (roots.length === 0) return levels;

    levels.push({
      depth: 0,
      parentId: null,
      selectedId: internalPathIds[0] || null,
      items: roots,
    });

    for (let i = 0; i < internalPathIds.length; i++) {
      const curId = internalPathIds[i];
      const kids = internalTree.childrenByParent.get(curId) || [];
      if (kids.length > 0) {
        levels.push({
          depth: i + 1,
          parentId: curId,
          selectedId: internalPathIds[i + 1] || null,
          items: kids,
        });
      }
    }
    return levels;
  }, [internalTree, internalPathIds]);

  const selectedMerchant = useMemo(
    () => linkedMerchants.find((m) => m.id === selectedMerchantId) || null,
    [linkedMerchants, selectedMerchantId]
  );

  const handleOpenMainCat = (mc: PlatformMainCategory) => {
    setSelectedMainCat(mc);
    setSelectedMerchantId(null);
    setInternalPathIds([]);
  };

  const handleBackToMainCats = () => {
    setSelectedMainCat(null);
    setSelectedMerchantId(null);
    setInternalPathIds([]);
  };

  const handleSelectMerchant = (merchantId: string | null) => {
    setSelectedMerchantId((prev) => (prev === merchantId ? null : merchantId));
    setInternalPathIds([]);
  };

  const handleSelectInternalAtDepth = (depth: number, catId: string | null) => {
    setInternalPathIds((prev) => {
      const next = prev.slice(0, depth);
      if (catId) next.push(catId);
      return next;
    });
  };

  return (
    <div className="pb-24" dir="rtl">
      {/* Top Sticky Header */}
      <div className="sticky top-0 z-20 bg-[#F6F7F9]/95 backdrop-blur-md border-b border-slate-200/80">
        {selectedMainCat ? (
          <div>
            {/* Main Category Context Bar */}
            <div className="flex items-center justify-between gap-2 px-1 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={handleBackToMainCats}
                  aria-label="العودة للأقسام الرئيسية"
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-xl bg-white border border-slate-200 text-slate-800 hover:border-[#A92224] hover:text-[#A92224] text-xs font-extrabold transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <ArrowRight className="w-4 h-4 shrink-0" />
                  <span>الأقسام</span>
                </button>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-black text-slate-900 truncate leading-tight">
                    {selectedMainCat.name_ar}
                  </h2>
                  <div className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1">
                    {selectedMerchant ? (
                      <>
                        <Store className="w-3 h-3 text-[#A92224] shrink-0" />
                        <span className="text-[#A92224] font-bold truncate">
                          {selectedMerchant.business_name_ar}
                        </span>
                      </>
                    ) : (
                      <span>
                        {linkedMerchants.length} متجر · {zoneName}
                      </span>
                    )}
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

            {/* Multi-level Internal Categories Horizontal Strips (shown when store is selected or General has categories) */}
            {categoryLevels.map((lvl) => (
              <div
                key={`lvl-${lvl.depth}-${lvl.parentId || 'root'}`}
                role="tablist"
                aria-label={lvl.depth === 0 ? 'الأقسام الداخلية للمتجر' : 'الأقسام الفرعية'}
                className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar px-1 ${
                  lvl.depth === 0
                    ? 'pb-2.5 pt-0.5'
                    : 'py-2 border-t border-slate-200/70 bg-white/80'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={lvl.selectedId === null}
                  onClick={() => handleSelectInternalAtDepth(lvl.depth, null)}
                  className={`whitespace-nowrap shrink-0 rounded-lg font-extrabold transition-colors cursor-pointer ${
                    lvl.depth === 0 ? 'h-9 px-3.5 text-xs' : 'h-8 px-3 text-[11.5px]'
                  } ${
                    lvl.selectedId === null
                      ? lvl.depth === 0
                        ? 'bg-[#A92224] text-white shadow-xs'
                        : 'bg-[#FEF2F2] text-[#A92224] border border-[#A92224]'
                      : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  الكل
                </button>
                {lvl.items.map((node) => {
                  const isActive = lvl.selectedId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleSelectInternalAtDepth(lvl.depth, node.id)}
                      className={`whitespace-nowrap shrink-0 rounded-lg font-extrabold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                        lvl.depth === 0 ? 'h-9 px-3.5 text-xs' : 'h-8 px-3 text-[11.5px]'
                      } ${
                        isActive
                          ? lvl.depth === 0
                            ? 'bg-[#A92224] text-white shadow-xs'
                            : 'bg-[#FEF2F2] text-[#A92224] border border-[#A92224]'
                          : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span>{node.name_ar}</span>
                      {node.products_count > 0 && (
                        <span
                          className={`text-[10px] tabular-nums ${
                            isActive && lvl.depth === 0 ? 'text-white/80' : 'text-slate-400'
                          }`}
                        >
                          ({node.products_count})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          /* Root Platform Main Categories Sticky Header */
          <div className="pt-2 pb-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                  alt="اطلبها"
                  className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border border-slate-200 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-black text-slate-900 truncate">الأقسام الرئيسية</div>
                  <div className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-[#A92224] shrink-0" />
                    <span className="truncate">{zoneName}</span>
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold text-slate-500 tabular-nums shrink-0">
                {mainCategories.length} قسم رئيسي
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

      {/* BODY */}
      {selectedMainCat ? (
        <div className="pt-3.5 space-y-4">
          {/* Horizontal Swipeable Strip of ONLY Merchants Linked to this Main Category */}
          <section aria-label="المتاجر المرتبطة بالقسم" className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-[#FEF2F2] text-[#A92224] flex items-center justify-center shrink-0">
                  <Store className="w-3.5 h-3.5" />
                </span>
                <h3 className="text-[13.5px] font-black text-slate-900">
                  متاجر {selectedMainCat.name_ar}
                </h3>
                <span className="text-[11px] font-extrabold text-[#A92224] bg-[#FEF2F2] px-2 py-0.5 rounded-md tabular-nums">
                  {linkedMerchants.length}
                </span>
              </div>
              {selectedMerchant && (
                <button
                  type="button"
                  onClick={() => handleSelectMerchant(null)}
                  className="text-xs font-extrabold text-[#A92224] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>عرض كل المتاجر</span>
                </button>
              )}
            </div>

            {linkedMerchants.length > 0 ? (
              <div className="flex items-stretch gap-2.5 overflow-x-auto no-scrollbar pb-1 px-0.5">
                {/* "All Stores" tile */}
                <button
                  type="button"
                  onClick={() => handleSelectMerchant(null)}
                  className={`shrink-0 w-[96px] rounded-2xl p-2.5 flex flex-col items-center justify-center text-center gap-1.5 border transition-all cursor-pointer ${
                    selectedMerchantId === null
                      ? 'bg-[#A92224] text-white border-[#A92224] shadow-md'
                      : 'bg-white text-slate-800 border-slate-200/80 hover:border-[#A92224]/50'
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                      selectedMerchantId === null
                        ? 'bg-white/15 text-white'
                        : 'bg-[#FEF2F2] text-[#A92224]'
                    }`}
                  >
                    <LayoutGrid className="w-5 h-5" />
                  </div>
                  <span className="text-[11.5px] font-extrabold leading-tight">كل المتاجر</span>
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      selectedMerchantId === null ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    {linkedMerchants.length} متجر
                  </span>
                </button>

                {linkedMerchants.map((store) => {
                  const isSelected = selectedMerchantId === store.id;
                  const isOpen = Boolean(store.is_open_now);
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => handleSelectMerchant(store.id)}
                      className={`group shrink-0 w-[112px] rounded-2xl p-2.5 flex flex-col items-center text-center gap-1.5 border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#FEF2F2] border-[#A92224] ring-2 ring-[#A92224]/20 shadow-md'
                          : 'bg-white border-slate-200/80 hover:border-[#A92224]/50 shadow-[0_2px_8px_rgba(15,23,42,0.03)]'
                      }`}
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

                      <span
                        className={`text-[11.5px] font-extrabold leading-tight line-clamp-2 min-h-[2rem] flex items-center ${
                          isSelected ? 'text-[#A92224]' : 'text-slate-900'
                        }`}
                      >
                        {store.business_name_ar}
                      </span>

                      <div className="flex items-center justify-center gap-1 text-[10px] font-bold">
                        {store.rating_avg > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 tabular-nums">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                            {store.rating_avg.toFixed(1)}
                          </span>
                        ) : (
                          <span className={isOpen ? 'text-emerald-600' : 'text-slate-400'}>
                            {isOpen ? 'مفتوح' : 'مغلق'}
                          </span>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-500 tabular-nums">{store.products_count}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : !loadingExplore ? (
              <div className="rounded-xl bg-white border border-slate-200/80 px-4 py-3 text-xs font-semibold text-slate-500">
                لا توجد متاجر مرتبطة بقسم «{selectedMainCat.name_ar}» حاليًا.
              </div>
            ) : null}
          </section>

          {/* Products Section Heading */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-black text-slate-900 truncate">
                {selectedMerchant
                  ? `منتجات ${selectedMerchant.business_name_ar} في ${selectedMainCat.name_ar}`
                  : `جميع منتجات ${selectedMainCat.name_ar}`}
              </h3>
              {!loadingExplore && (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-xs font-bold text-slate-500 tabular-nums shrink-0">
                    {totalProducts.toLocaleString('ar-EG')} منتج
                  </span>
                </>
              )}
            </div>
            {internalPathIds.length > 0 && (
              <button
                type="button"
                onClick={() => setInternalPathIds([])}
                className="text-xs font-bold text-[#A92224] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                كل الأقسام الداخلية
              </button>
            )}
          </div>

          {/* Products Grid */}
          {loadingExplore ? (
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
          ) : exploreError ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
              <p className="text-sm font-bold text-slate-700">{exploreError}</p>
              <button
                type="button"
                onClick={() =>
                  void fetchExplore(
                    selectedMainCat.id,
                    selectedMerchantId,
                    activeInternalCategoryId,
                    1,
                    false
                  )
                }
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
                  لا توجد منتجات متاحة حاليًا في هذا الاختيار
                </p>
                <p className="text-xs text-slate-500">
                  {selectedMerchant
                    ? `جرب اختيار قسم داخلي آخر أو عرض كل متاجر ${selectedMainCat.name_ar}`
                    : `سيتم عرض منتجات ${selectedMainCat.name_ar} فور ربطها من لوحة الإدارة`}
                </p>
              </div>
              {(selectedMerchantId || internalPathIds.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMerchantId(null);
                    setInternalPathIds([]);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
                >
                  عرض كل منتجات {selectedMainCat.name_ar}
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
                      void fetchExplore(
                        selectedMainCat.id,
                        selectedMerchantId,
                        activeInternalCategoryId,
                        page + 1,
                        true
                      )
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
        /* Step 1: Platform Main Categories Grid */
        <div className="pt-4 space-y-4">
          {loadingMainCats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-white border border-slate-200/80 p-4 animate-pulse space-y-3"
                >
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 mx-auto" />
                  <div className="h-3.5 w-2/3 bg-slate-100 rounded mx-auto" />
                  <div className="h-2.5 w-1/2 bg-slate-100 rounded mx-auto" />
                </div>
              ))}
            </div>
          ) : mainCatsError ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
              <p className="text-sm font-bold text-slate-700">{mainCatsError}</p>
              <button
                type="button"
                onClick={() => void loadMainCategories()}
                className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {mainCategories.map((mc) => {
                const Icon = MAIN_CAT_ICONS[mc.icon_key] || LayoutGrid;
                const accent = mc.accent_color || '#A92224';
                return (
                  <button
                    key={mc.id}
                    type="button"
                    onClick={() => handleOpenMainCat(mc)}
                    className="group flex flex-col items-stretch text-center rounded-2xl bg-white border border-slate-200/85 hover:border-[#A92224]/60 shadow-[0_2px_10px_rgba(15,23,42,0.035)] hover:shadow-md transition-all duration-200 overflow-hidden cursor-pointer focus-visible:outline-2 focus-visible:outline-[#A92224]"
                  >
                    <div
                      className="w-full h-24 flex items-center justify-center overflow-hidden relative"
                      style={{ backgroundColor: `${accent}12` }}
                    >
                      {mc.image_url ? (
                        <img
                          src={mc.image_url}
                          alt={mc.name_ar}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div
                          className="w-13 h-13 rounded-2xl bg-white shadow-xs flex items-center justify-center group-hover:scale-110 transition-transform duration-200"
                          style={{ color: accent }}
                        >
                          <Icon className="w-7 h-7" />
                        </div>
                      )}
                    </div>
                    <div className="px-2.5 py-3 flex-1 flex flex-col items-center justify-between gap-1 bg-white">
                      <span className="text-[13.5px] font-black text-slate-900 leading-snug line-clamp-1">
                        {mc.name_ar}
                      </span>
                      <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-bold text-slate-500 tabular-nums">
                        <span>{mc.merchants_count} متجر</span>
                        <span className="text-slate-300">·</span>
                        <span>{mc.products_count.toLocaleString('ar-EG')} منتج</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
