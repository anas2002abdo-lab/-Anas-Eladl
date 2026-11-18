-- اطلبها – Otlobha Production PostgreSQL + PostGIS Schema
-- Target Region: El Manzala, Dakahlia, Egypt

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS service_configs (
  service_key TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_license BOOLEAN NOT NULL DEFAULT FALSE,
  license_ready BOOLEAN NOT NULL DEFAULT TRUE,
  min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  maintenance_msg_ar TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_zones (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  zone_type TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  center_geog GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography) STORED,
  radius_km NUMERIC(6,2) NOT NULL DEFAULT 2.5,
  remote_area_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id TEXT PRIMARY KEY,
  rule_code TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  service_type TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'all',
  base_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  base_distance_km NUMERIC(6,2) NOT NULL DEFAULT 2,
  per_km_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_min_waiting_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  waiting_grace_min INTEGER NOT NULL DEFAULT 3,
  min_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  express_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  peak_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
  captain_delivery_share_pct NUMERIC(5,2) NOT NULL DEFAULT 85,
  min_commission NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_commission NUMERIC(10,2) NOT NULL DEFAULT 500,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS captains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  national_id TEXT UNIQUE NOT NULL,
  city TEXT NOT NULL DEFAULT 'المنزلة',
  zone_name TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  is_eligible_for_rides BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_services_json JSONB NOT NULL DEFAULT '["stores","parcels"]'::jsonb,
  verification_status TEXT NOT NULL DEFAULT 'under_review',
  rejection_reason TEXT,
  availability_status TEXT NOT NULL DEFAULT 'offline',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  location_geog GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
  cash_on_hand NUMERIC(10,2) NOT NULL DEFAULT 0,
  cash_limit NUMERIC(10,2) NOT NULL DEFAULT 1000,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.0,
  acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 95.0,
  cancellation_rate NUMERIC(5,2) NOT NULL DEFAULT 0.0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  idle_minutes INTEGER NOT NULL DEFAULT 15
);
CREATE INDEX IF NOT EXISTS idx_captains_geog ON captains USING GIST (location_geog);

CREATE TABLE IF NOT EXISTS captain_documents (
  id TEXT PRIMARY KEY,
  captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  file_url TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  expires_at DATE,
  review_note TEXT
);

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  business_name_ar TEXT NOT NULL,
  business_name_en TEXT NOT NULL,
  merchant_type TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  supports_free_order BOOLEAN NOT NULL DEFAULT TRUE,
  is_open_now BOOLEAN NOT NULL DEFAULT TRUE,
  pharmacy_license_no TEXT,
  pharmacist_name TEXT,
  syndicate_no TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  base_price NUMERIC(10,2) NOT NULL CHECK (base_price >= 0),
  sale_price NUMERIC(10,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  addons_text TEXT NOT NULL DEFAULT '',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  merchant_name TEXT NOT NULL,
  merchant_type TEXT NOT NULL,
  captain_id TEXT REFERENCES captains(id),
  captain_name TEXT,
  zone_name TEXT NOT NULL,
  address_landmark TEXT NOT NULL,
  order_channel TEXT NOT NULL,
  free_order_text TEXT,
  is_express BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  prescription_status TEXT,
  pharmacist_notes TEXT,
  substitution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  trip_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  dropoff_address TEXT NOT NULL,
  distance_km NUMERIC(6,2) NOT NULL,
  estimated_fare NUMERIC(10,2) NOT NULL,
  captain_id TEXT REFERENCES captains(id),
  captain_name TEXT,
  status TEXT NOT NULL DEFAULT 'searching',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  delivery_number TEXT UNIQUE NOT NULL,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  dropoff_address TEXT NOT NULL,
  item_category TEXT NOT NULL,
  size_tier TEXT NOT NULL DEFAULT 'small',
  required_vehicle_type TEXT NOT NULL DEFAULT 'moto',
  delivery_fee NUMERIC(10,2) NOT NULL,
  delivery_otp TEXT NOT NULL,
  captain_id TEXT REFERENCES captains(id),
  captain_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  seller_name TEXT NOT NULL,
  seller_phone TEXT NOT NULL,
  category_ar TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  condition TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  zone_name TEXT NOT NULL,
  is_negotiable BOOLEAN NOT NULL DEFAULT TRUE,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  reports_count INTEGER NOT NULL DEFAULT 0,
  escrow_held_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  owner_name TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  available_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_group_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_type TEXT NOT NULL,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  beneficiary_name TEXT NOT NULL,
  beneficiary_type TEXT NOT NULL,
  gross_earnings NUMERIC(12,2) NOT NULL,
  deducted_commissions NUMERIC(12,2) NOT NULL,
  net_payout NUMERIC(12,2) NOT NULL CHECK (net_payout >= 0),
  payout_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  applicable_services_json JSONB NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC(10,2) NOT NULL,
  max_discount NUMERIC(10,2) NOT NULL,
  min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  funded_by TEXT NOT NULL DEFAULT 'platform',
  used_count INTEGER NOT NULL DEFAULT 0,
  usage_limit_total INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  ticket_number TEXT UNIQUE NOT NULL,
  complainant_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  target_app TEXT NOT NULL,
  target_zone TEXT NOT NULL DEFAULT 'all',
  recipient_id TEXT,
  category TEXT NOT NULL DEFAULT 'operational',
  title_ar TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  deep_link TEXT NOT NULL DEFAULT 'home',
  fcm_topic TEXT NOT NULL DEFAULT 'otlobha_all',
  audience_count INTEGER NOT NULL DEFAULT 0,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by TEXT NOT NULL DEFAULT 'Super Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
