import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderTree,
  Gift,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  PackagePlus,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  downloadMasterProductsExcelTemplate,
  parseMasterSpreadsheetWithMeta,
  rebuildRowsWithCategoryColumns,
  type ParsedMasterExcelRow,
  type ParsedMasterSpreadsheetResult,
} from '../lib/masterExcelParser';
import { CategoryPathPicker } from './CategoryPathPicker';
import type {
  CategoryRecord,
  MasterProductMatchCandidate,
  ProductMatchingRequestRecord,
  ProductRecord,
} from '../shared/types';

interface Props {
  merchantId: string;
  categories: CategoryRecord[];
  merchantProducts: ProductRecord[];
  initialSubTab?: 'excel' | 'match' | 'requests' | 'deals';
  onRefresh: () => void;
  onToast: (msg: string) => void;
}

type ExcelPreviewData = Awaited<ReturnType<typeof api.previewMerchantExcelMasterCatalog>>;

const formatCategoryDisplay = (raw?: string | null) => {
  const clean = String(raw || '')
    .replace(/;+\s*$/g, '')
    .trim();
  return clean || 'عام';
};

export const MerchantMasterLinkPanel: React.FC<Props> = ({
  merchantId,
  categories,
  merchantProducts,
  initialSubTab = 'excel',
  onRefresh,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<'excel' | 'match' | 'requests' | 'deals'>(initialSubTab);

  // Excel upload & enrichment state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [excelFileName, setExcelFileName] = useState('');
  const [excelMeta, setExcelMeta] = useState<ParsedMasterSpreadsheetResult | null>(null);
  const [selectedExcelCatCols, setSelectedExcelCatCols] = useState<number[]>([]);
  const [parsedExcelRows, setParsedExcelRows] = useState<ParsedMasterExcelRow[]>([]);
  const [defaultCategoryPath, setDefaultCategoryPath] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState('');
  const [excelPreview, setExcelPreview] = useState<ExcelPreviewData | null>(null);
  const [excelPreviewing, setExcelPreviewing] = useState(false);
  const [excelSubmitting, setExcelSubmitting] = useState(false);
  const [excelProgressText, setExcelProgressText] = useState('');
  const [selectedPreviewCategory, setSelectedPreviewCategory] = useState<string>('ALL');

  // Smart matching search state
  const [queryName, setQueryName] = useState('');
  const [queryBrand, setQueryBrand] = useState('');
  const [querySize, setQuerySize] = useState('');
  const [queryBarcode, setQueryBarcode] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<{
    match_status: 'exact' | 'possible' | 'none';
    exact_match: MasterProductMatchCandidate | null;
    candidates: MasterProductMatchCandidate[];
    size_conflict_warning?: string | null;
  } | null>(null);

  // Selected master for linking
  const [selectedMaster, setSelectedMaster] = useState<MasterProductMatchCandidate | null>(null);
  const [linkForm, setLinkForm] = useState({
    base_price: '',
    sale_price: '',
    stock_quantity: '20',
    min_order_qty: '1',
    merchant_sku: '',
    category_id: '',
  });
  const [savingLink, setSavingLink] = useState(false);

  // Request new product form (when not found)
  const [reqForm, setReqForm] = useState({
    category_id: 'cat_grocery',
    category_path: '',
    proposed_price: '',
    proposed_stock: '15',
    image_url: '',
    description: '',
  });
  const [myRequests, setMyRequests] = useState<ProductMatchingRequestRecord[]>([]);

  // Deals state
  const [deals, setDeals] = useState<any[]>([]);
  const [dealForm, setDealForm] = useState({
    product_id: '',
    deal_type: 'free_gift' as 'buy_x_get_y' | 'bundle_discount' | 'free_gift' | 'tier_qty' | 'free_delivery',
    title_ar: '',
    subtitle_ar: '',
    required_qty: '1',
    free_qty: '1',
    discount_amount: '0',
    discount_percent: '0',
    gift_product_id: '',
  });

  const loadMyRequests = async () => {
    try {
      const rows = await api.getMerchantMatchingRequests(merchantId);
      setMyRequests(rows || []);
    } catch {
      // ignore
    }
  };

  const loadDeals = async () => {
    try {
      const rows = await api.getProductDeals({ merchant_id: merchantId });
      setDeals(rows || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadMyRequests();
  }, [merchantId]);

  useEffect(() => {
    if (subTab === 'requests') void loadMyRequests();
    if (subTab === 'deals') void loadDeals();
  }, [subTab, merchantId]);

  const runExcelPreview = async (rows: ParsedMasterExcelRow[], fallbackCategoryPath: string) => {
    if (rows.length === 0) return;
    setExcelPreviewing(true);
    setSelectedPreviewCategory('ALL');
    setExcelProgressText('جاري مطابقة الملف مع الكتالوج المركزي واستكمال الأقسام والصور...');
    try {
      const CHUNK_SIZE = 1500;
      const mergedRows: ExcelPreviewData['rows'] = [];
      const catMap = new Map<string, ExcelPreviewData['categories_breakdown'][number]>();
      const summary: ExcelPreviewData['summary'] = {
        total_rows: 0,
        valid_rows: 0,
        skipped_empty_rows: 0,
        matched_existing_count: 0,
        matched_possible_count: 0,
        new_products_count: 0,
        images_completed_from_master: 0,
        categories_completed_from_master: 0,
        products_enriched_count: 0,
        categories_count: 0,
        new_categories_count: 0,
      };

      for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const chunk = rows.slice(start, start + CHUNK_SIZE);
        setExcelProgressText(
          `جاري فحص ومطابقة الصفوف (${Math.min(start + chunk.length, rows.length)} من ${rows.length})...`
        );
        const res = await api.previewMerchantExcelMasterCatalog({
          rows: chunk as unknown as Array<Record<string, unknown>>,
          default_category_path: fallbackCategoryPath || undefined,
        });
        summary.total_rows += res.summary.total_rows;
        summary.valid_rows += res.summary.valid_rows;
        summary.skipped_empty_rows += res.summary.skipped_empty_rows;
        summary.matched_existing_count += res.summary.matched_existing_count;
        summary.matched_possible_count += res.summary.matched_possible_count;
        summary.new_products_count += res.summary.new_products_count;
        summary.images_completed_from_master += res.summary.images_completed_from_master;
        summary.categories_completed_from_master += res.summary.categories_completed_from_master;
        summary.products_enriched_count += res.summary.products_enriched_count;
        mergedRows.push(...res.rows);

        for (const c of res.categories_breakdown) {
          const prev = catMap.get(c.display_label);
          if (prev) {
            prev.count += c.count;
            prev.matched_count += c.matched_count;
            prev.new_count += c.new_count;
            prev.images_completed_count += c.images_completed_count;
          } else {
            catMap.set(c.display_label, { ...c });
          }
        }
      }

      const breakdown = Array.from(catMap.values()).sort((a, b) => b.count - a.count);
      summary.categories_count = breakdown.length;
      summary.new_categories_count = breakdown.filter((c) => c.is_new_category).length;

      setExcelPreview({
        summary,
        categories_breakdown: breakdown,
        rows: mergedRows,
      });
    } catch (err) {
      onToast((err as Error).message || 'تعذر قراءة أو مطابقة ملف Excel');
    } finally {
      setExcelPreviewing(false);
      setExcelProgressText('');
    }
  };

  const handleExcelFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFileName(file.name);
    setExcelPreview(null);
    setExcelMeta(null);
    setExcelPreviewing(true);
    setExcelProgressText('جاري قراءة ملف Excel...');
    try {
      const meta = await parseMasterSpreadsheetWithMeta(file);
      if (meta.rows.length === 0) {
        onToast('الملف لا يحتوي على صفوف منتجات صالحة. تأكد من وجود عمود اسم المنتج أو الباركود.');
        setParsedExcelRows([]);
        setExcelPreviewing(false);
        setExcelProgressText('');
        return;
      }
      setExcelMeta(meta);
      setSelectedExcelCatCols(meta.detectedCategoryColIndices);
      setParsedExcelRows(meta.rows);
      await runExcelPreview(meta.rows, defaultCategoryPath);
    } catch (err) {
      onToast((err as Error).message || 'حدث خطأ أثناء قراءة الملف');
      setExcelPreviewing(false);
      setExcelProgressText('');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleChangeMerchantExcelCatCol = (val: string) => {
    if (!excelMeta) return;
    const nextCols =
      val === 'AUTO' ? excelMeta.detectedCategoryColIndices : val === 'NONE' ? [] : [Number(val)];
    setSelectedExcelCatCols(nextCols);
    const rebuilt = rebuildRowsWithCategoryColumns(excelMeta, nextCols);
    setParsedExcelRows(rebuilt);
    void runExcelPreview(rebuilt, defaultCategoryPath);
  };

  const handleSubmitExcelForApproval = async () => {
    if (!excelPreview || excelPreview.rows.length === 0) return;
    setExcelSubmitting(true);
    const sharedBatchId = `xbatch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const CHUNK_SIZE = 800;
    let totalSubmitted = 0;
    let totalImagesCompleted = 0;
    let totalMatched = 0;
    const allCats = new Set<string>();

    try {
      for (let start = 0; start < parsedExcelRows.length; start += CHUNK_SIZE) {
        const chunk = parsedExcelRows.slice(start, start + CHUNK_SIZE);
        setExcelProgressText(
          `جاري إرسال المنتجات للإدارة للموافقة (${Math.min(start + chunk.length, parsedExcelRows.length)} من ${parsedExcelRows.length})...`
        );
        const res = await api.submitMerchantExcelMasterCatalog({
          merchant_id: merchantId,
          file_name: excelFileName || 'ملف Excel',
          batch_id: sharedBatchId,
          default_category_path: defaultCategoryPath || undefined,
          rows: chunk as unknown as Array<Record<string, unknown>>,
        });
        totalSubmitted += res.submitted_count;
        totalImagesCompleted += res.images_completed_from_master;
        totalMatched += res.matched_in_master_count;
        for (const c of res.categories_breakdown) allCats.add(c.display_label);
      }

      onToast(
        `تم إرسال ${totalSubmitted} منتج (${allCats.size} قسم · ${totalMatched} مطابق بالكتالوج · ${totalImagesCompleted} صورة مستكملة) للإدارة للموافقة. فور الموافقة ستنزل بالمنصة حسب أقسامها!`
      );
      setExcelPreview(null);
      setParsedExcelRows([]);
      setExcelFileName('');
      setSubTab('requests');
      await loadMyRequests();
    } catch (err) {
      onToast((err as Error).message || 'تعذر إرسال الملف للمراجعة');
    } finally {
      setExcelSubmitting(false);
      setExcelProgressText('');
    }
  };

  const filteredPreviewRows = useMemo(() => {
    if (!excelPreview) return [];
    if (selectedPreviewCategory === 'ALL') return excelPreview.rows;
    return excelPreview.rows.filter((r) => r.category_display === selectedPreviewCategory);
  }, [excelPreview, selectedPreviewCategory]);

  const pendingCount = useMemo(
    () => myRequests.filter((r) => r.status === 'pending').length,
    [myRequests]
  );

  const handleRunMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryName.trim() && !queryBarcode.trim()) {
      onToast('أدخل اسم المنتج أو الباركود أولاً للبحث في الكتالوج المركزي');
      return;
    }
    setMatching(true);
    setSelectedMaster(null);
    try {
      const res = await api.matchMasterCatalog({
        name_ar: queryName.trim(),
        brand: queryBrand.trim(),
        size_label: querySize.trim(),
        barcode: queryBarcode.trim(),
      });
      setMatchResult(res);
      if (res.exact_match) {
        setSelectedMaster(res.exact_match);
        setLinkForm((prev) => ({ ...prev, category_id: res.exact_match?.category_id || prev.category_id }));
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setMatching(false);
    }
  };

  const handleLinkListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaster) return;
    if (!linkForm.base_price || Number(linkForm.base_price) <= 0) {
      onToast('أدخل سعر المتجر بشكل صحيح');
      return;
    }
    setSavingLink(true);
    try {
      const res = await api.linkMerchantMasterListing({
        merchant_id: merchantId,
        master_product_id: selectedMaster.id,
        category_id: linkForm.category_id || selectedMaster.category_id || 'cat_grocery',
        base_price: Number(linkForm.base_price),
        sale_price: linkForm.sale_price ? Number(linkForm.sale_price) : null,
        stock_quantity: Number(linkForm.stock_quantity || 10),
        min_order_qty: Number(linkForm.min_order_qty || 1),
        merchant_sku: linkForm.merchant_sku.trim(),
        is_available: true,
      });
      onToast(
        res.updated_existing
          ? 'تم تحديث سعر ومخزون متجرك لهذا المنتج المركزي بنجاح'
          : 'تم ربط المنتج بمتجرك بنجاح وسيظهر الآن في مقارنة الأسعار!'
      );
      setSelectedMaster(null);
      setMatchResult(null);
      setQueryName('');
      setQueryBarcode('');
      setLinkForm({ base_price: '', sale_price: '', stock_quantity: '20', min_order_qty: '1', merchant_sku: '', category_id: '' });
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingLink(false);
    }
  };

  const handleSubmitNewRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryName.trim() || !reqForm.proposed_price) {
      onToast('اسم المنتج والسعر المقترح مطلوبان');
      return;
    }
    try {
      await api.requestNewMasterProduct({
        merchant_id: merchantId,
        product_name_ar: queryName.trim(),
        brand: queryBrand.trim(),
        size_label: querySize.trim(),
        barcode: queryBarcode.trim() || null,
        category_id: reqForm.category_id,
        category_path: reqForm.category_path.trim() || undefined,
        proposed_price: Number(reqForm.proposed_price),
        proposed_stock: Number(reqForm.proposed_stock || 10),
        image_url: reqForm.image_url.trim(),
        description: reqForm.description.trim(),
      });
      onToast('تم إرسال طلب إضافة المنتج للإدارة بنجاح — سيتم ربطه بمتجرك فور الاعتماد');
      setSubTab('requests');
      await loadMyRequests();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealForm.product_id || !dealForm.title_ar.trim()) {
      onToast('اختر المنتج وأدخل عنوان عرض التوفير');
      return;
    }
    try {
      await api.createProductDeal({
        merchant_id: merchantId,
        product_id: dealForm.product_id,
        deal_type: dealForm.deal_type,
        title_ar: dealForm.title_ar.trim(),
        subtitle_ar: dealForm.subtitle_ar.trim(),
        required_qty: Number(dealForm.required_qty || 1),
        free_qty: Number(dealForm.free_qty || 0),
        discount_amount: Number(dealForm.discount_amount || 0),
        discount_percent: Number(dealForm.discount_percent || 0),
        gift_product_ids: dealForm.gift_product_id ? [dealForm.gift_product_id] : [],
      });
      onToast('تم إنشاء عرض التوفير بنجاح وسيظهر للعملاء داخل بطاقة المنتج!');
      setDealForm({
        product_id: '',
        deal_type: 'free_gift',
        title_ar: '',
        subtitle_ar: '',
        required_qty: '1',
        free_qty: '1',
        discount_amount: '0',
        discount_percent: '0',
        gift_product_id: '',
      });
      await loadDeals();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const availableCategories = categories.filter((c) => !c.merchant_id || c.merchant_id === merchantId);

  return (
    <div className="bg-white rounded-3xl border border-red-200/80 shadow-sm overflow-hidden" dir="rtl">
      <div className="bg-gradient-to-l from-[#A92224] to-[#86191B] text-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-[#F5A623] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            الكتالوج المركزي الموحّد للتاجر
          </div>
          <h3 className="font-black text-base mt-0.5">
            رفع ملف Excel بالكتالوج المركزي وربط منتجات متجرك بالأقسام
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 bg-white/10 p-1 rounded-2xl">
          {[
            { id: 'excel', label: 'رفع ملف Excel', icon: FileSpreadsheet },
            { id: 'match', label: 'بحث وربط منتج', icon: Link2 },
            {
              id: 'requests',
              label: pendingCount > 0 ? `طلبات الاعتماد (${pendingCount})` : 'طلبات الاعتماد',
              icon: PackagePlus,
            },
            { id: 'deals', label: 'عروض التوفير والهدايا', icon: Gift },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  subTab === t.id ? 'bg-[#F5A623] text-[#3B180E]' : 'text-white/90 hover:bg-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* SUBTAB 0: MERCHANT EXCEL UPLOAD INTO CENTRAL CATALOG (WITH ENRICHMENT & ADMIN APPROVAL) */}
        {subTab === 'excel' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50/90 via-white to-red-50/40 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#A92224]">
                    <Sparkles className="w-3.5 h-3.5 text-[#F5A623]" />
                    تقسيم تلقائي بالأقسام + استكمال المنتج والقسم والصورة من الكتالوج المركزي
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    ارفع ملف Excel بمنتجاتك وأقسامها (مثل: <b>سوبر ماركت &gt; ألبان &gt; حليب</b> أو اسم القسم مباشرة).
                    يقوم النظام تلقائيًا بمطابقة كل منتج مع <b>الكتالوج المركزي</b> واستكمال <b>الصورة والقسم والعلامة والحجم</b> الناقصة،
                    ثم إرسال الملف كاملًا إلى <b>الإدارة للموافقة</b> — وفور الموافقة تنزل جميع المنتجات بالمنصة والتطبيق مرتّبة وفقًا لأقسامها!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => downloadMasterProductsExcelTemplate()}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-[#A92224]" />
                  تحميل نموذج Excel جاهز
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end pt-1">
                <div className="lg:col-span-2">
                  <CategoryPathPicker
                    categories={availableCategories}
                    valueCategoryId={defaultCategoryId}
                    valueCategoryPath={defaultCategoryPath}
                    compact
                    label="قسم افتراضي احتياطي (اختياري — يُستخدم فقط إذا لم يُذكر قسم بالملف أو بالكتالوج المركزي)"
                    onChange={({ category_id, category_path }) => {
                      setDefaultCategoryId(category_id);
                      setDefaultCategoryPath(category_path);
                      if (parsedExcelRows.length > 0) {
                        void runExcelPreview(parsedExcelRows, category_path);
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelFilePicked}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={excelPreviewing || excelSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-4 py-3 rounded-xl bg-[#A92224] hover:bg-[#86191B] disabled:opacity-60 text-white text-sm font-black inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    {excelPreviewing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {excelFileName ? 'اختيار ملف Excel آخر' : 'رفع ملف Excel للكتالوج المركزي'}
                  </button>
                  {excelFileName && (
                    <div className="text-[11px] text-slate-600 font-bold text-center truncate">
                      الملف الحالي: {excelFileName}
                    </div>
                  )}
                </div>
              </div>

              {excelProgressText && (
                <div className="rounded-xl bg-white border border-amber-200 px-3 py-2 text-xs font-bold text-[#A92224] flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>{excelProgressText}</span>
                </div>
              )}
            </div>

            {excelPreview && (
              <div className="space-y-4">
                {/* Explicit Category Column Selector */}
                {excelMeta && excelMeta.columns.length > 0 && (
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="text-xs text-indigo-950">
                      <span className="font-black">عمود القسم المقروء من الملف: </span>
                      <span className="font-bold">
                        {selectedExcelCatCols.length > 0
                          ? selectedExcelCatCols.map((i) => excelMeta.columns[i]?.header || `عمود ${i + 1}`).join(' > ')
                          : 'لم يُحدد (سيتم استكمال القسم من الكتالوج المركزي أو الافتراضي)'}
                      </span>
                    </div>
                    <select
                      value={
                        selectedExcelCatCols.length === 0
                          ? 'NONE'
                          : selectedExcelCatCols.length === 1
                          ? String(selectedExcelCatCols[0])
                          : 'AUTO'
                      }
                      onChange={(e) => handleChangeMerchantExcelCatCol(e.target.value)}
                      className="px-3 py-1.5 rounded-xl border border-indigo-300 bg-white text-xs font-bold text-slate-900 max-w-[280px]"
                    >
                      {excelMeta.detectedCategoryColIndices.length > 1 && (
                        <option value="AUTO">
                          تلقائي ({excelMeta.detectedCategoryColIndices.map((i) => excelMeta.columns[i]?.header).join(' > ')})
                        </option>
                      )}
                      <option value="NONE">استكمال القسم تلقائيًا من الكتالوج المركزي</option>
                      {excelMeta.columns.map((col) => (
                        <option key={col.index} value={String(col.index)}>
                          {col.header} {col.sample ? `— مثال: ${col.sample}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-bold text-slate-500">إجمالي المنتجات الجاهزة</div>
                    <div className="text-xl font-black text-slate-900 mt-0.5">{excelPreview.summary.valid_rows}</div>
                    <div className="text-[10px] text-slate-500">
                      {excelPreview.summary.new_products_count} منتج جديد · {excelPreview.summary.products_enriched_count} مطابق بالمركزي
                    </div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="text-[11px] font-bold text-emerald-700">مُستكمل من الكتالوج المركزي</div>
                    <div className="text-xl font-black text-emerald-900 mt-0.5">
                      {excelPreview.summary.products_enriched_count}
                    </div>
                    <div className="text-[10px] text-emerald-700">
                      تطابق تام: {excelPreview.summary.matched_existing_count} · محتمل: {excelPreview.summary.matched_possible_count}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3">
                    <div className="text-[11px] font-bold text-blue-700">صور وأقسام مُستكملة تلقائيًا</div>
                    <div className="text-xl font-black text-blue-900 mt-0.5">
                      {excelPreview.summary.images_completed_from_master} صورة
                    </div>
                    <div className="text-[10px] text-blue-700">
                      + {excelPreview.summary.categories_completed_from_master} قسم مستكمل من المركزي
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                    <div className="text-[11px] font-bold text-amber-800">تقسيم الأقسام بالملف</div>
                    <div className="text-xl font-black text-amber-950 mt-0.5">
                      {excelPreview.summary.categories_count} قسم
                    </div>
                    <div className="text-[10px] text-amber-800">
                      {excelPreview.summary.new_categories_count > 0
                        ? `منها ${excelPreview.summary.new_categories_count} قسم جديد يُنشأ فور الموافقة`
                        : 'جميع الأقسام موجودة ومرتبطة بالمنصة'}
                    </div>
                  </div>
                </div>

                {/* Category Split Breakdown */}
                <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <FolderTree className="w-4 h-4 text-[#A92224]" />
                      التقسيم التلقائي للمنتجات حسب الأقسام (اضغط على أي قسم لمعاينة منتجاته):
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPreviewCategory('ALL')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        selectedPreviewCategory === 'ALL'
                          ? 'bg-[#A92224] text-white border-[#A92224]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      كل الأقسام ({excelPreview.summary.valid_rows})
                    </button>
                    {excelPreview.categories_breakdown.map((cat) => {
                      const active = selectedPreviewCategory === cat.display_label;
                      return (
                        <button
                          key={cat.display_label}
                          type="button"
                          onClick={() => setSelectedPreviewCategory(cat.display_label)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer inline-flex items-center gap-1.5 ${
                            active
                              ? 'bg-[#A92224] text-white border-[#A92224]'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-red-300'
                          }`}
                        >
                          <span>{cat.display_label}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-lg text-[10px] font-black ${
                              active ? 'bg-white/20 text-white' : 'bg-red-50 text-[#A92224]'
                            }`}
                          >
                            {cat.count}
                          </span>
                          {cat.is_new_category && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-lg ${
                                active ? 'bg-amber-300 text-amber-950' : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              جديد
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Preview Table */}
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto max-h-[380px]">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5 font-black">الصورة</th>
                          <th className="p-2.5 font-black">المنتج والمطابقة مع الكتالوج المركزي</th>
                          <th className="p-2.5 font-black">القسم (التقسيم)</th>
                          <th className="p-2.5 font-black">السعر والمخزون</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {filteredPreviewRows.slice(0, 150).map((row) => (
                          <tr key={`${row.row_index}-${row.product_name_ar}`} className="hover:bg-slate-50/70">
                            <td className="p-2.5 w-24">
                              <div className="flex flex-col items-center gap-1">
                                {row.image_url ? (
                                  <img
                                    src={row.image_url}
                                    alt={row.product_name_ar}
                                    className="w-11 h-11 rounded-xl object-cover border border-slate-200"
                                  />
                                ) : (
                                  <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                                    <ImageIcon className="w-4 h-4" />
                                  </div>
                                )}
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                    row.image_source === 'master_catalog'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : row.image_source === 'excel'
                                      ? 'bg-slate-100 text-slate-600'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {row.image_source === 'master_catalog'
                                    ? 'من المركزي'
                                    : row.image_source === 'excel'
                                    ? 'من الملف'
                                    : 'بدون صورة'}
                                </span>
                              </div>
                            </td>
                            <td className="p-2.5">
                              <div className="font-black text-slate-900">{row.product_name_ar}</div>
                              <div className="text-[11px] text-slate-500 flex flex-wrap gap-2 mt-0.5">
                                {row.brand && <span>العلامة: <b>{row.brand}</b></span>}
                                {row.size_label && <span>الحجم: <b className="text-[#A92224]">{row.size_label}</b></span>}
                                {row.barcode && <span className="font-mono">باركود: {row.barcode}</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {row.enriched_from_master ? (
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                    مطابق بالكتالوج المركزي ({row.confidence_score}%)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                                    منتج جديد يُعتمد بالكتالوج المركزي
                                  </span>
                                )}
                                {row.enriched_fields.length > 0 && (
                                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 text-[10px] font-bold">
                                    استُكمل تلقائيًا: {row.enriched_fields.join('، ')}
                                  </span>
                                )}
                                {row.size_conflict_warning && (
                                  <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-700 text-[10px] font-bold inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    {row.size_conflict_warning}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-slate-900">{row.category_display}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                                    row.category_source === 'master_catalog'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : row.category_source === 'excel'
                                      ? 'bg-indigo-100 text-indigo-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {row.category_source === 'master_catalog'
                                    ? 'قسم مستكمل من المركزي'
                                    : row.category_source === 'excel'
                                    ? 'من ملف Excel'
                                    : 'قسم افتراضي'}
                                </span>
                                {row.is_new_category && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                                    يُنشأ عند الموافقة
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <div className="font-black text-[#A92224]">{row.proposed_price} ج.م</div>
                              {row.proposed_sale_price !== null && (
                                <div className="text-[10px] text-emerald-700 font-bold">
                                  عرض: {row.proposed_sale_price} ج.م
                                </div>
                              )}
                              <div className="text-[10px] text-slate-500">المخزون: {row.proposed_stock}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredPreviewRows.length > 150 && (
                    <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-t border-slate-200">
                      يتم عرض أول 150 منتج في المعاينة — سيتم إرسال جميع الـ {excelPreview.summary.valid_rows} منتج بالكامل للإدارة عند الضغط على زر الإرسال.
                    </div>
                  )}
                </div>

                {/* Submit Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-[#A92224]/30 bg-red-50/40 p-3.5">
                  <div className="text-xs text-slate-700">
                    <div className="font-black text-slate-900">
                      جاهز للإرسال إلى الإدارة للموافقة ({excelPreview.summary.valid_rows} منتج في {excelPreview.summary.categories_count} قسم)
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      لن تظهر المنتجات في المنصة إلا بعد موافقة الإدارة، ثم تنزل تلقائيًا تحت أقسامها المحددة.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={excelSubmitting}
                      onClick={() => {
                        setExcelPreview(null);
                        setParsedExcelRows([]);
                        setExcelFileName('');
                      }}
                      className="px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={excelSubmitting}
                      onClick={() => void handleSubmitExcelForApproval()}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-black inline-flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                      {excelSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {excelSubmitting
                        ? 'جاري الإرسال للإدارة...'
                        : `إرسال الملف للإدارة للموافقة (${excelPreview.summary.valid_rows} منتج)`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 1: SEARCH & LINK FROM MASTER CATALOG */}
        {subTab === 'match' && (
          <>
            <form onSubmit={handleRunMatch} className="grid grid-cols-1 md:grid-cols-5 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <div className="md:col-span-2">
                <label className="text-[11px] font-bold text-slate-600">اسم المنتج</label>
                <input
                  value={queryName}
                  onChange={(e) => setQueryName(e.target.value)}
                  placeholder="مثال: نسكافيه كلاسيك 200 جرام"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600">العلامة التجارية</label>
                <input
                  value={queryBrand}
                  onChange={(e) => setQueryBrand(e.target.value)}
                  placeholder="نسكافيه"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600">الوزن / الحجم</label>
                <input
                  value={querySize}
                  onChange={(e) => setQuerySize(e.target.value)}
                  placeholder="200 جرام / 1 لتر"
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                  <Barcode className="w-3 h-3" /> الباركود (اختياري)
                </label>
                <input
                  value={queryBarcode}
                  onChange={(e) => setQueryBarcode(e.target.value)}
                  placeholder="622103..."
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white font-mono"
                />
              </div>
              <div className="md:col-span-5 flex justify-end">
                <button
                  type="submit"
                  disabled={matching}
                  className="px-5 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  {matching ? 'جاري البحث والمطابقة الذكية...' : 'بحث في الكتالوج المركزي'}
                </button>
              </div>
            </form>

            {matchResult?.size_conflict_warning && (
              <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 font-bold">
                {matchResult.size_conflict_warning}
              </div>
            )}

            {matchResult && matchResult.candidates.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#F5A623]" />
                  {matchResult.match_status === 'exact'
                    ? 'تم العثور على تطابق تام في الكتالوج المركزي — اختره لربط سعرك ومخزونك فورًا:'
                    : 'منتجات مطابقة محتملة — اختر المنتج المطابق في العلامة والحجم أو أرسل طلب منتج جديد:'}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {matchResult.candidates.map((c) => {
                    const isPicked = selectedMaster?.id === c.id;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setSelectedMaster(c);
                          setLinkForm((prev) => ({ ...prev, category_id: c.category_id || prev.category_id }));
                        }}
                        className={`text-right p-3 rounded-2xl border-2 transition cursor-pointer flex items-center gap-3 ${
                          isPicked
                            ? 'border-[#A92224] bg-red-50/70'
                            : 'border-slate-200 hover:border-red-300 bg-white'
                        }`}
                      >
                        {c.image_url ? (
                          <img src={c.image_url} alt={c.canonical_name_ar} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-[#A92224] font-black shrink-0">
                            {c.confidence_score}%
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 text-sm truncate">{c.canonical_name_ar}</div>
                          <div className="text-xs text-slate-500">
                            {c.brand || 'بدون علامة'} · <b className="text-[#A92224]">{c.size_label || 'حجم قياسي'}</b>
                          </div>
                          <div className="text-[11px] text-emerald-700 font-bold mt-0.5">
                            {c.match_tier === 'exact' ? 'تطابق تام ✓' : `تطابق ${c.confidence_score}%`} · {c.stores_count} متجر
                            {c.lowest_price !== null ? ` · أقل سعر ${c.lowest_price} ج.م` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Store-specific Price & Stock Form for Selected Master */}
            {selectedMaster && (
              <form onSubmit={handleLinkListing} className="rounded-2xl border-2 border-[#A92224] bg-red-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[#A92224]">الخطوة 2: تسعير متجرك المستقل لهذا المنتج</div>
                    <div className="font-black text-slate-900">
                      {selectedMaster.canonical_name_ar} ({selectedMaster.size_label || 'قياسي'})
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                    لا يؤثر على أسعار المتاجر الأخرى
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">السعر الأساسي (ج.م) *</label>
                    <input
                      required
                      type="number"
                      step="0.5"
                      value={linkForm.base_price}
                      onChange={(e) => setLinkForm({ ...linkForm, base_price: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">سعر العرض (اختياري)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={linkForm.sale_price}
                      onChange={(e) => setLinkForm({ ...linkForm, sale_price: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">المخزون المتاح</label>
                    <input
                      type="number"
                      value={linkForm.stock_quantity}
                      onChange={(e) => setLinkForm({ ...linkForm, stock_quantity: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">أقل كمية طلب</label>
                    <input
                      type="number"
                      min={1}
                      value={linkForm.min_order_qty}
                      onChange={(e) => setLinkForm({ ...linkForm, min_order_qty: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700">كود SKU بمتجرك</label>
                    <input
                      value={linkForm.merchant_sku}
                      onChange={(e) => setLinkForm({ ...linkForm, merchant_sku: e.target.value })}
                      placeholder="اختياري"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingLink}
                    className="px-5 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-black flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {savingLink ? 'جاري الربط...' : 'حفظ وربط المنتج بمتجري'}
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: If not found or none match, allow submitting request to Admin */}
            {matchResult && !selectedMaster && (
              <form onSubmit={handleSubmitNewRequest} className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 space-y-3">
                <div className="font-black text-amber-950 text-sm flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-[#A92224]" />
                  المنتج غير موجود في الكتالوج المركزي؟ أرسل طلب إضافة للإدارة
                </div>
                <p className="text-xs text-amber-900">
                  سيتم مراجعة الطلب واعتماده كمنتج مركزي رسمي وربط متجرك به تلقائيًا وفقًا لقسمه دون تكرار.
                </p>
                <CategoryPathPicker
                  categories={availableCategories}
                  valueCategoryId={reqForm.category_id}
                  valueCategoryPath={reqForm.category_path}
                  compact
                  label="مسار الصنف في الأقسام (رئيسي ← فرعي ← القسم الأخير)"
                  onChange={({ category_id, category_path }) =>
                    setReqForm((prev) => ({ ...prev, category_id, category_path }))
                  }
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <input
                    required
                    type="number"
                    step="0.5"
                    value={reqForm.proposed_price}
                    onChange={(e) => setReqForm({ ...reqForm, proposed_price: e.target.value })}
                    placeholder="سعرك المقترح (ج.م) *"
                    className="px-3 py-2 rounded-xl border border-amber-200 text-sm bg-white"
                  />
                  <input
                    type="number"
                    value={reqForm.proposed_stock}
                    onChange={(e) => setReqForm({ ...reqForm, proposed_stock: e.target.value })}
                    placeholder="المخزون"
                    className="px-3 py-2 rounded-xl border border-amber-200 text-sm bg-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    إرسال للمراجعة
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* SUBTAB 2: MY SUBMITTED REQUESTS */}
        {subTab === 'requests' && (
          <div className="space-y-2.5">
            {myRequests.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">
                لم ترسل أي طلبات منتجات أو ملفات Excel للمراجعة بعد.
              </div>
            ) : (
              myRequests.map((r) => {
                const thumb = r.image_url || r.suggested_master_image;
                const catLabel = formatCategoryDisplay(
                  r.resolved_category_path || r.category_path || r.category_name || r.suggested_master_category_name
                );
                return (
                  <div key={r.id} className="rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      {thumb ? (
                        <img src={thumb} alt={r.product_name_ar} className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                          <ImageIcon className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black text-slate-900 text-sm">{r.product_name_ar}</span>
                          {r.size_label && <span className="text-[#A92224] font-bold">({r.size_label})</span>}
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[10px] font-bold">
                            {catLabel}
                          </span>
                          {r.source_file_name && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold inline-flex items-center gap-1">
                              <FileSpreadsheet className="w-3 h-3" />
                              {r.source_file_name}
                            </span>
                          )}
                          {Boolean(r.enriched_from_master) && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                              مُستكمل من المركزي
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          السعر المقترح: <b className="text-slate-800">{r.proposed_price} ج.م</b> · المخزون: {r.proposed_stock} ·{' '}
                          {r.admin_note || (r.status === 'pending' ? 'بانتظار موافقة الإدارة للنشر بالمنصة' : '')}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full font-bold shrink-0 ${
                      r.status === 'pending'
                        ? 'bg-amber-100 text-amber-800'
                        : r.status === 'rejected'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {r.status === 'pending'
                        ? 'قيد موافقة الإدارة'
                        : r.status === 'approved_new'
                        ? 'تمت الموافقة ونزل بالمنصة ✓'
                        : r.status === 'linked_existing'
                        ? 'تم الربط ونزل بالمنصة ✓'
                        : 'مرفوض'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* SUBTAB 3: SAVINGS DEALS & GIFTS */}
        {subTab === 'deals' && (
          <div className="space-y-4">
            <form onSubmit={handleCreateDeal} className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <select
                required
                value={dealForm.product_id}
                onChange={(e) => setDealForm({ ...dealForm, product_id: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="">اختر المنتج المشمول بالعرض *</option>
                {merchantProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_ar} ({p.sale_price ?? p.base_price} ج.م)
                  </option>
                ))}
              </select>
              <select
                value={dealForm.deal_type}
                onChange={(e) => setDealForm({ ...dealForm, deal_type: e.target.value as any })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="free_gift">هدية مجانية مع المنتج</option>
                <option value="buy_x_get_y">اشترِ منتجًا واحصل على إضافي</option>
                <option value="bundle_discount">عرض باقة / توفير عند إكمال مجموعة</option>
                <option value="tier_qty">خصم عند شراء كمية</option>
                <option value="free_delivery">توصيل مجاني مع المنتج</option>
              </select>
              <input
                required
                value={dealForm.title_ar}
                onChange={(e) => setDealForm({ ...dealForm, title_ar: e.target.value })}
                placeholder="عنوان العرض (مثال: هدية مجانية مع هذا المنتج)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <input
                type="number"
                min={1}
                value={dealForm.required_qty}
                onChange={(e) => setDealForm({ ...dealForm, required_qty: e.target.value })}
                placeholder="العدد المطلوب (مثال: 2)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <input
                type="number"
                value={dealForm.discount_amount}
                onChange={(e) => setDealForm({ ...dealForm, discount_amount: e.target.value })}
                placeholder="قيمة التوفير (ج.م)"
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <select
                value={dealForm.gift_product_id}
                onChange={(e) => setDealForm({ ...dealForm, gift_product_id: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="">منتج الهدية / المكمل (اختياري)</option>
                {merchantProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name_ar}</option>
                ))}
              </select>
              <div className="md:col-span-3 flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Tag className="w-3.5 h-3.5" />
                  تفعيل عرض التوفير
                </button>
              </div>
            </form>

            {deals.length > 0 && (
              <div className="space-y-2">
                {deals.map((d) => (
                  <div key={d.id} className="rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{d.title_ar}</div>
                      <div className="text-slate-500">
                        {d.product_name_ar} · توفير {d.discount_amount} ج.م · مطلوب {d.required_qty}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteProductDeal(d.id);
                        onToast('تم حذف العرض');
                        await loadDeals();
                      }}
                      className="p-2 rounded-xl text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
