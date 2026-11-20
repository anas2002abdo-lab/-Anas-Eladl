import assert from 'node:assert/strict';
import fs from 'node:fs';

// Isolate test database completely from production otlobha.db
const TEST_DB = '/tmp/otlobha_master_catalog_test.db';
for (const p of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.env.OTLOBHA_DB_PATH = TEST_DB;
process.env.OTLOBHA_SQLITE_JOURNAL_MODE = 'DELETE';

const { db, initDatabase } = await import('../src/server/db.ts');
const {
  createMasterProductRecord,
  matchMasterProducts,
  linkMerchantListingToMaster,
  submitMerchantProductRequestRecord,
  reviewMerchantProductRequestRecord,
  getStorefrontProductDetailsData,
  bulkImportMasterProductsFromExcel,
  compareExcelRowsAgainstMasterCatalog,
} = await import('../src/server/masterCatalog.ts');
const {
  parseCategoryHierarchyPath,
  formatCategoryExcelPath,
  getCategoryAndDescendantIds,
} = await import('../src/server/categoryHierarchy.ts');

initDatabase();

// Create two isolated test merchants: متجر الأهرام & متجر النخبة
db.prepare(`
  INSERT INTO merchants (
    id, email, password_hash, business_name_ar, business_name_en, merchant_type,
    branch_name, zone_name, phone, verification_status, is_open_now
  ) VALUES
    ('mer_test_ahram', 'ahram@test.local', 'x', 'متجر الأهرام', 'Al-Ahram Store', 'grocery', 'الفرع الرئيسي', 'وسط مدينة المنزلة', '01011111111', 'approved', 1),
    ('mer_test_nokhba', 'nokhba@test.local', 'x', 'متجر النخبة', 'Al-Nokhba Store', 'grocery', 'الفرع الرئيسي', 'وسط مدينة المنزلة', '01022222222', 'approved', 1)
`).run();

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✅ [PASS ${passed}/10] ${name}`);
}

let master200Id = '';
let ahramListingId = '';
let nokhbaListingId = '';

// Test 1: إضافة منتج "نسكافيه 200 جرام" من متجر الأهرام بسعر 32
test('1. إضافة "نسكافيه 200 جرام" في متجر الأهرام بسعر 32 ج.م', () => {
  const created = createMasterProductRecord({
    canonical_name_ar: 'نسكافيه كلاسيك 200 جرام',
    canonical_name_en: 'Nescafe Classic 200g',
    brand: 'نسكافيه',
    category_id: 'cat_coffee_tea',
    barcode: '6221031002001',
    size_label: '200 جرام',
    description: 'قهوة سريعة الذوبان كلاسيك أصلية 200 جرام',
    created_by: 'test_admin',
  });
  assert.equal(created.reused, false);
  master200Id = created.master.id;

  const linked = linkMerchantListingToMaster({
    merchant_id: 'mer_test_ahram',
    master_product_id: master200Id,
    category_id: 'cat_coffee_tea',
    base_price: 32,
    stock_quantity: 25,
  });
  ahramListingId = linked.listing.id;
  assert.equal(linked.listing.master_product_id, master200Id);
  assert.equal(Number(linked.listing.base_price), 32);
});

// Test 2: إضافة نفس المنتج من متجر النخبة بسعر 29 -> ربط بنفس المنتج المركزي + مقارنة مرتّبة بالأقل سعرًا وتوفير 3
test('2. إضافة نفس المنتج في متجر النخبة بسعر 29 -> تطابق مع نفس المنتج المركزي ومقارنة مرتبة (توفير 3)', () => {
  const match = matchMasterProducts({
    name_ar: 'نسكافيه 200 جم',
    brand: 'نسكافيه',
    size_label: '200g',
  });
  assert.equal(match.match_status, 'exact');
  assert.equal(match.exact_match?.id, master200Id);

  const linked = linkMerchantListingToMaster({
    merchant_id: 'mer_test_nokhba',
    master_product_id: match.exact_match!.id,
    category_id: 'cat_coffee_tea',
    base_price: 29,
    stock_quantity: 18,
  });
  nokhbaListingId = linked.listing.id;
  assert.equal(linked.listing.master_product_id, master200Id);

  const mastersCount = (db.prepare("SELECT COUNT(*) AS c FROM master_products WHERE approval_status = 'approved'").get() as { c: number }).c;
  assert.equal(mastersCount, 1, 'لا يجب إنشاء منتج مركزي مكرر');

  const details = getStorefrontProductDetailsData(ahramListingId)!;
  assert.equal(details.comparison.has_multi_store, true);
  assert.equal(details.comparison.stores_count, 2);
  assert.equal(details.comparison.available_stores[0].merchant_name, 'متجر النخبة');
  assert.equal(details.comparison.available_stores[0].effective_price, 29);
  assert.equal(details.comparison.available_stores[0].is_lowest, true);
  assert.equal(details.comparison.available_stores[0].savings_vs_highest, 3);
  assert.equal(details.comparison.available_stores[1].merchant_name, 'متجر الأهرام');
  assert.equal(details.comparison.available_stores[1].effective_price, 32);
  assert.equal(details.comparison.available_stores[1].price_diff_from_lowest, 3);
});

// Test 3: إضافة "نسكافيه 100 جرام" -> منتج مركزي مستقل بسبب اختلاف الوزن
test('3. إضافة "نسكافيه 100 جرام" -> يُنشأ منتج مركزي مستقل ولا يُدمج مع 200 جرام', () => {
  const match = matchMasterProducts({
    name_ar: 'نسكافيه كلاسيك 100 جرام',
    brand: 'نسكافيه',
    size_label: '100 جرام',
  });
  assert.notEqual(match.match_status, 'exact', 'ممنوع مطابقة 100 جم مع 200 جم');

  const created100 = createMasterProductRecord({
    canonical_name_ar: 'نسكافيه كلاسيك 100 جرام',
    canonical_name_en: 'Nescafe Classic 100g',
    brand: 'نسكافيه',
    category_id: 'cat_coffee_tea',
    barcode: '6221031001004',
    size_label: '100 جرام',
    created_by: 'test_admin',
  });
  assert.notEqual(created100.master.id, master200Id);

  const mastersCount = (db.prepare("SELECT COUNT(*) AS c FROM master_products WHERE approval_status = 'approved'").get() as { c: number }).c;
  assert.equal(mastersCount, 2);
});

// Test 4: إضافة اسم مختلف قليلاً ("Nescafé Classic 200g") بنفس الباركود -> اكتشاف التطابق ومنع التكرار
test('4. إضافة "Nescafé Classic 200g" بنفس الباركود -> اكتشاف التطابق التام ومنع إنشاء منتج مكرر', () => {
  const match = matchMasterProducts({
    name_ar: 'Nescafé Classic 200g',
    barcode: '6221031002001',
    size_label: '0.2 kg',
  });
  assert.equal(match.match_status, 'exact');
  assert.equal(match.exact_match?.id, master200Id);

  let duplicateBlocked = false;
  try {
    createMasterProductRecord({
      canonical_name_ar: 'Nescafé Classic 200g',
      barcode: '6221031002001',
      size_label: '200g',
      allow_reuse_exact: false,
    });
  } catch {
    duplicateBlocked = true;
  }
  assert.equal(duplicateBlocked, true, 'يجب منع إنشاء منتج مركزي مكرر بنفس الباركود/المواصفات');
});

// Test 5: تحديث سعر متجر الأهرام فقط -> لا يتأثر سعر متجر النخبة
test('5. تحديث سعر متجر الأهرام إلى 27 -> يتحدث متجر الأهرام فقط ويصبح الأرخص دون مساس بمتجر النخبة (29)', () => {
  linkMerchantListingToMaster({
    merchant_id: 'mer_test_ahram',
    master_product_id: master200Id,
    base_price: 27,
    stock_quantity: 20,
  });

  const details = getStorefrontProductDetailsData(nokhbaListingId)!;
  assert.equal(details.comparison.available_stores[0].merchant_name, 'متجر الأهرام');
  assert.equal(details.comparison.available_stores[0].effective_price, 27);
  assert.equal(details.comparison.available_stores[1].merchant_name, 'متجر النخبة');
  assert.equal(details.comparison.available_stores[1].effective_price, 29);
});

// Test 6: تعطيل التوفر في متجر الأهرام فقط -> ينتقل لقسم غير المتوفر بينما يبقى متجر النخبة متاحًا
test('6. تعطيل التوفر في متجر الأهرام -> يؤثر على الأهرام فقط ويبقى متجر النخبة متاحًا للشراء', () => {
  db.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run(ahramListingId);

  const details = getStorefrontProductDetailsData(nokhbaListingId)!;
  assert.equal(details.comparison.available_stores.length, 1);
  assert.equal(details.comparison.available_stores[0].merchant_name, 'متجر النخبة');
  assert.equal(details.comparison.unavailable_stores.length, 1);
  assert.equal(details.comparison.unavailable_stores[0].merchant_name, 'متجر الأهرام');
});

// Test 7: طلب تاجر لإضافة منتج غير موجود -> قيد المراجعة -> اعتماد الإدارة -> متاح في الكتالوج المركزي للجميع
test('7. طلب تاجر لإضافة منتج جديد -> قيد مراجعة الإدارة -> اعتماده وإتاحته في الكتالوج المركزي', () => {
  const reqRes = submitMerchantProductRequestRecord({
    merchant_id: 'mer_test_nokhba',
    requested_by: 'تاجر النخبة',
    product_name_ar: 'زيت عافية ذرة 1.6 لتر',
    product_name_en: 'Afia Corn Oil 1.6L',
    brand: 'عافية',
    category_id: 'cat_grocery',
    barcode: '6281007016009',
    size_label: '1.6 لتر',
    proposed_price: 165,
    proposed_stock: 15,
  });
  assert.equal(reqRes.request.status, 'pending');
  assert.equal(reqRes.match_preview.match_status, 'none');

  // Verify NOT in approved catalog yet before Admin approval
  const preMatch = matchMasterProducts({ barcode: '6281007016009' });
  assert.equal(preMatch.match_status, 'none');

  // Admin approves request -> creates Master + auto-links merchant listing
  const reviewed = reviewMerchantProductRequestRecord({
    request_id: reqRes.request.id,
    decision: 'approve_new',
    auto_create_listing: true,
    reviewed_by: 'المدير العام',
  });
  assert.equal(reviewed.request.status, 'approved_new');
  assert.ok(reviewed.master?.id);
  assert.equal(reviewed.listing?.merchant_id, 'mer_test_nokhba');
  assert.equal(Number(reviewed.listing?.base_price), 165);

  // Now another store (متجر الأهرام) can find it immediately in Master Catalog!
  const postMatch = matchMasterProducts({ name_ar: 'زيت عافية ذرة 1600 مل', brand: 'عافية' });
  assert.equal(postMatch.match_status, 'exact');
  assert.equal(postMatch.exact_match?.id, reviewed.master!.id);
});

// Test 8: رفع جماعي بواسطة Excel للمنتجات المركزية مع منع التكرار داخل الملف ومع القاعدة
test('8. رفع جماعي للمنتجات المركزية عبر Excel -> يضيف الجديد ويتخطى الموجود والمكرر داخل الملف تلقائيًا', () => {
  const importRes = bulkImportMasterProductsFromExcel({
    rows: [
      { row_index: 2, name_ar: 'حليب جهينة كامل الدسم 1 لتر', brand: 'جهينة', size_label: '1 لتر', barcode: '6221007011111', category: 'الألبان والبيض' },
      { row_index: 3, name_ar: 'حليب جهينة كامل الدسم 1000 مل', brand: 'جهينة', size_label: '1000 مل', barcode: '6221007011111', category: 'الألبان والبيض' }, // duplicate inside same file
      { row_index: 4, name_ar: 'نسكافيه كلاسيك 200 جم', brand: 'نسكافيه', size_label: '200 جم', barcode: '6221031002001' }, // already exists in DB
      { row_index: 5, name_ar: 'أرز الضحى مصري فاخر 1 كجم', brand: 'الضحى', size_label: '1 كجم', barcode: '6223009998881', category: 'الأرز والحبوب' },
    ],
    default_category_id: 'cat_grocery',
    skip_existing: true,
    actor_name: 'اختبار آلي',
  });
  assert.equal(importRes.created_count, 2, 'يجب إضافة منتجين جديدين فقط (جهينة 1 لتر + أرز الضحى 1 كجم)');
  assert.equal(importRes.skipped_existing_count, 2, 'يجب تخطي المكرر داخل الملف والموجود مسبقًا');
  assert.equal(importRes.error_count, 0);
});

// Test 9: مقارنة ملف Excel بالمنتجات المركزية -> فرز دقيق بين (الموجودة) و(غير الموجودة)
test('9. مقارنة ملف Excel بالمنتجات المركزية -> يفرز بدقة بين المنتجات الموجودة وغير الموجودة مع فصل الأحجام', () => {
  const cmp = compareExcelRowsAgainstMasterCatalog([
    { row_index: 2, name_ar: 'Nescafe Classic 200g', brand: 'نسكافيه', barcode: '6221031002001' }, // existing by barcode
    { row_index: 3, name_ar: 'حليب جهينة كامل الدسم 1000 مل', brand: 'جهينة', size_label: '1000 مل' }, // existing by unit conversion 1L == 1000ml
    { row_index: 4, name_ar: 'حليب جهينة كامل الدسم 500 مل', brand: 'جهينة', size_label: '500 مل' }, // NOT FOUND (different size!)
    { row_index: 5, name_ar: 'مكرونة الملكة قلم 400 جرام', brand: 'الملكة', size_label: '400 جرام', barcode: '6224001122334' }, // NOT FOUND (brand new)
  ]);

  assert.equal(cmp.summary.total_rows, 4);
  assert.equal(cmp.summary.existing_count, 2, 'يجب اكتشاف منتجين موجودين بالفعل');
  assert.equal(cmp.summary.not_found_count, 2, 'يجب اكتشاف منتجين غير موجودين (منهما 500 مل المفصول عن 1 لتر)');
  assert.ok(cmp.existing.every((r) => r.matched_master && r.matched_master.id));
  assert.ok(cmp.not_found.some((r) => r.name_ar.includes('500 مل')));
  assert.ok(cmp.not_found.some((r) => r.name_ar.includes('الملكة')));
});

// Test 10: الأقسام الرئيسية والفرعية بصيغة Excel (سوبر ماركت > مخبوزات > كرواسون وكيك;)
test('10. الأقسام الرئيسية والفرعية بصيغة Excel (سوبر ماركت > مخبوزات > كرواسون وكيك;) -> بناء الشجرة تلقائيًا والبحث الشجري', () => {
  // Exact string with NBSP (\u00A0) and trailing semicolon as requested by user
  const exactUserInput = 'سوبر ماركت\u00A0 > \u00A0مخبوزات\u00A0 > \u00A0كرواسون وكيك;';
  const segments = parseCategoryHierarchyPath(exactUserInput);
  assert.deepEqual(segments, ['سوبر ماركت', 'مخبوزات', 'كرواسون وكيك']);
  assert.equal(formatCategoryExcelPath(segments), 'سوبر ماركت > مخبوزات > كرواسون وكيك;');

  const importRes = bulkImportMasterProductsFromExcel({
    rows: [
      {
        row_index: 2,
        name_ar: 'مولتو كرواسون بالزبدة 80 جرام',
        brand: 'مولتو',
        size_label: '80 جرام',
        barcode: '6221039000809',
        category: exactUserInput,
      },
      {
        row_index: 3,
        name_ar: 'مولتو ميني شوكولاتة 65 جرام',
        brand: 'مولتو',
        size_label: '65 جرام',
        barcode: '6221039000656',
        category: 'سوبر ماركت > مخبوزات > كرواسون وكيك;', // should reuse all 3 created nodes without duplication!
      },
    ],
    default_category_id: 'cat_grocery',
    skip_existing: true,
    actor_name: 'اختبار آلي',
  });

  assert.equal(importRes.created_count, 2);
  assert.equal(importRes.categories_created_count, 3, 'يجب إنشاء 3 مستويات فقط (سوبر ماركت -> مخبوزات -> كرواسون وكيك) بدون تكرار');

  const rootCat = db.prepare("SELECT * FROM categories WHERE name_ar = 'سوبر ماركت' AND parent_id IS NULL").get() as any;
  const midCat = db.prepare("SELECT * FROM categories WHERE name_ar = 'مخبوزات'").get() as any;
  const leafCat = db.prepare("SELECT * FROM categories WHERE name_ar = 'كرواسون وكيك'").get() as any;

  assert.ok(rootCat && midCat && leafCat, 'يجب وجود المستويات الثلاثة في قاعدة البيانات');
  assert.equal(rootCat.level, 0);
  assert.equal(midCat.parent_id, rootCat.id);
  assert.equal(midCat.level, 1);
  assert.equal(leafCat.parent_id, midCat.id);
  assert.equal(leafCat.level, 2);
  assert.equal(leafCat.full_path_ar, 'سوبر ماركت > مخبوزات > كرواسون وكيك;');

  const descendantIds = getCategoryAndDescendantIds(rootCat.id);
  assert.equal(descendantIds.length, 3);
  assert.ok(descendantIds.includes(rootCat.id));
  assert.ok(descendantIds.includes(midCat.id));
  assert.ok(descendantIds.includes(leafCat.id));

  const linkedMaster = db.prepare("SELECT category_id FROM master_products WHERE barcode = '6221039000809'").get() as any;
  assert.equal(linkedMaster.category_id, leafCat.id, 'يجب ربط المنتج بآخر فرع فرعي (كرواسون وكيك)');
});

// Clean up temp test database
for (const p of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log(`\n🎉 ALL ${passed}/10 MASTER PRODUCT CATALOG, EXCEL & CATEGORY HIERARCHY TESTS PASSED SUCCESSFULLY!`);
