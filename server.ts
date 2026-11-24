import './src/server/loadEnv.ts';
import express from 'express';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import zlib from 'zlib';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  buildFtsMatchQuery,
  db,
  dbPath,
  ensureBootstrapSuperAdmin,
  hashPassword,
  initDatabase,
  isProductsFtsReady,
  postDoubleEntryLedger,
  rebuildProductsFtsIndex,
  recordAuditLog,
  sha256Otp,
  uid,
  verifyPassword,
} from './src/server/db.ts';
import { startSqlitePersistSync, type SqlitePersistController } from './src/server/sqlitePersist.ts';
import { registerCloudSyncRoutes } from './src/server/cloudSyncRoutes.ts';
import {
  CloudSqlUnavailableError,
  ensureFreshFromCloudSql,
  ensureHydratedFromCloudSql,
  flushCloudSqlBeforeShutdown,
  getCloudSqlPersistenceStatus,
  syncChangesToCloudSql,
  syncIfSqliteMutated,
} from './src/server/cloudSqlPersistence.ts';
import { isCloudSqlConfigured } from './src/db/index.ts';
import { getOrCreateUser } from './src/db/users.ts';
import {
  registerMasterCatalogRoutes,
  extractSize,
  ensureMasterProductForListing,
  reconcileAllExistingProductsToMasterCatalog,
} from './src/server/masterCatalog.ts';
import {
  createCategoryPathResolver,
  enrichAndOrderCategories,
  getCategoryAndDescendantIds,
  isCategoryDescendant,
  recomputeAllCategoryPaths,
  resolveOrCreateCategoryPath,
} from './src/server/categoryHierarchy.ts';
import {
  ALL_ADMIN_ROLES,
  authenticateWsUpgrade,
  closeSocketsForSession,
  extractRefreshToken,
  hasAuthPermission,
  isAdminAuth,
  issueSessionForUser,
  optionalAuth,
  registerSessionWebSocket,
  requireAuth,
  requireOwnership,
  requirePermission,
  requireRole,
  revokeCurrentSession,
  rotateRefreshSession,
  validateAuthConfiguration,
  type AuthContext,
} from './src/server/auth.ts';
import { calculateFinancialModel, calculateServicePrice, haversineKm, runSmartDispatch } from './src/server/engines.ts';
import {
  awaitPendingPushNotifications,
  createAndSendNotification,
  enqueueSystemPushNotification,
  getFcmStatus,
  probeFcmAuth,
  registerDeviceToken,
  registerGuestDeviceToken,
  resolveChannelId,
  setNotificationCreatedListener,
  unregisterDeviceToken,
  verifyGoogleOrFirebaseToken,
  type PushUserRole,
} from './src/server/pushService.ts';
import { normalizeEmail } from './src/shared/email.ts';
import type { FinancialModelInput } from './src/shared/types.ts';

validateAuthConfiguration();
initDatabase();
ensureBootstrapSuperAdmin();
if (!isCloudSqlConfigured()) {
  try {
    const recon = reconcileAllExistingProductsToMasterCatalog();
    if (recon.reconciled > 0 || recon.new_masters > 0) {
      console.log(
        `[MasterCatalog] Startup reconciliation complete: total=${recon.total}, reconciled=${recon.reconciled}, new_masters=${recon.new_masters}, linked_existing=${recon.linked_existing}`
      );
    }
  } catch (err) {
    console.error('[MasterCatalog] Startup reconciliation error:', err);
  }
}

const app = express();
app.set('trust proxy', 1);

let sqlitePersistRef: SqlitePersistController | null = null;
let postHydrationReconciled = false;

const READ_ONLY_POST_PATHS = new Set([
  '/storefront/assistant',
  '/merchant/master-catalog/match',
  '/merchant/master-catalog/excel-preview',
  '/pricing/simulate',
]);

app.use('/api', async (req, res, next) => {
  const isMutating =
    (req.method === 'POST' && !READ_ONLY_POST_PATHS.has(req.path)) ||
    req.method === 'PUT' ||
    req.method === 'PATCH' ||
    req.method === 'DELETE';

  // 1. Cloud SQL hydration & cross-instance freshness gate (fail-safe 503 if unreachable)
  if (req.path !== '/health' && isCloudSqlConfigured()) {
    try {
      await ensureFreshFromCloudSql(db, rebuildProductsFtsIndex, { forceCheck: isMutating });
      if (!postHydrationReconciled) {
        postHydrationReconciled = true;
        try {
          const bootRes = ensureBootstrapSuperAdmin();
          const recon = reconcileAllExistingProductsToMasterCatalog();
          if (bootRes.created || recon.reconciled > 0 || recon.new_masters > 0) {
            await syncChangesToCloudSql(db, 'startup:post_hydration_init', rebuildProductsFtsIndex);
          }
        } catch (reconErr) {
          console.error('[MasterCatalog] Post-hydration reconciliation error:', reconErr);
        }
      }
    } catch (err) {
      const msg =
        err instanceof CloudSqlUnavailableError
          ? err.message
          : 'الخدمة في وضع الصيانة المؤقتة لحماية البيانات، يرجى المحاولة بعد لحظات.';
      return res.status(503).json({ error: msg });
    }
  }

  let cloudSqlFlushStarted = false;

  res.on('finish', () => {
    if (isMutating && res.statusCode < 400 && !isCloudSqlConfigured()) {
      sqlitePersistRef?.scheduleFlush(`api:${req.method}`, 1200);
    }
    // Zero-cost safety net: catches any SQLite write that happened outside res.json/res.send (e.g. GET links or 204)
    if (isCloudSqlConfigured() && !cloudSqlFlushStarted) {
      void syncIfSqliteMutated(db, `finish:${req.method}:${req.path}`, rebuildProductsFtsIndex);
    }
  });

  // 2. Awaited Cloud SQL write-through + optional async Gzip compression for /api JSON payloads >= 1 KB
  const acceptEnc = String(req.headers['accept-encoding'] || '').toLowerCase();
  const wantsGzip = acceptEnc.includes('gzip');
  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  const sendJsonPayload = (body: unknown) => {
    if (res.headersSent) return;
    if (!wantsGzip) {
      origJson(body);
      return;
    }
    let rawStr: string;
    try {
      rawStr = JSON.stringify(body);
    } catch {
      origJson(body);
      return;
    }
    if (!rawStr || rawStr.length < 1024) {
      origJson(body);
      return;
    }
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    zlib.gzip(Buffer.from(rawStr, 'utf8'), { level: 6 }, (err, compressed) => {
      if (res.headersSent) return;
      if (err) {
        origSend(rawStr);
        return;
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(compressed.length));
      res.end(compressed);
    });
  };

  res.json = ((body: unknown) => {
    if (res.headersSent) return res;
    if (isMutating && res.statusCode < 400 && !cloudSqlFlushStarted) {
      cloudSqlFlushStarted = true;
      const persistTask = isCloudSqlConfigured()
        ? syncChangesToCloudSql(db, `api:${req.method}:${req.path}`, rebuildProductsFtsIndex)
        : Promise.resolve();
      persistTask
        .then(() => awaitPendingPushNotifications(3500).catch(() => {}))
        .then(() => {
          sendJsonPayload(body);
        })
        .catch((err) => {
          if (res.headersSent) return;
          const msg =
            err instanceof CloudSqlUnavailableError
              ? err.message
              : 'تعذر حفظ التغييرات في قاعدة البيانات الرئيسية مؤقتًا، يرجى المحاولة مرة أخرى.';
          res.status(503);
          origJson({ error: msg });
        });
      return res;
    }
    sendJsonPayload(body);
    return res;
  }) as typeof res.json;

  if (isMutating) {
    res.send = ((body?: unknown) => {
      if (res.headersSent || cloudSqlFlushStarted || res.statusCode >= 400) {
        return origSend(body);
      }
      cloudSqlFlushStarted = true;
      const persistTask = isCloudSqlConfigured()
        ? syncChangesToCloudSql(db, `api:${req.method}:${req.path}`, rebuildProductsFtsIndex)
        : Promise.resolve();
      persistTask
        .then(() => awaitPendingPushNotifications(3500).catch(() => {}))
        .then(() => {
          if (!res.headersSent) origSend(body);
        })
        .catch((err) => {
          if (res.headersSent) return;
          const msg =
            err instanceof CloudSqlUnavailableError
              ? err.message
              : 'تعذر حفظ التغييرات في قاعدة البيانات الرئيسية مؤقتًا، يرجى المحاولة مرة أخرى.';
          res.status(503);
          origJson({ error: msg });
        });
      return res;
    }) as typeof res.send;
  }

  next();
});

const SENSITIVE_FILE_EXT_RE = /\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3|sql|bak|pem|key|log)$/i;
const SENSITIVE_ROOT_FILES = new Set([
  'otlobha.db',
  'otlobha.db-wal',
  'otlobha.db-shm',
  'otlobha.db-journal',
  'server.ts',
  'server.js',
  'server.mjs',
  'server.cjs',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  'metadata.json',
  'dockerfile',
  'docker-compose.yml',
]);
const SENSITIVE_DIR_PREFIXES = ['/.backups', '/.git', '/.aistudio', '/.vscode', '/src/server', '/scripts', '/tests', '/deploy', '/mobile'];

function decodeUrlPathSafely(rawPath: string): { ok: true; decoded: string } | { ok: false } {
  let current = rawPath;
  for (let i = 0; i < 4; i++) {
    if (current.includes('\0')) return { ok: false };
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      return { ok: false };
    }
  }
  if (current.includes('\0')) return { ok: false };
  return { ok: true, decoded: current };
}

function isSensitiveProjectPath(rawUrl: string): boolean {
  const rawPathname = String(rawUrl || '/').split('?')[0].split('#')[0];
  const decodedRes = decodeUrlPathSafely(rawPathname);
  if (!decodedRes.ok) return true;

  const rawUnified = rawPathname.replace(/\\/g, '/');
  const decodedUnified = decodedRes.decoded.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (/(^|\/)\.\.(\/|$)/.test(rawUnified) || /(^|\/)\.\.(\/|$)/.test(decodedUnified)) {
    return true;
  }

  let normalized = path.posix.normalize(decodedUnified.startsWith('/') ? decodedUnified : `/${decodedUnified}`).toLowerCase();
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');

  // API endpoints are handled by Express router (traversal already blocked above)
  if (normalized === '/api' || normalized.startsWith('/api/')) {
    return false;
  }

  // Handle Vite /@fs/<absPath> bypass attempts
  let inspectPath = normalized;
  if (inspectPath.startsWith('/@fs/')) {
    const fsRest = inspectPath.slice('/@fs'.length);
    const cwdNorm = path.posix.normalize(process.cwd().replace(/\\/g, '/')).toLowerCase().replace(/\/+$/, '');
    if (cwdNorm && fsRest.startsWith(cwdNorm)) {
      inspectPath = fsRest.slice(cwdNorm.length) || '/';
    } else if (!fsRest.includes('/node_modules/')) {
      return true;
    }
  }

  const segments = inspectPath.split('/').filter(Boolean);
  for (const seg of segments) {
    const cleanSeg = seg.replace(/[\s.]+$/g, '');
    if (!cleanSeg) continue;
    if (
      cleanSeg.startsWith('.env') ||
      cleanSeg.startsWith('.backups') ||
      cleanSeg === '.git' ||
      cleanSeg === '.aistudio' ||
      cleanSeg === 'otlobha.db' ||
      cleanSeg.startsWith('otlobha.db-') ||
      SENSITIVE_FILE_EXT_RE.test(cleanSeg) ||
      SENSITIVE_ROOT_FILES.has(cleanSeg)
    ) {
      return true;
    }
  }

  for (const prefix of SENSITIVE_DIR_PREFIXES) {
    if (inspectPath === prefix || inspectPath.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
}

app.use((req, res, next) => {
  if (isSensitiveProjectPath(req.originalUrl || req.url)) {
    return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذا المسار' });
  }
  next();
});

const otpRateLimitBuckets = new Map<string, number[]>();

function checkRateLimit(bucketKey: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = (otpRateLimitBuckets.get(bucketKey) || []).filter((ts) => ts > cutoff);
  if (existing.length >= maxRequests) {
    otpRateLimitBuckets.set(bucketKey, existing);
    const oldest = existing[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  existing.push(now);
  otpRateLimitBuckets.set(bucketKey, existing);
  if (otpRateLimitBuckets.size > 5000) {
    for (const [k, list] of otpRateLimitBuckets.entries()) {
      const valid = list.filter((ts) => ts > cutoff);
      if (valid.length === 0) otpRateLimitBuckets.delete(k);
      else otpRateLimitBuckets.set(k, valid);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

function getClientIp(req: express.Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

app.use(express.json({ limit: '25mb' }));
app.use((req, _res, next) => {
  if (req.body === undefined || req.body === null) {
    req.body = {};
  }
  next();
});
registerCloudSyncRoutes(app);
registerMasterCatalogRoutes(app);

function parseLocalizedNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const extArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  let out = '';
  for (const ch of String(val ?? '')) {
    const idxAr = arabicIndic.indexOf(ch);
    if (idxAr !== -1) {
      out += String(idxAr);
      continue;
    }
    const idxFa = extArabicIndic.indexOf(ch);
    if (idxFa !== -1) {
      out += String(idxFa);
      continue;
    }
    if (ch === '٫' || ch === '،' || ch === ',') {
      out += '.';
      continue;
    }
    out += ch;
  }
  const cleaned = out.trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

// Real-time Chat & GPS Tracking WebSocket room registry
const chatRooms = new Map<string, Set<WebSocket>>();

function broadcastToRooms(roomKeys: string[], payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload);
  const sent = new Set<WebSocket>();
  for (const roomKey of roomKeys) {
    const clients = chatRooms.get(roomKey);
    if (!clients) continue;
    for (const client of clients) {
      if (!sent.has(client) && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
        sent.add(client);
      }
    }
  }
}

setNotificationCreatedListener((ev) => {
  const wsPayload: Record<string, unknown> = {
    type: 'notification:new',
    notification: {
      id: ev.id,
      target_app: ev.targetApp,
      target_zone: ev.targetZone,
      recipient_id: ev.recipientId,
      category: ev.category,
      title_ar: ev.titleAr,
      body_ar: ev.bodyAr,
      deep_link: ev.deepLink,
      channel_id: ev.channelId,
      order_id: ev.orderId || '',
      trip_id: ev.tripId || '',
      parcel_id: ev.parcelId || '',
      status: ev.status || '',
      email: ev.extraData?.email || '',
      is_read: false,
      created_at: ev.createdAt,
    },
  };

  if (ev.targetApp === 'customer' || ev.targetApp === 'all') {
    if (ev.recipientId) {
      broadcastToRooms([`customer:${ev.recipientId}`], wsPayload);
    } else {
      const targetRooms: string[] = [];
      const isVerifyEmailBroadcast = ev.deepLink.toLowerCase() === 'verify_email';
      for (const roomKey of chatRooms.keys()) {
        if (!roomKey.startsWith('customer:')) continue;
        if (isVerifyEmailBroadcast) {
          const cid = roomKey.slice('customer:'.length);
          const row = db.prepare('SELECT is_email_verified FROM customers WHERE id = ?').get(cid) as
            | { is_email_verified?: number }
            | undefined;
          if (row && Boolean(row.is_email_verified)) continue;
        }
        targetRooms.push(roomKey);
      }
      if (targetRooms.length > 0) {
        broadcastToRooms(targetRooms, wsPayload);
      }
    }
  }

  if (ev.targetApp === 'captain' || ev.targetApp === 'all') {
    if (ev.recipientId) {
      broadcastToRooms([`captain:${ev.recipientId}`], wsPayload);
    } else {
      const capRooms = Array.from(chatRooms.keys()).filter((k) => k.startsWith('captain:'));
      if (capRooms.length > 0) broadcastToRooms(capRooms, wsPayload);
    }
  }

  if (ev.targetApp === 'merchant' || ev.targetApp === 'all') {
    if (ev.recipientId) {
      broadcastToRooms([`merchant:${ev.recipientId}`], wsPayload);
    } else {
      const merchantRooms = Array.from(chatRooms.keys()).filter((k) => k.startsWith('merchant:'));
      if (merchantRooms.length > 0) broadcastToRooms(merchantRooms, wsPayload);
    }
  }
});

function broadcastOrderChat(orderId: string, payload: Record<string, unknown>) {
  const row = db
    .prepare('SELECT customer_id, merchant_id, captain_id FROM orders WHERE id = ?')
    .get(orderId) as { customer_id?: string | null; merchant_id?: string | null; captain_id?: string | null } | undefined;
  const rooms = [orderId, 'admin:all', 'rides:all'];
  if (row?.customer_id) rooms.push(`customer:${row.customer_id}`);
  if (row?.merchant_id) rooms.push(`merchant:${row.merchant_id}`);
  if (row?.captain_id) rooms.push(`captain:${row.captain_id}`);
  const storeRows = db
    .prepare('SELECT DISTINCT merchant_id FROM order_stores WHERE order_id = ?')
    .all(orderId) as Array<{ merchant_id?: string | null }>;
  for (const sr of storeRows) {
    if (sr.merchant_id) rooms.push(`merchant:${sr.merchant_id}`);
  }
  broadcastToRooms(rooms, payload);
}

function broadcastTripChat(tripId: string, payload: Record<string, unknown>) {
  const row = db
    .prepare('SELECT customer_id, captain_id FROM trips WHERE id = ?')
    .get(tripId) as { customer_id?: string | null; captain_id?: string | null } | undefined;
  const rooms = [`trip:${tripId}`, 'rides:all', 'admin:all'];
  if (row?.customer_id) rooms.push(`customer:${row.customer_id}`);
  if (row?.captain_id) rooms.push(`captain:${row.captain_id}`);
  broadcastToRooms(rooms, payload);
}

function ensureOrderChatStarter(orderId: string, captainName: string) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM order_chat_messages WHERE order_id = ?').get(orderId) as { c: number };
  if (existing.c > 0) return;
  const msgId = uid('msg');
  const text = `تم استلام الطلب بواسطة الكابتن ${captainName}. يمكنك التحدث مع الكابتن هنا، وسيقوم الكابتن بتصوير الأوردر عند منزلك وإرسال الصورة في هذا الشات عند الوصول.`;
  db.prepare(`
    INSERT INTO order_chat_messages (id, order_id, sender_role, sender_name, message_text, image_url, is_delivery_proof)
    VALUES (?, ?, 'system', 'النظام', ?, NULL, 0)
  `).run(msgId, orderId, text);
  const created = db.prepare('SELECT * FROM order_chat_messages WHERE id = ?').get(msgId) as Record<string, unknown>;
  broadcastOrderChat(orderId, {
    type: 'chat:message',
    order_id: orderId,
    message: { ...created, is_delivery_proof: Boolean(created.is_delivery_proof) },
  });
}

interface ServerOrderStoreSection {
  id: string;
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_type: string;
  merchant_lat?: number | null;
  merchant_lng?: number | null;
  order_channel: string;
  items: Array<Record<string, unknown>>;
  free_order_text: string | null;
  prescription_image_url: string | null;
  subtotal: number;
  commission_rate: number;
  prep_status: string;
  pharmacist_notes: string | null;
  substitution_note: string | null;
  rejection_reason: string | null;
  ready_at: string | null;
  captain_picked_up_at: string | null;
  sort_index: number;
}

function mapStoreSectionRow(r: Record<string, unknown>): ServerOrderStoreSection {
  return {
    id: String(r.id),
    order_id: String(r.order_id),
    merchant_id: String(r.merchant_id),
    merchant_name: String(r.merchant_name || ''),
    merchant_type: String(r.merchant_type || 'stores'),
    merchant_lat: r.merchant_lat !== undefined && r.merchant_lat !== null ? Number(r.merchant_lat) : null,
    merchant_lng: r.merchant_lng !== undefined && r.merchant_lng !== null ? Number(r.merchant_lng) : null,
    order_channel: String(r.order_channel || 'catalog'),
    items: parseOrderItems(r.items_json),
    free_order_text: r.free_order_text ? String(r.free_order_text) : null,
    prescription_image_url: r.prescription_image_url ? String(r.prescription_image_url) : null,
    subtotal: Number(r.subtotal || 0),
    commission_rate: Number(r.commission_rate ?? 10),
    prep_status: String(r.prep_status || 'pending_merchant'),
    pharmacist_notes: r.pharmacist_notes ? String(r.pharmacist_notes) : null,
    substitution_note: r.substitution_note ? String(r.substitution_note) : null,
    rejection_reason: r.rejection_reason ? String(r.rejection_reason) : null,
    ready_at: r.ready_at ? String(r.ready_at) : null,
    captain_picked_up_at: r.captain_picked_up_at ? String(r.captain_picked_up_at) : null,
    sort_index: Number(r.sort_index || 0),
  };
}

function getOrderStoreSections(orderId: string): ServerOrderStoreSection[] {
  const rows = db
    .prepare(
      `SELECT os.*, m.lat as merchant_lat, m.lng as merchant_lng
       FROM order_stores os
       LEFT JOIN merchants m ON m.id = os.merchant_id
       WHERE os.order_id = ?
       ORDER BY os.sort_index ASC, os.rowid ASC`
    )
    .all(orderId) as Array<Record<string, unknown>>;
  return rows.map(mapStoreSectionRow);
}

function getOrderStoreSectionsMap(orderIds: string[]): Map<string, ServerOrderStoreSection[]> {
  const result = new Map<string, ServerOrderStoreSection[]>();
  const cleanIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (cleanIds.length === 0) return result;
  const placeholders = cleanIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT os.*, m.lat as merchant_lat, m.lng as merchant_lng
       FROM order_stores os
       LEFT JOIN merchants m ON m.id = os.merchant_id
       WHERE os.order_id IN (${placeholders})
       ORDER BY os.sort_index ASC, os.rowid ASC`
    )
    .all(...cleanIds) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const sec = mapStoreSectionRow(r);
    const list = result.get(sec.order_id);
    if (list) list.push(sec);
    else result.set(sec.order_id, [sec]);
  }
  return result;
}

function getAnchorStoreSection(sections: ServerOrderStoreSection[]): ServerOrderStoreSection | null {
  const active = sections.filter((s) => s.prep_status !== 'cancelled');
  if (active.length === 0) return null;
  let best = active[0];
  let bestQty = -1;
  let bestSub = -1;
  for (const sec of active) {
    const accepted = sec.items.filter((it) => it.status !== 'rejected');
    const qty =
      accepted.length > 0
        ? accepted.reduce((sum, it) => sum + Math.max(1, Number(it.quantity || 1)), 0)
        : 1;
    const sub = Number(sec.subtotal || 0);
    if (qty > bestQty || (qty === bestQty && sub > bestSub)) {
      best = sec;
      bestQty = qty;
      bestSub = sub;
    }
  }
  return best;
}

function mapOrderRowWithSections(
  o: Record<string, unknown>,
  sections: ServerOrderStoreSection[],
  auth?: AuthContext | null
): Record<string, unknown> {
  const base = mapOrderRow(o) as Record<string, unknown>;
  if (auth?.role === 'merchant') {
    if (sections.length > 0) {
      const mySections = sections.filter((s) => s.merchant_id === auth.id);
      if (mySections.length > 0) {
        const my = mySections[0];
        const orderClosed = o.status === 'delivered' || o.status === 'cancelled';
        const effectiveStatus = orderClosed ? String(o.status) : my.prep_status;
        return {
          ...base,
          merchant_id: my.merchant_id,
          merchant_name: my.merchant_name,
          merchant_type: my.merchant_type,
          order_channel: my.order_channel,
          items: my.items,
          subtotal: Number(my.subtotal || 0),
          delivery_fee: 0,
          discount_amount: 0,
          total_amount: Number(my.subtotal || 0),
          free_order_text: my.free_order_text,
          prescription_image_url: my.prescription_image_url,
          pharmacist_notes: my.pharmacist_notes ?? base.pharmacist_notes,
          substitution_note: my.substitution_note ?? base.substitution_note,
          rejection_reason: my.rejection_reason ?? base.rejection_reason,
          ready_at: my.ready_at ?? base.ready_at,
          status: effectiveStatus,
          my_section_status: my.prep_status,
          is_multi_store: sections.length > 1,
          store_sections: mySections,
        };
      }
    }
    const rawItems = Array.isArray(base.items) ? (base.items as Array<Record<string, unknown>>) : [];
    const ownItems = rawItems.filter((it) => !it.merchant_id || String(it.merchant_id) === auth.id);
    const ownSubtotal =
      ownItems.length > 0
        ? Number(
            ownItems
              .filter((it) => it.status !== 'rejected')
              .reduce((sum, it) => sum + Number(it.total_price || 0), 0)
              .toFixed(2)
          )
        : Number(base.subtotal || 0);
    return {
      ...base,
      items: ownItems,
      subtotal: ownSubtotal,
      total_amount: ownSubtotal,
      delivery_fee: 0,
      discount_amount: 0,
      store_sections: [],
    };
  }
  const isUnassignedCaptain = auth?.role === 'captain' && String(o.captain_id || '') !== auth.id;
  if (isUnassignedCaptain) {
    base.prescription_image_url = null;
  }
  const safeSections = isUnassignedCaptain
    ? sections.map((s) => ({ ...s, prescription_image_url: null }))
    : sections;
  return {
    ...base,
    store_sections: safeSections,
  };
}

function reconcileAndDispatchSingleOrder(orderId: string): {
  dispatched: boolean;
  waitingForStores?: boolean;
  noCaptain?: boolean;
  cancelled?: boolean;
  captain_id?: string | null;
  captain_name?: string | null;
  anchor_merchant_name?: string | null;
} {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
  if (!order) return { dispatched: false };

  const sections = getOrderStoreSections(orderId);
  const activeSections = sections.filter((s) => s.prep_status !== 'cancelled');

  if (sections.length > 0 && activeSections.length === 0) {
    db.prepare("UPDATE orders SET status = 'cancelled', subtotal = 0, total_amount = 0 WHERE id = ?").run(orderId);
    broadcastOrderChat(orderId, { type: 'order:status', order_id: orderId, status: 'cancelled' });
    return { dispatched: false, cancelled: true };
  }

  if (sections.length === 0) {
    return {
      dispatched: Boolean(order.captain_id),
      captain_id: order.captain_id ? String(order.captain_id) : null,
      captain_name: order.captain_name ? String(order.captain_name) : null,
    };
  }

  const allReady = activeSections.every((s) =>
    ['ready_for_pickup', 'on_the_way', 'delivered'].includes(s.prep_status)
  );

  if (!allReady) {
    if (!['delivered', 'cancelled'].includes(String(order.status))) {
      db.prepare("UPDATE orders SET status = 'preparing' WHERE id = ? AND status NOT IN ('delivered', 'cancelled')").run(
        orderId
      );
    }
    broadcastOrderChat(orderId, { type: 'order:status', order_id: orderId, status: 'preparing' });
    return { dispatched: false, waitingForStores: true };
  }

  const nowIso = new Date().toISOString();
  if (['pending_merchant', 'awaiting_quote', 'preparing'].includes(String(order.status))) {
    db.prepare("UPDATE orders SET status = 'ready_for_pickup', ready_at = COALESCE(ready_at, ?) WHERE id = ?").run(
      nowIso,
      orderId
    );
  }

  if (order.captain_id) {
    const capId = String(order.captain_id);
    const capName = String(order.captain_name || '');
    if (capName) ensureOrderChatStarter(orderId, capName);
    broadcastOrderChat(orderId, {
      type: 'order:status',
      order_id: orderId,
      status: String(
        ['pending_merchant', 'awaiting_quote', 'preparing'].includes(String(order.status))
          ? 'ready_for_pickup'
          : order.status
      ),
    });
    return { dispatched: true, captain_id: capId, captain_name: capName };
  }

  const anchor = getAnchorStoreSection(activeSections);
  const anchorLat = Number(anchor?.merchant_lat || 31.1583);
  const anchorLng = Number(anchor?.merchant_lng || 31.9369);
  const dispatch = runSmartDispatch({
    service_type: anchor?.merchant_type === 'pharmacy' ? 'pharmacy' : 'stores',
    pickup_lat: anchorLat,
    pickup_lng: anchorLng,
  });

  if (!dispatch.winner) {
    broadcastOrderChat(orderId, { type: 'order:status', order_id: orderId, status: 'ready_for_pickup' });
    return {
      dispatched: false,
      noCaptain: true,
      anchor_merchant_name: anchor?.merchant_name || String(order.merchant_name || ''),
    };
  }

  const winnerId = dispatch.winner.captain_id;
  const winnerName = dispatch.winner.full_name;
  db.prepare('UPDATE orders SET captain_id = ?, captain_name = ? WHERE id = ? AND captain_id IS NULL').run(
    winnerId,
    winnerName,
    orderId
  );

  ensureOrderChatStarter(orderId, winnerName);
  broadcastOrderChat(orderId, { type: 'order:status', order_id: orderId, status: 'ready_for_pickup' });

  const ordNum = String(order.order_number);
  enqueueSystemPushNotification({
    targetApp: 'captain',
    targetZone: String(order.zone_name || 'all'),
    recipientId: winnerId,
    category: 'operational',
    titleAr: `طلب جاهز للاستلام #${ordNum}`,
    bodyAr:
      activeSections.length > 1
        ? `تم إسناد طلب مقسم (${activeSections.length} متاجر) إليك — المتجر الأكثر طلبًا: ${anchor?.merchant_name || ''}`
        : `تم إسناد الطلب #${ordNum} إليك من ${anchor?.merchant_name || String(order.merchant_name)}`,
    deepLink: 'order',
    orderId,
    status: 'ready_for_pickup',
    channelId: 'otlobha_dispatch_channel',
    sentBy: 'النظام',
  });

  if (order.customer_id) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(order.customer_id),
      category: 'operational',
      titleAr: `تم تجهيز طلبك #${ordNum}`,
      bodyAr:
        activeSections.length > 1
          ? `كل المتاجر (${activeSections.length}) جهّزت طلبك وتم تسليم الطلب للطيار ${winnerName} للاستلام.`
          : `تم تجهيز طلبك وإسناده للطيار ${winnerName}.`,
      deepLink: 'order',
      orderId,
      status: 'ready_for_pickup',
      channelId: 'otlobha_orders_channel',
      sentBy: 'النظام',
    });
  }

  recordAuditLog({
    actor_name: 'النظام (Smart Dispatch)',
    actor_role: 'system',
    action: 'ORDER_AUTO_DISPATCHED',
    entity_type: 'orders',
    entity_id: orderId,
    details: `إسناد تلقائي للطلب #${ordNum} (${activeSections.length} متاجر) لأقرب طيار (${winnerName}) من ${anchor?.merchant_name || String(order.merchant_name)}`,
  });

  return {
    dispatched: true,
    captain_id: winnerId,
    captain_name: winnerName,
    anchor_merchant_name: anchor?.merchant_name || String(order.merchant_name || ''),
  };
}

function ensureTripChatStarter(tripId: string, captainName: string) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM trip_chat_messages WHERE trip_id = ?').get(tripId) as { c: number };
  if (existing.c > 0) return;
  const msgId = uid('tmsg');
  const text = `وافق الكابتن ${captainName} على المشوار وهو متجه إليك الآن. يمكنك التواصل هنا ومتابعة موقع الطيار لحظيًا عبر الـ GPS.`;
  db.prepare(`
    INSERT INTO trip_chat_messages (id, trip_id, sender_role, sender_name, message_text, image_url)
    VALUES (?, ?, 'system', 'النظام', ?, NULL)
  `).run(msgId, tripId, text);
  const created = db.prepare('SELECT * FROM trip_chat_messages WHERE id = ?').get(msgId) as Record<string, unknown>;
  broadcastTripChat(tripId, {
    type: 'trip_chat:message',
    trip_id: tripId,
    message: created,
  });
}

// 1. Health, Auth Foundation & Overview KPIs
app.get('/api/health', (_req, res) => {
  const smtpCfg = resolveSmtpConfig();
  res.json({
    ok: true,
    service: 'Otlobha Unified Backend',
    email_otp_mode: smtpCfg ? 'smtp' : 'sandbox',
    smtp_host: smtpCfg ? smtpCfg.host : null,
    smtp_port: smtpCfg ? smtpCfg.port : null,
    persistence: getCloudSqlPersistenceStatus(),
    capabilities: {
      guest_bootstrap: true,
      customer_register_otp: true,
      customer_verification_link: true,
      customer_password_reset: true,
      customer_password_reset_link: true,
      customer_google_auth: true,
      fcm_push: true,
    },
  });
});

app.get('/api/auth/public-config', (_req, res) => {
  res.json({
    ok: true,
    google_web_client_id: String(process.env.GOOGLE_WEB_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
  });
});

app.get('/api/auth/bootstrap-status', (_req, res) => {
  const row = db
    .prepare("SELECT COUNT(*) as c FROM admin_users WHERE role_code = 'super_admin' AND is_active = 1")
    .get() as { c: number };
  res.json({
    ok: true,
    super_admin_configured: row.c > 0,
  });
});

function findMatchingSuperAdmin(rawIdentifier: string, password: string): Record<string, unknown> | null {
  const ident = String(rawIdentifier || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!ident || !pw) return null;

  const configuredAlias = String(process.env.SUPER_ADMIN_USERNAME || '').trim().toLowerCase();
  const superAdmins = db
    .prepare(
      `SELECT a.id, a.email, a.password_hash, a.full_name, a.role_code, a.custom_permissions_json, a.is_active, a.token_version, a.last_login_at, a.created_at,
              r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
       FROM admin_users a
       JOIN roles r ON r.code = a.role_code
       WHERE a.is_active = 1 AND a.role_code = 'super_admin'`
    )
    .all() as Array<Record<string, unknown>>;

  for (const admin of superAdmins) {
    const adminEmail = String(admin.email || '').trim().toLowerCase();
    const emailLocal = adminEmail.includes('@') ? adminEmail.split('@')[0] : adminEmail;
    const isMatch =
      ident === adminEmail ||
      ident === emailLocal ||
      ident === 'admin' ||
      ident === 'superadmin' ||
      (configuredAlias.length > 0 && ident === configuredAlias);
    if (isMatch && verifyPassword(pw, String(admin.password_hash || ''))) {
      return admin;
    }
  }
  return null;
}

function ensureSuperAdminCustomerAccount(admin: Record<string, unknown>): Record<string, unknown> {
  const adminId = String(admin.id);
  const adminEmail = String(admin.email || '').trim().toLowerCase();
  const adminName = String(admin.full_name || 'إدارة اطلبها').trim() || 'إدارة اطلبها';
  const adminHash = String(admin.password_hash || '');
  const fallbackId = `cust_admin_${adminId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12)}`;

  let existing = db
    .prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?) OR id = ? LIMIT 1')
    .get(adminEmail, fallbackId) as Record<string, unknown> | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO customers (id, email, phone, password_hash, full_name, status, default_zone_id, address_landmark, is_email_verified, auth_provider, profile_completed)
       VALUES (?, ?, NULL, ?, ?, 'active', 'zn_city_center', 'إدارة منصة اطلبها - المنزلة', 1, 'email', 1)`
    ).run(fallbackId, adminEmail, adminHash, adminName);
    existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(fallbackId) as Record<string, unknown>;
  } else {
    db.prepare(
      `UPDATE customers
       SET status = 'active', is_email_verified = 1, profile_completed = 1, last_login_at = datetime('now')
       WHERE id = ?`
    ).run(String(existing.id));
    existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(existing.id)) as Record<string, unknown>;
  }
  return existing;
}

function ensureSuperAdminCaptainAccount(admin: Record<string, unknown>): Record<string, unknown> {
  const adminId = String(admin.id);
  const adminName = String(admin.full_name || 'إدارة اطلبها').trim() || 'إدارة اطلبها';
  const adminHash = String(admin.password_hash || '');
  const capId = `cap_admin_${adminId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12)}`;

  let existing = db
    .prepare('SELECT * FROM captains WHERE id = ? OR user_id = ? LIMIT 1')
    .get(capId, adminId) as Record<string, unknown> | undefined;

  if (!existing) {
    const usernameTaken = db.prepare("SELECT id FROM captains WHERE LOWER(username) = 'admin'").get();
    const capUsername = usernameTaken ? `admin_${adminId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}` : 'admin';
    const phoneTaken = db.prepare("SELECT id FROM captains WHERE phone = '01099990000'").get();
    const capPhone = phoneTaken ? `0109${Date.now().toString().slice(-7)}` : '01099990000';
    const nidTaken = db.prepare("SELECT id FROM captains WHERE national_id = '29901010000001'").get();
    const capNid = nidTaken ? `299${Date.now().toString().slice(-11)}` : '29901010000001';

    db.prepare(
      `INSERT INTO captains (
         id, user_id, username, password_hash, full_name, phone, national_id, city, zone_name,
         vehicle_type, vehicle_model, plate_number, is_eligible_for_rides, allowed_services_json,
         verification_status, availability_status, lat, lng, cash_on_hand, cash_limit
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'المنزلة', 'وسط مدينة المنزلة (شارع حسن طوبار وبورسعيد)', 'moto', 'حساب إدارة اطلبها', 'ADMIN-01', 1, '["stores","pharmacy","parcels","rides"]', 'approved', 'offline', 31.1583, 31.9369, 0, 5000)`
    ).run(capId, adminId, capUsername, adminHash, `${adminName} (إدارة)`, capPhone, capNid);
    existing = db.prepare('SELECT * FROM captains WHERE id = ?').get(capId) as Record<string, unknown>;
  } else {
    db.prepare(
      "UPDATE captains SET verification_status = 'approved', is_eligible_for_rides = 1 WHERE id = ?"
    ).run(String(existing.id));
    existing = db.prepare('SELECT * FROM captains WHERE id = ?').get(String(existing.id)) as Record<string, unknown>;
  }
  return existing;
}

function ensureSuperAdminMerchantAccount(admin: Record<string, unknown>): Record<string, unknown> {
  const adminId = String(admin.id);
  const adminEmail = String(admin.email || '').trim().toLowerCase();
  const adminName = String(admin.full_name || 'إدارة اطلبها').trim() || 'إدارة اطلبها';
  const adminHash = String(admin.password_hash || '');
  const merId = `mer_admin_${adminId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12)}`;

  let existing = db
    .prepare('SELECT * FROM merchants WHERE LOWER(email) = LOWER(?) OR id = ? LIMIT 1')
    .get(adminEmail, merId) as Record<string, unknown> | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO merchants (
         id, email, password_hash, business_name_ar, business_name_en, merchant_type, branch_name,
         zone_name, phone, owner_name, address_detail, terms_accepted, terms_accepted_at,
         is_email_verified, verification_status, supports_free_order, is_open_now, lat, lng
       ) VALUES (?, ?, ?, 'متجر إدارة اطلبها', 'Otlobha Admin Store', 'supermarket', 'الفرع الرئيسي - المنزلة', 'وسط مدينة المنزلة (شارع حسن طوبار وبورسعيد)', '01000000000', ?, 'إدارة منصة اطلبها - المنزلة', 1, datetime('now'), 1, 'approved', 1, 1, 31.1583, 31.9369)`
    ).run(merId, adminEmail, adminHash, adminName);

    db.prepare(
      "INSERT OR IGNORE INTO categories (id, scope, merchant_id, name_ar, name_en, image_url, sort_order, is_offers_section, is_active) VALUES (?, 'merchant', ?, 'العروض', 'Offers', '', 0, 1, 1)"
    ).run(`cat_offers_${merId}`, merId);

    existing = db.prepare('SELECT * FROM merchants WHERE id = ?').get(merId) as Record<string, unknown>;
  } else {
    db.prepare(
      "UPDATE merchants SET verification_status = 'approved', is_email_verified = 1, terms_accepted = 1 WHERE id = ?"
    ).run(String(existing.id));
    existing = db.prepare('SELECT * FROM merchants WHERE id = ?').get(String(existing.id)) as Record<string, unknown>;
  }
  return existing;
}

app.post('/api/auth/admin/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const { email: rawEmail, username: rawUsername, password } = (req.body || {}) as {
    email?: string;
    username?: string;
    password?: string;
  };
  const ident = String(rawEmail || rawUsername || '').trim().toLowerCase();
  const pw = String(password || '');

  if (!ident || !pw) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني أو اسم المستخدم وكلمة المرور' });
  }

  let admin = db
    .prepare(
      `SELECT a.id, a.email, a.password_hash, a.full_name, a.role_code, a.custom_permissions_json, a.is_active, a.token_version, a.last_login_at, a.created_at,
              r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
       FROM admin_users a
       JOIN roles r ON r.code = a.role_code
       WHERE LOWER(a.email) = LOWER(?)`
    )
    .get(ident) as Record<string, unknown> | undefined;

  if (!admin) {
    admin = findMatchingSuperAdmin(ident, pw) || undefined;
  }

  if (!admin || !verifyPassword(pw, String(admin.password_hash || ''))) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  if (Number(admin.is_active) !== 1) {
    return res.status(403).json({ error: 'هذا الحساب الإداري موقوف حاليًا' });
  }

  db.prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?").run(String(admin.id));

  let permissions: string[] = [];
  if (admin.custom_permissions_json && String(admin.custom_permissions_json).trim().length > 0) {
    try {
      const parsed = JSON.parse(String(admin.custom_permissions_json));
      if (Array.isArray(parsed)) permissions = parsed.map(String);
    } catch {
      permissions = [];
    }
  } else {
    try {
      const parsed = JSON.parse(String(admin.permissions_json || '[]'));
      if (Array.isArray(parsed)) permissions = parsed.map(String);
    } catch {
      permissions = [];
    }
  }

  const tokens = issueSessionForUser(req, res, {
    userId: String(admin.id),
    role: String(admin.role_code),
    actorType: 'admin',
    tokenVersion: Number(admin.token_version || 0),
  });

  recordAuditLog({
    actor_name: String(admin.full_name),
    actor_role: String(admin.role_code),
    action: 'ADMIN_LOGIN_SUCCESS',
    entity_type: 'admin_users',
    entity_id: String(admin.id),
    details: `تسجيل دخول إداري (${String(admin.email)}) بدور ${String(admin.role_code)}`,
  });

  res.json({
    ok: true,
    user: {
      id: String(admin.id),
      email: String(admin.email),
      full_name: String(admin.full_name),
      role: String(admin.role_code),
      actorType: 'admin',
      role_name_ar: String(admin.role_name_ar),
      role_name_en: String(admin.role_name_en),
      permissions,
      is_active: true,
    },
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post('/api/auth/refresh', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const rawRefresh = extractRefreshToken(req);
  if (!rawRefresh) {
    return res.status(401).json({ error: 'رمز التحديث غير مرفق' });
  }

  const result = rotateRefreshSession(req, res, rawRefresh);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json({
    ok: true,
    user: result.actor.profile,
    tokens: {
      access_token: result.tokens.access_token,
      refresh_token: result.tokens.refresh_token,
      token_type: result.tokens.token_type,
      expires_in: result.tokens.expires_in,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const auth = optionalAuth(req);
  const fcmToken = typeof req.body?.fcm_token === 'string' ? req.body.fcm_token.trim() : '';
  const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim() : '';
  if (
    auth &&
    auth.sessionId.startsWith('ses_') &&
    (auth.role === 'customer' || auth.role === 'captain' || auth.role === 'merchant') &&
    (fcmToken || deviceId)
  ) {
    unregisterDeviceToken({
      userId: auth.id,
      userRole: auth.role as PushUserRole,
      fcmToken: fcmToken || null,
      deviceId: deviceId || null,
    });
  }
  const { revoked } = revokeCurrentSession(req, res);
  res.json({ ok: true, revoked });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    ok: true,
    authenticated: true,
    user: req.auth!.profile,
  });
});

app.get('/api/dashboard/overview', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  const captainsTotal = (db.prepare('SELECT COUNT(*) as c FROM captains').get() as { c: number }).c;
  const captainsPending = (
    db.prepare("SELECT COUNT(*) as c FROM captains WHERE verification_status IN ('new','incomplete_data','under_review','needs_correction')").get() as { c: number }
  ).c;
  const captainsAvailable = (
    db.prepare("SELECT COUNT(*) as c FROM captains WHERE verification_status = 'approved' AND availability_status = 'available'").get() as { c: number }
  ).c;
  const merchantsTotal = (db.prepare('SELECT COUNT(*) as c FROM merchants').get() as { c: number }).c;
  const pharmaciesTotal = (db.prepare("SELECT COUNT(*) as c FROM merchants WHERE merchant_type = 'pharmacy'").get() as { c: number }).c;
  const ordersCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
  const ordersActive = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('delivered','cancelled','refunded')").get() as { c: number }).c;
  const marketPending = (db.prepare("SELECT COUNT(*) as c FROM market_listings WHERE moderation_status = 'pending'").get() as { c: number }).c;
  const complaintsOpen = (db.prepare("SELECT COUNT(*) as c FROM complaints WHERE status IN ('open','investigating','escalated')").get() as { c: number }).c;

  const gmvRow = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'").get() as { total: number };
  const revRow = db.prepare("SELECT COALESCE(SUM(credit), 0) as total FROM ledger_entries WHERE account_type = 'platform_revenue'").get() as { total: number };
  const escrowRow = db.prepare("SELECT COALESCE(SUM(credit - debit), 0) as total FROM ledger_entries WHERE account_type = 'escrow_hold'").get() as { total: number };
  const walletSum = db.prepare('SELECT COALESCE(SUM(available_balance), 0) as avail, COALESCE(SUM(pending_balance), 0) as pend FROM wallets').get() as { avail: number; pend: number };
  const settlementsPending = (db.prepare("SELECT COALESCE(SUM(net_payout), 0) as total FROM settlements WHERE status IN ('requested','approved')").get() as { total: number }).total;
  const ratingsRow = db
    .prepare("SELECT COUNT(*) as cnt, COALESCE(AVG(rating), 5.0) as avg_rating FROM captain_ratings WHERE status = 'submitted' AND rating IS NOT NULL")
    .get() as { cnt: number; avg_rating: number };
  const penaltiesRow = db.prepare('SELECT COALESCE(SUM(total_penalties), 0) as total FROM captains').get() as { total: number };
  const activeTripsCount = (db.prepare("SELECT COUNT(*) as c FROM trips WHERE status NOT IN ('completed','cancelled')").get() as { c: number }).c;
  const supportOpenCount = (db.prepare("SELECT COUNT(*) as c FROM support_tickets WHERE status IN ('open','in_progress')").get() as { c: number }).c;

  res.json({
    captainsTotal,
    captainsPending,
    captainsAvailable,
    merchantsTotal,
    pharmaciesTotal,
    ordersCount,
    ordersActive,
    marketPending,
    complaintsOpen,
    supportOpenCount,
    gmvTotal: Number(gmvRow.total.toFixed(2)),
    platformRevenue: Number(revRow.total.toFixed(2)),
    escrowHeld: Number(escrowRow.total.toFixed(2)),
    walletsAvailableTotal: Number(walletSum.avail.toFixed(2)),
    walletsPendingTotal: Number(walletSum.pend.toFixed(2)),
    settlementsPending: Number(settlementsPending.toFixed(2)),
    ratingsCount: ratingsRow.cnt,
    avgCaptainRating: Number((ratingsRow.avg_rating || 5).toFixed(2)),
    totalCaptainPenalties: Number((penaltiesRow.total || 0).toFixed(2)),
    activeTripsCount,
  });
});

// 2. Services Feature Flags
app.get('/api/services', (_req, res) => {
  const rows = db.prepare('SELECT * FROM service_configs').all() as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      ...r,
      is_enabled: Boolean(r.is_enabled),
      requires_license: Boolean(r.requires_license),
      license_ready: Boolean(r.license_ready),
    }))
  );
});

app.patch('/api/services/:key', requireAuth, requirePermission('services.manage'), (req, res) => {
  const { key } = req.params;
  const { is_enabled, license_ready, min_order_amount, maintenance_msg_ar, reason } = req.body;
  const existing = db.prepare('SELECT * FROM service_configs WHERE service_key = ?').get(key) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الخدمة غير موجودة' });

  const enforcedEnabled = key === 'rides' ? 1 : is_enabled !== undefined ? (is_enabled ? 1 : 0) : existing.is_enabled;
  const enforcedLicenseReady = key === 'rides' ? 1 : license_ready !== undefined ? (license_ready ? 1 : 0) : existing.license_ready;
  const enforcedMaint = key === 'rides' ? '' : maintenance_msg_ar !== undefined ? String(maintenance_msg_ar) : existing.maintenance_msg_ar;

  db.prepare(`
    UPDATE service_configs
    SET is_enabled = ?, requires_license = ?, license_ready = ?, min_order_amount = ?, maintenance_msg_ar = ?, updated_at = datetime('now')
    WHERE service_key = ?
  `).run(
    enforcedEnabled,
    key === 'rides' ? 0 : existing.requires_license,
    enforcedLicenseReady,
    min_order_amount !== undefined ? Number(min_order_amount) : existing.min_order_amount,
    enforcedMaint,
    key
  );

  recordAuditLog({
    action: 'SERVICE_CONFIG_UPDATED',
    entity_type: 'service_configs',
    entity_id: key,
    reason: reason ?? 'تعديل إعدادات الخدمة من لوحة التحكم',
    details: `تم تحديث الخدمة (${String(existing.name_ar)}): التفعيل = ${enforcedEnabled ? 'مفعل' : 'موقوف'}، الحد الأدنى = ${min_order_amount ?? existing.min_order_amount} ج.م`,
  });

  res.json({ ok: true });
});

// 3. El Manzala Zones
app.get('/api/zones', (_req, res) => {
  const rows = db.prepare('SELECT * FROM service_zones ORDER BY remote_area_fee ASC').all() as Array<Record<string, unknown>>;
  res.json(rows.map((z) => ({ ...z, is_active: Boolean(z.is_active) })));
});

app.post('/api/zones', requireAuth, requirePermission('zones.manage'), (req, res) => {
  const { name_ar, name_en, zone_type, center_lat, center_lng, radius_km, remote_area_fee } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'اسم المنطقة بالعربية مطلوب' });
  const id = uid('zn');
  db.prepare(`
    INSERT INTO service_zones (id, name_ar, name_en, zone_type, center_lat, center_lng, radius_km, remote_area_fee, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    name_ar,
    name_en || name_ar,
    zone_type || 'village',
    Number(center_lat || 31.15),
    Number(center_lng || 31.93),
    Number(radius_km || 3),
    Number(remote_area_fee || 0)
  );
  recordAuditLog({
    action: 'ZONE_CREATED',
    entity_type: 'service_zones',
    entity_id: id,
    details: `إضافة منطقة تشغيل جديدة: ${name_ar} (رسوم بعد: ${remote_area_fee || 0} ج.م)`,
  });
  res.status(201).json({ id });
});

app.patch('/api/zones/:id', requireAuth, requirePermission('zones.manage'), (req, res) => {
  const { id } = req.params;
  const { remote_area_fee, radius_km, is_active } = req.body;
  const existing = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'المنطقة غير موجودة' });

  db.prepare(`
    UPDATE service_zones SET remote_area_fee = ?, radius_km = ?, is_active = ? WHERE id = ?
  `).run(
    remote_area_fee !== undefined ? Number(remote_area_fee) : existing.remote_area_fee,
    radius_km !== undefined ? Number(radius_km) : existing.radius_km,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    id
  );
  recordAuditLog({
    action: 'ZONE_UPDATED',
    entity_type: 'service_zones',
    entity_id: id,
    details: `تعديل منطقة ${String(existing.name_ar)}: رسوم المنطقة البعيدة = ${remote_area_fee ?? existing.remote_area_fee} ج.م`,
  });
  res.json({ ok: true });
});

// 4. Pricing Engine & Simulator
app.get('/api/pricing', (_req, res) => {
  const rows = db.prepare('SELECT * FROM pricing_rules').all() as Array<Record<string, unknown>>;
  res.json(rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })));
});

app.put('/api/pricing/:id', requireAuth, requirePermission('pricing.manage'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'قاعدة التسعير غير موجودة' });

  const fields = [
    'base_fee',
    'base_distance_km',
    'per_km_rate',
    'per_min_waiting_rate',
    'waiting_grace_min',
    'min_fare',
    'express_fee',
    'peak_multiplier',
    'cancellation_fee',
    'commission_rate',
    'captain_delivery_share_pct',
    'min_commission',
    'max_commission',
  ];

  const values: Record<string, number> = {};
  for (const f of fields) {
    values[f] = req.body[f] !== undefined ? Number(req.body[f]) : Number(existing[f]);
  }
  const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : Number(existing.is_active);

  db.prepare(`
    UPDATE pricing_rules SET
      base_fee = ?, base_distance_km = ?, per_km_rate = ?, per_min_waiting_rate = ?,
      waiting_grace_min = ?, min_fare = ?, express_fee = ?, peak_multiplier = ?,
      cancellation_fee = ?, commission_rate = ?, captain_delivery_share_pct = ?,
      min_commission = ?, max_commission = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    values.base_fee,
    values.base_distance_km,
    values.per_km_rate,
    values.per_min_waiting_rate,
    values.waiting_grace_min,
    values.min_fare,
    values.express_fee,
    values.peak_multiplier,
    values.cancellation_fee,
    values.commission_rate,
    values.captain_delivery_share_pct,
    values.min_commission,
    values.max_commission,
    isActive,
    id
  );

  recordAuditLog({
    action: 'PRICING_RULE_UPDATED',
    entity_type: 'pricing_rules',
    entity_id: id,
    reason: req.body.reason ?? 'تعديل تسعير أو عمولة من لوحة الإدارة',
    details: `تحديث ${String(existing.title_ar)}: رسوم أساسية ${values.base_fee} ج.م، كم ${values.per_km_rate} ج.م، عمولة ${values.commission_rate}%، معامل ذروة ${values.peak_multiplier}x`,
  });

  res.json({ ok: true });
});

app.post('/api/pricing/simulate', (req, res) => {
  try {
    const result = calculateServicePrice(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 5. Dispatch Engine & Config
app.get('/api/dispatch-config', requireAuth, requirePermission('dispatch.manage'), (_req, res) => {
  const row = db.prepare('SELECT * FROM dispatch_config WHERE id = ?').get('default');
  res.json(row);
});

app.put('/api/dispatch-config', requireAuth, requirePermission('dispatch.manage'), (req, res) => {
  const {
    weight_proximity,
    weight_acceptance,
    weight_rating,
    weight_idle_time,
    offer_timeout_sec,
    initial_radius_km,
    expanded_radius_km,
    max_radius_km,
    max_rejections_before_alert,
    default_cash_limit,
  } = req.body;

  const weightSum = Number(weight_proximity) + Number(weight_acceptance) + Number(weight_rating) + Number(weight_idle_time);
  if (Math.abs(weightSum - 1) > 0.02) {
    return res.status(400).json({ error: `مجموع أوزان خوارزمية التوزيع يجب أن يساوي 1.00 (الحالي: ${weightSum.toFixed(2)})` });
  }

  db.prepare(`
    UPDATE dispatch_config SET
      weight_proximity = ?, weight_acceptance = ?, weight_rating = ?, weight_idle_time = ?,
      offer_timeout_sec = ?, initial_radius_km = ?, expanded_radius_km = ?, max_radius_km = ?,
      max_rejections_before_alert = ?, default_cash_limit = ?, updated_at = datetime('now')
    WHERE id = 'default'
  `).run(
    Number(weight_proximity),
    Number(weight_acceptance),
    Number(weight_rating),
    Number(weight_idle_time),
    Number(offer_timeout_sec),
    Number(initial_radius_km),
    Number(expanded_radius_km),
    Number(max_radius_km),
    Number(max_rejections_before_alert),
    Number(default_cash_limit)
  );

  recordAuditLog({
    action: 'DISPATCH_CONFIG_UPDATED',
    entity_type: 'dispatch_config',
    entity_id: 'default',
    details: `تحديث أوزان التوزيع (قرب ${weight_proximity}، قبول ${weight_acceptance}، تقييم ${weight_rating}، انتظار ${weight_idle_time}) ومهلة ${offer_timeout_sec} ثانية`,
  });

  res.json({ ok: true });
});

app.post('/api/dispatch/test', requireAuth, requirePermission('dispatch.manage'), (req, res) => {
  const { service_type, required_vehicle, pickup_lat, pickup_lng } = req.body;
  const result = runSmartDispatch({
    service_type: service_type || 'stores',
    required_vehicle: required_vehicle || undefined,
    pickup_lat: Number(pickup_lat || 31.1583),
    pickup_lng: Number(pickup_lng || 31.9369),
  });
  res.json(result);
});

function sanitizeCaptain(c: Record<string, unknown>, docs?: Array<Record<string, unknown>>) {
  const { password_hash: _pw, ...rest } = c;
  return {
    ...rest,
    total_penalties: Number(c.total_penalties ?? 0),
    is_eligible_for_rides: Boolean(c.is_eligible_for_rides),
    allowed_services: JSON.parse(String(c.allowed_services_json || '[]')),
    ...(docs ? { documents: docs } : {}),
  };
}

function createPendingCaptainRating(params: {
  captain_id: string;
  captain_name: string;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  ref_type: 'trip' | 'order' | 'parcel';
  ref_id: string;
  ref_number: string;
  final_amount: number;
}): Record<string, unknown> {
  const existing = db
    .prepare('SELECT * FROM captain_ratings WHERE ref_type = ? AND ref_id = ?')
    .get(params.ref_type, params.ref_id) as Record<string, unknown> | undefined;
  if (existing) return existing;

  const rId = uid('rat');
  db.prepare(`
    INSERT INTO captain_ratings (
      id, captain_id, captain_name, customer_id, customer_name, customer_phone,
      ref_type, ref_id, ref_number, final_amount, rating, comment, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', 'pending')
  `).run(
    rId,
    params.captain_id,
    params.captain_name,
    params.customer_id || null,
    params.customer_name || 'عميل اطلبها',
    params.customer_phone || null,
    params.ref_type,
    params.ref_id,
    params.ref_number,
    Number(params.final_amount || 0)
  );
  return db.prepare('SELECT * FROM captain_ratings WHERE id = ?').get(rId) as Record<string, unknown>;
}

function finishTripTransaction(params: {
  tripId: string;
  captainIdOverride?: string | null;
  actorRole: 'customer' | 'captain' | 'admin';
  actorName: string;
}) {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(params.tripId) as Record<string, unknown> | undefined;
  if (!trip) return null;
  if (trip.status === 'completed' || trip.status === 'cancelled') {
    return { conflict: true as const, error: 'تم إنهاء أو إلغاء المشوار بالفعل' };
  }

  const capId = params.captainIdOverride || (trip.captain_id ? String(trip.captain_id) : null);
  if (!capId) {
    return { invalidState: true as const, error: 'لا يمكن إنهاء مشوار لم يتم قبوله من كابتن بعد' };
  }
  const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(capId) as Record<string, unknown> | undefined;
  if (!cap) {
    return { invalidState: true as const, error: 'بيانات الكابتن غير موجودة' };
  }

  const fare = Number(trip.final_fare ?? trip.customer_proposed_fare ?? trip.estimated_fare ?? 0);
  const fee10 = Number((fare * 0.1).toFixed(2));
  let ratingPrompt: Record<string, unknown> | null = null;
  let updated = false;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE trips
         SET status = 'completed',
             final_fare = ?,
             captain_id = COALESCE(captain_id, ?),
             captain_name = COALESCE(captain_name, ?)
         WHERE id = ? AND status NOT IN ('completed', 'cancelled')`
      )
      .run(fare, capId, String(cap.full_name || 'الكابتن'), params.tripId);
    if (info.changes !== 1) return;
    updated = true;

    db.prepare('UPDATE captains SET cash_on_hand = ROUND(cash_on_hand + ?, 2), completed_count = completed_count + 1 WHERE id = ?').run(
      fee10,
      capId
    );
    if (fee10 > 0) {
      postDoubleEntryLedger({
        idempotency_base: `trip_completed_${params.tripId}`,
        reference_type: 'trip',
        reference_id: params.tripId,
        description_ar: `حصة التطبيق 10% من رحلة #${String(trip.trip_number)} (السعر النهائي: ${fare} ج.م)`,
        debit_account_code: `CASH_CAPTAIN_${capId}`,
        debit_account_type: 'cash_clearing',
        credit_account_code: 'PLATFORM_REVENUE_RIDES',
        credit_account_type: 'platform_revenue',
        amount: fee10,
      });
    }
    ratingPrompt = createPendingCaptainRating({
      captain_id: capId,
      captain_name: String(cap.full_name || trip.captain_name || 'الكابتن'),
      customer_id: trip.customer_id ? String(trip.customer_id) : null,
      customer_name: String(trip.customer_name || 'عميل اطلبها'),
      customer_phone: trip.customer_phone ? String(trip.customer_phone) : null,
      ref_type: 'trip',
      ref_id: params.tripId,
      ref_number: String(trip.trip_number),
      final_amount: fare,
    });

    db.prepare(`
      INSERT INTO trip_chat_messages (id, trip_id, sender_role, sender_name, message_text, image_url)
      VALUES (?, ?, 'system', 'النظام', ?, NULL)
    `).run(
      uid('tmsg'),
      params.tripId,
      `تم إنهاء المشوار وتوثيق الفاتورة النهائية (${fare} ج.م) وحفظ المحادثة وسجل الرحلة في الأرشيف.`
    );
  });

  tx();
  if (!updated) {
    return { conflict: true as const, error: 'تم إنهاء أو إلغاء المشوار بالفعل' };
  }

  const archivedTrip = db.prepare('SELECT * FROM trips WHERE id = ?').get(params.tripId) as Record<string, unknown> | undefined;
  const custRoom = trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [];
  const roomKeys = [`trip:${params.tripId}`, 'rides:all', 'admin:all', `captain:${capId}`, ...custRoom];
  broadcastToRooms(roomKeys, {
    type: 'trip:completed',
    trip_id: params.tripId,
    trip_number: trip.trip_number,
    captain_id: capId,
    captain_name: cap.full_name ?? trip.captain_name ?? null,
    fare,
    fee_10pct: fee10,
    completed_by: params.actorRole,
    rating_prompt: ratingPrompt,
    trip: archivedTrip,
  });

  recordAuditLog({
    actor_name: params.actorName,
    actor_role: params.actorRole,
    action: 'TRIP_COMPLETED_AND_ARCHIVED',
    entity_type: 'trips',
    entity_id: params.tripId,
    details: `إنهاء المشوار #${String(trip.trip_number)} بواسطة ${params.actorRole} — السعر النهائي ${fare} ج.م — إضافة 10% (${fee10} ج.م) على الكابتن وأرشفة السجل`,
  });

  return { ok: true as const, archived: true, fare, fee_10pct: fee10, captain_id: capId, rating_prompt: ratingPrompt, trip: archivedTrip };
}

function cancelTripTransaction(params: {
  tripId: string;
  captainIdOverride?: string | null;
  actorRole: 'customer' | 'captain' | 'admin';
  actorName: string;
  reason?: string;
}) {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(params.tripId) as Record<string, unknown> | undefined;
  if (!trip) return null;
  if (trip.status === 'completed' || trip.status === 'cancelled') {
    return { conflict: true as const, error: 'تم إنهاء أو إلغاء المشوار بالفعل' };
  }

  const capId = params.captainIdOverride || (trip.captain_id ? String(trip.captain_id) : null);
  const cap = capId
    ? (db.prepare('SELECT * FROM captains WHERE id = ?').get(capId) as Record<string, unknown> | undefined)
    : undefined;

  const fare = Number(trip.final_fare ?? trip.customer_proposed_fare ?? trip.estimated_fare ?? 0);
  const penalty10 = params.actorRole === 'captain' && capId && cap ? Number((fare * 0.1).toFixed(2)) : 0;
  let updated = false;

  const tx = db.transaction(() => {
    const info = db
      .prepare(`UPDATE trips SET status = 'cancelled' WHERE id = ? AND status NOT IN ('completed', 'cancelled')`)
      .run(params.tripId);
    if (info.changes !== 1) return;
    updated = true;

    if (params.actorRole === 'captain' && capId && cap && penalty10 > 0) {
      db.prepare(`
        UPDATE captains
        SET cash_on_hand = ROUND(cash_on_hand + ?, 2),
            total_penalties = ROUND(COALESCE(total_penalties, 0) + ?, 2),
            cancellation_rate = MIN(100, ROUND(cancellation_rate + 2.5, 1))
        WHERE id = ?
      `).run(penalty10, penalty10, capId);

      postDoubleEntryLedger({
        idempotency_base: `trip_cancel_penalty_${params.tripId}`,
        reference_type: 'trip_penalty',
        reference_id: params.tripId,
        description_ar: `خصم غرامة إلغاء رحلة 10% على الطيار ${String(cap.full_name)} (#${String(trip.trip_number)})`,
        debit_account_code: `CASH_CAPTAIN_${capId}`,
        debit_account_type: 'cash_clearing',
        credit_account_code: 'PLATFORM_REVENUE_PENALTIES',
        credit_account_type: 'platform_revenue',
        amount: penalty10,
      });
    }

    const actorAr = params.actorRole === 'captain' ? 'الطيار' : params.actorRole === 'admin' ? 'الإدارة' : 'العميل';
    db.prepare(`
      INSERT INTO trip_chat_messages (id, trip_id, sender_role, sender_name, message_text, image_url)
      VALUES (?, ?, 'system', 'النظام', ?, NULL)
    `).run(
      uid('tmsg'),
      params.tripId,
      `تم إلغاء المشوار بواسطة ${actorAr}${params.reason ? ` (${params.reason})` : ''} وحفظ السجل والمحادثة في الأرشيف.`
    );
  });

  tx();
  if (!updated) {
    return { conflict: true as const, error: 'تم إنهاء أو إلغاء المشوار بالفعل' };
  }

  const archivedTrip = db.prepare('SELECT * FROM trips WHERE id = ?').get(params.tripId) as Record<string, unknown> | undefined;
  const custRoom = trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [];
  const roomKeys = [`trip:${params.tripId}`, 'rides:all', 'admin:all', ...(capId ? [`captain:${capId}`] : []), ...custRoom];
  broadcastToRooms(roomKeys, {
    type: 'trip:cancelled',
    trip_id: params.tripId,
    trip_number: trip.trip_number,
    captain_id: capId,
    captain_name: cap?.full_name ?? trip.captain_name ?? null,
    fare,
    penalty_10pct: penalty10,
    cancelled_by: params.actorRole,
    reason: params.reason || null,
    trip: archivedTrip,
  });

  recordAuditLog({
    actor_name: params.actorName,
    actor_role: params.actorRole,
    action: 'TRIP_CANCELLED_AND_ARCHIVED',
    entity_type: 'trips',
    entity_id: params.tripId,
    reason: params.reason ?? null,
    details:
      params.actorRole === 'captain' && penalty10 > 0
        ? `إلغاء المشوار #${String(trip.trip_number)} بواسطة الطيار — خصم 10% (${penalty10} ج.م) من قيمة ${fare} ج.م وأرشفة السجل`
        : `إلغاء المشوار #${String(trip.trip_number)} بواسطة ${params.actorRole} بدون غرامة وأرشفة السجل`,
  });

  return { ok: true as const, archived: true, fare, penalty_10pct: penalty10, cancelled_by: params.actorRole, trip: archivedTrip };
}

// 6. Captains & KYC Documents
app.get('/api/captains', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  const captains = db
    .prepare(
      `SELECT * FROM captains
       ORDER BY CASE
         WHEN verification_status IN ('under_review', 'new', 'needs_correction', 'incomplete_data') THEN 0
         WHEN verification_status = 'approved' THEN 1
         ELSE 2
       END, rowid DESC`
    )
    .all() as Array<Record<string, unknown>>;
  const docs = db.prepare('SELECT * FROM captain_documents').all() as Array<Record<string, unknown>>;
  res.json(captains.map((c) => sanitizeCaptain(c, docs.filter((d) => d.captain_id === c.id))));
});

app.patch('/api/captains/:id/credentials', requireAuth, requirePermission('captains.review'), (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body as { username?: string; password?: string };
  const existing = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الكابتن غير موجود' });

  const trimmedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const rawPassword = typeof password === 'string' ? password : '';

  if (!trimmedUsername && !rawPassword) {
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم أو كلمة مرور جديدة' });
  }

  let nextUsername = String(existing.username || '');
  if (trimmedUsername) {
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(trimmedUsername)) {
      return res.status(400).json({
        error: 'اسم المستخدم يجب أن يكون 3 إلى 32 حرفًا بالإنجليزية أو أرقام (بدون مسافات)',
      });
    }
    const conflict = db
      .prepare('SELECT id FROM captains WHERE LOWER(username) = LOWER(?) AND id != ?')
      .get(trimmedUsername, id);
    if (conflict) {
      return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل لكابتن آخر' });
    }
    nextUsername = trimmedUsername;
  }

  let nextPasswordHash = String(existing.password_hash || '');
  if (rawPassword) {
    if (rawPassword.length < 4) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 4 أحرف' });
    }
    nextPasswordHash = hashPassword(rawPassword);
  }

  db.prepare('UPDATE captains SET username = ?, password_hash = ? WHERE id = ?').run(nextUsername, nextPasswordHash, id);

  recordAuditLog({
    action: 'CAPTAIN_CREDENTIALS_UPDATED',
    entity_type: 'captains',
    entity_id: id,
    reason: 'تحديث بيانات دخول الطيار',
    details: `تحديث بيانات دخول الكابتن (${String(existing.full_name)}) — اسم المستخدم: @${nextUsername}${
      rawPassword ? ' + تم تعيين كلمة مرور جديدة' : ''
    }`,
  });

  res.json({ ok: true, username: nextUsername });
});

app.delete('/api/captains/:id', requireAuth, requirePermission('captains.review', 'captains.suspend'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الكابتن غير موجود' });

  const captainName = String(existing.full_name || id);
  const captainSessions = db
    .prepare("SELECT id FROM user_sessions WHERE user_id = ? AND user_role = 'captain'")
    .all(id) as Array<{ id: string }>;

  const removeCaptainTx = db.transaction((capId: string) => {
    db.prepare('UPDATE orders SET captain_id = NULL WHERE captain_id = ?').run(capId);
    db.prepare('UPDATE trips SET captain_id = NULL WHERE captain_id = ?').run(capId);
    db.prepare('UPDATE trips SET preferred_captain_id = NULL WHERE preferred_captain_id = ?').run(capId);
    db.prepare('UPDATE deliveries SET captain_id = NULL WHERE captain_id = ?').run(capId);
    db.prepare('UPDATE deliveries SET preferred_captain_id = NULL WHERE preferred_captain_id = ?').run(capId);
    db.prepare('DELETE FROM captain_documents WHERE captain_id = ?').run(capId);
    db.prepare('DELETE FROM captain_ratings WHERE captain_id = ?').run(capId);
    db.prepare("DELETE FROM wallets WHERE user_id = ? AND owner_type = 'captain'").run(capId);
    db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND user_role = 'captain'").run(capId);
    db.prepare("DELETE FROM push_device_tokens WHERE user_id = ? AND user_role = 'captain'").run(capId);
    db.prepare('DELETE FROM captains WHERE id = ?').run(capId);
  });

  removeCaptainTx(id);
  for (const s of captainSessions) {
    closeSocketsForSession(s.id, 4401, 'تم حذف حساب الطيار');
  }

  recordAuditLog({
    actor_name: req.auth?.fullName || 'المدير العام',
    actor_role: req.auth?.role || 'super_admin',
    action: 'CAPTAIN_DELETED',
    entity_type: 'captains',
    entity_id: id,
    reason: 'حذف حساب طيار من لوحة الإدارة',
    details: `تم حذف الطيار (${captainName} - ${String(existing.phone || '')}) وإنهاء جلساته النشطة`,
  });

  broadcastToRooms(['rides:all', 'admin:all', `captain:${id}`], {
    type: 'captains:updated',
    captain_id: id,
    deleted: true,
    availability_status: 'offline',
  });

  res.json({ ok: true, id, deleted_name: captainName });
});

app.patch('/api/captains/:id/status', requireAuth, requirePermission('captains.review', 'captains.suspend'), (req, res) => {
  const { id } = req.params;
  const { verification_status, rejection_reason, is_eligible_for_rides, allowed_services, availability_status, cash_limit } = req.body;
  const existing = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الكابتن غير موجود' });

  if (verification_status === 'rejected' && !rejection_reason) {
    return res.status(400).json({ error: 'يجب توضيح سبب الرفض' });
  }

  const nextStatus = verification_status ?? existing.verification_status;
  const nextAvail = nextStatus !== 'approved' ? 'offline' : availability_status ?? existing.availability_status;

  db.prepare(`
    UPDATE captains SET
      verification_status = ?, rejection_reason = ?, is_eligible_for_rides = ?,
      allowed_services_json = ?, availability_status = ?, cash_limit = ?
    WHERE id = ?
  `).run(
    nextStatus,
    rejection_reason !== undefined ? rejection_reason : existing.rejection_reason,
    is_eligible_for_rides !== undefined ? (is_eligible_for_rides ? 1 : 0) : existing.is_eligible_for_rides,
    allowed_services ? JSON.stringify(allowed_services) : existing.allowed_services_json,
    nextAvail,
    cash_limit !== undefined ? Number(cash_limit) : existing.cash_limit,
    id
  );

  if (nextStatus === 'approved') {
    db.prepare("UPDATE captain_documents SET review_status = 'approved' WHERE captain_id = ?").run(id);
  }

  recordAuditLog({
    action: 'CAPTAIN_REVIEW_UPDATED',
    entity_type: 'captains',
    entity_id: id,
    reason: rejection_reason || 'مراجعة ملف الكابتن',
    details: `تحديث حالة الكابتن (${String(existing.full_name)}) إلى ${String(nextStatus)} — التوفر: ${String(nextAvail)}`,
  });

  broadcastToRooms(['rides:all', 'admin:all', `captain:${id}`], {
    type: 'captains:updated',
    captain_id: id,
    verification_status: nextStatus,
    availability_status: nextAvail,
  });

  if (verification_status && verification_status !== existing.verification_status) {
    const statusMap: Record<string, { title: string; body: string; cat: 'compliance' | 'operational' | 'alert' }> = {
      approved: {
        title: 'تم اعتماد حسابك ككابتن في اطلبها',
        body: 'مبروك! يمكنك الآن تفعيل حالة التوفر وبدء استقبال الطلبات والمشاوير في المنزلة.',
        cat: 'operational',
      },
      rejected: {
        title: 'تحديث بخصوص طلب تسجيلك في اطلبها',
        body: rejection_reason ? `تم رفض الطلب: ${String(rejection_reason)}` : 'تعذر اعتماد طلبك حاليًا. راجع الإدارة للتفاصيل.',
        cat: 'compliance',
      },
      needs_correction: {
        title: 'مطلوب استكمال أو تعديل مستنداتك',
        body: rejection_reason ? `يرجى مراجعة: ${String(rejection_reason)}` : 'يرجى تحديث مستندات الحساب من صفحة الملف الشخصي.',
        cat: 'compliance',
      },
      suspended: {
        title: 'تم إيقاف الحساب مؤقتًا',
        body: rejection_reason ? `السبب: ${String(rejection_reason)}` : 'تم تعليق استقبال الطلبات مؤقتًا. تواصل مع الإدارة.',
        cat: 'alert',
      },
    };
    const msg = statusMap[String(nextStatus)];
    if (msg) {
      enqueueSystemPushNotification({
        targetApp: 'captain',
        targetZone: String(existing.zone_name || 'all'),
        recipientId: id,
        category: msg.cat,
        titleAr: msg.title,
        bodyAr: msg.body,
        deepLink: 'profile',
        status: String(nextStatus),
        channelId: 'otlobha_admin_channel',
        sentBy: req.auth!.fullName,
      });
    }
  }

  res.json({ ok: true });
});

app.patch('/api/captain-docs/:docId', requireAuth, requirePermission('docs.verify', 'captains.review'), (req, res) => {
  const { docId } = req.params;
  const { review_status, review_note } = req.body;
  const doc = db.prepare('SELECT * FROM captain_documents WHERE id = ?').get(docId) as Record<string, unknown> | undefined;
  if (!doc) return res.status(404).json({ error: 'المستند غير موجود' });
  db.prepare('UPDATE captain_documents SET review_status = ?, review_note = ? WHERE id = ?').run(review_status, review_note ?? null, docId);
  recordAuditLog({
    action: 'CAPTAIN_DOCUMENT_REVIEWED',
    entity_type: 'captain_documents',
    entity_id: docId,
    reason: review_note ?? 'مراجعة مستند مركبة/هوية',
    details: `تقييم مستند (${String(doc.label_ar)}): ${review_status}`,
  });
  res.json({ ok: true });
});

// 7. Merchants, Pharmacies & Orders
function sanitizeMerchantRow(m: Record<string, unknown>) {
  const { password_hash: _pw, ...rest } = m;
  return {
    ...rest,
    is_email_verified: Boolean(m.is_email_verified),
    terms_accepted: Boolean(m.terms_accepted),
    supports_free_order: Boolean(m.supports_free_order),
    is_open_now: Boolean(m.is_open_now),
  };
}

function sanitizePublicMerchantRow(m: Record<string, unknown>) {
  return {
    id: m.id,
    business_name_ar: m.business_name_ar,
    business_name_en: m.business_name_en,
    merchant_type: m.merchant_type,
    branch_name: m.branch_name,
    zone_name: m.zone_name,
    phone: m.phone,
    working_hours: m.working_hours,
    image_url: m.image_url,
    verification_status: m.verification_status,
    supports_free_order: Boolean(m.supports_free_order),
    is_open_now: Boolean(m.is_open_now),
    lat: m.lat,
    lng: m.lng,
    orders_count: m.orders_count,
  };
}

function parseOrderItems(rawJson: unknown) {
  if (typeof rawJson !== 'string' || !rawJson.trim()) return [];
  try {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapOrderRow(o: Record<string, unknown>) {
  return {
    ...o,
    is_express: Boolean(o.is_express),
    items: parseOrderItems(o.items_json),
  };
}

function canAccessOrder(auth: AuthContext, order: Record<string, unknown>): boolean {
  if (isAdminAuth(auth)) return true;
  if (auth.role === 'customer') {
    if (!order.customer_id || auth.id === 'guest_customer_01') return true;
    return String(order.customer_id) === auth.id;
  }
  if (auth.role === 'merchant') {
    if (Boolean(order.merchant_id) && String(order.merchant_id) === auth.id) return true;
    const sec = db
      .prepare('SELECT 1 FROM order_stores WHERE order_id = ? AND merchant_id = ? LIMIT 1')
      .get(String(order.id), auth.id);
    return Boolean(sec);
  }
  if (auth.role === 'captain') return Boolean(order.captain_id) && String(order.captain_id) === auth.id;
  return true;
}

app.get('/api/merchants', (req, res) => {
  const approvedOnly = req.query.approved_only === '1' || req.query.approved_only === 'true';
  if (approvedOnly) {
    const rows = db
      .prepare("SELECT * FROM merchants WHERE verification_status = 'approved' ORDER BY rowid DESC")
      .all() as Array<Record<string, unknown>>;
    return res.json(rows.map(sanitizePublicMerchantRow));
  }

  return requireAuth(req, res, () => {
    return requireRole(...ALL_ADMIN_ROLES)(req, res, () => {
      const rows = db.prepare('SELECT * FROM merchants ORDER BY rowid DESC').all() as Array<Record<string, unknown>>;
      return res.json(rows.map(sanitizeMerchantRow));
    });
  });
});

app.get(
  '/api/merchants/:id',
  requireAuth,
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'التاجر أو المتجر غير موجود' });

  const wallet = db
    .prepare('SELECT id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen FROM wallets WHERE user_id = ?')
    .get(id) as Record<string, unknown> | undefined;

  const categories = db
    .prepare(
      'SELECT id, scope, merchant_id, name_ar, name_en, image_url, sort_order, is_offers_section, is_active FROM categories WHERE merchant_id = ? ORDER BY sort_order ASC'
    )
    .all(id) as Array<Record<string, unknown>>;

  const prodStats = db
    .prepare(
      'SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END), 0) as available FROM products WHERE merchant_id = ?'
    )
    .get(id) as { total: number; available: number };

  const ordStats = db
    .prepare(
      `SELECT COUNT(*) as total,
              COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) as delivered,
              COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled,
              COALESCE(SUM(CASE WHEN status = 'delivered' THEN total_amount ELSE 0 END), 0) as total_sales
       FROM orders WHERE merchant_id = ?`
    )
    .get(id) as { total: number; delivered: number; cancelled: number; total_sales: number };

  const recentOrders = db
    .prepare(
      `SELECT id, order_number, customer_name, customer_phone, status, subtotal, delivery_fee, discount_amount, total_amount, payment_method, order_channel, created_at
       FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(id) as Array<Record<string, unknown>>;

  res.json({
    merchant: sanitizeMerchantRow(existing),
    wallet: wallet ? { ...wallet, is_frozen: Boolean(wallet.is_frozen) } : null,
    categories: categories.map((c) => ({
      ...c,
      is_offers_section: Boolean(c.is_offers_section),
      is_active: Boolean(c.is_active),
    })),
    stats: {
      categories_count: categories.length,
      products_total: Number(prodStats?.total || 0),
      products_available: Number(prodStats?.available || 0),
      orders_total: Number(ordStats?.total || 0),
      orders_delivered: Number(ordStats?.delivered || 0),
      orders_cancelled: Number(ordStats?.cancelled || 0),
      total_sales: Number(ordStats?.total_sales || 0),
    },
    recent_orders: recentOrders,
  });
});

app.patch(
  '/api/merchants/:id',
  requireAuth,
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const { verification_status, commission_rate, is_open_now, image_url, business_name_ar, branch_name, phone } = req.body;
    const isAdminActor = (ALL_ADMIN_ROLES as readonly string[]).includes(req.auth!.role);
    if (!isAdminActor && (verification_status !== undefined || commission_rate !== undefined)) {
      return res.status(403).json({ error: 'غير مصرح للتاجر بتعديل حالة الاعتماد أو نسبة العمولة' });
    }
    const existing = db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'التاجر غير موجود' });

    db.prepare(`
      UPDATE merchants SET
        verification_status = ?,
        commission_rate = ?,
        is_open_now = ?,
        image_url = ?,
        business_name_ar = ?,
        branch_name = ?,
        phone = ?
      WHERE id = ?
    `).run(
      isAdminActor && verification_status !== undefined ? verification_status : existing.verification_status,
      isAdminActor && commission_rate !== undefined ? Number(commission_rate) : existing.commission_rate,
      is_open_now !== undefined ? (is_open_now ? 1 : 0) : existing.is_open_now,
      image_url !== undefined ? String(image_url || '') : String(existing.image_url || ''),
      business_name_ar !== undefined ? String(business_name_ar).trim() : existing.business_name_ar,
      branch_name !== undefined ? String(branch_name).trim() : existing.branch_name,
      phone !== undefined ? String(phone).trim() : existing.phone,
      id
    );
    const updated = db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as Record<string, unknown>;
    recordAuditLog({
      actor_name: req.auth!.fullName,
      actor_role: req.auth!.role,
      action: 'MERCHANT_UPDATED',
      entity_type: 'merchants',
      entity_id: id,
      details: `تحديث التاجر (${String(updated.business_name_ar)}): الحالة ${String(updated.verification_status)}، العمولة ${String(updated.commission_rate)}%`,
    });
    res.json({
      ok: true,
      merchant: sanitizeMerchantRow(updated),
    });
  }
);

app.get(
  '/api/merchants/:id/swipe-progress',
  requireAuth,
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const merchant = db
      .prepare('SELECT id, swipe_deck_product_id, swipe_deck_index FROM merchants WHERE id = ?')
      .get(id) as { id: string; swipe_deck_product_id?: string | null; swipe_deck_index?: number | null } | undefined;
    if (!merchant) return res.status(404).json({ error: 'التاجر غير موجود' });

    const savedProductId = String(merchant.swipe_deck_product_id || '').trim();
    const savedIndex = Math.max(0, Math.trunc(Number(merchant.swipe_deck_index || 0)));

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM products p
         JOIN merchants m ON m.id = p.merchant_id
         JOIN categories c ON c.id = p.category_id
         WHERE p.merchant_id = ? AND p.is_available = 1`
      )
      .get(id) as { c?: number } | undefined;
    const totalAvailable = Number(totalRow?.c || 0);

    let resolvedOffset = 0;
    let isCompleted = false;

    if (totalAvailable === 0) {
      resolvedOffset = 0;
    } else if (savedProductId === '__END__') {
      resolvedOffset = totalAvailable;
      isCompleted = true;
    } else if (savedProductId.length > 0) {
      const beforeRow = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM products p
           JOIN merchants m ON m.id = p.merchant_id
           JOIN categories c ON c.id = p.category_id
           WHERE p.merchant_id = ? AND p.is_available = 1 AND p.id < ?`
        )
        .get(id, savedProductId) as { c?: number } | undefined;
      const beforeCount = Number(beforeRow?.c || 0);
      resolvedOffset = Math.min(beforeCount, Math.max(0, totalAvailable - 1));
    } else if (savedIndex > 0) {
      resolvedOffset = Math.min(savedIndex, Math.max(0, totalAvailable - 1));
    }

    res.json({
      ok: true,
      merchant_id: id,
      product_id: savedProductId,
      card_index: savedIndex,
      resolved_offset: resolvedOffset,
      total_available: totalAvailable,
      is_completed: isCompleted,
    });
  }
);

app.put(
  '/api/merchants/:id/swipe-progress',
  requireAuth,
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM merchants WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) return res.status(404).json({ error: 'التاجر غير موجود' });

    const rawProductId = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
    if (rawProductId.length > 128) {
      return res.status(400).json({ error: 'معرف المنتج غير صالح' });
    }
    const rawCardIndex = Number(req.body?.card_index ?? 0);
    const cardIndex = Number.isFinite(rawCardIndex)
      ? Math.max(0, Math.min(1000000, Math.trunc(rawCardIndex)))
      : 0;

    db.prepare(
      'UPDATE merchants SET swipe_deck_product_id = ?, swipe_deck_index = ? WHERE id = ?'
    ).run(rawProductId, cardIndex, id);

    res.json({
      ok: true,
      merchant_id: id,
      product_id: rawProductId,
      card_index: cardIndex,
    });
  }
);

app.delete('/api/merchants/:id', requireAuth, requirePermission('merchants.verify'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'التاجر أو المتجر غير موجود' });

  const bizName = String(existing.business_name_ar || id);
  const email = existing.email ? String(existing.email) : null;

  const merchantSessions = db
    .prepare('SELECT id FROM user_sessions WHERE user_id = ? AND user_role = ?')
    .all(id, 'merchant') as Array<{ id: string }>;

  const delTx = db.transaction(() => {
    // Preserve historical orders, order_stores, order_chat_messages, ledger_entries, and shared master_products
    db.prepare('DELETE FROM product_deals WHERE merchant_id = ?').run(id);
    db.prepare('DELETE FROM product_matching_requests WHERE merchant_id = ?').run(id);
    db.prepare(
      'UPDATE product_matching_requests SET category_id = NULL WHERE category_id IN (SELECT id FROM categories WHERE merchant_id = ?)'
    ).run(id);
    db.prepare(
      'UPDATE master_products SET category_id = NULL WHERE category_id IN (SELECT id FROM categories WHERE merchant_id = ?)'
    ).run(id);
    db.prepare(
      'UPDATE storefront_banners SET target_merchant_id = NULL WHERE target_merchant_id = ?'
    ).run(id);
    db.prepare(
      'UPDATE storefront_banners SET target_category_id = NULL WHERE target_category_id IN (SELECT id FROM categories WHERE merchant_id = ?)'
    ).run(id);
    db.prepare(
      'UPDATE categories SET parent_id = NULL WHERE parent_id IN (SELECT id FROM categories WHERE merchant_id = ?)'
    ).run(id);
    db.prepare(
      'DELETE FROM products WHERE merchant_id = ? OR category_id IN (SELECT id FROM categories WHERE merchant_id = ?)'
    ).run(id, id);
    db.prepare('DELETE FROM categories WHERE merchant_id = ?').run(id);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(id);
    if (email) {
      db.prepare("DELETE FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role IN ('merchant', 'merchant_register')").run(email);
    }
    db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND user_role = ?').run(id, 'merchant');
    db.prepare('DELETE FROM merchants WHERE id = ?').run(id);

    recordAuditLog({
      actor_name: req.auth!.fullName,
      actor_role: req.auth!.role,
      action: 'MERCHANT_DELETED',
      entity_type: 'merchants',
      entity_id: id,
      details: `حذف المتجر / التاجر نهائيًا مع الإبقاء على سجلات الطلبات السابقة والكتالوج المركزي: ${bizName} (${id})`,
    });
  });

  delTx();
  for (const s of merchantSessions) {
    closeSocketsForSession(s.id, 4401, 'تم حذف حساب المتجر');
  }
  res.json({ ok: true, id, deleted_business_name: bizName });
});

app.get('/api/orders', allowAnyUserOrGuest, (req, res) => {
  const auth = req.auth!;
  const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const defaultLimit = paginated ? 60 : 200;
  const maxLimit = paginated ? 200 : 500;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit || defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const requestedMerchantFilter = typeof req.query.merchant_id === 'string' ? req.query.merchant_id.trim() : '';
  const scopeParam = typeof req.query.scope === 'string' ? req.query.scope.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const isMerchantCaller = auth.role === 'merchant';
  const isMerchantScopedView = isMerchantCaller || (scopeParam === 'merchant' && Boolean(requestedMerchantFilter) && requestedMerchantFilter !== 'all');
  const effectiveMerchantId = isMerchantCaller
    ? auth.id
    : requestedMerchantFilter && requestedMerchantFilter !== 'all'
    ? requestedMerchantFilter
    : '';

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (statusFilter && statusFilter !== 'all') {
    if (isMerchantScopedView && effectiveMerchantId) {
      clauses.push(
        '(o.status = ? OR EXISTS (SELECT 1 FROM order_stores os_st WHERE os_st.order_id = o.id AND os_st.merchant_id = ? AND os_st.prep_status = ?))'
      );
      params.push(statusFilter, effectiveMerchantId, statusFilter);
    } else {
      clauses.push('o.status = ?');
      params.push(statusFilter);
    }
  }
  if (auth.role === 'customer') {
    clauses.push('o.customer_id = ?');
    params.push(auth.id);
  }
  if (effectiveMerchantId) {
    clauses.push('(o.merchant_id = ? OR EXISTS (SELECT 1 FROM order_stores os WHERE os.order_id = o.id AND os.merchant_id = ?))');
    params.push(effectiveMerchantId, effectiveMerchantId);
  }
  if (q) {
    const like = `%${q}%`;
    clauses.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.merchant_name LIKE ?)');
    params.push(like, like, like, like);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              m.lat as merchant_lat,
              m.lng as merchant_lng,
              (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       LEFT JOIN merchants m ON m.id = o.merchant_id
       ${whereSql}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const sectionsMap = getOrderStoreSectionsMap(rows.map((r) => String(r.id)));
  const viewAuth: AuthContext = isMerchantScopedView && effectiveMerchantId
    ? { ...auth, role: 'merchant' as const, id: effectiveMerchantId }
    : auth;
  const mapped = rows.map((row) => mapOrderRowWithSections(row, sectionsMap.get(String(row.id)) || [], viewAuth));

  if (paginated) {
    const total = (
      db.prepare(`SELECT COUNT(*) as c FROM orders o ${whereSql}`).get(...params) as { c: number }
    ).c;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      items: mapped,
      total,
      page,
      limit,
      total_pages: totalPages,
      has_more: offset + mapped.length < total,
    });
  }

  res.json(mapped);
});

app.get('/api/orders/:id/tracking', allowAnyUserOrGuest, (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              c.phone as captain_phone,
              c.availability_status as captain_availability,
              m.lat as merchant_lat,
              m.lng as merchant_lng
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       LEFT JOIN merchants m ON m.id = o.merchant_id
       WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'الطلب غير موجود' });
  const targetLat = Number(row.customer_lat || 31.1583);
  const targetLng = Number(row.customer_lng || 31.9369);
  const capLat = row.captain_lat !== null && row.captain_lat !== undefined ? Number(row.captain_lat) : null;
  const capLng = row.captain_lng !== null && row.captain_lng !== undefined ? Number(row.captain_lng) : null;
  const distanceKm = capLat !== null && capLng !== null ? haversineKm(capLat, capLng, targetLat, targetLng) : null;
  const etaMin = distanceKm !== null ? Math.max(2, Math.round(distanceKm * 3.5)) : null;
  const etaArrivalTime = etaMin !== null ? new Date(Date.now() + etaMin * 60000).toISOString() : null;

  const sections = getOrderStoreSections(id);
  const isMerchantCaller = req.auth?.role === 'merchant';
  if (isMerchantCaller) {
    const belongsToMerchant =
      String(row.merchant_id || '') === req.auth!.id || sections.some((s) => s.merchant_id === req.auth!.id);
    if (!belongsToMerchant) {
      return res.status(403).json({ error: 'غير مصرح لك بعرض طلب يخص متجرًا آخر' });
    }
  }
  const visibleSections = isMerchantCaller
    ? sections.filter((s) => s.merchant_id === req.auth!.id)
    : sections;
  const activeSections = visibleSections.filter((s) => s.prep_status !== 'cancelled');
  const pickedUpCount = activeSections.filter(
    (s) => Boolean(s.captain_picked_up_at) || s.prep_status === 'on_the_way' || s.prep_status === 'delivered'
  ).length;
  const storeSummary =
    visibleSections.length > 0
      ? {
          store_count: activeSections.length,
          picked_up_count: pickedUpCount,
          all_picked_up: activeSections.length > 0 && pickedUpCount === activeSections.length,
          stores: visibleSections,
        }
      : null;

  res.json({
    order: mapOrderRowWithSections(row, sections, req.auth),
    store_summary: storeSummary,
    captain_gps: capLat !== null && capLng !== null ? {
      lat: capLat,
      lng: capLng,
      updated_at: row.captain_location_updated_at ?? null,
      distance_km: distanceKm,
      eta_min: etaMin,
      eta_arrival_time: etaArrivalTime,
      vehicle_model: row.captain_vehicle_model ?? null,
      plate_number: row.captain_plate_number ?? null,
      phone: row.captain_phone ?? null,
    } : null,
  });
});

app.get('/api/orders/:id/chat', allowAnyUserOrGuest, (req, res) => {
  const { id } = req.params;
  const order = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              m.lat as merchant_lat,
              m.lng as merchant_lng
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       LEFT JOIN merchants m ON m.id = o.merchant_id
       WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const sections = getOrderStoreSections(id);
  const messages = db
    .prepare('SELECT * FROM order_chat_messages WHERE order_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(id) as Array<Record<string, unknown>>;
  const chatOrderAuth =
    req.auth?.role === 'merchant'
      ? req.auth
      : { ...req.auth!, role: 'super_admin' as const, permissions: ['*'] };
  res.json({
    order: mapOrderRowWithSections(order, sections, chatOrderAuth),
    messages: messages.map((m) => ({ ...m, is_delivery_proof: Boolean(m.is_delivery_proof) })),
  });
});

app.post('/api/orders/:id/chat', allowAnyUserOrGuest, (req, res) => {
  const { id } = req.params;
  const { message_text, image_url, is_delivery_proof, sender_role, sender_name } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

  const cleanText = String(message_text || '').trim();
  const cleanImg = image_url ? String(image_url) : null;
  if (!cleanText && !cleanImg) {
    return res.status(400).json({ error: 'أدخل رسالة أو أرفق صورة لإرسالها في الشات' });
  }

  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const requestedRole = String(sender_role || '').trim().toLowerCase();
  const validRequestedRole =
    requestedRole === 'customer' || requestedRole === 'captain' || requestedRole === 'admin' || requestedRole === 'merchant'
      ? requestedRole
      : null;

  const derivedSenderRole = validRequestedRole || (isAdmin ? 'admin' : auth.role || 'customer');
  const requestedName = String(sender_name || '').trim();
  let derivedSenderName = requestedName;
  if (!derivedSenderName) {
    if (derivedSenderRole === 'captain') {
      derivedSenderName = String(order.captain_name || auth.fullName || 'الكابتن').trim();
    } else if (derivedSenderRole === 'customer') {
      derivedSenderName = String(order.customer_name || auth.fullName || 'العميل').trim();
    } else if (derivedSenderRole === 'admin') {
      derivedSenderName = `الإدارة (${auth.fullName || 'المشرف'})`;
    } else {
      derivedSenderName = String(auth.fullName || 'مستخدم اطلبها').trim();
    }
  }

  const canAttachDeliveryProof = derivedSenderRole === 'captain' || auth.role === 'captain' || isAdmin;
  const isProof = Boolean(is_delivery_proof && cleanImg && canAttachDeliveryProof);

  const msgId = uid('msg');
  db.prepare(`
    INSERT INTO order_chat_messages (id, order_id, sender_role, sender_name, message_text, image_url, is_delivery_proof)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msgId,
    id,
    derivedSenderRole === 'admin' ? 'system' : derivedSenderRole,
    derivedSenderName,
    cleanText || (isProof ? 'تم تصوير الأوردر عند منزل العميل' : ''),
    cleanImg,
    isProof ? 1 : 0
  );

  let proofUrl = order.delivery_proof_image_url ? String(order.delivery_proof_image_url) : null;
  if (isProof && cleanImg) {
    db.prepare('UPDATE orders SET delivery_proof_image_url = ? WHERE id = ?').run(cleanImg, id);
    proofUrl = cleanImg;
    recordAuditLog({
      actor_name: derivedSenderName,
      actor_role: derivedSenderRole,
      action: 'ORDER_DELIVERY_PROOF_CAPTURED',
      entity_type: 'orders',
      entity_id: id,
      details: `التقاط وإرسال صورة الأوردر عند منزل العميل للطلب #${String(order.order_number)}`,
    });
  }

  const saved = db.prepare('SELECT * FROM order_chat_messages WHERE id = ?').get(msgId) as Record<string, unknown>;
  const msgObj = { ...saved, is_delivery_proof: Boolean(saved.is_delivery_proof) };
  broadcastOrderChat(id, {
    type: 'chat:message',
    order_id: id,
    message: msgObj,
    delivery_proof_image_url: proofUrl,
  });

  const ordNumChat = String(order.order_number || id);
  const previewText = (cleanText || (isProof ? 'تم إرفاق صورة إثبات التسليم عند المنزل' : 'صورة مرفقة')).slice(0, 140);
  if (derivedSenderRole !== 'customer' && order.customer_id) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(order.customer_id),
      category: 'operational',
      titleAr: `رسالة جديدة على الطلب #${ordNumChat}`,
      bodyAr: `${derivedSenderName}: ${previewText}`,
      deepLink: 'order_chat',
      orderId: id,
      channelId: 'otlobha_chat_channel',
      sentBy: derivedSenderName,
    });
  }
  if (derivedSenderRole !== 'captain' && order.captain_id) {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(order.captain_id),
      category: 'operational',
      titleAr: `رسالة من العميل على الطلب #${ordNumChat}`,
      bodyAr: `${derivedSenderName}: ${previewText}`,
      deepLink: 'order_chat',
      orderId: id,
      channelId: 'otlobha_chat_channel',
      sentBy: derivedSenderName,
    });
  }

  res.status(201).json({ message: msgObj, delivery_proof_image_url: proofUrl });
});

function allowAnyUserOrGuest(req: any, res: any, next: any) {
  const auth = optionalAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً للمتابعة' });
  }
  const headerCustId = String(req.headers['x-otlobha-customer-id'] || req.body?.customer_id || '').trim();
  if (headerCustId && (auth.role !== 'customer' || auth.id !== headerCustId)) {
    try {
      const custRow = db
        .prepare('SELECT id, full_name, phone, email, status FROM customers WHERE id = ?')
        .get(headerCustId) as { id: string; full_name: string; phone: string; email: string | null; status?: string } | undefined;
      if (custRow && (auth.id === custRow.id || isAdminAuth(auth))) {
        req.auth = {
          id: custRow.id,
          role: 'customer',
          sessionId: auth.sessionId || 'portal_ctx_customer',
          fullName: custRow.full_name,
          phone: custRow.phone,
          email: custRow.email,
          status: custRow.status || 'active',
          permissions: ['customer:self'],
          profile: {},
        };
        return next();
      }
    } catch {
      // ignore lookup error and use authenticated user context
    }
  }
  req.auth = auth;
  if (!req.auth.role) req.auth.role = 'customer';
  if (!req.auth.fullName) req.auth.fullName = req.auth.name || req.body?.customer_name || 'عميل اطلبها';
  next();
}

app.post('/api/orders', allowAnyUserOrGuest, (req, res) => {
  // If multi-store payload is provided, process as a unified bundle order
  if (Array.isArray(req.body?.stores) && req.body.stores.length > 0) {
    return handleBundleOrder(req, res);
  }

  // Auto-detect multi-store items if merchant_id is not specified
  const incomingRawItems = Array.isArray(req.body?.items) ? (req.body.items as Array<Record<string, unknown>>) : [];
  if (!req.body?.merchant_id && incomingRawItems.length > 0) {
    const storeMap = new Map<string, Array<Record<string, unknown>>>();
    for (const it of incomingRawItems) {
      const pId = it?.product_id ? String(it.product_id).trim() : null;
      let mId = it?.merchant_id ? String(it.merchant_id).trim() : null;
      if (!mId && pId) {
        const prod = db.prepare('SELECT merchant_id FROM products WHERE id = ?').get(pId) as { merchant_id?: string } | undefined;
        if (prod?.merchant_id) mId = prod.merchant_id;
      }
      if (mId) {
        if (!storeMap.has(mId)) storeMap.set(mId, []);
        storeMap.get(mId)!.push(it);
      }
    }
    if (storeMap.size > 1) {
      req.body.stores = Array.from(storeMap.entries()).map(([mId, items]) => ({
        merchant_id: mId,
        order_channel: req.body.order_channel || 'catalog',
        items,
      }));
      return handleBundleOrder(req, res);
    } else if (storeMap.size === 1) {
      req.body.merchant_id = Array.from(storeMap.keys())[0];
    }
  }

  const {
    customer_name,
    customer_phone,
    merchant_id,
    zone_id,
    address_landmark,
    order_channel,
    free_order_text,
    prescription_image_url,
    is_express,
    subtotal,
    coupon_code,
  } = req.body;
  const auth = req.auth!;
  const isAdminActor = isAdminAuth(auth);

  const allowedChannels = ['catalog', 'free_text', 'prescription'];
  const resolvedChannel = allowedChannels.includes(String(order_channel || ''))
    ? String(order_channel)
    : 'free_text';

  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(merchant_id) as Record<string, unknown> | undefined;
  const zone = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(zone_id) as Record<string, unknown> | undefined;
  if (!merchant || !zone) return res.status(400).json({ error: 'التاجر أو المنطقة غير صحيحة' });
  if (String(merchant.verification_status) !== 'approved') {
    return res.status(403).json({
      error: 'عذرًا، هذا المتجر قيد المراجعة ولم يتم اعتماده ونشره على المنصة من الإدارة بعد',
    });
  }

  const rawItems = Array.isArray(req.body.items) ? (req.body.items as Array<Record<string, unknown>>) : [];
  const sanitizedItems: Array<{
    id: string;
    product_id: string | null;
    name_ar: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    status: 'accepted';
    rejection_reason: string | null;
  }> = [];

  if (resolvedChannel === 'catalog') {
    for (let idx = 0; idx < rawItems.length; idx++) {
      const it = rawItems[idx];
      if (!it) continue;
      const rawQtyNum = Number(it.quantity ?? 1);
      const productId = it.product_id ? String(it.product_id).trim() : null;
      if (productId) {
        const product = db
          .prepare('SELECT id, merchant_id, name_ar, base_price, sale_price, is_available, is_weighted, weight_step, min_order_qty FROM products WHERE id = ?')
          .get(productId) as Record<string, unknown> | undefined;
        if (!product || String(product.merchant_id || '') !== String(merchant_id)) {
          return res.status(400).json({ error: 'أحد المنتجات المختارة غير موجود أو لا يتبع هذا المتجر' });
        }
        if (!Boolean(product.is_available)) {
          return res.status(400).json({ error: `المنتج "${String(product.name_ar)}" غير متوفر حاليًا` });
        }
        const isWeighted = Boolean(product.is_weighted);
        const weightStep = Math.max(0.05, Number(product.weight_step || 0.25));
        const minOrderQty = Math.max(isWeighted ? weightStep : 1, Number(product.min_order_qty || (isWeighted ? weightStep : 1)));
        const qty = isWeighted
          ? Math.max(minOrderQty, Math.round((Number.isFinite(rawQtyNum) && rawQtyNum > 0 ? rawQtyNum : weightStep) * 1000) / 1000)
          : Math.max(1, Math.floor(Number.isFinite(rawQtyNum) ? rawQtyNum : 1));
        const basePrice = Number(product.base_price || 0);
        const discPrice = product.sale_price !== null && product.sale_price !== undefined ? Number(product.sale_price) : null;
        const unitPrice = discPrice !== null && discPrice > 0 && discPrice < basePrice ? discPrice : basePrice;
        sanitizedItems.push({
          id: it.id ? String(it.id) : `item_${idx + 1}_${uid('it')}`,
          product_id: productId,
          name_ar: String(product.name_ar),
          quantity: qty,
          unit_price: unitPrice,
          total_price: Number((qty * unitPrice).toFixed(2)),
          status: 'accepted',
          rejection_reason: null,
        });
      } else if (isAdminActor && String(it.name_ar || '').trim()) {
        const qty = Math.max(0.05, Math.round((Number.isFinite(rawQtyNum) && rawQtyNum > 0 ? rawQtyNum : 1) * 1000) / 1000);
        const unitPrice = Math.max(0, Number(it.unit_price || 0));
        sanitizedItems.push({
          id: it.id ? String(it.id) : `item_${idx + 1}_${uid('it')}`,
          product_id: null,
          name_ar: String(it.name_ar).trim(),
          quantity: qty,
          unit_price: unitPrice,
          total_price: Number((qty * unitPrice).toFixed(2)),
          status: 'accepted',
          rejection_reason: null,
        });
      } else {
        return res.status(400).json({ error: 'يجب اختيار منتجات صالحة من كتالوج المتجر' });
      }
    }
    if (sanitizedItems.length === 0) {
      return res.status(400).json({ error: 'أضف منتجًا واحدًا على الأقل من المتجر' });
    }
  }

  const resolvedSubtotal =
    resolvedChannel === 'catalog'
      ? Number(sanitizedItems.reduce((sum, it) => sum + it.total_price, 0).toFixed(2))
      : isAdminActor
      ? Math.max(0, Number(subtotal || 0))
      : 0;

  const serviceType = merchant.merchant_type === 'pharmacy' ? 'pharmacy' : 'stores';
  const sim = calculateServicePrice({
    service_type: serviceType,
    zone_id,
    distance_km: zone.zone_type === 'city_core' ? 1.8 : 6.0,
    is_express: Boolean(is_express),
    basket_or_item_amount: resolvedSubtotal,
  });

  const isAdditionalStoreStop = Boolean(req.body.is_additional_store_stop);
  const effectiveDeliveryFee = isAdditionalStoreStop ? 5 : sim.delivery_or_fare_fee;
  const rawTotal = isAdditionalStoreStop ? resolvedSubtotal + 5 : sim.customer_total;

  let discountAmt = 0;
  let validatedCouponId: string | null = null;
  const cleanCouponCode = typeof coupon_code === 'string' ? coupon_code.trim().toUpperCase() : '';
  if (cleanCouponCode) {
    const coupon = db
      .prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1')
      .get(cleanCouponCode) as Record<string, unknown> | undefined;
    if (!coupon) {
      return res.status(400).json({ error: 'كود الخصم غير صالح أو غير مفعل' });
    }
    if (Number(coupon.used_count || 0) >= Number(coupon.usage_limit_total || 0)) {
      return res.status(400).json({ error: 'تم استنفاد الحد الأقصى لاستخدام كود الخصم' });
    }
    let applicableServices: string[] = [];
    try {
      const parsedSvc = JSON.parse(String(coupon.applicable_services_json || '[]'));
      if (Array.isArray(parsedSvc)) applicableServices = parsedSvc.map(String);
    } catch {
      applicableServices = [];
    }
    if (applicableServices.length > 0 && !applicableServices.includes(serviceType)) {
      return res.status(400).json({ error: 'كود الخصم غير مخصص لهذه الخدمة' });
    }
    const minOrderAmt = Number(coupon.min_order_amount || 0);
    if (resolvedSubtotal < minOrderAmt) {
      return res.status(400).json({ error: `الحد الأدنى لتطبيق الكود هو ${minOrderAmt} ج.م` });
    }
    const val = Number(coupon.discount_value || 0);
    if (coupon.discount_type === 'percentage' || coupon.discount_type === 'percent') {
      discountAmt = Number(((resolvedSubtotal * val) / 100).toFixed(2));
      const maxDisc = coupon.max_discount !== null && coupon.max_discount !== undefined ? Number(coupon.max_discount) : null;
      if (maxDisc !== null && maxDisc > 0) {
        discountAmt = Math.min(discountAmt, maxDisc);
      }
    } else {
      discountAmt = val;
    }
    discountAmt = Math.max(0, Math.min(rawTotal, Number(discountAmt.toFixed(2))));
    validatedCouponId = String(coupon.id);
  } else if (isAdminActor && req.body.discount_amount !== undefined) {
    discountAmt = Math.max(0, Math.min(rawTotal, Number(req.body.discount_amount || 0)));
  }

  const finalTotal = Math.max(0, Number((rawTotal - discountAmt).toFixed(2)));
  const id = uid('ord');
  const orderNum = `OTL-${Math.floor(1004 + Math.random() * 8900)}`;
  const initialStatus = resolvedChannel === 'free_text' || resolvedChannel === 'prescription' ? 'awaiting_quote' : 'pending_merchant';

  const customerLat = req.body.customer_lat !== undefined ? Number(req.body.customer_lat) : 31.1583;
  const customerLng = req.body.customer_lng !== undefined ? Number(req.body.customer_lng) : 31.9369;
  const resolvedLat = Number.isFinite(customerLat) ? customerLat : 31.1583;
  const resolvedLng = Number.isFinite(customerLng) ? customerLng : 31.9369;

  const explicitCustId = String(req.body.customer_id || req.headers['x-otlobha-customer-id'] || '').trim();
  const rawCustId = explicitCustId || (auth.role === 'customer' ? auth.id : null);
  let resolvedCustName = customer_name ? String(customer_name).trim() : '';
  let resolvedCustPhone = customer_phone ? String(customer_phone).trim() : '';
  let resolvedAddressLandmark = address_landmark ? String(address_landmark).trim() : '';

  if (rawCustId) {
    const custRow = db
      .prepare('SELECT full_name, phone, address_landmark FROM customers WHERE id = ?')
      .get(rawCustId) as { full_name?: string; phone?: string | null; address_landmark?: string | null } | undefined;
    if (custRow) {
      if (!resolvedCustName && custRow.full_name) resolvedCustName = String(custRow.full_name).trim();
      if (!resolvedCustPhone && custRow.phone) resolvedCustPhone = String(custRow.phone).trim();
      if (!resolvedAddressLandmark && custRow.address_landmark) {
        resolvedAddressLandmark = String(custRow.address_landmark).trim();
      }
    }
  }
  resolvedCustName = resolvedCustName || auth.fullName || 'عميل اطلبها';
  resolvedCustPhone = resolvedCustPhone || String(auth.profile?.phone || '');
  const finalAddressLandmark = resolvedAddressLandmark || 'وسط المنزلة';

  const rawPayment = String(req.body.payment_method || 'cash').trim().toLowerCase();
  const resolvedPaymentMethod = ['network', 'card', 'pos'].includes(rawPayment)
    ? 'network'
    : (rawPayment === 'wallet' ? 'wallet' : 'cash');

  const insertOrderTx = db.transaction(() => {
    if (validatedCouponId) {
      const couponRes = db
        .prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND is_active = 1 AND used_count < usage_limit_total')
        .run(validatedCouponId);
      if (couponRes.changes === 0) {
        throw new Error('COUPON_EXHAUSTED');
      }
    }

    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, merchant_id, merchant_name, merchant_type,
        zone_name, address_landmark, customer_lat, customer_lng, order_channel, free_order_text, items_json, is_express, status,
        subtotal, delivery_fee, discount_amount, total_amount, payment_method, prescription_status, prescription_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      orderNum,
      rawCustId,
      resolvedCustName,
      resolvedCustPhone,
      merchant_id,
      String(merchant.business_name_ar),
      String(merchant.merchant_type),
      String(zone.name_ar),
      finalAddressLandmark,
      resolvedLat,
      resolvedLng,
      resolvedChannel,
      free_order_text || null,
      JSON.stringify(sanitizedItems),
      is_express ? 1 : 0,
      initialStatus,
      resolvedSubtotal,
      effectiveDeliveryFee,
      discountAmt,
      finalTotal,
      resolvedPaymentMethod,
      merchant.merchant_type === 'pharmacy' ? 'pending' : null,
      prescription_image_url || null
    );

    db.prepare(`
      INSERT INTO order_stores (
        id, order_id, merchant_id, merchant_name, merchant_type, order_channel, items_json,
        free_order_text, prescription_image_url, subtotal, commission_rate, prep_status, sort_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      uid('ost'),
      id,
      merchant_id,
      String(merchant.business_name_ar),
      String(merchant.merchant_type),
      resolvedChannel,
      JSON.stringify(sanitizedItems),
      free_order_text || null,
      prescription_image_url || null,
      resolvedSubtotal,
      Number(merchant.commission_rate ?? 10),
      initialStatus
    );

    syncCustomerGpsSnapshot({
      customer_id: rawCustId,
      phone: resolvedCustPhone,
      full_name: resolvedCustName,
      lat: resolvedLat,
      lng: resolvedLng,
      address_landmark: finalAddressLandmark,
      default_zone_id: zone_id ? String(zone_id) : null,
    });

    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'ORDER_CREATED',
      entity_type: 'orders',
      entity_id: id,
      details: `إنشاء طلب جديد ${orderNum} لدى ${String(merchant.business_name_ar)} بقناة ${resolvedChannel}`,
    });
  });

  try {
    insertOrderTx();
  } catch (err) {
    if (err instanceof Error && err.message === 'COUPON_EXHAUSTED') {
      return res.status(409).json({ error: 'تم استنفاد الحد الأقصى لاستخدام كود الخصم' });
    }
    throw err;
  }

  broadcastOrderChat(id, {
    type: 'order:status',
    order_id: id,
    status: initialStatus,
  });

  if (rawCustId) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(zone.name_ar || 'all'),
      recipientId: rawCustId,
      category: 'operational',
      titleAr: `تم استلام طلبك #${orderNum}`,
      bodyAr: `طلبك من ${String(merchant.business_name_ar)} بقيمة ${finalTotal} ج.م قيد المتابعة والتجهيز الآن.`,
      deepLink: 'order',
      orderId: id,
      status: initialStatus,
      channelId: 'otlobha_orders_channel',
      sentBy: 'النظام',
    });
  }

  enqueueSystemPushNotification({
    targetApp: 'captain',
    targetZone: String(zone.name_ar || 'all'),
    category: 'operational',
    titleAr: `طلب جديد متاح #${orderNum}`,
    bodyAr: `طلب جديد بقيمة ${finalTotal} ج.م من ${String(merchant.business_name_ar)} متاح في ${String(zone.name_ar)}.`,
    deepLink: 'order',
    orderId: id,
    status: initialStatus,
    channelId: 'otlobha_dispatch_channel',
    sentBy: 'النظام',
  });

  if (merchant_id) {
    const storeItemCount = Array.isArray(sanitizedItems) ? sanitizedItems.length : 0;
    const merchantBody =
      storeItemCount > 0
        ? `وصلك طلب جديد (${storeItemCount} صنف) بقيمة ${resolvedSubtotal} ج.م من ${resolvedCustName} في ${String(zone.name_ar)}. افتح التطبيق لتجهيزه الآن.`
        : `وصلك طلب جديد${resolvedChannel === 'pharmacy_prescription' ? ' (روشتة)' : ''} من ${resolvedCustName} في ${String(zone.name_ar)}. افتح التطبيق لمراجعته وتجهيزه الآن.`;
    enqueueSystemPushNotification({
      targetApp: 'merchant',
      targetZone: String(zone.name_ar || 'all'),
      recipientId: String(merchant_id),
      category: 'operational',
      titleAr: `طلب جديد لمتجرك #${orderNum}`,
      bodyAr: merchantBody,
      deepLink: 'order',
      orderId: id,
      status: initialStatus,
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });
  }

  res.status(201).json({ id, order_number: orderNum });
});

function handleBundleOrder(req: express.Request, res: express.Response) {
  const {
    customer_name,
    customer_phone,
    zone_id,
    address_landmark,
    is_express,
    coupon_code,
    stores,
  } = req.body as {
    customer_name?: string;
    customer_phone?: string;
    zone_id?: string;
    address_landmark?: string;
    is_express?: boolean;
    coupon_code?: string;
    stores?: Array<{
      merchant_id: string;
      order_channel?: string;
      free_order_text?: string | null;
      prescription_image_url?: string | null;
      subtotal?: number;
      items?: Array<Record<string, unknown>>;
    }>;
  };

  const auth = req.auth!;
  const isAdminActor = isAdminAuth(auth);
  if (!Array.isArray(stores) || stores.length === 0) {
    return res.status(400).json({ error: 'أضف متجرًا واحدًا على الأقل لإتمام الطلب' });
  }
  const zone = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(zone_id) as Record<string, unknown> | undefined;
  if (!zone) return res.status(400).json({ error: 'المنطقة المحددة غير صحيحة' });

  const customerLat = req.body.customer_lat !== undefined ? Number(req.body.customer_lat) : 31.1583;
  const customerLng = req.body.customer_lng !== undefined ? Number(req.body.customer_lng) : 31.9369;
  const resolvedLat = Number.isFinite(customerLat) ? customerLat : 31.1583;
  const resolvedLng = Number.isFinite(customerLng) ? customerLng : 31.9369;

  const explicitCustId = String(req.body.customer_id || req.headers['x-otlobha-customer-id'] || '').trim();
  const rawCustId = explicitCustId || (auth.role === 'customer' ? auth.id : null);
  let resolvedCustName = customer_name ? String(customer_name).trim() : '';
  let resolvedCustPhone = customer_phone ? String(customer_phone).trim() : '';
  let resolvedAddressLandmark = address_landmark ? String(address_landmark).trim() : '';

  if (rawCustId) {
    const custRow = db
      .prepare('SELECT full_name, phone, address_landmark FROM customers WHERE id = ?')
      .get(rawCustId) as { full_name?: string; phone?: string | null; address_landmark?: string | null } | undefined;
    if (custRow) {
      if (!resolvedCustName && custRow.full_name) resolvedCustName = String(custRow.full_name).trim();
      if (!resolvedCustPhone && custRow.phone) resolvedCustPhone = String(custRow.phone).trim();
      if (!resolvedAddressLandmark && custRow.address_landmark) {
        resolvedAddressLandmark = String(custRow.address_landmark).trim();
      }
    }
  }
  resolvedCustName = resolvedCustName || auth.fullName || 'عميل اطلبها';
  resolvedCustPhone = resolvedCustPhone || String(auth.profile?.phone || '');
  const finalAddressLandmark = resolvedAddressLandmark || 'وسط المنزلة';

  const preparedStores: Array<{
    merchant: Record<string, unknown>;
    channel: string;
    initialStatus: string;
    sanitizedItems: Array<{
      id: string;
      product_id: string | null;
      name_ar: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      status: 'accepted';
      rejection_reason: string | null;
    }>;
    subtotal: number;
    deliveryFee: number;
    freeOrderText: string | null;
    prescriptionImageUrl: string | null;
  }> = [];

  for (let sIdx = 0; sIdx < stores.length; sIdx++) {
    const st = stores[sIdx];
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(st.merchant_id) as
      | Record<string, unknown>
      | undefined;
    if (!merchant) {
      return res.status(400).json({ error: 'أحد المتاجر المختارة غير موجود' });
    }
    if (String(merchant.verification_status) !== 'approved') {
      return res.status(403).json({
        error: `المتجر "${String(merchant.business_name_ar)}" قيد المراجعة ولم يتم اعتماده بعد`,
      });
    }
    const allowedChannels = ['catalog', 'free_text', 'prescription'];
    const resolvedChannel = allowedChannels.includes(String(st.order_channel || 'catalog'))
      ? String(st.order_channel || 'catalog')
      : 'catalog';

    const rawItems = Array.isArray(st.items) ? st.items : [];
    const sanitizedItems: Array<{
      id: string;
      product_id: string | null;
      name_ar: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      status: 'accepted';
      rejection_reason: string | null;
    }> = [];

    if (resolvedChannel === 'catalog') {
      for (let idx = 0; idx < rawItems.length; idx++) {
        const it = rawItems[idx];
        if (!it) continue;
        const rawQtyNum = Number(it.quantity ?? 1);
        const productId = it.product_id ? String(it.product_id).trim() : null;
        if (productId) {
          const product = db
            .prepare('SELECT id, merchant_id, name_ar, base_price, sale_price, is_available, is_weighted, weight_step, min_order_qty FROM products WHERE id = ?')
            .get(productId) as Record<string, unknown> | undefined;
          if (!product || String(product.merchant_id || '') !== String(st.merchant_id)) {
            return res.status(400).json({ error: 'أحد المنتجات المختارة غير موجود أو لا يتبع هذا المتجر' });
          }
          if (!Boolean(product.is_available)) {
            return res.status(400).json({ error: `المنتج "${String(product.name_ar)}" غير متوفر حاليًا` });
          }
          const isWeighted = Boolean(product.is_weighted);
          const weightStep = Math.max(0.05, Number(product.weight_step || 0.25));
          const minOrderQty = Math.max(isWeighted ? weightStep : 1, Number(product.min_order_qty || (isWeighted ? weightStep : 1)));
          const qty = isWeighted
            ? Math.max(minOrderQty, Math.round((Number.isFinite(rawQtyNum) && rawQtyNum > 0 ? rawQtyNum : weightStep) * 1000) / 1000)
            : Math.max(1, Math.floor(Number.isFinite(rawQtyNum) ? rawQtyNum : 1));
          const basePrice = Number(product.base_price || 0);
          const discPrice = product.sale_price !== null && product.sale_price !== undefined ? Number(product.sale_price) : null;
          const unitPrice = discPrice !== null && discPrice > 0 && discPrice < basePrice ? discPrice : basePrice;
          sanitizedItems.push({
            id: it.id ? String(it.id) : `item_${idx + 1}_${uid('it')}`,
            product_id: productId,
            name_ar: String(product.name_ar),
            quantity: qty,
            unit_price: unitPrice,
            total_price: Number((qty * unitPrice).toFixed(2)),
            status: 'accepted',
            rejection_reason: null,
          });
        } else if (isAdminActor && String(it.name_ar || '').trim()) {
          const qty = Math.max(0.05, Math.round((Number.isFinite(rawQtyNum) && rawQtyNum > 0 ? rawQtyNum : 1) * 1000) / 1000);
          const unitPrice = Math.max(0, Number(it.unit_price || 0));
          sanitizedItems.push({
            id: it.id ? String(it.id) : `item_${idx + 1}_${uid('it')}`,
            product_id: null,
            name_ar: String(it.name_ar).trim(),
            quantity: qty,
            unit_price: unitPrice,
            total_price: Number((qty * unitPrice).toFixed(2)),
            status: 'accepted',
            rejection_reason: null,
          });
        } else {
          return res.status(400).json({ error: 'يجب اختيار منتجات صالحة من كتالوج المتجر' });
        }
      }
      if (sanitizedItems.length === 0) {
        return res.status(400).json({ error: `أضف منتجًا واحدًا على الأقل من متجر "${String(merchant.business_name_ar)}"` });
      }
    }

    const storeSubtotal =
      resolvedChannel === 'catalog'
        ? Number(sanitizedItems.reduce((sum, it) => sum + it.total_price, 0).toFixed(2))
        : isAdminActor
        ? Math.max(0, Number(st.subtotal || 0))
        : 0;

    const serviceType = merchant.merchant_type === 'pharmacy' ? 'pharmacy' : 'stores';
    const sim = calculateServicePrice({
      service_type: serviceType,
      zone_id: String(zone_id),
      distance_km: zone.zone_type === 'city_core' ? 1.8 : 6.0,
      is_express: Boolean(is_express),
      basket_or_item_amount: storeSubtotal,
    });
    const deliveryFee = sIdx === 0 ? sim.delivery_or_fare_fee : 5;
    const initialStatus =
      resolvedChannel === 'free_text' || resolvedChannel === 'prescription' ? 'awaiting_quote' : 'pending_merchant';

    preparedStores.push({
      merchant,
      channel: resolvedChannel,
      initialStatus,
      sanitizedItems,
      subtotal: storeSubtotal,
      deliveryFee,
      freeOrderText:
        st.free_order_text ||
        (sanitizedItems.length > 0 ? sanitizedItems.map((it) => `${it.name_ar} × ${it.quantity}`).join(' + ') : null),
      prescriptionImageUrl: st.prescription_image_url || null,
    });
  }

  const combinedSubtotal = Number(preparedStores.reduce((s, p) => s + p.subtotal, 0).toFixed(2));
  const combinedRawTotal = Number(preparedStores.reduce((s, p) => s + p.subtotal + p.deliveryFee, 0).toFixed(2));

  let totalDiscount = 0;
  let validatedCouponId: string | null = null;
  const cleanCouponCode = typeof coupon_code === 'string' ? coupon_code.trim().toUpperCase() : '';
  if (cleanCouponCode) {
    const coupon = db
      .prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1')
      .get(cleanCouponCode) as Record<string, unknown> | undefined;
    if (!coupon) {
      return res.status(400).json({ error: 'كود الخصم غير صالح أو غير مفعل' });
    }
    if (Number(coupon.used_count || 0) >= Number(coupon.usage_limit_total || 0)) {
      return res.status(400).json({ error: 'تم استنفاد الحد الأقصى لاستخدام كود الخصم' });
    }
    const minOrderAmt = Number(coupon.min_order_amount || 0);
    if (combinedSubtotal < minOrderAmt) {
      return res.status(400).json({ error: `الحد الأدنى لتطبيق الكود هو ${minOrderAmt} ج.م` });
    }
    const val = Number(coupon.discount_value || 0);
    if (coupon.discount_type === 'percentage' || coupon.discount_type === 'percent') {
      totalDiscount = Number(((combinedSubtotal * val) / 100).toFixed(2));
      const maxDisc = coupon.max_discount !== null && coupon.max_discount !== undefined ? Number(coupon.max_discount) : null;
      if (maxDisc !== null && maxDisc > 0) {
        totalDiscount = Math.min(totalDiscount, maxDisc);
      }
    } else {
      totalDiscount = val;
    }
    totalDiscount = Math.max(0, Math.min(combinedRawTotal, Number(totalDiscount.toFixed(2))));
    validatedCouponId = String(coupon.id);
  }

  const isMultiStore = preparedStores.length > 1;
  const combinedDeliveryFee = Number(preparedStores.reduce((s, p) => s + p.deliveryFee, 0).toFixed(2));
  const combinedFinalTotal = Math.max(0, Number((combinedRawTotal - totalDiscount).toFixed(2)));

  // Pick anchor store (most item quantities, tie-break max subtotal)
  let anchorStore = preparedStores[0];
  let bestQty = -1;
  let bestSub = -1;
  for (const p of preparedStores) {
    const q =
      p.sanitizedItems.length > 0
        ? p.sanitizedItems.reduce((sum, it) => sum + Math.max(1, Number(it.quantity || 1)), 0)
        : 1;
    if (q > bestQty || (q === bestQty && p.subtotal > bestSub)) {
      anchorStore = p;
      bestQty = q;
      bestSub = p.subtotal;
    }
  }

  const orderId = uid('ord');
  const orderNum = `OTL-${Math.floor(1004 + Math.random() * 8900)}`;
  const unifiedItems = preparedStores.flatMap((p) =>
    p.sanitizedItems.map((it) => ({
      ...it,
      merchant_id: String(p.merchant.id),
      merchant_name: String(p.merchant.business_name_ar),
    }))
  );
  const combinedFreeText = isMultiStore
    ? preparedStores
        .map((p) => `${String(p.merchant.business_name_ar)}: ${p.freeOrderText || ''}`)
        .filter(Boolean)
        .join(' | ')
    : preparedStores[0].freeOrderText;
  const unifiedStatus = preparedStores.some((p) => p.initialStatus === 'awaiting_quote')
    ? 'awaiting_quote'
    : 'pending_merchant';
  const unifiedChannel = preparedStores.every((p) => p.channel === preparedStores[0].channel)
    ? preparedStores[0].channel
    : 'catalog';
  const anyPrescriptionImg = preparedStores.find((p) => p.prescriptionImageUrl)?.prescriptionImageUrl || null;
  const anyPharmacy = preparedStores.some((p) => String(p.merchant.merchant_type) === 'pharmacy');
  const headerMerchantName = isMultiStore
    ? `طلب من ${preparedStores.length} متاجر (${preparedStores.map((p) => String(p.merchant.business_name_ar)).join(' + ')})`
    : String(anchorStore.merchant.business_name_ar);

  const rawPayment = String(req.body.payment_method || 'cash').trim().toLowerCase();
  const resolvedPaymentMethod = ['network', 'card', 'pos'].includes(rawPayment)
    ? 'network'
    : (rawPayment === 'wallet' ? 'wallet' : 'cash');

  const bundleTx = db.transaction(() => {
    if (validatedCouponId) {
      const couponRes = db
        .prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND is_active = 1 AND used_count < usage_limit_total')
        .run(validatedCouponId);
      if (couponRes.changes === 0) {
        throw new Error('COUPON_EXHAUSTED');
      }
    }

    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, merchant_id, merchant_name, merchant_type,
        zone_name, address_landmark, customer_lat, customer_lng, order_channel, free_order_text, items_json, is_express, status,
        subtotal, delivery_fee, discount_amount, total_amount, payment_method, prescription_status, prescription_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orderNum,
      rawCustId,
      resolvedCustName,
      resolvedCustPhone,
      String(anchorStore.merchant.id),
      headerMerchantName,
      String(anchorStore.merchant.merchant_type),
      String(zone.name_ar),
      finalAddressLandmark,
      resolvedLat,
      resolvedLng,
      unifiedChannel,
      combinedFreeText,
      JSON.stringify(unifiedItems),
      is_express ? 1 : 0,
      unifiedStatus,
      combinedSubtotal,
      combinedDeliveryFee,
      totalDiscount,
      combinedFinalTotal,
      resolvedPaymentMethod,
      anyPharmacy ? 'pending' : null,
      anyPrescriptionImg
    );

    for (let sIdx = 0; sIdx < preparedStores.length; sIdx++) {
      const p = preparedStores[sIdx];
      db.prepare(`
        INSERT INTO order_stores (
          id, order_id, merchant_id, merchant_name, merchant_type, order_channel, items_json,
          free_order_text, prescription_image_url, subtotal, commission_rate, prep_status, sort_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid('ost'),
        orderId,
        String(p.merchant.id),
        String(p.merchant.business_name_ar),
        String(p.merchant.merchant_type),
        p.channel,
        JSON.stringify(p.sanitizedItems),
        p.freeOrderText,
        p.prescriptionImageUrl,
        p.subtotal,
        Number(p.merchant.commission_rate ?? 10),
        p.initialStatus,
        sIdx
      );
    }

    syncCustomerGpsSnapshot({
      customer_id: rawCustId,
      phone: resolvedCustPhone,
      full_name: resolvedCustName,
      lat: resolvedLat,
      lng: resolvedLng,
      address_landmark: finalAddressLandmark,
      default_zone_id: zone_id ? String(zone_id) : null,
    });

    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: isMultiStore ? 'MULTI_STORE_ORDER_CREATED' : 'ORDER_CREATED',
      entity_type: 'orders',
      entity_id: orderId,
      details: isMultiStore
        ? `إنشاء طلب واحد مقسم #${orderNum} عبر ${preparedStores.length} متاجر (${preparedStores.map((c) => String(c.merchant.business_name_ar)).join(' + ')})`
        : `إنشاء طلب جديد ${orderNum} لدى ${String(anchorStore.merchant.business_name_ar)}`,
    });
  });

  try {
    bundleTx();
  } catch (err) {
    if (err instanceof Error && err.message === 'COUPON_EXHAUSTED') {
      return res.status(409).json({ error: 'تم استنفاد الحد الأقصى لاستخدام كود الخصم' });
    }
    throw err;
  }

  const createdRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown>;
  const createdSections = getOrderStoreSections(orderId);
  const mappedOrder = mapOrderRowWithSections(createdRow, createdSections, auth);

  broadcastOrderChat(orderId, {
    type: 'order:status',
    order_id: orderId,
    status: unifiedStatus,
  });

  if (rawCustId) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(zone.name_ar || 'all'),
      recipientId: rawCustId,
      category: 'operational',
      titleAr: `تم استلام طلبك #${orderNum}`,
      bodyAr: isMultiStore
        ? `طلبك المقسم (${preparedStores.length} متاجر) بقيمة ${combinedFinalTotal} ج.م قيد المتابعة والتجهيز الآن.`
        : `طلبك من ${String(anchorStore.merchant.business_name_ar)} بقيمة ${combinedFinalTotal} ج.م قيد المتابعة والتجهيز الآن.`,
      deepLink: 'order',
      orderId: orderId,
      status: unifiedStatus,
      channelId: 'otlobha_orders_channel',
      sentBy: 'النظام',
    });
  }

  enqueueSystemPushNotification({
    targetApp: 'captain',
    targetZone: String(zone.name_ar || 'all'),
    category: 'operational',
    titleAr: isMultiStore ? `طلب مقسم متاح #${orderNum}` : `طلب جديد متاح #${orderNum}`,
    bodyAr: isMultiStore
      ? `طلب مقسم (${preparedStores.length} متاجر) بقيمة ${combinedFinalTotal} ج.م متاح للكباتن في ${String(zone.name_ar)}.`
      : `طلب جديد بقيمة ${combinedFinalTotal} ج.م من ${String(anchorStore.merchant.business_name_ar)} متاح في ${String(zone.name_ar)}.`,
    deepLink: 'order',
    orderId: orderId,
    status: unifiedStatus,
    channelId: 'otlobha_dispatch_channel',
    sentBy: 'النظام',
  });

  // Notify EACH merchant separately with ONLY their own isolated items count & subtotal (never leaking other stores' items/totals)
  for (const p of preparedStores) {
    const storeMerchantId = String(p.merchant.id || '').trim();
    if (!storeMerchantId) continue;
    const myItemsCount = Array.isArray(p.sanitizedItems) ? p.sanitizedItems.length : 0;
    const storeBody =
      myItemsCount > 0
        ? `وصلك طلب جديد (${myItemsCount} صنف) بقيمة ${p.subtotal} ج.م من ${resolvedCustName} في ${String(zone.name_ar)}. افتح التطبيق لتجهيز أصناف متجرك.`
        : `وصلك طلب جديد${p.channel === 'pharmacy_prescription' || p.channel === 'prescription' ? ' (روشتة)' : ''} من ${resolvedCustName} في ${String(zone.name_ar)}. افتح التطبيق لمراجعة طلب متجرك.`;
    enqueueSystemPushNotification({
      targetApp: 'merchant',
      targetZone: String(zone.name_ar || 'all'),
      recipientId: storeMerchantId,
      category: 'operational',
      titleAr: `طلب جديد لمتجرك #${orderNum}`,
      bodyAr: storeBody,
      deepLink: 'order',
      orderId: orderId,
      status: p.initialStatus,
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });
  }

  res.status(201).json({
    ok: true,
    id: orderId,
    order_number: orderNum,
    store_count: preparedStores.length,
    order: mappedOrder,
    orders: [mappedOrder],
  });
}

app.post('/api/orders/bundle', allowAnyUserOrGuest, handleBundleOrder);

app.patch(
  '/api/orders/:id/merchant-action',
  requireAuth,
  requireRole('merchant', ...ALL_ADMIN_ROLES),
  requireOwnership(
    (req) => {
      const ord = db.prepare('SELECT id, merchant_id FROM orders WHERE id = ?').get(req.params.id) as
        | { id: string; merchant_id?: string }
        | undefined;
      if (!ord) return null;
      if (req.auth && req.auth.role === 'merchant') {
        const sec = db
          .prepare('SELECT merchant_id FROM order_stores WHERE order_id = ? AND merchant_id = ? LIMIT 1')
          .get(ord.id, req.auth.id) as { merchant_id?: string } | undefined;
        if (sec?.merchant_id) return sec.merchant_id;
      }
      return ord.merchant_id || null;
    },
    { allowRoles: [...ALL_ADMIN_ROLES], notFoundMessage: 'الطلب غير موجود' }
  ),
  (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const isAdminActor = isAdminAuth(auth);
  const {
    action,
    merchant_id,
    status,
    subtotal,
    pharmacist_notes,
    substitution_note,
    prescription_status,
    assign_best_captain,
    captain_id,
    rejected_items,
    rejection_reason,
  } = req.body as {
    action?: 'reject_items' | 'reject_invoice' | 'ready' | 'quote' | 'deliver';
    merchant_id?: string;
    status?: string;
    subtotal?: number;
    pharmacist_notes?: string;
    substitution_note?: string;
    prescription_status?: string;
    assign_best_captain?: boolean;
    captain_id?: string | null;
    rejected_items?: Array<{ item_id: string; reason: string }>;
    rejection_reason?: string;
  };
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

  if (!isAdminActor && merchant_id && String(merchant_id) !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل طلب يخص متجرًا آخر' });
  }

  const sections = getOrderStoreSections(id);
  const targetMerchantId = isAdminActor
    ? merchant_id
      ? String(merchant_id)
      : String(order.merchant_id)
    : auth.id;

  // Full order delivery by admin/single merchant
  if (action === 'deliver' || status === 'delivered') {
    const nextCaptainId = order.captain_id ? String(order.captain_id) : null;
    const nextCaptainName = order.captain_name ? String(order.captain_name) : null;
    const orderTotal = Number(order.total_amount || 0);
    db.transaction(() => {
      db.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").run(id);
      if (sections.length > 0) {
        db.prepare(
          "UPDATE order_stores SET prep_status = 'delivered', captain_picked_up_at = COALESCE(captain_picked_up_at, datetime('now')) WHERE order_id = ? AND prep_status != 'cancelled'"
        ).run(id);
      }
    })();

    if (nextCaptainId && nextCaptainName) {
      createPendingCaptainRating({
        captain_id: nextCaptainId,
        captain_name: nextCaptainName,
        customer_id: order.customer_id ? String(order.customer_id) : null,
        customer_name: String(order.customer_name || 'عميل اطلبها'),
        customer_phone: order.customer_phone ? String(order.customer_phone) : null,
        ref_type: 'order',
        ref_id: id,
        ref_number: String(order.order_number),
        final_amount: orderTotal,
      });
    }

    const activeSections = sections.filter((s) => s.prep_status !== 'cancelled');
    if (activeSections.length > 0) {
      for (const sec of activeSections) {
        if (sec.subtotal > 0) {
          const commAmt = Number(((sec.subtotal * sec.commission_rate) / 100).toFixed(2));
          if (commAmt > 0) {
            postDoubleEntryLedger({
              idempotency_base: `order_delivered_comm_${id}_${sec.merchant_id}`,
              reference_type: 'order',
              reference_id: id,
              description_ar: `تحصيل عمولة طلب مكتمل #${String(order.order_number)} (${sec.merchant_name} - ${sec.commission_rate}%)`,
              debit_account_code: `CASH_CAPTAIN_${nextCaptainId ?? 'UNASSIGNED'}`,
              debit_account_type: 'cash_clearing',
              credit_account_code: 'PLATFORM_REVENUE_STORES',
              credit_account_type: 'platform_revenue',
              amount: commAmt,
            });
          }
        }
      }
    } else if (Number(order.subtotal || 0) > 0) {
      const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(order.merchant_id) as Record<string, unknown>;
      const commRate = Number(merchant?.commission_rate ?? 5);
      const commAmt = Number(((Number(order.subtotal || 0) * commRate) / 100).toFixed(2));
      if (commAmt > 0) {
        postDoubleEntryLedger({
          idempotency_base: `order_delivered_comm_${id}`,
          reference_type: 'order',
          reference_id: id,
          description_ar: `تحصيل عمولة طلب مكتمل #${String(order.order_number)} (${commRate}%)`,
          debit_account_code: `CASH_CAPTAIN_${nextCaptainId ?? 'UNASSIGNED'}`,
          debit_account_type: 'cash_clearing',
          credit_account_code: 'PLATFORM_REVENUE_STORES',
          credit_account_type: 'platform_revenue',
          amount: commAmt,
        });
      }
    }

    broadcastOrderChat(id, { type: 'order:status', order_id: id, status: 'delivered' });
    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'ORDER_MERCHANT_UPDATED',
      entity_type: 'orders',
      entity_id: id,
      details: `تسليم الطلب #${String(order.order_number)} وترحيل العمولات`,
    });

    const deliveredOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    return res.json({
      ok: true,
      assigned_captain: nextCaptainName,
      order: mapOrderRowWithSections(deliveredOrder, getOrderStoreSections(id), auth),
    });
  }

  // Normalized order_stores section workflow (supports 1 or N stores inside 1 order)
  if (sections.length > 0) {
    const targetSec = sections.find((s) => s.merchant_id === targetMerchantId);
    if (!targetSec) {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل طلب يخص متجرًا آخر' });
    }

    let secItems = (Array.isArray(targetSec.items) ? targetSec.items : []) as Array<{
      id: string;
      product_id?: string | null;
      name_ar: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      status: 'accepted' | 'rejected';
      rejection_reason?: string | null;
    }>;

    const acceptedSecSum = Number(
      secItems
        .filter((it) => it.status !== 'rejected')
        .reduce((sum, it) => sum + Number(it.total_price || 0), 0)
        .toFixed(2)
    );
    const hasItemizedCatalog = secItems.length > 0;
    const parsedSubtotal =
      subtotal !== undefined && Number.isFinite(Number(subtotal)) && Number(subtotal) >= 0
        ? Number(Number(subtotal).toFixed(2))
        : null;

    // Never allow client-supplied subtotal to overwrite or inflate itemized catalog sections.
    let nextSecSubtotal = hasItemizedCatalog
      ? acceptedSecSum
      : parsedSubtotal !== null
      ? parsedSubtotal
      : Number(targetSec.subtotal || 0);
    let nextSecStatus = status ?? targetSec.prep_status;
    let nextSecSubNote = substitution_note !== undefined ? substitution_note : targetSec.substitution_note;
    let nextSecRejectReason = targetSec.rejection_reason;
    let nextSecReadyAt = targetSec.ready_at;
    let notifyTitle = '';
    let notifyBody = '';

    if (action === 'reject_items') {
      const rejList = Array.isArray(rejected_items) ? rejected_items : [];
      if (rejList.length === 0) {
        return res.status(400).json({ error: 'اختر صنفًا واحدًا على الأقل لرفضه' });
      }
      for (const r of rejList) {
        if (!r || !String(r.item_id || '').trim() || !String(r.reason || '').trim()) {
          return res.status(400).json({ error: 'يجب كتابة سبب رفض كل صنف تم تحديده للرفض' });
        }
      }
      const rejMap = new Map(rejList.map((r) => [String(r.item_id), String(r.reason).trim()]));
      secItems = secItems.map((it) => {
        const reasonText = rejMap.get(String(it.id));
        if (reasonText) {
          return { ...it, status: 'rejected' as const, rejection_reason: reasonText };
        }
        return it;
      });

      const acceptedItems = secItems.filter((it) => it.status !== 'rejected');
      const rejectedSummary = secItems
        .filter((it) => it.status === 'rejected')
        .map((it) => `${it.name_ar} (${it.rejection_reason || 'غير متوفر'})`)
        .join('، ');

      if (acceptedItems.length === 0) {
        nextSecSubtotal = 0;
        nextSecStatus = 'cancelled';
        nextSecRejectReason = `تم رفض جميع أصناف ${targetSec.merchant_name}: ${rejectedSummary}`;
        nextSecSubNote = nextSecRejectReason;
        notifyTitle = `تحديث قسم ${targetSec.merchant_name} بالطلب #${String(order.order_number)}`;
        notifyBody = nextSecRejectReason;
      } else {
        nextSecSubtotal = Number(acceptedItems.reduce((sum, it) => sum + Number(it.total_price || 0), 0).toFixed(2));
        if (nextSecStatus === 'pending_merchant' || nextSecStatus === 'awaiting_quote') {
          nextSecStatus = 'preparing';
        }
        nextSecSubNote = `تم رفض الأصناف التالية من ${targetSec.merchant_name}: ${rejectedSummary}`;
        notifyTitle = `تحديث فاتورة الطلب #${String(order.order_number)}`;
        notifyBody = `${nextSecSubNote} — إجمالي القسم بعد التعديل: ${nextSecSubtotal} ج.م`;
      }
    } else if (action === 'reject_invoice' || nextSecStatus === 'cancelled') {
      const cleanReason = String(rejection_reason || '').trim();
      if (!cleanReason) {
        return res.status(400).json({ error: 'يجب كتابة سبب رفض/إلغاء الفاتورة بالكامل' });
      }
      nextSecStatus = 'cancelled';
      nextSecRejectReason = cleanReason;
      nextSecSubNote = cleanReason;
      nextSecSubtotal = 0;
      secItems = secItems.map((it) => ({
        ...it,
        status: 'rejected' as const,
        rejection_reason: it.rejection_reason || cleanReason,
      }));
      notifyTitle = `اعتذار متجر ${targetSec.merchant_name} بالطلب #${String(order.order_number)}`;
      notifyBody = `السبب: ${cleanReason}`;
    } else if (action === 'ready' || nextSecStatus === 'ready_for_pickup') {
      const wasAlreadyReady = targetSec.prep_status === 'ready_for_pickup';
      nextSecStatus = 'ready_for_pickup';
      nextSecReadyAt = targetSec.ready_at || new Date().toISOString();
      if (!wasAlreadyReady) {
        notifyTitle = `تجهيز قسم ${targetSec.merchant_name} بالطلب #${String(order.order_number)}`;
        notifyBody = `أعلن متجر ${targetSec.merchant_name} أن طلباته جاهزة الآن للاستلام.`;
      }
    }

    let captainId = order.captain_id ? String(order.captain_id) : null;
    let captainName = order.captain_name ? String(order.captain_name) : null;
    if (isAdminActor && (captain_id === null || captain_id === '')) {
      captainId = null;
      captainName = null;
    } else if (isAdminActor && typeof captain_id === 'string' && captain_id.trim()) {
      const cap = db
        .prepare('SELECT id, full_name, verification_status FROM captains WHERE id = ?')
        .get(captain_id.trim()) as { id: string; full_name: string; verification_status?: string } | undefined;
      if (!cap) return res.status(404).json({ error: 'الطيار المختار غير موجود' });
      if (cap.verification_status !== 'approved') {
        return res.status(400).json({ error: 'لا يمكن إسناد الطلب لطيار غير معتمد' });
      }
      captainId = cap.id;
      captainName = cap.full_name;
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE order_stores SET
          prep_status = ?, subtotal = ?, pharmacist_notes = ?, substitution_note = ?,
          items_json = ?, rejection_reason = ?, ready_at = ?
        WHERE id = ?
      `).run(
        nextSecStatus,
        nextSecSubtotal,
        pharmacist_notes !== undefined ? pharmacist_notes : targetSec.pharmacist_notes,
        nextSecSubNote,
        JSON.stringify(secItems),
        nextSecRejectReason,
        nextSecReadyAt,
        targetSec.id
      );

      const refreshedSections = getOrderStoreSections(id);
      const activeSecs = refreshedSections.filter((s) => s.prep_status !== 'cancelled');
      const combinedSub = Number(activeSecs.reduce((sum, s) => sum + Number(s.subtotal || 0), 0).toFixed(2));
      const deliveryFee = Number(order.delivery_fee || 0);
      const discount = Number(order.discount_amount || 0);
      const combinedTotal =
        activeSecs.length === 0 ? 0 : Math.max(0, Number((combinedSub + deliveryFee - discount).toFixed(2)));
      const combinedItems = refreshedSections.flatMap((s) =>
        s.items.map((it) => ({ ...it, merchant_id: s.merchant_id, merchant_name: s.merchant_name }))
      );

      db.prepare(`
        UPDATE orders SET
          subtotal = ?, total_amount = ?, items_json = ?,
          pharmacist_notes = COALESCE(?, pharmacist_notes),
          substitution_note = COALESCE(?, substitution_note),
          prescription_status = ?,
          captain_id = ?, captain_name = ?
        WHERE id = ?
      `).run(
        combinedSub,
        combinedTotal,
        JSON.stringify(combinedItems),
        pharmacist_notes !== undefined ? pharmacist_notes : null,
        nextSecSubNote,
        prescription_status !== undefined ? prescription_status : order.prescription_status,
        captainId,
        captainName,
        id
      );
    })();

    const reconcileRes = reconcileAndDispatchSingleOrder(id);
    if (reconcileRes.captain_name) {
      captainId = reconcileRes.captain_id ?? captainId;
      captainName = reconcileRes.captain_name;
    }

    if (notifyTitle && notifyBody) {
      enqueueSystemPushNotification({
        targetApp: 'customer',
        targetZone: String(order.zone_name || 'all'),
        recipientId: order.customer_id ? String(order.customer_id) : null,
        category: nextSecStatus === 'cancelled' ? 'alert' : 'operational',
        titleAr: notifyTitle,
        bodyAr: notifyBody,
        deepLink: 'order',
        orderId: id,
        status: nextSecStatus,
        channelId: 'otlobha_orders_channel',
        sentBy: targetSec.merchant_name,
      });
    }

    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: nextSecStatus === 'cancelled' ? 'ORDER_REJECTED_BY_MERCHANT' : 'ORDER_MERCHANT_UPDATED',
      entity_type: 'orders',
      entity_id: id,
      reason: nextSecRejectReason ?? null,
      details: `تحديث متجر (${targetSec.merchant_name}) في الطلب #${String(order.order_number)}: الحالة ${nextSecStatus}، قيمة القسم ${nextSecSubtotal} ج.م${captainName ? `، الطيار: ${captainName}` : ''}`,
    });

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    return res.json({
      ok: true,
      assigned_captain: captainName,
      order: mapOrderRowWithSections(updatedOrder, getOrderStoreSections(id), auth),
    });
  }

  // Fallback for legacy single-store orders without order_stores rows
  if (merchant_id && String(order.merchant_id) !== String(merchant_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل طلب يخص متجرًا آخر' });
  }

  let items = parseOrderItems(order.items_json) as Array<{
    id: string;
    product_id?: string | null;
    name_ar: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    status: 'accepted' | 'rejected';
    rejection_reason?: string | null;
  }>;

  const legacyAcceptedSum = Number(
    items
      .filter((it) => it.status !== 'rejected')
      .reduce((sum, it) => sum + Number(it.total_price || 0), 0)
      .toFixed(2)
  );
  const legacyHasItemizedCatalog = items.length > 0;
  const legacyParsedSubtotal =
    subtotal !== undefined && Number.isFinite(Number(subtotal)) && Number(subtotal) >= 0
      ? Number(Number(subtotal).toFixed(2))
      : null;

  let nextSubtotal = legacyHasItemizedCatalog
    ? legacyAcceptedSum
    : legacyParsedSubtotal !== null
    ? legacyParsedSubtotal
    : Number(order.subtotal || 0);
  const deliveryFee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);
  let nextTotal = Math.max(0, Number((nextSubtotal + deliveryFee - discount).toFixed(2)));
  let nextStatus = status ?? String(order.status);
  let nextSubNote = substitution_note !== undefined ? substitution_note : (order.substitution_note as string | null);
  let nextRejectReason = order.rejection_reason ? String(order.rejection_reason) : null;
  let nextReadyAt = order.ready_at ? String(order.ready_at) : null;
  let notifyTitle = '';
  let notifyBody = '';

  if (action === 'reject_items') {
    const rejList = Array.isArray(rejected_items) ? rejected_items : [];
    if (rejList.length === 0) {
      return res.status(400).json({ error: 'اختر صنفًا واحدًا على الأقل لرفضه' });
    }
    for (const r of rejList) {
      if (!r || !String(r.item_id || '').trim() || !String(r.reason || '').trim()) {
        return res.status(400).json({ error: 'يجب كتابة سبب رفض كل صنف تم تحديده للرفض' });
      }
    }
    const rejMap = new Map(rejList.map((r) => [String(r.item_id), String(r.reason).trim()]));
    items = items.map((it) => {
      const reasonText = rejMap.get(String(it.id));
      if (reasonText) {
        return { ...it, status: 'rejected' as const, rejection_reason: reasonText };
      }
      return it;
    });

    const acceptedItems = items.filter((it) => it.status !== 'rejected');
    const rejectedSummary = items
      .filter((it) => it.status === 'rejected')
      .map((it) => `${it.name_ar} (${it.rejection_reason || 'غير متوفر'})`)
      .join('، ');

    if (acceptedItems.length === 0) {
      nextSubtotal = 0;
      nextTotal = 0;
      nextStatus = 'cancelled';
      nextRejectReason = `تم رفض جميع أصناف الطلب: ${rejectedSummary}`;
      nextSubNote = nextRejectReason;
      notifyTitle = `تم إلغاء الطلب #${String(order.order_number)}`;
      notifyBody = nextRejectReason;
    } else {
      nextSubtotal = Number(acceptedItems.reduce((sum, it) => sum + Number(it.total_price || 0), 0).toFixed(2));
      nextTotal = Math.max(0, Number((nextSubtotal + deliveryFee - discount).toFixed(2)));
      if (nextStatus === 'pending_merchant' || nextStatus === 'awaiting_quote') {
        nextStatus = 'preparing';
      }
      nextSubNote = `تم رفض الأصناف التالية من التاجر: ${rejectedSummary}`;
      notifyTitle = `تحديث فاتورة الطلب #${String(order.order_number)}`;
      notifyBody = `${nextSubNote} — إجمالي الأصناف بعد التعديل: ${nextSubtotal} ج.م`;
    }
  } else if (action === 'reject_invoice' || nextStatus === 'cancelled') {
    const cleanReason = String(rejection_reason || '').trim();
    if (!cleanReason) {
      return res.status(400).json({ error: 'يجب كتابة سبب رفض/إلغاء الفاتورة بالكامل' });
    }
    nextStatus = 'cancelled';
    nextRejectReason = cleanReason;
    nextSubNote = cleanReason;
    nextSubtotal = 0;
    nextTotal = 0;
    items = items.map((it) => ({
      ...it,
      status: 'rejected' as const,
      rejection_reason: it.rejection_reason || cleanReason,
    }));
    notifyTitle = `تم رفض الفاتورة #${String(order.order_number)}`;
    notifyBody = `اعتذر التاجر عن تنفيذ الفاتورة — السبب: ${cleanReason}`;
  } else if (action === 'ready') {
    nextStatus = 'ready_for_pickup';
    nextReadyAt = new Date().toISOString();
    notifyTitle = `الطلب #${String(order.order_number)} جاهز للتوصيل`;
    notifyBody = `أعلن متجر ${String(order.merchant_name)} أن الطلب جاهز الآن للاستلام والتوصيل.`;
  }

  let captainId = order.captain_id as string | null;
  let captainName = order.captain_name as string | null;

  if (isAdminActor && (captain_id === null || captain_id === '')) {
    captainId = null;
    captainName = null;
  } else if (isAdminActor && typeof captain_id === 'string' && captain_id.trim()) {
    const cap = db
      .prepare('SELECT id, full_name, verification_status FROM captains WHERE id = ?')
      .get(captain_id.trim()) as { id: string; full_name: string; verification_status?: string } | undefined;
    if (!cap) return res.status(404).json({ error: 'الطيار المختار غير موجود' });
    if (cap.verification_status !== 'approved') {
      return res.status(400).json({ error: 'لا يمكن إسناد الطلب لطيار غير معتمد' });
    }
    captainId = cap.id;
    captainName = cap.full_name;
  } else {
    const shouldDispatch =
      nextStatus !== 'cancelled' && (assign_best_captain || action === 'ready') && !captainId;
    if (shouldDispatch) {
      const merchantRow = db
        .prepare('SELECT lat, lng FROM merchants WHERE id = ?')
        .get(order.merchant_id) as { lat?: number | null; lng?: number | null } | undefined;
      const dispatch = runSmartDispatch({
        service_type: order.merchant_type === 'pharmacy' ? 'pharmacy' : 'stores',
        pickup_lat: Number(merchantRow?.lat || 31.1583),
        pickup_lng: Number(merchantRow?.lng || 31.9369),
      });
      if (dispatch.winner) {
        captainId = dispatch.winner.captain_id;
        captainName = dispatch.winner.full_name;
      }
    }
  }

  db.prepare(`
    UPDATE orders SET
      status = ?, subtotal = ?, total_amount = ?, pharmacist_notes = ?,
      substitution_note = ?, prescription_status = ?, captain_id = ?, captain_name = ?,
      items_json = ?, rejection_reason = ?, ready_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    nextSubtotal,
    nextTotal,
    pharmacist_notes !== undefined ? pharmacist_notes : order.pharmacist_notes,
    nextSubNote,
    prescription_status !== undefined ? prescription_status : order.prescription_status,
    captainId,
    captainName,
    JSON.stringify(items),
    nextRejectReason,
    nextReadyAt,
    id
  );

  if (notifyTitle && notifyBody) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(order.zone_name || 'all'),
      recipientId: order.customer_id ? String(order.customer_id) : null,
      category: nextStatus === 'cancelled' ? 'alert' : 'operational',
      titleAr: notifyTitle,
      bodyAr: notifyBody,
      deepLink: 'order',
      orderId: id,
      status: String(nextStatus),
      channelId: 'otlobha_orders_channel',
      sentBy: String(order.merchant_name || 'التاجر'),
    });
  }

  if (captainId && captainId !== (order.captain_id || null) && nextStatus !== 'cancelled') {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(captainId),
      category: 'operational',
      titleAr: `طلب جديد مسند إليك #${String(order.order_number)}`,
      bodyAr: `تم إسناد الطلب #${String(order.order_number)} من ${String(order.merchant_name || 'المتجر')} إليك — يرجى التوجه للاستلام.`,
      deepLink: 'order',
      orderId: id,
      status: String(nextStatus),
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });
  }

  if (captainId && captainName && nextStatus !== 'cancelled') {
    ensureOrderChatStarter(id, captainName);
  }

  broadcastOrderChat(id, {
    type: 'order:status',
    order_id: id,
    status: nextStatus,
  });

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: nextStatus === 'cancelled' ? 'ORDER_REJECTED_BY_MERCHANT' : 'ORDER_MERCHANT_UPDATED',
    entity_type: 'orders',
    entity_id: id,
    reason: nextRejectReason ?? null,
    details: `تحديث طلب ${String(order.order_number)}: الحالة ${String(nextStatus)}، قيمة السلة ${nextSubtotal} ج.م${nextRejectReason ? `، السبب: ${nextRejectReason}` : ''}${captainName ? `، إسناد للكابتن ${captainName}` : ''}`,
  });

  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({ ok: true, assigned_captain: captainName, order: mapOrderRowWithSections(updatedOrder, [], auth) });
});

app.patch('/api/admin/orders/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const { id } = req.params;
  const {
    status,
    captain_id,
    assign_best_captain,
    mark_all_ready,
    subtotal,
    address_landmark,
    reason,
    admin_note,
  } = req.body as {
    status?: string;
    captain_id?: string | null;
    assign_best_captain?: boolean;
    mark_all_ready?: boolean;
    subtotal?: number;
    address_landmark?: string;
    reason?: string;
    admin_note?: string;
  };

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

  const sections = getOrderStoreSections(id);
  const nextStatus = mark_all_ready && ['pending_merchant', 'awaiting_quote', 'preparing'].includes(String(order.status))
    ? 'ready_for_pickup'
    : (status ?? String(order.status));
  const nextSubtotal = subtotal !== undefined && Number.isFinite(Number(subtotal)) ? Number(subtotal) : Number(order.subtotal);
  const deliveryFee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);
  const nextTotal = Math.max(0, Number((nextSubtotal + deliveryFee - discount).toFixed(2)));
  const nextAddress = address_landmark !== undefined ? String(address_landmark) : String(order.address_landmark || '');

  let nextCaptainId: string | null = order.captain_id ? String(order.captain_id) : null;
  let nextCaptainName: string | null = order.captain_name ? String(order.captain_name) : null;

  if (captain_id === null || captain_id === '') {
    nextCaptainId = null;
    nextCaptainName = null;
  } else if (typeof captain_id === 'string' && captain_id.trim()) {
    const cap = db
      .prepare('SELECT id, full_name, verification_status FROM captains WHERE id = ?')
      .get(captain_id.trim()) as { id: string; full_name: string; verification_status?: string } | undefined;
    if (!cap) return res.status(404).json({ error: 'الطيار المختار غير موجود' });
    if (cap.verification_status !== 'approved') {
      return res.status(400).json({ error: 'لا يمكن إسناد الطلب لطيار غير معتمد (يجب اعتماد حسابه أولاً)' });
    }
    nextCaptainId = cap.id;
    nextCaptainName = cap.full_name;
  } else if (assign_best_captain) {
    const anchor = getAnchorStoreSection(sections);
    const dispatch = runSmartDispatch({
      service_type: (anchor?.merchant_type || order.merchant_type) === 'pharmacy' ? 'pharmacy' : 'stores',
      pickup_lat: Number(anchor?.merchant_lat || order.customer_lat || 31.1583),
      pickup_lng: Number(anchor?.merchant_lng || order.customer_lng || 31.9369),
    });
    if (dispatch.winner) {
      nextCaptainId = dispatch.winner.captain_id;
      nextCaptainName = dispatch.winner.full_name;
    }
  }

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    if (mark_all_ready && sections.length > 0) {
      db.prepare(
        "UPDATE order_stores SET prep_status = 'ready_for_pickup', ready_at = COALESCE(ready_at, ?) WHERE order_id = ? AND prep_status IN ('pending_merchant', 'awaiting_quote', 'preparing')"
      ).run(nowIso, id);
    }
    if (nextStatus === 'delivered' && sections.length > 0) {
      db.prepare(
        "UPDATE order_stores SET prep_status = 'delivered', captain_picked_up_at = COALESCE(captain_picked_up_at, ?) WHERE order_id = ? AND prep_status != 'cancelled'"
      ).run(nowIso, id);
    }
    db.prepare(`
      UPDATE orders
      SET status = ?, subtotal = ?, total_amount = ?, address_landmark = ?, captain_id = ?, captain_name = ?,
          ready_at = CASE WHEN ? = 'ready_for_pickup' THEN COALESCE(ready_at, ?) ELSE ready_at END
      WHERE id = ?
    `).run(nextStatus, nextSubtotal, nextTotal, nextAddress, nextCaptainId, nextCaptainName, nextStatus, nowIso, id);
  })();

  if (nextCaptainId && nextCaptainName) {
    ensureOrderChatStarter(id, nextCaptainName);
  }

  if (nextStatus === 'delivered') {
    if (nextCaptainId && nextCaptainName) {
      createPendingCaptainRating({
        captain_id: nextCaptainId,
        captain_name: nextCaptainName,
        customer_id: order.customer_id ? String(order.customer_id) : null,
        customer_name: String(order.customer_name || 'عميل اطلبها'),
        customer_phone: order.customer_phone ? String(order.customer_phone) : null,
        ref_type: 'order',
        ref_id: id,
        ref_number: String(order.order_number),
        final_amount: nextTotal,
      });
    }
    const activeSecs = getOrderStoreSections(id).filter((s) => s.prep_status !== 'cancelled');
    if (activeSecs.length > 0) {
      for (const sec of activeSecs) {
        if (sec.subtotal > 0) {
          const commAmt = Number(((sec.subtotal * sec.commission_rate) / 100).toFixed(2));
          if (commAmt > 0) {
            postDoubleEntryLedger({
              idempotency_base: `order_delivered_comm_${id}_${sec.merchant_id}`,
              reference_type: 'order',
              reference_id: id,
              description_ar: `تحصيل عمولة طلب مكتمل #${String(order.order_number)} (${sec.merchant_name} - ${sec.commission_rate}%)`,
              debit_account_code: `CASH_CAPTAIN_${nextCaptainId ?? 'UNASSIGNED'}`,
              debit_account_type: 'cash_clearing',
              credit_account_code: 'PLATFORM_REVENUE_STORES',
              credit_account_type: 'platform_revenue',
              amount: commAmt,
            });
          }
        }
      }
    } else if (nextSubtotal > 0) {
      const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(order.merchant_id) as Record<string, unknown>;
      const commRate = Number(merchant?.commission_rate ?? 10);
      const commAmt = Number(((nextSubtotal * commRate) / 100).toFixed(2));
      if (commAmt > 0) {
        postDoubleEntryLedger({
          idempotency_base: `order_delivered_comm_${id}`,
          reference_type: 'order',
          reference_id: id,
          description_ar: `تحصيل عمولة طلب مكتمل #${String(order.order_number)} (${commRate}%)`,
          debit_account_code: `CASH_CAPTAIN_${nextCaptainId ?? 'UNASSIGNED'}`,
          debit_account_type: 'cash_clearing',
          credit_account_code: 'PLATFORM_REVENUE_STORES',
          credit_account_type: 'platform_revenue',
          amount: commAmt,
        });
      }
    }
  }

  const sysNote =
    admin_note?.trim() ||
    (nextStatus === 'cancelled'
      ? `تم إلغاء الطلب بواسطة الإدارة${reason ? ` — السبب: ${reason}` : ''}`
      : nextCaptainId !== (order.captain_id || null) && nextCaptainName
      ? `تم إسناد الطلب إداريًا للكابتن ${nextCaptainName}`
      : nextCaptainId === null && order.captain_id
      ? 'تم إلغاء إسناد الطيار من الطلب إداريًا'
      : mark_all_ready
      ? 'تم تأكيد جاهزية جميع متاجر الطلب إداريًا'
      : status && status !== order.status
      ? `تم تحديث حالة الطلب إداريًا إلى: ${nextStatus}`
      : '');

  if (sysNote) {
    const msgId = uid('msg');
    db.prepare(`
      INSERT INTO order_chat_messages (id, order_id, sender_role, sender_name, message_text, image_url, is_delivery_proof)
      VALUES (?, ?, 'system', 'إدارة اطلبها', ?, NULL, 0)
    `).run(msgId, id, sysNote);
    const savedMsg = db.prepare('SELECT * FROM order_chat_messages WHERE id = ?').get(msgId) as Record<string, unknown>;
    broadcastOrderChat(id, {
      type: 'chat:message',
      order_id: id,
      message: { ...savedMsg, is_delivery_proof: false },
    });
  }

  broadcastOrderChat(id, {
    type: 'order:status',
    order_id: id,
    status: nextStatus,
  });

  if (nextCaptainId && nextCaptainId !== (order.captain_id || null) && nextStatus !== 'cancelled') {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(nextCaptainId),
      category: 'operational',
      titleAr: `إسناد طلب من الإدارة #${String(order.order_number)}`,
      bodyAr: `تم إسناد الطلب #${String(order.order_number)} (${String(order.merchant_name || 'متجر')}) إليك بواسطة الإدارة.`,
      deepLink: 'order',
      orderId: id,
      status: String(nextStatus),
      channelId: 'otlobha_dispatch_channel',
      sentBy: req.auth!.fullName,
    });
  }

  if (order.customer_id && sysNote) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: String(order.zone_name || 'all'),
      recipientId: String(order.customer_id),
      category: nextStatus === 'cancelled' ? 'alert' : 'operational',
      titleAr: `تحديث على طلبك #${String(order.order_number)}`,
      bodyAr: sysNote,
      deepLink: 'order',
      orderId: id,
      status: String(nextStatus),
      channelId: 'otlobha_orders_channel',
      sentBy: req.auth!.fullName,
    });
  }

  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: nextStatus === 'cancelled' ? 'ADMIN_ORDER_CANCELLED' : 'ADMIN_ORDER_UPDATED',
    entity_type: 'orders',
    entity_id: id,
    reason: reason ?? null,
    details: `تحديث إداري للطلب #${String(order.order_number)}: الحالة ${nextStatus}، المجموع ${nextTotal} ج.م${nextCaptainName ? `، الطيار: ${nextCaptainName}` : ''}`,
  });

  const updated = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;

  res.json({ ok: true, order: mapOrderRowWithSections(updated, getOrderStoreSections(id), req.auth) });
});

app.delete('/api/orders/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;

  if (!isAdminAuth(auth)) {
    return res.status(403).json({ error: 'غير مصرح لغير مسؤولي الإدارة بحذف الطلبات' });
  }

  const order = db.prepare('SELECT id, order_number, customer_name, total_amount, status FROM orders WHERE id = ?').get(id) as
    | { id: string; order_number: string; customer_name: string; total_amount: number; status: string }
    | undefined;

  if (!order) {
    return res.status(404).json({ error: 'الطلب غير موجود أو تم حذفه مسبقًا' });
  }

  const deleteTx = db.transaction((orderId: string) => {
    db.prepare('DELETE FROM order_chat_messages WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_stores WHERE order_id = ?').run(orderId);
    db.prepare('UPDATE pos_invoices SET order_id = NULL WHERE order_id = ?').run(orderId);
    const info = db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    return info.changes > 0;
  });

  const deleted = deleteTx(id);
  if (!deleted) {
    return res.status(500).json({ error: 'تعذر حذف الطلب من قاعدة البيانات' });
  }

  broadcastOrderChat(id, {
    type: 'order:deleted',
    order_id: id,
    order_number: order.order_number,
  });

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'ORDER_DELETED_PERMANENTLY',
    entity_type: 'orders',
    entity_id: id,
    details: `حذف الطلب #${order.order_number} نهائيًا بواسطة الإدارة (${auth.fullName} - ${auth.role}). العميل: ${order.customer_name}، القيمة: ${order.total_amount} ج.م`,
  });

  res.json({ ok: true, id, message: `تم حذف الطلب #${order.order_number} نهائيًا بنجاح` });
});

// 7B. Categories & Products / Inventory Catalog
app.get('/api/categories', (req, res) => {
  const auth = optionalAuth(req);
  const scope = req.query.scope as string | undefined;
  const merchantId = req.query.merchant_id as string | undefined;
  const approvedOnly = req.query.approved_only === '1' || req.query.approved_only === 'true';
  let sql = 'SELECT c.* FROM categories c LEFT JOIN merchants m ON m.id = c.merchant_id';
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope) {
    clauses.push('c.scope = ?');
    params.push(scope);
  }
  if (merchantId) {
    clauses.push('(c.merchant_id = ? OR c.merchant_id IS NULL)');
    params.push(merchantId);
  }
  if (isAdminAuth(auth)) {
    if (approvedOnly) {
      clauses.push("c.is_active = 1 AND (c.merchant_id IS NULL OR m.verification_status = 'approved')");
    }
  } else if (auth?.role === 'merchant') {
    clauses.push("(c.merchant_id = ? OR (c.is_active = 1 AND (c.merchant_id IS NULL OR m.verification_status = 'approved')))");
    params.push(auth.id);
  } else {
    clauses.push("c.is_active = 1 AND (c.merchant_id IS NULL OR m.verification_status = 'approved')");
  }
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  sql += ' ORDER BY c.is_offers_section DESC, c.sort_order ASC, c.scope ASC';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const enriched = enrichAndOrderCategories(rows);
  res.json(
    enriched.map((c) => ({
      ...c,
      is_active: Boolean(c.is_active),
      is_offers_section: Boolean(c.is_offers_section),
    }))
  );
});

app.post('/api/categories', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بإدارة الأقسام' });
  }

  const { scope, merchant_id, parent_id, path_ar, name_ar, name_en, image_url, sort_order, is_offers_section } = req.body;
  const rawPath = String(path_ar || '').trim();
  if (!name_ar && !rawPath) {
    return res.status(400).json({ error: 'اسم القسم أو مسار القسم مطلوب' });
  }
  if (!scope && auth.role !== 'merchant') {
    return res.status(400).json({ error: 'نطاق القسم مطلوب' });
  }

  let effectiveMerchantId: string | null = merchant_id ? String(merchant_id).trim() : null;
  let effectiveScope: 'merchant' | 'pharmacy' | 'market' = (String(scope || 'merchant').trim() as 'merchant' | 'pharmacy' | 'market');

  if (auth.role === 'merchant') {
    if (effectiveMerchantId && effectiveMerchantId !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بإضافة قسم لمتجر آخر' });
    }
    const merRow = db.prepare('SELECT merchant_type FROM merchants WHERE id = ?').get(auth.id) as
      | { merchant_type?: string }
      | undefined;
    if (!merRow) return res.status(404).json({ error: 'حساب التاجر غير موجود' });
    effectiveMerchantId = auth.id;
    effectiveScope = merRow.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant';
  }

  // If user pasted a hierarchical Excel path like "سوبر ماركت > مخبوزات > كرواسون وكيك;"
  if (rawPath || (String(name_ar || '').includes('>') && !parent_id)) {
    const pathText = rawPath || String(name_ar || '');
    const resolver = createCategoryPathResolver({ scope: effectiveScope, merchantId: effectiveMerchantId });
    const resolved = resolveOrCreateCategoryPath(resolver, pathText, null);
    if (!resolved.category_id) {
      return res.status(400).json({ error: 'مسار القسم غير صالح. استخدم الصيغة: رئيسي > فرعي > فرعي أخير;' });
    }
    if (image_url && String(image_url).trim()) {
      db.prepare('UPDATE categories SET image_url = ? WHERE id = ?').run(String(image_url).trim(), resolved.category_id);
    }
    recomputeAllCategoryPaths();
    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'CATEGORY_PATH_CREATED',
      entity_type: 'categories',
      entity_id: resolved.category_id,
      details: `إنشاء مسار أقسام هرمي: ${resolved.excel_path} (${resolved.created_count} قسم جديد)`,
    });
    return res.status(201).json({
      id: resolved.category_id,
      excel_path: resolved.excel_path,
      created_count: resolved.created_count,
      is_offers_section: Boolean(resolved.is_offers_section),
    });
  }

  const trimmedAr = String(name_ar).trim();
  if (!trimmedAr) return res.status(400).json({ error: 'اسم القسم مطلوب' });
  const cleanParentId = parent_id ? String(parent_id).trim() : null;
  if (cleanParentId) {
    const parentRow = db.prepare('SELECT id FROM categories WHERE id = ?').get(cleanParentId);
    if (!parentRow) return res.status(400).json({ error: 'القسم الأب المحدد غير موجود' });
  }

  const isOffers =
    Boolean(is_offers_section) || ['العروض', 'عروض', 'عروض المتجر', 'offers'].includes(trimmedAr.toLowerCase());
  const lowerName = trimmedAr.toLowerCase();
  let inferredGroupKey = 'groceries';
  let inferredGroupName = 'المقاضي والمواد الغذائية';
  if (/خضار|فاكه|فواك|طازج|مخبوز|خبز|لحوم|دواجن|فراخ|أسماك|اسماك|سمك|ألبان|البان|جبن|بيض/.test(lowerName)) {
    inferredGroupKey = 'fresh';
    inferredGroupName = 'المنتجات الطازجة';
  } else if (/مشروب|قهو|شاي|عصير|عصائر|مياه|سخن|بارد/.test(lowerName)) {
    inferredGroupKey = 'drinks';
    inferredGroupName = 'المشروبات والمرطبات';
  } else if (/منظف|تنظيف|غسيل|مطهر|عناي|شخصي|صابون|شامبو/.test(lowerName)) {
    inferredGroupKey = 'home_care';
    inferredGroupName = 'المنظفات والعناية بالمنزل';
  } else if (/مطبخ|أواني|اواني|أدوات|ادوات/.test(lowerName)) {
    inferredGroupKey = 'kitchen';
    inferredGroupName = 'مستلزمات المطبخ';
  } else if (effectiveScope === 'pharmacy') {
    inferredGroupKey = 'other';
    inferredGroupName = 'أقسام أخرى والصيدلية';
  }
  const id = uid('cat');
  db.prepare(
    'INSERT INTO categories (id, scope, merchant_id, parent_id, level, full_path_ar, name_ar, name_en, image_url, group_key, group_name_ar, sort_order, is_offers_section, is_active) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
  ).run(
    id,
    effectiveScope,
    effectiveMerchantId,
    cleanParentId,
    `${trimmedAr};`,
    trimmedAr,
    String(name_en || trimmedAr).trim(),
    String(image_url || ''),
    inferredGroupKey,
    inferredGroupName,
    Number(sort_order || 0),
    isOffers ? 1 : 0
  );
  recomputeAllCategoryPaths();
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CATEGORY_CREATED',
    entity_type: 'categories',
    entity_id: id,
    details: `إضافة قسم جديد: ${trimmedAr} (${effectiveScope}${cleanParentId ? ` · تحت ${cleanParentId}` : ' · رئيسي'})`,
  });
  res.status(201).json({ id, is_offers_section: isOffers });
});

app.post('/api/categories/import-excel', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح باستيراد الأقسام' });
  }
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (paths.length === 0) {
    return res.status(400).json({ error: 'لا توجد مسارات أقسام للاستيراد' });
  }
  if (paths.length > 5000) {
    return res.status(400).json({ error: 'الحد الأقصى 5000 مسار في الدفعة الواحدة' });
  }
  const effectiveMerchantId = auth.role === 'merchant' ? auth.id : req.body?.merchant_id ? String(req.body.merchant_id).trim() : null;
  const effectiveScope: 'merchant' | 'pharmacy' | 'market' =
    auth.role === 'merchant'
      ? 'merchant'
      : ((String(req.body?.scope || 'merchant').trim() as 'merchant' | 'pharmacy' | 'market') || 'merchant');

  const resolver = createCategoryPathResolver({ scope: effectiveScope, merchantId: effectiveMerchantId });
  let totalCreated = 0;
  let processed = 0;

  const tx = db.transaction(() => {
    for (const rawEntry of paths) {
      const text = typeof rawEntry === 'string' ? rawEntry : String(rawEntry?.path_ar || rawEntry?.category || '');
      if (!text.trim()) continue;
      const r = resolveOrCreateCategoryPath(resolver, text, null);
      if (r.category_id) {
        processed += 1;
        totalCreated += r.created_count;
      }
    }
  });
  tx();
  recomputeAllCategoryPaths();

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CATEGORIES_EXCEL_IMPORTED',
    entity_type: 'categories',
    entity_id: 'bulk',
    details: `استيراد شجرة أقسام بالـ Excel: معالجة ${processed} مسار وإنشاء ${totalCreated} قسم جديد`,
  });
  res.json({ ok: true, processed_paths: processed, created_count: totalCreated });
});

app.patch('/api/categories/:id', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بتعديل الأقسام' });
  }

  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'القسم غير موجود' });

  if (auth.role === 'merchant' && String(existing.merchant_id || '') !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل قسم لا يخص متجرك' });
  }

  const { name_ar, name_en, merchant_id, parent_id, image_url, sort_order, is_active, is_offers_section } = req.body;
  if (auth.role === 'merchant' && merchant_id !== undefined && String(merchant_id || '') !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بنقل ملكية القسم إلى متجر آخر' });
  }

  const nextNameAr = name_ar !== undefined ? String(name_ar).trim() : String(existing.name_ar);
  if (!nextNameAr) return res.status(400).json({ error: 'اسم القسم مطلوب' });
  const nextIsOffers =
    is_offers_section !== undefined
      ? is_offers_section
        ? 1
        : 0
      : existing.is_offers_section ||
        (['العروض', 'عروض', 'عروض المتجر', 'offers'].includes(nextNameAr.toLowerCase()) ? 1 : 0);

  const nextMerchantId =
    auth.role === 'merchant'
      ? existing.merchant_id
      : merchant_id !== undefined
      ? merchant_id
        ? String(merchant_id).trim()
        : null
      : existing.merchant_id;

  let nextParentId: string | null = existing.parent_id ? String(existing.parent_id) : null;
  if (parent_id !== undefined) {
    const cleanPid = parent_id ? String(parent_id).trim() : null;
    if (cleanPid) {
      if (cleanPid === id || isCategoryDescendant(cleanPid, id)) {
        return res.status(400).json({ error: 'لا يمكن جعل القسم فرعيًا تحت نفسه أو تحت أحد أقسامه الفرعية' });
      }
      const pExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(cleanPid);
      if (!pExists) return res.status(400).json({ error: 'القسم الأب المحدد غير موجود' });
    }
    nextParentId = cleanPid;
  }

  db.prepare(
    'UPDATE categories SET name_ar = ?, name_en = ?, merchant_id = ?, parent_id = ?, image_url = ?, sort_order = ?, is_offers_section = ?, is_active = ? WHERE id = ?'
  ).run(
    nextNameAr,
    name_en !== undefined ? String(name_en).trim() : existing.name_en,
    nextMerchantId,
    nextParentId,
    image_url !== undefined ? String(image_url || '') : existing.image_url || '',
    sort_order !== undefined ? Number(sort_order) : existing.sort_order,
    nextIsOffers,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    id
  );
  recomputeAllCategoryPaths();
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CATEGORY_UPDATED',
    entity_type: 'categories',
    entity_id: id,
    details: `تعديل القسم: ${nextNameAr}`,
  });
  res.json({ ok: true });
});

app.delete('/api/categories/:id', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بحذف الأقسام' });
  }

  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'القسم غير موجود' });
  if (auth.role === 'merchant' && String(existing.merchant_id || '') !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بحذف قسم لا يخص متجرك' });
  }

  const childCount = (db.prepare('SELECT COUNT(*) as c FROM categories WHERE parent_id = ?').get(id) as { c: number }).c;
  if (childCount > 0) {
    return res.status(400).json({ error: `لا يمكن حذف القسم لاحتوائه على ${childCount} قسم فرعي؛ احذف أو انقل الأقسام الفرعية أولًا` });
  }

  const linked = (db.prepare('SELECT COUNT(*) as c FROM products WHERE category_id = ?').get(id) as { c: number }).c;
  if (linked > 0) {
    return res.status(400).json({ error: `لا يمكن حذف القسم لارتباطه بـ ${linked} منتجات؛ يمكنك إيقاف تفعيله أو نقل منتجاته أولًا` });
  }

  const deleteCategoryTx = db.transaction((categoryId: string) => {
    db.prepare('UPDATE master_products SET category_id = NULL WHERE category_id = ?').run(categoryId);
    db.prepare('UPDATE product_matching_requests SET category_id = NULL WHERE category_id = ?').run(categoryId);
    db.prepare('UPDATE storefront_banners SET target_category_id = NULL WHERE target_category_id = ?').run(categoryId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });
  deleteCategoryTx(id);

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CATEGORY_DELETED',
    entity_type: 'categories',
    entity_id: id,
    details: `حذف قسم: ${String(existing.name_ar || id)}`,
  });
  res.json({ ok: true });
});

app.get('/api/products', (req, res) => {
  const auth = optionalAuth(req);
  const merchantId = typeof req.query.merchant_id === 'string' ? req.query.merchant_id.trim() : '';
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id.trim() : '';
  const offersOnly = req.query.offers_only === '1' || req.query.offers_only === 'true';
  const noImageOnly = req.query.no_image === '1' || req.query.no_image === 'true';
  const availabilityFilter = typeof req.query.availability === 'string' ? req.query.availability.trim().toLowerCase() : 'all';
  const approvedOnly = req.query.approved_only === '1' || req.query.approved_only === 'true';
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const defaultLimit = paginated ? 60 : 250;
  const maxLimit = paginated ? 200 : 500;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit || defaultLimit), 10) || defaultLimit));
  const rawOffset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : NaN;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : (page - 1) * limit;
  const sortMode = String(req.query.sort || '').trim().toLowerCase();
  const fromId = String(req.query.from_id || '').trim();
  const afterId = String(req.query.after_id || '').trim();

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (merchantId && merchantId !== 'all') {
    clauses.push('p.merchant_id = ?');
    params.push(merchantId);
  }
  if (categoryId && categoryId !== 'all' && categoryId !== 'offers') {
    const descendantIds = getCategoryAndDescendantIds(categoryId);
    if (descendantIds.length > 1) {
      clauses.push(`p.category_id IN (${descendantIds.map(() => '?').join(',')})`);
      params.push(...descendantIds);
    } else {
      clauses.push('p.category_id = ?');
      params.push(categoryId);
    }
  }
  if (offersOnly || categoryId === 'offers') {
    clauses.push('(p.is_offer = 1 OR c.is_offers_section = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price))');
  }
  if (noImageOnly) {
    clauses.push("TRIM(COALESCE(p.image_url, '')) = ''");
  }
  if (availabilityFilter === 'available') {
    clauses.push('p.is_available = 1');
  } else if (availabilityFilter === 'unavailable' || availabilityFilter === 'paused' || availabilityFilter === 'hidden') {
    clauses.push('p.is_available = 0');
  }
  if (afterId && afterId.length <= 128) {
    clauses.push('p.id > ?');
    params.push(afterId);
  } else if (fromId && fromId.length <= 128) {
    clauses.push('p.id >= ?');
    params.push(fromId);
  }

  if (isAdminAuth(auth)) {
    if (approvedOnly) {
      clauses.push("p.is_available = 1 AND m.verification_status = 'approved' AND c.is_active = 1");
    }
  } else if (auth?.role === 'merchant') {
    if (approvedOnly) {
      clauses.push("p.is_available = 1 AND m.verification_status = 'approved' AND c.is_active = 1");
    } else {
      clauses.push("(p.merchant_id = ? OR (p.is_available = 1 AND m.verification_status = 'approved' AND c.is_active = 1))");
      params.push(auth.id);
    }
  } else {
    clauses.push("p.is_available = 1 AND m.verification_status = 'approved' AND c.is_active = 1");
  }

  let usedFts = false;
  if (rawQuery) {
    const ftsQuery = isProductsFtsReady() ? buildFtsMatchQuery(rawQuery) : null;
    if (ftsQuery) {
      usedFts = true;
      clauses.push('(p.id IN (SELECT product_id FROM products_fts WHERE products_fts MATCH ?) OR LOWER(COALESCE(p.product_code, \'\')) = LOWER(?))');
      params.push(ftsQuery, rawQuery);
    } else {
      const like = `%${rawQuery}%`;
      clauses.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.product_code LIKE ? OR p.description LIKE ? OR c.name_ar LIKE ?)');
      params.push(like, like, like, like, like);
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const baseFromSql = `
    FROM products p
    JOIN merchants m ON m.id = p.merchant_id
    JOIN categories c ON c.id = p.category_id
    ${whereSql}
  `;

  const mapProductRow = (p: Record<string, unknown>) => {
    const hasDiscount = p.sale_price !== null && p.sale_price !== undefined && Number(p.sale_price) < Number(p.base_price);
    const isWeighted = Boolean(p.is_weighted);
    const weightStep = Number(p.weight_step || 0.25);
    const weightUnit = String(p.weight_unit || 'كجم').trim() || 'كجم';
    return {
      ...p,
      is_offer: Boolean(p.is_offer) || Boolean(p.category_is_offers) || hasDiscount,
      requires_prescription: Boolean(p.requires_prescription),
      is_available: Boolean(p.is_available),
      is_weighted: isWeighted,
      weight_step: Number.isFinite(weightStep) && weightStep > 0 ? weightStep : 0.25,
      weight_unit: weightUnit,
      min_order_qty: Number(p.min_order_qty || (isWeighted ? (Number.isFinite(weightStep) && weightStep > 0 ? weightStep : 0.25) : 1)),
    };
  };

  const shouldGroupByMaster =
    !isAdminAuth(auth) &&
    auth?.role !== 'merchant' &&
    (!merchantId || merchantId === 'all') &&
    req.query.ungrouped !== '1' &&
    req.query.ungrouped !== 'true';

  const selectColumnsSql = `
    SELECT p.*, m.business_name_ar as merchant_name, c.name_ar as category_name,
           COALESCE(NULLIF(c.full_path_ar, ''), c.name_ar || ';') as category_path,
           c.is_offers_section as category_is_offers
  `;

  const ungroupedOrderSql = sortMode === 'id_asc' ? 'ORDER BY p.id ASC' : 'ORDER BY p.is_offer DESC, p.updated_at DESC';
  const buildSelectQuery = (fromSql: string) =>
    shouldGroupByMaster
      ? `SELECT * FROM (
           ${selectColumnsSql},
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(p.master_product_id, p.id)
             ORDER BY p.is_offer DESC, COALESCE(p.sale_price, p.base_price) ASC, p.updated_at DESC
           ) AS rn
           ${fromSql}
         ) sub
         WHERE sub.rn = 1
         ORDER BY sub.is_offer DESC, sub.updated_at DESC
         LIMIT ? OFFSET ?`
      : `${selectColumnsSql}
         ${fromSql}
         ${ungroupedOrderSql}
         LIMIT ? OFFSET ?`;

  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db.prepare(buildSelectQuery(baseFromSql)).all(...params, limit, offset) as Array<Record<string, unknown>>;
  } catch (queryErr) {
    if (usedFts && rawQuery) {
      // Graceful fallback to LIKE if an unusual punctuation query causes an FTS5 syntax error
      clauses.pop();
      params.pop();
      params.pop();
      const like = `%${rawQuery}%`;
      clauses.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.product_code LIKE ? OR p.description LIKE ? OR c.name_ar LIKE ?)');
      params.push(like, like, like, like, like);
      const fallbackFrom = `
        FROM products p
        JOIN merchants m ON m.id = p.merchant_id
        JOIN categories c ON c.id = p.category_id
        WHERE ${clauses.join(' AND ')}
      `;
      rows = db.prepare(buildSelectQuery(fallbackFrom)).all(...params, limit, offset) as Array<Record<string, unknown>>;
    } else {
      throw queryErr;
    }
  }

  // Enrich grouped customer products with multi-store count & lowest price
  const storeStatsByMaster = new Map<string, { stores_count: number; lowest_store_price: number }>();
  if (shouldGroupByMaster && rows.length > 0) {
    const mIds = Array.from(new Set(rows.map((r) => String(r.master_product_id || '')).filter(Boolean)));
    if (mIds.length > 0) {
      const ph = mIds.map(() => '?').join(',');
      const agg = db
        .prepare(
          `SELECT master_product_id, COUNT(*) AS stores_count, MIN(COALESCE(sale_price, base_price)) AS lowest_price
           FROM products
           WHERE master_product_id IN (${ph}) AND is_available = 1
           GROUP BY master_product_id`
        )
        .all(...mIds) as Array<{ master_product_id: string; stores_count: number; lowest_price: number }>;
      for (const a of agg) {
        storeStatsByMaster.set(a.master_product_id, {
          stores_count: Number(a.stores_count || 1),
          lowest_store_price: Number(a.lowest_price || 0),
        });
      }
    }
  }

  const mapped = rows.map((r) => {
    const base = mapProductRow(r);
    if (shouldGroupByMaster && r.master_product_id) {
      const stats = storeStatsByMaster.get(String(r.master_product_id));
      if (stats) {
        return {
          ...base,
          stores_count: stats.stores_count,
          lowest_store_price: stats.lowest_store_price,
        };
      }
    }
    return base;
  });

  if (paginated) {
    const finalWhere = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const countExpr = shouldGroupByMaster ? 'COUNT(DISTINCT COALESCE(p.master_product_id, p.id))' : 'COUNT(*)';
    const total = (
      db
        .prepare(
          `SELECT ${countExpr} as c
           FROM products p
           JOIN merchants m ON m.id = p.merchant_id
           JOIN categories c ON c.id = p.category_id
           ${finalWhere}`
        )
        .get(...params) as { c: number }
    ).c;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    let summary:
      | { total_all: number; total_offers: number; total_no_image: number; total_unavailable: number }
      | undefined;
    if (merchantId && merchantId !== 'all') {
      const sRow = db
        .prepare(
          `SELECT
             COUNT(*) AS total_all,
             SUM(CASE WHEN p.is_offer = 1 OR c.is_offers_section = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.base_price) THEN 1 ELSE 0 END) AS total_offers,
             SUM(CASE WHEN TRIM(COALESCE(p.image_url, '')) = '' AND p.is_available = 1 THEN 1 ELSE 0 END) AS total_no_image,
             SUM(CASE WHEN p.is_available = 0 THEN 1 ELSE 0 END) AS total_unavailable
           FROM products p
           JOIN categories c ON c.id = p.category_id
           WHERE p.merchant_id = ?`
        )
        .get(merchantId) as {
        total_all?: number;
        total_offers?: number;
        total_no_image?: number;
        total_unavailable?: number;
      };
      summary = {
        total_all: Number(sRow?.total_all || 0),
        total_offers: Number(sRow?.total_offers || 0),
        total_no_image: Number(sRow?.total_no_image || 0),
        total_unavailable: Number(sRow?.total_unavailable || 0),
      };
    }
    return res.json({
      items: mapped,
      total,
      page,
      limit,
      total_pages: totalPages,
      has_more: offset + mapped.length < total,
      ...(summary ? { summary } : {}),
    });
  }

  res.json(mapped);
});

app.post('/api/products', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بإضافة منتجات' });
  }

  const {
    product_code,
    merchant_id,
    category_id,
    category_path,
    master_product_id,
    name_ar,
    name_en,
    brand,
    size_label,
    barcode,
    merchant_sku,
    min_order_qty,
    is_weighted,
    weight_step,
    weight_unit,
    description,
    image_url,
    base_price,
    price,
    sale_price,
    is_offer,
    stock_quantity,
    low_stock_threshold,
    requires_prescription,
    addons_text,
    is_available,
  } = req.body;

  const effectiveMerchantId = auth.role === 'merchant' ? auth.id : String(merchant_id || '').trim();
  if (auth.role === 'merchant' && merchant_id && String(merchant_id).trim() !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بإضافة منتج لمتجر آخر' });
  }
  const cleanCategoryPath = String(category_path || '').trim();
  if (!effectiveMerchantId || (!category_id && !cleanCategoryPath) || !String(name_ar || '').trim()) {
    return res.status(400).json({ error: 'التاجر والقسم (أو مسار القسم) واسم المنتج مطلوبة' });
  }

  const merchantRow = db.prepare('SELECT id, merchant_type FROM merchants WHERE id = ?').get(effectiveMerchantId) as
    | { id: string; merchant_type?: string }
    | undefined;
  if (!merchantRow) return res.status(404).json({ error: 'المتجر المحدد غير موجود' });

  let resolvedCategoryId = String(category_id || '').trim();
  if (cleanCategoryPath) {
    const catScope = merchantRow.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant';
    const resolver = createCategoryPathResolver({ scope: catScope, merchantId: auth.role === 'merchant' ? effectiveMerchantId : null });
    const resolved = resolveOrCreateCategoryPath(resolver, cleanCategoryPath, resolvedCategoryId || null);
    if (resolved.category_id) {
      resolvedCategoryId = resolved.category_id;
    }
    if (resolved.created_count > 0) {
      recomputeAllCategoryPaths();
    }
  }

  const catRow = db.prepare('SELECT id, scope, merchant_id, is_offers_section, name_ar FROM categories WHERE id = ?').get(resolvedCategoryId) as
    | { id: string; scope: string; merchant_id: string | null; is_offers_section?: number; name_ar?: string }
    | undefined;
  if (!catRow) return res.status(400).json({ error: 'القسم المحدد غير موجود' });
  if (auth.role === 'merchant' && catRow.merchant_id && catRow.merchant_id !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بإضافة منتج داخل قسم يتبع متجرًا آخر' });
  }

  const parsedBase = Number(base_price ?? price ?? 0);
  if (!Number.isFinite(parsedBase) || parsedBase < 0) {
    return res.status(400).json({ error: 'السعر الأساسي غير صالح' });
  }
  const parsedSale = sale_price !== '' && sale_price !== null && sale_price !== undefined ? Number(sale_price) : null;
  if (parsedSale !== null && (!Number.isFinite(parsedSale) || parsedSale < 0 || parsedSale > parsedBase)) {
    return res.status(400).json({ error: 'سعر العرض يجب أن يكون رقمًا غير سالب ولا يتجاوز السعر الأساسي' });
  }
  const parsedStock = Math.max(0, Math.floor(Number(stock_quantity ?? 10)));
  const parsedThreshold = Math.max(0, Math.floor(Number(low_stock_threshold ?? 5)));
  const parsedIsWeighted = Boolean(is_weighted) ? 1 : 0;
  const rawWeightStep = Number(weight_step ?? 0.25);
  const parsedWeightStep =
    Number.isFinite(rawWeightStep) && rawWeightStep >= 0.05 && rawWeightStep <= 10
      ? Math.round(rawWeightStep * 1000) / 1000
      : 0.25;
  const parsedWeightUnit = String(weight_unit || 'كجم').trim() || 'كجم';
  const rawMinQty = Number(min_order_qty ?? (parsedIsWeighted ? parsedWeightStep : 1));
  const parsedMinQty = parsedIsWeighted
    ? Math.max(parsedWeightStep, Math.round((Number.isFinite(rawMinQty) && rawMinQty > 0 ? rawMinQty : parsedWeightStep) * 1000) / 1000)
    : Math.max(1, Math.floor(Number.isFinite(rawMinQty) ? rawMinQty : 1));
  const parsedSize = extractSize({ size_label, name_ar, name_en });
  const cleanMasterId = String(master_product_id || '').trim() || null;

  // Guarantee that every added product passes through the central master catalog first
  const masterLink = ensureMasterProductForListing({
    name_ar: String(name_ar).trim(),
    name_en: String(name_en || name_ar).trim(),
    brand: String(brand || '').trim(),
    category_id: resolvedCategoryId,
    barcode: String(barcode || '').trim() || null,
    size_value: parsedSize?.canonicalValue ?? null,
    size_unit: parsedSize?.canonicalUnit ?? '',
    size_label: String(size_label || parsedSize?.displayLabel || '').trim(),
    image_url: String(image_url || '').trim(),
    description: String(description || '').trim(),
    merchant_id: effectiveMerchantId,
    master_product_id: cleanMasterId,
  });

  const finalMasterId = masterLink.master_product_id;

  if (finalMasterId) {
    const dupMasterListing = db
      .prepare('SELECT id FROM products WHERE merchant_id = ? AND master_product_id = ? AND is_available = 1')
      .get(effectiveMerchantId, finalMasterId);
    if (dupMasterListing) {
      return res.status(409).json({ error: 'لديك بالفعل عرض نشط لهذا المنتج في متجرك؛ قم بتعديل السعر أو المخزون بدلًا من التكرار' });
    }
  }

  const id = uid('prd');
  let finalCode = String(product_code || '').trim();
  if (!finalCode) {
    const countRow = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
    let seq = 1001 + countRow.c;
    while (db.prepare('SELECT 1 FROM products WHERE LOWER(product_code) = LOWER(?)').get(`PRD-${seq}`)) {
      seq += 1;
    }
    finalCode = `PRD-${seq}`;
  } else {
    const dup = db.prepare('SELECT id FROM products WHERE LOWER(product_code) = LOWER(?)').get(finalCode);
    if (dup) {
      return res.status(409).json({ error: `كود المنتج "${finalCode}" مستخدم بالفعل لمنتج آخر` });
    }
  }

  const catIsOffers =
    Boolean(catRow?.is_offers_section) ||
    ['العروض', 'عروض', 'عروض المتجر', 'offers'].includes(String(catRow?.name_ar || '').trim().toLowerCase());
  const effectiveIsOffer = Boolean(is_offer) || catIsOffers || (parsedSale !== null && parsedSale < parsedBase) ? 1 : 0;

  db.prepare(`
    INSERT INTO products (
      id, product_code, merchant_id, category_id, master_product_id, name_ar, name_en, description, image_url,
      brand, size_label, size_value, size_unit, barcode, merchant_sku, min_order_qty,
      is_weighted, weight_step, weight_unit,
      base_price, sale_price, is_offer, stock_quantity, low_stock_threshold, requires_prescription, addons_text, is_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    finalCode,
    effectiveMerchantId,
    resolvedCategoryId,
    finalMasterId,
    String(name_ar).trim(),
    String(name_en || name_ar).trim(),
    String(description || ''),
    String(image_url || ''),
    String(brand || '').trim(),
    String(size_label || parsedSize?.displayLabel || '').trim(),
    parsedSize?.canonicalValue ?? null,
    parsedSize?.canonicalUnit ?? '',
    String(barcode || '').trim() || null,
    String(merchant_sku || '').trim(),
    parsedMinQty,
    parsedIsWeighted,
    parsedWeightStep,
    parsedWeightUnit,
    parsedBase,
    parsedSale,
    effectiveIsOffer,
    parsedStock,
    parsedThreshold,
    requires_prescription ? 1 : 0,
    String(addons_text || ''),
    is_available !== false ? 1 : 0
  );
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'PRODUCT_CREATED',
    entity_type: 'products',
    entity_id: id,
    details: `إضافة منتج جديد: ${String(name_ar).trim()} (الكود ${finalCode}، السعر ${parsedBase} ج.م، المخزون ${parsedStock}${effectiveIsOffer ? ' · مضاف للعروض' : ''})`,
  });
  res.status(201).json({ id, product_code: finalCode, is_offer: Boolean(effectiveIsOffer) });
});

app.post('/api/products/import-excel', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح باستيراد المنتجات' });
  }

  const { merchant_id, rows } = req.body as {
    merchant_id?: string;
    rows?: Array<{
      product_code?: string | number;
      name_ar?: string;
      price?: number | string;
      category_name?: string;
      image_url?: string;
    }>;
  };
  if (auth.role === 'merchant' && merchant_id && String(merchant_id).trim() !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك باستيراد منتجات لمتجر آخر' });
  }
  const effectiveMerchantId = auth.role === 'merchant' ? auth.id : String(merchant_id || '').trim();
  if (!effectiveMerchantId) {
    return res.status(400).json({ error: 'يرجى تحديد المتجر أو الصيدلية المستهدفة للاستيراد' });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'ملف الإكسل لا يحتوي على صفوف منتجات صالحة' });
  }
  if (rows.length > 10000) {
    return res.status(400).json({ error: 'الحد الأقصى للاستيراد في الدفعة الواحدة هو 10,000 صف' });
  }
  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(effectiveMerchantId) as Record<string, unknown> | undefined;
  if (!merchant) {
    return res.status(404).json({ error: 'المتجر المحدد غير موجود' });
  }
  const catScope = String(merchant.merchant_type) === 'pharmacy' ? 'pharmacy' : 'merchant';
  const defaultCat =
    (db.prepare("SELECT id FROM categories WHERE scope = ? ORDER BY sort_order ASC LIMIT 1").get(catScope) as
      | { id: string }
      | undefined) ||
    (db.prepare("SELECT id FROM categories WHERE scope != 'market' ORDER BY sort_order ASC LIMIT 1").get() as
      | { id: string }
      | undefined);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let categoriesCreated = 0;
  const errors: string[] = [];

  // Pre-load existing product codes and categories into in-memory maps so 10,000-row imports execute in milliseconds
  const prodCodeMap = new Map<string, { id: string; merchant_id: string }>();
  const existingCodes = new Set<string>();
  const existingProdRows = db
    .prepare("SELECT id, merchant_id, product_code FROM products WHERE product_code IS NOT NULL AND TRIM(product_code) != ''")
    .all() as Array<{ id: string; merchant_id: string; product_code: string }>;
  for (const r of existingProdRows) {
    const key = String(r.product_code).trim().toUpperCase();
    existingCodes.add(key);
    if (!prodCodeMap.has(key)) {
      prodCodeMap.set(key, { id: String(r.id), merchant_id: String(r.merchant_id) });
    }
  }

  let nextAutoSeq = 1001 + existingCodes.size;
  const nextGeneratedCode = () => {
    while (existingCodes.has(`PRD-${nextAutoSeq}`)) nextAutoSeq += 1;
    const code = `PRD-${nextAutoSeq}`;
    existingCodes.add(code);
    nextAutoSeq += 1;
    return code;
  };

  const categoryResolver = createCategoryPathResolver({
    scope: catScope as 'merchant' | 'pharmacy',
    merchantId: effectiveMerchantId,
  });

  const insertProdStmt = db.prepare(`
    INSERT INTO products (
      id, product_code, merchant_id, category_id, master_product_id, name_ar, name_en, description, image_url,
      size_label, size_value, size_unit,
      base_price, sale_price, stock_quantity, low_stock_threshold, requires_prescription, addons_text, is_offer, is_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, NULL, 25, 5, 0, '', ?, 1)
  `);
  const updateProdStmt = db.prepare(`
    UPDATE products SET
      category_id = ?, master_product_id = ?, name_ar = ?, name_en = ?,
      size_label = ?, size_value = ?, size_unit = ?, base_price = ?,
      image_url = CASE WHEN TRIM(?) != '' THEN ? ELSE image_url END,
      is_offer = CASE WHEN ? = 1 THEN 1 ELSE is_offer END,
      updated_at = datetime('now')
    WHERE id = ? AND merchant_id = ?
  `);

  const runImport = db.transaction(() => {
    rows.forEach((rawRow, index) => {
      const rowNum = index + 2;
      const nameAr = String(rawRow.name_ar ?? '').trim();
      const rawCode = String(rawRow.product_code ?? '').trim();
      const rawCategory = String(rawRow.category_name ?? '').trim();
      const rawImage = String(rawRow.image_url ?? '').trim();
      const parsedPrice = parseLocalizedNumber(rawRow.price ?? 0);

      if (!nameAr) {
        skipped += 1;
        if (errors.length < 100) errors.push(`صف ${rowNum}: اسم المنتج فارغ`);
        return;
      }
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        skipped += 1;
        if (errors.length < 100) errors.push(`صف ${rowNum} (${nameAr}): سعر غير صالح`);
        return;
      }

      let categoryId = defaultCat?.id || 'cat_grocery';
      let categoryIsOffers = 0;
      if (rawCategory) {
        const resolvedCat = resolveOrCreateCategoryPath(categoryResolver, rawCategory, categoryId);
        if (resolvedCat.category_id) {
          categoryId = resolvedCat.category_id;
          categoryIsOffers = resolvedCat.is_offers_section;
          categoriesCreated += resolvedCat.created_count;
        }
      }

      const parsedSize = extractSize({ name_ar: nameAr, name_en: nameAr });
      const sizeLabelVal = parsedSize?.displayLabel || '';
      const sizeValueVal = parsedSize?.canonicalValue ?? null;
      const sizeUnitVal = parsedSize?.canonicalUnit ?? '';

      const masterLink = ensureMasterProductForListing({
        name_ar: nameAr,
        name_en: nameAr,
        category_id: categoryId,
        size_value: sizeValueVal,
        size_unit: sizeUnitVal,
        size_label: sizeLabelVal,
        image_url: rawImage,
        merchant_id: effectiveMerchantId,
      });
      const finalMasterId = masterLink.master_product_id;

      if (rawCode) {
        const codeKey = rawCode.toUpperCase();
        const existingProd = prodCodeMap.get(codeKey);
        if (existingProd) {
          if (String(existingProd.merchant_id) !== effectiveMerchantId) {
            skipped += 1;
            if (errors.length < 100) errors.push(`صف ${rowNum} (${rawCode}): كود المنتج مملوك لمتجر آخر ولا يمكن تعديله`);
            return;
          }
          updateProdStmt.run(
            categoryId,
            finalMasterId,
            nameAr,
            nameAr,
            sizeLabelVal,
            sizeValueVal,
            sizeUnitVal,
            parsedPrice,
            rawImage,
            rawImage,
            categoryIsOffers,
            existingProd.id,
            effectiveMerchantId
          );
          updated += 1;
          return;
        }
        const newProdId = uid('prd');
        existingCodes.add(codeKey);
        prodCodeMap.set(codeKey, { id: newProdId, merchant_id: effectiveMerchantId });
        insertProdStmt.run(
          newProdId,
          rawCode,
          effectiveMerchantId,
          categoryId,
          finalMasterId,
          nameAr,
          nameAr,
          rawImage,
          sizeLabelVal,
          sizeValueVal,
          sizeUnitVal,
          parsedPrice,
          categoryIsOffers
        );
        created += 1;
        return;
      }

      const generatedCode = nextGeneratedCode();
      const newProdId = uid('prd');
      prodCodeMap.set(generatedCode.toUpperCase(), { id: newProdId, merchant_id: effectiveMerchantId });
      insertProdStmt.run(
        newProdId,
        generatedCode,
        effectiveMerchantId,
        categoryId,
        finalMasterId,
        nameAr,
        nameAr,
        rawImage,
        sizeLabelVal,
        sizeValueVal,
        sizeUnitVal,
        parsedPrice,
        categoryIsOffers
      );
      created += 1;
    });
  });

  runImport();

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'PRODUCTS_EXCEL_IMPORTED',
    entity_type: 'products',
    entity_id: effectiveMerchantId,
    details: `استيراد Excel لمتجر ${String(merchant.business_name_ar)}: جديد ${created}، محدث ${updated}، أقسام جديدة ${categoriesCreated}، متخطى ${skipped}`,
  });

  res.json({
    ok: true,
    created,
    updated,
    skipped,
    categories_created: categoriesCreated,
    errors: errors.slice(0, 30),
  });
});

app.patch('/api/products/:id', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بتعديل المنتجات' });
  }

  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });

  if (auth.role === 'merchant' && String(existing.merchant_id || '') !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل منتج يتبع متجرًا آخر' });
  }

  const b = req.body;
  if (auth.role === 'merchant' && b.merchant_id !== undefined && String(b.merchant_id) !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بنقل ملكية المنتج لمتجر آخر' });
  }

  const nextCode = b.product_code !== undefined ? String(b.product_code || '').trim() : String(existing.product_code || '');
  if (nextCode) {
    const dup = db
      .prepare('SELECT id FROM products WHERE LOWER(product_code) = LOWER(?) AND id != ?')
      .get(nextCode, id);
    if (dup) {
      return res.status(409).json({ error: `كود المنتج "${nextCode}" مستخدم بالفعل لمنتج آخر` });
    }
  }
  const nextBase =
    b.base_price !== undefined
      ? Number(b.base_price)
      : b.price !== undefined
      ? Number(b.price)
      : Number(existing.base_price);
  if (!Number.isFinite(nextBase) || nextBase < 0) {
    return res.status(400).json({ error: 'السعر الأساسي غير صالح' });
  }
  const nextSale =
    b.sale_price === '' || b.sale_price === null
      ? null
      : b.sale_price !== undefined
      ? Number(b.sale_price)
      : existing.sale_price !== null && existing.sale_price !== undefined
      ? Number(existing.sale_price)
      : null;
  if (nextSale !== null && (!Number.isFinite(nextSale) || nextSale < 0 || nextSale > nextBase)) {
    return res.status(400).json({ error: 'سعر العرض غير صالح أو يتجاوز السعر الأساسي' });
  }

  let nextCatId = String(b.category_id ?? existing.category_id);
  const patchCategoryPath = String(b.category_path || '').trim();
  if (patchCategoryPath) {
    const merInfo = db.prepare('SELECT merchant_type FROM merchants WHERE id = ?').get(existing.merchant_id) as
      | { merchant_type?: string }
      | undefined;
    const catScope = merInfo?.merchant_type === 'pharmacy' ? 'pharmacy' : 'merchant';
    const resolver = createCategoryPathResolver({
      scope: catScope,
      merchantId: auth.role === 'merchant' ? String(existing.merchant_id) : null,
    });
    const resolved = resolveOrCreateCategoryPath(resolver, patchCategoryPath, nextCatId);
    if (resolved.category_id) nextCatId = resolved.category_id;
    if (resolved.created_count > 0) recomputeAllCategoryPaths();
  }
  const catRow = db.prepare('SELECT merchant_id, is_offers_section, name_ar FROM categories WHERE id = ?').get(nextCatId) as
    | { merchant_id?: string | null; is_offers_section?: number; name_ar?: string }
    | undefined;
  if (!catRow) return res.status(400).json({ error: 'القسم المحدد غير موجود' });
  if (auth.role === 'merchant' && catRow.merchant_id && catRow.merchant_id !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بنقل المنتج لقسم متجر آخر' });
  }

  const catIsOffers =
    Boolean(catRow?.is_offers_section) ||
    ['العروض', 'عروض', 'عروض المتجر', 'offers'].includes(String(catRow?.name_ar || '').trim().toLowerCase());
  const requestedIsOffer = b.is_offer !== undefined ? Boolean(b.is_offer) : Boolean(existing.is_offer);
  const nextIsOffer = requestedIsOffer || catIsOffers || (nextSale !== null && nextSale < nextBase) ? 1 : 0;

  const nextBrand = b.brand !== undefined ? String(b.brand || '').trim() : String(existing.brand || '');
  const nextSizeLabel = b.size_label !== undefined ? String(b.size_label || '').trim() : String(existing.size_label || '');
  const nextParsedSize = extractSize({ size_label: nextSizeLabel, name_ar: String(b.name_ar ?? existing.name_ar), name_en: String(b.name_en ?? existing.name_en) });
  const nextBarcode: string | null =
    b.barcode !== undefined
      ? (String(b.barcode || '').trim() || null)
      : existing.barcode ? String(existing.barcode).trim() : null;
  const nextMerchantSku = b.merchant_sku !== undefined ? String(b.merchant_sku || '').trim() : String(existing.merchant_sku || '');
  const nextIsWeighted = b.is_weighted !== undefined ? (Boolean(b.is_weighted) ? 1 : 0) : (Boolean(existing.is_weighted) ? 1 : 0);
  const rawNextStep = b.weight_step !== undefined ? Number(b.weight_step) : Number(existing.weight_step || 0.25);
  const nextWeightStep =
    Number.isFinite(rawNextStep) && rawNextStep >= 0.05 && rawNextStep <= 10
      ? Math.round(rawNextStep * 1000) / 1000
      : 0.25;
  const nextWeightUnit =
    b.weight_unit !== undefined
      ? (String(b.weight_unit || 'كجم').trim() || 'كجم')
      : (String(existing.weight_unit || 'كجم').trim() || 'كجم');
  const rawNextMinQty = b.min_order_qty !== undefined ? Number(b.min_order_qty) : Number(existing.min_order_qty || (nextIsWeighted ? nextWeightStep : 1));
  const nextMinQty = nextIsWeighted
    ? Math.max(nextWeightStep, Math.round((Number.isFinite(rawNextMinQty) && rawNextMinQty > 0 ? rawNextMinQty : nextWeightStep) * 1000) / 1000)
    : Math.max(1, Math.floor(Number.isFinite(rawNextMinQty) ? rawNextMinQty : 1));

  let nextMasterId = existing.master_product_id ? String(existing.master_product_id).trim() : null;
  const nameChanged = b.name_ar !== undefined && String(b.name_ar).trim() !== String(existing.name_ar).trim();
  const brandChanged = b.brand !== undefined && String(b.brand).trim() !== String(existing.brand || '').trim();
  const sizeChanged = b.size_label !== undefined && String(b.size_label).trim() !== String(existing.size_label || '').trim();
  const barcodeChanged = b.barcode !== undefined && String(b.barcode || '').trim() !== String(existing.barcode || '').trim();

  if (!nextMasterId || nameChanged || brandChanged || sizeChanged || barcodeChanged) {
    const syncRes = ensureMasterProductForListing({
      id: String(id),
      name_ar: String(b.name_ar ?? existing.name_ar).trim(),
      name_en: String(b.name_en ?? existing.name_en ?? b.name_ar ?? existing.name_ar).trim(),
      brand: nextBrand,
      category_id: nextCatId,
      barcode: nextBarcode,
      size_value: nextParsedSize?.canonicalValue ?? null,
      size_unit: nextParsedSize?.canonicalUnit ?? '',
      size_label: nextSizeLabel || nextParsedSize?.displayLabel || '',
      image_url: String(b.image_url ?? existing.image_url ?? '').trim(),
      description: String(b.description ?? existing.description ?? '').trim(),
      merchant_id: String(existing.merchant_id),
      master_product_id: nextMasterId,
    });
    nextMasterId = syncRes.master_product_id;
  }

  db.prepare(`
    UPDATE products SET
      product_code = ?, merchant_id = ?, category_id = ?, master_product_id = ?, name_ar = ?, name_en = ?, description = ?, image_url = ?,
      brand = ?, size_label = ?, size_value = ?, size_unit = ?, barcode = ?, merchant_sku = ?, min_order_qty = ?,
      is_weighted = ?, weight_step = ?, weight_unit = ?,
      base_price = ?, sale_price = ?, is_offer = ?, stock_quantity = ?, low_stock_threshold = ?,
      requires_prescription = ?, addons_text = ?, is_available = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    nextCode || existing.product_code || null,
    auth.role === 'merchant' ? existing.merchant_id : (b.merchant_id ?? existing.merchant_id),
    nextCatId,
    nextMasterId,
    b.name_ar ?? existing.name_ar,
    b.name_en ?? existing.name_en,
    b.description !== undefined ? b.description : existing.description,
    b.image_url !== undefined ? b.image_url : existing.image_url,
    nextBrand,
    nextSizeLabel || nextParsedSize?.displayLabel || '',
    nextParsedSize?.canonicalValue ?? existing.size_value ?? null,
    nextParsedSize?.canonicalUnit ?? existing.size_unit ?? '',
    nextBarcode,
    nextMerchantSku,
    nextMinQty,
    nextIsWeighted,
    nextWeightStep,
    nextWeightUnit,
    nextBase,
    nextSale,
    nextIsOffer,
    b.stock_quantity !== undefined ? Math.max(0, Math.floor(Number(b.stock_quantity))) : existing.stock_quantity,
    b.low_stock_threshold !== undefined ? Math.max(0, Math.floor(Number(b.low_stock_threshold))) : existing.low_stock_threshold,
    b.requires_prescription !== undefined ? (b.requires_prescription ? 1 : 0) : existing.requires_prescription,
    b.addons_text !== undefined ? b.addons_text : existing.addons_text,
    b.is_available !== undefined ? (b.is_available ? 1 : 0) : existing.is_available,
    id
  );
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'PRODUCT_UPDATED',
    entity_type: 'products',
    entity_id: id,
    details: `تعديل المنتج: ${b.name_ar ?? existing.name_ar}`,
  });
  res.json({ ok: true, is_offer: Boolean(nextIsOffer) });
});

app.delete('/api/products/:id', requireAuth, requireRole('merchant', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  if (isAdmin && !hasAuthPermission(auth, 'merchants.verify', 'pharmacy.verify_license')) {
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بحذف المنتجات' });
  }

  const { id } = req.params;
  const existing = db.prepare('SELECT id, merchant_id, name_ar FROM products WHERE id = ?').get(id) as
    | { id: string; merchant_id: string; name_ar: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });
  if (auth.role === 'merchant' && String(existing.merchant_id) !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بحذف منتج يتبع متجرًا آخر' });
  }

  const deleteProductTx = db.transaction((productId: string) => {
    db.prepare('DELETE FROM product_deals WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  });
  deleteProductTx(id);
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'PRODUCT_DELETED',
    entity_type: 'products',
    entity_id: id,
    details: `حذف المنتج: ${existing.name_ar}`,
  });
  res.json({ ok: true });
});

// 8. Otlobha Market C2C CRUD & Moderation
app.get('/api/market', (req, res) => {
  const auth = optionalAuth(req);
  const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || (paginated ? '40' : '120')), 10) || 120));
  const offset = (page - 1) * limit;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (isAdminAuth(auth) && hasAuthPermission(auth, 'market.approve', 'market.delete', 'market.disputes')) {
    // admin sees all
  } else if (auth) {
    clauses.push("(moderation_status = 'approved' OR seller_id = ?)");
    params.push(auth.id);
  } else {
    clauses.push("moderation_status = 'approved'");
  }
  if (q) {
    const like = `%${q}%`;
    clauses.push('(title LIKE ? OR description LIKE ? OR category_ar LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM market_listings ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<Record<string, unknown>>;
  const mapped = rows.map((m) => ({ ...m, is_negotiable: Boolean(m.is_negotiable) }));

  if (paginated) {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM market_listings ${whereSql}`).get(...params) as { c: number }).c;
    return res.json({
      items: mapped,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      has_more: offset + mapped.length < total,
    });
  }
  res.json(mapped);
});

app.post('/api/market', requireAuth, (req, res) => {
  const auth = req.auth!;
  const { seller_phone, category_ar, title, description, image_url, condition, price, quantity, zone_name, is_negotiable } = req.body;
  const numPrice = Number(price);
  if (!title || !String(title).trim() || !Number.isFinite(numPrice) || numPrice <= 0) {
    return res.status(400).json({ error: 'اسم المنتج والسعر الصحيح مطلوبان' });
  }
  const numQty = Math.max(1, Math.floor(Number(quantity || 1)));
  const profilePhone = typeof auth.profile?.phone === 'string' ? auth.profile.phone : '';
  const resolvedPhone = String(profilePhone || seller_phone || '01000000000').trim();
  const id = uid('mkt');
  db.prepare(`
    INSERT INTO market_listings (
      id, seller_id, seller_name, seller_phone, category_ar, title, description, image_url, condition, price,
      quantity, zone_name, is_negotiable, moderation_status, reports_count, escrow_held_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, 0)
  `).run(
    id,
    auth.id,
    auth.fullName || 'مستخدم المنزلة',
    resolvedPhone,
    category_ar || 'منتجات يدوية ومنزلية',
    String(title).trim(),
    String(description || ''),
    String(image_url || '').trim(),
    condition === 'new' ? 'new' : 'used',
    numPrice,
    numQty,
    zone_name || 'وسط مدينة المنزلة',
    is_negotiable !== false ? 1 : 0
  );
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'MARKET_LISTING_CREATED',
    entity_type: 'market_listings',
    entity_id: id,
    details: `إضافة إعلان سوق جديد: ${String(title).trim()} (${numPrice} ج.م)`,
  });
  res.status(201).json({ id });
});

app.put('/api/market/:id', requireAuth, (req, res) => {
  const auth = req.auth!;
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM market_listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الإعلان غير موجود' });

  const isModerator = isAdminAuth(auth) && hasAuthPermission(auth, 'market.approve', 'market.delete', 'market.disputes');
  const isOwner = Boolean(existing.seller_id) && String(existing.seller_id) === auth.id;
  if (!isOwner && !isModerator) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل إعلان لا يخصك' });
  }

  const b = req.body;
  const nextPrice = b.price !== undefined ? Number(b.price) : Number(existing.price);
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    return res.status(400).json({ error: 'السعر غير صالح' });
  }
  const nextModerationStatus = isModerator && b.moderation_status !== undefined ? b.moderation_status : existing.moderation_status;

  db.prepare(`
    UPDATE market_listings SET
      category_ar = ?, title = ?, description = ?, image_url = ?, condition = ?, price = ?,
      quantity = ?, zone_name = ?, is_negotiable = ?, moderation_status = ?
    WHERE id = ?
  `).run(
    b.category_ar ?? existing.category_ar,
    b.title !== undefined ? String(b.title).trim() || existing.title : existing.title,
    b.description !== undefined ? b.description : existing.description,
    b.image_url !== undefined ? String(b.image_url || '') : String(existing.image_url || ''),
    b.condition ?? existing.condition,
    nextPrice,
    b.quantity !== undefined ? Math.max(1, Math.floor(Number(b.quantity))) : existing.quantity,
    b.zone_name ?? existing.zone_name,
    b.is_negotiable !== undefined ? (b.is_negotiable ? 1 : 0) : existing.is_negotiable,
    nextModerationStatus,
    id
  );
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'MARKET_LISTING_UPDATED',
    entity_type: 'market_listings',
    entity_id: id,
    details: `تعديل إعلان السوق: ${b.title ?? existing.title}`,
  });
  res.json({ ok: true });
});

app.delete('/api/market/:id', requireAuth, (req, res) => {
  const auth = req.auth!;
  const { id } = req.params;
  const existing = db.prepare('SELECT id, seller_id, title FROM market_listings WHERE id = ?').get(id) as
    | { id: string; seller_id: string | null; title: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'الإعلان غير موجود' });

  const isModerator = isAdminAuth(auth) && hasAuthPermission(auth, 'market.approve', 'market.delete', 'market.disputes');
  const isOwner = Boolean(existing.seller_id) && String(existing.seller_id) === auth.id;
  if (!isOwner && !isModerator) {
    return res.status(403).json({ error: 'غير مصرح لك بحذف إعلان لا يخصك' });
  }

  db.prepare('DELETE FROM market_listings WHERE id = ?').run(id);
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'MARKET_LISTING_DELETED',
    entity_type: 'market_listings',
    entity_id: id,
    details: `حذف إعلان السوق: ${existing.title}`,
  });
  res.json({ ok: true });
});

app.patch('/api/market/:id/moderate', requireAuth, requirePermission('market.approve', 'market.delete'), (req, res) => {
  const { id } = req.params;
  const { moderation_status, reason } = req.body;
  const item = db.prepare('SELECT * FROM market_listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!item) return res.status(404).json({ error: 'الإعلان غير موجود' });

  db.prepare('UPDATE market_listings SET moderation_status = ? WHERE id = ?').run(moderation_status, id);

  if (moderation_status === 'sold' && Number(item.escrow_held_amount) > 0) {
    const rule = db.prepare("SELECT commission_rate FROM pricing_rules WHERE service_type = 'market' LIMIT 1").get() as { commission_rate: number };
    const comm = Number(((Number(item.price) * (rule?.commission_rate ?? 5)) / 100).toFixed(2));
    postDoubleEntryLedger({
      idempotency_base: `market_sold_${id}`,
      reference_type: 'market_listing',
      reference_id: id,
      description_ar: `إتمام بيع السوق واستحقاق عمولة إعلان (${String(item.title)})`,
      debit_account_code: `ESCROW_HOLD_${id}`,
      debit_account_type: 'escrow_hold',
      credit_account_code: 'PLATFORM_REVENUE_MARKET',
      credit_account_type: 'platform_revenue',
      amount: comm,
    });
  }

  recordAuditLog({
    action: 'MARKET_LISTING_MODERATED',
    entity_type: 'market_listings',
    entity_id: id,
    reason: reason ?? 'مراجعة إعلان السوق',
    details: `تحديث إعلان (${String(item.title)}) إلى ${moderation_status}`,
  });

  res.json({ ok: true });
});

// 9. Finance, Wallets, Double-Entry Ledger & Settlements
app.get('/api/finance/ledger', requireAuth, requirePermission('ledger.view'), (_req, res) => {
  const wallets = db
    .prepare('SELECT * FROM wallets ORDER BY (available_balance + pending_balance) DESC, id ASC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
  const walletsTotalCount = (db.prepare('SELECT COUNT(*) as c FROM wallets').get() as { c: number }).c;
  const entries = db.prepare('SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 80').all();
  const settlements = db.prepare('SELECT * FROM settlements ORDER BY created_at DESC LIMIT 150').all();
  const sums = db.prepare('SELECT COALESCE(SUM(debit),0) as total_debit, COALESCE(SUM(credit),0) as total_credit FROM ledger_entries').get() as {
    total_debit: number;
    total_credit: number;
  };
  res.json({
    wallets: wallets.map((w) => ({ ...w, is_frozen: Boolean(w.is_frozen) })),
    wallets_total_count: walletsTotalCount,
    entries,
    settlements,
    reconciliation: {
      total_debit: Number(sums.total_debit.toFixed(2)),
      total_credit: Number(sums.total_credit.toFixed(2)),
      is_balanced: Math.abs(sums.total_debit - sums.total_credit) < 0.01,
    },
  });
});

app.post('/api/finance/wallet-adjust', requireAuth, requirePermission('wallet.adjust_with_reason'), (req, res) => {
  const { wallet_id, direction, amount, reason, idempotency_key } = req.body;
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'لا يُسمح بتعديل أي رصيد يدويًا دون ذكر سبب واضح (5 أحرف على الأقل)' });
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'المبلغ غير صحيح' });
  }

  const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(wallet_id) as Record<string, unknown> | undefined;
  if (!wallet) return res.status(404).json({ error: 'المحفظة غير موجودة' });
  if (direction === 'debit' && Number(wallet.available_balance) < numAmount) {
    return res.status(400).json({ error: 'الرصيد المتاح لا يكفي للخصم' });
  }

  const idem = idempotency_key || `manual_${wallet_id}_${Date.now()}`;
  const runAdjust = db.transaction(() => {
    const ledgerRes = postDoubleEntryLedger({
      idempotency_base: idem,
      reference_type: 'manual_adjustment',
      reference_id: wallet_id,
      description_ar: `تسوية يدوية (${direction === 'credit' ? 'إضافة' : 'خصم'}) — السبب: ${reason}`,
      debit_account_code: direction === 'credit' ? 'PLATFORM_ADJUSTMENT_EXPENSE' : `WALLET_${wallet_id}`,
      debit_account_type: direction === 'credit' ? 'platform_adjustment' : 'customer_liability',
      credit_account_code: direction === 'credit' ? `WALLET_${wallet_id}` : 'PLATFORM_REVENUE_ADJUSTMENT',
      credit_account_type: direction === 'credit' ? 'customer_liability' : 'platform_revenue',
      amount: numAmount,
    });

    if (!ledgerRes.duplicate) {
      const delta = direction === 'credit' ? numAmount : -numAmount;
      db.prepare('UPDATE wallets SET available_balance = available_balance + ? WHERE id = ?').run(delta, wallet_id);
      recordAuditLog({
        action: 'WALLET_MANUAL_ADJUSTMENT',
        entity_type: 'wallets',
        entity_id: wallet_id,
        reason,
        details: `${direction === 'credit' ? 'إضافة' : 'خصم'} ${numAmount} ج.م لحساب ${String(wallet.owner_name)}`,
      });
    }
    return ledgerRes;
  });

  const result = runAdjust();
  res.json({ ok: true, ...result });
});

app.patch('/api/finance/settlements/:id', requireAuth, requirePermission('settlements.approve'), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const st = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!st) return res.status(404).json({ error: 'طلب التسوية غير موجود' });

  db.prepare('UPDATE settlements SET status = ? WHERE id = ?').run(status, id);
  if (status === 'paid') {
    postDoubleEntryLedger({
      idempotency_base: `settlement_paid_${id}`,
      reference_type: 'settlement',
      reference_id: id,
      description_ar: `صرف تسوية مستحقات لـ ${String(st.beneficiary_name)} عبر ${String(st.payout_method)}`,
      debit_account_code: `PAYABLE_${String(st.beneficiary_type).toUpperCase()}_${id}`,
      debit_account_type: `${String(st.beneficiary_type)}_payable`,
      credit_account_code: 'PLATFORM_BANK_OR_CASH',
      credit_account_type: 'gateway_clearing',
      amount: Number(st.net_payout),
    });
  }
  recordAuditLog({
    action: 'SETTLEMENT_UPDATED',
    entity_type: 'settlements',
    entity_id: id,
    details: `تغيير حالة تسوية ${String(st.beneficiary_name)} (${String(st.net_payout)} ج.م) إلى ${status}`,
  });
  res.json({ ok: true });
});

// 10. Coupons, Complaints, Roles, Audit Logs, Financial Model
app.get('/api/coupons', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  const rows = db.prepare('SELECT * FROM coupons').all() as Array<Record<string, unknown>>;
  res.json(
    rows.map((c) => ({
      ...c,
      applicable_services: JSON.parse(String(c.applicable_services_json || '[]')),
      is_active: Boolean(c.is_active),
    }))
  );
});

app.post('/api/coupons', requireAuth, requirePermission('coupons.manage'), (req, res) => {
  const { code, applicable_services, discount_type, discount_value, max_discount, min_order_amount, funded_by, usage_limit_total } = req.body;
  if (!code) return res.status(400).json({ error: 'كود الكوبون مطلوب' });
  const id = uid('cpn');
  db.prepare(`
    INSERT INTO coupons (id, code, applicable_services_json, discount_type, discount_value, max_discount, min_order_amount, funded_by, usage_limit_total, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    String(code).toUpperCase().trim(),
    JSON.stringify(applicable_services || ['stores']),
    discount_type || 'fixed',
    Number(discount_value || 10),
    Number(max_discount || 25),
    Number(min_order_amount || 100),
    funded_by || 'platform',
    Number(usage_limit_total || 100)
  );
  recordAuditLog({
    action: 'COUPON_CREATED',
    entity_type: 'coupons',
    entity_id: id,
    details: `إنشاء كوبون ${String(code).toUpperCase()} بقيمة ${discount_value} (${funded_by})`,
  });
  res.status(201).json({ id });
});

app.patch('/api/coupons/:id', requireAuth, requirePermission('coupons.manage'), (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  db.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
  res.json({ ok: true });
});

app.get('/api/complaints', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  res.json(db.prepare('SELECT * FROM complaints ORDER BY created_at DESC').all());
});

app.patch('/api/complaints/:id', requireAuth, requirePermission('complaints.resolve', 'complaints.pharmacy'), (req, res) => {
  const { id } = req.params;
  const { status, resolution_notes } = req.body;
  db.prepare('UPDATE complaints SET status = ?, resolution_notes = ? WHERE id = ?').run(status, resolution_notes ?? null, id);
  recordAuditLog({
    action: 'COMPLAINT_UPDATED',
    entity_type: 'complaints',
    entity_id: id,
    reason: resolution_notes ?? 'متابعة شكوى',
    details: `تحديث حالة الشكوى إلى ${status}`,
  });
  res.json({ ok: true });
});

app.get('/api/roles', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  const rows = db.prepare('SELECT * FROM roles').all() as Array<Record<string, unknown>>;
  res.json(rows.map((r) => ({ ...r, permissions: JSON.parse(String(r.permissions_json || '[]')) })));
});

// Admin Team & Custom Permissions Management (Section 19 RBAC & Custom Privileges)
app.get('/api/admin/users', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.email, a.full_name, a.role_code, a.custom_permissions_json, a.is_active, a.token_version, a.last_login_at, a.created_at,
              r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
       FROM admin_users a
       JOIN roles r ON r.code = a.role_code
       ORDER BY a.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const result = rows.map((u) => {
    let rolePerms: string[] = [];
    try {
      const p = JSON.parse(String(u.permissions_json || '[]'));
      if (Array.isArray(p)) rolePerms = p.map(String);
    } catch {
      rolePerms = [];
    }

    let customPerms: string[] | null = null;
    if (u.custom_permissions_json && String(u.custom_permissions_json).trim().length > 0) {
      try {
        const cp = JSON.parse(String(u.custom_permissions_json));
        if (Array.isArray(cp)) customPerms = cp.map(String);
      } catch {
        customPerms = null;
      }
    }

    return {
      id: String(u.id),
      email: String(u.email),
      full_name: String(u.full_name),
      role_code: String(u.role_code),
      role_name_ar: String(u.role_name_ar),
      role_name_en: String(u.role_name_en),
      is_active: Number(u.is_active) === 1,
      permissions: customPerms !== null ? customPerms : rolePerms,
      custom_permissions: customPerms,
      last_login_at: u.last_login_at ? String(u.last_login_at) : null,
      created_at: String(u.created_at),
    };
  });

  res.json(result);
});

app.post('/api/admin/users', requireAuth, requireRole('super_admin', 'general_manager'), (req, res) => {
  const { email: rawEmail, password: rawPassword, full_name, role_code, permissions } = req.body as {
    email?: string;
    password?: string;
    full_name?: string;
    role_code?: string;
    permissions?: string[];
  };

  const email = normalizeEmail(String(rawEmail || ''));
  const password = String(rawPassword || '').trim();
  const name = String(full_name || '').trim();
  const role = String(role_code || '').trim();

  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صالح ومقبول' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
  }

  if (!name) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم بالكامل للمستخدم الإداري' });
  }

  const roleExists = db.prepare('SELECT code, name_ar, name_en, permissions_json FROM roles WHERE code = ?').get(role) as
    | { code: string; name_ar: string; name_en: string; permissions_json: string }
    | undefined;

  if (!roleExists) {
    return res.status(400).json({ error: 'الدور الإداري المختار غير صالح' });
  }

  const existing = db.prepare('SELECT id FROM admin_users WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل لمستخدم إداري آخر' });
  }

  const newId = uid('adm');
  const pwHash = hashPassword(password);
  let customPermsJson: string | null = null;
  if (Array.isArray(permissions) && permissions.length > 0) {
    customPermsJson = JSON.stringify(permissions.map(String));
  }

  db.prepare(`
    INSERT INTO admin_users (id, email, password_hash, full_name, role_code, is_active, token_version, custom_permissions_json)
    VALUES (?, ?, ?, ?, ?, 1, 0, ?)
  `).run(newId, email, pwHash, name, role, customPermsJson);

  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: 'ADMIN_USER_CREATED',
    entity_type: 'admin_users',
    entity_id: newId,
    details: `إضافة مستخدم إداري جديد (${name} - ${email}) بدور ${roleExists.name_ar}${customPermsJson ? ` مع تخصيص ${permissions?.length} صلاحيات` : ''}`,
  });

  const createdUser = db.prepare(`
    SELECT a.id, a.email, a.full_name, a.role_code, a.is_active, a.token_version, a.last_login_at, a.created_at, a.custom_permissions_json,
           r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
    FROM admin_users a
    JOIN roles r ON r.code = a.role_code
    WHERE a.id = ?
  `).get(newId) as Record<string, unknown>;

  let rolePerms: string[] = [];
  try {
    const p = JSON.parse(String(createdUser.permissions_json || '[]'));
    if (Array.isArray(p)) rolePerms = p.map(String);
  } catch {
    rolePerms = [];
  }

  res.status(201).json({
    ok: true,
    user: {
      id: String(createdUser.id),
      email: String(createdUser.email),
      full_name: String(createdUser.full_name),
      role_code: String(createdUser.role_code),
      role_name_ar: String(createdUser.role_name_ar),
      role_name_en: String(createdUser.role_name_en),
      is_active: true,
      permissions: customPermsJson ? JSON.parse(customPermsJson) : rolePerms,
      custom_permissions: customPermsJson ? JSON.parse(customPermsJson) : null,
      last_login_at: null,
      created_at: String(createdUser.created_at),
    },
  });
});

app.patch('/api/admin/users/:id', requireAuth, requireRole('super_admin', 'general_manager'), (req, res) => {
  const { id } = req.params;
  const { full_name, email: rawEmail, password, role_code, permissions, is_active } = req.body as {
    full_name?: string;
    email?: string;
    password?: string;
    role_code?: string;
    permissions?: string[] | null;
    is_active?: boolean;
  };

  const existing = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'المستخدم الإداري غير موجود' });
  }

  // Safety protection for super_admin
  if (existing.role_code === 'super_admin') {
    if (role_code && role_code !== 'super_admin') {
      const activeSuperCount = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role_code = 'super_admin' AND is_active = 1").get() as { c: number };
      if (activeSuperCount.c <= 1) {
        return res.status(400).json({ error: 'لا يمكن تغيير دور المالك/المدير الأعلى الوحيد في المنظومة' });
      }
    }
    if (is_active === false) {
      const activeSuperCount = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role_code = 'super_admin' AND is_active = 1").get() as { c: number };
      if (activeSuperCount.c <= 1) {
        return res.status(400).json({ error: 'لا يمكن تعطيل حساب المالك/المدير الأعلى الوحيد' });
      }
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (full_name !== undefined && String(full_name).trim()) {
    updates.push('full_name = ?');
    params.push(String(full_name).trim());
  }

  if (rawEmail !== undefined && String(rawEmail).trim()) {
    const email = String(rawEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
    }
    const duplicate = db.prepare('SELECT id FROM admin_users WHERE LOWER(email) = LOWER(?) AND id != ?').get(email, id);
    if (duplicate) {
      return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل لمستخدم آخر' });
    }
    updates.push('email = ?');
    params.push(email);
  }

  if (role_code !== undefined && String(role_code).trim()) {
    const roleExists = db.prepare('SELECT code FROM roles WHERE code = ?').get(String(role_code).trim());
    if (!roleExists) {
      return res.status(400).json({ error: 'الدور المختار غير صالح' });
    }
    updates.push('role_code = ?');
    params.push(String(role_code).trim());
  }

  if (password !== undefined && String(password).trim().length > 0) {
    if (String(password).trim().length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
    }
    updates.push('password_hash = ?');
    params.push(hashPassword(String(password).trim()));
    updates.push('token_version = token_version + 1');
  }

  if (is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
    if (!is_active) {
      updates.push('token_version = token_version + 1');
    }
  }

  if (permissions !== undefined) {
    if (permissions === null || (Array.isArray(permissions) && permissions.length === 0)) {
      updates.push('custom_permissions_json = NULL');
    } else if (Array.isArray(permissions)) {
      updates.push('custom_permissions_json = ?');
      params.push(JSON.stringify(permissions.map(String)));
    }
  }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: 'ADMIN_USER_UPDATED',
    entity_type: 'admin_users',
    entity_id: id,
    details: `تحديث بيانات وصلاحيات المستخدم الإداري (${existing.full_name} - ${existing.email}) بواسطة ${req.auth!.fullName}`,
  });

  const updatedUser = db.prepare(`
    SELECT a.id, a.email, a.full_name, a.role_code, a.is_active, a.token_version, a.last_login_at, a.created_at, a.custom_permissions_json,
           r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
    FROM admin_users a
    JOIN roles r ON r.code = a.role_code
    WHERE a.id = ?
  `).get(id) as Record<string, unknown>;

  let rolePerms: string[] = [];
  try {
    const p = JSON.parse(String(updatedUser.permissions_json || '[]'));
    if (Array.isArray(p)) rolePerms = p.map(String);
  } catch {
    rolePerms = [];
  }

  let customPerms: string[] | null = null;
  if (updatedUser.custom_permissions_json && String(updatedUser.custom_permissions_json).trim().length > 0) {
    try {
      const cp = JSON.parse(String(updatedUser.custom_permissions_json));
      if (Array.isArray(cp)) customPerms = cp.map(String);
    } catch {
      customPerms = null;
    }
  }

  res.json({
    ok: true,
    user: {
      id: String(updatedUser.id),
      email: String(updatedUser.email),
      full_name: String(updatedUser.full_name),
      role_code: String(updatedUser.role_code),
      role_name_ar: String(updatedUser.role_name_ar),
      role_name_en: String(updatedUser.role_name_en),
      is_active: Number(updatedUser.is_active) === 1,
      permissions: customPerms !== null ? customPerms : rolePerms,
      custom_permissions: customPerms,
      last_login_at: updatedUser.last_login_at ? String(updatedUser.last_login_at) : null,
      created_at: String(updatedUser.created_at),
    },
  });
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('super_admin', 'general_manager'), (req, res) => {
  const { id } = req.params;

  if (req.auth!.id === id) {
    return res.status(400).json({ error: 'لا يمكنك حذف حسابك الإداري الحالي' });
  }

  const user = db.prepare('SELECT id, email, full_name, role_code FROM admin_users WHERE id = ?').get(id) as
    | { id: string; email: string; full_name: string; role_code: string }
    | undefined;

  if (!user) {
    return res.status(404).json({ error: 'المستخدم الإداري غير موجود أو تم حذفه مسبقًا' });
  }

  if (user.role_code === 'super_admin') {
    const activeSuperCount = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role_code = 'super_admin' AND is_active = 1").get() as { c: number };
    if (activeSuperCount.c <= 1) {
      return res.status(400).json({ error: 'لا يمكن حذف المالك/المدير الأعلى الوحيد في المنظومة' });
    }
  }

  // Revoke active sessions
  db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ?").run(id);

  db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);

  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: 'ADMIN_USER_DELETED',
    entity_type: 'admin_users',
    entity_id: id,
    details: `حذف حساب المستخدم الإداري (${user.full_name} - ${user.email} - ${user.role_code}) نهائيًا بواسطة ${req.auth!.fullName}`,
  });

  res.json({ ok: true, id, message: `تم حذف حساب ${user.full_name} نهائيًا` });
});

app.get('/api/audit-logs', requireAuth, requireRole(...ALL_ADMIN_ROLES), (_req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80').all());
});

app.get('/api/financial-model', requireAuth, requirePermission('ledger.view', 'pricing.manage', 'reports.view'), (_req, res) => {
  const row = db.prepare("SELECT config_json FROM financial_model_settings WHERE id = 'default'").get() as { config_json: string };
  const input = JSON.parse(row.config_json) as FinancialModelInput;
  res.json({ input, output: calculateFinancialModel(input) });
});

app.put('/api/financial-model', requireAuth, requireRole('super_admin', 'finance_manager', 'general_manager'), (req, res) => {
  const input = req.body as FinancialModelInput;
  const output = calculateFinancialModel(input);
  db.prepare("UPDATE financial_model_settings SET config_json = ?, updated_at = datetime('now') WHERE id = 'default'").run(JSON.stringify(input));
  recordAuditLog({
    action: 'FINANCIAL_MODEL_UPDATED',
    entity_type: 'financial_model_settings',
    entity_id: 'default',
    details: 'تحديث افتراضات النموذج المالي ذي الثلاثة سيناريوهات من لوحة التحكم',
  });
  res.json({ input, output });
});

function getPaymentSettingsRow() {
  let row = db.prepare("SELECT * FROM payment_settings WHERE id = 'default'").get() as Record<string, unknown> | undefined;
  if (!row) {
    db.prepare(`
      INSERT OR IGNORE INTO payment_settings (
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
    row = db.prepare("SELECT * FROM payment_settings WHERE id = 'default'").get() as Record<string, unknown>;
  }
  return {
    ...row,
    cod_enabled: Boolean(row.cod_enabled),
    network_pos_enabled: Boolean(row.network_pos_enabled),
    wallet_enabled: Boolean(row.wallet_enabled),
    online_card_enabled: Boolean(row.online_card_enabled),
    cod_max_amount: Number(row.cod_max_amount ?? 5000),
    network_min_amount: Number(row.network_min_amount ?? 10),
    cod_instructions_ar: String(row.cod_instructions_ar || 'الدفع نقداً عند استلام الطلب من الكابتن'),
    network_instructions_ar: String(row.network_instructions_ar || 'الدفع ببطاقة مدى / فيزا / ماستركارد عبر ماكينة POS المحمولة مع الكابتن'),
    wallet_instructions_ar: String(row.wallet_instructions_ar || 'التحويل عبر المحافظ الإلكترونية أو فودافون كاش / إنستاباي'),
  };
}

app.get('/api/payment-settings', (_req, res) => {
  res.json(getPaymentSettingsRow());
});

app.put('/api/payment-settings', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const current = getPaymentSettingsRow();
  const cod_enabled = req.body.cod_enabled !== undefined ? (req.body.cod_enabled ? 1 : 0) : (current.cod_enabled ? 1 : 0);
  const network_pos_enabled = req.body.network_pos_enabled !== undefined ? (req.body.network_pos_enabled ? 1 : 0) : (current.network_pos_enabled ? 1 : 0);
  const wallet_enabled = req.body.wallet_enabled !== undefined ? (req.body.wallet_enabled ? 1 : 0) : (current.wallet_enabled ? 1 : 0);
  const online_card_enabled = req.body.online_card_enabled !== undefined ? (req.body.online_card_enabled ? 1 : 0) : (current.online_card_enabled ? 1 : 0);
  const cod_max_amount = req.body.cod_max_amount !== undefined ? Math.max(0, Number(req.body.cod_max_amount)) : current.cod_max_amount;
  const network_min_amount = req.body.network_min_amount !== undefined ? Math.max(0, Number(req.body.network_min_amount)) : current.network_min_amount;
  const cod_instructions_ar = req.body.cod_instructions_ar !== undefined ? String(req.body.cod_instructions_ar).trim() : current.cod_instructions_ar;
  const network_instructions_ar = req.body.network_instructions_ar !== undefined ? String(req.body.network_instructions_ar).trim() : current.network_instructions_ar;
  const wallet_instructions_ar = req.body.wallet_instructions_ar !== undefined ? String(req.body.wallet_instructions_ar).trim() : current.wallet_instructions_ar;

  db.prepare(`
    UPDATE payment_settings SET
      cod_enabled = ?,
      network_pos_enabled = ?,
      wallet_enabled = ?,
      online_card_enabled = ?,
      cod_max_amount = ?,
      network_min_amount = ?,
      cod_instructions_ar = ?,
      network_instructions_ar = ?,
      wallet_instructions_ar = ?,
      updated_at = datetime('now')
    WHERE id = 'default'
  `).run(
    cod_enabled,
    network_pos_enabled,
    wallet_enabled,
    online_card_enabled,
    cod_max_amount,
    network_min_amount,
    cod_instructions_ar,
    network_instructions_ar,
    wallet_instructions_ar
  );

  const updated = getPaymentSettingsRow();
  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: 'PAYMENT_SETTINGS_UPDATED',
    entity_type: 'payment_settings',
    entity_id: 'default',
    details: `تحديث إعدادات الدفع (كاش: ${updated.cod_enabled ? 'مفعل' : 'معطل'}، شبكة/POS: ${updated.network_pos_enabled ? 'مفعل' : 'معطل'}، محفظة: ${updated.wallet_enabled ? 'مفعل' : 'معطل'})`,
  });

  res.json({ ok: true, settings: updated });
});

// 11. Mobile Customer & Captain Endpoints (Flutter + Live Preview)
function buildBootstrapStaticCatalogSnapshot() {
  const services = db.prepare('SELECT * FROM service_configs').all() as Array<Record<string, unknown>>;
  const zones = db.prepare('SELECT * FROM service_zones WHERE is_active = 1').all() as Array<Record<string, unknown>>;
  const merchants = db.prepare("SELECT * FROM merchants WHERE verification_status = 'approved'").all() as Array<Record<string, unknown>>;
  const categories = db
    .prepare(
      `SELECT c.*
       FROM categories c
       LEFT JOIN merchants m ON m.id = c.merchant_id
       WHERE c.is_active = 1
         AND (c.merchant_id IS NULL OR m.verification_status = 'approved')
       ORDER BY c.is_offers_section DESC, c.sort_order ASC`
    )
    .all() as Array<Record<string, unknown>>;

  // High-scale cap: never dump 500,000 products into bootstrap; return top 100 featured/offer items + paginated /api/products for full browsing
  const products = db
    .prepare(
      `SELECT p.*, m.business_name_ar as merchant_name, c.name_ar as category_name, c.is_offers_section as category_is_offers
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id
       JOIN categories c ON c.id = p.category_id
       WHERE p.is_available = 1
         AND m.verification_status = 'approved'
         AND c.is_active = 1
       ORDER BY p.is_offer DESC, p.updated_at DESC
       LIMIT 100`
    )
    .all() as Array<Record<string, unknown>>;

  const productsTotalCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c
         FROM products p
         JOIN merchants m ON m.id = p.merchant_id
         WHERE p.is_available = 1 AND m.verification_status = 'approved'`
      )
      .get() as { c: number }
  ).c;

  // Fast index-only distinct category map per merchant so store section strips work accurately even with 500K products
  const merchantCatPairs = db
    .prepare(
      `SELECT p.merchant_id, p.category_id, COUNT(*) as product_count
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id
       WHERE p.is_available = 1 AND m.verification_status = 'approved'
       GROUP BY p.merchant_id, p.category_id`
    )
    .all() as Array<{ merchant_id: string; category_id: string; product_count: number }>;

  const merchantCategoryIds: Record<string, string[]> = {};
  const merchantProductCounts: Record<string, number> = {};
  for (const row of merchantCatPairs) {
    if (!merchantCategoryIds[row.merchant_id]) merchantCategoryIds[row.merchant_id] = [];
    merchantCategoryIds[row.merchant_id].push(row.category_id);
    merchantProductCounts[row.merchant_id] = (merchantProductCounts[row.merchant_id] || 0) + Number(row.product_count || 0);
  }

  const market = db
    .prepare("SELECT * FROM market_listings WHERE moderation_status = 'approved' ORDER BY created_at DESC LIMIT 60")
    .all() as Array<Record<string, unknown>>;
  const coupons = db
    .prepare('SELECT id, code, applicable_services_json, discount_type, discount_value, max_discount, min_order_amount, is_active FROM coupons WHERE is_active = 1')
    .all() as Array<Record<string, unknown>>;

  return {
    services: services.map((s) => ({ ...s, is_enabled: Boolean(s.is_enabled) })),
    zones,
    merchants: merchants.map((m) => ({
      ...sanitizePublicMerchantRow(m),
      product_count: merchantProductCounts[String(m.id)] || 0,
    })),
    categories: categories.map((c) => ({
      ...c,
      is_active: Boolean(c.is_active),
      is_offers_section: Boolean(c.is_offers_section),
    })),
    merchant_category_ids: merchantCategoryIds,
    products_total_count: productsTotalCount,
    products_paginated: true,
    products: products.map((p) => {
      const hasDiscount = p.sale_price !== null && p.sale_price !== undefined && Number(p.sale_price) < Number(p.base_price);
      return {
        ...p,
        is_offer: Boolean(p.is_offer) || Boolean(p.category_is_offers) || hasDiscount,
        requires_prescription: Boolean(p.requires_prescription),
        is_available: Boolean(p.is_available),
      };
    }),
    market: market.map((m) => ({ ...m, is_negotiable: Boolean(m.is_negotiable) })),
    coupons: coupons.map((c) => ({
      ...c,
      is_active: Boolean(c.is_active),
      applicable_services: JSON.parse(String(c.applicable_services_json || '[]')),
    })),
    payment_settings: getPaymentSettingsRow(),
  };
}

app.get('/api/mobile/customer/guest-bootstrap', (req, res) => {
  const isLite = req.query.lite === '1' || req.query.lite === 'true';
  if (isLite) {
    return res.json({
      is_guest: true,
      lite: true,
      customer: null,
      orders: [],
      trips: [],
      parcels: [],
      ratings: [],
      pending_ratings: [],
      wallet: { available_balance: 0, pending_balance: 0, is_frozen: false },
      notifications: [],
    });
  }
  const catalog = buildBootstrapStaticCatalogSnapshot();
  res.json({
    is_guest: true,
    customer: null,
    ...catalog,
    orders: [],
    trips: [],
    parcels: [],
    ratings: [],
    pending_ratings: [],
    wallet: { available_balance: 0, pending_balance: 0, is_frozen: false },
    notifications: [],
  });
});

app.get('/api/mobile/customer/bootstrap', (req, res) => {
  const auth = optionalAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً للمتابعة' });
  }

  const isLite = req.query.lite === '1' || req.query.lite === 'true';

  const targetCustomerId = String(
    req.query.customer_id || req.headers['x-otlobha-customer-id'] || (auth?.role === 'customer' ? auth.id : '')
  ).trim();
  const targetCaptainId = String(
    req.query.captain_id || req.headers['x-otlobha-captain-id'] || (auth?.role === 'captain' ? auth.id : '')
  ).trim();

  let customerProfile: Record<string, unknown> | null = null;
  let customerPhoneForScope = '';
  if (targetCustomerId) {
    const cRow = db
      .prepare('SELECT id, email, phone, full_name, default_zone_id, address_landmark, is_email_verified FROM customers WHERE id = ?')
      .get(targetCustomerId) as Record<string, unknown> | undefined;
    if (cRow) {
      customerPhoneForScope = String(cRow.phone || '').trim();
      customerProfile = {
        ...cRow,
        is_email_verified: Boolean(cRow.is_email_verified),
      };
    }
  }

  let trips: Array<Record<string, unknown>> = [];
  let parcels: Array<Record<string, unknown>> = [];
  let orders: Array<Record<string, unknown>> = [];
  let ratings: Array<Record<string, unknown>> = [];
  let pendingRatings: Array<Record<string, unknown>> = [];
  let notifications: Array<Record<string, unknown>> = [];
  let wallet: Record<string, unknown> = { available_balance: 0, pending_balance: 0, is_frozen: false };

  const scopeStrictlyToCustomer = auth.role === 'customer' && Boolean(targetCustomerId);

  if (scopeStrictlyToCustomer) {
    trips = db
      .prepare(
        `SELECT t.*,
                c.lat as captain_lat,
                c.lng as captain_lng,
                c.location_updated_at as captain_location_updated_at,
                c.vehicle_model as captain_vehicle_model,
                c.plate_number as captain_plate_number,
                COALESCE(t.captain_phone, c.phone) as captain_phone,
                (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
         FROM trips t
         LEFT JOIN captains c ON c.id = t.captain_id
         WHERE t.customer_id = ? ${customerPhoneForScope ? 'OR t.customer_phone = ?' : ''}
         ORDER BY t.created_at DESC LIMIT 30`
      )
      .all(...(customerPhoneForScope ? [targetCustomerId, customerPhoneForScope] : [targetCustomerId])) as Array<Record<string, unknown>>;

    parcels = db
      .prepare(
        `SELECT * FROM deliveries
         WHERE customer_id = ? ${customerPhoneForScope ? 'OR sender_phone = ?' : ''}
         ORDER BY created_at DESC LIMIT 25`
      )
      .all(...(customerPhoneForScope ? [targetCustomerId, customerPhoneForScope] : [targetCustomerId])) as Array<Record<string, unknown>>;

    const scopedOrderRows = db
      .prepare(
        `SELECT o.*,
                c.lat as captain_lat,
                c.lng as captain_lng,
                c.location_updated_at as captain_location_updated_at,
                m.lat as merchant_lat,
                m.lng as merchant_lng,
                (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
         FROM orders o
         LEFT JOIN captains c ON c.id = o.captain_id
         LEFT JOIN merchants m ON m.id = o.merchant_id
         WHERE o.customer_id = ? ${customerPhoneForScope ? 'OR o.customer_phone = ?' : ''}
         ORDER BY o.created_at DESC LIMIT 40`
      )
      .all(...(customerPhoneForScope ? [targetCustomerId, customerPhoneForScope] : [targetCustomerId])) as Array<Record<string, unknown>>;
    const scopedSecMap = getOrderStoreSectionsMap(scopedOrderRows.map((r) => String(r.id)));
    orders = scopedOrderRows.map((r) => mapOrderRowWithSections(r, scopedSecMap.get(String(r.id)) || [], auth));
  } else {
    // Admin / Captain / Multi-portal preview mode: bounded recent rows
    trips = db
      .prepare(
        `SELECT t.*,
                c.lat as captain_lat,
                c.lng as captain_lng,
                c.location_updated_at as captain_location_updated_at,
                c.vehicle_model as captain_vehicle_model,
                c.plate_number as captain_plate_number,
                COALESCE(t.captain_phone, c.phone) as captain_phone,
                (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
         FROM trips t
         LEFT JOIN captains c ON c.id = t.captain_id
         ORDER BY t.created_at DESC LIMIT 40`
      )
      .all() as Array<Record<string, unknown>>;

    parcels = db.prepare('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT 30').all() as Array<Record<string, unknown>>;

    const allOrderRows = db
      .prepare(
        `SELECT o.*,
                c.lat as captain_lat,
                c.lng as captain_lng,
                c.location_updated_at as captain_location_updated_at,
                m.lat as merchant_lat,
                m.lng as merchant_lng,
                (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
         FROM orders o
         LEFT JOIN captains c ON c.id = o.captain_id
         LEFT JOIN merchants m ON m.id = o.merchant_id
         ORDER BY o.created_at DESC LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;
    const allSecMap = getOrderStoreSectionsMap(allOrderRows.map((r) => String(r.id)));
    orders = allOrderRows.map((r) => mapOrderRowWithSections(r, allSecMap.get(String(r.id)) || [], auth));
  }

  if (targetCustomerId) {
    const wRow = db
      .prepare("SELECT id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen FROM wallets WHERE user_id = ? AND owner_type = 'customer' LIMIT 1")
      .get(targetCustomerId) as Record<string, unknown> | undefined;
    if (wRow) wallet = { ...wRow, is_frozen: Boolean(wRow.is_frozen) };
    const isVerifiedCust = Boolean(customerProfile?.is_email_verified);
    notifications = db
      .prepare(
        `SELECT * FROM notifications
         WHERE target_app IN ('customer', 'all')
           AND (recipient_id IS NULL OR recipient_id = ?)
           AND NOT (? = 1 AND LOWER(COALESCE(deep_link, '')) = 'verify_email' AND recipient_id IS NULL)
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(targetCustomerId, isVerifiedCust ? 1 : 0) as Array<Record<string, unknown>>;
    ratings = db
      .prepare('SELECT * FROM captain_ratings WHERE customer_id = ? ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 40')
      .all(targetCustomerId) as Array<Record<string, unknown>>;
    pendingRatings = ratings.filter((r) => r.status === 'pending');
  } else if (targetCaptainId) {
    const wRow = db
      .prepare("SELECT id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen FROM wallets WHERE user_id = ? AND owner_type = 'captain' LIMIT 1")
      .get(targetCaptainId) as Record<string, unknown> | undefined;
    if (wRow) wallet = { ...wRow, is_frozen: Boolean(wRow.is_frozen) };
    notifications = db
      .prepare("SELECT * FROM notifications WHERE target_app IN ('captain', 'all') AND (recipient_id IS NULL OR recipient_id = ?) ORDER BY created_at DESC LIMIT 30")
      .all(targetCaptainId) as Array<Record<string, unknown>>;
    ratings = db
      .prepare('SELECT * FROM captain_ratings WHERE captain_id = ? ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 40')
      .all(targetCaptainId) as Array<Record<string, unknown>>;
    pendingRatings = ratings.filter((r) => r.status === 'pending');
  } else {
    notifications = db
      .prepare("SELECT * FROM notifications WHERE target_app IN ('customer', 'all') ORDER BY created_at DESC LIMIT 30")
      .all() as Array<Record<string, unknown>>;
    ratings = db
      .prepare('SELECT * FROM captain_ratings ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 40')
      .all() as Array<Record<string, unknown>>;
    pendingRatings = ratings.filter((r) => r.status === 'pending');
  }

  const dynamicPayload = {
    customer: customerProfile,
    orders,
    trips,
    parcels,
    ratings,
    pending_ratings: pendingRatings,
    wallet,
    notifications: notifications.map((n) => ({ ...n, is_read: Boolean(n.is_read) })),
  };

  if (isLite) {
    return res.json({
      lite: true,
      ...dynamicPayload,
    });
  }

  const catalog = buildBootstrapStaticCatalogSnapshot();
  res.json({
    ...catalog,
    ...dynamicPayload,
  });
});

app.patch('/api/mobile/customer/me', requireAuth, requireRole('customer'), (req, res) => {
  const auth = req.auth!;
  const existing = db
    .prepare(
      'SELECT id, email, phone, secondary_phone, full_name, age, country, city, default_zone_id, address_landmark, last_lat, last_lng, is_email_verified, auth_provider, profile_completed FROM customers WHERE id = ?'
    )
    .get(auth.id) as Record<string, unknown> | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'حساب العميل غير موجود' });
  }

  const {
    full_name,
    age,
    country,
    city,
    phone,
    secondary_phone,
    address_landmark,
    default_zone_id,
    last_lat,
    last_lng,
    profile_completed,
  } = (req.body || {}) as {
    full_name?: unknown;
    age?: unknown;
    country?: unknown;
    city?: unknown;
    phone?: unknown;
    secondary_phone?: unknown;
    address_landmark?: unknown;
    default_zone_id?: unknown;
    last_lat?: unknown;
    last_lng?: unknown;
    profile_completed?: unknown;
  };

  let nextName = String(existing.full_name || 'عميل اطلبها').trim();
  if (full_name !== undefined) {
    const trimmed = String(full_name).trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      return res.status(400).json({ error: 'يجب أن يتكون الاسم من حرفين إلى 100 حرف' });
    }
    nextName = trimmed;
  }

  let nextAge: number | null = typeof existing.age === 'number' ? existing.age : null;
  if (age !== undefined && age !== null && String(age).trim() !== '') {
    const parsedAge = Math.trunc(parseLocalizedNumber(age));
    if (!Number.isFinite(parsedAge) || parsedAge < 10 || parsedAge > 110) {
      return res.status(400).json({ error: 'يرجى إدخال عمر صحيح (من 10 إلى 110 سنة)' });
    }
    nextAge = parsedAge;
  } else if (age === null || age === '') {
    nextAge = null;
  }

  let nextCountry = String(existing.country || 'مصر').trim() || 'مصر';
  if (country !== undefined) {
    const trimmedCountry = String(country).trim();
    if (trimmedCountry.length < 2 || trimmedCountry.length > 80) {
      return res.status(400).json({ error: 'يرجى إدخال اسم البلد بشكل صحيح' });
    }
    nextCountry = trimmedCountry;
  }

  let nextCity = String(existing.city || 'المنزلة').trim() || 'المنزلة';
  if (city !== undefined) {
    const trimmedCity = String(city).trim();
    if (trimmedCity.length > 80) {
      return res.status(400).json({ error: 'اسم المدينة طويل جدًا' });
    }
    if (trimmedCity) nextCity = trimmedCity;
  }

  let nextPhone = existing.phone ? String(existing.phone).trim() : null;
  if (phone !== undefined) {
    const trimmedPhone = String(phone).trim();
    if (!trimmedPhone) {
      nextPhone = null;
    } else {
      if (!/^[+0-9\s-]{8,18}$/.test(trimmedPhone)) {
        return res.status(400).json({ error: 'رقم الهاتف الأساسي غير صالح' });
      }
      nextPhone = trimmedPhone;
    }
  }

  let nextSecondaryPhone = existing.secondary_phone ? String(existing.secondary_phone).trim() : null;
  if (secondary_phone !== undefined) {
    const trimmedSec = String(secondary_phone).trim();
    if (!trimmedSec) {
      nextSecondaryPhone = null;
    } else {
      if (!/^[+0-9\s-]{8,18}$/.test(trimmedSec)) {
        return res.status(400).json({ error: 'رقم الهاتف الإضافي غير صالح' });
      }
      nextSecondaryPhone = trimmedSec;
    }
  }

  let nextAddress = String(existing.address_landmark || '').trim();
  if (address_landmark !== undefined) {
    const trimmedAddr = String(address_landmark).trim();
    if (trimmedAddr.length > 250) {
      return res.status(400).json({ error: 'العنوان طويل جدًا (الحد الأقصى 250 حرفًا)' });
    }
    nextAddress = trimmedAddr;
  }

  let nextZoneId = String(existing.default_zone_id || 'zn_city_center');
  if (default_zone_id !== undefined && String(default_zone_id).trim() !== '') {
    const zoneIdCandidate = String(default_zone_id).trim();
    const zoneExists = db
      .prepare('SELECT id FROM service_zones WHERE id = ? AND is_active = 1')
      .get(zoneIdCandidate) as { id: string } | undefined;
    if (!zoneExists) {
      return res.status(400).json({ error: 'منطقة التوصيل غير صالحة' });
    }
    nextZoneId = zoneExists.id;
  }

  const nextLat =
    last_lat !== undefined && last_lat !== null && Number.isFinite(Number(last_lat))
      ? Number(last_lat)
      : (existing.last_lat ?? null);
  const nextLng =
    last_lng !== undefined && last_lng !== null && Number.isFinite(Number(last_lng))
      ? Number(last_lng)
      : (existing.last_lng ?? null);

  let nextCompleted = Number(existing.profile_completed || 0);
  if (profile_completed === true || profile_completed === 1 || profile_completed === '1') {
    if (!nextPhone) {
      return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف الأساسي لإكمال ملفك الشخصي' });
    }
    nextCompleted = 1;
  }

  db.prepare(
    `UPDATE customers
     SET full_name = ?, age = ?, country = ?, city = ?, phone = ?, secondary_phone = ?,
         address_landmark = ?, default_zone_id = ?, last_lat = ?, last_lng = ?,
         profile_completed = ?, location_updated_at = CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN datetime('now') ELSE location_updated_at END
     WHERE id = ?`
  ).run(
    nextName,
    nextAge,
    nextCountry,
    nextCity,
    nextPhone,
    nextSecondaryPhone,
    nextAddress,
    nextZoneId,
    nextLat,
    nextLng,
    nextCompleted,
    nextLat,
    nextLng,
    auth.id
  );

  const updated = db
    .prepare('SELECT * FROM customers WHERE id = ?')
    .get(auth.id) as Record<string, unknown>;

  recordAuditLog({
    actor_name: nextName,
    actor_role: 'customer',
    action: 'CUSTOMER_PROFILE_UPDATED',
    entity_type: 'customers',
    entity_id: auth.id,
    details: 'تحديث بيانات الملف الشخصي للعميل',
  });

  const profileObj = sanitizeCustomerRow(updated);
  res.json({
    ok: true,
    customer: profileObj,
    user: profileObj,
  });
});

function normPhoneKey(raw: unknown): string {
  return String(raw || '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function normNameKey(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function syncCustomerGpsSnapshot(params: {
  customer_id?: string | null;
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
  lat: number;
  lng: number;
  address_landmark?: string | null;
  default_zone_id?: string | null;
}): boolean {
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lng)) return false;

  let target: { id: string } | undefined;
  if (params.customer_id) {
    target = db.prepare('SELECT id FROM customers WHERE id = ?').get(params.customer_id) as { id: string } | undefined;
  }
  if (!target && params.email) {
    target = db.prepare('SELECT id FROM customers WHERE LOWER(email) = LOWER(?)').get(params.email) as { id: string } | undefined;
  }
  if (!target && params.phone) {
    const pKey = normPhoneKey(params.phone);
    if (pKey) {
      const all = db.prepare('SELECT id, phone FROM customers').all() as Array<{ id: string; phone: string | null }>;
      target = all.find((c) => normPhoneKey(c.phone) === pKey);
    }
  }
  if (!target && params.full_name) {
    const nKey = normNameKey(params.full_name);
    if (nKey) {
      const all = db.prepare('SELECT id, full_name FROM customers').all() as Array<{ id: string; full_name: string }>;
      target = all.find((c) => normNameKey(c.full_name) === nKey);
    }
  }
  if (!target) return false;

  db.prepare(`
    UPDATE customers
    SET last_lat = ?,
        last_lng = ?,
        location_updated_at = datetime('now'),
        address_landmark = COALESCE(NULLIF(TRIM(?), ''), address_landmark),
        default_zone_id = COALESCE(NULLIF(TRIM(?), ''), default_zone_id)
    WHERE id = ?
  `).run(
    Number(params.lat.toFixed(6)),
    Number(params.lng.toFixed(6)),
    params.address_landmark ?? '',
    params.default_zone_id ?? '',
    target.id
  );
  return true;
}

app.patch('/api/mobile/customer/location', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const { customer_id, email, phone, full_name, lat, lng, address_landmark, default_zone_id } = req.body as {
    customer_id?: string;
    email?: string;
    phone?: string;
    full_name?: string;
    lat?: number;
    lng?: number;
    address_landmark?: string;
    default_zone_id?: string;
  };
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
    return res.status(400).json({ error: 'إحداثيات GPS غير صالحة' });
  }
  if (!isAdmin && customer_id && String(customer_id) !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بتحديث موقع عميل آخر' });
  }
  const updated = syncCustomerGpsSnapshot({
    customer_id: isAdmin ? customer_id : auth.id,
    email: isAdmin ? email : auth.email,
    phone: isAdmin ? phone : undefined,
    full_name: isAdmin ? full_name : auth.fullName,
    lat: numLat,
    lng: numLng,
    address_landmark,
    default_zone_id,
  });
  res.json({ ok: true, updated, lat: Number(numLat.toFixed(6)), lng: Number(numLng.toFixed(6)) });
});

function buildAdminCustomerDirectory() {
  const registered = db.prepare('SELECT * FROM customers ORDER BY last_login_at DESC, created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  const zones = db.prepare('SELECT * FROM service_zones').all() as Array<Record<string, unknown>>;
  const zoneMap = new Map<string, Record<string, unknown>>(zones.map((z) => [String(z.id), z]));

  const orders = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       ORDER BY o.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const trips = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone,
              (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       ORDER BY t.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const parcels = db.prepare('SELECT * FROM deliveries ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  const ratings = db
    .prepare('SELECT * FROM captain_ratings ORDER BY COALESCE(submitted_at, created_at) DESC')
    .all() as Array<Record<string, unknown>>;
  const tripAudits = db
    .prepare(
      "SELECT * FROM audit_logs WHERE entity_type = 'trips' OR action IN ('TRIP_REQUESTED', 'TRIP_COMPLETED_AND_REMOVED', 'TRIP_CANCELLED_AND_REMOVED', 'TRIP_FINAL_FARE_UPDATED') ORDER BY created_at DESC LIMIT 120"
    )
    .all() as Array<Record<string, unknown>>;

  type CustEntry = {
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
    last_lat: number | null;
    last_lng: number | null;
    location_updated_at: string | null;
  };

  const entries: CustEntry[] = registered.map((c) => {
    const zId = String(c.default_zone_id || 'zn_city_center');
    const zone = zoneMap.get(zId);
    return {
      id: String(c.id),
      is_registered: true,
      full_name: String(c.full_name || 'عميل اطلبها'),
      email: c.email ? String(c.email) : null,
      phone: c.phone ? String(c.phone) : null,
      default_zone_id: zId,
      zone_name: zone ? String(zone.name_ar) : 'وسط مدينة المنزلة',
      address_landmark: String(c.address_landmark || ''),
      is_email_verified: Boolean(c.is_email_verified),
      last_login_at: c.last_login_at ? String(c.last_login_at) : null,
      created_at: c.created_at ? String(c.created_at) : null,
      last_lat: c.last_lat !== null && c.last_lat !== undefined ? Number(c.last_lat) : null,
      last_lng: c.last_lng !== null && c.last_lng !== undefined ? Number(c.last_lng) : null,
      location_updated_at: c.location_updated_at ? String(c.location_updated_at) : null,
    };
  });

  const findRegisteredForRecord = (custId: unknown, phone: unknown, name: unknown): CustEntry | undefined => {
    if (custId) {
      const byId = entries.find((e) => e.id === String(custId));
      if (byId) return byId;
    }
    const pKey = normPhoneKey(phone);
    if (pKey) {
      const byPhone = entries.find((e) => normPhoneKey(e.phone) === pKey);
      if (byPhone) return byPhone;
    }
    const nKey = normNameKey(name);
    if (nKey) {
      const byName = entries.find((e) => normNameKey(e.full_name) === nKey);
      if (byName) return byName;
    }
    return undefined;
  };

  // Synthesize guest entries for activity rows not tied to a registered customer
  const guestMap = new Map<string, CustEntry>();
  const ensureGuest = (name: string, phone: string | null, zoneName: string, landmark: string, createdAt: string | null, lat: number | null, lng: number | null) => {
    const pKey = normPhoneKey(phone);
    const nKey = normNameKey(name);
    const key = pKey ? `p_${pKey}` : `n_${nKey}`;
    if (!key || key === 'p_' || key === 'n_') return;
    if (!guestMap.has(key)) {
      const safeId = `guest_${Buffer.from(key).toString('base64url').slice(0, 16)}`;
      guestMap.set(key, {
        id: safeId,
        is_registered: false,
        full_name: name || 'عميل زائر',
        email: null,
        phone: phone || null,
        default_zone_id: 'zn_city_center',
        zone_name: zoneName || 'وسط مدينة المنزلة',
        address_landmark: landmark || '',
        is_email_verified: false,
        last_login_at: createdAt,
        created_at: createdAt,
        last_lat: lat,
        last_lng: lng,
        location_updated_at: createdAt,
      });
    }
  };

  for (const o of orders) {
    if (!findRegisteredForRecord(o.customer_id, o.customer_phone, o.customer_name)) {
      ensureGuest(
        String(o.customer_name || 'عميل'),
        o.customer_phone ? String(o.customer_phone) : null,
        String(o.zone_name || 'وسط مدينة المنزلة'),
        String(o.address_landmark || ''),
        o.created_at ? String(o.created_at) : null,
        o.customer_lat !== null && o.customer_lat !== undefined ? Number(o.customer_lat) : null,
        o.customer_lng !== null && o.customer_lng !== undefined ? Number(o.customer_lng) : null
      );
    }
  }
  for (const t of trips) {
    if (!findRegisteredForRecord(t.customer_id, t.customer_phone, t.customer_name)) {
      ensureGuest(
        String(t.customer_name || 'عميل'),
        t.customer_phone ? String(t.customer_phone) : null,
        'وسط مدينة المنزلة',
        String(t.pickup_address || ''),
        t.created_at ? String(t.created_at) : null,
        t.pickup_lat !== null && t.pickup_lat !== undefined ? Number(t.pickup_lat) : null,
        t.pickup_lng !== null && t.pickup_lng !== undefined ? Number(t.pickup_lng) : null
      );
    }
  }
  for (const d of parcels) {
    if (!findRegisteredForRecord(d.customer_id, d.sender_phone, d.sender_name)) {
      ensureGuest(
        String(d.sender_name || 'عميل'),
        d.sender_phone ? String(d.sender_phone) : null,
        'وسط مدينة المنزلة',
        String(d.pickup_address || ''),
        d.created_at ? String(d.created_at) : null,
        null,
        null
      );
    }
  }

  const allCustomers = [...entries, ...Array.from(guestMap.values())];

  return allCustomers.map((c) => {
    const matchesCustomer = (custId: unknown, phone: unknown, name: unknown) => {
      if (custId && String(custId) === c.id) return true;
      const cPhone = normPhoneKey(c.phone);
      const rPhone = normPhoneKey(phone);
      if (cPhone && rPhone && cPhone === rPhone) return true;
      const cName = normNameKey(c.full_name);
      const rName = normNameKey(name);
      if (cName && rName && cName === rName) return true;
      return false;
    };

    const custOrders: Array<Record<string, unknown>> = orders
      .filter((o) => matchesCustomer(o.customer_id, o.customer_phone, o.customer_name))
      .map((o) => ({ ...o, is_express: Boolean(o.is_express) }));
    const custTrips = trips.filter((t) => matchesCustomer(t.customer_id, t.customer_phone, t.customer_name));
    const custParcels = parcels.filter((d) => matchesCustomer(d.customer_id, d.sender_phone, d.sender_name));
    const custRatings = ratings.filter((r) => matchesCustomer(null, r.customer_phone, r.customer_name));

    const tripRefIds = new Set([
      ...custTrips.map((t) => String(t.id)),
      ...custRatings.filter((r) => r.ref_type === 'trip').map((r) => String(r.ref_id)),
    ]);
    const tripNumbers = new Set([
      ...custTrips.map((t) => String(t.trip_number)),
      ...custRatings.filter((r) => r.ref_type === 'trip').map((r) => String(r.ref_number)),
    ]);
    const cNameNorm = normNameKey(c.full_name);
    const custTripLogs = tripAudits.filter((a) => {
      if (tripRefIds.has(String(a.entity_id))) return true;
      const det = String(a.details || '');
      for (const tn of tripNumbers) {
        if (tn && det.includes(tn)) return true;
      }
      if (cNameNorm && normNameKey(a.actor_name) === cNameNorm) return true;
      return false;
    });

    const zone = zoneMap.get(c.default_zone_id) || zoneMap.get('zn_city_center');
    const latestTripWithGps = custTrips.find((t) => t.pickup_lat !== null && t.pickup_lng !== null);
    const latestOrderWithGps = custOrders.find((o) => o.customer_lat !== null && o.customer_lng !== null);

    let effLat = c.last_lat;
    let effLng = c.last_lng;
    let gpsSource: 'customer_gps' | 'latest_trip' | 'latest_order' | 'zone_default' = 'customer_gps';
    let gpsUpdatedAt = c.location_updated_at;

    if (effLat === null || effLng === null) {
      if (latestTripWithGps) {
        effLat = Number(latestTripWithGps.pickup_lat);
        effLng = Number(latestTripWithGps.pickup_lng);
        gpsSource = 'latest_trip';
        gpsUpdatedAt = String(latestTripWithGps.created_at || '');
      } else if (latestOrderWithGps) {
        effLat = Number(latestOrderWithGps.customer_lat);
        effLng = Number(latestOrderWithGps.customer_lng);
        gpsSource = 'latest_order';
        gpsUpdatedAt = String(latestOrderWithGps.created_at || '');
      } else {
        effLat = Number(zone?.center_lat ?? 31.1583);
        effLng = Number(zone?.center_lng ?? 31.9369);
        gpsSource = 'zone_default';
      }
    }

    const totalSpent = Number(
      custOrders
        .filter((o) => o.status !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
        .toFixed(2)
    );
    const activeOrdersCount = custOrders.filter(
      (o) => !['delivered', 'cancelled'].includes(String(o.status || ''))
    ).length;

    return {
      summary: {
        id: c.id,
        is_registered: c.is_registered,
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        default_zone_id: c.default_zone_id,
        zone_name: c.zone_name,
        address_landmark: c.address_landmark,
        is_email_verified: c.is_email_verified,
        last_login_at: c.last_login_at,
        created_at: c.created_at,
        lat: effLat,
        lng: effLng,
        gps_source: gpsSource,
        location_updated_at: gpsUpdatedAt,
        orders_count: custOrders.length,
        active_orders_count: activeOrdersCount,
        trips_count: custTrips.length,
        parcels_count: custParcels.length,
        ratings_count: custRatings.length,
        total_spent: totalSpent,
      },
      detail: {
        orders: custOrders,
        trips: custTrips,
        parcels: custParcels,
        ratings: custRatings,
        trip_history_logs: custTripLogs,
      },
    };
  });
}

app.get('/api/admin/customers', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const defaultLimit = paginated ? 50 : 200;
  const limit = Math.min(250, Math.max(1, parseInt(String(req.query.limit || defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const filterMode = typeof req.query.filter === 'string' ? req.query.filter.trim() : 'all';

  const zones = db.prepare('SELECT * FROM service_zones').all() as Array<Record<string, unknown>>;
  const zoneMap = new Map<string, Record<string, unknown>>();
  for (const z of zones) zoneMap.set(String(z.id), z);

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (q) {
    const like = `%${q}%`;
    clauses.push('(c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.address_landmark LIKE ?)');
    params.push(like, like, like, like);
  }
  if (filterMode === 'registered') {
    clauses.push('c.is_email_verified = 1');
  } else if (filterMode === 'active') {
    clauses.push(
      `(EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('delivered', 'cancelled'))
        OR EXISTS (SELECT 1 FROM trips t WHERE t.customer_id = c.id AND t.status NOT IN ('completed', 'cancelled')))`
    );
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const customerRows = db
    .prepare(
      `SELECT c.id, c.full_name, c.email, c.phone, c.default_zone_id, c.address_landmark,
              c.is_email_verified, c.last_login_at, c.created_at, c.last_lat, c.last_lng, c.location_updated_at
       FROM customers c
       ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const custIds = customerRows.map((c) => String(c.id));
  const orderStatsMap = new Map<string, { orders_count: number; active_orders_count: number; total_spent: number }>();
  const tripStatsMap = new Map<string, number>();
  const parcelStatsMap = new Map<string, number>();
  const ratingStatsMap = new Map<string, number>();

  if (custIds.length > 0) {
    const ph = custIds.map(() => '?').join(', ');
    const oStats = db
      .prepare(
        `SELECT customer_id,
                COUNT(*) as orders_count,
                SUM(CASE WHEN status NOT IN ('delivered', 'cancelled') THEN 1 ELSE 0 END) as active_orders_count,
                SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END) as total_spent
         FROM orders
         WHERE customer_id IN (${ph})
         GROUP BY customer_id`
      )
      .all(...custIds) as Array<{ customer_id: string; orders_count: number; active_orders_count: number; total_spent: number }>;
    for (const r of oStats) {
      orderStatsMap.set(r.customer_id, {
        orders_count: Number(r.orders_count || 0),
        active_orders_count: Number(r.active_orders_count || 0),
        total_spent: Number(Number(r.total_spent || 0).toFixed(2)),
      });
    }

    const tStats = db
      .prepare(`SELECT customer_id, COUNT(*) as c FROM trips WHERE customer_id IN (${ph}) GROUP BY customer_id`)
      .all(...custIds) as Array<{ customer_id: string; c: number }>;
    for (const r of tStats) tripStatsMap.set(r.customer_id, Number(r.c || 0));

    const pStats = db
      .prepare(`SELECT customer_id, COUNT(*) as c FROM deliveries WHERE customer_id IN (${ph}) GROUP BY customer_id`)
      .all(...custIds) as Array<{ customer_id: string; c: number }>;
    for (const r of pStats) parcelStatsMap.set(r.customer_id, Number(r.c || 0));

    const rStats = db
      .prepare(`SELECT customer_id, COUNT(*) as c FROM captain_ratings WHERE customer_id IN (${ph}) GROUP BY customer_id`)
      .all(...custIds) as Array<{ customer_id: string; c: number }>;
    for (const r of rStats) ratingStatsMap.set(r.customer_id, Number(r.c || 0));
  }

  const summaries = customerRows.map((c) => {
    const id = String(c.id);
    const zId = String(c.default_zone_id || 'zn_city_center');
    const zone = zoneMap.get(zId) || zoneMap.get('zn_city_center');
    const hasDirectGps = c.last_lat !== null && c.last_lat !== undefined && c.last_lng !== null && c.last_lng !== undefined;
    const oStat = orderStatsMap.get(id);
    return {
      id,
      is_registered: true,
      full_name: String(c.full_name || 'عميل اطلبها'),
      email: c.email ? String(c.email) : null,
      phone: c.phone ? String(c.phone) : null,
      default_zone_id: zId,
      zone_name: zone ? String(zone.name_ar) : 'وسط مدينة المنزلة',
      address_landmark: String(c.address_landmark || ''),
      is_email_verified: Boolean(c.is_email_verified),
      last_login_at: c.last_login_at ? String(c.last_login_at) : null,
      created_at: c.created_at ? String(c.created_at) : null,
      lat: hasDirectGps ? Number(c.last_lat) : Number(zone?.center_lat ?? 31.1583),
      lng: hasDirectGps ? Number(c.last_lng) : Number(zone?.center_lng ?? 31.9369),
      gps_source: (hasDirectGps ? 'customer_gps' : 'zone_default') as 'customer_gps' | 'latest_trip' | 'latest_order' | 'zone_default',
      location_updated_at: c.location_updated_at ? String(c.location_updated_at) : null,
      orders_count: oStat?.orders_count ?? 0,
      active_orders_count: oStat?.active_orders_count ?? 0,
      trips_count: tripStatsMap.get(id) ?? 0,
      parcels_count: parcelStatsMap.get(id) ?? 0,
      ratings_count: ratingStatsMap.get(id) ?? 0,
      total_spent: oStat?.total_spent ?? 0,
    };
  });

  if (paginated) {
    const filteredTotal = (db.prepare(`SELECT COUNT(*) as c FROM customers c ${whereSql}`).get(...params) as { c: number }).c;
    const totalAll = (db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number }).c;
    const verifiedAll = (db.prepare('SELECT COUNT(*) as c FROM customers WHERE is_email_verified = 1').get() as { c: number }).c;
    const activeAll = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT cid) as c FROM (
             SELECT customer_id as cid FROM orders WHERE customer_id IS NOT NULL AND status NOT IN ('delivered', 'cancelled')
             UNION
             SELECT customer_id as cid FROM trips WHERE customer_id IS NOT NULL AND status NOT IN ('completed', 'cancelled')
           )`
        )
        .get() as { c: number }
    ).c;

    return res.json({
      items: summaries,
      total: filteredTotal,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(filteredTotal / limit)),
      has_more: offset + summaries.length < filteredTotal,
      stats: {
        total_customers: totalAll,
        registered_count: verifiedAll,
        active_users_count: activeAll,
      },
    });
  }

  res.json(summaries);
});

app.get('/api/admin/customers/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const { id } = req.params;
  if (id.startsWith('guest_')) {
    const dir = buildAdminCustomerDirectory();
    const match = dir.find((item) => item.summary.id === id);
    if (!match) return res.status(404).json({ error: 'المستخدم غير موجود' });
    return res.json({ customer: match.summary, ...match.detail });
  }

  const cRow = db
    .prepare(
      `SELECT id, full_name, email, phone, default_zone_id, address_landmark,
              is_email_verified, last_login_at, created_at, last_lat, last_lng, location_updated_at
       FROM customers WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!cRow) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const phone = cRow.phone ? String(cRow.phone).trim() : '';
  const zId = String(cRow.default_zone_id || 'zn_city_center');
  const zone = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(zId) as Record<string, unknown> | undefined;

  const custOrdersRaw = db
    .prepare(
      `SELECT o.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              m.lat as merchant_lat,
              m.lng as merchant_lng,
              (SELECT COUNT(*) FROM order_chat_messages m WHERE m.order_id = o.id) as chat_count
       FROM orders o
       LEFT JOIN captains c ON c.id = o.captain_id
       LEFT JOIN merchants m ON m.id = o.merchant_id
       WHERE o.customer_id = ? ${phone ? 'OR o.customer_phone = ?' : ''}
       ORDER BY o.created_at DESC LIMIT 100`
    )
    .all(...(phone ? [id, phone] : [id])) as Array<Record<string, unknown>>;
  const custOrders: Array<Record<string, unknown>> = custOrdersRaw.map((o) => ({ ...o, is_express: Boolean(o.is_express) }));

  const custTrips = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone,
              (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       WHERE t.customer_id = ? ${phone ? 'OR t.customer_phone = ?' : ''}
       ORDER BY t.created_at DESC LIMIT 100`
    )
    .all(...(phone ? [id, phone] : [id])) as Array<Record<string, unknown>>;

  const custParcels = db
    .prepare(
      `SELECT * FROM deliveries
       WHERE customer_id = ? ${phone ? 'OR sender_phone = ?' : ''}
       ORDER BY created_at DESC LIMIT 100`
    )
    .all(...(phone ? [id, phone] : [id])) as Array<Record<string, unknown>>;

  const custRatings = db
    .prepare(
      `SELECT * FROM captain_ratings
       WHERE customer_id = ? ${phone ? 'OR customer_phone = ?' : ''}
       ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 100`
    )
    .all(...(phone ? [id, phone] : [id])) as Array<Record<string, unknown>>;

  const tripIds = custTrips.map((t) => String(t.id));
  const custTripLogs =
    tripIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM audit_logs
             WHERE entity_type = 'trips' AND entity_id IN (${tripIds.map(() => '?').join(', ')})
             ORDER BY created_at DESC LIMIT 60`
          )
          .all(...tripIds) as Array<Record<string, unknown>>)
      : [];

  let effLat = cRow.last_lat !== null && cRow.last_lat !== undefined ? Number(cRow.last_lat) : null;
  let effLng = cRow.last_lng !== null && cRow.last_lng !== undefined ? Number(cRow.last_lng) : null;
  let gpsSource: 'customer_gps' | 'latest_trip' | 'latest_order' | 'zone_default' = 'customer_gps';
  let gpsUpdatedAt = cRow.location_updated_at ? String(cRow.location_updated_at) : null;

  if (effLat === null || effLng === null) {
    const latestTripWithGps = custTrips.find((t) => t.pickup_lat !== null && t.pickup_lng !== null);
    const latestOrderWithGps = custOrders.find((o) => o.customer_lat !== null && o.customer_lng !== null);
    if (latestTripWithGps) {
      effLat = Number(latestTripWithGps.pickup_lat);
      effLng = Number(latestTripWithGps.pickup_lng);
      gpsSource = 'latest_trip';
      gpsUpdatedAt = String(latestTripWithGps.created_at || '');
    } else if (latestOrderWithGps) {
      effLat = Number(latestOrderWithGps.customer_lat);
      effLng = Number(latestOrderWithGps.customer_lng);
      gpsSource = 'latest_order';
      gpsUpdatedAt = String(latestOrderWithGps.created_at || '');
    } else {
      effLat = Number(zone?.center_lat ?? 31.1583);
      effLng = Number(zone?.center_lng ?? 31.9369);
      gpsSource = 'zone_default';
    }
  }

  const totalSpent = Number(
    custOrders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
      .toFixed(2)
  );
  const activeOrdersCount = custOrders.filter(
    (o) => !['delivered', 'cancelled'].includes(String(o.status || ''))
  ).length;

  res.json({
    customer: {
      id,
      is_registered: true,
      full_name: String(cRow.full_name || 'عميل اطلبها'),
      email: cRow.email ? String(cRow.email) : null,
      phone: phone || null,
      default_zone_id: zId,
      zone_name: zone ? String(zone.name_ar) : 'وسط مدينة المنزلة',
      address_landmark: String(cRow.address_landmark || ''),
      is_email_verified: Boolean(cRow.is_email_verified),
      last_login_at: cRow.last_login_at ? String(cRow.last_login_at) : null,
      created_at: cRow.created_at ? String(cRow.created_at) : null,
      lat: effLat,
      lng: effLng,
      gps_source: gpsSource,
      location_updated_at: gpsUpdatedAt,
      orders_count: custOrders.length,
      active_orders_count: activeOrdersCount,
      trips_count: custTrips.length,
      parcels_count: custParcels.length,
      ratings_count: custRatings.length,
      total_spent: totalSpent,
    },
    orders: custOrders,
    trips: custTrips,
    parcels: custParcels,
    ratings: custRatings,
    trip_history_logs: custTripLogs,
  });
});

// 12. Push Notifications & Broadcast Campaigns (Customer App, Captain App, Merchant Portal)
app.get('/api/notifications/fcm-status', requireAuth, requireRole(...ALL_ADMIN_ROLES), async (req, res) => {
  const status = getFcmStatus();
  if (req.query.probe === '1' || req.query.probe === 'true') {
    const probe = await probeFcmAuth();
    return res.json({ ...status, auth_probe: probe });
  }
  res.json(status);
});

app.post('/api/mobile/push/register', requireAuth, requireRole('customer', 'captain', 'merchant'), (req, res) => {
  const auth = req.auth!;
  if (!auth.sessionId || !auth.sessionId.startsWith('ses_')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول بحساب فعلي لتفعيل الإشعارات' });
  }
  const { fcm_token, device_id, platform, app_version, device_label } = req.body || {};
  const cleanToken = typeof fcm_token === 'string' ? fcm_token.trim() : '';
  if (!cleanToken || cleanToken.length < 20) {
    return res.status(400).json({ error: 'رمز FCM غير صالح أو ناقص' });
  }
  const result = registerDeviceToken({
    userId: auth.id,
    userRole: auth.role as PushUserRole,
    fcmToken: cleanToken,
    deviceId: typeof device_id === 'string' ? device_id : null,
    platform: typeof platform === 'string' ? platform : 'android',
    appVersion: typeof app_version === 'string' ? app_version : null,
    deviceLabel: typeof device_label === 'string' ? device_label : null,
  });
  res.json({ ok: true, ...result });
});

app.post('/api/mobile/push/register-guest', (req, res) => {
  const { fcm_token, device_id, platform, app_version, device_label, app } = req.body || {};
  const cleanToken = typeof fcm_token === 'string' ? fcm_token.trim() : '';
  const cleanDeviceId = typeof device_id === 'string' ? device_id.trim() : '';
  if (!cleanToken || cleanToken.length < 20) {
    return res.status(400).json({ error: 'رمز FCM غير صالح أو ناقص' });
  }
  if (!cleanDeviceId || cleanDeviceId.length < 4) {
    return res.status(400).json({ error: 'معرّف الجهاز مطلوب' });
  }
  const rawApp = String(app || '').toLowerCase();
  const role: PushUserRole = rawApp === 'captain' ? 'captain' : rawApp === 'merchant' ? 'merchant' : 'customer';
  const result = registerGuestDeviceToken({
    fcmToken: cleanToken,
    deviceId: cleanDeviceId,
    platform: typeof platform === 'string' ? platform : 'android',
    appVersion: typeof app_version === 'string' ? app_version : null,
    deviceLabel: typeof device_label === 'string' ? device_label : null,
    userRole: role,
  });
  res.json({ ok: true, ...result });
});

app.post('/api/mobile/push/unregister', requireAuth, requireRole('customer', 'captain', 'merchant'), (req, res) => {
  const auth = req.auth!;
  if (!auth.sessionId || !auth.sessionId.startsWith('ses_')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول بحساب فعلي لإلغاء ربط الجهاز' });
  }
  const { fcm_token, device_id } = req.body || {};
  const result = unregisterDeviceToken({
    userId: auth.id,
    userRole: auth.role as PushUserRole,
    fcmToken: typeof fcm_token === 'string' ? fcm_token : null,
    deviceId: typeof device_id === 'string' ? device_id : null,
  });
  res.json({ ok: true, ...result });
});

app.get('/api/mobile/push/devices', requireAuth, requireRole('customer', 'captain', 'merchant'), (req, res) => {
  const auth = req.auth!;
  if (!auth.sessionId || !auth.sessionId.startsWith('ses_')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول بحساب فعلي لعرض الأجهزة المسجلة' });
  }
  const rows = db
    .prepare(
      `SELECT id, device_id, platform, app_version, device_label, is_active, last_seen_at, created_at
       FROM push_device_tokens
       WHERE user_id = ? AND user_role = ? AND is_active = 1
       ORDER BY last_seen_at DESC`
    )
    .all(auth.id, auth.role);
  res.json({ ok: true, devices: rows });
});

app.get('/api/notifications', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const { target_app } = req.query;
  const rows = (
    target_app
      ? db.prepare('SELECT * FROM notifications WHERE target_app = ? ORDER BY created_at DESC LIMIT 100').all(String(target_app))
      : db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all()
  ) as Array<Record<string, unknown>>;
  res.json(rows.map((n) => ({ ...n, is_read: Boolean(n.is_read) })));
});

app.post('/api/notifications', requireAuth, requireRole(...ALL_ADMIN_ROLES), async (req, res) => {
  const { target_app, target_zone, recipient_id, target_segment, category, title_ar, body_ar, deep_link } = req.body;
  if (!title_ar || !body_ar) {
    return res.status(400).json({ error: 'عنوان الإشعار ونص الرسالة مطلوبان' });
  }
  const appTarget = (['customer', 'captain', 'merchant', 'all'].includes(String(target_app))
    ? String(target_app)
    : 'customer') as 'customer' | 'captain' | 'merchant' | 'all';
  const zoneTarget = String(target_zone || 'all');
  const cleanDeepLink = String(deep_link || 'notifications').trim() || 'notifications';
  const cleanSegment = String(target_segment || 'all').trim().toLowerCase();

  const validCategory = (['promo', 'operational', 'compliance', 'alert'].includes(String(category))
    ? String(category)
    : 'operational') as 'promo' | 'operational' | 'compliance' | 'alert';

  // Targeted campaign for unverified customers (especially useful for verify_email campaigns)
  if (appTarget === 'customer' && !recipient_id && cleanSegment === 'unverified_email') {
    let zoneIdFilter: string | null = null;
    if (zoneTarget !== 'all') {
      const zoneRow = db
        .prepare('SELECT id FROM service_zones WHERE id = ? OR name_ar = ? OR name_en = ? LIMIT 1')
        .get(zoneTarget, zoneTarget, zoneTarget) as { id: string } | undefined;
      zoneIdFilter = zoneRow?.id || null;
    }

    const unverifiedCustomers = (
      zoneIdFilter
        ? db
            .prepare(
              `SELECT id, email FROM customers
               WHERE COALESCE(is_email_verified, 0) = 0 AND default_zone_id = ?`
            )
            .all(zoneIdFilter)
        : db.prepare('SELECT id, email FROM customers WHERE COALESCE(is_email_verified, 0) = 0').all()
    ) as Array<{ id: string; email: string | null }>;

    if (unverifiedCustomers.length === 0) {
      return res.status(400).json({ error: 'لا يوجد عملاء ببريد إلكتروني غير موثّق في النطاق المحدد حاليًا' });
    }

    let totalTargetedDevices = 0;
    let totalSentCount = 0;
    let totalFailedCount = 0;
    let fcmEnabled = false;
    let lastReason: string | undefined;
    let firstId = '';

    for (const cust of unverifiedCustomers) {
      const extraData =
        cleanDeepLink === 'verify_email' && cust.email ? { email: String(cust.email).trim() } : undefined;
      const single = await createAndSendNotification({
        targetApp: 'customer',
        targetZone: zoneTarget,
        recipientId: cust.id,
        category: validCategory,
        titleAr: String(title_ar).trim(),
        bodyAr: String(body_ar).trim(),
        deepLink: cleanDeepLink,
        sentBy: req.auth?.fullName || 'Super Admin',
        audienceCount: 1,
        extraData,
      });
      if (!firstId) firstId = single.id;
      fcmEnabled = fcmEnabled || single.fcm_delivery.fcm_enabled;
      totalTargetedDevices += single.fcm_delivery.targeted_devices;
      totalSentCount += single.fcm_delivery.sent_count;
      totalFailedCount += single.fcm_delivery.failed_count;
      if (single.fcm_delivery.reason) lastReason = single.fcm_delivery.reason;
    }

    const topicLabel = 'otlobha_customer_unverified_email';
    recordAuditLog({
      action: 'NOTIFICATION_BROADCAST_SENT',
      entity_type: 'notifications',
      entity_id: firstId,
      details: `إرسال إشعار موجه (${cleanDeepLink}) إلى ${unverifiedCustomers.length} عميل غير موثّق البريد (${zoneTarget}): ${title_ar} — FCM مرسل: ${totalSentCount}/${totalTargetedDevices}`,
    });

    return res.status(201).json({
      id: firstId,
      fcm_topic: topicLabel,
      audience_count: unverifiedCustomers.length,
      recipients_sent: unverifiedCustomers.length,
      fcm_delivery: {
        fcm_enabled: fcmEnabled,
        targeted_devices: totalTargetedDevices,
        sent_count: totalSentCount,
        failed_count: totalFailedCount,
        ...(lastReason ? { reason: lastReason } : {}),
      },
    });
  }

  let audienceCount = 0;
  let extraData: Record<string, string> | undefined;
  if (recipient_id) {
    audienceCount = 1;
    if (appTarget === 'customer' && cleanDeepLink === 'verify_email') {
      const cust = db.prepare('SELECT email FROM customers WHERE id = ?').get(String(recipient_id)) as
        | { email: string | null }
        | undefined;
      if (cust?.email) {
        extraData = { email: String(cust.email).trim() };
      }
    }
  } else if (appTarget === 'captain') {
    const c = db
      .prepare(zoneTarget === 'all' ? 'SELECT COUNT(*) as c FROM captains' : 'SELECT COUNT(*) as c FROM captains WHERE zone_name = ?')
      .get(...(zoneTarget === 'all' ? [] : [zoneTarget])) as { c: number };
    audienceCount = Math.max(c.c, 1);
  } else if (appTarget === 'merchant') {
    const m = db
      .prepare(zoneTarget === 'all' ? 'SELECT COUNT(*) as c FROM merchants' : 'SELECT COUNT(*) as c FROM merchants WHERE zone_name = ?')
      .get(...(zoneTarget === 'all' ? [] : [zoneTarget])) as { c: number };
    audienceCount = Math.max(m.c, 1);
  } else {
    const custCnt = (db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number }).c;
    const capCnt = (db.prepare('SELECT COUNT(*) as c FROM captains').get() as { c: number }).c;
    audienceCount = appTarget === 'all' ? Math.max(custCnt + capCnt, 1) : Math.max(custCnt, 1);
  }

  const result = await createAndSendNotification({
    targetApp: appTarget,
    targetZone: zoneTarget,
    recipientId: recipient_id || null,
    category: validCategory,
    titleAr: String(title_ar).trim(),
    bodyAr: String(body_ar).trim(),
    deepLink: cleanDeepLink,
    sentBy: req.auth?.fullName || 'Super Admin',
    audienceCount,
    extraData,
  });

  recordAuditLog({
    action: 'NOTIFICATION_BROADCAST_SENT',
    entity_type: 'notifications',
    entity_id: result.id,
    details: `إرسال إشعار إلى [${appTarget}] (${zoneTarget}) [${cleanDeepLink}]: ${title_ar} — الموضوع ${result.fcm_topic} — FCM مرسل: ${result.fcm_delivery.sent_count}/${result.fcm_delivery.targeted_devices}`,
  });

  res.status(201).json(result);
});

app.get('/api/mobile/notifications/background-poll', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const rawAuthHeader = String(req.headers.authorization || '').trim();
  const hasBearerHeader = rawAuthHeader.toLowerCase().startsWith('bearer ') && rawAuthHeader.length > 10;
  const auth = optionalAuth(req);
  if (hasBearerHeader && (!auth || auth.sessionId === 'portal_ctx_session')) {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      error: 'token_expired',
      needs_refresh: true,
    });
  }
  const rawRequested = String(req.query.app || '').toLowerCase();
  const requestedApp =
    rawRequested === 'captain' ? 'captain' : rawRequested === 'merchant' ? 'merchant' : 'customer';
  const limit = Math.min(Math.max(Number(req.query.limit || 12) || 12, 1), 25);

  let appName = requestedApp;
  let recipientId: string | null = null;
  let customerIsVerified = false;
  let customerEmail = '';

  if (auth && auth.sessionId !== 'portal_ctx_session' && !isAdminAuth(auth)) {
    appName = auth.role === 'captain' ? 'captain' : auth.role === 'merchant' ? 'merchant' : 'customer';
    recipientId = auth.id;
    if (auth.role === 'customer') {
      const custRow = db
        .prepare('SELECT email, is_email_verified FROM customers WHERE id = ?')
        .get(auth.id) as { email?: string | null; is_email_verified?: number } | undefined;
      customerIsVerified = Boolean(custRow?.is_email_verified);
      customerEmail = String(custRow?.email || '').trim();
    }
  }

  const rows = recipientId
    ? (db
        .prepare(
          `SELECT id, target_app, category, title_ar, body_ar, deep_link, is_read, created_at
           FROM notifications
           WHERE (target_app = ? OR target_app = 'all')
             AND (recipient_id IS NULL OR recipient_id = ?)
             AND COALESCE(is_read, 0) = 0
             AND NOT (? = 1 AND LOWER(COALESCE(deep_link, '')) = 'verify_email' AND recipient_id IS NULL)
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(appName, recipientId, customerIsVerified ? 1 : 0, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT id, target_app, category, title_ar, body_ar, deep_link, is_read, created_at
           FROM notifications
           WHERE (target_app = ? OR target_app = 'all')
             AND recipient_id IS NULL
             AND COALESCE(is_read, 0) = 0
             AND LOWER(COALESCE(deep_link, '')) != 'verify_email'
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(appName, limit) as Array<Record<string, unknown>>);

  const notifications = rows.map((n) => {
    const category = String(n.category || 'operational');
    const deepLink = String(n.deep_link || 'notifications');
    return {
      id: String(n.id || ''),
      title_ar: String(n.title_ar || ''),
      body_ar: String(n.body_ar || ''),
      category,
      deep_link: deepLink,
      channel_id: resolveChannelId(category, deepLink, appName),
      email: customerEmail || undefined,
      created_at: String(n.created_at || ''),
    };
  });

  res.json({
    ok: true,
    authenticated: Boolean(recipientId),
    app: appName,
    notifications,
  });
});

app.get('/api/mobile/notifications', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const rawAuthHeader = String(req.headers.authorization || '').trim();
  const hasBearerHeader = rawAuthHeader.toLowerCase().startsWith('bearer ') && rawAuthHeader.length > 10;
  const auth = req.auth!;
  if (hasBearerHeader && auth.sessionId === 'portal_ctx_session') {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      error: 'token_expired',
      needs_refresh: true,
    });
  }
  const isAdmin = isAdminAuth(auth);
  const appName = isAdmin ? String(req.query.app || 'customer') : auth.role;
  const recipientId = isAdmin ? (req.query.recipient_id ? String(req.query.recipient_id) : '') : auth.id;
  let customerIsVerified = false;
  if (!isAdmin && auth.role === 'customer') {
    const custRow = db.prepare('SELECT is_email_verified FROM customers WHERE id = ?').get(auth.id) as
      | { is_email_verified: number }
      | undefined;
    customerIsVerified = Boolean(custRow?.is_email_verified);
  }
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       WHERE (target_app = ? OR target_app = 'all')
         AND (recipient_id IS NULL OR recipient_id = ?)
         AND NOT (? = 1 AND LOWER(COALESCE(deep_link, '')) = 'verify_email' AND recipient_id IS NULL)
       ORDER BY created_at DESC LIMIT 40`
    )
    .all(appName, recipientId, customerIsVerified ? 1 : 0) as Array<Record<string, unknown>>;
  res.json(rows.map((n) => ({ ...n, is_read: Boolean(n.is_read) })));
});

app.patch('/api/mobile/notifications/read-all', requireAuth, (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const appName = isAdmin
    ? String(req.body?.app || req.query.app || 'customer')
    : auth.role;
  const recipientId = isAdmin
    ? String(req.body?.recipient_id || req.query.recipient_id || '')
    : auth.id;
  const rawIds = Array.isArray(req.body?.ids)
    ? req.body.ids
        .map((v: unknown) => String(v || '').trim())
        .filter((v: string) => v.length > 0 && v.length <= 120)
    : [];

  let updated = 0;
  if (rawIds.length > 0) {
    const placeholders = rawIds.map(() => '?').join(', ');
    if (isAdmin) {
      const info = db
        .prepare(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders}) AND COALESCE(is_read, 0) = 0`)
        .run(...rawIds);
      updated = info.changes;
    } else {
      const info = db
        .prepare(
          `UPDATE notifications
           SET is_read = 1
           WHERE id IN (${placeholders})
             AND (target_app = ? OR target_app = 'all')
             AND (recipient_id IS NULL OR recipient_id = ?)
             AND COALESCE(is_read, 0) = 0`
        )
        .run(...rawIds, appName, recipientId);
      updated = info.changes;
    }
  } else if (isAdmin) {
    const info = db
      .prepare(
        `UPDATE notifications
         SET is_read = 1
         WHERE (target_app = ? OR target_app = 'all')
           AND (recipient_id IS NULL OR recipient_id = ?)
           AND COALESCE(is_read, 0) = 0`
      )
      .run(appName, recipientId);
    updated = info.changes;
  } else {
    const info = db
      .prepare(
        `UPDATE notifications
         SET is_read = 1
         WHERE (target_app = ? OR target_app = 'all')
           AND (recipient_id IS NULL OR recipient_id = ?)
           AND COALESCE(is_read, 0) = 0`
      )
      .run(appName, recipientId);
    updated = info.changes;
  }

  res.json({ ok: true, updated });
});

app.patch('/api/mobile/notifications/:id/read', requireAuth, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!notif) return res.status(404).json({ error: 'الإشعار غير موجود' });
  if (!isAdminAuth(auth)) {
    if (notif.recipient_id && String(notif.recipient_id) !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الإشعار' });
    }
    if (notif.target_app && String(notif.target_app) !== 'all' && String(notif.target_app) !== auth.role) {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الإشعار' });
    }
  }
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/mobile/parcels', requireAuth, (req, res) => {
  const auth = req.auth!;
  let rows: Array<Record<string, unknown>> = [];
  if (isAdminAuth(auth)) {
    rows = db.prepare('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>;
  } else if (auth.role === 'customer') {
    rows = db.prepare('SELECT * FROM deliveries WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').all(auth.id) as Array<Record<string, unknown>>;
  } else if (auth.role === 'captain') {
    const cap = db.prepare('SELECT verification_status FROM captains WHERE id = ?').get(auth.id) as
      | { verification_status?: string }
      | undefined;
    const sql =
      cap?.verification_status === 'approved'
        ? "SELECT * FROM deliveries WHERE captain_id = ? OR (captain_id IS NULL AND status = 'pending') ORDER BY created_at DESC LIMIT 50"
        : 'SELECT * FROM deliveries WHERE captain_id = ? ORDER BY created_at DESC LIMIT 50';
    rows = db.prepare(sql).all(auth.id) as Array<Record<string, unknown>>;
  } else {
    return res.status(403).json({ error: 'غير مصرح بعرض الطرود' });
  }
  res.json(rows);
});

function canAccessTrip(auth: AuthContext, trip: Record<string, unknown>): boolean {
  if (isAdminAuth(auth)) return true;
  if (auth.role === 'customer') return Boolean(trip.customer_id) && String(trip.customer_id) === auth.id;
  if (auth.role === 'captain') return Boolean(trip.captain_id) && String(trip.captain_id) === auth.id;
  return false;
}

app.get('/api/trips', requireAuth, (req, res) => {
  const auth = req.auth!;
  const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const offset = (page - 1) * limit;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (isAdminAuth(auth)) {
    // admin can view all trips
  } else if (auth.role === 'customer') {
    clauses.push('t.customer_id = ?');
    params.push(auth.id);
  } else if (auth.role === 'captain') {
    const cap = db.prepare('SELECT verification_status FROM captains WHERE id = ?').get(auth.id) as
      | { verification_status?: string }
      | undefined;
    if (cap?.verification_status === 'approved') {
      clauses.push(
        "(t.captain_id = ? OR (t.status = 'searching' AND (t.preferred_captain_id IS NULL OR t.preferred_captain_id = ?)))"
      );
      params.push(auth.id, auth.id);
    } else {
      clauses.push('t.captain_id = ?');
      params.push(auth.id);
    }
  } else {
    return res.status(403).json({ error: 'غير مصرح بعرض المشاوير' });
  }

  if (statusFilter && statusFilter !== 'all') {
    clauses.push('t.status = ?');
    params.push(statusFilter);
  }
  if (q) {
    const like = `%${q}%`;
    clauses.push('(t.trip_number LIKE ? OR t.customer_name LIKE ? OR t.customer_phone LIKE ? OR t.dropoff_address LIKE ?)');
    params.push(like, like, like, like);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone,
              (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       ${whereClause}
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  if (paginated) {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM trips t ${whereClause}`).get(...params) as { c: number }).c;
    return res.json({
      items: rows,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      has_more: offset + rows.length < total,
    });
  }

  res.json(rows);
});

app.get('/api/mobile/captains/nearby', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const refLat = Number(req.query.lat || 31.1583);
  const refLng = Number(req.query.lng || 31.9369);
  const vehicleType = req.query.vehicle_type ? String(req.query.vehicle_type) : null;

  // Strictly return ONLY approved captains who are currently online & available
  const rows = db
    .prepare("SELECT * FROM captains WHERE verification_status = 'approved' AND availability_status = 'available'")
    .all() as Array<Record<string, unknown>>;

  const effectiveRows =
    vehicleType && vehicleType !== 'all'
      ? rows.filter((c) => String(c.vehicle_type) === vehicleType)
      : rows;

  const enriched = effectiveRows
    .map((c) => {
      const capLat = Number(c.lat || 31.1583);
      const capLng = Number(c.lng || 31.9369);
      const dist = haversineKm(refLat, refLng, capLat, capLng);
      return {
        id: String(c.id),
        full_name: String(c.full_name),
        vehicle_type: String(c.vehicle_type),
        vehicle_model: String(c.vehicle_model),
        plate_number: String(c.plate_number),
        availability_status: String(c.availability_status),
        lat: capLat,
        lng: capLng,
        location_updated_at: c.location_updated_at ?? null,
        rating_avg: Number(c.rating_avg || 5),
        distance_km: dist,
        eta_min: Math.max(2, Math.round(dist * 3.5)),
        is_eligible_for_rides: Boolean(c.is_eligible_for_rides),
      };
    })
    .sort((a, b) => a.distance_km - b.distance_km);

  res.json(enriched);
});

app.post('/api/mobile/rides', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  // Always keep rides service open & enabled
  db.prepare(`
    UPDATE service_configs
    SET is_enabled = 1, requires_license = 0, license_ready = 1, maintenance_msg_ar = ''
    WHERE service_key = 'rides'
  `).run();

  const {
    customer_name,
    customer_phone,
    vehicle_type,
    pickup_address,
    dropoff_address,
    pickup_lat,
    pickup_lng,
    dropoff_lat,
    dropoff_lng,
    distance_km,
    customer_proposed_fare,
    estimated_fare,
    preferred_captain_id,
  } = req.body;

  const proposedFare = parseLocalizedNumber(customer_proposed_fare ?? estimated_fare ?? 0);
  if (!Number.isFinite(proposedFare) || proposedFare <= 0) {
    return res.status(400).json({ error: 'يرجى كتابة السعر الذي تقترحه للمشوار بالجنيه' });
  }

  const pLat = pickup_lat !== undefined && pickup_lat !== null ? Number(pickup_lat) : 31.1583;
  const pLng = pickup_lng !== undefined && pickup_lng !== null ? Number(pickup_lng) : 31.9369;
  const dLat = dropoff_lat !== undefined && dropoff_lat !== null ? Number(dropoff_lat) : null;
  const dLng = dropoff_lng !== undefined && dropoff_lng !== null ? Number(dropoff_lng) : null;

  let effectiveDistance = Number(distance_km || 0);
  if (dLat !== null && dLng !== null && Number.isFinite(dLat) && Number.isFinite(dLng)) {
    const airKm = haversineKm(pLat, pLng, dLat, dLng);
    effectiveDistance = Math.max(1.0, Number((airKm * 1.25).toFixed(2)));
  }
  if (!effectiveDistance || effectiveDistance <= 0) {
    effectiveDistance = 2.5;
  }

  let preferredCapId: string | null = preferred_captain_id ? String(preferred_captain_id) : null;
  let preferredCapName: string | null = null;
  if (preferredCapId) {
    const capRow = db
      .prepare("SELECT id, full_name FROM captains WHERE id = ? AND verification_status = 'approved' AND availability_status = 'available'")
      .get(preferredCapId) as { id: string; full_name: string } | undefined;
    if (capRow) {
      preferredCapName = capRow.full_name;
    } else {
      preferredCapId = null;
    }
  }

  const rawCustId = auth.role === 'customer' ? auth.id : req.body.customer_id ? String(req.body.customer_id) : null;
  let resolvedCustName = customer_name ? String(customer_name).trim() : '';
  let resolvedCustPhone = customer_phone ? String(customer_phone).trim() : '';
  if (rawCustId) {
    const custRow = db.prepare('SELECT full_name, phone FROM customers WHERE id = ?').get(rawCustId) as
      | { full_name?: string; phone?: string }
      | undefined;
    if (!resolvedCustName && custRow?.full_name) resolvedCustName = custRow.full_name;
    if (!resolvedCustPhone && custRow?.phone) resolvedCustPhone = custRow.phone;
  }
  resolvedCustName = resolvedCustName || auth.fullName || 'عميل المنزلة';
  resolvedCustPhone = resolvedCustPhone || '01000000000';

  const id = uid('trp');
  const tripNumber = `TRP-${Math.floor(2000 + Math.random() * 7900)}`;

  db.prepare(`
    INSERT INTO trips (
      id, trip_number, customer_id, customer_name, customer_phone, vehicle_type,
      pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      distance_km, estimated_fare, customer_proposed_fare, final_fare, fare_updated_by,
      preferred_captain_id, preferred_captain_name,
      captain_id, captain_name, captain_phone, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'customer', ?, ?, NULL, NULL, NULL, 'searching')
  `).run(
    id,
    tripNumber,
    rawCustId,
    resolvedCustName,
    resolvedCustPhone,
    vehicle_type || 'moto',
    pickup_address || 'موقعي الحالي (GPS) - المنزلة',
    dropoff_address || 'شارع بورسعيد - المنزلة',
    pLat,
    pLng,
    dLat,
    dLng,
    effectiveDistance,
    proposedFare,
    proposedFare,
    proposedFare,
    preferredCapId,
    preferredCapName
  );

  syncCustomerGpsSnapshot({
    customer_id: rawCustId,
    phone: resolvedCustPhone,
    full_name: resolvedCustName,
    lat: pLat,
    lng: pLng,
    address_landmark: pickup_address ? String(pickup_address) : null,
  });

  const createdTrip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown>;
  broadcastToRooms(
    ['rides:all', 'admin:all', ...(rawCustId ? [`customer:${rawCustId}`] : []), ...(preferredCapId ? [`captain:${preferredCapId}`] : [])],
    {
      type: 'trip:created',
      trip: createdTrip,
    }
  );

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'TRIP_REQUESTED',
    entity_type: 'trips',
    entity_id: id,
    details: `طلب مشوار ${tripNumber} بسعر مقترح من العميل ${proposedFare} ج.م${preferredCapName ? ` — موجه للطيار ${preferredCapName}` : ' — متاح لاختيار الطيارين'}`,
  });

  if (preferredCapId) {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      targetZone: 'all',
      recipientId: preferredCapId,
      category: 'operational',
      titleAr: `مشوار جديد مخصص لك #${tripNumber}`,
      bodyAr: `طلب مشوار مباشر من ${resolvedCustName} بسعر ${proposedFare} ج.م — اضغط لقبول المشوار.`,
      deepLink: 'trip',
      tripId: id,
      status: 'searching',
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });
  } else {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      targetZone: 'all',
      category: 'operational',
      titleAr: `مشوار جديد متاح #${tripNumber}`,
      bodyAr: `مشوار جديد من ${pickup_address || 'المنزلة'} إلى ${dropoff_address || 'المنزلة'} بقيمة ${proposedFare} ج.م متاح للكباتن.`,
      deepLink: 'trip',
      tripId: id,
      status: 'searching',
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });
  }

  res.status(201).json({
    id,
    trip_number: tripNumber,
    fare: proposedFare,
    customer_proposed_fare: proposedFare,
    final_fare: proposedFare,
    preferred_captain_id: preferredCapId,
    preferred_captain_name: preferredCapName,
    distance_km: effectiveDistance,
    status: 'searching',
    trip: createdTrip,
  });
});

app.patch('/api/trips/:id/fare', requireAuth, requirePermission('pricing.manage', 'dispatch.manage', 'orders.reassign'), (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { final_fare } = req.body;
  const nextFare = parseLocalizedNumber(final_fare);
  if (!Number.isFinite(nextFare) || nextFare <= 0) {
    return res.status(400).json({ error: 'أدخل سعرًا نهائيًا صحيحًا أكبر من صفر' });
  }
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود أو انتهى بالفعل' });
  if (trip.status === 'completed' || trip.status === 'cancelled') {
    return res.status(409).json({ error: 'لا يمكن تعديل السعر بعد إنهاء أو إلغاء المشوار' });
  }

  db.prepare(
    "UPDATE trips SET final_fare = ?, estimated_fare = ?, customer_proposed_fare = CASE WHEN status = 'searching' THEN ? ELSE customer_proposed_fare END, fare_updated_by = ? WHERE id = ?"
  ).run(nextFare, nextFare, nextFare, auth.role, id);

  const fee10 = Number((nextFare * 0.1).toFixed(2));
  const sysMsgId = uid('tmsg');
  db.prepare(`
    INSERT INTO trip_chat_messages (id, trip_id, sender_role, sender_name, message_text, image_url)
    VALUES (?, ?, 'system', 'النظام', ?, NULL)
  `).run(
    sysMsgId,
    id,
    `تم اعتماد السعر النهائي بواسطة الإدارة (${auth.fullName}): ${nextFare} ج.م (حصة التطبيق 10%: ${fee10} ج.م)`
  );

  const updatedTrip = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone
       FROM trips t LEFT JOIN captains c ON c.id = t.captain_id WHERE t.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const savedSysMsg = db.prepare('SELECT * FROM trip_chat_messages WHERE id = ?').get(sysMsgId) as Record<string, unknown>;

  broadcastTripChat(id, {
    type: 'trip:fare_updated',
    trip_id: id,
    final_fare: nextFare,
    fee_10pct: fee10,
    trip: updatedTrip,
    message: savedSysMsg,
  });

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'TRIP_FINAL_FARE_UPDATED',
    entity_type: 'trips',
    entity_id: id,
    details: `تحديث السعر النهائي للمشوار #${String(trip.trip_number)} إلى ${nextFare} ج.م (10% للتطبيق = ${fee10} ج.م)`,
  });

  res.json({ ok: true, final_fare: nextFare, fee_10pct: fee10, trip: updatedTrip, message: savedSysMsg });
});

app.patch('/api/trips/:id/captain', requireAuth, requirePermission('dispatch.manage', 'orders.reassign'), (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { preferred_captain_id } = req.body || {};
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود أو انتهى بالفعل' });
  if (trip.status !== 'searching' || trip.captain_id) {
    return res.status(409).json({ error: 'تم قبول المشوار بالفعل من طيار' });
  }

  let nextPrefId: string | null = preferred_captain_id ? String(preferred_captain_id) : null;
  let nextPrefName: string | null = null;
  let nextVeh = String(trip.vehicle_type || 'moto');
  if (nextPrefId) {
    const cap = db
      .prepare("SELECT id, full_name, vehicle_type FROM captains WHERE id = ? AND verification_status = 'approved'")
      .get(nextPrefId) as { id: string; full_name: string; vehicle_type: string } | undefined;
    if (!cap) return res.status(404).json({ error: 'الطيار المختار غير موجود أو غير معتمد' });
    nextPrefName = cap.full_name;
    if (cap.vehicle_type) nextVeh = cap.vehicle_type;
  }

  db.prepare('UPDATE trips SET preferred_captain_id = ?, preferred_captain_name = ?, vehicle_type = ? WHERE id = ?').run(
    nextPrefId,
    nextPrefName,
    nextVeh,
    id
  );

  const updatedTrip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown>;
  const custRoom = trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [];
  broadcastToRooms(['rides:all', 'admin:all', `trip:${id}`, ...custRoom, ...(nextPrefId ? [`captain:${nextPrefId}`] : [])], {
    type: 'trip:status',
    trip_id: id,
    trip: updatedTrip,
  });

  if (nextPrefId) {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      recipientId: nextPrefId,
      category: 'operational',
      titleAr: `مشوار جديد موجه إليك #${String(trip.trip_number)}`,
      bodyAr: `من ${String(trip.pickup_address || '')} إلى ${String(trip.dropoff_address || '')}`,
      deepLink: 'trip',
      tripId: id,
      channelId: 'otlobha_dispatch_channel',
      sentBy: auth.fullName,
    });
  }

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'TRIP_PREFERRED_CAPTAIN_UPDATED',
    entity_type: 'trips',
    entity_id: id,
    details: `توجيه المشوار #${String(trip.trip_number)} ${nextPrefName ? `للكابتن ${nextPrefName}` : 'لكافة الطيارين'}`,
  });

  res.json({ ok: true, preferred_captain_id: nextPrefId, preferred_captain_name: nextPrefName, trip: updatedTrip });
});

app.post('/api/trips/:id/finish', requireAuth, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود أو تم إنهاؤه بالفعل' });

  const isAdmin = isAdminAuth(auth);
  if (isAdmin) {
    if (!hasAuthPermission(auth, 'dispatch.manage', 'orders.reassign', 'complaints.resolve')) {
      return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بإنهاء المشاوير' });
    }
  } else if (!canAccessTrip(auth, trip)) {
    return res.status(403).json({ error: 'غير مصرح لك بإنهاء مشوار لا يخصك' });
  }

  const actorRole: 'customer' | 'captain' | 'admin' = isAdmin ? 'admin' : auth.role === 'captain' ? 'captain' : 'customer';
  const result = finishTripTransaction({
    tripId: id,
    captainIdOverride: auth.role === 'captain' ? auth.id : null,
    actorRole,
    actorName: auth.fullName,
  });
  if (!result) return res.status(404).json({ error: 'المشوار غير موجود أو تم إنهاؤه بالفعل' });
  if ('conflict' in result && result.conflict) {
    return res.status(409).json({ error: result.error });
  }
  if ('invalidState' in result && result.invalidState) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

app.post('/api/trips/:id/cancel', requireAuth, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { reason } = req.body || {};
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود أو تم إلغاؤه بالفعل' });

  const isAdmin = isAdminAuth(auth);
  if (isAdmin) {
    if (!hasAuthPermission(auth, 'dispatch.manage', 'orders.reassign', 'complaints.resolve')) {
      return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بإلغاء المشاوير' });
    }
  } else if (!canAccessTrip(auth, trip)) {
    return res.status(403).json({ error: 'غير مصرح لك بإلغاء مشوار لا يخصك' });
  }

  const actorRole: 'customer' | 'captain' | 'admin' = isAdmin ? 'admin' : auth.role === 'captain' ? 'captain' : 'customer';
  const result = cancelTripTransaction({
    tripId: id,
    captainIdOverride: auth.role === 'captain' ? auth.id : null,
    actorRole,
    actorName: auth.fullName,
    reason: reason ? String(reason) : undefined,
  });
  if (!result) return res.status(404).json({ error: 'المشوار غير موجود أو تم إلغاؤه بالفعل' });
  if ('conflict' in result && result.conflict) {
    return res.status(409).json({ error: result.error });
  }
  res.json(result);
});

app.get('/api/ratings', requireAuth, (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const { captain_id, status, ref_type } = req.query;
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (isAdmin) {
    if (captain_id) {
      clauses.push('captain_id = ?');
      args.push(String(captain_id));
    }
  } else if (auth.role === 'captain') {
    clauses.push('captain_id = ?');
    args.push(auth.id);
  } else if (auth.role === 'customer') {
    clauses.push('customer_id = ?');
    args.push(auth.id);
  } else {
    return res.status(403).json({ error: 'غير مصرح بعرض التقييمات' });
  }

  if (status) {
    clauses.push('status = ?');
    args.push(String(status));
  }
  if (ref_type) {
    clauses.push('ref_type = ?');
    args.push(String(ref_type));
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM captain_ratings ${where} ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 200`)
    .all(...args);
  res.json(rows);
});

app.get('/api/mobile/ratings/pending', requireAuth, (req, res) => {
  const auth = req.auth!;
  if (isAdminAuth(auth)) {
    const { customer_id } = req.query;
    const rows = customer_id
      ? db
          .prepare("SELECT * FROM captain_ratings WHERE status = 'pending' AND customer_id = ? ORDER BY created_at DESC LIMIT 50")
          .all(String(customer_id))
      : db
          .prepare("SELECT * FROM captain_ratings WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50")
          .all();
    return res.json(rows);
  }
  if (auth.role === 'customer') {
    const rows = db
      .prepare("SELECT * FROM captain_ratings WHERE status = 'pending' AND customer_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(auth.id);
    return res.json(rows);
  }
  return res.status(403).json({ error: 'غير مصرح بعرض التقييمات المعلقة' });
});

app.post('/api/ratings', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const {
    rating_id,
    ref_type,
    ref_id,
    rating,
    comment,
  } = req.body || {};

  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ error: 'التقييم يجب أن يكون من 1 إلى 5 نجوم' });
  }
  const cleanComment = String(comment || '').trim();

  let targetRow: Record<string, unknown> | undefined;
  if (rating_id) {
    targetRow = db.prepare('SELECT * FROM captain_ratings WHERE id = ?').get(String(rating_id)) as Record<string, unknown> | undefined;
    if (!targetRow) return res.status(404).json({ error: 'سجل التقييم غير موجود' });
  } else if (ref_type && ref_id) {
    targetRow = db
      .prepare('SELECT * FROM captain_ratings WHERE ref_type = ? AND ref_id = ?')
      .get(String(ref_type), String(ref_id)) as Record<string, unknown> | undefined;
  } else {
    return res.status(400).json({ error: 'يجب ربط التقييم بطلب أو مشوار أو طرد مكتمل' });
  }

  let verifiedCaptainId = '';
  let verifiedCustomerId: string | null = null;
  let verifiedCustomerName = auth.fullName;
  let verifiedCustomerPhone: string | null = null;
  let verifiedRefType = String(ref_type || 'order');
  let verifiedRefId = String(ref_id || '');
  let verifiedRefNumber = '#OTL';
  let verifiedFinalAmount = 0;

  if (targetRow) {
    if (!isAdmin && String(targetRow.customer_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتقييم عملية لا تخص حسابك' });
    }
    if (String(targetRow.status || '') === 'submitted') {
      return res.status(409).json({ error: 'تم إرسال تقييم لهذه العملية مسبقًا' });
    }
    verifiedCaptainId = String(targetRow.captain_id || '');
    verifiedCustomerId = targetRow.customer_id ? String(targetRow.customer_id) : null;
    verifiedCustomerName = String(targetRow.customer_name || auth.fullName);
    verifiedCustomerPhone = targetRow.customer_phone ? String(targetRow.customer_phone) : null;
    verifiedRefType = String(targetRow.ref_type);
    verifiedRefId = String(targetRow.ref_id);
    verifiedRefNumber = String(targetRow.ref_number || '#OTL');
    verifiedFinalAmount = Number(targetRow.final_amount || 0);
  } else {
    const cleanType = String(ref_type || '');
    const cleanId = String(ref_id || '');
    let entity: Record<string, unknown> | undefined;
    if (cleanType === 'order') {
      entity = db.prepare('SELECT * FROM orders WHERE id = ?').get(cleanId) as Record<string, unknown> | undefined;
      if (!entity) return res.status(404).json({ error: 'الطلب غير موجود' });
      if (String(entity.status) !== 'delivered') {
        return res.status(400).json({ error: 'لا يمكن تقييم الطلب قبل إتمام التوصيل' });
      }
      verifiedRefNumber = String(entity.order_number || '#OTL');
      verifiedFinalAmount = Number(entity.total_amount || 0);
      verifiedCustomerPhone = entity.customer_phone ? String(entity.customer_phone) : null;
    } else if (cleanType === 'trip') {
      entity = db.prepare('SELECT * FROM trips WHERE id = ?').get(cleanId) as Record<string, unknown> | undefined;
      if (!entity) return res.status(404).json({ error: 'المشوار غير موجود' });
      if (String(entity.status) !== 'completed') {
        return res.status(400).json({ error: 'لا يمكن تقييم المشوار قبل إنهائه' });
      }
      verifiedRefNumber = String(entity.trip_number || '#TRP');
      verifiedFinalAmount = Number(entity.final_fare ?? entity.estimated_fare ?? 0);
      verifiedCustomerPhone = entity.customer_phone ? String(entity.customer_phone) : null;
    } else if (cleanType === 'parcel') {
      entity = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(cleanId) as Record<string, unknown> | undefined;
      if (!entity) return res.status(404).json({ error: 'الشحنة غير موجودة' });
      if (String(entity.status) !== 'delivered') {
        return res.status(400).json({ error: 'لا يمكن تقييم الطرد قبل إتمام تسليمه' });
      }
      verifiedRefNumber = String(entity.delivery_number || '#PKG');
      verifiedFinalAmount = Number(entity.delivery_fee || 0);
      verifiedCustomerPhone = entity.sender_phone ? String(entity.sender_phone) : null;
    } else {
      return res.status(400).json({ error: 'نوع العملية المراد تقييمها غير صالح' });
    }

    if (!isAdmin && String(entity.customer_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتقييم عملية لا تخص حسابك' });
    }
    if (!entity.captain_id) {
      return res.status(400).json({ error: 'لا يوجد طيار معين على هذه العملية' });
    }
    verifiedCaptainId = String(entity.captain_id);
    verifiedCustomerId = entity.customer_id ? String(entity.customer_id) : (auth.role === 'customer' ? auth.id : null);
    verifiedCustomerName = auth.role === 'customer' ? auth.fullName : String(entity.customer_name || entity.sender_name || 'عميل اطلبها');
    verifiedRefType = cleanType;
    verifiedRefId = cleanId;
  }

  const cap = db.prepare('SELECT id, full_name FROM captains WHERE id = ?').get(verifiedCaptainId) as
    | { id: string; full_name: string }
    | undefined;
  if (!cap) return res.status(404).json({ error: 'الطيار غير موجود' });

  let savedId = '';
  if (targetRow) {
    savedId = String(targetRow.id);
    db.prepare(`
      UPDATE captain_ratings
      SET rating = ?, comment = ?, status = 'submitted', submitted_at = datetime('now')
      WHERE id = ? AND status != 'submitted'
    `).run(score, cleanComment, savedId);
  } else {
    savedId = uid('rat');
    db.prepare(`
      INSERT INTO captain_ratings (
        id, captain_id, captain_name, customer_id, customer_name, customer_phone,
        ref_type, ref_id, ref_number, final_amount, rating, comment, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'))
    `).run(
      savedId,
      cap.id,
      cap.full_name,
      verifiedCustomerId,
      verifiedCustomerName,
      verifiedCustomerPhone,
      verifiedRefType,
      verifiedRefId,
      verifiedRefNumber,
      verifiedFinalAmount,
      score,
      cleanComment
    );
  }

  const avgRow = db
    .prepare("SELECT COALESCE(AVG(rating), 5.0) as avg_rating FROM captain_ratings WHERE captain_id = ? AND status = 'submitted' AND rating IS NOT NULL")
    .get(cap.id) as { avg_rating: number };
  const nextAvg = Number((avgRow.avg_rating || 5).toFixed(2));
  db.prepare('UPDATE captains SET rating_avg = ? WHERE id = ?').run(nextAvg, cap.id);

  const savedRating = db.prepare('SELECT * FROM captain_ratings WHERE id = ?').get(savedId) as Record<string, unknown>;
  broadcastToRooms(['admin:all', 'rides:all', `captain:${cap.id}`], {
    type: 'rating:submitted',
    rating: savedRating,
    captain_id: cap.id,
    captain_rating_avg: nextAvg,
  });

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CAPTAIN_RATED',
    entity_type: 'captain_ratings',
    entity_id: savedId,
    details: `تقييم الطيار ${cap.full_name} بـ ${score}/5 نجوم عن ${String(savedRating.ref_type)} ${String(savedRating.ref_number)}${cleanComment ? ` — "${cleanComment}"` : ''}`,
  });

  res.status(201).json({ ok: true, rating: savedRating, captain_rating_avg: nextAvg });
});

app.get('/api/mobile/rides/:id/tracking', requireAuth, (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       WHERE t.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'المشوار غير موجود' });
  if (!canAccessTrip(req.auth!, row)) {
    return res.status(403).json({ error: 'غير مصرح لك بتتبع هذا المشوار' });
  }

  const pLat = Number(row.pickup_lat || 31.1583);
  const pLng = Number(row.pickup_lng || 31.9369);
  const capLat = row.captain_lat !== null && row.captain_lat !== undefined ? Number(row.captain_lat) : null;
  const capLng = row.captain_lng !== null && row.captain_lng !== undefined ? Number(row.captain_lng) : null;
  const distToPickup = capLat !== null && capLng !== null ? haversineKm(capLat, capLng, pLat, pLng) : null;

  res.json({
    trip: row,
    captain_gps: capLat !== null && capLng !== null ? {
      lat: capLat,
      lng: capLng,
      updated_at: row.captain_location_updated_at ?? null,
      distance_to_pickup_km: distToPickup,
      eta_min: distToPickup !== null ? Math.max(2, Math.round(distToPickup * 3.5)) : null,
      vehicle_model: row.captain_vehicle_model ?? null,
      plate_number: row.captain_plate_number ?? null,
      phone: row.captain_phone ?? null,
    } : null,
  });
});

app.get('/api/rides/:id/chat', requireAuth, (req, res) => {
  const { id } = req.params;
  const trip = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       WHERE t.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود' });
  if (!canAccessTrip(req.auth!, trip)) {
    return res.status(403).json({ error: 'غير مصرح لك بعرض محادثة هذا المشوار' });
  }

  const messages = db
    .prepare('SELECT * FROM trip_chat_messages WHERE trip_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(id) as Array<Record<string, unknown>>;
  res.json({ trip, messages });
});

app.post('/api/rides/:id/chat', allowAnyUserOrGuest, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { message_text, image_url, sender_role, sender_name } = req.body;
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'المشوار غير موجود' });

  const cleanText = String(message_text || '').trim();
  const cleanImg = image_url ? String(image_url) : null;
  if (!cleanText && !cleanImg) {
    return res.status(400).json({ error: 'أدخل رسالة أو أرفق صورة لإرسالها في الشات' });
  }

  const isAdmin = isAdminAuth(auth);
  const reqRole = String(sender_role || '').trim().toLowerCase();
  const validRole = reqRole === 'customer' || reqRole === 'captain' || reqRole === 'admin' ? reqRole : null;
  const derivedRole = validRole || (isAdmin ? 'admin' : auth.role || 'customer');
  let derivedName = String(sender_name || '').trim();
  if (!derivedName) {
    if (derivedRole === 'captain') {
      derivedName = String(trip.captain_name || auth.fullName || 'الكابتن').trim();
    } else if (derivedRole === 'customer') {
      derivedName = String(trip.customer_name || auth.fullName || 'العميل').trim();
    } else {
      derivedName = `الإدارة (${auth.fullName || 'المشرف'})`;
    }
  }

  const msgId = uid('tmsg');
  db.prepare(`
    INSERT INTO trip_chat_messages (id, trip_id, sender_role, sender_name, message_text, image_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    msgId,
    id,
    derivedRole,
    derivedName,
    cleanText || 'صورة مرفقة',
    cleanImg
  );

  const saved = db.prepare('SELECT * FROM trip_chat_messages WHERE id = ?').get(msgId) as Record<string, unknown>;
  broadcastTripChat(id, {
    type: 'trip_chat:message',
    trip_id: id,
    message: saved,
  });

  const tripPreview = (cleanText || 'صورة مرفقة').slice(0, 140);
  if (derivedRole !== 'customer' && trip.customer_id) {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      recipientId: String(trip.customer_id),
      category: 'operational',
      titleAr: `رسالة جديدة في المشوار #${String(trip.trip_number || id)}`,
      bodyAr: `${derivedName}: ${tripPreview}`,
      deepLink: 'trip_chat',
      tripId: id,
      channelId: 'otlobha_chat_channel',
      sentBy: derivedName,
    });
  }
  if (derivedRole !== 'captain' && trip.captain_id) {
    enqueueSystemPushNotification({
      targetApp: 'captain',
      recipientId: String(trip.captain_id),
      category: 'operational',
      titleAr: `رسالة من الراكب في المشوار #${String(trip.trip_number || id)}`,
      bodyAr: `${derivedName}: ${tripPreview}`,
      deepLink: 'trip_chat',
      tripId: id,
      channelId: 'otlobha_chat_channel',
      sentBy: derivedName,
    });
  }

  res.status(201).json({ message: saved });
});

app.post('/api/mobile/parcels', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const {
    sender_name,
    sender_phone,
    receiver_phone,
    pickup_address,
    dropoff_address,
    zone_id,
    item_category,
    size_tier,
    required_vehicle_type,
    prohibited_confirmed,
    customer_proposed_fee,
    preferred_captain_id,
  } = req.body;
  if (!prohibited_confirmed) {
    return res.status(400).json({ error: 'يجب الإقرار بعدم احتواء الطرد على مواد محظورة قانونًا' });
  }
  const price = calculateServicePrice({
    service_type: 'parcels',
    zone_id: zone_id || 'zn_city_center',
    distance_km: zone_id === 'zn_city_center' ? 2.5 : 7.0,
  });
  const parsedCustomFee =
    customer_proposed_fee !== undefined && customer_proposed_fee !== null && String(customer_proposed_fee).trim() !== ''
      ? parseLocalizedNumber(customer_proposed_fee)
      : NaN;
  const effectiveFee = Number.isFinite(parsedCustomFee) && parsedCustomFee > 0 ? parsedCustomFee : price.customer_total;

  let chosenCapId: string | null = null;
  let chosenCapName: string | null = null;
  if (preferred_captain_id) {
    const capRow = db
      .prepare("SELECT id, full_name FROM captains WHERE id = ? AND verification_status = 'approved' AND availability_status = 'available'")
      .get(String(preferred_captain_id)) as { id: string; full_name: string } | undefined;
    if (capRow) {
      chosenCapId = capRow.id;
      chosenCapName = capRow.full_name;
    }
  }
  const dispatch = chosenCapId
    ? null
    : runSmartDispatch({
        service_type: 'parcels',
        required_vehicle: required_vehicle_type || 'moto',
        pickup_lat: 31.1583,
        pickup_lng: 31.9369,
      });
  const assignedCapId = chosenCapId ?? dispatch?.winner?.captain_id ?? null;
  const assignedCapName = chosenCapName ?? dispatch?.winner?.full_name ?? null;

  const rawCustId = auth.role === 'customer' ? auth.id : req.body.customer_id ? String(req.body.customer_id) : null;
  let resolvedSenderName = '';
  let resolvedSenderPhone = '';
  if (auth.role === 'customer') {
    const custRow = db.prepare('SELECT full_name, phone FROM customers WHERE id = ?').get(auth.id) as
      | { full_name?: string; phone?: string | null }
      | undefined;
    if (!custRow) {
      return res.status(401).json({ error: 'حساب العميل غير موجود' });
    }
    resolvedSenderName = String(custRow.full_name || auth.fullName || 'عميل اطلبها').trim();
    resolvedSenderPhone = custRow.phone ? String(custRow.phone).trim() : '';
  } else {
    resolvedSenderName = sender_name ? String(sender_name).trim() : '';
    resolvedSenderPhone = sender_phone ? String(sender_phone).trim() : '';
    if (rawCustId) {
      const custRow = db.prepare('SELECT full_name, phone FROM customers WHERE id = ?').get(rawCustId) as
        | { full_name?: string; phone?: string | null }
        | undefined;
      if (!resolvedSenderName && custRow?.full_name) resolvedSenderName = custRow.full_name;
      if (!resolvedSenderPhone && custRow?.phone) resolvedSenderPhone = custRow.phone;
    }
    resolvedSenderName = resolvedSenderName || auth.fullName || 'مرسل المنزلة';
    resolvedSenderPhone = resolvedSenderPhone || '';
  }

  const id = uid('del');
  const deliveryNumber = `PKG-${Math.floor(3000 + Math.random() * 6900)}`;
  const otp = String(Math.floor(1000 + Math.random() * 8999));

  db.prepare(`
    INSERT INTO deliveries (id, delivery_number, customer_id, sender_name, sender_phone, receiver_phone, pickup_address, dropoff_address, item_category, size_tier, required_vehicle_type, delivery_fee, delivery_otp, captain_id, captain_name, preferred_captain_id, preferred_captain_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    deliveryNumber,
    rawCustId,
    resolvedSenderName,
    resolvedSenderPhone,
    receiver_phone || '01099999999',
    pickup_address || 'وسط المنزلة',
    dropoff_address || 'البصراط',
    item_category || 'أغراض شخصية',
    size_tier || 'small',
    required_vehicle_type || 'moto',
    effectiveFee,
    otp,
    assignedCapId,
    assignedCapName,
    chosenCapId,
    chosenCapName,
    assignedCapId ? 'assigned' : 'pending'
  );
  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'PARCEL_CREATED',
    entity_type: 'deliveries',
    entity_id: id,
    details: `شحنة ${deliveryNumber} (${item_category}) — رسوم ${effectiveFee} ج.م${assignedCapName ? ` · الطيار: ${assignedCapName}` : ''}`,
  });
  res.status(201).json({ id, delivery_number: deliveryNumber, delivery_fee: effectiveFee, delivery_otp: otp, assigned_captain: assignedCapName });
});

const EMAIL_OTP_MAX_PER_WINDOW = 5;
const EMAIL_OTP_SEND_WINDOW_MIN = 10;
const EMAIL_OTP_MAX_VERIFY_FAILS = 10;
const EMAIL_OTP_FAIL_WINDOW_MIN = 15;

function parseSqliteUtcMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatArabicWaitDuration(seconds: number): string {
  const clamped = Math.max(10, Math.ceil(seconds));
  if (clamped < 60) {
    return `${clamped} ثانية`;
  }
  const mins = Math.ceil(clamped / 60);
  if (mins === 1) return 'دقيقة واحدة';
  if (mins === 2) return 'دقيقتين';
  if (mins <= 10) return `${mins} دقائق`;
  return `${mins} دقيقة`;
}

function checkEmailOtpQuota(
  email: string,
  role: string
): { allowed: true } | { allowed: false; retryAfterSec: number; reason: 'send_limit' | 'fail_limit'; error: string } {
  const sendWindowModifier = `-${EMAIL_OTP_SEND_WINDOW_MIN} minutes`;
  const failWindowModifier = `-${EMAIL_OTP_FAIL_WINDOW_MIN} minutes`;

  const sendStats = db
    .prepare(
      `SELECT COUNT(*) as c, MIN(created_at) as oldest
       FROM email_otp_codes
       WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', ?)`
    )
    .get(email, role, sendWindowModifier) as { c: number; oldest: string | null };

  const failStats = db
    .prepare(
      `SELECT COALESCE(SUM(attempts), 0) as s, MIN(CASE WHEN attempts > 0 THEN created_at END) as oldest_fail
       FROM email_otp_codes
       WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', ?)`
    )
    .get(email, role, failWindowModifier) as { s: number; oldest_fail: string | null };

  if (failStats.s >= EMAIL_OTP_MAX_VERIFY_FAILS) {
    const oldestMs = parseSqliteUtcMs(failStats.oldest_fail);
    const remainingSec = oldestMs
      ? Math.max(30, Math.ceil((oldestMs + EMAIL_OTP_FAIL_WINDOW_MIN * 60 * 1000 - Date.now()) / 1000))
      : EMAIL_OTP_FAIL_WINDOW_MIN * 60;
    return {
      allowed: false,
      retryAfterSec: remainingSec,
      reason: 'fail_limit',
      error: `تم تجاوز الحد المسموح لمحاولات إدخال الرمز الخاطئ لهذا البريد، يرجى الانتظار ${formatArabicWaitDuration(remainingSec)} قبل إعادة المحاولة.`,
    };
  }

  if (sendStats.c >= EMAIL_OTP_MAX_PER_WINDOW) {
    const oldestMs = parseSqliteUtcMs(sendStats.oldest);
    const remainingSec = oldestMs
      ? Math.max(30, Math.ceil((oldestMs + EMAIL_OTP_SEND_WINDOW_MIN * 60 * 1000 - Date.now()) / 1000))
      : EMAIL_OTP_SEND_WINDOW_MIN * 60;
    return {
      allowed: false,
      retryAfterSec: remainingSec,
      reason: 'send_limit',
      error: `تم إرسال الحد الأقصى من رموز التحقق (${EMAIL_OTP_MAX_PER_WINDOW} رموز خلال ${EMAIL_OTP_SEND_WINDOW_MIN} دقائق) لهذا البريد، يرجى الانتظار ${formatArabicWaitDuration(remainingSec)} قبل طلب رمز جديد.`,
    };
  }

  return { allowed: true };
}

function resolveSmtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
} | null {
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  let smtpPass = String(process.env.SMTP_PASS || '').trim();
  if (!smtpUser || !smtpPass) {
    return null;
  }

  const rawHost = String(process.env.SMTP_HOST || '').trim();
  const isValidAsciiHost = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(rawHost);
  if (rawHost && !isValidAsciiHost) {
    console.warn('[Email OTP SMTP Config] Invalid SMTP_HOST value detected; falling back to smtp.gmail.com');
  }
  const host = isValidAsciiHost ? rawHost : 'smtp.gmail.com';

  if (host.toLowerCase() === 'smtp.gmail.com') {
    const compactPass = smtpPass.replace(/\s+/g, '');
    if (/^[a-z]{16}$/i.test(compactPass)) {
      smtpPass = compactPass;
    }
  }

  const parsedPort = Number(String(process.env.SMTP_PORT || '').trim());
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 465;

  const rawSecure = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = port === 465 ? true : port === 587 ? false : rawSecure === 'true';

  const rawFrom = String(process.env.SMTP_FROM || '').trim();
  const from = rawFrom
    ? rawFrom.includes('@')
      ? rawFrom
      : `${rawFrom} <${smtpUser}>`
    : `اطلبها – Otlobha <${smtpUser}>`;

  return { host, port, secure, user: smtpUser, pass: smtpPass, from };
}

async function dispatchEmailOtp(
  email: string,
  code: string,
  options?: { subject?: string; intro?: string; plainText?: string }
): Promise<{ ok: true; delivery_channel: 'smtp' } | { ok: false; error: string }> {
  const smtpCfg = resolveSmtpConfig();
  if (!smtpCfg) {
    return {
      ok: false,
      error: 'خدمة إرسال البريد الإلكتروني (Gmail SMTP) غير مفعلة حاليًا — يرجى التحقق من إعدادات البريد.',
    };
  }
  const mailSubject = options?.subject || `رمز تأكيد الدخول إلى اطلبها: ${code}`;
  const mailIntro =
    options?.intro || 'مرحبًا بك، استخدم رمز التأكيد التالي لإتمام تسجيل الدخول (صالح لمدة 5 دقائق):';
  const mailText =
    options?.plainText || `رمز تأكيد الدخول لمنصة اطلبها هو: ${code} (صالح لمدة 5 دقائق).`;
  try {
    const transporter = nodemailer.createTransport({
      host: smtpCfg.host,
      port: smtpCfg.port,
      secure: smtpCfg.secure,
      auth: { user: smtpCfg.user, pass: smtpCfg.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transporter.sendMail({
      from: smtpCfg.from,
      to: email,
      subject: mailSubject,
      text: mailText,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background: #f8fafc;">
          <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #e2e8f0;">
            <h2 style="color: #0f172a; margin-top: 0;">اطلبها – المنزلة</h2>
            <p style="color: #334155; font-size: 14px;">${mailIntro}</p>
            <div style="text-align: center; margin: 20px 0; padding: 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #ea580c;">
              ${code}
            </div>
            <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.</p>
          </div>
        </div>
      `,
    });
    return { ok: true, delivery_channel: 'smtp' };
  } catch (err) {
    const safeErrMsg = err instanceof Error ? err.message : 'SMTP transport failure';
    const errObj = err as { code?: unknown; responseCode?: unknown; command?: unknown };
    const smtpCode = typeof errObj?.responseCode === 'number' ? Number(errObj.responseCode) : 0;
    const errCode = typeof errObj?.code === 'string' ? errObj.code : '';
    console.error(
      `[Email OTP SMTP Error]: host=${smtpCfg.host} port=${smtpCfg.port} secure=${smtpCfg.secure} code=${errCode || 'N/A'} responseCode=${smtpCode || 'N/A'} msg=${safeErrMsg}`
    );
    const isAuthError =
      errCode === 'EAUTH' ||
      smtpCode === 534 ||
      smtpCode === 535 ||
      /invalid login|username and password not accepted|application-specific password/i.test(safeErrMsg);
    const isRecipientRejected =
      smtpCode === 550 ||
      smtpCode === 551 ||
      smtpCode === 553 ||
      /recipient address rejected|invalid recipient|user unknown|no such user|mailbox unavailable/i.test(safeErrMsg);
    return {
      ok: false,
      error: isRecipientRejected
        ? 'تعذر تسليم الرسالة إلى هذا البريد الإلكتروني لأنه غير موجود أو لا يستقبل رسائل، يرجى التحقق من كتابته بشكل صحيح.'
        : isAuthError
          ? 'تعذر تسجيل الدخول إلى خدمة البريد الإلكتروني على الخادم (Gmail App Password)، يرجى مراجعة إعدادات SMTP على الخادم.'
          : 'تعذر إرسال رمز التأكيد حاليًا بسبب خلل مؤقت في خدمة البريد على الخادم، يرجى المحاولة مرة أخرى بعد قليل.',
    };
  }
}

function timingSafeHexEquals(hexA: string, hexB: string): boolean {
  if (!/^[0-9a-f]+$/i.test(hexA) || !/^[0-9a-f]+$/i.test(hexB)) return false;
  const bufA = Buffer.from(hexA, 'hex');
  const bufB = Buffer.from(hexB, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

app.post('/api/auth/otp/request', async (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`otp_req_ip:${ip}`, 10, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز الحد المسموح لطلبات رمز التأكيد، حاول مرة أخرى بعد قليل' });
  }

  const { email: rawEmail, role = 'customer' } = req.body as { email?: string; role?: 'customer' | 'merchant' };
  if (role !== 'customer' && role !== 'merchant') {
    return res.status(400).json({ error: 'نوع الحساب غير صالح' });
  }
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }

  const quota = checkEmailOtpQuota(email, role);
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSec));
    return res.status(429).json({
      error: quota.error,
      reason: quota.reason,
      retry_after_sec: quota.retryAfterSec,
    });
  }

  const unifiedSuccessMessage = 'تم إرسال رمز التأكيد المكون من 6 أرقام إلى بريدك الإلكتروني على Gmail.';

  if (role === 'merchant') {
    const merchant = db.prepare('SELECT id FROM merchants WHERE LOWER(email) = LOWER(?)').get(email) as
      | { id: string }
      | undefined;
    if (!merchant) {
      return res.status(404).json({
        error: 'لا يوجد حساب تاجر أو صيدلية مسجل بهذا البريد الإلكتروني — يرجى إنشاء حساب تاجر جديد أولًا',
      });
    }
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256Otp(email, role, code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const otpId = uid('otp');

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0').run(email, role);
  db.prepare(`
    INSERT INTO email_otp_codes (id, email, role, code_hash, attempts, is_used, expires_at)
    VALUES (?, ?, ?, ?, 0, 0, ?)
  `).run(otpId, email, role, codeHash, expiresAt);

  const mailRes = await dispatchEmailOtp(email, code);
  if (!mailRes.ok) {
    // Delete unsent OTP record so transient SMTP errors never consume the user's OTP rate limit
    db.prepare('DELETE FROM email_otp_codes WHERE id = ?').run(otpId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: email,
    actor_role: role,
    action: 'EMAIL_OTP_SENT',
    entity_type: 'email_otp_codes',
    entity_id: email,
    details: `إرسال رمز تأكيد OTP إلى البريد ${email} (${role === 'merchant' ? 'تاجر' : 'عميل'}) عبر Gmail SMTP`,
  });

  res.json({
    ok: true,
    email,
    role,
    message: unifiedSuccessMessage,
    expires_in_sec: 300,
    delivery_channel: mailRes.delivery_channel,
  });
});

app.post('/api/auth/otp/verify', (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`otp_verify_ip:${ip}`, 15, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات التحقق المسموح بها، يرجى المحاولة لاحقًا' });
  }

  const { email: rawEmail, code: rawCode, role = 'customer', full_name, phone, password } = req.body as {
    email?: string;
    code?: string;
    role?: 'customer' | 'merchant';
    full_name?: string;
    phone?: string;
    password?: string;
  };
  if (role !== 'customer' && role !== 'merchant') {
    return res.status(400).json({ error: 'نوع الحساب غير صالح' });
  }
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }
  const cleanCode = String(rawCode || '').trim();
  if (!/^[0-9]{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'أدخل رمز التأكيد المكون من 6 أرقام' });
  }

  const cumulativeFailures = (
    db
      .prepare(
        "SELECT COALESCE(SUM(attempts), 0) as s FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', '-15 minutes')"
      )
      .get(email, role) as { s: number }
  ).s;
  if (cumulativeFailures >= 10) {
    return res.status(429).json({ error: 'تم حظر التحقق مؤقتًا بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة' });
  }

  const otpRow = db
    .prepare(
      'SELECT * FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1'
    )
    .get(email, role) as
    | { id: string; code_hash: string; attempts: number; expires_at: string }
    | undefined;

  if (!otpRow) {
    return res.status(400).json({ error: 'لا يوجد رمز تأكيد نشط لهذا البريد، اطلب رمزًا جديدًا' });
  }
  if (Date.now() > Date.parse(otpRow.expires_at)) {
    db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'انتهت صلاحية رمز التأكيد، اطلب رمزًا جديدًا' });
  }
  if (otpRow.attempts >= 5) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى للمحاولات، اطلب رمز تأكيد جديد' });
  }

  const expectedHash = sha256Otp(email, role, cleanCode);
  if (!timingSafeHexEquals(expectedHash, String(otpRow.code_hash || ''))) {
    db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(401).json({ error: 'رمز التأكيد غير صحيح، راجع بريدك وحاول مرة أخرى' });
  }

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);

  if (role === 'merchant') {
    const merchant = db.prepare('SELECT * FROM merchants WHERE LOWER(email) = LOWER(?)').get(email) as
      | Record<string, unknown>
      | undefined;
    if (!merchant) {
      return res.status(404).json({ error: 'حساب التاجر غير موجود' });
    }
    const tokens = issueSessionForUser(req, res, {
      userId: String(merchant.id),
      role: 'merchant',
      actorType: 'merchant',
      tokenVersion: Number(merchant.token_version || 0),
    });
    recordAuditLog({
      actor_name: String(merchant.business_name_ar),
      actor_role: 'merchant',
      action: 'MERCHANT_EMAIL_OTP_LOGIN',
      entity_type: 'merchants',
      entity_id: String(merchant.id),
      details: `تسجيل دخول التاجر ${String(merchant.business_name_ar)} بتأكيد البريد ${email}`,
    });
    return res.json({
      ok: true,
      role: 'merchant',
      user: sanitizeMerchantRow(merchant),
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
      },
    });
  }

  const existingCust = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | Record<string, unknown>
    | undefined;
  const trimmedName = typeof full_name === 'string' ? full_name.trim() : '';
  const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
  const cleanOptionalPass = typeof password === 'string' && password.length >= 6 ? password : '';
  let customerRow: Record<string, unknown>;
  if (existingCust) {
    const nextName = trimmedName || String(existingCust.full_name || 'عميل اطلبها');
    const nextPhone = trimmedPhone || (existingCust.phone ? String(existingCust.phone) : null);
    const hasExistingPw = Boolean(String(existingCust.password_hash || '').trim());
    if (!hasExistingPw && cleanOptionalPass) {
      db.prepare(
        "UPDATE customers SET full_name = ?, phone = ?, password_hash = ?, is_email_verified = 1, last_login_at = datetime('now') WHERE id = ?"
      ).run(nextName, nextPhone, hashPassword(cleanOptionalPass), String(existingCust.id));
    } else {
      db.prepare(
        "UPDATE customers SET full_name = ?, phone = ?, is_email_verified = 1, last_login_at = datetime('now') WHERE id = ?"
      ).run(nextName, nextPhone, String(existingCust.id));
    }
    customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(existingCust.id)) as Record<string, unknown>;
  } else {
    const custId = uid('cust');
    const nextName = trimmedName || email.split('@')[0] || 'عميل اطلبها';
    const pwHash = cleanOptionalPass ? hashPassword(cleanOptionalPass) : null;
    db.prepare(`
      INSERT INTO customers (id, email, phone, password_hash, full_name, default_zone_id, address_landmark, is_email_verified)
      VALUES (?, ?, ?, ?, ?, 'zn_city_center', '', 1)
    `).run(custId, email, trimmedPhone || null, pwHash, nextName);
    customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId) as Record<string, unknown>;
  }

  const tokens = issueSessionForUser(req, res, {
    userId: String(customerRow.id),
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(customerRow.token_version || 0),
  });

  recordAuditLog({
    actor_name: String(customerRow.full_name),
    actor_role: 'customer',
    action: 'CUSTOMER_EMAIL_OTP_LOGIN',
    entity_type: 'customers',
    entity_id: String(customerRow.id),
    details: `تسجيل دخول العميل ${String(customerRow.full_name)} بتأكيد البريد الإلكتروني ${email}`,
  });

  res.json({
    ok: true,
    role: 'customer',
    user: sanitizeCustomerRow(customerRow),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

function sanitizeCustomerRow(row: Record<string, unknown>) {
  const { password_hash: _pw, ...rest } = row;
  const completed = Boolean(row.profile_completed);
  return {
    ...rest,
    age: row.age ?? null,
    country: String(row.country || 'مصر'),
    city: String(row.city || 'المنزلة'),
    secondary_phone: row.secondary_phone ? String(row.secondary_phone) : null,
    auth_provider: String(row.auth_provider || 'email'),
    is_email_verified: Boolean(row.is_email_verified),
    profile_completed: completed,
    needs_profile_completion: !completed,
    has_password: Boolean(String(row.password_hash || '').trim()),
  };
}

function resolvePublicAppUrl(req: express.Request): string {
  const envUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl;
  }
  const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${protoHeader}://${host}`.replace(/\/+$/, '');
}

function hashActionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(`otlobha_action:${rawToken}`).digest('hex');
}

function escapeHtmlSafe(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function dispatchBrandedHtmlEmail(
  email: string,
  params: { subject: string; plainText: string; html: string }
): Promise<{ ok: true; delivery_channel: 'smtp' } | { ok: false; error: string }> {
  const smtpCfg = resolveSmtpConfig();
  if (!smtpCfg) {
    return {
      ok: false,
      error: 'خدمة إرسال البريد الإلكتروني (Gmail SMTP) غير مفعلة حاليًا — يرجى التحقق من إعدادات البريد.',
    };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: smtpCfg.host,
      port: smtpCfg.port,
      secure: smtpCfg.secure,
      auth: { user: smtpCfg.user, pass: smtpCfg.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transporter.sendMail({
      from: smtpCfg.from,
      to: email,
      subject: params.subject,
      text: params.plainText,
      html: params.html,
    });
    return { ok: true, delivery_channel: 'smtp' };
  } catch (err) {
    const safeErrMsg = err instanceof Error ? err.message : 'SMTP transport failure';
    const errObj = err as { code?: unknown; responseCode?: unknown };
    const smtpCode = typeof errObj?.responseCode === 'number' ? Number(errObj.responseCode) : 0;
    const errCode = typeof errObj?.code === 'string' ? errObj.code : '';
    console.error(
      `[Email Link SMTP Error]: host=${smtpCfg.host} port=${smtpCfg.port} secure=${smtpCfg.secure} code=${errCode || 'N/A'} responseCode=${smtpCode || 'N/A'} msg=${safeErrMsg}`
    );
    const isAuthError =
      errCode === 'EAUTH' ||
      smtpCode === 534 ||
      smtpCode === 535 ||
      /invalid login|username and password not accepted|application-specific password/i.test(safeErrMsg);
    const isRecipientRejected =
      smtpCode === 550 ||
      smtpCode === 551 ||
      smtpCode === 553 ||
      /recipient address rejected|invalid recipient|user unknown|no such user|mailbox unavailable/i.test(safeErrMsg);
    return {
      ok: false,
      error: isRecipientRejected
        ? 'تعذر تسليم الرسالة إلى هذا البريد الإلكتروني لأنه غير موجود أو لا يستقبل رسائل، يرجى التحقق من كتابته بشكل صحيح.'
        : isAuthError
          ? 'تعذر تسجيل الدخول إلى خدمة البريد الإلكتروني على الخادم (Gmail App Password)، يرجى مراجعة إعدادات SMTP على الخادم.'
          : 'تعذر إرسال رسالة البريد الإلكتروني حاليًا بسبب خلل مؤقت على الخادم، يرجى المحاولة مرة أخرى بعد قليل.',
    };
  }
}

function renderActionResultPage(params: {
  title: string;
  heading: string;
  body: string;
  success: boolean;
  ctaHref?: string;
  ctaLabel?: string;
}): string {
  const accent = params.success ? '#0D9488' : '#A92224';
  const badgeBg = params.success ? '#F0FDFA' : '#FEF2F2';
  const iconSvg = params.success
    ? '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#A92224" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const ctaBlock = params.ctaHref
    ? `<a href="${escapeHtmlSafe(params.ctaHref)}" style="display:inline-block;margin-top:20px;padding:13px 26px;background:${accent};color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;">${escapeHtmlSafe(params.ctaLabel || 'العودة إلى تطبيق اطلبها')}</a>`
    : '';
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtmlSafe(params.title)}</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:20px;padding:32px 24px;text-align:center;box-shadow:0 12px 32px rgba(15,23,42,0.06);">
    <div style="width:68px;height:68px;margin:0 auto 18px;border-radius:18px;background:${badgeBg};display:flex;align-items:center;justify-content:center;">
      ${iconSvg}
    </div>
    <h1 style="margin:0 0 10px;font-size:21px;font-weight:800;color:#0F172A;">${escapeHtmlSafe(params.heading)}</h1>
    <p style="margin:0;font-size:14.5px;line-height:1.75;color:#475569;">${escapeHtmlSafe(params.body)}</p>
    ${ctaBlock}
    <p style="margin-top:22px;font-size:12px;color:#94A3B8;">اطلبها – Otlobha</p>
  </div>
</body>
</html>`;
}

// Google Sign-In for Customer (Flutter google_sign_in / Firebase Auth & Web Google Identity Services)
const handleCustomerGoogleAuth = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_google_ip:${ip}`, 25, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات تسجيل الدخول، يرجى الانتظار قليلًا' });
  }

  const { id_token } = (req.body || {}) as { id_token?: string };
  if (!id_token || !String(id_token).trim()) {
    return res.status(400).json({ error: 'رمز مصادقة جوجل غير موجود، يرجى المحاولة مرة أخرى' });
  }

  const identity = await verifyGoogleOrFirebaseToken(String(id_token));
  if (!identity || !identity.email) {
    return res.status(401).json({ error: 'تعذر التحقق من حساب جوجل، يرجى إعادة المحاولة' });
  }

  const normalizedEmail = normalizeEmail(identity.email) || identity.email.toLowerCase();
  if (isCloudSqlConfigured() && identity.uid) {
    await getOrCreateUser(identity.uid, normalizedEmail).catch(() => {});
  }
  let customerRow = db
    .prepare('SELECT * FROM customers WHERE google_uid = ? OR LOWER(email) = LOWER(?) LIMIT 1')
    .get(identity.uid, normalizedEmail) as Record<string, unknown> | undefined;

  let isNewCustomer = false;
  if (customerRow) {
    if (String(customerRow.status || 'active') === 'suspended') {
      return res.status(403).json({ error: 'هذا الحساب موقوف حاليًا، يرجى التواصل مع الدعم الفني' });
    }
    const nextName =
      String(customerRow.full_name || '').trim() && String(customerRow.full_name) !== 'عميل اطلبها'
        ? String(customerRow.full_name)
        : identity.name || normalizedEmail.split('@')[0] || 'عميل اطلبها';
    db.prepare(
      `UPDATE customers
       SET google_uid = COALESCE(google_uid, ?),
           auth_provider = CASE WHEN auth_provider = 'email' THEN 'google' ELSE auth_provider END,
           full_name = ?,
           is_email_verified = 1,
           last_login_at = datetime('now')
       WHERE id = ?`
    ).run(identity.uid, nextName, String(customerRow.id));
    customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customerRow.id)) as Record<string, unknown>;
  } else {
    isNewCustomer = true;
    const custId = uid('cust');
    const displayName = identity.name || normalizedEmail.split('@')[0] || 'عميل اطلبها';
    db.prepare(
      `INSERT INTO customers (id, email, phone, password_hash, full_name, default_zone_id, address_landmark, is_email_verified, google_uid, auth_provider, profile_completed)
       VALUES (?, ?, NULL, '', ?, 'zn_city_center', '', 1, ?, 'google', 0)`
    ).run(custId, normalizedEmail, displayName, identity.uid);
    customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId) as Record<string, unknown>;
  }

  const tokens = issueSessionForUser(req, res, {
    userId: String(customerRow.id),
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(customerRow.token_version || 0),
  });

  recordAuditLog({
    actor_name: String(customerRow.full_name || normalizedEmail),
    actor_role: 'customer',
    action: isNewCustomer ? 'CUSTOMER_GOOGLE_REGISTER' : 'CUSTOMER_GOOGLE_LOGIN',
    entity_type: 'customers',
    entity_id: String(customerRow.id),
    details: `${isNewCustomer ? 'تسجيل حساب عميل جديد' : 'تسجيل دخول العميل'} عبر Google (${normalizedEmail})`,
  });

  const sanitized = sanitizeCustomerRow(customerRow);
  return res.json({
    ok: true,
    role: 'customer',
    is_new_user: isNewCustomer,
    needs_profile_completion: sanitized.needs_profile_completion,
    user: sanitized,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
};

app.post('/api/mobile/customer/auth/google', handleCustomerGoogleAuth);
app.post('/api/auth/customer/google', handleCustomerGoogleAuth);

// Direct Customer Registration (NO prior email verification required — enters app immediately
// and receives an in-app + push notification to verify email on external hosted page)
const handleCustomerDirectRegister = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_direct_reg_ip:${ip}`, 15, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات التسجيل، يرجى المحاولة بعد قليل' });
  }

  const { full_name, email: rawEmail, password, phone: rawPhone } = (req.body || {}) as {
    full_name?: string;
    email?: string;
    password?: string;
    phone?: string;
  };
  const cleanName = String(full_name || '').trim();
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanPass = String(password || '');
  const cleanPhone = String(rawPhone || '').trim();

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل (حرفين على الأقل)' });
  }
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
  }
  if (cleanPhone && !/^[+0-9\s-]{8,18}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
  }

  const existing = db.prepare('SELECT id FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string }
    | undefined;
  if (existing) {
    return res.status(409).json({
      error: 'هذا البريد الإلكتروني مسجل بالفعل، يمكنك تسجيل الدخول أو استعادة كلمة المرور',
    });
  }

  const custId = uid('cust');
  db.prepare(
    `INSERT INTO customers (id, email, phone, password_hash, full_name, status, default_zone_id, address_landmark, is_email_verified, auth_provider, profile_completed)
     VALUES (?, ?, ?, ?, ?, 'active', 'zn_city_center', '', 0, 'email', 0)`
  ).run(custId, email, cleanPhone || null, hashPassword(cleanPass), cleanName);

  const customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId) as Record<string, unknown>;
  const tokens = issueSessionForUser(req, res, {
    userId: custId,
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(customerRow.token_version || 0),
  });

  // Create persistent in-app + push notification prompting email verification via external code page
  enqueueSystemPushNotification({
    targetApp: 'customer',
    recipientId: custId,
    category: 'alert',
    titleAr: 'وثّق بريدك الإلكتروني الآن',
    bodyAr: 'اضغط هنا لفتح صفحة التوثيق وإدخال الرمز المرسل على بريدك الإلكتروني لتأمين حسابك في اطلبها.',
    deepLink: 'verify_email',
    sentBy: 'نظام اطلبها',
    extraData: { email },
  });

  recordAuditLog({
    actor_name: cleanName,
    actor_role: 'customer',
    action: 'CUSTOMER_DIRECT_REGISTER',
    entity_type: 'customers',
    entity_id: custId,
    details: `تسجيل فوري للعميل بدون تأكيد مسبق للبريد (${email}) وإرسال إشعار توثيق البريد`,
  });

  const sanitized = sanitizeCustomerRow(customerRow);
  return res.status(201).json({
    ok: true,
    role: 'customer',
    needs_profile_completion: sanitized.needs_profile_completion,
    user: sanitized,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
};

app.post('/api/mobile/customer/register-direct', handleCustomerDirectRegister);
app.post('/api/auth/customer/register-direct', handleCustomerDirectRegister);

// Request 6-digit OTP code for verifying an existing customer's email (used by /auth/verify-email external page)
const handleCustomerEmailVerifyRequestCode = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_email_verify_req_ip:${ip}`, 15, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات إرسال الرمز، يرجى الانتظار قليلًا' });
  }

  const { email: rawEmail } = (req.body || {}) as { email?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }

  const customer = db
    .prepare('SELECT id, full_name, status, is_email_verified FROM customers WHERE LOWER(email) = LOWER(?)')
    .get(email) as { id: string; full_name: string; status: string; is_email_verified: number } | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'لا يوجد حساب عميل مسجل بهذا البريد الإلكتروني' });
  }
  if (customer.status === 'suspended') {
    return res.status(403).json({ error: 'هذا الحساب موقوف حاليًا، يرجى التواصل مع الدعم الفني' });
  }
  if (Boolean(customer.is_email_verified)) {
    return res.json({
      ok: true,
      already_verified: true,
      email,
      redirect_url: `otlobha://verified?email=${encodeURIComponent(email)}`,
      message: 'بريدك الإلكتروني موثّق بالفعل! جاري إعادتك إلى تطبيق اطلبها...',
    });
  }

  const verifyRole = 'customer_verify_email';
  const quota = checkEmailOtpQuota(email, verifyRole);
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSec));
    return res.status(429).json({
      error: quota.error,
      reason: quota.reason,
      retry_after_sec: quota.retryAfterSec,
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256Otp(email, verifyRole, code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const otpId = uid('otp');

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0').run(
    email,
    verifyRole
  );
  db.prepare(
    `INSERT INTO email_otp_codes (id, email, role, code_hash, attempts, is_used, expires_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)`
  ).run(otpId, email, verifyRole, codeHash, expiresAt);

  const mailRes = await dispatchEmailOtp(email, code, {
    subject: `رمز توثيق البريد الإلكتروني – اطلبها: ${code}`,
    intro: `مرحبًا ${customer.full_name || 'عميلنا العزيز'}، أدخل الرمز التالي خلال 5 دقائق في صفحة توثيق البريد لتأمين حسابك في تطبيق اطلبها:`,
    plainText: `رمز توثيق بريدك الإلكتروني في اطلبها هو: ${code} (صالح لمدة 5 دقائق).`,
  });
  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_otp_codes WHERE id = ?').run(otpId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: customer.full_name || email,
    actor_role: 'customer',
    action: 'CUSTOMER_EMAIL_VERIFY_CODE_SENT',
    entity_type: 'customers',
    entity_id: customer.id,
    details: `إرسال رمز توثيق البريد الإلكتروني (${email}) عبر صفحة التوثيق الخارجية`,
  });

  return res.json({
    ok: true,
    email,
    message: `تم إرسال رمز التوثيق المكون من 6 أرقام إلى بريدك الإلكتروني (${email}).`,
    expires_in_sec: 300,
    delivery_channel: mailRes.delivery_channel,
  });
};

// Scoped CORS for the 4 public customer email-verify & forgot-password endpoints so the isolated GitHub Pages Customer Portal can call them directly without a second Cloud Run service.
const CUSTOMER_PORTAL_CORS_PATHS = [
  '/api/auth/customer/email-verify/request-code',
  '/api/mobile/customer/email-verify/request-code',
  '/api/auth/customer/email-verify/confirm-code',
  '/api/mobile/customer/email-verify/confirm-code',
  '/api/mobile/customer/forgot-password/request',
  '/api/mobile/customer/forgot-password/reset',
];
app.use(CUSTOMER_PORTAL_CORS_PATHS, (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.post('/api/auth/customer/email-verify/request-code', handleCustomerEmailVerifyRequestCode);
app.post('/api/mobile/customer/email-verify/request-code', handleCustomerEmailVerifyRequestCode);

// Confirm 6-digit OTP code on /auth/verify-email external page
const handleCustomerEmailVerifyConfirmCode = (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_email_verify_confirm_ip:${ip}`, 20, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات التحقق، يرجى المحاولة بعد قليل' });
  }

  const { email: rawEmail, code: rawCode } = (req.body || {}) as { email?: string; code?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanCode = String(rawCode || '').trim();
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (!/^[0-9]{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'يرجى إدخال رمز التوثيق المكون من 6 أرقام' });
  }

  const verifyRole = 'customer_verify_email';
  const cumulativeFailures = (
    db
      .prepare(
        "SELECT COALESCE(SUM(attempts), 0) as s FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', '-15 minutes')"
      )
      .get(email, verifyRole) as { s: number }
  ).s;
  if (cumulativeFailures >= 10) {
    return res.status(429).json({ error: 'تم حظر التحقق مؤقتًا بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة' });
  }

  const otpRow = db
    .prepare(
      'SELECT * FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1'
    )
    .get(email, verifyRole) as { id: string; code_hash: string; attempts: number; expires_at: string } | undefined;

  if (!otpRow) {
    return res.status(400).json({ error: 'لا يوجد رمز توثيق نشط لهذا البريد، اضغط على إرسال رمز جديد' });
  }
  if (Date.now() > Date.parse(otpRow.expires_at)) {
    db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'انتهت صلاحية الرمز، اضغط على إعادة إرسال رمز جديد' });
  }
  if (otpRow.attempts >= 5) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى لمحاولات الرمز، اطلب رمزًا جديدًا' });
  }

  const expectedHash = sha256Otp(email, verifyRole, cleanCode);
  if (!timingSafeHexEquals(expectedHash, String(otpRow.code_hash || ''))) {
    db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(401).json({ error: 'رمز التوثيق غير صحيح، راجع بريدك وحاول مرة أخرى' });
  }

  const customer = db.prepare('SELECT id, full_name FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string; full_name: string }
    | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'حساب العميل غير موجود' });
  }

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
  db.prepare('UPDATE customers SET is_email_verified = 1 WHERE id = ?').run(customer.id);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND deep_link = 'verify_email'").run(
    customer.id
  );

  recordAuditLog({
    actor_name: customer.full_name || email,
    actor_role: 'customer',
    action: 'CUSTOMER_EMAIL_VERIFIED_BY_CODE',
    entity_type: 'customers',
    entity_id: customer.id,
    details: `توثيق بريد العميل (${email}) بنجاح عبر رمز التحقق في الصفحة الخارجية`,
  });

  return res.json({
    ok: true,
    verified: true,
    email,
    redirect_url: `otlobha://verified?email=${encodeURIComponent(email)}`,
    message: 'تم توثيق بريدك الإلكتروني بنجاح! جاري إغلاق الصفحة والعودة إلى تطبيق اطلبها...',
  });
};

app.post('/api/auth/customer/email-verify/confirm-code', handleCustomerEmailVerifyConfirmCode);
app.post('/api/mobile/customer/email-verify/confirm-code', handleCustomerEmailVerifyConfirmCode);

// External Hosted RTL Page 1: Verify Customer Email via 6-digit Code -> Auto-close & Redirect back to App
app.get(['/portal/customer/verify-email', '/verify-email', '/auth/verify-email'], (req, res) => {
  const prefillEmail = normalizeEmail(String(req.query.email || '')) || String(req.query.email || '').trim();
  const autoSend = String(req.query.auto || '') === '1';
  const safeEmail = escapeHtmlSafe(prefillEmail);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).send(`<!doctype html>
<!-- otlobha-customer-portal-marker -->
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>توثيق البريد الإلكتروني – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);">
    <div style="text-align:center;margin-bottom:18px;">
      <div style="width:62px;height:62px;margin:0 auto 12px;border-radius:18px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A92224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#0F172A;">توثيق البريد الإلكتروني</h1>
      <p style="margin:0;font-size:13.5px;line-height:1.65;color:#475569;">أرسل رمز التوثيق إلى بريدك الإلكتروني ثم أدخل الرمز المكون من 6 أرقام لتأمين حسابك في اطلبها.</p>
    </div>

    <div id="msgBox" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.6;"></div>

    <div id="formWrap">
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">البريد الإلكتروني</label>
        <input id="emailInput" type="email" dir="ltr" value="${safeEmail}" placeholder="name@gmail.com" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>

      <button id="sendCodeBtn" type="button" style="width:100%;padding:12px;border:1px solid #A92224;border-radius:12px;background:#FFF5F5;color:#A92224;font-weight:700;font-size:14.5px;cursor:pointer;margin-bottom:16px;">إرسال رمز التوثيق على البريد</button>

      <form id="verifyForm" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">رمز التوثيق (6 أرقام)</label>
          <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" placeholder="000000" style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #CBD5E1;border-radius:12px;font-size:22px;font-weight:800;letter-spacing:8px;text-align:center;background:#F8FAFC;" />
        </div>
        <button id="confirmBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">تأكيد وتوثيق البريد</button>
      </form>
    </div>

    <div id="doneBox" style="display:none;text-align:center;padding-top:6px;">
      <div style="width:66px;height:66px;margin:0 auto 14px;border-radius:18px;background:#F0FDFA;display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <h2 style="margin:0 0 8px;font-size:19px;font-weight:800;color:#0F766E;">تم توثيق بريدك بنجاح!</h2>
      <p style="margin:0 0 18px;font-size:13.5px;color:#475569;line-height:1.65;">جاري إغلاق هذه الصفحة وإعادتك مباشرة إلى تطبيق اطلبها...</p>
      <a id="returnAppLink" href="otlobha://verified" style="display:inline-block;width:100%;box-sizing:border-box;padding:13px 20px;border-radius:12px;background:#0D9488;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;">العودة إلى تطبيق اطلبها</a>
    </div>

    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#94A3B8;">اطلبها – Otlobha</p>
  </div>
  <script>
    const emailInput = document.getElementById('emailInput');
    const codeInput = document.getElementById('codeInput');
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    const verifyForm = document.getElementById('verifyForm');
    const confirmBtn = document.getElementById('confirmBtn');
    const formWrap = document.getElementById('formWrap');
    const doneBox = document.getElementById('doneBox');
    const returnAppLink = document.getElementById('returnAppLink');
    const msgBox = document.getElementById('msgBox');
    let cooldown = 0;
    let timerId = null;

    function normalizeDigits(v) {
      const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
      return String(v || '').replace(/[٠-٩۰-۹]/g, ch => map[ch] || ch).replace(/[^0-9]/g, '').slice(0, 6);
    }

    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeDigits(codeInput.value);
    });

    function showMsg(text, ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = ok ? '#F0FDFA' : '#FEF2F2';
      msgBox.style.color = ok ? '#0F766E' : '#B91C1C';
      msgBox.style.border = ok ? '1px solid #99F6E4' : '1px solid #FECACA';
      msgBox.textContent = text;
    }

    function startCooldown(sec) {
      cooldown = sec;
      if (timerId) clearInterval(timerId);
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
      timerId = setInterval(() => {
        cooldown--;
        if (cooldown <= 0) {
          clearInterval(timerId);
          sendCodeBtn.disabled = false;
          sendCodeBtn.textContent = 'إعادة إرسال رمز التوثيق';
        } else {
          sendCodeBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
        }
      }, 1000);
    }

    function finishAndReturn(redirectUrl) {
      const target = redirectUrl || ('otlobha://verified?email=' + encodeURIComponent(emailInput.value.trim()));
      returnAppLink.href = target;
      formWrap.style.display = 'none';
      doneBox.style.display = 'block';
      setTimeout(() => { window.location.href = target; }, 500);
      setTimeout(() => { try { window.close(); } catch (_) {} }, 1300);
    }

    async function sendCode() {
      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال بريد إلكتروني صحيح أولًا', false);
        return;
      }
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'جاري إرسال الرمز...';
      try {
        const res = await fetch('/api/auth/customer/email-verify/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر إرسال الرمز حاليًا', false);
          if (data.retry_after_sec && Number(data.retry_after_sec) > 0) {
            startCooldown(Math.min(Number(data.retry_after_sec), 120));
          } else {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'إرسال رمز التوثيق على البريد';
          }
          return;
        }
        if (data.already_verified) {
          showMsg(data.message || 'بريدك موثّق بالفعل!', true);
          finishAndReturn(data.redirect_url);
          return;
        }
        showMsg(data.message || 'تم إرسال رمز التوثيق إلى بريدك الإلكتروني', true);
        startCooldown(60);
        codeInput.focus();
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = 'إرسال رمز التوثيق على البريد';
      }
    }

    sendCodeBtn.addEventListener('click', sendCode);

    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const code = normalizeDigits(codeInput.value);
      codeInput.value = code;
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال البريد الإلكتروني بشكل صحيح', false);
        return;
      }
      if (code.length !== 6) {
        showMsg('يرجى إدخال رمز التوثيق المكون من 6 أرقام', false);
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'جاري التحقق...';
      try {
        const res = await fetch('/api/auth/customer/email-verify/confirm-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر التحقق من الرمز', false);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'تأكيد وتوثيق البريد';
          return;
        }
        showMsg(data.message || 'تم توثيق بريدك الإلكتروني بنجاح!', true);
        finishAndReturn(data.redirect_url);
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'تأكيد وتوثيق البريد';
      }
    });

    if (${autoSend ? 'true' : 'false'} && emailInput.value.trim().includes('@')) {
      sendCode();
    }
  </script>
</body>
</html>`);
});

// External Hosted RTL Page 2: Forgot Password (Enter Email -> Receive 6-digit Code -> Reset Password -> Auto-close & Return to App)
app.get(['/portal/customer/forgot-password', '/forgot-password', '/auth/forgot-password'], (req, res) => {
  const prefillEmail = normalizeEmail(String(req.query.email || '')) || String(req.query.email || '').trim();
  const safeEmail = escapeHtmlSafe(prefillEmail);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).send(`<!doctype html>
<!-- otlobha-customer-portal-marker -->
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>استعادة كلمة المرور – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);">
    <div style="text-align:center;margin-bottom:18px;">
      <div style="width:62px;height:62px;margin:0 auto 12px;border-radius:18px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A92224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#0F172A;">استعادة كلمة المرور</h1>
      <p id="stepSubtitle" style="margin:0;font-size:13.5px;line-height:1.65;color:#475569;">أدخل بريدك الإلكتروني المسجل لنرسل لك رمز التحقق المكون من 6 أرقام لتغيير كلمة المرور.</p>
    </div>

    <div id="msgBox" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.6;"></div>

    <form id="step1Form" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">البريد الإلكتروني المسجل</label>
        <input id="emailInput" type="email" required dir="ltr" value="${safeEmail}" placeholder="name@gmail.com" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <button id="sendBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">إرسال رمز التحقق</button>
    </form>

    <form id="step2Form" style="display:none;flex-direction:column;gap:14px;">
      <div style="background:#F1F5F9;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span id="emailBadge" dir="ltr" style="font-size:13px;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;"></span>
        <button id="changeEmailBtn" type="button" style="border:none;background:none;color:#A92224;font-weight:700;font-size:12.5px;cursor:pointer;">تعديل</button>
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">رمز التحقق (6 أرقام)</label>
        <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" required maxlength="6" dir="ltr" placeholder="000000" style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #CBD5E1;border-radius:12px;font-size:21px;font-weight:800;letter-spacing:8px;text-align:center;background:#F8FAFC;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">كلمة المرور الجديدة (6 أحرف على الأقل)</label>
        <input id="pw1" type="password" required minlength="6" dir="ltr" placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">تأكيد كلمة المرور الجديدة</label>
        <input id="pw2" type="password" required minlength="6" dir="ltr" placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <button id="resetBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">تغيير كلمة المرور</button>
      <button id="resendBtn" type="button" style="padding:10px;border:1px solid #CBD5E1;border-radius:10px;background:#FFFFFF;color:#334155;font-weight:700;font-size:13px;cursor:pointer;">إعادة إرسال الرمز</button>
    </form>

    <div id="doneBox" style="display:none;text-align:center;padding-top:6px;">
      <div style="width:66px;height:66px;margin:0 auto 14px;border-radius:18px;background:#F0FDFA;display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <h2 style="margin:0 0 8px;font-size:19px;font-weight:800;color:#0F766E;">تم تغيير كلمة المرور بنجاح!</h2>
      <p style="margin:0 0 18px;font-size:13.5px;color:#475569;line-height:1.65;">جاري إغلاق الصفحة وإعادتك إلى تطبيق اطلبها لتسجيل الدخول بكلمة المرور الجديدة...</p>
      <a id="returnAppLink" href="otlobha://password-reset-done" style="display:inline-block;width:100%;box-sizing:border-box;padding:13px 20px;border-radius:12px;background:#0D9488;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;">العودة إلى تطبيق اطلبها</a>
    </div>

    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#94A3B8;">اطلبها – Otlobha</p>
  </div>
  <script>
    const step1Form = document.getElementById('step1Form');
    const step2Form = document.getElementById('step2Form');
    const stepSubtitle = document.getElementById('stepSubtitle');
    const emailInput = document.getElementById('emailInput');
    const emailBadge = document.getElementById('emailBadge');
    const changeEmailBtn = document.getElementById('changeEmailBtn');
    const sendBtn = document.getElementById('sendBtn');
    const codeInput = document.getElementById('codeInput');
    const pw1 = document.getElementById('pw1');
    const pw2 = document.getElementById('pw2');
    const resetBtn = document.getElementById('resetBtn');
    const resendBtn = document.getElementById('resendBtn');
    const doneBox = document.getElementById('doneBox');
    const returnAppLink = document.getElementById('returnAppLink');
    const msgBox = document.getElementById('msgBox');
    let activeEmail = '';
    let cooldown = 0;
    let timerId = null;

    function normalizeDigits(v) {
      const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
      return String(v || '').replace(/[٠-٩۰-۹]/g, ch => map[ch] || ch).replace(/[^0-9]/g, '').slice(0, 6);
    }

    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeDigits(codeInput.value);
    });

    function showMsg(text, ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = ok ? '#F0FDFA' : '#FEF2F2';
      msgBox.style.color = ok ? '#0F766E' : '#B91C1C';
      msgBox.style.border = ok ? '1px solid #99F6E4' : '1px solid #FECACA';
      msgBox.textContent = text;
    }

    function startCooldown(sec) {
      cooldown = sec;
      if (timerId) clearInterval(timerId);
      resendBtn.disabled = true;
      resendBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
      timerId = setInterval(() => {
        cooldown--;
        if (cooldown <= 0) {
          clearInterval(timerId);
          resendBtn.disabled = false;
          resendBtn.textContent = 'إعادة إرسال الرمز';
        } else {
          resendBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
        }
      }, 1000);
    }

    async function requestResetCode(email) {
      const res = await fetch('/api/mobile/customer/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.retry_after_sec && Number(data.retry_after_sec) > 0) {
          startCooldown(Math.min(Number(data.retry_after_sec), 120));
        }
        throw new Error(data.error || 'تعذر إرسال رمز الاستعادة');
      }
      return data;
    }

    step1Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال بريد إلكتروني صحيح', false);
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = 'جاري إرسال الرمز...';
      try {
        const data = await requestResetCode(email);
        activeEmail = data.email || email;
        emailBadge.textContent = activeEmail;
        step1Form.style.display = 'none';
        step2Form.style.display = 'flex';
        stepSubtitle.textContent = 'أدخل الرمز المرسل إلى بريدك الإلكتروني ثم اختر كلمة مرور جديدة.';
        showMsg(data.message || 'تم إرسال رمز التحقق إلى بريدك الإلكتروني', true);
        startCooldown(60);
        codeInput.focus();
      } catch (err) {
        showMsg(err.message || 'تعذر الاتصال بالخادم', false);
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال رمز التحقق';
      }
    });

    resendBtn.addEventListener('click', async () => {
      if (!activeEmail) return;
      resendBtn.disabled = true;
      resendBtn.textContent = 'جاري إعادة الإرسال...';
      try {
        const data = await requestResetCode(activeEmail);
        showMsg(data.message || 'تم إعادة إرسال رمز التحقق إلى بريدك الإلكتروني', true);
        startCooldown(60);
      } catch (err) {
        showMsg(err.message || 'تعذر إعادة إرسال الرمز', false);
        if (cooldown <= 0) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'إعادة إرسال الرمز';
        }
      }
    });

    changeEmailBtn.addEventListener('click', () => {
      step2Form.style.display = 'none';
      step1Form.style.display = 'flex';
      stepSubtitle.textContent = 'أدخل بريدك الإلكتروني المسجل لنرسل لك رمز التحقق المكون من 6 أرقام لتغيير كلمة المرور.';
      msgBox.style.display = 'none';
    });

    step2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = normalizeDigits(codeInput.value);
      codeInput.value = code;
      if (code.length !== 6) {
        showMsg('يرجى إدخال رمز التحقق المكون من 6 أرقام', false);
        return;
      }
      if (pw1.value.length < 6) {
        showMsg('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف', false);
        return;
      }
      if (pw1.value !== pw2.value) {
        showMsg('كلمتا المرور غير متطابقتين', false);
        return;
      }
      resetBtn.disabled = true;
      resetBtn.textContent = 'جاري تحديث كلمة المرور...';
      try {
        const res = await fetch('/api/mobile/customer/forgot-password/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: activeEmail, code, new_password: pw1.value })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر تحديث كلمة المرور', false);
          resetBtn.disabled = false;
          resetBtn.textContent = 'تغيير كلمة المرور';
          return;
        }
        const target = 'otlobha://password-reset-done?email=' + encodeURIComponent(activeEmail);
        returnAppLink.href = target;
        showMsg('تم تغيير كلمة المرور بنجاح! جاري إعادتك إلى تطبيق اطلبها...', true);
        step2Form.style.display = 'none';
        doneBox.style.display = 'block';
        setTimeout(() => { window.location.href = target; }, 500);
        setTimeout(() => { try { window.close(); } catch (_) {} }, 1300);
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        resetBtn.disabled = false;
        resetBtn.textContent = 'تغيير كلمة المرور';
      }
    });
  </script>
</body>
</html>`);
});

// Manual Email Registration via Clickable Verification Link (NO OTP Code)
const handleCustomerSendVerificationLink = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_verify_link_ip:${ip}`, 10, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم إرسال عدة روابط مؤخرًا، يرجى الانتظار قليلًا ثم المحاولة مرة أخرى' });
  }

  const { full_name, email: rawEmail, password, phone: rawPhone } = (req.body || {}) as {
    full_name?: string;
    email?: string;
    password?: string;
    phone?: string;
  };
  const cleanName = String(full_name || '').trim();
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanPass = String(password || '');
  const cleanPhone = String(rawPhone || '').trim();

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل (حرفين على الأقل)' });
  }
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
  }
  if (cleanPhone && !/^[+0-9\s-]{8,18}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
  }

  const existing = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | Record<string, unknown>
    | undefined;
  let customerId: string;
  if (existing) {
    if (Boolean(existing.is_email_verified)) {
      return res.status(409).json({
        error: 'هذا البريد الإلكتروني مسجل ومفعّل بالفعل، يمكنك تسجيل الدخول مباشرة',
      });
    }
    customerId = String(existing.id);
    db.prepare(
      'UPDATE customers SET full_name = ?, phone = COALESCE(?, phone), password_hash = ? WHERE id = ?'
    ).run(cleanName, cleanPhone || null, hashPassword(cleanPass), customerId);
  } else {
    customerId = uid('cust');
    db.prepare(
      `INSERT INTO customers (id, email, phone, password_hash, full_name, default_zone_id, address_landmark, is_email_verified, auth_provider, profile_completed)
       VALUES (?, ?, ?, ?, ?, 'zn_city_center', '', 0, 'email', 0)`
    ).run(customerId, email, cleanPhone || null, hashPassword(cleanPass), cleanName);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashActionToken(rawToken);
  const tokenId = uid('eat');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  db.prepare(
    "UPDATE email_action_tokens SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND action_type = 'verify_email' AND is_used = 0"
  ).run(email);
  db.prepare(
    `INSERT INTO email_action_tokens (id, customer_id, email, action_type, token_hash, is_used, expires_at)
     VALUES (?, ?, ?, 'verify_email', ?, 0, ?)`
  ).run(tokenId, customerId, email, tokenHash, expiresAt);

  const verifyUrl = `${resolvePublicAppUrl(req)}/api/auth/customer/verify-email?token=${encodeURIComponent(rawToken)}`;
  const mailRes = await dispatchBrandedHtmlEmail(email, {
    subject: 'تأكيد حسابك في تطبيق اطلبها – Otlobha',
    plainText: `مرحبًا ${cleanName}، اضغط على الرابط التالي لتأكيد بريدك الإلكتروني وتفعيل حسابك في اطلبها (صالح لمدة 30 دقيقة):\n${verifyUrl}`,
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; padding: 24px; background: #F8FAFC;">
        <div style="max-width: 500px; margin: 0 auto; background: #FFFFFF; border-radius: 18px; padding: 28px; border: 1px solid #E2E8F0;">
          <h2 style="color: #A92224; margin: 0 0 10px;">مرحبًا بك في اطلبها</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.7;">أهلًا ${escapeHtmlSafe(cleanName)}، اضغط على الزر بالأسفل لتأكيد بريدك الإلكتروني وتفعيل حسابك فورًا:</p>
          <div style="text-align: center; margin: 26px 0;">
            <a href="${escapeHtmlSafe(verifyUrl)}" style="display: inline-block; background: #A92224; color: #FFFFFF; text-decoration: none; padding: 14px 30px; border-radius: 12px; font-weight: bold; font-size: 15px;">
              تأكيد البريد الإلكتروني وتفعيل الحساب
            </a>
          </div>
          <p style="color: #64748B; font-size: 12.5px; line-height: 1.6;">إذا لم يعمل الزر، انسخ هذا الرابط وافتحه في المتصفح (صالح لمدة 30 دقيقة):</p>
          <p style="direction: ltr; word-break: break-all; font-size: 12px; color: #0F172A; background: #F1F5F9; padding: 10px; border-radius: 8px;">${escapeHtmlSafe(verifyUrl)}</p>
        </div>
      </div>
    `,
  });

  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_action_tokens WHERE id = ?').run(tokenId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: cleanName,
    actor_role: 'customer',
    action: 'CUSTOMER_VERIFICATION_LINK_SENT',
    entity_type: 'customers',
    entity_id: customerId,
    details: `إرسال رابط تأكيد الحساب إلى البريد ${email} عبر Gmail SMTP`,
  });

  return res.json({
    ok: true,
    email,
    message: `تم إرسال رابط تأكيد الحساب إلى بريدك الإلكتروني (${email}). افتح الرسالة واضغط على الرابط ثم عد للتطبيق.`,
    expires_in_sec: 1800,
    delivery_channel: mailRes.delivery_channel,
  });
};

app.post('/api/mobile/customer/register/send-verification-link', handleCustomerSendVerificationLink);
app.post('/api/auth/customer/register/send-verification-link', handleCustomerSendVerificationLink);

// Clicking the email verification link activates the customer account immediately
app.get('/api/auth/customer/verify-email', (req, res) => {
  const rawToken = String(req.query.token || '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!rawToken) {
    return res.status(400).send(
      renderActionResultPage({
        title: 'رابط غير صالح – اطلبها',
        heading: 'رابط التأكيد غير مكتمل',
        body: 'يرجى فتح رابط التأكيد مباشرة من رسالة البريد الإلكتروني أو طلب إرسال رابط جديد من تطبيق اطلبها.',
        success: false,
      })
    );
  }

  const tokenHash = hashActionToken(rawToken);
  const row = db
    .prepare("SELECT * FROM email_action_tokens WHERE token_hash = ? AND action_type = 'verify_email' LIMIT 1")
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row) {
    return res.status(404).send(
      renderActionResultPage({
        title: 'رابط غير صالح – اطلبها',
        heading: 'رابط التأكيد غير صالح',
        body: 'هذا الرابط غير صالح أو تم استبداله برابط أحدث. اطلب رابط تأكيد جديد من تطبيق اطلبها.',
        success: false,
      })
    );
  }

  const email = String(row.email || '');
  if (Boolean(row.is_used)) {
    return res.status(200).send(
      renderActionResultPage({
        title: 'تم التأكيد مسبقًا – اطلبها',
        heading: 'حسابك مفعّل بالفعل',
        body: `تم تأكيد البريد الإلكتروني (${email}) سابقًا. يمكنك الآن العودة إلى تطبيق اطلبها والمتابعة مباشرة.`,
        success: true,
        ctaHref: `otlobha://verified?email=${encodeURIComponent(email)}`,
        ctaLabel: 'العودة إلى تطبيق اطلبها',
      })
    );
  }

  if (Date.now() > new Date(String(row.expires_at)).getTime()) {
    return res.status(410).send(
      renderActionResultPage({
        title: 'انتهت صلاحية الرابط – اطلبها',
        heading: 'انتهت صلاحية رابط التأكيد',
        body: 'انتهت صلاحية هذا الرابط (30 دقيقة). افتح تطبيق اطلبها واضغط على «إعادة إرسال رابط التأكيد».',
        success: false,
      })
    );
  }

  db.prepare('UPDATE email_action_tokens SET is_used = 1 WHERE id = ?').run(String(row.id));
  db.prepare('UPDATE customers SET is_email_verified = 1 WHERE id = ? OR LOWER(email) = LOWER(?)').run(
    String(row.customer_id || ''),
    email
  );

  recordAuditLog({
    actor_name: email,
    actor_role: 'customer',
    action: 'CUSTOMER_EMAIL_LINK_VERIFIED',
    entity_type: 'customers',
    entity_id: String(row.customer_id || email),
    details: `تأكيد بريد العميل (${email}) عبر رابط التفعيل`,
  });

  return res.status(200).send(
    renderActionResultPage({
      title: 'تم تأكيد الحساب – اطلبها',
      heading: 'تم تأكيد بريدك الإلكتروني بنجاح!',
      body: `تم تفعيل حسابك (${email}) بنجاح. ارجع الآن إلى تطبيق اطلبها واضغط على «تم التأكيد — متابعة» لإكمال بياناتك الشخصية.`,
      success: true,
      ctaHref: `otlobha://verified?email=${encodeURIComponent(email)}`,
      ctaLabel: 'فتح تطبيق اطلبها',
    })
  );
});

// Check whether user clicked verification link & issue session automatically
const handleCustomerCheckVerified = (req: express.Request, res: express.Response) => {
  const { email: rawEmail, password } = (req.body || {}) as { email?: string; password?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanPass = String(password || '');
  if (!email || !cleanPass) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
  }

  const customerRow = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | Record<string, unknown>
    | undefined;
  if (!customerRow) {
    return res.status(404).json({ error: 'لا يوجد حساب بهذا البريد الإلكتروني' });
  }
  const storedHash = String(customerRow.password_hash || '').trim();
  if (!storedHash || !verifyPassword(cleanPass, storedHash)) {
    return res.status(401).json({ error: 'بيانات الحساب غير متطابقة' });
  }
  if (!Boolean(customerRow.is_email_verified)) {
    return res.json({
      ok: true,
      verified: false,
      message: 'لم يتم تأكيد البريد بعد — افتح رسالة Gmail واضغط على رابط التأكيد ثم اضغط متابعة.',
    });
  }

  db.prepare("UPDATE customers SET last_login_at = datetime('now') WHERE id = ?").run(String(customerRow.id));
  const freshRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customerRow.id)) as Record<string, unknown>;
  const tokens = issueSessionForUser(req, res, {
    userId: String(freshRow.id),
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(freshRow.token_version || 0),
  });
  const sanitized = sanitizeCustomerRow(freshRow);
  return res.json({
    ok: true,
    verified: true,
    role: 'customer',
    needs_profile_completion: sanitized.needs_profile_completion,
    user: sanitized,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
};

app.post('/api/mobile/customer/register/check-verified', handleCustomerCheckVerified);
app.post('/api/auth/customer/register/check-verified', handleCustomerCheckVerified);

// Forgot Password via Clickable Reset Link (NO OTP Code)
const handleCustomerSendPasswordResetLink = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_reset_link_ip:${ip}`, 10, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد طلبات استعادة كلمة المرور، يرجى المحاولة بعد قليل' });
  }

  const { email: rawEmail } = (req.body || {}) as { email?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }

  const customer = db.prepare('SELECT id, full_name, status FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string; full_name: string; status: string }
    | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'لا يوجد حساب عميل مسجل بهذا البريد الإلكتروني' });
  }
  if (customer.status === 'suspended') {
    return res.status(403).json({ error: 'هذا الحساب موقوف حاليًا، يرجى التواصل مع الدعم الفني' });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashActionToken(rawToken);
  const tokenId = uid('eat');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  db.prepare(
    "UPDATE email_action_tokens SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND action_type = 'reset_password' AND is_used = 0"
  ).run(email);
  db.prepare(
    `INSERT INTO email_action_tokens (id, customer_id, email, action_type, token_hash, is_used, expires_at)
     VALUES (?, ?, ?, 'reset_password', ?, 0, ?)`
  ).run(tokenId, customer.id, email, tokenHash, expiresAt);

  const resetUrl = `${resolvePublicAppUrl(req)}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
  const mailRes = await dispatchBrandedHtmlEmail(email, {
    subject: 'إعادة تعيين كلمة المرور – تطبيق اطلبها',
    plainText: `تلقينا طلبًا لتغيير كلمة المرور لحسابك في اطلبها. اضغط على الرابط التالي لتعيين كلمة مرور جديدة (صالح لمدة 30 دقيقة):\n${resetUrl}`,
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; padding: 24px; background: #F8FAFC;">
        <div style="max-width: 500px; margin: 0 auto; background: #FFFFFF; border-radius: 18px; padding: 28px; border: 1px solid #E2E8F0;">
          <h2 style="color: #A92224; margin: 0 0 10px;">تغيير كلمة المرور – اطلبها</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.7;">مرحبًا ${escapeHtmlSafe(customer.full_name || 'عميلنا العزيز')}، اضغط على الزر بالأسفل لاختيار كلمة مرور جديدة لحسابك:</p>
          <div style="text-align: center; margin: 26px 0;">
            <a href="${escapeHtmlSafe(resetUrl)}" style="display: inline-block; background: #A92224; color: #FFFFFF; text-decoration: none; padding: 14px 30px; border-radius: 12px; font-weight: bold; font-size: 15px;">
              تعيين كلمة مرور جديدة
            </a>
          </div>
          <p style="color: #64748B; font-size: 12.5px; line-height: 1.6;">الرابط صالح لمدة 30 دقيقة ولمرة واحدة فقط. إذا لم تطلب تغيير كلمة المرور يمكنك تجاهل هذه الرسالة.</p>
          <p style="direction: ltr; word-break: break-all; font-size: 12px; color: #0F172A; background: #F1F5F9; padding: 10px; border-radius: 8px;">${escapeHtmlSafe(resetUrl)}</p>
        </div>
      </div>
    `,
  });

  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_action_tokens WHERE id = ?').run(tokenId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: customer.full_name || email,
    actor_role: 'customer',
    action: 'CUSTOMER_PASSWORD_RESET_LINK_SENT',
    entity_type: 'customers',
    entity_id: customer.id,
    details: `إرسال رابط تغيير كلمة المرور إلى ${email} عبر Gmail SMTP`,
  });

  return res.json({
    ok: true,
    email,
    message: `تم إرسال رابط تغيير كلمة المرور إلى بريدك الإلكتروني (${email}). افتح الرسالة واضغط على الرابط لتعيين كلمة مرور جديدة.`,
    expires_in_sec: 1800,
    delivery_channel: mailRes.delivery_channel,
  });
};

app.post('/api/mobile/customer/forgot-password/send-link', handleCustomerSendPasswordResetLink);
app.post('/api/auth/customer/forgot-password/send-link', handleCustomerSendPasswordResetLink);

// Hosted RTL HTML page for resetting password directly from the email link
app.get('/auth/reset-password', (req, res) => {
  const rawToken = String(req.query.token || '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!rawToken) {
    return res.status(400).send(
      renderActionResultPage({
        title: 'رابط غير صالح – اطلبها',
        heading: 'رابط تغيير كلمة المرور غير مكتمل',
        body: 'افتح الرابط من رسالة البريد الإلكتروني أو اطلب رابطًا جديدًا من تطبيق اطلبها.',
        success: false,
      })
    );
  }
  const tokenHash = hashActionToken(rawToken);
  const row = db
    .prepare("SELECT * FROM email_action_tokens WHERE token_hash = ? AND action_type = 'reset_password' LIMIT 1")
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row || Boolean(row.is_used) || Date.now() > new Date(String(row.expires_at)).getTime()) {
    return res.status(410).send(
      renderActionResultPage({
        title: 'انتهت صلاحية الرابط – اطلبها',
        heading: 'الرابط غير صالح أو منتهي الصلاحية',
        body: 'انتهت صلاحية رابط تغيير كلمة المرور أو تم استخدامه مسبقًا. اطلب رابطًا جديدًا من شاشة «هل نسيت كلمة المرور؟» في التطبيق.',
        success: false,
      })
    );
  }

  const email = escapeHtmlSafe(String(row.email || ''));
  const safeToken = escapeHtmlSafe(rawToken);

  return res.status(200).send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>تعيين كلمة مرور جديدة – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:20px;padding:30px 24px;box-shadow:0 12px 32px rgba(15,23,42,0.06);">
    <h1 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#0F172A;text-align:center;">تعيين كلمة مرور جديدة</h1>
    <p style="margin:0 0 22px;font-size:13.5px;color:#475569;text-align:center;">الحساب: <strong style="direction:ltr;display:inline-block;">${email}</strong></p>
    <form id="resetForm" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">كلمة المرور الجديدة (6 أحرف على الأقل)</label>
        <input id="pw1" type="password" required minlength="6" dir="ltr" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">تأكيد كلمة المرور الجديدة</label>
        <input id="pw2" type="password" required minlength="6" dir="ltr" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;" />
      </div>
      <div id="msgBox" style="display:none;padding:11px 14px;border-radius:10px;font-size:13.5px;line-height:1.6;"></div>
      <button id="submitBtn" type="submit" style="margin-top:4px;padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:700;font-size:15px;cursor:pointer;">حفظ كلمة المرور الجديدة</button>
    </form>
    <div id="doneBox" style="display:none;text-align:center;margin-top:14px;">
      <a href="otlobha://password-reset-done" style="display:inline-block;padding:12px 24px;border-radius:12px;background:#0D9488;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14.5px;">العودة إلى تطبيق اطلبها</a>
    </div>
  </div>
  <script>
    const form = document.getElementById('resetForm');
    const msgBox = document.getElementById('msgBox');
    const submitBtn = document.getElementById('submitBtn');
    const doneBox = document.getElementById('doneBox');
    function showMsg(text, ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = ok ? '#F0FDFA' : '#FEF2F2';
      msgBox.style.color = ok ? '#0F766E' : '#B91C1C';
      msgBox.style.border = ok ? '1px solid #99F6E4' : '1px solid #FECACA';
      msgBox.textContent = text;
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = document.getElementById('pw1').value;
      const p2 = document.getElementById('pw2').value;
      if (p1.length < 6) { showMsg('كلمة المرور يجب أن لا تقل عن 6 أحرف', false); return; }
      if (p1 !== p2) { showMsg('كلمتا المرور غير متطابقتين', false); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري الحفظ...';
      try {
        const res = await fetch('/api/auth/customer/reset-password-by-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${safeToken}', new_password: p1 })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر تحديث كلمة المرور', false);
          submitBtn.disabled = false;
          submitBtn.textContent = 'حفظ كلمة المرور الجديدة';
          return;
        }
        showMsg(data.message || 'تم تغيير كلمة المرور بنجاح! يمكنك الآن العودة للتطبيق وتسجيل الدخول.', true);
        form.style.display = 'none';
        doneBox.style.display = 'block';
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = 'حفظ كلمة المرور الجديدة';
      }
    });
  </script>
</body>
</html>`);
});

app.post('/api/auth/customer/reset-password-by-token', (req, res) => {
  const { token, new_password } = (req.body || {}) as { token?: string; new_password?: string };
  const rawToken = String(token || '').trim();
  const cleanPass = String(new_password || '');
  if (!rawToken) {
    return res.status(400).json({ error: 'رابط التغيير غير صالح' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' });
  }

  const tokenHash = hashActionToken(rawToken);
  const row = db
    .prepare("SELECT * FROM email_action_tokens WHERE token_hash = ? AND action_type = 'reset_password' LIMIT 1")
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row || Boolean(row.is_used)) {
    return res.status(400).json({ error: 'هذا الرابط غير صالح أو تم استخدامه بالفعل' });
  }
  if (Date.now() > new Date(String(row.expires_at)).getTime()) {
    return res.status(410).json({ error: 'انتهت صلاحية الرابط، يرجى طلب رابط جديد من التطبيق' });
  }

  const email = String(row.email || '');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? OR LOWER(email) = LOWER(?) LIMIT 1').get(
    String(row.customer_id || ''),
    email
  ) as Record<string, unknown> | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'حساب العميل غير موجود' });
  }

  db.prepare('UPDATE email_action_tokens SET is_used = 1 WHERE id = ?').run(String(row.id));
  db.prepare(
    'UPDATE customers SET password_hash = ?, is_email_verified = 1, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?'
  ).run(hashPassword(cleanPass), String(customer.id));

  recordAuditLog({
    actor_name: String(customer.full_name || email),
    actor_role: 'customer',
    action: 'CUSTOMER_PASSWORD_RESET_BY_LINK',
    entity_type: 'customers',
    entity_id: String(customer.id),
    details: `تغيير كلمة مرور العميل (${email}) عبر رابط البريد الإلكتروني`,
  });

  return res.json({
    ok: true,
    message: 'تم تغيير كلمة المرور بنجاح! يمكنك الآن العودة إلى تطبيق اطلبها وتسجيل الدخول بكلمة المرور الجديدة.',
  });
});

const handleCustomerRegisterRequestOtp = async (req: express.Request, res: express.Response) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_reg_otp_ip:${ip}`, 10, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات إرسال رمز التحقق، يرجى المحاولة بعد قليل' });
  }

  const {
    full_name,
    email: rawEmail,
    phone: rawPhone,
    password,
  } = (req.body || {}) as {
    full_name?: string;
    email?: string;
    phone?: string;
    password?: string;
  };

  const cleanName = String(full_name || '').trim();
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanPhone = String(rawPhone || '').trim();
  const cleanPass = String(password || '');

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل (حرفين على الأقل)' });
  }
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (cleanPhone && !/^[+0-9\s-]{8,18}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
  }

  const dupEmail = db.prepare('SELECT id FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string }
    | undefined;
  if (dupEmail) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل، يمكنك تسجيل الدخول أو استعادة كلمة السر' });
  }

  const regRole = 'customer_register';
  const quota = checkEmailOtpQuota(email, regRole);
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSec));
    return res.status(429).json({
      error: quota.error,
      reason: quota.reason,
      retry_after_sec: quota.retryAfterSec,
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256Otp(email, regRole, code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const otpId = uid('otp');

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0').run(
    email,
    regRole
  );
  db.prepare(`
    INSERT INTO email_otp_codes (id, email, role, code_hash, attempts, is_used, expires_at)
    VALUES (?, ?, ?, ?, 0, 0, ?)
  `).run(otpId, email, regRole, codeHash, expiresAt);

  const mailRes = await dispatchEmailOtp(email, code, {
    subject: `رمز تأكيد البريد الإلكتروني – اطلبها: ${code}`,
    intro: `مرحبًا ${cleanName}، أدخل الرمز التالي خلال 5 دقائق لتأكيد بريدك الإلكتروني وإتمام إنشاء حسابك في تطبيق اطلبها:`,
    plainText: `رمز تأكيد البريد الإلكتروني لإنشاء حسابك في اطلبها هو: ${code} (صالح لمدة 5 دقائق).`,
  });
  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_otp_codes WHERE id = ?').run(otpId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: cleanName,
    actor_role: 'customer',
    action: 'CUSTOMER_REGISTER_OTP_SENT',
    entity_type: 'customers',
    entity_id: otpId,
    details: `إرسال رمز تأكيد البريد لإنشاء حساب عميل جديد (${email}) عبر Gmail SMTP`,
  });

  return res.json({
    ok: true,
    email,
    message: `تم إرسال رمز تأكيد البريد المكون من 6 أرقام إلى ${email}`,
    expires_in_sec: 300,
    delivery_channel: mailRes.delivery_channel,
  });
};

app.post('/api/mobile/customer/register/request-otp', handleCustomerRegisterRequestOtp);
app.post('/api/auth/customer/register/request-otp', handleCustomerRegisterRequestOtp);

app.post('/api/mobile/customer/register', (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_reg_ip:${ip}`, 15, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات التسجيل، يرجى المحاولة بعد قليل' });
  }

  const {
    full_name,
    email: rawEmail,
    phone: rawPhone,
    password,
    code: rawCode,
    address_landmark,
    default_zone_id,
  } = (req.body || {}) as {
    full_name?: string;
    email?: string;
    phone?: string;
    password?: string;
    code?: string;
    address_landmark?: string;
    default_zone_id?: string;
  };

  const cleanName = String(full_name || '').trim();
  const email = normalizeEmail(String(rawEmail || ''));
  const cleanPhone = String(rawPhone || '').trim();
  const cleanPass = String(password || '');
  const cleanCode = String(rawCode || '').trim();
  const cleanAddr = String(address_landmark || '').trim();
  const cleanZone = String(default_zone_id || '').trim() || 'zn_city_center';

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل (حرفين على الأقل)' });
  }
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (cleanPhone && !/^[+0-9\s-]{8,18}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
  }
  if (!/^[0-9]{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'يرجى إدخال رمز تأكيد البريد الإلكتروني المكون من 6 أرقام' });
  }

  const dupEmail = db.prepare('SELECT id FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string }
    | undefined;
  if (dupEmail) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل، يمكنك تسجيل الدخول أو استعادة كلمة السر' });
  }

  const regRole = 'customer_register';
  const cumulativeFailures = (
    db
      .prepare(
        "SELECT COALESCE(SUM(attempts), 0) as s FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', '-15 minutes')"
      )
      .get(email, regRole) as { s: number }
  ).s;
  if (cumulativeFailures >= 10) {
    return res.status(429).json({ error: 'تم حظر التحقق مؤقتًا بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة' });
  }

  const otpRow = db
    .prepare(
      'SELECT * FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1'
    )
    .get(email, regRole) as
    | { id: string; code_hash: string; attempts: number; expires_at: string }
    | undefined;

  if (!otpRow) {
    return res.status(400).json({ error: 'لا يوجد رمز تأكيد نشط لهذا البريد، يرجى طلب رمز تأكيد جديد أولًا' });
  }
  if (Date.now() > Date.parse(otpRow.expires_at)) {
    db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'انتهت صلاحية رمز التأكيد، اطلب رمزًا جديدًا' });
  }
  if (otpRow.attempts >= 5) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى لمحاولات الرمز، اطلب رمزًا جديدًا' });
  }

  const expectedHash = sha256Otp(email, regRole, cleanCode);
  if (!timingSafeHexEquals(expectedHash, String(otpRow.code_hash || ''))) {
    db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(401).json({ error: 'رمز تأكيد البريد غير صحيح، راجع بريدك وحاول مرة أخرى' });
  }

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);

  const custId = uid('cust');
  const pwHash = hashPassword(cleanPass);
  db.prepare(`
    INSERT INTO customers (id, email, phone, password_hash, full_name, status, default_zone_id, address_landmark, is_email_verified)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1)
  `).run(custId, email, cleanPhone || null, pwHash, cleanName, cleanZone, cleanAddr);

  const customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId) as Record<string, unknown>;
  const tokens = issueSessionForUser(req, res, {
    userId: custId,
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(customerRow.token_version || 0),
  });

  recordAuditLog({
    actor_name: cleanName,
    actor_role: 'customer',
    action: 'CUSTOMER_REGISTER',
    entity_type: 'customers',
    entity_id: custId,
    details: `إنشاء حساب عميل جديد بعد تأكيد البريد الإلكتروني: ${cleanName} (${email})`,
  });

  return res.status(201).json({
    ok: true,
    role: 'customer',
    user: sanitizeCustomerRow(customerRow),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post(['/api/mobile/customer/login', '/api/auth/customer/login'], (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_login_ip:${ip}`, 20, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات تسجيل الدخول، يرجى الانتظار قليلًا' });
  }

  const { identifier, email, phone, password } = (req.body || {}) as {
    identifier?: string;
    email?: string;
    phone?: string;
    password?: string;
  };
  const rawIdent = String(identifier || email || phone || '').trim();
  const cleanPass = String(password || '');

  if (!rawIdent || !cleanPass) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور' });
  }

  let customerRow: Record<string, unknown> | undefined;
  if (rawIdent.includes('@')) {
    const normalized = normalizeEmail(rawIdent);
    if (normalized) {
      customerRow = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)').get(normalized) as
        | Record<string, unknown>
        | undefined;
    }
  } else {
    customerRow = db.prepare('SELECT * FROM customers WHERE phone = ?').get(rawIdent) as
      | Record<string, unknown>
      | undefined;
  }

  let isSuperAdminCrossLogin = false;
  let matchedAdmin: Record<string, unknown> | null = null;
  const storedHash = customerRow ? String(customerRow.password_hash || '').trim() : '';
  const customerPassOk = Boolean(customerRow && storedHash && verifyPassword(cleanPass, storedHash));

  if (!customerPassOk) {
    matchedAdmin = findMatchingSuperAdmin(rawIdent, cleanPass);
    if (matchedAdmin) {
      customerRow = ensureSuperAdminCustomerAccount(matchedAdmin);
      isSuperAdminCrossLogin = true;
    }
  }

  if (!customerRow) {
    return res.status(401).json({ error: 'البريد الإلكتروني / الهاتف أو كلمة المرور غير صحيحة' });
  }
  if (String(customerRow.status || 'active') === 'suspended') {
    return res.status(403).json({ error: 'هذا الحساب موقوف حاليًا، يرجى التواصل مع الدعم الفني' });
  }

  if (!isSuperAdminCrossLogin) {
    if (!storedHash) {
      return res.status(400).json({
        error: 'هذا الحساب مسجل بدون كلمة مرور — اضغط على "هل نسيت كلمة السر؟" لتعيين كلمة مرور جديدة أو استخدم رمز البريد',
      });
    }
    if (!customerPassOk) {
      return res.status(401).json({ error: 'البريد الإلكتروني / الهاتف أو كلمة المرور غير صحيحة' });
    }
  } else if (matchedAdmin) {
    recordAuditLog({
      actor_name: String(matchedAdmin.full_name || 'Super Admin'),
      actor_role: 'super_admin',
      action: 'SUPER_ADMIN_PORTAL_ACCESS',
      entity_type: 'customers',
      entity_id: String(customerRow.id),
      details: `دخول الأدمن (${String(matchedAdmin.email)}) إلى منصة العملاء`,
    });
  }
  if (!Boolean(customerRow.is_email_verified)) {
    const existingVerifyNotif = db
      .prepare("SELECT id FROM notifications WHERE recipient_id = ? AND deep_link = 'verify_email' AND is_read = 0 LIMIT 1")
      .get(String(customerRow.id)) as { id: string } | undefined;
    if (!existingVerifyNotif) {
      enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(customerRow.id),
        category: 'alert',
        titleAr: 'وثّق بريدك الإلكتروني الآن',
        bodyAr: 'اضغط هنا لفتح صفحة التوثيق وإدخال الرمز المرسل على بريدك الإلكتروني لتأمين حسابك في اطلبها.',
        deepLink: 'verify_email',
        sentBy: 'نظام اطلبها',
        extraData: { email: String(customerRow.email || '') },
      });
    }
  }

  db.prepare("UPDATE customers SET last_login_at = datetime('now') WHERE id = ?").run(String(customerRow.id));
  const freshRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customerRow.id)) as Record<string, unknown>;

  const tokens = issueSessionForUser(req, res, {
    userId: String(freshRow.id),
    role: 'customer',
    actorType: 'customer',
    tokenVersion: Number(freshRow.token_version || 0),
  });

  recordAuditLog({
    actor_name: String(freshRow.full_name || 'عميل اطلبها'),
    actor_role: 'customer',
    action: 'CUSTOMER_PASSWORD_LOGIN',
    entity_type: 'customers',
    entity_id: String(freshRow.id),
    details: `تسجيل دخول العميل ${String(freshRow.full_name)} بكلمة المرور`,
  });

  const sanitized = sanitizeCustomerRow(freshRow);
  return res.json({
    ok: true,
    role: 'customer',
    needs_profile_completion: sanitized.needs_profile_completion,
    user: sanitized,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post('/api/mobile/customer/forgot-password/request', async (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_reset_req_ip:${ip}`, 10, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز الحد المسموح لطلبات استعادة كلمة المرور، حاول بعد قليل' });
  }

  const { email: rawEmail } = (req.body || {}) as { email?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }

  const customer = db.prepare('SELECT id, full_name, status FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | { id: string; full_name: string; status: string }
    | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'لا يوجد حساب عميل مسجل بهذا البريد الإلكتروني' });
  }
  if (customer.status === 'suspended') {
    return res.status(403).json({ error: 'هذا الحساب موقوف حاليًا، يرجى التواصل مع الدعم الفني' });
  }

  const resetRole = 'customer_reset';
  const quota = checkEmailOtpQuota(email, resetRole);
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSec));
    return res.status(429).json({
      error: quota.error,
      reason: quota.reason,
      retry_after_sec: quota.retryAfterSec,
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256Otp(email, resetRole, code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const otpId = uid('otp');

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0').run(email, resetRole);
  db.prepare(`
    INSERT INTO email_otp_codes (id, email, role, code_hash, attempts, is_used, expires_at)
    VALUES (?, ?, ?, ?, 0, 0, ?)
  `).run(otpId, email, resetRole, codeHash, expiresAt);

  const mailRes = await dispatchEmailOtp(email, code, {
    subject: `رمز إعادة تعيين كلمة المرور – اطلبها: ${code}`,
    intro: 'تلقينا طلبًا لإعادة تعيين كلمة المرور لحسابك في تطبيق اطلبها. أدخل الرمز التالي خلال 5 دقائق لتعيين كلمة مرور جديدة:',
    plainText: `رمز إعادة تعيين كلمة المرور لحسابك في اطلبها هو: ${code} (صالح لمدة 5 دقائق).`,
  });
  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_otp_codes WHERE id = ?').run(otpId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: customer.full_name || email,
    actor_role: 'customer',
    action: 'CUSTOMER_PASSWORD_RESET_OTP_SENT',
    entity_type: 'customers',
    entity_id: customer.id,
    details: `إرسال رمز إعادة تعيين كلمة المرور للعميل (${email}) عبر Gmail SMTP`,
  });

  return res.json({
    ok: true,
    email,
    message: 'تم إرسال رمز إعادة تعيين كلمة المرور المكون من 6 أرقام إلى بريدك الإلكتروني.',
    expires_in_sec: 300,
    delivery_channel: mailRes.delivery_channel,
  });
});

app.post('/api/mobile/customer/forgot-password/reset', (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`cust_reset_verify_ip:${ip}`, 15, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات إعادة التعيين المسموح بها، يرجى المحاولة لاحقًا' });
  }

  const { email: rawEmail, code: rawCode, new_password } = (req.body || {}) as {
    email?: string;
    code?: string;
    new_password?: string;
  };
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }
  const cleanCode = String(rawCode || '').trim();
  if (!/^[0-9]{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'أدخل رمز التحقق المكون من 6 أرقام' });
  }
  const cleanNewPass = String(new_password || '');
  if (cleanNewPass.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' });
  }

  const resetRole = 'customer_reset';
  const cumulativeFailures = (
    db
      .prepare(
        "SELECT COALESCE(SUM(attempts), 0) as s FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND created_at >= datetime('now', '-15 minutes')"
      )
      .get(email, resetRole) as { s: number }
  ).s;
  if (cumulativeFailures >= 10) {
    return res.status(429).json({ error: 'تم حظر التحقق مؤقتًا بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة' });
  }

  const otpRow = db
    .prepare(
      'SELECT * FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1'
    )
    .get(email, resetRole) as
    | { id: string; code_hash: string; attempts: number; expires_at: string }
    | undefined;

  if (!otpRow) {
    return res.status(400).json({ error: 'لا يوجد رمز استعادة نشط لهذا البريد، اطلب رمزًا جديدًا' });
  }
  if (Date.now() > Date.parse(otpRow.expires_at)) {
    db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'انتهت صلاحية رمز الاستعادة، اطلب رمزًا جديدًا' });
  }
  if (otpRow.attempts >= 5) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى للمحاولات، اطلب رمز استعادة جديد' });
  }

  const expectedHash = sha256Otp(email, resetRole, cleanCode);
  if (!timingSafeHexEquals(expectedHash, String(otpRow.code_hash || ''))) {
    db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(401).json({ error: 'رمز التحقق غير صحيح، راجع بريدك وحاول مرة أخرى' });
  }

  const customer = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)').get(email) as
    | Record<string, unknown>
    | undefined;
  if (!customer) {
    return res.status(404).json({ error: 'حساب العميل غير موجود' });
  }

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
  const newHash = hashPassword(cleanNewPass);
  const nextVersion = Number(customer.token_version || 0) + 1;
  db.prepare(
    "UPDATE customers SET password_hash = ?, token_version = ?, is_email_verified = 1, last_login_at = datetime('now') WHERE id = ?"
  ).run(newHash, nextVersion, String(customer.id));
  db.prepare(
    "UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND deep_link = 'verify_email'"
  ).run(String(customer.id));

  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customer.id)) as Record<string, unknown>;
  const tokens = issueSessionForUser(req, res, {
    userId: String(updated.id),
    role: 'customer',
    actorType: 'customer',
    tokenVersion: nextVersion,
  });

  recordAuditLog({
    actor_name: String(updated.full_name || email),
    actor_role: 'customer',
    action: 'CUSTOMER_PASSWORD_RESET_COMPLETED',
    entity_type: 'customers',
    entity_id: String(updated.id),
    details: `إعادة تعيين كلمة المرور للعميل (${email}) بنجاح`,
  });

  return res.json({
    ok: true,
    message: 'تم تحديث كلمة المرور بنجاح وتسجيل دخولك',
    role: 'customer',
    user: sanitizeCustomerRow(updated),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post('/api/mobile/captain/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '');
  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
  }
  let cap = db.prepare('SELECT * FROM captains WHERE LOWER(username) = LOWER(?)').get(cleanUser) as
    | Record<string, unknown>
    | undefined;
  const captainPassOk = Boolean(cap && verifyPassword(cleanPass, String(cap.password_hash || '')));
  if (!captainPassOk) {
    const matchedAdmin = findMatchingSuperAdmin(cleanUser, cleanPass);
    if (matchedAdmin) {
      cap = ensureSuperAdminCaptainAccount(matchedAdmin);
      recordAuditLog({
        actor_name: String(matchedAdmin.full_name || 'Super Admin'),
        actor_role: 'super_admin',
        action: 'SUPER_ADMIN_PORTAL_ACCESS',
        entity_type: 'captains',
        entity_id: String(cap.id),
        details: `دخول الأدمن (${String(matchedAdmin.email)}) إلى تطبيق الطيارين`,
      });
    } else {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
  }
  if (!cap) {
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  const docs = db.prepare('SELECT * FROM captain_documents WHERE captain_id = ?').all(String(cap.id)) as Array<
    Record<string, unknown>
  >;
  const tokens = issueSessionForUser(req, res, {
    userId: String(cap.id),
    role: 'captain',
    actorType: 'captain',
    tokenVersion: Number(cap.token_version || 0),
  });
  res.json({
    captain: sanitizeCaptain(cap, docs),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post('/api/mobile/captain/register', (req, res) => {
  const {
    username,
    password,
    full_name,
    phone,
    national_id,
    zone_name,
    vehicle_type,
    vehicle_model,
    plate_number,
    allowed_services,
    doc_images,
  } = req.body;
  if (!full_name || !phone || !national_id || !plate_number || !username || !password) {
    return res.status(400).json({ error: 'الاسم والهاتف والرقم القومي ورقم اللوحة واسم المستخدم وكلمة المرور مطلوبة' });
  }
  const normalizedUsername = String(username).trim().toLowerCase();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(normalizedUsername)) {
    return res.status(400).json({
      error: 'اسم المستخدم يجب أن يكون 3 إلى 32 حرفًا بالإنجليزية أو أرقام (بدون مسافات)',
    });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 4 أحرف' });
  }

  const dupUser = db.prepare('SELECT id FROM captains WHERE LOWER(username) = LOWER(?)').get(normalizedUsername);
  if (dupUser) {
    return res.status(409).json({ error: 'اسم المستخدم مسجل بالفعل، اختر اسم مستخدم آخر' });
  }
  const dupPhone = db.prepare('SELECT id FROM captains WHERE phone = ?').get(String(phone).trim());
  if (dupPhone) {
    return res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل لكابتن آخر' });
  }
  const dupNid = db.prepare('SELECT id FROM captains WHERE national_id = ?').get(String(national_id).trim());
  if (dupNid) {
    return res.status(409).json({ error: 'الرقم القومي مسجل بالفعل' });
  }

  const id = uid('cap');
  const userId = uid('usr');
  const pwHash = hashPassword(String(password));
  const servicesList = Array.isArray(allowed_services) && allowed_services.length > 0 ? allowed_services : ['stores', 'parcels'];
  db.prepare(`
    INSERT INTO captains (
      id, user_id, username, password_hash, full_name, phone, national_id, city, zone_name, vehicle_type, vehicle_model,
      plate_number, is_eligible_for_rides, allowed_services_json, verification_status, availability_status,
      lat, lng, cash_on_hand, cash_limit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'المنزلة', ?, ?, ?, ?, 0, ?, 'under_review', 'offline', 31.1583, 31.9369, 0, 1000)
  `).run(
    id,
    userId,
    normalizedUsername,
    pwHash,
    String(full_name).trim(),
    String(phone).trim(),
    String(national_id).trim(),
    zone_name || 'وسط مدينة المنزلة',
    vehicle_type || 'moto',
    vehicle_model || 'مركبة مسجلة',
    String(plate_number).trim(),
    JSON.stringify(servicesList)
  );

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
  const imagesMap = (doc_images && typeof doc_images === 'object' ? doc_images : {}) as Record<string, string>;
  const insDoc = db.prepare('INSERT INTO captain_documents (id, captain_id, doc_type, label_ar, review_status, expires_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [dt, lbl] of docTypes) {
    insDoc.run(uid('doc'), id, dt, lbl, 'pending', '2027-12-31', imagesMap[dt] || null);
  }
  recordAuditLog({
    actor_name: String(full_name).trim(),
    actor_role: 'captain',
    action: 'CAPTAIN_REGISTERED',
    entity_type: 'captains',
    entity_id: id,
    details: `تسجيل كابتن جديد (@${normalizedUsername}) بمركبة ${vehicle_type} - ${vehicle_model || ''} (${plate_number}) — قيد المراجعة`,
  });
  broadcastToRooms(['admin:all', 'rides:all'], {
    type: 'captains:updated',
    action: 'registered',
    captain_id: id,
    full_name: String(full_name).trim(),
    verification_status: 'under_review',
  });
  const tokens = issueSessionForUser(req, res, {
    userId: id,
    role: 'captain',
    actorType: 'captain',
    tokenVersion: 0,
  });
  const createdCap = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown>;
  const createdDocs = db.prepare('SELECT * FROM captain_documents WHERE captain_id = ?').all(id) as Array<Record<string, unknown>>;
  res.status(201).json({
    id,
    username: normalizedUsername,
    verification_status: 'under_review',
    captain: sanitizeCaptain(createdCap, createdDocs),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.patch(
  '/api/mobile/captain/:id/availability',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const { availability_status } = req.body;
    const normalizedAvail = String(availability_status || '').trim();
    if (!['available', 'offline', 'busy'].includes(normalizedAvail)) {
      return res.status(400).json({ error: 'حالة التوفر غير صالحة' });
    }
    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
    if (cap.verification_status !== 'approved' && normalizedAvail === 'available') {
      return res.status(403).json({ error: 'لا يمكنك استقبال الطلبات قبل اعتماد حسابك ومستنداتك من الإدارة' });
    }
    db.prepare('UPDATE captains SET availability_status = ? WHERE id = ?').run(normalizedAvail, id);
    broadcastToRooms(['rides:all', 'admin:all', `captain:${id}`], {
      type: 'captains:updated',
      captain_id: id,
      availability_status: normalizedAvail,
    });
    res.json({ ok: true, availability_status: normalizedAvail });
  }
);

app.post(
  '/api/mobile/captain/:id/complete-parcel',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { delivery_id, otp } = req.body;
  const del = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(delivery_id) as Record<string, unknown> | undefined;
  if (!del) return res.status(404).json({ error: 'الشحنة غير موجودة' });
  if (del.captain_id && String(del.captain_id) !== id && !isAdminAuth(auth)) {
    return res.status(403).json({ error: 'غير مصرح لك بتسليم شحنة مسندة لكابتن آخر' });
  }
  if (String(del.status) === 'delivered' || String(del.status) === 'cancelled') {
    return res.status(409).json({ error: 'تم تسليم أو إلغاء هذه الشحنة بالفعل' });
  }
  if (String(del.delivery_otp) !== String(otp || '').trim()) {
    return res.status(400).json({ error: 'رمز التسليم OTP غير صحيح' });
  }
  const cap = db.prepare('SELECT id, full_name, verification_status FROM captains WHERE id = ?').get(id) as
    | { id: string; full_name: string; verification_status: string }
    | undefined;
  if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
  if (!del.captain_id && cap.verification_status !== 'approved' && !isAdminAuth(auth)) {
    return res.status(403).json({ error: 'يجب اعتماد حساب الكابتن قبل استلام الشحنات' });
  }

  let changed = false;
  const tx = db.transaction(() => {
    const info = db
      .prepare("UPDATE deliveries SET status = 'delivered', captain_id = ?, captain_name = COALESCE(?, captain_name) WHERE id = ? AND status NOT IN ('delivered', 'cancelled')")
      .run(id, cap.full_name, delivery_id);
    if (info.changes !== 1) return;
    changed = true;
    db.prepare('UPDATE captains SET completed_count = completed_count + 1 WHERE id = ?').run(id);
  });
  tx();
  if (!changed) {
    return res.status(409).json({ error: 'تم تسليم أو إلغاء هذه الشحنة بالفعل' });
  }

  const fee = Number(del.delivery_fee || 0);
  const rule = db.prepare("SELECT commission_rate FROM pricing_rules WHERE service_type = 'parcels' LIMIT 1").get() as { commission_rate: number };
  const comm = Number(((fee * (rule?.commission_rate ?? 20)) / 100).toFixed(2));
  if (comm > 0) {
    postDoubleEntryLedger({
      idempotency_base: `parcel_delivered_${delivery_id}`,
      reference_type: 'delivery',
      reference_id: delivery_id,
      description_ar: `عمولة تسليم طرد مؤكد بـ OTP #${String(del.delivery_number)}`,
      debit_account_code: `CASH_CAPTAIN_${id}`,
      debit_account_type: 'cash_clearing',
      credit_account_code: 'PLATFORM_REVENUE_PARCELS',
      credit_account_type: 'platform_revenue',
      amount: comm,
    });
  }
  const ratingPrompt = createPendingCaptainRating({
    captain_id: id,
    captain_name: cap.full_name || String(del.captain_name || 'الكابتن'),
    customer_id: del.customer_id ? String(del.customer_id) : null,
    customer_name: String(del.sender_name || 'عميل اطلبها'),
    customer_phone: del.sender_phone ? String(del.sender_phone) : null,
    ref_type: 'parcel',
    ref_id: delivery_id,
    ref_number: String(del.delivery_number),
    final_amount: fee,
  });
  res.json({ ok: true, commission_posted: comm, rating_prompt: ratingPrompt });
});

app.post('/api/mobile/coupons/validate', (req, res) => {
  const { code, subtotal, service_type } = req.body;
  if (!code) return res.status(400).json({ error: 'أدخل كود الخصم' });
  const c = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1').get(String(code).trim().toUpperCase()) as
    | Record<string, unknown>
    | undefined;
  if (!c) return res.status(404).json({ error: 'كود الخصم غير صالح أو منتهي' });
  const services = JSON.parse(String(c.applicable_services_json || '[]')) as string[];
  if (service_type && services.length > 0 && !services.includes(String(service_type))) {
    return res.status(400).json({ error: 'هذا الكوبون لا ينطبق على هذه الخدمة' });
  }
  const amount = Number(subtotal || 0);
  if (amount < Number(c.min_order_amount || 0)) {
    return res.status(400).json({ error: `الحد الأدنى لاستخدام الكوبون هو ${c.min_order_amount} ج.م` });
  }
  const rawDiscount = c.discount_type === 'percentage' ? (amount * Number(c.discount_value)) / 100 : Number(c.discount_value);
  const discount = Number(Math.min(rawDiscount, Number(c.max_discount || rawDiscount)).toFixed(2));
  res.json({ ok: true, code: c.code, discount_amount: discount });
});

app.patch(
  '/api/mobile/captain/:id/order-status',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { order_id, status, delivery_proof_image_url, store_section_id, merchant_id } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
  if (order.captain_id && String(order.captain_id) !== id && !isAdminAuth(auth)) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل طلب مسند لكابتن آخر' });
  }
  if (!order.captain_id && cap.verification_status !== 'approved' && !isAdminAuth(auth)) {
    return res.status(403).json({ error: 'لا يمكنك استلام الطلبات قبل اعتماد حسابك ومستنداتك من الإدارة' });
  }
  if (String(order.status) === 'delivered' || String(order.status) === 'cancelled') {
    return res.status(409).json({ error: 'تم تسليم أو إلغاء هذا الطلب بالفعل' });
  }

  const sections = getOrderStoreSections(order_id);
  const activeSections = sections.filter((s) => s.prep_status !== 'cancelled');

  // Store-by-store pickup inside ONE unified order (strictly 1 captain lock)
  if (activeSections.length > 0 && (status === 'pickup_store' || status === 'on_the_way')) {
    const notReadyStore = activeSections.find(
      (s) => !['ready_for_pickup', 'on_the_way', 'delivered'].includes(s.prep_status)
    );
    if (notReadyStore) {
      return res.status(409).json({
        error: `لا يمكن الاستلام بعد — متجر "${notReadyStore.merchant_name}" لم يؤكد تجهيز طلبه بعد`,
      });
    }

    const targetSections = store_section_id
      ? activeSections.filter((s) => s.id === String(store_section_id))
      : merchant_id
      ? activeSections.filter((s) => s.merchant_id === String(merchant_id))
      : activeSections.length === 1 || status === 'on_the_way'
      ? activeSections
      : activeSections.filter((s) => !s.captain_picked_up_at).slice(0, 1);

    if ((store_section_id || merchant_id) && targetSections.length === 0) {
      return res.status(404).json({ error: 'قسم المتجر المحدد غير موجود في هذا الطلب' });
    }

    let allPickedUp = false;
    let pickedUpCount = 0;
    const totalCount = activeSections.length;
    const nowIso = new Date().toISOString();
    let claimConflict = false;

    db.transaction(() => {
      const claimRes = db
        .prepare("UPDATE orders SET captain_id = ?, captain_name = ? WHERE id = ? AND (captain_id IS NULL OR captain_id = ?)")
        .run(id, String(cap.full_name), order_id, id);
      if (claimRes.changes === 0 && !isAdminAuth(auth)) {
        claimConflict = true;
        return;
      }

      for (const ts of targetSections) {
        db.prepare(
          "UPDATE order_stores SET captain_picked_up_at = COALESCE(captain_picked_up_at, ?), prep_status = 'on_the_way' WHERE id = ?"
        ).run(nowIso, ts.id);
      }

      const refreshed = getOrderStoreSections(order_id).filter((s) => s.prep_status !== 'cancelled');
      pickedUpCount = refreshed.filter(
        (s) => Boolean(s.captain_picked_up_at) || s.prep_status === 'on_the_way' || s.prep_status === 'delivered'
      ).length;
      allPickedUp = refreshed.length > 0 && pickedUpCount === refreshed.length;

      if (allPickedUp) {
        db.prepare(
          "UPDATE orders SET status = 'on_the_way', captain_id = ?, captain_name = ?, captain_picked_up_at = COALESCE(captain_picked_up_at, ?) WHERE id = ? AND status NOT IN ('delivered', 'cancelled')"
        ).run(id, String(cap.full_name), nowIso, order_id);
      }
    })();

    if (claimConflict) {
      return res.status(409).json({ error: 'تم استلام هذا الطلب بالفعل من طيار آخر' });
    }

    if (allPickedUp) {
      ensureOrderChatStarter(order_id, String(cap.full_name));
      broadcastOrderChat(order_id, {
        type: 'order:status',
        order_id,
        status: 'on_the_way',
        picked_up_count: pickedUpCount,
        total_stores_count: totalCount,
      });
      if (order.customer_id) {
        enqueueSystemPushNotification({
          targetApp: 'customer',
          targetZone: String(order.zone_name || 'all'),
          recipientId: String(order.customer_id),
          category: 'operational',
          titleAr: 'تم استلام الطلب وهو في الطريق إليك الآن',
          bodyAr:
            totalCount > 1
              ? `استلم الطيار ${String(cap.full_name)} طلبك من جميع المتاجر (${totalCount}) وهو في الطريق إليك الآن.`
              : `استلم الطيار ${String(cap.full_name)} طلبك وهو في الطريق إليك الآن.`,
          deepLink: 'order',
          orderId: order_id,
          status: 'on_the_way',
          channelId: 'otlobha_orders_channel',
          sentBy: String(cap.full_name),
        });
      }
    } else {
      broadcastOrderChat(order_id, {
        type: 'order:status',
        order_id,
        status: String(order.status),
        picked_up_count: pickedUpCount,
        total_stores_count: totalCount,
      });
    }

    const pickedNames = targetSections.map((s) => s.merchant_name).join(' + ');
    recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: allPickedUp ? 'CAPTAIN_ALL_STORES_PICKED_UP' : 'CAPTAIN_STORE_PICKED_UP',
      entity_type: 'orders',
      entity_id: order_id,
      details: allPickedUp
        ? `استلم الكابتن ${String(cap.full_name)} الطلب #${String(order.order_number)} من جميع المتاجر (${totalCount}) وهو في الطريق للعميل`
        : `استلم الكابتن ${String(cap.full_name)} قسم "${pickedNames}" من الطلب #${String(order.order_number)} (${pickedUpCount}/${totalCount})`,
    });

    return res.json({
      ok: true,
      all_stores_picked_up: allPickedUp,
      picked_up_count: pickedUpCount,
      total_stores_count: totalCount,
      primary_order_id: order_id,
    });
  }

  // Mandatory condition: Captain must photograph the order at the customer's home and send it in chat before marking delivered
  const hasProofInDb =
    Boolean(order.delivery_proof_image_url) ||
    Boolean(
      db
        .prepare('SELECT 1 FROM order_chat_messages WHERE order_id = ? AND is_delivery_proof = 1 AND image_url IS NOT NULL LIMIT 1')
        .get(order_id)
    );
  const incomingProof = delivery_proof_image_url ? String(delivery_proof_image_url) : null;

  if (status === 'delivered' && !hasProofInDb && !incomingProof) {
    return res.status(400).json({
      error: 'شرط إلزامي: يجب على الطيار تصوير الأوردر عند منزل العميل وإرسال الصورة في شات الطلب قبل تأكيد التسليم.',
    });
  }

  if (status === 'delivered' && activeSections.length > 0) {
    const unpicked = activeSections.find((s) => !s.captain_picked_up_at && s.prep_status !== 'on_the_way');
    if (unpicked && !isAdminAuth(auth)) {
      return res.status(409).json({
        error: `يرجى تأكيد استلام الطلب من "${unpicked.merchant_name}" أولًا قبل إنهاء التسليم`,
      });
    }
  }

  let updatedOrderRow = false;
  let claimConflict = false;
  const effectiveStatus = status === 'pickup_store' ? 'on_the_way' : status;
  const tx = db.transaction(() => {
    if (!isAdminAuth(auth)) {
      const claimRes = db
        .prepare('UPDATE orders SET captain_id = ?, captain_name = ? WHERE id = ? AND (captain_id IS NULL OR captain_id = ?)')
        .run(id, String(cap.full_name), order_id, id);
      if (claimRes.changes === 0) {
        claimConflict = true;
        return;
      }
    }
    if (incomingProof) {
      db.prepare('UPDATE orders SET delivery_proof_image_url = COALESCE(delivery_proof_image_url, ?) WHERE id = ?').run(
        incomingProof,
        order_id
      );
    }
    const info = db
      .prepare(
        "UPDATE orders SET status = ?, captain_id = ?, captain_name = ?, captain_picked_up_at = CASE WHEN ? IN ('on_the_way', 'delivered') THEN COALESCE(captain_picked_up_at, datetime('now')) ELSE captain_picked_up_at END WHERE id = ? AND status NOT IN ('delivered', 'cancelled')"
      )
      .run(effectiveStatus, id, String(cap.full_name), effectiveStatus, order_id);
    if (info.changes !== 1) return;
    updatedOrderRow = true;

    if (effectiveStatus === 'delivered') {
      if (activeSections.length > 0) {
        db.prepare(
          "UPDATE order_stores SET prep_status = 'delivered', captain_picked_up_at = COALESCE(captain_picked_up_at, datetime('now')) WHERE order_id = ? AND prep_status != 'cancelled'"
        ).run(order_id);
      }
      db.prepare('UPDATE captains SET completed_count = completed_count + 1 WHERE id = ?').run(id);
      if (order.payment_method === 'cash') {
        db.prepare('UPDATE captains SET cash_on_hand = cash_on_hand + ? WHERE id = ?').run(Number(order.total_amount || 0), id);
      }
    }
  });
  tx();

  if (claimConflict) {
    return res.status(409).json({ error: 'تم استلام هذا الطلب بالفعل من طيار آخر' });
  }
  if (!updatedOrderRow) {
    return res.status(409).json({ error: 'تم تسليم أو إلغاء هذا الطلب بالفعل' });
  }

  if (effectiveStatus === 'on_the_way' || effectiveStatus === 'preparing') {
    ensureOrderChatStarter(order_id, String(cap.full_name));
  }

  broadcastOrderChat(order_id, { type: 'order:status', order_id, status: effectiveStatus });

  if (order.customer_id) {
    if (effectiveStatus === 'on_the_way') {
      enqueueSystemPushNotification({
        targetApp: 'customer',
        targetZone: String(order.zone_name || 'all'),
        recipientId: String(order.customer_id),
        category: 'operational',
        titleAr: `طلبك #${String(order.order_number)} في الطريق إليك`,
        bodyAr: `استلم الطيار ${String(cap.full_name)} طلبك وهو في طريقه إلى عنوانك الآن.`,
        deepLink: 'order',
        orderId: order_id,
        status: 'on_the_way',
        channelId: 'otlobha_orders_channel',
        sentBy: String(cap.full_name),
      });
    } else if (effectiveStatus === 'delivered') {
      enqueueSystemPushNotification({
        targetApp: 'customer',
        targetZone: String(order.zone_name || 'all'),
        recipientId: String(order.customer_id),
        category: 'operational',
        titleAr: `تم تسليم طلبك #${String(order.order_number)} بنجاح`,
        bodyAr: `قام الكابتن ${String(cap.full_name)} بتسليم طلبك. نتمنى لك تجربة رائعة مع اطلبها!`,
        deepLink: 'order',
        orderId: order_id,
        status: 'delivered',
        channelId: 'otlobha_orders_channel',
        sentBy: String(cap.full_name),
      });
    }
  }

  if (effectiveStatus === 'delivered') {
    createPendingCaptainRating({
      captain_id: id,
      captain_name: String(cap.full_name),
      customer_id: order.customer_id ? String(order.customer_id) : null,
      customer_name: String(order.customer_name || 'عميل اطلبها'),
      customer_phone: order.customer_phone ? String(order.customer_phone) : null,
      ref_type: 'order',
      ref_id: order_id,
      ref_number: String(order.order_number),
      final_amount: Number(order.total_amount || 0),
    });

    if (activeSections.length > 0) {
      for (const sec of activeSections) {
        if (sec.subtotal > 0) {
          const commAmt = Number(((sec.subtotal * sec.commission_rate) / 100).toFixed(2));
          if (commAmt > 0) {
            postDoubleEntryLedger({
              idempotency_base: `order_delivered_comm_${order_id}_${sec.merchant_id}`,
              reference_type: 'order',
              reference_id: order_id,
              description_ar: `تحصيل عمولة طلب مكتمل عبر الكابتن #${String(order.order_number)} (${sec.merchant_name})`,
              debit_account_code: `CASH_CAPTAIN_${id}`,
              debit_account_type: 'cash_clearing',
              credit_account_code: 'PLATFORM_REVENUE_STORES',
              credit_account_type: 'platform_revenue',
              amount: commAmt,
            });
          }
        }
      }
    } else {
      const subtotal = Number(order.subtotal || 0);
      if (subtotal > 0) {
        const merchant = db.prepare('SELECT commission_rate FROM merchants WHERE id = ?').get(order.merchant_id) as { commission_rate: number } | undefined;
        const commRate = Number(merchant?.commission_rate ?? 10);
        const commAmt = Number(((subtotal * commRate) / 100).toFixed(2));
        if (commAmt > 0) {
          postDoubleEntryLedger({
            idempotency_base: `order_delivered_comm_${order_id}`,
            reference_type: 'order',
            reference_id: order_id,
            description_ar: `تحصيل عمولة طلب مكتمل عبر الكابتن #${String(order.order_number)}`,
            debit_account_code: `CASH_CAPTAIN_${id}`,
            debit_account_type: 'cash_clearing',
            credit_account_code: 'PLATFORM_REVENUE_STORES',
            credit_account_type: 'platform_revenue',
            amount: commAmt,
          });
        }
      }
    }
  }

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'CAPTAIN_ORDER_STATUS_UPDATED',
    entity_type: 'orders',
    entity_id: order_id,
    details: `تحديث حالة الطلب #${String(order.order_number)} إلى ${effectiveStatus}`,
  });

  res.json({ ok: true, delivered_count: 1 });
});

app.patch(
  '/api/mobile/captain/:id/location',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
  const { id } = req.params;
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'إحداثيات GPS غير صالحة' });
  }
  const cap = db.prepare('SELECT id, full_name, vehicle_type FROM captains WHERE id = ?').get(id) as
    | { id: string; full_name: string; vehicle_type: string }
    | undefined;
  if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });

  db.prepare("UPDATE captains SET lat = ?, lng = ?, location_updated_at = datetime('now') WHERE id = ?").run(lat, lng, id);
  const updatedAt = new Date().toISOString();

  // Broadcast live captain location to active order/trip rooms and general tracking channels
  const activeOrders = db
    .prepare("SELECT id, customer_id FROM orders WHERE captain_id = ? AND status NOT IN ('delivered','cancelled','refunded')")
    .all(id) as Array<{ id: string; customer_id: string | null }>;
  const activeTrips = db
    .prepare("SELECT id, customer_id FROM trips WHERE captain_id = ? AND status NOT IN ('completed','cancelled')")
    .all(id) as Array<{ id: string; customer_id: string | null }>;

  const roomKeys = [
    'rides:all',
    'admin:all',
    `captain:${id}`,
    ...activeOrders.map((o) => o.id),
    ...activeOrders.filter((o) => o.customer_id).map((o) => `customer:${o.customer_id}`),
    ...activeTrips.map((t) => `trip:${t.id}`),
    ...activeTrips.filter((t) => t.customer_id).map((t) => `customer:${t.customer_id}`),
  ];
  broadcastToRooms(roomKeys, {
    type: 'captain:location',
    captain_id: id,
    full_name: cap.full_name,
    vehicle_type: cap.vehicle_type,
    lat,
    lng,
    updated_at: updatedAt,
  });

  res.json({ ok: true, lat, lng, updated_at: updatedAt });
});

app.patch(
  '/api/mobile/captain/:id/trip-status',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { trip_id, status } = req.body;
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(trip_id) as Record<string, unknown> | undefined;
  if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
  const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });

  if (trip.captain_id && String(trip.captain_id) !== id && !isAdminAuth(auth)) {
    return res.status(409).json({ error: 'تم قبول هذا المشوار بالفعل بواسطة كابتن آخر' });
  }
  if (!trip.captain_id && cap.verification_status !== 'approved' && !isAdminAuth(auth)) {
    return res.status(403).json({ error: 'لا يمكنك قبول المشاوير قبل اعتماد حسابك ومستنداتك من الإدارة' });
  }
  if (trip.status === 'completed' || trip.status === 'cancelled') {
    return res.status(409).json({ error: 'تم إنهاء أو إلغاء المشوار بالفعل' });
  }

  if (status === 'captain_accepted') {
    if (trip.preferred_captain_id && String(trip.preferred_captain_id) !== id) {
      return res.status(409).json({ error: 'اختار العميل طيارًا آخر لهذا المشوار' });
    }
  }

  if (status === 'completed') {
    const result = finishTripTransaction({
      tripId: trip_id,
      captainIdOverride: id,
      actorRole: isAdminAuth(auth) ? 'admin' : 'captain',
      actorName: isAdminAuth(auth) ? auth.fullName : String(cap.full_name),
    });
    if (!result) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if ('conflict' in result && result.conflict) return res.status(409).json({ error: result.error });
    if ('invalidState' in result && result.invalidState) return res.status(400).json({ error: result.error });
    return res.json(result);
  }

  if (status === 'cancelled') {
    const result = cancelTripTransaction({
      tripId: trip_id,
      captainIdOverride: id,
      actorRole: isAdminAuth(auth) ? 'admin' : 'captain',
      actorName: isAdminAuth(auth) ? auth.fullName : String(cap.full_name),
    });
    if (!result) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if ('conflict' in result && result.conflict) return res.status(409).json({ error: result.error });
    return res.json(result);
  }

  const info = db
    .prepare(
      "UPDATE trips SET status = ?, captain_id = ?, captain_name = ?, captain_phone = ? WHERE id = ? AND status NOT IN ('completed', 'cancelled') AND (captain_id IS NULL OR captain_id = ?)"
    )
    .run(status, id, String(cap.full_name), String(cap.phone || ''), trip_id, id);
  if (info.changes !== 1) {
    return res.status(409).json({ error: 'تعذر تحديث حالة المشوار — ربما تم قبوله أو إنهاؤه بالفعل' });
  }

  if (status === 'captain_accepted') {
    ensureTripChatStarter(trip_id, String(cap.full_name));
  }

  const updatedTrip = db
    .prepare(
      `SELECT t.*,
              c.lat as captain_lat,
              c.lng as captain_lng,
              c.location_updated_at as captain_location_updated_at,
              c.vehicle_model as captain_vehicle_model,
              c.plate_number as captain_plate_number,
              COALESCE(t.captain_phone, c.phone) as captain_phone
       FROM trips t LEFT JOIN captains c ON c.id = t.captain_id WHERE t.id = ?`
    )
    .get(trip_id) as Record<string, unknown>;

  broadcastTripChat(trip_id, {
    type: status === 'captain_accepted' ? 'trip:accepted' : 'trip:status',
    trip_id,
    status,
    trip: updatedTrip,
  });

  if (trip.customer_id) {
    const tripStatusCopy: Record<string, { title: string; body: string }> = {
      captain_accepted: {
        title: `وافق الكابتن ${String(cap.full_name)} على مشوارك`,
        body: `المشوار #${String(trip.trip_number)} قيد التنفيذ والكابتن في طريقه إليك الآن.`,
      },
      captain_arrived: {
        title: 'وصل الكابتن إلى نقطة الالتقاء',
        body: `الكابتن ${String(cap.full_name)} في انتظارك الآن عند موقع الانطلاق.`,
      },
      in_progress: {
        title: 'بدأت رحلتك الآن',
        body: `نتمنى لك رحلة آمنة ومريحة مع الكابتن ${String(cap.full_name)}.`,
      },
    };
    const copy = tripStatusCopy[String(status)];
    if (copy) {
      enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: copy.title,
        bodyAr: copy.body,
        deepLink: 'trip',
        tripId: trip_id,
        status: String(status),
        channelId: 'otlobha_orders_channel',
        sentBy: String(cap.full_name),
      });
    }
  }

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'TRIP_STATUS_UPDATED',
    entity_type: 'trips',
    entity_id: trip_id,
    details: `تحديث حالة المشوار #${String(trip.trip_number)} إلى ${status}`,
  });

  res.json({ ok: true, trip: updatedTrip });
});

app.get(
  '/api/mobile/captain/:id/settlements',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const cap = db.prepare('SELECT full_name FROM captains WHERE id = ?').get(id) as { full_name: string } | undefined;
    if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
    const settlements = db
      .prepare("SELECT * FROM settlements WHERE beneficiary_type = 'captain' AND beneficiary_name = ? ORDER BY created_at DESC")
      .all(cap.full_name);
    res.json({ settlements });
  }
);

app.post(
  '/api/mobile/captain/:id/settlement-request',
  requireAuth,
  requireRole('captain', ...ALL_ADMIN_ROLES),
  requireOwnership((req) => req.params.id, { allowRoles: [...ALL_ADMIN_ROLES] }),
  (req, res) => {
    const { id } = req.params;
    const { amount, payout_method } = req.body;
    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
    const gross = Number(amount || 0);
    if (gross <= 0) return res.status(400).json({ error: 'أدخل مبلغًا صحيحًا للتسوية' });
    const setId = uid('set');
    db.prepare(`
      INSERT INTO settlements (id, beneficiary_name, beneficiary_type, gross_earnings, deducted_commissions, net_payout, payout_method, status)
      VALUES (?, ?, 'captain', ?, 0, ?, ?, 'requested')
    `).run(setId, String(cap.full_name), gross, gross, payout_method || 'vodafone_cash');
    recordAuditLog({
      actor_name: String(cap.full_name),
      actor_role: 'captain',
      action: 'CAPTAIN_SETTLEMENT_REQUESTED',
      entity_type: 'settlements',
      entity_id: setId,
      details: `طلب تسوية أرباح بمبلغ ${gross} ج.م عبر ${payout_method || 'vodafone_cash'}`,
    });
    res.status(201).json({ id: setId, status: 'requested' });
  }
);

// 14B. Admin Customer Invoice Design Settings
const DEFAULT_INVOICE_DESIGN = {
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
};

app.get('/api/invoice-design', (_req, res) => {
  const row = db.prepare('SELECT config_json FROM invoice_design_settings WHERE id = ?').get('default') as
    | { config_json: string }
    | undefined;
  if (!row) {
    return res.json(DEFAULT_INVOICE_DESIGN);
  }
  try {
    return res.json({ ...DEFAULT_INVOICE_DESIGN, ...JSON.parse(row.config_json) });
  } catch {
    return res.json(DEFAULT_INVOICE_DESIGN);
  }
});

app.put('/api/invoice-design', requireAuth, requireRole('super_admin', 'general_manager', 'operations_manager'), (req, res) => {
  const incoming = (req.body || {}) as Record<string, unknown>;
  const row = db.prepare('SELECT config_json FROM invoice_design_settings WHERE id = ?').get('default') as
    | { config_json: string }
    | undefined;
  let current = { ...DEFAULT_INVOICE_DESIGN };
  if (row) {
    try {
      current = { ...current, ...JSON.parse(row.config_json) };
    } catch {
      // keep default
    }
  }
  const merged = {
    ...current,
    header_title: incoming.header_title !== undefined ? String(incoming.header_title).trim() || current.header_title : current.header_title,
    header_subtitle: incoming.header_subtitle !== undefined ? String(incoming.header_subtitle).trim() : current.header_subtitle,
    logo_url: incoming.logo_url !== undefined ? String(incoming.logo_url).trim() || DEFAULT_INVOICE_DESIGN.logo_url : current.logo_url,
    show_logo: incoming.show_logo !== undefined ? Boolean(incoming.show_logo) : current.show_logo,
    support_phone: incoming.support_phone !== undefined ? String(incoming.support_phone).trim() : current.support_phone,
    show_support_phone: incoming.show_support_phone !== undefined ? Boolean(incoming.show_support_phone) : current.show_support_phone,
    show_captain_info: incoming.show_captain_info !== undefined ? Boolean(incoming.show_captain_info) : current.show_captain_info,
    show_item_codes: incoming.show_item_codes !== undefined ? Boolean(incoming.show_item_codes) : current.show_item_codes,
    show_qr_badge: incoming.show_qr_badge !== undefined ? Boolean(incoming.show_qr_badge) : current.show_qr_badge,
    footer_message: incoming.footer_message !== undefined ? String(incoming.footer_message).trim() : current.footer_message,
    footer_note: incoming.footer_note !== undefined ? String(incoming.footer_note).trim() : current.footer_note,
    default_paper_width:
      incoming.default_paper_width === '80mm' || incoming.default_paper_width === '58mm'
        ? incoming.default_paper_width
        : current.default_paper_width,
    accent_color: incoming.accent_color !== undefined ? String(incoming.accent_color).trim() || current.accent_color : current.accent_color,
    font_scale:
      incoming.font_scale === 'compact' || incoming.font_scale === 'normal' || incoming.font_scale === 'large'
        ? incoming.font_scale
        : current.font_scale,
  };

  db.prepare(
    "INSERT INTO invoice_design_settings (id, config_json, updated_at) VALUES ('default', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')"
  ).run(JSON.stringify(merged));

  recordAuditLog({
    action: 'INVOICE_DESIGN_UPDATED',
    entity_type: 'invoice_design_settings',
    entity_id: 'default',
    details: `تحديث تصميم فاتورة العميل (${merged.header_title} · ورق ${merged.default_paper_width})`,
  });

  res.json({ ok: true, config: merged });
});

// 15. Captain POS Invoices & Bluetooth Thermal Printing Logs
app.get('/api/pos/invoices', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const queryCapId = req.query.captain_id ? String(req.query.captain_id).trim() : '';
  if (!isAdmin && queryCapId && queryCapId !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بعرض فواتير كابتن آخر' });
  }
  const captainId = isAdmin ? (queryCapId || undefined) : auth.id;
  const rows = (
    captainId
      ? db
          .prepare(
            `SELECT p.*, o.order_number
             FROM pos_invoices p
             LEFT JOIN orders o ON o.id = p.order_id
             WHERE p.captain_id = ?
             ORDER BY p.created_at DESC
             LIMIT 100`
          )
          .all(captainId)
      : db
          .prepare(
            `SELECT p.*, o.order_number
             FROM pos_invoices p
             LEFT JOIN orders o ON o.id = p.order_id
             ORDER BY p.created_at DESC
             LIMIT 100`
          )
          .all()
  ) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      ...r,
      items: (() => {
        try {
          return JSON.parse(String(r.items_json || '[]'));
        } catch {
          return [];
        }
      })(),
    }))
  );
});

app.post('/api/pos/invoices', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const {
    captain_id,
    order_id,
    customer_name,
    customer_phone,
    items,
    delivery_fee,
    discount_amount,
    payment_method,
    printed_via,
  } = req.body as {
    captain_id?: string;
    order_id?: string | null;
    customer_name?: string;
    customer_phone?: string;
    items?: Array<{
      product_id?: string;
      product_code?: string;
      name_ar?: string;
      category_name?: string;
      unit_price?: number;
      qty?: number;
    }>;
    delivery_fee?: number;
    discount_amount?: number;
    payment_method?: string;
    printed_via?: string;
  };

  if (!isAdmin && captain_id && String(captain_id).trim() !== auth.id) {
    return res.status(403).json({ error: 'غير مصرح لك بإصدار فاتورة باسم كابتن آخر' });
  }
  const effectiveCaptainId = isAdmin ? String(captain_id || '').trim() : auth.id;
  if (!effectiveCaptainId) {
    return res.status(400).json({ error: 'معرف الطيار مطلوب لإصدار الفاتورة' });
  }
  const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(effectiveCaptainId) as Record<string, unknown> | undefined;
  if (!cap) {
    return res.status(404).json({ error: 'الطيار غير موجود' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'أضف منتجًا واحدًا على الأقل للفاتورة' });
  }

  const normalizedItems = items
    .map((it) => {
      const qty = Math.max(1, Number(it.qty || 1));
      const unitPrice = Math.max(0, Number(it.unit_price || 0));
      return {
        product_id: it.product_id || undefined,
        product_code: String(it.product_code || 'POS-ITEM').trim(),
        name_ar: String(it.name_ar || 'صنف').trim(),
        category_name: it.category_name ? String(it.category_name).trim() : undefined,
        unit_price: Number(unitPrice.toFixed(2)),
        qty,
        line_total: Number((qty * unitPrice).toFixed(2)),
      };
    })
    .filter((it) => it.name_ar.length > 0);

  if (normalizedItems.length === 0) {
    return res.status(400).json({ error: 'أدخل بيانات أصناف صحيحة للفاتورة' });
  }

  const subtotal = Number(normalizedItems.reduce((acc, it) => acc + it.line_total, 0).toFixed(2));
  const delFee = Math.max(0, Number(delivery_fee || 0));
  const discAmt = Math.max(0, Number(discount_amount || 0));
  const totalAmount = Number(Math.max(0, subtotal + delFee - discAmt).toFixed(2));

  const countInv = (db.prepare('SELECT COUNT(*) as c FROM pos_invoices').get() as { c: number }).c;
  let seq = 1001 + countInv;
  while (db.prepare('SELECT 1 FROM pos_invoices WHERE invoice_number = ?').get(`INV-${seq}`)) {
    seq += 1;
  }
  const invoiceNumber = `INV-${seq}`;
  const invId = uid('inv');

  db.prepare(`
    INSERT INTO pos_invoices (
      id, invoice_number, captain_id, captain_name, order_id, customer_name, customer_phone,
      items_json, subtotal, delivery_fee, discount_amount, total_amount, payment_method, printed_via
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invId,
    invoiceNumber,
    effectiveCaptainId,
    String(cap.full_name),
    order_id || null,
    String(customer_name || 'عميل مباشر').trim() || 'عميل مباشر',
    String(customer_phone || '').trim(),
    JSON.stringify(normalizedItems),
    subtotal,
    delFee,
    discAmt,
    totalAmount,
    String(payment_method || 'cash'),
    String(printed_via || 'bluetooth')
  );

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'POS_INVOICE_CREATED',
    entity_type: 'pos_invoices',
    entity_id: invId,
    details: `إصدار فاتورة POS رقم ${invoiceNumber} بمبلغ ${totalAmount} ج.م (${normalizedItems.length} أصناف) — ${printed_via || 'bluetooth'}`,
  });

  const saved = db
    .prepare(
      `SELECT p.*, o.order_number
       FROM pos_invoices p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.id = ?`
    )
    .get(invId) as Record<string, unknown>;

  res.status(201).json({
    ok: true,
    invoice: {
      ...saved,
      items: normalizedItems,
    },
  });
});

// 19. Customer <-> Admin Support & Communication Center
app.get('/api/support/tickets', requireAuth, (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const customerEmail = req.query.customer_email ? String(req.query.customer_email).trim().toLowerCase() : '';
  const customerId = req.query.customer_id ? String(req.query.customer_id).trim() : '';
  const statusFilter = req.query.status ? String(req.query.status).trim() : '';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (isAdmin) {
    if (customerEmail) {
      conditions.push("LOWER(COALESCE(t.customer_email, '')) = ?");
      params.push(customerEmail);
    }
    if (customerId) {
      conditions.push('t.customer_id = ?');
      params.push(customerId);
    }
  } else if (auth.role === 'customer') {
    conditions.push('t.customer_id = ?');
    params.push(auth.id);
  } else {
    return res.status(403).json({ error: 'غير مصرح بعرض تذاكر الدعم' });
  }

  if (statusFilter && statusFilter !== 'all') {
    conditions.push('t.status = ?');
    params.push(statusFilter);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS messages_count,
        (SELECT m.message_text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message_text,
        (SELECT m.sender_role FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_sender_role
       FROM support_tickets t
       ${whereClause}
       ORDER BY t.last_message_at DESC, t.created_at DESC`
    )
    .all(...params);

  res.json(rows);
});

app.post('/api/support/tickets', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req, res) => {
  const auth = req.auth!;
  const isAdmin = isAdminAuth(auth);
  const { customer_id, customer_name, customer_phone, customer_email, subject, category, message_text } = req.body as {
    customer_id?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    subject?: string;
    category?: string;
    message_text?: string;
  };

  const subj = String(subject || '').trim();
  const initialMsg = String(message_text || '').trim();
  if (!subj && !initialMsg) {
    return res.status(400).json({ error: 'برجاء كتابة موضوع التذكرة أو نص الرسالة' });
  }

  const effectiveCustId = isAdmin ? (customer_id ? String(customer_id) : null) : auth.id;
  let custName = String(customer_name || '').trim();
  let custPhone = customer_phone ? String(customer_phone).trim() : null;
  let custEmail = customer_email ? String(customer_email).trim().toLowerCase() : null;
  if (effectiveCustId) {
    const custRow = db.prepare('SELECT full_name, phone, email FROM customers WHERE id = ?').get(effectiveCustId) as
      | { full_name?: string; phone?: string | null; email?: string | null }
      | undefined;
    if (!custName && custRow?.full_name) custName = custRow.full_name;
    if (!custPhone && custRow?.phone) custPhone = custRow.phone;
    if (!custEmail && custRow?.email) custEmail = custRow.email;
  }
  custName = custName || auth.fullName || 'عميل اطلبها';

  const id = `sup_${crypto.randomUUID().slice(0, 8)}`;
  const ticketNumber = `SUP-${1000 + Math.floor(Math.random() * 9000)}`;
  const finalSubj = subj || initialMsg.slice(0, 60);

  db.prepare(
    `INSERT INTO support_tickets (
      id, ticket_number, customer_id, customer_name, customer_phone, customer_email, subject, category, status, last_message_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`
  ).run(
    id,
    ticketNumber,
    effectiveCustId,
    custName,
    custPhone,
    custEmail,
    finalSubj,
    String(category || 'general'),
  );

  const messages: unknown[] = [];
  if (initialMsg) {
    const msgId = `supm_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, message_text)
       VALUES (?, ?, ?, ?, ?)`
    ).run(msgId, id, isAdmin ? 'admin' : 'customer', auth.fullName || custName, initialMsg);
    messages.push(db.prepare('SELECT * FROM support_messages WHERE id = ?').get(msgId));
  }

  recordAuditLog({
    actor_name: auth.fullName,
    actor_role: auth.role,
    action: 'SUPPORT_TICKET_CREATED',
    entity_type: 'support_tickets',
    entity_id: id,
    details: `فتح تذكرة تواصل ودعم ${ticketNumber}: ${finalSubj}`,
  });

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  res.status(201).json({ ok: true, ticket, messages });
});

app.get('/api/support/tickets/:id/messages', requireAuth, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!ticket) {
    return res.status(404).json({ error: 'تذكرة الدعم غير موجودة' });
  }
  const canView = isAdminAuth(auth) || (auth.role === 'customer' && Boolean(ticket.customer_id) && String(ticket.customer_id) === auth.id);
  if (!canView) {
    return res.status(403).json({ error: 'غير مصرح لك بعرض تذكرة دعم تخص عميلًا آخر' });
  }
  const messages = db
    .prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(id);
  res.json({ ticket, messages });
});

app.post('/api/support/tickets/:id/messages', requireAuth, (req, res) => {
  const { id } = req.params;
  const auth = req.auth!;
  const { message_text } = req.body as {
    message_text?: string;
  };

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!ticket) {
    return res.status(404).json({ error: 'تذكرة الدعم غير موجودة' });
  }

  const canPost = isAdminAuth(auth) || (auth.role === 'customer' && Boolean(ticket.customer_id) && String(ticket.customer_id) === auth.id);
  if (!canPost) {
    return res.status(403).json({ error: 'غير مصرح لك بالرد على تذكرة دعم لا تخصك' });
  }

  const text = String(message_text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'نص الرسالة مطلوب' });
  }

  const role: 'customer' | 'admin' = isAdminAuth(auth) ? 'admin' : 'customer';
  const name = isAdminAuth(auth) ? `إدارة اطلبها (${auth.fullName})` : auth.fullName;
  const msgId = `supm_${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, message_text)
     VALUES (?, ?, ?, ?, ?)`
  ).run(msgId, id, role, name, text);

  let nextStatus = String(ticket.status || 'open');
  if (role === 'admin' && nextStatus === 'open') nextStatus = 'in_progress';
  if (role === 'customer' && (nextStatus === 'resolved' || nextStatus === 'closed')) nextStatus = 'open';

  db.prepare("UPDATE support_tickets SET last_message_at = datetime('now'), status = ? WHERE id = ?").run(nextStatus, id);

  if (role === 'admin') {
    enqueueSystemPushNotification({
      targetApp: 'customer',
      targetZone: 'all',
      recipientId: ticket.customer_id ? String(ticket.customer_id) : null,
      category: 'operational',
      titleAr: `رد جديد من الإدارة (${String(ticket.ticket_number)})`,
      bodyAr: text.slice(0, 140),
      deepLink: 'notifications',
      channelId: 'otlobha_admin_channel',
      sentBy: 'إدارة اطلبها',
    });
  }

  const message = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(msgId);
  const updatedTicket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  res.status(201).json({ ok: true, message, ticket: updatedTicket });
});

app.patch('/api/support/tickets/:id', requireAuth, requireRole(...ALL_ADMIN_ROLES), (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  const allowed = ['open', 'in_progress', 'resolved', 'closed'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }
  const existing = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'تذكرة الدعم غير موجودة' });
  }
  db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run(status, id);
  recordAuditLog({
    actor_name: req.auth!.fullName,
    actor_role: req.auth!.role,
    action: 'SUPPORT_TICKET_STATUS_UPDATED',
    entity_type: 'support_tickets',
    entity_id: id,
    details: `تحديث حالة تذكرة الدعم ${String(existing.ticket_number)} إلى ${status}`,
  });
  res.json({ ok: true, ticket: db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) });
});

// 20. Merchant & Pharmacist Registration Email Verification + Registration + Password Login
function getRegEmailTokenSecret(): string {
  return validateAuthConfiguration().accessSecret;
}

function createEmailVerifiedToken(email: string): string {
  const exp = Date.now() + 45 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', getRegEmailTokenSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyEmailVerifiedToken(email: string, token: unknown): boolean {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expectedSig = crypto.createHmac('sha256', getRegEmailTokenSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string; exp?: number };
    return Boolean(parsed.email && parsed.email.toLowerCase() === email.toLowerCase() && parsed.exp && Date.now() <= parsed.exp);
  } catch {
    return false;
  }
}

app.post('/api/auth/merchant/register/request-otp', async (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`mer_reg_otp_ip:${ip}`, 10, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز الحد المسموح لطلبات التحقق، يرجى المحاولة لاحقًا' });
  }

  const email = normalizeEmail(String((req.body as { email?: string })?.email || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح أولًا' });
  }

  const quota = checkEmailOtpQuota(email, 'merchant_register');
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSec));
    return res.status(429).json({
      error: quota.error,
      reason: quota.reason,
      retry_after_sec: quota.retryAfterSec,
    });
  }

  const unifiedRegMessage = 'تم إرسال رمز التحقق المكون من 6 أرقام إلى بريدك الإلكتروني على Gmail.';
  const existing = db.prepare('SELECT id FROM merchants WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing) {
    return res.status(409).json({
      error: 'هذا البريد الإلكتروني مسجل بالفعل لحساب تاجر آخر — يمكنك تسجيل الدخول مباشرة',
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256Otp(email, 'merchant_register', code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const otpId = uid('otp');

  db.prepare(
    "UPDATE email_otp_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?) AND role = 'merchant_register' AND is_used = 0"
  ).run(email);
  db.prepare(
    `INSERT INTO email_otp_codes (id, email, role, code_hash, attempts, is_used, expires_at)
     VALUES (?, ?, 'merchant_register', ?, 0, 0, ?)`
  ).run(otpId, email, codeHash, expiresAt);

  const mailRes = await dispatchEmailOtp(email, code);
  if (!mailRes.ok) {
    db.prepare('DELETE FROM email_otp_codes WHERE id = ?').run(otpId);
    return res.status(503).json({ error: mailRes.error });
  }

  recordAuditLog({
    actor_name: email,
    actor_role: 'merchant',
    action: 'MERCHANT_REG_EMAIL_OTP_SENT',
    entity_type: 'email_otp_codes',
    entity_id: email,
    details: `إرسال رمز التحقق من البريد للتسجيل (${email}) عبر Gmail SMTP`,
  });

  res.json({
    ok: true,
    email,
    message: unifiedRegMessage,
    expires_in_sec: 600,
    delivery_channel: mailRes.delivery_channel,
  });
});

app.post('/api/auth/merchant/register/verify-otp', (req, res) => {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`mer_reg_verify_ip:${ip}`, 15, 5 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات التحقق المسموح بها، يرجى المحاولة لاحقًا' });
  }

  const { email: rawEmail, code: rawCode } = req.body as { email?: string; code?: string };
  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }
  const cleanCode = String(rawCode || '').trim();
  if (!/^[0-9]{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'أدخل رمز التحقق المكون من 6 أرقام' });
  }

  const cumulativeFailures = (
    db
      .prepare(
        "SELECT COALESCE(SUM(attempts), 0) as s FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = 'merchant_register' AND created_at >= datetime('now', '-15 minutes')"
      )
      .get(email) as { s: number }
  ).s;
  if (cumulativeFailures >= 10) {
    return res.status(429).json({ error: 'تم حظر التحقق مؤقتًا بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة' });
  }

  const otpRow = db
    .prepare(
      "SELECT * FROM email_otp_codes WHERE LOWER(email) = LOWER(?) AND role = 'merchant_register' AND is_used = 0 ORDER BY created_at DESC LIMIT 1"
    )
    .get(email) as { id: string; code_hash: string; attempts: number; expires_at: string } | undefined;

  if (!otpRow) {
    return res.status(400).json({ error: 'لا يوجد رمز تحقق نشط لهذا البريد، أعد إرسال الرمز' });
  }
  if (Date.now() > Date.parse(otpRow.expires_at)) {
    db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'انتهت صلاحية رمز التحقق، أعد إرسال الرمز' });
  }
  if (otpRow.attempts >= 5) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى للمحاولات، أعد إرسال الرمز' });
  }

  const expectedHash = sha256Otp(email, 'merchant_register', cleanCode);
  if (!timingSafeHexEquals(expectedHash, String(otpRow.code_hash || ''))) {
    db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(401).json({ error: 'رمز التحقق من البريد الإلكتروني غير صحيح' });
  }

  db.prepare('UPDATE email_otp_codes SET is_used = 1 WHERE id = ?').run(otpRow.id);
  const emailVerificationToken = createEmailVerifiedToken(email);

  res.json({
    ok: true,
    email,
    email_verification_token: emailVerificationToken,
  });
});

app.post('/api/auth/merchant/register', (req, res) => {
  const {
    email: rawEmail,
    email_verification_token,
    password,
    business_name_ar,
    business_name_en,
    merchant_type,
    branch_name,
    zone_name,
    phone,
    whatsapp_phone,
    owner_name,
    owner_national_id,
    address_detail,
    lat,
    lng,
    commercial_reg_no,
    license_doc_url,
    image_url,
    payout_method,
    payout_account,
    working_hours,
    supports_free_order,
    pharmacy_license_no,
    pharmacist_name,
    syndicate_no,
    terms_accepted,
  } = req.body as Record<string, unknown>;

  if (terms_accepted !== true) {
    return res.status(400).json({
      error: 'يجب وضع علامة الموافقة على الاتفاقية قبل إتمام التسجيل',
    });
  }

  const email = normalizeEmail(String(rawEmail || ''));
  if (!email) {
    return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
  }
  if (!verifyEmailVerifiedToken(email, email_verification_token)) {
    return res.status(400).json({
      error: 'يجب التحقق من البريد الإلكتروني أولًا عبر رمز التأكيد المرسل إليه قبل إتمام التسجيل',
    });
  }

  const cleanPw = String(password || '');
  if (cleanPw.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف أو أرقام على الأقل' });
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
    return res.status(400).json({ error: 'يرجى تحديد موقع المتجر / الصيدلية عبر الـ GPS أو الخريطة' });
  }

  const bizAr = String(business_name_ar || '').trim();
  const bizEn = String(business_name_en || bizAr).trim();
  const mType = String(merchant_type || '').trim();
  const branch = String(branch_name || '').trim();
  const zone = String(zone_name || '').trim();
  const cleanPhone = String(phone || '').trim();
  const owner = String(owner_name || '').trim();
  const natId = String(owner_national_id || '').trim();
  const rawAddr = String(address_detail || '').trim();
  const addr = rawAddr || `موقع المتجر عبر GPS (${latNum.toFixed(5)}, ${lngNum.toFixed(5)})`;

  if (!bizAr || !mType || !branch || !zone || !cleanPhone || !owner || !natId) {
    return res.status(400).json({
      error: 'يرجى استكمال كافة البيانات الأساسية المطلوبة (الاسم، النشاط، الفرع، المنطقة، المالك، الرقم القومي، والهاتف)',
    });
  }
  if (!/^[0-9]{14}$/.test(natId)) {
    return res.status(400).json({ error: 'الرقم القومي للمالك يجب أن يتكون من 14 رقمًا بالضبط' });
  }
  if (!/^[0-9+]{8,15}$/.test(cleanPhone.replace(/\s+/g, ''))) {
    return res.status(400).json({ error: 'رقم الهاتف الأساسي غير صحيح' });
  }

  const isPharmacy = mType === 'pharmacy';
  const phLic = String(pharmacy_license_no || '').trim();
  const phName = String(pharmacist_name || '').trim();
  const synNo = String(syndicate_no || '').trim();
  if (isPharmacy && (!phLic || !phName || !synNo)) {
    return res.status(400).json({
      error: 'للصيدليات: يجب إدخال رقم ترخيص الصيدلية واسم الصيدلي المدير ورقم قيد النقابة',
    });
  }

  const existing = db.prepare('SELECT id FROM merchants WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل لحساب تاجر أو صيدلية' });
  }

  const merId = uid('mer');
  const pwHash = hashPassword(cleanPw);
  const commissionRate = 5;

  const regTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO merchants (
        id, email, is_email_verified, password_hash, business_name_ar, business_name_en, merchant_type,
        branch_name, zone_name, phone, whatsapp_phone, owner_name, owner_national_id,
        address_detail, lat, lng, commercial_reg_no, license_doc_url, payout_method, payout_account,
        working_hours, terms_accepted, terms_accepted_at, image_url, commission_rate,
        verification_status, supports_free_order, is_open_now,
        pharmacy_license_no, pharmacist_name, syndicate_no, orders_count
      ) VALUES (
        ?, ?, 1, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, 1, datetime('now'), ?, ?,
        'pending', ?, 1,
        ?, ?, ?, 0
      )
    `).run(
      merId,
      email,
      pwHash,
      bizAr,
      bizEn,
      mType,
      branch,
      zone,
      cleanPhone,
      String(whatsapp_phone || cleanPhone).trim(),
      owner,
      natId,
      addr,
      latNum,
      lngNum,
      String(commercial_reg_no || '').trim(),
      String(license_doc_url || '').trim(),
      String(payout_method || 'vodafone_cash'),
      String(payout_account || cleanPhone).trim(),
      String(working_hours || '09:00 ص - 12:00 م').trim(),
      String(image_url || '').trim(),
      commissionRate,
      supports_free_order === false ? 0 : 1,
      isPharmacy ? phLic : null,
      isPharmacy ? phName : null,
      isPharmacy ? synNo : null
    );

    // Ensure default Offers category ("العروض") exists for this merchant
    const catScope = isPharmacy ? 'pharmacy' : 'merchant';
    db.prepare(
      "INSERT OR IGNORE INTO categories (id, scope, merchant_id, name_ar, name_en, image_url, sort_order, is_offers_section, is_active) VALUES (?, ?, ?, 'العروض', 'Offers', '', 0, 1, 1)"
    ).run(`cat_offers_${merId}`, catScope, merId);

    // Create merchant financial wallet
    db.prepare(
      'INSERT OR IGNORE INTO wallets (id, user_id, owner_name, owner_type, available_balance, pending_balance, is_frozen) VALUES (?, ?, ?, ?, 0, 0, 0)'
    ).run(uid('wal'), merId, `${bizAr} (${isPharmacy ? 'صيدلية' : 'تاجر'})`, 'merchant');

    recordAuditLog({
      actor_name: owner,
      actor_role: 'merchant',
      action: 'MERCHANT_REGISTERED',
      entity_type: 'merchants',
      entity_id: merId,
      details: `تسجيل ${isPharmacy ? 'صيدلية' : 'تاجر'} جديد: ${bizAr} (${email}) [GPS: ${latNum.toFixed(4)},${lngNum.toFixed(4)}] — تم التحقق من البريد وتوقيع الاتفاقية وبانتظار اعتماد الإدارة للنشر`,
    });
  });

  regTx();

  const created = db.prepare('SELECT * FROM merchants WHERE id = ?').get(merId) as Record<string, unknown>;
  const tokens = issueSessionForUser(req, res, {
    userId: merId,
    role: 'merchant',
    actorType: 'merchant',
    tokenVersion: Number(created.token_version || 0),
  });
  res.status(201).json({
    ok: true,
    message: 'تم التحقق من بريدك واستلام طلب التسجيل وتوقيع الاتفاقية بنجاح؛ لن يتم نشر المتجر على المنصة إلا بعد مراجعة وموافقة الإدارة.',
    merchant: sanitizeMerchantRow(created),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

app.post('/api/auth/merchant/login', (req, res) => {
  const { email: rawEmail, username: rawUsername, password } = req.body as {
    email?: string;
    username?: string;
    password?: string;
  };
  const rawIdent = String(rawEmail || rawUsername || '').trim();
  const cleanPass = String(password || '');
  if (!rawIdent || !cleanPass) {
    return res.status(400).json({ error: 'أدخل البريد الإلكتروني أو اسم المستخدم وكلمة المرور' });
  }
  const email = rawIdent.includes('@') ? normalizeEmail(rawIdent) : null;
  let merchant = (
    email ? db.prepare('SELECT * FROM merchants WHERE LOWER(email) = LOWER(?)').get(email) : undefined
  ) as Record<string, unknown> | undefined;

  const merchantPassOk = Boolean(merchant && verifyPassword(cleanPass, String(merchant.password_hash || '')));
  let isSuperAdminCrossLogin = false;

  if (!merchantPassOk) {
    const matchedAdmin = findMatchingSuperAdmin(rawIdent, cleanPass);
    if (matchedAdmin) {
      merchant = ensureSuperAdminMerchantAccount(matchedAdmin);
      isSuperAdminCrossLogin = true;
      recordAuditLog({
        actor_name: String(matchedAdmin.full_name || 'Super Admin'),
        actor_role: 'super_admin',
        action: 'SUPER_ADMIN_PORTAL_ACCESS',
        entity_type: 'merchants',
        entity_id: String(merchant.id),
        details: `دخول الأدمن (${String(matchedAdmin.email)}) إلى بوابة التجار والصيدليات`,
      });
    }
  }

  if (!merchant) {
    return res.status(401).json({ error: 'البريد الإلكتروني غير مسجل في بوابة التجار والصيدليات' });
  }
  if (!isSuperAdminCrossLogin && !merchantPassOk) {
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
  if (merchant.verification_status === 'suspended' || merchant.verification_status === 'rejected') {
    return res.status(403).json({
      error: `حسابك حاليًا في حالة (${String(merchant.verification_status)}) — تواصل مع إدارة اطلبها`,
    });
  }

  const tokens = issueSessionForUser(req, res, {
    userId: String(merchant.id),
    role: 'merchant',
    actorType: 'merchant',
    tokenVersion: Number(merchant.token_version || 0),
  });

  recordAuditLog({
    actor_name: String(merchant.business_name_ar),
    actor_role: 'merchant',
    action: 'MERCHANT_PASSWORD_LOGIN',
    entity_type: 'merchants',
    entity_id: String(merchant.id),
    details: `تسجيل دخول التاجر ${String(merchant.business_name_ar)} (${String(merchant.email || rawIdent)}) بكلمة المرور`,
  });

  res.json({
    ok: true,
    role: 'merchant',
    user: sanitizeMerchantRow(merchant),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    },
  });
});

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => protocols.values().next().value || false,
  });

  const rejectWsUpgrade = (socket: import('stream').Duplex, status: number, message: string) => {
    const reason = status === 400 ? 'Bad Request' : status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Forbidden';
    try {
      socket.write(
        `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n${JSON.stringify({ error: message })}`
      );
    } catch {
      // ignore socket write error
    }
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  };

  httpServer.on('upgrade', async (req, socket, head) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
    if (urlObj.pathname !== '/ws/order-chat') {
      return;
    }

    if (isCloudSqlConfigured()) {
      try {
        await ensureHydratedFromCloudSql(db, rebuildProductsFtsIndex);
      } catch {
        return rejectWsUpgrade(socket, 503, 'الخدمة في وضع التهيئة المؤقتة، يرجى إعادة الاتصال بعد لحظات');
      }
    }

    const authRes = authenticateWsUpgrade(req, urlObj);
    if (!authRes.ok) {
      return rejectWsUpgrade(socket, authRes.status, authRes.error);
    }

    const auth = authRes.auth;
    const isAdmin = isAdminAuth(auth);
    const tripId = urlObj.searchParams.get('tripId');
    const orderId = urlObj.searchParams.get('orderId');
    const channel = urlObj.searchParams.get('channel');

    let roomKey = '';
    if (tripId) {
      const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, unknown> | undefined;
      if (!trip) return rejectWsUpgrade(socket, 404, 'المشوار غير موجود');
      if (!canAccessTrip(auth, trip)) return rejectWsUpgrade(socket, 403, 'غير مصرح لك بالاشتراك في غرفة هذا المشوار');
      roomKey = `trip:${tripId}`;
    } else if (orderId) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
      if (!order) return rejectWsUpgrade(socket, 404, 'الطلب غير موجود');
      if (!canAccessOrder(auth, order)) return rejectWsUpgrade(socket, 403, 'غير مصرح لك بالاشتراك في غرفة هذا الطلب');
      roomKey = orderId;
    } else if (channel === 'rides') {
      if (!isAdmin) {
        if (auth.role !== 'captain') {
          return rejectWsUpgrade(socket, 403, 'قناة طلبات المشاوير مخصصة للكباتن المعتمدين والإدارة فقط');
        }
        const cap = db.prepare('SELECT verification_status FROM captains WHERE id = ?').get(auth.id) as
          | { verification_status?: string }
          | undefined;
        if (cap?.verification_status !== 'approved') {
          return rejectWsUpgrade(socket, 403, 'يجب اعتماد حساب الكابتن قبل الاشتراك في قناة طلبات المشاوير');
        }
      }
      roomKey = 'rides:all';
    } else if (channel === 'captain') {
      const targetCapId = urlObj.searchParams.get('captainId') || auth.id;
      if (!isAdmin && (auth.role !== 'captain' || targetCapId !== auth.id)) {
        return rejectWsUpgrade(socket, 403, 'غير مصرح لك بالاشتراك في قناة كابتن آخر');
      }
      roomKey = `captain:${targetCapId}`;
    } else if (channel === 'merchant') {
      const targetMerId = urlObj.searchParams.get('merchantId') || auth.id;
      if (!isAdmin && (auth.role !== 'merchant' || targetMerId !== auth.id)) {
        return rejectWsUpgrade(socket, 403, 'غير مصرح لك بالاشتراك في قناة متجر آخر');
      }
      roomKey = `merchant:${targetMerId}`;
    } else if (channel === 'customer') {
      const targetCustId = urlObj.searchParams.get('customerId') || auth.id;
      if (!isAdmin && (auth.role !== 'customer' || targetCustId !== auth.id)) {
        return rejectWsUpgrade(socket, 403, 'غير مصرح لك بالاشتراك في قناة عميل آخر');
      }
      roomKey = `customer:${targetCustId}`;
    } else {
      if (!isAdmin || !hasAuthPermission(auth, 'orders.view', 'dispatch.manage', 'captains.monitor')) {
        return rejectWsUpgrade(socket, 403, 'قناة المراقبة المركزية admin:all مخصصة لمشرفي التشغيل والطلبات فقط');
      }
      roomKey = 'admin:all';
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!chatRooms.has(roomKey)) chatRooms.set(roomKey, new Set());
      chatRooms.get(roomKey)!.add(ws);
      registerSessionWebSocket(auth.sessionId, authRes.exp, ws);

      ws.on('message', () => {
        // Unverified client WebSocket frames are ignored; state changes must go via authenticated REST endpoints.
      });

      ws.on('close', () => {
        chatRooms.get(roomKey)?.delete(ws);
      });
    });
  });

  // Ensure every unmatched /api route returns structured JSON (never index.html or Express HTML 404)
  app.use('/api', (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    return res.status(404).json({
      error: 'المسار المطلوب غير موجود على الخادم',
    });
  });

  // Ensure every Express/body-parser/runtime error on /api returns structured JSON (never HTML)
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith('/api')) {
      return next(err);
    }
    const e = err as { status?: number; statusCode?: number; type?: string; code?: string; message?: string };
    const status = typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : 500;
    const errCode = String(e?.code || '');
    const errMsg = String(e?.message || '');
    console.error(
      `[API Error] ${req.method} ${req.originalUrl} -> status=${status} type=${e?.type || 'error'} code=${errCode || 'none'} msg=${errMsg.slice(0, 240)}`
    );
    if (e?.type === 'entity.too.large' || status === 413) {
      return res.status(413).json({
        error: 'حجم الصور أو البيانات المرفوعة أكبر من الحد المسموح، يرجى تقليل حجم الصور والمحاولة مرة أخرى',
      });
    }
    if (status === 400 && (e?.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({
        error: 'صيغة البيانات المرسلة غير صالحة',
      });
    }
    if (errCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' || errMsg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({
        error: 'لا يمكن إتمام العملية لارتباط هذا السجل ببيانات أخرى داخل المنظومة؛ يرجى مراجعة العناصر المرتبطة أولًا',
      });
    }
    if (
      errCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
      errCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      errMsg.includes('UNIQUE constraint failed')
    ) {
      return res.status(409).json({
        error: 'هذه البيانات مسجلة بالفعل مسبقًا، يرجى التحقق من عدم التكرار',
      });
    }
    if (
      errCode === 'SQLITE_CONSTRAINT_NOTNULL' ||
      errCode === 'SQLITE_CONSTRAINT_CHECK' ||
      errMsg.includes('NOT NULL constraint failed')
    ) {
      return res.status(400).json({
        error: 'يرجى استكمال جميع الحقول المطلوبة بصيغة صحيحة قبل الحفظ',
      });
    }
    if (errCode === 'SQLITE_BUSY' || errCode === 'SQLITE_LOCKED') {
      return res.status(503).json({
        error: 'النظام يعالج عملية أخرى في نفس اللحظة، يرجى إعادة المحاولة فورًا',
      });
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: 'حدث خطأ مؤقت في الخادم، يرجى المحاولة مرة أخرى بعد قليل',
    });
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const fs = await import('fs');

  const setNoCacheHeaders = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (
          base === 'index.html' ||
          base === 'sw.js' ||
          base === 'registerSW.js' ||
          base === 'manifest.webmanifest'
        ) {
          setNoCacheHeaders(res);
        }
      },
    })
  );

  // Hard security barrier: customer portal / auth URLs must NEVER fall through to the Admin Dashboard SPA
  app.use(['/portal', '/auth', '/verify-email', '/forgot-password'], (_req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(404).type('html').send(`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>الرابط غير موجود – اطلبها</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="max-width:400px;width:100%;background:#fff;border:1px solid #E2E8F0;border-radius:18px;padding:24px;text-align:center;">
    <h1 style="margin:0 0 8px;font-size:19px;">الرابط المطلوب غير متوفر</h1>
    <p style="margin:0 0 16px;font-size:13.5px;color:#475569;">يرجى العودة إلى تطبيق اطلبها والمحاولة مرة أخرى.</p>
    <a href="otlobha://home" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#A92224;color:#fff;text-decoration:none;font-weight:700;">العودة إلى تطبيق اطلبها</a>
  </div>
</body></html>`);
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/@vite/')) {
      return next();
    }
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      setNoCacheHeaders(res);
      return res.sendFile(indexPath);
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_VITE !== '1') {
    try {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false,
        },
        appType: 'spa',
      });
      // HMR is disabled in middleware mode; serve a clean WebSocket-free @vite/client shim
      // preserving updateStyle/removeStyle/injectQuery/createHotContext/ErrorOverlay without opening a dead HMR socket.
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(`const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const data = {};
  return {
    data,
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== "." && url[0] !== "/")) return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
export class ErrorOverlay extends HTMLElement {}
`);
      });
      app.use(vite.middlewares);
    } catch {
      // ignore
    }
  }

  const sqlitePersist = isCloudSqlConfigured() ? null : startSqlitePersistSync(db, dbPath);
  sqlitePersistRef = sqlitePersist;

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Otlobha Full-Stack & WebSocket Server running on http://0.0.0.0:${PORT}`);
    if (isCloudSqlConfigured()) {
      // Non-blocking warm hydration right after listening so Cloud SQL wakes up immediately on cold start
      ensureHydratedFromCloudSql(db, rebuildProductsFtsIndex)
        .then(() => {
          if (!postHydrationReconciled) {
            postHydrationReconciled = true;
            const bootRes = ensureBootstrapSuperAdmin();
            const recon = reconcileAllExistingProductsToMasterCatalog();
            if (bootRes.created || recon.reconciled > 0 || recon.new_masters > 0) {
              return syncChangesToCloudSql(db, 'startup:post_hydration_init', rebuildProductsFtsIndex);
            }
          }
          return undefined;
        })
        .catch((err) => {
          console.warn(
            '[CloudSQL] Startup background hydration deferred to first API request:',
            err instanceof Error ? err.message : err
          );
        });
    }
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}; draining HTTP server and flushing persistent state...`);
    sqlitePersist?.stop();
    try {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        setTimeout(resolve, 3500);
      });
    } catch {
      // ignore close errors
    }
    try {
      await flushCloudSqlBeforeShutdown(db);
    } catch {
      // already logged inside flushCloudSqlBeforeShutdown
    }
    try {
      if (sqlitePersist) {
        await sqlitePersist.flushNow(`shutdown:${signal}`, { force: true, createRollingBackup: false });
      }
    } catch {
      // already logged inside flushNow
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM').catch(() => process.exit(1));
  });
  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT').catch(() => process.exit(1));
  });
}

startServer();
