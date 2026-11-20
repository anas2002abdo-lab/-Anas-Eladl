import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertCircle, ImagePlus, Trash2, Camera, Store, Tag, Percent, X, FolderTree, Plus, CornerDownLeft } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CategoryRecord, Language, MerchantRecord, ProductRecord } from '../shared/types.ts';
import { MerchantMasterLinkPanel } from './MerchantMasterLinkPanel.tsx';
import { CategoryPathPicker } from './CategoryPathPicker.tsx';

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
  const [productPage, setProductPage] = useState<number>(1);
  const [productsTotal, setProductsTotal] = useState<number>(0);
  const [productsTotalPages, setProductsTotalPages] = useState<number>(1);
  const [loadingProducts, setLoadingProducts] = useState<boolean>(false);

  const [merchantFilter, setMerchantFilter] = useState<string>(lockedMerchantId || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProductModalOpen, setEditProductModalOpen] = useState<boolean>(false);
  const [editCategoryModalOpen, setEditCategoryModalOpen] = useState<boolean>(false);

  // Store Photo state
  const [photoMerchantId, setPhotoMerchantId] = useState<string>(
    lockedMerchantId || merchants[0]?.id || ''
  );
  const [storeImageUrl, setStoreImageUrl] = useState<string>('');
  const [storePhotoDirty, setStorePhotoDirty] = useState<boolean>(false);
  const lastPhotoMerchantIdRef = useRef<string>('');
  const [savingStorePhoto, setSavingStorePhoto] = useState<boolean>(false);

  const [importMerchantId, setImportMerchantId] = useState<string>(
    lockedMerchantId || merchants[0]?.id || ''
  );
  const [parsedExcelRows, setParsedExcelRows] = useState<ParsedExcelProductRow[]>([]);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importingExcel, setImportingExcel] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importSummary, setImportSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    categories_created: number;
    errors: string[];
  } | null>(null);

  const [productForm, setProductForm] = useState({
    product_code: '',
    merchant_id: lockedMerchantId || merchants[0]?.id || '',
    category_id: 'cat_grocery',
    category_path: '',
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
    parent_id: '',
    path_ar: '',
    name_ar: '',
    name_en: '',
    image_url: '',
    sort_order: 1,
    is_offers_section: false,
  });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState<string>('');
  const [editingCatParentId, setEditingCatParentId] = useState<string>('');
  const [editingCatImage, setEditingCatImage] = useState<string>('');
  const [editingCatIsOffers, setEditingCatIsOffers] = useState<boolean>(false);
  const [importingCatsExcel, setImportingCatsExcel] = useState<boolean>(false);
  const catFormRef = useRef<HTMLFormElement | null>(null);

  const loadCatalog = async (opts?: { page?: number; search?: string; merchant?: string }) => {
    const targetPage = opts?.page ?? productPage;
    const targetSearch = opts?.search !== undefined ? opts.search : debouncedSearch;
    const targetMerchant = opts?.merchant !== undefined ? opts.merchant : lockedMerchantId || merchantFilter;
    setLoadingProducts(true);
    try {
      const [prodRes, cats] = await Promise.all([
        api.getProductsPaginated({
          merchant_id: targetMerchant !== 'all' ? targetMerchant : undefined,
          q: targetSearch || undefined,
          page: targetPage,
          limit: 60,
        }),
        api.getCategories(),
      ]);
      setProducts(prodRes.items || []);
      setProductsTotal(prodRes.total || 0);
      setProductsTotalPages(prodRes.total_pages || 1);
      setCategories(cats);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setProductPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    loadCatalog({ page: productPage, search: debouncedSearch, merchant: lockedMerchantId || merchantFilter });
  }, [productPage, debouncedSearch, merchantFilter, lockedMerchantId]);

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
    if (!lockedMerchantId && merchants.length > 0) {
      if (!photoMerchantId || !merchants.some((m) => m.id === photoMerchantId)) {
        setPhotoMerchantId(merchants[0].id);
      }
      if (!importMerchantId || !merchants.some((m) => m.id === importMerchantId)) {
        setImportMerchantId(merchants[0].id);
      }
      setProductForm((prev) =>
        prev.merchant_id && merchants.some((m) => m.id === prev.merchant_id)
          ? prev
          : { ...prev, merchant_id: merchants[0].id }
      );
    }
  }, [lockedMerchantId, merchants, photoMerchantId, importMerchantId]);

  useEffect(() => {
    const merchantChanged = lastPhotoMerchantIdRef.current !== photoMerchantId;
    if (!merchantChanged && storePhotoDirty) {
      // Never wipe out an unsaved/recently uploaded store image when merchants list polls in the background
      return;
    }
    lastPhotoMerchantIdRef.current = photoMerchantId;
    const targetMer =
      merchants.find((m) => m.id === photoMerchantId) ||
      (merchantSession && merchantSession.id === photoMerchantId ? merchantSession : undefined);
    setStoreImageUrl(targetMer?.image_url || '');
    if (merchantChanged) {
      setStorePhotoDirty(false);
    }
  }, [photoMerchantId, merchants, merchantSession, storePhotoDirty]);

  const resetProductForm = () => {
    setEditingId(null);
    const defaultMerId = lockedMerchantId || merchants[0]?.id || '';
    setProductForm({
      product_code: '',
      merchant_id: defaultMerId,
      category_id:
        categories.find((c) => c.scope !== 'market' && (!c.merchant_id || c.merchant_id === defaultMerId))?.id ||
        'cat_grocery',
      category_path: '',
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

  const handleSaveStorePhoto = async (overrideImageUrl?: string) => {
    const targetMerchantId = lockedMerchantId || photoMerchantId || merchants[0]?.id || '';
    if (!targetMerchantId) {
      onNotify(isAr ? 'يرجى اختيار المتجر أولًا' : 'Please select a store first');
      return;
    }
    const nextUrl = (overrideImageUrl !== undefined ? overrideImageUrl : storeImageUrl).trim();
    setSavingStorePhoto(true);
    try {
      const res = (await api.updateMerchant(targetMerchantId, {
        image_url: nextUrl,
      })) as { ok: boolean; merchant?: MerchantRecord };
      const persistedUrl = res?.merchant?.image_url ?? nextUrl;
      setStoreImageUrl(persistedUrl);
      if (res?.merchant && onMerchantUpdated) {
        onMerchantUpdated(res.merchant);
      }
      if (onRefreshCore) {
        await onRefreshCore();
      }
      setStorePhotoDirty(false);
      onNotify(
        nextUrl
          ? isAr
            ? 'تم حفظ صورة المتجر بنجاح وستظهر كأيقونة دائرية في صفحة المتاجر'
            : 'Store image updated successfully'
          : isAr
          ? 'تم إزالة صورة المتجر بنجاح'
          : 'Store image removed'
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
      category_path: '',
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
    const catPathById = new Map(categories.map((c) => [c.id, c.excel_path || c.full_path_ar || `${c.name_ar};`]));
    const sheetRows = sourceList.map((p) => ({
      'كود المنتج': p.product_code || p.id,
      'اسم المنتج': p.name_ar,
      'سعر المنتج': p.sale_price !== null && p.sale_price !== undefined ? p.sale_price : p.base_price,
      'قسم المنتج': p.category_path || catPathById.get(p.category_id) || (p.category_name ? `${p.category_name};` : ''),
      'صورة المنتج': p.image_url || '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ['كود المنتج', 'اسم المنتج', 'سعر المنتج', 'قسم المنتج', 'صورة المنتج'],
    });
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 38 }, { wch: 42 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المنتجات');
    XLSX.writeFile(wb, `otlobha-products-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(isAr ? `تم تصدير ${sheetRows.length} منتج (شامل مسار الأقسام وصور المنتجات) إلى Excel بنجاح` : `Exported ${sheetRows.length} products`);
  };

  const handleDownloadExcelTemplate = () => {
    const sampleRows = [
      {
        'كود المنتج': 'PRD-2001',
        'اسم المنتج': 'كرواسون بالزبدة مولتو 80 جرام',
        'سعر المنتج': 18,
        'قسم المنتج': 'سوبر ماركت > مخبوزات > كرواسون وكيك;',
        'صورة المنتج': '',
      },
      {
        'كود المنتج': 'PRD-2002',
        'اسم المنتج': 'لبن كامل الدسم 1 لتر',
        'سعر المنتج': 44,
        'قسم المنتج': 'سوبر ماركت > ألبان ومنتجاتها > الألبان والبيض;',
        'صورة المنتج': '',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, {
      header: ['كود المنتج', 'اسم المنتج', 'سعر المنتج', 'قسم المنتج', 'صورة المنتج'],
    });
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 38 }, { wch: 42 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'نموذج المنتجات');
    XLSX.writeFile(wb, 'otlobha-products-template.xlsx');
    onNotify(isAr ? 'تم تحميل نموذج Excel الجاهز بمسار الأقسام (سوبر ماركت > مخبوزات > كرواسون وكيك;)' : 'Downloaded Excel template');
  };

  const handleDownloadCategoriesExcelTemplate = () => {
    const sampleRows = [
      { 'مسار القسم': 'سوبر ماركت > مخبوزات > كرواسون وكيك;', 'صورة القسم': '' },
      { 'مسار القسم': 'سوبر ماركت > مخبوزات > خبز وفينو;', 'صورة القسم': '' },
      { 'مسار القسم': 'سوبر ماركت > ألبان ومنتجاتها > الألبان والبيض;', 'صورة القسم': '' },
      { 'مسار القسم': 'سوبر ماركت > مشروبات ساخنة > القهوة والشاي;', 'صورة القسم': '' },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: ['مسار القسم', 'صورة القسم'] });
    ws['!cols'] = [{ wch: 46 }, { wch: 36 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'شجرة الأقسام');
    XLSX.writeFile(wb, 'otlobha-categories-tree-template.xlsx');
    onNotify(isAr ? 'تم تحميل نموذج Excel الجاهز لشجرة الأقسام الرئيسية والفرعية' : 'Downloaded categories template');
  };

  const handleExportCategoriesExcel = () => {
    const rows = visibleCategories.map((c) => ({
      'مسار القسم': c.excel_path || c.full_path_ar || `${c.name_ar};`,
      'اسم القسم': c.name_ar,
      'المستوى': (c.level || 0) === 0 ? 'رئيسي' : `فرعي (${c.level})`,
      'صورة القسم': c.image_url || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['مسار القسم', 'اسم القسم', 'المستوى', 'صورة القسم'] });
    ws['!cols'] = [{ wch: 46 }, { wch: 24 }, { wch: 14 }, { wch: 38 }];
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'شجرة الأقسام');
    XLSX.writeFile(wb, `otlobha-categories-tree-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(isAr ? `تم تصدير ${rows.length} قسم (بالصيغة الهرمية) إلى Excel بنجاح` : `Exported ${rows.length} categories`);
  };

  const handleImportCategoriesExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingCatsExcel(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
      const isOle = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
      let wb: XLSX.WorkBook;
      if (isZip || isOle) {
        wb = XLSX.read(bytes, { type: 'array', raw: false });
      } else {
        let txt = new TextDecoder('utf-8').decode(bytes);
        if (txt.includes('\uFFFD')) {
          try {
            txt = new TextDecoder('windows-1256').decode(bytes);
          } catch {
            // keep utf-8
          }
        }
        wb = XLSX.read(txt, { type: 'string', raw: false });
      }
      const rowsToImport: Array<{ path: string; image_url?: string }> = [];
      const pathKeys = ['مسار القسم', 'القسم', 'قسم المنتج', 'التصنيف', 'category', 'category path', 'path'].map(normalizeSpreadsheetHeader);
      const imgKeys = ['صوره القسم', 'رابط الصوره', 'الصوره', 'image', 'image url'].map(normalizeSpreadsheetHeader);

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        if (!matrix.length) continue;

        let headerIdx = -1;
        let colPath = 0;
        let colImg = -1;
        for (let r = 0; r < Math.min(matrix.length, 6); r++) {
          const norm = (matrix[r] || []).map(normalizeSpreadsheetHeader);
          const pIdx = norm.findIndex((h) => h && pathKeys.some((k) => h === k || h.includes(k)));
          if (pIdx >= 0) {
            headerIdx = r;
            colPath = pIdx;
            colImg = norm.findIndex((h) => h && imgKeys.some((k) => h === k || h.includes(k)));
            break;
          }
        }
        for (let r = headerIdx + 1; r < matrix.length; r++) {
          const row = matrix[r] || [];
          const rawPath = String(row[colPath] ?? '').trim();
          if (!rawPath) continue;
          const img = colImg >= 0 ? String(row[colImg] ?? '').trim() : '';
          rowsToImport.push({ path: rawPath, image_url: img });
        }
        if (rowsToImport.length > 0) break;
      }

      if (rowsToImport.length === 0) {
        onNotify(isAr ? 'لم يتم العثور على مسارات أقسام صالحة داخل الملف.' : 'No valid category paths found');
        return;
      }

      const res = await api.importCategoriesExcel({
        rows: rowsToImport,
        scope: catForm.scope,
        merchant_id: lockedMerchantId || catForm.merchant_id || null,
      });
      await loadCatalog();
      onNotify(
        isAr
          ? `تم استيراد شجرة الأقسام: معالجة ${res.processed_paths} مسار وإنشاء ${res.created_count} قسم رئيسي/فرعي جديد`
          : `Imported ${res.created_count} categories`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setImportingCatsExcel(false);
      e.target.value = '';
    }
  };

  const normalizeSpreadsheetHeader = (raw: unknown): string => {
    return String(raw ?? '')
      .replace(/[\u064B-\u065F\u0670\u0640\uFEFF]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[_\-/\\()[\]:;.,]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const parseSpreadsheetPrice = (raw: unknown): number => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const digitMap: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
      '٫': '.', '٬': '',
    };
    const normalized = String(raw ?? '')
      .replace(/[٠-٩۰-۹٫٬]/g, (ch) => digitMap[ch] ?? ch)
      .replace(/,/g, '.')
      .replace(/[^\d.-]/g, '');
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const MAX_EXCEL_IMPORT_ROWS = 10000;
  const EXCEL_IMPORT_BATCH_SIZE = 1000;

  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSummary(null);
    setImportProgress(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const lowerName = file.name.toLowerCase();

      // Detect text-based spreadsheets (CSV, TSV, TXT, HTML-table .xls from POS/ERP, SpreadsheetML .xml)
      // so Arabic UTF-8 and Windows-1256 encodings both decode cleanly without mojibake.
      const isZipMagic = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // PK (xlsx/xlsm/xlsb/ods)
      const isOleMagic = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; // OLE2 (.xls)
      const looksTextBased =
        !isZipMagic &&
        !isOleMagic &&
        (lowerName.endsWith('.csv') ||
          lowerName.endsWith('.tsv') ||
          lowerName.endsWith('.txt') ||
          lowerName.endsWith('.html') ||
          lowerName.endsWith('.htm') ||
          lowerName.endsWith('.xml') ||
          lowerName.endsWith('.xls'));

      let wb: XLSX.WorkBook;
      if (looksTextBased) {
        const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const hasMojibake = utf8Text.includes('\uFFFD');
        let decodedText = utf8Text;
        if (hasMojibake) {
          try {
            decodedText = new TextDecoder('windows-1256').decode(bytes);
          } catch {
            decodedText = utf8Text;
          }
        }
        const trimmedStart = decodedText.trimStart().toLowerCase();
        if (trimmedStart.startsWith('<html') || trimmedStart.startsWith('<!doctype') || trimmedStart.includes('<table')) {
          const doc = new DOMParser().parseFromString(decodedText, 'text/html');
          const table = doc.querySelector('table');
          wb = table ? XLSX.utils.table_to_book(table) : XLSX.read(decodedText, { type: 'string', raw: false });
        } else {
          // Normalize semicolon-delimited CSV (common in Arabic Windows Excel exports)
          const firstLine = decodedText.split(/\r?\n/)[0] || '';
          const semiCount = (firstLine.match(/;/g) || []).length;
          const commaCount = (firstLine.match(/,/g) || []).length;
          const tabCount = (firstLine.match(/\t/g) || []).length;
          const fs = tabCount > semiCount && tabCount > commaCount ? '\t' : semiCount > commaCount ? ';' : ',';
          wb = XLSX.read(decodedText, { type: 'string', FS: fs, raw: false });
        }
      } else {
        wb = XLSX.read(bytes, { type: 'array', codepage: 1256, raw: false });
      }

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        onNotify(isAr ? 'ملف الإكسل فارغ' : 'Empty workbook');
        return;
      }

      const codeKeys = [
        'كود المنتج', 'كود الصنف', 'رقم الصنف', 'رقم المنتج', 'الباركود', 'باركود', 'الكود', 'كود', 'الرمز', 'رمز',
        'product code', 'item code', 'code', 'sku', 'barcode', 'bar code', 'id',
      ].map(normalizeSpreadsheetHeader);
      const nameKeys = [
        'اسم المنتج', 'اسم الصنف', 'اسم الدواء', 'الصنف', 'المنتج', 'الاسم', 'البيان', 'الوصف', 'اسم',
        'name ar', 'product name', 'item name', 'item', 'product', 'title', 'name', 'description',
      ].map(normalizeSpreadsheetHeader);
      const priceKeys = [
        'سعر المنتج', 'سعر الصنف', 'سعر البيع', 'سعر الجمهور', 'السعر', 'سعر', 'الثمن', 'التكلفه', 'القيمه',
        'base price', 'selling price', 'unit price', 'sale price', 'retail price', 'price', 'cost', 'amount',
      ].map(normalizeSpreadsheetHeader);
      const catKeys = [
        'قسم المنتج', 'قسم الصنف', 'القسم', 'قسم', 'التصنيف', 'تصنيف', 'المجموعه', 'مجموعه', 'الفئه', 'فئه', 'النوع', 'الشركه',
        'category name', 'category', 'section', 'group', 'department', 'type',
      ].map(normalizeSpreadsheetHeader);
      const imageKeys = [
        'صوره المنتج', 'صوره الصنف', 'الصوره', 'صوره', 'رابط الصوره', 'image url', 'image', 'photo', 'img', 'picture', 'url',
      ].map(normalizeSpreadsheetHeader);

      const matchCol = (headers: string[], keys: string[], used: Set<number>): number => {
        for (const key of keys) {
          const exactIdx = headers.findIndex((h, i) => !used.has(i) && h === key);
          if (exactIdx >= 0) return exactIdx;
        }
        for (const key of keys) {
          const partialIdx = headers.findIndex((h, i) => !used.has(i) && h.length > 0 && (h.includes(key) || key.includes(h)));
          if (partialIdx >= 0) return partialIdx;
        }
        return -1;
      };

      let parsed: ParsedExcelProductRow[] = [];

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        const nonEmptyRows = matrix.filter(
          (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
        );
        if (nonEmptyRows.length === 0) continue;

        // Auto-detect header row anywhere in the first 10 non-empty rows (handles title/banner rows)
        let headerRowIdx = -1;
        let colCode = -1;
        let colName = -1;
        let colPrice = -1;
        let colCat = -1;
        let colImg = -1;

        const maxScan = Math.min(10, nonEmptyRows.length);
        for (let rIdx = 0; rIdx < maxScan; rIdx++) {
          const normHeaders = nonEmptyRows[rIdx].map(normalizeSpreadsheetHeader);
          const used = new Set<number>();
          const nIdx = matchCol(normHeaders, nameKeys, used);
          if (nIdx >= 0) used.add(nIdx);
          const pIdx = matchCol(normHeaders, priceKeys, used);
          if (pIdx >= 0) used.add(pIdx);
          const cIdx = matchCol(normHeaders, codeKeys, used);
          if (cIdx >= 0) used.add(cIdx);
          const catIdx = matchCol(normHeaders, catKeys, used);
          if (catIdx >= 0) used.add(catIdx);
          const imgIdx = matchCol(normHeaders, imageKeys, used);
          if (imgIdx >= 0) used.add(imgIdx);

          const matchedCount = [nIdx, pIdx, cIdx, catIdx, imgIdx].filter((i) => i >= 0).length;
          if (nIdx >= 0 || matchedCount >= 2) {
            headerRowIdx = rIdx;
            colName = nIdx;
            colPrice = pIdx;
            colCode = cIdx;
            colCat = catIdx;
            colImg = imgIdx;
            break;
          }
        }

        // Positional fallback for headerless Excel/CSV sheets (e.g. [اسم, سعر] or [كود, اسم, سعر, قسم])
        let dataStartIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
        if (headerRowIdx < 0) {
          const sampleRows = nonEmptyRows.slice(0, Math.min(20, nonEmptyRows.length));
          const maxCols = Math.max(...sampleRows.map((r) => r.length));
          if (maxCols === 1) {
            colName = 0;
          } else {
            // Find the most numeric column for Price, and the longest text column for Name
            let bestPriceCol = -1;
            let bestPriceScore = 0;
            let bestNameCol = -1;
            let bestNameScore = 0;
            for (let c = 0; c < maxCols; c++) {
              let numericHits = 0;
              let textLenSum = 0;
              let nonEmptyCount = 0;
              for (const row of sampleRows) {
                const rawVal = String(row[c] ?? '').trim();
                if (!rawVal) continue;
                nonEmptyCount++;
                const cleanedNum = rawVal
                  .replace(/[٠-٩۰-۹]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(ch) % 10))
                  .replace(/[,٫\s]/g, '');
                if (/^\d+(\.\d+)?$/.test(cleanedNum) && Number(cleanedNum) < 1000000) {
                  numericHits++;
                } else {
                  textLenSum += rawVal.length;
                }
              }
              const numericRatio = nonEmptyCount > 0 ? numericHits / nonEmptyCount : 0;
              if (numericRatio >= 0.6 && numericHits > bestPriceScore) {
                bestPriceScore = numericHits;
                bestPriceCol = c;
              }
              if (numericRatio < 0.5 && textLenSum > bestNameScore) {
                bestNameScore = textLenSum;
                bestNameCol = c;
              }
            }
            colName = bestNameCol >= 0 ? bestNameCol : 0;
            colPrice = bestPriceCol >= 0 && bestPriceCol !== colName ? bestPriceCol : (maxCols > 1 && colName === 0 ? 1 : -1);
            for (let c = 0; c < maxCols; c++) {
              if (c === colName || c === colPrice) continue;
              if (colCode < 0 && c < colName) {
                colCode = c;
              } else if (colCat < 0) {
                colCat = c;
              } else if (colImg < 0) {
                colImg = c;
              }
            }
          }
          dataStartIdx = 0;
        }

        const candidateRows: ParsedExcelProductRow[] = [];
        for (let rIdx = dataStartIdx; rIdx < nonEmptyRows.length; rIdx++) {
          const row = nonEmptyRows[rIdx];
          const code = colCode >= 0 ? String(row[colCode] ?? '').trim() : '';
          const nameAr = colName >= 0 ? String(row[colName] ?? '').trim() : '';
          const priceVal = colPrice >= 0 ? parseSpreadsheetPrice(row[colPrice]) : 0;
          const catName = colCat >= 0 ? String(row[colCat] ?? '').trim() : '';
          const imageUrl = colImg >= 0 ? String(row[colImg] ?? '').trim() : '';
          if (nameAr.length > 0) {
            candidateRows.push({
              product_code: code,
              name_ar: nameAr,
              price: priceVal,
              category_name: catName,
              image_url: imageUrl,
            });
          }
        }

        if (candidateRows.length > 0) {
          parsed = candidateRows;
          break;
        }
      }

      if (parsed.length === 0) {
        onNotify(
          isAr
            ? 'لم يتم العثور على صفوف أصناف صالحة داخل الملف. تأكد من وجود عمود لاسم الصنف أو المنتج.'
            : 'No valid product rows found in spreadsheet'
        );
        return;
      }

      if (parsed.length > MAX_EXCEL_IMPORT_ROWS) {
        onNotify(
          isAr
            ? `الملف يحتوي على ${parsed.length.toLocaleString('ar-EG')} صنف، والحد الأقصى للاستيراد هو 10,000 صنف. سيتم تجهيز أول 10,000 صنف فقط.`
            : `File has ${parsed.length} rows; trimmed to maximum 10,000 rows.`
        );
        parsed = parsed.slice(0, MAX_EXCEL_IMPORT_ROWS);
      }

      setImportFileName(file.name);
      setParsedExcelRows(parsed);
      onNotify(
        isAr
          ? `تمت قراءة ${parsed.length.toLocaleString('ar-EG')} صنف من الملف (${file.name}) — اضغط تأكيد الاستيراد`
          : `Parsed ${parsed.length} rows from ${file.name}`
      );
    } catch (err) {
      onNotify(isAr ? `تعذر قراءة الملف: ${(err as Error).message}` : (err as Error).message);
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmExcelImport = async () => {
    if (parsedExcelRows.length === 0) return;
    const targetMerId = lockedMerchantId || importMerchantId || merchants[0]?.id || '';
    if (!targetMerId) {
      onNotify(isAr ? 'يرجى اختيار المتجر المستهدف أولًا' : 'Please select target merchant');
      return;
    }
    setImportingExcel(true);
    setImportProgress({ done: 0, total: parsedExcelRows.length });

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalCatsCreated = 0;
    const combinedErrors: string[] = [];

    try {
      for (let offset = 0; offset < parsedExcelRows.length; offset += EXCEL_IMPORT_BATCH_SIZE) {
        const chunk = parsedExcelRows.slice(offset, offset + EXCEL_IMPORT_BATCH_SIZE);
        const res = await api.importProductsExcel({
          merchant_id: targetMerId,
          rows: chunk,
        });
        totalCreated += Number(res.created || 0);
        totalUpdated += Number(res.updated || 0);
        totalSkipped += Number(res.skipped || 0);
        totalCatsCreated += Number(res.categories_created || 0);
        if (Array.isArray(res.errors) && combinedErrors.length < 30) {
          combinedErrors.push(...res.errors.slice(0, 30 - combinedErrors.length));
        }
        setImportProgress({
          done: Math.min(offset + chunk.length, parsedExcelRows.length),
          total: parsedExcelRows.length,
        });
      }

      setImportSummary({
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
        categories_created: totalCatsCreated,
        errors: combinedErrors,
      });
      setParsedExcelRows([]);
      setImportFileName('');
      await loadCatalog();
      onNotify(
        isAr
          ? `تم استيراد Excel: ${totalCreated} منتج جديد، ${totalUpdated} محدّث، ${totalCatsCreated} قسم جديد`
          : `Imported: ${totalCreated} created, ${totalUpdated} updated`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setImportingExcel(false);
      setImportProgress(null);
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
    const hasPath = catForm.path_ar.trim().length > 0;
    const hasName = catForm.name_ar.trim().length > 0;
    if (!hasPath && !hasName) {
      onNotify(isAr ? 'أدخل اسم القسم أو المسار الهرمي الكامل (مثل: سوبر ماركت > مخبوزات > كرواسون وكيك;)' : 'Enter category name or hierarchy path');
      return;
    }
    try {
      const res = await api.createCategory({
        scope: catForm.scope,
        merchant_id: lockedMerchantId || catForm.merchant_id || null,
        parent_id: hasPath ? null : catForm.parent_id || null,
        path_ar: hasPath ? catForm.path_ar.trim() : undefined,
        name_ar: catForm.name_ar.trim(),
        name_en: catForm.name_en.trim(),
        image_url: catForm.image_url,
        sort_order: catForm.sort_order,
        is_offers_section: catForm.is_offers_section,
      });
      setCatForm((prev) => ({
        ...prev,
        parent_id: '',
        path_ar: '',
        name_ar: '',
        name_en: '',
        image_url: '',
        is_offers_section: false,
      }));
      await loadCatalog();
      onNotify(
        res.created_count && res.created_count > 1
          ? isAr
            ? `تم إنشاء المسار الهرمي بنجاح (${res.created_count} أقسام رئيسية وفرعية)`
            : `Created ${res.created_count} hierarchical categories`
          : isAr
          ? 'تمت إضافة القسم بنجاح ضمن شجرة الأقسام'
          : 'Category created'
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleSaveCategoryEdit = async (c: CategoryRecord) => {
    try {
      await api.updateCategory(c.id, {
        name_ar: editingCatName,
        parent_id: editingCatParentId || null,
        image_url: editingCatImage,
        is_offers_section: editingCatIsOffers,
      });
      setEditingCatId(null);
      await loadCatalog();
      onNotify(isAr ? 'تم تحديث بيانات القسم وترتيبه الهرمي بنجاح' : 'Category updated');
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

  // Server already filters by merchant_id and FTS5 search query and paginates (60 per page)
  const filteredProducts = products;

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
      {(lockedMerchantId || photoMerchantId) && (
        <MerchantMasterLinkPanel
          merchantId={lockedMerchantId || photoMerchantId}
          categories={categories}
          merchantProducts={products.filter((p) => p.merchant_id === (lockedMerchantId || photoMerchantId))}
          onRefresh={() => {
            void loadCatalog({ page: productPage, search: debouncedSearch, merchant: lockedMerchantId || merchantFilter });
            if (onRefreshCore) void onRefreshCore();
          }}
          onToast={onNotify}
        />
      )}
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
            onChange={(e) => {
              setStorePhotoDirty(true);
              setStoreImageUrl(e.target.value);
            }}
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
                  setStorePhotoDirty(true);
                  setStoreImageUrl(dataUrl);
                  await handleSaveStorePhoto(dataUrl);
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
                  setStorePhotoDirty(true);
                  setStoreImageUrl(dataUrl);
                  await handleSaveStorePhoto(dataUrl);
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
              disabled={savingStorePhoto}
              onClick={() => {
                setStorePhotoDirty(true);
                setStoreImageUrl('');
                handleSaveStorePhoto('');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 rounded-lg text-xs font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isAr ? 'حذف' : 'Remove'}</span>
            </button>
          )}
          <button
            type="button"
            disabled={savingStorePhoto}
            onClick={() => handleSaveStorePhoto()}
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
              ? `المنتجات والأسعار والمخزون (${productsTotal.toLocaleString('en-US')})`
              : `Products & Inventory (${productsTotal.toLocaleString('en-US')})`}
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
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الاسم بالإنجليزية (اختياري)' : 'Product Name (EN)'}</label>
                <input
                  type="text"
                  placeholder="Product EN"
                  value={productForm.name_en}
                  onChange={(e) => setProductForm({ ...productForm, name_en: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <CategoryPathPicker
                  categories={storeCats}
                  valueCategoryId={productForm.category_id}
                  valueCategoryPath={productForm.category_path}
                  isAr={isAr}
                  label={isAr ? 'مسار الصنف في الأقسام (رئيسي ← فرعي ← القسم الأخير)' : 'Item Category Path (Main > Sub > Leaf)'}
                  onChange={({ category_id, category_path, pickedCategory }) => {
                    setProductForm((prev) => ({
                      ...prev,
                      category_id,
                      category_path,
                      is_offer: pickedCategory?.is_offers_section ? true : prev.is_offer,
                    }));
                  }}
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
                    {isAr ? 'استيراد وتصدير المنتجات عبر جميع صيغ Excel والجداول (حتى 10,000 صنف)' : 'Universal Excel & Spreadsheet Import/Export (Up to 10,000 Items)'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? 'يقبل جميع صيغ الإكسل (.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv, .xml) مع تعرّف تلقائي ذكي على الأعمدة وسقف استيراد حتى 10,000 صنف'
                      : 'Supports all spreadsheet formats (.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv, .xml) up to 10,000 items'}
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
                  <span>
                    {importFileName
                      ? `تم اختيار: ${importFileName}`
                      : isAr
                      ? 'اختر أي ملف Excel / CSV / ODS (حتى 10,000 صنف)'
                      : 'Choose any Excel / CSV / ODS File'}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm,.xlt,.ods,.fods,.csv,.tsv,.txt,.xml,.html,.htm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.oasis.opendocument.spreadsheet,text/csv,text/tab-separated-values,text/plain"
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
                    ? importProgress
                      ? isAr
                        ? `جاري الاستيراد (${importProgress.done}/${importProgress.total})...`
                        : `Importing (${importProgress.done}/${importProgress.total})...`
                      : isAr
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
                    onChange={(e) => {
                      setMerchantFilter(e.target.value);
                      setProductPage(1);
                    }}
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
                          <div className="text-slate-400">
                            {p.category_path ? p.category_path.replace(/;\s*$/, '') : p.category_name}
                          </div>
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

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
              <div className="tabular-nums">
                {loadingProducts
                  ? isAr
                    ? 'جاري تحميل الأصناف...'
                    : 'Loading products...'
                  : isAr
                  ? `عرض ${filteredProducts.length} صنف · صفحة ${productPage} من ${productsTotalPages} (الإجمالي: ${productsTotal.toLocaleString('en-US')} صنف)`
                  : `Showing ${filteredProducts.length} items · Page ${productPage} of ${productsTotalPages} (Total: ${productsTotal.toLocaleString('en-US')})`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={productPage <= 1 || loadingProducts}
                  onClick={() => setProductPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-40"
                >
                  {isAr ? 'السابق' : 'Prev'}
                </button>
                <span className="px-2 py-1 bg-slate-100 rounded-md font-bold tabular-nums text-slate-800">
                  {productPage} / {productsTotalPages}
                </span>
                <button
                  type="button"
                  disabled={productPage >= productsTotalPages || loadingProducts}
                  onClick={() => setProductPage((p) => Math.min(productsTotalPages, p + 1))}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-40"
                >
                  {isAr ? 'التالي' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'categories' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-[#A92224]" />
                <span>{isAr ? 'شجرة الأقسام الرئيسية والفرعية (متعددة المستويات) + Excel' : 'Hierarchical Main & Subcategories Tree + Excel'}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                {isAr
                  ? 'أنشئ أقسامًا رئيسية وأقسامًا فرعية بأي عمق، أو اكتب المسار مباشرة بصيغة Excel من الرئيسي إلى آخر فرعي:'
                  : 'Create multi-level main & subcategories or import directly using Excel path syntax:'}{' '}
                <code className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[#A92224] font-bold">
                  سوبر ماركت &gt; مخبوزات &gt; كرواسون وكيك;
                </code>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadCategoriesExcelTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? 'نموذج Excel للأقسام' : 'Template'}</span>
              </button>
              <button
                type="button"
                onClick={handleExportCategoriesExcel}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{isAr ? 'تصدير الشجرة Excel' : 'Export Tree'}</span>
              </button>
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#A92224] hover:bg-[#86191B] text-white rounded-lg text-xs font-bold cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{importingCatsExcel ? (isAr ? 'جاري الاستيراد...' : 'Importing...') : isAr ? 'رفع شجرة الأقسام Excel' : 'Import Tree Excel'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.ods"
                  disabled={importingCatsExcel}
                  onChange={(e) => void handleImportCategoriesExcel(e)}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <form ref={catFormRef} onSubmit={handleCreateCategory} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            {/* Quick Full Excel Path Input */}
            <div className="bg-amber-50/80 border border-[#F5A623]/40 rounded-xl p-3 space-y-1.5">
              <label className="block text-xs font-bold text-slate-900">
                {isAr
                  ? 'إضافة سريعة بمسار هرمي كامل (مثل Excel — يُنشئ الرئيسي والفرعي تلقائيًا بالترتيب):'
                  : 'Quick Hierarchical Path (auto-creates parent & child levels):'}
              </label>
              <input
                type="text"
                placeholder="سوبر ماركت > مخبوزات > كرواسون وكيك;"
                value={catForm.path_ar}
                onChange={(e) => setCatForm({ ...catForm, path_ar: e.target.value })}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white font-semibold focus:border-[#A92224] focus:outline-none"
              />
              <p className="text-[11px] text-slate-600">
                {isAr
                  ? 'اكتب المسار مفصولًا بـ (>) من الفرع الرئيسي إلى آخر فرع فرعي وينتهي بـ (;) — أو اتركه فارغًا وأضف قسمًا واحدًا بالأسفل.'
                  : 'Separate levels with (>) from Main Root to deepest Subcategory, ending with (;).'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {isAr ? 'القسم الأب (اختياري لإنشاء فرعي)' : 'Parent Category'}
                </label>
                <select
                  value={catForm.parent_id}
                  disabled={catForm.path_ar.trim().length > 0}
                  onChange={(e) => setCatForm({ ...catForm, parent_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">{isAr ? '— قسم رئيسي (بدون أب) —' : '— Root Category —'}</option>
                  {visibleCategories
                    .filter((c) => c.scope === catForm.scope)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_path_ar ? c.full_path_ar.replace(/;\s*$/, '') : c.name_ar}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {isAr ? 'اسم القسم بالعربية' : 'Arabic Name'}
                </label>
                <input
                  type="text"
                  required={!catForm.path_ar.trim()}
                  placeholder={isAr ? 'مثال: كرواسون وكيك' : 'Section name'}
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
                  className="w-11 h-11 rounded-full object-cover border-2 border-[#A92224] shrink-0 bg-white"
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
              <label className="inline-flex items-center gap-1 px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
                <Camera className="w-4 h-4 text-[#A92224]" />
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
                <ImagePlus className="w-4 h-4 text-[#A92224]" />
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
                className="px-4 py-2 bg-[#A92224] hover:bg-[#86191B] text-white text-xs font-bold rounded-lg whitespace-nowrap cursor-pointer"
              >
                {catForm.path_ar.trim()
                  ? isAr
                    ? '+ إنشاء المسار الهرمي بالكامل'
                    : '+ Create Hierarchy Path'
                  : catForm.parent_id
                  ? isAr
                    ? '+ إضافة قسم فرعي'
                    : '+ Add Subcategory'
                  : isAr
                  ? '+ إضافة قسم رئيسي'
                  : '+ Add Main Section'}
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100">
            {visibleCategories.map((c) => {
              const ownerMerchant = c.merchant_id ? merchants.find((m) => m.id === c.merchant_id) : null;
              const canManageCat = !isMerchantPortal || c.merchant_id === lockedMerchantId;
              const depth = Math.min(c.level || 0, 5);
              const depthIndentClass = ['ps-2', 'ps-8', 'ps-14', 'ps-20', 'ps-24', 'ps-28'][depth] || 'ps-2';
              const excelPath = c.excel_path || c.full_path_ar || `${c.name_ar};`;
              return (
                <div
                  key={c.id}
                  className={`py-3 pe-2 flex flex-wrap items-center justify-between gap-3 text-sm ${depthIndentClass} ${
                    depth === 0 ? 'bg-white' : 'bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {depth > 0 && (
                      <CornerDownLeft className="w-4 h-4 text-[#A92224]/60 shrink-0" />
                    )}
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name_ar}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-50"
                      />
                    ) : (
                      <div
                        className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${
                          c.is_offers_section
                            ? 'bg-rose-50 border-rose-200 text-rose-600'
                            : depth === 0
                            ? 'bg-red-50 border-red-200 text-[#A92224]'
                            : 'bg-amber-50 border-amber-200 text-amber-700'
                        }`}
                      >
                        {c.is_offers_section ? <Percent className="w-4 h-4" /> : <Tag className="w-4 h-4" />}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900">{c.name_ar}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            depth === 0
                              ? 'bg-red-50 text-[#A92224] border border-red-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {depth === 0 ? (isAr ? 'قسم رئيسي' : 'Main') : isAr ? `فرعي (مستوى ${depth})` : `Sub L${depth}`}
                        </span>
                        {(c.children_count || 0) > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                            {c.children_count} {isAr ? 'فرعي' : 'sub'}
                          </span>
                        )}
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
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={excelPath}>
                        <span className="font-semibold text-slate-400">مسار Excel: </span>
                        <span className="font-semibold text-slate-700">{excelPath}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {canManageCat && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setCatForm((prev) => ({
                              ...prev,
                              scope: c.scope,
                              merchant_id: lockedMerchantId || c.merchant_id || '',
                              parent_id: c.id,
                              path_ar: '',
                            }));
                            catFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-900 rounded hover:bg-amber-100 font-bold cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isAr ? 'قسم فرعي' : 'Sub'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(c.id);
                            setEditingCatName(c.name_ar);
                            setEditingCatParentId(c.parent_id || '');
                            setEditingCatImage(c.image_url || '');
                            setEditingCatIsOffers(Boolean(c.is_offers_section));
                            setEditCategoryModalOpen(true);
                          }}
                          className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          {isAr ? 'تعديل' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(c)}
                          className={`px-2.5 py-1 border rounded cursor-pointer ${
                            c.is_active ? 'border-teal-200 text-teal-700' : 'border-slate-200 text-slate-500'
                          }`}
                        >
                          {c.is_active ? (isAr ? 'مفعّل' : 'Active') : isAr ? 'موقوف' : 'Paused'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(c)}
                          className="px-2.5 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50 cursor-pointer"
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
                <div className="sm:col-span-2">
                  <CategoryPathPicker
                    categories={storeCats}
                    valueCategoryId={productForm.category_id}
                    valueCategoryPath={productForm.category_path}
                    isAr={isAr}
                    compact
                    label={isAr ? 'مسار الصنف في الأقسام (رئيسي ← فرعي ← أخير)' : 'Item Category Path'}
                    onChange={({ category_id, category_path, pickedCategory }) => {
                      setProductForm((prev) => ({
                        ...prev,
                        category_id,
                        category_path,
                        is_offer: pickedCategory?.is_offers_section ? true : prev.is_offer,
                      }));
                    }}
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
                  {isAr ? 'القسم الأب (اجعله فارغًا لتحويله لقسم رئيسي)' : 'Parent Category'}
                </label>
                <select
                  value={editingCatParentId}
                  onChange={(e) => setEditingCatParentId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="">{isAr ? '— قسم رئيسي (بدون أب) —' : '— Root Category —'}</option>
                  {visibleCategories
                    .filter((opt) => opt.id !== editingCatId)
                    .map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.full_path_ar ? opt.full_path_ar.replace(/;\s*$/, '') : opt.name_ar}
                      </option>
                    ))}
                </select>
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
