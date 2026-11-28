import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Home,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  ShoppingCart,
  Sparkles,
  Store,
  Timer,
  Trash2,
  Users,
  Video,
  Image as ImageIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { RecipeDetail, RecipeLinkedProduct } from '../../shared/types';

export interface SelectedRecipeCartItem {
  product: RecipeLinkedProduct;
  qty: number;
}

interface Props {
  recipeId: string;
  onBack: () => void;
  onAddIngredientsToCart: (items: SelectedRecipeCartItem[]) => void;
  onNotify?: (msg: string) => void;
}

function formatTimerClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getEmbedVideoUrl(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  const clean = String(url || '').trim();
  if (!clean) return null;
  const ytMatch = clean.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (ytMatch) {
    return { kind: 'iframe', src: `https://www.youtube.com/embed/${ytMatch[1]}` };
  }
  const vimeoMatch = clean.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) {
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  }
  return { kind: 'video', src: clean };
}

export const OtlobhaRecipeDetailView: React.FC<Props> = ({
  recipeId,
  onBack,
  onAddIngredientsToCart,
  onNotify,
}) => {
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ingredients' | 'steps'>('ingredients');
  const [showVideo, setShowVideo] = useState(false);

  // Ingredient shopping state: maps ingredientId -> selected productId, qty, excluded/haveAtHome
  const [selectedProductByIng, setSelectedProductByIng] = useState<Record<string, string>>({});
  const [qtyByIng, setQtyByIng] = useState<Record<string, number>>({});
  const [haveAtHome, setHaveAtHome] = useState<Record<string, boolean>>({});
  const [removedIngs, setRemovedIngs] = useState<Record<string, boolean>>({});

  // Cook Step-by-Step state (preserved across tab switches and persisted per recipe in sessionStorage)
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});
  const [timerRemaining, setTimerRemaining] = useState<Record<string, number>>({});
  const [runningTimers, setRunningTimers] = useState<Record<string, boolean>>({});
  const [finishedTimers, setFinishedTimers] = useState<Record<string, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setShowVideo(false);

    api
      .getRecipeDetail(recipeId)
      .then((res) => {
        if (!active) return;
        const r = res.recipe;
        setRecipe(r);

        // Initialize default product selections & quantities
        const initSelected: Record<string, string> = {};
        const initQty: Record<string, number> = {};
        for (const grp of r.groups) {
          for (const ing of grp.ingredients) {
            if (ing.default_product_id) {
              initSelected[ing.id] = ing.default_product_id;
              const matched = ing.products.find((p) => p.product_id === ing.default_product_id);
              initQty[ing.id] = matched ? Number(matched.default_qty || (matched.is_weighted ? matched.weight_step : 1)) : 1;
            }
          }
        }
        setSelectedProductByIng(initSelected);
        setQtyByIng(initQty);
        setHaveAtHome({});
        setRemovedIngs({});

        // Restore cooking step completion from sessionStorage if available
        let restoredCompleted: Record<string, boolean> = {};
        try {
          const saved = sessionStorage.getItem(`otlobha_recipe_steps_${r.id}`);
          if (saved) restoredCompleted = JSON.parse(saved);
        } catch {
          // ignore
        }
        setCompletedSteps(restoredCompleted);

        const initTimers: Record<string, number> = {};
        for (const st of r.steps) {
          if (st.timer_seconds > 0) initTimers[st.id] = st.timer_seconds;
        }
        setTimerRemaining(initTimers);
        setRunningTimers({});
        setFinishedTimers({});
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الوصفة');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [recipeId]);

  // Persist completed steps across brief navigations
  useEffect(() => {
    if (!recipe) return;
    try {
      sessionStorage.setItem(`otlobha_recipe_steps_${recipe.id}`, JSON.stringify(completedSteps));
    } catch {
      // ignore
    }
  }, [recipe, completedSteps]);

  // Single master interval ticking any running step timers (survives tab switches, cleans up on unmount)
  const hasAnyRunningTimer = useMemo(
    () => Object.values(runningTimers).some(Boolean),
    [runningTimers]
  );

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!hasAnyRunningTimer) return;

    intervalRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        let changed = false;
        const next = { ...prev };
        const newlyFinished: string[] = [];

        for (const [stepId, isRun] of Object.entries(runningTimers)) {
          if (!isRun) continue;
          const cur = Number(prev[stepId] ?? 0);
          if (cur > 1) {
            next[stepId] = cur - 1;
            changed = true;
          } else if (cur === 1) {
            next[stepId] = 0;
            newlyFinished.push(stepId);
            changed = true;
          }
        }

        if (newlyFinished.length > 0) {
          setRunningTimers((rt) => {
            const copy = { ...rt };
            for (const sid of newlyFinished) copy[sid] = false;
            return copy;
          });
          setFinishedTimers((ft) => {
            const copy = { ...ft };
            for (const sid of newlyFinished) copy[sid] = true;
            return copy;
          });
          onNotify?.('انتهى مؤقت خطوة الطبخ!');
        }

        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasAnyRunningTimer, runningTimers, onNotify]);

  // Compute live selected shopping basket summary
  const shoppingSummary = useMemo(() => {
    if (!recipe) return { items: [] as SelectedRecipeCartItem[], totalAmount: 0, totalItems: 0, storesCount: 0, storeNames: [] as string[] };
    const selectedItems: SelectedRecipeCartItem[] = [];
    const storesMap = new Map<string, string>();
    let totalAmount = 0;

    for (const grp of recipe.groups) {
      for (const ing of grp.ingredients) {
        if (haveAtHome[ing.id] || removedIngs[ing.id]) continue;
        const pid = selectedProductByIng[ing.id];
        if (!pid) continue;
        const prod = ing.products.find((p) => p.product_id === pid);
        if (!prod || !prod.is_available) continue;
        const qty = Number(qtyByIng[ing.id] ?? prod.default_qty ?? 1);
        if (qty <= 0) continue;
        selectedItems.push({ product: prod, qty });
        totalAmount += prod.effective_price * qty;
        storesMap.set(prod.merchant_id, prod.merchant_name);
      }
    }

    return {
      items: selectedItems,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalItems: selectedItems.length,
      storesCount: storesMap.size,
      storeNames: Array.from(storesMap.values()),
    };
  }, [recipe, haveAtHome, removedIngs, selectedProductByIng, qtyByIng]);

  const completedStepsCount = useMemo(() => {
    if (!recipe) return 0;
    return recipe.steps.filter((s) => Boolean(completedSteps[s.id])).length;
  }, [recipe, completedSteps]);

  const handleSelectProductForIng = (ingId: string, prod: RecipeLinkedProduct) => {
    if (!prod.is_available) return;
    setSelectedProductByIng((prev) => ({ ...prev, [ingId]: prod.product_id }));
    setRemovedIngs((prev) => ({ ...prev, [ingId]: false }));
    setHaveAtHome((prev) => ({ ...prev, [ingId]: false }));
    setQtyByIng((prev) => ({
      ...prev,
      [ingId]: prev[ingId] && prev[ingId] > 0 ? prev[ingId] : prod.default_qty || (prod.is_weighted ? prod.weight_step : 1),
    }));
  };

  const handleStepQty = (ingId: string, prod: RecipeLinkedProduct, dir: 1 | -1) => {
    const step = prod.is_weighted ? Number(prod.weight_step || 0.25) : 1;
    setQtyByIng((prev) => {
      const cur = Number(prev[ingId] ?? prod.default_qty ?? step);
      const next = Math.round((cur + dir * step) * 1000) / 1000;
      if (next <= 0.001) {
        setRemovedIngs((r) => ({ ...r, [ingId]: true }));
        return { ...prev, [ingId]: step };
      }
      return { ...prev, [ingId]: next };
    });
  };

  const handleShare = async () => {
    if (!recipe) return;
    const shareText = `${recipe.title_ar} — تسوق مكوناتها واطبخها خطوة بخطوة على منصة اطلبها`;
    try {
      if (navigator.share) {
        await navigator.share({ title: recipe.title_ar, text: shareText, url: window.location.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareText}\n${window.location.href}`);
        onNotify?.('تم نسخ رابط الوصفة للمشاركة');
      }
    } catch {
      // user cancelled share
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 pb-24" dir="rtl">
        <div className="h-60 rounded-3xl bg-slate-200 animate-pulse" />
        <div className="h-24 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-44 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-3" dir="rtl">
        <ChefHat className="w-10 h-10 text-slate-300 mx-auto" />
        <p className="text-sm font-bold text-slate-700">{error || 'الوصفة غير متاحة حاليًا'}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-[#A92224] text-white text-xs font-extrabold cursor-pointer"
        >
          العودة لقائمة الوصفات
        </button>
      </div>
    );
  }

  const videoInfo = getEmbedVideoUrl(recipe.video_url);
  const progressPct = recipe.steps.length > 0 ? Math.round((completedStepsCount / recipe.steps.length) * 100) : 0;

  return (
    <div className="space-y-4 pb-36" dir="rtl">
      {/* 1. HERO MEDIA (IMAGE OR VIDEO) */}
      <div className="relative rounded-[26px] overflow-hidden bg-slate-900 shadow-[0_14px_38px_rgba(15,23,42,0.14)]">
        <div className="relative aspect-[16/9] w-full">
          {showVideo && videoInfo ? (
            videoInfo.kind === 'iframe' ? (
              <iframe
                src={videoInfo.src}
                title={recipe.title_ar}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                src={videoInfo.src}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-cover bg-black"
              />
            )
          ) : recipe.image_url ? (
            <img
              src={recipe.image_url}
              alt={recipe.title_ar}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#3D1214] via-[#7A1A1D] to-[#A92224] flex flex-col items-center justify-center text-white/90 gap-2">
              <ChefHat className="w-12 h-12" />
              <span className="text-sm font-black">{recipe.title_ar}</span>
            </div>
          )}

          {!showVideo && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/35 pointer-events-none" />
          )}

          {/* Top Floating Controls */}
          <div className="absolute top-3.5 inset-x-3.5 flex items-center justify-between gap-2 z-20">
            <button
              type="button"
              onClick={onBack}
              className="w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md text-white flex items-center justify-center transition cursor-pointer"
              aria-label="رجوع"
            >
              <ArrowRight className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              {videoInfo && (
                <button
                  type="button"
                  onClick={() => setShowVideo((v) => !v)}
                  className="h-10 px-3.5 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md text-white text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer"
                >
                  {showVideo ? <ImageIcon className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                  <span>{showVideo ? 'عرض الصورة' : 'شاهد الفيديو'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleShare}
                className="w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md text-white flex items-center justify-center transition cursor-pointer"
                aria-label="مشاركة الوصفة"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bottom Title Overlay (when image mode is shown) */}
          {!showVideo && (
            <div className="absolute bottom-0 inset-x-0 p-4 sm:p-5 z-10 text-white space-y-1">
              <div className="text-[11.5px] font-bold text-amber-300 flex items-center gap-1.5">
                <span>{recipe.category_ar}</span>
                <span aria-hidden="true">·</span>
                <span>المصدر: {recipe.source_name}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black leading-snug text-balance">
                {recipe.title_ar}
              </h1>
            </div>
          )}
        </div>
      </div>

      {/* 2. DESCRIPTION & STRUCTURED METADATA STRIP */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3.5">
        {showVideo && (
          <div className="space-y-1">
            <div className="text-xs font-bold text-[#A92224]">
              {recipe.category_ar} · المصدر: {recipe.source_name}
            </div>
            <h1 className="text-lg font-black text-slate-900">{recipe.title_ar}</h1>
          </div>
        )}

        {recipe.description_ar && (
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
            {recipe.description_ar}
          </p>
        )}

        <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-200/80 pt-2 border-t border-slate-100 text-center">
          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[11px] font-semibold">
              <Clock className="w-3.5 h-3.5 text-[#A92224]" />
              <span>مدة التحضير</span>
            </div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {recipe.prep_time_minutes} دقيقة
            </div>
          </div>
          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[11px] font-semibold">
              <Users className="w-3.5 h-3.5 text-[#A92224]" />
              <span>عدد الأشخاص</span>
            </div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {recipe.servings} أفراد
            </div>
          </div>
          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[11px] font-semibold">
              <ShoppingCart className="w-3.5 h-3.5 text-[#A92224]" />
              <span>المنتجات المطلوبة</span>
            </div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {recipe.products_count} منتج
            </div>
          </div>
        </div>
      </div>

      {/* 3. SEGMENTED 2-TAB SWITCHER (SHOP INGREDIENTS | COOK STEP BY STEP) */}
      <div className="bg-slate-200/75 p-1 rounded-2xl grid grid-cols-2 gap-1 sticky top-2 z-20 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveTab('ingredients')}
          className={`h-11 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition cursor-pointer ${
            activeTab === 'ingredients'
              ? 'bg-white text-[#A92224] shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>تسوق المكونات</span>
          <span className="text-[11px] font-bold opacity-80 tabular-nums">({shoppingSummary.totalItems})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('steps')}
          className={`h-11 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition cursor-pointer ${
            activeTab === 'steps'
              ? 'bg-white text-[#A92224] shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>اطبخ خطوة بخطوة</span>
          <span className="text-[11px] font-bold opacity-80 tabular-nums">
            ({completedStepsCount}/{recipe.steps.length})
          </span>
        </button>
      </div>

      {/* 4A. TAB 1: SHOP INGREDIENTS */}
      {activeTab === 'ingredients' && (
        <div className="space-y-5">
          {recipe.groups.map((grp) => (
            <section key={grp.id} className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm sm:text-base font-black text-slate-900">{grp.title_ar}</h2>
                <span className="text-xs font-bold text-slate-500 tabular-nums">
                  {grp.ingredients.length} مكونات
                </span>
              </div>

              <div className="space-y-3">
                {grp.ingredients.map((ing) => {
                  const owned = Boolean(haveAtHome[ing.id]);
                  const removed = Boolean(removedIngs[ing.id]);
                  const excluded = owned || removed;
                  const activeProdId = selectedProductByIng[ing.id] || '';
                  const activeProd = ing.products.find((p) => p.product_id === activeProdId) || null;
                  const currentQty = Number(
                    qtyByIng[ing.id] ?? activeProd?.default_qty ?? (activeProd?.is_weighted ? activeProd.weight_step : 1)
                  );
                  const hasMultipleChoices = ing.products.filter((p) => p.is_available).length > 1;

                  return (
                    <div
                      key={ing.id}
                      className={`bg-white rounded-2xl border transition-opacity ${
                        excluded
                          ? 'border-slate-200/70 opacity-65'
                          : 'border-slate-200/90'
                      } p-3.5 space-y-3`}
                    >
                      {/* Ingredient Header Row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className={`text-sm font-black ${excluded ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                              {ing.name_ar}
                            </h3>
                            <span className="text-xs font-bold text-slate-500 tabular-nums">
                              · {ing.quantity} {ing.unit_ar}
                            </span>
                            {ing.is_optional && (
                              <span className="text-[11px] font-bold text-slate-400">· اختياري</span>
                            )}
                          </div>
                          {ing.notes_ar && (
                            <p className="text-[11.5px] text-slate-500 mt-0.5 leading-snug">{ing.notes_ar}</p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setHaveAtHome((prev) => ({ ...prev, [ing.id]: !prev[ing.id] }));
                            setRemovedIngs((prev) => ({ ...prev, [ing.id]: false }));
                          }}
                          className={`shrink-0 h-8 px-2.5 rounded-xl text-[11px] font-extrabold border flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
                            owned
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <Home className="w-3.5 h-3.5" />
                          <span>{owned ? 'متوفر لديّ ✓' : 'متوفر لديّ'}</span>
                        </button>
                      </div>

                      {/* Unavailable Notice */}
                      {ing.primary_unavailable && !excluded && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200/80 px-3 py-2 text-[11.5px] text-amber-900 font-bold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            {ing.suggested_alternatives.length > 0
                              ? 'المنتج الأساسي غير متوفر حاليًا — اخترنا لك بدائل مقترحة متوفرة من متاجر اطلبها:'
                              : 'المنتج الأساسي غير متوفر حاليًا في المتجر.'}
                          </span>
                        </div>
                      )}

                      {/* Excluded / Removed Restore Banner */}
                      {removed && !owned && (
                        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          <span>تم استبعاد هذا المكون من قائمة الشراء</span>
                          <button
                            type="button"
                            onClick={() => setRemovedIngs((prev) => ({ ...prev, [ing.id]: false }))}
                            className="font-black text-[#A92224] hover:underline cursor-pointer"
                          >
                            إعادة الإضافة
                          </button>
                        </div>
                      )}

                      {/* Linked Real Store Products */}
                      {!excluded && ing.products.length === 0 && (
                        <p className="text-xs text-slate-400 font-semibold">
                          لا يوجد منتج مرتبط بهذا المكون حاليًا في المتاجر.
                        </p>
                      )}

                      {!excluded && ing.products.length > 0 && (
                        <div className="space-y-2">
                          {ing.products.map((prod) => {
                            const isSelected = activeProd?.product_id === prod.product_id;
                            const hasDiscount = prod.is_offer && prod.sale_price !== null && prod.sale_price < prod.base_price;

                            return (
                              <div
                                key={prod.product_id}
                                onClick={() => prod.is_available && handleSelectProductForIng(ing.id, prod)}
                                className={`rounded-xl border p-2.5 flex items-center gap-3 transition ${
                                  !prod.is_available
                                    ? 'bg-slate-50/80 border-slate-200/70 opacity-60 cursor-not-allowed'
                                    : isSelected
                                    ? 'bg-[#FFF9F9] border-[#A92224] cursor-pointer'
                                    : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                                }`}
                              >
                                {/* Selection Radio Indicator */}
                                <div
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                    !prod.is_available
                                      ? 'border-slate-300 bg-slate-100'
                                      : isSelected
                                      ? 'border-[#A92224] bg-[#A92224] text-white'
                                      : 'border-slate-300 bg-white'
                                  }`}
                                >
                                  {isSelected && prod.is_available && <Check className="w-3 h-3 stroke-[3]" />}
                                </div>

                                {/* Real Product Thumbnail */}
                                <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                  {prod.image_url ? (
                                    <img
                                      src={prod.image_url}
                                      alt={prod.name_ar}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-contain p-1"
                                    />
                                  ) : (
                                    <ShoppingCart className="w-5 h-5 text-slate-300" />
                                  )}
                                </div>

                                {/* Product Real Metadata */}
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-extrabold">
                                    {prod.is_recommended && hasMultipleChoices && prod.is_available && (
                                      <span className="text-[#A92224] flex items-center gap-0.5">
                                        <Sparkles className="w-3 h-3" />
                                        <span>موصى به</span>
                                      </span>
                                    )}
                                    {prod.is_suggested_alternative && prod.is_available && (
                                      <span className="text-amber-700">بديل مقترح</span>
                                    )}
                                    {!prod.is_available && (
                                      <span className="text-rose-600">غير متوفر حاليًا</span>
                                    )}
                                  </div>

                                  <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                                    {prod.name_ar}
                                  </div>

                                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                                    <span className="inline-flex items-center gap-0.5 font-semibold text-slate-600">
                                      <Store className="w-3 h-3 text-slate-400" />
                                      <span>{prod.merchant_name}</span>
                                    </span>
                                    {prod.size_label && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span>{prod.size_label}</span>
                                      </>
                                    )}
                                    {!prod.merchant_is_open && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-rose-600 font-bold">المتجر مغلق حاليًا</span>
                                      </>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 pt-0.5 tabular-nums">
                                    <span className="text-sm font-black text-[#A92224]">
                                      {prod.effective_price.toFixed(2)} ج.م
                                    </span>
                                    {hasDiscount && (
                                      <span className="text-[11px] text-slate-400 line-through font-semibold">
                                        {prod.base_price.toFixed(2)} ج.م
                                      </span>
                                    )}
                                    {hasDiscount && (
                                      <span className="text-[10.5px] font-extrabold text-emerald-700">عرض</span>
                                    )}
                                  </div>
                                </div>

                                {/* Active Quantity Stepper & Delete */}
                                {isSelected && prod.is_available && (
                                  <div
                                    className="flex flex-col items-end gap-1.5 shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5">
                                      <button
                                        type="button"
                                        onClick={() => handleStepQty(ing.id, prod, 1)}
                                        className="w-7 h-7 rounded-lg bg-[#A92224] text-white flex items-center justify-center cursor-pointer"
                                        aria-label="زيادة الكمية"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                      </button>
                                      <span className="min-w-[28px] text-center text-xs font-black text-slate-900 tabular-nums px-1">
                                        {currentQty}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleStepQty(ing.id, prod, -1)}
                                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
                                        aria-label="تقليل الكمية"
                                      >
                                        <Minus className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setRemovedIngs((prev) => ({ ...prev, [ing.id]: true }))}
                                      className="text-[10.5px] font-bold text-slate-400 hover:text-rose-600 flex items-center gap-0.5 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>حذف</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 4B. TAB 2: COOK STEP BY STEP */}
      {activeTab === 'steps' && (
        <div className="space-y-4">
          {/* Cooking Progress Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-slate-900">تقدم تحضير الوصفة</h2>
                <p className="text-xs text-slate-500 font-semibold mt-0.5 tabular-nums">
                  أكملت {completedStepsCount} من {recipe.steps.length} خطوات
                </p>
              </div>
              <span className="text-lg font-black text-[#A92224] tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  progressPct === 100 ? 'bg-emerald-500' : 'bg-[#A92224]'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {progressPct === 100 && recipe.steps.length > 0 && (
              <p className="text-xs font-extrabold text-emerald-700">
                بالهنا والشفا! تم إكمال جميع خطوات الوصفة بنجاح.
              </p>
            )}
          </div>

          {/* Ordered Steps List */}
          <div className="space-y-3">
            {recipe.steps.map((step) => {
              const isDone = Boolean(completedSteps[step.id]);
              const hasTimer = step.timer_seconds > 0;
              const remSec = Number(timerRemaining[step.id] ?? step.timer_seconds);
              const isRunning = Boolean(runningTimers[step.id]);
              const isFinished = Boolean(finishedTimers[step.id]) || (hasTimer && remSec === 0);

              return (
                <div
                  key={step.id}
                  className={`bg-white rounded-2xl border p-4 space-y-3 transition ${
                    isDone ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200/90'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setCompletedSteps((prev) => ({
                          ...prev,
                          [step.id]: !prev[step.id],
                        }))
                      }
                      aria-label={isDone ? 'إلغاء إكمال الخطوة' : 'تحديد الخطوة كمكتملة'}
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 font-black text-xs transition cursor-pointer mt-0.5 ${
                        isDone
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:border-[#A92224]'
                      }`}
                    >
                      {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : step.step_number}
                    </button>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3
                          className={`text-sm font-black ${
                            isDone ? 'line-through text-emerald-900/70' : 'text-slate-900'
                          }`}
                        >
                          {step.step_number}. {step.title_ar}
                        </h3>
                        {isDone && (
                          <span className="text-[11px] font-extrabold text-emerald-700 flex items-center gap-1 shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>مكتملة</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                        {step.instruction_ar}
                      </p>
                      {step.tip_ar && (
                        <p className="text-[11.5px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2 font-semibold mt-1.5">
                          نصيحة الشيف: {step.tip_ar}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Interactive Step Countdown Timer */}
                  {hasTimer && (
                    <div
                      className={`rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 border ${
                        isFinished
                          ? 'bg-emerald-50 border-emerald-200'
                          : isRunning
                          ? 'bg-[#FFF5F5] border-[#A92224]/30'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Timer
                          className={`w-4 h-4 ${
                            isFinished ? 'text-emerald-600' : isRunning ? 'text-[#A92224]' : 'text-slate-500'
                          }`}
                        />
                        <span className="text-base font-black font-mono tabular-nums text-slate-900">
                          {formatTimerClock(remSec)}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">
                          {isFinished ? 'انتهى الوقت' : isRunning ? 'المؤقت يعمل' : 'مؤقت الخطوة'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (remSec <= 0) {
                              setTimerRemaining((p) => ({ ...p, [step.id]: step.timer_seconds }));
                              setFinishedTimers((p) => ({ ...p, [step.id]: false }));
                              setRunningTimers((p) => ({ ...p, [step.id]: true }));
                            } else {
                              setRunningTimers((p) => ({ ...p, [step.id]: !p[step.id] }));
                            }
                          }}
                          className={`h-8 px-3 rounded-lg text-xs font-extrabold flex items-center gap-1 cursor-pointer transition ${
                            isRunning
                              ? 'bg-slate-900 text-white'
                              : 'bg-[#A92224] hover:bg-[#8E1B1D] text-white'
                          }`}
                        >
                          {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          <span>{isRunning ? 'إيقاف' : 'تشغيل'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRunningTimers((p) => ({ ...p, [step.id]: false }));
                            setFinishedTimers((p) => ({ ...p, [step.id]: false }));
                            setTimerRemaining((p) => ({ ...p, [step.id]: step.timer_seconds }));
                          }}
                          aria-label="إعادة ضبط المؤقت"
                          className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. FIXED STICKY BOTTOM INGREDIENT CART BAR */}
      <div className="fixed bottom-[70px] inset-x-0 z-30 px-3 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto bg-white/98 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-[0_12px_36px_rgba(15,23,42,0.18)] px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11.5px] font-bold text-slate-500 flex items-center gap-1.5 flex-wrap tabular-nums">
              <span>{shoppingSummary.totalItems} منتجات مختارة</span>
              {shoppingSummary.storesCount > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-700 font-extrabold">
                    من {shoppingSummary.storesCount} متاجر
                  </span>
                </>
              )}
            </div>
            <div className="text-base sm:text-lg font-black text-slate-900 tabular-nums">
              {shoppingSummary.totalAmount.toFixed(2)} <span className="text-xs font-bold text-slate-500">ج.م</span>
            </div>
          </div>

          <button
            type="button"
            disabled={shoppingSummary.totalItems === 0}
            onClick={() => {
              if (shoppingSummary.items.length === 0) return;
              onAddIngredientsToCart(shoppingSummary.items);
            }}
            className="h-11 px-5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] disabled:bg-slate-300 text-white text-xs sm:text-sm font-black flex items-center gap-2 shrink-0 cursor-pointer transition shadow-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>أضف للسلة</span>
          </button>
        </div>
      </div>
    </div>
  );
};
