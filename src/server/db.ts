import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const dbPath = process.env.OTLOBHA_DB_PATH
  ? path.resolve(process.env.OTLOBHA_DB_PATH)
  : path.resolve(process.cwd(), 'otlobha.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function sha256Otp(phone: string, role: string, code: string): string {
  return crypto.createHash('sha256').update(`${phone}:${role}:${code}`).digest('hex');
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_configs (
      service_key TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      requires_license INTEGER NOT NULL DEFAULT 0,
      license_ready INTEGER NOT NULL DEFAULT 1,
      min_order_amount REAL NOT NULL DEFAULT 0,
      maintenance_msg_ar TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_zones (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      zone_type TEXT NOT NULL,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      radius_km REAL NOT NULL DEFAULT 2.5,
      remote_area_fee REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      rule_code TEXT UNIQUE NOT NULL,
      title_ar TEXT NOT NULL,
      title_en TEXT NOT NULL,
      service_type TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'all',
      base_fee REAL NOT NULL DEFAULT 0,
      base_distance_km REAL NOT NULL DEFAULT 2,
      per_km_rate REAL NOT NULL DEFAULT 0,
      per_min_waiting_rate REAL NOT NULL DEFAULT 0,
      waiting_grace_min INTEGER NOT NULL DEFAULT 3,
      min_fare REAL NOT NULL DEFAULT 0,
      express_fee REAL NOT NULL DEFAULT 0,
      peak_multiplier REAL NOT NULL DEFAULT 1.0,
      cancellation_fee REAL NOT NULL DEFAULT 0,
      commission_rate REAL NOT NULL DEFAULT 10,
      captain_delivery_share_pct REAL NOT NULL DEFAULT 85,
      min_commission REAL NOT NULL DEFAULT 0,
      max_commission REAL NOT NULL DEFAULT 500,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dispatch_config (
      id TEXT PRIMARY KEY,
      weight_proximity REAL NOT NULL DEFAULT 0.50,
      weight_acceptance REAL NOT NULL DEFAULT 0.25,
      weight_rating REAL NOT NULL DEFAULT 0.15,
      weight_idle_time REAL NOT NULL DEFAULT 0.10,
      offer_timeout_sec INTEGER NOT NULL DEFAULT 25,
      initial_radius_km REAL NOT NULL DEFAULT 2.0,
      expanded_radius_km REAL NOT NULL DEFAULT 5.0,
      max_radius_km REAL NOT NULL DEFAULT 12.0,
      max_rejections_before_alert INTEGER NOT NULL DEFAULT 3,
      default_cash_limit REAL NOT NULL DEFAULT 1000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      code TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      permissions_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS captains (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      national_id TEXT UNIQUE NOT NULL,
      city TEXT NOT NULL DEFAULT 'المنزلة',
      zone_name TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      is_eligible_for_rides INTEGER NOT NULL DEFAULT 0,
      allowed_services_json TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'under_review',
      rejection_reason TEXT,
      availability_status TEXT NOT NULL DEFAULT 'offline',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      cash_on_hand REAL NOT NULL DEFAULT 0,
      cash_limit REAL NOT NULL DEFAULT 1000,
      rating_avg REAL NOT NULL DEFAULT 5.0,
      acceptance_rate REAL NOT NULL DEFAULT 95.0,
      cancellation_rate REAL NOT NULL DEFAULT 0.0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      idle_minutes INTEGER NOT NULL DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS captain_documents (
      id TEXT PRIMARY KEY,
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      label_ar TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      review_note TEXT,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      business_name_ar TEXT NOT NULL,
      business_name_en TEXT NOT NULL,
      merchant_type TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      zone_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      whatsapp_phone TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      owner_national_id TEXT NOT NULL DEFAULT '',
      address_detail TEXT NOT NULL DEFAULT '',
      commercial_reg_no TEXT NOT NULL DEFAULT '',
      license_doc_url TEXT NOT NULL DEFAULT '',
      payout_method TEXT NOT NULL DEFAULT 'vodafone_cash',
      payout_account TEXT NOT NULL DEFAULT '',
      working_hours TEXT NOT NULL DEFAULT '09:00 ص - 12:00 م',
      terms_accepted INTEGER NOT NULL DEFAULT 0,
      terms_accepted_at TEXT,
      image_url TEXT NOT NULL DEFAULT '',
      commission_rate REAL NOT NULL DEFAULT 10,
      verification_status TEXT NOT NULL DEFAULT 'pending',
      supports_free_order INTEGER NOT NULL DEFAULT 1,
      is_open_now INTEGER NOT NULL DEFAULT 1,
      pharmacy_license_no TEXT,
      pharmacist_name TEXT,
      syndicate_no TEXT,
      orders_count INTEGER NOT NULL DEFAULT 0
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
      is_express INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      delivery_fee REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      prescription_status TEXT,
      prescription_image_url TEXT,
      delivery_proof_image_url TEXT,
      pharmacist_notes TEXT,
      substitution_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS market_listings (
      id TEXT PRIMARY KEY,
      seller_name TEXT NOT NULL,
      seller_phone TEXT NOT NULL,
      category_ar TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      zone_name TEXT NOT NULL,
      is_negotiable INTEGER NOT NULL DEFAULT 1,
      moderation_status TEXT NOT NULL DEFAULT 'pending',
      reports_count INTEGER NOT NULL DEFAULT 0,
      escrow_held_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      owner_name TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      available_balance REAL NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
      pending_balance REAL NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
      is_frozen INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      transaction_group_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_type TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      description_ar TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      beneficiary_name TEXT NOT NULL,
      beneficiary_type TEXT NOT NULL,
      gross_earnings REAL NOT NULL,
      deducted_commissions REAL NOT NULL,
      net_payout REAL NOT NULL CHECK (net_payout >= 0),
      payout_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      applicable_services_json TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      max_discount REAL NOT NULL,
      min_order_amount REAL NOT NULL DEFAULT 0,
      funded_by TEXT NOT NULL DEFAULT 'platform',
      used_count INTEGER NOT NULL DEFAULT 0,
      usage_limit_total INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_model_settings (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      merchant_id TEXT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_offers_section INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      base_price REAL NOT NULL CHECK (base_price >= 0),
      sale_price REAL CHECK (sale_price IS NULL OR sale_price >= 0),
      is_offer INTEGER NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5,
      requires_prescription INTEGER NOT NULL DEFAULT 0,
      addons_text TEXT NOT NULL DEFAULT '',
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_email TEXT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'open',
      last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      trip_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      pickup_address TEXT NOT NULL,
      dropoff_address TEXT NOT NULL,
      distance_km REAL NOT NULL,
      estimated_fare REAL NOT NULL,
      captain_id TEXT REFERENCES captains(id),
      captain_name TEXT,
      status TEXT NOT NULL DEFAULT 'searching',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      delivery_fee REAL NOT NULL,
      delivery_otp TEXT NOT NULL,
      captain_id TEXT REFERENCES captains(id),
      captain_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      is_read INTEGER NOT NULL DEFAULT 0,
      sent_by TEXT NOT NULL DEFAULT 'Super Admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_chat_messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message_text TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      is_delivery_proof INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      phone TEXT,
      full_name TEXT NOT NULL DEFAULT 'عميل اطلبها',
      status TEXT NOT NULL DEFAULT 'active',
      default_zone_id TEXT NOT NULL DEFAULT 'zn_city_center',
      address_landmark TEXT NOT NULL DEFAULT '',
      is_email_verified INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_otp_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      is_used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS trip_chat_messages (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message_text TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS captain_ratings (
      id TEXT PRIMARY KEY,
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      captain_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      ref_number TEXT NOT NULL,
      final_amount REAL NOT NULL DEFAULT 0,
      rating INTEGER,
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_captain_ratings_ref ON captain_ratings(ref_type, ref_id);

    CREATE TABLE IF NOT EXISTS pos_invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      captain_id TEXT NOT NULL,
      captain_name TEXT NOT NULL,
      order_id TEXT,
      customer_name TEXT NOT NULL DEFAULT 'عميل مباشر',
      customer_phone TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      delivery_fee REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      printed_via TEXT NOT NULL DEFAULT 'bluetooth',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_design_settings (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_settings (
      id TEXT PRIMARY KEY,
      cod_enabled INTEGER NOT NULL DEFAULT 1,
      network_pos_enabled INTEGER NOT NULL DEFAULT 1,
      wallet_enabled INTEGER NOT NULL DEFAULT 1,
      online_card_enabled INTEGER NOT NULL DEFAULT 0,
      cod_max_amount REAL NOT NULL DEFAULT 5000,
      network_min_amount REAL NOT NULL DEFAULT 10,
      cod_instructions_ar TEXT NOT NULL DEFAULT 'الدفع نقداً عند استلام الطلب من الكابتن',
      network_instructions_ar TEXT NOT NULL DEFAULT 'الدفع ببطاقة مدى / فيزا / ماستركارد عبر ماكينة POS المحمولة مع الكابتن',
      wallet_instructions_ar TEXT NOT NULL DEFAULT 'التحويل عبر المحافظ الإلكترونية أو فودافون كاش / إنستاباي',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role_code TEXT NOT NULL REFERENCES roles(code),
      is_active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 0,
      custom_permissions_json TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower ON admin_users(LOWER(email));

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_role TEXT NOT NULL,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, user_role);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  `);

  const adminCols = db.prepare("PRAGMA table_info('admin_users')").all() as Array<{ name: string }>;
  if (!adminCols.some((c) => c.name === 'custom_permissions_json')) {
    db.exec('ALTER TABLE admin_users ADD COLUMN custom_permissions_json TEXT');
  }

  const orderCols = db.prepare("PRAGMA table_info('orders')").all() as Array<{ name: string }>;
  if (!orderCols.some((c) => c.name === 'prescription_image_url')) {
    db.exec('ALTER TABLE orders ADD COLUMN prescription_image_url TEXT');
  }
  if (!orderCols.some((c) => c.name === 'delivery_proof_image_url')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_proof_image_url TEXT');
  }
  if (!orderCols.some((c) => c.name === 'customer_lat')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_lat REAL');
  }
  if (!orderCols.some((c) => c.name === 'customer_lng')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_lng REAL');
  }
  if (!orderCols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT');
  }
  if (!orderCols.some((c) => c.name === 'items_json')) {
    db.exec("ALTER TABLE orders ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!orderCols.some((c) => c.name === 'rejection_reason')) {
    db.exec('ALTER TABLE orders ADD COLUMN rejection_reason TEXT');
  }
  if (!orderCols.some((c) => c.name === 'ready_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN ready_at TEXT');
  }
  if (!orderCols.some((c) => c.name === 'order_group_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN order_group_id TEXT');
  }
  if (!orderCols.some((c) => c.name === 'order_group_number')) {
    db.exec('ALTER TABLE orders ADD COLUMN order_group_number TEXT');
  }
  if (!orderCols.some((c) => c.name === 'captain_picked_up_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN captain_picked_up_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_group_id ON orders(order_group_id);');

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_stores (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      merchant_id TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      merchant_type TEXT NOT NULL DEFAULT 'supermarket',
      order_channel TEXT NOT NULL DEFAULT 'catalog',
      items_json TEXT NOT NULL DEFAULT '[]',
      free_order_text TEXT,
      prescription_image_url TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      commission_rate REAL,
      prep_status TEXT NOT NULL DEFAULT 'pending_merchant',
      pharmacist_notes TEXT,
      substitution_note TEXT,
      rejection_reason TEXT,
      ready_at TEXT,
      captain_picked_up_at TEXT,
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_order_stores_order_id ON order_stores(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_stores_merchant_id ON order_stores(merchant_id);
  `);
  const orderStoreCols = db.prepare("PRAGMA table_info('order_stores')").all() as Array<{ name: string }>;
  if (!orderStoreCols.some((c) => c.name === 'order_channel')) {
    db.exec("ALTER TABLE order_stores ADD COLUMN order_channel TEXT NOT NULL DEFAULT 'catalog'");
  }

  const tripCols = db.prepare("PRAGMA table_info('trips')").all() as Array<{ name: string }>;
  if (!tripCols.some((c) => c.name === 'pickup_lat')) {
    db.exec('ALTER TABLE trips ADD COLUMN pickup_lat REAL');
  }
  if (!tripCols.some((c) => c.name === 'pickup_lng')) {
    db.exec('ALTER TABLE trips ADD COLUMN pickup_lng REAL');
  }
  if (!tripCols.some((c) => c.name === 'dropoff_lat')) {
    db.exec('ALTER TABLE trips ADD COLUMN dropoff_lat REAL');
  }
  if (!tripCols.some((c) => c.name === 'dropoff_lng')) {
    db.exec('ALTER TABLE trips ADD COLUMN dropoff_lng REAL');
  }
  if (!tripCols.some((c) => c.name === 'captain_phone')) {
    db.exec('ALTER TABLE trips ADD COLUMN captain_phone TEXT');
  }
  if (!tripCols.some((c) => c.name === 'customer_proposed_fare')) {
    db.exec('ALTER TABLE trips ADD COLUMN customer_proposed_fare REAL');
  }
  if (!tripCols.some((c) => c.name === 'final_fare')) {
    db.exec('ALTER TABLE trips ADD COLUMN final_fare REAL');
  }
  if (!tripCols.some((c) => c.name === 'fare_updated_by')) {
    db.exec('ALTER TABLE trips ADD COLUMN fare_updated_by TEXT');
  }
  if (!tripCols.some((c) => c.name === 'preferred_captain_id')) {
    db.exec('ALTER TABLE trips ADD COLUMN preferred_captain_id TEXT');
  }
  if (!tripCols.some((c) => c.name === 'preferred_captain_name')) {
    db.exec('ALTER TABLE trips ADD COLUMN preferred_captain_name TEXT');
  }
  if (!tripCols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE trips ADD COLUMN customer_id TEXT');
  }

  const delCols = db.prepare("PRAGMA table_info('deliveries')").all() as Array<{ name: string }>;
  if (!delCols.some((c) => c.name === 'preferred_captain_id')) {
    db.exec('ALTER TABLE deliveries ADD COLUMN preferred_captain_id TEXT');
  }
  if (!delCols.some((c) => c.name === 'preferred_captain_name')) {
    db.exec('ALTER TABLE deliveries ADD COLUMN preferred_captain_name TEXT');
  }
  if (!delCols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE deliveries ADD COLUMN customer_id TEXT');
  }

  const capDocCols = db.prepare("PRAGMA table_info('captain_documents')").all() as Array<{ name: string }>;
  if (!capDocCols.some((c) => c.name === 'image_url')) {
    db.exec('ALTER TABLE captain_documents ADD COLUMN image_url TEXT');
  }

  const mktCols = db.prepare("PRAGMA table_info('market_listings')").all() as Array<{ name: string }>;
  if (!mktCols.some((c) => c.name === 'image_url')) {
    db.exec("ALTER TABLE market_listings ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }
  if (!mktCols.some((c) => c.name === 'seller_id')) {
    db.exec('ALTER TABLE market_listings ADD COLUMN seller_id TEXT');
  }

  const ratingCols = db.prepare("PRAGMA table_info('captain_ratings')").all() as Array<{ name: string }>;
  if (!ratingCols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE captain_ratings ADD COLUMN customer_id TEXT');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_trips_customer ON trips(customer_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON deliveries(customer_id);
    CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id);
    CREATE INDEX IF NOT EXISTS idx_captain_ratings_customer ON captain_ratings(customer_id);
  `);

  const capCols = db.prepare("PRAGMA table_info('captains')").all() as Array<{ name: string }>;
  if (!capCols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE captains ADD COLUMN username TEXT');
  }
  if (!capCols.some((c) => c.name === 'password_hash')) {
    db.exec("ALTER TABLE captains ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!capCols.some((c) => c.name === 'location_updated_at')) {
    db.exec('ALTER TABLE captains ADD COLUMN location_updated_at TEXT');
  }
  if (!capCols.some((c) => c.name === 'total_penalties')) {
    db.exec('ALTER TABLE captains ADD COLUMN total_penalties REAL NOT NULL DEFAULT 0');
  }

  const unmigratedCaps = db
    .prepare("SELECT id FROM captains WHERE username IS NULL OR TRIM(username) = '' OR password_hash IS NULL OR password_hash = ''")
    .all() as Array<{ id: string }>;
  if (unmigratedCaps.length > 0) {
    const defaultSeedUsernames: Record<string, string> = {
      cap_1: 'captain1',
      cap_2: 'captain2',
      cap_3: 'captain3',
      cap_4: 'captain4',
    };
    const defaultPwHash = hashPassword('123456');
    const updCapCred = db.prepare(`
      UPDATE captains SET
        username = COALESCE(NULLIF(TRIM(username), ''), ?),
        password_hash = CASE WHEN password_hash IS NULL OR password_hash = '' THEN ? ELSE password_hash END
      WHERE id = ?
    `);
    unmigratedCaps.forEach((row, idx) => {
      const fallbackUser = defaultSeedUsernames[row.id] || `captain_${row.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}_${idx + 1}`;
      updCapCred.run(fallbackUser, defaultPwHash, row.id);
    });
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_username_lower ON captains(LOWER(username))');

  const countServices = db.prepare('SELECT COUNT(*) as c FROM service_configs').get() as { c: number };
  if (countServices.c === 0) {
    seedInitialData();
  }

  // Always keep Otlobha Rides ("اطلبها مشوار") open & ready and enforce 10% platform commission
  db.prepare(`
    UPDATE service_configs
    SET is_enabled = 1, requires_license = 0, license_ready = 1, maintenance_msg_ar = '', updated_at = datetime('now')
    WHERE service_key = 'rides'
  `).run();
  db.prepare("UPDATE pricing_rules SET commission_rate = 10 WHERE service_type = 'rides'").run();

  // Ensure captains have a GPS timestamp and cap_1 can serve rides too
  db.prepare("UPDATE captains SET location_updated_at = COALESCE(location_updated_at, datetime('now'))").run();
  const cap1 = db.prepare('SELECT allowed_services_json FROM captains WHERE id = ?').get('cap_1') as
    | { allowed_services_json: string }
    | undefined;
  if (cap1) {
    const allowed = JSON.parse(cap1.allowed_services_json || '[]') as string[];
    if (!allowed.includes('rides')) allowed.push('rides');
    db.prepare('UPDATE captains SET is_eligible_for_rides = 1, allowed_services_json = ? WHERE id = ?').run(
      JSON.stringify(allowed),
      'cap_1'
    );
  }

  const countCats = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
  if (countCats.c === 0) {
    seedCatalogData();
  }

  const countNotifs = db.prepare('SELECT COUNT(*) as c FROM notifications').get() as { c: number };
  if (countNotifs.c === 0) {
    seedNotificationsData();
  }

  const countChats = db.prepare('SELECT COUNT(*) as c FROM order_chat_messages').get() as { c: number };
  if (countChats.c === 0) {
    seedOrderChatData();
  }

  const merCols = db.prepare("PRAGMA table_info('merchants')").all() as Array<{ name: string }>;
  const merAlterDefs: Array<[string, string]> = [
    ['email', 'ALTER TABLE merchants ADD COLUMN email TEXT'],
    ['password_hash', "ALTER TABLE merchants ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''"],
    ['whatsapp_phone', "ALTER TABLE merchants ADD COLUMN whatsapp_phone TEXT NOT NULL DEFAULT ''"],
    ['owner_name', "ALTER TABLE merchants ADD COLUMN owner_name TEXT NOT NULL DEFAULT ''"],
    ['owner_national_id', "ALTER TABLE merchants ADD COLUMN owner_national_id TEXT NOT NULL DEFAULT ''"],
    ['address_detail', "ALTER TABLE merchants ADD COLUMN address_detail TEXT NOT NULL DEFAULT ''"],
    ['commercial_reg_no', "ALTER TABLE merchants ADD COLUMN commercial_reg_no TEXT NOT NULL DEFAULT ''"],
    ['license_doc_url', "ALTER TABLE merchants ADD COLUMN license_doc_url TEXT NOT NULL DEFAULT ''"],
    ['payout_method', "ALTER TABLE merchants ADD COLUMN payout_method TEXT NOT NULL DEFAULT 'vodafone_cash'"],
    ['payout_account', "ALTER TABLE merchants ADD COLUMN payout_account TEXT NOT NULL DEFAULT ''"],
    ['working_hours', "ALTER TABLE merchants ADD COLUMN working_hours TEXT NOT NULL DEFAULT '09:00 ص - 12:00 م'"],
    ['terms_accepted', 'ALTER TABLE merchants ADD COLUMN terms_accepted INTEGER NOT NULL DEFAULT 0'],
    ['terms_accepted_at', 'ALTER TABLE merchants ADD COLUMN terms_accepted_at TEXT'],
    ['image_url', "ALTER TABLE merchants ADD COLUMN image_url TEXT NOT NULL DEFAULT ''"],
    ['is_email_verified', 'ALTER TABLE merchants ADD COLUMN is_email_verified INTEGER NOT NULL DEFAULT 0'],
    ['lat', 'ALTER TABLE merchants ADD COLUMN lat REAL'],
    ['lng', 'ALTER TABLE merchants ADD COLUMN lng REAL'],
  ];
  for (const [col, sql] of merAlterDefs) {
    if (!merCols.some((c) => c.name === col)) {
      db.exec(sql);
    }
  }
  db.exec('UPDATE merchants SET is_email_verified = 1 WHERE terms_accepted = 1 AND is_email_verified = 0');
  db.exec('UPDATE merchants SET lat = COALESCE(lat, 31.1583), lng = COALESCE(lng, 31.9369) WHERE lat IS NULL OR lng IS NULL');
  const defaultMerchantEmails: Record<string, string> = {
    mer_1: 'baraka@otlobha.eg',
    mer_2: 'manzala.fish@otlobha.eg',
    mer_3: 'shifa.pharmacy@otlobha.eg',
    mer_4: 'alnour.bakery@otlobha.eg',
  };
  const unmigratedMers = db
    .prepare("SELECT id FROM merchants WHERE email IS NULL OR TRIM(email) = ''")
    .all() as Array<{ id: string }>;
  if (unmigratedMers.length > 0) {
    const updMerEmail = db.prepare('UPDATE merchants SET email = ? WHERE id = ?');
    unmigratedMers.forEach((row, idx) => {
      updMerEmail.run(defaultMerchantEmails[row.id] || `merchant_${idx + 1}@otlobha.eg`, row.id);
    });
  }
  const unhashedMers = db
    .prepare("SELECT id FROM merchants WHERE password_hash IS NULL OR TRIM(password_hash) = ''")
    .all() as Array<{ id: string }>;
  if (unhashedMers.length > 0) {
    const defaultMerPwHash = hashPassword('123456');
    const updMerPw = db.prepare(
      "UPDATE merchants SET password_hash = ?, terms_accepted = 1, terms_accepted_at = COALESCE(terms_accepted_at, datetime('now')) WHERE id = ?"
    );
    for (const row of unhashedMers) {
      updMerPw.run(defaultMerPwHash, row.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_email_lower ON merchants(LOWER(email))');

  const catCols = db.prepare("PRAGMA table_info('categories')").all() as Array<{ name: string }>;
  if (!catCols.some((c) => c.name === 'merchant_id')) {
    db.exec('ALTER TABLE categories ADD COLUMN merchant_id TEXT');
  }
  if (!catCols.some((c) => c.name === 'image_url')) {
    db.exec("ALTER TABLE categories ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }
  if (!catCols.some((c) => c.name === 'is_offers_section')) {
    db.exec('ALTER TABLE categories ADD COLUMN is_offers_section INTEGER NOT NULL DEFAULT 0');
  }
  // Ensure each merchant has a dedicated Offers section ("العروض")
  const allMerchantsForOffers = db.prepare('SELECT id, merchant_type FROM merchants').all() as Array<{
    id: string;
    merchant_type: string;
  }>;
  const checkOfferCat = db.prepare(
    "SELECT id FROM categories WHERE merchant_id = ? AND (is_offers_section = 1 OR TRIM(name_ar) IN ('العروض', 'عروض المتجر'))"
  );
  const insertOfferCat = db.prepare(
    "INSERT OR IGNORE INTO categories (id, scope, merchant_id, name_ar, name_en, image_url, sort_order, is_offers_section, is_active) VALUES (?, ?, ?, 'العروض', 'Offers', '', 0, 1, 1)"
  );
  for (const m of allMerchantsForOffers) {
    const existingOffer = checkOfferCat.get(m.id) as { id: string } | undefined;
    if (!existingOffer) {
      const catScope = m.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant';
      insertOfferCat.run(`cat_offers_${m.id}`, catScope, m.id);
    } else {
      db.prepare('UPDATE categories SET is_offers_section = 1 WHERE id = ?').run(existingOffer.id);
    }
  }

  const custCols = db.prepare("PRAGMA table_info('customers')").all() as Array<{ name: string }>;
  if (!custCols.some((c) => c.name === 'email')) {
    const migrateCustTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE customers_new (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          phone TEXT,
          full_name TEXT NOT NULL DEFAULT 'عميل اطلبها',
          default_zone_id TEXT NOT NULL DEFAULT 'zn_city_center',
          address_landmark TEXT NOT NULL DEFAULT '',
          is_email_verified INTEGER NOT NULL DEFAULT 1,
          last_login_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const oldRows = db.prepare('SELECT * FROM customers').all() as Array<Record<string, unknown>>;
      const insNew = db.prepare(`
        INSERT INTO customers_new (id, email, phone, full_name, default_zone_id, address_landmark, is_email_verified, last_login_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
      `);
      const defaultCustEmails: Record<string, string> = {
        cust_1: 'ahmed.awad@otlobha.eg',
        cust_2: 'mona.ibrahim@otlobha.eg',
      };
      oldRows.forEach((r, idx) => {
        const em = defaultCustEmails[String(r.id)] || `customer_${idx + 1}@otlobha.eg`;
        insNew.run(
          r.id,
          em,
          r.phone ?? null,
          r.full_name ?? 'عميل اطلبها',
          r.default_zone_id ?? 'zn_city_center',
          r.address_landmark ?? '',
          r.last_login_at ?? null,
          r.created_at ?? null
        );
      });
      db.exec('DROP TABLE customers; ALTER TABLE customers_new RENAME TO customers;');
    });
    migrateCustTx();
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_lower ON customers(LOWER(email))');

  const checkCustCols = db.prepare("PRAGMA table_info('customers')").all() as Array<{ name: string }>;
  if (!checkCustCols.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }

  const countCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
  if (countCustomers.c === 0) {
    const insCust = db.prepare(`
      INSERT OR IGNORE INTO customers (id, email, phone, full_name, default_zone_id, address_landmark, is_email_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    insCust.run('cust_1', 'ahmed.awad@otlobha.eg', '01022334455', 'أحمد عوض', 'zn_city_center', 'شارع بورسعيد أمام مسجد الأنصار');
    insCust.run('cust_2', 'mona.ibrahim@otlobha.eg', '01055112233', 'منى إبراهيم', 'zn_basrat', 'بجوار المسجد الكبير - البصراط');
  }

  const custColsGps = db.prepare("PRAGMA table_info('customers')").all() as Array<{ name: string }>;
  if (!custColsGps.some((c) => c.name === 'last_lat')) {
    db.exec('ALTER TABLE customers ADD COLUMN last_lat REAL');
  }
  if (!custColsGps.some((c) => c.name === 'last_lng')) {
    db.exec('ALTER TABLE customers ADD COLUMN last_lng REAL');
  }
  if (!custColsGps.some((c) => c.name === 'location_updated_at')) {
    db.exec('ALTER TABLE customers ADD COLUMN location_updated_at TEXT');
  }
  db.prepare(`
    UPDATE customers
    SET last_lat = 31.1583, last_lng = 31.9369, location_updated_at = COALESCE(location_updated_at, datetime('now'))
    WHERE id = 'cust_1' AND (last_lat IS NULL OR last_lng IS NULL)
  `).run();
  db.prepare(`
    UPDATE customers
    SET last_lat = 31.1240, last_lng = 31.9610, location_updated_at = COALESCE(location_updated_at, datetime('now'))
    WHERE id = 'cust_2' AND (last_lat IS NULL OR last_lng IS NULL)
  `).run();

  const prodCols = db.prepare("PRAGMA table_info('products')").all() as Array<{ name: string }>;
  if (!prodCols.some((c) => c.name === 'product_code')) {
    db.exec('ALTER TABLE products ADD COLUMN product_code TEXT');
  }
  if (!prodCols.some((c) => c.name === 'is_offer')) {
    db.exec('ALTER TABLE products ADD COLUMN is_offer INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare(
    'UPDATE products SET is_offer = 1 WHERE is_offer = 0 AND sale_price IS NOT NULL AND sale_price < base_price'
  ).run();
  const uncodedProds = db
    .prepare("SELECT id FROM products WHERE product_code IS NULL OR TRIM(product_code) = '' ORDER BY created_at ASC, id ASC")
    .all() as Array<{ id: string }>;
  if (uncodedProds.length > 0) {
    let seq = 1001;
    const existingCodes = new Set(
      (
        db
          .prepare("SELECT product_code FROM products WHERE product_code IS NOT NULL AND TRIM(product_code) != ''")
          .all() as Array<{ product_code: string }>
      ).map((r) => r.product_code.toUpperCase())
    );
    const updCode = db.prepare('UPDATE products SET product_code = ? WHERE id = ?');
    for (const row of uncodedProds) {
      while (existingCodes.has(`PRD-${seq}`)) seq += 1;
      const code = `PRD-${seq}`;
      existingCodes.add(code);
      updCode.run(code, row.id);
      seq += 1;
    }
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code_lower ON products(LOWER(product_code)) WHERE TRIM(COALESCE(product_code, '')) != ''"
  );

  const countInvDesign = db.prepare('SELECT COUNT(*) as c FROM invoice_design_settings').get() as { c: number };
  if (countInvDesign.c === 0) {
    db.prepare('INSERT INTO invoice_design_settings (id, config_json) VALUES (?, ?)').run(
      'default',
      JSON.stringify({
        header_title: 'اطلبها – Otlobha المنزلة',
        header_subtitle: 'فاتورة توصيل ومشوار معتمدة للعميل',
        logo_url: '/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg',
        show_logo: true,
        support_phone: '01000000000',
        show_support_phone: true,
        show_captain_info: true,
        show_item_codes: true,
        show_qr_badge: true,
        footer_message: 'شكرًا لاستخدامكم تطبيق اطلبها – المنزلة',
        footer_note: 'خدمة سريعة تغطي المدينة والقرى',
        default_paper_width: '58mm',
        accent_color: '#A92224',
        font_scale: 'normal',
      })
    );
  }

  const countPaySettings = db.prepare('SELECT COUNT(*) as c FROM payment_settings').get() as { c: number };
  if (countPaySettings.c === 0) {
    db.prepare(`
      INSERT INTO payment_settings (
        id, cod_enabled, network_pos_enabled, wallet_enabled, online_card_enabled,
        cod_max_amount, network_min_amount, cod_instructions_ar, network_instructions_ar, wallet_instructions_ar
      ) VALUES (
        'default', 1, 1, 1, 0,
        5000, 10,
        'الدفع نقداً عند استلام الطلب من الكابتن',
        'الدفع ببطاقة مدى / فيزا / ماستركارد عبر ماكينة POS المحمولة مع الكابتن',
        'التحويل عبر المحافظ الإلكترونية أو فودافون كاش / إنستاباي'
      )
    `).run();
  }

  const supportTicketCount = (db.prepare('SELECT COUNT(*) as c FROM support_tickets').get() as { c: number }).c;
  if (supportTicketCount === 0) {
    db.prepare(`
      INSERT INTO support_tickets (
        id, ticket_number, customer_id, customer_name, customer_phone, customer_email, subject, category, status, last_message_at
      ) VALUES (
        'sup_1', 'SUP-1001', 'cust_1', 'أحمد عوض', '01022334455', 'ahmed.awad@otlobha.eg',
        'استفسار عن موعد توصيل طلب وتحديث العنوان', 'order_support', 'open', datetime('now')
      )
    `).run();
    db.prepare(`
      INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, message_text)
      VALUES ('sup_msg_1', 'sup_1', 'customer', 'أحمد عوض', 'مرحباً إدارة اطلبها، أحتاج التأكد من تحديث عنواني الجديد في شارع بورسعيد للطلبات القادمة.')
    `).run();
  }

  // Ensure token_version exists on user actor tables for session invalidation
  const capTvCols = db.prepare("PRAGMA table_info('captains')").all() as Array<{ name: string }>;
  if (!capTvCols.some((c) => c.name === 'token_version')) {
    db.exec('ALTER TABLE captains ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  const merTvCols = db.prepare("PRAGMA table_info('merchants')").all() as Array<{ name: string }>;
  if (!merTvCols.some((c) => c.name === 'token_version')) {
    db.exec('ALTER TABLE merchants ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  const custTvCols = db.prepare("PRAGMA table_info('customers')").all() as Array<{ name: string }>;
  if (!custTvCols.some((c) => c.name === 'token_version')) {
    db.exec('ALTER TABLE customers ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
}

export function ensureBootstrapSuperAdmin(): { created: boolean; reason?: string } {
  const existing = db
    .prepare("SELECT COUNT(*) as c FROM admin_users WHERE role_code = 'super_admin'")
    .get() as { c: number };
  if (existing.c > 0) {
    return { created: false, reason: 'already_exists' };
  }

  const rawEmail = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const rawPassword = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const fullName = String(process.env.SUPER_ADMIN_NAME || 'المؤسس / المدير العام').trim() || 'المؤسس / المدير العام';

  if (!rawEmail || !rawPassword) {
    console.warn(
      '[Auth] No super_admin account exists yet. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in environment variables to initialize the first Super Admin securely.'
    );
    return { created: false, reason: 'missing_env' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    console.warn('[Auth] SUPER_ADMIN_EMAIL is not a valid email address; skipping Super Admin bootstrap.');
    return { created: false, reason: 'invalid_email' };
  }

  if (rawPassword.length < 10) {
    console.warn('[Auth] SUPER_ADMIN_PASSWORD must be at least 10 characters; skipping Super Admin bootstrap.');
    return { created: false, reason: 'weak_password' };
  }

  const roleRow = db.prepare("SELECT code FROM roles WHERE code = 'super_admin'").get() as { code: string } | undefined;
  if (!roleRow) {
    console.warn('[Auth] super_admin role not found in roles table; skipping bootstrap.');
    return { created: false, reason: 'missing_role' };
  }

  const adminId = uid('adm');
  const pwHash = hashPassword(rawPassword);

  db.prepare(`
    INSERT INTO admin_users (id, email, password_hash, full_name, role_code, is_active, token_version)
    VALUES (?, ?, ?, ?, 'super_admin', 1, 0)
  `).run(adminId, rawEmail, pwHash, fullName);

  recordAuditLog({
    actor_name: fullName,
    actor_role: 'super_admin',
    action: 'SUPER_ADMIN_BOOTSTRAPPED',
    entity_type: 'admin_users',
    entity_id: adminId,
    details: `تهيئة حساب Super Admin الأول (${rawEmail}) عبر متغيرات البيئة`,
  });

  console.log(`[Auth] Initialized first Super Admin account for ${rawEmail}`);
  return { created: true };
}

function seedOrderChatData(): void {
  const ord2 = db.prepare('SELECT id FROM orders WHERE id = ?').get('ord_2');
  if (!ord2) return;
  const ins = db.prepare(`
    INSERT INTO order_chat_messages (id, order_id, sender_role, sender_name, message_text, image_url, is_delivery_proof)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  ins.run(
    'msg_seed_1',
    'ord_2',
    'captain',
    'محمود السيد عبده',
    'تم استلام طلب الصيدلية وأنا في الطريق إلى عنوانك أمام مدرسة المنزلة الثانوية.',
    null,
    0
  );
  ins.run(
    'msg_seed_2',
    'ord_2',
    'customer',
    'خالد محمد حسن',
    'شكرًا يا كابتن، لما توصل قدام البوابة ابعتلي صورة الطلب هنا.',
    null,
    0
  );
}

function seedNotificationsData(): void {
  const ins = db.prepare(`
    INSERT INTO notifications (id, target_app, target_zone, recipient_id, category, title_ar, body_ar, deep_link, fcm_topic, audience_count, is_read, sent_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Super Admin')
  `);
  ins.run(
    'ntf_cust_1',
    'customer',
    'وسط مدينة المنزلة',
    null,
    'promo',
    'خصم 20 ج.م على أول طلب بقالة أو طرد في المنزلة',
    'استخدم كود MANZALA20 عند إتمام الطلب من المتاجر أو خدمة اطلبها أي حاجة.',
    'stores',
    'otlobha_customer_manzala',
    1240
  );
  ins.run(
    'ntf_cust_2',
    'customer',
    'all',
    null,
    'operational',
    'اطلب روشتتك من صيدليات المنزلة المعتمدة',
    'صور الروشتة أو اكتب اسم الدواء وتواصل مباشرة مع الصيدلي المرخص.',
    'pharmacy',
    'otlobha_customer_all',
    2180
  );
  ins.run(
    'ntf_cap_1',
    'captain',
    'وسط مدينة المنزلة',
    null,
    'promo',
    'ساعات ذروة نشطة في وسط المنزلة والبصراط',
    'الطلب مرتفع الآن على توصيل المتاجر والطرود. فعّل حالة "متاح" لاستقبال أقرب طلب.',
    'orders',
    'otlobha_captain_manzala',
    42
  );
  ins.run(
    'ntf_cap_2',
    'captain',
    'all',
    null,
    'compliance',
    'تذكير: حد الكاش الأقصى 1000 ج.م وتوثيق رخصة المركبة',
    'يرجى مراجعة رصيد الكاش بيدك وتحديث صور المركبة السارية لتجنب إيقاف استقبال الطلبات.',
    'kyc_upload',
    'otlobha_captain_all',
    58
  );
}

function seedCatalogData(): void {
  const tx = db.transaction(() => {
    const cats: Array<[string, string, string, string, number]> = [
      ['cat_grocery', 'merchant', 'بقالة وسوبرماركت', 'Groceries & Pantry', 1],
      ['cat_dairy', 'merchant', 'ألبان وأجبان', 'Dairy & Cheese', 2],
      ['cat_seafood', 'merchant', 'أسماك ومشويات', 'Seafood & Grill', 3],
      ['cat_bakery', 'merchant', 'مخبوزات وحلويات', 'Bakery & Sweets', 4],
      ['cat_pharma_med', 'pharmacy', 'أدوية وعلاجات', 'Medicines', 1],
      ['cat_pharma_care', 'pharmacy', 'عناية شخصية ومستلزمات طبية', 'Medical & Personal Care', 2],
      ['cat_mkt_phones', 'market', 'هواتف وإلكترونيات', 'Phones & Electronics', 1],
      ['cat_mkt_home', 'market', 'منتجات يدوية ومنزلية', 'Handmade & Home', 2],
      ['cat_mkt_fashion', 'market', 'ملابس وأحذية', 'Clothing & Shoes', 3],
      ['cat_mkt_auto', 'market', 'مستلزمات سيارات وموتوسيكلات', 'Auto & Moto Parts', 4],
    ];
    const insCat = db.prepare('INSERT OR IGNORE INTO categories (id, scope, name_ar, name_en, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)');
    for (const c of cats) insCat.run(...c);

    const prods: Array<[string, string, string, string, string, string, string, number, number | null, number, number, number, string]> = [
      ['prd_1', 'mer_1', 'cat_grocery', 'أرز مصري فاخر 5 كجم', 'Premium Egyptian Rice 5kg', 'تعبئة حديثة حبة عريضة', '', 175, 165, 40, 8, 0, ''],
      ['prd_2', 'mer_1', 'cat_dairy', 'جبنة بيضاء طبيعي 500 جم', 'Natural White Cheese 500g', 'عبوة محكمة الغلق', '', 68, null, 25, 5, 0, 'عبوة 250 جم / 500 جم'],
      ['prd_3', 'mer_2', 'cat_seafood', 'وجبة سمك بوري مشوي بالردة (كيلو)', 'Grilled Mullet Fish 1kg', 'يُقدم مع أرز صيادية وسلطة طحينة', '', 260, 245, 15, 3, 0, 'إضافة سلطة إضافية +15 ج.م | أرز زيادة +25 ج.م'],
      ['prd_4', 'mer_3', 'cat_pharma_med', 'بنادول إكسترا 24 قرص', 'Panadol Extra 24 Tabs', 'مسكن وخافض حرارة', '', 54, null, 32, 6, 0, ''],
      ['prd_5', 'mer_3', 'cat_pharma_med', 'مضاد حيوي واسع المجال (بوصفة)', 'Antibiotic Rx Only', 'لا يُصرف إلا بعد مراجعة الصيدلي للروشتة', '', 118, null, 4, 5, 1, ''],
      ['prd_6', 'mer_4', 'cat_bakery', 'عيش فينو طازج (10 أرغفة)', 'Fresh Fino Bread (10 pcs)', 'مخبوز صباحي ساخن', '', 25, null, 60, 10, 0, ''],
    ];
    const insProd = db.prepare(`
      INSERT OR IGNORE INTO products (
        id, merchant_id, category_id, name_ar, name_en, description, image_url,
        base_price, sale_price, stock_quantity, low_stock_threshold, requires_prescription, addons_text, is_available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    for (const p of prods) insProd.run(...p);
  });
  tx();
}

export function recordAuditLog(params: {
  actor_name?: string;
  actor_role?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason?: string | null;
  details: string;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_name, actor_role, action, entity_type, entity_id, reason, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid('aud'),
    params.actor_name ?? 'المؤسس / المدير العام',
    params.actor_role ?? 'super_admin',
    params.action,
    params.entity_type,
    params.entity_id,
    params.reason ?? null,
    params.details
  );
}

export function postDoubleEntryLedger(params: {
  idempotency_base: string;
  reference_type: string;
  reference_id: string;
  description_ar: string;
  debit_account_code: string;
  debit_account_type: string;
  credit_account_code: string;
  credit_account_type: string;
  amount: number;
}): { group_id: string; duplicate: boolean } {
  if (params.amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  }
  const existing = db
    .prepare('SELECT transaction_group_id FROM ledger_entries WHERE idempotency_key = ?')
    .get(`${params.idempotency_base}:DR`) as { transaction_group_id: string } | undefined;

  if (existing) {
    return { group_id: existing.transaction_group_id, duplicate: true };
  }

  const groupId = uid('txg');
  const insertStmt = db.prepare(`
    INSERT INTO ledger_entries (
      id, transaction_group_id, account_code, account_type, debit, credit,
      reference_type, reference_id, description_ar, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runTx = db.transaction(() => {
    insertStmt.run(
      uid('led'),
      groupId,
      params.debit_account_code,
      params.debit_account_type,
      params.amount,
      0,
      params.reference_type,
      params.reference_id,
      params.description_ar,
      `${params.idempotency_base}:DR`
    );
    insertStmt.run(
      uid('led'),
      groupId,
      params.credit_account_code,
      params.credit_account_type,
      0,
      params.amount,
      params.reference_type,
      params.reference_id,
      params.description_ar,
      `${params.idempotency_base}:CR`
    );
  });

  runTx();
  return { group_id: groupId, duplicate: false };
}

function seedInitialData(): void {
  const seed = db.transaction(() => {
    // 1. Service Feature Flags (DEC-005 & Section 19)
    const services = [
      ['stores', 'اطلبها – المتاجر والطلبات اليومية', 'Otlobha Stores & Daily Orders', 1, 0, 1, 30, ''],
      ['parcels', 'اطلبها أي حاجة (الطرود)', 'Otlobha Anything (Parcels)', 1, 0, 1, 15, ''],
      ['pharmacy', 'اطلبها فارما (الصيدليات)', 'Otlobha Pharmacy', 1, 1, 1, 20, 'متاح عبر الصيدليات المرخصة المتعاقدة فقط'],
      ['market', 'السوق (Otlobha Market)', 'Otlobha Market C2C', 1, 0, 1, 50, ''],
      ['rides', 'اطلبها مشوار (النقل الذكي)', 'Otlobha Rides', 1, 0, 1, 15, ''],
      ['wallet', 'المحفظة الإلكترونية المفتوحة', 'Otlobha Open Wallet', 0, 1, 0, 10, 'مفعّل كرصيد تسويات داخلي لحين التعاقد مع مقدم دفع مرخص'],
    ];
    const insertService = db.prepare(`
      INSERT INTO service_configs (service_key, name_ar, name_en, is_enabled, requires_license, license_ready, min_order_amount, maintenance_msg_ar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of services) insertService.run(...s);

    // 2. El Manzala Zones & Villages
    const zones = [
      ['zn_city_center', 'وسط مدينة المنزلة (شارع حسن طوبار وبورسعيد)', 'El Manzala City Center', 'city_core', 31.1583, 31.9369, 2.5, 0, 1],
      ['zn_basrat', 'قرية البصراط', 'Al-Basrat Village', 'village', 31.124, 31.961, 3.0, 12, 1],
      ['zn_tawabrah', 'قرية الطوابرة', 'Al-Tawabrah Village', 'village', 31.142, 31.908, 2.5, 10, 1],
      ['zn_meet_sherif', 'قرية ميت شريف', 'Meet Sherif Village', 'village', 31.175, 31.912, 2.5, 10, 1],
      ['zn_aziza', 'قرية العزيزة', 'Al-Aziza Village', 'village', 31.192, 31.948, 3.0, 15, 1],
      ['zn_rawdah', 'قرية الرودة والجماملة', 'Al-Rawdah & Al-Gamamla', 'village', 31.116, 31.894, 3.5, 18, 1],
      ['zn_mataria_edge', 'نطاق المطرية المجاور', 'Al-Matariya Border', 'neighbor_center', 31.183, 32.031, 4.0, 25, 0],
    ];
    const insertZone = db.prepare(`
      INSERT INTO service_zones (id, name_ar, name_en, zone_type, center_lat, center_lng, radius_km, remote_area_fee, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const z of zones) insertZone.run(...z);

    // 3. Dynamic Pricing Rules
    const rules = [
      ['pr_stores', 'delivery_stores', 'تسعير توصيل المتاجر والمطاعم', 'Stores Delivery Pricing', 'stores', 'all', 12, 2.0, 4.0, 0, 0, 12, 8, 1.0, 10, 10, 85, 2, 150, 1],
      ['pr_pharmacy', 'delivery_pharmacy', 'تسعير توصيل الصيدليات (فارما)', 'Pharmacy Delivery Pricing', 'pharmacy', 'all', 12, 2.0, 4.0, 0, 0, 12, 10, 1.0, 10, 8, 85, 2, 120, 1],
      ['pr_parcels', 'delivery_parcels', 'تسعير نقل الطرود (أي حاجة)', 'Parcels Pricing', 'parcels', 'all', 18, 2.5, 5.0, 0, 0, 18, 12, 1.0, 15, 20, 80, 5, 250, 1],
      ['pr_ride_moto', 'ride_moto', 'مشوار – موتوسيكل (Moto)', 'Ride - Motorcycle', 'rides', 'moto', 10, 1.5, 3.5, 1.0, 3, 15, 0, 1.0, 10, 10, 85, 3, 100, 1],
      ['pr_ride_tuktuk', 'ride_tuktuk', 'مشوار – توكتوك مرخص (TukTuk)', 'Ride - TukTuk', 'rides', 'tuktuk', 12, 1.5, 4.5, 1.25, 3, 20, 0, 1.0, 12, 10, 85, 3, 120, 1],
      ['pr_ride_car', 'ride_car', 'مشوار – سيارة (Car)', 'Ride - Car', 'rides', 'car', 20, 2.0, 7.0, 2.0, 3, 35, 0, 1.0, 20, 10, 85, 5, 300, 1],
      ['pr_market', 'market_c2c', 'عمولة السوق (Otlobha Market)', 'Market C2C Commission', 'market', 'all', 0, 0, 0, 0, 0, 0, 0, 1.0, 0, 5, 0, 10, 500, 1],
    ];
    const insertRule = db.prepare(`
      INSERT INTO pricing_rules (
        id, rule_code, title_ar, title_en, service_type, vehicle_type, base_fee, base_distance_km,
        per_km_rate, per_min_waiting_rate, waiting_grace_min, min_fare, express_fee, peak_multiplier,
        cancellation_fee, commission_rate, captain_delivery_share_pct, min_commission, max_commission, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rules) insertRule.run(...r);

    // 4. Dispatch Config
    db.prepare(`
      INSERT INTO dispatch_config (
        id, weight_proximity, weight_acceptance, weight_rating, weight_idle_time,
        offer_timeout_sec, initial_radius_km, expanded_radius_km, max_radius_km,
        max_rejections_before_alert, default_cash_limit
      ) VALUES ('default', 0.50, 0.25, 0.15, 0.10, 25, 2.0, 5.0, 12.0, 3, 1000)
    `).run();

    // 5. 9 RBAC Roles (Section 19)
    const roles = [
      ['super_admin', 'المالك وصاحب الصلاحية العليا', 'Super Admin', JSON.stringify(['*'])],
      ['general_manager', 'المدير العام', 'General Manager', JSON.stringify(['services.manage', 'pricing.manage', 'reports.view', 'captains.review', 'merchants.verify'])],
      ['operations_manager', 'مدير التشغيل', 'Operations Manager', JSON.stringify(['dispatch.manage', 'orders.reassign', 'zones.manage', 'captains.monitor'])],
      ['finance_manager', 'المدير المالي', 'Finance Manager', JSON.stringify(['ledger.view', 'settlements.approve', 'wallet.adjust_with_reason', 'refunds.process', 'coupons.manage'])],
      ['captain_manager', 'مسؤول الكباتن', 'Captain Manager', JSON.stringify(['captains.review', 'captains.suspend', 'docs.verify'])],
      ['merchant_manager', 'مسؤول التجار', 'Merchant Manager', JSON.stringify(['merchants.verify', 'merchants.commission', 'orders.view'])],
      ['market_moderator', 'مشرف السوق', 'Market Moderator', JSON.stringify(['market.approve', 'market.delete', 'market.disputes'])],
      ['customer_support', 'خدمة العملاء', 'Customer Support', JSON.stringify(['complaints.resolve', 'orders.view', 'refunds.request'])],
      ['pharmacy_supervisor', 'مشرف الصيدليات', 'Pharmacy Supervisor', JSON.stringify(['pharmacy.verify_license', 'prescriptions.audit', 'complaints.pharmacy'])],
    ];
    const insertRole = db.prepare('INSERT INTO roles (code, name_ar, name_en, permissions_json) VALUES (?, ?, ?, ?)');
    for (const role of roles) insertRole.run(...role);

    // 6. Captains + Docs
    const defaultPwHash = hashPassword('123456');
    const captains = [
      ['cap_1', 'usr_cap_1', 'captain1', defaultPwHash, 'محمود السيد عبده', '01011223344', '29805121201451', 'المنزلة', 'وسط مدينة المنزلة', 'moto', 'هوجان 4 - 2023', 'د ق 4821', 1, JSON.stringify(['stores', 'pharmacy', 'parcels', 'rides']), 'approved', null, 'available', 31.1592, 31.9375, 240, 1000, 4.9, 96, 1.5, 42, 22],
      ['cap_2', 'usr_cap_2', 'captain2', defaultPwHash, 'أحمد رضا الشربيني', '01099887766', '29509181203319', 'المنزلة', 'قرية البصراط', 'tuktuk', 'باجاج مرخص 2022', 'د هـ 9104', 1, JSON.stringify(['stores', 'parcels', 'rides']), 'approved', null, 'available', 31.1480, 31.9460, 480, 1000, 4.7, 91, 3.0, 29, 38],
      ['cap_3', 'usr_cap_3', 'captain3', defaultPwHash, 'إسلام فتحي محمد', '01233445566', '30001051208812', 'المنزلة', 'قرية الطوابرة', 'moto', 'دايون 40 - 2024', 'د ط 1152', 0, JSON.stringify(['stores', 'parcels']), 'under_review', null, 'offline', 31.1440, 31.9150, 0, 1000, 5.0, 100, 0, 0, 0],
      ['cap_4', 'usr_cap_4', 'captain4', defaultPwHash, 'كريم طارق العيسوي', '01144556677', '29211221204471', 'المنزلة', 'وسط مدينة المنزلة', 'car', 'هيونداي أكسنت 2021', 'د ص 7720', 1, JSON.stringify(['stores', 'parcels', 'rides']), 'approved', null, 'busy', 31.1605, 31.9340, 910, 1000, 4.8, 88, 2.0, 18, 5],
    ];
    const insertCap = db.prepare(`
      INSERT INTO captains (
        id, user_id, username, password_hash, full_name, phone, national_id, city, zone_name, vehicle_type, vehicle_model,
        plate_number, is_eligible_for_rides, allowed_services_json, verification_status, rejection_reason,
        availability_status, lat, lng, cash_on_hand, cash_limit, rating_avg, acceptance_rate,
        cancellation_rate, completed_count, idle_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of captains) insertCap.run(...c);

    const docTypes = [
      ['vehicle_front', 'صورة المركبة من الأمام'],
      ['vehicle_back', 'صورة المركبة من الخلف'],
      ['vehicle_right', 'الجانب الأيمن للمركبة'],
      ['vehicle_left', 'الجانب الأيسر للمركبة'],
      ['vehicle_plate', 'صورة لوحة المركبة'],
      ['vehicle_license', 'رخصة المركبة السارية'],
      ['driving_license', 'رخصة القيادة'],
      ['national_id_front', 'الرقم القومي'],
      ['selfie', 'الصورة الشخصية المباشرة'],
    ];
    const insertDoc = db.prepare(`
      INSERT INTO captain_documents (id, captain_id, doc_type, label_ar, review_status, expires_at, review_note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [dt, label] of docTypes) {
      insertDoc.run(uid('doc'), 'cap_1', dt, label, 'approved', '2027-08-01', null);
      insertDoc.run(uid('doc'), 'cap_2', dt, label, 'approved', '2027-04-15', null);
      insertDoc.run(uid('doc'), 'cap_3', dt, label, dt === 'vehicle_license' ? 'pending' : 'pending', '2026-12-30', dt === 'vehicle_plate' ? 'يُرجى التحقق من وضوح رقم اللوحة' : null);
    }

    // 7. Merchants & Pharmacies in El Manzala
    const merchants = [
      ['mer_1', 'baraka@otlobha.eg', 'سوبرماركت البركة', 'Al-Baraka Supermarket', 'supermarket', 'فرع شارع حسن طوبار', 'وسط مدينة المنزلة', '01020304050', 10, 'approved', 1, 1, null, null, null, 24],
      ['mer_2', 'manzala.fish@otlobha.eg', 'أسماك ومشويات بحيرة المنزلة', 'Manzala Lake Grill & Fish', 'restaurant', 'فرع شارع بورسعيد', 'وسط مدينة المنزلة', '01060708090', 12, 'approved', 1, 1, null, null, null, 19],
      ['mer_3', 'shifa.pharmacy@otlobha.eg', 'صيدلية الشفاء الحديثة', 'Al-Shifa Modern Pharmacy', 'pharmacy', 'فرع ميدان المحطة', 'وسط مدينة المنزلة', '01288990011', 8, 'approved', 1, 1, 'PH-DK-44912', 'د. سارة أحمد المتولي', 'SYN-18842', 14],
      ['mer_4', 'alnour.bakery@otlobha.eg', 'مخبز وحلواني النور', 'Al-Nour Bakery', 'bakery', 'مدخل البصراط', 'قرية البصراط', '01122339988', 10, 'pending', 1, 1, null, null, null, 0],
    ];
    const insertMer = db.prepare(`
      INSERT INTO merchants (
        id, email, business_name_ar, business_name_en, merchant_type, branch_name, zone_name,
        phone, commission_rate, verification_status, supports_free_order, is_open_now,
        pharmacy_license_no, pharmacist_name, syndicate_no, orders_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of merchants) insertMer.run(...m);

    // 8. Orders & Prescriptions
    const orders = [
      ['ord_1', 'OTL-1001', 'منى إبراهيم', '01055112233', 'mer_1', 'سوبرماركت البركة', 'supermarket', null, null, 'قرية البصراط', 'بجوار المسجد الكبير - البصراط', 'free_text', '2 كيلو سكر + زجاجة زيت + علبة جبنة عبور لاند كبيرة + عيش فينو', 0, 'awaiting_quote', 0, 24, 0, 24, 'cash', null, null, null],
      ['ord_2', 'OTL-1002', 'خالد محمد حسن', '01277441122', 'mer_3', 'صيدلية الشفاء الحديثة', 'pharmacy', 'cap_1', 'محمود السيد عبده', 'وسط مدينة المنزلة', 'أمام مدرسة المنزلة الثانوية', 'prescription', 'صورة روشتة مرفقة (علاج ضغط ومكمل فيتامين د)', 1, 'preparing', 215, 22, 0, 237, 'cash', 'reviewed', 'الروشتة سارية ولا توجد أصناف جدول. تم تأكيد التوافر.', 'الشركة الأساسية غير متوفرة؛ وافق العميل على البديل المماثل بنفس المادة الفعالة'],
      ['ord_3', 'OTL-1003', 'أحمد عوض', '01099114422', 'mer_2', 'أسماك ومشويات بحيرة المنزلة', 'restaurant', 'cap_1', 'محمود السيد عبده', 'وسط مدينة المنزلة', 'شارع المستشفى - عمارة 4', 'catalog', null, 0, 'delivered', 320, 14, 20, 314, 'cash', null, null, null],
    ];
    const insertOrd = db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_name, customer_phone, merchant_id, merchant_name, merchant_type,
        captain_id, captain_name, zone_name, address_landmark, order_channel, free_order_text,
        is_express, status, subtotal, delivery_fee, discount_amount, total_amount, payment_method,
        prescription_status, pharmacist_notes, substitution_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const o of orders) insertOrd.run(...o);

    // 9. Market Listings
    const listings = [
      ['mkt_1', 'مصطفى جمال', '01033221199', 'هواتف وإلكترونيات', 'هاتف سامسونج A54 استخدام خفيف بالكرتونة', 'حالة ممتازة بدون خدوش - ضمان متبقي 4 شهور', 'used', 11500, 1, 'وسط مدينة المنزلة', 1, 'pending', 0, 0],
      ['mkt_2', 'فاطمة حسن', '01199002233', 'منتجات يدوية ومنزلية', 'طقم مفارش كروشيه شغل يدوي 6 قطع', 'صناعة يدوية خيوط قطن مصري', 'new', 850, 3, 'قرية الطوابرة', 0, 'approved', 0, 850],
      ['mkt_3', 'مستخدم غير موثق', '01511220099', 'أدوية ومكملات', 'علب مكملات مستوردة بدون ترخيص', 'عرض مشبوه مخالف لسياسة المواد المحظورة', 'new', 1200, 5, 'وسط مدينة المنزلة', 1, 'pending', 2, 0],
    ];
    const insertMkt = db.prepare(`
      INSERT INTO market_listings (
        id, seller_name, seller_phone, category_ar, title, description, condition, price,
        quantity, zone_name, is_negotiable, moderation_status, reports_count, escrow_held_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of listings) insertMkt.run(...l);

    // 10. Wallets & Ledger & Settlements
    const wallets = [
      ['wal_cust_1', 'usr_cust_3', 'أحمد عوض (عميل)', 'customer', 45, 0, 0],
      ['wal_cap_1', 'usr_cap_1', 'محمود السيد عبده (كابتن)', 'captain', 610, 0, 0],
      ['wal_mer_1', 'mer_1', 'سوبرماركت البركة (تاجر)', 'merchant', 1420, 215, 0],
      ['wal_mkt_2', 'usr_seller_2', 'فاطمة حسن (بائع السوق)', 'market_seller', 0, 807.5, 0],
    ];
    const insertWal = db.prepare('INSERT INTO wallets (id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const w of wallets) insertWal.run(...w);

    postDoubleEntryLedger({
      idempotency_base: 'seed_ord_3_comm',
      reference_type: 'order',
      reference_id: 'ord_3',
      description_ar: 'استحقاق عمولة طلب #OTL-1003 (أسماك بحيرة المنزلة)',
      debit_account_code: 'CASH_CAPTAIN_cap_1',
      debit_account_type: 'cash_clearing',
      credit_account_code: 'PLATFORM_REVENUE_STORES',
      credit_account_type: 'platform_revenue',
      amount: 40.5,
    });

    postDoubleEntryLedger({
      idempotency_base: 'seed_mkt_2_escrow',
      reference_type: 'market_listing',
      reference_id: 'mkt_2',
      description_ar: 'حجز مبلغ الضمان المؤقت (Escrow) لصفقة طقم كروشيه',
      debit_account_code: 'GATEWAY_CLEARING',
      debit_account_type: 'gateway_clearing',
      credit_account_code: 'ESCROW_HOLD_mkt_2',
      credit_account_type: 'escrow_hold',
      amount: 850,
    });

    const settlements = [
      ['set_1', 'محمود السيد عبده', 'captain', 720, 110, 610, 'vodafone_cash', 'requested'],
      ['set_2', 'سوبرماركت البركة', 'merchant', 1580, 160, 1420, 'instapay', 'approved'],
    ];
    const insertSet = db.prepare('INSERT INTO settlements (id, beneficiary_name, beneficiary_type, gross_earnings, deducted_commissions, net_payout, payout_method, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const st of settlements) insertSet.run(...st);

    // 11. Coupons & Complaints
    db.prepare(`
      INSERT INTO coupons (id, code, applicable_services_json, discount_type, discount_value, max_discount, min_order_amount, funded_by, used_count, usage_limit_total, is_active)
      VALUES ('cpn_1', 'MANZALA20', '["stores","parcels"]', 'fixed', 20, 20, 120, 'platform', 14, 200, 1)
    `).run();

    db.prepare(`
      INSERT INTO complaints (id, ticket_number, complainant_name, service_type, category, description, status, resolution_notes)
      VALUES ('cmp_1', 'TKT-401', 'علاء محمود', 'stores', 'late_delivery', 'تأخر الطلب 20 دقيقة بسبب زحام طريق البصراط', 'open', NULL)
    `).run();

    // 12. Financial Model Config
    db.prepare(`
      INSERT INTO financial_model_settings (id, config_json) VALUES ('default', ?)
    `).run(JSON.stringify({
      monthly_orders_conservative: 300,
      monthly_orders_moderate: 1500,
      monthly_orders_optimistic: 4500,
      store_share_pct: 60,
      parcel_share_pct: 20,
      ride_share_pct: 15,
      market_share_pct: 5,
      avg_store_basket: 200,
      avg_delivery_fee: 20,
      avg_parcel_fee: 30,
      avg_ride_fare: 40,
      avg_market_price: 600,
      store_commission_pct: 10,
      platform_delivery_share_pct: 15,
      parcel_commission_pct: 20,
      ride_commission_pct: 15,
      market_commission_pct: 5,
      variable_cost_per_tx: 4,
      fixed_cost_conservative: 3500,
      fixed_cost_moderate: 15000,
      fixed_cost_optimistic: 32000,
    }));

    // Initial Audit Log
    recordAuditLog({
      actor_name: 'النظام التأسيسي',
      actor_role: 'super_admin',
      action: 'SYSTEM_INITIALIZED',
      entity_type: 'platform',
      entity_id: 'otlobha_manzala',
      reason: 'تأسيس المنظومة بقاعدة بيانات المنزلة المبدئية',
      details: 'تم تهيئة قواعد التسعير والتوزيع ومناطق المنزلة والدفتر المالي المركزي.',
    });
  });

  seed();
}
