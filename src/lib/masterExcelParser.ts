import * as XLSX from 'xlsx';

export interface ParsedMasterExcelRow {
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
  sale_price?: string;
  stock_quantity?: string;
}

export interface ExcelColumnInfo {
  index: number;
  header: string;
  sample: string;
}

export interface ParsedMasterSpreadsheetResult {
  rows: ParsedMasterExcelRow[];
  columns: ExcelColumnInfo[];
  detectedCategoryColIndices: number[];
  headerRowIdx: number;
  rawMatrix: unknown[][];
  colMap: {
    nameAr: number;
    nameEn: number;
    brand: number;
    size: number;
    barcode: number;
    categoryCols: number[];
    image: number;
    desc: number;
    usage: number;
    ingredients: number;
    price: number;
    salePrice: number;
    stock: number;
  };
}

export function normalizeExcelHeaderCell(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_\-\/\\()[\]:*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanExcelCellText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    if (Number.isInteger(raw)) return raw.toFixed(0);
    return String(raw);
  }
  return String(raw)
    .replace(/\u00A0/g, ' ')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&')
    .trim();
}

export function applyExcelColumnWidths(ws: XLSX.WorkSheet, widths: number[]): void {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

function isPurelyNumericList(val: string): boolean {
  if (!val) return false;
  return /^[\d\s,;|.-]+$/.test(val);
}

function isUrlText(val: string): boolean {
  const v = val.trim().toLowerCase();
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('www.') || /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(v);
}

export function rebuildRowsWithCategoryColumns(
  parsed: ParsedMasterSpreadsheetResult,
  categoryColIndices: number[]
): ParsedMasterExcelRow[] {
  const { rawMatrix, headerRowIdx, colMap } = parsed;
  const rows: ParsedMasterExcelRow[] = [];

  for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
    const row = rawMatrix[r] || [];
    if (!row.some((cell) => cleanExcelCellText(cell) !== '')) continue;

    const nameAr = colMap.nameAr >= 0 ? cleanExcelCellText(row[colMap.nameAr]) : '';
    const nameEn = colMap.nameEn >= 0 ? cleanExcelCellText(row[colMap.nameEn]) : '';
    const barcode = colMap.barcode >= 0 ? cleanExcelCellText(row[colMap.barcode]) : '';
    if (!nameAr && !nameEn && !barcode) continue;

    // Join multi-column categories (e.g. Main Category + Sub Category) into a clean hierarchy path
    const catSegments: string[] = [];
    for (const cIdx of categoryColIndices) {
      if (cIdx < 0) continue;
      const cellVal = cleanExcelCellText(row[cIdx]);
      if (!cellVal || isUrlText(cellVal)) continue;
      const prev = catSegments[catSegments.length - 1];
      if (!prev || prev.toLowerCase() !== cellVal.toLowerCase()) {
        catSegments.push(cellVal);
      }
    }
    const categoryCombined = catSegments.join(' > ');

    rows.push({
      row_index: r + 1,
      name_ar: nameAr || nameEn,
      name_en: nameEn,
      brand: colMap.brand >= 0 ? cleanExcelCellText(row[colMap.brand]) : '',
      size_label: colMap.size >= 0 ? cleanExcelCellText(row[colMap.size]) : '',
      barcode,
      category: categoryCombined,
      image_url: colMap.image >= 0 ? cleanExcelCellText(row[colMap.image]) : '',
      description: colMap.desc >= 0 ? cleanExcelCellText(row[colMap.desc]) : '',
      usage_notes: colMap.usage >= 0 ? cleanExcelCellText(row[colMap.usage]) : '',
      ingredients: colMap.ingredients >= 0 ? cleanExcelCellText(row[colMap.ingredients]) : '',
      price: colMap.price >= 0 ? cleanExcelCellText(row[colMap.price]) : '',
      sale_price: colMap.salePrice >= 0 ? cleanExcelCellText(row[colMap.salePrice]) : '',
      stock_quantity: colMap.stock >= 0 ? cleanExcelCellText(row[colMap.stock]) : '',
    });
  }

  return rows;
}

export async function parseMasterSpreadsheetWithMeta(file: File): Promise<ParsedMasterSpreadsheetResult> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZipMagic = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOleMagic =
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;

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
  ].map(normalizeExcelHeaderCell);

  const nameEnKeys = [
    'الاسم الانجليزي',
    'الاسم بالانجليزيه',
    'اسم انجليزي',
    'name en',
    'english name',
    'canonical name en',
    'title en',
  ].map(normalizeExcelHeaderCell);

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
  ].map(normalizeExcelHeaderCell);

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
  ].map(normalizeExcelHeaderCell);

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
    'model',
  ].map(normalizeExcelHeaderCell);

  // Comprehensive Arabic & English category header dictionary (supports OpenCart, MyShopX, WooCommerce, Salla, Zid, custom)
  const categoryKeys = [
    'القسم',
    'قسم',
    'اسم القسم',
    'مسار القسم',
    'القسم والمسار',
    'الاقسام',
    'اقسام',
    'شجره الاقسام',
    'القسم الرئيسي',
    'قسم رئيسي',
    'القسم الفرعي',
    'قسم فرعي',
    'القسم الفرعي الاول',
    'القسم الفرعي الثاني',
    'التصنيف',
    'تصنيف',
    'التصنيفات',
    'تصنيفات',
    'مسار التصنيف',
    'التصنيف الرئيسي',
    'التصنيف الفرعي',
    'تصنيف الصنف',
    'الفئه',
    'فئه',
    'الفئات',
    'فئات',
    'المجموعه',
    'مجموعه',
    'المجموعات',
    'مجموعات',
    'مجموعه الصنف',
    'النوع',
    'نوع المنتج',
    'نوع الصنف',
    'category',
    'categories',
    'category name',
    'categories name',
    'category names',
    'categories names',
    'category path',
    'categories path',
    'category tree',
    'category id',
    'category ids',
    'cat',
    'cats',
    'cat name',
    'main category',
    'parent category',
    'root category',
    'sub category',
    'subcategory',
    'sub categories',
    'subcategories',
    'department',
    'departments',
    'section',
    'sections',
    'group',
    'groups',
    'product group',
    'product type',
    'collection',
    'collections',
    'taxonomy',
  ].map(normalizeExcelHeaderCell);

  const imageKeys = [
    'صوره المنتج',
    'رابط الصوره',
    'الصوره',
    'صوره',
    'image',
    'image url',
    'image name',
    'main image',
    'photo',
    'picture',
    'img',
  ].map(normalizeExcelHeaderCell);

  const descKeys = [
    'الوصف',
    'وصف المنتج',
    'تفاصيل',
    'ملاحظات',
    'description',
    'details',
    'notes',
  ].map(normalizeExcelHeaderCell);

  const usageKeys = ['الاستخدامات', 'طريقه الاستخدام', 'usage', 'usage notes'].map(normalizeExcelHeaderCell);
  const ingredientsKeys = ['المكونات', 'ingredients'].map(normalizeExcelHeaderCell);
  const priceKeys = [
    'السعر',
    'سعر',
    'السعر الاساسي',
    'السعر الحالي',
    'سعر البيع',
    'سعر المنتج',
    'price',
    'base price',
  ].map(normalizeExcelHeaderCell);
  const salePriceKeys = [
    'سعر العرض',
    'سعر الخصم',
    'الخصم',
    'عرض',
    'sale price',
    'discount price',
    'offer price',
    'special',
  ].map(normalizeExcelHeaderCell);
  const stockKeys = [
    'المخزون',
    'الكميه',
    'الكميه بالمخزون',
    'الرصيد',
    'stock',
    'qty',
    'quantity',
    'stock quantity',
  ].map(normalizeExcelHeaderCell);

  const findCol = (headers: string[], keys: string[], excludeIndices?: Set<number>): number => {
    for (let i = 0; i < headers.length; i++) {
      if (excludeIndices?.has(i)) continue;
      if (keys.includes(headers[i])) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      if (excludeIndices?.has(i)) continue;
      const h = headers[i];
      if (!h) continue;
      if (keys.some((k) => k.length >= 3 && (h.includes(k) || k.includes(h)))) return i;
    }
    return -1;
  };

  const findAllCategoryCols = (
    headers: string[],
    matrix: unknown[][],
    headerRowIdx: number,
    usedCols: Set<number>
  ): number[] => {
    const matchedCols: Array<{ idx: number; header: string; hasText: boolean; hasNumericOnly: boolean }> = [];

    for (let i = 0; i < headers.length; i++) {
      if (usedCols.has(i)) continue;
      const h = headers[i];
      if (!h) continue;
      const isExact = categoryKeys.includes(h);
      const isFuzzy =
        !isExact &&
        (categoryKeys.some((k) => k.length >= 3 && (h.includes(k) || k.includes(h))) ||
          /\bcat(egor(y|ies))?\b/i.test(h) ||
          h.includes('قسم') ||
          h.includes('اقسام') ||
          h.includes('تصنيف') ||
          h.includes('فئه') ||
          h.includes('فئات') ||
          h.includes('مجموع'));

      if (isExact || isFuzzy) {
        // Inspect up to 25 data rows to check if values are real text names vs numeric IDs (e.g., OpenCart category_id "12,15")
        let nonEmpty = 0;
        let numericOnly = 0;
        let urlCount = 0;
        const limit = Math.min(matrix.length, headerRowIdx + 26);
        for (let r = headerRowIdx + 1; r < limit; r++) {
          const val = cleanExcelCellText((matrix[r] || [])[i]);
          if (!val) continue;
          nonEmpty++;
          if (isPurelyNumericList(val)) numericOnly++;
          if (isUrlText(val)) urlCount++;
        }
        if (nonEmpty > 0 && urlCount === nonEmpty) continue; // skip if column is actually URLs
        matchedCols.push({
          idx: i,
          header: h,
          hasText: nonEmpty > 0 && numericOnly < nonEmpty,
          hasNumericOnly: nonEmpty > 0 && numericOnly === nonEmpty,
        });
      }
    }

    // Prefer text category columns over numeric-only ID columns (e.g. if sheet has both category_id and categories)
    const textCols = matchedCols.filter((c) => c.hasText);
    if (textCols.length > 0) {
      return textCols.map((c) => c.idx);
    }
    if (matchedCols.length > 0) {
      return matchedCols.map((c) => c.idx);
    }

    // Fallback heuristic: look for an unmapped column containing hierarchy paths (`>` / `»` / `|`)
    const maxCols = headers.length;
    const sampleLimit = Math.min(matrix.length, headerRowIdx + 35);
    for (let i = 0; i < maxCols; i++) {
      if (usedCols.has(i)) continue;
      let pathLikeCount = 0;
      let nonEmptyCount = 0;
      for (let r = headerRowIdx + 1; r < sampleLimit; r++) {
        const val = cleanExcelCellText((matrix[r] || [])[i]);
        if (!val || isUrlText(val) || isPurelyNumericList(val)) continue;
        nonEmptyCount++;
        if (/[>»›|←→]/.test(val)) pathLikeCount++;
      }
      if (nonEmptyCount >= 2 && pathLikeCount >= Math.max(1, Math.floor(nonEmptyCount * 0.4))) {
        return [i];
      }
    }

    return [];
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
    let colCategoryCols: number[] = [];
    let colImage = -1;
    let colDesc = -1;
    let colUsage = -1;
    let colIngredients = -1;
    let colPrice = -1;
    let colSalePrice = -1;
    let colStock = -1;

    const scanLimit = Math.min(matrix.length, 12);
    for (let r = 0; r < scanLimit; r++) {
      const row = matrix[r] || [];
      const normHeaders = row.map(normalizeExcelHeaderCell);
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
        colImage = findCol(normHeaders, imageKeys);
        colDesc = findCol(normHeaders, descKeys);
        colUsage = findCol(normHeaders, usageKeys);
        colIngredients = findCol(normHeaders, ingredientsKeys);
        colPrice = findCol(normHeaders, priceKeys);
        colSalePrice = findCol(normHeaders, salePriceKeys);
        colStock = findCol(normHeaders, stockKeys);

        const usedForOtherFields = new Set<number>(
          [
            colNameAr,
            colNameEn,
            colBrand,
            colSize,
            colBarcode,
            colImage,
            colDesc,
            colUsage,
            colIngredients,
            colPrice,
            colSalePrice,
            colStock,
          ].filter((x) => x >= 0)
        );
        colCategoryCols = findAllCategoryCols(normHeaders, matrix, headerRowIdx, usedForOtherFields);
        break;
      }
    }

    if (headerRowIdx === -1) {
      headerRowIdx = -1;
      colNameAr = 0;
      colBrand = 1;
      colSize = 2;
      colBarcode = 3;
      colCategoryCols = [4];
      colImage = 5;
    }

    const headerRow = headerRowIdx >= 0 ? matrix[headerRowIdx] || [] : [];
    const maxColCount = Math.max(
      headerRow.length,
      ...matrix.slice(Math.max(0, headerRowIdx + 1), headerRowIdx + 10).map((r) => (r || []).length)
    );
    const columns: ExcelColumnInfo[] = [];
    for (let c = 0; c < maxColCount; c++) {
      const rawHeader = cleanExcelCellText(headerRow[c]) || `عمود ${c + 1}`;
      let sample = '';
      for (let r = headerRowIdx + 1; r < Math.min(matrix.length, headerRowIdx + 15); r++) {
        const v = cleanExcelCellText((matrix[r] || [])[c]);
        if (v) {
          sample = v.length > 42 ? `${v.slice(0, 42)}...` : v;
          break;
        }
      }
      columns.push({ index: c, header: rawHeader, sample });
    }

    const colMap = {
      nameAr: colNameAr,
      nameEn: colNameEn,
      brand: colBrand,
      size: colSize,
      barcode: colBarcode,
      categoryCols: colCategoryCols,
      image: colImage,
      desc: colDesc,
      usage: colUsage,
      ingredients: colIngredients,
      price: colPrice,
      salePrice: colSalePrice,
      stock: colStock,
    };

    const result: ParsedMasterSpreadsheetResult = {
      rows: [],
      columns,
      detectedCategoryColIndices: colCategoryCols,
      headerRowIdx,
      rawMatrix: matrix,
      colMap,
    };
    result.rows = rebuildRowsWithCategoryColumns(result, colCategoryCols);

    if (result.rows.length > 0) return result;
  }

  return {
    rows: [],
    columns: [],
    detectedCategoryColIndices: [],
    headerRowIdx: -1,
    rawMatrix: [],
    colMap: {
      nameAr: -1,
      nameEn: -1,
      brand: -1,
      size: -1,
      barcode: -1,
      categoryCols: [],
      image: -1,
      desc: -1,
      usage: -1,
      ingredients: -1,
      price: -1,
      salePrice: -1,
      stock: -1,
    },
  };
}

export async function parseMasterSpreadsheetFile(file: File): Promise<ParsedMasterExcelRow[]> {
  const res = await parseMasterSpreadsheetWithMeta(file);
  return res.rows;
}

export function downloadMasterProductsExcelTemplate(fileName = 'otlobha-merchant-products-template.xlsx'): void {
  const sampleRows = [
    {
      'اسم المنتج': 'كرواسون بالزبدة مولتو 80 جرام',
      'الاسم الإنجليزي': 'Molto Butter Croissant 80g',
      'السعر': 15,
      'سعر العرض': '',
      'المخزون': 50,
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
      'السعر': 185,
      'سعر العرض': 170,
      'المخزون': 30,
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
      'السعر': 44,
      'سعر العرض': '',
      'المخزون': 40,
      'العلامة التجارية': 'جهينة',
      'الحجم أو الوزن': '1 لتر',
      'الباركود': '6221007011223',
      'القسم': 'سوبر ماركت > ألبان ومنتجاتها > الألبان والبيض;',
      'رابط الصورة': '',
      'الوصف': 'حليب طبيعي معقم كامل الدسم 1 لتر',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  applyExcelColumnWidths(ws, [30, 26, 12, 12, 10, 18, 15, 18, 38, 28, 36]);
  ws['!views'] = [{ rightToLeft: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'نموذج منتجات المتجر');
  XLSX.writeFile(wb, fileName);
}
