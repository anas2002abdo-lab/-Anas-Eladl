import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { db, uid } from './db.ts';

export type PushUserRole = 'customer' | 'captain';

export type PushChannelId =
  | 'otlobha_orders_channel'
  | 'otlobha_dispatch_channel'
  | 'otlobha_chat_channel'
  | 'otlobha_admin_channel'
  | 'otlobha_promos_channel';

export interface PushDeliverySummary {
  fcm_enabled: boolean;
  reason?: string;
  targeted_devices: number;
  sent_count: number;
  failed_count: number;
  deactivated_tokens: number;
}

export interface PushPayloadInput {
  title: string;
  body: string;
  channelId?: PushChannelId;
  category?: string;
  deepLink?: string;
  notificationId?: string;
  orderId?: string | null;
  tripId?: string | null;
  parcelId?: string | null;
  status?: string | null;
  targetApp?: string;
  extraData?: Record<string, string>;
}

export interface MulticastSendResult {
  successCount: number;
  failureCount: number;
  responses: Array<{
    success: boolean;
    messageId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export type CustomMulticastTransport = (
  tokens: string[],
  payload: PushPayloadInput,
  channelId: PushChannelId
) => Promise<MulticastSendResult>;

let initializedApp: App | null = null;
let initAttempted = false;
let initSource: 'service_account_json' | 'fcm_env_vars' | 'google_application_credentials' | 'none' = 'none';
let initProjectId: string | null = null;
let customTransportForTests: CustomMulticastTransport | null = null;

export function setPushTransportForTest(transport: CustomMulticastTransport | null): void {
  customTransportForTests = transport;
}

function parseServiceAccountFromEnv(): {
  serviceAccount: ServiceAccount;
  source: 'service_account_json' | 'fcm_env_vars';
  projectId: string;
} | null {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const jsonText = rawJson.startsWith('{')
        ? rawJson
        : Buffer.from(rawJson, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonText) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          serviceAccount: {
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          },
          source: 'service_account_json',
          projectId: parsed.project_id,
        };
      }
    } catch (err) {
      console.warn('[FCM] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err instanceof Error ? err.message : err);
    }
  }

  const projectId = String(process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FCM_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKeyRaw = String(process.env.FCM_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '').trim();

  if (projectId && clientEmail && privateKeyRaw) {
    return {
      serviceAccount: {
        projectId,
        clientEmail,
        privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
      },
      source: 'fcm_env_vars',
      projectId,
    };
  }

  return null;
}

function ensureFirebaseAdmin(): App | null {
  if (initializedApp) return initializedApp;
  if (initAttempted) return null;
  initAttempted = true;

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    initializedApp = existingApps[0];
    return initializedApp;
  }

  const parsed = parseServiceAccountFromEnv();
  if (parsed) {
    try {
      initializedApp = initializeApp({
        credential: cert(parsed.serviceAccount),
        projectId: parsed.projectId,
      });
      initSource = parsed.source;
      initProjectId = parsed.projectId;
      console.log(`[FCM] Firebase Admin SDK initialized via ${initSource} (project: ${initProjectId})`);
      return initializedApp;
    } catch (err) {
      console.error('[FCM] Firebase Admin initialization failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  const gac = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (gac) {
    try {
      initializedApp = initializeApp({
        credential: applicationDefault(),
      });
      initSource = 'google_application_credentials';
      initProjectId = String(process.env.FCM_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim() || null;
      console.log('[FCM] Firebase Admin SDK initialized via GOOGLE_APPLICATION_CREDENTIALS');
      return initializedApp;
    } catch (err) {
      console.error('[FCM] Firebase Admin ADC initialization failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  console.warn(
    '[FCM] Firebase Admin credentials not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY). In-app notifications will still be saved in SQLite.'
  );
  return null;
}

export function getFcmStatus(): {
  configured: boolean;
  source: string;
  project_id: string | null;
  registered_devices: {
    total: number;
    customer: number;
    captain: number;
  };
} {
  const app = ensureFirebaseAdmin();
  const total = (
    db.prepare('SELECT COUNT(*) as c FROM push_device_tokens WHERE is_active = 1').get() as { c: number }
  ).c;
  const customer = (
    db
      .prepare("SELECT COUNT(*) as c FROM push_device_tokens WHERE is_active = 1 AND user_role = 'customer'")
      .get() as { c: number }
  ).c;
  const captain = (
    db
      .prepare("SELECT COUNT(*) as c FROM push_device_tokens WHERE is_active = 1 AND user_role = 'captain'")
      .get() as { c: number }
  ).c;

  return {
    configured: Boolean(app || customTransportForTests),
    source: customTransportForTests ? 'test_transport' : initSource,
    project_id: initProjectId,
    registered_devices: { total, customer, captain },
  };
}

export function resolveChannelId(category?: string, deepLink?: string, targetApp?: string): PushChannelId {
  const dl = String(deepLink || '').toLowerCase();
  const cat = String(category || '').toLowerCase();
  if (dl.includes('chat')) return 'otlobha_chat_channel';
  if (cat === 'promo' || dl === 'offers' || dl === 'promo') return 'otlobha_promos_channel';
  if (targetApp === 'captain' && (dl === 'orders' || dl === 'order' || dl === 'trip' || dl === 'rides' || dl === 'parcels')) {
    return 'otlobha_dispatch_channel';
  }
  if (cat === 'compliance' || cat === 'alert' || dl === 'notifications' || dl === 'profile' || dl === 'kyc_upload') {
    return 'otlobha_admin_channel';
  }
  return 'otlobha_orders_channel';
}

export function registerDeviceToken(params: {
  userId: string;
  userRole: PushUserRole;
  fcmToken: string;
  deviceId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  deviceLabel?: string | null;
}): { id: string; user_id: string; user_role: PushUserRole; device_id: string | null; active_devices: number } {
  const cleanToken = String(params.fcmToken || '').trim();
  const cleanDeviceId = params.deviceId ? String(params.deviceId).trim().slice(0, 120) : null;
  const cleanPlatform = ['android', 'ios', 'web'].includes(String(params.platform || '').toLowerCase())
    ? String(params.platform).toLowerCase()
    : 'android';
  const cleanAppVersion = params.appVersion ? String(params.appVersion).trim().slice(0, 40) : null;
  const cleanDeviceLabel = params.deviceLabel ? String(params.deviceLabel).trim().slice(0, 120) : null;

  let recordId = uid('fcm');

  db.transaction(() => {
    // If this physical device rotated its FCM token for the same account, deactivate old token(s) on that same device_id
    if (cleanDeviceId) {
      db.prepare(
        `UPDATE push_device_tokens
         SET is_active = 0, updated_at = datetime('now')
         WHERE user_id = ? AND user_role = ? AND device_id = ? AND fcm_token != ?`
      ).run(params.userId, params.userRole, cleanDeviceId, cleanToken);
    }

    const existing = db
      .prepare('SELECT id FROM push_device_tokens WHERE fcm_token = ?')
      .get(cleanToken) as { id: string } | undefined;

    if (existing) {
      recordId = existing.id;
      db.prepare(
        `UPDATE push_device_tokens
         SET user_id = ?, user_role = ?, device_id = COALESCE(?, device_id),
             platform = ?, app_version = COALESCE(?, app_version),
             device_label = COALESCE(?, device_label),
             is_active = 1, last_seen_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        params.userId,
        params.userRole,
        cleanDeviceId,
        cleanPlatform,
        cleanAppVersion,
        cleanDeviceLabel,
        recordId
      );
    } else {
      db.prepare(
        `INSERT INTO push_device_tokens
         (id, user_id, user_role, fcm_token, device_id, platform, app_version, device_label, is_active, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))`
      ).run(
        recordId,
        params.userId,
        params.userRole,
        cleanToken,
        cleanDeviceId,
        cleanPlatform,
        cleanAppVersion,
        cleanDeviceLabel
      );
    }
  })();

  const activeDevices = (
    db
      .prepare('SELECT COUNT(*) as c FROM push_device_tokens WHERE user_id = ? AND user_role = ? AND is_active = 1')
      .get(params.userId, params.userRole) as { c: number }
  ).c;

  return {
    id: recordId,
    user_id: params.userId,
    user_role: params.userRole,
    device_id: cleanDeviceId,
    active_devices: activeDevices,
  };
}

export function unregisterDeviceToken(params: {
  userId: string;
  userRole: PushUserRole;
  fcmToken?: string | null;
  deviceId?: string | null;
}): { deactivated: number } {
  const cleanToken = params.fcmToken ? String(params.fcmToken).trim() : '';
  const cleanDeviceId = params.deviceId ? String(params.deviceId).trim() : '';

  if (cleanToken) {
    const info = db
      .prepare(
        `UPDATE push_device_tokens
         SET is_active = 0, updated_at = datetime('now')
         WHERE user_id = ? AND user_role = ? AND fcm_token = ?`
      )
      .run(params.userId, params.userRole, cleanToken);
    return { deactivated: info.changes };
  }

  if (cleanDeviceId) {
    const info = db
      .prepare(
        `UPDATE push_device_tokens
         SET is_active = 0, updated_at = datetime('now')
         WHERE user_id = ? AND user_role = ? AND device_id = ?`
      )
      .run(params.userId, params.userRole, cleanDeviceId);
    return { deactivated: info.changes };
  }

  return { deactivated: 0 };
}

export function getActiveTokensForAudience(params: {
  targetApp: string;
  recipientId?: string | null;
  targetZone?: string | null;
}): string[] {
  const app = String(params.targetApp || 'customer').toLowerCase();
  const recipientId = params.recipientId ? String(params.recipientId).trim() : '';
  const zone = params.targetZone && params.targetZone !== 'all' ? String(params.targetZone).trim() : '';

  if (recipientId) {
    const roles: PushUserRole[] =
      app === 'captain' ? ['captain'] : app === 'customer' ? ['customer'] : ['customer', 'captain'];
    const placeholders = roles.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT DISTINCT fcm_token FROM push_device_tokens
         WHERE is_active = 1 AND user_id = ? AND user_role IN (${placeholders})`
      )
      .all(recipientId, ...roles) as Array<{ fcm_token: string }>;
    return rows.map((r) => r.fcm_token);
  }

  const tokens = new Set<string>();

  if (app === 'captain' || app === 'all') {
    const rows = zone
      ? (db
          .prepare(
            `SELECT DISTINCT t.fcm_token
             FROM push_device_tokens t
             JOIN captains c ON c.id = t.user_id
             WHERE t.is_active = 1 AND t.user_role = 'captain' AND c.zone_name = ?`
          )
          .all(zone) as Array<{ fcm_token: string }>)
      : (db
          .prepare(
            `SELECT DISTINCT fcm_token FROM push_device_tokens
             WHERE is_active = 1 AND user_role = 'captain'`
          )
          .all() as Array<{ fcm_token: string }>);
    for (const r of rows) tokens.add(r.fcm_token);
  }

  if (app === 'customer' || app === 'all') {
    const rows = zone
      ? (db
          .prepare(
            `SELECT DISTINCT t.fcm_token
             FROM push_device_tokens t
             LEFT JOIN customers cu ON cu.id = t.user_id
             LEFT JOIN service_zones sz ON sz.id = cu.default_zone_id
             WHERE t.is_active = 1 AND t.user_role = 'customer'
               AND (sz.name_ar = ? OR cu.default_zone_id = ?)`
          )
          .all(zone, zone) as Array<{ fcm_token: string }>)
      : (db
          .prepare(
            `SELECT DISTINCT fcm_token FROM push_device_tokens
             WHERE is_active = 1 AND user_role = 'customer'`
          )
          .all() as Array<{ fcm_token: string }>);
    for (const r of rows) tokens.add(r.fcm_token);
  }

  return Array.from(tokens);
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function buildFcmDataMap(payload: PushPayloadInput, channelId: PushChannelId): Record<string, string> {
  const data: Record<string, string> = {
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
    channel_id: channelId,
    title_ar: String(payload.title || ''),
    body_ar: String(payload.body || ''),
    category: String(payload.category || 'operational'),
    deep_link: String(payload.deepLink || 'notifications'),
    target_app: String(payload.targetApp || 'customer'),
  };
  if (payload.notificationId) data.notification_id = String(payload.notificationId);
  if (payload.orderId) data.order_id = String(payload.orderId);
  if (payload.tripId) data.trip_id = String(payload.tripId);
  if (payload.parcelId) data.parcel_id = String(payload.parcelId);
  if (payload.status) data.status = String(payload.status);
  if (payload.extraData) {
    for (const [k, v] of Object.entries(payload.extraData)) {
      if (v !== undefined && v !== null) data[k] = String(v);
    }
  }
  return data;
}

export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayloadInput
): Promise<PushDeliverySummary> {
  const uniqueTokens = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
  if (uniqueTokens.length === 0) {
    return {
      fcm_enabled: Boolean(ensureFirebaseAdmin() || customTransportForTests),
      reason: 'no_registered_devices',
      targeted_devices: 0,
      sent_count: 0,
      failed_count: 0,
      deactivated_tokens: 0,
    };
  }

  const channelId = payload.channelId || resolveChannelId(payload.category, payload.deepLink, payload.targetApp);
  const app = customTransportForTests ? null : ensureFirebaseAdmin();

  if (!customTransportForTests && !app) {
    return {
      fcm_enabled: false,
      reason: 'fcm_not_configured',
      targeted_devices: uniqueTokens.length,
      sent_count: 0,
      failed_count: 0,
      deactivated_tokens: 0,
    };
  }

  const dataMap = buildFcmDataMap(payload, channelId);
  let sentCount = 0;
  let failedCount = 0;
  let deactivatedCount = 0;

  // FCM sendEachForMulticast supports up to 500 tokens per batch
  const CHUNK_SIZE = 500;
  for (let i = 0; i < uniqueTokens.length; i += CHUNK_SIZE) {
    const chunk = uniqueTokens.slice(i, i + CHUNK_SIZE);
    try {
      let batchResult: MulticastSendResult;
      if (customTransportForTests) {
        batchResult = await customTransportForTests(chunk, payload, channelId);
      } else {
        const res = await getMessaging(app!).sendEachForMulticast({
          tokens: chunk,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: dataMap,
          android: {
            priority: 'high',
            notification: {
              channelId,
              sound: 'default',
              defaultVibrateTimings: true,
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
              tag: payload.orderId
                ? `order_${payload.orderId}`
                : payload.tripId
                ? `trip_${payload.tripId}`
                : payload.notificationId || undefined,
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
            },
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                contentAvailable: true,
              },
            },
          },
        });
        batchResult = {
          successCount: res.successCount,
          failureCount: res.failureCount,
          responses: res.responses.map((r) => ({
            success: r.success,
            messageId: r.messageId,
            errorCode: r.error?.code,
            errorMessage: r.error?.message,
          })),
        };
      }

      sentCount += batchResult.successCount;
      failedCount += batchResult.failureCount;

      const staleTokens: string[] = [];
      batchResult.responses.forEach((resp, idx) => {
        if (!resp.success && resp.errorCode && INVALID_TOKEN_CODES.has(resp.errorCode)) {
          staleTokens.push(chunk[idx]);
        }
      });

      if (staleTokens.length > 0) {
        const deactivateStmt = db.prepare(
          "UPDATE push_device_tokens SET is_active = 0, updated_at = datetime('now') WHERE fcm_token = ?"
        );
        db.transaction(() => {
          for (const badToken of staleTokens) {
            const info = deactivateStmt.run(badToken);
            deactivatedCount += info.changes;
          }
        })();
      }
    } catch (err) {
      console.error('[FCM] Batch multicast send error:', err instanceof Error ? err.message : err);
      failedCount += chunk.length;
    }
  }

  return {
    fcm_enabled: true,
    targeted_devices: uniqueTokens.length,
    sent_count: sentCount,
    failed_count: failedCount,
    deactivated_tokens: deactivatedCount,
  };
}

/**
 * Persists a notification into the existing `notifications` table AND dispatches real FCM Push Notifications
 * to all active devices matching the target audience. Preserves 100% of existing in-app notifications behavior.
 */
export async function createAndSendNotification(params: {
  targetApp: 'customer' | 'captain' | 'merchant' | 'all';
  targetZone?: string | null;
  recipientId?: string | null;
  category?: 'promo' | 'operational' | 'compliance' | 'alert';
  titleAr: string;
  bodyAr: string;
  deepLink?: string;
  sentBy?: string;
  audienceCount?: number;
  orderId?: string | null;
  tripId?: string | null;
  parcelId?: string | null;
  status?: string | null;
  channelId?: PushChannelId;
  extraData?: Record<string, string>;
}): Promise<{
  id: string;
  fcm_topic: string;
  audience_count: number;
  fcm_delivery: PushDeliverySummary;
}> {
  const id = uid('ntf');
  const appTarget = String(params.targetApp || 'customer');
  const zoneTarget = String(params.targetZone || 'all');
  const category = params.category || 'operational';
  const deepLink = params.deepLink || 'notifications';
  const fcmTopic = `otlobha_${appTarget}_${zoneTarget === 'all' ? 'all' : 'zone'}`;
  const titleClean = String(params.titleAr || '').trim();
  const bodyClean = String(params.bodyAr || '').trim();

  const tokens =
    appTarget === 'merchant'
      ? []
      : getActiveTokensForAudience({
          targetApp: appTarget,
          recipientId: params.recipientId,
          targetZone: zoneTarget,
        });

  const audienceCount =
    params.audienceCount !== undefined
      ? params.audienceCount
      : params.recipientId
      ? 1
      : Math.max(tokens.length, 1);

  db.prepare(
    `INSERT INTO notifications (id, target_app, target_zone, recipient_id, category, title_ar, body_ar, deep_link, fcm_topic, audience_count, is_read, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    appTarget,
    zoneTarget,
    params.recipientId || null,
    category,
    titleClean,
    bodyClean,
    deepLink,
    fcmTopic,
    audienceCount,
    params.sentBy || 'النظام'
  );

  const fcmDelivery = await sendPushToTokens(tokens, {
    title: titleClean,
    body: bodyClean,
    channelId: params.channelId || resolveChannelId(category, deepLink, appTarget),
    category,
    deepLink,
    notificationId: id,
    orderId: params.orderId,
    tripId: params.tripId,
    parcelId: params.parcelId,
    status: params.status,
    targetApp: appTarget,
    extraData: params.extraData,
  });

  return {
    id,
    fcm_topic: fcmTopic,
    audience_count: audienceCount,
    fcm_delivery: fcmDelivery,
  };
}

/**
 * Fire-and-forget helper for transactional endpoints (orders, trips, KYC)
 * so push delivery never blocks or fails the primary HTTP response.
 */
export function enqueueSystemPushNotification(
  params: Parameters<typeof createAndSendNotification>[0]
): void {
  createAndSendNotification(params).catch((err) => {
    console.error('[FCM] System event push error:', err instanceof Error ? err.message : err);
  });
}

export interface VerifiedGoogleIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

/**
 * Verifies a Firebase Auth ID token (preferred when Firebase Admin is configured)
 * or a standard Google Sign-In OAuth2 ID token via Google's tokeninfo endpoint.
 */
export async function verifyGoogleOrFirebaseToken(idToken: string): Promise<VerifiedGoogleIdentity | null> {
  const cleanToken = String(idToken || '').trim();
  if (!cleanToken) return null;

  const fbApp = ensureFirebaseAdmin();
  if (fbApp) {
    try {
      const decoded = await getAuth(fbApp).verifyIdToken(cleanToken, false);
      const email = String(decoded.email || '').trim().toLowerCase();
      if (email) {
        return {
          uid: decoded.uid,
          email,
          emailVerified: Boolean(decoded.email_verified),
          name: String(decoded.name || '').trim(),
          picture: typeof decoded.picture === 'string' ? decoded.picture : undefined,
        };
      }
    } catch {
      // May be a raw Google OAuth2 ID token rather than a Firebase ID token; fall through to tokeninfo
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(cleanToken)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const payload = (await resp.json()) as Record<string, unknown>;
    const email = String(payload.email || '').trim().toLowerCase();
    const sub = String(payload.sub || '').trim();
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const iss = String(payload.iss || '');
    const validIssuer = iss === 'https://accounts.google.com' || iss === 'accounts.google.com';
    const expSec = Number(payload.exp || 0);
    if (!email || !sub || !validIssuer || !emailVerified || (expSec > 0 && expSec * 1000 < Date.now())) {
      return null;
    }
    const allowedWebClientId = String(
      process.env.GOOGLE_WEB_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || ''
    ).trim();
    const allowedAndroidClientIds = String(process.env.GOOGLE_ANDROID_CLIENT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedAudiences = [allowedWebClientId, ...allowedAndroidClientIds].filter(Boolean);
    if (allowedAudiences.length > 0 && !allowedAudiences.includes(String(payload.aud || '').trim())) {
      return null;
    }
    return {
      uid: `google_${sub}`,
      email,
      emailVerified: true,
      name: String(payload.name || '').trim(),
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}
