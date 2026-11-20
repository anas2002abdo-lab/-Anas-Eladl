export type Language = 'ar' | 'en';

export type CaptainVerificationStatus =
  | 'new'
  | 'incomplete_data'
  | 'under_review'
  | 'needs_correction'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'inactive';

export type VehicleType = 'moto' | 'tuktuk' | 'car' | 'bicycle';

export type ServiceKey = 'stores' | 'pharmacy' | 'rides' | 'parcels' | 'market' | 'wallet';

export interface ServiceConfig {
  service_key: ServiceKey;
  name_ar: string;
  name_en: string;
  is_enabled: boolean;
  requires_license: boolean;
  license_ready: boolean;
  min_order_amount: number;
  maintenance_msg_ar: string;
  updated_at: string;
}

export interface ServiceZone {
  id: string;
  name_ar: string;
  name_en: string;
  zone_type: 'city_core' | 'village' | 'neighbor_center';
  center_lat: number;
  center_lng: number;
  radius_km: number;
  remote_area_fee: number;
  is_active: boolean;
}

export interface PricingRule {
  id: string;
  rule_code: string;
  title_ar: string;
  title_en: string;
  service_type: 'stores' | 'pharmacy' | 'parcels' | 'rides' | 'market';
  vehicle_type: VehicleType | 'all';
  base_fee: number;
  base_distance_km: number;
  per_km_rate: number;
  per_min_waiting_rate: number;
  waiting_grace_min: number;
  min_fare: number;
  express_fee: number;
  peak_multiplier: number;
  cancellation_fee: number;
  commission_rate: number;
  captain_delivery_share_pct: number;
  min_commission: number;
  max_commission: number;
  is_active: boolean;
  updated_at: string;
}

export interface DispatchConfig {
  id: string;
  weight_proximity: number;
  weight_acceptance: number;
  weight_rating: number;
  weight_idle_time: number;
  offer_timeout_sec: number;
  initial_radius_km: number;
  expanded_radius_km: number;
  max_radius_km: number;
  max_rejections_before_alert: number;
  default_cash_limit: number;
  updated_at: string;
}

export interface PaymentSettings {
  id: string;
  cod_enabled: boolean;
  network_pos_enabled: boolean;
  wallet_enabled: boolean;
  online_card_enabled: boolean;
  cod_max_amount: number;
  network_min_amount: number;
  cod_instructions_ar: string;
  network_instructions_ar: string;
  wallet_instructions_ar: string;
  updated_at?: string;
}

export interface CaptainDocument {
  id: string;
  captain_id: string;
  doc_type: string;
  label_ar: string;
  review_status: 'pending' | 'approved' | 'rejected';
  expires_at: string | null;
  review_note: string | null;
  image_url?: string | null;
}

export interface CaptainRecord {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  phone: string;
  national_id: string;
  city: string;
  zone_name: string;
  vehicle_type: VehicleType;
  vehicle_model: string;
  plate_number: string;
  is_eligible_for_rides: boolean;
  allowed_services: string[];
  verification_status: CaptainVerificationStatus;
  rejection_reason: string | null;
  availability_status: 'offline' | 'available' | 'busy';
  lat: number;
  lng: number;
  location_updated_at?: string | null;
  cash_on_hand: number;
  cash_limit: number;
  total_penalties?: number;
  rating_avg: number;
  acceptance_rate: number;
  cancellation_rate: number;
  completed_count: number;
  idle_minutes: number;
  documents: CaptainDocument[];
}

export interface MerchantRecord {
  id: string;
  email?: string;
  is_email_verified?: boolean;
  lat?: number | null;
  lng?: number | null;
  business_name_ar: string;
  business_name_en: string;
  merchant_type: string;
  branch_name: string;
  zone_name: string;
  phone: string;
  whatsapp_phone?: string;
  owner_name?: string;
  owner_national_id?: string;
  address_detail?: string;
  commercial_reg_no?: string;
  license_doc_url?: string;
  payout_method?: string;
  payout_account?: string;
  working_hours?: string;
  terms_accepted?: boolean;
  terms_accepted_at?: string | null;
  image_url?: string;
  commission_rate: number;
  verification_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  supports_free_order: boolean;
  is_open_now: boolean;
  pharmacy_license_no: string | null;
  pharmacist_name: string | null;
  syndicate_no: string | null;
  orders_count: number;
}

export interface AdminMerchantDetail {
  merchant: MerchantRecord;
  wallet: WalletAccount | null;
  categories: CategoryRecord[];
  stats: {
    categories_count: number;
    products_total: number;
    products_available: number;
    orders_total: number;
    orders_delivered: number;
    orders_cancelled: number;
    total_sales: number;
  };
  recent_orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    subtotal: number;
    delivery_fee: number;
    discount_amount: number;
    total_amount: number;
    payment_method: string;
    order_channel: string;
    created_at: string;
  }>;
}

export interface CategoryRecord {
  id: string;
  scope: 'merchant' | 'pharmacy' | 'market';
  merchant_id?: string | null;
  parent_id?: string | null;
  level?: number;
  full_path_ar?: string;
  excel_path?: string;
  children_count?: number;
  name_ar: string;
  name_en: string;
  image_url?: string;
  sort_order: number;
  is_offers_section?: boolean;
  is_active: boolean;
}

export interface ProductRecord {
  id: string;
  product_code?: string;
  master_product_id?: string | null;
  merchant_id: string;
  merchant_name?: string;
  category_id: string;
  category_name?: string;
  category_path?: string;
  name_ar: string;
  name_en: string;
  brand?: string;
  size_label?: string;
  barcode?: string | null;
  merchant_sku?: string;
  min_order_qty?: number;
  purchase_count?: number;
  description: string;
  image_url: string;
  base_price: number;
  sale_price: number | null;
  is_offer?: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  requires_prescription: boolean;
  addons_text: string;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface MasterProductRecord {
  id: string;
  canonical_name_ar: string;
  canonical_name_en: string;
  trade_name: string;
  brand: string;
  category_id: string | null;
  category_name?: string;
  category_path?: string;
  barcode: string | null;
  size_value: number | null;
  size_unit: string;
  size_label: string;
  image_url: string;
  description: string;
  usage_notes: string;
  ingredients: string;
  approval_status: 'approved' | 'pending' | 'rejected' | 'merged' | 'disabled';
  merged_into_id?: string | null;
  total_listings?: number;
  active_stores_count?: number;
  lowest_price?: number | null;
  highest_price?: number | null;
  created_at: string;
  updated_at: string;
}

export interface MasterProductMatchCandidate {
  id: string;
  canonical_name_ar: string;
  canonical_name_en: string;
  trade_name: string;
  brand: string;
  category_id: string | null;
  category_name?: string;
  barcode: string | null;
  size_label: string;
  image_url: string;
  description: string;
  stores_count: number;
  lowest_price: number | null;
  match_tier: 'exact' | 'possible';
  confidence_score: number;
  match_reasons: string[];
}

export interface ProductMatchingRequestRecord {
  id: string;
  merchant_id: string;
  merchant_name?: string;
  requested_by: string;
  product_name_ar: string;
  product_name_en: string;
  brand: string;
  category_id: string | null;
  category_name?: string;
  barcode: string | null;
  size_label: string;
  image_url: string;
  description: string;
  proposed_price: number;
  proposed_sale_price: number | null;
  proposed_stock: number;
  merchant_sku: string;
  suggested_master_id: string | null;
  suggested_master_name?: string;
  suggested_master_size?: string;
  match_confidence: 'exact' | 'possible' | 'none';
  status: 'pending' | 'approved_new' | 'linked_existing' | 'rejected';
  admin_note: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface StorefrontBannerRecord {
  id: string;
  title_ar: string;
  subtitle_ar: string;
  badge_ar: string;
  banner_type: 'hero' | 'strip';
  image_url: string;
  cta_label: string;
  target_filter: string;
  target_category_id?: string | null;
  target_merchant_id?: string | null;
  accent_color: string;
  sort_order: number;
  is_active: boolean | number;
}

export interface StorefrontCategoryRecord {
  id: string;
  scope: string;
  parent_id?: string | null;
  level?: number;
  full_path_ar?: string;
  excel_path?: string;
  children_count?: number;
  name_ar: string;
  name_en: string;
  image_url: string;
  sort_order: number;
  group_key: string;
  group_name_ar: string;
  products_count: number;
}

export interface StorefrontProductCard {
  id: string;
  product_code?: string;
  master_product_id?: string | null;
  merchant_id: string;
  merchant_name: string;
  merchant_type?: string;
  category_id: string;
  category_name?: string;
  category_group_key?: string;
  name_ar: string;
  name_en?: string;
  brand?: string;
  size_label?: string;
  image_url: string;
  description?: string;
  base_price: number;
  sale_price: number | null;
  effective_price: number;
  discount_percent: number;
  is_offer: boolean;
  stock_quantity: number;
  min_order_qty: number;
  is_available: boolean;
  requires_prescription?: boolean;
  purchase_count?: number;
  stores_count: number;
  lowest_store_price: number;
  max_store_savings: number;
  active_deal?: { id: string; deal_type: string; title_ar: string } | null;
}

export interface StoreComparisonOption {
  product_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_zone: string;
  merchant_is_open: boolean;
  merchant_image_url: string;
  image_url: string;
  size_label: string;
  base_price: number;
  sale_price: number | null;
  effective_price: number;
  stock_quantity: number;
  min_order_qty: number;
  is_available: boolean;
  is_current_listing: boolean;
  rank?: number;
  is_lowest?: boolean;
  price_diff_from_lowest?: number;
  savings_vs_highest?: number;
}

export interface StorefrontProductDeal {
  id: string;
  deal_type: 'buy_x_get_y' | 'bundle_discount' | 'free_gift' | 'tier_qty' | 'free_delivery';
  title_ar: string;
  subtitle_ar: string;
  required_qty: number;
  free_qty: number;
  discount_amount: number;
  discount_percent: number;
  min_amount: number;
  gift_products: Array<Record<string, any>>;
  bundle_products: Array<Record<string, any>>;
}

export interface StorefrontProductDetailsResponse {
  product: StorefrontProductCard & {
    merchant_zone: string;
    merchant_is_open: boolean;
    merchant_working_hours: string;
    barcode?: string | null;
    images: string[];
    usage_notes: string;
    ingredients: string;
  };
  comparison: {
    has_multi_store: boolean;
    stores_count: number;
    lowest_price: number;
    highest_price: number;
    max_savings: number;
    available_stores: StoreComparisonOption[];
    unavailable_stores: StoreComparisonOption[];
  };
  deals: StorefrontProductDeal[];
  attributes: Array<{ id: string; attr_key: string; attr_value: string }>;
  same_brand_products: Array<Record<string, any>>;
  cheaper_alternatives: Array<Record<string, any>>;
  complementary_products: Array<Record<string, any>>;
}

export interface OrderItemRecord {
  id: string;
  product_id?: string | null;
  name_ar: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: 'accepted' | 'rejected';
  rejection_reason?: string | null;
}

export interface OrderStoreSectionRecord {
  id: string;
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_type: string;
  merchant_lat?: number | null;
  merchant_lng?: number | null;
  items: OrderItemRecord[];
  free_order_text?: string | null;
  prescription_image_url?: string | null;
  subtotal: number;
  commission_rate?: number | null;
  prep_status: string;
  pharmacist_notes?: string | null;
  substitution_note?: string | null;
  rejection_reason?: string | null;
  ready_at?: string | null;
  captain_picked_up_at?: string | null;
  sort_index: number;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  merchant_id: string;
  merchant_name: string;
  merchant_type: string;
  captain_id: string | null;
  captain_name: string | null;
  captain_lat?: number | null;
  captain_lng?: number | null;
  captain_location_updated_at?: string | null;
  customer_lat?: number | null;
  customer_lng?: number | null;
  zone_name: string;
  address_landmark: string;
  order_channel: 'catalog' | 'free_text' | 'voice' | 'image' | 'prescription';
  free_order_text: string | null;
  items?: OrderItemRecord[];
  store_sections?: OrderStoreSectionRecord[];
  is_express: boolean;
  status: string;
  subtotal: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  payment_method: string;
  prescription_status: string | null;
  prescription_image_url?: string | null;
  delivery_proof_image_url?: string | null;
  chat_count?: number;
  pharmacist_notes: string | null;
  substitution_note: string | null;
  order_group_id?: string | null;
  order_group_number?: string | null;
  captain_picked_up_at?: string | null;
  merchant_lat?: number | null;
  merchant_lng?: number | null;
  rejection_reason?: string | null;
  ready_at?: string | null;
  created_at: string;
}

export interface MarketListingRecord {
  id: string;
  seller_name: string;
  seller_phone: string;
  category_ar: string;
  title: string;
  description: string;
  image_url?: string;
  condition: 'new' | 'used';
  price: number;
  quantity: number;
  zone_name: string;
  is_negotiable: boolean;
  moderation_status: 'pending' | 'approved' | 'rejected' | 'sold' | 'paused';
  reports_count: number;
  escrow_held_amount: number;
  created_at: string;
}

export interface WalletAccount {
  id: string;
  user_id: string;
  owner_name: string;
  owner_type: string;
  available_balance: number;
  pending_balance: number;
  is_frozen: boolean;
}

export interface LedgerEntryRecord {
  id: string;
  transaction_group_id: string;
  account_code: string;
  account_type: string;
  debit: number;
  credit: number;
  reference_type: string;
  reference_id: string;
  description_ar: string;
  idempotency_key: string;
  created_at: string;
}

export interface SettlementRecord {
  id: string;
  beneficiary_name: string;
  beneficiary_type: 'captain' | 'merchant' | 'market_seller';
  gross_earnings: number;
  deducted_commissions: number;
  net_payout: number;
  payout_method: string;
  status: 'requested' | 'approved' | 'paid' | 'rejected';
  created_at: string;
}

export interface CouponRecord {
  id: string;
  code: string;
  applicable_services: string[];
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_discount: number;
  min_order_amount: number;
  funded_by: 'platform' | 'merchant';
  used_count: number;
  usage_limit_total: number;
  is_active: boolean;
}

export interface ComplaintRecord {
  id: string;
  ticket_number: string;
  complainant_name: string;
  service_type: string;
  category: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved' | 'escalated' | 'closed';
  resolution_notes: string | null;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  details: string;
  created_at: string;
}

export interface RoleRecord {
  code: string;
  name_ar: string;
  name_en: string;
  permissions: string[];
}

export interface AdminUserDetail {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name_ar: string;
  role_name_en: string;
  is_active: boolean;
  permissions: string[];
  custom_permissions?: string[] | null;
  last_login_at: string | null;
  created_at: string;
}

export interface FinancialModelInput {
  monthly_orders_conservative: number;
  monthly_orders_moderate: number;
  monthly_orders_optimistic: number;
  store_share_pct: number;
  parcel_share_pct: number;
  ride_share_pct: number;
  market_share_pct: number;
  avg_store_basket: number;
  avg_delivery_fee: number;
  avg_parcel_fee: number;
  avg_ride_fare: number;
  avg_market_price: number;
  store_commission_pct: number;
  platform_delivery_share_pct: number;
  parcel_commission_pct: number;
  ride_commission_pct: number;
  market_commission_pct: number;
  variable_cost_per_tx: number;
  fixed_cost_conservative: number;
  fixed_cost_moderate: number;
  fixed_cost_optimistic: number;
}

export type NotificationTargetApp = 'customer' | 'captain' | 'merchant' | 'all';

export interface NotificationRecord {
  id: string;
  target_app: NotificationTargetApp;
  target_zone: string;
  recipient_id: string | null;
  category: 'promo' | 'operational' | 'compliance' | 'alert';
  title_ar: string;
  body_ar: string;
  deep_link: string;
  fcm_topic: string;
  audience_count: number;
  is_read: boolean;
  sent_by: string;
  created_at: string;
}

export interface OrderChatMessage {
  id: string;
  order_id: string;
  sender_role: 'customer' | 'captain' | 'admin' | 'system';
  sender_name: string;
  message_text: string;
  image_url: string | null;
  is_delivery_proof: boolean;
  created_at: string;
}

export interface TripRecord {
  id: string;
  trip_number: string;
  customer_name: string;
  customer_phone: string;
  vehicle_type: 'moto' | 'tuktuk' | 'car' | 'bicycle';
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  distance_km: number;
  estimated_fare: number;
  customer_proposed_fare?: number | null;
  final_fare?: number | null;
  fare_updated_by?: string | null;
  preferred_captain_id?: string | null;
  preferred_captain_name?: string | null;
  captain_id: string | null;
  captain_name: string | null;
  captain_phone?: string | null;
  captain_lat?: number | null;
  captain_lng?: number | null;
  captain_location_updated_at?: string | null;
  captain_vehicle_model?: string | null;
  captain_plate_number?: string | null;
  status: string;
  chat_count?: number;
  created_at: string;
}

export interface TripChatMessage {
  id: string;
  trip_id: string;
  sender_role: 'customer' | 'captain' | 'admin' | 'system';
  sender_name: string;
  message_text: string;
  image_url: string | null;
  created_at: string;
}

export interface NearbyCaptainRecord {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: VehicleType;
  vehicle_model: string;
  plate_number: string;
  availability_status: 'offline' | 'available' | 'busy';
  lat: number;
  lng: number;
  location_updated_at: string | null;
  rating_avg: number;
  distance_km: number;
  eta_min: number;
  is_eligible_for_rides: boolean;
}

export interface CaptainRatingRecord {
  id: string;
  captain_id: string;
  captain_name: string;
  customer_name: string;
  customer_phone: string | null;
  ref_type: 'trip' | 'order' | 'parcel';
  ref_id: string;
  ref_number: string;
  final_amount: number;
  rating: number | null;
  comment: string;
  status: 'pending' | 'submitted';
  created_at: string;
  submitted_at: string | null;
}

export interface AdminCustomerSummary {
  id: string;
  is_registered: boolean;
  full_name: string;
  email: string | null;
  phone: string | null;
  default_zone_id: string;
  zone_name: string;
  address_landmark: string;
  is_email_verified: boolean;
  last_login_at: string | null;
  created_at: string | null;
  lat: number;
  lng: number;
  gps_source: 'customer_gps' | 'latest_trip' | 'latest_order' | 'zone_default';
  location_updated_at: string | null;
  orders_count: number;
  active_orders_count: number;
  trips_count: number;
  parcels_count: number;
  ratings_count: number;
  total_spent: number;
}

export interface AdminCustomerDetail {
  customer: AdminCustomerSummary;
  orders: OrderRecord[];
  trips: TripRecord[];
  parcels: Array<Record<string, unknown>>;
  ratings: CaptainRatingRecord[];
  trip_history_logs: AuditLogRecord[];
}

export interface PosInvoiceItem {
  product_id?: string;
  product_code: string;
  name_ar: string;
  category_name?: string;
  unit_price: number;
  qty: number;
  line_total: number;
}

export interface PosInvoiceRecord {
  id: string;
  invoice_number: string;
  captain_id: string;
  captain_name: string;
  order_id: string | null;
  customer_name: string;
  customer_phone: string;
  items: PosInvoiceItem[];
  subtotal: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  payment_method: string;
  printed_via: string;
  created_at: string;
}

export interface InvoiceDesignConfig {
  header_title: string;
  header_subtitle: string;
  logo_url: string;
  show_logo: boolean;
  support_phone: string;
  show_support_phone: boolean;
  show_captain_info: boolean;
  show_item_codes: boolean;
  show_qr_badge: boolean;
  footer_message: string;
  footer_note: string;
  default_paper_width: '58mm' | '80mm';
  accent_color: string;
  font_scale: 'compact' | 'normal' | 'large';
}

export interface PosPrefillReceipt {
  ref_type: 'order' | 'trip' | 'parcel';
  ref_id?: string | null;
  ref_number: string;
  customer_name: string;
  customer_phone?: string;
  items: PosInvoiceItem[];
  delivery_fee: number;
  discount_amount: number;
  payment_method?: 'cash' | 'network' | 'wallet' | 'instapay';
}

export interface SupportTicketRecord {
  id: string;
  ticket_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  subject: string;
  category: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  last_message_at: string;
  created_at: string;
  messages_count?: number;
  last_message_text?: string | null;
  last_sender_role?: 'customer' | 'admin' | null;
}

export interface SupportMessageRecord {
  id: string;
  ticket_id: string;
  sender_role: 'customer' | 'admin';
  sender_name: string;
  message_text: string;
  created_at: string;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  full_name: string;
  role: string;
  actorType: 'admin';
  role_name_ar?: string;
  role_name_en?: string;
  permissions: string[];
  is_active: boolean;
  last_login_at?: string | null;
  created_at?: string;
}
