import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChefHat,
  Clock,
  Search,
  ShoppingCart,
  Users,
  Video,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { RecipeSummary } from '../../shared/types';
import {
  OtlobhaRecipeDetailView,
  type SelectedRecipeCartItem,
} from './OtlobhaRecipeDetailView';

interface Props {
  onBack: () => void;
  onAddIngredientsToCart: (items: SelectedRecipeCartItem[]) => void;
  onNotify?: (msg: string) => void;
  initialRecipeId?: string | null;
}

export const OtlobhaRecipesView: React.FC<Props> = ({
  onBack,
  onAddIngredientsToCart,
  onNotify,
  initialRecipeId = null,
}) => {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(initialRecipeId);

  useEffect(() => {
    if (initialRecipeId) setActiveRecipeId(initialRecipeId);
  }, [initialRecipeId]);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .getRecipes({
          q: searchQuery.trim() || undefined,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
        })
        .then((res) => {
          if (!active) return;
          setRecipes(res.recipes || []);
          if (selectedCategory === 'all' && !searchQuery.trim()) {
            setCategories(res.categories || []);
          } else if (categories.length === 0 && (res.categories || []).length > 0) {
            setCategories(res.categories || []);
          }
        })
        .catch((err) => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'تعذر تحميل الوصفات');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchQuery, selectedCategory]);

  if (activeRecipeId) {
    return (
      <OtlobhaRecipeDetailView
        recipeId={activeRecipeId}
        onBack={() => setActiveRecipeId(null)}
        onAddIngredientsToCart={onAddIngredientsToCart}
        onNotify={onNotify}
      />
    );
  }

  return (
    <div className="space-y-4 pb-24" dir="rtl">
      {/* Header Bar */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-4 sm:p-5 space-y-3.5 shadow-[0_6px_22px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="رجوع"
              className="w-10 h-10 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 cursor-pointer transition"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black text-slate-900 truncate">
                وصفات اطلبها الذكية
              </h1>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                اختر وصفتك، اطلب مكوناتها الفعلية من متاجر اطلبها، واطبخ خطوة بخطوة
              </p>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#FEF2F2] text-[#A92224] flex items-center justify-center shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#A92224] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            dir="rtl"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن وصفة أو وجبة..."
            className="w-full h-11 pr-10 pl-9 rounded-2xl bg-[#F6F7F9] border border-slate-200 focus:border-[#A92224] focus:bg-white focus:outline-none text-sm font-semibold text-slate-900"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="مسح البحث"
              className="w-7 h-7 rounded-full hover:bg-slate-200 flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Filter Buttons */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`h-9 px-3.5 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer transition ${
                selectedCategory === 'all'
                  ? 'bg-[#A92224] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
              }`}
            >
              كل الوصفات
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`h-9 px-3.5 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer transition ${
                  selectedCategory === cat
                    ? 'bg-[#A92224] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="bg-white rounded-3xl border border-slate-200 overflow-hidden animate-pulse">
              <div className="aspect-[16/9] bg-slate-200" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="bg-white rounded-3xl border border-rose-200 p-6 text-center space-y-2">
          <p className="text-sm font-bold text-rose-700">{error}</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && recipes.length === 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-2">
          <ChefHat className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-black text-slate-800">لا توجد وصفات مطابقة لبحثك حاليًا</h3>
          <p className="text-xs text-slate-500">جرّب البحث باسم مختلف أو تصفح كل الوصفات.</p>
        </div>
      )}

      {/* Editorial Recipe Cards Grid */}
      {!loading && !error && recipes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {recipes.map((r) => (
            <article
              key={r.id}
              onClick={() => setActiveRecipeId(r.id)}
              className="group bg-white rounded-[24px] border border-slate-200/85 overflow-hidden shadow-[0_6px_22px_rgba(15,23,42,0.05)] hover:border-[#A92224]/45 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
            >
              {/* 16:9 Editorial Image */}
              <div className="relative aspect-[16/9] w-full bg-slate-100 overflow-hidden">
                {r.image_url ? (
                  <img
                    src={r.image_url}
                    alt={r.title_ar}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#3D1214] to-[#A92224] flex items-center justify-center text-white/85">
                    <ChefHat className="w-10 h-10" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent pointer-events-none" />
                {r.video_url && (
                  <div className="absolute top-3 left-3 bg-black/55 backdrop-blur-md text-white px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1">
                    <Video className="w-3.5 h-3.5" />
                    <span>فيديو</span>
                  </div>
                )}
                <div className="absolute bottom-3 inset-x-3.5 text-white flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-amber-300">
                      {r.category_ar} · {r.source_name}
                    </div>
                    <h2 className="text-base font-black leading-snug line-clamp-1 mt-0.5">
                      {r.title_ar}
                    </h2>
                  </div>
                </div>
              </div>

              {/* Clean Metadata & Direct Action */}
              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  {r.description_ar && (
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed font-medium">
                      {r.description_ar}
                    </p>
                  )}

                  <div className="flex items-center gap-2 text-[11.5px] font-bold text-slate-500 flex-wrap tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#A92224]" />
                      <span>{r.prep_time_minutes} دقيقة</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-[#A92224]" />
                      <span>{r.servings} أفراد</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <ShoppingCart className="w-3.5 h-3.5 text-[#A92224]" />
                      <span>{r.products_count} منتج</span>
                    </span>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="tabular-nums">
                    <span className="text-[10.5px] font-semibold text-slate-400 block">التكلفة التقديرية</span>
                    <span className="text-sm font-black text-slate-900">
                      {r.estimated_total > 0 ? `${r.estimated_total.toFixed(0)} ج.م` : 'حسب اختيارك'}
                    </span>
                  </div>
                  <span className="h-9 px-4 rounded-xl bg-[#A92224] group-hover:bg-[#8E1B1D] text-white text-xs font-black flex items-center gap-1.5 transition">
                    <span>تسوق واطبخ</span>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
