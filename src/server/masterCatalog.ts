import type { Express, Request, Response } from 'express';
import { db, uid, recordAuditLog, isProductsFtsReady, buildFtsMatchQuery } from './db.ts';
import {
  ALL_ADMIN_ROLES,
  hasAuthPermission,
  isAdminAuth,
  requireAuth,
  requireRole,
} from './auth.ts';
import {
  createCategoryPathResolver,
  enrichAndOrderCategories,
  getCategoryAndDescendantIds,
  recomputeAllCategoryPaths,
  resolveOrCreateCategoryPath,
} from './categoryHierarchy.ts';
import {
  GeminiAssistantError,
  runOtlobhaGeminiAssistant,
  type AssistantHistoryTurn,
} from './geminiAssistant.ts';

// ============================================================================
// 1. Text, Brand & Size Normalization Engine (Arabic + English + Units)
// ============================================================================

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

const SYNONYM_MAP: Record<string, string> = {
  // Popular FMCG brands & variants (Arabic <-> Latin canonical tokens)
  نسكافيه: 'nescafe',
  نسكافي: 'nescafe',
  nescafe: 'nescafe',
  كلاسيك: 'classic',
  كلاسك: 'classic',
  classic: 'classic',
  جولد: 'gold',
  قールド: 'gold',
  gold: 'gold',
  فيري: 'fairy',
  fairy: 'fairy',
  كومفورت: 'comfort',
  كمفورت: 'comfort',
  comfort: 'comfort',
  داوني: 'downy',
  downy: 'downy',
  اريل: 'ariel',
  اريال: 'ariel',
  ariel: 'ariel',
  برسيل: 'persil',
  persil: 'persil',
  ليبتون: 'lipton',
  lipton: 'lipton',
  العروسه: 'elarosa',
  العروسة: 'elarosa',
  عروسه: 'elarosa',
  عروسة: 'elarosa',
  جهينه: 'juhayna',
  جهينة: 'juhayna',
  juhayna: 'juhayna',
  المراعي: 'almarai',
  مراعي: 'almarai',
  almarai: 'almarai',
  نادك: 'nadec',
  nadec: 'nadec',
  كوكاكولا: 'cocacola',
  كوكا: 'cocacola',
  cocacola: 'cocacola',
  بيبسي: 'pepsi',
  pepsi: 'pepsi',
  سبرايت: 'sprite',
  sprite: 'sprite',
  فانتا: 'fanta',
  fanta: 'fanta',
  ميرندا: 'mirinda',
  mirinda: 'mirinda',
  شويبس: 'schweppes',
  schweppes: 'schweppes',
  نوتيلا: 'nutella',
  nutella: 'nutella',
  ديتول: 'dettol',
  dettol: 'dettol',
  كلوركس: 'clorox',
  clorox: 'clorox',
  بامبرز: 'pampers',
  pampers: 'pampers',
  مولفيكس: 'molfix',
  molfix: 'molfix',
  اندومي: 'indomie',
  indomie: 'indomie',
  شيبسي: 'chipsy',
  chipsy: 'chipsy',
  ليز: 'lays',
  lays: 'lays',
  تايجر: 'tiger',
  tiger: 'tiger',
  دوريتوس: 'doritos',
  doritos: 'doritos',
  شيتوس: 'cheetos',
  cheetos: 'cheetos',
  اوريو: 'oreo',
  oreo: 'oreo',
  مولتو: 'molto',
  molto: 'molto',
  هوهوز: 'hohos',
  hohos: 'hohos',
  توينكيز: 'twinkies',
  twinkies: 'twinkies',
  جلاكسي: 'galaxy',
  جالكسي: 'galaxy',
  galaxy: 'galaxy',
  كادبوري: 'cadbury',
  cadbury: 'cadbury',
  دوف: 'dove',
  dove: 'dove',
  لايفبوي: 'lifebuoy',
  lifebuoy: 'lifebuoy',
  الملكه: 'elmaleka',
  الملقة: 'elmaleka',
  ملكه: 'elmaleka',
  الضحي: 'eldoha',
  ضحي: 'eldoha',
  دومتي: 'domty',
  domty: 'domty',
  عبورلاند: 'obourland',
  عبور: 'obourland',
  لامار: 'lamar',
  lamar: 'lamar',
  بخيره: 'bekhero',
  كريستال: 'crystal',
  crystal: 'crystal',
  عافيه: 'afia',
  afia: 'afia',
  روابي: 'rawabi',
  جنه: 'ganna',
  فيرن: 'fern',
  اوكسي: 'oxy',
  oxy: 'oxy',
  تايد: 'tide',
  tide: 'tide',
  بريل: 'pril',
  pril: 'pril',
  نيدو: 'nido',
  nido: 'nido',
  دانون: 'danone',
  danone: 'danone',
  كيري: 'kiri',
  kiri: 'kiri',
  بريزيدن: 'president',
  بريزيدون: 'president',
  president: 'president',
  حلواني: 'halwani',
  اطياب: 'atyab',
  كوكي: 'koki',
  // Common grocery nouns
  قهوه: 'coffee',
  coffee: 'coffee',
  شاي: 'tea',
  tea: 'tea',
  حليب: 'milk',
  لبن: 'milk',
  milk: 'milk',
  سكر: 'sugar',
  sugar: 'sugar',
  زيت: 'oil',
  oil: 'oil',
  سمن: 'ghee',
  سمنه: 'ghee',
  ghee: 'ghee',
  زبده: 'butter',
  زبد: 'butter',
  butter: 'butter',
  ارز: 'rice',
  رز: 'rice',
  rice: 'rice',
  مكرونه: 'pasta',
  معكرونه: 'pasta',
  pasta: 'pasta',
  دقيق: 'flour',
  طحين: 'flour',
  flour: 'flour',
  جبنه: 'cheese',
  جبن: 'cheese',
  cheese: 'cheese',
  زبادي: 'yogurt',
  yogurt: 'yogurt',
  دجاج: 'chicken',
  فراخ: 'chicken',
  chicken: 'chicken',
  لحمه: 'beef',
  لحم: 'beef',
  beef: 'beef',
  تونه: 'tuna',
  tuna: 'tuna',
  عسل: 'honey',
  honey: 'honey',
  شوكولاته: 'chocolate',
  شيكولاته: 'chocolate',
  شوكلاته: 'chocolate',
  chocolate: 'chocolate',
  مياه: 'water',
  ماء: 'water',
  ميه: 'water',
  water: 'water',
  عصير: 'juice',
  juice: 'juice',
  بسكويت: 'biscuit',
  بسكوت: 'biscuit',
  biscuit: 'biscuit',
  صلصه: 'sauce',
  كاتشب: 'ketchup',
  ketchup: 'ketchup',
  مايونيز: 'mayo',
  mayo: 'mayo',
  فراوله: 'strawberry',
  strawberry: 'strawberry',
  مانجو: 'mango',
  مانجه: 'mango',
  mango: 'mango',
  برتقال: 'orange',
  orange: 'orange',
  تفاح: 'apple',
  apple: 'apple',
  ليمون: 'lemon',
  lemon: 'lemon',
  نعناع: 'mint',
  mint: 'mint',
  جوافه: 'guava',
  guava: 'guava',
  خوخ: 'peach',
  peach: 'peach',
  اناناس: 'pineapple',
  pineapple: 'pineapple',
  فانيليا: 'vanilla',
  فانيلا: 'vanilla',
  vanilla: 'vanilla',
  كراميل: 'caramel',
  caramel: 'caramel',
  بندق: 'hazelnut',
  hazelnut: 'hazelnut',
  موز: 'banana',
  banana: 'banana',
  توت: 'berry',
  berry: 'berry',
  كاكاو: 'cocoa',
  cocoa: 'cocoa',
  حار: 'spicy',
  شطه: 'spicy',
  سبايسي: 'spicy',
  spicy: 'spicy',
  دايت: 'diet',
  diet: 'diet',
  لايت: 'light',
  light: 'light',
  زيرو: 'zero',
  zero: 'zero',
};

const VARIANT_GUARD_TOKENS = new Set([
  // Flavors
  'strawberry',
  'mango',
  'chocolate',
  'vanilla',
  'orange',
  'apple',
  'lemon',
  'mint',
  'guava',
  'peach',
  'pineapple',
  'caramel',
  'hazelnut',
  'banana',
  'berry',
  'cocoa',
  'spicy',
  'ملح',
  'مملح',
  'خل',
  'طماطم',
  'ketchup',
  'كباب',
  'شواء',
  'باربكيو',
  'جبن',
  'cheese',
  'خضار',
  'قرفه',
  'هيل',
  'حبهان',
  'كمون',
  'فلفل',
  'زيتون',
  'بسطرمه',
  'رومي',
  'شيدر',
  'فيتا',
  'اسطنبولي',
  'براميلي',
  'موتزاريلا',
  'قشطه',
  // Dietary / variant types
  'diet',
  'light',
  'zero',
  'classic',
  'gold',
  'خالي',
  'كامل',
  'نصف',
  'محلي',
  'بدون',
  'ساده',
  'محوج',
  'فاتح',
  'وسط',
  'غامق',
  // Relative sizes & colors (prevent merging Small vs Large or Red vs Green)
  'كبير',
  'كبيره',
  'صغير',
  'صغيره',
  'عائلي',
  'اقتصادي',
  'جامبو',
  'ميني',
  'large',
  'small',
  'medium',
  'family',
  'mini',
  'jumbo',
  'احمر',
  'اخضر',
  'ازرق',
  'اسود',
  'ابيض',
  'اصفر',
  'red',
  'green',
  'blue',
  'black',
  'white',
]);

const STOP_WORDS = new Set([
  'من',
  'في',
  'مع',
  'على',
  'عبوه',
  'عبوة',
  'كيس',
  'علبه',
  'علبة',
  'زجاجه',
  'زجاجة',
  'برطمان',
  'باكيت',
  'باكت',
  'pack',
  'bottle',
  'jar',
  'box',
  'bag',
  'the',
  'and',
  'with',
  'for',
  'of',
  'original',
  'اصلي',
  'الاصلي',
]);

export function toWesternDigits(input: string): string {
  let out = '';
  for (const ch of String(input || '')) {
    const arIdx = ARABIC_INDIC.indexOf(ch);
    if (arIdx !== -1) {
      out += String(arIdx);
      continue;
    }
    const faIdx = PERSIAN_INDIC.indexOf(ch);
    if (faIdx !== -1) {
      out += String(faIdx);
      continue;
    }
    out += ch;
  }
  return out;
}

export function normalizeText(input: string): string {
  let s = toWesternDigits(String(input || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Latin accents (Nescafé -> Nescafe)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic tashkeel & tatweel
    .toLowerCase();

  // Arabic letter unification
  s = s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  // Keep letters, digits, spaces
  s = s.replace(/[^a-z0-9\u0621-\u064a.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export interface ParsedSize {
  canonicalValue: number;
  canonicalUnit: 'g' | 'ml' | 'pcs';
  displayLabel: string;
}

const SIZE_UNIT_REGEX =
  /(\d+(?:\.\d+)?)\s*(كيلو\s*جرام|كيلوجرام|كيلو|كجم|كج|kg|kilo|جرام|جم|غ|غرام|gm|gr|g|مللي|مليلتر|ملل|مل|ml|لتر|ليتر|ل|ltr|liter|litre|l|قطعه|قطعة|قطع|حبه|حبة|حبات|بيضه|بيضة|كيس|اكياس|أكياس|عبوه|عبوة|عبوات|قرص|اقراص|أقراص|pcs|pc|pack|packs|x)(?=$|[\s.,/\-_()])/gi;

export function normalizeUnitAndValue(value: number, rawUnit: string): ParsedSize | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const u = normalizeText(rawUnit).replace(/\s+/g, '');
  if (!u) return null;

  if (['kg', 'kilo', 'كيلو', 'كيلوجرام', 'كجم', 'كج'].includes(u)) {
    const g = Math.round(value * 1000 * 100) / 100;
    return {
      canonicalValue: g,
      canonicalUnit: 'g',
      displayLabel: g >= 1000 ? `${+(g / 1000).toFixed(2)} كجم` : `${g} جرام`,
    };
  }
  if (['g', 'gm', 'gr', 'جرام', 'جم', 'غ', 'غرام'].includes(u)) {
    const g = Math.round(value * 100) / 100;
    return {
      canonicalValue: g,
      canonicalUnit: 'g',
      displayLabel: g >= 1000 && g % 1000 === 0 ? `${g / 1000} كجم` : `${g} جرام`,
    };
  }
  if (['l', 'ltr', 'liter', 'litre', 'لتر', 'ليتر', 'ل'].includes(u)) {
    const ml = Math.round(value * 1000 * 100) / 100;
    return {
      canonicalValue: ml,
      canonicalUnit: 'ml',
      displayLabel: ml >= 1000 ? `${+(ml / 1000).toFixed(2)} لتر` : `${ml} مل`,
    };
  }
  if (['ml', 'مل', 'ملل', 'مللي', 'مليلتر'].includes(u)) {
    const ml = Math.round(value * 100) / 100;
    return {
      canonicalValue: ml,
      canonicalUnit: 'ml',
      displayLabel: ml >= 1000 && ml % 1000 === 0 ? `${ml / 1000} لتر` : `${ml} مل`,
    };
  }
  if (
    [
      'pcs',
      'pc',
      'pack',
      'packs',
      'x',
      'قطعه',
      'قطع',
      'حبه',
      'حبات',
      'بيضه',
      'كيس',
      'اكياس',
      'عبوه',
      'عبوات',
      'قرص',
      'اقراص',
    ].includes(u)
  ) {
    const pcs = Math.round(value * 100) / 100;
    return {
      canonicalValue: pcs,
      canonicalUnit: 'pcs',
      displayLabel: `${pcs} قطعة`,
    };
  }
  return null;
}

export function extractSize(input: {
  size_value?: number | string | null;
  size_unit?: string | null;
  size_label?: string | null;
  name_ar?: string | null;
  name_en?: string | null;
}): ParsedSize | null {
  const numVal =
    input.size_value !== undefined && input.size_value !== null && String(input.size_value).trim() !== ''
      ? Number(toWesternDigits(String(input.size_value)))
      : NaN;
  if (Number.isFinite(numVal) && numVal > 0 && input.size_unit) {
    const direct = normalizeUnitAndValue(numVal, String(input.size_unit));
    if (direct) return direct;
  }

  const sources = [input.size_label, input.name_ar, input.name_en].filter(Boolean) as string[];
  for (const src of sources) {
    const norm = normalizeText(src);
    // Support compact formats like "200g" or "1.5l" or "200جم"
    const spaced = norm.replace(/(\d+(?:\.\d+)?)([a-z\u0621-\u064a]+)/g, '$1 $2');
    SIZE_UNIT_REGEX.lastIndex = 0;
    const match = SIZE_UNIT_REGEX.exec(spaced);
    if (match) {
      const val = Number(match[1]);
      const unit = match[2];
      const parsed = normalizeUnitAndValue(val, unit);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function stripSizeTokens(text: string): string {
  const norm = normalizeText(text).replace(/(\d+(?:\.\d+)?)([a-z\u0621-\u064a]+)/g, '$1 $2');
  return norm.replace(SIZE_UNIT_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenizeCanonical(text: string): string[] {
  const clean = stripSizeTokens(text);
  const rawTokens = clean.split(' ').filter(Boolean);
  const tokens: string[] = [];
  for (const t of rawTokens) {
    if (STOP_WORDS.has(t)) continue;
    let mapped = SYNONYM_MAP[t];
    if (!mapped && t.startsWith('ال') && t.length >= 5) {
      const stripped = t.slice(2);
      if (STOP_WORDS.has(stripped)) continue;
      mapped = SYNONYM_MAP[stripped] || stripped;
    } else if (!mapped) {
      mapped = t;
    }
    if (mapped.length >= 2 || /^\d+$/.test(mapped)) {
      tokens.push(mapped);
    }
  }
  return Array.from(new Set(tokens));
}

function hasVariantOrFlavorConflict(tokensA: string[], tokensB: string[]): boolean {
  const setA = new Set(tokensA.filter((t) => VARIANT_GUARD_TOKENS.has(t)));
  const setB = new Set(tokensB.filter((t) => VARIANT_GUARD_TOKENS.has(t)));
  if (setA.size === 0 && setB.size === 0) return false;
  if (setA.size !== setB.size) return true;
  for (const t of setA) {
    if (!setB.has(t)) return true;
  }
  return false;
}

export function buildNormalizedKey(input: {
  name_ar?: string;
  name_en?: string;
  brand?: string;
  size_value?: number | null;
  size_unit?: string | null;
  size_label?: string | null;
}): string {
  const tokens = tokenizeCanonical(`${input.brand || ''} ${input.name_ar || ''} ${input.name_en || ''}`).sort();
  const parsedSize = extractSize(input);
  const sizePart = parsedSize ? `${parsedSize.canonicalValue}${parsedSize.canonicalUnit}` : 'nosize';
  return `${tokens.join('_')}__${sizePart}`;
}

export function areSizesCompatible(a: ParsedSize | null, b: ParsedSize | null): 'identical' | 'unspecified' | 'conflict' {
  if (a && b) {
    if (a.canonicalUnit === b.canonicalUnit && Math.abs(a.canonicalValue - b.canonicalValue) <= 0.01) {
      return 'identical';
    }
    return 'conflict';
  }
  return 'unspecified';
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

function overlapCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  return inter / Math.min(setA.size, setB.size);
}

// ============================================================================
// 2. Smart Master Product Matcher (3 Confidence Tiers: exact / possible / none)
// ============================================================================

export interface MasterProductCandidate {
  id: string;
  canonical_name_ar: string;
  canonical_name_en: string;
  trade_name: string;
  brand: string;
  category_id: string | null;
  category_name?: string;
  barcode: string | null;
  size_value: number | null;
  size_unit: string;
  size_label: string;
  image_url: string;
  description: string;
  approval_status: string;
  stores_count: number;
  lowest_price: number | null;
  match_tier: 'exact' | 'possible';
  confidence_score: number;
  match_reasons: string[];
}

export interface MatchMasterResult {
  match_status: 'exact' | 'possible' | 'none';
  exact_match: MasterProductCandidate | null;
  candidates: MasterProductCandidate[];
  parsed_size: ParsedSize | null;
  normalized_key: string;
  size_conflict_warning?: string | null;
}

export function matchMasterProducts(input: {
  name_ar?: string;
  name_en?: string;
  brand?: string;
  barcode?: string | null;
  size_value?: number | string | null;
  size_unit?: string | null;
  size_label?: string | null;
  category_id?: string | null;
  exclude_master_id?: string | null;
}): MatchMasterResult {
  const cleanBarcode = String(input.barcode || '').trim().toLowerCase();
  const inputSize = extractSize(input);
  const inputTokens = tokenizeCanonical(`${input.brand || ''} ${input.name_ar || ''} ${input.name_en || ''}`);
  const inputBrandTokens = tokenizeCanonical(input.brand || '');
  const normalizedKey = buildNormalizedKey({
    name_ar: input.name_ar,
    name_en: input.name_en,
    brand: input.brand,
    size_value: inputSize?.canonicalValue ?? null,
    size_unit: inputSize?.canonicalUnit ?? null,
    size_label: input.size_label || inputSize?.displayLabel || '',
  });

  const rows = db
    .prepare(`
      SELECT
        mp.*,
        c.name_ar AS category_name,
        (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS stores_count,
        (SELECT MIN(COALESCE(p.sale_price, p.base_price)) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS lowest_price
      FROM master_products mp
      LEFT JOIN categories c ON c.id = mp.category_id
      WHERE mp.approval_status = 'approved'
      ${input.exclude_master_id ? 'AND mp.id != ?' : ''}
    `)
    .all(...(input.exclude_master_id ? [input.exclude_master_id] : [])) as Array<Record<string, any>>;

  let exactMatch: MasterProductCandidate | null = null;
  const candidates: MasterProductCandidate[] = [];
  let sizeConflictWarning: string | null = null;

  for (const row of rows) {
    const rowBarcode = String(row.barcode || '').trim().toLowerCase();
    const rowSize = extractSize({
      size_value: row.size_value,
      size_unit: row.size_unit,
      size_label: row.size_label,
      name_ar: row.canonical_name_ar,
      name_en: row.canonical_name_en,
    });

    const sizeCheck = areSizesCompatible(inputSize, rowSize);

    // Priority 1: Exact barcode match
    if (cleanBarcode && rowBarcode && cleanBarcode === rowBarcode) {
      if (sizeCheck === 'conflict') {
        sizeConflictWarning = `الباركود مطابق لمنتج "${row.canonical_name_ar}" (${rowSize?.displayLabel || row.size_label}) لكن الحجم المُدخل مختلف (${inputSize?.displayLabel}). يرجى مراجعة الحجم.`;
        continue;
      }
      const cand: MasterProductCandidate = {
        id: row.id,
        canonical_name_ar: row.canonical_name_ar,
        canonical_name_en: row.canonical_name_en || '',
        trade_name: row.trade_name || '',
        brand: row.brand || '',
        category_id: row.category_id || null,
        category_name: row.category_name || '',
        barcode: row.barcode || null,
        size_value: row.size_value ?? null,
        size_unit: row.size_unit || '',
        size_label: row.size_label || rowSize?.displayLabel || '',
        image_url: row.image_url || '',
        description: row.description || '',
        approval_status: row.approval_status,
        stores_count: Number(row.stores_count || 0),
        lowest_price: row.lowest_price !== null && row.lowest_price !== undefined ? Number(row.lowest_price) : null,
        match_tier: 'exact',
        confidence_score: 100,
        match_reasons: ['تطابق باركود كامل (Barcode Exact Match)'],
      };
      exactMatch = cand;
      candidates.unshift(cand);
      continue;
    }

    // Strict size boundary: NEVER treat conflicting sizes/weights as the same product!
    if (sizeCheck === 'conflict') {
      continue;
    }

    const rowTokens = tokenizeCanonical(
      `${row.brand || ''} ${row.canonical_name_ar || ''} ${row.canonical_name_en || ''} ${row.trade_name || ''}`
    );
    const rowBrandTokens = tokenizeCanonical(row.brand || '');

    const jaccard = jaccardSimilarity(inputTokens, rowTokens);
    const overlap = overlapCoefficient(inputTokens, rowTokens);

    // Check brand alignment if both provided
    let brandMatches = false;
    let brandConflict = false;
    if (inputBrandTokens.length > 0 && rowBrandTokens.length > 0) {
      const bOverlap = overlapCoefficient(inputBrandTokens, rowBrandTokens);
      if (bOverlap >= 0.5) brandMatches = true;
      else brandConflict = true;
    }
    if (brandConflict) continue;

    // Strict flavor/variant boundary: NEVER auto-merge different flavors, colors, or relative sizes (e.g., فراولة vs مانجو, دايت vs عادي, كبير vs صغير)
    const variantConflict = hasVariantOrFlavorConflict(inputTokens, rowTokens);
    if (variantConflict) {
      continue;
    }

    // Composite similarity score
    let score = Math.round((jaccard * 0.65 + overlap * 0.35) * 100);
    const reasons: string[] = [];

    const rowKey =
      row.normalized_key ||
      buildNormalizedKey({
        name_ar: row.canonical_name_ar,
        name_en: row.canonical_name_en,
        brand: row.brand,
        size_value: rowSize?.canonicalValue ?? null,
        size_unit: rowSize?.canonicalUnit ?? null,
        size_label: row.size_label || rowSize?.displayLabel || '',
      });
    const bothNoSize = !inputSize && !rowSize;
    const keyExactMatch = Boolean(rowKey && normalizedKey && rowKey === normalizedKey && normalizedKey !== '__nosize');

    if (keyExactMatch) {
      score = Math.max(score, 96);
      reasons.push(bothNoSize ? 'تطابق تام للاسم والعلامة التجارية' : 'تطابق تام للاسم والعلامة والحجم');
    } else if (jaccard >= 0.75 || (overlap >= 0.85 && inputTokens.length >= 2)) {
      reasons.push('تطابق عالٍ في الاسم التجاري');
    } else if (score >= 45) {
      reasons.push('تشابه قوي في الكلمات المفتاحية');
    }

    if (brandMatches) {
      score = Math.min(99, score + 8);
      reasons.push('نفس العلامة التجارية');
    }
    if (sizeCheck === 'identical') {
      score = Math.min(99, score + 10);
      reasons.push(`نفس الحجم/الوزن (${rowSize?.displayLabel || row.size_label})`);
    } else if (inputSize && !rowSize) {
      score = Math.max(0, score - 12);
    } else if (!inputSize && rowSize) {
      score = Math.max(0, score - 10);
    }

    // Exact match:
    // 1. Both have identical explicit sizes + strong text match (or exact normalized key)
    // 2. Both have NO explicit size + exact normalized key OR very high bidirectional token agreement
    // Note: if ONE has an explicit size and the other does NOT, NEVER auto-merge as exact (only possible match).
    const isExact =
      (sizeCheck === 'identical' && (keyExactMatch || score >= 84 || (jaccard >= 0.68 && overlap >= 0.85))) ||
      (bothNoSize &&
        inputTokens.length >= 1 &&
        (keyExactMatch || (jaccard >= 0.82 && overlap >= 0.9) || (score >= 88 && jaccard >= 0.72)));

    if (isExact) {
      const cand: MasterProductCandidate = {
        id: row.id,
        canonical_name_ar: row.canonical_name_ar,
        canonical_name_en: row.canonical_name_en || '',
        trade_name: row.trade_name || '',
        brand: row.brand || '',
        category_id: row.category_id || null,
        category_name: row.category_name || '',
        barcode: row.barcode || null,
        size_value: row.size_value ?? null,
        size_unit: row.size_unit || '',
        size_label: row.size_label || rowSize?.displayLabel || '',
        image_url: row.image_url || '',
        description: row.description || '',
        approval_status: row.approval_status,
        stores_count: Number(row.stores_count || 0),
        lowest_price: row.lowest_price !== null && row.lowest_price !== undefined ? Number(row.lowest_price) : null,
        match_tier: 'exact',
        confidence_score: Math.min(99, Math.max(score, 90)),
        match_reasons: reasons.length ? reasons : ['تطابق كامل في الاسم والحجم'],
      };
      if (!exactMatch || cand.confidence_score > exactMatch.confidence_score) {
        exactMatch = cand;
      }
      candidates.push(cand);
    } else if (score >= 42) {
      candidates.push({
        id: row.id,
        canonical_name_ar: row.canonical_name_ar,
        canonical_name_en: row.canonical_name_en || '',
        trade_name: row.trade_name || '',
        brand: row.brand || '',
        category_id: row.category_id || null,
        category_name: row.category_name || '',
        barcode: row.barcode || null,
        size_value: row.size_value ?? null,
        size_unit: row.size_unit || '',
        size_label: row.size_label || rowSize?.displayLabel || '',
        image_url: row.image_url || '',
        description: row.description || '',
        approval_status: row.approval_status,
        stores_count: Number(row.stores_count || 0),
        lowest_price: row.lowest_price !== null && row.lowest_price !== undefined ? Number(row.lowest_price) : null,
        match_tier: 'possible',
        confidence_score: score,
        match_reasons: reasons.length ? reasons : ['منتج محتمل مطابق — يرجى التأكيد'],
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.match_tier !== b.match_tier) return a.match_tier === 'exact' ? -1 : 1;
    return b.confidence_score - a.confidence_score;
  });

  const match_status: 'exact' | 'possible' | 'none' = exactMatch
    ? 'exact'
    : candidates.length > 0
    ? 'possible'
    : 'none';

  return {
    match_status,
    exact_match: exactMatch,
    candidates: candidates.slice(0, 12),
    parsed_size: inputSize,
    normalized_key: normalizedKey,
    size_conflict_warning: sizeConflictWarning,
  };
}

// ============================================================================
// 3. Core Transactional Operations (Reusable for APIs & Automated Tests)
// ============================================================================

export function createMasterProductRecord(input: {
  canonical_name_ar: string;
  canonical_name_en?: string;
  trade_name?: string;
  brand?: string;
  category_id?: string | null;
  barcode?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  size_label?: string | null;
  image_url?: string;
  description?: string;
  usage_notes?: string;
  ingredients?: string;
  attributes?: Array<{ attr_key: string; attr_value: string }>;
  created_by?: string;
  allow_reuse_exact?: boolean;
}): { master: Record<string, any>; reused: boolean } {
  const nameAr = String(input.canonical_name_ar || '').trim();
  if (!nameAr) throw new Error('الاسم الرسمي للمنتج بالعربية مطلوب');

  const parsedSize = extractSize({
    size_value: input.size_value,
    size_unit: input.size_unit,
    size_label: input.size_label,
    name_ar: nameAr,
    name_en: input.canonical_name_en,
  });

  const cleanBarcode = String(input.barcode || '').trim() || null;

  // Guard against creating duplicate master when exact match already exists
  const matchCheck = matchMasterProducts({
    name_ar: nameAr,
    name_en: input.canonical_name_en,
    brand: input.brand,
    barcode: cleanBarcode,
    size_value: parsedSize?.canonicalValue ?? input.size_value ?? null,
    size_unit: parsedSize?.canonicalUnit ?? input.size_unit ?? null,
    size_label: input.size_label || parsedSize?.displayLabel || '',
  });

  if (matchCheck.size_conflict_warning) {
    throw new Error(matchCheck.size_conflict_warning);
  }

  if (matchCheck.match_status === 'exact' && matchCheck.exact_match) {
    if (input.allow_reuse_exact) {
      const existingMaster = db
        .prepare('SELECT * FROM master_products WHERE id = ?')
        .get(matchCheck.exact_match.id) as Record<string, any>;
      return { master: existingMaster, reused: true };
    }
    throw new Error(
      `هذا المنتج موجود بالفعل في الكتالوج المركزي: "${matchCheck.exact_match.canonical_name_ar}" (${matchCheck.exact_match.size_label || 'نفس المواصفات'}). قم بربط متجرك بالمنتج الموجود بدلاً من التكرار.`
    );
  }

  const id = uid('mst');
  const normKey = buildNormalizedKey({
    name_ar: nameAr,
    name_en: input.canonical_name_en,
    brand: input.brand,
    size_value: parsedSize?.canonicalValue ?? null,
    size_unit: parsedSize?.canonicalUnit ?? null,
    size_label: input.size_label || parsedSize?.displayLabel || '',
  });
  const finalSizeLabel = String(input.size_label || '').trim() || parsedSize?.displayLabel || '';

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO master_products (
        id, canonical_name_ar, canonical_name_en, trade_name, brand, category_id, barcode,
        size_value, size_unit, size_label, image_url, description, usage_notes, ingredients,
        approval_status, normalized_key, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `).run(
      id,
      nameAr,
      String(input.canonical_name_en || '').trim(),
      String(input.trade_name || nameAr).trim(),
      String(input.brand || '').trim(),
      input.category_id || null,
      cleanBarcode,
      parsedSize?.canonicalValue ?? (input.size_value ?? null),
      parsedSize?.canonicalUnit ?? String(input.size_unit || '').trim(),
      finalSizeLabel,
      String(input.image_url || '').trim(),
      String(input.description || '').trim(),
      String(input.usage_notes || '').trim(),
      String(input.ingredients || '').trim(),
      normKey,
      String(input.created_by || 'admin')
    );

    if (input.image_url && String(input.image_url).trim()) {
      db.prepare(`
        INSERT INTO product_images (id, master_product_id, image_url, is_primary, sort_order)
        VALUES (?, ?, ?, 1, 0)
      `).run(uid('pimg'), id, String(input.image_url).trim());
    }

    if (Array.isArray(input.attributes)) {
      const insAttr = db.prepare(
        'INSERT INTO product_attributes (id, master_product_id, attr_key, attr_value) VALUES (?, ?, ?, ?)'
      );
      for (const attr of input.attributes) {
        if (String(attr.attr_key || '').trim() && String(attr.attr_value || '').trim()) {
          insAttr.run(uid('pattr'), id, String(attr.attr_key).trim(), String(attr.attr_value).trim());
        }
      }
    }

    db.prepare(`
      INSERT INTO catalog_merge_audit (id, action, target_master_id, actor_name, reason, details_json)
      VALUES (?, 'create_master', ?, ?, ?, ?)
    `).run(
      uid('cma'),
      id,
      String(input.created_by || 'admin'),
      'إنشاء منتج مركزي معتمد',
      JSON.stringify({ name_ar: nameAr, brand: input.brand || '', size_label: finalSizeLabel, barcode: cleanBarcode })
    );
  });

  tx();
  const master = db.prepare('SELECT * FROM master_products WHERE id = ?').get(id) as Record<string, any>;
  return { master, reused: false };
}

function parseFlexibleMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const normalized = String(raw)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[,٬]/g, '')
    .replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function ensureDefaultStorefrontMerchant(requestedMerchantId?: string | null): string {
  const reqId = String(requestedMerchantId || '').trim();
  if (reqId) {
    const found = db.prepare('SELECT id FROM merchants WHERE id = ?').get(reqId) as { id: string } | undefined;
    if (found) return found.id;
  }

  const approved = db
    .prepare("SELECT id FROM merchants WHERE verification_status = 'approved' ORDER BY rowid ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (approved) return approved.id;

  const anyMerchant = db.prepare('SELECT id FROM merchants ORDER BY rowid ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (anyMerchant) return anyMerchant.id;

  // Auto-create primary official Otlobha storefront merchant so Master Catalog products publish seamlessly
  const defaultId = 'mer_otlobha_store';
  db.prepare(`
    INSERT OR IGNORE INTO merchants (
      id, email, password_hash, business_name_ar, business_name_en, merchant_type,
      branch_name, zone_name, phone, working_hours, terms_accepted, commission_rate,
      verification_status, supports_free_order, is_open_now, is_email_verified, lat, lng
    ) VALUES (
      ?, 'store@otlobha.eg', '', 'متجر اطلبها', 'Otlobha Store', 'supermarket',
      'الفرع الرئيسي', 'المنزلة', '01000000000', '24 ساعة', 1, 0,
      'approved', 1, 1, 1, 31.1583, 31.9369
    )
  `).run(defaultId);
  return defaultId;
}

export function ensureValidStoreCategoryId(rawCatId?: string | null): string {
  const cleanId = String(rawCatId || '').trim();
  if (cleanId) {
    const found = db.prepare('SELECT id FROM categories WHERE id = ?').get(cleanId) as { id: string } | undefined;
    if (found) return found.id;
  }

  const anyActive = db
    .prepare("SELECT id FROM categories WHERE is_active = 1 AND scope IN ('merchant', 'pharmacy') ORDER BY level ASC, sort_order ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (anyActive) return anyActive.id;

  const anyCat = db.prepare('SELECT id FROM categories ORDER BY rowid ASC LIMIT 1').get() as { id: string } | undefined;
  if (anyCat) return anyCat.id;

  // Only created on demand when adding a product while zero categories exist in the store
  const fallbackId = 'cat_general';
  db.prepare(`
    INSERT OR IGNORE INTO categories (
      id, scope, merchant_id, parent_id, level, full_path_ar, name_ar, name_en,
      image_url, group_key, group_name_ar, sort_order, is_offers_section, is_active
    ) VALUES (
      ?, 'merchant', NULL, NULL, 0, 'عام;', 'عام', 'General',
      '', 'groceries', 'المقاضي', 0, 0, 1
    )
  `).run(fallbackId);
  return fallbackId;
}

export function linkMerchantListingToMaster(input: {
  merchant_id: string;
  master_product_id: string;
  category_id?: string | null;
  base_price: number;
  sale_price?: number | null;
  stock_quantity?: number;
  min_order_qty?: number;
  merchant_sku?: string;
  is_available?: boolean;
  is_offer?: boolean;
  actor_name?: string;
}): { listing: Record<string, any>; updated_existing: boolean } {
  const merchant = db.prepare('SELECT id, business_name_ar FROM merchants WHERE id = ?').get(input.merchant_id) as
    | { id: string; business_name_ar: string }
    | undefined;
  if (!merchant) throw new Error('المتجر غير موجود');

  const master = db.prepare('SELECT * FROM master_products WHERE id = ?').get(input.master_product_id) as
    | Record<string, any>
    | undefined;
  if (!master) throw new Error('المنتج المركزي غير موجود');
  if (master.approval_status === 'merged' && master.merged_into_id) {
    return linkMerchantListingToMaster({ ...input, master_product_id: String(master.merged_into_id) });
  }
  if (master.approval_status !== 'approved') {
    throw new Error('لا يمكن الربط بمنتج مركزي غير معتمد');
  }

  const basePrice = Number(input.base_price);
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error('السعر غير صالح');
  }
  const salePrice =
    input.sale_price !== undefined && input.sale_price !== null && String(input.sale_price) !== ''
      ? Number(input.sale_price)
      : null;
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > basePrice)) {
    throw new Error('سعر العرض يجب أن يكون أقل من أو يساوي السعر الأساسي');
  }

  const stockQty = Math.max(0, Math.floor(Number(input.stock_quantity ?? 50)));
  const minQty = Math.max(1, Math.floor(Number(input.min_order_qty ?? 1)));
  const isAvailable = input.is_available !== false ? 1 : 0;
  const isOffer = Boolean(input.is_offer) || (salePrice !== null && salePrice < basePrice) ? 1 : 0;

  // Ensure valid category_id (safe even when store started with 0 categories)
  const categoryId = ensureValidStoreCategoryId(input.category_id || master.category_id);

  // Check if merchant already has a listing for this master product (prevent duplicate store listing!)
  const existing = db
    .prepare('SELECT * FROM products WHERE merchant_id = ? AND master_product_id = ? LIMIT 1')
    .get(input.merchant_id, master.id) as Record<string, any> | undefined;

  if (existing) {
    db.prepare(`
      UPDATE products SET
        category_id = ?,
        name_ar = ?,
        name_en = ?,
        description = ?,
        image_url = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE image_url END,
        base_price = ?,
        sale_price = ?,
        is_offer = ?,
        stock_quantity = ?,
        min_order_qty = ?,
        merchant_sku = ?,
        is_available = ?,
        brand = ?,
        size_label = ?,
        size_value = ?,
        size_unit = ?,
        barcode = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      categoryId,
      master.canonical_name_ar,
      master.canonical_name_en || master.canonical_name_ar,
      master.description || existing.description || '',
      master.image_url || '',
      master.image_url || '',
      basePrice,
      salePrice,
      isOffer,
      stockQty,
      minQty,
      String(input.merchant_sku || existing.merchant_sku || '').trim(),
      isAvailable,
      master.brand || '',
      master.size_label || '',
      master.size_value ?? null,
      master.size_unit || '',
      master.barcode || null,
      existing.id
    );
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id) as Record<string, any>;
    return { listing: updated, updated_existing: true };
  }

  // Create new independent store listing linked to Master Product
  const id = uid('prd');
  const countRow = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
  let seq = 1001 + countRow.c;
  while (db.prepare('SELECT 1 FROM products WHERE LOWER(product_code) = LOWER(?)').get(`PRD-${seq}`)) {
    seq += 1;
  }
  const productCode = `PRD-${seq}`;

  db.prepare(`
    INSERT INTO products (
      id, product_code, merchant_id, category_id, master_product_id,
      name_ar, name_en, description, image_url,
      brand, size_label, size_value, size_unit, barcode, merchant_sku,
      base_price, sale_price, is_offer, stock_quantity, low_stock_threshold,
      min_order_qty, requires_prescription, addons_text, is_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?, 0, '', ?)
  `).run(
    id,
    productCode,
    input.merchant_id,
    categoryId,
    master.id,
    master.canonical_name_ar,
    master.canonical_name_en || master.canonical_name_ar,
    master.description || '',
    master.image_url || '',
    master.brand || '',
    master.size_label || '',
    master.size_value ?? null,
    master.size_unit || '',
    master.barcode || null,
    String(input.merchant_sku || '').trim(),
    basePrice,
    salePrice,
    isOffer,
    stockQty,
    minQty,
    isAvailable
  );

  const listing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, any>;
  return { listing, updated_existing: false };
}

export function ensureMasterProductForListing(input: {
  id?: string;
  name_ar: string;
  name_en?: string;
  brand?: string;
  category_id?: string | null;
  barcode?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  size_label?: string | null;
  image_url?: string;
  description?: string;
  merchant_id?: string;
  master_product_id?: string | null;
}): { master_product_id: string; master: Record<string, any>; is_new: boolean } {
  const nameAr = String(input.name_ar || '').trim();
  if (!nameAr) throw new Error('اسم المنتج بالعربية مطلوب للربط بالكتالوج المركزي');

  const cleanBarcode = String(input.barcode || '').trim() || null;
  const parsedSize = extractSize({
    size_value: input.size_value,
    size_unit: input.size_unit,
    size_label: input.size_label,
    name_ar: nameAr,
    name_en: input.name_en,
  });

  // 1. If explicit, valid master_product_id is provided, verify it exists
  const explicitMasterId = String(input.master_product_id || '').trim();
  if (explicitMasterId) {
    const existingMaster = db
      .prepare('SELECT * FROM master_products WHERE id = ?')
      .get(explicitMasterId) as Record<string, any> | undefined;
    if (existingMaster) {
      if (existingMaster.merged_into_id) {
        return ensureMasterProductForListing({ ...input, master_product_id: String(existingMaster.merged_into_id) });
      }
      return { master_product_id: existingMaster.id, master: existingMaster, is_new: false };
    }
  }

  // 2. Search central master catalog for an exact match (exact barcode or normalized name + brand + compatible size)
  const matchResult = matchMasterProducts({
    name_ar: nameAr,
    name_en: input.name_en,
    brand: input.brand,
    barcode: cleanBarcode,
    size_value: parsedSize?.canonicalValue ?? input.size_value ?? null,
    size_unit: parsedSize?.canonicalUnit ?? input.size_unit ?? null,
    size_label: input.size_label || parsedSize?.displayLabel || '',
    category_id: input.category_id,
  });

  if (matchResult.match_status === 'exact' && matchResult.exact_match) {
    const matchedMaster = db
      .prepare('SELECT * FROM master_products WHERE id = ?')
      .get(matchResult.exact_match.id) as Record<string, any>;
    if (matchedMaster) {
      // If master lacks image, barcode, brand, or description and listing provides them, update master
      const updates: string[] = [];
      const params: any[] = [];
      if (!matchedMaster.image_url && input.image_url && input.image_url.trim()) {
        updates.push('image_url = ?');
        params.push(input.image_url.trim());
      }
      if (!matchedMaster.barcode && cleanBarcode) {
        updates.push('barcode = ?');
        params.push(cleanBarcode);
      }
      if (!matchedMaster.brand && input.brand && input.brand.trim()) {
        updates.push('brand = ?');
        params.push(input.brand.trim());
      }
      if (!matchedMaster.description && input.description && input.description.trim()) {
        updates.push('description = ?');
        params.push(input.description.trim());
      }
      if (updates.length > 0) {
        params.push(matchedMaster.id);
        db.prepare(`UPDATE master_products SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
      }
      return { master_product_id: matchedMaster.id, master: matchedMaster, is_new: false };
    }
  }

  // 3. No exact match found: create a new canonical master product record automatically
  const created = createMasterProductRecord({
    canonical_name_ar: nameAr,
    canonical_name_en: input.name_en || nameAr,
    trade_name: nameAr,
    brand: input.brand || '',
    category_id: input.category_id || null,
    barcode: cleanBarcode,
    size_value: parsedSize?.canonicalValue ?? (input.size_value ?? null),
    size_unit: parsedSize?.canonicalUnit ?? (input.size_unit || ''),
    size_label: input.size_label || parsedSize?.displayLabel || '',
    image_url: input.image_url || '',
    description: input.description || '',
    allow_reuse_exact: true,
  });

  return { master_product_id: created.master.id, master: created.master, is_new: !created.reused };
}

export function reconcileAllExistingProductsToMasterCatalog(): {
  total: number;
  reconciled: number;
  linked_existing: number;
  new_masters: number;
  merged_duplicates: number;
} {
  const allProducts = db.prepare(`
    SELECT id, product_code, merchant_id, category_id, master_product_id,
           name_ar, name_en, description, image_url, brand, size_label,
           size_value, size_unit, barcode
    FROM products
  `).all() as Array<Record<string, any>>;

  let reconciled = 0;
  let linkedExisting = 0;
  let newMasters = 0;
  let mergedDuplicates = 0;

  const updateStmt = db.prepare('UPDATE products SET master_product_id = ? WHERE id = ?');

  db.transaction(() => {
    // Pass 1: Ensure every product points to an active (non-merged) master product
    for (const prod of allProducts) {
      const existingMasterId = prod.master_product_id ? String(prod.master_product_id).trim() : '';
      let validActiveId: string | null = null;
      if (existingMasterId) {
        const check = db
          .prepare('SELECT id, approval_status, merged_into_id FROM master_products WHERE id = ?')
          .get(existingMasterId) as { id: string; approval_status?: string; merged_into_id?: string | null } | undefined;
        if (check) {
          if (check.merged_into_id) {
            updateStmt.run(String(check.merged_into_id), prod.id);
            reconciled++;
            linkedExisting++;
            validActiveId = String(check.merged_into_id);
          } else {
            validActiveId = check.id;
          }
        }
      }

      if (!validActiveId) {
        const parsedSize = extractSize({
          size_value: prod.size_value,
          size_unit: prod.size_unit,
          size_label: prod.size_label,
          name_ar: prod.name_ar,
          name_en: prod.name_en,
        });
        const res = ensureMasterProductForListing({
          id: prod.id,
          name_ar: prod.name_ar,
          name_en: prod.name_en,
          brand: prod.brand,
          category_id: prod.category_id,
          barcode: prod.barcode,
          size_value: parsedSize?.canonicalValue ?? prod.size_value,
          size_unit: parsedSize?.canonicalUnit ?? prod.size_unit,
          size_label: prod.size_label || parsedSize?.displayLabel || '',
          image_url: prod.image_url,
          description: prod.description,
          merchant_id: prod.merchant_id,
        });

        updateStmt.run(res.master_product_id, prod.id);
        reconciled++;
        if (res.is_new) newMasters++;
        else linkedExisting++;
      }
    }

    // Pass 2: Recompute normalized_key on all approved master_products and safely merge exact duplicates
    const activeMasters = db
      .prepare(`
        SELECT mp.*,
          (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id) AS listing_count
        FROM master_products mp
        WHERE mp.approval_status = 'approved' AND mp.merged_into_id IS NULL
        ORDER BY listing_count DESC, mp.created_at ASC
      `)
      .all() as Array<Record<string, any>>;

    const updateKeyStmt = db.prepare('UPDATE master_products SET normalized_key = ? WHERE id = ?');
    const canonicalByGroup = new Map<string, Record<string, any>>();
    const canonicalByBarcode = new Map<string, Record<string, any>>();
    const moveProductsStmt = db.prepare(
      "UPDATE products SET master_product_id = ?, updated_at = datetime('now') WHERE master_product_id = ?"
    );
    const moveDealsStmt = db.prepare('UPDATE product_deals SET master_product_id = ? WHERE master_product_id = ?');
    const markMergedStmt = db.prepare(
      "UPDATE master_products SET approval_status = 'merged', merged_into_id = ?, updated_at = datetime('now') WHERE id = ?"
    );

    for (const mp of activeMasters) {
      const parsedSize = extractSize({
        size_value: mp.size_value,
        size_unit: mp.size_unit,
        size_label: mp.size_label,
        name_ar: mp.canonical_name_ar,
        name_en: mp.canonical_name_en,
      });
      const freshKey = buildNormalizedKey({
        name_ar: mp.canonical_name_ar,
        name_en: mp.canonical_name_en,
        brand: mp.brand,
        size_value: parsedSize?.canonicalValue ?? null,
        size_unit: parsedSize?.canonicalUnit ?? null,
        size_label: mp.size_label || parsedSize?.displayLabel || '',
      });
      if (freshKey && freshKey !== mp.normalized_key) {
        updateKeyStmt.run(freshKey, mp.id);
        mp.normalized_key = freshKey;
      }

      const cleanBarcode = String(mp.barcode || '').trim().toLowerCase();
      let targetCanonical: Record<string, any> | undefined;

      if (cleanBarcode && canonicalByBarcode.has(cleanBarcode)) {
        const bcTarget = canonicalByBarcode.get(cleanBarcode)!;
        const bcSize = extractSize({
          size_value: bcTarget.size_value,
          size_unit: bcTarget.size_unit,
          size_label: bcTarget.size_label,
          name_ar: bcTarget.canonical_name_ar,
          name_en: bcTarget.canonical_name_en,
        });
        if (areSizesCompatible(parsedSize, bcSize) !== 'conflict') {
          targetCanonical = bcTarget;
        }
      }

      if (!targetCanonical && freshKey && freshKey !== '__nosize' && canonicalByGroup.has(freshKey)) {
        const keyTarget = canonicalByGroup.get(freshKey)!;
        const keyTokens = tokenizeCanonical(
          `${keyTarget.brand || ''} ${keyTarget.canonical_name_ar || ''} ${keyTarget.canonical_name_en || ''}`
        );
        const mpTokens = tokenizeCanonical(`${mp.brand || ''} ${mp.canonical_name_ar || ''} ${mp.canonical_name_en || ''}`);
        if (!hasVariantOrFlavorConflict(mpTokens, keyTokens)) {
          targetCanonical = keyTarget;
        }
      }

      if (targetCanonical && targetCanonical.id !== mp.id) {
        // Fill missing metadata on canonical master without overwriting existing rich data
        const metaUpdates: string[] = [];
        const metaParams: unknown[] = [];
        if (!targetCanonical.image_url && mp.image_url) {
          metaUpdates.push('image_url = ?');
          metaParams.push(mp.image_url);
          targetCanonical.image_url = mp.image_url;
        }
        if (!targetCanonical.barcode && mp.barcode) {
          metaUpdates.push('barcode = ?');
          metaParams.push(mp.barcode);
          targetCanonical.barcode = mp.barcode;
        }
        if (!targetCanonical.brand && mp.brand) {
          metaUpdates.push('brand = ?');
          metaParams.push(mp.brand);
          targetCanonical.brand = mp.brand;
        }
        if (!targetCanonical.description && mp.description) {
          metaUpdates.push('description = ?');
          metaParams.push(mp.description);
          targetCanonical.description = mp.description;
        }
        if (metaUpdates.length > 0) {
          metaParams.push(targetCanonical.id);
          db.prepare(`UPDATE master_products SET ${metaUpdates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
            ...metaParams
          );
        }

        moveProductsStmt.run(targetCanonical.id, mp.id);
        moveDealsStmt.run(targetCanonical.id, mp.id);
        markMergedStmt.run(targetCanonical.id, mp.id);
        mergedDuplicates++;
      } else {
        if (freshKey && freshKey !== '__nosize' && !canonicalByGroup.has(freshKey)) {
          canonicalByGroup.set(freshKey, mp);
        }
        if (cleanBarcode && !canonicalByBarcode.has(cleanBarcode)) {
          canonicalByBarcode.set(cleanBarcode, mp);
        }
      }
    }
  })();

  return {
    total: allProducts.length,
    reconciled,
    linked_existing: linkedExisting,
    new_masters: newMasters,
    merged_duplicates: mergedDuplicates,
  };
}

export function submitMerchantProductRequestRecord(input: {
  merchant_id: string;
  requested_by?: string;
  product_name_ar: string;
  product_name_en?: string;
  brand?: string;
  category_id?: string | null;
  barcode?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  size_label?: string | null;
  image_url?: string;
  description?: string;
  proposed_price: number;
  proposed_sale_price?: number | null;
  proposed_stock?: number;
  merchant_sku?: string;
}): { request: Record<string, any>; match_preview: MatchMasterResult } {
  const nameAr = String(input.product_name_ar || '').trim();
  if (!nameAr) throw new Error('اسم المنتج مطلوب');

  const parsedSize = extractSize({
    size_value: input.size_value,
    size_unit: input.size_unit,
    size_label: input.size_label,
    name_ar: nameAr,
    name_en: input.product_name_en,
  });

  const matchPreview = matchMasterProducts({
    name_ar: nameAr,
    name_en: input.product_name_en,
    brand: input.brand,
    barcode: input.barcode,
    size_value: parsedSize?.canonicalValue ?? input.size_value ?? null,
    size_unit: parsedSize?.canonicalUnit ?? input.size_unit ?? null,
    size_label: input.size_label || parsedSize?.displayLabel || '',
  });

  const id = uid('pmr');
  db.prepare(`
    INSERT INTO product_matching_requests (
      id, merchant_id, requested_by, product_name_ar, product_name_en, brand, category_id,
      barcode, size_value, size_unit, size_label, image_url, description,
      proposed_price, proposed_sale_price, proposed_stock, merchant_sku,
      suggested_master_id, match_confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    id,
    input.merchant_id,
    String(input.requested_by || ''),
    nameAr,
    String(input.product_name_en || '').trim(),
    String(input.brand || '').trim(),
    input.category_id || null,
    String(input.barcode || '').trim() || null,
    parsedSize?.canonicalValue ?? (input.size_value ?? null),
    parsedSize?.canonicalUnit ?? String(input.size_unit || '').trim(),
    String(input.size_label || '').trim() || parsedSize?.displayLabel || '',
    String(input.image_url || '').trim(),
    String(input.description || '').trim(),
    Math.max(0, Number(input.proposed_price || 0)),
    input.proposed_sale_price !== undefined && input.proposed_sale_price !== null
      ? Number(input.proposed_sale_price)
      : null,
    Math.max(0, Math.floor(Number(input.proposed_stock ?? 10))),
    String(input.merchant_sku || '').trim(),
    matchPreview.exact_match?.id || matchPreview.candidates[0]?.id || null,
    matchPreview.match_status
  );

  const request = db.prepare('SELECT * FROM product_matching_requests WHERE id = ?').get(id) as Record<string, any>;
  return { request, match_preview: matchPreview };
}

export function reviewMerchantProductRequestRecord(input: {
  request_id: string;
  decision: 'approve_new' | 'link_existing' | 'reject';
  target_master_id?: string | null;
  auto_create_listing?: boolean;
  admin_note?: string;
  reviewed_by?: string;
  overrides?: {
    canonical_name_ar?: string;
    canonical_name_en?: string;
    brand?: string;
    category_id?: string | null;
    barcode?: string | null;
    size_label?: string | null;
    image_url?: string;
    description?: string;
  };
}): {
  request: Record<string, any>;
  master?: Record<string, any> | null;
  listing?: Record<string, any> | null;
} {
  const reqRow = db
    .prepare('SELECT * FROM product_matching_requests WHERE id = ?')
    .get(input.request_id) as Record<string, any> | undefined;
  if (!reqRow) throw new Error('طلب المنتج غير موجود');
  if (reqRow.status !== 'pending') throw new Error('تمت مراجعة هذا الطلب مسبقًا');

  const actor = String(input.reviewed_by || 'المدير العام');
  const note = String(input.admin_note || '').trim();

  if (input.decision === 'reject') {
    db.prepare(`
      UPDATE product_matching_requests
      SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(note || 'تم رفض الطلب بعد المراجعة', actor, reqRow.id);
    const updated = db.prepare('SELECT * FROM product_matching_requests WHERE id = ?').get(reqRow.id) as Record<string, any>;
    return { request: updated, master: null, listing: null };
  }

  let master: Record<string, any> | null = null;
  let listing: Record<string, any> | null = null;

  if (input.decision === 'approve_new') {
    const ov = input.overrides || {};
    const created = createMasterProductRecord({
      canonical_name_ar: ov.canonical_name_ar || reqRow.product_name_ar,
      canonical_name_en: ov.canonical_name_en ?? reqRow.product_name_en,
      brand: ov.brand ?? reqRow.brand,
      category_id: ov.category_id ?? reqRow.category_id,
      barcode: ov.barcode ?? reqRow.barcode,
      size_value: reqRow.size_value,
      size_unit: reqRow.size_unit,
      size_label: ov.size_label ?? reqRow.size_label,
      image_url: ov.image_url ?? reqRow.image_url,
      description: ov.description ?? reqRow.description,
      created_by: actor,
      allow_reuse_exact: true,
    });
    master = created.master;

    if (input.auto_create_listing !== false && Number(reqRow.proposed_price || 0) >= 0) {
      const linked = linkMerchantListingToMaster({
        merchant_id: reqRow.merchant_id,
        master_product_id: master.id,
        category_id: master.category_id || reqRow.category_id,
        base_price: Number(reqRow.proposed_price || 0),
        sale_price: reqRow.proposed_sale_price !== null ? Number(reqRow.proposed_sale_price) : null,
        stock_quantity: Number(reqRow.proposed_stock ?? 10),
        merchant_sku: reqRow.merchant_sku || '',
        is_available: true,
        actor_name: actor,
      });
      listing = linked.listing;
    }

    db.prepare(`
      UPDATE product_matching_requests
      SET status = 'approved_new', suggested_master_id = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(master.id, note || 'تم اعتماد المنتج وإضافته للكتالوج المركزي', actor, reqRow.id);
  } else if (input.decision === 'link_existing') {
    const targetId = String(input.target_master_id || reqRow.suggested_master_id || '').trim();
    if (!targetId) throw new Error('يجب تحديد المنتج المركزي المراد الربط به');
    master = db.prepare('SELECT * FROM master_products WHERE id = ?').get(targetId) as Record<string, any> | undefined || null;
    if (!master) throw new Error('المنتج المركزي المحدد غير موجود');

    if (input.auto_create_listing !== false) {
      const linked = linkMerchantListingToMaster({
        merchant_id: reqRow.merchant_id,
        master_product_id: master.id,
        category_id: master.category_id || reqRow.category_id,
        base_price: Number(reqRow.proposed_price || 0),
        sale_price: reqRow.proposed_sale_price !== null ? Number(reqRow.proposed_sale_price) : null,
        stock_quantity: Number(reqRow.proposed_stock ?? 10),
        merchant_sku: reqRow.merchant_sku || '',
        is_available: true,
        actor_name: actor,
      });
      listing = linked.listing;
    }

    db.prepare(`
      UPDATE product_matching_requests
      SET status = 'linked_existing', suggested_master_id = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(master.id, note || `تم ربط الطلب بالمنتج المركزي (${master.canonical_name_ar})`, actor, reqRow.id);
  }

  const updated = db.prepare('SELECT * FROM product_matching_requests WHERE id = ?').get(reqRow.id) as Record<string, any>;
  return { request: updated, master, listing };
}

export function mergeMasterProductsTx(input: {
  source_master_id: string;
  target_master_id: string;
  actor_name?: string;
  reason?: string;
}): { moved_listings: number; deduplicated_listings: number } {
  const { source_master_id, target_master_id } = input;
  if (!source_master_id || !target_master_id || source_master_id === target_master_id) {
    throw new Error('يجب اختيار منتجين مركزيين مختلفين للدمج');
  }

  const source = db.prepare('SELECT * FROM master_products WHERE id = ?').get(source_master_id) as Record<string, any> | undefined;
  const target = db.prepare('SELECT * FROM master_products WHERE id = ?').get(target_master_id) as Record<string, any> | undefined;
  if (!source || !target) throw new Error('أحد المنتجين غير موجود');
  if (target.approval_status === 'merged') throw new Error('المنتج الهدف مدمج مسبقًا');

  let movedListings = 0;
  let deduplicatedListings = 0;

  const tx = db.transaction(() => {
    const sourceListings = db
      .prepare('SELECT * FROM products WHERE master_product_id = ?')
      .all(source_master_id) as Array<Record<string, any>>;

    for (const listing of sourceListings) {
      const targetSameMerchant = db
        .prepare('SELECT id FROM products WHERE merchant_id = ? AND master_product_id = ? AND is_available = 1 LIMIT 1')
        .get(listing.merchant_id, target_master_id) as { id: string } | undefined;

      if (targetSameMerchant && Number(listing.is_available) === 1) {
        // Avoid unique constraint collision: deactivate duplicate listing in same store
        db.prepare(`
          UPDATE products
          SET is_available = 0, master_product_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(target_master_id, listing.id);
        deduplicatedListings += 1;
      } else {
        db.prepare(`
          UPDATE products
          SET master_product_id = ?, brand = ?, size_label = ?, size_value = ?, size_unit = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          target_master_id,
          target.brand || listing.brand || '',
          target.size_label || listing.size_label || '',
          target.size_value ?? listing.size_value ?? null,
          target.size_unit || listing.size_unit || '',
          listing.id
        );
        movedListings += 1;
      }
    }

    // Repoint deals & images
    db.prepare('UPDATE product_deals SET master_product_id = ? WHERE master_product_id = ?').run(
      target_master_id,
      source_master_id
    );
    db.prepare('UPDATE product_images SET master_product_id = ? WHERE master_product_id = ?').run(
      target_master_id,
      source_master_id
    );

    // Fill missing target barcode/image from source if target lacks them
    if (!target.barcode && source.barcode) {
      db.prepare('UPDATE master_products SET barcode = NULL WHERE id = ?').run(source_master_id);
      db.prepare('UPDATE master_products SET barcode = ? WHERE id = ?').run(source.barcode, target_master_id);
    }
    if (!target.image_url && source.image_url) {
      db.prepare('UPDATE master_products SET image_url = ? WHERE id = ?').run(source.image_url, target_master_id);
    }

    db.prepare(`
      UPDATE master_products
      SET approval_status = 'merged', merged_into_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(target_master_id, source_master_id);

    db.prepare(`
      INSERT INTO catalog_merge_audit (id, action, source_master_id, target_master_id, actor_name, reason, details_json)
      VALUES (?, 'merge_masters', ?, ?, ?, ?, ?)
    `).run(
      uid('cma'),
      source_master_id,
      target_master_id,
      String(input.actor_name || 'المدير العام'),
      String(input.reason || 'دمج منتج مكرر في الكتالوج المركزي'),
      JSON.stringify({
        source_name: source.canonical_name_ar,
        target_name: target.canonical_name_ar,
        moved_listings: movedListings,
        deduplicated_listings: deduplicatedListings,
      })
    );
  });

  tx();
  return { moved_listings: movedListings, deduplicated_listings: deduplicatedListings };
}

// ============================================================================
// 4. Multi-Store Product Comparison & Details Query (REAL DB DATA ONLY!)
// ============================================================================

export function getStorefrontProductDetailsData(productId: string) {
  const row = db
    .prepare(`
      SELECT
        p.*,
        m.business_name_ar AS merchant_name,
        m.merchant_type,
        m.zone_name AS merchant_zone,
        m.is_open_now AS merchant_is_open,
        m.image_url AS merchant_image_url,
        m.working_hours AS merchant_working_hours,
        c.name_ar AS category_name,
        c.group_key AS category_group_key,
        mp.canonical_name_ar AS master_name_ar,
        mp.canonical_name_en AS master_name_en,
        mp.brand AS master_brand,
        mp.size_label AS master_size_label,
        mp.size_value AS master_size_value,
        mp.size_unit AS master_size_unit,
        mp.barcode AS master_barcode,
        mp.image_url AS master_image_url,
        mp.description AS master_description,
        mp.usage_notes AS master_usage_notes,
        mp.ingredients AS master_ingredients
      FROM products p
      LEFT JOIN merchants m ON m.id = p.merchant_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN master_products mp ON mp.id = p.master_product_id
      WHERE p.id = ?
    `)
    .get(productId) as Record<string, any> | undefined;

  if (!row) {
    const linkedProd = db
      .prepare('SELECT id FROM products WHERE master_product_id = ? ORDER BY is_available DESC LIMIT 1')
      .get(productId) as { id: string } | undefined;
    if (linkedProd?.id) {
      return getStorefrontProductDetailsData(linkedProd.id);
    }
    return null;
  }

  const effectivePrice =
    row.sale_price !== null && row.sale_price !== undefined && Number(row.sale_price) < Number(row.base_price)
      ? Number(row.sale_price)
      : Number(row.base_price);
  const discountPct =
    row.sale_price !== null && row.sale_price !== undefined && Number(row.base_price) > 0 && Number(row.sale_price) < Number(row.base_price)
      ? Math.round(((Number(row.base_price) - Number(row.sale_price)) / Number(row.base_price)) * 100)
      : 0;

  const brand = String(row.master_brand || row.brand || '').trim();
  const sizeLabel = String(row.master_size_label || row.size_label || '').trim();
  const displayNameAr = String(row.master_name_ar || row.name_ar || '').trim();
  const displayImage = String(row.image_url || row.master_image_url || '').trim();

  // REAL Multi-Store Comparison: only listings sharing the exact same master_product_id!
  let availableStores: Array<Record<string, any>> = [];
  let unavailableStores: Array<Record<string, any>> = [];

  if (row.master_product_id) {
    const allLinked = db
      .prepare(`
        SELECT
          p.id AS product_id,
          p.merchant_id,
          p.master_product_id,
          p.name_ar,
          p.image_url,
          p.base_price,
          p.sale_price,
          p.stock_quantity,
          p.min_order_qty,
          p.is_available,
          p.size_label,
          p.is_offer,
          m.business_name_ar AS merchant_name,
          m.zone_name AS merchant_zone,
          m.is_open_now AS merchant_is_open,
          m.image_url AS merchant_image_url,
          m.working_hours AS merchant_working_hours
        FROM products p
        JOIN merchants m ON m.id = p.merchant_id
        WHERE p.master_product_id = ?
          AND m.verification_status IN ('approved', 'pending')
      `)
      .all(row.master_product_id) as Array<Record<string, any>>;

    const mapped = allLinked.map((l) => {
      const eff =
        l.sale_price !== null && l.sale_price !== undefined && Number(l.sale_price) < Number(l.base_price)
          ? Number(l.sale_price)
          : Number(l.base_price);
      const isBuyable = Boolean(l.is_available) && Number(l.stock_quantity) > 0;
      return {
        product_id: l.product_id,
        merchant_id: l.merchant_id,
        merchant_name: l.merchant_name,
        merchant_zone: l.merchant_zone,
        merchant_is_open: Boolean(l.merchant_is_open),
        merchant_image_url: l.merchant_image_url || '',
        image_url: l.image_url || displayImage,
        size_label: l.size_label || sizeLabel,
        base_price: Number(l.base_price),
        sale_price: l.sale_price !== null && l.sale_price !== undefined ? Number(l.sale_price) : null,
        effective_price: eff,
        stock_quantity: Number(l.stock_quantity),
        min_order_qty: Number(l.min_order_qty || 1),
        is_available: isBuyable,
        is_current_listing: l.product_id === row.id,
      };
    });

    availableStores = mapped
      .filter((s) => s.is_available)
      .sort((a, b) => a.effective_price - b.effective_price);
    unavailableStores = mapped
      .filter((s) => !s.is_available)
      .sort((a, b) => a.effective_price - b.effective_price);

    if (availableStores.length > 0) {
      const lowestPrice = availableStores[0].effective_price;
      const highestPrice = availableStores[availableStores.length - 1].effective_price;
      availableStores = availableStores.map((s, idx) => ({
        ...s,
        rank: idx + 1,
        is_lowest: s.effective_price === lowestPrice,
        price_diff_from_lowest: Math.round((s.effective_price - lowestPrice) * 100) / 100,
        savings_vs_highest: Math.round((highestPrice - s.effective_price) * 100) / 100,
      }));
    }
  } else {
    // Unlinked standalone product: show only its own store truthfully (never fabricate comparisons)
    const isBuyable = Boolean(row.is_available) && Number(row.stock_quantity) > 0;
    const single = {
      product_id: row.id,
      merchant_id: row.merchant_id,
      merchant_name: row.merchant_name,
      merchant_zone: row.merchant_zone,
      merchant_is_open: Boolean(row.merchant_is_open),
      merchant_image_url: row.merchant_image_url || '',
      image_url: displayImage,
      size_label: sizeLabel,
      base_price: Number(row.base_price),
      sale_price: row.sale_price !== null && row.sale_price !== undefined ? Number(row.sale_price) : null,
      effective_price: effectivePrice,
      stock_quantity: Number(row.stock_quantity),
      min_order_qty: Number(row.min_order_qty || 1),
      is_available: isBuyable,
      is_current_listing: true,
      rank: 1,
      is_lowest: true,
      price_diff_from_lowest: 0,
      savings_vs_highest: 0,
    };
    if (isBuyable) availableStores = [single];
    else unavailableStores = [single];
  }

  // Real active deals linked to this product or its master product
  const rawDeals = db
    .prepare(`
      SELECT * FROM product_deals
      WHERE is_active = 1
        AND (
          product_id = ?
          OR (master_product_id IS NOT NULL AND master_product_id = ? AND (merchant_id IS NULL OR merchant_id = ?))
        )
      ORDER BY created_at DESC
    `)
    .all(row.id, row.master_product_id || '__none__', row.merchant_id) as Array<Record<string, any>>;

  const deals = rawDeals.map((d) => {
    let giftIds: string[] = [];
    let bundleIds: string[] = [];
    try {
      giftIds = JSON.parse(d.gift_product_ids_json || '[]');
    } catch {
      giftIds = [];
    }
    try {
      bundleIds = JSON.parse(d.bundle_product_ids_json || '[]');
    } catch {
      bundleIds = [];
    }

    const fetchMiniProducts = (ids: string[]) => {
      if (!ids.length) return [];
      const placeholders = ids.map(() => '?').join(',');
      return db
        .prepare(`
          SELECT p.id, p.name_ar, p.brand, p.size_label, p.image_url, p.base_price, p.sale_price, p.merchant_id, m.business_name_ar AS merchant_name
          FROM products p
          JOIN merchants m ON m.id = p.merchant_id
          WHERE p.id IN (${placeholders}) AND p.is_available = 1
        `)
        .all(...ids);
    };

    return {
      id: d.id,
      deal_type: d.deal_type,
      title_ar: d.title_ar,
      subtitle_ar: d.subtitle_ar || '',
      required_qty: Number(d.required_qty || 1),
      free_qty: Number(d.free_qty || 0),
      discount_amount: Number(d.discount_amount || 0),
      discount_percent: Number(d.discount_percent || 0),
      min_amount: Number(d.min_amount || 0),
      gift_products: fetchMiniProducts(giftIds),
      bundle_products: fetchMiniProducts(bundleIds),
    };
  });

  // Master attributes & gallery images
  const attributes = row.master_product_id
    ? (db
        .prepare('SELECT id, attr_key, attr_value FROM product_attributes WHERE master_product_id = ?')
        .all(row.master_product_id) as Array<{ id: string; attr_key: string; attr_value: string }>)
    : [];

  const gallery = row.master_product_id
    ? (db
        .prepare('SELECT image_url FROM product_images WHERE master_product_id = ? ORDER BY is_primary DESC, sort_order ASC')
        .all(row.master_product_id) as Array<{ image_url: string }>).map((g) => g.image_url)
    : [];
  const images = Array.from(new Set([displayImage, ...gallery].filter(Boolean)));

  // Real alternative & complementary products from DB
  const sameBrandProducts = brand
    ? db
        .prepare(`
          SELECT p.id, p.name_ar, p.brand, p.size_label, p.image_url, p.base_price, p.sale_price, p.is_offer,
                 p.merchant_id, p.category_id, p.master_product_id, m.business_name_ar AS merchant_name
          FROM products p
          JOIN merchants m ON m.id = p.merchant_id
          WHERE p.is_available = 1 AND p.id != ?
            AND (LOWER(p.brand) = LOWER(?) OR p.master_product_id IN (SELECT id FROM master_products WHERE LOWER(brand) = LOWER(?)))
            AND (p.master_product_id IS NULL OR p.master_product_id != COALESCE(?, '__none__'))
          ORDER BY p.is_offer DESC, p.updated_at DESC
          LIMIT 8
        `)
        .all(row.id, brand, brand, row.master_product_id || null)
    : [];

  const cheaperAlternatives = db
    .prepare(`
      SELECT p.id, p.name_ar, p.brand, p.size_label, p.image_url, p.base_price, p.sale_price, p.is_offer,
             p.merchant_id, p.category_id, p.master_product_id, m.business_name_ar AS merchant_name
      FROM products p
      JOIN merchants m ON m.id = p.merchant_id
      WHERE p.is_available = 1 AND p.id != ? AND p.category_id = ?
        AND COALESCE(p.sale_price, p.base_price) < ?
        AND (p.master_product_id IS NULL OR p.master_product_id != COALESCE(?, '__none__'))
      ORDER BY COALESCE(p.sale_price, p.base_price) ASC
      LIMIT 8
    `)
    .all(row.id, row.category_id, effectivePrice, row.master_product_id || null);

  const complementaryProducts = db
    .prepare(`
      SELECT p.id, p.name_ar, p.brand, p.size_label, p.image_url, p.base_price, p.sale_price, p.is_offer,
             p.merchant_id, p.category_id, p.master_product_id, m.business_name_ar AS merchant_name
      FROM products p
      JOIN merchants m ON m.id = p.merchant_id
      WHERE p.is_available = 1 AND p.id != ? AND p.merchant_id = ?
        AND p.category_id != ?
      ORDER BY p.is_offer DESC, p.purchase_count DESC, p.updated_at DESC
      LIMIT 8
    `)
    .all(row.id, row.merchant_id, row.category_id);

  const lowestAvailable = availableStores.length > 0 ? availableStores[0].effective_price : effectivePrice;
  const highestAvailable =
    availableStores.length > 0 ? availableStores[availableStores.length - 1].effective_price : effectivePrice;
  const maxSavings = Math.max(0, Math.round((highestAvailable - lowestAvailable) * 100) / 100);

  return {
    product: {
      id: row.id,
      product_code: row.product_code,
      master_product_id: row.master_product_id || null,
      merchant_id: row.merchant_id,
      merchant_name: row.merchant_name,
      merchant_zone: row.merchant_zone,
      merchant_is_open: Boolean(row.merchant_is_open),
      merchant_working_hours: row.merchant_working_hours || '',
      category_id: row.category_id,
      category_name: row.category_name || '',
      name_ar: displayNameAr,
      name_en: row.master_name_en || row.name_en || '',
      brand,
      size_label: sizeLabel,
      barcode: row.master_barcode || row.barcode || null,
      image_url: displayImage,
      images,
      description: String(row.master_description || row.description || '').trim(),
      usage_notes: String(row.master_usage_notes || '').trim(),
      ingredients: String(row.master_ingredients || '').trim(),
      base_price: Number(row.base_price),
      sale_price: row.sale_price !== null && row.sale_price !== undefined ? Number(row.sale_price) : null,
      effective_price: effectivePrice,
      discount_percent: discountPct,
      is_offer: Boolean(row.is_offer),
      stock_quantity: Number(row.stock_quantity),
      min_order_qty: Number(row.min_order_qty || 1),
      is_available: Boolean(row.is_available) && Number(row.stock_quantity) > 0,
      requires_prescription: Boolean(row.requires_prescription),
      purchase_count: Number(row.purchase_count || 0),
    },
    comparison: {
      has_multi_store: availableStores.length + unavailableStores.length > 1,
      stores_count: availableStores.length,
      lowest_price: lowestAvailable,
      highest_price: highestAvailable,
      max_savings: maxSavings,
      available_stores: availableStores,
      unavailable_stores: unavailableStores,
    },
    deals,
    attributes,
    same_brand_products: sameBrandProducts,
    cheaper_alternatives: cheaperAlternatives,
    complementary_products: complementaryProducts,
  };
}

// ============================================================================
// 5. Register Express Routes (Storefront + Merchant Master + Admin Master)
// ============================================================================

export function registerMasterCatalogRoutes(app: Express): void {
  // Helper to enrich product rows with cheapest multi-store summary & active deal badge
  const enrichStorefrontProducts = (rows: Array<Record<string, any>>) => {
    if (!rows.length) return [];
    const masterIds = Array.from(new Set(rows.map((r) => r.master_product_id).filter(Boolean)));
    const prodIds = rows.map((r) => r.id);

    const comparisonMap = new Map<string, { stores_count: number; lowest_price: number; highest_price: number }>();
    if (masterIds.length > 0) {
      const ph = masterIds.map(() => '?').join(',');
      const agg = db
        .prepare(`
          SELECT
            master_product_id,
            COUNT(*) AS stores_count,
            MIN(COALESCE(sale_price, base_price)) AS lowest_price,
            MAX(COALESCE(sale_price, base_price)) AS highest_price
          FROM products
          WHERE master_product_id IN (${ph}) AND is_available = 1 AND stock_quantity > 0
          GROUP BY master_product_id
        `)
        .all(...masterIds) as Array<{
        master_product_id: string;
        stores_count: number;
        lowest_price: number;
        highest_price: number;
      }>;
      for (const a of agg) {
        comparisonMap.set(a.master_product_id, {
          stores_count: Number(a.stores_count),
          lowest_price: Number(a.lowest_price),
          highest_price: Number(a.highest_price),
        });
      }
    }

    const dealMap = new Map<string, { id: string; deal_type: string; title_ar: string }>();
    if (prodIds.length > 0) {
      const ph = prodIds.map(() => '?').join(',');
      const dealRows = db
        .prepare(`
          SELECT id, product_id, master_product_id, deal_type, title_ar
          FROM product_deals
          WHERE is_active = 1 AND product_id IN (${ph})
        `)
        .all(...prodIds) as Array<Record<string, any>>;
      for (const d of dealRows) {
        if (d.product_id && !dealMap.has(d.product_id)) {
          dealMap.set(d.product_id, { id: d.id, deal_type: d.deal_type, title_ar: d.title_ar });
        }
      }
    }

    return rows.map((r) => {
      const base = Number(r.base_price || 0);
      const sale = r.sale_price !== null && r.sale_price !== undefined ? Number(r.sale_price) : null;
      const eff = sale !== null && sale < base ? sale : base;
      const discountPct = sale !== null && base > 0 && sale < base ? Math.round(((base - sale) / base) * 100) : 0;
      const cmp = r.master_product_id ? comparisonMap.get(r.master_product_id) : undefined;
      const deal = dealMap.get(r.id) || null;
      return {
        id: r.id,
        product_code: r.product_code || '',
        master_product_id: r.master_product_id || null,
        merchant_id: r.merchant_id,
        merchant_name: r.merchant_name || '',
        merchant_type: r.merchant_type || 'grocery',
        category_id: r.category_id,
        category_name: r.category_name || '',
        category_group_key: r.category_group_key || 'groceries',
        name_ar: r.master_name_ar || r.name_ar,
        name_en: r.master_name_en || r.name_en || '',
        brand: r.master_brand || r.brand || '',
        size_label: r.master_size_label || r.size_label || '',
        image_url: r.image_url || r.master_image_url || '',
        description: r.master_description || r.description || '',
        base_price: base,
        sale_price: sale,
        effective_price: eff,
        discount_percent: discountPct,
        is_offer: Boolean(r.is_offer) || discountPct > 0,
        stock_quantity: Number(r.stock_quantity ?? 0),
        min_order_qty: Number(r.min_order_qty ?? 1),
        is_available: Boolean(r.is_available) && Number(r.stock_quantity ?? 0) > 0,
        requires_prescription: Boolean(r.requires_prescription),
        purchase_count: Number(r.purchase_count ?? 0),
        stores_count: cmp?.stores_count ?? 1,
        lowest_store_price: cmp?.lowest_price ?? eff,
        max_store_savings: cmp ? Math.max(0, Math.round((cmp.highest_price - cmp.lowest_price) * 100) / 100) : 0,
        active_deal: deal,
      };
    });
  };

  // -------------------------------------------------------------------------
  // A. Customer Storefront APIs
  // -------------------------------------------------------------------------

  app.get('/api/storefront/home', (req: Request, res: Response) => {
    const filter = String(req.query.filter || 'for_you').trim(); // for_you | fresh | groceries | offers | free_delivery
    const categoryId = String(req.query.category_id || '').trim();
    const merchantId = String(req.query.merchant_id || '').trim();
    const brand = String(req.query.brand || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(40, Math.max(8, parseInt(String(req.query.limit || '24'), 10) || 24));
    const offset = (page - 1) * limit;

    const banners = (db
      .prepare('SELECT * FROM storefront_banners WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC')
      .all() as Array<Record<string, any>>).map((b) => {
      const tf = String(b.target_filter || '');
      const targetService = tf.startsWith('service:') ? tf.slice('service:'.length).trim() : null;
      return {
        ...b,
        target_service: targetService || null,
      };
    });

    const rawCategories = db
      .prepare(`
        SELECT
          c.id, c.scope, c.parent_id, c.level, c.full_path_ar, c.name_ar, c.name_en, c.image_url, c.sort_order,
          c.group_key, c.group_name_ar,
          (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_available = 1) AS products_count,
          (SELECT p.image_url FROM products p WHERE p.category_id = c.id AND p.is_available = 1 AND TRIM(COALESCE(p.image_url, '')) != '' LIMIT 1) AS sample_image_url
        FROM categories c
        WHERE c.is_active = 1
          AND c.scope IN ('merchant', 'pharmacy')
          AND (c.merchant_id IS NULL OR EXISTS (SELECT 1 FROM merchants m WHERE m.id = c.merchant_id))
        ORDER BY c.level ASC, c.sort_order ASC, c.name_ar ASC
      `)
      .all() as Array<Record<string, any>>;

    const enrichedCategories = enrichAndOrderCategories(rawCategories);
    // Roll up products_count so parent categories show total products across all subcategories
    const directCountById = new Map<string, number>();
    for (const c of enrichedCategories) directCountById.set(String(c.id), Number(c.products_count || 0));
    const rolledCategories = enrichedCategories.map((c) => {
      const descendants = getCategoryAndDescendantIds(String(c.id));
      let totalCnt = 0;
      for (const did of descendants) totalCnt += directCountById.get(did) || 0;
      return {
        ...c,
        products_count: totalCnt,
        image_url: c.image_url || c.sample_image_url || '',
      };
    });

    const where: string[] = [
      'p.is_available = 1',
      "m.verification_status IN ('approved', 'pending')",
    ];
    const params: unknown[] = [];

    if (categoryId) {
      const catIds = getCategoryAndDescendantIds(categoryId);
      if (catIds.length > 1) {
        where.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`);
        params.push(...catIds);
      } else {
        where.push('p.category_id = ?');
        params.push(categoryId);
      }
    }
    if (merchantId) {
      where.push('p.merchant_id = ?');
      params.push(merchantId);
    }
    if (brand) {
      where.push('(LOWER(p.brand) = LOWER(?) OR LOWER(COALESCE(mp.brand, \'\')) = LOWER(?))');
      params.push(brand, brand);
    }
    if (filter === 'fresh') {
      where.push("c.group_key = 'fresh'");
    } else if (filter === 'groceries') {
      where.push("c.group_key IN ('groceries', 'drinks', 'home_care', 'kitchen')");
    } else if (filter === 'offers') {
      where.push('(p.is_offer = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price))');
    } else if (filter === 'free_delivery') {
      where.push(
        "(p.is_offer = 1 OR EXISTS (SELECT 1 FROM product_deals d WHERE d.is_active = 1 AND (d.product_id = p.id OR d.master_product_id = p.master_product_id)))"
      );
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Deduplicate same master_product_id in home feed by preferring cheapest store listing
    const totalRow = merchantId
      ? (db
          .prepare(`
            SELECT COUNT(*) AS c
            FROM products p
            JOIN merchants m ON m.id = p.merchant_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN master_products mp ON mp.id = p.master_product_id
            ${whereSql}
          `)
          .get(...params) as { c: number })
      : (db
          .prepare(`
            SELECT COUNT(DISTINCT COALESCE(p.master_product_id, p.id)) AS c
            FROM products p
            JOIN merchants m ON m.id = p.merchant_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN master_products mp ON mp.id = p.master_product_id
            ${whereSql}
          `)
          .get(...params) as { c: number });

    const rawProducts = merchantId
      ? (db
          .prepare(`
            SELECT
              p.*,
              m.business_name_ar AS merchant_name,
              m.merchant_type,
              c.name_ar AS category_name,
              c.group_key AS category_group_key,
              mp.canonical_name_ar AS master_name_ar,
              mp.canonical_name_en AS master_name_en,
              mp.brand AS master_brand,
              mp.size_label AS master_size_label,
              mp.image_url AS master_image_url,
              mp.description AS master_description
            FROM products p
            JOIN merchants m ON m.id = p.merchant_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN master_products mp ON mp.id = p.master_product_id
            ${whereSql}
            ORDER BY p.is_offer DESC, p.purchase_count DESC, COALESCE(p.sale_price, p.base_price) ASC, p.updated_at DESC
            LIMIT ? OFFSET ?
          `)
          .all(...params, limit, offset) as Array<Record<string, any>>)
      : (db
          .prepare(`
            SELECT * FROM (
              SELECT
                p.*,
                m.business_name_ar AS merchant_name,
                m.merchant_type,
                c.name_ar AS category_name,
                c.group_key AS category_group_key,
                mp.canonical_name_ar AS master_name_ar,
                mp.canonical_name_en AS master_name_en,
                mp.brand AS master_brand,
                mp.size_label AS master_size_label,
                mp.image_url AS master_image_url,
                mp.description AS master_description,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(p.master_product_id, p.id)
                  ORDER BY p.is_offer DESC, COALESCE(p.sale_price, p.base_price) ASC
                ) AS rn
              FROM products p
              JOIN merchants m ON m.id = p.merchant_id
              LEFT JOIN categories c ON c.id = p.category_id
              LEFT JOIN master_products mp ON mp.id = p.master_product_id
              ${whereSql}
            ) sub
            WHERE sub.rn = 1
            ORDER BY sub.is_offer DESC, sub.purchase_count DESC, COALESCE(sub.sale_price, sub.base_price) ASC, sub.updated_at DESC
            LIMIT ? OFFSET ?
          `)
          .all(...params, limit, offset) as Array<Record<string, any>>);

    const dedupedRows = rawProducts;

    const brands = db
      .prepare(`
        SELECT DISTINCT COALESCE(NULLIF(TRIM(mp.brand), ''), NULLIF(TRIM(p.brand), '')) AS brand_name
        FROM products p
        LEFT JOIN master_products mp ON mp.id = p.master_product_id
        WHERE p.is_available = 1
          AND COALESCE(NULLIF(TRIM(mp.brand), ''), NULLIF(TRIM(p.brand), '')) IS NOT NULL
        LIMIT 24
      `)
      .all() as Array<{ brand_name: string }>;

    res.json({
      banners,
      categories: rolledCategories,
      products: enrichStorefrontProducts(dedupedRows),
      brands: brands.map((b) => b.brand_name),
      pagination: {
        page,
        limit,
        total: Number(totalRow.c || 0),
        has_more: offset + rawProducts.length < Number(totalRow.c || 0),
      },
    });
  });

  app.get('/api/storefront/search', (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    const merchantId = String(req.query.merchant_id || '').trim();
    const categoryId = String(req.query.category_id || '').trim();
    const brand = String(req.query.brand || '').trim();
    const minPrice = req.query.min_price !== undefined && req.query.min_price !== '' ? Number(req.query.min_price) : null;
    const maxPrice = req.query.max_price !== undefined && req.query.max_price !== '' ? Number(req.query.max_price) : null;
    const sortBy = String(req.query.sort || 'relevance'); // relevance | price_asc | price_desc | discount
    const limit = Math.min(48, Math.max(10, parseInt(String(req.query.limit || '24'), 10) || 24));

    const where: string[] = ['p.is_available = 1', "m.verification_status IN ('approved', 'pending')"];
    const params: unknown[] = [];

    if (merchantId) {
      where.push('p.merchant_id = ?');
      params.push(merchantId);
    }
    if (categoryId) {
      const catIds = getCategoryAndDescendantIds(categoryId);
      if (catIds.length > 1) {
        where.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`);
        params.push(...catIds);
      } else {
        where.push('p.category_id = ?');
        params.push(categoryId);
      }
    }
    if (brand) {
      where.push("(LOWER(p.brand) = LOWER(?) OR LOWER(COALESCE(mp.brand, '')) = LOWER(?))");
      params.push(brand, brand);
    }
    if (minPrice !== null && Number.isFinite(minPrice)) {
      where.push('COALESCE(p.sale_price, p.base_price) >= ?');
      params.push(minPrice);
    }
    if (maxPrice !== null && Number.isFinite(maxPrice)) {
      where.push('COALESCE(p.sale_price, p.base_price) <= ?');
      params.push(maxPrice);
    }

    if (q) {
      const ftsQuery = isProductsFtsReady() ? buildFtsMatchQuery(q) : null;
      const like = `%${q}%`;
      if (ftsQuery) {
        where.push(
          '(p.id IN (SELECT product_id FROM products_fts WHERE products_fts MATCH ?) OR p.name_ar LIKE ? OR p.name_en LIKE ? OR p.brand LIKE ? OR p.barcode LIKE ? OR COALESCE(mp.canonical_name_ar, \'\') LIKE ? OR COALESCE(mp.brand, \'\') LIKE ?)'
        );
        params.push(ftsQuery, like, like, like, like, like, like);
      } else {
        where.push(
          "(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.brand LIKE ? OR p.barcode LIKE ? OR COALESCE(mp.canonical_name_ar, '') LIKE ? OR COALESCE(mp.brand, '') LIKE ?)"
        );
        params.push(like, like, like, like, like, like);
      }
    }

    const orderSql =
      sortBy === 'price_asc'
        ? 'ORDER BY COALESCE(p.sale_price, p.base_price) ASC'
        : sortBy === 'price_desc'
        ? 'ORDER BY COALESCE(p.sale_price, p.base_price) DESC'
        : sortBy === 'discount'
        ? 'ORDER BY p.is_offer DESC, (p.base_price - COALESCE(p.sale_price, p.base_price)) DESC'
        : 'ORDER BY p.is_offer DESC, p.purchase_count DESC, COALESCE(p.sale_price, p.base_price) ASC';

    const rawItems = db
      .prepare(`
        SELECT
          p.*,
          m.business_name_ar AS merchant_name,
          m.merchant_type,
          c.name_ar AS category_name,
          c.group_key AS category_group_key,
          mp.canonical_name_ar AS master_name_ar,
          mp.canonical_name_en AS master_name_en,
          mp.brand AS master_brand,
          mp.size_label AS master_size_label,
          mp.image_url AS master_image_url,
          mp.description AS master_description
        FROM products p
        JOIN merchants m ON m.id = p.merchant_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN master_products mp ON mp.id = p.master_product_id
        WHERE ${where.join(' AND ')}
        ${orderSql}
        LIMIT ?
      `)
      .all(...params, limit) as Array<Record<string, any>>;

    const topOffers = db
      .prepare(`
        SELECT
          p.*,
          m.business_name_ar AS merchant_name,
          m.merchant_type,
          c.name_ar AS category_name,
          c.group_key AS category_group_key,
          mp.canonical_name_ar AS master_name_ar,
          mp.brand AS master_brand,
          mp.size_label AS master_size_label,
          mp.image_url AS master_image_url
        FROM products p
        JOIN merchants m ON m.id = p.merchant_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN master_products mp ON mp.id = p.master_product_id
        WHERE p.is_available = 1 AND (p.is_offer = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price))
        ORDER BY (p.base_price - COALESCE(p.sale_price, p.base_price)) DESC, p.updated_at DESC
        LIMIT 8
      `)
      .all() as Array<Record<string, any>>;

    // Trending searches derived from real top categories/brands/products + grocery defaults
    const realTrending = db
      .prepare(`
        SELECT DISTINCT name_ar AS label FROM (
          SELECT name_ar FROM products WHERE is_available = 1 ORDER BY purchase_count DESC, is_offer DESC LIMIT 6
        )
      `)
      .all() as Array<{ label: string }>;

    const trendingQueries = Array.from(
      new Set([
        ...realTrending.map((t) => t.label),
        'حليب',
        'نسكافيه',
        'أرز',
        'زيت',
        'دجاج',
        'منظفات',
        'عصائر',
        'جبنة',
      ])
    ).slice(0, 10);

    const availableBrands = db
      .prepare(`
        SELECT DISTINCT COALESCE(NULLIF(TRIM(mp.brand), ''), NULLIF(TRIM(p.brand), '')) AS b
        FROM products p
        LEFT JOIN master_products mp ON mp.id = p.master_product_id
        WHERE p.is_available = 1 AND COALESCE(NULLIF(TRIM(mp.brand), ''), NULLIF(TRIM(p.brand), '')) IS NOT NULL
        LIMIT 20
      `)
      .all() as Array<{ b: string }>;

    const availableStores = db
      .prepare(`
        SELECT m.id, m.business_name_ar, COUNT(p.id) AS products_count
        FROM merchants m
        JOIN products p ON p.merchant_id = m.id AND p.is_available = 1
        GROUP BY m.id
        ORDER BY products_count DESC
        LIMIT 20
      `)
      .all() as Array<{ id: string; business_name_ar: string; products_count: number }>;

    const dedupedSearchItems = merchantId
      ? rawItems
      : (() => {
          const seen = new Map<string, Record<string, any>>();
          const list: Array<Record<string, any>> = [];
          for (const item of rawItems) {
            const mId = item.master_product_id;
            if (!mId) {
              list.push(item);
              continue;
            }
            const existing = seen.get(mId);
            const itemPrice =
              item.sale_price !== null && item.sale_price < item.base_price ? item.sale_price : item.base_price;
            if (!existing) {
              seen.set(mId, item);
              list.push(item);
            } else {
              const exPrice =
                existing.sale_price !== null && existing.sale_price < existing.base_price
                  ? existing.sale_price
                  : existing.base_price;
              if (itemPrice < exPrice) {
                const idx = list.indexOf(existing);
                if (idx !== -1) list[idx] = item;
                seen.set(mId, item);
              }
            }
          }
          return list;
        })();

    res.json({
      query: q,
      items: enrichStorefrontProducts(dedupedSearchItems),
      top_offers: enrichStorefrontProducts(topOffers),
      trending_queries: trendingQueries,
      facets: {
        brands: availableBrands.map((x) => x.b),
        stores: availableStores,
      },
    });
  });

  app.get(
    ['/api/storefront/products/:productId/details', '/api/storefront/products/:productId'],
    (req: Request, res: Response) => {
      const data = getStorefrontProductDetailsData(String(req.params.productId || ''));
      if (!data) return res.status(404).json({ error: 'المنتج غير موجود' });
      res.json(data);
    }
  );

  // Otlobha Smart Shopping Assistant (Gemini AI + real DB catalog & price comparison helper)
  app.post('/api/storefront/assistant', async (req: Request, res: Response) => {
    const rawMessage = req.body?.message ?? req.body?.prompt ?? '';
    const message = String(rawMessage).trim();
    if (!message) {
      return res.json({
        reply_ar: 'أهلاً بك في مساعد اطلبها الذكي! اكتب أي سؤال أو اسم منتج أو خدمة تحتاجها (مثل: أرخص نسكافيه، مقاضي الفطار، عروض اليوم، أو طلب مشوار) وسأساعدك فورًا.',
        suggested_products: [],
        suggested_service: '',
        quick_prompts: ['أرخص العروض اليوم', 'مقاضي الفطار والألبان', 'قهوة وشاي بأقل سعر', 'إزاي أطلب طلب نصي حر؟'],
      });
    }

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history: AssistantHistoryTurn[] = rawHistory
      .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
      .slice(-10)
      .map((h: any) => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        text: String(h.text).trim().slice(0, 1200),
      }));

    const queryProductsByTokens = (tokens: string[], preferCheapest: boolean, limit = 12) => {
      const cleanTokens = tokens.map((t) => String(t || '').trim()).filter((t) => t.length >= 2).slice(0, 6);
      if (cleanTokens.length === 0) return [] as Array<Record<string, any>>;
      const likeClauses = cleanTokens.map(
        () =>
          "(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.brand LIKE ? OR c.name_ar LIKE ? OR COALESCE(mp.canonical_name_ar, '') LIKE ?)"
      );
      const likeParams: string[] = [];
      for (const t of cleanTokens) {
        const lk = `%${t}%`;
        likeParams.push(lk, lk, lk, lk, lk);
      }
      return db
        .prepare(`
          SELECT
            p.*, m.business_name_ar AS merchant_name, m.merchant_type,
            c.name_ar AS category_name, c.group_key AS category_group_key,
            mp.canonical_name_ar AS master_name_ar, mp.brand AS master_brand,
            mp.size_label AS master_size_label, mp.image_url AS master_image_url
          FROM products p
          JOIN merchants m ON m.id = p.merchant_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN master_products mp ON mp.id = p.master_product_id
          WHERE p.is_available = 1 AND (${likeClauses.join(' OR ')})
          ORDER BY ${preferCheapest ? 'COALESCE(p.sale_price, p.base_price) ASC' : 'p.is_offer DESC, COALESCE(p.sale_price, p.base_price) ASC'}
          LIMIT ?
        `)
        .all(...likeParams, limit) as Array<Record<string, any>>;
    };

    try {
      const norm = normalizeText(message);
      const wantsCheapest = norm.includes('ارخص') || norm.includes('اقل سعر') || norm.includes('سعر');
      const stopWords = new Set([
        'عايز', 'اريد', 'ابحث', 'هات', 'محتاج', 'ارخص', 'اقل', 'سعر', 'عروض', 'عرض',
        'اليوم', 'النهاردة', 'النهارده', 'بين', 'المتاجر', 'ايه', 'ازاي', 'ممكن', 'لو', 'سمحت', 'عن', 'في', 'من',
      ]);
      const tokens = tokenizeCanonical(message).filter((t) => !stopWords.has(t));

      let candidateRows = queryProductsByTokens(tokens, wantsCheapest, 14);
      if (candidateRows.length < 6) {
        const fallbackRows = db
          .prepare(`
            SELECT
              p.*, m.business_name_ar AS merchant_name, m.merchant_type,
              c.name_ar AS category_name, c.group_key AS category_group_key,
              mp.canonical_name_ar AS master_name_ar, mp.brand AS master_brand,
              mp.size_label AS master_size_label, mp.image_url AS master_image_url
            FROM products p
            JOIN merchants m ON m.id = p.merchant_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN master_products mp ON mp.id = p.master_product_id
            WHERE p.is_available = 1
            ORDER BY p.is_offer DESC, COALESCE(p.sale_price, p.base_price) ASC
            LIMIT 12
          `)
          .all() as Array<Record<string, any>>;
        const seen = new Set(candidateRows.map((r) => String(r.id)));
        for (const row of fallbackRows) {
          if (!seen.has(String(row.id))) {
            candidateRows.push(row);
            seen.add(String(row.id));
          }
        }
      }

      const enrichedCandidates = enrichStorefrontProducts(candidateRows);
      const categoryRows = db
        .prepare(`SELECT name_ar FROM categories WHERE COALESCE(is_active, 1) = 1 ORDER BY sort_order ASC LIMIT 30`)
        .all() as Array<{ name_ar: string }>;
      const merchantRows = db
        .prepare(`SELECT business_name_ar FROM merchants WHERE verification_status = 'approved' ORDER BY orders_count DESC LIMIT 20`)
        .all() as Array<{ business_name_ar: string }>;

      const aiResult = await runOtlobhaGeminiAssistant({
        message,
        history,
        catalogProducts: enrichedCandidates.map((p) => ({
          id: p.id,
          name_ar: p.name_ar,
          brand: p.brand,
          size_label: p.size_label,
          category_name: p.category_name,
          merchant_name: p.merchant_name,
          effective_price: p.effective_price,
          base_price: p.base_price,
          is_offer: Boolean(p.is_offer),
          stores_count: p.stores_count,
        })),
        categoryNames: categoryRows.map((c) => c.name_ar).filter(Boolean),
        merchantNames: merchantRows.map((m) => m.business_name_ar).filter(Boolean),
      });

      // Resolve real suggested products from Gemini's selected IDs and/or search_keywords
      let suggestedProducts = aiResult.suggested_product_ids
        .map((id) => enrichedCandidates.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      if (suggestedProducts.length === 0 && aiResult.search_keywords.length > 0) {
        const kwTokens = aiResult.search_keywords.flatMap((kw) => tokenizeCanonical(kw));
        const kwRows = queryProductsByTokens(
          kwTokens.length > 0 ? kwTokens : aiResult.search_keywords,
          wantsCheapest,
          8
        );
        suggestedProducts = enrichStorefrontProducts(kwRows);
      }

      return res.json({
        reply_ar: aiResult.reply_ar,
        suggested_products: suggestedProducts.slice(0, 8),
        suggested_service: aiResult.suggested_service,
        quick_prompts: aiResult.quick_prompts,
        model: aiResult.model,
      });
    } catch (err) {
      if (err instanceof GeminiAssistantError) {
        console.error(`[OtlobhaAssistant] ${err.code} (${err.statusCode}): ${err.message}`);
        return res.status(err.statusCode).json({
          error: err.message,
          error_code: err.code,
        });
      }
      console.error('[OtlobhaAssistant] Unexpected error:', err);
      return res.status(500).json({
        error: 'حدث خطأ غير متوقع في المساعد الذكي. يرجى المحاولة مرة أخرى.',
        error_code: 'INTERNAL_ERROR',
      });
    }
  });

  // -------------------------------------------------------------------------
  // B. Merchant Master Catalog Matching, Linking & Requests
  // -------------------------------------------------------------------------

  app.post('/api/merchant/master-catalog/match', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const result = matchMasterProducts({
      name_ar: req.body?.name_ar,
      name_en: req.body?.name_en,
      brand: req.body?.brand,
      barcode: req.body?.barcode,
      size_value: req.body?.size_value,
      size_unit: req.body?.size_unit,
      size_label: req.body?.size_label,
      category_id: req.body?.category_id,
    });
    res.json(result);
  });

  app.post('/api/merchant/master-catalog/link-listing', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const auth = req.auth!;
    const effectiveMerchantId = auth.role === 'merchant' ? auth.id : String(req.body?.merchant_id || '').trim();
    if (!effectiveMerchantId) return res.status(400).json({ error: 'معرّف المتجر مطلوب' });
    if (auth.role === 'merchant' && req.body?.merchant_id && String(req.body.merchant_id) !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بربط منتج لمتجر آخر' });
    }
    try {
      const result = linkMerchantListingToMaster({
        merchant_id: effectiveMerchantId,
        master_product_id: String(req.body?.master_product_id || '').trim(),
        category_id: req.body?.category_id || null,
        base_price: Number(req.body?.base_price),
        sale_price: req.body?.sale_price !== undefined ? req.body.sale_price : null,
        stock_quantity: req.body?.stock_quantity !== undefined ? Number(req.body.stock_quantity) : 10,
        min_order_qty: req.body?.min_order_qty !== undefined ? Number(req.body.min_order_qty) : 1,
        merchant_sku: String(req.body?.merchant_sku || ''),
        is_available: req.body?.is_available !== false,
        is_offer: Boolean(req.body?.is_offer),
        actor_name: auth.fullName,
      });
      recordAuditLog({
        actor_name: auth.fullName,
        actor_role: auth.role,
        action: 'MERCHANT_LINKED_MASTER_PRODUCT',
        entity_type: 'products',
        entity_id: result.listing.id,
        details: `ربط المتجر (${effectiveMerchantId}) بالمنتج المركزي (${result.listing.master_product_id}) بسعر ${result.listing.base_price} ج.م`,
      });
      res.status(result.updated_existing ? 200 : 201).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/merchant/master-catalog/request-new', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const auth = req.auth!;
    const effectiveMerchantId = auth.role === 'merchant' ? auth.id : String(req.body?.merchant_id || '').trim();
    if (!effectiveMerchantId) return res.status(400).json({ error: 'معرّف المتجر مطلوب' });
    try {
      let resolvedCatId: string | null = req.body?.category_id || null;
      const rawCatPath = String(req.body?.category_path || '').trim();
      if (rawCatPath) {
        const resolver = createCategoryPathResolver({ scope: 'merchant', merchantId: null });
        const resolved = resolveOrCreateCategoryPath(resolver, rawCatPath, resolvedCatId);
        if (resolved.category_id) resolvedCatId = resolved.category_id;
        if (resolved.created_count > 0) recomputeAllCategoryPaths();
      }
      const result = submitMerchantProductRequestRecord({
        merchant_id: effectiveMerchantId,
        requested_by: auth.fullName,
        product_name_ar: req.body?.product_name_ar,
        product_name_en: req.body?.product_name_en,
        brand: req.body?.brand,
        category_id: resolvedCatId,
        barcode: req.body?.barcode || null,
        size_value: req.body?.size_value ?? null,
        size_unit: req.body?.size_unit ?? null,
        size_label: req.body?.size_label ?? null,
        image_url: req.body?.image_url || '',
        description: req.body?.description || '',
        proposed_price: Number(req.body?.proposed_price || 0),
        proposed_sale_price:
          req.body?.proposed_sale_price !== undefined && req.body?.proposed_sale_price !== ''
            ? Number(req.body.proposed_sale_price)
            : null,
        proposed_stock: Number(req.body?.proposed_stock ?? 10),
        merchant_sku: String(req.body?.merchant_sku || ''),
      });
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/merchant/master-catalog/my-requests', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const auth = req.auth!;
    const merchantId = auth.role === 'merchant' ? auth.id : String(req.query.merchant_id || '').trim();
    const rows = merchantId
      ? db
          .prepare(`
            SELECT r.*, m.business_name_ar AS merchant_name, mp.canonical_name_ar AS suggested_master_name
            FROM product_matching_requests r
            LEFT JOIN merchants m ON m.id = r.merchant_id
            LEFT JOIN master_products mp ON mp.id = r.suggested_master_id
            WHERE r.merchant_id = ?
            ORDER BY r.created_at DESC
            LIMIT 100
          `)
          .all(merchantId)
      : db
          .prepare(`
            SELECT r.*, m.business_name_ar AS merchant_name, mp.canonical_name_ar AS suggested_master_name
            FROM product_matching_requests r
            LEFT JOIN merchants m ON m.id = r.merchant_id
            LEFT JOIN master_products mp ON mp.id = r.suggested_master_id
            ORDER BY r.created_at DESC
            LIMIT 100
          `)
          .all();
    res.json(rows);
  });

  // -------------------------------------------------------------------------
  // C. Product Savings Deals & Free Gifts APIs (Merchant + Admin)
  // -------------------------------------------------------------------------

  app.get('/api/deals', (req: Request, res: Response) => {
    const merchantId = String(req.query.merchant_id || '').trim();
    const productId = String(req.query.product_id || '').trim();
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (merchantId) {
      where.push('d.merchant_id = ?');
      params.push(merchantId);
    }
    if (productId) {
      where.push('d.product_id = ?');
      params.push(productId);
    }
    const rows = db
      .prepare(`
        SELECT d.*, m.business_name_ar AS merchant_name, p.name_ar AS product_name_ar
        FROM product_deals d
        LEFT JOIN merchants m ON m.id = d.merchant_id
        LEFT JOIN products p ON p.id = d.product_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.is_active DESC, d.created_at DESC
        LIMIT 200
      `)
      .all(...params) as Array<Record<string, any>>;

    res.json(
      rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        gift_product_ids: JSON.parse(r.gift_product_ids_json || '[]'),
        bundle_product_ids: JSON.parse(r.bundle_product_ids_json || '[]'),
      }))
    );
  });

  app.post('/api/deals', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const auth = req.auth!;
    const effectiveMerchantId = auth.role === 'merchant' ? auth.id : (req.body?.merchant_id || null);
    const titleAr = String(req.body?.title_ar || '').trim();
    if (!titleAr) return res.status(400).json({ error: 'عنوان العرض مطلوب' });

    const productId = req.body?.product_id ? String(req.body.product_id) : null;
    let masterProductId = req.body?.master_product_id ? String(req.body.master_product_id) : null;
    if (productId) {
      const prod = db.prepare('SELECT merchant_id, master_product_id FROM products WHERE id = ?').get(productId) as
        | { merchant_id: string; master_product_id: string | null }
        | undefined;
      if (!prod) return res.status(404).json({ error: 'المنتج غير موجود' });
      if (auth.role === 'merchant' && prod.merchant_id !== auth.id) {
        return res.status(403).json({ error: 'غير مصرح لك بإضافة عرض لمنتج متجر آخر' });
      }
      if (!masterProductId && prod.master_product_id) masterProductId = prod.master_product_id;
    }

    const id = uid('dl');
    db.prepare(`
      INSERT INTO product_deals (
        id, merchant_id, product_id, master_product_id, deal_type, title_ar, subtitle_ar,
        required_qty, free_qty, discount_amount, discount_percent,
        gift_product_ids_json, bundle_product_ids_json, min_amount, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      effectiveMerchantId,
      productId,
      masterProductId,
      String(req.body?.deal_type || 'bundle_discount'),
      titleAr,
      String(req.body?.subtitle_ar || ''),
      Math.max(1, Number(req.body?.required_qty || 1)),
      Math.max(0, Number(req.body?.free_qty || 0)),
      Math.max(0, Number(req.body?.discount_amount || 0)),
      Math.max(0, Number(req.body?.discount_percent || 0)),
      JSON.stringify(Array.isArray(req.body?.gift_product_ids) ? req.body.gift_product_ids : []),
      JSON.stringify(Array.isArray(req.body?.bundle_product_ids) ? req.body.bundle_product_ids : []),
      Math.max(0, Number(req.body?.min_amount || 0))
    );
    res.status(201).json({ ok: true, id });
  });

  app.delete('/api/deals/:id', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
    const auth = req.auth!;
    const deal = db.prepare('SELECT id, merchant_id FROM product_deals WHERE id = ?').get(req.params.id) as
      | { id: string; merchant_id: string | null }
      | undefined;
    if (!deal) return res.status(404).json({ error: 'العرض غير موجود' });
    if (auth.role === 'merchant' && deal.merchant_id !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بحذف عرض متجر آخر' });
    }
    db.prepare('DELETE FROM product_deals WHERE id = ?').run(deal.id);
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // D. Super Admin Master Catalog Management APIs
  // -------------------------------------------------------------------------

  const ensureAdminCatalogAccess = (req: Request, res: Response): boolean => {
    const auth = req.auth!;
    if (!isAdminAuth(auth)) {
      res.status(403).json({ error: 'هذا الإجراء مخصص للإدارة فقط' });
      return false;
    }
    if (!hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license', '*')) {
      res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بإدارة الكتالوج المركزي' });
      return false;
    }
    return true;
  };

  app.get('/api/admin/master-products', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '30'), 10) || 30));
    const offset = (page - 1) * limit;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (status && status !== 'all') {
      where.push('mp.approval_status = ?');
      params.push(status);
    } else {
      where.push("mp.approval_status != 'merged'");
    }
    if (q) {
      const lk = `%${q}%`;
      where.push('(mp.canonical_name_ar LIKE ? OR mp.canonical_name_en LIKE ? OR mp.brand LIKE ? OR mp.barcode LIKE ?)');
      params.push(lk, lk, lk, lk);
    }

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM master_products mp WHERE ${where.join(' AND ')}`).get(...params) as { c: number }
    ).c;

    const items = db
      .prepare(`
        SELECT
          mp.*,
          c.name_ar AS category_name,
          COALESCE(NULLIF(TRIM(c.full_path_ar), ''), CASE WHEN c.name_ar IS NOT NULL THEN c.name_ar || ';' ELSE '' END) AS category_path,
          (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id) AS total_listings,
          (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS active_stores_count,
          (SELECT MIN(COALESCE(p.sale_price, p.base_price)) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS lowest_price,
          (SELECT MAX(COALESCE(p.sale_price, p.base_price)) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS highest_price
        FROM master_products mp
        LEFT JOIN categories c ON c.id = mp.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY active_stores_count DESC, mp.updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset);

    const stats = {
      approved_masters: (db.prepare("SELECT COUNT(*) AS c FROM master_products WHERE approval_status = 'approved'").get() as { c: number }).c,
      pending_requests: (db.prepare("SELECT COUNT(*) AS c FROM product_matching_requests WHERE status = 'pending'").get() as { c: number }).c,
      linked_listings: (db.prepare('SELECT COUNT(*) AS c FROM products WHERE master_product_id IS NOT NULL').get() as { c: number }).c,
      multi_store_masters: (
        db
          .prepare(`
            SELECT COUNT(*) AS c FROM (
              SELECT master_product_id FROM products
              WHERE master_product_id IS NOT NULL AND is_available = 1
              GROUP BY master_product_id HAVING COUNT(*) >= 2
            )
          `)
          .get() as { c: number }
      ).c,
    };

    res.json({ items, total, page, limit, stats });
  });

  app.get('/api/admin/master-products/:id/listings', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    const master = db
      .prepare(`
        SELECT mp.*, c.name_ar AS category_name
        FROM master_products mp
        LEFT JOIN categories c ON c.id = mp.category_id
        WHERE mp.id = ?
      `)
      .get(req.params.id);
    if (!master) return res.status(404).json({ error: 'المنتج المركزي غير موجود' });

    const listings = db
      .prepare(`
        SELECT p.*, m.business_name_ar AS merchant_name, m.zone_name AS merchant_zone, m.is_open_now
        FROM products p
        JOIN merchants m ON m.id = p.merchant_id
        WHERE p.master_product_id = ?
        ORDER BY p.is_available DESC, COALESCE(p.sale_price, p.base_price) ASC
      `)
      .all(req.params.id);

    const attributes = db
      .prepare('SELECT * FROM product_attributes WHERE master_product_id = ?')
      .all(req.params.id);

    res.json({ master, listings, attributes });
  });

  app.post('/api/admin/master-products', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      let resolvedCatId: string | null = req.body?.category_id ? String(req.body.category_id).trim() : null;
      const rawCatPath = String(req.body?.category_path || '').trim();
      if (rawCatPath) {
        const resolver = createCategoryPathResolver({ scope: 'merchant', merchantId: null });
        const resolved = resolveOrCreateCategoryPath(resolver, rawCatPath, resolvedCatId);
        if (resolved.category_id) resolvedCatId = resolved.category_id;
        if (resolved.created_count > 0) recomputeAllCategoryPaths();
      }
      // Validate category_id exists (or gracefully create/pick valid category)
      resolvedCatId = ensureValidStoreCategoryId(resolvedCatId);

      const result = createMasterProductRecord({
        ...req.body,
        category_id: resolvedCatId,
        created_by: req.auth!.fullName,
        allow_reuse_exact: false,
      });

      // Automatically publish the Master Product directly into the live Store (products table)
      const targetMerchantId = ensureDefaultStorefrontMerchant(req.body?.merchant_id);
      const parsedBasePrice = parseFlexibleMoney(req.body?.base_price ?? req.body?.price) ?? 0;
      const parsedSalePriceRaw = parseFlexibleMoney(req.body?.sale_price);
      const parsedSalePrice =
        parsedSalePriceRaw !== null && parsedSalePriceRaw > 0 && parsedSalePriceRaw < parsedBasePrice
          ? parsedSalePriceRaw
          : null;
      const parsedStock = Math.max(0, Math.floor(Number(req.body?.stock_quantity ?? 50) || 50));

      const linked = linkMerchantListingToMaster({
        merchant_id: targetMerchantId,
        master_product_id: String(result.master.id),
        category_id: resolvedCatId,
        base_price: parsedBasePrice,
        sale_price: parsedSalePrice,
        stock_quantity: parsedStock,
        is_available: req.body?.is_available !== false,
        is_offer: Boolean(req.body?.is_offer) || parsedSalePrice !== null,
        actor_name: req.auth!.fullName,
      });

      res.status(201).json({
        ok: true,
        ...result,
        listing: linked.listing,
        merchant_id: targetMerchantId,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/admin/master-products/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const existing = db.prepare('SELECT * FROM master_products WHERE id = ?').get(req.params.id) as Record<string, any> | undefined;
    if (!existing) return res.status(404).json({ error: 'المنتج المركزي غير موجود' });

    const b = req.body || {};
    const nextNameAr = String(b.canonical_name_ar ?? existing.canonical_name_ar).trim();
    const nextNameEn = String(b.canonical_name_en ?? existing.canonical_name_en).trim();
    const nextBrand = String(b.brand ?? existing.brand).trim();
    const nextSizeLabel = String(b.size_label ?? existing.size_label).trim();
    const parsedSize = extractSize({
      size_value: b.size_value !== undefined ? b.size_value : existing.size_value,
      size_unit: b.size_unit !== undefined ? b.size_unit : existing.size_unit,
      size_label: nextSizeLabel,
      name_ar: nextNameAr,
      name_en: nextNameEn,
    });
    const normKey = buildNormalizedKey({
      name_ar: nextNameAr,
      name_en: nextNameEn,
      brand: nextBrand,
      size_value: parsedSize?.canonicalValue ?? null,
      size_unit: parsedSize?.canonicalUnit ?? null,
      size_label: nextSizeLabel || parsedSize?.displayLabel || '',
    });

    db.prepare(`
      UPDATE master_products SET
        canonical_name_ar = ?,
        canonical_name_en = ?,
        trade_name = ?,
        brand = ?,
        category_id = ?,
        barcode = ?,
        size_value = ?,
        size_unit = ?,
        size_label = ?,
        image_url = ?,
        description = ?,
        usage_notes = ?,
        ingredients = ?,
        approval_status = ?,
        normalized_key = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      nextNameAr,
      nextNameEn,
      String(b.trade_name ?? existing.trade_name ?? nextNameAr).trim(),
      nextBrand,
      b.category_id !== undefined ? b.category_id : existing.category_id,
      b.barcode !== undefined ? (String(b.barcode || '').trim() || null) : existing.barcode,
      parsedSize?.canonicalValue ?? existing.size_value ?? null,
      parsedSize?.canonicalUnit ?? existing.size_unit ?? '',
      nextSizeLabel || parsedSize?.displayLabel || '',
      b.image_url !== undefined ? String(b.image_url || '').trim() : existing.image_url,
      b.description !== undefined ? String(b.description || '') : existing.description,
      b.usage_notes !== undefined ? String(b.usage_notes || '') : existing.usage_notes,
      b.ingredients !== undefined ? String(b.ingredients || '') : existing.ingredients,
      b.approval_status ?? existing.approval_status,
      normKey,
      existing.id
    );

    // Sync canonical fields down to linked store listings
    const nextCatId = b.category_id !== undefined ? b.category_id : existing.category_id;
    const nextImgUrl = b.image_url !== undefined ? String(b.image_url || '').trim() : existing.image_url;
    const nextDesc = b.description !== undefined ? String(b.description || '') : existing.description;
    db.prepare(`
      UPDATE products
      SET
        name_ar = ?,
        name_en = ?,
        category_id = COALESCE(?, category_id),
        image_url = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE image_url END,
        description = ?,
        brand = ?,
        size_label = ?,
        size_value = ?,
        size_unit = ?,
        barcode = ?,
        updated_at = datetime('now')
      WHERE master_product_id = ?
    `).run(
      nextNameAr,
      nextNameEn || nextNameAr,
      nextCatId,
      nextImgUrl,
      nextImgUrl,
      nextDesc,
      nextBrand,
      nextSizeLabel || parsedSize?.displayLabel || '',
      parsedSize?.canonicalValue ?? existing.size_value ?? null,
      parsedSize?.canonicalUnit ?? existing.size_unit ?? '',
      b.barcode !== undefined ? (String(b.barcode || '').trim() || null) : existing.barcode,
      existing.id
    );

    const updated = db.prepare('SELECT * FROM master_products WHERE id = ?').get(existing.id);
    res.json({ ok: true, master: updated });
  });

  app.get('/api/admin/master-products/duplicates', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
    const masters = db
      .prepare(`
        SELECT mp.*,
          (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS stores_count
        FROM master_products mp
        WHERE mp.approval_status = 'approved'
        ORDER BY mp.created_at DESC
        LIMIT 250
      `)
      .all() as Array<Record<string, any>>;

    const pairs: Array<{
      master_a: Record<string, any>;
      master_b: Record<string, any>;
      confidence_score: number;
      reasons: string[];
    }> = [];
    const seenPairs = new Set<string>();

    for (const m of masters) {
      const result = matchMasterProducts({
        name_ar: m.canonical_name_ar,
        name_en: m.canonical_name_en,
        brand: m.brand,
        barcode: m.barcode,
        size_value: m.size_value,
        size_unit: m.size_unit,
        size_label: m.size_label,
        exclude_master_id: m.id,
      });
      for (const c of result.candidates) {
        if (c.confidence_score < 60) continue;
        const pairKey = [m.id, c.id].sort().join('::');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        pairs.push({
          master_a: m,
          master_b: c,
          confidence_score: c.confidence_score,
          reasons: c.match_reasons,
        });
      }
    }

    pairs.sort((a, b) => b.confidence_score - a.confidence_score);
    res.json(pairs.slice(0, 50));
  });

  app.post('/api/admin/master-products/merge', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      const out = mergeMasterProductsTx({
        source_master_id: String(req.body?.source_master_id || '').trim(),
        target_master_id: String(req.body?.target_master_id || '').trim(),
        actor_name: req.auth!.fullName,
        reason: String(req.body?.reason || ''),
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/admin/master-products/unlink-listing', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const listingId = String(req.body?.listing_id || '').trim();
    const listing = db.prepare('SELECT id, master_product_id, name_ar FROM products WHERE id = ?').get(listingId) as
      | { id: string; master_product_id: string | null; name_ar: string }
      | undefined;
    if (!listing) return res.status(404).json({ error: 'سجل المتجر غير موجود' });

    db.prepare("UPDATE products SET master_product_id = NULL, updated_at = datetime('now') WHERE id = ?").run(listing.id);
    db.prepare(`
      INSERT INTO catalog_merge_audit (id, action, source_master_id, listing_id, actor_name, reason, details_json)
      VALUES (?, 'unlink_listing', ?, ?, ?, ?, ?)
    `).run(
      uid('cma'),
      listing.master_product_id,
      listing.id,
      req.auth!.fullName,
      String(req.body?.reason || 'فصل ارتباط خاطئ لمنتج متجر'),
      JSON.stringify({ listing_name: listing.name_ar })
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/master-products/relink-listing', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const listingId = String(req.body?.listing_id || '').trim();
    const targetMasterId = String(req.body?.target_master_id || '').trim();
    const listing = db.prepare('SELECT * FROM products WHERE id = ?').get(listingId) as Record<string, any> | undefined;
    const master = db.prepare('SELECT * FROM master_products WHERE id = ?').get(targetMasterId) as Record<string, any> | undefined;
    if (!listing || !master) return res.status(404).json({ error: 'سجل المتجر أو المنتج المركزي غير موجود' });

    const collision = db
      .prepare('SELECT id FROM products WHERE merchant_id = ? AND master_product_id = ? AND is_available = 1 AND id != ?')
      .get(listing.merchant_id, targetMasterId, listing.id);
    if (collision) {
      return res.status(409).json({ error: 'هذا المتجر لديه بالفعل عرض نشط مرتبط بهذا المنتج المركزي' });
    }

    db.prepare(`
      UPDATE products SET
        master_product_id = ?, brand = ?, size_label = ?, size_value = ?, size_unit = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(master.id, master.brand || '', master.size_label || '', master.size_value ?? null, master.size_unit || '', listing.id);

    db.prepare(`
      INSERT INTO catalog_merge_audit (id, action, source_master_id, target_master_id, listing_id, actor_name, reason, details_json)
      VALUES (?, 'relink_listing', ?, ?, ?, ?, ?, ?)
    `).run(
      uid('cma'),
      listing.master_product_id || null,
      master.id,
      listing.id,
      req.auth!.fullName,
      String(req.body?.reason || 'إعادة ربط منتج المتجر بمنتج مركزي صحيح'),
      JSON.stringify({ listing_name: listing.name_ar, target_master: master.canonical_name_ar })
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/matching-requests', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    const status = String(req.query.status || 'pending').trim();
    const rows = db
      .prepare(`
        SELECT
          r.*,
          m.business_name_ar AS merchant_name,
          c.name_ar AS category_name,
          mp.canonical_name_ar AS suggested_master_name,
          mp.size_label AS suggested_master_size
        FROM product_matching_requests r
        LEFT JOIN merchants m ON m.id = r.merchant_id
        LEFT JOIN categories c ON c.id = r.category_id
        LEFT JOIN master_products mp ON mp.id = r.suggested_master_id
        ${status !== 'all' ? 'WHERE r.status = ?' : ''}
        ORDER BY r.created_at DESC
        LIMIT 150
      `)
      .all(...(status !== 'all' ? [status] : []));
    res.json(rows);
  });

  app.post('/api/admin/matching-requests/:id/review', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      const out = reviewMerchantProductRequestRecord({
        request_id: req.params.id,
        decision: req.body?.decision,
        target_master_id: req.body?.target_master_id || null,
        auto_create_listing: req.body?.auto_create_listing !== false,
        admin_note: req.body?.admin_note || '',
        reviewed_by: req.auth!.fullName,
        overrides: req.body?.overrides,
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/admin/master-catalog/audit', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM catalog_merge_audit ORDER BY created_at DESC LIMIT 100')
      .all();
    res.json(rows);
  });

  // -------------------------------------------------------------------------
  // E. Admin Storefront Banners Management
  // -------------------------------------------------------------------------

  const enrichBannerRow = (b: Record<string, any>) => {
    const tf = String(b.target_filter || '');
    const targetService = tf.startsWith('service:') ? tf.slice('service:'.length).trim() : null;
    return {
      ...b,
      target_service: targetService || null,
    };
  };

  app.get('/api/admin/storefront-banners', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
    const rows = (db.prepare('SELECT * FROM storefront_banners ORDER BY sort_order ASC, created_at DESC').all() as Array<Record<string, any>>)
      .map(enrichBannerRow);
    res.json(rows);
  });

  app.post('/api/admin/storefront-banners', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const titleAr = String(req.body?.title_ar || '').trim();
    if (!titleAr) return res.status(400).json({ error: 'عنوان البانر مطلوب' });
    const rawTargetService = String(req.body?.target_service || '').trim();
    const rawTargetFilter = String(req.body?.target_filter || '').trim();
    const resolvedTargetFilter = rawTargetService
      ? `service:${rawTargetService}`
      : (rawTargetFilter || 'offers');
    const resolvedCategoryId = rawTargetService ? null : (req.body?.target_category_id || null);
    const resolvedMerchantId = rawTargetService ? null : (req.body?.target_merchant_id || null);

    const id = uid('bnr');
    db.prepare(`
      INSERT INTO storefront_banners (
        id, title_ar, subtitle_ar, badge_ar, banner_type, image_url, cta_label,
        target_filter, target_category_id, target_merchant_id, accent_color, sort_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      titleAr,
      String(req.body?.subtitle_ar || ''),
      String(req.body?.badge_ar || ''),
      String(req.body?.banner_type || 'hero'),
      String(req.body?.image_url || ''),
      String(req.body?.cta_label || (rawTargetService ? 'اطلب الخدمة الآن' : 'تسوّق الآن')),
      resolvedTargetFilter,
      resolvedCategoryId,
      resolvedMerchantId,
      String(req.body?.accent_color || '#A92224'),
      Number(req.body?.sort_order || 10)
    );
    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/admin/storefront-banners/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const existing = db.prepare('SELECT * FROM storefront_banners WHERE id = ?').get(req.params.id) as Record<string, any> | undefined;
    if (!existing) return res.status(404).json({ error: 'البانر غير موجود' });
    const b = req.body || {};
    const nextTargetFilter =
      b.target_service !== undefined
        ? (String(b.target_service || '').trim() ? `service:${String(b.target_service).trim()}` : String(b.target_filter || 'offers'))
        : (b.target_filter ?? existing.target_filter);
    const nextCategoryId = b.target_category_id !== undefined ? (b.target_category_id || null) : existing.target_category_id;
    const nextMerchantId = b.target_merchant_id !== undefined ? (b.target_merchant_id || null) : existing.target_merchant_id;

    db.prepare(`
      UPDATE storefront_banners SET
        title_ar = ?, subtitle_ar = ?, badge_ar = ?, banner_type = ?, image_url = ?,
        cta_label = ?, target_filter = ?, target_category_id = ?, target_merchant_id = ?,
        accent_color = ?, sort_order = ?, is_active = ?
      WHERE id = ?
    `).run(
      b.title_ar ?? existing.title_ar,
      b.subtitle_ar ?? existing.subtitle_ar,
      b.badge_ar ?? existing.badge_ar,
      b.banner_type ?? existing.banner_type,
      b.image_url ?? existing.image_url,
      b.cta_label ?? existing.cta_label,
      nextTargetFilter,
      nextCategoryId,
      nextMerchantId,
      b.accent_color ?? existing.accent_color,
      b.sort_order !== undefined ? Number(b.sort_order) : existing.sort_order,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      existing.id
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/storefront-banners/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    db.prepare('DELETE FROM storefront_banners WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Delete all products in Central Master Catalog (and remove all published store products)
  app.delete('/api/admin/master-products/all', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM product_deals').run();
        db.prepare('DELETE FROM product_attributes').run();
        db.prepare('DELETE FROM product_images').run();
        db.prepare('DELETE FROM product_matching_requests').run();
        db.prepare('DELETE FROM products').run();
        db.prepare('DELETE FROM master_products').run();
        recordAuditLog({
          actor_name: req.auth!.fullName,
          actor_role: req.auth!.role,
          action: 'MASTER_CATALOG_CLEARED',
          entity_type: 'master_products',
          entity_id: 'all',
          details: 'حذف جميع المنتجات في الكتالوج المركزي والمتجر بالكامل',
        });
      })();
      res.json({ ok: true, message: 'تم حذف جميع المنتجات في الكتالوج المركزي والمتجر بنجاح' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete single Master Product (and remove its linked store listings)
  app.delete('/api/admin/master-products/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const { id } = req.params;
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM product_deals WHERE master_product_id = ? OR product_id IN (SELECT id FROM products WHERE master_product_id = ?)').run(id, id);
        db.prepare('DELETE FROM products WHERE master_product_id = ?').run(id);
        db.prepare('DELETE FROM product_images WHERE master_product_id = ?').run(id);
        db.prepare('DELETE FROM product_attributes WHERE master_product_id = ?').run(id);
        const info = db.prepare('DELETE FROM master_products WHERE id = ?').run(id);
        if (info.changes === 0) {
          throw new Error('المنتج المركزي غير موجود');
        }
        recordAuditLog({
          actor_name: req.auth!.fullName,
          actor_role: req.auth!.role,
          action: 'MASTER_PRODUCT_DELETED',
          entity_type: 'master_products',
          entity_id: id,
          details: `حذف المنتج المركزي ${id} وإزالة عروضه المرتبطة من المتجر`,
        });
      })();
      res.json({ ok: true, message: 'تم حذف المنتج المركزي ومنتجاته في المتجر بنجاح' });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Reconcile and unify all merchant products to master catalog
  app.post('/api/admin/master-products/reconcile-all', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      const summary = reconcileAllExistingProductsToMasterCatalog();
      recordAuditLog({
        actor_name: req.auth!.fullName,
        actor_role: req.auth!.role,
        action: 'MASTER_PRODUCTS_RECONCILED',
        entity_type: 'master_products',
        entity_id: 'bulk',
        details: `معالجة وتوحيد ربط المنتجات بالكتالوج المركزي (إجمالي: ${summary.total}، تم ربطه: ${summary.reconciled}، كتالوج جديد: ${summary.new_masters})`,
      });
      res.json({ ok: true, summary });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Export all approved Master Products (for full Excel download)
  app.get('/api/admin/master-products/export-all', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    const rows = db
      .prepare(`
        SELECT
          mp.id,
          mp.canonical_name_ar,
          mp.canonical_name_en,
          mp.trade_name,
          mp.brand,
          mp.category_id,
          c.name_ar AS category_name,
          COALESCE(NULLIF(TRIM(c.full_path_ar), ''), CASE WHEN c.name_ar IS NOT NULL THEN c.name_ar || ';' ELSE '' END) AS category_path,
          mp.barcode,
          mp.size_value,
          mp.size_unit,
          mp.size_label,
          mp.image_url,
          mp.description,
          mp.usage_notes,
          mp.ingredients,
          mp.approval_status,
          mp.created_at,
          (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS active_stores_count,
          (SELECT MIN(COALESCE(p.sale_price, p.base_price)) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS lowest_price
        FROM master_products mp
        LEFT JOIN categories c ON c.id = mp.category_id
        WHERE mp.approval_status = 'approved'
        ORDER BY mp.created_at DESC
      `)
      .all();
    res.json({ items: rows, total: rows.length });
  });

  // Compare Excel rows against Master Products Catalog (returns existing, not_found, possible)
  app.post('/api/admin/master-products/excel-compare', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ error: 'لا توجد صفوف منتجات للمقارنة' });
      }
      if (rows.length > 20000) {
        return res.status(400).json({ error: 'الحد الأقصى للدفعة الواحدة هو 20,000 صف. يرجى تقسيم الملف.' });
      }
      const result = compareExcelRowsAgainstMasterCatalog(rows);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Bulk import Master Products from Excel rows (atomic transaction + smart deduplication)
  app.post('/api/admin/master-products/excel-import', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
    if (!ensureAdminCatalogAccess(req, res)) return;
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ error: 'لا توجد منتجات لرفعها' });
      }
      if (rows.length > 10000) {
        return res.status(400).json({ error: 'الحد الأقصى للدفعة الواحدة هو 10,000 منتج' });
      }
      const result = bulkImportMasterProductsFromExcel({
        rows,
        default_category_id: req.body?.default_category_id || null,
        merchant_id: req.body?.merchant_id || null,
        publish_to_store: req.body?.publish_to_store !== false,
        skip_existing: req.body?.skip_existing !== false,
        update_missing_fields: Boolean(req.body?.update_missing_fields),
        actor_name: req.auth?.fullName || req.auth?.email || 'admin',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}

// ============================================================================
// 5. High-Speed Indexed Excel Comparison & Bulk Import Engine
// ============================================================================

export interface ExcelMasterInputRow {
  row_index?: number;
  name_ar: string;
  name_en?: string;
  brand?: string;
  size_label?: string;
  barcode?: string;
  category?: string;
  image_url?: string;
  description?: string;
  usage_notes?: string;
  ingredients?: string;
  price?: number | string | null;
  sale_price?: number | string | null;
  stock_quantity?: number | string | null;
  extra?: Record<string, unknown>;
}

export interface ExcelCompareRowResult {
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

interface IndexedMasterEntry {
  row: Record<string, any>;
  barcodeLower: string;
  size: ParsedSize | null;
  tokens: string[];
  brandTokens: string[];
  normalizedKey: string;
}

interface MasterCatalogMemoryIndex {
  entries: IndexedMasterEntry[];
  byBarcode: Map<string, IndexedMasterEntry>;
  byNormalizedKey: Map<string, IndexedMasterEntry[]>;
  byToken: Map<string, IndexedMasterEntry[]>;
}

function addEntryToIndex(index: MasterCatalogMemoryIndex, row: Record<string, any>): IndexedMasterEntry {
  const barcodeLower = String(row.barcode || '').trim().toLowerCase();
  const size = extractSize({
    size_value: row.size_value,
    size_unit: row.size_unit,
    size_label: row.size_label,
    name_ar: row.canonical_name_ar,
    name_en: row.canonical_name_en,
  });
  const tokens = tokenizeCanonical(
    `${row.brand || ''} ${row.canonical_name_ar || ''} ${row.canonical_name_en || ''} ${row.trade_name || ''}`
  );
  const brandTokens = tokenizeCanonical(row.brand || '');
  const normalizedKey =
    row.normalized_key ||
    buildNormalizedKey({
      name_ar: row.canonical_name_ar,
      name_en: row.canonical_name_en,
      brand: row.brand,
      size_value: size?.canonicalValue ?? null,
      size_unit: size?.canonicalUnit ?? null,
      size_label: row.size_label || size?.displayLabel || '',
    });

  const entry: IndexedMasterEntry = {
    row,
    barcodeLower,
    size,
    tokens,
    brandTokens,
    normalizedKey,
  };
  index.entries.push(entry);
  if (barcodeLower) {
    index.byBarcode.set(barcodeLower, entry);
  }
  if (normalizedKey && normalizedKey !== '__nosize') {
    const arr = index.byNormalizedKey.get(normalizedKey);
    if (arr) arr.push(entry);
    else index.byNormalizedKey.set(normalizedKey, [entry]);
  }
  for (const tok of tokens) {
    if (!tok) continue;
    const arr = index.byToken.get(tok);
    if (arr) arr.push(entry);
    else index.byToken.set(tok, [entry]);
  }
  return entry;
}

function buildMasterCatalogMemoryIndex(): MasterCatalogMemoryIndex {
  const index: MasterCatalogMemoryIndex = {
    entries: [],
    byBarcode: new Map(),
    byNormalizedKey: new Map(),
    byToken: new Map(),
  };

  const rows = db
    .prepare(`
      SELECT
        mp.*,
        c.name_ar AS category_name,
        (SELECT COUNT(*) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS stores_count,
        (SELECT MIN(COALESCE(p.sale_price, p.base_price)) FROM products p WHERE p.master_product_id = mp.id AND p.is_available = 1) AS lowest_price
      FROM master_products mp
      LEFT JOIN categories c ON c.id = mp.category_id
      WHERE mp.approval_status = 'approved'
    `)
    .all() as Array<Record<string, any>>;

  for (const row of rows) {
    addEntryToIndex(index, row);
  }
  return index;
}

function matchAgainstMemoryIndex(
  index: MasterCatalogMemoryIndex,
  input: {
    name_ar?: string;
    name_en?: string;
    brand?: string;
    barcode?: string;
    size_label?: string;
  }
): {
  status: 'existing' | 'possible' | 'not_found';
  best: IndexedMasterEntry | null;
  confidence_score: number;
  match_reasons: string[];
  parsed_size: ParsedSize | null;
  normalized_key: string;
  size_conflict_warning: string | null;
} {
  const cleanBarcode = String(input.barcode || '').trim().toLowerCase();
  const inputSize = extractSize({
    size_label: input.size_label,
    name_ar: input.name_ar,
    name_en: input.name_en,
  });
  const inputTokens = tokenizeCanonical(`${input.brand || ''} ${input.name_ar || ''} ${input.name_en || ''}`);
  const inputBrandTokens = tokenizeCanonical(input.brand || '');
  const normalizedKey = buildNormalizedKey({
    name_ar: input.name_ar,
    name_en: input.name_en,
    brand: input.brand,
    size_value: inputSize?.canonicalValue ?? null,
    size_unit: inputSize?.canonicalUnit ?? null,
    size_label: input.size_label || inputSize?.displayLabel || '',
  });

  let sizeConflictWarning: string | null = null;

  // Priority 1: O(1) Barcode match
  if (cleanBarcode) {
    const bcEntry = index.byBarcode.get(cleanBarcode);
    if (bcEntry) {
      const sizeCheck = areSizesCompatible(inputSize, bcEntry.size);
      if (sizeCheck === 'conflict') {
        sizeConflictWarning = `الباركود مطابق لمنتج "${bcEntry.row.canonical_name_ar}" (${bcEntry.size?.displayLabel || bcEntry.row.size_label}) لكن الحجم مختلف (${inputSize?.displayLabel || input.size_label}).`;
      } else {
        return {
          status: 'existing',
          best: bcEntry,
          confidence_score: 100,
          match_reasons: ['تطابق باركود كامل (Barcode Exact Match)'],
          parsed_size: inputSize,
          normalized_key: normalizedKey,
          size_conflict_warning: null,
        };
      }
    }
  }

  // Priority 2: O(1) Exact normalized key match
  if (normalizedKey && normalizedKey !== '__nosize') {
    const keyEntries = index.byNormalizedKey.get(normalizedKey);
    if (keyEntries && keyEntries.length > 0) {
      for (const entry of keyEntries) {
        const sizeCheck = areSizesCompatible(inputSize, entry.size);
        if (sizeCheck === 'conflict') continue;
        return {
          status: 'existing',
          best: entry,
          confidence_score: 98,
          match_reasons: ['تطابق تام للاسم والعلامة والحجم'],
          parsed_size: inputSize,
          normalized_key: normalizedKey,
          size_conflict_warning: sizeConflictWarning,
        };
      }
    }
  }

  // Priority 3: Inverted token index candidate set (skips unrelated rows in O(1))
  const candidateSet = new Set<IndexedMasterEntry>();
  for (const tok of inputTokens) {
    const bucket = index.byToken.get(tok);
    if (!bucket) continue;
    // Cap huge generic buckets if catalog grows massive while still checking top entries
    const limit = Math.min(bucket.length, 400);
    for (let i = 0; i < limit; i++) {
      candidateSet.add(bucket[i]);
    }
  }

  let bestExact: { entry: IndexedMasterEntry; score: number; reasons: string[] } | null = null;
  let bestPossible: { entry: IndexedMasterEntry; score: number; reasons: string[] } | null = null;

  for (const entry of candidateSet) {
    const sizeCheck = areSizesCompatible(inputSize, entry.size);
    if (sizeCheck === 'conflict') continue;

    // Brand conflict guard
    let brandMatches = false;
    if (inputBrandTokens.length > 0 && entry.brandTokens.length > 0) {
      const bOverlap = overlapCoefficient(inputBrandTokens, entry.brandTokens);
      if (bOverlap >= 0.5) brandMatches = true;
      else continue;
    }

    const jaccard = jaccardSimilarity(inputTokens, entry.tokens);
    const overlap = overlapCoefficient(inputTokens, entry.tokens);
    let score = Math.round((jaccard * 0.65 + overlap * 0.35) * 100);
    const reasons: string[] = [];

    if (entry.normalizedKey && entry.normalizedKey === normalizedKey && normalizedKey !== '__nosize') {
      score = Math.max(score, 96);
      reasons.push('تطابق تام للاسم والعلامة والحجم');
    } else if (jaccard >= 0.75 || (overlap >= 0.85 && inputTokens.length >= 2)) {
      reasons.push('تطابق عالٍ في الاسم التجاري');
    } else if (score >= 45) {
      reasons.push('تشابه قوي في الكلمات المفتاحية');
    }

    if (brandMatches) {
      score = Math.min(99, score + 8);
      reasons.push('نفس العلامة التجارية');
    }
    if (sizeCheck === 'identical') {
      score = Math.min(99, score + 10);
      reasons.push(`نفس الحجم/الوزن (${entry.size?.displayLabel || entry.row.size_label})`);
    } else if (inputSize && !entry.size) {
      score = Math.max(0, score - 12);
    } else if (!inputSize && entry.size) {
      score = Math.max(0, score - 10);
    }

    const isExact =
      (sizeCheck === 'identical' && (score >= 86 || (jaccard >= 0.7 && overlap >= 0.85))) ||
      (sizeCheck === 'unspecified' &&
        !inputSize &&
        !entry.size &&
        jaccard >= 0.92 &&
        overlap >= 0.95 &&
        inputTokens.length >= 2);

    if (isExact) {
      const finalScore = Math.min(99, Math.max(score, 90));
      if (!bestExact || finalScore > bestExact.score) {
        bestExact = {
          entry,
          score: finalScore,
          reasons: reasons.length ? reasons : ['تطابق كامل في الاسم والحجم'],
        };
      }
    } else if (score >= 52) {
      if (!bestPossible || score > bestPossible.score) {
        bestPossible = {
          entry,
          score,
          reasons: reasons.length ? reasons : ['تشابه محتمل — يُنصح بالمراجعة'],
        };
      }
    }
  }

  if (bestExact) {
    return {
      status: 'existing',
      best: bestExact.entry,
      confidence_score: bestExact.score,
      match_reasons: bestExact.reasons,
      parsed_size: inputSize,
      normalized_key: normalizedKey,
      size_conflict_warning: sizeConflictWarning,
    };
  }
  if (bestPossible) {
    return {
      status: 'possible',
      best: bestPossible.entry,
      confidence_score: bestPossible.score,
      match_reasons: bestPossible.reasons,
      parsed_size: inputSize,
      normalized_key: normalizedKey,
      size_conflict_warning: sizeConflictWarning,
    };
  }
  return {
    status: 'not_found',
    best: null,
    confidence_score: 0,
    match_reasons: [],
    parsed_size: inputSize,
    normalized_key: normalizedKey,
    size_conflict_warning: sizeConflictWarning,
  };
}

export function compareExcelRowsAgainstMasterCatalog(rows: ExcelMasterInputRow[]): {
  summary: {
    total_rows: number;
    existing_count: number;
    not_found_count: number;
    possible_count: number;
    duplicate_in_file_count: number;
  };
  existing: ExcelCompareRowResult[];
  not_found: ExcelCompareRowResult[];
  possible: ExcelCompareRowResult[];
  all_rows: ExcelCompareRowResult[];
} {
  const index = buildMasterCatalogMemoryIndex();
  const seenFileBarcodes = new Set<string>();
  const seenFileKeys = new Set<string>();

  const existing: ExcelCompareRowResult[] = [];
  const not_found: ExcelCompareRowResult[] = [];
  const possible: ExcelCompareRowResult[] = [];
  const all_rows: ExcelCompareRowResult[] = [];
  let duplicateInFileCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || ({} as ExcelMasterInputRow);
    const nameAr = String(raw.name_ar || '').trim();
    const nameEn = String(raw.name_en || '').trim();
    if (!nameAr && !nameEn) continue;

    const brand = String(raw.brand || '').trim();
    const sizeLabel = String(raw.size_label || '').trim();
    const barcode = String(raw.barcode || '').trim();
    const category = String(raw.category || '').trim();
    const imageUrl = String(raw.image_url || '').trim();
    const description = String(raw.description || '').trim();
    const priceStr = raw.price !== null && raw.price !== undefined ? String(raw.price).trim() : '';

    const match = matchAgainstMemoryIndex(index, {
      name_ar: nameAr || nameEn,
      name_en: nameEn,
      brand,
      barcode,
      size_label: sizeLabel,
    });

    const bcLower = barcode.toLowerCase();
    const fileSig = match.normalized_key && match.normalized_key !== '__nosize'
      ? match.normalized_key
      : normalizeText(`${brand} ${nameAr || nameEn} ${sizeLabel}`);
    const isDupInFile =
      (bcLower !== '' && seenFileBarcodes.has(bcLower)) ||
      (fileSig !== '' && seenFileKeys.has(fileSig));
    if (isDupInFile) duplicateInFileCount++;
    if (bcLower) seenFileBarcodes.add(bcLower);
    if (fileSig) seenFileKeys.add(fileSig);

    const item: ExcelCompareRowResult = {
      row_index: raw.row_index ?? i + 2,
      name_ar: nameAr || nameEn,
      name_en: nameEn,
      brand,
      size_label: sizeLabel || match.parsed_size?.displayLabel || '',
      parsed_size_label: match.parsed_size?.displayLabel || '',
      barcode,
      category,
      image_url: imageUrl,
      description,
      price: priceStr,
      status: match.status,
      duplicate_in_file: isDupInFile,
      confidence_score: match.confidence_score,
      match_reasons: match.match_reasons,
      size_conflict_warning: match.size_conflict_warning,
      matched_master: match.best
        ? {
            id: match.best.row.id,
            canonical_name_ar: match.best.row.canonical_name_ar,
            canonical_name_en: match.best.row.canonical_name_en || '',
            brand: match.best.row.brand || '',
            size_label: match.best.row.size_label || match.best.size?.displayLabel || '',
            barcode: match.best.row.barcode || null,
            category_name: match.best.row.category_name || '',
            stores_count: Number(match.best.row.stores_count || 0),
            lowest_price:
              match.best.row.lowest_price !== null && match.best.row.lowest_price !== undefined
                ? Number(match.best.row.lowest_price)
                : null,
          }
        : null,
    };

    all_rows.push(item);
    if (item.status === 'existing') existing.push(item);
    else if (item.status === 'possible') possible.push(item);
    else not_found.push(item);
  }

  return {
    summary: {
      total_rows: all_rows.length,
      existing_count: existing.length,
      not_found_count: not_found.length,
      possible_count: possible.length,
      duplicate_in_file_count: duplicateInFileCount,
    },
    existing,
    not_found,
    possible,
    all_rows,
  };
}

export function bulkImportMasterProductsFromExcel(input: {
  rows: ExcelMasterInputRow[];
  default_category_id?: string | null;
  merchant_id?: string | null;
  publish_to_store?: boolean;
  skip_existing?: boolean;
  update_missing_fields?: boolean;
  actor_name?: string;
}): {
  ok: true;
  created_count: number;
  skipped_existing_count: number;
  updated_existing_count: number;
  store_products_created: number;
  store_products_updated: number;
  categories_created_count: number;
  merchant_id: string | null;
  error_count: number;
  errors: Array<{ row_index: number; name_ar: string; error: string }>;
  created_ids: string[];
} {
  const index = buildMasterCatalogMemoryIndex();
  const skipExisting = input.skip_existing !== false;
  const updateMissing = Boolean(input.update_missing_fields);
  const publishToStore = input.publish_to_store !== false;
  const actorName = String(input.actor_name || 'admin');
  const targetMerchantId = publishToStore ? ensureDefaultStorefrontMerchant(input.merchant_id) : null;

  // Hierarchical category path resolver (supports "سوبر ماركت > مخبوزات > كرواسون وكيك;")
  const catResolver = createCategoryPathResolver({ scope: 'merchant', merchantId: null });
  const fallbackCatId =
    (input.default_category_id && catResolver.byId.has(String(input.default_category_id))
      ? String(input.default_category_id)
      : null) ||
    Array.from(catResolver.byId.keys())[0] ||
    null;

  let createdCount = 0;
  let skippedExistingCount = 0;
  let updatedExistingCount = 0;
  let storeProductsCreated = 0;
  let storeProductsUpdated = 0;
  let categoriesCreatedCount = 0;
  const errors: Array<{ row_index: number; name_ar: string; error: string }> = [];
  const createdIds: string[] = [];

  const insertMasterStmt = db.prepare(`
    INSERT INTO master_products (
      id, canonical_name_ar, canonical_name_en, trade_name, brand, category_id, barcode,
      size_value, size_unit, size_label, image_url, description, usage_notes, ingredients,
      approval_status, normalized_key, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
  `);
  const insertImgStmt = db.prepare(`
    INSERT INTO product_images (id, master_product_id, image_url, is_primary, sort_order)
    VALUES (?, ?, ?, 1, 0)
  `);
  const updateMissingStmt = db.prepare(`
    UPDATE master_products
    SET
      canonical_name_en = CASE WHEN (canonical_name_en IS NULL OR canonical_name_en = '') AND ? != '' THEN ? ELSE canonical_name_en END,
      brand = CASE WHEN (brand IS NULL OR brand = '') AND ? != '' THEN ? ELSE brand END,
      barcode = CASE WHEN (barcode IS NULL OR barcode = '') AND ? != '' THEN ? ELSE barcode END,
      image_url = CASE WHEN (image_url IS NULL OR image_url = '') AND ? != '' THEN ? ELSE image_url END,
      description = CASE WHEN (description IS NULL OR description = '') AND ? != '' THEN ? ELSE description END,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const findStoreListingStmt = db.prepare(
    'SELECT id, base_price, sale_price, stock_quantity FROM products WHERE merchant_id = ? AND master_product_id = ? LIMIT 1'
  );
  const checkCodeStmt = db.prepare('SELECT 1 FROM products WHERE LOWER(product_code) = LOWER(?)');
  const insertStoreProductStmt = db.prepare(`
    INSERT INTO products (
      id, product_code, merchant_id, category_id, master_product_id,
      name_ar, name_en, description, image_url,
      brand, size_label, size_value, size_unit, barcode, merchant_sku,
      base_price, sale_price, is_offer, stock_quantity, low_stock_threshold,
      min_order_qty, requires_prescription, addons_text, is_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 5, 1, 0, '', 1)
  `);
  const updateStoreProductStmt = db.prepare(`
    UPDATE products
    SET
      category_id = ?,
      name_ar = ?,
      name_en = ?,
      description = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE description END,
      image_url = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE image_url END,
      brand = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE brand END,
      size_label = CASE WHEN TRIM(COALESCE(?, '')) != '' THEN ? ELSE size_label END,
      barcode = COALESCE(NULLIF(TRIM(COALESCE(?, '')), ''), barcode),
      base_price = ?,
      sale_price = ?,
      is_offer = ?,
      stock_quantity = ?,
      is_available = 1,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  let prodCodeSeq = 1001 + ((db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number })?.c || 0);
  const nextProductCode = () => {
    while (checkCodeStmt.get(`PRD-${prodCodeSeq}`)) {
      prodCodeSeq += 1;
    }
    const code = `PRD-${prodCodeSeq}`;
    prodCodeSeq += 1;
    return code;
  };

  const upsertStoreListing = (params: {
    masterId: string;
    nameAr: string;
    nameEn: string;
    description: string;
    imageUrl: string;
    brand: string;
    sizeLabel: string;
    sizeValue: number | null;
    sizeUnit: string;
    barcode: string | null;
    categoryId: string | null;
    rawPrice: unknown;
    rawSalePrice: unknown;
    rawStock: unknown;
  }) => {
    if (!targetMerchantId) return;
    const validCatId = ensureValidStoreCategoryId(params.categoryId);
    const parsedPrice = parseFlexibleMoney(params.rawPrice);
    const parsedSaleRaw = parseFlexibleMoney(params.rawSalePrice);
    const parsedStockRaw = parseFlexibleMoney(params.rawStock);

    const existingListing = findStoreListingStmt.get(targetMerchantId, params.masterId) as
      | { id: string; base_price: number; sale_price: number | null; stock_quantity: number }
      | undefined;

    if (existingListing) {
      const nextBase = parsedPrice !== null ? parsedPrice : Number(existingListing.base_price || 0);
      const nextSale =
        parsedSaleRaw !== null && parsedSaleRaw > 0 && parsedSaleRaw < nextBase
          ? parsedSaleRaw
          : existingListing.sale_price ?? null;
      const nextStock =
        parsedStockRaw !== null ? Math.max(0, Math.floor(parsedStockRaw)) : Number(existingListing.stock_quantity ?? 50);
      const isOffer = nextSale !== null && nextSale < nextBase ? 1 : 0;

      updateStoreProductStmt.run(
        validCatId,
        params.nameAr,
        params.nameEn || params.nameAr,
        params.description,
        params.description,
        params.imageUrl,
        params.imageUrl,
        params.brand,
        params.brand,
        params.sizeLabel,
        params.sizeLabel,
        params.barcode || '',
        nextBase,
        nextSale,
        isOffer,
        nextStock,
        existingListing.id
      );
      storeProductsUpdated++;
      return;
    }

    const basePrice = parsedPrice ?? 0;
    const salePrice =
      parsedSaleRaw !== null && parsedSaleRaw > 0 && parsedSaleRaw < basePrice ? parsedSaleRaw : null;
    const stockQty = parsedStockRaw !== null ? Math.max(0, Math.floor(parsedStockRaw)) : 50;
    const isOffer = salePrice !== null && salePrice < basePrice ? 1 : 0;

    insertStoreProductStmt.run(
      uid('prd'),
      nextProductCode(),
      targetMerchantId,
      validCatId,
      params.masterId,
      params.nameAr,
      params.nameEn || params.nameAr,
      params.description,
      params.imageUrl,
      params.brand,
      params.sizeLabel,
      params.sizeValue,
      params.sizeUnit,
      params.barcode,
      basePrice,
      salePrice,
      isOffer,
      stockQty
    );
    storeProductsCreated++;
  };

  const tx = db.transaction(() => {
    for (let i = 0; i < input.rows.length; i++) {
      const raw = input.rows[i];
      const rowIndex = raw?.row_index ?? i + 2;
      const nameAr = String(raw?.name_ar || '').trim();
      const nameEn = String(raw?.name_en || '').trim();
      const finalNameAr = nameAr || nameEn;

      if (!finalNameAr) {
        errors.push({ row_index: rowIndex, name_ar: '', error: 'اسم المنتج فارغ' });
        continue;
      }

      const brand = String(raw?.brand || '').trim();
      const sizeLabelRaw = String(raw?.size_label || '').trim();
      const barcode = String(raw?.barcode || '').trim() || null;
      const imageUrl = String(raw?.image_url || '').trim();
      const description = String(raw?.description || '').trim();
      const usageNotes = String(raw?.usage_notes || '').trim();
      const ingredients = String(raw?.ingredients || '').trim();

      const match = matchAgainstMemoryIndex(index, {
        name_ar: finalNameAr,
        name_en: nameEn,
        brand,
        barcode: barcode || '',
        size_label: sizeLabelRaw,
      });

      if (match.size_conflict_warning) {
        errors.push({ row_index: rowIndex, name_ar: finalNameAr, error: match.size_conflict_warning });
        continue;
      }

      if (match.status === 'existing' && match.best) {
        const targetId = match.best.row.id;
        let resolvedCatIdForExisting: string | null = match.best.row.category_id || fallbackCatId;
        if (String(raw?.category || '').trim()) {
          const resolvedCat = resolveOrCreateCategoryPath(catResolver, String(raw?.category || ''), resolvedCatIdForExisting);
          if (resolvedCat.category_id) resolvedCatIdForExisting = resolvedCat.category_id;
          categoriesCreatedCount += resolvedCat.created_count;
        }

        if (updateMissing) {
          const safeBarcode = barcode && !index.byBarcode.has(barcode.toLowerCase()) ? barcode : '';
          const info = updateMissingStmt.run(
            nameEn, nameEn,
            brand, brand,
            safeBarcode, safeBarcode,
            imageUrl, imageUrl,
            description, description,
            targetId
          );
          if (info.changes > 0) {
            if (safeBarcode) {
              match.best.row.barcode = safeBarcode;
              match.best.barcodeLower = safeBarcode.toLowerCase();
              index.byBarcode.set(safeBarcode.toLowerCase(), match.best);
            }
            updatedExistingCount++;
          } else {
            skippedExistingCount++;
          }
        } else if (skipExisting) {
          skippedExistingCount++;
        } else {
          errors.push({
            row_index: rowIndex,
            name_ar: finalNameAr,
            error: `موجود بالفعل: ${match.best.row.canonical_name_ar}`,
          });
          continue;
        }

        // Ensure matched Master Product is also published/updated in the live Store
        if (publishToStore) {
          upsertStoreListing({
            masterId: targetId,
            nameAr: match.best.row.canonical_name_ar || finalNameAr,
            nameEn: match.best.row.canonical_name_en || nameEn,
            description: description || match.best.row.description || '',
            imageUrl: imageUrl || match.best.row.image_url || '',
            brand: match.best.row.brand || brand,
            sizeLabel: match.best.row.size_label || sizeLabelRaw,
            sizeValue: match.best.row.size_value ?? null,
            sizeUnit: match.best.row.size_unit || '',
            barcode: match.best.row.barcode || barcode,
            categoryId: resolvedCatIdForExisting,
            rawPrice: raw?.price,
            rawSalePrice: raw?.sale_price,
            rawStock: raw?.stock_quantity,
          });
        }
        continue;
      }

      const id = uid('mst');
      const parsedSize = match.parsed_size;
      const finalSizeLabel = sizeLabelRaw || parsedSize?.displayLabel || '';
      const resolvedCat = resolveOrCreateCategoryPath(catResolver, String(raw?.category || ''), fallbackCatId);
      const catId = ensureValidStoreCategoryId(resolvedCat.category_id);
      categoriesCreatedCount += resolvedCat.created_count;

      try {
        insertMasterStmt.run(
          id,
          finalNameAr,
          nameEn,
          finalNameAr,
          brand,
          catId,
          barcode,
          parsedSize?.canonicalValue ?? null,
          parsedSize?.canonicalUnit ?? '',
          finalSizeLabel,
          imageUrl,
          description,
          usageNotes,
          ingredients,
          match.normalized_key,
          actorName
        );
        if (imageUrl) {
          insertImgStmt.run(uid('pimg'), id, imageUrl);
        }

        // Automatically publish newly imported Master Product directly to the live Store!
        if (publishToStore) {
          upsertStoreListing({
            masterId: id,
            nameAr: finalNameAr,
            nameEn,
            description,
            imageUrl,
            brand,
            sizeLabel: finalSizeLabel,
            sizeValue: parsedSize?.canonicalValue ?? null,
            sizeUnit: parsedSize?.canonicalUnit ?? '',
            barcode,
            categoryId: catId,
            rawPrice: raw?.price,
            rawSalePrice: raw?.sale_price,
            rawStock: raw?.stock_quantity,
          });
        }

        // Update in-memory index immediately to catch duplicates inside the same Excel file
        addEntryToIndex(index, {
          id,
          canonical_name_ar: finalNameAr,
          canonical_name_en: nameEn,
          trade_name: finalNameAr,
          brand,
          category_id: catId,
          barcode,
          size_value: parsedSize?.canonicalValue ?? null,
          size_unit: parsedSize?.canonicalUnit ?? '',
          size_label: finalSizeLabel,
          image_url: imageUrl,
          description,
          normalized_key: match.normalized_key,
          approval_status: 'approved',
          stores_count: publishToStore ? 1 : 0,
          lowest_price: parseFlexibleMoney(raw?.price),
        });

        createdCount++;
        createdIds.push(id);
      } catch (err) {
        errors.push({ row_index: rowIndex, name_ar: finalNameAr, error: (err as Error).message });
      }
    }

    if (createdCount > 0 || updatedExistingCount > 0 || storeProductsCreated > 0 || storeProductsUpdated > 0) {
      db.prepare(`
        INSERT INTO catalog_merge_audit (id, action, actor_name, reason, details_json)
        VALUES (?, 'excel_bulk_import', ?, ?, ?)
      `).run(
        uid('cma'),
        actorName,
        `استيراد جماعي بالـ Excel (${createdCount} مركزي جديد، ${storeProductsCreated} مضاف للمتجر، ${storeProductsUpdated} محدّث بالمتجر)`,
        JSON.stringify({
          created_count: createdCount,
          updated_existing_count: updatedExistingCount,
          skipped_existing_count: skippedExistingCount,
          store_products_created: storeProductsCreated,
          store_products_updated: storeProductsUpdated,
          merchant_id: targetMerchantId,
          error_count: errors.length,
        })
      );
    }
  });

  tx();
  if (categoriesCreatedCount > 0) {
    recomputeAllCategoryPaths();
  }

  return {
    ok: true,
    created_count: createdCount,
    skipped_existing_count: skippedExistingCount,
    updated_existing_count: updatedExistingCount,
    store_products_created: storeProductsCreated,
    store_products_updated: storeProductsUpdated,
    categories_created_count: categoriesCreatedCount,
    merchant_id: targetMerchantId,
    error_count: errors.length,
    errors: errors.slice(0, 100),
    created_ids: createdIds,
  };
}
