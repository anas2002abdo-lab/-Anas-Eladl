import type { Express, Request, Response } from 'express';
import { db, uid, recordAuditLog } from './db.ts';
import {
  ALL_ADMIN_ROLES,
  requireAuth,
  requireRole,
  type AuthContext,
} from './auth.ts';
import { computeCategoryHierarchyMap } from './categoryHierarchy.ts';

export interface PlatformMainCategoryRow {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  icon_key: string;
  image_url: string;
  accent_color: string;
  sort_order: number;
  is_active: number;
  is_general: number;
  created_at: string;
  updated_at: string;
}

interface MerchantLinkRow {
  id: string;
  main_category_id: string;
  merchant_id: string;
  include_all_categories: number;
  sort_order: number;
  created_at: string;
}

interface InternalCatLinkRow {
  id: string;
  main_category_id: string;
  merchant_id: string;
  internal_category_id: string;
  include_descendants: number;
  link_type: 'include' | 'exclude';
  created_at: string;
}

interface ProductLinkRow {
  id: string;
  main_category_id: string;
  product_id: string;
  created_at: string;
}

interface RawCategoryRow {
  id: string;
  scope: string;
  merchant_id: string | null;
  parent_id: string | null;
  level: number;
  full_path_ar: string | null;
  name_ar: string;
  name_en: string | null;
  image_url: string | null;
  sort_order: number;
  is_offers_section: number;
  is_active: number;
  group_key: string | null;
  group_name_ar: string | null;
}

interface RawMerchantRow {
  id: string;
  business_name_ar: string;
  business_name_en: string | null;
  merchant_type: string | null;
  branch_name: string | null;
  zone_name: string | null;
  image_url: string | null;
  working_hours: string | null;
  verification_status: string;
  is_open_now: number | null;
  rating_avg: number | null;
  rating_count: number | null;
}

interface RawProductRow {
  id: string;
  product_code: string | null;
  master_product_id: string | null;
  merchant_id: string;
  category_id: string | null;
  name_ar: string;
  name_en: string | null;
  brand: string | null;
  size_label: string | null;
  barcode: string | null;
  description: string | null;
  image_url: string | null;
  base_price: number;
  sale_price: number | null;
  is_offer: number;
  stock_quantity: number | null;
  is_available: number;
  requires_prescription: number | null;
  is_weighted: number | null;
  weight_step: number | null;
  weight_unit: string | null;
  purchase_count: number | null;
  merchant_name: string | null;
  merchant_is_open: number | null;
  category_name: string | null;
}

const INITIAL_MAIN_CATEGORIES: Array<{
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  icon_key: string;
  accent_color: string;
  sort_order: number;
  is_general: number;
}> = [
  {
    id: 'mcat_supermarket',
    slug: 'supermarket',
    name_ar: 'السوبر ماركت',
    name_en: 'Supermarket',
    description_ar: 'المقاضي اليومية والمواد الغذائية والألبان والمشروبات',
    icon_key: 'shopping_basket',
    accent_color: '#A92224',
    sort_order: 10,
    is_general: 0,
  },
  {
    id: 'mcat_meat',
    slug: 'meat',
    name_ar: 'اللحوم',
    name_en: 'Meat & Poultry',
    description_ar: 'اللحوم البلدي الطازجة والدواجن والمصنعات',
    icon_key: 'meat',
    accent_color: '#B91C1C',
    sort_order: 20,
    is_general: 0,
  },
  {
    id: 'mcat_produce',
    slug: 'produce',
    name_ar: 'الخضار والفاكهة',
    name_en: 'Fruits & Vegetables',
    description_ar: 'خضروات وفواكه طازجة يومياً من أفضل المتاجر',
    icon_key: 'produce',
    accent_color: '#047857',
    sort_order: 30,
    is_general: 0,
  },
  {
    id: 'mcat_fish',
    slug: 'fish',
    name_ar: 'الأسماك',
    name_en: 'Fish & Seafood',
    description_ar: 'الأسماك الطازجة والمأكولات البحرية والمشويات',
    icon_key: 'fish',
    accent_color: '#0284C7',
    sort_order: 40,
    is_general: 0,
  },
  {
    id: 'mcat_detergents',
    slug: 'detergents',
    name_ar: 'المنظفات',
    name_en: 'Detergents',
    description_ar: 'مساحيق الغسيل ومنظفات المنزل والعناية اليومية',
    icon_key: 'detergents',
    accent_color: '#4F46E5',
    sort_order: 50,
    is_general: 0,
  },
  {
    id: 'mcat_electronics',
    slug: 'electronics',
    name_ar: 'الإلكترونيات',
    name_en: 'Electronics',
    description_ar: 'الأجهزة الإلكترونية وإكسسوارات الموبايل والكمبيوتر',
    icon_key: 'electronics',
    accent_color: '#1D4ED8',
    sort_order: 60,
    is_general: 0,
  },
  {
    id: 'mcat_perfumes',
    slug: 'perfumes',
    name_ar: 'العطور والبرفانات',
    name_en: 'Perfumes',
    description_ar: 'العطور الشرقية والغربية ومستحضرات التجميل',
    icon_key: 'perfumes',
    accent_color: '#9333EA',
    sort_order: 70,
    is_general: 0,
  },
  {
    id: 'mcat_restaurants',
    slug: 'restaurants',
    name_ar: 'المطاعم',
    name_en: 'Restaurants',
    description_ar: 'الوجبات الساخنة والمشويات والمأكولات السريعة',
    icon_key: 'restaurants',
    accent_color: '#EA580C',
    sort_order: 80,
    is_general: 0,
  },
  {
    id: 'mcat_home_appliances',
    slug: 'home-appliances',
    name_ar: 'الأدوات المنزلية',
    name_en: 'Home Appliances',
    description_ar: 'أدوات المطبخ والمستلزمات المنزلية والأجهزة',
    icon_key: 'home',
    accent_color: '#0D9488',
    sort_order: 90,
    is_general: 0,
  },
  {
    id: 'mcat_clothing',
    slug: 'clothing',
    name_ar: 'الملابس',
    name_en: 'Clothing',
    description_ar: 'ملابس رجالي وحريمي وأطفال وأحذية وإكسسوارات',
    icon_key: 'clothing',
    accent_color: '#DB2777',
    sort_order: 100,
    is_general: 0,
  },
  {
    id: 'mcat_general',
    slug: 'general',
    name_ar: 'العام',
    name_en: 'General',
    description_ar: 'جميع المنتجات والأقسام المتاحة على المنصة',
    icon_key: 'general',
    accent_color: '#475569',
    sort_order: 110,
    is_general: 1,
  },
];

function slugify(input: string): string {
  const ascii = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 2) return ascii;
  return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeSearchText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strictly additive table initialization & idempotent seeding.
 * NEVER modifies, deletes, or overwrites any existing tables or rows
 * (categories, products, merchants, orders, customers remain 100% untouched).
 */
export function ensureMainCategoriesSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_main_categories (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT DEFAULT '',
      description_ar TEXT DEFAULT '',
      icon_key TEXT DEFAULT 'general',
      image_url TEXT DEFAULT '',
      accent_color TEXT DEFAULT '#A92224',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_general INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS main_category_merchant_links (
      id TEXT PRIMARY KEY,
      main_category_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      include_all_categories INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(main_category_id, merchant_id)
    );

    CREATE TABLE IF NOT EXISTS main_category_internal_links (
      id TEXT PRIMARY KEY,
      main_category_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL DEFAULT '',
      internal_category_id TEXT NOT NULL,
      include_descendants INTEGER NOT NULL DEFAULT 1,
      link_type TEXT NOT NULL DEFAULT 'include',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(main_category_id, merchant_id, internal_category_id, link_type)
    );

    CREATE TABLE IF NOT EXISTS main_category_product_links (
      id TEXT PRIMARY KEY,
      main_category_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(main_category_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mc_merchant_links_mc ON main_category_merchant_links(main_category_id);
    CREATE INDEX IF NOT EXISTS idx_mc_merchant_links_mer ON main_category_merchant_links(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_mc_internal_links_mc ON main_category_internal_links(main_category_id);
    CREATE INDEX IF NOT EXISTS idx_mc_internal_links_cat ON main_category_internal_links(internal_category_id);
    CREATE INDEX IF NOT EXISTS idx_mc_product_links_mc ON main_category_product_links(main_category_id);
    CREATE INDEX IF NOT EXISTS idx_mc_product_links_prod ON main_category_product_links(product_id);
  `);

  const now = new Date().toISOString();
  const countRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM platform_main_categories')
    .get() as { cnt: number };

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO platform_main_categories (
      id, slug, name_ar, name_en, description_ar, icon_key, image_url,
      accent_color, sort_order, is_active, is_general, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1, ?, ?, ?)
  `);

  if (Number(countRow?.cnt || 0) === 0) {
    const tx = db.transaction(() => {
      for (const item of INITIAL_MAIN_CATEGORIES) {
        insertStmt.run(
          item.id,
          item.slug,
          item.name_ar,
          item.name_en,
          item.description_ar,
          item.icon_key,
          item.accent_color,
          item.sort_order,
          item.is_general,
          now,
          now
        );
      }
    });
    tx();
  } else {
    // Always guarantee the General fallback category exists even if DB was migrated partially
    const generalRow = db
      .prepare('SELECT id FROM platform_main_categories WHERE is_general = 1 LIMIT 1')
      .get() as { id: string } | undefined;
    if (!generalRow) {
      const gen = INITIAL_MAIN_CATEGORIES.find((c) => c.is_general === 1)!;
      insertStmt.run(
        gen.id,
        gen.slug,
        gen.name_ar,
        gen.name_en,
        gen.description_ar,
        gen.icon_key,
        gen.accent_color,
        gen.sort_order,
        1,
        now,
        now
      );
    }
  }
}

interface ResolutionSnapshot {
  mainCategories: PlatformMainCategoryRow[];
  generalMainCategory: PlatformMainCategoryRow | null;
  categories: RawCategoryRow[];
  catById: Map<string, RawCategoryRow>;
  childrenByParent: Map<string, string[]>;
  metaMap: ReturnType<typeof computeCategoryHierarchyMap>;
  merchants: RawMerchantRow[];
  merchantById: Map<string, RawMerchantRow>;
  products: RawProductRow[];
  merchantLinks: MerchantLinkRow[];
  internalLinks: InternalCatLinkRow[];
  productLinks: ProductLinkRow[];
  // Fast lookup indexes
  merchantLinksByMc: Map<string, Map<string, MerchantLinkRow>>;
  internalLinksByMc: Map<string, InternalCatLinkRow[]>;
  productLinksByMc: Map<string, Set<string>>;
  activeDealByProductId: Map<string, { id: string; title_ar: string; deal_type: string; discount_value: number }>;
  storesCountByMasterId: Map<string, number>;
}

function buildResolutionSnapshot(): ResolutionSnapshot {
  const mainCategories = db
    .prepare(
      'SELECT * FROM platform_main_categories ORDER BY sort_order ASC, created_at ASC'
    )
    .all() as PlatformMainCategoryRow[];
  const generalMainCategory =
    mainCategories.find((m) => Number(m.is_general) === 1) || null;

  const categories = db
    .prepare(
      `SELECT id, scope, merchant_id, parent_id, level, full_path_ar, name_ar, name_en,
              image_url, sort_order, is_offers_section, is_active, group_key, group_name_ar
       FROM categories
       WHERE is_active = 1
       ORDER BY sort_order ASC, name_ar ASC`
    )
    .all() as RawCategoryRow[];

  const catById = new Map<string, RawCategoryRow>();
  const childrenByParent = new Map<string, string[]>();
  for (const c of categories) {
    catById.set(c.id, c);
    if (c.parent_id) {
      const arr = childrenByParent.get(c.parent_id) || [];
      arr.push(c.id);
      childrenByParent.set(c.parent_id, arr);
    }
  }
  const metaMap = computeCategoryHierarchyMap();

  const merchants = db
    .prepare(
      `SELECT m.id, m.business_name_ar, m.business_name_en, m.merchant_type,
              m.branch_name, m.zone_name, m.image_url, m.working_hours,
              m.verification_status, m.is_open_now,
              (SELECT ROUND(AVG(sr.rating), 2) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible') AS rating_avg,
              (SELECT COUNT(*) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible') AS rating_count
       FROM merchants m
       WHERE m.verification_status = 'approved'
       ORDER BY COALESCE(m.is_open_now, 0) DESC, m.business_name_ar ASC`
    )
    .all() as RawMerchantRow[];

  const merchantById = new Map<string, RawMerchantRow>();
  for (const m of merchants) merchantById.set(m.id, m);

  const products = db
    .prepare(
      `SELECT p.id, p.product_code, p.master_product_id, p.merchant_id, p.category_id,
              p.name_ar, p.name_en, p.brand, p.size_label, p.barcode, p.description,
              p.image_url, p.base_price, p.sale_price, p.is_offer, p.stock_quantity,
              p.is_available, p.requires_prescription, p.is_weighted, p.weight_step,
              p.weight_unit, p.purchase_count,
              m.business_name_ar AS merchant_name,
              m.is_open_now AS merchant_is_open,
              c.name_ar AS category_name
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE m.verification_status = 'approved'
         AND p.is_available = 1
         AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
       ORDER BY COALESCE(m.is_open_now, 0) DESC, p.is_offer DESC, COALESCE(p.purchase_count, 0) DESC, p.name_ar ASC`
    )
    .all() as RawProductRow[];

  const merchantLinks = db
    .prepare(
      'SELECT * FROM main_category_merchant_links ORDER BY sort_order ASC, created_at ASC'
    )
    .all() as MerchantLinkRow[];

  const internalLinks = db
    .prepare('SELECT * FROM main_category_internal_links ORDER BY created_at ASC')
    .all() as InternalCatLinkRow[];

  const productLinks = db
    .prepare('SELECT * FROM main_category_product_links ORDER BY created_at ASC')
    .all() as ProductLinkRow[];

  const merchantLinksByMc = new Map<string, Map<string, MerchantLinkRow>>();
  for (const row of merchantLinks) {
    let inner = merchantLinksByMc.get(row.main_category_id);
    if (!inner) {
      inner = new Map();
      merchantLinksByMc.set(row.main_category_id, inner);
    }
    inner.set(row.merchant_id, row);
  }

  const internalLinksByMc = new Map<string, InternalCatLinkRow[]>();
  for (const row of internalLinks) {
    const arr = internalLinksByMc.get(row.main_category_id) || [];
    arr.push(row);
    internalLinksByMc.set(row.main_category_id, arr);
  }

  const productLinksByMc = new Map<string, Set<string>>();
  for (const row of productLinks) {
    let set = productLinksByMc.get(row.main_category_id);
    if (!set) {
      set = new Set();
      productLinksByMc.set(row.main_category_id, set);
    }
    set.add(row.product_id);
  }

  // Active deals map (best-effort, non-breaking if table empty)
  const activeDealByProductId = new Map<
    string,
    { id: string; title_ar: string; deal_type: string; discount_value: number }
  >();
  try {
    const deals = db
      .prepare(
        `SELECT id, product_id, title_ar, deal_type, discount_value
         FROM product_deals
         WHERE is_active = 1
           AND (ends_at IS NULL OR ends_at = '' OR ends_at > datetime('now'))`
      )
      .all() as Array<{
      id: string;
      product_id: string;
      title_ar: string;
      deal_type: string;
      discount_value: number;
    }>;
    for (const d of deals) {
      if (d.product_id && !activeDealByProductId.has(d.product_id)) {
        activeDealByProductId.set(d.product_id, d);
      }
    }
  } catch {
    // ignore if product_deals does not exist
  }

  const storesCountByMasterId = new Map<string, number>();
  const masterMerchantSets = new Map<string, Set<string>>();
  for (const p of products) {
    if (!p.master_product_id) continue;
    let s = masterMerchantSets.get(p.master_product_id);
    if (!s) {
      s = new Set();
      masterMerchantSets.set(p.master_product_id, s);
    }
    s.add(p.merchant_id);
  }
  for (const [mid, set] of masterMerchantSets.entries()) {
    storesCountByMasterId.set(mid, set.size);
  }

  return {
    mainCategories,
    generalMainCategory,
    categories,
    catById,
    childrenByParent,
    metaMap,
    merchants,
    merchantById,
    products,
    merchantLinks,
    internalLinks,
    productLinks,
    merchantLinksByMc,
    internalLinksByMc,
    productLinksByMc,
    activeDealByProductId,
    storesCountByMasterId,
  };
}

function getAncestorChain(
  snap: ResolutionSnapshot,
  catId: string | null | undefined
): string[] {
  const chain: string[] = [];
  if (!catId) return chain;
  const seen = new Set<string>();
  let cur: string | null | undefined = catId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    const node = snap.catById.get(cur);
    cur = node?.parent_id || null;
  }
  return chain;
}

function getDescendantSet(
  snap: ResolutionSnapshot,
  rootId: string
): Set<string> {
  const result = new Set<string>();
  if (!rootId) return result;
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    const kids = snap.childrenByParent.get(id);
    if (kids) {
      for (const k of kids) queue.push(k);
    }
  }
  return result;
}

/**
 * Evaluates whether an internal category (within a specific merchant context)
 * is included in a NON-GENERAL Platform Main Category.
 *
 * Precedence (most specific wins):
 * 1. Closest category node along ancestor chain (exact match > parent > grandparent)
 * 2. Merchant-scoped rule beats global rule (merchant_id = '')
 * 3. 'exclude' beats 'include' at the exact same level & scope
 * 4. Whole-merchant link (include_all_categories = 1) applies if not explicitly excluded
 */
function matchesNonGeneralCategoryRule(
  snap: ResolutionSnapshot,
  mainCategoryId: string,
  merchantId: string,
  internalCategoryId: string | null | undefined
): boolean {
  const rules = snap.internalLinksByMc.get(mainCategoryId) || [];
  const chain = getAncestorChain(snap, internalCategoryId);

  if (chain.length > 0 && rules.length > 0) {
    for (let depth = 0; depth < chain.length; depth++) {
      const nodeId = chain[depth];
      // Check merchant-specific rules first at this depth, then global rules
      const scopes = [merchantId, ''];
      for (const scopeMerchant of scopes) {
        let hasInclude = false;
        let hasExclude = false;
        for (const r of rules) {
          if (r.internal_category_id !== nodeId) continue;
          if (r.merchant_id !== scopeMerchant) continue;
          if (depth > 0 && Number(r.include_descendants) !== 1) continue;
          if (r.link_type === 'exclude') hasExclude = true;
          else hasInclude = true;
        }
        if (hasExclude) return false;
        if (hasInclude) return true;
      }
    }
  }

  // Fallback to merchant-level whole-store link
  const merLink = snap.merchantLinksByMc.get(mainCategoryId)?.get(merchantId);
  if (merLink && Number(merLink.include_all_categories) === 1) {
    return true;
  }

  return false;
}

/**
 * Resolves whether a single product belongs to a specific NON-GENERAL main category.
 */
function productMatchesNonGeneralMainCategory(
  snap: ResolutionSnapshot,
  mainCategoryId: string,
  product: RawProductRow
): boolean {
  // 1. Direct multi-category product link always includes the product
  const directSet = snap.productLinksByMc.get(mainCategoryId);
  if (directSet && directSet.has(product.id)) return true;

  // 2. Internal category rule or merchant-level include_all_categories
  return matchesNonGeneralCategoryRule(
    snap,
    mainCategoryId,
    product.merchant_id,
    product.category_id
  );
}

/**
 * Computes the complete product assignment across all active main categories.
 * Any product that does not belong to any active non-general main category
 * automatically resolves into the General («العام») category without moving or duplicating rows.
 */
function computeMainCategoryMembership(snap: ResolutionSnapshot): {
  productsByMc: Map<string, RawProductRow[]>;
  merchantsByMc: Map<string, Set<string>>;
  productCountByMcMerchant: Map<string, Map<string, number>>;
  assignedProductIds: Set<string>;
} {
  const activeNonGeneralMcs = snap.mainCategories.filter(
    (m) => Number(m.is_active) === 1 && Number(m.is_general) !== 1
  );
  const allNonGeneralMcs = snap.mainCategories.filter(
    (m) => Number(m.is_general) !== 1
  );

  const productsByMc = new Map<string, RawProductRow[]>();
  const merchantsByMc = new Map<string, Set<string>>();
  const productCountByMcMerchant = new Map<string, Map<string, number>>();
  for (const mc of snap.mainCategories) {
    productsByMc.set(mc.id, []);
    merchantsByMc.set(mc.id, new Set());
    productCountByMcMerchant.set(mc.id, new Map());
  }

  const assignedToActiveNonGeneral = new Set<string>();

  // Evaluate every product against all non-general main categories
  for (const mc of allNonGeneralMcs) {
    const isActiveMc = Number(mc.is_active) === 1;
    const list = productsByMc.get(mc.id)!;
    const merSet = merchantsByMc.get(mc.id)!;
    const countMap = productCountByMcMerchant.get(mc.id)!;

    // Include explicitly linked merchants even if they currently have 0 available products
    const explicitMerLinks = snap.merchantLinksByMc.get(mc.id);
    if (explicitMerLinks) {
      for (const mid of explicitMerLinks.keys()) {
        if (snap.merchantById.has(mid)) merSet.add(mid);
      }
    }
    const explicitCatLinks = snap.internalLinksByMc.get(mc.id) || [];
    for (const cl of explicitCatLinks) {
      if (cl.link_type === 'include' && cl.merchant_id && snap.merchantById.has(cl.merchant_id)) {
        merSet.add(cl.merchant_id);
      }
    }

    for (const p of snap.products) {
      if (productMatchesNonGeneralMainCategory(snap, mc.id, p)) {
        list.push(p);
        merSet.add(p.merchant_id);
        countMap.set(p.merchant_id, (countMap.get(p.merchant_id) || 0) + 1);
        if (isActiveMc) {
          assignedToActiveNonGeneral.add(p.id);
        }
      }
    }
  }

  // Resolve General («العام») fallback:
  // Contains all products NOT assigned to any active non-general main category,
  // plus any products/merchants explicitly linked to General.
  if (snap.generalMainCategory) {
    const genId = snap.generalMainCategory.id;
    const genProducts = productsByMc.get(genId)!;
    const genMerchants = merchantsByMc.get(genId)!;
    const genCountMap = productCountByMcMerchant.get(genId)!;
    const explicitGenProds = snap.productLinksByMc.get(genId);
    const explicitGenMers = snap.merchantLinksByMc.get(genId);

    if (explicitGenMers) {
      for (const mid of explicitGenMers.keys()) {
        if (snap.merchantById.has(mid)) genMerchants.add(mid);
      }
    }

    for (const p of snap.products) {
      const explicitlyInGen = explicitGenProds?.has(p.id) || false;
      if (!assignedToActiveNonGeneral.has(p.id) || explicitlyInGen) {
        genProducts.push(p);
        genMerchants.add(p.merchant_id);
        genCountMap.set(p.merchant_id, (genCountMap.get(p.merchant_id) || 0) + 1);
      }
    }

    // If no active non-general categories have any linked merchants yet,
    // make sure every approved merchant is visible under General as well.
    if (activeNonGeneralMcs.length === 0 || assignedToActiveNonGeneral.size === 0) {
      for (const m of snap.merchants) {
        genMerchants.add(m.id);
      }
    }
  }

  return {
    productsByMc,
    merchantsByMc,
    productCountByMcMerchant,
    assignedProductIds: assignedToActiveNonGeneral,
  };
}

/**
 * Computes ONLY the internal categories (preserving exact L1 -> L2 -> L3+ hierarchy)
 * allowed for a specific `(mainCategory, merchantId)` context.
 */
function buildAllowedInternalCategories(
  snap: ResolutionSnapshot,
  mainCategory: PlatformMainCategoryRow,
  merchantId: string | null,
  mcProducts: RawProductRow[]
): Array<{
  id: string;
  parent_id: string | null;
  original_parent_id: string | null;
  level: number;
  name_ar: string;
  name_en: string;
  image_url: string;
  sort_order: number;
  full_path_ar: string;
  products_count: number;
  children_count: number;
}> {
  const isGeneral = Number(mainCategory.is_general) === 1;
  const scopedProducts = merchantId
    ? mcProducts.filter((p) => p.merchant_id === merchantId)
    : mcProducts;

  // Count products directly in each internal category AND rolled up across descendants
  const directProdCount = new Map<string, number>();
  for (const p of scopedProducts) {
    if (!p.category_id) continue;
    directProdCount.set(p.category_id, (directProdCount.get(p.category_id) || 0) + 1);
  }

  const allowedIds = new Set<string>();

  if (isGeneral) {
    // In General («العام»): preserve ALL internal categories used by unassigned products
    // (plus their ancestor chain so L1 -> L2 -> L3+ hierarchy is 100% preserved!).
    for (const catId of directProdCount.keys()) {
      for (const anc of getAncestorChain(snap, catId)) {
        if (snap.catById.has(anc)) allowedIds.add(anc);
      }
    }
    // Also include empty merchant-owned categories that aren't linked to any non-general main category
    if (merchantId) {
      const activeNonGen = snap.mainCategories.filter(
        (m) => Number(m.is_active) === 1 && Number(m.is_general) !== 1
      );
      for (const c of snap.categories) {
        if (c.merchant_id && c.merchant_id !== merchantId) continue;
        if (!c.merchant_id && directProdCount.size > 0 && !allowedIds.has(c.id)) continue;
        const linkedElsewhere = activeNonGen.some((ng) =>
          matchesNonGeneralCategoryRule(snap, ng.id, merchantId, c.id)
        );
        if (!linkedElsewhere && (c.merchant_id === merchantId || allowedIds.has(c.id))) {
          allowedIds.add(c.id);
        }
      }
    } else if (allowedIds.size === 0) {
      // If no products exist at all, show all categories not linked elsewhere
      for (const c of snap.categories) {
        allowedIds.add(c.id);
      }
    }
  } else {
    // Non-general main category: strictly include ONLY internal categories that belong to (mainCategory, merchant)
    // 1. Any category directly matching the main category rules (if it belongs to this store or has products for this store)
    const merIdsToCheck = merchantId
      ? [merchantId]
      : Array.from(new Set(scopedProducts.map((p) => p.merchant_id)));

    for (const c of snap.categories) {
      if (merchantId && c.merchant_id && c.merchant_id !== merchantId) continue;
      const matchesRule = merIdsToCheck.some((mid) =>
        matchesNonGeneralCategoryRule(snap, mainCategory.id, mid, c.id)
      );
      if (matchesRule) {
        // Keep if merchant explicitly owns this category, OR it has products in this subtree, OR explicitly linked
        const descendants = getDescendantSet(snap, c.id);
        let subtreeProds = 0;
        for (const d of descendants) subtreeProds += directProdCount.get(d) || 0;
        const isExplicitlyLinked = (snap.internalLinksByMc.get(mainCategory.id) || []).some(
          (r) =>
            r.link_type === 'include' &&
            r.internal_category_id === c.id &&
            (!merchantId || r.merchant_id === '' || r.merchant_id === merchantId)
        );
        if (subtreeProds > 0 || isExplicitlyLinked || (merchantId && c.merchant_id === merchantId)) {
          allowedIds.add(c.id);
        }
      }
    }

    // 2. Also ensure categories of directly linked products are represented
    for (const catId of directProdCount.keys()) {
      if (snap.catById.has(catId)) {
        allowedIds.add(catId);
        // Add ancestors ONLY if those ancestors are also allowed (do NOT leak unrelated parent categories)
        for (const anc of getAncestorChain(snap, catId)) {
          if (anc === catId) continue;
          const ancAllowed = merIdsToCheck.some((mid) =>
            matchesNonGeneralCategoryRule(snap, mainCategory.id, mid, anc)
          );
          if (ancAllowed && snap.catById.has(anc)) {
            allowedIds.add(anc);
          }
        }
      }
    }
  }

  // Build rolled-up counts for allowed categories
  const rolledCount = new Map<string, number>();
  for (const id of allowedIds) {
    const desc = getDescendantSet(snap, id);
    let total = 0;
    for (const d of desc) {
      if (allowedIds.has(d) || d === id) {
        total += directProdCount.get(d) || 0;
      }
    }
    rolledCount.set(id, total);
  }

  // Determine effective parent_id within the allowed subtree:
  // If a subcategory is linked without its parent, it cleanly becomes a root (parent_id = null)
  // inside this main category context while preserving its own children!
  const effectiveParent = new Map<string, string | null>();
  const childrenMap = new Map<string | null, RawCategoryRow[]>();

  const allowedRows = snap.categories.filter((c) => allowedIds.has(c.id));
  for (const c of allowedRows) {
    const effPid = c.parent_id && allowedIds.has(c.parent_id) ? c.parent_id : null;
    effectiveParent.set(c.id, effPid);
    const list = childrenMap.get(effPid) || [];
    list.push(c);
    childrenMap.set(effPid, list);
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      const diff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (diff !== 0) return diff;
      return String(a.name_ar || '').localeCompare(String(b.name_ar || ''), 'ar');
    });
  }

  const ordered: Array<{
    id: string;
    parent_id: string | null;
    original_parent_id: string | null;
    level: number;
    name_ar: string;
    name_en: string;
    image_url: string;
    sort_order: number;
    full_path_ar: string;
    products_count: number;
    children_count: number;
  }> = [];

  const visited = new Set<string>();
  const dfs = (parentId: string | null, depth: number) => {
    const kids = childrenMap.get(parentId) || [];
    for (const c of kids) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      const myKids = childrenMap.get(c.id) || [];
      const meta = snap.metaMap.get(c.id);
      ordered.push({
        id: c.id,
        parent_id: effectiveParent.get(c.id) || null,
        original_parent_id: c.parent_id || null,
        level: depth,
        name_ar: c.name_ar,
        name_en: c.name_en || '',
        image_url: c.image_url || '',
        sort_order: Number(c.sort_order || 0),
        full_path_ar: meta?.full_path_ar || c.full_path_ar || `${c.name_ar};`,
        products_count: rolledCount.get(c.id) || 0,
        children_count: myKids.length,
      });
      dfs(c.id, depth + 1);
    }
  };
  dfs(null, 0);

  return ordered;
}

function serializeProductCard(snap: ResolutionSnapshot, p: RawProductRow) {
  const basePrice = Number(p.base_price || 0);
  const salePrice =
    p.sale_price !== null && p.sale_price !== undefined ? Number(p.sale_price) : null;
  const hasDiscount = salePrice !== null && salePrice > 0 && salePrice < basePrice;
  const effPrice = hasDiscount ? salePrice : basePrice;
  const discountPct =
    hasDiscount && basePrice > 0
      ? Math.round(((basePrice - effPrice) / basePrice) * 100)
      : 0;
  const isWeighted = Boolean(p.is_weighted);
  const weightStep = Number(p.weight_step || (isWeighted ? 0.25 : 1));
  const weightUnit = String(p.weight_unit || (isWeighted ? 'كجم' : ''));
  const deal = snap.activeDealByProductId.get(p.id) || null;
  const storesCount = p.master_product_id
    ? snap.storesCountByMasterId.get(p.master_product_id) || 1
    : 1;

  return {
    id: p.id,
    product_code: p.product_code || '',
    master_product_id: p.master_product_id || null,
    merchant_id: p.merchant_id,
    merchant_name: String(p.merchant_name || 'متجر اطلبها'),
    merchant_is_open: Boolean(p.merchant_is_open),
    category_id: p.category_id || '',
    category_name: String(p.category_name || ''),
    name_ar: p.name_ar,
    name_en: p.name_en || '',
    brand: p.brand || '',
    size_label: p.size_label || '',
    barcode: p.barcode || null,
    description: p.description || '',
    image_url: p.image_url || '',
    base_price: basePrice,
    sale_price: salePrice,
    effective_price: effPrice,
    discount_percent: discountPct,
    is_offer: Boolean(p.is_offer) || hasDiscount,
    stock_quantity:
      p.stock_quantity !== null && p.stock_quantity !== undefined
        ? Number(p.stock_quantity)
        : 99,
    is_available: Boolean(p.is_available),
    requires_prescription: Boolean(p.requires_prescription),
    is_weighted: isWeighted,
    weight_step: weightStep,
    weight_unit: weightUnit,
    purchase_count: Number(p.purchase_count || 0),
    stores_count: storesCount,
    active_deal: deal
      ? {
          id: deal.id,
          title_ar: deal.title_ar,
          deal_type: deal.deal_type,
          discount_value: Number(deal.discount_value || 0),
        }
      : null,
  };
}

function serializeMainCategory(
  row: PlatformMainCategoryRow,
  stats?: { merchants_count: number; products_count: number; internal_links_count?: number }
) {
  return {
    id: row.id,
    slug: row.slug,
    name_ar: row.name_ar,
    name_en: row.name_en || '',
    description_ar: row.description_ar || '',
    icon_key: row.icon_key || 'general',
    image_url: row.image_url || '',
    accent_color: row.accent_color || '#A92224',
    sort_order: Number(row.sort_order || 0),
    is_active: Boolean(row.is_active),
    is_general: Boolean(row.is_general),
    merchants_count: stats?.merchants_count ?? 0,
    products_count: stats?.products_count ?? 0,
    internal_links_count: stats?.internal_links_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerMainCategoriesRoutes(app: Express): void {
  ensureMainCategoriesSchema();

  // =========================================================================
  // PUBLIC CUSTOMER APIS (Web & Flutter)
  // =========================================================================

  // 1. List active Platform Main Categories ordered by sort_order
  app.get('/api/main-categories', (_req: Request, res: Response) => {
    try {
      const snap = buildResolutionSnapshot();
      const membership = computeMainCategoryMembership(snap);
      const items = snap.mainCategories
        .filter((mc) => Number(mc.is_active) === 1)
        .map((mc) =>
          serializeMainCategory(mc, {
            merchants_count: membership.merchantsByMc.get(mc.id)?.size || 0,
            products_count: membership.productsByMc.get(mc.id)?.length || 0,
          })
        );
      res.json({ main_categories: items });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل الأقسام الرئيسية' });
    }
  });

  // 2. Explore a Platform Main Category:
  //    - Returns ONLY linked merchants (for horizontal swipeable strip)
  //    - Returns all products across linked stores (or filtered to selected store + internal category)
  //    - When merchant_id is selected, returns ONLY that store's internal L1/L2/L3+ categories linked to this Main Category
  app.get('/api/main-categories/:id/explore', (req: Request, res: Response) => {
    try {
      const idOrSlug = String(req.params.id || '').trim();
      const merchantId = String(req.query.merchant_id || '').trim() || null;
      const internalCategoryId = String(req.query.internal_category_id || '').trim() || null;
      const q = normalizeSearchText(String(req.query.q || ''));
      const page = Math.max(1, Number(req.query.page || 1) || 1);
      const limit = Math.min(60, Math.max(6, Number(req.query.limit || 24) || 24));

      const snap = buildResolutionSnapshot();
      const mainCategory = snap.mainCategories.find(
        (m) => m.id === idOrSlug || m.slug === idOrSlug
      );
      if (!mainCategory || Number(mainCategory.is_active) !== 1) {
        return res.status(404).json({ error: 'القسم الرئيسي غير موجود أو غير مفعل' });
      }

      const membership = computeMainCategoryMembership(snap);
      const mcProducts = membership.productsByMc.get(mainCategory.id) || [];
      const mcMerchantIds = membership.merchantsByMc.get(mainCategory.id) || new Set<string>();
      const countMap = membership.productCountByMcMerchant.get(mainCategory.id) || new Map<string, number>();
      const explicitMerLinks = snap.merchantLinksByMc.get(mainCategory.id);

      // Build horizontal strip merchants list (ONLY merchants linked to this main category)
      const merchants = Array.from(mcMerchantIds)
        .map((mid) => snap.merchantById.get(mid))
        .filter((m): m is RawMerchantRow => Boolean(m))
        .map((m) => {
          const link = explicitMerLinks?.get(m.id);
          const isOpen = Boolean(m.is_open_now);
          return {
            id: m.id,
            business_name_ar: m.business_name_ar,
            business_name_en: m.business_name_en || '',
            merchant_type: m.merchant_type || 'grocery',
            branch_name: m.branch_name || '',
            zone_name: m.zone_name || '',
            image_url: m.image_url || '',
            working_hours: m.working_hours || '',
            is_open_now: isOpen,
            is_open: isOpen,
            rating_avg: Number(m.rating_avg || 0),
            rating_count: Number(m.rating_count || 0),
            products_count: countMap.get(m.id) || 0,
            include_all_categories: link ? Boolean(link.include_all_categories) : false,
            _sort: link ? Number(link.sort_order || 0) : 999,
          };
        })
        .sort((a, b) => {
          if (a._sort !== b._sort) return a._sort - b._sort;
          if (a.is_open_now !== b.is_open_now) return a.is_open_now ? -1 : 1;
          if (b.products_count !== a.products_count) return b.products_count - a.products_count;
          return a.business_name_ar.localeCompare(b.business_name_ar, 'ar');
        })
        .map(({ _sort, ...rest }) => rest);

      // Build allowed internal categories for selected store (or for General when browsing globally)
      const internalCategories = merchantId
        ? buildAllowedInternalCategories(snap, mainCategory, merchantId, mcProducts)
        : Number(mainCategory.is_general) === 1
        ? buildAllowedInternalCategories(snap, mainCategory, null, mcProducts)
        : [];

      // Filter products
      let filtered = mcProducts;
      if (merchantId) {
        filtered = filtered.filter((p) => p.merchant_id === merchantId);
      }

      if (internalCategoryId) {
        // Include selected internal category + all its allowed descendants
        const allowedIdSet = new Set(internalCategories.map((c) => c.id));
        const descSet = getDescendantSet(snap, internalCategoryId);
        // Restrict descendants to allowed categories (so excluded child subcategories stay excluded!)
        const activeCatIds = new Set<string>();
        for (const d of descSet) {
          if (allowedIdSet.size === 0 || allowedIdSet.has(d) || d === internalCategoryId) {
            activeCatIds.add(d);
          }
        }
        filtered = filtered.filter((p) => p.category_id && activeCatIds.has(p.category_id));
      }

      if (q) {
        filtered = filtered.filter((p) => {
          const hay = normalizeSearchText(
            `${p.name_ar} ${p.name_en || ''} ${p.brand || ''} ${p.merchant_name || ''} ${p.category_name || ''}`
          );
          return hay.includes(q);
        });
      }

      const total = filtered.length;
      const offset = (page - 1) * limit;
      const sliced = filtered.slice(offset, offset + limit).map((p) => serializeProductCard(snap, p));

      res.json({
        main_category: serializeMainCategory(mainCategory, {
          merchants_count: merchants.length,
          products_count: mcProducts.length,
        }),
        selected_merchant_id: merchantId,
        selected_internal_category_id: internalCategoryId,
        merchants,
        internal_categories: internalCategories,
        products: sliced,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.max(1, Math.ceil(total / limit)),
          has_more: offset + sliced.length < total,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل بيانات القسم الرئيسي' });
    }
  });

  // =========================================================================
  // ADMIN PANEL APIS (Protected by Admin Auth & Roles)
  // =========================================================================

  // 1. Get all Platform Main Categories (including hidden) + counts + unassigned summary
  app.get(
    '/api/admin/main-categories',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (_req: Request, res: Response) => {
      try {
        const snap = buildResolutionSnapshot();
        const membership = computeMainCategoryMembership(snap);
        const items = snap.mainCategories.map((mc) =>
          serializeMainCategory(mc, {
            merchants_count: membership.merchantsByMc.get(mc.id)?.size || 0,
            products_count: membership.productsByMc.get(mc.id)?.length || 0,
            internal_links_count: (snap.internalLinksByMc.get(mc.id) || []).length,
          })
        );

        const totalProducts = snap.products.length;
        const assignedProducts = membership.assignedProductIds.size;
        const unassignedProducts = Math.max(0, totalProducts - assignedProducts);

        res.json({
          main_categories: items,
          summary: {
            total_main_categories: items.length,
            active_main_categories: items.filter((i) => i.is_active).length,
            total_products: totalProducts,
            assigned_products: assignedProducts,
            unassigned_in_general: unassignedProducts,
            total_merchants: snap.merchants.length,
            total_internal_categories: snap.categories.length,
          },
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر تحميل الأقسام الرئيسية للإدارة' });
      }
    }
  );

  // 2. Create a new Platform Main Category
  app.post(
    '/api/admin/main-categories',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const auth = (req as Request & { auth?: AuthContext }).auth;
        const nameAr = String(req.body?.name_ar || '').trim();
        if (!nameAr) {
          return res.status(400).json({ error: 'يرجى إدخال اسم القسم الرئيسي بالعربية' });
        }
        const nameEn = String(req.body?.name_en || '').trim();
        const descriptionAr = String(req.body?.description_ar || '').trim();
        const iconKey = String(req.body?.icon_key || 'general').trim() || 'general';
        const imageUrl = String(req.body?.image_url || '').trim();
        const accentColor = String(req.body?.accent_color || '#A92224').trim() || '#A92224';
        const isActive = req.body?.is_active === false ? 0 : 1;

        let slug = slugify(String(req.body?.slug || nameEn || nameAr));
        const existingSlug = db
          .prepare('SELECT id FROM platform_main_categories WHERE slug = ?')
          .get(slug);
        if (existingSlug) {
          slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
        }

        const maxSortRow = db
          .prepare('SELECT MAX(sort_order) AS mx FROM platform_main_categories WHERE is_general = 0')
          .get() as { mx: number | null };
        const sortOrder =
          req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))
            ? Number(req.body.sort_order)
            : Number(maxSortRow?.mx ?? 100) + 10;

        const id = uid('mcat');
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO platform_main_categories (
             id, slug, name_ar, name_en, description_ar, icon_key, image_url,
             accent_color, sort_order, is_active, is_general, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
          id,
          slug,
          nameAr,
          nameEn,
          descriptionAr,
          iconKey,
          imageUrl,
          accentColor,
          sortOrder,
          isActive,
          now,
          now
        );

        const created = db
          .prepare('SELECT * FROM platform_main_categories WHERE id = ?')
          .get(id) as PlatformMainCategoryRow;

        recordAuditLog({
          actor_name: auth?.email || 'Admin',
          actor_role: auth?.role || 'super_admin',
          action: 'main_category_created',
          entity_type: 'platform_main_category',
          entity_id: id,
          details: JSON.stringify({ name_ar: nameAr, slug, sort_order: sortOrder }),
        });

        res.status(201).json({ ok: true, main_category: serializeMainCategory(created) });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر إنشاء القسم الرئيسي' });
      }
    }
  );

  // 3. Reorder Platform Main Categories
  app.post(
    '/api/admin/main-categories/reorder',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const orderedIds = Array.isArray(req.body?.ordered_ids)
          ? req.body.ordered_ids.map((v: unknown) => String(v || '').trim()).filter(Boolean)
          : [];
        if (orderedIds.length === 0) {
          return res.status(400).json({ error: 'قائمة الترتيب فارغة' });
        }
        const now = new Date().toISOString();
        const stmt = db.prepare(
          'UPDATE platform_main_categories SET sort_order = ?, updated_at = ? WHERE id = ?'
        );
        const tx = db.transaction(() => {
          orderedIds.forEach((id: string, idx: number) => {
            stmt.run((idx + 1) * 10, now, id);
          });
        });
        tx();
        res.json({ ok: true, updated_count: orderedIds.length });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر إعادة ترتيب الأقسام' });
      }
    }
  );

  // 4. Update a Platform Main Category (edit, hide/show, sort_order)
  app.patch(
    '/api/admin/main-categories/:id',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const id = String(req.params.id || '').trim();
        const existing = db
          .prepare('SELECT * FROM platform_main_categories WHERE id = ?')
          .get(id) as PlatformMainCategoryRow | undefined;
        if (!existing) {
          return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });
        }

        const nameAr =
          req.body?.name_ar !== undefined
            ? String(req.body.name_ar).trim() || existing.name_ar
            : existing.name_ar;
        const nameEn =
          req.body?.name_en !== undefined ? String(req.body.name_en).trim() : existing.name_en;
        const descriptionAr =
          req.body?.description_ar !== undefined
            ? String(req.body.description_ar).trim()
            : existing.description_ar;
        const iconKey =
          req.body?.icon_key !== undefined
            ? String(req.body.icon_key).trim() || existing.icon_key
            : existing.icon_key;
        const imageUrl =
          req.body?.image_url !== undefined ? String(req.body.image_url).trim() : existing.image_url;
        const accentColor =
          req.body?.accent_color !== undefined
            ? String(req.body.accent_color).trim() || existing.accent_color
            : existing.accent_color;
        const sortOrder =
          req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))
            ? Number(req.body.sort_order)
            : existing.sort_order;
        const isActive =
          req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

        const now = new Date().toISOString();
        db.prepare(
          `UPDATE platform_main_categories
           SET name_ar = ?, name_en = ?, description_ar = ?, icon_key = ?,
               image_url = ?, accent_color = ?, sort_order = ?, is_active = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          nameAr,
          nameEn,
          descriptionAr,
          iconKey,
          imageUrl,
          accentColor,
          sortOrder,
          isActive,
          now,
          id
        );

        const updated = db
          .prepare('SELECT * FROM platform_main_categories WHERE id = ?')
          .get(id) as PlatformMainCategoryRow;
        res.json({ ok: true, main_category: serializeMainCategory(updated) });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر تحديث القسم الرئيسي' });
      }
    }
  );

  // 5. Delete a Platform Main Category (NEVER deletes products/internal categories/merchants; protects General)
  app.delete(
    '/api/admin/main-categories/:id',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const auth = (req as Request & { auth?: AuthContext }).auth;
        const id = String(req.params.id || '').trim();
        const existing = db
          .prepare('SELECT * FROM platform_main_categories WHERE id = ?')
          .get(id) as PlatformMainCategoryRow | undefined;
        if (!existing) {
          return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });
        }
        if (Number(existing.is_general) === 1) {
          return res.status(400).json({
            error: 'لا يمكن حذف قسم «العام» لأنه القسم الافتراضي الحاضن لباقي المنتجات والأقسام',
          });
        }

        const tx = db.transaction(() => {
          db.prepare('DELETE FROM main_category_merchant_links WHERE main_category_id = ?').run(id);
          db.prepare('DELETE FROM main_category_internal_links WHERE main_category_id = ?').run(id);
          db.prepare('DELETE FROM main_category_product_links WHERE main_category_id = ?').run(id);
          db.prepare('DELETE FROM platform_main_categories WHERE id = ?').run(id);
        });
        tx();

        recordAuditLog({
          actor_name: auth?.email || 'Admin',
          actor_role: auth?.role || 'super_admin',
          action: 'main_category_deleted',
          entity_type: 'platform_main_category',
          entity_id: id,
          details: JSON.stringify({ name_ar: existing.name_ar }),
        });

        res.json({ ok: true, id });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر حذف القسم الرئيسي' });
      }
    }
  );

  // 6. Inspect links for a specific Platform Main Category (merchant links, internal category links, product links)
  app.get(
    '/api/admin/main-categories/:id/links',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const id = String(req.params.id || '').trim();
        const snap = buildResolutionSnapshot();
        const mc = snap.mainCategories.find((m) => m.id === id);
        if (!mc) {
          return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });
        }

        const membership = computeMainCategoryMembership(snap);
        const merchantLinks = (
          Array.from(snap.merchantLinksByMc.get(id)?.values() || [])
        ).map((l) => {
          const mer = snap.merchantById.get(l.merchant_id);
          return {
            ...l,
            include_all_categories: Boolean(l.include_all_categories),
            merchant_name: mer?.business_name_ar || l.merchant_id,
            merchant_image: mer?.image_url || '',
            merchant_is_open: Boolean(mer?.is_open_now),
          };
        });

        const internalLinks = (snap.internalLinksByMc.get(id) || []).map((l) => {
          const cat = snap.catById.get(l.internal_category_id);
          const meta = snap.metaMap.get(l.internal_category_id);
          const mer = l.merchant_id ? snap.merchantById.get(l.merchant_id) : null;
          return {
            ...l,
            include_descendants: Boolean(l.include_descendants),
            category_name_ar: cat?.name_ar || l.internal_category_id,
            category_full_path_ar: meta?.full_path_ar || cat?.full_path_ar || cat?.name_ar || '',
            category_level: meta?.level ?? cat?.level ?? 0,
            merchant_name: mer?.business_name_ar || (l.merchant_id ? l.merchant_id : 'كل المتاجر'),
          };
        });

        const directProductIds = Array.from(snap.productLinksByMc.get(id) || []);
        const productById = new Map(snap.products.map((p) => [p.id, p]));
        const directProducts = directProductIds
          .map((pid) => {
            const p = productById.get(pid);
            if (!p) return null;
            return {
              product_id: p.id,
              name_ar: p.name_ar,
              image_url: p.image_url || '',
              merchant_id: p.merchant_id,
              merchant_name: p.merchant_name || '',
              category_id: p.category_id || '',
              category_name: p.category_name || '',
              base_price: Number(p.base_price || 0),
              sale_price: p.sale_price !== null ? Number(p.sale_price) : null,
            };
          })
          .filter(Boolean);

        res.json({
          main_category: serializeMainCategory(mc, {
            merchants_count: membership.merchantsByMc.get(id)?.size || 0,
            products_count: membership.productsByMc.get(id)?.length || 0,
            internal_links_count: internalLinks.length,
          }),
          merchant_links: merchantLinks,
          internal_links: internalLinks,
          product_links: directProducts,
          resolved_merchants_count: membership.merchantsByMc.get(id)?.size || 0,
          resolved_products_count: membership.productsByMc.get(id)?.length || 0,
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر تحميل روابط القسم الرئيسي' });
      }
    }
  );

  // 7. Link/Update a whole Merchant to a Platform Main Category
  app.post(
    '/api/admin/main-categories/:id/merchant-links',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const mainCategoryId = String(req.params.id || '').trim();
        const merchantId = String(req.body?.merchant_id || '').trim();
        const includeAll = req.body?.include_all_categories === false ? 0 : 1;
        const sortOrder = Number(req.body?.sort_order || 0) || 0;

        if (!merchantId) {
          return res.status(400).json({ error: 'يرجى اختيار المتجر' });
        }
        const mc = db
          .prepare('SELECT id FROM platform_main_categories WHERE id = ?')
          .get(mainCategoryId);
        if (!mc) return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });

        const mer = db.prepare('SELECT id FROM merchants WHERE id = ?').get(merchantId);
        if (!mer) return res.status(404).json({ error: 'المتجر غير موجود' });

        const existing = db
          .prepare(
            'SELECT id FROM main_category_merchant_links WHERE main_category_id = ? AND merchant_id = ?'
          )
          .get(mainCategoryId, merchantId) as { id: string } | undefined;

        if (existing) {
          db.prepare(
            'UPDATE main_category_merchant_links SET include_all_categories = ?, sort_order = ? WHERE id = ?'
          ).run(includeAll, sortOrder, existing.id);
          return res.json({ ok: true, id: existing.id, updated: true });
        }

        const linkId = uid('mcml');
        db.prepare(
          `INSERT INTO main_category_merchant_links
             (id, main_category_id, merchant_id, include_all_categories, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(linkId, mainCategoryId, merchantId, includeAll, sortOrder, new Date().toISOString());

        res.status(201).json({ ok: true, id: linkId, updated: false });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر ربط المتجر بالقسم الرئيسي' });
      }
    }
  );

  // 8. Unlink a Merchant from a Platform Main Category
  app.delete(
    '/api/admin/main-categories/:id/merchant-links/:merchantId',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const mainCategoryId = String(req.params.id || '').trim();
        const merchantId = String(req.params.merchantId || '').trim();
        db.prepare(
          'DELETE FROM main_category_merchant_links WHERE main_category_id = ? AND merchant_id = ?'
        ).run(mainCategoryId, merchantId);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر إلغاء ربط المتجر' });
      }
    }
  );

  // 9. Link (or Exclude) an Internal Store Category to a Platform Main Category
  app.post(
    '/api/admin/main-categories/:id/category-links',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const mainCategoryId = String(req.params.id || '').trim();
        const internalCategoryId = String(req.body?.internal_category_id || '').trim();
        const merchantId = String(req.body?.merchant_id || '').trim(); // '' = all stores
        const includeDescendants = req.body?.include_descendants === false ? 0 : 1;
        const linkType = req.body?.link_type === 'exclude' ? 'exclude' : 'include';

        if (!internalCategoryId) {
          return res.status(400).json({ error: 'يرجى اختيار القسم الداخلي' });
        }
        const mc = db
          .prepare('SELECT id FROM platform_main_categories WHERE id = ?')
          .get(mainCategoryId);
        if (!mc) return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });

        const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(internalCategoryId);
        if (!cat) return res.status(404).json({ error: 'القسم الداخلي غير موجود' });

        const existing = db
          .prepare(
            `SELECT id FROM main_category_internal_links
             WHERE main_category_id = ? AND merchant_id = ? AND internal_category_id = ? AND link_type = ?`
          )
          .get(mainCategoryId, merchantId, internalCategoryId, linkType) as { id: string } | undefined;

        if (existing) {
          db.prepare(
            'UPDATE main_category_internal_links SET include_descendants = ? WHERE id = ?'
          ).run(includeDescendants, existing.id);
          return res.json({ ok: true, id: existing.id, updated: true });
        }

        const linkId = uid('mcil');
        db.prepare(
          `INSERT INTO main_category_internal_links
             (id, main_category_id, merchant_id, internal_category_id, include_descendants, link_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          linkId,
          mainCategoryId,
          merchantId,
          internalCategoryId,
          includeDescendants,
          linkType,
          new Date().toISOString()
        );

        res.status(201).json({ ok: true, id: linkId, updated: false });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر ربط القسم الداخلي' });
      }
    }
  );

  // 10. Delete an Internal Category Link
  app.delete(
    '/api/admin/main-categories/:id/category-links/:linkId',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const mainCategoryId = String(req.params.id || '').trim();
        const linkId = String(req.params.linkId || '').trim();
        db.prepare(
          'DELETE FROM main_category_internal_links WHERE id = ? AND main_category_id = ?'
        ).run(linkId, mainCategoryId);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر إزالة ربط القسم الداخلي' });
      }
    }
  );

  // 11. Link/Unlink Products directly to a Platform Main Category (Multi-category without duplicating products)
  app.post(
    '/api/admin/main-categories/:id/product-links',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const mainCategoryId = String(req.params.id || '').trim();
        const productIds: string[] = Array.isArray(req.body?.product_ids)
          ? req.body.product_ids.map((v: unknown) => String(v || '').trim()).filter(Boolean)
          : req.body?.product_id
          ? [String(req.body.product_id).trim()]
          : [];
        const action = req.body?.action === 'remove' ? 'remove' : 'add';

        if (productIds.length === 0) {
          return res.status(400).json({ error: 'يرجى تحديد منتج واحد على الأقل' });
        }

        const mc = db
          .prepare('SELECT id FROM platform_main_categories WHERE id = ?')
          .get(mainCategoryId);
        if (!mc) return res.status(404).json({ error: 'القسم الرئيسي غير موجود' });

        const now = new Date().toISOString();
        const insertStmt = db.prepare(
          `INSERT OR IGNORE INTO main_category_product_links (id, main_category_id, product_id, created_at)
           VALUES (?, ?, ?, ?)`
        );
        const delStmt = db.prepare(
          'DELETE FROM main_category_product_links WHERE main_category_id = ? AND product_id = ?'
        );

        const tx = db.transaction(() => {
          for (const pid of productIds) {
            if (action === 'remove') {
              delStmt.run(mainCategoryId, pid);
            } else {
              insertStmt.run(uid('mcpl'), mainCategoryId, pid, now);
            }
          }
        });
        tx();

        res.json({ ok: true, action, count: productIds.length });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر تحديث ربط المنتجات' });
      }
    }
  );

  // 12. Search products in Admin for multi-category assignment (supports unassigned_only filter)
  app.get(
    '/api/admin/main-categories/catalog/products',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const q = normalizeSearchText(String(req.query.q || ''));
        const merchantId = String(req.query.merchant_id || '').trim();
        const categoryId = String(req.query.category_id || '').trim();
        const unassignedOnly = String(req.query.unassigned_only || '') === '1';
        const limit = Math.min(100, Math.max(10, Number(req.query.limit || 40) || 40));

        const snap = buildResolutionSnapshot();
        const membership = computeMainCategoryMembership(snap);

        // Precompute direct + resolved main categories per product
        const directMcsByProd = new Map<string, string[]>();
        for (const pl of snap.productLinks) {
          const arr = directMcsByProd.get(pl.product_id) || [];
          arr.push(pl.main_category_id);
          directMcsByProd.set(pl.product_id, arr);
        }

        const catDescSet = categoryId ? getDescendantSet(snap, categoryId) : null;

        let list = snap.products;
        if (merchantId) list = list.filter((p) => p.merchant_id === merchantId);
        if (catDescSet) list = list.filter((p) => p.category_id && catDescSet.has(p.category_id));
        if (unassignedOnly) list = list.filter((p) => !membership.assignedProductIds.has(p.id));
        if (q) {
          list = list.filter((p) => {
            const hay = normalizeSearchText(
              `${p.name_ar} ${p.name_en || ''} ${p.brand || ''} ${p.barcode || ''} ${p.merchant_name || ''} ${p.category_name || ''}`
            );
            return hay.includes(q);
          });
        }

        const total = list.length;
        const items = list.slice(0, limit).map((p) => {
          const directIds = directMcsByProd.get(p.id) || [];
          const resolvedIds: string[] = [];
          for (const mc of snap.mainCategories) {
            if (Number(mc.is_general) === 1) continue;
            if (productMatchesNonGeneralMainCategory(snap, mc.id, p)) {
              resolvedIds.push(mc.id);
            }
          }
          return {
            id: p.id,
            name_ar: p.name_ar,
            image_url: p.image_url || '',
            merchant_id: p.merchant_id,
            merchant_name: p.merchant_name || '',
            category_id: p.category_id || '',
            category_name: p.category_name || '',
            base_price: Number(p.base_price || 0),
            sale_price: p.sale_price !== null ? Number(p.sale_price) : null,
            direct_main_category_ids: directIds,
            resolved_main_category_ids: resolvedIds,
            in_general_only: !membership.assignedProductIds.has(p.id),
          };
        });

        res.json({ products: items, total });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر البحث في المنتجات' });
      }
    }
  );

  // 13. Set direct multi-category links for a single product (without duplicating the product!)
  app.put(
    '/api/admin/products/:productId/main-categories',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      try {
        const productId = String(req.params.productId || '').trim();
        const mainCategoryIds: string[] = Array.isArray(req.body?.main_category_ids)
          ? req.body.main_category_ids.map((v: unknown) => String(v || '').trim()).filter(Boolean)
          : [];

        const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
        if (!prod) return res.status(404).json({ error: 'المنتج غير موجود' });

        const now = new Date().toISOString();
        const tx = db.transaction(() => {
          db.prepare('DELETE FROM main_category_product_links WHERE product_id = ?').run(productId);
          const ins = db.prepare(
            `INSERT OR IGNORE INTO main_category_product_links (id, main_category_id, product_id, created_at)
             VALUES (?, ?, ?, ?)`
          );
          for (const mcId of mainCategoryIds) {
            ins.run(uid('mcpl'), mcId, productId, now);
          }
        });
        tx();

        res.json({ ok: true, product_id: productId, main_category_ids: mainCategoryIds });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'تعذر حفظ الأقسام الرئيسية للمنتج' });
      }
    }
  );
}
