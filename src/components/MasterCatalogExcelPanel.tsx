import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  GitCompare,
  Loader2,
  PlusCircle,
  Search,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import type { CategoryRecord } from '../shared/types';

interface Props {
  categories: CategoryRecord[];
  initialMode?: 'import' | 'compare';
  onImported: () => void;
  onToast: (msg: string) => void;
}

interface ParsedMasterExcelRow {
  row_index: number;
  name_ar: string;
  name_en: string;
  brand: string;
  size_label: string;
  barcode: string;
  category: string;
  image_url: string;
  description: string;
  usage_notes: string;
  ingredients: string;
  price: string;
}

interface CompareRowResult {
  row_index: number;
  name_ar: string;
  name_en: string;
  brand: string;
  size_label: string;
  parsed_size_label: string;
  barcode: string;
  category: string;
  image_url: string;
  description: string;
  price: string;
  status: 'existing' | 'not_found' | 'possible';
  duplicate_in_file: boolean;
  confidence_score: number;
  match_reasons: string[];
  size_conflict_warning: string | null;
  matched_master: {
    id: string;
    canonical_name_ar: string;
    canonical_name_en: string;
    brand: string;
    size_label: string;
    barcode: string | null;
    category_name: string;
    stores_count: number;
    lowest_price: number | null;
  } | null;
}

interface CompareSummary {
  total_rows: number;
  existing_count: number;
  not_found_count: number;
  possible_count: number;
  duplicate_in_file_count: number;
}

function normalizeHeaderCell(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_\-\/\\()[\]:*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCellText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    // Avoid scientific notation for long barcodes like 6221000000000
    if (Number.isInteger(raw)) return raw.toFixed(0);
    return String(raw);
  }
  return String(raw).trim();
}

async function parseMasterSpreadsheetFile(file: File): Promise<ParsedMasterExcelRow[]> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZipMagic = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOleMagic = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

  let wb: XLSX.WorkBook;
  if (isZipMagic || isOleMagic) {
    wb = XLSX.read(buf, { type: 'array', raw: false });
  } else {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('\uFFFD')) {
      try {
        text = new TextDecoder('windows-1256').decode(bytes);
      } catch {
        // fallback to utf-8 text
      }
    }
    // Semicolon CSV normalization common in Arabic Windows Excel
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    if (!firstLine.includes(',') && firstLine.includes(';') && !firstLine.trim().startsWith('<')) {
      text = text.replace(/;/g, ',');
    }
    wb = XLSX.read(text, { type: 'string', raw: false });
  }

  const nameArKeys = [
    'اسم المنتج',
    'الاسم العربي',
    'الاسم',
    'المنتج',
    'الصنف',
    'اسم الصنف',
    'اسم المنتج الرسمي',
    'product name',
    'product',
    'name ar',
    'canonical name ar',
    'name',
    'title',
    'item',
    'item name',
  ].map(normalizeHeaderCell);

  const nameEnKeys = [
    'الاسم الانجليزي',
    'الاسم بالانجليزيه',
    'اسم انجليزي',
    'name en',
    'english name',
    'canonical name en',
    'title en',
  ].map(normalizeHeaderCell);

  const brandKeys = [
    'العلامه التجاريه',
    'العلامه',
    'الماركه',
    'الشركه',
    'الشركه المنتجه',
    'البراند',
    'brand',
    'manufacturer',
    'company',
  ].map(normalizeHeaderCell);

  const sizeKeys = [
    'الحجم',
    'الوزن',
    'الحجم او الوزن',
    'الحجم الوزن',
    'العبوه',
    'المقاس',
    'الوحده',
    'السعه',
    'size',
    'weight',
    'size label',
    'unit',
    'volume',
    'pack size',
  ].map(normalizeHeaderCell);

  const barcodeKeys = [
    'الباركود',
    'باركود',
    'كود الصنف',
    'كود المنتج',
    'الكود',
    'barcode',
    'ean',
    'ean13',
    'upc',
    'gtin',
    'sku',
    'code',
  ].map(normalizeHeaderCell);

  const categoryKeys = [
    'القسم',
    'مسار القسم',
    'القسم والمسار',
    'الاقسام',
    'التصنيف',
    'مسار التصنيف',
    'الفئه',
    'المجموعه',
    'category',
    'category name',
    'category path',
    'category id',
    'department',
    'group',
  ].map(normalizeHeaderCell);

  const imageKeys = [
    'صوره المنتج',
    'رابط الصوره',
    'الصوره',
    'صوره',
    'image',
    'image url',
    'photo',
    'picture',
    'img',
  ].map(normalizeHeaderCell);

  const descKeys = [
    'الوصف',
    'وصف المنتج',
    'تفاصيل',
    'ملاحظات',
    'description',
    'details',
    'notes',
  ].map(normalizeHeaderCell);

  const usageKeys = ['الاستخدامات', 'طريقه الاستخدام', 'usage', 'usage notes'].map(normalizeHeaderCell);
  const ingredientsKeys = ['المكونات', 'ingredients'].map(normalizeHeaderCell);
  const priceKeys = ['السعر', 'سعر', 'السعر الحالي', 'سعر البيع', 'price', 'base price', 'sale price'].map(normalizeHeaderCell);

  const findCol = (headers: string[], keys: string[]): number => {
    for (let i = 0; i < headers.length; i++) {
      if (keys.includes(headers[i])) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!h) continue;
      if (keys.some((k) => k.length >= 3 && (h.includes(k) || k.includes(h)))) return i;
    }
    return -1;
  };

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (!matrix || matrix.length === 0) continue;

    let headerRowIdx = -1;
    let colNameAr = -1;
    let colNameEn = -1;
    let colBrand = -1;
    let colSize = -1;
    let colBarcode = -1;
    let colCategory = -1;
    let colImage = -1;
    let colDesc = -1;
    let colUsage = -1;
    let colIngredients = -1;
    let colPrice = -1;

    const scanLimit = Math.min(matrix.length, 12);
    for (let r = 0; r < scanLimit; r++) {
      const row = matrix[r] || [];
      const normHeaders = row.map(normalizeHeaderCell);
      const foundName = findCol(normHeaders, nameArKeys);
      const foundBarcode = findCol(normHeaders, barcodeKeys);
      const foundBrand = findCol(normHeaders, brandKeys);
      if (foundName !== -1 || (foundBarcode !== -1 && foundBrand !== -1)) {
        headerRowIdx = r;
        colNameAr = foundName;
        colNameEn = findCol(normHeaders, nameEnKeys);
        colBrand = foundBrand;
        colSize = findCol(normHeaders, sizeKeys);
        colBarcode = foundBarcode;
        colCategory = findCol(normHeaders, categoryKeys);
        colImage = findCol(normHeaders, imageKeys);
        colDesc = findCol(normHeaders, descKeys);
        colUsage = findCol(normHeaders, usageKeys);
        colIngredients = findCol(normHeaders, ingredientsKeys);
        colPrice = findCol(normHeaders, priceKeys);
        break;
      }
    }

    // Positional fallback if spreadsheet has no header row
    if (headerRowIdx === -1) {
      headerRowIdx = -1;
      colNameAr = 0;
      colBrand = 1;
      colSize = 2;
      colBarcode = 3;
      colCategory = 4;
      colImage = 5;
    }

    const parsed: ParsedMasterExcelRow[] = [];
    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (!row.some((cell) => cleanCellText(cell) !== '')) continue;

      const nameAr = colNameAr >= 0 ? cleanCellText(row[colNameAr]) : '';
      const nameEn = colNameEn >= 0 ? cleanCellText(row[colNameEn]) : '';
      if (!nameAr && !nameEn) continue;

      parsed.push({
        row_index: r + 1,
        name_ar: nameAr || nameEn,
        name_en: nameEn,
        brand: colBrand >= 0 ? cleanCellText(row[colBrand]) : '',
        size_label: colSize >= 0 ? cleanCellText(row[colSize]) : '',
        barcode: colBarcode >= 0 ? cleanCellText(row[colBarcode]) : '',
        category: colCategory >= 0 ? cleanCellText(row[colCategory]) : '',
        image_url: colImage >= 0 ? cleanCellText(row[colImage]) : '',
        description: colDesc >= 0 ? cleanCellText(row[colDesc]) : '',
        usage_notes: colUsage >= 0 ? cleanCellText(row[colUsage]) : '',
        ingredients: colIngredients >= 0 ? cleanCellText(row[colIngredients]) : '',
        price: colPrice >= 0 ? cleanCellText(row[colPrice]) : '',
      });
    }

    if (parsed.length > 0) return parsed;
  }

  return [];
}

function applyColumnWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

export const MasterCatalogExcelPanel: React.FC<Props> = ({
  categories,
  initialMode = 'compare',
  onImported,
  onToast,
}) => {
  const [mode, setMode] = useState<'import' | 'compare'>(initialMode);

  // Import state
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<ParsedMasterExcelRow[]>([]);
  const [defaultCategoryId, setDefaultCategoryId] = useState('cat_grocery');
  const [skipExisting, setSkipExisting] = useState(true);
  const [updateMissingFields, setUpdateMissingFields] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importReport, setImportReport] = useState<{
    created_count: number;
    skipped_existing_count: number;
    updated_existing_count: number;
    categories_created_count: number;
    error_count: number;
    errors: Array<{ row_index: number; name_ar: string; error: string }>;
  } | null>(null);

  // Compare state
  const compareFileRef = useRef<HTMLInputElement | null>(null);
  const [compareFileName, setCompareFileName] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState({ done: 0, total: 0 });
  const [compareSummary, setCompareSummary] = useState<CompareSummary | null>(null);
  const [compareExisting, setCompareExisting] = useState<CompareRowResult[]>([]);
  const [compareNotFound, setCompareNotFound] = useState<CompareRowResult[]>([]);
  const [comparePossible, setComparePossible] = useState<CompareRowResult[]>([]);
  const [compareAllRows, setCompareAllRows] = useState<CompareRowResult[]>([]);
  const [compareFilter, setCompareFilter] = useState<'all' | 'not_found' | 'existing' | 'possible'>('not_found');
  const [compareSearch, setCompareSearch] = useState('');
  const [exportingCatalog, setExportingCatalog] = useState(false);

  const merchantCategories = useMemo(
    () => categories.filter((c) => !c.merchant_id && c.scope !== 'market'),
    [categories]
  );

  // ============================================================================
  // Template & Full Catalog Export Helpers
  // ============================================================================
  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'اسم المنتج': 'كرواسون بالزبدة مولتو 80 جرام',
        'الاسم الإنجليزي': 'Molto Butter Croissant 80g',
        'العلامة التجارية': 'مولتو',
        'الحجم أو الوزن': '80 جرام',
        'الباركود': '6221039000801',
        'القسم': 'سوبر ماركت > مخبوزات > كرواسون وكيك;',
        'رابط الصورة': '',
        'الوصف': 'كرواسون طازج محشو بالزبدة الطبيعية 80 جرام',
      },
      {
        'اسم المنتج': 'نسكافيه كلاسيك 200 جرام',
        'الاسم الإنجليزي': 'Nescafe Classic 200g',
        'العلامة التجارية': 'نسكافيه',
        'الحجم أو الوزن': '200 جرام',
        'الباركود': '7613035089123',
        'القسم': 'سوبر ماركت > مشروبات ساخنة > القهوة والشاي;',
        'رابط الصورة': '',
        'الوصف': 'قهوة سريعة الذوبان عبوة زجاجية 200 جرام',
      },
      {
        'اسم المنتج': 'حليب جهينة كامل الدسم 1 لتر',
        'الاسم الإنجليزي': 'Juhayna Full Cream Milk 1L',
        'العلامة التجارية': 'جهينة',
        'الحجم أو الوزن': '1 لتر',
        'الباركود': '6221007011223',
        'القسم': 'سوبر ماركت > ألبان ومنتجاتها > الألبان والبيض;',
        'رابط الصورة': '',
        'الوصف': 'حليب طبيعي معقم كامل الدسم 1 لتر',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    applyColumnWidths(ws, [30, 26, 18, 15, 18, 38, 28, 36]);
    ws['!views'] = [{ rightToLeft: true }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'نموذج المنتجات المركزية');
    XLSX.writeFile(wb, 'otlobha-master-products-template.xlsx');
    onToast('تم تحميل نموذج Excel الجاهز بمسارات الأقسام الرئيسية والفرعية');
  };

  const handleExportAllMasterCatalog = async () => {
    setExportingCatalog(true);
    try {
      const res = await api.exportAllAdminMasterProducts();
      const items = res.items || [];
      if (items.length === 0) {
        onToast('لا توجد منتجات مركزية معتمدة للتصدير حاليًا');
        return;
      }
      const rows = items.map((m) => ({
        'معرّف المنتج المركزي': m.id,
        'اسم المنتج': m.canonical_name_ar || '',
        'الاسم الإنجليزي': m.canonical_name_en || '',
        'العلامة التجارية': m.brand || '',
        'الحجم أو الوزن': m.size_label || '',
        'الباركود': m.barcode || '',
        'القسم': m.category_path || (m.category_name ? `${m.category_name};` : ''),
        'عدد المتاجر': m.active_stores_count || 0,
        'أقل سعر متاح': m.lowest_price ?? '',
        'رابط الصورة': m.image_url || '',
        'الوصف': m.description || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      applyColumnWidths(ws, [22, 32, 26, 18, 15, 18, 38, 12, 14, 30, 36]);
      ws['!views'] = [{ rightToLeft: true }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الكتالوج المركزي');
      XLSX.writeFile(wb, `otlobha-master-catalog-${new Date().toISOString().slice(0, 10)}.xlsx`);
      onToast(`تم تصدير ${items.length} منتج مركزي إلى ملف Excel بنجاح`);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setExportingCatalog(false);
    }
  };

  // ============================================================================
  // Mode 1: Bulk Excel Upload into Master Products
  // ============================================================================
  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseMasterSpreadsheetFile(file);
      if (parsed.length === 0) {
        onToast('لم يتم العثور على صفوف منتجات صالحة داخل الملف. تأكد من وجود عمود "اسم المنتج".');
        return;
      }
      setImportFileName(file.name);
      setImportRows(parsed);
      setImportReport(null);
      onToast(`تمت قراءة ${parsed.length} صف منتج من "${file.name}" بنجاح`);
    } catch (err) {
      onToast(`تعذر قراءة الملف: ${(err as Error).message}`);
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const executeBulkImportRows = async (rowsToImport: ParsedMasterExcelRow[]) => {
    if (rowsToImport.length === 0) return;
    setImporting(true);
    setImportReport(null);
    const CHUNK_SIZE = 1000;
    setImportProgress({ done: 0, total: rowsToImport.length });

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalUpdated = 0;
    let totalCategoriesCreated = 0;
    let totalErrors = 0;
    const allErrors: Array<{ row_index: number; name_ar: string; error: string }> = [];

    try {
      for (let start = 0; start < rowsToImport.length; start += CHUNK_SIZE) {
        const chunk = rowsToImport.slice(start, start + CHUNK_SIZE);
        const res = await api.importMasterProductsExcel({
          rows: chunk as unknown as Array<Record<string, unknown>>,
          default_category_id: defaultCategoryId,
          skip_existing: skipExisting,
          update_missing_fields: updateMissingFields,
        });
        totalCreated += res.created_count || 0;
        totalSkipped += res.skipped_existing_count || 0;
        totalUpdated += res.updated_existing_count || 0;
        totalCategoriesCreated += res.categories_created_count || 0;
        totalErrors += res.error_count || 0;
        if (Array.isArray(res.errors) && allErrors.length < 100) {
          allErrors.push(...res.errors.slice(0, 100 - allErrors.length));
        }
        setImportProgress({ done: Math.min(start + chunk.length, rowsToImport.length), total: rowsToImport.length });
      }

      setImportReport({
        created_count: totalCreated,
        skipped_existing_count: totalSkipped,
        updated_existing_count: totalUpdated,
        categories_created_count: totalCategoriesCreated,
        error_count: totalErrors,
        errors: allErrors,
      });
      onToast(
        `اكتمل الرفع: تمت إضافة ${totalCreated} منتج مركزي جديد` +
          (totalCategoriesCreated > 0 ? ` · إنشاء ${totalCategoriesCreated} قسم رئيسي/فرعي تلقائيًا` : '') +
          (totalUpdated > 0 ? ` · تحديث ${totalUpdated}` : '') +
          (totalSkipped > 0 ? ` · تخطي ${totalSkipped} موجود مسبقًا` : '')
      );
      onImported();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  // ============================================================================
  // Mode 2: Excel Compare Against Existing Master Catalog & Generate Diff Excel
  // ============================================================================
  const handleSelectCompareFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseMasterSpreadsheetFile(file);
      if (parsed.length === 0) {
        onToast('لم يتم العثور على صفوف منتجات صالحة في ملف المقارنة.');
        return;
      }

      setCompareFileName(file.name);
      setComparing(true);
      const CHUNK_SIZE = 2000;
      setCompareProgress({ done: 0, total: parsed.length });

      const mergedExisting: CompareRowResult[] = [];
      const mergedNotFound: CompareRowResult[] = [];
      const mergedPossible: CompareRowResult[] = [];
      const mergedAll: CompareRowResult[] = [];
      let dupInFileTotal = 0;

      for (let start = 0; start < parsed.length; start += CHUNK_SIZE) {
        const chunk = parsed.slice(start, start + CHUNK_SIZE);
        const res = await api.compareMasterProductsExcel(chunk as unknown as Array<Record<string, unknown>>);
        mergedExisting.push(...(res.existing || []));
        mergedNotFound.push(...(res.not_found || []));
        mergedPossible.push(...(res.possible || []));
        mergedAll.push(...(res.all_rows || []));
        dupInFileTotal += res.summary?.duplicate_in_file_count || 0;
        setCompareProgress({ done: Math.min(start + chunk.length, parsed.length), total: parsed.length });
      }

      const summary: CompareSummary = {
        total_rows: mergedAll.length,
        existing_count: mergedExisting.length,
        not_found_count: mergedNotFound.length,
        possible_count: mergedPossible.length,
        duplicate_in_file_count: dupInFileTotal,
      };
      setCompareSummary(summary);
      setCompareExisting(mergedExisting);
      setCompareNotFound(mergedNotFound);
      setComparePossible(mergedPossible);
      setCompareAllRows(mergedAll);
      setCompareFilter(mergedNotFound.length > 0 ? 'not_found' : 'existing');
      onToast(
        `اكتملت المقارنة: ${summary.not_found_count} غير موجود (جديد) · ${summary.existing_count} موجود بالفعل · ${summary.possible_count} تشابه محتمل`
      );
    } catch (err) {
      onToast(`تعذر مقارنة الملف: ${(err as Error).message}`);
    } finally {
      setComparing(false);
      if (compareFileRef.current) compareFileRef.current.value = '';
    }
  };

  const mapNotFoundToSheetRow = (r: CompareRowResult) => ({
    'رقم الصف بالملف': r.row_index,
    'اسم المنتج': r.name_ar,
    'الاسم الإنجليزي': r.name_en,
    'العلامة التجارية': r.brand,
    'الحجم أو الوزن': r.size_label || r.parsed_size_label,
    'الباركود': r.barcode,
    'القسم': r.category,
    'السعر (إن وُجد)': r.price,
    'رابط الصورة': r.image_url,
    'الوصف': r.description,
    'الحالة': r.duplicate_in_file ? 'غير موجود (مكرر داخل ملفك)' : 'غير موجود — منتج جديد',
  });

  const mapExistingToSheetRow = (r: CompareRowResult) => ({
    'رقم الصف بالملف': r.row_index,
    'اسم المنتج في ملفك': r.name_ar,
    'العلامة في ملفك': r.brand,
    'الحجم في ملفك': r.size_label || r.parsed_size_label,
    'الباركود في ملفك': r.barcode,
    'الحالة': 'موجود بالكتالوج المركزي',
    'معرّف المنتج المركزي': r.matched_master?.id || '',
    'اسم المنتج المركزي المطابق': r.matched_master?.canonical_name_ar || '',
    'العلامة المركزية': r.matched_master?.brand || '',
    'الحجم المركزي': r.matched_master?.size_label || '',
    'الباركود المركزي': r.matched_master?.barcode || '',
    'القسم المركزي': r.matched_master?.category_name || '',
    'عدد المتاجر المتوفر بها': r.matched_master?.stores_count ?? 0,
    'أقل سعر حالي': r.matched_master?.lowest_price ?? '',
    'نسبة التطابق %': r.confidence_score,
    'سبب التطابق': r.match_reasons.join(' + '),
  });

  const mapPossibleToSheetRow = (r: CompareRowResult) => ({
    'رقم الصف بالملف': r.row_index,
    'اسم المنتج في ملفك': r.name_ar,
    'العلامة في ملفك': r.brand,
    'الحجم في ملفك': r.size_label || r.parsed_size_label,
    'الباركود في ملفك': r.barcode,
    'الحالة': 'تشابه محتمل — يحتاج مراجعة',
    'أقرب منتج مركزي': r.matched_master?.canonical_name_ar || '',
    'معرّف الأقرب': r.matched_master?.id || '',
    'الحجم المركزي': r.matched_master?.size_label || '',
    'نسبة التشابه %': r.confidence_score,
    'السبب': r.match_reasons.join(' + '),
    'ملاحظة': r.size_conflict_warning || '',
  });

  const handleDownloadComparisonExcel = (scope: 'combined' | 'not_found' | 'existing') => {
    if (!compareSummary) return;
    const wb = XLSX.utils.book_new();
    const dateTag = new Date().toISOString().slice(0, 10);

    if (scope === 'combined' || scope === 'not_found') {
      const nfRows =
        compareNotFound.length > 0
          ? compareNotFound.map(mapNotFoundToSheetRow)
          : [{ 'رسالة': 'لا توجد منتجات غير موجودة — جميع المنتجات موجودة بالفعل في الكتالوج المركزي' }];
      const wsNF = XLSX.utils.json_to_sheet(nfRows);
      applyColumnWidths(wsNF, [14, 30, 24, 18, 15, 18, 18, 14, 28, 32, 24]);
      XLSX.utils.book_append_sheet(wb, wsNF, 'المنتجات غير الموجودة');
    }

    if (scope === 'combined' || scope === 'existing') {
      const exRows =
        compareExisting.length > 0
          ? compareExisting.map(mapExistingToSheetRow)
          : [{ 'رسالة': 'لا توجد منتجات متطابقة مع الكتالوج المركزي الحالي' }];
      const wsEX = XLSX.utils.json_to_sheet(exRows);
      applyColumnWidths(wsEX, [14, 28, 16, 14, 18, 22, 20, 30, 16, 14, 18, 18, 14, 14, 13, 30]);
      XLSX.utils.book_append_sheet(wb, wsEX, 'المنتجات الموجودة');
    }

    if (scope === 'combined' && comparePossible.length > 0) {
      const psRows = comparePossible.map(mapPossibleToSheetRow);
      const wsPS = XLSX.utils.json_to_sheet(psRows);
      applyColumnWidths(wsPS, [14, 28, 16, 14, 18, 24, 30, 20, 14, 14, 28, 30]);
      XLSX.utils.book_append_sheet(wb, wsPS, 'تشابه محتمل للمراجعة');
    }

    if (scope === 'combined') {
      const summarySheet = XLSX.utils.json_to_sheet([
        { 'البند': 'اسم الملف المقارَن', 'القيمة': compareFileName || 'ملف إكسل' },
        { 'البند': 'تاريخ المقارنة', 'القيمة': new Date().toLocaleString('ar-EG') },
        { 'البند': 'إجمالي الصفوف المفحوصة', 'القيمة': compareSummary.total_rows },
        { 'البند': 'المنتجات غير الموجودة (جديدة)', 'القيمة': compareSummary.not_found_count },
        { 'البند': 'المنتجات الموجودة بالفعل', 'القيمة': compareSummary.existing_count },
        { 'البند': 'تشابه محتمل للمراجعة', 'القيمة': compareSummary.possible_count },
        { 'البند': 'تكرارات داخل الملف المرفوع نفسه', 'القيمة': compareSummary.duplicate_in_file_count },
      ]);
      applyColumnWidths(summarySheet, [32, 34]);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'ملخص المقارنة');
    }

    const fileName =
      scope === 'combined'
        ? `otlobha-compare-report-${dateTag}.xlsx`
        : scope === 'not_found'
        ? `otlobha-not-found-products-${dateTag}.xlsx`
        : `otlobha-existing-products-${dateTag}.xlsx`;

    XLSX.writeFile(wb, fileName);
    onToast(`تم إنشاء وتحميل ملف Excel بنجاح (${fileName})`);
  };

  const handleImportNotFoundDirectly = async () => {
    if (compareNotFound.length === 0) return;
    const mapped: ParsedMasterExcelRow[] = compareNotFound.map((r) => ({
      row_index: r.row_index,
      name_ar: r.name_ar,
      name_en: r.name_en,
      brand: r.brand,
      size_label: r.size_label || r.parsed_size_label,
      barcode: r.barcode,
      category: r.category,
      image_url: r.image_url,
      description: r.description,
      usage_notes: '',
      ingredients: '',
      price: r.price,
    }));
    await executeBulkImportRows(mapped);
    // Refresh comparison automatically after direct import
    setCompareSummary(null);
    setCompareAllRows([]);
    setCompareExisting([]);
    setCompareNotFound([]);
    setComparePossible([]);
  };

  const filteredCompareRows = useMemo(() => {
    const base =
      compareFilter === 'not_found'
        ? compareNotFound
        : compareFilter === 'existing'
        ? compareExisting
        : compareFilter === 'possible'
        ? comparePossible
        : compareAllRows;
    const q = compareSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) =>
        r.name_ar.toLowerCase().includes(q) ||
        r.name_en.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        r.barcode.toLowerCase().includes(q) ||
        (r.matched_master?.canonical_name_ar || '').toLowerCase().includes(q)
    );
  }, [compareFilter, compareNotFound, compareExisting, comparePossible, compareAllRows, compareSearch]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Top Mode Switcher & Quick Utility Actions */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('import')}
            className={`px-4 py-2.5 rounded-2xl text-sm font-black flex items-center gap-2 transition cursor-pointer ${
              mode === 'import'
                ? 'bg-[#A92224] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            رفع منتجات مركزية بالـ Excel
          </button>
          <button
            type="button"
            onClick={() => setMode('compare')}
            className={`px-4 py-2.5 rounded-2xl text-sm font-black flex items-center gap-2 transition cursor-pointer ${
              mode === 'compare'
                ? 'bg-[#A92224] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <GitCompare className="w-4 h-4" />
            مقارنة ملف Excel وتوليد ملف (موجود / غير موجود)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            تحميل نموذج Excel جاهز
          </button>
          <button
            type="button"
            onClick={() => void handleExportAllMasterCatalog()}
            disabled={exportingCatalog}
            className="px-3.5 py-2 rounded-xl border border-[#F5A623]/40 bg-amber-50 hover:bg-amber-100 text-[#7A4400] text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {exportingCatalog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            تصدير الكتالوج المركزي كاملًا
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODE 1: BULK EXCEL IMPORT INTO MASTER CATALOG */}
      {/* ===================================================================== */}
      {mode === 'import' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-[#A92224]" />
                رفع جماعي للمنتجات المركزية عبر Excel
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                ارفع ملف (.xlsx / .xls / .csv) يضم آلاف المنتجات دفعة واحدة. يمنع النظام التكرار تلقائيًا بالباركود أو بالاسم والعلامة والحجم مع حفظ التوافق الصارم بين الأحجام المختلفة.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.ods"
                onChange={(e) => void handleSelectImportFile(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="px-4 py-2.5 rounded-2xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-black flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                اختيار ملف Excel للرفع
              </button>
            </div>
          </div>

          {/* Smart Import Settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#F6F7F9] p-4 rounded-2xl border border-slate-200/80">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">القسم الافتراضي (إن لم يُذكر في الملف)</label>
              <select
                value={defaultCategoryId}
                onChange={(e) => setDefaultCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
              >
                {merchantCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_path_ar ? c.full_path_ar.replace(/;\s*$/, '') : c.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                className="mt-1 accent-[#A92224]"
              />
              <div>
                <div className="text-xs font-black text-slate-900">تخطي المنتجات الموجودة تلقائيًا</div>
                <div className="text-[11px] text-slate-500">يمنع إنشاء أي تكرار بالباركود أو الاسم + الماركة + الحجم.</div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={updateMissingFields}
                onChange={(e) => setUpdateMissingFields(e.target.checked)}
                className="mt-1 accent-[#A92224]"
              />
              <div>
                <div className="text-xs font-black text-slate-900">استكمال الحقول الناقصة للموجود</div>
                <div className="text-[11px] text-slate-500">يكمل الصورة أو الباركود أو الوصف إذا كان فارغًا في الكتالوج المركزي.</div>
              </div>
            </label>
          </div>

          {/* Supported Columns Guide */}
          {importRows.length === 0 && !importReport && (
            <div
              onClick={() => importFileRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-[#A92224] rounded-3xl p-8 text-center transition cursor-pointer bg-slate-50/50 hover:bg-red-50/20"
            >
              <div className="w-14 h-14 rounded-2xl bg-red-50 text-[#A92224] flex items-center justify-center mx-auto mb-3">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <p className="font-black text-slate-900 text-base">اضغط هنا لاختيار ملف Excel أو CSV للمنتجات المركزية</p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-2xl mx-auto leading-relaxed">
                الأعمدة المدعومة تلقائيًا (عربي أو إنجليزي): <span className="font-bold text-slate-700">اسم المنتج</span> (مطلوب)،{' '}
                <span className="font-bold text-slate-700">الاسم الإنجليزي</span>،{' '}
                <span className="font-bold text-slate-700">العلامة التجارية</span>،{' '}
                <span className="font-bold text-slate-700">الحجم أو الوزن</span>،{' '}
                <span className="font-bold text-slate-700">الباركود</span>،{' '}
                <span className="font-bold text-slate-700">القسم</span>،{' '}
                <span className="font-bold text-slate-700">رابط الصورة</span>،{' '}
                <span className="font-bold text-slate-700">الوصف</span>.
              </p>
              <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-[#F5A623]/40 text-xs text-slate-800">
                <span className="font-black text-[#A92224]">صيغة الأقسام الرئيسية والفرعية في Excel:</span>
                <code className="px-2 py-0.5 rounded-lg bg-white border border-amber-200 font-bold text-slate-900">
                  سوبر ماركت &gt; مخبوزات &gt; كرواسون وكيك;
                </code>
                <span className="text-[11px] text-slate-600">(يُنشئ الشجرة تلقائيًا من الرئيسي إلى آخر فرعي)</span>
              </div>
            </div>
          )}

          {/* Parsed Rows Preview + Confirm Upload */}
          {importRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-[#F5A623]/40 rounded-2xl p-3.5">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    الملف الجاهز: {importFileName} ({importRows.length.toLocaleString('ar-EG')} منتج)
                  </div>
                  <div className="text-xs text-slate-600">
                    معاينة أول {Math.min(importRows.length, 30)} صف قبل الاعتماد والإدراج في قاعدة المنتجات المركزية.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportRows([]);
                      setImportFileName('');
                    }}
                    disabled={importing}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    إلغاء الملف
                  </button>
                  <button
                    type="button"
                    onClick={() => void executeBulkImportRows(importRows)}
                    disabled={importing}
                    className="px-5 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] disabled:opacity-60 text-white text-sm font-black flex items-center gap-2 shadow-sm cursor-pointer"
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {importing
                      ? `جاري الرفع (${importProgress.done} / ${importProgress.total})...`
                      : `اعتماد ورفع ${importRows.length.toLocaleString('ar-EG')} منتج مركزي`}
                  </button>
                </div>
              </div>

              {importing && importProgress.total > 0 && (
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-l from-[#A92224] to-[#F5A623] transition-all"
                    style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                  />
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-2xl max-h-[340px]">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">اسم المنتج</th>
                      <th className="py-2.5 px-3">العلامة</th>
                      <th className="py-2.5 px-3">الحجم / الوزن</th>
                      <th className="py-2.5 px-3">الباركود</th>
                      <th className="py-2.5 px-3">القسم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importRows.slice(0, 30).map((r, i) => (
                      <tr key={`${r.row_index}-${i}`} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-slate-400">{r.row_index}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">
                          {r.name_ar}
                          {r.name_en && <div className="text-[11px] font-normal text-slate-400">{r.name_en}</div>}
                        </td>
                        <td className="py-2 px-3 text-slate-700">{r.brand || '—'}</td>
                        <td className="py-2 px-3 text-[#A92224] font-bold">{r.size_label || 'تلقائي من الاسم'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{r.barcode || '—'}</td>
                        <td className="py-2 px-3 text-slate-600">{r.category || 'افتراضي'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import Summary Report */}
          {importReport && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-black text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  تقرير نتيجة الرفع الجماعي
                </div>
                <button
                  type="button"
                  onClick={() => setImportReport(null)}
                  className="p-1 rounded-lg hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="bg-white rounded-xl p-3 border border-emerald-200">
                  <div className="text-[11px] text-slate-500 font-bold">تمت إضافتها (جديدة)</div>
                  <div className="text-xl font-black text-emerald-700">{importReport.created_count}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-indigo-200">
                  <div className="text-[11px] text-slate-500 font-bold">أقسام رئيسية/فرعية أُنشئت</div>
                  <div className="text-xl font-black text-indigo-700">{importReport.categories_created_count}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-200">
                  <div className="text-[11px] text-slate-500 font-bold">موجودة مسبقًا (تم تخطيها)</div>
                  <div className="text-xl font-black text-slate-700">{importReport.skipped_existing_count}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-amber-200">
                  <div className="text-[11px] text-slate-500 font-bold">تم استكمال بياناتها</div>
                  <div className="text-xl font-black text-amber-700">{importReport.updated_existing_count}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-rose-200">
                  <div className="text-[11px] text-slate-500 font-bold">صفوف بها ملاحظات/أخطاء</div>
                  <div className="text-xl font-black text-rose-700">{importReport.error_count}</div>
                </div>
              </div>
              {importReport.errors.length > 0 && (
                <div className="bg-white rounded-xl p-3 border border-rose-200 max-h-40 overflow-y-auto space-y-1 text-xs">
                  {importReport.errors.map((er, idx) => (
                    <div key={idx} className="text-rose-700">
                      صف #{er.row_index} ({er.name_ar || 'بدون اسم'}): {er.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 2: SMART EXCEL COMPARE & DIFF GENERATOR (EXISTING vs NOT FOUND) */}
      {/* ===================================================================== */}
      {mode === 'compare' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#A92224] bg-red-50 px-2.5 py-1 rounded-full mb-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                أداة الفرز والمقارنة الذكية بالكتالوج المركزي
              </div>
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-[#A92224]" />
                مقارنة ملف Excel بالمنتجات المركزية وإنشاء ملف Excel مفروز
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                ارفع أي ملف إكسل يحتوي على منتجات جديدة أو قائمة متجر، وسيقوم المحرك بمقارنتها فورًا بالمنتجات المركزية (بالباركود + الاسم الموحّد + العلامة التجارية + الحجم الصارم) ثم ينشئ لك ملف Excel جديدًا مقسمًا إلى: <strong className="text-slate-800">ورقة المنتجات غير الموجودة</strong> و<strong className="text-slate-800">ورقة المنتجات الموجودة</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={compareFileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.ods"
                onChange={(e) => void handleSelectCompareFile(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => compareFileRef.current?.click()}
                disabled={comparing}
                className="px-4 py-2.5 rounded-2xl bg-[#A92224] hover:bg-[#86191B] disabled:opacity-60 text-white text-sm font-black flex items-center gap-2 shadow-sm cursor-pointer"
              >
                {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                {comparing ? 'جاري الفحص والمقارنة...' : 'رفع ملف Excel للمقارنة'}
              </button>
            </div>
          </div>

          {comparing && (
            <div className="bg-amber-50 border border-[#F5A623]/40 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#A92224]" />
                  جاري مقارنة المنتجات مع الكتالوج المركزي...
                </span>
                <span className="tabular-nums">
                  {compareProgress.done.toLocaleString('ar-EG')} / {compareProgress.total.toLocaleString('ar-EG')}
                </span>
              </div>
              <div className="w-full h-2.5 bg-white rounded-full overflow-hidden border border-amber-200">
                <div
                  className="h-full bg-gradient-to-l from-[#A92224] to-[#F5A623] transition-all"
                  style={{
                    width: `${compareProgress.total > 0 ? Math.round((compareProgress.done / compareProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {!compareSummary && !comparing && (
            <div
              onClick={() => compareFileRef.current?.click()}
              className="border-2 border-dashed border-[#A92224]/30 hover:border-[#A92224] rounded-3xl p-8 text-center transition cursor-pointer bg-gradient-to-b from-red-50/30 to-amber-50/20"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#A92224] text-white flex items-center justify-center mx-auto mb-3 shadow-sm">
                <GitCompare className="w-7 h-7" />
              </div>
              <p className="font-black text-slate-900 text-base">اسحب أو اضغط هنا لرفع ملف Excel ومقارنته بالمنتجات المركزية</p>
              <p className="text-xs text-slate-600 mt-1.5 max-w-xl mx-auto">
                يفرز النظام الملف تلقائيًا ويُولّد لك ملف Excel جديدًا يحتوي على ورقة <strong>«المنتجات غير الموجودة»</strong> وورقة <strong>«المنتجات الموجودة»</strong> مع تفاصيل المنتج المركزي المطابق ونسبة التطابق.
              </p>
            </div>
          )}

          {/* Comparison Results Dashboard */}
          {compareSummary && (
            <div className="space-y-4">
              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="text-xs font-bold text-slate-500">إجمالي الصفوف بالملف</div>
                  <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                    {compareSummary.total_rows.toLocaleString('ar-EG')}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{compareFileName}</div>
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50/70 p-3.5">
                  <div className="text-xs font-bold text-[#A92224]">منتجات غير موجودة (جديدة)</div>
                  <div className="text-2xl font-black text-[#A92224] mt-1 tabular-nums">
                    {compareSummary.not_found_count.toLocaleString('ar-EG')}
                  </div>
                  <div className="text-[11px] text-red-700/80 mt-0.5">جاهزة للتصدير أو الإضافة للكتالوج</div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                  <div className="text-xs font-bold text-emerald-700">منتجات موجودة بالفعل</div>
                  <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
                    {compareSummary.existing_count.toLocaleString('ar-EG')}
                  </div>
                  <div className="text-[11px] text-emerald-700/80 mt-0.5">تطابق تام بالباركود أو الاسم والحجم</div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5">
                  <div className="text-xs font-bold text-amber-800">تشابه محتمل للمراجعة</div>
                  <div className="text-2xl font-black text-amber-700 mt-1 tabular-nums">
                    {compareSummary.possible_count.toLocaleString('ar-EG')}
                  </div>
                  <div className="text-[11px] text-amber-800/80 mt-0.5">
                    {compareSummary.duplicate_in_file_count > 0
                      ? `كما يوجد ${compareSummary.duplicate_in_file_count} تكرار داخل ملفك`
                      : 'مقارنة ذكية بدون دمج خاطئ للأحجام'}
                  </div>
                </div>
              </div>

              {/* Primary Excel Download Actions */}
              <div className="bg-gradient-to-l from-[#A92224]/5 via-amber-50/60 to-white border border-[#F5A623]/40 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadComparisonExcel('combined')}
                    className="px-4 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-black flex items-center gap-2 shadow-sm cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    تحميل Excel الشامل (الموجودة + غير الموجودة)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadComparisonExcel('not_found')}
                    className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-red-50 border border-red-200 text-[#A92224] text-xs font-black flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    غير الموجودة فقط ({compareSummary.not_found_count})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadComparisonExcel('existing')}
                    className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    الموجودة فقط ({compareSummary.existing_count})
                  </button>
                </div>

                {compareSummary.not_found_count > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleImportNotFoundDirectly()}
                    disabled={importing}
                    className="px-4 py-2.5 rounded-xl bg-[#F5A623] hover:bg-[#E0961A] text-[#3B180E] text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                    إضافة كل غير الموجودة ({compareSummary.not_found_count}) للكتالوج المركزي فورًا
                  </button>
                )}
              </div>

              {/* Filter Tabs & Search inside comparison table */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'not_found', label: 'غير موجودة (جديدة)', count: compareSummary.not_found_count },
                    { id: 'existing', label: 'موجودة بالفعل', count: compareSummary.existing_count },
                    { id: 'possible', label: 'تشابه محتمل', count: compareSummary.possible_count },
                    { id: 'all', label: 'الكل', count: compareSummary.total_rows },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setCompareFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        compareFilter === f.id
                          ? 'bg-[#A92224] text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[220px] flex-1 max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={compareSearch}
                    onChange={(e) => setCompareSearch(e.target.value)}
                    placeholder="ابحث داخل نتائج المقارنة..."
                    className="w-full pr-9 pl-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:border-[#A92224] focus:outline-none"
                  />
                </div>
              </div>

              {/* Comparison Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-2xl max-h-[420px]">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">الصف</th>
                      <th className="py-2.5 px-3">المنتج في ملف Excel</th>
                      <th className="py-2.5 px-3">الحجم والباركود</th>
                      <th className="py-2.5 px-3">نتيجة المقارنة</th>
                      <th className="py-2.5 px-3">المنتج المركزي المطابق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCompareRows.slice(0, 150).map((r, idx) => (
                      <tr key={`${r.row_index}-${idx}`} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-mono text-slate-400">#{r.row_index}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{r.name_ar}</div>
                          <div className="text-[11px] text-slate-500">
                            {r.brand || 'بدون علامة'} {r.category ? `· ${r.category}` : ''}
                            {r.duplicate_in_file && (
                              <span className="mr-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                                مكرر بالملف
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-800">{r.size_label || r.parsed_size_label || '—'}</div>
                          <div className="font-mono text-[11px] text-slate-500">{r.barcode || 'بدون باركود'}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          {r.status === 'existing' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              موجود ({r.confidence_score}%)
                            </span>
                          ) : r.status === 'possible' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 font-bold">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              تشابه محتمل ({r.confidence_score}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-[#A92224] font-bold">
                              <XCircle className="w-3.5 h-3.5" />
                              غير موجود (جديد)
                            </span>
                          )}
                          {r.size_conflict_warning && (
                            <div className="text-[10px] text-rose-600 mt-1 max-w-[220px]">{r.size_conflict_warning}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {r.matched_master ? (
                            <div>
                              <div className="font-bold text-slate-900">{r.matched_master.canonical_name_ar}</div>
                              <div className="text-[11px] text-slate-500">
                                {r.matched_master.brand || '—'} · {r.matched_master.size_label || '—'} ·{' '}
                                {r.matched_master.stores_count} متجر
                              </div>
                              {r.match_reasons.length > 0 && (
                                <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                                  {r.match_reasons.join(' · ')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">غير مسجّل في الكتالوج المركزي</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredCompareRows.length > 150 && (
                  <div className="p-2.5 text-center text-xs font-bold text-slate-500 bg-slate-50 border-t border-slate-200">
                    يُعرض أول 150 صف في المعاينة — قم بتحميل ملف Excel للحصول على جميع الـ {filteredCompareRows.length.toLocaleString('ar-EG')} صف كاملين.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
