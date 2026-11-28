import type { Express, Request, Response } from 'express';
import { db, uid, recordAuditLog } from './db.ts';
import {
  ALL_ADMIN_ROLES,
  optionalAuth,
  requireAuth,
  requireRole,
  type AuthContext,
} from './auth.ts';
import type { PushChannelId } from './pushService.ts';

export type StoreFollowerEventType =
  | 'new_offer'
  | 'limited_discount'
  | 'new_product'
  | 'back_in_stock';

export interface StoresReviewsDeps {
  enqueueSystemPushNotification: (input: {
    targetApp: 'customer' | 'captain' | 'merchant' | 'all';
    targetZone?: string;
    recipientId?: string | null;
    category?: 'operational' | 'promo' | 'alert' | 'compliance';
    titleAr: string;
    bodyAr: string;
    deepLink?: string;
    orderId?: string | null;
    tripId?: string | null;
    parcelId?: string | null;
    status?: string | null;
    channelId?: PushChannelId;
    sentBy?: string;
    extraData?: Record<string, string>;
  }) => unknown;
  broadcastToRooms?: (roomKeys: string[], payload: Record<string, unknown>) => void;
}

let notifyFollowersImpl:
  | ((params: {
      merchantId: string;
      eventType: StoreFollowerEventType;
      titleAr: string;
      bodyAr: string;
      refId?: string;
    }) => { sent: number; skipped: number })
  | null = null;

export function notifyStoreFollowers(params: {
  merchantId: string;
  eventType: StoreFollowerEventType;
  titleAr: string;
  bodyAr: string;
  refId?: string;
}): { sent: number; skipped: number } {
  if (!notifyFollowersImpl) return { sent: 0, skipped: 0 };
  return notifyFollowersImpl(params);
}

export function initStoresReviewsSchema(): void {
  // Non-destructive column additions on existing merchants table (never changes IDs or category relations)
  const merchantCols = db.prepare("PRAGMA table_info('merchants')").all() as Array<{ name: string }>;
  const hasCol = (name: string) => merchantCols.some((c) => c.name === name);
  if (!hasCol('cover_image_url')) {
    db.exec("ALTER TABLE merchants ADD COLUMN cover_image_url TEXT NOT NULL DEFAULT ''");
  }
  if (!hasCol('description_ar')) {
    db.exec("ALTER TABLE merchants ADD COLUMN description_ar TEXT NOT NULL DEFAULT ''");
  }
  if (!hasCol('lat')) {
    db.exec('ALTER TABLE merchants ADD COLUMN lat REAL');
  }
  if (!hasCol('lng')) {
    db.exec('ALTER TABLE merchants ADD COLUMN lng REAL');
  }
  if (!hasCol('share_slug')) {
    db.exec('ALTER TABLE merchants ADD COLUMN share_slug TEXT');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_share_slug
      ON merchants(share_slug) WHERE share_slug IS NOT NULL AND share_slug != '';

    CREATE TABLE IF NOT EXISTS store_reviews (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_name_display TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
      hidden_reason TEXT,
      moderated_by TEXT,
      moderated_at TEXT,
      editable_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(merchant_id, customer_id, order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_reviews_merchant_status ON store_reviews(merchant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_store_reviews_customer ON store_reviews(customer_id);

    CREATE TABLE IF NOT EXISTS product_reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_name_display TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      image_urls_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
      hidden_reason TEXT,
      moderated_by TEXT,
      moderated_at TEXT,
      editable_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, customer_id, order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_reviews_product_status ON product_reviews(product_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_product_reviews_merchant ON product_reviews(merchant_id, status);

    CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY,
      review_type TEXT NOT NULL CHECK (review_type IN ('store', 'product')),
      review_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reporter_role TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(review_type, review_id, reporter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_type, review_id);

    CREATE TABLE IF NOT EXISTS store_follows (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      notify_new_offers INTEGER NOT NULL DEFAULT 1,
      notify_discounts INTEGER NOT NULL DEFAULT 1,
      notify_new_products INTEGER NOT NULL DEFAULT 1,
      notify_back_in_stock INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(customer_id, merchant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_follows_merchant ON store_follows(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_store_follows_customer ON store_follows(customer_id);

    CREATE TABLE IF NOT EXISTS store_notification_throttle (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ref_id TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_store_notif_throttle_lookup
      ON store_notification_throttle(merchant_id, customer_id, event_type, sent_at);

    CREATE TABLE IF NOT EXISTS store_review_settings (
      id TEXT PRIMARY KEY,
      edit_window_hours INTEGER NOT NULL DEFAULT 72,
      notification_cooldown_minutes INTEGER NOT NULL DEFAULT 120,
      max_daily_store_notifications INTEGER NOT NULL DEFAULT 3,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`
    INSERT OR IGNORE INTO store_review_settings (id, edit_window_hours, notification_cooldown_minutes, max_daily_store_notifications)
    VALUES ('default', 72, 120, 3)
  `).run();
}

function getReviewSettings(): {
  edit_window_hours: number;
  notification_cooldown_minutes: number;
  max_daily_store_notifications: number;
} {
  const row = db
    .prepare(
      'SELECT edit_window_hours, notification_cooldown_minutes, max_daily_store_notifications FROM store_review_settings WHERE id = ?'
    )
    .get('default') as
    | {
        edit_window_hours?: number;
        notification_cooldown_minutes?: number;
        max_daily_store_notifications?: number;
      }
    | undefined;
  return {
    edit_window_hours: Math.max(1, Math.min(720, Number(row?.edit_window_hours ?? 72))),
    notification_cooldown_minutes: Math.max(1, Math.min(10080, Number(row?.notification_cooldown_minutes ?? 120))),
    max_daily_store_notifications: Math.max(1, Math.min(20, Number(row?.max_daily_store_notifications ?? 3))),
  };
}

function safeDisplayName(fullName: string | null | undefined): string {
  const clean = String(fullName || '').trim();
  if (!clean) return 'عميل اطلبها';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0].slice(0, 32);
  // Show first name + first letter of second name for customer privacy
  const secondInitial = parts[1].charAt(0);
  return `${parts[0].slice(0, 20)} ${secondInitial}.`;
}

function isSafeImageUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(u) && u.length <= 600_000) {
    return true;
  }
  if (u.length > 1000) return false;
  if (u.startsWith('/uploads/') || u.startsWith('/assets/')) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveMerchantByIdOrSlug(idOrSlug: string): Record<string, unknown> | undefined {
  const clean = String(idOrSlug || '').trim();
  if (!clean) return undefined;
  return db
    .prepare('SELECT * FROM merchants WHERE id = ? OR LOWER(share_slug) = LOWER(?) LIMIT 1')
    .get(clean, clean) as Record<string, unknown> | undefined;
}

function computeStoreRatingSummary(merchantId: string): {
  rating_avg: number;
  rating_count: number;
  distribution: Record<string, number>;
} {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg_rating
       FROM store_reviews
       WHERE merchant_id = ? AND status = 'visible'`
    )
    .get(merchantId) as { cnt?: number; avg_rating?: number } | undefined;

  const distRows = db
    .prepare(
      `SELECT rating, COUNT(*) AS cnt
       FROM store_reviews
       WHERE merchant_id = ? AND status = 'visible'
       GROUP BY rating`
    )
    .all(merchantId) as Array<{ rating: number; cnt: number }>;

  const distribution: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
  for (const r of distRows) {
    const key = String(r.rating);
    if (key in distribution) distribution[key] = Number(r.cnt || 0);
  }

  const count = Number(agg?.cnt || 0);
  const avg = count > 0 ? Math.round(Number(agg?.avg_rating || 0) * 10) / 10 : 0;
  return { rating_avg: avg, rating_count: count, distribution };
}

function computeProductRatingSummary(productId: string): {
  rating_avg: number;
  rating_count: number;
} {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg_rating
       FROM product_reviews
       WHERE product_id = ? AND status = 'visible'`
    )
    .get(productId) as { cnt?: number; avg_rating?: number } | undefined;
  const count = Number(agg?.cnt || 0);
  const avg = count > 0 ? Math.round(Number(agg?.avg_rating || 0) * 10) / 10 : 0;
  return { rating_avg: avg, rating_count: count };
}

function isReviewStillEditable(editableUntil: string | null | undefined): boolean {
  if (!editableUntil) return false;
  const iso = editableUntil.includes('T') ? editableUntil : `${editableUntil.replace(' ', 'T')}Z`;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() <= ts;
}

function getDeliveredCustomerOrdersForMerchant(customerId: string, merchantId: string): Array<{
  order_id: string;
  order_number: string;
  created_at: string;
  total_amount: number;
}> {
  const rows = db
    .prepare(
      `SELECT DISTINCT o.id AS order_id, o.order_number, o.created_at, o.total_amount
       FROM orders o
       LEFT JOIN order_stores os ON os.order_id = o.id
       WHERE o.customer_id = ?
         AND o.status = 'delivered'
         AND (
           o.merchant_id = ?
           OR (os.merchant_id = ? AND COALESCE(os.prep_status, '') != 'cancelled')
         )
       ORDER BY datetime(o.created_at) DESC`
    )
    .all(customerId, merchantId, merchantId) as Array<{
    order_id: string;
    order_number: string;
    created_at: string;
    total_amount: number;
  }>;
  return rows;
}

function orderContainsProduct(orderId: string, productId: string): boolean {
  const checkItemsJson = (raw: unknown): boolean => {
    if (!raw || typeof raw !== 'string') return false;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      return parsed.some((it) => {
        if (!it || typeof it !== 'object') return false;
        const rec = it as Record<string, unknown>;
        const status = String(rec.status || '').toLowerCase();
        if (status === 'rejected' || status === 'cancelled') return false;
        return String(rec.product_id || rec.id || '') === productId;
      });
    } catch {
      return false;
    }
  };

  const ord = db.prepare('SELECT items_json FROM orders WHERE id = ?').get(orderId) as
    | { items_json?: string | null }
    | undefined;
  if (checkItemsJson(ord?.items_json)) return true;

  const sections = db
    .prepare("SELECT items_json FROM order_stores WHERE order_id = ? AND COALESCE(prep_status, '') != 'cancelled'")
    .all(orderId) as Array<{ items_json?: string | null }>;
  for (const s of sections) {
    if (checkItemsJson(s.items_json)) return true;
  }
  return false;
}

function getDeliveredCustomerOrdersForProduct(customerId: string, productId: string): Array<{
  order_id: string;
  order_number: string;
  created_at: string;
}> {
  const delivered = db
    .prepare(
      `SELECT id, order_number, created_at
       FROM orders
       WHERE customer_id = ? AND status = 'delivered'
       ORDER BY datetime(created_at) DESC`
    )
    .all(customerId) as Array<{ id: string; order_number: string; created_at: string }>;

  const matched: Array<{ order_id: string; order_number: string; created_at: string }> = [];
  for (const o of delivered) {
    if (orderContainsProduct(o.id, productId)) {
      matched.push({ order_id: o.id, order_number: o.order_number, created_at: o.created_at });
    }
  }
  return matched;
}

function buildPublicOrigin(req: Request): string {
  const envUrl = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function registerStoresReviewsRoutes(app: Express, deps: StoresReviewsDeps): void {
  initStoresReviewsSchema();

  // Wire up follower notification broadcaster with preferences & anti-spam throttling
  notifyFollowersImpl = ({ merchantId, eventType, titleAr, bodyAr, refId }) => {
    const cleanMerchantId = String(merchantId || '').trim();
    if (!cleanMerchantId) return { sent: 0, skipped: 0 };

    const prefCol =
      eventType === 'new_offer'
        ? 'notify_new_offers'
        : eventType === 'limited_discount'
          ? 'notify_discounts'
          : eventType === 'new_product'
            ? 'notify_new_products'
            : 'notify_back_in_stock';

    const settings = getReviewSettings();
    const followers = db
      .prepare(
        `SELECT sf.customer_id, c.default_zone_id
         FROM store_follows sf
         JOIN customers c ON c.id = sf.customer_id
         WHERE sf.merchant_id = ? AND sf.${prefCol} = 1`
      )
      .all(cleanMerchantId) as Array<{ customer_id: string; default_zone_id?: string | null }>;

    if (followers.length === 0) return { sent: 0, skipped: 0 };

    const cooldownCutoff = `-${settings.notification_cooldown_minutes} minutes`;
    let sent = 0;
    let skipped = 0;

    const checkRecentSameEvent = db.prepare(
      `SELECT 1 FROM store_notification_throttle
       WHERE merchant_id = ? AND customer_id = ? AND event_type = ?
         AND datetime(sent_at) >= datetime('now', ?)
       LIMIT 1`
    );
    const checkDailyCap = db.prepare(
      `SELECT COUNT(*) AS cnt FROM store_notification_throttle
       WHERE merchant_id = ? AND customer_id = ?
         AND datetime(sent_at) >= datetime('now', '-24 hours')`
    );
    const insertThrottle = db.prepare(
      `INSERT INTO store_notification_throttle (id, merchant_id, customer_id, event_type, ref_id)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const f of followers) {
      const recentlySent = checkRecentSameEvent.get(cleanMerchantId, f.customer_id, eventType, cooldownCutoff);
      if (recentlySent) {
        skipped++;
        continue;
      }
      const dailyCount = Number(
        (checkDailyCap.get(cleanMerchantId, f.customer_id) as { cnt?: number } | undefined)?.cnt || 0
      );
      if (dailyCount >= settings.max_daily_store_notifications) {
        skipped++;
        continue;
      }

      insertThrottle.run(uid('snt'), cleanMerchantId, f.customer_id, eventType, refId || null);
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        targetZone: String(f.default_zone_id || 'all'),
        recipientId: f.customer_id,
        category: 'promo',
        titleAr,
        bodyAr,
        deepLink: `merchant:${cleanMerchantId}`,
        channelId: 'otlobha_promos_channel',
        sentBy: 'إشعار متجر متابع',
        extraData: {
          merchant_id: cleanMerchantId,
          event_type: eventType,
          ref_id: refId || '',
        },
      });
      sent++;
    }

    return { sent, skipped };
  };

  // =========================================================================
  // 1. PUBLIC / CUSTOMER INDEPENDENT STORE PAGE API
  // =========================================================================

  app.get('/api/stores/:merchantId', (req: Request, res: Response) => {
    const auth: AuthContext | null = optionalAuth(req);
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'المتجر غير موجود' });
    }
    const merchantId = String(merchant.id);
    const isAdmin = Boolean(auth && (ALL_ADMIN_ROLES as readonly string[]).includes(auth.role));
    if (String(merchant.verification_status || '') !== 'approved' && !isAdmin && auth?.id !== merchantId) {
      return res.status(404).json({ error: 'المتجر غير متاح حالياً' });
    }

    const ratingSummary = computeStoreRatingSummary(merchantId);
    const followersRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM store_follows WHERE merchant_id = ?')
      .get(merchantId) as { cnt?: number } | undefined;
    const followersCount = Number(followersRow?.cnt || 0);

    // Internal store categories derived strictly from existing categories + products (no new category system)
    const storeCategories = db
      .prepare(
        `SELECT
           c.id,
           c.name_ar,
           c.name_en,
           c.image_url,
           c.parent_id,
           c.sort_order,
           COUNT(p.id) AS products_count
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.merchant_id = ? AND c.is_active = 1
         GROUP BY c.id
         ORDER BY c.sort_order ASC, products_count DESC, c.name_ar ASC`
      )
      .all(merchantId) as Array<Record<string, unknown>>;

    const prodStats = db
      .prepare(
        `SELECT
           COUNT(*) AS total_products,
           SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END) AS available_products,
           SUM(CASE WHEN is_available = 1 AND (is_offer = 1 OR (sale_price IS NOT NULL AND sale_price < base_price)) THEN 1 ELSE 0 END) AS offers_count
         FROM products
         WHERE merchant_id = ?`
      )
      .get(merchantId) as {
      total_products?: number;
      available_products?: number;
      offers_count?: number;
    };

    const deals = db
      .prepare(
        `SELECT id, product_id, deal_type, title_ar, subtitle_ar, required_qty, free_qty, discount_amount, discount_percent, min_amount, created_at
         FROM product_deals
         WHERE merchant_id = ? AND is_active = 1
         ORDER BY datetime(created_at) DESC
         LIMIT 20`
      )
      .all(merchantId);

    // Customer-specific state (follow, notification prefs, review eligibility)
    let isFollowing = false;
    let notificationPrefs = {
      notify_new_offers: true,
      notify_discounts: true,
      notify_new_products: true,
      notify_back_in_stock: true,
    };
    let eligibleOrdersForReview: Array<{
      order_id: string;
      order_number: string;
      created_at: string;
      total_amount: number;
    }> = [];
    let myReviews: Array<Record<string, unknown>> = [];

    if (auth && auth.role === 'customer') {
      const followRow = db
        .prepare(
          `SELECT notify_new_offers, notify_discounts, notify_new_products, notify_back_in_stock
           FROM store_follows
           WHERE customer_id = ? AND merchant_id = ?`
        )
        .get(auth.id, merchantId) as Record<string, number> | undefined;
      if (followRow) {
        isFollowing = true;
        notificationPrefs = {
          notify_new_offers: Boolean(followRow.notify_new_offers),
          notify_discounts: Boolean(followRow.notify_discounts),
          notify_new_products: Boolean(followRow.notify_new_products),
          notify_back_in_stock: Boolean(followRow.notify_back_in_stock),
        };
      }

      const deliveredOrders = getDeliveredCustomerOrdersForMerchant(auth.id, merchantId);
      const existingMyReviews = db
        .prepare(
          `SELECT id, order_id, rating, comment, status, editable_until, created_at, updated_at
           FROM store_reviews
           WHERE merchant_id = ? AND customer_id = ?
           ORDER BY datetime(created_at) DESC`
        )
        .all(merchantId, auth.id) as Array<Record<string, unknown>>;

      const reviewedOrderIds = new Set(existingMyReviews.map((r) => String(r.order_id)));
      eligibleOrdersForReview = deliveredOrders.filter((o) => !reviewedOrderIds.has(o.order_id));
      myReviews = existingMyReviews
        .filter((r) => String(r.status) === 'visible')
        .map((r) => ({
          ...r,
          can_edit: isReviewStillEditable(r.editable_until as string | null),
        }));
    }

    const origin = buildPublicOrigin(req);
    const stableKey = String(merchant.share_slug || '').trim() || merchantId;
    const shareUrl = `${origin}/store/${encodeURIComponent(stableKey)}`;
    const deepLinkUrl = `otlobha://store/${encodeURIComponent(merchantId)}`;
    const settings = getReviewSettings();

    res.json({
      store: {
        id: merchantId,
        share_slug: String(merchant.share_slug || ''),
        business_name_ar: String(merchant.business_name_ar || ''),
        business_name_en: String(merchant.business_name_en || ''),
        merchant_type: String(merchant.merchant_type || 'supermarket'),
        branch_name: String(merchant.branch_name || ''),
        zone_name: String(merchant.zone_name || ''),
        address_detail: String(merchant.address_detail || ''),
        working_hours: String(merchant.working_hours || '09:00 ص - 12:00 م'),
        description_ar: String(merchant.description_ar || ''),
        image_url: String(merchant.image_url || ''),
        cover_image_url: String(merchant.cover_image_url || ''),
        phone: String(merchant.phone || ''),
        whatsapp_phone: String(merchant.whatsapp_phone || ''),
        lat: merchant.lat != null ? Number(merchant.lat) : null,
        lng: merchant.lng != null ? Number(merchant.lng) : null,
        is_open_now: Boolean(merchant.is_open_now),
        is_open: Boolean(merchant.is_open_now),
        supports_free_order: Boolean(merchant.supports_free_order),
        verification_status: String(merchant.verification_status || 'approved'),
        orders_count: Number(merchant.orders_count || 0),
        rating_avg: ratingSummary.rating_avg,
        rating_count: ratingSummary.rating_count,
        rating_distribution: ratingSummary.distribution,
        followers_count: followersCount,
        total_products: Number(prodStats?.total_products || 0),
        available_products: Number(prodStats?.available_products || 0),
        offers_count: Number(prodStats?.offers_count || 0),
        share_url: shareUrl,
        deep_link_url: deepLinkUrl,
      },
      categories: storeCategories.map((c) => ({
        id: String(c.id),
        name_ar: String(c.name_ar || ''),
        name_en: String(c.name_en || ''),
        icon: String(c.icon || ''),
        image_url: String(c.image_url || ''),
        parent_id: c.parent_id ? String(c.parent_id) : null,
        products_count: Number(c.products_count || 0),
      })),
      deals,
      customer_state: {
        is_authenticated: Boolean(auth && auth.role === 'customer'),
        is_following: isFollowing,
        notification_prefs: notificationPrefs,
        eligible_orders_for_review: eligibleOrdersForReview,
        can_review: eligibleOrdersForReview.length > 0,
        my_reviews: myReviews,
        edit_window_hours: settings.edit_window_hours,
      },
    });
  });

  // Paginated Store Products API (strictly uses existing products & categories tables)
  app.get('/api/stores/:merchantId/products', (req: Request, res: Response) => {
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
    const merchantId = String(merchant.id);

    const categoryId = String(req.query.category_id || '').trim();
    const offersOnly = String(req.query.offers_only || '') === '1' || String(req.query.offers_only || '') === 'true';
    const includeUnavailable = String(req.query.include_unavailable || '1') !== '0';
    const q = String(req.query.q || '').trim();
    const sort = String(req.query.sort || 'default').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ['p.merchant_id = ?'];
    const params: unknown[] = [merchantId];

    if (!includeUnavailable) {
      where.push('p.is_available = 1');
    }
    if (categoryId) {
      where.push('p.category_id = ?');
      params.push(categoryId);
    }
    if (offersOnly) {
      where.push('(p.is_offer = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price))');
    }
    if (q) {
      where.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const whereSql = where.join(' AND ');
    const orderBySql =
      sort === 'price_asc'
        ? 'p.is_available DESC, COALESCE(p.sale_price, p.base_price) ASC'
        : sort === 'price_desc'
          ? 'p.is_available DESC, COALESCE(p.sale_price, p.base_price) DESC'
          : sort === 'newest'
            ? 'p.is_available DESC, datetime(p.created_at) DESC'
            : sort === 'offers'
              ? 'p.is_available DESC, p.is_offer DESC, (CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.base_price THEN 1 ELSE 0 END) DESC, p.name_ar ASC'
              : 'p.is_available DESC, p.is_offer DESC, datetime(p.created_at) DESC';

    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM products p WHERE ${whereSql}`)
      .get(...params) as { cnt?: number };
    const total = Number(countRow?.cnt || 0);

    const rows = db
      .prepare(
        `SELECT
           p.*,
           c.name_ar AS category_name_ar,
           m.business_name_ar AS merchant_name_ar,
           (SELECT ROUND(AVG(pr.rating), 1) FROM product_reviews pr WHERE pr.product_id = p.id AND pr.status = 'visible') AS product_rating_avg,
           (SELECT COUNT(*) FROM product_reviews pr WHERE pr.product_id = p.id AND pr.status = 'visible') AS product_rating_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN merchants m ON m.id = p.merchant_id
         WHERE ${whereSql}
         ORDER BY ${orderBySql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    const products = rows.map((r) => {
      const basePrice = Number(r.base_price || 0);
      const salePrice = r.sale_price != null ? Number(r.sale_price) : null;
      const effectivePrice = salePrice != null && salePrice > 0 && salePrice < basePrice ? salePrice : basePrice;
      const discountPct =
        salePrice != null && basePrice > 0 && salePrice < basePrice
          ? Math.round(((basePrice - salePrice) / basePrice) * 100)
          : 0;
      return {
        ...r,
        base_price: basePrice,
        sale_price: salePrice,
        effective_price: effectivePrice,
        discount_percent: discountPct,
        is_available: Boolean(r.is_available),
        is_offer: Boolean(r.is_offer) || discountPct > 0,
        is_weighted: Boolean(r.is_weighted),
        weight_step: Number(r.weight_step || 0.25),
        weight_unit: String(r.weight_unit || 'كجم'),
        requires_prescription: Boolean(r.requires_prescription),
        product_rating_avg: r.product_rating_avg != null ? Number(r.product_rating_avg) : 0,
        product_rating_count: Number(r.product_rating_count || 0),
      };
    });

    res.json({
      products,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        has_more: offset + products.length < total,
      },
    });
  });

  // =========================================================================
  // 2. STORE REVIEWS API (SEPARATE FROM CAPTAIN & PRODUCT REVIEWS)
  // =========================================================================

  app.get('/api/stores/:merchantId/reviews', (req: Request, res: Response) => {
    const auth = optionalAuth(req);
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
    const merchantId = String(merchant.id);

    const sort = String(req.query.sort || 'newest').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '15'), 10) || 15));
    const offset = (page - 1) * limit;

    const orderBy =
      sort === 'highest'
        ? 'sr.rating DESC, datetime(sr.created_at) DESC'
        : sort === 'lowest'
          ? 'sr.rating ASC, datetime(sr.created_at) DESC'
          : 'datetime(sr.created_at) DESC';

    const summary = computeStoreRatingSummary(merchantId);
    const rows = db
      .prepare(
        `SELECT
           sr.id,
           sr.merchant_id,
           sr.customer_id,
           sr.order_id,
           sr.customer_name_display,
           sr.rating,
           sr.comment,
           sr.editable_until,
           sr.created_at,
           sr.updated_at,
           o.order_number
         FROM store_reviews sr
         LEFT JOIN orders o ON o.id = sr.order_id
         WHERE sr.merchant_id = ? AND sr.status = 'visible'
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      )
      .all(merchantId, limit, offset) as Array<Record<string, unknown>>;

    const reviews = rows.map((r) => {
      const isMine = Boolean(auth && auth.role === 'customer' && auth.id === String(r.customer_id));
      return {
        id: String(r.id),
        merchant_id: String(r.merchant_id),
        customer_name_display: String(r.customer_name_display || 'عميل اطلبها'),
        rating: Number(r.rating),
        comment: String(r.comment || ''),
        verified_purchase: true,
        order_number_short: r.order_number ? `#${String(r.order_number).slice(-4)}` : null,
        is_mine: isMine,
        can_edit: isMine && isReviewStillEditable(r.editable_until as string | null),
        editable_until: isMine ? r.editable_until : undefined,
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || ''),
      };
    });

    res.json({
      summary,
      reviews,
      pagination: {
        page,
        limit,
        total: summary.rating_count,
        has_more: offset + reviews.length < summary.rating_count,
      },
    });
  });

  app.post('/api/stores/:merchantId/reviews', requireAuth, requireRole('customer'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
    const merchantId = String(merchant.id);

    const rating = Math.trunc(Number(req.body?.rating));
    const comment = String(req.body?.comment || '').trim();
    const orderId = String(req.body?.order_id || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'يرجى اختيار تقييم صحيح من 1 إلى 5 نجوم' });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ error: 'التعليق طويل جداً (الحد الأقصى 1000 حرف)' });
    }
    if (!orderId) {
      return res.status(400).json({ error: 'لا يمكن تقييم المتجر إلا بناءً على طلب مكتمل' });
    }

    // Verify customer owns this completed order for this merchant
    const deliveredOrders = getDeliveredCustomerOrdersForMerchant(auth.id, merchantId);
    const eligibleOrder = deliveredOrders.find((o) => o.order_id === orderId);
    if (!eligibleOrder) {
      return res.status(403).json({
        error: 'عذراً، لا يمكنك تقييم هذا المتجر إلا بعد إكمال واستلام طلب حقيقي منه.',
      });
    }

    const dup = db
      .prepare('SELECT id FROM store_reviews WHERE merchant_id = ? AND customer_id = ? AND order_id = ?')
      .get(merchantId, auth.id, orderId);
    if (dup) {
      return res.status(409).json({ error: 'لقد قمت بتقييم هذا المتجر بالفعل لهذا الطلب' });
    }

    const settings = getReviewSettings();
    const reviewId = uid('srev');
    const displayName = safeDisplayName(auth.fullName);

    db.prepare(
      `INSERT INTO store_reviews (
         id, merchant_id, customer_id, order_id, customer_name_display,
         rating, comment, status, editable_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'visible', datetime('now', ?))`
    ).run(reviewId, merchantId, auth.id, orderId, displayName, rating, comment, `+${settings.edit_window_hours} hours`);

    const created = db.prepare('SELECT * FROM store_reviews WHERE id = ?').get(reviewId) as Record<string, unknown>;
    const summary = computeStoreRatingSummary(merchantId);

    res.status(201).json({
      ok: true,
      review: {
        id: String(created.id),
        merchant_id: merchantId,
        order_id: orderId,
        customer_name_display: String(created.customer_name_display),
        rating: Number(created.rating),
        comment: String(created.comment || ''),
        is_mine: true,
        can_edit: true,
        editable_until: created.editable_until,
        created_at: created.created_at,
      },
      summary,
    });
  });

  app.patch(
    '/api/stores/:merchantId/reviews/:reviewId',
    requireAuth,
    requireRole('customer'),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
      if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
      const merchantId = String(merchant.id);
      const reviewId = String(req.params.reviewId || '').trim();

      const existing = db
        .prepare('SELECT * FROM store_reviews WHERE id = ? AND merchant_id = ?')
        .get(reviewId, merchantId) as Record<string, unknown> | undefined;
      if (!existing) return res.status(404).json({ error: 'التقييم غير موجود' });
      if (String(existing.customer_id) !== auth.id) {
        return res.status(403).json({ error: 'غير مصرح لك بتعديل تقييم عميل آخر' });
      }
      if (String(existing.status) !== 'visible') {
        return res.status(403).json({ error: 'لا يمكن تعديل تقييم مخفي أو محذوف' });
      }
      if (!isReviewStillEditable(existing.editable_until as string | null)) {
        return res.status(403).json({ error: 'انتهت الفترة المسموح بها لتعديل هذا التقييم' });
      }

      const rating = req.body?.rating !== undefined ? Math.trunc(Number(req.body.rating)) : Number(existing.rating);
      const comment = req.body?.comment !== undefined ? String(req.body.comment).trim() : String(existing.comment || '');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'يرجى اختيار تقييم صحيح من 1 إلى 5 نجوم' });
      }
      if (comment.length > 1000) {
        return res.status(400).json({ error: 'التعليق طويل جداً (الحد الأقصى 1000 حرف)' });
      }

      db.prepare(
        `UPDATE store_reviews
         SET rating = ?, comment = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(rating, comment, reviewId);

      const summary = computeStoreRatingSummary(merchantId);
      res.json({ ok: true, id: reviewId, rating, comment, summary });
    }
  );

  // =========================================================================
  // 3. INDEPENDENT PRODUCT REVIEWS API
  // =========================================================================

  app.get('/api/products/:productId/reviews', (req: Request, res: Response) => {
    const auth = optionalAuth(req);
    const productId = String(req.params.productId || '').trim();
    const product = db.prepare('SELECT id, merchant_id, name_ar FROM products WHERE id = ?').get(productId) as
      | { id: string; merchant_id: string; name_ar: string }
      | undefined;
    if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });

    const sort = String(req.query.sort || 'newest').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '15'), 10) || 15));
    const offset = (page - 1) * limit;

    const orderBy =
      sort === 'highest'
        ? 'pr.rating DESC, datetime(pr.created_at) DESC'
        : 'datetime(pr.created_at) DESC';

    const summary = computeProductRatingSummary(productId);
    const rows = db
      .prepare(
        `SELECT pr.*, o.order_number
         FROM product_reviews pr
         LEFT JOIN orders o ON o.id = pr.order_id
         WHERE pr.product_id = ? AND pr.status = 'visible'
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      )
      .all(productId, limit, offset) as Array<Record<string, unknown>>;

    const reviews = rows.map((r) => {
      const isMine = Boolean(auth && auth.role === 'customer' && auth.id === String(r.customer_id));
      let imageUrls: string[] = [];
      try {
        const parsed = JSON.parse(String(r.image_urls_json || '[]'));
        if (Array.isArray(parsed)) imageUrls = parsed.filter((u) => typeof u === 'string' && isSafeImageUrl(u));
      } catch {
        imageUrls = [];
      }
      return {
        id: String(r.id),
        product_id: productId,
        merchant_id: String(r.merchant_id),
        customer_name_display: String(r.customer_name_display || 'عميل اطلبها'),
        rating: Number(r.rating),
        comment: String(r.comment || ''),
        image_urls: imageUrls,
        verified_purchase: true,
        is_mine: isMine,
        can_edit: isMine && isReviewStillEditable(r.editable_until as string | null),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || ''),
      };
    });

    let eligibleOrders: Array<{ order_id: string; order_number: string; created_at: string }> = [];
    if (auth && auth.role === 'customer') {
      const allPurchased = getDeliveredCustomerOrdersForProduct(auth.id, productId);
      const reviewedIds = new Set(
        (
          db
            .prepare('SELECT order_id FROM product_reviews WHERE product_id = ? AND customer_id = ?')
            .all(productId, auth.id) as Array<{ order_id: string }>
        ).map((x) => x.order_id)
      );
      eligibleOrders = allPurchased.filter((o) => !reviewedIds.has(o.order_id));
    }

    res.json({
      summary,
      reviews,
      can_review: eligibleOrders.length > 0,
      eligible_orders: eligibleOrders,
      pagination: {
        page,
        limit,
        total: summary.rating_count,
        has_more: offset + reviews.length < summary.rating_count,
      },
    });
  });

  app.post('/api/products/:productId/reviews', requireAuth, requireRole('customer'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const productId = String(req.params.productId || '').trim();
    const product = db.prepare('SELECT id, merchant_id FROM products WHERE id = ?').get(productId) as
      | { id: string; merchant_id: string }
      | undefined;
    if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });

    const rating = Math.trunc(Number(req.body?.rating));
    const comment = String(req.body?.comment || '').trim();
    const orderId = String(req.body?.order_id || '').trim();
    const rawImages = Array.isArray(req.body?.image_urls) ? req.body.image_urls : [];
    const imageUrls = rawImages
      .filter((u: unknown): u is string => typeof u === 'string' && isSafeImageUrl(u))
      .slice(0, 4);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'يرجى اختيار تقييم صحيح من 1 إلى 5 نجوم' });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ error: 'التعليق طويل جداً (الحد الأقصى 1000 حرف)' });
    }
    if (!orderId) {
      return res.status(400).json({ error: 'لا يمكن تقييم المنتج إلا بعد شرائه واستلامه في طلب مكتمل' });
    }

    const purchasedOrders = getDeliveredCustomerOrdersForProduct(auth.id, productId);
    if (!purchasedOrders.some((o) => o.order_id === orderId)) {
      return res.status(403).json({
        error: 'عذراً، يمكنك تقييم هذا المنتج فقط بعد شرائه واستلام الطلب بنجاح.',
      });
    }

    const dup = db
      .prepare('SELECT id FROM product_reviews WHERE product_id = ? AND customer_id = ? AND order_id = ?')
      .get(productId, auth.id, orderId);
    if (dup) {
      return res.status(409).json({ error: 'لقد قمت بتقييم هذا المنتج بالفعل لهذا الطلب' });
    }

    const settings = getReviewSettings();
    const id = uid('prev');
    const displayName = safeDisplayName(auth.fullName);

    db.prepare(
      `INSERT INTO product_reviews (
         id, product_id, merchant_id, customer_id, order_id,
         customer_name_display, rating, comment, image_urls_json, status, editable_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', datetime('now', ?))`
    ).run(
      id,
      productId,
      product.merchant_id,
      auth.id,
      orderId,
      displayName,
      rating,
      comment,
      JSON.stringify(imageUrls),
      `+${settings.edit_window_hours} hours`
    );

    const summary = computeProductRatingSummary(productId);
    res.status(201).json({
      ok: true,
      review: {
        id,
        product_id: productId,
        merchant_id: product.merchant_id,
        customer_name_display: displayName,
        rating,
        comment,
        image_urls: imageUrls,
        is_mine: true,
        can_edit: true,
      },
      summary,
    });
  });

  app.patch(
    '/api/products/:productId/reviews/:reviewId',
    requireAuth,
    requireRole('customer'),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const productId = String(req.params.productId || '').trim();
      const reviewId = String(req.params.reviewId || '').trim();

      const existing = db
        .prepare('SELECT * FROM product_reviews WHERE id = ? AND product_id = ?')
        .get(reviewId, productId) as Record<string, unknown> | undefined;
      if (!existing) return res.status(404).json({ error: 'تقييم المنتج غير موجود' });
      if (String(existing.customer_id) !== auth.id) {
        return res.status(403).json({ error: 'غير مصرح لك بتعديل تقييم عميل آخر' });
      }
      if (String(existing.status) !== 'visible') {
        return res.status(403).json({ error: 'لا يمكن تعديل تقييم مخفي' });
      }
      if (!isReviewStillEditable(existing.editable_until as string | null)) {
        return res.status(403).json({ error: 'انتهت الفترة المسموح بها لتعديل هذا التقييم' });
      }

      const rating = req.body?.rating !== undefined ? Math.trunc(Number(req.body.rating)) : Number(existing.rating);
      const comment = req.body?.comment !== undefined ? String(req.body.comment).trim() : String(existing.comment || '');
      const imageUrlsJson =
        Array.isArray(req.body?.image_urls)
          ? JSON.stringify(
              req.body.image_urls
                .filter((u: unknown): u is string => typeof u === 'string' && isSafeImageUrl(u))
                .slice(0, 4)
            )
          : String(existing.image_urls_json || '[]');

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'يرجى اختيار تقييم صحيح من 1 إلى 5 نجوم' });
      }
      if (comment.length > 1000) {
        return res.status(400).json({ error: 'التعليق طويل جداً (الحد الأقصى 1000 حرف)' });
      }

      db.prepare(
        `UPDATE product_reviews
         SET rating = ?, comment = ?, image_urls_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(rating, comment, imageUrlsJson, reviewId);

      const summary = computeProductRatingSummary(productId);
      res.json({ ok: true, id: reviewId, rating, comment, summary });
    }
  );

  // =========================================================================
  // 4. REPORT ABUSIVE REVIEW (ANY AUTHENTICATED USER)
  // =========================================================================

  app.post('/api/reviews/report', requireAuth, (req: Request, res: Response) => {
    const auth = req.auth!;
    const reviewType = String(req.body?.review_type || 'store').trim();
    const reviewId = String(req.body?.review_id || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim().slice(0, 600);

    if (reviewType !== 'store' && reviewType !== 'product') {
      return res.status(400).json({ error: 'نوع التقييم غير صالح' });
    }
    if (!reviewId || !reason) {
      return res.status(400).json({ error: 'يرجى تحديد التقييم وسبب البلاغ' });
    }

    const reviewRow =
      reviewType === 'store'
        ? (db.prepare('SELECT id, merchant_id FROM store_reviews WHERE id = ?').get(reviewId) as
            | { id: string; merchant_id: string }
            | undefined)
        : (db.prepare('SELECT id, merchant_id FROM product_reviews WHERE id = ?').get(reviewId) as
            | { id: string; merchant_id: string }
            | undefined);

    if (!reviewRow) {
      return res.status(404).json({ error: 'التقييم المبلغ عنه غير موجود' });
    }

    const dup = db
      .prepare('SELECT id FROM review_reports WHERE review_type = ? AND review_id = ? AND reporter_id = ?')
      .get(reviewType, reviewId, auth.id);
    if (dup) {
      return res.status(409).json({ error: 'لقد قمت بالإبلاغ عن هذا التعليق مسبقاً، وهو قيد مراجعة الإدارة' });
    }

    const reportId = uid('rrp');
    db.prepare(
      `INSERT INTO review_reports (id, review_type, review_id, merchant_id, reporter_id, reporter_role, reason, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(reportId, reviewType, reviewId, reviewRow.merchant_id, auth.id, auth.role, reason.slice(0, 120), details);

    res.status(201).json({ ok: true, id: reportId, message: 'تم إرسال البلاغ للإدارة للمراجعة بنجاح' });
  });

  // =========================================================================
  // 5. FOLLOW / FAVORITE STORES & NOTIFICATION PREFERENCES
  // =========================================================================

  app.post('/api/stores/:merchantId/follow', requireAuth, requireRole('customer'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
    const merchantId = String(merchant.id);

    const notifyOffers = req.body?.notify_new_offers !== false ? 1 : 0;
    const notifyDiscounts = req.body?.notify_discounts !== false ? 1 : 0;
    const notifyNewProducts = req.body?.notify_new_products !== false ? 1 : 0;
    const notifyBackInStock = req.body?.notify_back_in_stock !== false ? 1 : 0;

    db.prepare(
      `INSERT INTO store_follows (
         id, customer_id, merchant_id,
         notify_new_offers, notify_discounts, notify_new_products, notify_back_in_stock
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(customer_id, merchant_id) DO UPDATE SET
         notify_new_offers = excluded.notify_new_offers,
         notify_discounts = excluded.notify_discounts,
         notify_new_products = excluded.notify_new_products,
         notify_back_in_stock = excluded.notify_back_in_stock`
    ).run(uid('sfl'), auth.id, merchantId, notifyOffers, notifyDiscounts, notifyNewProducts, notifyBackInStock);

    const cntRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM store_follows WHERE merchant_id = ?')
      .get(merchantId) as { cnt?: number };

    res.json({
      ok: true,
      is_following: true,
      followers_count: Number(cntRow?.cnt || 0),
      notification_prefs: {
        notify_new_offers: Boolean(notifyOffers),
        notify_discounts: Boolean(notifyDiscounts),
        notify_new_products: Boolean(notifyNewProducts),
        notify_back_in_stock: Boolean(notifyBackInStock),
      },
    });
  });

  app.delete('/api/stores/:merchantId/follow', requireAuth, requireRole('customer'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
    const merchantId = String(merchant.id);

    db.prepare('DELETE FROM store_follows WHERE customer_id = ? AND merchant_id = ?').run(auth.id, merchantId);
    const cntRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM store_follows WHERE merchant_id = ?')
      .get(merchantId) as { cnt?: number };

    res.json({
      ok: true,
      is_following: false,
      followers_count: Number(cntRow?.cnt || 0),
    });
  });

  app.patch(
    '/api/stores/:merchantId/follow/preferences',
    requireAuth,
    requireRole('customer'),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const merchant = resolveMerchantByIdOrSlug(req.params.merchantId);
      if (!merchant) return res.status(404).json({ error: 'المتجر غير موجود' });
      const merchantId = String(merchant.id);

      const existing = db
        .prepare('SELECT * FROM store_follows WHERE customer_id = ? AND merchant_id = ?')
        .get(auth.id, merchantId) as Record<string, number> | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'أنت لا تتابع هذا المتجر حالياً' });
      }

      const nextOffers =
        req.body?.notify_new_offers !== undefined ? (req.body.notify_new_offers ? 1 : 0) : existing.notify_new_offers;
      const nextDiscounts =
        req.body?.notify_discounts !== undefined ? (req.body.notify_discounts ? 1 : 0) : existing.notify_discounts;
      const nextNewProds =
        req.body?.notify_new_products !== undefined
          ? req.body.notify_new_products
            ? 1
            : 0
          : existing.notify_new_products;
      const nextBackInStock =
        req.body?.notify_back_in_stock !== undefined
          ? req.body.notify_back_in_stock
            ? 1
            : 0
          : existing.notify_back_in_stock;

      db.prepare(
        `UPDATE store_follows
         SET notify_new_offers = ?, notify_discounts = ?, notify_new_products = ?, notify_back_in_stock = ?
         WHERE customer_id = ? AND merchant_id = ?`
      ).run(nextOffers, nextDiscounts, nextNewProds, nextBackInStock, auth.id, merchantId);

      res.json({
        ok: true,
        notification_prefs: {
          notify_new_offers: Boolean(nextOffers),
          notify_discounts: Boolean(nextDiscounts),
          notify_new_products: Boolean(nextNewProds),
          notify_back_in_stock: Boolean(nextBackInStock),
        },
      });
    }
  );

  app.get('/api/customer/followed-stores', requireAuth, requireRole('customer'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const followedRows = db
      .prepare(
        `SELECT
           sf.merchant_id,
           sf.notify_new_offers,
           sf.notify_discounts,
           sf.notify_new_products,
           sf.notify_back_in_stock,
           sf.created_at AS followed_at,
           m.business_name_ar,
           m.business_name_en,
           m.merchant_type,
           m.branch_name,
           m.zone_name,
           m.address_detail,
           m.working_hours,
           m.description_ar,
           m.image_url,
           m.cover_image_url,
           m.is_open_now,
           m.share_slug,
           (SELECT COUNT(*) FROM store_follows f2 WHERE f2.merchant_id = m.id) AS followers_count,
           (SELECT ROUND(AVG(sr.rating), 1) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible') AS rating_avg,
           (SELECT COUNT(*) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible') AS rating_count,
           (SELECT COUNT(*) FROM products p WHERE p.merchant_id = m.id AND p.is_available = 1 AND (p.is_offer = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price))) AS offers_count
         FROM store_follows sf
         JOIN merchants m ON m.id = sf.merchant_id
         WHERE sf.customer_id = ? AND m.verification_status = 'approved'
         ORDER BY datetime(sf.created_at) DESC`
      )
      .all(auth.id) as Array<Record<string, unknown>>;

    const merchantIds = followedRows.map((r) => String(r.merchant_id));
    let recentProducts: Array<Record<string, unknown>> = [];
    if (merchantIds.length > 0) {
      const placeholders = merchantIds.map(() => '?').join(',');
      const rawProds = db
        .prepare(
          `SELECT
             p.*,
             m.business_name_ar AS merchant_name_ar,
             c.name_ar AS category_name_ar
           FROM products p
           JOIN merchants m ON m.id = p.merchant_id
           LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.merchant_id IN (${placeholders}) AND p.is_available = 1
           ORDER BY p.is_offer DESC, (CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.base_price THEN 1 ELSE 0 END) DESC, datetime(p.created_at) DESC
           LIMIT 30`
        )
        .all(...merchantIds) as Array<Record<string, unknown>>;

      recentProducts = rawProds.map((r) => {
        const basePrice = Number(r.base_price || 0);
        const salePrice = r.sale_price != null ? Number(r.sale_price) : null;
        const effectivePrice = salePrice != null && salePrice > 0 && salePrice < basePrice ? salePrice : basePrice;
        return {
          ...r,
          base_price: basePrice,
          sale_price: salePrice,
          effective_price: effectivePrice,
          is_available: Boolean(r.is_available),
          is_offer: Boolean(r.is_offer) || (salePrice != null && salePrice < basePrice),
          is_weighted: Boolean(r.is_weighted),
        };
      });
    }

    res.json({
      stores: followedRows.map((r) => ({
        id: String(r.merchant_id),
        business_name_ar: String(r.business_name_ar || ''),
        business_name_en: String(r.business_name_en || ''),
        merchant_type: String(r.merchant_type || 'supermarket'),
        branch_name: String(r.branch_name || ''),
        zone_name: String(r.zone_name || ''),
        address_detail: String(r.address_detail || ''),
        working_hours: String(r.working_hours || ''),
        description_ar: String(r.description_ar || ''),
        image_url: String(r.image_url || ''),
        cover_image_url: String(r.cover_image_url || ''),
        is_open_now: Boolean(r.is_open_now),
        is_open: Boolean(r.is_open_now),
        followers_count: Number(r.followers_count || 0),
        rating_avg: r.rating_avg != null ? Number(r.rating_avg) : 0,
        rating_count: Number(r.rating_count || 0),
        offers_count: Number(r.offers_count || 0),
        followed_at: String(r.followed_at || ''),
        notification_prefs: {
          notify_new_offers: Boolean(r.notify_new_offers),
          notify_discounts: Boolean(r.notify_discounts),
          notify_new_products: Boolean(r.notify_new_products),
          notify_back_in_stock: Boolean(r.notify_back_in_stock),
        },
      })),
      products_and_offers: recentProducts,
    });
  });

  // =========================================================================
  // 6. ADMIN MODERATION, RANKINGS, REPORTS & REVIEW SETTINGS
  //    (Strictly Admin-only; Merchants CANNOT tamper with or delete reviews!)
  // =========================================================================

  app.get(
    '/api/admin/store-reviews/overview',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (_req: Request, res: Response) => {
      const storeRankings = db
        .prepare(
          `SELECT
             m.id,
             m.business_name_ar,
             m.merchant_type,
             m.zone_name,
             m.image_url,
             m.is_open_now,
             m.verification_status,
             COALESCE((SELECT ROUND(AVG(sr.rating), 2) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible'), 0) AS rating_avg,
             (SELECT COUNT(*) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'visible') AS rating_count,
             (SELECT COUNT(*) FROM store_reviews sr WHERE sr.merchant_id = m.id AND sr.status = 'hidden') AS hidden_reviews_count,
             (SELECT COUNT(*) FROM product_reviews pr WHERE pr.merchant_id = m.id AND pr.status = 'visible') AS product_reviews_count,
             (SELECT COUNT(*) FROM store_follows sf WHERE sf.merchant_id = m.id) AS followers_count,
             (SELECT COUNT(*) FROM review_reports rr WHERE rr.merchant_id = m.id AND rr.status = 'open') AS open_reports_count
           FROM merchants m
           ORDER BY rating_avg DESC, rating_count DESC, m.business_name_ar ASC`
        )
        .all() as Array<Record<string, unknown>>;

      const kpiStore = db
        .prepare(
          `SELECT
             COUNT(CASE WHEN status = 'visible' THEN 1 END) AS visible_store_reviews,
             COUNT(CASE WHEN status = 'hidden' THEN 1 END) AS hidden_store_reviews,
             COALESCE(ROUND(AVG(CASE WHEN status = 'visible' THEN rating END), 2), 0) AS overall_store_avg
           FROM store_reviews`
        )
        .get() as Record<string, number>;

      const kpiProd = db
        .prepare(
          `SELECT
             COUNT(CASE WHEN status = 'visible' THEN 1 END) AS visible_product_reviews,
             COUNT(CASE WHEN status = 'hidden' THEN 1 END) AS hidden_product_reviews
           FROM product_reviews`
        )
        .get() as Record<string, number>;

      const openReports = db
        .prepare("SELECT COUNT(*) AS cnt FROM review_reports WHERE status = 'open'")
        .get() as { cnt?: number };

      const totalFollows = db.prepare('SELECT COUNT(*) AS cnt FROM store_follows').get() as { cnt?: number };

      const ratedStores = storeRankings.filter((s) => Number(s.rating_count || 0) > 0);
      const topRated = [...ratedStores]
        .sort((a, b) => Number(b.rating_avg) - Number(a.rating_avg) || Number(b.rating_count) - Number(a.rating_count))
        .slice(0, 5);
      const lowestRated = [...ratedStores]
        .sort((a, b) => Number(a.rating_avg) - Number(b.rating_avg) || Number(b.rating_count) - Number(a.rating_count))
        .slice(0, 5);

      res.json({
        kpis: {
          visible_store_reviews: Number(kpiStore?.visible_store_reviews || 0),
          hidden_store_reviews: Number(kpiStore?.hidden_store_reviews || 0),
          overall_store_avg: Number(kpiStore?.overall_store_avg || 0),
          visible_product_reviews: Number(kpiProd?.visible_product_reviews || 0),
          hidden_product_reviews: Number(kpiProd?.hidden_product_reviews || 0),
          open_reports_count: Number(openReports?.cnt || 0),
          total_store_follows: Number(totalFollows?.cnt || 0),
        },
        settings: getReviewSettings(),
        stores: storeRankings.map((s) => ({
          ...s,
          is_open_now: Boolean(s.is_open_now),
          is_open: Boolean(s.is_open_now),
          rating_avg: Number(s.rating_avg || 0),
          rating_count: Number(s.rating_count || 0),
          hidden_reviews_count: Number(s.hidden_reviews_count || 0),
          product_reviews_count: Number(s.product_reviews_count || 0),
          followers_count: Number(s.followers_count || 0),
          open_reports_count: Number(s.open_reports_count || 0),
        })),
        top_rated_stores: topRated,
        lowest_rated_stores: lowestRated,
      });
    }
  );

  app.get(
    '/api/admin/store-reviews',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const reviewType = String(req.query.type || 'all').trim(); // all | store | product
      const merchantId = String(req.query.merchant_id || '').trim();
      const status = String(req.query.status || 'all').trim(); // all | visible | hidden
      const reportedOnly = String(req.query.reported_only || '') === '1';
      const q = String(req.query.q || '').trim().toLowerCase();

      const results: Array<Record<string, unknown>> = [];

      if (reviewType === 'all' || reviewType === 'store') {
        const where: string[] = ['1=1'];
        const params: unknown[] = [];
        if (merchantId) {
          where.push('sr.merchant_id = ?');
          params.push(merchantId);
        }
        if (status === 'visible' || status === 'hidden') {
          where.push('sr.status = ?');
          params.push(status);
        }
        const rows = db
          .prepare(
            `SELECT
               sr.*,
               m.business_name_ar AS merchant_name_ar,
               o.order_number,
               (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_type = 'store' AND rr.review_id = sr.id AND rr.status = 'open') AS open_reports_count
             FROM store_reviews sr
             LEFT JOIN merchants m ON m.id = sr.merchant_id
             LEFT JOIN orders o ON o.id = sr.order_id
             WHERE ${where.join(' AND ')}
             ORDER BY datetime(sr.created_at) DESC
             LIMIT 200`
          )
          .all(...params) as Array<Record<string, unknown>>;

        for (const r of rows) {
          results.push({
            review_type: 'store',
            id: String(r.id),
            merchant_id: String(r.merchant_id),
            merchant_name_ar: String(r.merchant_name_ar || ''),
            product_id: null,
            product_name_ar: null,
            order_id: String(r.order_id),
            order_number: String(r.order_number || ''),
            customer_name_display: String(r.customer_name_display || ''),
            rating: Number(r.rating),
            comment: String(r.comment || ''),
            image_urls: [],
            status: String(r.status),
            hidden_reason: r.hidden_reason ? String(r.hidden_reason) : null,
            moderated_by: r.moderated_by ? String(r.moderated_by) : null,
            moderated_at: r.moderated_at ? String(r.moderated_at) : null,
            open_reports_count: Number(r.open_reports_count || 0),
            created_at: String(r.created_at || ''),
            updated_at: String(r.updated_at || ''),
          });
        }
      }

      if (reviewType === 'all' || reviewType === 'product') {
        const where: string[] = ['1=1'];
        const params: unknown[] = [];
        if (merchantId) {
          where.push('pr.merchant_id = ?');
          params.push(merchantId);
        }
        if (status === 'visible' || status === 'hidden') {
          where.push('pr.status = ?');
          params.push(status);
        }
        const rows = db
          .prepare(
            `SELECT
               pr.*,
               m.business_name_ar AS merchant_name_ar,
               p.name_ar AS product_name_ar,
               o.order_number,
               (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_type = 'product' AND rr.review_id = pr.id AND rr.status = 'open') AS open_reports_count
             FROM product_reviews pr
             LEFT JOIN merchants m ON m.id = pr.merchant_id
             LEFT JOIN products p ON p.id = pr.product_id
             LEFT JOIN orders o ON o.id = pr.order_id
             WHERE ${where.join(' AND ')}
             ORDER BY datetime(pr.created_at) DESC
             LIMIT 200`
          )
          .all(...params) as Array<Record<string, unknown>>;

        for (const r of rows) {
          let imgs: string[] = [];
          try {
            const parsed = JSON.parse(String(r.image_urls_json || '[]'));
            if (Array.isArray(parsed)) imgs = parsed.filter((x) => typeof x === 'string');
          } catch {
            imgs = [];
          }
          results.push({
            review_type: 'product',
            id: String(r.id),
            merchant_id: String(r.merchant_id),
            merchant_name_ar: String(r.merchant_name_ar || ''),
            product_id: String(r.product_id),
            product_name_ar: String(r.product_name_ar || ''),
            order_id: String(r.order_id),
            order_number: String(r.order_number || ''),
            customer_name_display: String(r.customer_name_display || ''),
            rating: Number(r.rating),
            comment: String(r.comment || ''),
            image_urls: imgs,
            status: String(r.status),
            hidden_reason: r.hidden_reason ? String(r.hidden_reason) : null,
            moderated_by: r.moderated_by ? String(r.moderated_by) : null,
            moderated_at: r.moderated_at ? String(r.moderated_at) : null,
            open_reports_count: Number(r.open_reports_count || 0),
            created_at: String(r.created_at || ''),
            updated_at: String(r.updated_at || ''),
          });
        }
      }

      const filtered = results
        .filter((item) => (!reportedOnly || Number(item.open_reports_count) > 0))
        .filter((item) => {
          if (!q) return true;
          return (
            String(item.comment || '').toLowerCase().includes(q) ||
            String(item.merchant_name_ar || '').toLowerCase().includes(q) ||
            String(item.product_name_ar || '').toLowerCase().includes(q) ||
            String(item.customer_name_display || '').toLowerCase().includes(q)
          );
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      res.json({ reviews: filtered });
    }
  );

  app.patch(
    '/api/admin/store-reviews/:type/:id/moderate',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const reviewType = String(req.params.type || '').trim();
      const reviewId = String(req.params.id || '').trim();
      const nextStatus = String(req.body?.status || '').trim();
      const reason = String(req.body?.reason || '').trim().slice(0, 300);

      if (reviewType !== 'store' && reviewType !== 'product') {
        return res.status(400).json({ error: 'نوع التقييم غير صالح' });
      }
      if (nextStatus !== 'visible' && nextStatus !== 'hidden') {
        return res.status(400).json({ error: 'حالة الرقابة يجب أن تكون visible أو hidden' });
      }

      const table = reviewType === 'store' ? 'store_reviews' : 'product_reviews';
      const existing = db.prepare(`SELECT id, merchant_id FROM ${table} WHERE id = ?`).get(reviewId) as
        | { id: string; merchant_id: string }
        | undefined;
      if (!existing) return res.status(404).json({ error: 'التقييم غير موجود' });

      db.prepare(
        `UPDATE ${table}
         SET status = ?, hidden_reason = ?, moderated_by = ?, moderated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextStatus, nextStatus === 'hidden' ? reason || 'مخالفة سياسة التعليقات' : null, auth.fullName, reviewId);

      if (nextStatus === 'hidden') {
        db.prepare(
          `UPDATE review_reports
           SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now')
           WHERE review_type = ? AND review_id = ? AND status = 'open'`
        ).run(auth.fullName, reviewType, reviewId);
      }

      recordAuditLog({
        actor_name: auth.fullName,
        actor_role: auth.role,
        action: nextStatus === 'hidden' ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
        entity_type: table,
        entity_id: reviewId,
        reason: reason || (nextStatus === 'hidden' ? 'إخفاء تعليق مخالف' : 'إعادة إظهار تقييم'),
        details: `تم ${nextStatus === 'hidden' ? 'إخفاء' : 'إعادة إظهار'} تقييم (${reviewType}) للمتجر ${existing.merchant_id}`,
      });

      const summary =
        reviewType === 'store' ? computeStoreRatingSummary(existing.merchant_id) : undefined;
      res.json({ ok: true, id: reviewId, status: nextStatus, summary });
    }
  );

  app.get(
    '/api/admin/review-reports',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const status = String(req.query.status || 'open').trim();
      const whereSql = status === 'all' ? '1=1' : 'rr.status = ?';
      const params = status === 'all' ? [] : [status];

      const rows = db
        .prepare(
          `SELECT
             rr.*,
             m.business_name_ar AS merchant_name_ar,
             CASE WHEN rr.review_type = 'store' THEN sr.comment ELSE pr.comment END AS review_comment,
             CASE WHEN rr.review_type = 'store' THEN sr.rating ELSE pr.rating END AS review_rating,
             CASE WHEN rr.review_type = 'store' THEN sr.status ELSE pr.status END AS review_status,
             CASE WHEN rr.review_type = 'store' THEN sr.customer_name_display ELSE pr.customer_name_display END AS reviewer_name
           FROM review_reports rr
           LEFT JOIN merchants m ON m.id = rr.merchant_id
           LEFT JOIN store_reviews sr ON rr.review_type = 'store' AND sr.id = rr.review_id
           LEFT JOIN product_reviews pr ON rr.review_type = 'product' AND pr.id = rr.review_id
           WHERE ${whereSql}
           ORDER BY datetime(rr.created_at) DESC
           LIMIT 150`
        )
        .all(...params);

      res.json({ reports: rows });
    }
  );

  app.patch(
    '/api/admin/review-reports/:id',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const reportId = String(req.params.id || '').trim();
      const nextStatus = String(req.body?.status || '').trim();
      const hideReview = Boolean(req.body?.hide_review);
      const hideReason = String(req.body?.hide_reason || 'إخفاء بناءً على بلاغ').trim().slice(0, 300);

      if (nextStatus !== 'resolved' && nextStatus !== 'dismissed') {
        return res.status(400).json({ error: 'حالة البلاغ يجب أن تكون resolved أو dismissed' });
      }
      const existing = db.prepare('SELECT * FROM review_reports WHERE id = ?').get(reportId) as
        | Record<string, unknown>
        | undefined;
      if (!existing) return res.status(404).json({ error: 'البلاغ غير موجود' });

      db.prepare(
        `UPDATE review_reports
         SET status = ?, resolved_by = ?, resolved_at = datetime('now')
         WHERE id = ?`
      ).run(nextStatus, auth.fullName, reportId);

      if (hideReview) {
        const table = existing.review_type === 'product' ? 'product_reviews' : 'store_reviews';
        db.prepare(
          `UPDATE ${table}
           SET status = 'hidden', hidden_reason = ?, moderated_by = ?, moderated_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).run(hideReason, auth.fullName, existing.review_id);
      }

      recordAuditLog({
        actor_name: auth.fullName,
        actor_role: auth.role,
        action: 'REVIEW_REPORT_PROCESSED',
        entity_type: 'review_reports',
        entity_id: reportId,
        details: `معالجة البلاغ (${nextStatus})${hideReview ? ' مع إخفاء التعليق' : ''}`,
      });

      res.json({ ok: true, id: reportId, status: nextStatus, review_hidden: hideReview });
    }
  );

  app.patch(
    '/api/admin/store-reviews/settings',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const auth = req.auth!;
      const current = getReviewSettings();
      const editWindowHours =
        req.body?.edit_window_hours !== undefined
          ? Math.max(1, Math.min(720, Math.trunc(Number(req.body.edit_window_hours))))
          : current.edit_window_hours;
      const cooldownMinutes =
        req.body?.notification_cooldown_minutes !== undefined
          ? Math.max(1, Math.min(10080, Math.trunc(Number(req.body.notification_cooldown_minutes))))
          : current.notification_cooldown_minutes;
      const maxDaily =
        req.body?.max_daily_store_notifications !== undefined
          ? Math.max(1, Math.min(20, Math.trunc(Number(req.body.max_daily_store_notifications))))
          : current.max_daily_store_notifications;

      db.prepare(
        `UPDATE store_review_settings
         SET edit_window_hours = ?, notification_cooldown_minutes = ?, max_daily_store_notifications = ?, updated_at = datetime('now')
         WHERE id = 'default'`
      ).run(editWindowHours, cooldownMinutes, maxDaily);

      recordAuditLog({
        actor_name: auth.fullName,
        actor_role: auth.role,
        action: 'STORE_REVIEW_SETTINGS_UPDATED',
        entity_type: 'store_review_settings',
        entity_id: 'default',
        details: `تعديل إعدادات التقييمات: فترة التعديل ${editWindowHours} ساعة، تهدئة الإشعارات ${cooldownMinutes} دقيقة، الحد اليومي ${maxDaily}`,
      });

      res.json({ ok: true, settings: getReviewSettings() });
    }
  );

  // =========================================================================
  // 7. PUBLIC SHAREABLE STORE LINK (/store/:merchantId) — DEEP LINK + WEB FALLBACK
  //    Serves rich OpenGraph metadata for social previews & smart App Deep Link
  // =========================================================================

  app.get('/store/:merchantId', (req: Request, res: Response, next) => {
    const rawKey = String(req.params.merchantId || '').trim();
    const merchant = resolveMerchantByIdOrSlug(rawKey);
    const ua = String(req.headers['user-agent'] || '').toLowerCase();
    const isSocialBot =
      /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|googlebot/.test(ua);
    const forcePreviewHtml = String(req.query.preview || '') === 'meta';

    // For social link preview bots (WhatsApp/Facebook/Telegram), return clean OG HTML
    if (isSocialBot || forcePreviewHtml) {
      const origin = buildPublicOrigin(req);
      if (!merchant) {
        res.status(404).send('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>المتجر غير موجود – اطلبها</title></head><body><h1>المتجر غير موجود</h1></body></html>');
        return;
      }
      const merchantId = String(merchant.id);
      const summary = computeStoreRatingSummary(merchantId);
      const title = `${String(merchant.business_name_ar || 'متجر')} – اطلبها Otlobha`;
      const desc =
        String(merchant.description_ar || '').trim() ||
        `تسوّق من ${String(merchant.business_name_ar || '')} على منصة اطلبها${summary.rating_count > 0 ? ` · تقييم ${summary.rating_avg} ★ (${summary.rating_count} تقييم)` : ''}`;
      const img = String(merchant.cover_image_url || merchant.image_url || '');
      const fullImg = img.startsWith('http') ? img : img ? `${origin}${img.startsWith('/') ? '' : '/'}${img}` : '';
      const pageUrl = `${origin}/store/${encodeURIComponent(String(merchant.share_slug || merchantId))}`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  ${fullImg ? `<meta property="og:image" content="${escapeHtml(fullImg)}" />` : ''}
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(desc)}</p>
  <a href="otlobha://store/${escapeHtml(merchantId)}">فتح المتجر في تطبيق اطلبها</a>
</body>
</html>`);
      return;
    }

    // For normal browsers, pass through to SPA (Vite in dev / dist/index.html in prod) where App.tsx renders PublicStoreWebPage!
    next();
  });
}
