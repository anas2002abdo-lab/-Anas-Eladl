import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertCircle, ImagePlus, Trash2, Camera, Store, Tag, Percent, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CategoryRecord, Language, MerchantRecord, ProductRecord } from '../shared/types.ts';

interface Props {
  lang: Language;
  merchants: MerchantRecord[];
  portalMode?: 'admin' | 'merchant';
  merchantSession?: MerchantRecord | null;
  onRefreshCore?: () => Promise<void>;
  onMerchantUpdated?: (merchant: MerchantRecord) => void;
  onNotify: (msg: string) => void;
}

interface ParsedExcelProductRow {
  product_code: string;
  name_ar: string;
  price: number | string;
  category_name: string;
  image_url?: string;
}

function compressProductImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxDim = 600;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(rawUrl);
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
}

export const CatalogSection: React.FC<Props> = ({
  lang,
  merchants,
  portalMode = 'admin',
  merchantSession,
  onRefreshCore,
  onMerchantUpdated,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const isMerchantPortal = portalMode === 'merchant' && Boolean(merchantSession?.id);
  const lockedMerchantId = isMerchantPortal ? merchantSession!.id : '';

  const [subTab, setSubTab] = useState<'products' | 'categories'>('products');
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);

  const [merchantFilter, setMerchantFilter] = useState<string>(lockedMerchantId || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProductModalOpen, setEditProductModalOpen] = useState<boolean>(false);
  const [editCategoryModalOpen, setEditCategoryModalOpen] = useState<boolean>(false);

  // Store Photo state
  const [photoMerchantId, setPhotoMerchantId] = useState<string>(
    lockedMerchantId || merchants[0]?.id || 'mer_1'
  );
  const [storeImageUrl, setStoreImageUrl] = useState<string>('');
  const [savingStorePhoto, setSavingStorePhoto] = useState<boolean>(false);

  const [importMerchantId, setImportMerchantId] = useState<string>(
    lockedMerchantId || merchants[0]?.id || 'mer_1'
  );
  const [parsedExcelRows, setParsedExcelRows] = useState<ParsedExcelProductRow[]>([]);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importingExcel, setImportingExcel] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    categories_created: number;
    errors: string[];
  } | null>(null);

  const [productForm, setProductForm] = useState({
    product_code: '',
    merchant_id: lockedMerchantId || merchants[0]?.id || 'mer_1',
    category_id: 'cat_grocery',
    name_ar: '',
    name_en: '',
    description: '',
    image_url: '',
    base_price: 50,
    sale_price: '' as string | number,
    stock_quantity: 20,
    low_stock_threshold: 5,
    requires_prescription: false,
    addons_text: '',
    is_offer: false,
    is_available: true,
  });

  const [catForm, setCatForm] = useState({
    scope: (merchantSession?.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant') as
      | 'merchant'
      | 'pharmacy'
      | 'market',
    merchant_id: lockedMerchantId || '',
    name_ar: '',
    name_en: '',
    image_url: '',
    sort_order: 1,
    is_offers_section: false,
  });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState<string>('');
  const [editingCatImage, setEditingCatImage] = useState<string>('');
  const [editingCatIsOffers, setEditingCatIsOffers] = useState<boolean>(false);

  const loadCatalog = async () => {
    const [prods, cats] = await Promise.all([api.getProducts(), api.getCategories()]);
    setProducts(prods);
    setCategories(cats);
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    if (lockedMerchantId) {
      setPhotoMerchantId(lockedMerchantId);
      setImportMerchantId(lockedMerchantId);
      setMerchantFilter(lockedMerchantId);
      setProductForm((prev) => ({ ...prev, merchant_id: lockedMerchantId }));
      setCatForm((prev) => ({
        ...prev,
        merchant_id: lockedMerchantId,
        scope: merchantSession?.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant',
      }));
    }
  }, [lockedMerchantId, merchantSession?.merchant_type]);

  useEffect(() => {
    const targetMer =
      merchants.find((m) => m.id === photoMerchantId) ||
      (merchantSession && merchantSession.id === photoMerchantId ? merchantSession : undefined);
    setStoreImageUrl(targetMer?.image_url || '');
  }, [photoMerchantId, merchants, merchantSession]);

  const resetProductForm = () => {
    setEditingId(null);
    const defaultMerId = lockedMerchantId || merchants[0]?.id || 'mer_1';
    setProductForm({
      product_code: '',
      merchant_id: defaultMerId,
      category_id:
        categories.find((c) => c.scope !== 'market' && (!c.merchant_id || c.merchant_id === defaultMerId))?.id ||
        'cat_grocery',
      name_ar: '',
      name_en: '',
      description: '',
      image_url: '',
      base_price: 50,
      sale_price: '',
      stock_quantity: 20,
      low_stock_threshold: 5,
      requires_prescription: false,
      addons_text: '',
      is_offer: false,
      is_available: true,
    });
  };

  const handleSaveStorePhoto = async () => {
    if (!photoMerchantId) return;
    setSavingStorePhoto(true);
    try {
      const res = (await api.updateMerchant(photoMerchantId, {
        image_url: storeImageUrl.trim(),
      })) as { ok: boolean; merchant?: MerchantRecord };
      if (res?.merchant && onMerchantUpdated) {
        onMerchantUpdated(res.merchant);
      }
      if (onRefreshCore) {
        await onRefreshCore();
      }
      onNotify(
        isAr
          ? 'تم حفظ صورة المتجر بنجاح وستظهر كأيقونة دائرية في صفحة المتاجر'
          : 'Store image updated successfully'
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingStorePhoto(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name_ar.trim()) return;
    try {
      const payload = {
        ...productForm,
        merchant_id: lockedMerchantId || productForm.merchant_id,
      };
      if (editingId) {
        await api.updateProduct(editingId, payload);
        onNotify(isAr ? 'تم تعديل المنتج وتحديث المخزون' : 'Product updated');
      } else {
        await api.createProduct(payload);
        onNotify(
          payload.is_offer
            ? isAr
              ? 'تمت إضافة المنتج وظهوره تلقائيًا في قسم العروض وصفحة العروض الرئيسية'
              : 'Product added & synced to Offers'
            : isAr
            ? 'تمت إضافة المنتج الجديد للقائمة'
            : 'Product added'
        );
      }
      resetProductForm();
      await loadCatalog();
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleStartEditProduct = (p: ProductRecord) => {
    setEditingId(p.id);
    setProductForm({
      product_code: p.product_code || '',
      merchant_id: lockedMerchantId || p.merchant_id,
      category_id: p.category_id,
      name_ar: p.name_ar,
      name_en: p.name_en,
      description: p.description,
      image_url: p.image_url || '',
      base_price: p.base_price,
      sale_price: p.sale_price ?? '',
      stock_quantity: p.stock_quantity,
      low_stock_threshold: p.low_stock_threshold,
      requires_prescription: p.requires_prescription,
      addons_text: p.addons_text,
      is_offer: Boolean(p.is_offer),
      is_available: p.is_available,
    });
    setEditProductModalOpen(true);
  };

  const handleExportProductsExcel = () => {
    const sourceList = filteredProducts.length > 0 ? filteredProducts : products;
    const sheetRows = sourceList.map((p) => ({
      'كود المنتج': p.product_code || p.id,
      'اسم المنتج': p.name_ar,
      'سعر المنتج': p.sale_price !== null && p.sale_price !== undefined ? p.sale_price : p.base_price,
      'قسم المنتج': p.category_name || '',
      'صورة المنتج': p.image_url || '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ['كود المنتج', 'اسم المنتج', 'سعر المنتج', 'قسم المنتج', 'صورة المنتج'],
    });
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 42 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المنتجات');
    XLSX.writeFile(wb, `otlobha-products-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(isAr ? `تم تصدير ${sheetRows.length} منتج (شامل روابط الصور) إلى Excel بنجاح` : `Exported ${sheetRows.length} products`);
  };

  const handleDownloadExcelTemplate = () => {
    const sampleRows = [
      {
        'كود المنتج': 'PRD-2001',
        'اسم المنتج': 'زيت عباد الشمس 1 لتر',
        'سعر المنتج': 95,
        'قسم المنتج': 'بقالة وسوبرماركت',
        'صورة المنتج': 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400',
      },
      {
        'كود المنتج': 'PRD-2002',
        'اسم المنتج': 'لبن كامل الدسم 1 لتر',
        'سعر المنتج': 44,
        'قسم المنتج': 'ألبان وأجبان',
        'صورة المنتج': '',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, {
      header: ['كود المنتج', 'اسم المنتج', 'سعر المنتج', 'قسم المنتج', 'صورة المنتج'],
    });
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 42 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'نموذج المنتجات');
    XLSX.writeFile(wb, 'otlobha-products-template.xlsx');
    onNotify(isAr ? 'تم تحميل نموذج Excel الجاهز (5 أعمدة شامل صورة المنتج)' : 'Downloaded Excel template');
  };

  const pickColumnValue = (row: Record<string, unknown>, keys: string[]): string => {
    const normalizedEntries = Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v] as const);
    for (const candidate of keys) {
      const target = candidate.trim().toLowerCase();
      const found = normalizedEntries.find(([k]) => k === target || k.includes(target));
      if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') {
        return String(found[1]).trim();
      }
    }
    return '';
  };

  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSummary(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        onNotify(isAr ? 'ملف الإكسل فارغ' : 'Empty workbook');
        return;
      }
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: '' });
      const parsed: ParsedExcelProductRow[] = rawJson
        .map((r) => {
          const code = pickColumnValue(r, ['كود المنتج', 'الكود', 'كود', 'product_code', 'code', 'sku']);
          const nameAr = pickColumnValue(r, ['اسم المنتج', 'المنتج', 'الاسم', 'name_ar', 'name', 'product_name']);
          const priceStr = pickColumnValue(r, ['سعر المنتج', 'السعر', 'price', 'base_price']);
          const catName = pickColumnValue(r, ['قسم المنتج', 'القسم', 'التصنيف', 'category_name', 'category']);
          const imageUrl = pickColumnValue(r, ['صورة المنتج', 'الصورة', 'رابط الصورة', 'image_url', 'image', 'photo']);
          return {
            product_code: code,
            name_ar: nameAr,
            price: priceStr === '' ? 0 : Number(priceStr.replace(/[^\d.-]/g, '')),
            category_name: catName,
            image_url: imageUrl,
          };
        })
        .filter((r) => r.name_ar.length > 0 || r.product_code.length > 0);

      if (parsed.length === 0) {
        onNotify(
          isAr
            ? 'لم يتم العثور على أعمدة مطابقة (كود المنتج، اسم المنتج، سعر المنتج، قسم المنتج، صورة المنتج)'
            : 'No matching columns found'
        );
        return;
      }
      setImportFileName(file.name);
      setParsedExcelRows(parsed);
      onNotify(isAr ? `تمت قراءة ${parsed.length} صف من الملف (${file.name}) — اضغط تأكيد الاستيراد` : `Parsed ${parsed.length} rows`);
    } catch (err) {
      onNotify(isAr ? `تعذر قراءة ملف الإكسل: ${(err as Error).message}` : (err as Error).message);
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmExcelImport = async () => {
    if (parsedExcelRows.length === 0) return;
    setImportingExcel(true);
    try {
      const res = await api.importProductsExcel({
        merchant_id: importMerchantId,
        rows: parsedExcelRows,
      });
      setImportSummary(res);
      setParsedExcelRows([]);
      setImportFileName('');
      await loadCatalog();
      onNotify(
        isAr
          ? `تم استيراد Excel: ${res.created} منتج جديد، ${res.updated} محدّث، ${res.categories_created} قسم جديد`
          : `Imported: ${res.created} created, ${res.updated} updated`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setImportingExcel(false);
    }
  };

  const handleAdjustStock = async (p: ProductRecord, delta: number) => {
    const nextQty = Math.max(0, p.stock_quantity + delta);
    await api.updateProduct(p.id, { stock_quantity: nextQty, is_available: nextQty > 0 });
    await loadCatalog();
  };

  const handleToggleProductAvail = async (p: ProductRecord) => {
    await api.updateProduct(p.id, { is_available: !p.is_available });
    await loadCatalog();
    onNotify(isAr ? 'تم تحديث توافر المنتج' : 'Availability updated');
  };

  const handleDeleteProduct = async (p: ProductRecord) => {
    await api.deleteProduct(p.id);
    await loadCatalog();
    onNotify(isAr ? `تم حذف المنتج: ${p.name_ar}` : 'Product deleted');
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catForm.name_ar.trim()) return;
    try {
      await api.createCategory({
        ...catForm,
        merchant_id: lockedMerchantId || catForm.merchant_id || null,
      });
      setCatForm((prev) => ({
        ...prev,
        name_ar: '',
        name_en: '',
        image_url: '',
        is_offers_section: false,
      }));
      await loadCatalog();
      onNotify(isAr ? 'تمت إضافة القسم بنجاح بصورته الدائرية' : 'Category created');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleSaveCategoryEdit = async (c: CategoryRecord) => {
    try {
      await api.updateCategory(c.id, {
        name_ar: editingCatName,
        image_url: editingCatImage,
        is_offers_section: editingCatIsOffers,
      });
      setEditingCatId(null);
      await loadCatalog();
      onNotify(isAr ? 'تم تحديث بيانات وصورة القسم' : 'Category updated');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleToggleCategory = async (c: CategoryRecord) => {
    await api.updateCategory(c.id, { is_active: !c.is_active });
    await loadCatalog();
  };

  const handleDeleteCategory = async (c: CategoryRecord) => {
    try {
      await api.deleteCategory(c.id);
      await loadCatalog();
      onNotify(isAr ? 'تم حذف القسم' : 'Category deleted');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const filteredProducts = products.filter((p) => {
    const activeMerFilter = lockedMerchantId || merchantFilter;
    const matchMerchant = activeMerFilter === 'all' || p.merchant_id === activeMerFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      p.name_ar.toLowerCase().includes(q) ||
      (p.product_code || '').toLowerCase().includes(q) ||
      (p.category_name || '').toLowerCase().includes(q);
    return matchMerchant && matchSearch;
  });

  const storeCats = categories.filter(
    (c) =>
      c.scope !== 'market' &&
      (!c.merchant_id || c.merchant_id === (lockedMerchantId || productForm.merchant_id))
  );

  const visibleCategories = isMerchantPortal
    ? categories.filter((c) => c.scope !== 'market' && (c.merchant_id === lockedMerchantId || !c.merchant_id))
    : categories;

  const selectedPhotoMerchant =
    merchants.find((m) => m.id === photoMerchantId) ||
    (merchantSession && merchantSession.id === photoMerchantId ? merchantSession : undefined);

  return (
    <div className="space-y-6">
      {/* STORE PHOTO / BRANDING CARD */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {storeImageUrl ? (
              <img
                src={storeImageUrl}
                alt={selectedPhotoMerchant?.business_name_ar || 'Store'}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-full object-cover border-2 border-orange-500 shadow-sm shrink-0 bg-slate-50"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-orange-50 border-2 border-dashed border-orange-300 flex items-center justify-center text-orange-600 shrink-0">
                <Store className="w-7 h-7" />
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'صورة المتجر والشعار الدائري' : 'Store Photo & Circular Avatar'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr
                  ? 'تظهر هذه الصورة داخل أيقونة دائرية باسم متجرك في صفحة المتاجر بتطبيق العميل.'
                  : 'Displayed as a circular icon with your store name in the Customer Stores view.'}
              </p>
            </div>
          </div>

          {!isMerchantPortal && (
            <div className="min-w-[210px]">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                {isAr ? 'اختر المتجر لتحديث صورته:' : 'Select Store:'}
              </label>
              <select
                value={photoMerchantId}
                onChange={(e) => setPhotoMerchantId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold bg-white"
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.business_name_ar}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
          <input
            type="text"
            dir="ltr"
            placeholder="https://... أو التقط/ارفع صورة للمتجر"
            value={storeImageUrl}
            onChange={(e) => setStoreImageUrl(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono-num"
          />
          <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-900 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
            <Camera className="w-4 h-4 text-orange-600" />
            <span>{isAr ? 'تصوير' : 'Camera'}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const dataUrl = await compressProductImage(file);
                  setStoreImageUrl(dataUrl);
                } catch (err) {
                  onNotify((err as Error).message);
                } finally {
                  e.target.value = '';
                }
              }}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
            <ImagePlus className="w-4 h-4 text-slate-700" />
            <span>{isAr ? 'رفع صورة' : 'Upload'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const dataUrl = await compressProductImage(file);
                  setStoreImageUrl(dataUrl);
                } catch (err) {
                  onNotify((err as Error).message);
                } finally {
                  e.target.value = '';
                }
              }}
            />
          </label>
          {storeImageUrl && (
            <button
              type="button"
              onClick={() => setStoreImageUrl('')}
              className="inline-flex items-center gap-1 px-2.5 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg text-xs font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isAr ? 'حذف' : 'Remove'}</span>
            </button>
          )}
          <button
            type="button"
            disabled={savingStorePhoto}
            onClick={handleSaveStorePhoto}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold whitespace-nowrap"
          >
            {savingStorePhoto ? (isAr ? 'جاري الحفظ...' : 'Saving...') : isAr ? 'حفظ صورة المتجر' : 'Save Store Photo'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          <button
            onClick={() => setSubTab('products')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'products' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {isAr
              ? `المنتجات والأسعار والمخزون (${filteredProducts.length})`
              : `Products & Inventory (${filteredProducts.length})`}
          </button>
          <button
            onClick={() => setSubTab('categories')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'categories' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {isAr
              ? `أقسام المتجر والعروض (${visibleCategories.length})`
              : `Store Sections & Categories (${visibleCategories.length})`}
          </button>
        </div>
      </div>

      {subTab === 'products' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveProduct} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingId ? (isAr ? 'تعديل المنتج المحدد' : 'Edit Product') : isAr ? 'إضافة منتج جديد لمتجر أو صيدلية' : 'Add New Product'}
              </h3>
              {editingId && (
                <button type="button" onClick={resetProductForm} className="text-xs text-slate-600 underline">
                  {isAr ? 'إلغاء التعديل وإضافة جديد' : 'Cancel Edit'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isAr ? 'كود المنتج (اختياري - يُولَّد تلقائيًا)' : 'Product Code'}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder="PRD-1007"
                  value={productForm.product_code}
                  onChange={(e) => setProductForm({ ...productForm, product_code: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'المتجر / الصيدلية' : 'Merchant'}</label>
                <select
                  value={lockedMerchantId || productForm.merchant_id}
                  disabled={isMerchantPortal}
                  onChange={(e) => {
                    const nextMerId = e.target.value;
                    const firstAllowedCat = categories.find(
                      (c) => c.scope !== 'market' && (!c.merchant_id || c.merchant_id === nextMerId)
                    );
                    setProductForm({
                      ...productForm,
                      merchant_id: nextMerId,
                      category_id: firstAllowedCat?.id || productForm.category_id,
                    });
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-600"
                >
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.business_name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'القسم بالمتجر' : 'Category'}</label>
                <select
                  value={productForm.category_id}
                  onChange={(e) => {
                    const nextCatId = e.target.value;
                    const pickedCat = storeCats.find((c) => c.id === nextCatId);
                    setProductForm({
                      ...productForm,
                      category_id: nextCatId,
                      is_offer: pickedCat?.is_offers_section ? true : productForm.is_offer,
                    });
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {storeCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.is_offers_section ? `⭐ ${c.name_ar} (تلقائي بصفحة العروض)` : c.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'اسم المنتج بالعربية' : 'Product Name (AR)'}</label>
                <input
                  type="text"
                  required
                  placeholder={isAr ? 'مثال: زيت عباد الشمس 1 لتر' : 'Product title'}
                  value={productForm.name_ar}
                  onChange={(e) => setProductForm({ ...productForm, name_ar: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'السعر الأساسي (ج.م)' : 'Base Price (EGP)'}</label>
                <input
                  type="number"
                  step="0.5"
                  required
                  value={productForm.base_price}
                  onChange={(e) => setProductForm({ ...productForm, base_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'سعر العرض/الخصم (اختياري)' : 'Sale Price (Optional)'}</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder={isAr ? 'اتركه فارغًا بدون خصم' : 'None'}
                  value={productForm.sale_price}
                  onChange={(e) => setProductForm({ ...productForm, sale_price: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الكمية بالمخزون' : 'Stock Quantity'}</label>
                <input
                  type="number"
                  value={productForm.stock_quantity}
                  onChange={(e) => setProductForm({ ...productForm, stock_quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الإضافات / الأحجام' : 'Addons / Sizes'}</label>
                <input
                  type="text"
                  placeholder={isAr ? 'مثال: حجم كبير +20 ج.م' : 'Addons'}
                  value={productForm.addons_text}
                  onChange={(e) => setProductForm({ ...productForm, addons_text: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'وصف المنتج' : 'Description'}</label>
                <input
                  type="text"
                  placeholder={isAr ? 'تفاصيل مختصرة للعميل...' : 'Details...'}
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isAr ? 'صورة المنتج (رابط URL أو رفع صورة من الجهاز)' : 'Product Image (URL or Upload)'}
                </label>
                <div className="flex items-center gap-2">
                  {productForm.image_url ? (
                    <div className="relative shrink-0">
                      <img
                        src={productForm.image_url}
                        alt={productForm.name_ar || 'Product'}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-cover border border-slate-200 bg-slate-50"
                      />
                      <button
                        type="button"
                        onClick={() => setProductForm({ ...productForm, image_url: '' })}
                        title={isAr ? 'إزالة الصورة' : 'Remove image'}
                        className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : null}
                  <input
                    type="text"
                    dir="ltr"
                    placeholder="https://... أو ارفع صورة بالزر المجاور"
                    value={productForm.image_url}
                    onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono-num"
                  />
                  <label className="inline-flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
                    <ImagePlus className="w-4 h-4 text-orange-600" />
                    <span>{isAr ? 'رفع صورة' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const dataUrl = await compressProductImage(file);
                          setProductForm((prev) => ({ ...prev, image_url: dataUrl }));
                        } catch (err) {
                          onNotify((err as Error).message);
                        } finally {
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.requires_prescription}
                    onChange={(e) => setProductForm({ ...productForm, requires_prescription: e.target.checked })}
                  />
                  {isAr ? 'يتطلب روشتة طبية' : 'Requires Rx'}
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.is_available}
                    onChange={(e) => setProductForm({ ...productForm, is_available: e.target.checked })}
                  />
                  {isAr ? 'متاح للبيع' : 'Available'}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.is_offer}
                    onChange={(e) => setProductForm({ ...productForm, is_offer: e.target.checked })}
                  />
                  <Percent className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isAr
                      ? 'إضافة لقسم العروض وصفحة العروض الرئيسية (مع بقائه في قسمه)'
                      : 'Add to Store & Main Offers'}
                  </span>
                </label>
              </div>
              <div className="flex items-end justify-end sm:col-span-2">
                <button
                  type="submit"
                  className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg whitespace-nowrap"
                >
                  {editingId ? (isAr ? 'حفظ التعديلات' : 'Update Product') : isAr ? 'إضافة المنتج' : 'Add Product'}
                </button>
              </div>
            </div>
          </form>

          {/* EXCEL IMPORT & EXPORT BAR */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {isAr ? 'استيراد وتصدير المنتجات عبر Excel (.xlsx)' : 'Excel Products Import & Export'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? 'الأعمدة المعتمدة: كود المنتج | اسم المنتج | سعر المنتج | قسم المنتج | صورة المنتج (رابط أو مسار)'
                      : 'Columns: Product Code | Name | Price | Category | Image URL'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadExcelTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 rounded-lg text-xs font-semibold"
                >
                  <FileSpreadsheet className="w-4 h-4 text-slate-600" />
                  <span>{isAr ? 'تنزيل نموذج Excel جاهز' : 'Download Template'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportProductsExcel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                >
                  <Download className="w-4 h-4" />
                  <span>{isAr ? 'تصدير المنتجات إلى Excel' : 'Export Excel'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-3 border-t border-slate-100">
              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isAr ? 'استيراد الملف لصالح متجر / صيدلية:' : 'Target Merchant for Import:'}
                </label>
                <select
                  value={lockedMerchantId || importMerchantId}
                  disabled={isMerchantPortal}
                  onChange={(e) => setImportMerchantId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white disabled:bg-slate-100"
                >
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.business_name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-5">
                <label className="flex items-center justify-center gap-2 w-full px-3.5 py-2 border-2 border-dashed border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-900 rounded-lg text-xs font-bold cursor-pointer min-h-[38px]">
                  <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{importFileName ? `تم اختيار: ${importFileName}` : isAr ? 'اختر ملف Excel (.xlsx / .xls / .csv)' : 'Choose Excel File'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelFileSelected}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="sm:col-span-3">
                <button
                  type="button"
                  disabled={parsedExcelRows.length === 0 || importingExcel}
                  onClick={handleConfirmExcelImport}
                  className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold min-h-[38px]"
                >
                  {importingExcel
                    ? isAr
                      ? 'جاري الاستيراد...'
                      : 'Importing...'
                    : isAr
                    ? `تأكيد استيراد (${parsedExcelRows.length})`
                    : `Confirm Import (${parsedExcelRows.length})`}
                </button>
              </div>
            </div>

            {parsedExcelRows.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">
                    معاينة الملف قبل الحفظ ({parsedExcelRows.length} منتج) — يتم تحديث المنتج تلقائيًا إذا تطابق «كود المنتج»
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedExcelRows([]);
                      setImportFileName('');
                    }}
                    className="text-rose-600 hover:underline"
                  >
                    إلغاء المعاينة
                  </button>
                </div>
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1.5 text-start">كود المنتج</th>
                        <th className="py-1.5 text-start">اسم المنتج</th>
                        <th className="py-1.5 text-start">سعر المنتج</th>
                        <th className="py-1.5 text-start">قسم المنتج</th>
                        <th className="py-1.5 text-start">صورة المنتج</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {parsedExcelRows.slice(0, 8).map((r, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 font-mono-num text-slate-700">{r.product_code || 'تلقائي'}</td>
                          <td className="py-1.5 font-semibold text-slate-900">{r.name_ar}</td>
                          <td className="py-1.5 tabular-nums font-bold text-teal-700">{r.price} ج.م</td>
                          <td className="py-1.5 text-slate-600">{r.category_name || 'القسم الافتراضي'}</td>
                          <td className="py-1.5">
                            {r.image_url ? (
                              <div className="flex items-center gap-1.5">
                                <img
                                  src={r.image_url}
                                  alt={r.name_ar}
                                  referrerPolicy="no-referrer"
                                  className="w-6 h-6 rounded object-cover border border-slate-200"
                                />
                                <span className="text-[11px] text-teal-700 truncate max-w-[140px]" dir="ltr">
                                  {r.image_url}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400">بدون صورة</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {importSummary && (
              <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>
                  نتيجة الاستيراد: <strong>{importSummary.created}</strong> منتج جديد ·{' '}
                  <strong>{importSummary.updated}</strong> منتج محدّث ·{' '}
                  <strong>{importSummary.categories_created}</strong> قسم جديد ·{' '}
                  <strong>{importSummary.skipped}</strong> متخطى
                </span>
                {importSummary.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {importSummary.errors[0]}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">{isAr ? 'كتالوج المنتجات والمخزون' : 'Products & Stock Table'}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder={isAr ? 'بحث بكود المنتج أو الاسم أو القسم...' : 'Search code or name...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                />
                {!isMerchantPortal && (
                  <select
                    value={merchantFilter}
                    onChange={(e) => setMerchantFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  >
                    <option value="all">{isAr ? 'كل المتاجر والصيدليات' : 'All Merchants'}</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.business_name_ar}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">{isAr ? 'كود المنتج' : 'Code'}</th>
                    <th className="py-2 text-start">{isAr ? 'المنتج' : 'Product'}</th>
                    <th className="py-2 text-start">{isAr ? 'المتجر والقسم' : 'Store & Category'}</th>
                    <th className="py-2 text-start">{isAr ? 'السعر' : 'Price'}</th>
                    <th className="py-2 text-start">{isAr ? 'المخزون' : 'Stock'}</th>
                    <th className="py-2 text-start">{isAr ? 'التوافر' : 'Status'}</th>
                    <th className="py-2 text-end">{isAr ? 'تحكم' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const isLowStock = p.stock_quantity <= p.low_stock_threshold;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-3 text-xs">
                          <span dir="ltr" className="inline-block px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono-num font-bold text-slate-800">
                            {p.product_code || p.id}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2.5">
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.name_ar}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-50"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 text-slate-400">
                                <ImagePlus className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 flex flex-wrap items-center gap-1.5">
                                <span>{p.name_ar}</span>
                                {(p.is_offer || (p.sale_price !== null && p.sale_price < p.base_price)) && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                                    {isAr ? 'في العروض ⭐' : 'In Offers'}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500">
                                {p.description}
                                {p.requires_prescription && (
                                  <span className="text-amber-700 font-medium ms-1">· {isAr ? 'بوصفة طبية' : 'Rx Required'}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-xs text-slate-600">
                          <div>{p.merchant_name}</div>
                          <div className="text-slate-400">{p.category_name}</div>
                        </td>
                        <td className="py-3 text-xs tabular-nums">
                          {p.sale_price !== null ? (
                            <div>
                              <span className="font-bold text-teal-700">{p.sale_price} ج.م</span>
                              <span className="line-through text-slate-400 ms-1.5">{p.base_price}</span>
                            </div>
                          ) : (
                            <span className="font-bold text-slate-900">{p.base_price} ج.م</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5 tabular-nums text-xs">
                            <button
                              onClick={() => handleAdjustStock(p, -1)}
                              className="w-6 h-6 border border-slate-200 rounded hover:bg-slate-100"
                            >
                              -
                            </button>
                            <span className={`px-1.5 font-semibold ${isLowStock ? 'text-red-600' : 'text-slate-900'}`}>
                              {p.stock_quantity}
                            </span>
                            <button
                              onClick={() => handleAdjustStock(p, 1)}
                              className="w-6 h-6 border border-slate-200 rounded hover:bg-slate-100"
                            >
                              +
                            </button>
                            {isLowStock && <span className="text-[11px] text-red-600">{isAr ? 'مخزون منخفض' : 'Low'}</span>}
                          </div>
                        </td>
                        <td className="py-3 text-xs">
                          <button
                            onClick={() => handleToggleProductAvail(p)}
                            className={`font-medium ${p.is_available ? 'text-teal-700' : 'text-slate-400'}`}
                          >
                            {p.is_available ? (isAr ? 'متاح' : 'Available') : isAr ? 'غير متاح' : 'Hidden'}
                          </button>
                        </td>
                        <td className="py-3 text-end">
                          <div className="flex items-center justify-end gap-2 text-xs">
                            <button
                              onClick={() => handleStartEditProduct(p)}
                              className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-100"
                            >
                              {isAr ? 'تعديل' : 'Edit'}
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(p)}
                              className="px-2.5 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50"
                            >
                              {isAr ? 'حذف' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'categories' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'تقسيم المتجر إلى أقسام بصور دائرية + قسم العروض' : 'Store Sections, Circular Photos & Offers'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {isAr
                ? 'أضف أقسام متجرك مع صورة دائرية لكل قسم لتظهر في شريط أفقي قابل للسحب داخل صفحة المتجر. أي منتج يوضع في قسم «العروض» يضاف تلقائيًا لصفحة العروض الرئيسية مع بقائه في قسمه.'
                : 'Add store sections with circular images for the horizontal store strip. Items in Offers auto-sync to the Main Offers tab.'}
            </p>
          </div>

          <form onSubmit={handleCreateCategory} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {!isMerchantPortal && (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">{isAr ? 'النطاق' : 'Scope'}</label>
                    <select
                      value={catForm.scope}
                      onChange={(e) => setCatForm({ ...catForm, scope: e.target.value as 'merchant' | 'pharmacy' | 'market' })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                    >
                      <option value="merchant">{isAr ? 'أقسام المتاجر والمطاعم' : 'Merchant Stores'}</option>
                      <option value="pharmacy">{isAr ? 'أقسام الصيدليات' : 'Pharmacy'}</option>
                      <option value="market">{isAr ? 'أقسام السوق C2C' : 'Market C2C'}</option>
                    </select>
                  </div>
                  {catForm.scope !== 'market' && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {isAr ? 'يتبع متجر محدد (أو عام للكل)' : 'Owner Merchant'}
                      </label>
                      <select
                        value={catForm.merchant_id}
                        onChange={(e) => setCatForm({ ...catForm, merchant_id: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                      >
                        <option value="">{isAr ? 'قسم عام لكل المتاجر' : 'Global Section'}</option>
                        {merchants.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.business_name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">{isAr ? 'اسم القسم بالعربية' : 'Arabic Name'}</label>
                <input
                  type="text"
                  required
                  placeholder={isAr ? 'مثال: لحوم ودواجن / العروض' : 'Section name'}
                  value={catForm.name_ar}
                  onChange={(e) => setCatForm({ ...catForm, name_ar: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">{isAr ? 'الاسم بالإنجليزية (اختياري)' : 'English Name'}</label>
                <input
                  type="text"
                  placeholder="Section EN"
                  value={catForm.name_en}
                  onChange={(e) => setCatForm({ ...catForm, name_en: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {catForm.image_url ? (
                <img
                  src={catForm.image_url}
                  alt={catForm.name_ar || 'Section'}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-full object-cover border-2 border-orange-400 shrink-0 bg-white"
                />
              ) : (
                <div className="w-11 h-11 rounded-full border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0">
                  <Tag className="w-4 h-4" />
                </div>
              )}
              <input
                type="text"
                dir="ltr"
                placeholder="رابط صورة القسم https://... أو ارفع صورة"
                value={catForm.image_url}
                onChange={(e) => setCatForm({ ...catForm, image_url: e.target.value })}
                className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono-num bg-white"
              />
              <label className="inline-flex items-center gap-1 px-3 py-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-900 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
                <Camera className="w-4 h-4 text-orange-600" />
                <span>{isAr ? 'تصوير' : 'Camera'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const dataUrl = await compressProductImage(file);
                      setCatForm((prev) => ({ ...prev, image_url: dataUrl }));
                    } catch (err) {
                      onNotify((err as Error).message);
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              <label className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
                <ImagePlus className="w-4 h-4 text-orange-600" />
                <span>{isAr ? 'صورة القسم' : 'Section Photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const dataUrl = await compressProductImage(file);
                      setCatForm((prev) => ({ ...prev, image_url: dataUrl }));
                    } catch (err) {
                      onNotify((err as Error).message);
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-2 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={catForm.is_offers_section}
                  onChange={(e) => setCatForm({ ...catForm, is_offers_section: e.target.checked })}
                />
                <span>{isAr ? 'قسم عروض (ربط تلقائي بالرئيسية)' : 'Offers Section'}</span>
              </label>
              <button
                type="submit"
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg whitespace-nowrap"
              >
                {isAr ? '+ إضافة القسم للمتجر' : '+ Add Section'}
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100">
            {visibleCategories.map((c) => {
              const ownerMerchant = c.merchant_id ? merchants.find((m) => m.id === c.merchant_id) : null;
              const canManageCat = !isMerchantPortal || c.merchant_id === lockedMerchantId;
              return (
                <div key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name_ar}
                        referrerPolicy="no-referrer"
                        className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-50"
                      />
                    ) : (
                      <div
                        className={`w-11 h-11 rounded-full border flex items-center justify-center shrink-0 ${
                          c.is_offers_section
                            ? 'bg-rose-50 border-rose-200 text-rose-600'
                            : 'bg-orange-50 border-orange-200 text-orange-600'
                        }`}
                      >
                        {c.is_offers_section ? <Percent className="w-4 h-4" /> : <Tag className="w-4 h-4" />}
                      </div>
                    )}

                    {editingCatId === c.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editingCatName}
                          onChange={(e) => setEditingCatName(e.target.value)}
                          className="px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                          placeholder={isAr ? 'اسم القسم' : 'Name'}
                        />
                        <input
                          type="text"
                          dir="ltr"
                          value={editingCatImage}
                          onChange={(e) => setEditingCatImage(e.target.value)}
                          className="px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono-num w-44"
                          placeholder="رابط الصورة"
                        />
                        <label className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-xs font-semibold cursor-pointer">
                          <ImagePlus className="w-3.5 h-3.5 text-orange-600" />
                          <span>{isAr ? 'رفع' : 'Upload'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const dataUrl = await compressProductImage(file);
                                setEditingCatImage(dataUrl);
                              } catch (err) {
                                onNotify((err as Error).message);
                              } finally {
                                e.target.value = '';
                              }
                            }}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-rose-700 font-semibold">
                          <input
                            type="checkbox"
                            checked={editingCatIsOffers}
                            onChange={(e) => setEditingCatIsOffers(e.target.checked)}
                          />
                          <span>{isAr ? 'قسم عروض' : 'Offers'}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleSaveCategoryEdit(c)}
                          className="px-2.5 py-1.5 bg-slate-900 text-white text-xs rounded font-semibold"
                        >
                          {isAr ? 'حفظ' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{c.name_ar}</span>
                          {c.is_offers_section && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                              {isAr ? 'قسم العروض (تلقائي بالرئيسية)' : 'Auto Offers'}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                            {ownerMerchant
                              ? ownerMerchant.business_name_ar
                              : c.scope === 'market'
                              ? isAr
                                ? 'السوق'
                                : 'Market'
                              : isAr
                              ? 'قسم عام'
                              : 'Global'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {canManageCat && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(c.id);
                            setEditingCatName(c.name_ar);
                            setEditingCatImage(c.image_url || '');
                            setEditingCatIsOffers(Boolean(c.is_offers_section));
                            setEditCategoryModalOpen(true);
                          }}
                          className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50"
                        >
                          {isAr ? 'تعديل / صورة' : 'Edit / Photo'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(c)}
                          className={`px-2.5 py-1 border rounded ${
                            c.is_active ? 'border-teal-200 text-teal-700' : 'border-slate-200 text-slate-500'
                          }`}
                        >
                          {c.is_active ? (isAr ? 'مفعّل' : 'Active') : isAr ? 'موقوف' : 'Paused'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(c)}
                          className="px-2.5 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50"
                        >
                          {isAr ? 'حذف' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL WINDOW */}
      {editProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSaveProduct(e);
              setEditProductModalOpen(false);
            }}
            className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Store className="w-4 h-4 text-orange-400" />
                <span>{isAr ? 'تعديل بيانات المنتج (نافذة مستقلة)' : 'Edit Product'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditProductModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'كود المنتج' : 'Code'}</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={productForm.product_code}
                    onChange={(e) => setProductForm({ ...productForm, product_code: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'اسم المنتج بالعربية' : 'Name (AR)'}</label>
                  <input
                    type="text"
                    required
                    value={productForm.name_ar}
                    onChange={(e) => setProductForm({ ...productForm, name_ar: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'السعر الأساسي (ج.م)' : 'Base Price'}</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={productForm.base_price}
                    onChange={(e) => setProductForm({ ...productForm, base_price: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'سعر الخصم/العرض' : 'Sale Price'}</label>
                  <input
                    type="number"
                    step="0.5"
                    value={productForm.sale_price}
                    onChange={(e) => setProductForm({ ...productForm, sale_price: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الكمية بالمخزون' : 'Stock'}</label>
                  <input
                    type="number"
                    value={productForm.stock_quantity}
                    onChange={(e) => setProductForm({ ...productForm, stock_quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الإضافات / الأحجام' : 'Addons'}</label>
                  <input
                    type="text"
                    value={productForm.addons_text}
                    onChange={(e) => setProductForm({ ...productForm, addons_text: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'وصف المنتج' : 'Description'}</label>
                  <input
                    type="text"
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'صورة المنتج' : 'Image URL'}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      value={productForm.image_url}
                      onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono-num"
                    />
                    <label className="inline-flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer shrink-0">
                      <ImagePlus className="w-4 h-4 text-orange-600" />
                      <span>{isAr ? 'رفع' : 'Upload'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const dataUrl = await compressProductImage(file);
                            setProductForm((prev) => ({ ...prev, image_url: dataUrl }));
                          } catch (err) {
                            onNotify((err as Error).message);
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.requires_prescription}
                    onChange={(e) => setProductForm({ ...productForm, requires_prescription: e.target.checked })}
                  />
                  {isAr ? 'يتطلب روشتة طبية' : 'Requires Rx'}
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.is_available}
                    onChange={(e) => setProductForm({ ...productForm, is_available: e.target.checked })}
                  />
                  {isAr ? 'متاح للبيع' : 'Available'}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.is_offer}
                    onChange={(e) => setProductForm({ ...productForm, is_offer: e.target.checked })}
                  />
                  <Percent className="w-3.5 h-3.5 shrink-0" />
                  <span>{isAr ? 'إضافة لقسم العروض' : 'Add to Offers'}</span>
                </label>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditProductModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold"
              >
                {isAr ? 'حفظ تعديلات المنتج' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT CATEGORY MODAL WINDOW */}
      {editCategoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const c = categories.find((x) => x.id === editingCatId);
              if (c) {
                await handleSaveCategoryEdit(c);
              }
              setEditCategoryModalOpen(false);
            }}
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Tag className="w-4 h-4 text-orange-400" />
                <span>{isAr ? 'تعديل بيانات القسم (نافذة مستقلة)' : 'Edit Category'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditCategoryModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'اسم القسم بالعربية' : 'Arabic Name'}
                </label>
                <input
                  type="text"
                  required
                  value={editingCatName}
                  onChange={(e) => setEditingCatName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'صورة القسم (رابط أو رفع)' : 'Image URL'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    value={editingCatImage}
                    onChange={(e) => setEditingCatImage(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono-num"
                    placeholder="https://..."
                  />
                  <label className="inline-flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer shrink-0">
                    <ImagePlus className="w-4 h-4 text-orange-600" />
                    <span>رفع</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const dataUrl = await compressProductImage(file);
                          setEditingCatImage(dataUrl);
                        } catch (err) {
                          onNotify((err as Error).message);
                        } finally {
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2.5 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingCatIsOffers}
                  onChange={(e) => setEditingCatIsOffers(e.target.checked)}
                />
                <span>{isAr ? 'قسم عروض (ربط تلقائي بالرئيسية)' : 'Offers Section'}</span>
              </label>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditCategoryModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                حفظ التعديلات
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
