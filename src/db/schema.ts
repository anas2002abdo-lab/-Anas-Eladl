import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Firebase Auth linked users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Internal durability coordination metadata
export const cloudSqlMeta = pgTable('cloud_sql_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// 1. Platform Configuration & RBAC Tables
export const serviceConfigs = pgTable('service_configs', {
  service_key: text('service_key').primaryKey(),
  name_ar: text('name_ar').notNull(),
  name_en: text('name_en').notNull(),
  is_enabled: integer('is_enabled').notNull().default(1),
  requires_license: integer('requires_license').notNull().default(0),
  license_ready: integer('license_ready').notNull().default(1),
  min_order_amount: doublePrecision('min_order_amount').notNull().default(0),
  maintenance_msg_ar: text('maintenance_msg_ar').notNull().default(''),
  updated_at: text('updated_at').notNull().default(''),
});

export const serviceZones = pgTable('service_zones', {
  id: text('id').primaryKey(),
  name_ar: text('name_ar').notNull(),
  name_en: text('name_en').notNull(),
  zone_type: text('zone_type').notNull(),
  center_lat: doublePrecision('center_lat').notNull(),
  center_lng: doublePrecision('center_lng').notNull(),
  radius_km: doublePrecision('radius_km').notNull().default(2.5),
  remote_area_fee: doublePrecision('remote_area_fee').notNull().default(0),
  is_active: integer('is_active').notNull().default(1),
});

export const pricingRules = pgTable('pricing_rules', {
  id: text('id').primaryKey(),
  rule_code: text('rule_code').notNull(),
  title_ar: text('title_ar').notNull(),
  title_en: text('title_en').notNull(),
  service_type: text('service_type').notNull(),
  vehicle_type: text('vehicle_type').notNull().default('all'),
  base_fee: doublePrecision('base_fee').notNull().default(0),
  base_distance_km: doublePrecision('base_distance_km').notNull().default(2),
  per_km_rate: doublePrecision('per_km_rate').notNull().default(0),
  per_min_waiting_rate: doublePrecision('per_min_waiting_rate').notNull().default(0),
  waiting_grace_min: integer('waiting_grace_min').notNull().default(3),
  min_fare: doublePrecision('min_fare').notNull().default(0),
  express_fee: doublePrecision('express_fee').notNull().default(0),
  peak_multiplier: doublePrecision('peak_multiplier').notNull().default(1.0),
  cancellation_fee: doublePrecision('cancellation_fee').notNull().default(0),
  commission_rate: doublePrecision('commission_rate').notNull().default(10),
  captain_delivery_share_pct: doublePrecision('captain_delivery_share_pct').notNull().default(85),
  min_commission: doublePrecision('min_commission').notNull().default(0),
  max_commission: doublePrecision('max_commission').notNull().default(500),
  is_active: integer('is_active').notNull().default(1),
  updated_at: text('updated_at').notNull().default(''),
});

export const dispatchConfig = pgTable('dispatch_config', {
  id: text('id').primaryKey(),
  weight_proximity: doublePrecision('weight_proximity').notNull().default(0.5),
  weight_acceptance: doublePrecision('weight_acceptance').notNull().default(0.25),
  weight_rating: doublePrecision('weight_rating').notNull().default(0.15),
  weight_idle_time: doublePrecision('weight_idle_time').notNull().default(0.1),
  offer_timeout_sec: integer('offer_timeout_sec').notNull().default(25),
  initial_radius_km: doublePrecision('initial_radius_km').notNull().default(2.0),
  expanded_radius_km: doublePrecision('expanded_radius_km').notNull().default(5.0),
  max_radius_km: doublePrecision('max_radius_km').notNull().default(12.0),
  max_rejections_before_alert: integer('max_rejections_before_alert').notNull().default(3),
  default_cash_limit: doublePrecision('default_cash_limit').notNull().default(1000),
  updated_at: text('updated_at').notNull().default(''),
});

export const roles = pgTable('roles', {
  code: text('code').primaryKey(),
  name_ar: text('name_ar').notNull(),
  name_en: text('name_en').notNull(),
  permissions_json: text('permissions_json').notNull(),
});

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  full_name: text('full_name').notNull(),
  role_code: text('role_code').notNull(),
  is_active: integer('is_active').notNull().default(1),
  token_version: integer('token_version').notNull().default(0),
  custom_permissions_json: text('custom_permissions_json'),
  last_login_at: text('last_login_at'),
  created_at: text('created_at').notNull().default(''),
});

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    user_role: text('user_role').notNull(),
    refresh_token_hash: text('refresh_token_hash').notNull(),
    expires_at: text('expires_at').notNull(),
    revoked_at: text('revoked_at'),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [index('pg_idx_user_sessions_user').on(table.user_id, table.user_role)]
);

export const pushDeviceTokens = pgTable(
  'push_device_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    user_role: text('user_role').notNull(),
    fcm_token: text('fcm_token').notNull(),
    device_id: text('device_id'),
    platform: text('platform').notNull().default('android'),
    app_version: text('app_version'),
    device_label: text('device_label'),
    is_active: integer('is_active').notNull().default(1),
    last_seen_at: text('last_seen_at').notNull().default(''),
    created_at: text('created_at').notNull().default(''),
    updated_at: text('updated_at').notNull().default(''),
  },
  (table) => [index('pg_idx_push_tokens_user').on(table.user_id, table.user_role)]
);

export const financialModelSettings = pgTable('financial_model_settings', {
  id: text('id').primaryKey(),
  config_json: text('config_json').notNull(),
  updated_at: text('updated_at').notNull().default(''),
});

export const invoiceDesignSettings = pgTable('invoice_design_settings', {
  id: text('id').primaryKey(),
  config_json: text('config_json').notNull(),
  updated_at: text('updated_at').notNull().default(''),
});

export const paymentSettings = pgTable('payment_settings', {
  id: text('id').primaryKey(),
  cod_enabled: integer('cod_enabled').notNull().default(1),
  network_pos_enabled: integer('network_pos_enabled').notNull().default(1),
  wallet_enabled: integer('wallet_enabled').notNull().default(1),
  online_card_enabled: integer('online_card_enabled').notNull().default(0),
  cod_max_amount: doublePrecision('cod_max_amount').notNull().default(5000),
  network_min_amount: doublePrecision('network_min_amount').notNull().default(10),
  cod_instructions_ar: text('cod_instructions_ar').notNull().default(''),
  network_instructions_ar: text('network_instructions_ar').notNull().default(''),
  wallet_instructions_ar: text('wallet_instructions_ar').notNull().default(''),
  updated_at: text('updated_at').notNull().default(''),
});

export const coupons = pgTable('coupons', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  applicable_services_json: text('applicable_services_json').notNull(),
  discount_type: text('discount_type').notNull(),
  discount_value: doublePrecision('discount_value').notNull(),
  max_discount: doublePrecision('max_discount').notNull(),
  min_order_amount: doublePrecision('min_order_amount').notNull().default(0),
  funded_by: text('funded_by').notNull().default('platform'),
  used_count: integer('used_count').notNull().default(0),
  usage_limit_total: integer('usage_limit_total').notNull().default(100),
  is_active: integer('is_active').notNull().default(1),
});

// 2. Actor Accounts (Customers, Captains, Merchants)
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    phone: text('phone'),
    password_hash: text('password_hash').notNull().default(''),
    full_name: text('full_name').notNull().default('عميل اطلبها'),
    status: text('status').notNull().default('active'),
    default_zone_id: text('default_zone_id').notNull().default('zn_city_center'),
    address_landmark: text('address_landmark').notNull().default(''),
    is_email_verified: integer('is_email_verified').notNull().default(1),
    last_login_at: text('last_login_at').notNull().default(''),
    created_at: text('created_at').notNull().default(''),
    last_lat: doublePrecision('last_lat'),
    last_lng: doublePrecision('last_lng'),
    location_updated_at: text('location_updated_at'),
    token_version: integer('token_version').notNull().default(0),
    age: integer('age'),
    country: text('country').notNull().default('مصر'),
    city: text('city').notNull().default('المنزلة'),
    secondary_phone: text('secondary_phone'),
    google_uid: text('google_uid'),
    auth_provider: text('auth_provider').notNull().default('email'),
    profile_completed: integer('profile_completed').notNull().default(0),
  },
  (table) => [index('pg_idx_customers_phone').on(table.phone)]
);

export const captains = pgTable(
  'captains',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    username: text('username'),
    password_hash: text('password_hash').notNull().default(''),
    full_name: text('full_name').notNull(),
    phone: text('phone').notNull(),
    national_id: text('national_id').notNull(),
    city: text('city').notNull().default('المنزلة'),
    zone_name: text('zone_name').notNull(),
    vehicle_type: text('vehicle_type').notNull(),
    vehicle_model: text('vehicle_model').notNull(),
    plate_number: text('plate_number').notNull(),
    is_eligible_for_rides: integer('is_eligible_for_rides').notNull().default(0),
    allowed_services_json: text('allowed_services_json').notNull(),
    verification_status: text('verification_status').notNull().default('under_review'),
    rejection_reason: text('rejection_reason'),
    availability_status: text('availability_status').notNull().default('offline'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    cash_on_hand: doublePrecision('cash_on_hand').notNull().default(0),
    cash_limit: doublePrecision('cash_limit').notNull().default(1000),
    rating_avg: doublePrecision('rating_avg').notNull().default(5.0),
    acceptance_rate: doublePrecision('acceptance_rate').notNull().default(95.0),
    cancellation_rate: doublePrecision('cancellation_rate').notNull().default(0.0),
    completed_count: integer('completed_count').notNull().default(0),
    idle_minutes: integer('idle_minutes').notNull().default(15),
    location_updated_at: text('location_updated_at'),
    total_penalties: doublePrecision('total_penalties').notNull().default(0),
    token_version: integer('token_version').notNull().default(0),
  },
  (table) => [index('pg_idx_captains_verif').on(table.verification_status, table.availability_status)]
);

export const captainDocuments = pgTable('captain_documents', {
  id: text('id').primaryKey(),
  captain_id: text('captain_id').notNull(),
  doc_type: text('doc_type').notNull(),
  label_ar: text('label_ar').notNull(),
  review_status: text('review_status').notNull().default('pending'),
  expires_at: text('expires_at'),
  review_note: text('review_note'),
  image_url: text('image_url'),
});

export const captainRatings = pgTable('captain_ratings', {
  id: text('id').primaryKey(),
  captain_id: text('captain_id').notNull(),
  captain_name: text('captain_name').notNull(),
  customer_name: text('customer_name').notNull(),
  customer_phone: text('customer_phone'),
  ref_type: text('ref_type').notNull(),
  ref_id: text('ref_id').notNull(),
  ref_number: text('ref_number').notNull(),
  final_amount: doublePrecision('final_amount').notNull().default(0),
  rating: integer('rating'),
  comment: text('comment').notNull().default(''),
  status: text('status').notNull().default('pending'),
  created_at: text('created_at').notNull().default(''),
  submitted_at: text('submitted_at'),
  customer_id: text('customer_id'),
});

export const merchants = pgTable(
  'merchants',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    password_hash: text('password_hash').notNull().default(''),
    business_name_ar: text('business_name_ar').notNull(),
    business_name_en: text('business_name_en').notNull(),
    merchant_type: text('merchant_type').notNull(),
    branch_name: text('branch_name').notNull(),
    zone_name: text('zone_name').notNull(),
    phone: text('phone').notNull(),
    whatsapp_phone: text('whatsapp_phone').notNull().default(''),
    owner_name: text('owner_name').notNull().default(''),
    owner_national_id: text('owner_national_id').notNull().default(''),
    address_detail: text('address_detail').notNull().default(''),
    commercial_reg_no: text('commercial_reg_no').notNull().default(''),
    license_doc_url: text('license_doc_url').notNull().default(''),
    payout_method: text('payout_method').notNull().default('vodafone_cash'),
    payout_account: text('payout_account').notNull().default(''),
    working_hours: text('working_hours').notNull().default('09:00 ص - 12:00 م'),
    terms_accepted: integer('terms_accepted').notNull().default(0),
    terms_accepted_at: text('terms_accepted_at'),
    image_url: text('image_url').notNull().default(''),
    commission_rate: doublePrecision('commission_rate').notNull().default(10),
    verification_status: text('verification_status').notNull().default('pending'),
    supports_free_order: integer('supports_free_order').notNull().default(1),
    is_open_now: integer('is_open_now').notNull().default(1),
    pharmacy_license_no: text('pharmacy_license_no'),
    pharmacist_name: text('pharmacist_name'),
    syndicate_no: text('syndicate_no'),
    orders_count: integer('orders_count').notNull().default(0),
    is_email_verified: integer('is_email_verified').notNull().default(0),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    token_version: integer('token_version').notNull().default(0),
  },
  (table) => [index('pg_idx_merchants_status').on(table.verification_status, table.merchant_type)]
);

// 3. Catalog, Categories, Master Products & Store Products
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    merchant_id: text('merchant_id'),
    name_ar: text('name_ar').notNull(),
    name_en: text('name_en').notNull(),
    image_url: text('image_url').notNull().default(''),
    sort_order: integer('sort_order').notNull().default(0),
    is_offers_section: integer('is_offers_section').notNull().default(0),
    is_active: integer('is_active').notNull().default(1),
    group_key: text('group_key').notNull().default('groceries'),
    group_name_ar: text('group_name_ar').notNull().default('المقاضي'),
    parent_id: text('parent_id'),
    level: integer('level').notNull().default(0),
    full_path_ar: text('full_path_ar').notNull().default(''),
  },
  (table) => [index('pg_idx_categories_merchant').on(table.merchant_id, table.is_active)]
);

export const masterProducts = pgTable(
  'master_products',
  {
    id: text('id').primaryKey(),
    canonical_name_ar: text('canonical_name_ar').notNull(),
    canonical_name_en: text('canonical_name_en').notNull().default(''),
    trade_name: text('trade_name').notNull().default(''),
    brand: text('brand').notNull().default(''),
    category_id: text('category_id'),
    barcode: text('barcode'),
    size_value: doublePrecision('size_value'),
    size_unit: text('size_unit').notNull().default(''),
    size_label: text('size_label').notNull().default(''),
    image_url: text('image_url').notNull().default(''),
    description: text('description').notNull().default(''),
    usage_notes: text('usage_notes').notNull().default(''),
    ingredients: text('ingredients').notNull().default(''),
    approval_status: text('approval_status').notNull().default('approved'),
    merged_into_id: text('merged_into_id'),
    normalized_key: text('normalized_key').notNull().default(''),
    created_by: text('created_by').notNull().default('system'),
    created_at: text('created_at').notNull().default(''),
    updated_at: text('updated_at').notNull().default(''),
  },
  (table) => [
    index('pg_idx_master_products_barcode').on(table.barcode),
    index('pg_idx_master_products_norm_key').on(table.normalized_key),
  ]
);

export const productAttributes = pgTable('product_attributes', {
  id: text('id').primaryKey(),
  master_product_id: text('master_product_id').notNull(),
  attr_key: text('attr_key').notNull(),
  attr_value: text('attr_value').notNull(),
  created_at: text('created_at').notNull().default(''),
});

export const productImages = pgTable('product_images', {
  id: text('id').primaryKey(),
  master_product_id: text('master_product_id').notNull(),
  image_url: text('image_url').notNull(),
  is_primary: integer('is_primary').notNull().default(0),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: text('created_at').notNull().default(''),
});

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    merchant_id: text('merchant_id').notNull(),
    category_id: text('category_id').notNull(),
    name_ar: text('name_ar').notNull(),
    name_en: text('name_en').notNull(),
    description: text('description').notNull().default(''),
    image_url: text('image_url').notNull().default(''),
    base_price: doublePrecision('base_price').notNull().default(0),
    sale_price: doublePrecision('sale_price'),
    is_offer: integer('is_offer').notNull().default(0),
    stock_quantity: integer('stock_quantity').notNull().default(0),
    low_stock_threshold: integer('low_stock_threshold').notNull().default(5),
    requires_prescription: integer('requires_prescription').notNull().default(0),
    addons_text: text('addons_text').notNull().default(''),
    is_available: integer('is_available').notNull().default(1),
    created_at: text('created_at').notNull().default(''),
    updated_at: text('updated_at').notNull().default(''),
    product_code: text('product_code'),
    master_product_id: text('master_product_id'),
    brand: text('brand').notNull().default(''),
    size_label: text('size_label').notNull().default(''),
    size_value: doublePrecision('size_value'),
    size_unit: text('size_unit').notNull().default(''),
    barcode: text('barcode'),
    merchant_sku: text('merchant_sku').notNull().default(''),
    min_order_qty: integer('min_order_qty').notNull().default(1),
    purchase_count: integer('purchase_count').notNull().default(0),
  },
  (table) => [
    index('pg_idx_products_merchant').on(table.merchant_id, table.is_available),
    index('pg_idx_products_master').on(table.master_product_id, table.is_available),
    index('pg_idx_products_category').on(table.category_id, table.is_available),
  ]
);

export const productMatchingRequests = pgTable('product_matching_requests', {
  id: text('id').primaryKey(),
  merchant_id: text('merchant_id').notNull(),
  requested_by: text('requested_by').notNull().default(''),
  product_name_ar: text('product_name_ar').notNull(),
  product_name_en: text('product_name_en').notNull().default(''),
  brand: text('brand').notNull().default(''),
  category_id: text('category_id'),
  category_path: text('category_path').notNull().default(''),
  barcode: text('barcode'),
  size_value: doublePrecision('size_value'),
  size_unit: text('size_unit').notNull().default(''),
  size_label: text('size_label').notNull().default(''),
  image_url: text('image_url').notNull().default(''),
  description: text('description').notNull().default(''),
  proposed_price: doublePrecision('proposed_price').notNull().default(0),
  proposed_sale_price: doublePrecision('proposed_sale_price'),
  proposed_stock: integer('proposed_stock').notNull().default(10),
  merchant_sku: text('merchant_sku').notNull().default(''),
  suggested_master_id: text('suggested_master_id'),
  match_confidence: text('match_confidence').notNull().default('none'),
  batch_id: text('batch_id').notNull().default(''),
  source_file_name: text('source_file_name').notNull().default(''),
  enriched_from_master: integer('enriched_from_master').notNull().default(0),
  status: text('status').notNull().default('pending'),
  admin_note: text('admin_note').notNull().default(''),
  reviewed_by: text('reviewed_by'),
  reviewed_at: text('reviewed_at'),
  created_at: text('created_at').notNull().default(''),
});

export const productDeals = pgTable('product_deals', {
  id: text('id').primaryKey(),
  merchant_id: text('merchant_id'),
  product_id: text('product_id'),
  master_product_id: text('master_product_id'),
  deal_type: text('deal_type').notNull().default('bundle_discount'),
  title_ar: text('title_ar').notNull(),
  subtitle_ar: text('subtitle_ar').notNull().default(''),
  required_qty: integer('required_qty').notNull().default(1),
  free_qty: integer('free_qty').notNull().default(0),
  discount_amount: doublePrecision('discount_amount').notNull().default(0),
  discount_percent: doublePrecision('discount_percent').notNull().default(0),
  gift_product_ids_json: text('gift_product_ids_json').notNull().default('[]'),
  bundle_product_ids_json: text('bundle_product_ids_json').notNull().default('[]'),
  min_amount: doublePrecision('min_amount').notNull().default(0),
  is_active: integer('is_active').notNull().default(1),
  starts_at: text('starts_at'),
  ends_at: text('ends_at'),
  created_at: text('created_at').notNull().default(''),
});

export const catalogMergeAudit = pgTable('catalog_merge_audit', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  source_master_id: text('source_master_id'),
  target_master_id: text('target_master_id'),
  listing_id: text('listing_id'),
  actor_name: text('actor_name').notNull().default('المدير العام'),
  reason: text('reason').notNull().default(''),
  details_json: text('details_json').notNull().default('{}'),
  created_at: text('created_at').notNull().default(''),
});

export const storefrontBanners = pgTable('storefront_banners', {
  id: text('id').primaryKey(),
  title_ar: text('title_ar').notNull(),
  subtitle_ar: text('subtitle_ar').notNull().default(''),
  badge_ar: text('badge_ar').notNull().default(''),
  banner_type: text('banner_type').notNull().default('hero'),
  image_url: text('image_url').notNull().default(''),
  cta_label: text('cta_label').notNull().default('تسوّق الآن'),
  target_filter: text('target_filter').notNull().default('offers'),
  target_category_id: text('target_category_id'),
  target_merchant_id: text('target_merchant_id'),
  accent_color: text('accent_color').notNull().default('#A92224'),
  sort_order: integer('sort_order').notNull().default(0),
  is_active: integer('is_active').notNull().default(1),
  created_at: text('created_at').notNull().default(''),
});

// 4. Orders, Sub-Orders (order_stores), Trips, Deliveries & Market
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    order_number: text('order_number').notNull(),
    customer_name: text('customer_name').notNull(),
    customer_phone: text('customer_phone').notNull(),
    merchant_id: text('merchant_id'), // Nullable / preserved when merchant is deleted
    merchant_name: text('merchant_name').notNull(),
    merchant_type: text('merchant_type').notNull(),
    captain_id: text('captain_id'),
    captain_name: text('captain_name'),
    zone_name: text('zone_name').notNull(),
    address_landmark: text('address_landmark').notNull(),
    order_channel: text('order_channel').notNull(),
    free_order_text: text('free_order_text'),
    is_express: integer('is_express').notNull().default(0),
    status: text('status').notNull(),
    subtotal: doublePrecision('subtotal').notNull().default(0),
    delivery_fee: doublePrecision('delivery_fee').notNull().default(0),
    discount_amount: doublePrecision('discount_amount').notNull().default(0),
    total_amount: doublePrecision('total_amount').notNull().default(0),
    payment_method: text('payment_method').notNull().default('cash'),
    prescription_status: text('prescription_status'),
    prescription_image_url: text('prescription_image_url'),
    delivery_proof_image_url: text('delivery_proof_image_url'),
    pharmacist_notes: text('pharmacist_notes'),
    substitution_note: text('substitution_note'),
    created_at: text('created_at').notNull().default(''),
    customer_lat: doublePrecision('customer_lat'),
    customer_lng: doublePrecision('customer_lng'),
    customer_id: text('customer_id'),
    items_json: text('items_json').notNull().default('[]'),
    rejection_reason: text('rejection_reason'),
    ready_at: text('ready_at'),
    order_group_id: text('order_group_id'),
    order_group_number: text('order_group_number'),
    captain_picked_up_at: text('captain_picked_up_at'),
  },
  (table) => [
    index('pg_idx_orders_status').on(table.status),
    index('pg_idx_orders_customer').on(table.customer_id),
    index('pg_idx_orders_merchant').on(table.merchant_id),
  ]
);

export const orderStores = pgTable(
  'order_stores',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id').notNull(),
    merchant_id: text('merchant_id').notNull(),
    merchant_name: text('merchant_name').notNull(),
    merchant_type: text('merchant_type').notNull().default('supermarket'),
    order_channel: text('order_channel').notNull().default('catalog'),
    items_json: text('items_json').notNull().default('[]'),
    free_order_text: text('free_order_text'),
    prescription_image_url: text('prescription_image_url'),
    subtotal: doublePrecision('subtotal').notNull().default(0),
    commission_rate: doublePrecision('commission_rate'),
    prep_status: text('prep_status').notNull().default('pending_merchant'),
    pharmacist_notes: text('pharmacist_notes'),
    substitution_note: text('substitution_note'),
    rejection_reason: text('rejection_reason'),
    ready_at: text('ready_at'),
    captain_picked_up_at: text('captain_picked_up_at'),
    sort_index: integer('sort_index').notNull().default(0),
    created_at: text('created_at'),
  },
  (table) => [
    index('pg_idx_order_stores_order').on(table.order_id),
    index('pg_idx_order_stores_merchant').on(table.merchant_id),
  ]
);

export const orderChatMessages = pgTable('order_chat_messages', {
  id: text('id').primaryKey(),
  order_id: text('order_id').notNull(),
  sender_role: text('sender_role').notNull(),
  sender_name: text('sender_name').notNull(),
  message_text: text('message_text').notNull().default(''),
  image_url: text('image_url'),
  is_delivery_proof: integer('is_delivery_proof').notNull().default(0),
  created_at: text('created_at').notNull().default(''),
});

export const trips = pgTable('trips', {
  id: text('id').primaryKey(),
  trip_number: text('trip_number').notNull(),
  customer_name: text('customer_name').notNull(),
  customer_phone: text('customer_phone').notNull(),
  vehicle_type: text('vehicle_type').notNull(),
  pickup_address: text('pickup_address').notNull(),
  dropoff_address: text('dropoff_address').notNull(),
  distance_km: doublePrecision('distance_km').notNull(),
  estimated_fare: doublePrecision('estimated_fare').notNull(),
  captain_id: text('captain_id'),
  captain_name: text('captain_name'),
  status: text('status').notNull().default('searching'),
  created_at: text('created_at').notNull().default(''),
  pickup_lat: doublePrecision('pickup_lat'),
  pickup_lng: doublePrecision('pickup_lng'),
  dropoff_lat: doublePrecision('dropoff_lat'),
  dropoff_lng: doublePrecision('dropoff_lng'),
  captain_phone: text('captain_phone'),
  customer_proposed_fare: doublePrecision('customer_proposed_fare'),
  final_fare: doublePrecision('final_fare'),
  fare_updated_by: text('fare_updated_by'),
  preferred_captain_id: text('preferred_captain_id'),
  preferred_captain_name: text('preferred_captain_name'),
  customer_id: text('customer_id'),
});

export const tripChatMessages = pgTable('trip_chat_messages', {
  id: text('id').primaryKey(),
  trip_id: text('trip_id').notNull(),
  sender_role: text('sender_role').notNull(),
  sender_name: text('sender_name').notNull(),
  message_text: text('message_text').notNull().default(''),
  image_url: text('image_url'),
  created_at: text('created_at').notNull().default(''),
});

export const deliveries = pgTable('deliveries', {
  id: text('id').primaryKey(),
  delivery_number: text('delivery_number').notNull(),
  sender_name: text('sender_name').notNull(),
  sender_phone: text('sender_phone').notNull(),
  receiver_phone: text('receiver_phone').notNull(),
  pickup_address: text('pickup_address').notNull(),
  dropoff_address: text('dropoff_address').notNull(),
  item_category: text('item_category').notNull(),
  size_tier: text('size_tier').notNull().default('small'),
  required_vehicle_type: text('required_vehicle_type').notNull().default('moto'),
  delivery_fee: doublePrecision('delivery_fee').notNull(),
  delivery_otp: text('delivery_otp').notNull(),
  captain_id: text('captain_id'),
  captain_name: text('captain_name'),
  status: text('status').notNull().default('pending'),
  created_at: text('created_at').notNull().default(''),
  preferred_captain_id: text('preferred_captain_id'),
  preferred_captain_name: text('preferred_captain_name'),
  customer_id: text('customer_id'),
});

export const marketListings = pgTable('market_listings', {
  id: text('id').primaryKey(),
  seller_name: text('seller_name').notNull(),
  seller_phone: text('seller_phone').notNull(),
  category_ar: text('category_ar').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  image_url: text('image_url').notNull().default(''),
  condition: text('condition').notNull(),
  price: doublePrecision('price').notNull(),
  quantity: integer('quantity').notNull().default(1),
  zone_name: text('zone_name').notNull(),
  is_negotiable: integer('is_negotiable').notNull().default(1),
  moderation_status: text('moderation_status').notNull().default('pending'),
  reports_count: integer('reports_count').notNull().default(0),
  escrow_held_amount: doublePrecision('escrow_held_amount').notNull().default(0),
  created_at: text('created_at').notNull().default(''),
  seller_id: text('seller_id'),
});

// 5. Financial, Support, Notifications, OTP & Audit Tables
export const wallets = pgTable('wallets', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  owner_name: text('owner_name').notNull(),
  owner_type: text('owner_type').notNull(),
  available_balance: doublePrecision('available_balance').notNull().default(0),
  pending_balance: doublePrecision('pending_balance').notNull().default(0),
  is_frozen: integer('is_frozen').notNull().default(0),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  transaction_group_id: text('transaction_group_id').notNull(),
  account_code: text('account_code').notNull(),
  account_type: text('account_type').notNull(),
  debit: doublePrecision('debit').notNull().default(0),
  credit: doublePrecision('credit').notNull().default(0),
  reference_type: text('reference_type').notNull(),
  reference_id: text('reference_id').notNull(),
  description_ar: text('description_ar').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: text('created_at').notNull().default(''),
});

export const settlements = pgTable('settlements', {
  id: text('id').primaryKey(),
  beneficiary_name: text('beneficiary_name').notNull(),
  beneficiary_type: text('beneficiary_type').notNull(),
  gross_earnings: doublePrecision('gross_earnings').notNull(),
  deducted_commissions: doublePrecision('deducted_commissions').notNull(),
  net_payout: doublePrecision('net_payout').notNull(),
  payout_method: text('payout_method').notNull(),
  status: text('status').notNull().default('requested'),
  created_at: text('created_at').notNull().default(''),
});

export const posInvoices = pgTable('pos_invoices', {
  id: text('id').primaryKey(),
  invoice_number: text('invoice_number').notNull(),
  captain_id: text('captain_id').notNull(),
  captain_name: text('captain_name').notNull(),
  order_id: text('order_id'),
  customer_name: text('customer_name').notNull().default('عميل مباشر'),
  customer_phone: text('customer_phone').notNull().default(''),
  items_json: text('items_json').notNull(),
  subtotal: doublePrecision('subtotal').notNull().default(0),
  delivery_fee: doublePrecision('delivery_fee').notNull().default(0),
  discount_amount: doublePrecision('discount_amount').notNull().default(0),
  total_amount: doublePrecision('total_amount').notNull().default(0),
  payment_method: text('payment_method').notNull().default('cash'),
  printed_via: text('printed_via').notNull().default('bluetooth'),
  created_at: text('created_at').notNull().default(''),
});

export const complaints = pgTable('complaints', {
  id: text('id').primaryKey(),
  ticket_number: text('ticket_number').notNull(),
  complainant_name: text('complainant_name').notNull(),
  service_type: text('service_type').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'),
  resolution_notes: text('resolution_notes'),
  created_at: text('created_at').notNull().default(''),
});

export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  ticket_number: text('ticket_number').notNull(),
  customer_id: text('customer_id'),
  customer_name: text('customer_name').notNull(),
  customer_phone: text('customer_phone'),
  customer_email: text('customer_email'),
  subject: text('subject').notNull(),
  category: text('category').notNull().default('general'),
  status: text('status').notNull().default('open'),
  last_message_at: text('last_message_at').notNull().default(''),
  created_at: text('created_at').notNull().default(''),
});

export const supportMessages = pgTable('support_messages', {
  id: text('id').primaryKey(),
  ticket_id: text('ticket_id').notNull(),
  sender_role: text('sender_role').notNull(),
  sender_name: text('sender_name').notNull(),
  message_text: text('message_text').notNull(),
  created_at: text('created_at').notNull().default(''),
});

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  target_app: text('target_app').notNull(),
  target_zone: text('target_zone').notNull().default('all'),
  recipient_id: text('recipient_id'),
  category: text('category').notNull().default('operational'),
  title_ar: text('title_ar').notNull(),
  body_ar: text('body_ar').notNull(),
  deep_link: text('deep_link').notNull().default('home'),
  fcm_topic: text('fcm_topic').notNull().default('otlobha_all'),
  audience_count: integer('audience_count').notNull().default(0),
  is_read: integer('is_read').notNull().default(0),
  sent_by: text('sent_by').notNull().default('Super Admin'),
  created_at: text('created_at').notNull().default(''),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actor_name: text('actor_name').notNull(),
  actor_role: text('actor_role').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  reason: text('reason'),
  details: text('details').notNull(),
  created_at: text('created_at').notNull().default(''),
});

export const emailOtpCodes = pgTable('email_otp_codes', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  code_hash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  is_used: integer('is_used').notNull().default(0),
  expires_at: text('expires_at').notNull(),
  created_at: text('created_at').notNull().default(''),
});

export const emailActionTokens = pgTable('email_action_tokens', {
  id: text('id').primaryKey(),
  customer_id: text('customer_id'),
  email: text('email').notNull(),
  action_type: text('action_type').notNull(),
  token_hash: text('token_hash').notNull(),
  is_used: integer('is_used').notNull().default(0),
  expires_at: text('expires_at').notNull(),
  created_at: text('created_at').notNull().default(''),
});
