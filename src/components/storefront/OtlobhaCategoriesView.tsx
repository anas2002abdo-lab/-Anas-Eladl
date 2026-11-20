import React, { useMemo, useState } from 'react';
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
  FolderTree,
  Home,
  Layers,
  MapPin,
  Milk,
  Package,
  Pill,
  Search,
  Snowflake,
  Sparkles,
  Utensils,
  Wheat,
} from 'lucide-react';
import type { StorefrontCategoryRecord } from '../../shared/types';

interface Props {
  categories: StorefrontCategoryRecord[];
  zoneName: string;
  onOpenSearch: () => void;
  onSelectCategory: (category: StorefrontCategoryRecord) => void;
  onSelectGroup: (groupKey: string) => void;
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
  zoneName,
  onOpenSearch,
  onSelectCategory,
  onSelectGroup,
}) => {
  const [activeParentId, setActiveParentId] = useState<string | null>(null);

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
  const activeParent = activeParentId ? byId.get(activeParentId) || null : null;
  const activeChildren = activeParent ? childrenByParent.get(activeParent.id) || [] : [];

  // Build RTL breadcrumb chain from root down to activeParent
  const breadcrumb = useMemo(() => {
    const chain: StorefrontCategoryRecord[] = [];
    const seen = new Set<string>();
    let cur = activeParent;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) || null : null;
    }
    return chain;
  }, [activeParent, byId]);

  // Group root categories when browsing top-level
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

  const handleCardClick = (cat: StorefrontCategoryRecord) => {
    const kids = childrenByParent.get(cat.id) || [];
    if (kids.length > 0) {
      setActiveParentId(cat.id);
    } else {
      onSelectCategory(cat);
    }
  };

  const renderCategoryCard = (cat: StorefrontCategoryRecord) => {
    const vis = CATEGORY_VISUALS[cat.id] || {
      icon: Package,
      bg: 'bg-[#FEF2F2]',
      fg: 'text-[#A92224]',
    };
    const Icon = vis.icon;
    const kidsCount = (childrenByParent.get(cat.id) || []).length;

    return (
      <button
        key={cat.id}
        type="button"
        onClick={() => handleCardClick(cat)}
        className="group flex flex-col items-center text-center gap-2 p-2.5 rounded-2xl bg-white border border-slate-200/80 hover:border-[#A92224]/50 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:shadow-md transition cursor-pointer"
      >
        <div
          className={`w-full aspect-square rounded-xl ${vis.bg} flex items-center justify-center overflow-hidden relative`}
        >
          {cat.image_url ? (
            <img
              src={cat.image_url}
              alt={cat.name_ar}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <Icon className={`w-8 h-8 ${vis.fg} group-hover:scale-110 transition-transform`} />
          )}
          {kidsCount > 0 && (
            <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md bg-[#A92224] text-white text-[9px] font-black shadow-xs flex items-center gap-0.5">
              <Layers className="w-2.5 h-2.5" />
              {kidsCount}
            </span>
          )}
          {cat.products_count > 0 && (
            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-white/95 text-[9px] font-black text-slate-700 shadow-xs">
              {cat.products_count}
            </span>
          )}
        </div>
        <span className="text-[11px] font-extrabold text-slate-800 leading-tight line-clamp-2 min-h-[2rem] flex items-center">
          {cat.name_ar}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5 pb-24" dir="rtl">
      {/* Sticky Top Header with Address + Search Bar */}
      <div className="sticky top-0 z-20 bg-[#F6F7F9]/95 backdrop-blur-md pt-2 pb-3 space-y-2.5 border-b border-slate-200/70">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt="اطلبها"
              className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-500">الأقسام الرئيسية والفرعية</div>
              <div className="text-xs font-black text-slate-900 truncate flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#A92224] shrink-0" />
                <span className="truncate">{zoneName}</span>
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#FEF2F2] text-[#A92224] text-[11px] font-black shrink-0">
            {activeParent ? `${activeChildren.length} قسم فرعي` : `${rootCategories.length} قسم رئيسي`}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full h-11 rounded-2xl bg-white border border-slate-200/90 px-3.5 flex items-center gap-2.5 text-slate-400 text-sm shadow-sm hover:border-[#A92224]/40 transition cursor-pointer"
        >
          <Search className="w-4 h-4 text-[#A92224] shrink-0" />
          <span className="truncate">ابحث في جميع الأقسام والمنتجات...</span>
        </button>

        {/* Interactive Hierarchy Breadcrumb when drilling into subcategories */}
        {activeParent && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 px-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveParentId(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:border-[#A92224] hover:text-[#A92224] transition cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>الأقسام الرئيسية</span>
            </button>
            {breadcrumb.map((node, idx) => {
              const isLast = idx === breadcrumb.length - 1;
              return (
                <React.Fragment key={node.id}>
                  <ChevronLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <button
                    type="button"
                    onClick={() => !isLast && setActiveParentId(node.id)}
                    className={`px-2.5 py-1 rounded-xl font-extrabold transition ${
                      isLast
                        ? 'bg-[#A92224] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:border-[#A92224] cursor-pointer'
                    }`}
                  >
                    {node.name_ar}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Subcategory Drill-down View */}
      {activeParent ? (
        <div className="space-y-4">
          {/* Action banner to view ALL products under this parent category & its children */}
          <div className="rounded-2xl bg-gradient-to-l from-[#A92224] to-[#86191B] text-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#F5A623] flex items-center gap-1">
                <FolderTree className="w-3.5 h-3.5" />
                <span>{activeParent.full_path_ar?.replace(/;\s*$/, '') || activeParent.name_ar}</span>
              </div>
              <h3 className="text-base font-black mt-0.5">{activeParent.name_ar}</h3>
              <p className="text-xs text-white/80 mt-0.5">
                اختر قسمًا فرعيًا أدناه أو تصفّح جميع منتجات {activeParent.name_ar} ({activeParent.products_count} منتج)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectCategory(activeParent)}
              className="px-4 py-2 rounded-xl bg-[#F5A623] hover:bg-[#E0961A] text-[#3B180E] text-xs font-black flex items-center gap-1 shadow-xs transition cursor-pointer shrink-0"
            >
              <span>عرض كل منتجات {activeParent.name_ar}</span>
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
            {activeChildren.map((child) => renderCategoryCard(child))}
          </div>
        </div>
      ) : (
        /* Root Level Grouped Visual Categories Grid */
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black text-slate-900">{group.title}</h3>
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.key)}
                  className="text-xs font-extrabold text-[#A92224] hover:text-[#86191B] flex items-center gap-0.5 cursor-pointer"
                >
                  <span>عرض الكل</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {group.items.map((cat) => renderCategoryCard(cat))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
