import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  ALL_ADMIN_ROLES,
  isAdminAuth,
  optionalAuth,
  requireAuth,
  requireRole,
} from './auth.ts';

function attachOptionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const ctx = optionalAuth(req);
  if (ctx) {
    req.auth = ctx;
  }
  next();
}
import { db, hashPassword, recordAuditLog, uid } from './db.ts';
import {
  MERCHANT_ACTIVITY_REGISTRY,
  MERCHANT_STAFF_ROLES,
  ONBOARDING_STATUS_META,
  resolveActivityCategory,
  resolveActivityProfile,
  type MerchantActivityCategory,
  type MerchantStaffRole,
  type OnboardingApplicationStatus,
} from '../shared/merchantActivities.ts';

interface MerchantOnboardingDeps {
  enqueueSystemPushNotification?: (payload: {
    app_target: 'customer' | 'captain' | 'merchant';
    target_user_id?: string | null;
    title_ar: string;
    body_ar: string;
    data?: Record<string, unknown>;
  }) => void;
  broadcastToRooms?: (rooms: string[], payload: Record<string, unknown>) => void;
  checkRateLimit?: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  getClientIp?: (req: Request) => string;
}

const ALLOWED_DOC_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

const MAX_DOC_DATA_URL_BYTES = 5 * 1024 * 1024; // 5 MB

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function normalizeEmail(raw: string): string {
  const v = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '').trim();
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function generateApplicationNumber(): string {
  const year = new Date().getFullYear();
  const rnd = crypto.randomInt(100000, 999999);
  return `OTL-${year}-${rnd}`;
}

function extractApplicantSecret(req: Request): string {
  const hdr = String(req.headers['x-application-secret'] || '').trim();
  if (hdr) return hdr;
  const q = String(req.query.secret || '').trim();
  if (q) return q;
  const bodySecret =
    req.body && typeof req.body === 'object' ? String((req.body as Record<string, unknown>).applicant_secret || '').trim() : '';
  return bodySecret;
}

function safeAddColumn(table: string, columnDef: string): void {
  const colName = columnDef.trim().split(/\s+/)[0];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === colName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

export function initMerchantOnboardingSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchant_onboarding_applications (
      id TEXT PRIMARY KEY,
      application_number TEXT NOT NULL UNIQUE,
      applicant_secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      activity_category TEXT NOT NULL DEFAULT 'store',
      merchant_type TEXT NOT NULL DEFAULT 'supermarket',
      custom_activity_label TEXT DEFAULT '',
      business_name_ar TEXT DEFAULT '',
      business_name_en TEXT DEFAULT '',
      branch_name TEXT DEFAULT '',
      zone_name TEXT DEFAULT '',
      address_detail TEXT DEFAULT '',
      lat REAL,
      lng REAL,
      working_hours TEXT DEFAULT '',
      description_ar TEXT DEFAULT '',
      owner_name TEXT DEFAULT '',
      owner_national_id TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      whatsapp_phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      commercial_reg_no TEXT DEFAULT '',
      tax_card_no TEXT DEFAULT '',
      payout_method TEXT DEFAULT 'vodafone_cash',
      payout_account TEXT DEFAULT '',
      supports_free_order INTEGER DEFAULT 1,
      activity_details_json TEXT DEFAULT '{}',
      terms_accepted INTEGER DEFAULT 0,
      review_note TEXT DEFAULT '',
      requested_changes_json TEXT DEFAULT '[]',
      rejection_reason TEXT DEFAULT '',
      reviewed_by TEXT DEFAULT '',
      reviewed_at TEXT,
      linked_merchant_id TEXT,
      existing_match_merchant_id TEXT,
      submitted_at TEXT,
      activated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mer_onb_app_status
      ON merchant_onboarding_applications(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mer_onb_app_email
      ON merchant_onboarding_applications(LOWER(email));
    CREATE INDEX IF NOT EXISTS idx_mer_onb_app_phone
      ON merchant_onboarding_applications(phone);

    CREATE TABLE IF NOT EXISTS merchant_onboarding_documents (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_label_ar TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      file_size INTEGER NOT NULL DEFAULT 0,
      data_url TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES merchant_onboarding_applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mer_onb_docs_app
      ON merchant_onboarding_documents(application_id, doc_type);

    CREATE TABLE IF NOT EXISTS merchant_onboarding_history (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      from_status TEXT DEFAULT '',
      to_status TEXT NOT NULL,
      actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES merchant_onboarding_applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mer_onb_hist_app
      ON merchant_onboarding_history(application_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS merchant_staff_members (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT DEFAULT '',
      staff_role TEXT NOT NULL DEFAULT 'orders_staff',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mer_staff_merchant
      ON merchant_staff_members(merchant_id, is_active);
  `);

  // Safe additive columns on merchants & products (never altering categories!)
  safeAddColumn('merchants', "activity_category TEXT DEFAULT ''");
  safeAddColumn('merchants', "onboarding_application_id TEXT DEFAULT ''");
  safeAddColumn('merchants', 'avg_prep_minutes INTEGER DEFAULT 15');
  safeAddColumn('merchants', "cuisine_type TEXT DEFAULT ''");
  safeAddColumn('merchants', "tax_card_no TEXT DEFAULT ''");
  safeAddColumn('merchants', "health_cert_no TEXT DEFAULT ''");

  safeAddColumn('products', 'prep_time_minutes INTEGER DEFAULT 15');
  safeAddColumn('products', "variants_json TEXT DEFAULT '[]'");
  safeAddColumn('products', "addons_json TEXT DEFAULT '[]'");
  safeAddColumn('products', "meal_section TEXT DEFAULT ''");
}

function findMatchingExistingMerchant(email: string, phone: string): Record<string, unknown> | null {
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);
  if (cleanEmail) {
    const byEmail = db
      .prepare('SELECT id, email, phone, business_name_ar, merchant_type, verification_status, branch_name, zone_name FROM merchants WHERE LOWER(email) = LOWER(?) LIMIT 1')
      .get(cleanEmail) as Record<string, unknown> | undefined;
    if (byEmail) return byEmail;
  }
  if (cleanPhone && cleanPhone.length >= 8) {
    const byPhone = db
      .prepare("SELECT id, email, phone, business_name_ar, merchant_type, verification_status, branch_name, zone_name FROM merchants WHERE REPLACE(REPLACE(phone, ' ', ''), '-', '') = ? LIMIT 1")
      .get(cleanPhone) as Record<string, unknown> | undefined;
    if (byPhone) return byPhone;
  }
  return null;
}

function formatApplicationDocumentMeta(doc: Record<string, unknown>) {
  return {
    id: String(doc.id),
    application_id: String(doc.application_id),
    doc_type: String(doc.doc_type),
    doc_label_ar: String(doc.doc_label_ar || ''),
    file_name: String(doc.file_name || ''),
    mime_type: String(doc.mime_type || ''),
    file_size: Number(doc.file_size || 0),
    uploaded_at: String(doc.uploaded_at || ''),
    download_url: `/api/merchant-onboarding/documents/${encodeURIComponent(String(doc.id))}`,
  };
}

function serializeApplication(row: Record<string, unknown>, includeSensitive: boolean) {
  const appId = String(row.id);
  const status = String(row.status || 'draft') as OnboardingApplicationStatus;
  const activityCategory = resolveActivityCategory(String(row.merchant_type || ''), String(row.activity_category || ''));
  const docs = db
    .prepare('SELECT id, application_id, doc_type, doc_label_ar, file_name, mime_type, file_size, uploaded_at FROM merchant_onboarding_documents WHERE application_id = ? ORDER BY uploaded_at DESC')
    .all(appId) as Array<Record<string, unknown>>;
  const history = db
    .prepare('SELECT id, from_status, to_status, actor_name, actor_role, note, created_at FROM merchant_onboarding_history WHERE application_id = ? ORDER BY created_at DESC')
    .all(appId) as Array<Record<string, unknown>>;

  const existingMatch =
    row.linked_merchant_id
      ? (db
          .prepare('SELECT id, email, phone, business_name_ar, merchant_type, verification_status, branch_name, zone_name FROM merchants WHERE id = ?')
          .get(String(row.linked_merchant_id)) as Record<string, unknown> | undefined) || null
      : findMatchingExistingMerchant(String(row.email || ''), String(row.phone || ''));

  const base = {
    id: appId,
    application_number: String(row.application_number),
    status,
    status_meta: ONBOARDING_STATUS_META[status] || ONBOARDING_STATUS_META.draft,
    activity_category: activityCategory,
    activity_profile: MERCHANT_ACTIVITY_REGISTRY[activityCategory],
    merchant_type: String(row.merchant_type || MERCHANT_ACTIVITY_REGISTRY[activityCategory].default_merchant_type),
    custom_activity_label: String(row.custom_activity_label || ''),
    business_name_ar: String(row.business_name_ar || ''),
    business_name_en: String(row.business_name_en || ''),
    branch_name: String(row.branch_name || ''),
    zone_name: String(row.zone_name || ''),
    working_hours: String(row.working_hours || ''),
    description_ar: String(row.description_ar || ''),
    review_note: String(row.review_note || ''),
    requested_changes: safeJsonParse<string[]>(row.requested_changes_json, []),
    rejection_reason: String(row.rejection_reason || ''),
    reviewed_by: String(row.reviewed_by || ''),
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    linked_merchant_id: row.linked_merchant_id ? String(row.linked_merchant_id) : null,
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    activated_at: row.activated_at ? String(row.activated_at) : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    history,
  };

  if (!includeSensitive) {
    return {
      ...base,
      documents_count: docs.length,
    };
  }

  return {
    ...base,
    address_detail: String(row.address_detail || ''),
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    owner_name: String(row.owner_name || ''),
    owner_national_id: String(row.owner_national_id || ''),
    phone: String(row.phone || ''),
    whatsapp_phone: String(row.whatsapp_phone || ''),
    email: String(row.email || ''),
    has_password: Boolean(String(row.password_hash || '').trim()),
    commercial_reg_no: String(row.commercial_reg_no || ''),
    tax_card_no: String(row.tax_card_no || ''),
    payout_method: String(row.payout_method || 'vodafone_cash'),
    payout_account: String(row.payout_account || ''),
    supports_free_order: Boolean(row.supports_free_order),
    activity_details: safeJsonParse<Record<string, unknown>>(row.activity_details_json, {}),
    terms_accepted: Boolean(row.terms_accepted),
    documents: docs.map(formatApplicationDocumentMeta),
    existing_match_merchant: existingMatch,
  };
}

function recordHistory(params: {
  applicationId: string;
  fromStatus: string;
  toStatus: string;
  actorName: string;
  actorRole: string;
  note?: string;
}) {
  db.prepare(
    `INSERT INTO merchant_onboarding_history (id, application_id, from_status, to_status, actor_name, actor_role, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('mhist'),
    params.applicationId,
    params.fromStatus,
    params.toStatus,
    params.actorName,
    params.actorRole,
    String(params.note || '').trim()
  );
}

function verifyApplicationAccess(req: Request, appRow: Record<string, unknown>): boolean {
  if (req.auth && isAdminAuth(req.auth)) return true;
  if (req.auth && req.auth.role === 'merchant' && appRow.linked_merchant_id && String(appRow.linked_merchant_id) === req.auth.id) {
    return true;
  }
  const secret = extractApplicantSecret(req);
  if (!secret) return false;
  return timingSafeHexEqual(sha256Hex(secret), String(appRow.applicant_secret_hash || ''));
}

function ensureMerchantOwnerStaffRow(merchant: Record<string, unknown>): void {
  const merId = String(merchant.id || '');
  if (!merId) return;
  const existing = db
    .prepare("SELECT id FROM merchant_staff_members WHERE merchant_id = ? AND staff_role = 'owner' LIMIT 1")
    .get(merId);
  if (existing) return;
  db.prepare(
    `INSERT INTO merchant_staff_members (id, merchant_id, full_name, email, phone, staff_role, permissions_json, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, 'owner', ?, 1, 'system')`
  ).run(
    uid('mstaff'),
    merId,
    String(merchant.owner_name || merchant.business_name_ar || 'مالك النشاط'),
    String(merchant.email || ''),
    String(merchant.phone || ''),
    JSON.stringify(MERCHANT_STAFF_ROLES.owner.permissions)
  );
}

function validateSubmissionCompleteness(row: Record<string, unknown>, docs: Array<Record<string, unknown>>): string[] {
  const errors: string[] = [];
  const activityCategory = resolveActivityCategory(String(row.merchant_type || ''), String(row.activity_category || ''));
  const details = safeJsonParse<Record<string, unknown>>(row.activity_details_json, {});

  if (!String(row.business_name_ar || '').trim()) errors.push('اسم النشاط بالعربية مطلوب');
  if (!String(row.owner_name || '').trim()) errors.push('اسم المالك أو المدير المسؤول مطلوب');
  const natId = String(row.owner_national_id || '').trim();
  if (!/^[0-9]{14}$/.test(natId)) errors.push('الرقم القومي للمالك يجب أن يتكون من 14 رقمًا');
  const phone = normalizePhone(String(row.phone || ''));
  if (!/^[0-9+]{8,15}$/.test(phone)) errors.push('رقم الهاتف الأساسي غير صحيح');
  const email = normalizeEmail(String(row.email || ''));
  if (!email) errors.push('البريد الإلكتروني غير صحيح');
  if (!String(row.zone_name || '').trim()) errors.push('يرجى تحديد النطاق / المنطقة');
  if (!String(row.branch_name || '').trim()) errors.push('اسم الفرع أو العنوان المختصر مطلوب');
  if (!Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lng))) {
    errors.push('يرجى تحديد موقع المنشأة على الخريطة (GPS)');
  }
  const existingMatch = findMatchingExistingMerchant(email, phone);
  if (!existingMatch && !String(row.password_hash || '').trim()) {
    errors.push('يرجى تعيين كلمة مرور للحساب الجديد (6 أحرف على الأقل)');
  }
  if (!row.terms_accepted) {
    errors.push('يجب الموافقة على شروط واتفاقية الانضمام لمنصة اطلبها');
  }

  if (activityCategory === 'pharmacy') {
    if (!String(details.pharmacy_license_no || '').trim()) errors.push('رقم ترخيص الصيدلية مطلوب');
    if (!String(details.pharmacist_name || '').trim()) errors.push('اسم الصيدلي المدير مطلوب');
    if (!String(details.syndicate_no || '').trim()) errors.push('رقم قيد نقابة الصيادلة مطلوب');
  }

  if (activityCategory === 'restaurant_cafe') {
    if (!String(details.cuisine_type || '').trim()) {
      errors.push('يرجى تحديد نوع المطبخ أو المشروبات للمطعم / الكافيه');
    }
  }

  if (activityCategory === 'other') {
    if (!String(row.custom_activity_label || '').trim()) {
      errors.push('يرجى توضيح نوع النشاط التجاري في خانة "وصف النشاط"');
    }
  }

  const spec = MERCHANT_ACTIVITY_REGISTRY[activityCategory];
  const uploadedTypes = new Set(docs.map((d) => String(d.doc_type || '')));
  for (const reqDoc of spec.documents) {
    if (reqDoc.required && !uploadedTypes.has(reqDoc.doc_type)) {
      errors.push(`المستند المطلوب مفقود: ${reqDoc.label_ar}`);
    }
  }

  return errors;
}

export function registerMerchantOnboardingRoutes(app: Express, deps: MerchantOnboardingDeps = {}): void {
  initMerchantOnboardingSchema();

  const checkLimit = (req: Request, res: Response, bucket: string, max: number, windowMs: number): boolean => {
    if (!deps.checkRateLimit) return true;
    const ip = deps.getClientIp ? deps.getClientIp(req) : req.ip || 'unknown';
    const lim = deps.checkRateLimit(`${bucket}:${ip}`, max, windowMs);
    if (!lim.allowed) {
      res.setHeader('Retry-After', String(lim.retryAfterSec));
      res.status(429).json({ error: 'تم تجاوز الحد المسموح للطلبات، يرجى المحاولة بعد قليل' });
      return false;
    }
    return true;
  };

  // =========================================================================
  // 1. PUBLIC SELF-ONBOARDING CONFIG, DRAFTS, DOCUMENTS, SUBMISSION & STATUS
  // =========================================================================

  app.get('/api/merchant-onboarding/config', (_req: Request, res: Response) => {
    const zones = db
      .prepare('SELECT id, name_ar, name_en, is_active FROM service_zones WHERE is_active = 1 ORDER BY name_ar ASC')
      .all() as Array<Record<string, unknown>>;
    res.json({
      activities: Object.values(MERCHANT_ACTIVITY_REGISTRY),
      statuses: ONBOARDING_STATUS_META,
      staff_roles: Object.values(MERCHANT_STAFF_ROLES),
      zones,
    });
  });

  app.post('/api/merchant-onboarding/drafts', (req: Request, res: Response) => {
    if (!checkLimit(req, res, 'mer_onb_draft_create', 25, 10 * 60 * 1000)) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const activityCategory = resolveActivityCategory(
      String(body.merchant_type || ''),
      String(body.activity_category || 'store')
    );
    const defaultType = MERCHANT_ACTIVITY_REGISTRY[activityCategory].default_merchant_type;
    const merchantType = String(body.merchant_type || defaultType).trim() || defaultType;

    const appId = uid('mapp');
    let appNumber = generateApplicationNumber();
    for (let i = 0; i < 5; i++) {
      const dup = db.prepare('SELECT id FROM merchant_onboarding_applications WHERE application_number = ?').get(appNumber);
      if (!dup) break;
      appNumber = generateApplicationNumber();
    }

    const applicantSecret = crypto.randomBytes(24).toString('hex');
    const secretHash = sha256Hex(applicantSecret);
    const rawPw = String(body.password || '');
    const pwHash = rawPw.length >= 6 ? hashPassword(rawPw) : '';

    const latVal = body.lat !== undefined && body.lat !== null && body.lat !== '' && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lngVal = body.lng !== undefined && body.lng !== null && body.lng !== '' && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;

    db.prepare(
      `INSERT INTO merchant_onboarding_applications (
        id, application_number, applicant_secret_hash, status,
        activity_category, merchant_type, custom_activity_label,
        business_name_ar, business_name_en, branch_name, zone_name, address_detail,
        lat, lng, working_hours, description_ar,
        owner_name, owner_national_id, phone, whatsapp_phone, email, password_hash,
        commercial_reg_no, tax_card_no, payout_method, payout_account, supports_free_order,
        activity_details_json, terms_accepted
      ) VALUES (
        ?, ?, ?, 'draft',
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )`
    ).run(
      appId,
      appNumber,
      secretHash,
      activityCategory,
      merchantType,
      String(body.custom_activity_label || '').trim().slice(0, 120),
      String(body.business_name_ar || '').trim().slice(0, 160),
      String(body.business_name_en || '').trim().slice(0, 160),
      String(body.branch_name || '').trim().slice(0, 120),
      String(body.zone_name || '').trim().slice(0, 120),
      String(body.address_detail || '').trim().slice(0, 300),
      latVal,
      lngVal,
      String(body.working_hours || '09:00 ص - 12:00 م').trim().slice(0, 120),
      String(body.description_ar || '').trim().slice(0, 600),
      String(body.owner_name || '').trim().slice(0, 140),
      String(body.owner_national_id || '').trim().slice(0, 20),
      normalizePhone(String(body.phone || '')).slice(0, 20),
      normalizePhone(String(body.whatsapp_phone || '')).slice(0, 20),
      String(body.email || '').trim().toLowerCase().slice(0, 160),
      pwHash,
      String(body.commercial_reg_no || '').trim().slice(0, 80),
      String(body.tax_card_no || '').trim().slice(0, 80),
      String(body.payout_method || 'vodafone_cash').trim().slice(0, 40),
      String(body.payout_account || '').trim().slice(0, 80),
      body.supports_free_order === false ? 0 : 1,
      JSON.stringify(
        body.activity_details && typeof body.activity_details === 'object'
          ? body.activity_details
          : body.activity_payload && typeof body.activity_payload === 'object'
          ? body.activity_payload
          : {}
      ),
      body.terms_accepted === true ? 1 : 0
    );

    recordHistory({
      applicationId: appId,
      fromStatus: '',
      toStatus: 'draft',
      actorName: String(body.owner_name || 'متقدم جديد').trim() || 'متقدم جديد',
      actorRole: 'applicant',
      note: 'إنشاء مسودة طلب انضمام جديدة',
    });

    const created = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(appId) as Record<string, unknown>;
    res.status(201).json({
      ok: true,
      application_number: appNumber,
      applicant_secret: applicantSecret,
      application: serializeApplication(created, true),
    });
  });

  app.get('/api/merchant-onboarding/applications/:appNumber', attachOptionalAuth, (req: Request, res: Response) => {
    const appNumber = String(req.params.appNumber || '').trim();
    const row = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE application_number = ? OR id = ?')
      .get(appNumber, appNumber) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
    if (!verifyApplicationAccess(req, row)) {
      return res.status(403).json({ error: 'غير مصرح بالوصول لبيانات هذه المسودة — يلزم رمز المتابعة السري أو صلاحية الإدارة' });
    }
    res.json({ ok: true, application: serializeApplication(row, true) });
  });

  app.patch('/api/merchant-onboarding/applications/:appNumber', attachOptionalAuth, (req: Request, res: Response) => {
    if (!checkLimit(req, res, 'mer_onb_draft_update', 60, 10 * 60 * 1000)) return;
    const appNumber = String(req.params.appNumber || '').trim();
    const existing = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE application_number = ? OR id = ?')
      .get(appNumber, appNumber) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
    if (!verifyApplicationAccess(req, existing)) {
      return res.status(403).json({ error: 'غير مصرح بتعديل هذا الطلب' });
    }

    const currentStatus = String(existing.status || 'draft');
    if (currentStatus !== 'draft' && currentStatus !== 'needs_completion') {
      return res.status(409).json({
        error: 'لا يمكن تعديل الطلب في حالته الحالية؛ يمكن التعديل فقط وهو مسودة أو في حالة «مطلوب استكمال».',
      });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const nextCategory =
      body.activity_category !== undefined || body.merchant_type !== undefined
        ? resolveActivityCategory(
            String(body.merchant_type ?? existing.merchant_type ?? ''),
            String(body.activity_category ?? existing.activity_category ?? 'store')
          )
        : (String(existing.activity_category || 'store') as MerchantActivityCategory);

    const nextMerchantType =
      body.merchant_type !== undefined
        ? String(body.merchant_type).trim() || MERCHANT_ACTIVITY_REGISTRY[nextCategory].default_merchant_type
        : String(existing.merchant_type || MERCHANT_ACTIVITY_REGISTRY[nextCategory].default_merchant_type);

    const rawPw = body.password !== undefined ? String(body.password || '') : '';
    let nextPwHash = String(existing.password_hash || '');
    if (rawPw.length > 0) {
      if (rawPw.length < 6) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
      }
      nextPwHash = hashPassword(rawPw);
    }

    const prevDetails = safeJsonParse<Record<string, unknown>>(existing.activity_details_json, {});
    const incomingDetails =
      body.activity_details && typeof body.activity_details === 'object'
        ? (body.activity_details as Record<string, unknown>)
        : body.activity_payload && typeof body.activity_payload === 'object'
        ? (body.activity_payload as Record<string, unknown>)
        : null;
    const mergedDetails = incomingDetails ? { ...prevDetails, ...incomingDetails } : prevDetails;

    const nextLat =
      body.lat !== undefined
        ? body.lat !== null && body.lat !== '' && Number.isFinite(Number(body.lat))
          ? Number(body.lat)
          : null
        : existing.lat ?? null;
    const nextLng =
      body.lng !== undefined
        ? body.lng !== null && body.lng !== '' && Number.isFinite(Number(body.lng))
          ? Number(body.lng)
          : null
        : existing.lng ?? null;

    db.prepare(
      `UPDATE merchant_onboarding_applications SET
        activity_category = ?,
        merchant_type = ?,
        custom_activity_label = ?,
        business_name_ar = ?,
        business_name_en = ?,
        branch_name = ?,
        zone_name = ?,
        address_detail = ?,
        lat = ?,
        lng = ?,
        working_hours = ?,
        description_ar = ?,
        owner_name = ?,
        owner_national_id = ?,
        phone = ?,
        whatsapp_phone = ?,
        email = ?,
        password_hash = ?,
        commercial_reg_no = ?,
        tax_card_no = ?,
        payout_method = ?,
        payout_account = ?,
        supports_free_order = ?,
        activity_details_json = ?,
        terms_accepted = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      nextCategory,
      nextMerchantType,
      body.custom_activity_label !== undefined
        ? String(body.custom_activity_label || '').trim().slice(0, 120)
        : String(existing.custom_activity_label || ''),
      body.business_name_ar !== undefined
        ? String(body.business_name_ar || '').trim().slice(0, 160)
        : String(existing.business_name_ar || ''),
      body.business_name_en !== undefined
        ? String(body.business_name_en || '').trim().slice(0, 160)
        : String(existing.business_name_en || ''),
      body.branch_name !== undefined
        ? String(body.branch_name || '').trim().slice(0, 120)
        : String(existing.branch_name || ''),
      body.zone_name !== undefined
        ? String(body.zone_name || '').trim().slice(0, 120)
        : String(existing.zone_name || ''),
      body.address_detail !== undefined
        ? String(body.address_detail || '').trim().slice(0, 300)
        : String(existing.address_detail || ''),
      nextLat,
      nextLng,
      body.working_hours !== undefined
        ? String(body.working_hours || '').trim().slice(0, 120)
        : String(existing.working_hours || ''),
      body.description_ar !== undefined
        ? String(body.description_ar || '').trim().slice(0, 600)
        : String(existing.description_ar || ''),
      body.owner_name !== undefined
        ? String(body.owner_name || '').trim().slice(0, 140)
        : String(existing.owner_name || ''),
      body.owner_national_id !== undefined
        ? String(body.owner_national_id || '').trim().slice(0, 20)
        : String(existing.owner_national_id || ''),
      body.phone !== undefined ? normalizePhone(String(body.phone || '')).slice(0, 20) : String(existing.phone || ''),
      body.whatsapp_phone !== undefined
        ? normalizePhone(String(body.whatsapp_phone || '')).slice(0, 20)
        : String(existing.whatsapp_phone || ''),
      body.email !== undefined
        ? String(body.email || '').trim().toLowerCase().slice(0, 160)
        : String(existing.email || ''),
      nextPwHash,
      body.commercial_reg_no !== undefined
        ? String(body.commercial_reg_no || '').trim().slice(0, 80)
        : String(existing.commercial_reg_no || ''),
      body.tax_card_no !== undefined
        ? String(body.tax_card_no || '').trim().slice(0, 80)
        : String(existing.tax_card_no || ''),
      body.payout_method !== undefined
        ? String(body.payout_method || 'vodafone_cash').trim().slice(0, 40)
        : String(existing.payout_method || 'vodafone_cash'),
      body.payout_account !== undefined
        ? String(body.payout_account || '').trim().slice(0, 80)
        : String(existing.payout_account || ''),
      body.supports_free_order !== undefined ? (body.supports_free_order ? 1 : 0) : existing.supports_free_order,
      JSON.stringify(mergedDetails),
      body.terms_accepted !== undefined ? (body.terms_accepted ? 1 : 0) : existing.terms_accepted,
      String(existing.id)
    );

    const updated = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(String(existing.id)) as Record<string, unknown>;
    res.json({ ok: true, application: serializeApplication(updated, true) });
  });

  app.post('/api/merchant-onboarding/applications/:appNumber/documents', attachOptionalAuth, (req: Request, res: Response) => {
    if (!checkLimit(req, res, 'mer_onb_doc_upload', 40, 10 * 60 * 1000)) return;
    const appNumber = String(req.params.appNumber || '').trim();
    const existing = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE application_number = ? OR id = ?')
      .get(appNumber, appNumber) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
    if (!verifyApplicationAccess(req, existing)) {
      return res.status(403).json({ error: 'غير مصرح برفع مستندات لهذا الطلب' });
    }
    const status = String(existing.status || 'draft');
    if (status !== 'draft' && status !== 'needs_completion') {
      return res.status(409).json({ error: 'لا يمكن رفع مستندات بعد إرسال الطلب إلا إذا طلبت الإدارة استكمالًا' });
    }

    const { doc_type, doc_label_ar, doc_label, file_name, data_url, file_data } = (req.body || {}) as Record<string, unknown>;
    const cleanType = String(doc_type || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
    const rawDataUrl = String(data_url || file_data || '').trim();
    const resolvedLabel = String(doc_label_ar || doc_label || cleanType).trim().slice(0, 120);
    if (!cleanType || !rawDataUrl) {
      return res.status(400).json({ error: 'يرجى تحديد نوع المستند والملف المرفق' });
    }

    const match = rawDataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      return res.status(400).json({ error: 'صيغة الملف غير مدعومة — يُسمح فقط بصور JPG/PNG/WEBP أو ملفات PDF' });
    }
    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_DOC_MIMES.has(mimeType)) {
      return res.status(400).json({ error: 'نوع الملف غير مسموح به — يُسمح فقط بـ JPG, PNG, WEBP, PDF' });
    }
    const approxBytes = Math.ceil((match[2].replace(/\s+/g, '').length * 3) / 4);
    if (approxBytes > MAX_DOC_DATA_URL_BYTES) {
      return res.status(413).json({ error: 'حجم المستند يتجاوز الحد الأقصى المسموح (5 ميجابايت)' });
    }

    const appId = String(existing.id);
    const cleanFileName = String(file_name || `${cleanType}.${mimeType.split('/')[1] || 'jpg'}`)
      .replace(/[^\w.\-\u0600-\u06FF ]+/g, '_')
      .slice(0, 120);

    // Replace existing document of the same doc_type on this application to avoid duplicates
    db.prepare('DELETE FROM merchant_onboarding_documents WHERE application_id = ? AND doc_type = ?').run(appId, cleanType);
    const docId = uid('mdoc');
    db.prepare(
      `INSERT INTO merchant_onboarding_documents (id, application_id, doc_type, doc_label_ar, file_name, mime_type, file_size, data_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      appId,
      cleanType,
      resolvedLabel,
      cleanFileName,
      mimeType,
      approxBytes,
      rawDataUrl
    );

    db.prepare("UPDATE merchant_onboarding_applications SET updated_at = datetime('now') WHERE id = ?").run(appId);

    const saved = db
      .prepare('SELECT id, application_id, doc_type, doc_label_ar, file_name, mime_type, file_size, uploaded_at FROM merchant_onboarding_documents WHERE id = ?')
      .get(docId) as Record<string, unknown>;

    res.status(201).json({
      ok: true,
      document: formatApplicationDocumentMeta(saved),
    });
  });

  app.delete('/api/merchant-onboarding/applications/:appNumber/documents/:docId', attachOptionalAuth, (req: Request, res: Response) => {
    const appNumber = String(req.params.appNumber || '').trim();
    const docId = String(req.params.docId || '').trim();
    const existing = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE application_number = ? OR id = ?')
      .get(appNumber, appNumber) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
    if (!verifyApplicationAccess(req, existing)) {
      return res.status(403).json({ error: 'غير مصرح بحذف مستندات هذا الطلب' });
    }
    const status = String(existing.status || 'draft');
    if (status !== 'draft' && status !== 'needs_completion') {
      return res.status(409).json({ error: 'لا يمكن حذف مستندات طلب قيد المراجعة أو معتمد' });
    }
    db.prepare('DELETE FROM merchant_onboarding_documents WHERE id = ? AND application_id = ?').run(docId, String(existing.id));
    res.json({ ok: true });
  });

  // Protected document download/view (Admin OR valid X-Application-Secret OR Linked Merchant Owner)
  app.get('/api/merchant-onboarding/documents/:docId', attachOptionalAuth, (req: Request, res: Response) => {
    const docId = String(req.params.docId || '').trim();
    const doc = db
      .prepare('SELECT * FROM merchant_onboarding_documents WHERE id = ?')
      .get(docId) as Record<string, unknown> | undefined;
    if (!doc) return res.status(404).json({ error: 'المستند غير موجود' });

    const appRow = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?')
      .get(String(doc.application_id)) as Record<string, unknown> | undefined;
    if (!appRow) return res.status(404).json({ error: 'الطلب المرتبط بالمستند غير موجود' });

    if (!verifyApplicationAccess(req, appRow)) {
      return res.status(403).json({ error: 'غير مصرح بعرض هذا المستند المحمي' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      document: {
        ...formatApplicationDocumentMeta(doc),
        data_url: String(doc.data_url || ''),
      },
    });
  });

  app.post('/api/merchant-onboarding/applications/:appNumber/submit', attachOptionalAuth, (req: Request, res: Response) => {
    if (!checkLimit(req, res, 'mer_onb_submit', 15, 10 * 60 * 1000)) return;
    const appNumber = String(req.params.appNumber || '').trim();
    const existing = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE application_number = ? OR id = ?')
      .get(appNumber, appNumber) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
    if (!verifyApplicationAccess(req, existing)) {
      return res.status(403).json({ error: 'غير مصرح بإرسال هذا الطلب' });
    }

    const fromStatus = String(existing.status || 'draft');
    if (fromStatus !== 'draft' && fromStatus !== 'needs_completion') {
      return res.status(409).json({ error: 'تم إرسال هذا الطلب بالفعل ولا يمكن إعادة إرساله في حالته الحالية' });
    }

    const docs = db
      .prepare('SELECT * FROM merchant_onboarding_documents WHERE application_id = ?')
      .all(String(existing.id)) as Array<Record<string, unknown>>;

    const validationErrors = validateSubmissionCompleteness(existing, docs);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: validationErrors[0],
        validation_errors: validationErrors,
      });
    }

    const existingMatch = findMatchingExistingMerchant(String(existing.email || ''), String(existing.phone || ''));
    db.prepare(
      `UPDATE merchant_onboarding_applications SET
        status = 'under_review',
        existing_match_merchant_id = ?,
        submitted_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(existingMatch ? String(existingMatch.id) : null, String(existing.id));

    recordHistory({
      applicationId: String(existing.id),
      fromStatus,
      toStatus: 'under_review',
      actorName: String(existing.owner_name || existing.business_name_ar || 'المتقدم'),
      actorRole: 'applicant',
      note:
        fromStatus === 'needs_completion'
          ? 'تم استكمال البيانات المطلوبة وإعادة إرسال الطلب للمراجعة'
          : 'تم إرسال طلب الانضمام للمراجعة والاعتماد من الإدارة',
    });

    recordAuditLog({
      actor_name: String(existing.owner_name || existing.email || 'متقدم جديد'),
      actor_role: 'merchant_applicant',
      action: 'MERCHANT_ONBOARDING_SUBMITTED',
      entity_type: 'merchant_onboarding_applications',
      entity_id: String(existing.id),
      details: `إرسال طلب انضمام جديد #${String(existing.application_number)} (${String(existing.business_name_ar)} · ${String(existing.activity_category)})`,
    });

    deps.broadcastToRooms?.(['admins'], {
      type: 'MERCHANT_ONBOARDING_SUBMITTED',
      application_id: String(existing.id),
      application_number: String(existing.application_number),
      business_name_ar: String(existing.business_name_ar),
      activity_category: String(existing.activity_category),
    });

    const updated = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?')
      .get(String(existing.id)) as Record<string, unknown>;

    res.json({
      ok: true,
      message: 'تم إرسال طلب انضمامك بنجاح وهو الآن قيد المراجعة من إدارة اطلبها. لن يتم تفعيل الحساب إلا بعد الاعتماد.',
      application: serializeApplication(updated, true),
    });
  });

  // Public status tracking by application_number + phone or email (no PII/docs leaked!)
  app.post('/api/merchant-onboarding/status', (req: Request, res: Response) => {
    if (!checkLimit(req, res, 'mer_onb_status', 30, 5 * 60 * 1000)) return;
    const { application_number, phone, email, contact } = (req.body || {}) as Record<string, unknown>;
    const appNo = String(application_number || '').trim().toUpperCase();
    const rawContact = String(contact || '').trim();
    const cleanPhone = normalizePhone(String(phone || (!rawContact.includes('@') ? rawContact : '')));
    const cleanEmail = normalizeEmail(String(email || (rawContact.includes('@') ? rawContact : '')));
    if (!appNo || (!cleanPhone && !cleanEmail)) {
      return res.status(400).json({ error: 'أدخل رقم الطلب مع رقم الهاتف أو البريد الإلكتروني المسجل للتحقق' });
    }

    const row = db
      .prepare('SELECT * FROM merchant_onboarding_applications WHERE UPPER(application_number) = ?')
      .get(appNo) as Record<string, unknown> | undefined;
    if (!row) {
      return res.status(404).json({ error: 'لم يتم العثور على طلب بهذا الرقم' });
    }

    const rowPhone = normalizePhone(String(row.phone || ''));
    const rowEmail = String(row.email || '').trim().toLowerCase();
    const phoneMatches = Boolean(cleanPhone && rowPhone && rowPhone === cleanPhone);
    const emailMatches = Boolean(cleanEmail && rowEmail && rowEmail === cleanEmail);
    if (!phoneMatches && !emailMatches) {
      return res.status(403).json({ error: 'بيانات التواصل لا تطابق رقم الطلب المدخل' });
    }

    const serialized = serializeApplication(row, false);
    res.json({
      ok: true,
      application_number: serialized.application_number,
      business_name_ar: serialized.business_name_ar,
      status: serialized.status,
      admin_notes: serialized.review_note || serialized.rejection_reason || '',
      application: serialized,
    });
  });

  // =========================================================================
  // 2. ADMIN REVIEW QUEUE & DECISION WORKFLOW (PROTECTED: ADMIN ROLES ONLY)
  // =========================================================================

  app.get(
    '/api/admin/merchant-onboarding/applications',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const statusFilter = String(req.query.status || 'all').trim();
      const activityFilter = String(req.query.activity_category || 'all').trim();
      const q = String(req.query.q || '').trim().toLowerCase();

      const clauses: string[] = [];
      const params: unknown[] = [];

      if (statusFilter && statusFilter !== 'all') {
        clauses.push('status = ?');
        params.push(statusFilter);
      }
      if (activityFilter && activityFilter !== 'all') {
        clauses.push('activity_category = ?');
        params.push(activityFilter);
      }
      if (q) {
        const like = `%${q}%`;
        clauses.push(
          '(LOWER(application_number) LIKE ? OR LOWER(business_name_ar) LIKE ? OR LOWER(owner_name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ?)'
        );
        params.push(like, like, like, like, like);
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT * FROM merchant_onboarding_applications ${whereSql}
           ORDER BY
             CASE status
               WHEN 'under_review' THEN 0
               WHEN 'needs_completion' THEN 1
               WHEN 'draft' THEN 2
               WHEN 'approved' THEN 3
               WHEN 'activated' THEN 4
               WHEN 'rejected' THEN 5
               ELSE 6
             END ASC,
             updated_at DESC
           LIMIT 200`
        )
        .all(...params) as Array<Record<string, unknown>>;

      const countRows = db
        .prepare('SELECT status, COUNT(*) AS c FROM merchant_onboarding_applications GROUP BY status')
        .all() as Array<{ status: string; c: number }>;
      const counts: Record<string, number> = {
        all: 0,
        draft: 0,
        under_review: 0,
        needs_completion: 0,
        approved: 0,
        activated: 0,
        rejected: 0,
      };
      for (const r of countRows) {
        counts[r.status] = Number(r.c || 0);
        counts.all += Number(r.c || 0);
      }

      res.json({
        ok: true,
        counts,
        applications: rows.map((r) => serializeApplication(r, true)),
      });
    }
  );

  app.get(
    '/api/admin/merchant-onboarding/applications/:id',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const id = String(req.params.id || '').trim();
      const row = db
        .prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ? OR application_number = ?')
        .get(id, id) as Record<string, unknown> | undefined;
      if (!row) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });
      res.json({ ok: true, application: serializeApplication(row, true) });
    }
  );

  app.post(
    '/api/admin/merchant-onboarding/applications/:id/decision',
    requireAuth,
    requireRole(...ALL_ADMIN_ROLES),
    (req: Request, res: Response) => {
      const id = String(req.params.id || '').trim();
      const existing = db
        .prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ? OR application_number = ?')
        .get(id, id) as Record<string, unknown> | undefined;
      if (!existing) return res.status(404).json({ error: 'طلب الانضمام غير موجود' });

      const {
        action,
        review_note,
        rejection_reason,
        requested_changes,
        commission_rate,
        link_existing_merchant_id,
      } = (req.body || {}) as Record<string, unknown>;

      const cleanAction = String(action || '').trim();
      if (!['approve', 'request_completion', 'reject'].includes(cleanAction)) {
        return res.status(400).json({ error: 'الإجراء غير صالح (المتاح: approve | request_completion | reject)' });
      }

      const appId = String(existing.id);
      const fromStatus = String(existing.status || 'draft');
      const actorName = req.auth!.fullName;
      const actorRole = req.auth!.role;

      if (cleanAction === 'request_completion') {
        const note = String(review_note || '').trim();
        const changesList = Array.isArray(requested_changes)
          ? requested_changes.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        if (!note && changesList.length === 0) {
          return res.status(400).json({ error: 'يرجى كتابة ملاحظات الاستكمال المطلوبة للمتقدم' });
        }

        db.prepare(
          `UPDATE merchant_onboarding_applications SET
            status = 'needs_completion',
            review_note = ?,
            requested_changes_json = ?,
            reviewed_by = ?,
            reviewed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`
        ).run(note, JSON.stringify(changesList), actorName, appId);

        recordHistory({
          applicationId: appId,
          fromStatus,
          toStatus: 'needs_completion',
          actorName,
          actorRole,
          note: note || changesList.join(' · '),
        });

        recordAuditLog({
          actor_name: actorName,
          actor_role: actorRole,
          action: 'MERCHANT_ONBOARDING_NEEDS_COMPLETION',
          entity_type: 'merchant_onboarding_applications',
          entity_id: appId,
          details: `طلب استكمال للطلب #${String(existing.application_number)} (${String(existing.business_name_ar)}): ${note}`,
        });

        const updated = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(appId) as Record<string, unknown>;
        return res.json({
          ok: true,
          message: 'تم إرسال طلب استكمال البيانات للمتقدم وتحديث حالة الطلب',
          application: serializeApplication(updated, true),
        });
      }

      if (cleanAction === 'reject') {
        const reason = String(rejection_reason || review_note || '').trim();
        if (!reason) {
          return res.status(400).json({ error: 'يرجى كتابة سبب الرفض ليظهر للمتقدم ويُسجل في سجل المراجعة' });
        }

        db.prepare(
          `UPDATE merchant_onboarding_applications SET
            status = 'rejected',
            rejection_reason = ?,
            review_note = ?,
            reviewed_by = ?,
            reviewed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`
        ).run(reason, String(review_note || reason).trim(), actorName, appId);

        recordHistory({
          applicationId: appId,
          fromStatus,
          toStatus: 'rejected',
          actorName,
          actorRole,
          note: reason,
        });

        recordAuditLog({
          actor_name: actorName,
          actor_role: actorRole,
          action: 'MERCHANT_ONBOARDING_REJECTED',
          entity_type: 'merchant_onboarding_applications',
          entity_id: appId,
          details: `رفض طلب الانضمام #${String(existing.application_number)} (${String(existing.business_name_ar)}): ${reason}`,
        });

        const updated = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(appId) as Record<string, unknown>;
        return res.json({
          ok: true,
          message: 'تم تسجيل قرار رفض الطلب وإشعار المتقدم',
          application: serializeApplication(updated, true),
        });
      }

      // APPROVE & ACTIVATE (Smart Link existing account OR Create new approved merchant account atomically)
      if (fromStatus === 'activated' && existing.linked_merchant_id) {
        const already = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(appId) as Record<string, unknown>;
        return res.json({
          ok: true,
          already_activated: true,
          linked_merchant_id: String(existing.linked_merchant_id),
          application: serializeApplication(already, true),
        });
      }

      const activityCategory = resolveActivityCategory(
        String(existing.merchant_type || ''),
        String(existing.activity_category || '')
      );
      const details = safeJsonParse<Record<string, unknown>>(existing.activity_details_json, {});
      const docs = db
        .prepare('SELECT doc_type, id FROM merchant_onboarding_documents WHERE application_id = ?')
        .all(appId) as Array<{ doc_type: string; id: string }>;
      const docUrlByType = new Map(docs.map((d) => [d.doc_type, `/api/merchant-onboarding/documents/${encodeURIComponent(d.id)}`]));

      const email = normalizeEmail(String(existing.email || ''));
      const phone = normalizePhone(String(existing.phone || ''));
      const explicitLinkId = String(link_existing_merchant_id || '').trim();

      let targetMerchant: Record<string, unknown> | null = null;
      if (explicitLinkId) {
        targetMerchant =
          (db.prepare('SELECT * FROM merchants WHERE id = ?').get(explicitLinkId) as Record<string, unknown> | undefined) || null;
        if (!targetMerchant) {
          return res.status(404).json({ error: 'الحساب المختار للربط غير موجود' });
        }
      } else {
        const matched = findMatchingExistingMerchant(email, phone);
        if (matched) {
          targetMerchant =
            (db.prepare('SELECT * FROM merchants WHERE id = ?').get(String(matched.id)) as Record<string, unknown> | undefined) || null;
        }
      }

      let finalMerchantId = '';
      let actionMode: 'linked_existing' | 'created_new' = 'created_new';

      const tx = db.transaction(() => {
        if (targetMerchant) {
          actionMode = 'linked_existing';
          finalMerchantId = String(targetMerchant.id);
          // Safely link & enrich missing profile/activity fields WITHOUT altering password_hash, token_version, or wiping existing data!
          db.prepare(
            `UPDATE merchants SET
              verification_status = 'approved',
              activity_category = COALESCE(NULLIF(activity_category, ''), ?),
              onboarding_application_id = ?,
              avg_prep_minutes = COALESCE(avg_prep_minutes, ?),
              cuisine_type = COALESCE(NULLIF(cuisine_type, ''), ?),
              tax_card_no = COALESCE(NULLIF(tax_card_no, ''), ?),
              health_cert_no = COALESCE(NULLIF(health_cert_no, ''), ?),
              pharmacy_license_no = COALESCE(NULLIF(pharmacy_license_no, ''), ?),
              pharmacist_name = COALESCE(NULLIF(pharmacist_name, ''), ?),
              syndicate_no = COALESCE(NULLIF(syndicate_no, ''), ?)
            WHERE id = ?`
          ).run(
            activityCategory,
            appId,
            Number(details.avg_prep_minutes || 15),
            String(details.cuisine_type || ''),
            String(existing.tax_card_no || ''),
            String(details.health_cert_no || ''),
            details.pharmacy_license_no ? String(details.pharmacy_license_no) : null,
            details.pharmacist_name ? String(details.pharmacist_name) : null,
            details.syndicate_no ? String(details.syndicate_no) : null,
            finalMerchantId
          );

          const refreshedMer = db.prepare('SELECT * FROM merchants WHERE id = ?').get(finalMerchantId) as Record<string, unknown>;
          ensureMerchantOwnerStaffRow(refreshedMer);
        } else {
          actionMode = 'created_new';
          finalMerchantId = uid('mer');
          const pwHash = String(existing.password_hash || '').trim();
          if (!pwHash) {
            throw new Error('لا توجد كلمة مرور مسجلة لإنشاء الحساب الجديد — اطلب من المتقدم استكمال كلمة المرور');
          }

          const commRate =
            commission_rate !== undefined && Number.isFinite(Number(commission_rate))
              ? Math.max(0, Math.min(35, Number(commission_rate)))
              : 5;
          const mType = String(existing.merchant_type || MERCHANT_ACTIVITY_REGISTRY[activityCategory].default_merchant_type);
          const isPharmacy = activityCategory === 'pharmacy';
          const licenseRef =
            docUrlByType.get('pharmacy_license') ||
            docUrlByType.get('commercial_reg') ||
            docUrlByType.get('health_cert') ||
            docUrlByType.get('national_id_front') ||
            '';

          db.prepare(
            `INSERT INTO merchants (
              id, email, is_email_verified, password_hash, business_name_ar, business_name_en, merchant_type,
              branch_name, zone_name, phone, whatsapp_phone, owner_name, owner_national_id,
              address_detail, lat, lng, commercial_reg_no, license_doc_url, payout_method, payout_account,
              working_hours, terms_accepted, terms_accepted_at, image_url, description_ar, commission_rate,
              verification_status, supports_free_order, is_open_now,
              pharmacy_license_no, pharmacist_name, syndicate_no, orders_count,
              activity_category, onboarding_application_id, avg_prep_minutes, cuisine_type, tax_card_no, health_cert_no
            ) VALUES (
              ?, ?, 1, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, 1, datetime('now'), '', ?, ?,
              'approved', ?, 1,
              ?, ?, ?, 0,
              ?, ?, ?, ?, ?, ?
            )`
          ).run(
            finalMerchantId,
            email,
            pwHash,
            String(existing.business_name_ar || '').trim(),
            String(existing.business_name_en || existing.business_name_ar || '').trim(),
            mType,
            String(existing.branch_name || '').trim(),
            String(existing.zone_name || '').trim(),
            phone,
            String(existing.whatsapp_phone || phone).trim(),
            String(existing.owner_name || '').trim(),
            String(existing.owner_national_id || '').trim(),
            String(existing.address_detail || '').trim(),
            existing.lat != null ? Number(existing.lat) : null,
            existing.lng != null ? Number(existing.lng) : null,
            String(existing.commercial_reg_no || '').trim(),
            licenseRef,
            String(existing.payout_method || 'vodafone_cash').trim(),
            String(existing.payout_account || phone).trim(),
            String(existing.working_hours || '09:00 ص - 12:00 م').trim(),
            String(existing.description_ar || '').trim(),
            commRate,
            existing.supports_free_order === 0 ? 0 : 1,
            isPharmacy ? String(details.pharmacy_license_no || '').trim() : null,
            isPharmacy ? String(details.pharmacist_name || '').trim() : null,
            isPharmacy ? String(details.syndicate_no || '').trim() : null,
            activityCategory,
            appId,
            Number(details.avg_prep_minutes || 15),
            String(details.cuisine_type || '').trim(),
            String(existing.tax_card_no || '').trim(),
            String(details.health_cert_no || '').trim()
          );

          // Create merchant wallet (do NOT touch platform categories hierarchy!)
          db.prepare(
            `INSERT OR IGNORE INTO wallets (id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen)
             VALUES (?, ?, ?, 'merchant', 0, 0, 0)`
          ).run(uid('wal'), finalMerchantId, String(existing.business_name_ar || '').trim());

          const createdMer = db.prepare('SELECT * FROM merchants WHERE id = ?').get(finalMerchantId) as Record<string, unknown>;
          ensureMerchantOwnerStaffRow(createdMer);
        }

        db.prepare(
          `UPDATE merchant_onboarding_applications SET
            status = 'activated',
            review_note = ?,
            reviewed_by = ?,
            reviewed_at = datetime('now'),
            linked_merchant_id = ?,
            activated_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`
        ).run(
          String(review_note || (actionMode === 'linked_existing' ? 'تم الاعتماد وربط الطلب بالحساب الموجود بنجاح' : 'تم الاعتماد وإنشاء وتفعيل حساب النشاط بنجاح')).trim(),
          actorName,
          finalMerchantId,
          appId
        );

        recordHistory({
          applicationId: appId,
          fromStatus,
          toStatus: 'approved',
          actorName,
          actorRole,
          note: String(review_note || 'موافقة الإدارة على طلب الانضمام'),
        });
        recordHistory({
          applicationId: appId,
          fromStatus: 'approved',
          toStatus: 'activated',
          actorName,
          actorRole,
          note:
            actionMode === 'linked_existing'
              ? `تم ربط الطلب بالحساب الموجود (${finalMerchantId}) وتفعيله دون تكرار`
              : `تم إنشاء وتفعيل حساب النشاط الجديد (${finalMerchantId})`,
        });

        recordAuditLog({
          actor_name: actorName,
          actor_role: actorRole,
          action: actionMode === 'linked_existing' ? 'MERCHANT_ONBOARDING_APPROVED_LINKED' : 'MERCHANT_ONBOARDING_APPROVED_CREATED',
          entity_type: 'merchant_onboarding_applications',
          entity_id: appId,
          details: `اعتماد طلب الانضمام #${String(existing.application_number)} (${String(existing.business_name_ar)}) -> حساب التاجر ${finalMerchantId} (${actionMode})`,
        });
      });

      try {
        tx();
      } catch (err) {
        return res.status(400).json({ error: (err as Error).message || 'تعذر اعتماد الطلب' });
      }

      deps.enqueueSystemPushNotification?.({
        app_target: 'merchant',
        target_user_id: finalMerchantId,
        title_ar: 'تم اعتماد وتفعيل حسابك في اطلبها 🎉',
        body_ar: `مبروك! تم قبول طلب انضمام «${String(existing.business_name_ar)}» وتفعيل الحساب بنجاح.`,
        data: { type: 'onboarding_activated', application_number: String(existing.application_number) },
      });

      const updatedApp = db.prepare('SELECT * FROM merchant_onboarding_applications WHERE id = ?').get(appId) as Record<string, unknown>;
      const linkedMer = db.prepare('SELECT * FROM merchants WHERE id = ?').get(finalMerchantId) as Record<string, unknown> | undefined;
      if (linkedMer) delete linkedMer.password_hash;

      const resolvedActionMode = actionMode as 'linked_existing' | 'created_new';
      res.json({
        ok: true,
        mode: resolvedActionMode,
        linked_merchant_id: finalMerchantId,
        merchant: linkedMer || null,
        message:
          resolvedActionMode === 'linked_existing'
            ? 'تم اعتماد الطلب وربطه بحساب التاجر الموجود مسبقًا دون تكرار الحسابات.'
            : 'تم اعتماد الطلب وإنشاء وتفعيل حساب النشاط الجديد بنجاح.',
        application: serializeApplication(updatedApp, true),
      });
    }
  );

  // =========================================================================
  // 3. MERCHANT ACTIVITY WORKSPACE PROFILE, RESTAURANT MENU & TEAM RBAC
  // =========================================================================

  app.get('/api/merchant/workspace/profile', requireAuth, (req: Request, res: Response) => {
    const requestedMerchantId = String(req.query.merchant_id || '').trim();
    const merchantId = isAdminAuth(req.auth!) && requestedMerchantId ? requestedMerchantId : req.auth!.id;
    if (!isAdminAuth(req.auth!) && req.auth!.role !== 'merchant') {
      return res.status(403).json({ error: 'غير مصرح بالوصول لمساحة عمل التاجر' });
    }
    if (!isAdminAuth(req.auth!) && merchantId !== req.auth!.id) {
      return res.status(403).json({ error: 'لا يمكنك الوصول لمساحة عمل متجر آخر' });
    }

    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(merchantId) as Record<string, unknown> | undefined;
    if (!merchant) return res.status(404).json({ error: 'حساب النشاط غير موجود' });

    ensureMerchantOwnerStaffRow(merchant);
    const activityProfile = resolveActivityProfile(
      String(merchant.merchant_type || ''),
      String(merchant.activity_category || '')
    );

    const staff = db
      .prepare(
        'SELECT id, merchant_id, full_name, email, phone, staff_role, permissions_json, is_active, created_at FROM merchant_staff_members WHERE merchant_id = ? ORDER BY CASE staff_role WHEN \'owner\' THEN 0 WHEN \'manager\' THEN 1 ELSE 2 END, created_at ASC'
      )
      .all(merchantId) as Array<Record<string, unknown>>;

    const prodStats = db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END), 0) AS active_count,
          COALESCE(SUM(CASE WHEN is_available = 0 THEN 1 ELSE 0 END), 0) AS paused_count,
          COALESCE(SUM(CASE WHEN is_offer = 1 OR (sale_price IS NOT NULL AND sale_price < base_price) THEN 1 ELSE 0 END), 0) AS offers_count,
          COALESCE(SUM(CASE WHEN requires_prescription = 1 THEN 1 ELSE 0 END), 0) AS rx_products_count
        FROM products WHERE merchant_id = ?`
      )
      .get(merchantId) as Record<string, unknown>;

    const { password_hash: _pw, ...safeMerchant } = merchant;

    res.json({
      ok: true,
      merchant: {
        ...safeMerchant,
        is_open_now: Boolean(merchant.is_open_now),
        is_open: Boolean(merchant.is_open_now),
        supports_free_order: Boolean(merchant.supports_free_order),
        activity_category: activityProfile.category,
      },
      activity_profile: activityProfile,
      staff_roles_catalog: Object.values(MERCHANT_STAFF_ROLES),
      staff: staff.map((s) => ({
        ...s,
        is_active: Boolean(s.is_active),
        permissions: safeJsonParse<string[]>(s.permissions_json, []),
        role_meta: MERCHANT_STAFF_ROLES[(String(s.staff_role) as MerchantStaffRole)] || MERCHANT_STAFF_ROLES.orders_staff,
      })),
      stats: {
        total_items: Number(prodStats?.total || 0),
        active_items: Number(prodStats?.active_count || 0),
        paused_items: Number(prodStats?.paused_count || 0),
        offers_count: Number(prodStats?.offers_count || 0),
        rx_products_count: Number(prodStats?.rx_products_count || 0),
      },
    });
  });

  // Restaurant / Cafe Menu Items (Built cleanly on top of existing `products` table without touching categories!)
  app.get('/api/merchant/menu-items', requireAuth, (req: Request, res: Response) => {
    const requestedMerchantId = String(req.query.merchant_id || '').trim();
    const merchantId = isAdminAuth(req.auth!) && requestedMerchantId ? requestedMerchantId : req.auth!.id;
    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || merchantId !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بالوصول لقائمة الطعام' });
    }

    const rows = db
      .prepare(
        `SELECT id, merchant_id, category_id, name_ar, name_en, description, image_url,
                base_price, sale_price, is_offer, is_available, addons_text,
                prep_time_minutes, variants_json, addons_json, meal_section, created_at, updated_at
         FROM products
         WHERE merchant_id = ?
         ORDER BY is_available DESC, meal_section ASC, updated_at DESC`
      )
      .all(merchantId) as Array<Record<string, unknown>>;

    res.json({
      ok: true,
      items: rows.map((r) => ({
        ...r,
        base_price: Number(r.base_price || 0),
        sale_price: r.sale_price != null ? Number(r.sale_price) : null,
        is_offer: Boolean(r.is_offer),
        is_available: Boolean(r.is_available),
        prep_time_minutes: Number(r.prep_time_minutes || 15),
        variants: safeJsonParse<Array<{ label: string; price: number }>>(r.variants_json, []),
        addons: safeJsonParse<Array<{ label: string; price: number }>>(r.addons_json, []),
        meal_section: String(r.meal_section || ''),
      })),
    });
  });

  app.post('/api/merchant/menu-items', requireAuth, (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const merchantId = isAdminAuth(req.auth!) && body.merchant_id ? String(body.merchant_id).trim() : req.auth!.id;
    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || merchantId !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بإضافة وجبات لهذا النشاط' });
    }

    const merchant = db.prepare('SELECT id, business_name_ar FROM merchants WHERE id = ?').get(merchantId) as
      | { id: string; business_name_ar: string }
      | undefined;
    if (!merchant) return res.status(404).json({ error: 'الحساب غير موجود' });

    const nameAr = String(body.name_ar || '').trim();
    const basePrice = Number(body.base_price);
    if (!nameAr || !Number.isFinite(basePrice) || basePrice <= 0) {
      return res.status(400).json({ error: 'يرجى إدخال اسم الوجبة/الصنف وسعر صحيح أكبر من صفر' });
    }

    const salePriceRaw = body.sale_price !== undefined && body.sale_price !== null && body.sale_price !== '' ? Number(body.sale_price) : null;
    const salePrice = salePriceRaw !== null && Number.isFinite(salePriceRaw) && salePriceRaw > 0 && salePriceRaw < basePrice ? salePriceRaw : null;
    const prepMinutes = Math.max(1, Math.min(180, Math.round(Number(body.prep_time_minutes || 15) || 15)));
    const variants = Array.isArray(body.variants)
      ? body.variants
          .filter((v) => v && typeof v === 'object' && String((v as Record<string, unknown>).label || '').trim())
          .map((v) => ({
            label: String((v as Record<string, unknown>).label).trim().slice(0, 60),
            price: Math.max(0, Number((v as Record<string, unknown>).price || 0)),
          }))
      : [];
    const addons = Array.isArray(body.addons)
      ? body.addons
          .filter((a) => a && typeof a === 'object' && String((a as Record<string, unknown>).label || '').trim())
          .map((a) => ({
            label: String((a as Record<string, unknown>).label).trim().slice(0, 60),
            price: Math.max(0, Number((a as Record<string, unknown>).price || 0)),
          }))
      : [];
    const addonsText = addons.map((a) => (a.price > 0 ? `${a.label} (+${a.price} ج.م)` : a.label)).join('، ');
    const mealSection = String(body.meal_section || '').trim().slice(0, 80);

    // Pick an existing active category_id without ever mutating categories table!
    let catId = String(body.category_id || '').trim();
    if (!catId) {
      const existingCat = db
        .prepare("SELECT id FROM categories WHERE is_active = 1 ORDER BY sort_order ASC LIMIT 1")
        .get() as { id?: string } | undefined;
      catId = String(existingCat?.id || 'cat_general');
    }

    const prodId = uid('prod');
    const code = `MNU-${crypto.randomInt(10000, 99999)}`;
    db.prepare(
      `INSERT INTO products (
        id, product_code, merchant_id, category_id, name_ar, name_en, description, image_url,
        base_price, sale_price, is_offer, stock_quantity, low_stock_threshold,
        requires_prescription, addons_text, is_available,
        prep_time_minutes, variants_json, addons_json, meal_section
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 999, 5,
        0, ?, ?,
        ?, ?, ?, ?
      )`
    ).run(
      prodId,
      code,
      merchantId,
      catId,
      nameAr.slice(0, 160),
      String(body.name_en || nameAr).trim().slice(0, 160),
      String(body.description || '').trim().slice(0, 500),
      String(body.image_url || '').trim(),
      basePrice,
      salePrice,
      salePrice !== null ? 1 : 0,
      addonsText,
      body.is_available === false ? 0 : 1,
      prepMinutes,
      JSON.stringify(variants),
      JSON.stringify(addons),
      mealSection
    );

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId) as Record<string, unknown>;
    res.status(201).json({
      ok: true,
      item: {
        ...created,
        is_offer: Boolean(created.is_offer),
        is_available: Boolean(created.is_available),
        prep_time_minutes: Number(created.prep_time_minutes || 15),
        variants,
        addons,
        meal_section: mealSection,
      },
    });
  });

  app.patch('/api/merchant/menu-items/:productId', requireAuth, (req: Request, res: Response) => {
    const productId = String(req.params.productId || '').trim();
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'الصنف غير موجود' });

    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || String(existing.merchant_id) !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بتعديل هذا الصنف' });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const nextBase = body.base_price !== undefined ? Number(body.base_price) : Number(existing.base_price);
    if (!Number.isFinite(nextBase) || nextBase <= 0) {
      return res.status(400).json({ error: 'السعر الأساسي غير صحيح' });
    }

    let nextSale = existing.sale_price != null ? Number(existing.sale_price) : null;
    if (body.sale_price !== undefined) {
      if (body.sale_price === null || body.sale_price === '') {
        nextSale = null;
      } else {
        const s = Number(body.sale_price);
        nextSale = Number.isFinite(s) && s > 0 && s < nextBase ? s : null;
      }
    }

    const nextPrep =
      body.prep_time_minutes !== undefined
        ? Math.max(1, Math.min(180, Math.round(Number(body.prep_time_minutes) || 15)))
        : Number(existing.prep_time_minutes || 15);

    const nextVariants =
      body.variants !== undefined && Array.isArray(body.variants)
        ? body.variants
            .filter((v) => v && typeof v === 'object' && String((v as Record<string, unknown>).label || '').trim())
            .map((v) => ({
              label: String((v as Record<string, unknown>).label).trim().slice(0, 60),
              price: Math.max(0, Number((v as Record<string, unknown>).price || 0)),
            }))
        : safeJsonParse<Array<{ label: string; price: number }>>(existing.variants_json, []);

    const nextAddons =
      body.addons !== undefined && Array.isArray(body.addons)
        ? body.addons
            .filter((a) => a && typeof a === 'object' && String((a as Record<string, unknown>).label || '').trim())
            .map((a) => ({
              label: String((a as Record<string, unknown>).label).trim().slice(0, 60),
              price: Math.max(0, Number((a as Record<string, unknown>).price || 0)),
            }))
        : safeJsonParse<Array<{ label: string; price: number }>>(existing.addons_json, []);

    const nextAddonsText =
      body.addons !== undefined
        ? nextAddons.map((a) => (a.price > 0 ? `${a.label} (+${a.price} ج.م)` : a.label)).join('، ')
        : String(existing.addons_text || '');

    db.prepare(
      `UPDATE products SET
        name_ar = ?,
        description = ?,
        base_price = ?,
        sale_price = ?,
        is_offer = ?,
        is_available = ?,
        prep_time_minutes = ?,
        variants_json = ?,
        addons_json = ?,
        addons_text = ?,
        meal_section = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      body.name_ar !== undefined ? String(body.name_ar || '').trim().slice(0, 160) : String(existing.name_ar || ''),
      body.description !== undefined ? String(body.description || '').trim().slice(0, 500) : String(existing.description || ''),
      nextBase,
      nextSale,
      nextSale !== null ? 1 : 0,
      body.is_available !== undefined ? (body.is_available ? 1 : 0) : existing.is_available,
      nextPrep,
      JSON.stringify(nextVariants),
      JSON.stringify(nextAddons),
      nextAddonsText,
      body.meal_section !== undefined ? String(body.meal_section || '').trim().slice(0, 80) : String(existing.meal_section || ''),
      productId
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<string, unknown>;
    res.json({
      ok: true,
      item: {
        ...updated,
        is_offer: Boolean(updated.is_offer),
        is_available: Boolean(updated.is_available),
        prep_time_minutes: Number(updated.prep_time_minutes || 15),
        variants: nextVariants,
        addons: nextAddons,
        meal_section: String(updated.meal_section || ''),
      },
    });
  });

  // Future-ready Multi-Role Staff Management (Owner / Manager / Orders Staff / Catalog Staff)
  app.get('/api/merchant/staff', requireAuth, (req: Request, res: Response) => {
    const requestedMerchantId = String(req.query.merchant_id || '').trim();
    const merchantId = isAdminAuth(req.auth!) && requestedMerchantId ? requestedMerchantId : req.auth!.id;
    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || merchantId !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بعرض فريق العمل' });
    }
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(merchantId) as Record<string, unknown> | undefined;
    if (!merchant) return res.status(404).json({ error: 'الحساب غير موجود' });
    ensureMerchantOwnerStaffRow(merchant);

    const rows = db
      .prepare('SELECT id, merchant_id, full_name, email, phone, staff_role, permissions_json, is_active, created_at FROM merchant_staff_members WHERE merchant_id = ? ORDER BY created_at ASC')
      .all(merchantId) as Array<Record<string, unknown>>;

    res.json({
      ok: true,
      roles_catalog: Object.values(MERCHANT_STAFF_ROLES),
      staff: rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        permissions: safeJsonParse<string[]>(r.permissions_json, []),
        role_meta: MERCHANT_STAFF_ROLES[(String(r.staff_role) as MerchantStaffRole)] || MERCHANT_STAFF_ROLES.orders_staff,
      })),
    });
  });

  app.post('/api/merchant/staff', requireAuth, (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const merchantId = isAdminAuth(req.auth!) && body.merchant_id ? String(body.merchant_id).trim() : req.auth!.id;
    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || merchantId !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بإضافة أعضاء فريق لهذا الحساب' });
    }

    const fullName = String(body.full_name || '').trim();
    const role = String(body.staff_role || 'orders_staff').trim() as MerchantStaffRole;
    if (!fullName) return res.status(400).json({ error: 'يرجى إدخال اسم عضو الفريق' });
    if (!MERCHANT_STAFF_ROLES[role]) return res.status(400).json({ error: 'الدور الوظيفي غير صالح' });

    const email = body.email ? normalizeEmail(String(body.email)) : '';
    const phone = normalizePhone(String(body.phone || ''));
    const rawPw = String(body.password || '');
    const pwHash = rawPw.length >= 6 ? hashPassword(rawPw) : '';

    const staffId = uid('mstaff');
    const perms = MERCHANT_STAFF_ROLES[role].permissions;
    db.prepare(
      `INSERT INTO merchant_staff_members (id, merchant_id, full_name, email, phone, password_hash, staff_role, permissions_json, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(staffId, merchantId, fullName.slice(0, 120), email, phone.slice(0, 20), pwHash, role, JSON.stringify(perms), req.auth!.fullName);

    recordAuditLog({
      actor_name: req.auth!.fullName,
      actor_role: req.auth!.role,
      action: 'MERCHANT_STAFF_ADDED',
      entity_type: 'merchant_staff_members',
      entity_id: staffId,
      details: `إضافة عضو فريق (${fullName} · ${MERCHANT_STAFF_ROLES[role].label_ar}) للحساب ${merchantId}`,
    });

    const created = db
      .prepare('SELECT id, merchant_id, full_name, email, phone, staff_role, permissions_json, is_active, created_at FROM merchant_staff_members WHERE id = ?')
      .get(staffId) as Record<string, unknown>;

    res.status(201).json({
      ok: true,
      member: {
        ...created,
        is_active: Boolean(created.is_active),
        permissions: perms,
        role_meta: MERCHANT_STAFF_ROLES[role],
      },
    });
  });

  app.patch('/api/merchant/staff/:staffId', requireAuth, (req: Request, res: Response) => {
    const staffId = String(req.params.staffId || '').trim();
    const existing = db.prepare('SELECT * FROM merchant_staff_members WHERE id = ?').get(staffId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'عضو الفريق غير موجود' });

    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || String(existing.merchant_id) !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بتعديل صلاحيات هذا العضو' });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const nextRole = (body.staff_role !== undefined ? String(body.staff_role).trim() : String(existing.staff_role)) as MerchantStaffRole;
    if (!MERCHANT_STAFF_ROLES[nextRole]) return res.status(400).json({ error: 'الدور الوظيفي غير صالح' });
    if (String(existing.staff_role) === 'owner' && body.is_active === false) {
      return res.status(400).json({ error: 'لا يمكن تعطيل حساب المالك الرئيسي' });
    }

    const nextPerms = MERCHANT_STAFF_ROLES[nextRole].permissions;
    db.prepare(
      `UPDATE merchant_staff_members SET
        full_name = ?,
        phone = ?,
        staff_role = ?,
        permissions_json = ?,
        is_active = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      body.full_name !== undefined ? String(body.full_name || '').trim().slice(0, 120) : String(existing.full_name || ''),
      body.phone !== undefined ? normalizePhone(String(body.phone || '')).slice(0, 20) : String(existing.phone || ''),
      nextRole,
      JSON.stringify(nextPerms),
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
      staffId
    );

    const updated = db
      .prepare('SELECT id, merchant_id, full_name, email, phone, staff_role, permissions_json, is_active, created_at FROM merchant_staff_members WHERE id = ?')
      .get(staffId) as Record<string, unknown>;
    res.json({
      ok: true,
      member: {
        ...updated,
        is_active: Boolean(updated.is_active),
        permissions: nextPerms,
        role_meta: MERCHANT_STAFF_ROLES[nextRole],
      },
    });
  });

  app.delete('/api/merchant/staff/:staffId', requireAuth, (req: Request, res: Response) => {
    const staffId = String(req.params.staffId || '').trim();
    const existing = db.prepare('SELECT * FROM merchant_staff_members WHERE id = ?').get(staffId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'عضو الفريق غير موجود' });
    if (!isAdminAuth(req.auth!) && (req.auth!.role !== 'merchant' || String(existing.merchant_id) !== req.auth!.id)) {
      return res.status(403).json({ error: 'غير مصرح بحذف عضو الفريق' });
    }
    if (String(existing.staff_role) === 'owner') {
      return res.status(400).json({ error: 'لا يمكن حذف المالك الرئيسي للنشاط' });
    }
    db.prepare('DELETE FROM merchant_staff_members WHERE id = ?').run(staffId);
    res.json({ ok: true });
  });
}
