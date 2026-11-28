import type { Express, Request, Response } from 'express';
import { db, uid, recordAuditLog } from './db.ts';
import {
  ALL_ADMIN_ROLES,
  requireAuth,
  requireRole,
  type AuthContext,
} from './auth.ts';

type RawProductJoin = {
  link_id?: string;
  product_id: string;
  merchant_id: string;
  category_id: string | null;
  master_product_id: string | null;
  name_ar: string;
  name_en: string | null;
  image_url: string | null;
  base_price: number;
  sale_price: number | null;
  is_offer: number;
  stock_quantity: number | null;
  is_available: number;
  is_weighted: number | null;
  weight_step: number | null;
  weight_unit: string | null;
  size_label: string | null;
  brand: string | null;
  requires_prescription: number | null;
  merchant_name: string | null;
  merchant_is_open: number | null;
  merchant_verification_status: string | null;
  is_recommended?: number;
  is_alternative?: number;
  default_qty?: number;
  sort_order?: number;
};

function normalizeArabic(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProductCurrentlyAvailable(p: {
  is_available?: number | boolean | null;
  stock_quantity?: number | null;
  merchant_verification_status?: string | null;
}): boolean {
  const avail = p.is_available === 1 || p.is_available === true;
  const stockOk = p.stock_quantity === null || p.stock_quantity === undefined || Number(p.stock_quantity) > 0;
  const merchantOk =
    !p.merchant_verification_status ||
    p.merchant_verification_status === 'approved' ||
    p.merchant_verification_status === 'active';
  return avail && stockOk && merchantOk;
}

function effectiveUnitPrice(basePrice: number, salePrice: number | null, isOffer: number): number {
  const base = Number(basePrice || 0);
  const sale = salePrice !== null && salePrice !== undefined ? Number(salePrice) : null;
  if (sale !== null && sale > 0 && sale < base) return sale;
  if (isOffer && sale !== null && sale > 0) return sale;
  return base;
}

function serializeLinkedProduct(
  row: RawProductJoin,
  opts: { isSuggestedAlternative?: boolean; suggestionSource?: 'admin' | 'auto_match' | null } = {}
) {
  const basePrice = Number(row.base_price || 0);
  const salePrice = row.sale_price !== null && row.sale_price !== undefined ? Number(row.sale_price) : null;
  const isOffer = Boolean(row.is_offer) || (salePrice !== null && salePrice > 0 && salePrice < basePrice);
  const effPrice = effectiveUnitPrice(basePrice, salePrice, row.is_offer ? 1 : 0);
  const available = isProductCurrentlyAvailable(row);
  const isWeighted = Boolean(row.is_weighted);
  const weightStep = Number(row.weight_step || (isWeighted ? 0.25 : 1));
  const weightUnit = String(row.weight_unit || (isWeighted ? 'كجم' : ''));
  const sizeLabel = String(row.size_label || weightUnit || '').trim();

  return {
    link_id: row.link_id || null,
    product_id: row.product_id,
    id: row.product_id,
    merchant_id: row.merchant_id,
    merchant_name: String(row.merchant_name || 'متجر اطلبها'),
    merchant_is_open: row.merchant_is_open === null || row.merchant_is_open === undefined ? true : Boolean(row.merchant_is_open),
    category_id: row.category_id || '',
    name_ar: row.name_ar,
    name_en: row.name_en || '',
    image_url: row.image_url || '',
    base_price: basePrice,
    sale_price: salePrice,
    effective_price: effPrice,
    is_offer: isOffer,
    stock_quantity: row.stock_quantity !== null && row.stock_quantity !== undefined ? Number(row.stock_quantity) : 99,
    is_available: available,
    is_weighted: isWeighted,
    weight_step: weightStep,
    weight_unit: weightUnit,
    size_label: sizeLabel,
    brand: row.brand || '',
    requires_prescription: Boolean(row.requires_prescription),
    is_recommended: Boolean(row.is_recommended),
    is_alternative: Boolean(row.is_alternative) || Boolean(opts.isSuggestedAlternative),
    is_suggested_alternative: Boolean(opts.isSuggestedAlternative),
    suggestion_source: opts.suggestionSource || null,
    default_qty: Number(row.default_qty || (isWeighted ? weightStep : 1)),
    sort_order: Number(row.sort_order || 0),
  };
}

function findAutoAlternatives(params: {
  ingredientName: string;
  excludeProductIds: string[];
  preferredCategoryIds: string[];
  preferredMasterIds: string[];
  limit?: number;
}): ReturnType<typeof serializeLinkedProduct>[] {
  const limit = params.limit ?? 3;
  const excludeSet = new Set(params.excludeProductIds);
  const found: RawProductJoin[] = [];

  const baseSelect = `
    SELECT
      p.id AS product_id,
      p.merchant_id,
      p.category_id,
      p.master_product_id,
      p.name_ar,
      p.name_en,
      p.image_url,
      p.base_price,
      p.sale_price,
      p.is_offer,
      p.stock_quantity,
      p.is_available,
      p.is_weighted,
      p.weight_step,
      p.weight_unit,
      p.size_label,
      p.brand,
      p.requires_prescription,
      m.business_name_ar AS merchant_name,
      m.is_open_now AS merchant_is_open,
      m.verification_status AS merchant_verification_status
    FROM products p
    INNER JOIN merchants m ON m.id = p.merchant_id
    WHERE p.is_available = 1
      AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
      AND m.verification_status IN ('approved', 'active')
  `;

  // 1. Same master product in other stores
  for (const masterId of params.preferredMasterIds) {
    if (!masterId || found.length >= limit) continue;
    const rows = db
      .prepare(`${baseSelect} AND p.master_product_id = ? ORDER BY COALESCE(m.is_open_now, 1) DESC, COALESCE(p.sale_price, p.base_price) ASC LIMIT 6`)
      .all(masterId) as RawProductJoin[];
    for (const r of rows) {
      if (!excludeSet.has(r.product_id) && found.length < limit) {
        excludeSet.add(r.product_id);
        found.push(r);
      }
    }
  }

  // 2. Same category + keyword token match
  if (found.length < limit) {
    const tokens = normalizeArabic(params.ingredientName)
      .split(' ')
      .filter((t) => t.length >= 2 && !['من', 'في', 'مع', 'علي', 'او', 'جم', 'كجم', 'مل', 'لتر', 'كبير', 'صغير', 'طازج', 'طازجه'].includes(t));

    if (tokens.length > 0) {
      const likeToken = `%${tokens[0]}%`;
      const rows = db
        .prepare(`${baseSelect} AND (p.name_ar LIKE ? OR p.brand LIKE ?) ORDER BY COALESCE(m.is_open_now, 1) DESC, p.purchase_count DESC, COALESCE(p.sale_price, p.base_price) ASC LIMIT 12`)
        .all(likeToken, likeToken) as RawProductJoin[];
      for (const r of rows) {
        if (!excludeSet.has(r.product_id) && found.length < limit) {
          excludeSet.add(r.product_id);
          found.push(r);
        }
      }
    }
  }

  // 3. Fallback: same category available items
  if (found.length < limit && params.preferredCategoryIds.length > 0) {
    for (const catId of params.preferredCategoryIds) {
      if (!catId || found.length >= limit) continue;
      const rows = db
        .prepare(`${baseSelect} AND p.category_id = ? ORDER BY COALESCE(m.is_open_now, 1) DESC, p.purchase_count DESC, COALESCE(p.sale_price, p.base_price) ASC LIMIT 6`)
        .all(catId) as RawProductJoin[];
      for (const r of rows) {
        if (!excludeSet.has(r.product_id) && found.length < limit) {
          excludeSet.add(r.product_id);
          found.push(r);
        }
      }
    }
  }

  return found.map((r) =>
    serializeLinkedProduct(r, {
      isSuggestedAlternative: true,
      suggestionSource: 'auto_match',
    })
  );
}

function initRecipesTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title_ar TEXT NOT NULL,
      description_ar TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT 'مطبخ اطلبها',
      category_ar TEXT NOT NULL DEFAULT 'وجبات رئيسية',
      image_url TEXT NOT NULL DEFAULT '',
      video_url TEXT NOT NULL DEFAULT '',
      prep_time_minutes INTEGER NOT NULL DEFAULT 30,
      servings INTEGER NOT NULL DEFAULT 4,
      difficulty_ar TEXT NOT NULL DEFAULT 'متوسط',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredient_groups (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      title_ar TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit_ar TEXT NOT NULL DEFAULT 'عبوة',
      notes_ar TEXT NOT NULL DEFAULT '',
      is_optional INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES recipe_ingredient_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredient_products (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      is_recommended INTEGER NOT NULL DEFAULT 0,
      is_alternative INTEGER NOT NULL DEFAULT 0,
      default_qty REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(ingredient_id, product_id),
      FOREIGN KEY (ingredient_id) REFERENCES recipe_ingredients(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipe_steps (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      instruction_ar TEXT NOT NULL,
      timer_seconds INTEGER NOT NULL DEFAULT 0,
      tip_ar TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_active_sort ON recipes(is_active, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_recipe_groups_recipe ON recipe_ingredient_groups(recipe_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_recipe_ing_group ON recipe_ingredients(recipe_id, group_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_recipe_ing_prod_ing ON recipe_ingredient_products(ingredient_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe ON recipe_steps(recipe_id, step_number);
  `);
}

function findRealProductByKeywords(keywords: string[], excludeIds: Set<string> = new Set()): string | null {
  for (const kw of keywords) {
    const rows = db
      .prepare(
        `SELECT p.id FROM products p
         INNER JOIN merchants m ON m.id = p.merchant_id
         WHERE p.is_available = 1
           AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
           AND m.verification_status IN ('approved', 'active')
           AND p.name_ar LIKE ?
         ORDER BY p.purchase_count DESC, COALESCE(p.sale_price, p.base_price) ASC
         LIMIT 5`
      )
      .all(`%${kw}%`) as Array<{ id: string }>;
    for (const r of rows) {
      if (!excludeIds.has(r.id)) {
        return r.id;
      }
    }
  }
  return null;
}

function seedInitialRecipes(): void {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM recipes').get() as { cnt: number };
  if (countRow && countRow.cnt > 0) return;

  const prodCount = db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE is_available = 1').get() as { cnt: number };
  if (!prodCount || prodCount.cnt === 0) return;

  const now = new Date().toISOString();

  type SeedIngredientDef = {
    name_ar: string;
    quantity: number;
    unit_ar: string;
    notes_ar?: string;
    is_optional?: boolean;
    primaryKeywords: string[];
    altKeywords?: string[];
    defaultQty?: number;
  };

  type SeedRecipeDef = {
    title_ar: string;
    description_ar: string;
    source_name: string;
    category_ar: string;
    image_url: string;
    prep_time_minutes: number;
    servings: number;
    difficulty_ar: string;
    groups: Array<{
      title_ar: string;
      ingredients: SeedIngredientDef[];
    }>;
    steps: Array<{
      title_ar: string;
      instruction_ar: string;
      timer_seconds: number;
      tip_ar?: string;
    }>;
  };

  const seeds: SeedRecipeDef[] = [
    {
      title_ar: 'مكرونة بالبشاميل واللحم المفروم',
      description_ar:
        'صينية مكرونة بشاميل مصرية أصلية بطبقات لحم مفروم متبّل وصوص بشاميل كريمي غني ووجه ذهبي مقرمش تكفي لمة العيلة.',
      source_name: 'مطبخ اطلبها',
      category_ar: 'وجبات رئيسية',
      image_url: '/recipe-assets/recipe_macarona_bechamel_1795866300342.jpg',
      prep_time_minutes: 50,
      servings: 6,
      difficulty_ar: 'متوسط',
      groups: [
        {
          title_ar: 'مكونات المكرونة والعصاج',
          ingredients: [
            {
              name_ar: 'مكرونة فرن قلم',
              quantity: 400,
              unit_ar: 'جرام',
              notes_ar: 'تسلق 3/4 سلقة فقط لتكمل تسويتها في الفرن',
              primaryKeywords: ['مكرونة فرن', 'ايطاليانو مكرونة', 'مكرونه'],
              altKeywords: ['الضحى مكرونه', 'مكرونة'],
              defaultQty: 1,
            },
            {
              name_ar: 'لحم مفروم بلدي',
              quantity: 0.5,
              unit_ar: 'كجم',
              notes_ar: 'مفروم قليل الدهن لعصاج غني بدون دهون زائدة',
              primaryKeywords: ['مفروم بدون دهن', 'لحم مفروم'],
              altKeywords: ['لحم مفروم ضانى', 'كفته لحمه'],
              defaultQty: 0.5,
            },
            {
              name_ar: 'زيت نباتي للتحمير',
              quantity: 2,
              unit_ar: 'ملعقة كبيرة',
              primaryKeywords: ['صني زيت عباد الشمس', 'هلا زيت عباد الشمس'],
              altKeywords: ['كريستال زيت ذرة', 'صني زيت'],
              defaultQty: 1,
            },
            {
              name_ar: 'ملح طعام ناعم',
              quantity: 1,
              unit_ar: 'ملعقة صغيرة',
              primaryKeywords: ['ملح رشه', 'ملح'],
              defaultQty: 1,
            },
          ],
        },
        {
          title_ar: 'مكونات صوص البشاميل الكريمي',
          ingredients: [
            {
              name_ar: 'حليب كامل الدسم',
              quantity: 1,
              unit_ar: 'لتر',
              notes_ar: 'يُفضل أن يكون باردًا عند إضافته للدقيق لمنع التكتل',
              primaryKeywords: ['حليب كامل الدسم', 'المراعى حليب', 'لبن'],
              defaultQty: 1,
            },
            {
              name_ar: 'كريمة طهي للغنى',
              quantity: 200,
              unit_ar: 'مل',
              notes_ar: 'تمنح الصوص قوامًا مخمليًا ولونًا ذهبيًا رائعًا',
              is_optional: true,
              primaryKeywords: ['كريمه طهي', 'كريمة طهي', 'قشطه بيضاء'],
              altKeywords: ['قشطه بيضاء'],
              defaultQty: 1,
            },
            {
              name_ar: 'دقيق أبيض فاخر',
              quantity: 4,
              unit_ar: 'ملاعق كبيرة',
              primaryKeywords: ['دوبيلا دقيق', 'دقيق'],
              defaultQty: 1,
            },
          ],
        },
      ],
      steps: [
        {
          title_ar: 'سلق المكرونة',
          instruction_ar: 'اغلي قدر ماء مملح وأضيفي المكرونة الفرن لمدة 8 دقائق حتى تصبح متماسكة (3/4 تسوية)، ثم صفّيها واتركي كوبًا من ماء السلق جانبًا.',
          timer_seconds: 480,
          tip_ar: 'لا تغسلي المكرونة بالماء البارد حتى يلتصق بها صوص البشاميل جيدًا.',
        },
        {
          title_ar: 'تحضير عصاج اللحم المفروم',
          instruction_ar: 'في طاسة ساخنة بها ملعقتان من الزيت، شوّحي اللحم المفروم مع الملح والفلفل حتى يتغير لونه وتجف سوائله تمامًا.',
          timer_seconds: 600,
          tip_ar: 'التقليب على نار عالية في البداية يحفظ عصارة اللحم داخله.',
        },
        {
          title_ar: 'تحضير صوص البشاميل',
          instruction_ar: 'شوّحي الدقيق في الزيت لمدة دقيقتين حتى تفوح رائحته دون أن يغمق، ثم أضيفي الحليب البارد تدريجيًا مع الخفق المستمر، وأضيفي كريمة الطهي حتى يثقل القوام.',
          timer_seconds: 420,
          tip_ar: 'استخدمي مضرب السلك اليدوي للحصول على بشاميل ناعم خالٍ من أي تكتلات.',
        },
        {
          title_ar: 'تجميع الصينية والخبز',
          instruction_ar: 'اخلطي نصف البشاميل مع المكرونة، وزّعي نصف الكمية في الصينية ثم طبقة اللحم المفروم ثم باقي المكرونة، وغطّي الوجه بباقي البشاميل وأدخليها فرنًا ساخنًا على 200° مئوية.',
          timer_seconds: 1500,
          tip_ar: 'اتركي الصينية ترتاح 10 دقائق بعد خروجها من الفرن لتقطيع قطع متماسكة.',
        },
      ],
    },
    {
      title_ar: 'كفتة مشوية بالطحينة والجرجير',
      description_ar:
        'سندوتشات ووجبة كفتة بلدي مشوية على الطريقة المصرية مع سلطة طحينة كريمية وجرجير طازج وبصل أخضر وعيش فينو.',
      source_name: 'شيف اطلبها',
      category_ar: 'مشويات',
      image_url: '/recipe-assets/recipe_grilled_kofta_1795866300292.jpg',
      prep_time_minutes: 30,
      servings: 4,
      difficulty_ar: 'سهل',
      groups: [
        {
          title_ar: 'مكونات الشوي والتقديم',
          ingredients: [
            {
              name_ar: 'كفتة لحم بلدي متبلة',
              quantity: 1,
              unit_ar: 'كجم',
              primaryKeywords: ['كفته لحمه بلدى', 'كفته'],
              altKeywords: ['مفروم بدون دهن', 'لحم مفروم'],
              defaultQty: 1,
            },
            {
              name_ar: 'عيش فينو طازج',
              quantity: 1,
              unit_ar: 'كيس',
              primaryKeywords: ['فينو وليد', 'فينو'],
              defaultQty: 1,
            },
            {
              name_ar: 'جرجير بلدي طازج',
              quantity: 2,
              unit_ar: 'حزمة',
              primaryKeywords: ['جرجير'],
              defaultQty: 0.5,
            },
            {
              name_ar: 'بصل أخضر طازج',
              quantity: 1,
              unit_ar: 'حزمة',
              primaryKeywords: ['بصل اخصر', 'بصل أخضر', 'بصل'],
              defaultQty: 0.5,
            },
          ],
        },
        {
          title_ar: 'مكونات سلطة الطحينة والتتبيل',
          ingredients: [
            {
              name_ar: 'طحينة سمسم أصلية',
              quantity: 150,
              unit_ar: 'جرام',
              primaryKeywords: ['طحينه الرشيدى', 'طحينه'],
              altKeywords: ['طحينه بيضاء'],
              defaultQty: 1,
            },
            {
              name_ar: 'دبس رمان للتلميع والتقديم',
              quantity: 2,
              unit_ar: 'ملعقة كبيرة',
              is_optional: true,
              primaryKeywords: ['دبس رمان'],
              defaultQty: 1,
            },
          ],
        },
      ],
      steps: [
        {
          title_ar: 'تسخين الشواية وتجهيز الكفتة',
          instruction_ar: 'سخّني الجريل أو الفرن على درجة حرارة عالية مع مسحة زيت خفيفة، وشكّلي الكفتة على أسياخ خشبية أو أصابع متساوية.',
          timer_seconds: 300,
        },
        {
          title_ar: 'شوي الكفتة حتى تتحمر',
          instruction_ar: 'اشوي الكفتة مع التقليب كل 3 دقائق حتى تأخذ لونًا ذهبيًا شهيًا وتنضج من الداخل مع احتفاظها بالعصارة.',
          timer_seconds: 900,
          tip_ar: 'ادهني الكفتة بلمسة دبس رمان في آخر دقيقتين لنكهة مطاعم فاخرة.',
        },
        {
          title_ar: 'تحضير سلطة الطحينة والتقديم',
          instruction_ar: 'اخفقي الطحينة مع ماء دافئ ورشة ملح وليمون حتى تصبح كريمية، وقدّمي الكفتة ساخنة فوق الجرجير والبصل الأخضر مع الفينو.',
          timer_seconds: 180,
        },
      ],
    },
    {
      title_ar: 'فطار صحي بالشوفان والزبادي اليوناني والعسل',
      description_ar:
        'وعاء فطار متكامل غني بالبروتين والألياف من الزبادي اليوناني والشوفان الكامل وعسل النحل الطبيعي ومكعبات الكنتالوب الطازجة بجانب فنجان قهوة فرنساوي.',
      source_name: 'مطبخ اطلبها الصحي',
      category_ar: 'فطار صحي',
      image_url: '/recipe-assets/recipe_oats_honey_bowl_1795866302485.jpg',
      prep_time_minutes: 10,
      servings: 2,
      difficulty_ar: 'سهل',
      groups: [
        {
          title_ar: 'مكونات وعاء الفطار',
          ingredients: [
            {
              name_ar: 'شوفان حبة كاملة',
              quantity: 100,
              unit_ar: 'جرام',
              primaryKeywords: ['شوفان طبيعى', 'شوفان'],
              altKeywords: ['سانتي كرانشي'],
              defaultQty: 1,
            },
            {
              name_ar: 'زبادي يوناني كريمي',
              quantity: 2,
              unit_ar: 'كوب',
              primaryKeywords: ['زبادى يونان', 'زبادي يوناني'],
              altKeywords: ['اكتفيا زبادى', 'جهينه زبادي'],
              defaultQty: 2,
            },
            {
              name_ar: 'عسل نحل طبيعي',
              quantity: 2,
              unit_ar: 'ملعقة كبيرة',
              primaryKeywords: ['امتنان عسل', 'عسل نوارة'],
              altKeywords: ['الشفاء عسل نحل', 'عسل'],
              defaultQty: 1,
            },
            {
              name_ar: 'كنتالوب طازج مقطع مكعبات',
              quantity: 0.5,
              unit_ar: 'كجم',
              primaryKeywords: ['كنتالوب'],
              altKeywords: ['اناناس'],
              defaultQty: 0.5,
            },
          ],
        },
        {
          title_ar: 'قهوة الصباح',
          ingredients: [
            {
              name_ar: 'بن فرنساوي فاخر',
              quantity: 2,
              unit_ar: 'ملعقة صغيرة',
              is_optional: true,
              primaryKeywords: ['بن ابو عوف فرنساوي', 'بن ابو عوف'],
              altKeywords: ['ابو همدان بن'],
              defaultQty: 1,
            },
            {
              name_ar: 'حليب كامل الدسم للقهوة',
              quantity: 250,
              unit_ar: 'مل',
              is_optional: true,
              primaryKeywords: ['المراعى حليب', 'حليب كامل الدسم'],
              defaultQty: 1,
            },
          ],
        },
      ],
      steps: [
        {
          title_ar: 'تجهيز قاعدة الزبادي والشوفان',
          instruction_ar: 'وزّعي الزبادي اليوناني في وعاء التقديم وأضيفي فوقه الشوفان الكامل، ويمكن نقع الشوفان في ملعقتين حليب دافئ لدقيقتين لقوام أطري.',
          timer_seconds: 120,
        },
        {
          title_ar: 'إضافة الفاكهة وعسل النحل',
          instruction_ar: 'قطّعي الكنتالوب مكعبات متساوية ورصّيها فوق الشوفان ثم اسكبي خيوط العسل الطبيعي على الوجه.',
          timer_seconds: 0,
        },
        {
          title_ar: 'تحضير القهوة الفرنساوي',
          instruction_ar: 'قلّبي ملعقتين من البن الفرنساوي مع الحليب البارد على نار هادئة لمدة 3 دقائق حتى ترتفع الرغوة وقدّميها فورًا بجانب الوعاء.',
          timer_seconds: 180,
          tip_ar: 'النار الهادئة تصنع وشًّا غنيًا وتمنع احتراق البن.',
        },
      ],
    },
    {
      title_ar: 'سلطة تونة دايت بالخضار والمستردة',
      description_ar:
        'وجبة غداء أو عشاء خفيفة ومشبعة من التونة القطع مع الجرجير والبصل الأخضر وجبنة الفيتا اللايت وتتبيلة المستردة المنعشة في 10 دقائق.',
      source_name: 'مطبخ اطلبها السريع',
      category_ar: 'سلطات وسريع',
      image_url: '/recipe-assets/recipe_tuna_salad_bowl_1795866300939.jpg',
      prep_time_minutes: 10,
      servings: 2,
      difficulty_ar: 'سهل',
      groups: [
        {
          title_ar: 'المكونات الأساسية',
          ingredients: [
            {
              name_ar: 'تونة قطع فاخرة',
              quantity: 2,
              unit_ar: 'علبة',
              primaryKeywords: ['صن شاين قطع', 'تونه'],
              altKeywords: ['تونه دولفين', 'صن شاين اكسبريس'],
              defaultQty: 2,
            },
            {
              name_ar: 'جبنة فيتا لايت',
              quantity: 100,
              unit_ar: 'جرام',
              primaryKeywords: ['دومتى جبن فيتا لايت', 'جبن فيتا'],
              altKeywords: ['عبور لاند جبنا فيتا', 'دومتي جبنة فيتا'],
              defaultQty: 1,
            },
            {
              name_ar: 'جرجير طازج',
              quantity: 1,
              unit_ar: 'حزمة',
              primaryKeywords: ['جرجير'],
              defaultQty: 0.25,
            },
            {
              name_ar: 'بصل أخضر مقطع شرائح',
              quantity: 2,
              unit_ar: 'عود',
              primaryKeywords: ['بصل اخصر', 'بصل'],
              defaultQty: 0.25,
            },
          ],
        },
        {
          title_ar: 'تتبيلة المستردة',
          ingredients: [
            {
              name_ar: 'مستردة هاينز',
              quantity: 1,
              unit_ar: 'ملعقة كبيرة',
              primaryKeywords: ['هاينز مسترده', 'مسترده'],
              defaultQty: 1,
            },
            {
              name_ar: 'زيت نباتي خفيف',
              quantity: 1,
              unit_ar: 'ملعقة كبيرة',
              primaryKeywords: ['هلا زيت عباد الشمس', 'صني زيت 750'],
              altKeywords: ['كريستال زيت ذرة'],
              defaultQty: 1,
            },
          ],
        },
      ],
      steps: [
        {
          title_ar: 'تجهيز الخضار وتصفية التونة',
          instruction_ar: 'اغسلي أوراق الجرجير وجففيها جيدًا، قطّعي البصل الأخضر شرائح رفيعة، وصفّي علب التونة من الزيت الزائد.',
          timer_seconds: 180,
        },
        {
          title_ar: 'خلط تتبيلة المستردة',
          instruction_ar: 'في كوب صغير اخفقي ملعقة المستردة مع ملعقة الزيت ورشة ملح وليمون حتى تحصلي على صوص متجانس.',
          timer_seconds: 60,
        },
        {
          title_ar: 'التجميع والتقديم',
          instruction_ar: 'ضعي الجرجير والبصل في طبق التقديم ثم وزّعي قطع التونة ومكعبات جبنة الفيتا، واسكبي صوص المستردة قبل التقديم مباشرة.',
          timer_seconds: 0,
        },
      ],
    },
  ];

  const tx = db.transaction(() => {
    seeds.forEach((seed, rIdx) => {
      const recipeId = uid('rcp');
      db.prepare(
        `INSERT INTO recipes (
          id, title_ar, description_ar, source_name, category_ar,
          image_url, video_url, prep_time_minutes, servings, difficulty_ar,
          is_active, sort_order, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1, ?, 'system_seed', ?, ?)`
      ).run(
        recipeId,
        seed.title_ar,
        seed.description_ar,
        seed.source_name,
        seed.category_ar,
        seed.image_url,
        seed.prep_time_minutes,
        seed.servings,
        seed.difficulty_ar,
        rIdx,
        now,
        now
      );

      seed.groups.forEach((grp, gIdx) => {
        const groupId = uid('rgp');
        db.prepare(
          'INSERT INTO recipe_ingredient_groups (id, recipe_id, title_ar, sort_order) VALUES (?, ?, ?, ?)'
        ).run(groupId, recipeId, grp.title_ar, gIdx);

        grp.ingredients.forEach((ing, iIdx) => {
          const ingId = uid('rig');
          db.prepare(
            `INSERT INTO recipe_ingredients (
              id, recipe_id, group_id, name_ar, quantity, unit_ar, notes_ar, is_optional, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            ingId,
            recipeId,
            groupId,
            ing.name_ar,
            ing.quantity,
            ing.unit_ar,
            ing.notes_ar || '',
            ing.is_optional ? 1 : 0,
            iIdx
          );

          const usedProds = new Set<string>();
          const primaryId = findRealProductByKeywords(ing.primaryKeywords, usedProds);
          if (primaryId) {
            usedProds.add(primaryId);
            db.prepare(
              `INSERT OR IGNORE INTO recipe_ingredient_products (
                id, ingredient_id, product_id, is_recommended, is_alternative, default_qty, sort_order
              ) VALUES (?, ?, ?, 1, 0, ?, 0)`
            ).run(uid('rip'), ingId, primaryId, ing.defaultQty ?? 1);
          }

          if (ing.altKeywords && ing.altKeywords.length > 0) {
            const altId = findRealProductByKeywords(ing.altKeywords, usedProds);
            if (altId) {
              usedProds.add(altId);
              db.prepare(
                `INSERT OR IGNORE INTO recipe_ingredient_products (
                  id, ingredient_id, product_id, is_recommended, is_alternative, default_qty, sort_order
                ) VALUES (?, ?, ?, 0, 1, ?, 1)`
              ).run(uid('rip'), ingId, altId, ing.defaultQty ?? 1);
            }
          }
        });
      });

      seed.steps.forEach((st, sIdx) => {
        db.prepare(
          `INSERT INTO recipe_steps (
            id, recipe_id, step_number, title_ar, instruction_ar, timer_seconds, tip_ar
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(uid('rst'), recipeId, sIdx + 1, st.title_ar, st.instruction_ar, st.timer_seconds || 0, st.tip_ar || '');
      });
    });
  });

  tx();
}

function hydrateRecipeDetail(recipeRow: Record<string, any>, includeHiddenCheck = false) {
  const recipeId = String(recipeRow.id);

  const groups = db
    .prepare('SELECT * FROM recipe_ingredient_groups WHERE recipe_id = ? ORDER BY sort_order ASC, id ASC')
    .all(recipeId) as Array<Record<string, any>>;

  const ingredients = db
    .prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order ASC, id ASC')
    .all(recipeId) as Array<Record<string, any>>;

  const steps = db
    .prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY step_number ASC, id ASC')
    .all(recipeId) as Array<Record<string, any>>;

  const linkedRows = db
    .prepare(
      `SELECT
         rip.id AS link_id,
         rip.ingredient_id,
         rip.product_id,
         rip.is_recommended,
         rip.is_alternative,
         rip.default_qty,
         rip.sort_order,
         p.merchant_id,
         p.category_id,
         p.master_product_id,
         p.name_ar,
         p.name_en,
         p.image_url,
         p.base_price,
         p.sale_price,
         p.is_offer,
         p.stock_quantity,
         p.is_available,
         p.is_weighted,
         p.weight_step,
         p.weight_unit,
         p.size_label,
         p.brand,
         p.requires_prescription,
         m.business_name_ar AS merchant_name,
         m.is_open_now AS merchant_is_open,
         m.verification_status AS merchant_verification_status
       FROM recipe_ingredient_products rip
       INNER JOIN recipe_ingredients ri ON ri.id = rip.ingredient_id
       INNER JOIN products p ON p.id = rip.product_id
       LEFT JOIN merchants m ON m.id = p.merchant_id
       WHERE ri.recipe_id = ?
       ORDER BY rip.is_recommended DESC, rip.is_alternative ASC, rip.sort_order ASC`
    )
    .all(recipeId) as Array<RawProductJoin & { ingredient_id: string }>;

  const linksByIng = new Map<string, Array<RawProductJoin & { ingredient_id: string }>>();
  for (const r of linkedRows) {
    const arr = linksByIng.get(r.ingredient_id) || [];
    arr.push(r);
    linksByIng.set(r.ingredient_id, arr);
  }

  let totalBuyableIngredients = 0;
  let estimatedTotal = 0;
  const distinctStores = new Set<string>();

  const hydratedGroups = groups.map((g) => {
    const groupIngs = ingredients
      .filter((i) => i.group_id === g.id)
      .map((ing) => {
        const rawLinks = linksByIng.get(String(ing.id)) || [];
        const serializedLinks = rawLinks.map((rl) =>
          serializeLinkedProduct(rl, {
            isSuggestedAlternative: Boolean(rl.is_alternative),
            suggestionSource: rl.is_alternative ? 'admin' : null,
          })
        );

        const primaryOptions = serializedLinks.filter((p) => !p.is_alternative);
        const adminAltOptions = serializedLinks.filter((p) => p.is_alternative);

        const hasAvailablePrimary = primaryOptions.some((p) => p.is_available);
        const availableAdminAlts = adminAltOptions.filter((p) => p.is_available);

        let suggestedAlternatives: ReturnType<typeof serializeLinkedProduct>[] = [];
        if (!hasAvailablePrimary) {
          if (availableAdminAlts.length > 0) {
            suggestedAlternatives = availableAdminAlts.map((a) => ({
              ...a,
              is_suggested_alternative: true,
              suggestion_source: 'admin' as const,
            }));
          } else if (!includeHiddenCheck) {
            suggestedAlternatives = findAutoAlternatives({
              ingredientName: String(ing.name_ar || ''),
              excludeProductIds: rawLinks.map((r) => r.product_id),
              preferredCategoryIds: Array.from(new Set(rawLinks.map((r) => r.category_id || '').filter(Boolean))),
              preferredMasterIds: Array.from(new Set(rawLinks.map((r) => r.master_product_id || '').filter(Boolean))),
              limit: 3,
            });
          }
        }

        // Combined list for customer selection
        const allOptions = [
          ...primaryOptions,
          ...adminAltOptions,
          ...suggestedAlternatives.filter((sa) => !serializedLinks.some((sl) => sl.product_id === sa.product_id)),
        ];

        // Pick default active option: recommended & available -> first available primary -> first available alternative
        const defaultSelected =
          allOptions.find((p) => p.is_recommended && p.is_available) ||
          primaryOptions.find((p) => p.is_available) ||
          allOptions.find((p) => p.is_available) ||
          null;

        if (defaultSelected) {
          totalBuyableIngredients += 1;
          estimatedTotal += defaultSelected.effective_price * defaultSelected.default_qty;
          distinctStores.add(defaultSelected.merchant_id);
        }

        return {
          id: String(ing.id),
          group_id: String(ing.group_id),
          name_ar: String(ing.name_ar),
          quantity: Number(ing.quantity || 1),
          unit_ar: String(ing.unit_ar || ''),
          notes_ar: String(ing.notes_ar || ''),
          is_optional: Boolean(ing.is_optional),
          sort_order: Number(ing.sort_order || 0),
          primary_unavailable: primaryOptions.length > 0 && !hasAvailablePrimary,
          default_product_id: defaultSelected ? defaultSelected.product_id : null,
          products: allOptions,
          suggested_alternatives: suggestedAlternatives,
        };
      });

    return {
      id: String(g.id),
      title_ar: String(g.title_ar),
      sort_order: Number(g.sort_order || 0),
      ingredients: groupIngs,
    };
  });

  return {
    id: recipeId,
    title_ar: String(recipeRow.title_ar),
    description_ar: String(recipeRow.description_ar || ''),
    source_name: String(recipeRow.source_name || 'مطبخ اطلبها'),
    category_ar: String(recipeRow.category_ar || 'وجبات رئيسية'),
    image_url: String(recipeRow.image_url || ''),
    video_url: String(recipeRow.video_url || ''),
    prep_time_minutes: Number(recipeRow.prep_time_minutes || 30),
    servings: Number(recipeRow.servings || 4),
    difficulty_ar: String(recipeRow.difficulty_ar || 'متوسط'),
    is_active: Boolean(recipeRow.is_active),
    sort_order: Number(recipeRow.sort_order || 0),
    created_at: String(recipeRow.created_at || ''),
    updated_at: String(recipeRow.updated_at || ''),
    ingredients_count: ingredients.length,
    products_count: totalBuyableIngredients,
    stores_count: distinctStores.size,
    steps_count: steps.length,
    estimated_total: Math.round(estimatedTotal * 100) / 100,
    groups: hydratedGroups,
    steps: steps.map((s) => ({
      id: String(s.id),
      step_number: Number(s.step_number || 1),
      title_ar: String(s.title_ar || ''),
      instruction_ar: String(s.instruction_ar || ''),
      timer_seconds: Number(s.timer_seconds || 0),
      tip_ar: String(s.tip_ar || ''),
    })),
  };
}

function summarizeRecipeRow(recipeRow: Record<string, any>) {
  const hydrated = hydrateRecipeDetail(recipeRow, true);
  return {
    id: hydrated.id,
    title_ar: hydrated.title_ar,
    description_ar: hydrated.description_ar,
    source_name: hydrated.source_name,
    category_ar: hydrated.category_ar,
    image_url: hydrated.image_url,
    video_url: hydrated.video_url,
    prep_time_minutes: hydrated.prep_time_minutes,
    servings: hydrated.servings,
    difficulty_ar: hydrated.difficulty_ar,
    is_active: hydrated.is_active,
    sort_order: hydrated.sort_order,
    ingredients_count: hydrated.ingredients_count,
    products_count: hydrated.products_count,
    stores_count: hydrated.stores_count,
    steps_count: hydrated.steps_count,
    estimated_total: hydrated.estimated_total,
    created_at: hydrated.created_at,
    updated_at: hydrated.updated_at,
  };
}

type UpsertRecipeBody = {
  title_ar?: string;
  description_ar?: string;
  source_name?: string;
  category_ar?: string;
  image_url?: string;
  video_url?: string;
  prep_time_minutes?: number;
  servings?: number;
  difficulty_ar?: string;
  is_active?: boolean;
  sort_order?: number;
  groups?: Array<{
    title_ar: string;
    ingredients: Array<{
      name_ar: string;
      quantity?: number;
      unit_ar?: string;
      notes_ar?: string;
      is_optional?: boolean;
      products?: Array<{
        product_id: string;
        is_recommended?: boolean;
        is_alternative?: boolean;
        default_qty?: number;
      }>;
    }>;
  }>;
  steps?: Array<{
    title_ar?: string;
    instruction_ar: string;
    timer_seconds?: number;
    tip_ar?: string;
  }>;
};

function validateAndPersistRecipeContent(recipeId: string, body: UpsertRecipeBody): void {
  const groups = Array.isArray(body.groups) ? body.groups : [];
  const steps = Array.isArray(body.steps) ? body.steps : [];

  // Validate that all referenced product_ids actually exist in products (zero fake products)
  const referencedIds = new Set<string>();
  for (const g of groups) {
    for (const ing of Array.isArray(g.ingredients) ? g.ingredients : []) {
      for (const p of Array.isArray(ing.products) ? ing.products : []) {
        const pid = String(p.product_id || '').trim();
        if (pid) referencedIds.add(pid);
      }
    }
  }

  const existingProductIds = new Set<string>();
  if (referencedIds.size > 0) {
    const idsArr = Array.from(referencedIds);
    const placeholders = idsArr.map(() => '?').join(',');
    const found = db.prepare(`SELECT id FROM products WHERE id IN (${placeholders})`).all(...idsArr) as Array<{ id: string }>;
    for (const r of found) existingProductIds.add(r.id);
    const missing = idsArr.filter((id) => !existingProductIds.has(id));
    if (missing.length > 0) {
      throw new Error(`منتجات غير موجودة في قاعدة بيانات اطلبها: ${missing.join(', ')}`);
    }
  }

  // Clear old child rows for update
  db.prepare('DELETE FROM recipe_ingredient_groups WHERE recipe_id = ?').run(recipeId);
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
  db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(recipeId);

  groups.forEach((grp, gIdx) => {
    const grpTitle = String(grp.title_ar || '').trim() || `المجموعة ${gIdx + 1}`;
    const groupId = uid('rgp');
    db.prepare(
      'INSERT INTO recipe_ingredient_groups (id, recipe_id, title_ar, sort_order) VALUES (?, ?, ?, ?)'
    ).run(groupId, recipeId, grpTitle, gIdx);

    const ings = Array.isArray(grp.ingredients) ? grp.ingredients : [];
    ings.forEach((ing, iIdx) => {
      const ingName = String(ing.name_ar || '').trim();
      if (!ingName) return;
      const ingId = uid('rig');
      db.prepare(
        `INSERT INTO recipe_ingredients (
          id, recipe_id, group_id, name_ar, quantity, unit_ar, notes_ar, is_optional, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ingId,
        recipeId,
        groupId,
        ingName,
        Math.max(0.05, Number(ing.quantity || 1)),
        String(ing.unit_ar || 'عبوة').trim(),
        String(ing.notes_ar || '').trim(),
        ing.is_optional ? 1 : 0,
        iIdx
      );

      const prods = Array.isArray(ing.products) ? ing.products : [];
      const seenProds = new Set<string>();
      prods.forEach((p, pIdx) => {
        const pid = String(p.product_id || '').trim();
        if (!pid || seenProds.has(pid) || !existingProductIds.has(pid)) return;
        seenProds.add(pid);
        db.prepare(
          `INSERT INTO recipe_ingredient_products (
            id, ingredient_id, product_id, is_recommended, is_alternative, default_qty, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uid('rip'),
          ingId,
          pid,
          p.is_recommended ? 1 : 0,
          p.is_alternative ? 1 : 0,
          Math.max(0.1, Number(p.default_qty || 1)),
          pIdx
        );
      });
    });
  });

  steps.forEach((st, sIdx) => {
    const inst = String(st.instruction_ar || '').trim();
    if (!inst) return;
    db.prepare(
      `INSERT INTO recipe_steps (
        id, recipe_id, step_number, title_ar, instruction_ar, timer_seconds, tip_ar
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid('rst'),
      recipeId,
      sIdx + 1,
      String(st.title_ar || '').trim() || `الخطوة ${sIdx + 1}`,
      inst,
      Math.max(0, Math.round(Number(st.timer_seconds || 0))),
      String(st.tip_ar || '').trim()
    );
  });
}

export function registerRecipesRoutes(app: Express): void {
  initRecipesTables();
  seedInitialRecipes();

  // ======================== CUSTOMER / PUBLIC ENDPOINTS ========================

  app.get('/api/recipes', (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim();
      const category = String(req.query.category || '').trim();

      const rows = db
        .prepare('SELECT * FROM recipes WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC')
        .all() as Array<Record<string, any>>;

      const normQ = normalizeArabic(q);
      const categoriesSet = new Set<string>();
      for (const r of rows) {
        if (r.category_ar) categoriesSet.add(String(r.category_ar));
      }

      const filtered = rows.filter((r) => {
        if (category && category !== 'all' && String(r.category_ar) !== category) return false;
        if (normQ) {
          const hay = normalizeArabic(`${r.title_ar} ${r.description_ar} ${r.source_name} ${r.category_ar}`);
          if (!hay.includes(normQ)) return false;
        }
        return true;
      });

      res.json({
        recipes: filtered.map(summarizeRecipeRow),
        categories: Array.from(categoriesSet),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل الوصفات' });
    }
  });

  app.get('/api/recipes/:id', (req: Request, res: Response) => {
    try {
      const row = db
        .prepare('SELECT * FROM recipes WHERE id = ? AND is_active = 1')
        .get(String(req.params.id)) as Record<string, any> | undefined;
      if (!row) {
        return res.status(404).json({ error: 'الوصفة غير موجودة أو غير متاحة حاليًا' });
      }
      res.json({ recipe: hydrateRecipeDetail(row, false) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل تفاصيل الوصفة' });
    }
  });

  // ======================== ADMIN CMS ENDPOINTS ========================

  app.get('/api/admin/recipes/catalog/search', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim();
      const merchantId = String(req.query.merchant_id || '').trim();
      const limit = Math.min(40, Math.max(5, Number(req.query.limit || 24)));

      const conditions: string[] = ["m.verification_status IN ('approved', 'active')"];
      const params: unknown[] = [];

      if (merchantId) {
        conditions.push('p.merchant_id = ?');
        params.push(merchantId);
      }
      if (q) {
        conditions.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.brand LIKE ? OR m.business_name_ar LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }

      const rows = db
        .prepare(
          `SELECT
             p.id AS product_id,
             p.merchant_id,
             p.category_id,
             p.master_product_id,
             p.name_ar,
             p.name_en,
             p.image_url,
             p.base_price,
             p.sale_price,
             p.is_offer,
             p.stock_quantity,
             p.is_available,
             p.is_weighted,
             p.weight_step,
             p.weight_unit,
             p.size_label,
             p.brand,
             p.requires_prescription,
             m.business_name_ar AS merchant_name,
             m.is_open_now AS merchant_is_open,
             m.verification_status AS merchant_verification_status
           FROM products p
           INNER JOIN merchants m ON m.id = p.merchant_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY p.is_available DESC, p.purchase_count DESC, p.name_ar ASC
           LIMIT ?`
        )
        .all(...params, limit) as RawProductJoin[];

      res.json({
        products: rows.map((r) => serializeLinkedProduct(r)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر البحث في منتجات المنصة' });
    }
  });

  app.get('/api/admin/recipes', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const rows = db
        .prepare('SELECT * FROM recipes ORDER BY sort_order ASC, created_at DESC')
        .all() as Array<Record<string, any>>;
      res.json({ recipes: rows.map(summarizeRecipeRow) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل قائمة الوصفات' });
    }
  });

  app.get('/api/admin/recipes/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const row = db
        .prepare('SELECT * FROM recipes WHERE id = ?')
        .get(String(req.params.id)) as Record<string, any> | undefined;
      if (!row) {
        return res.status(404).json({ error: 'الوصفة غير موجودة' });
      }
      res.json({ recipe: hydrateRecipeDetail(row, true) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحميل الوصفة للتعديل' });
    }
  });

  app.post('/api/admin/recipes', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const auth = (req as Request & { auth?: AuthContext }).auth;
      const body = (req.body || {}) as UpsertRecipeBody;
      const title = String(body.title_ar || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'اسم الوصفة مطلوب' });
      }

      const recipeId = uid('rcp');
      const now = new Date().toISOString();

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO recipes (
            id, title_ar, description_ar, source_name, category_ar,
            image_url, video_url, prep_time_minutes, servings, difficulty_ar,
            is_active, sort_order, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          recipeId,
          title,
          String(body.description_ar || '').trim(),
          String(body.source_name || 'مطبخ اطلبها').trim() || 'مطبخ اطلبها',
          String(body.category_ar || 'وجبات رئيسية').trim() || 'وجبات رئيسية',
          String(body.image_url || '').trim(),
          String(body.video_url || '').trim(),
          Math.max(1, Math.round(Number(body.prep_time_minutes || 30))),
          Math.max(1, Math.round(Number(body.servings || 4))),
          String(body.difficulty_ar || 'متوسط').trim() || 'متوسط',
          body.is_active === false ? 0 : 1,
          Number(body.sort_order || 0),
          auth?.id || 'admin',
          now,
          now
        );

        validateAndPersistRecipeContent(recipeId, body);
      });

      tx();

      recordAuditLog({
        actor_name: auth?.id || 'admin',
        actor_role: auth?.role || 'admin',
        action: 'RECIPE_CREATED',
        entity_type: 'recipes',
        entity_id: recipeId,
        details: `إنشاء وصفة جديدة: ${title}`,
      });

      const created = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<string, any>;
      res.status(201).json({ ok: true, recipe: hydrateRecipeDetail(created, true) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'تعذر حفظ الوصفة' });
    }
  });

  app.put('/api/admin/recipes/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const auth = (req as Request & { auth?: AuthContext }).auth;
      const recipeId = String(req.params.id);
      const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<string, any> | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'الوصفة غير موجودة' });
      }

      const body = (req.body || {}) as UpsertRecipeBody;
      const title = String(body.title_ar ?? existing.title_ar).trim();
      if (!title) {
        return res.status(400).json({ error: 'اسم الوصفة مطلوب' });
      }

      const now = new Date().toISOString();

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE recipes SET
            title_ar = ?,
            description_ar = ?,
            source_name = ?,
            category_ar = ?,
            image_url = ?,
            video_url = ?,
            prep_time_minutes = ?,
            servings = ?,
            difficulty_ar = ?,
            is_active = ?,
            sort_order = ?,
            updated_at = ?
          WHERE id = ?`
        ).run(
          title,
          String(body.description_ar ?? existing.description_ar).trim(),
          String(body.source_name ?? existing.source_name).trim() || 'مطبخ اطلبها',
          String(body.category_ar ?? existing.category_ar).trim() || 'وجبات رئيسية',
          String(body.image_url ?? existing.image_url).trim(),
          String(body.video_url ?? existing.video_url).trim(),
          Math.max(1, Math.round(Number(body.prep_time_minutes ?? existing.prep_time_minutes ?? 30))),
          Math.max(1, Math.round(Number(body.servings ?? existing.servings ?? 4))),
          String(body.difficulty_ar ?? existing.difficulty_ar ?? 'متوسط').trim(),
          body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(existing.is_active),
          body.sort_order !== undefined ? Number(body.sort_order) : Number(existing.sort_order || 0),
          now,
          recipeId
        );

        if (body.groups !== undefined || body.steps !== undefined) {
          validateAndPersistRecipeContent(recipeId, body);
        }
      });

      tx();

      recordAuditLog({
        actor_name: auth?.id || 'admin',
        actor_role: auth?.role || 'admin',
        action: 'RECIPE_UPDATED',
        entity_type: 'recipes',
        entity_id: recipeId,
        details: `تعديل الوصفة: ${title}`,
      });

      const updated = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<string, any>;
      res.json({ ok: true, recipe: hydrateRecipeDetail(updated, true) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'تعذر تحديث الوصفة' });
    }
  });

  app.patch('/api/admin/recipes/:id/toggle', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const auth = (req as Request & { auth?: AuthContext }).auth;
      const recipeId = String(req.params.id);
      const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<string, any> | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'الوصفة غير موجودة' });
      }
      const nextActive =
        req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active ? 0 : 1;
      const now = new Date().toISOString();
      db.prepare('UPDATE recipes SET is_active = ?, updated_at = ? WHERE id = ?').run(nextActive, now, recipeId);

      recordAuditLog({
        actor_name: auth?.id || 'admin',
        actor_role: auth?.role || 'admin',
        action: nextActive ? 'RECIPE_ACTIVATED' : 'RECIPE_HIDDEN',
        entity_type: 'recipes',
        entity_id: recipeId,
        details: `${nextActive ? 'تفعيل' : 'إخفاء'} الوصفة: ${String(existing.title_ar)}`,
      });

      res.json({ ok: true, id: recipeId, is_active: Boolean(nextActive) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر تحديث حالة الوصفة' });
    }
  });

  app.delete('/api/admin/recipes/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    try {
      const auth = (req as Request & { auth?: AuthContext }).auth;
      const recipeId = String(req.params.id);
      const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<string, any> | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'الوصفة غير موجودة' });
      }

      const tx = db.transaction(() => {
        db.prepare(
          'DELETE FROM recipe_ingredient_products WHERE ingredient_id IN (SELECT id FROM recipe_ingredients WHERE recipe_id = ?)'
        ).run(recipeId);
        db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
        db.prepare('DELETE FROM recipe_ingredient_groups WHERE recipe_id = ?').run(recipeId);
        db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(recipeId);
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
      });
      tx();

      recordAuditLog({
        actor_name: auth?.id || 'admin',
        actor_role: auth?.role || 'admin',
        action: 'RECIPE_DELETED',
        entity_type: 'recipes',
        entity_id: recipeId,
        details: `حذف الوصفة: ${String(existing.title_ar)}`,
      });

      res.json({ ok: true, id: recipeId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'تعذر حذف الوصفة' });
    }
  });
}
