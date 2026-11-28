import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Apple,
  ArrowDown,
  ArrowUp,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Fish,
  Flame,
  FolderTree,
  Home,
  LayoutGrid,
  Link2,
  Loader2,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  CategoryRecord,
  Language,
  MerchantRecord,
  PlatformMainCategory,
} from '../shared/types';

interface Props {
  lang: Language;
  merchants: MerchantRecord[];
  categories: CategoryRecord[];
  onNotify: (msg: string) => void;
}

const ICON_OPTIONS: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<any>;
}> = [
  { key: 'shopping_basket', label: 'سوبر ماركت', icon: ShoppingBasket },
  { key: 'meat', label: 'لحوم', icon: Flame },
  { key: 'produce', label: 'خضار وفاكهة', icon: Apple },
  { key: 'fish', label: 'أسماك', icon: Fish },
  { key: 'detergents', label: 'منظفات', icon: Sparkles },
  { key: 'electronics', label: 'إلكترونيات', icon: Smartphone },
  { key: 'perfumes', label: 'عطور', icon: Sparkles },
  { key: 'restaurants', label: 'مطاعم', icon: UtensilsCrossed },
  { key: 'home', label: 'أدوات منزلية', icon: Home },
  { key: 'clothing', label: 'ملابس', icon: Shirt },
  { key: 'general', label: 'عام', icon: LayoutGrid },
];

const ACCENT_PRESETS = [
  '#A92224',
  '#B91C1C',
  '#047857',
  '#0284C7',
  '#4F46E5',
  '#1D4ED8',
  '#9333EA',
  '#EA580C',
  '#0D9488',
  '#DB2777',
  '#475569',
];

function getIconComponent(iconKey: string): React.ComponentType<any> {
  return ICON_OPTIONS.find((i) => i.key === iconKey)?.icon || LayoutGrid;
}

export const AdminMainCategoriesSection: React.FC<Props> = ({
  merchants,
  categories,
  onNotify,
}) => {
  const [loading, setLoading] = useState(true);
  const [mainCategories, setMainCategories] = useState<PlatformMainCategory[]>([]);
  const [summary, setSummary] = useState({
    total_main_categories: 0,
    active_main_categories: 0,
    total_products: 0,
    assigned_products: 0,
    unassigned_in_general: 0,
    total_merchants: 0,
    total_internal_categories: 0,
  });

  const [selectedId, setSelectedId] = useState<string>('');
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksSubTab, setLinksSubTab] = useState<'merchants' | 'internal' | 'products'>('merchants');
  const [linksData, setLinksData] = useState<Awaited<
    ReturnType<typeof api.adminGetMainCategoryLinks>
  > | null>(null);

  // Create / Edit Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<PlatformMainCategory | null>(null);
  const [formNameAr, setFormNameAr] = useState('');
  const [formNameEn, setFormNameEn] = useState('');
  const [formDescAr, setFormDescAr] = useState('');
  const [formIconKey, setFormIconKey] = useState('general');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formAccentColor, setFormAccentColor] = useState('#A92224');
  const [formActive, setFormActive] = useState(true);
  const [savingForm, setSavingForm] = useState(false);

  // Merchant Link Form
  const [linkMerchantId, setLinkMerchantId] = useState('');
  const [linkIncludeAll, setLinkIncludeAll] = useState(true);
  const [savingLink, setSavingLink] = useState(false);

  // Internal Category Link Form
  const [catLinkMerchantId, setCatLinkMerchantId] = useState('');
  const [catLinkInternalId, setCatLinkInternalId] = useState('');
  const [catLinkDescendants, setCatLinkDescendants] = useState(true);
  const [catLinkType, setCatLinkType] = useState<'include' | 'exclude'>('include');
  const [catSearchQuery, setCatSearchQuery] = useState('');

  // Multi-Category Products Tab
  const [prodQuery, setProdQuery] = useState('');
  const [prodMerchantFilter, setProdMerchantFilter] = useState('');
  const [prodCategoryFilter, setProdCategoryFilter] = useState('');
  const [prodUnassignedOnly, setProdUnassignedOnly] = useState(false);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodResults, setProdResults] = useState<
    Awaited<ReturnType<typeof api.adminSearchMainCategoryProducts>>['products']
  >([]);
  const [prodTotal, setProdTotal] = useState(0);
  const [selectedProdIds, setSelectedProdIds] = useState<string[]>([]);
  const [savingProdId, setSavingProdId] = useState<string | null>(null);

  const approvedMerchants = useMemo(
    () => merchants.filter((m) => m.verification_status === 'approved'),
    [merchants]
  );

  const loadMainCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminGetMainCategories();
      setMainCategories(res.main_categories || []);
      if (res.summary) setSummary(res.summary);
      setSelectedId((prev) => {
        if (prev && res.main_categories.some((c) => c.id === prev)) return prev;
        return res.main_categories[0]?.id || '';
      });
    } catch (err: any) {
      onNotify(err?.message || 'تعذر تحميل الأقسام الرئيسية');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  const loadSelectedLinks = useCallback(
    async (mcId: string) => {
      if (!mcId) {
        setLinksData(null);
        return;
      }
      setLinksLoading(true);
      try {
        const res = await api.adminGetMainCategoryLinks(mcId);
        setLinksData(res);
      } catch (err: any) {
        onNotify(err?.message || 'تعذر تحميل روابط القسم');
      } finally {
        setLinksLoading(false);
      }
    },
    [onNotify]
  );

  const searchCatalogProducts = useCallback(async () => {
    setProdLoading(true);
    try {
      const res = await api.adminSearchMainCategoryProducts({
        q: prodQuery,
        merchant_id: prodMerchantFilter || undefined,
        category_id: prodCategoryFilter || undefined,
        unassigned_only: prodUnassignedOnly,
        limit: 50,
      });
      setProdResults(res.products || []);
      setProdTotal(res.total || 0);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر البحث في المنتجات');
    } finally {
      setProdLoading(false);
    }
  }, [prodQuery, prodMerchantFilter, prodCategoryFilter, prodUnassignedOnly, onNotify]);

  useEffect(() => {
    void loadMainCategories();
  }, [loadMainCategories]);

  useEffect(() => {
    if (selectedId) void loadSelectedLinks(selectedId);
  }, [selectedId, loadSelectedLinks]);

  useEffect(() => {
    if (linksSubTab === 'products') {
      void searchCatalogProducts();
    }
  }, [linksSubTab, searchCatalogProducts]);

  const selectedCategory = useMemo(
    () => mainCategories.find((c) => c.id === selectedId) || null,
    [mainCategories, selectedId]
  );

  const filteredInternalCategories = useMemo(() => {
    const q = catSearchQuery.trim().toLowerCase();
    return categories.filter((c) => {
      if (catLinkMerchantId && c.merchant_id && c.merchant_id !== catLinkMerchantId) return false;
      if (!q) return true;
      const hay = `${c.name_ar} ${c.name_en || ''} ${c.full_path_ar || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [categories, catLinkMerchantId, catSearchQuery]);

  const openCreateModal = () => {
    setEditingCat(null);
    setFormNameAr('');
    setFormNameEn('');
    setFormDescAr('');
    setFormIconKey('general');
    setFormImageUrl('');
    setFormAccentColor('#A92224');
    setFormActive(true);
    setEditorOpen(true);
  };

  const openEditModal = (cat: PlatformMainCategory) => {
    setEditingCat(cat);
    setFormNameAr(cat.name_ar);
    setFormNameEn(cat.name_en || '');
    setFormDescAr(cat.description_ar || '');
    setFormIconKey(cat.icon_key || 'general');
    setFormImageUrl(cat.image_url || '');
    setFormAccentColor(cat.accent_color || '#A92224');
    setFormActive(cat.is_active);
    setEditorOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNameAr.trim()) {
      onNotify('يرجى إدخال اسم القسم بالعربية');
      return;
    }
    setSavingForm(true);
    try {
      if (editingCat) {
        await api.adminUpdateMainCategory(editingCat.id, {
          name_ar: formNameAr.trim(),
          name_en: formNameEn.trim(),
          description_ar: formDescAr.trim(),
          icon_key: formIconKey,
          image_url: formImageUrl.trim(),
          accent_color: formAccentColor,
          is_active: formActive,
        });
        onNotify(`تم تحديث القسم الرئيسي «${formNameAr.trim()}»`);
      } else {
        const res = await api.adminCreateMainCategory({
          name_ar: formNameAr.trim(),
          name_en: formNameEn.trim(),
          description_ar: formDescAr.trim(),
          icon_key: formIconKey,
          image_url: formImageUrl.trim(),
          accent_color: formAccentColor,
          is_active: formActive,
        });
        setSelectedId(res.main_category.id);
        onNotify(`تم إنشاء القسم الرئيسي «${formNameAr.trim()}»`);
      }
      setEditorOpen(false);
      await loadMainCategories();
    } catch (err: any) {
      onNotify(err?.message || 'تعذر حفظ القسم الرئيسي');
    } finally {
      setSavingForm(false);
    }
  };

  const handleToggleActive = async (cat: PlatformMainCategory) => {
    try {
      await api.adminUpdateMainCategory(cat.id, { is_active: !cat.is_active });
      onNotify(cat.is_active ? `تم إخفاء «${cat.name_ar}» من واجهة العميل` : `تم إظهار «${cat.name_ar}»`);
      await loadMainCategories();
    } catch (err: any) {
      onNotify(err?.message || 'تعذر تغيير حالة القسم');
    }
  };

  const handleDelete = async (cat: PlatformMainCategory) => {
    if (cat.is_general) {
      onNotify('لا يمكن حذف قسم «العام» لأنه القسم الافتراضي');
      return;
    }
    try {
      await api.adminDeleteMainCategory(cat.id);
      onNotify(`تم حذف القسم الرئيسي «${cat.name_ar}» (مع الحفاظ التام على جميع المنتجات والمتاجر)`);
      await loadMainCategories();
    } catch (err: any) {
      onNotify(err?.message || 'تعذر حذف القسم الرئيسي');
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= mainCategories.length) return;
    const next = [...mainCategories];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setMainCategories(next);
    try {
      await api.adminReorderMainCategories(next.map((c) => c.id));
      onNotify('تم حفظ الترتيب الجديد للأقسام الرئيسية');
      await loadMainCategories();
    } catch (err: any) {
      onNotify(err?.message || 'تعذر إعادة الترتيب');
      await loadMainCategories();
    }
  };

  const handleLinkMerchant = async () => {
    if (!selectedId || !linkMerchantId) return;
    setSavingLink(true);
    try {
      await api.adminLinkMerchantToMainCategory(selectedId, {
        merchant_id: linkMerchantId,
        include_all_categories: linkIncludeAll,
      });
      setLinkMerchantId('');
      onNotify('تم ربط المتجر بالقسم الرئيسي بنجاح');
      await Promise.all([loadSelectedLinks(selectedId), loadMainCategories()]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر ربط المتجر');
    } finally {
      setSavingLink(false);
    }
  };

  const handleUnlinkMerchant = async (merchantId: string) => {
    if (!selectedId) return;
    try {
      await api.adminUnlinkMerchantFromMainCategory(selectedId, merchantId);
      onNotify('تم فك ربط المتجر من هذا القسم الرئيسي');
      await Promise.all([loadSelectedLinks(selectedId), loadMainCategories()]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر إلغاء ربط المتجر');
    }
  };

  const handleLinkInternalCategory = async () => {
    if (!selectedId || !catLinkInternalId) return;
    setSavingLink(true);
    try {
      await api.adminLinkInternalCategoryToMainCategory(selectedId, {
        internal_category_id: catLinkInternalId,
        merchant_id: catLinkMerchantId,
        include_descendants: catLinkDescendants,
        link_type: catLinkType,
      });
      setCatLinkInternalId('');
      onNotify(
        catLinkType === 'exclude'
          ? 'تم استثناء القسم الفرعي من هذا القسم الرئيسي'
          : 'تم ربط القسم الداخلي (وفروعه) بالقسم الرئيسي بنجاح'
      );
      await Promise.all([loadSelectedLinks(selectedId), loadMainCategories()]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر ربط القسم الداخلي');
    } finally {
      setSavingLink(false);
    }
  };

  const handleUnlinkInternalCategory = async (linkId: string) => {
    if (!selectedId) return;
    try {
      await api.adminUnlinkInternalCategoryFromMainCategory(selectedId, linkId);
      onNotify('تم إزالة رابط القسم الداخلي');
      await Promise.all([loadSelectedLinks(selectedId), loadMainCategories()]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر إزالة الرابط');
    }
  };

  const handleBulkAssignSelectedProducts = async () => {
    if (!selectedId || selectedProdIds.length === 0) return;
    setSavingLink(true);
    try {
      await api.adminUpdateMainCategoryProductLinks(selectedId, {
        product_ids: selectedProdIds,
        action: 'add',
      });
      setSelectedProdIds([]);
      onNotify(`تم ربط ${selectedProdIds.length} منتج بالقسم «${selectedCategory?.name_ar}» بدون تكرار`);
      await Promise.all([
        loadSelectedLinks(selectedId),
        loadMainCategories(),
        searchCatalogProducts(),
      ]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر ربط المنتجات');
    } finally {
      setSavingLink(false);
    }
  };

  const handleToggleProductMainCat = async (
    productId: string,
    currentDirectIds: string[],
    targetMcId: string
  ) => {
    setSavingProdId(productId);
    const exists = currentDirectIds.includes(targetMcId);
    const nextIds = exists
      ? currentDirectIds.filter((id) => id !== targetMcId)
      : [...currentDirectIds, targetMcId];
    try {
      await api.adminSetProductMainCategories(productId, nextIds);
      await Promise.all([
        searchCatalogProducts(),
        loadMainCategories(),
        selectedId ? loadSelectedLinks(selectedId) : Promise.resolve(),
      ]);
    } catch (err: any) {
      onNotify(err?.message || 'تعذر تحديث أقسام المنتج');
    } finally {
      setSavingProdId(null);
    }
  };

  const nonGeneralCategories = useMemo(
    () => mainCategories.filter((c) => !c.is_general),
    [mainCategories]
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header + Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-[#A92224]" />
            <span>الأقسام الرئيسية وربط أقسام المتاجر</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            تحكم كامل في الأقسام الرئيسية للمنصة وربطها بأقسام المتاجر الداخلية والمنتجات متعددة الأقسام بدون تكرار أو تعديل لبيانات المتاجر الحالية.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadMainCategories();
              if (selectedId) void loadSelectedLinks(selectedId);
            }}
            className="h-10 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="h-10 px-4 rounded-xl bg-[#A92224] hover:bg-[#8A1B1D] text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة قسم رئيسي</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">الأقسام الرئيسية</div>
          <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
            {summary.active_main_categories}
            <span className="text-xs font-bold text-slate-400 mr-1">/ {summary.total_main_categories}</span>
          </div>
          <div className="text-[11px] text-emerald-600 font-bold mt-0.5">نشط في تطبيق العميل</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">إجمالي المنتجات الحالية</div>
          <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
            {summary.total_products.toLocaleString('ar-EG')}
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-0.5">
            عبر {summary.total_merchants} متجر معتمد
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500">منتجات موزعة على الأقسام</div>
          <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
            {summary.assigned_products.toLocaleString('ar-EG')}
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-0.5">مرتبطة بأقسام رئيسية محددة</div>
        </div>
        <div className="bg-white rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4">
          <div className="text-xs font-bold text-amber-800">في قسم «العام» حالياً</div>
          <div className="text-2xl font-black text-amber-900 mt-1 tabular-nums">
            {summary.unassigned_in_general.toLocaleString('ar-EG')}
          </div>
          <div className="text-[11px] text-amber-700 font-semibold mt-0.5">محفوظة كما هي وجاهزة للتوزيع</div>
        </div>
      </div>

      {/* Main Two-Column Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Right Column (RTL): Platform Main Categories List */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-black text-slate-900">قائمة الأقسام الرئيسية</span>
            <span className="text-[11px] font-bold text-slate-500">استخدم الأسهم لإعادة الترتيب</span>
          </div>

          {loading ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-[#A92224]" />
              <span>جاري التحميل...</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {mainCategories.map((cat, idx) => {
                const Icon = getIconComponent(cat.icon_key);
                const isSelected = cat.id === selectedId;
                return (
                  <div
                    key={cat.id}
                    onClick={() => setSelectedId(cat.id)}
                    className={`p-3.5 flex items-center gap-3 transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#FEF2F2]/80 border-r-4 border-r-[#A92224]'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-slate-200/70"
                      style={{
                        backgroundColor: `${cat.accent_color || '#A92224'}14`,
                        color: cat.accent_color || '#A92224',
                      }}
                    >
                      {cat.image_url ? (
                        <img
                          src={cat.image_url}
                          alt={cat.name_ar}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-black text-slate-900 truncate">
                          {cat.name_ar}
                        </span>
                        {cat.is_general && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold bg-slate-800 text-white px-2 py-0.5 rounded-md">
                            <Lock className="w-2.5 h-2.5" />
                            افتراضي
                          </span>
                        )}
                        {!cat.is_active && (
                          <span className="text-[10px] font-extrabold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md">
                            مخفي
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-bold text-slate-500 mt-1 tabular-nums">
                        <span>{cat.merchants_count} متجر</span>
                        <span>·</span>
                        <span>{cat.products_count.toLocaleString('ar-EG')} منتج</span>
                        {cat.internal_links_count ? (
                          <>
                            <span>·</span>
                            <span className="text-[#A92224]">{cat.internal_links_count} ربط قسم</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleMove(idx, -1)}
                        title="تحريك لأعلى"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center text-slate-700 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === mainCategories.length - 1}
                        onClick={() => void handleMove(idx, 1)}
                        title="تحريك لأسفل"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center text-slate-700 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(cat)}
                        title={cat.is_active ? 'إخفاء القسم' : 'إظهار القسم'}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer ${
                          cat.is_active
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                        }`}
                      >
                        {cat.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(cat)}
                        title="تعديل"
                        className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center justify-center cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {!cat.is_general && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(cat)}
                          title="حذف"
                          className="w-7 h-7 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Left Column (RTL): Link Management for Selected Main Category */}
        <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {!selectedCategory ? (
            <div className="p-10 text-center text-sm text-slate-500">
              اختر قسماً رئيسياً من القائمة لإدارة المتاجر والأقسام الداخلية والمنتجات المرتبطة به.
            </div>
          ) : (
            <div>
              {/* Selected Header */}
              <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900">
                      إدارة روابط: {selectedCategory.name_ar}
                    </h3>
                    {selectedCategory.is_general && (
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                        يحتوي تلقائياً كل منتج وقسم غير موزع
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {linksData
                      ? `${linksData.resolved_merchants_count} متجر مرتبط فعلياً · ${linksData.resolved_products_count.toLocaleString('ar-EG')} منتج يظهر للعميل في هذا القسم`
                      : selectedCategory.description_ar}
                  </p>
                </div>

                {/* Sub-tabs */}
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
                  {[
                    { key: 'merchants' as const, label: 'ربط المتاجر', icon: Store },
                    { key: 'internal' as const, label: 'الأقسام الداخلية', icon: FolderTree },
                    { key: 'products' as const, label: 'المنتجات المتعددة', icon: Package },
                  ].map((t) => {
                    const TabIcon = t.icon;
                    const active = linksSubTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setLinksSubTab(t.key)}
                        className={`h-8 px-3 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer ${
                          active
                            ? 'bg-[#A92224] text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <TabIcon className="w-3.5 h-3.5" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {linksLoading && linksSubTab !== 'products' ? (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin text-[#A92224]" />
                  <span>جاري تحميل الروابط...</span>
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  {/* SUB-TAB 1: Whole Merchant Linking */}
                  {linksSubTab === 'merchants' && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                          <Link2 className="w-4 h-4 text-[#A92224]" />
                          <span>ربط متجر كامل بقسم «{selectedCategory.name_ar}»</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          مثال: ربط متجر «عمر علوي» بقسم «السوبر ماركت» مع تفعيل «تضمين كل أقسام المتجر» يعرض جميع أقسامه الداخلية عند الدخول من السوبر ماركت، بينما عند ربط قسم «اللحوم» فقط من تبويب الأقسام الداخلية سيظهر قسم اللحوم فقط عند الدخول من اللحوم.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                          <select
                            value={linkMerchantId}
                            onChange={(e) => setLinkMerchantId(e.target.value)}
                            className="md:col-span-6 h-10 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800"
                          >
                            <option value="">اختر متجراً معتمداً...</option>
                            {approvedMerchants.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.business_name_ar} ({m.is_open_now ? 'مفتوح' : 'مغلق'})
                              </option>
                            ))}
                          </select>

                          <label className="md:col-span-4 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={linkIncludeAll}
                              onChange={(e) => setLinkIncludeAll(e.target.checked)}
                              className="w-4 h-4 accent-[#A92224]"
                            />
                            <span>تضمين كل أقسام المتجر</span>
                          </label>

                          <button
                            type="button"
                            disabled={!linkMerchantId || savingLink}
                            onClick={() => void handleLinkMerchant()}
                            className="md:col-span-2 h-10 rounded-xl bg-[#A92224] hover:bg-[#8A1B1D] disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer"
                          >
                            ربط
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-black text-slate-700">
                          المتاجر المرتبطة مباشرة ({linksData?.merchant_links.length || 0})
                        </div>
                        {!linksData || linksData.merchant_links.length === 0 ? (
                          <div className="p-6 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                            لا توجد متاجر مرتبطة بالكامل بهذا القسم بعد. يمكنك ربط متجر أعلاه أو ربط أقسام داخلية محددة.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {linksData.merchant_links.map((ml) => (
                              <div
                                key={ml.id}
                                className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-9 h-9 rounded-xl bg-[#FEF2F2] text-[#A92224] overflow-hidden flex items-center justify-center shrink-0">
                                    {ml.merchant_image ? (
                                      <img
                                        src={ml.merchant_image}
                                        alt={ml.merchant_name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <Store className="w-4 h-4" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-black text-slate-900 truncate">
                                      {ml.merchant_name}
                                    </div>
                                    <div className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
                                      <span className={ml.merchant_is_open ? 'text-emerald-600' : 'text-slate-400'}>
                                        {ml.merchant_is_open ? 'مفتوح الآن' : 'مغلق'}
                                      </span>
                                      <span>·</span>
                                      <span>
                                        {ml.include_all_categories
                                          ? 'يشمل كل أقسام المتجر الداخلية'
                                          : 'الأقسام المربوطة يدوياً فقط'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleUnlinkMerchant(ml.merchant_id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer shrink-0"
                                >
                                  فك الربط
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 2: Internal Store Category Linking (with descendant inheritance & exclusion) */}
                  {linksSubTab === 'internal' && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                          <FolderTree className="w-4 h-4 text-[#A92224]" />
                          <span>ربط قسم داخلي (رئيسي / فرعي / فرعي من فرعي) بقسم «{selectedCategory.name_ar}»</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          عند ربط أي قسم داخلي مع تفعيل «تضمين الفروع تلقائياً»، يتم ربط جميع أقسامه الفرعية والفرعية من الفرعية ومنتجاتها تلقائياً مع إمكانية استثناء أي قسم فرعي محدد.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <select
                            value={catLinkMerchantId}
                            onChange={(e) => setCatLinkMerchantId(e.target.value)}
                            className="h-10 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800"
                          >
                            <option value="">نطاق المتجر: كل المتاجر (عام)</option>
                            {approvedMerchants.map((m) => (
                              <option key={m.id} value={m.id}>
                                متجر محدد: {m.business_name_ar}
                              </option>
                            ))}
                          </select>

                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={catSearchQuery}
                              onChange={(e) => setCatSearchQuery(e.target.value)}
                              placeholder="ابحث داخل الأقسام الداخلية..."
                              className="w-full h-10 pr-8 pl-3 rounded-xl bg-white border border-slate-300 text-xs font-semibold"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                          <select
                            value={catLinkInternalId}
                            onChange={(e) => setCatLinkInternalId(e.target.value)}
                            className="md:col-span-7 h-10 px-3 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800"
                          >
                            <option value="">اختر القسم الداخلي...</option>
                            {filteredInternalCategories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_path_ar ? c.full_path_ar.replace(/;$/, '') : c.name_ar}
                              </option>
                            ))}
                          </select>

                          <select
                            value={catLinkType}
                            onChange={(e) => setCatLinkType(e.target.value as 'include' | 'exclude')}
                            className="md:col-span-3 h-10 px-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800"
                          >
                            <option value="include">تضمين (ربط)</option>
                            <option value="exclude">استثناء قسم فرعي</option>
                          </select>

                          <button
                            type="button"
                            disabled={!catLinkInternalId || savingLink}
                            onClick={() => void handleLinkInternalCategory()}
                            className="md:col-span-2 h-10 rounded-xl bg-[#A92224] hover:bg-[#8A1B1D] disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer"
                          >
                            حفظ الربط
                          </button>
                        </div>

                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={catLinkDescendants}
                            onChange={(e) => setCatLinkDescendants(e.target.checked)}
                            className="w-4 h-4 accent-[#A92224]"
                          />
                          <span>تضمين جميع الأقسام الفرعية والفرعية من الفرعية تلقائياً</span>
                        </label>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-black text-slate-700">
                          الأقسام الداخلية المرتبطة / المستثناة ({linksData?.internal_links.length || 0})
                        </div>
                        {!linksData || linksData.internal_links.length === 0 ? (
                          <div className="p-6 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                            لم يتم ربط أقسام داخلية محددة بهذا القسم الرئيسي بعد.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {linksData.internal_links.map((il) => (
                              <div
                                key={il.id}
                                className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                                  il.link_type === 'exclude'
                                    ? 'border-amber-200 bg-amber-50/50'
                                    : 'border-slate-200 bg-white'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                                        il.link_type === 'exclude'
                                          ? 'bg-amber-200 text-amber-900'
                                          : 'bg-emerald-100 text-emerald-800'
                                      }`}
                                    >
                                      {il.link_type === 'exclude' ? 'استثناء' : 'تضمين'}
                                    </span>
                                    <span className="text-xs font-black text-slate-900">
                                      {il.category_full_path_ar
                                        ? il.category_full_path_ar.replace(/;$/, '')
                                        : il.category_name_ar}
                                    </span>
                                  </div>
                                  <div className="text-[11px] font-semibold text-slate-500 mt-1 flex items-center gap-2">
                                    <span>النطاق: {il.merchant_name}</span>
                                    <span>·</span>
                                    <span>
                                      {il.include_descendants
                                        ? 'يشمل كل الفروع التابعة تلقائياً'
                                        : 'هذا المستوى فقط'}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleUnlinkInternalCategory(il.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer shrink-0"
                                >
                                  إزالة
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 3: Multi-Category Products (Zero Duplication) */}
                  {linksSubTab === 'products' && (
                    <div className="space-y-3.5">
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                        <div className="text-xs font-black text-slate-800">
                          توزيع المنتجات وربط نفس المنتج بأكثر من قسم رئيسي (بدون تكرار)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={prodQuery}
                              onChange={(e) => setProdQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void searchCatalogProducts();
                              }}
                              placeholder="ابحث باسم المنتج أو الباركود..."
                              className="w-full h-9 pr-8 pl-3 rounded-xl bg-white border border-slate-300 text-xs font-semibold"
                            />
                          </div>
                          <select
                            value={prodMerchantFilter}
                            onChange={(e) => setProdMerchantFilter(e.target.value)}
                            className="h-9 px-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold"
                          >
                            <option value="">كل المتاجر</option>
                            {approvedMerchants.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.business_name_ar}
                              </option>
                            ))}
                          </select>
                          <select
                            value={prodCategoryFilter}
                            onChange={(e) => setProdCategoryFilter(e.target.value)}
                            className="h-9 px-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold"
                          >
                            <option value="">كل الأقسام الداخلية</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_path_ar ? c.full_path_ar.replace(/;$/, '') : c.name_ar}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={prodUnassignedOnly}
                              onChange={(e) => setProdUnassignedOnly(e.target.checked)}
                              className="w-4 h-4 accent-[#A92224]"
                            />
                            <span>عرض المنتجات الموجودة في «العام» فقط</span>
                          </label>

                          <div className="flex items-center gap-2">
                            {selectedProdIds.length > 0 && !selectedCategory.is_general && (
                              <button
                                type="button"
                                disabled={savingLink}
                                onClick={() => void handleBulkAssignSelectedProducts()}
                                className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                              >
                                ربط المحدد ({selectedProdIds.length}) بـ «{selectedCategory.name_ar}»
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void searchCatalogProducts()}
                              className="h-8 px-3 rounded-lg bg-slate-800 text-white text-xs font-bold cursor-pointer"
                            >
                              بحث ({prodTotal})
                            </button>
                          </div>
                        </div>
                      </div>

                      {prodLoading ? (
                        <div className="p-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                          <Loader2 className="w-4 h-4 animate-spin text-[#A92224]" />
                          <span>جاري تحميل المنتجات...</span>
                        </div>
                      ) : prodResults.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                          لا توجد منتجات مطابقة للبحث الحالي.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[460px] overflow-y-auto pl-1">
                          {prodResults.map((p) => {
                            const checked = selectedProdIds.includes(p.id);
                            return (
                              <div
                                key={p.id}
                                className="p-3 rounded-xl border border-slate-200 hover:border-slate-300 space-y-2"
                              >
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setSelectedProdIds((prev) =>
                                        e.target.checked
                                          ? [...prev, p.id]
                                          : prev.filter((id) => id !== p.id)
                                      );
                                    }}
                                    className="w-4 h-4 accent-[#A92224] shrink-0"
                                  />
                                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                    {p.image_url ? (
                                      <img
                                        src={p.image_url}
                                        alt={p.name_ar}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <Package className="w-4 h-4 text-slate-400" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-black text-slate-900 truncate">
                                      {p.name_ar}
                                    </div>
                                    <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[#A92224] font-bold">{p.merchant_name}</span>
                                      {p.category_name && (
                                        <>
                                          <span>·</span>
                                          <span>{p.category_name}</span>
                                        </>
                                      )}
                                      <span>·</span>
                                      <span className="tabular-nums font-bold text-slate-700">
                                        {Number(p.sale_price ?? p.base_price).toLocaleString('ar-EG')} ج.م
                                      </span>
                                      {p.in_general_only && (
                                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                                          في العام
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Direct multi-category chips */}
                                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                                  <span className="text-[10px] font-bold text-slate-400 ml-1">
                                    الأقسام الرئيسية:
                                  </span>
                                  {nonGeneralCategories.map((mc) => {
                                    const isDirect = p.direct_main_category_ids.includes(mc.id);
                                    const isResolved = p.resolved_main_category_ids.includes(mc.id);
                                    return (
                                      <button
                                        key={mc.id}
                                        type="button"
                                        disabled={savingProdId === p.id}
                                        onClick={() =>
                                          void handleToggleProductMainCat(
                                            p.id,
                                            p.direct_main_category_ids,
                                            mc.id
                                          )
                                        }
                                        className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 border transition cursor-pointer ${
                                          isDirect
                                            ? 'bg-[#A92224] text-white border-[#A92224]'
                                            : isResolved
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-[#A92224]/40'
                                        }`}
                                        title={
                                          isDirect
                                            ? 'ربط مباشر (اضغط للإلغاء)'
                                            : isResolved
                                            ? 'مرتبط تلقائياً عبر المتجر أو القسم الداخلي'
                                            : 'اضغط لربط المنتج بهذا القسم أيضاً'
                                        }
                                      >
                                        {(isDirect || isResolved) && <Check className="w-2.5 h-2.5" />}
                                        <span>{mc.name_ar}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Safety Notice */}
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-2.5 text-xs text-emerald-900">
        <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
        <p className="leading-relaxed font-semibold">
          حماية البيانات: جميع عمليات الربط والتوزيع وتعدد الأقسام تعمل عبر جداول ربط مستقلة ولا تعدّل أو تحذف أو تكرر أي منتج أو قسم داخلي أو متجر في قاعدة البيانات الأصلية.
        </p>
      </div>

      {/* Create / Edit Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveForm}
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                {editingCat ? `تعديل القسم الرئيسي: ${editingCat.name_ar}` : 'إضافة قسم رئيسي جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالعربية *
                  </label>
                  <input
                    type="text"
                    required
                    value={formNameAr}
                    onChange={(e) => setFormNameAr(e.target.value)}
                    placeholder="مثال: السوبر ماركت"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالإنجليزية
                  </label>
                  <input
                    type="text"
                    value={formNameEn}
                    onChange={(e) => setFormNameEn(e.target.value)}
                    placeholder="Supermarket"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">وصف مختصر</label>
                <input
                  type="text"
                  value={formDescAr}
                  onChange={(e) => setFormDescAr(e.target.value)}
                  placeholder="وصف يظهر أسفل اسم القسم..."
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  رابط صورة مخصصة (اختياري)
                </label>
                <input
                  type="text"
                  value={formImageUrl}
                  onChange={(e) => setFormImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الأيقونة</label>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {ICON_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = formIconKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setFormIconKey(opt.key)}
                        className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-[10px] font-bold cursor-pointer ${
                          active
                            ? 'border-[#A92224] bg-[#FEF2F2] text-[#A92224]'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="truncate w-full text-center">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اللون المميز</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {ACCENT_PRESETS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setFormAccentColor(hex)}
                      className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                        formAccentColor === hex ? 'border-slate-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-4 h-4 accent-[#A92224]"
                />
                <span>إظهار القسم في تطبيق العميل</span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="h-9 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingForm}
                className="h-9 px-5 rounded-xl bg-[#A92224] hover:bg-[#8A1B1D] disabled:opacity-50 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {savingForm && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{editingCat ? 'حفظ التعديلات' : 'إنشاء القسم'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
