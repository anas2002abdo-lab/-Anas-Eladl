import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChefHat,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Timer,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  RecipeDetail,
  RecipeLinkedProduct,
  RecipeSummary,
  RecipeUpsertPayload,
} from '../shared/types';

interface Props {
  lang: 'ar' | 'en';
  onNotify: (msg: string) => void;
}

type DraftProductLink = {
  product_id: string;
  name_ar: string;
  merchant_name: string;
  effective_price: number;
  size_label: string;
  image_url: string;
  is_available: boolean;
  is_recommended: boolean;
  is_alternative: boolean;
  default_qty: number;
};

type DraftIngredient = {
  tempId: string;
  name_ar: string;
  quantity: number;
  unit_ar: string;
  notes_ar: string;
  is_optional: boolean;
  products: DraftProductLink[];
};

type DraftGroup = {
  tempId: string;
  title_ar: string;
  ingredients: DraftIngredient[];
};

type DraftStep = {
  tempId: string;
  title_ar: string;
  instruction_ar: string;
  timer_minutes: number;
  timer_seconds_rem: number;
  tip_ar: string;
};

const mkId = () => `tmp_${Math.random().toString(36).slice(2, 10)}`;

const PRESET_CATEGORIES = ['وجبات رئيسية', 'مشويات', 'فطار صحي', 'سلطات وسريع', 'حلويات ومشروبات', 'مقبلات وشوربات'];
const PRESET_UNITS = ['جرام', 'كجم', 'مل', 'لتر', 'عبوة', 'علبة', 'كيس', 'كوب', 'ملعقة كبيرة', 'ملعقة صغيرة', 'حزمة', 'قطعة'];

function createEmptyDraft() {
  return {
    title_ar: '',
    description_ar: '',
    source_name: 'مطبخ اطلبها',
    category_ar: 'وجبات رئيسية',
    image_url: '',
    video_url: '',
    prep_time_minutes: 30,
    servings: 4,
    difficulty_ar: 'متوسط',
    is_active: true,
    groups: [
      {
        tempId: mkId(),
        title_ar: 'المكونات الأساسية',
        ingredients: [
          {
            tempId: mkId(),
            name_ar: '',
            quantity: 1,
            unit_ar: 'عبوة',
            notes_ar: '',
            is_optional: false,
            products: [],
          },
        ],
      },
    ] as DraftGroup[],
    steps: [
      {
        tempId: mkId(),
        title_ar: 'التحضير الأولي',
        instruction_ar: '',
        timer_minutes: 0,
        timer_seconds_rem: 0,
        tip_ar: '',
      },
    ] as DraftStep[],
  };
}

export const AdminRecipesSection: React.FC<Props> = ({ onNotify }) => {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'hidden'>('all');

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<'basic' | 'ingredients' | 'steps'>('basic');
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [draft, setDraft] = useState(createEmptyDraft());

  // Product picker drawer for linking real DB products to a specific ingredient
  const [pickerTarget, setPickerTarget] = useState<{ groupId: string; ingId: string; ingName: string } | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<RecipeLinkedProduct[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Confirm delete state
  const [deleteTarget, setDeleteTarget] = useState<RecipeSummary | null>(null);

  const loadRecipes = async () => {
    setLoading(true);
    try {
      const res = await api.adminGetRecipes();
      setRecipes(res.recipes || []);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل الوصفات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipes();
  }, []);

  useEffect(() => {
    if (!pickerTarget) return;
    let active = true;
    const t = setTimeout(() => {
      setPickerLoading(true);
      api
        .adminSearchRecipeProducts(pickerQuery)
        .then((res) => {
          if (active) setPickerResults(res.products || []);
        })
        .catch(() => {
          if (active) setPickerResults([]);
        })
        .finally(() => {
          if (active) setPickerLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [pickerTarget, pickerQuery]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false;
      if (statusFilter === 'hidden' && r.is_active) return false;
      if (q) {
        const hay = `${r.title_ar} ${r.category_ar} ${r.source_name} ${r.description_ar}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recipes, search, statusFilter]);

  const openCreateEditor = () => {
    setEditingId(null);
    setDraft(createEmptyDraft());
    setEditorTab('basic');
    setEditorOpen(true);
  };

  const openEditEditor = async (recipeId: string) => {
    setEditingId(recipeId);
    setEditorTab('basic');
    setEditorOpen(true);
    setLoadingDetail(true);
    try {
      const res = await api.adminGetRecipeDetail(recipeId);
      const r: RecipeDetail = res.recipe;
      setDraft({
        title_ar: r.title_ar,
        description_ar: r.description_ar,
        source_name: r.source_name || 'مطبخ اطلبها',
        category_ar: r.category_ar || 'وجبات رئيسية',
        image_url: r.image_url || '',
        video_url: r.video_url || '',
        prep_time_minutes: r.prep_time_minutes || 30,
        servings: r.servings || 4,
        difficulty_ar: r.difficulty_ar || 'متوسط',
        is_active: r.is_active,
        groups:
          r.groups.length > 0
            ? r.groups.map((g) => ({
                tempId: g.id || mkId(),
                title_ar: g.title_ar,
                ingredients: g.ingredients.map((i) => ({
                  tempId: i.id || mkId(),
                  name_ar: i.name_ar,
                  quantity: i.quantity,
                  unit_ar: i.unit_ar || 'عبوة',
                  notes_ar: i.notes_ar || '',
                  is_optional: i.is_optional,
                  products: i.products
                    .filter((p) => p.suggestion_source !== 'auto_match')
                    .map((p) => ({
                      product_id: p.product_id,
                      name_ar: p.name_ar,
                      merchant_name: p.merchant_name,
                      effective_price: p.effective_price,
                      size_label: p.size_label,
                      image_url: p.image_url,
                      is_available: p.is_available,
                      is_recommended: p.is_recommended,
                      is_alternative: p.is_alternative,
                      default_qty: p.default_qty || 1,
                    })),
                })),
              }))
            : createEmptyDraft().groups,
        steps:
          r.steps.length > 0
            ? r.steps.map((s) => ({
                tempId: s.id || mkId(),
                title_ar: s.title_ar,
                instruction_ar: s.instruction_ar,
                timer_minutes: Math.floor((s.timer_seconds || 0) / 60),
                timer_seconds_rem: (s.timer_seconds || 0) % 60,
                tip_ar: s.tip_ar || '',
              }))
            : createEmptyDraft().steps,
      });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الوصفة');
      setEditorOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleToggleActive = async (recipe: RecipeSummary) => {
    try {
      const next = !recipe.is_active;
      await api.adminToggleRecipe(recipe.id, next);
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, is_active: next } : r)));
      onNotify(next ? `تم تفعيل الوصفة "${recipe.title_ar}"` : `تم إخفاء الوصفة "${recipe.title_ar}"`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحديث حالة الوصفة');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.adminDeleteRecipe(deleteTarget.id);
      setRecipes((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      onNotify(`تم حذف الوصفة "${deleteTarget.title_ar}"`);
      setDeleteTarget(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حذف الوصفة');
    }
  };

  const handleSaveRecipe = async () => {
    if (!draft.title_ar.trim()) {
      onNotify('يرجى إدخال اسم الوصفة أولاً');
      setEditorTab('basic');
      return;
    }

    const payload: RecipeUpsertPayload = {
      title_ar: draft.title_ar.trim(),
      description_ar: draft.description_ar.trim(),
      source_name: draft.source_name.trim() || 'مطبخ اطلبها',
      category_ar: draft.category_ar.trim() || 'وجبات رئيسية',
      image_url: draft.image_url.trim(),
      video_url: draft.video_url.trim(),
      prep_time_minutes: Math.max(1, Number(draft.prep_time_minutes || 30)),
      servings: Math.max(1, Number(draft.servings || 4)),
      difficulty_ar: draft.difficulty_ar || 'متوسط',
      is_active: draft.is_active,
      groups: draft.groups
        .map((g) => ({
          title_ar: g.title_ar.trim() || 'المكونات',
          ingredients: g.ingredients
            .filter((i) => i.name_ar.trim())
            .map((i) => ({
              name_ar: i.name_ar.trim(),
              quantity: Math.max(0.05, Number(i.quantity || 1)),
              unit_ar: i.unit_ar.trim() || 'عبوة',
              notes_ar: i.notes_ar.trim(),
              is_optional: i.is_optional,
              products: i.products.map((p) => ({
                product_id: p.product_id,
                is_recommended: p.is_recommended,
                is_alternative: p.is_alternative,
                default_qty: Math.max(0.1, Number(p.default_qty || 1)),
              })),
            })),
        }))
        .filter((g) => g.ingredients.length > 0),
      steps: draft.steps
        .filter((s) => s.instruction_ar.trim())
        .map((s, idx) => ({
          title_ar: s.title_ar.trim() || `الخطوة ${idx + 1}`,
          instruction_ar: s.instruction_ar.trim(),
          timer_seconds: Math.max(0, Number(s.timer_minutes || 0) * 60 + Number(s.timer_seconds_rem || 0)),
          tip_ar: s.tip_ar.trim(),
        })),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.adminUpdateRecipe(editingId, payload);
        onNotify('تم تحديث الوصفة بنجاح');
      } else {
        await api.adminCreateRecipe(payload);
        onNotify('تم إنشاء الوصفة الجديدة بنجاح');
      }
      setEditorOpen(false);
      await loadRecipes();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حفظ الوصفة');
    } finally {
      setSaving(false);
    }
  };

  const attachProductToIngredient = (prod: RecipeLinkedProduct) => {
    if (!pickerTarget) return;
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        if (g.tempId !== pickerTarget.groupId) return g;
        return {
          ...g,
          ingredients: g.ingredients.map((ing) => {
            if (ing.tempId !== pickerTarget.ingId) return ing;
            if (ing.products.some((p) => p.product_id === prod.product_id)) return ing;
            const isFirst = ing.products.length === 0;
            return {
              ...ing,
              products: [
                ...ing.products,
                {
                  product_id: prod.product_id,
                  name_ar: prod.name_ar,
                  merchant_name: prod.merchant_name,
                  effective_price: prod.effective_price,
                  size_label: prod.size_label,
                  image_url: prod.image_url,
                  is_available: prod.is_available,
                  is_recommended: isFirst,
                  is_alternative: !isFirst,
                  default_qty: prod.is_weighted ? Number(prod.weight_step || 0.5) : 1,
                },
              ],
            };
          }),
        };
      }),
    }));
    onNotify(`تم ربط المنتج "${prod.name_ar}" بالمكون`);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const next = [...prev.steps];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, steps: next };
    });
  };

  const handleImageFileUpload = (file: File | null) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      onNotify('حجم الصورة يجب ألا يتجاوز 3 ميجابايت');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft((p) => ({ ...p, image_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">إدارة الوصفات الذكية والتسوق من المكونات</h2>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            أنشئ الوصفات واربط كل مكون بمنتجات متاجر اطلبها الفعلية وحدد البدائل وخطوات التحضير والمؤقتات
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateEditor}
          className="h-11 px-5 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] text-white text-xs font-black flex items-center justify-center gap-2 shrink-0 cursor-pointer transition"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة وصفة جديدة</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">إجمالي الوصفات</div>
          <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{recipes.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">الوصفات المفعّلة</div>
          <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
            {recipes.filter((r) => r.is_active).length}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">الوصفات المخفية</div>
          <div className="text-2xl font-black text-slate-600 mt-1 tabular-nums">
            {recipes.filter((r) => !r.is_active).length}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">إجمالي المنتجات المرتبطة</div>
          <div className="text-2xl font-black text-[#A92224] mt-1 tabular-nums">
            {recipes.reduce((s, r) => s + r.products_count, 0)}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الوصفة أو القسم أو المصدر..."
            className="w-full h-10 pr-9 pl-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 focus:border-[#A92224] focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
          {([
            ['all', 'الكل'],
            ['active', 'مفعّلة'],
            ['hidden', 'مخفية'],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter(k)}
              className={`h-8 px-3 rounded-lg text-xs font-extrabold cursor-pointer transition ${
                statusFilter === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Recipes List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm font-bold">
          جاري تحميل الوصفات...
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
          <ChefHat className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-600">لا توجد وصفات مطابقة حاليًا</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRecipes.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between"
            >
              <div className="flex gap-3.5 p-4">
                <div className="w-28 h-24 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200/60">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.title_ar}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <ChefHat className="w-7 h-7" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-[#A92224]">
                      {r.category_ar} · {r.source_name}
                    </span>
                    <span
                      className={`text-[11px] font-extrabold ${
                        r.is_active ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {r.is_active ? 'مفعّلة للعملاء' : 'مخفية'}
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-slate-900 line-clamp-1">{r.title_ar}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{r.description_ar}</p>
                  <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 pt-1 tabular-nums flex-wrap">
                    <span>{r.prep_time_minutes} د</span>
                    <span>·</span>
                    <span>{r.servings} أفراد</span>
                    <span>·</span>
                    <span>{r.products_count} منتج مرتبط</span>
                    <span>·</span>
                    <span>{r.steps_count} خطوات</span>
                    {r.video_url && (
                      <>
                        <span>·</span>
                        <span className="text-indigo-600 inline-flex items-center gap-0.5">
                          <Video className="w-3 h-3" /> فيديو
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-800 tabular-nums">
                  التقديري: {r.estimated_total.toFixed(0)} ج.م
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(r)}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1 cursor-pointer"
                  >
                    {r.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{r.is_active ? 'إخفاء' : 'تفعيل'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditEditor(r.id)}
                    className="h-8 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(r)}
                    className="h-8 px-2.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    aria-label="حذف الوصفة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-black text-slate-900">تأكيد حذف الوصفة</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              هل أنت متأكد من حذف الوصفة <strong>«{deleteTarget.title_ar}»</strong>؟ لن يتم حذف أي منتجات من المتاجر، فقط سجل الوصفة وخطواتها.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-9 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black cursor-pointer"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL RECIPE EDITOR MODAL */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  {editingId ? 'تعديل الوصفة' : 'إنشاء وصفة جديدة'}
                </h3>
                <p className="text-xs text-slate-500 font-semibold">
                  جميع المنتجات المرتبطة تُسحب مباشرة من قاعدة بيانات متاجر اطلبها الفعلية
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Editor Sub-Tabs */}
            <div className="px-5 pt-3 border-b border-slate-100 flex items-center gap-2 overflow-x-auto">
              {([
                ['basic', '1. البيانات والوسائط'],
                ['ingredients', '2. المكونات والمنتجات المرتبطة'],
                ['steps', '3. خطوات التحضير والمؤقتات'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditorTab(key)}
                  className={`pb-3 px-2 text-xs font-black border-b-2 whitespace-nowrap cursor-pointer transition ${
                    editorTab === key
                      ? 'border-[#A92224] text-[#A92224]'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingDetail ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="w-7 h-7 animate-spin text-[#A92224]" />
                  <span className="text-xs font-bold">جاري تحميل بيانات الوصفة...</span>
                </div>
              ) : (
                <>
                  {/* TAB 1: BASIC INFO */}
                  {editorTab === 'basic' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <label className="space-y-1 block sm:col-span-2">
                          <span className="text-xs font-extrabold text-slate-700">اسم الوصفة *</span>
                          <input
                            value={draft.title_ar}
                            onChange={(e) => setDraft((p) => ({ ...p, title_ar: e.target.value }))}
                            placeholder="مثال: مكرونة بالبشاميل واللحم المفروم"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-bold focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <label className="space-y-1 block sm:col-span-2">
                          <span className="text-xs font-extrabold text-slate-700">وصف الوصفة</span>
                          <textarea
                            rows={3}
                            value={draft.description_ar}
                            onChange={(e) => setDraft((p) => ({ ...p, description_ar: e.target.value }))}
                            placeholder="وصف مشوّق للوصفة ومكوناتها..."
                            className="w-full p-3 rounded-xl border border-slate-200 text-xs font-semibold focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <label className="space-y-1 block">
                          <span className="text-xs font-extrabold text-slate-700">مصدر الوصفة</span>
                          <input
                            value={draft.source_name}
                            onChange={(e) => setDraft((p) => ({ ...p, source_name: e.target.value }))}
                            placeholder="مطبخ اطلبها / اسم الشيف"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <label className="space-y-1 block">
                          <span className="text-xs font-extrabold text-slate-700">التصنيف</span>
                          <select
                            value={draft.category_ar}
                            onChange={(e) => setDraft((p) => ({ ...p, category_ar: e.target.value }))}
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold bg-white focus:border-[#A92224] focus:outline-none"
                          >
                            {PRESET_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1 block">
                          <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-[#A92224]" /> مدة التحضير (بالدقائق)
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={draft.prep_time_minutes}
                            onChange={(e) => setDraft((p) => ({ ...p, prep_time_minutes: Number(e.target.value || 1) }))}
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold tabular-nums focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <label className="space-y-1 block">
                          <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-[#A92224]" /> عدد الأشخاص
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={draft.servings}
                            onChange={(e) => setDraft((p) => ({ ...p, servings: Number(e.target.value || 1) }))}
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold tabular-nums focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <div className="space-y-1.5 sm:col-span-2">
                          <span className="text-xs font-extrabold text-slate-700 block">صورة الوصفة الرئيسية (رابط أو رفع)</span>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={draft.image_url}
                              onChange={(e) => setDraft((p) => ({ ...p, image_url: e.target.value }))}
                              placeholder="/recipe-assets/... أو https://..."
                              className="flex-1 h-10 px-3 rounded-xl border border-slate-200 text-xs font-semibold focus:border-[#A92224] focus:outline-none"
                            />
                            <label className="h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-extrabold text-slate-700 flex items-center justify-center cursor-pointer shrink-0">
                              <span>رفع صورة</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handleImageFileUpload(e.target.files?.[0] || null)}
                              />
                            </label>
                          </div>
                          {draft.image_url && (
                            <img
                              src={draft.image_url}
                              alt="معاينة الصورة"
                              referrerPolicy="no-referrer"
                              className="w-48 aspect-[16/9] object-cover rounded-xl border border-slate-200 mt-1"
                            />
                          )}
                        </div>

                        <label className="space-y-1 block sm:col-span-2">
                          <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1">
                            <Video className="w-3.5 h-3.5 text-[#A92224]" /> رابط فيديو الوصفة (اختياري — YouTube أو MP4)
                          </span>
                          <input
                            value={draft.video_url}
                            onChange={(e) => setDraft((p) => ({ ...p, video_url: e.target.value }))}
                            placeholder="https://www.youtube.com/watch?v=... أو رابط ملف MP4"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-semibold focus:border-[#A92224] focus:outline-none"
                          />
                        </label>

                        <label className="flex items-center gap-2.5 sm:col-span-2 pt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.is_active}
                            onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))}
                            className="w-4 h-4 accent-[#A92224]"
                          />
                          <span className="text-xs font-extrabold text-slate-800">
                            تفعيل الوصفة وإظهارها فورًا في تطبيق العميل
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: INGREDIENT GROUPS & REAL PRODUCT LINKING */}
                  {editorTab === 'ingredients' && (
                    <div className="space-y-4">
                      {draft.groups.map((grp, gIdx) => (
                        <div key={grp.tempId} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <input
                              value={grp.title_ar}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  groups: p.groups.map((g) =>
                                    g.tempId === grp.tempId ? { ...g, title_ar: e.target.value } : g
                                  ),
                                }))
                              }
                              placeholder="اسم المجموعة (مثال: مكونات الصوص)"
                              className="flex-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-900"
                            />
                            {draft.groups.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((p) => ({
                                    ...p,
                                    groups: p.groups.filter((g) => g.tempId !== grp.tempId),
                                  }))
                                }
                                className="h-9 px-2.5 rounded-xl border border-rose-200 bg-white text-rose-600 text-xs font-bold cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="space-y-2.5">
                            {grp.ingredients.map((ing) => (
                              <div
                                key={ing.tempId}
                                className="bg-white rounded-xl border border-slate-200 p-3 space-y-2.5"
                              >
                                <div className="grid grid-cols-12 gap-2 items-center">
                                  <input
                                    value={ing.name_ar}
                                    onChange={(e) =>
                                      setDraft((p) => ({
                                        ...p,
                                        groups: p.groups.map((g) =>
                                          g.tempId !== grp.tempId
                                            ? g
                                            : {
                                                ...g,
                                                ingredients: g.ingredients.map((x) =>
                                                  x.tempId === ing.tempId ? { ...x, name_ar: e.target.value } : x
                                                ),
                                              }
                                        ),
                                      }))
                                    }
                                    placeholder="اسم المكون (مثال: حليب كامل الدسم)"
                                    className="col-span-12 sm:col-span-5 h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-bold"
                                  />
                                  <input
                                    type="number"
                                    step="0.25"
                                    min={0.05}
                                    value={ing.quantity}
                                    onChange={(e) =>
                                      setDraft((p) => ({
                                        ...p,
                                        groups: p.groups.map((g) =>
                                          g.tempId !== grp.tempId
                                            ? g
                                            : {
                                                ...g,
                                                ingredients: g.ingredients.map((x) =>
                                                  x.tempId === ing.tempId
                                                    ? { ...x, quantity: Number(e.target.value || 1) }
                                                    : x
                                                ),
                                              }
                                        ),
                                      }))
                                    }
                                    className="col-span-4 sm:col-span-2 h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold tabular-nums"
                                  />
                                  <select
                                    value={ing.unit_ar}
                                    onChange={(e) =>
                                      setDraft((p) => ({
                                        ...p,
                                        groups: p.groups.map((g) =>
                                          g.tempId !== grp.tempId
                                            ? g
                                            : {
                                                ...g,
                                                ingredients: g.ingredients.map((x) =>
                                                  x.tempId === ing.tempId ? { ...x, unit_ar: e.target.value } : x
                                                ),
                                              }
                                        ),
                                      }))
                                    }
                                    className="col-span-6 sm:col-span-3 h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold bg-white"
                                  >
                                    {PRESET_UNITS.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="col-span-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDraft((p) => ({
                                          ...p,
                                          groups: p.groups.map((g) =>
                                            g.tempId !== grp.tempId
                                              ? g
                                              : {
                                                  ...g,
                                                  ingredients: g.ingredients.filter((x) => x.tempId !== ing.tempId),
                                                }
                                          ),
                                        }))
                                      }
                                      className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer"
                                      aria-label="حذف المكون"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <input
                                    value={ing.notes_ar}
                                    onChange={(e) =>
                                      setDraft((p) => ({
                                        ...p,
                                        groups: p.groups.map((g) =>
                                          g.tempId !== grp.tempId
                                            ? g
                                            : {
                                                ...g,
                                                ingredients: g.ingredients.map((x) =>
                                                  x.tempId === ing.tempId ? { ...x, notes_ar: e.target.value } : x
                                                ),
                                              }
                                        ),
                                      }))
                                    }
                                    placeholder="ملاحظة اختيارية على المكون..."
                                    className="flex-1 min-w-[180px] h-8 px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-semibold"
                                  />
                                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={ing.is_optional}
                                      onChange={(e) =>
                                        setDraft((p) => ({
                                          ...p,
                                          groups: p.groups.map((g) =>
                                            g.tempId !== grp.tempId
                                              ? g
                                              : {
                                                  ...g,
                                                  ingredients: g.ingredients.map((x) =>
                                                    x.tempId === ing.tempId ? { ...x, is_optional: e.target.checked } : x
                                                  ),
                                                }
                                          ),
                                        }))
                                      }
                                    />
                                    <span>مكون اختياري</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPickerTarget({
                                        groupId: grp.tempId,
                                        ingId: ing.tempId,
                                        ingName: ing.name_ar || 'المكون',
                                      });
                                      setPickerQuery(ing.name_ar.split(' ')[0] || '');
                                    }}
                                    className="h-8 px-3 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#A92224] text-[11px] font-black flex items-center gap-1 cursor-pointer"
                                  >
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    <span>ربط منتج من المنصة</span>
                                  </button>
                                </div>

                                {/* Linked Real Products for this Ingredient */}
                                {ing.products.length > 0 && (
                                  <div className="space-y-1.5 pt-1 border-t border-slate-100">
                                    {ing.products.map((prod) => (
                                      <div
                                        key={prod.product_id}
                                        className="rounded-lg bg-slate-50 border border-slate-200/80 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="font-black text-slate-900 truncate">{prod.name_ar}</div>
                                          <div className="text-slate-500 font-semibold tabular-nums">
                                            {prod.merchant_name} · {prod.effective_price.toFixed(2)} ج.م
                                            {prod.size_label ? ` · ${prod.size_label}` : ''}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDraft((p) => ({
                                                ...p,
                                                groups: p.groups.map((g) =>
                                                  g.tempId !== grp.tempId
                                                    ? g
                                                    : {
                                                        ...g,
                                                        ingredients: g.ingredients.map((x) =>
                                                          x.tempId !== ing.tempId
                                                            ? x
                                                            : {
                                                                ...x,
                                                                products: x.products.map((pr) => ({
                                                                  ...pr,
                                                                  is_recommended: pr.product_id === prod.product_id,
                                                                  is_alternative:
                                                                    pr.product_id === prod.product_id ? false : pr.is_alternative,
                                                                })),
                                                              }
                                                        ),
                                                      }
                                                ),
                                              }))
                                            }
                                            className={`h-7 px-2 rounded-md font-extrabold border cursor-pointer flex items-center gap-0.5 ${
                                              prod.is_recommended
                                                ? 'bg-[#A92224] text-white border-[#A92224]'
                                                : 'bg-white text-slate-600 border-slate-200'
                                            }`}
                                          >
                                            <Sparkles className="w-3 h-3" />
                                            <span>موصى به</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDraft((p) => ({
                                                ...p,
                                                groups: p.groups.map((g) =>
                                                  g.tempId !== grp.tempId
                                                    ? g
                                                    : {
                                                        ...g,
                                                        ingredients: g.ingredients.map((x) =>
                                                          x.tempId !== ing.tempId
                                                            ? x
                                                            : {
                                                                ...x,
                                                                products: x.products.map((pr) =>
                                                                  pr.product_id === prod.product_id
                                                                    ? {
                                                                        ...pr,
                                                                        is_alternative: !pr.is_alternative,
                                                                        is_recommended: !pr.is_alternative
                                                                          ? false
                                                                          : pr.is_recommended,
                                                                      }
                                                                    : pr
                                                                ),
                                                              }
                                                        ),
                                                      }
                                                ),
                                              }))
                                            }
                                            className={`h-7 px-2 rounded-md font-extrabold border cursor-pointer ${
                                              prod.is_alternative
                                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                                : 'bg-white text-slate-600 border-slate-200'
                                            }`}
                                          >
                                            بديل مقترح
                                          </button>

                                          <label className="flex items-center gap-1 bg-white border border-slate-200 rounded-md px-1.5 h-7">
                                            <span className="text-slate-400">الكمية:</span>
                                            <input
                                              type="number"
                                              step="0.25"
                                              min={0.25}
                                              value={prod.default_qty}
                                              onChange={(e) =>
                                                setDraft((p) => ({
                                                  ...p,
                                                  groups: p.groups.map((g) =>
                                                    g.tempId !== grp.tempId
                                                      ? g
                                                      : {
                                                          ...g,
                                                          ingredients: g.ingredients.map((x) =>
                                                            x.tempId !== ing.tempId
                                                              ? x
                                                              : {
                                                                  ...x,
                                                                  products: x.products.map((pr) =>
                                                                    pr.product_id === prod.product_id
                                                                      ? {
                                                                          ...pr,
                                                                          default_qty: Number(e.target.value || 1),
                                                                        }
                                                                      : pr
                                                                  ),
                                                                }
                                                          ),
                                                        }
                                                  ),
                                                }))
                                              }
                                              className="w-11 text-center font-black text-slate-900 focus:outline-none tabular-nums"
                                            />
                                          </label>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDraft((p) => ({
                                                ...p,
                                                groups: p.groups.map((g) =>
                                                  g.tempId !== grp.tempId
                                                    ? g
                                                    : {
                                                        ...g,
                                                        ingredients: g.ingredients.map((x) =>
                                                          x.tempId !== ing.tempId
                                                            ? x
                                                            : {
                                                                ...x,
                                                                products: x.products.filter(
                                                                  (pr) => pr.product_id !== prod.product_id
                                                                ),
                                                              }
                                                        ),
                                                      }
                                                ),
                                              }))
                                            }
                                            className="w-7 h-7 rounded-md bg-white border border-slate-200 hover:text-rose-600 flex items-center justify-center cursor-pointer"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setDraft((p) => ({
                                ...p,
                                groups: p.groups.map((g, idx) =>
                                  idx !== gIdx
                                    ? g
                                    : {
                                        ...g,
                                        ingredients: [
                                          ...g.ingredients,
                                          {
                                            tempId: mkId(),
                                            name_ar: '',
                                            quantity: 1,
                                            unit_ar: 'عبوة',
                                            notes_ar: '',
                                            is_optional: false,
                                            products: [],
                                          },
                                        ],
                                      }
                                ),
                              }))
                            }
                            className="h-9 px-3.5 rounded-xl border border-dashed border-slate-300 hover:border-[#A92224] text-xs font-extrabold text-slate-700 hover:text-[#A92224] flex items-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>إضافة مكون جديد لهذه المجموعة</span>
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            groups: [
                              ...p.groups,
                              {
                                tempId: mkId(),
                                title_ar: `مجموعة مكونات ${p.groups.length + 1}`,
                                ingredients: [
                                  {
                                    tempId: mkId(),
                                    name_ar: '',
                                    quantity: 1,
                                    unit_ar: 'عبوة',
                                    notes_ar: '',
                                    is_optional: false,
                                    products: [],
                                  },
                                ],
                              },
                            ],
                          }))
                        }
                        className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة مجموعة مكونات جديدة</span>
                      </button>
                    </div>
                  )}

                  {/* TAB 3: COOKING STEPS & TIMERS */}
                  {editorTab === 'steps' && (
                    <div className="space-y-3">
                      {draft.steps.map((st, idx) => (
                        <div key={st.tempId} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-[#A92224]">الخطوة رقم {idx + 1}</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveStep(idx, -1)}
                                className="w-7 h-7 rounded-lg bg-white border border-slate-200 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                aria-label="تحريك لأعلى"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === draft.steps.length - 1}
                                onClick={() => moveStep(idx, 1)}
                                className="w-7 h-7 rounded-lg bg-white border border-slate-200 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                aria-label="تحريك لأسفل"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              {draft.steps.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft((p) => ({
                                      ...p,
                                      steps: p.steps.filter((x) => x.tempId !== st.tempId),
                                    }))
                                  }
                                  className="w-7 h-7 rounded-lg bg-white border border-rose-200 text-rose-600 flex items-center justify-center cursor-pointer"
                                  aria-label="حذف الخطوة"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <input
                            value={st.title_ar}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                steps: p.steps.map((x) => (x.tempId === st.tempId ? { ...x, title_ar: e.target.value } : x)),
                              }))
                            }
                            placeholder="عنوان الخطوة (مثال: سلق المكرونة)"
                            className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-extrabold"
                          />

                          <textarea
                            rows={2}
                            value={st.instruction_ar}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                steps: p.steps.map((x) =>
                                  x.tempId === st.tempId ? { ...x, instruction_ar: e.target.value } : x
                                ),
                              }))
                            }
                            placeholder="شرح تفصيلي واضح للخطوة..."
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                          />

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 h-9 text-xs font-bold">
                              <Timer className="w-3.5 h-3.5 text-[#A92224]" />
                              <span>دقائق المؤقت:</span>
                              <input
                                type="number"
                                min={0}
                                value={st.timer_minutes}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    steps: p.steps.map((x) =>
                                      x.tempId === st.tempId
                                        ? { ...x, timer_minutes: Math.max(0, Number(e.target.value || 0)) }
                                        : x
                                    ),
                                  }))
                                }
                                className="w-14 text-center font-black tabular-nums focus:outline-none"
                              />
                            </label>
                            <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 h-9 text-xs font-bold">
                              <span>ثوانٍ إضافية:</span>
                              <input
                                type="number"
                                min={0}
                                max={59}
                                value={st.timer_seconds_rem}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    steps: p.steps.map((x) =>
                                      x.tempId === st.tempId
                                        ? { ...x, timer_seconds_rem: Math.min(59, Math.max(0, Number(e.target.value || 0))) }
                                        : x
                                    ),
                                  }))
                                }
                                className="w-14 text-center font-black tabular-nums focus:outline-none"
                              />
                            </label>
                            <input
                              value={st.tip_ar}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  steps: p.steps.map((x) => (x.tempId === st.tempId ? { ...x, tip_ar: e.target.value } : x)),
                                }))
                              }
                              placeholder="نصيحة الشيف (اختياري)..."
                              className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                            />
                          </div>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            steps: [
                              ...p.steps,
                              {
                                tempId: mkId(),
                                title_ar: `الخطوة ${p.steps.length + 1}`,
                                instruction_ar: '',
                                timer_minutes: 0,
                                timer_seconds_rem: 0,
                                tip_ar: '',
                              },
                            ],
                          }))
                        }
                        className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة خطوة تحضير جديدة</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving || loadingDetail}
                onClick={handleSaveRecipe}
                className="h-10 px-6 rounded-xl bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-50 text-white text-xs font-black flex items-center gap-2 cursor-pointer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{editingId ? 'حفظ التعديلات' : 'نشر الوصفة'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REAL CATALOG PRODUCT PICKER MODAL */}
      {pickerTarget && (
        <div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-xl max-h-[82vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-black text-slate-900 truncate">
                  ربط منتج فعلي للمكون: {pickerTarget.ingName}
                </h4>
                <p className="text-[11px] text-slate-500 font-semibold">
                  ابحث في منتجات متاجر اطلبها الفعلية — لا يتم إنشاء منتجات مكررة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerTarget(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-[#A92224] absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="ابحث باسم المنتج أو الماركة أو اسم المتجر..."
                  className="w-full h-10 pr-9 pl-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold focus:border-[#A92224] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {pickerLoading ? (
                <div className="py-10 text-center text-xs text-slate-400 font-bold">جاري البحث في الكتالوج...</div>
              ) : pickerResults.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400 font-bold">
                  لا توجد منتجات مطابقة — جرّب كلمة بحث أخرى
                </div>
              ) : (
                pickerResults.map((p) => (
                  <div
                    key={p.product_id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition"
                  >
                    <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200/60 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name_ar}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain p-0.5"
                        />
                      ) : (
                        <ShoppingCart className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-black text-slate-900 truncate">{p.name_ar}</div>
                      <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1.5 flex-wrap tabular-nums">
                        <span className="inline-flex items-center gap-0.5">
                          <Store className="w-3 h-3" /> {p.merchant_name}
                        </span>
                        <span>·</span>
                        <span className="text-[#A92224] font-extrabold">{p.effective_price.toFixed(2)} ج.م</span>
                        {p.size_label && (
                          <>
                            <span>·</span>
                            <span>{p.size_label}</span>
                          </>
                        )}
                        {!p.is_available && <span className="text-rose-600 font-bold">· غير متوفر</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachProductToIngredient(p)}
                      className="h-8 px-3 rounded-lg bg-[#A92224] hover:bg-[#8E1B1D] text-white text-[11px] font-black shrink-0 cursor-pointer"
                    >
                      ربط
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
