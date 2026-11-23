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

export type PushUserRole = 'customer' | 'captain' | 'merchant';

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
  topic_sent?: boolean;
  topic_name?: string;
  topic_message_id?: string;
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

const FCM_ADMIN_APP_NAME = 'otlobha-fcm';
let initializedApp: App | null = null;
let initAttempted = false;
let initSource: 'service_account_json' | 'fcm_env_vars' | 'google_application_credentials' | 'application_default' | 'none' = 'none';
let initProjectId: string | null = null;
let lastFcmError: { code: string; message: string; at: string } | null = null;
let customTransportForTests: CustomMulticastTransport | null = null;
const pendingPushPromises = new Set<Promise<unknown>>();

export function setPushTransportForTest(transport: CustomMulticastTransport | null): void {
  customTransportForTests = transport;
}

export async function awaitPendingPushNotifications(timeoutMs = 3500): Promise<void> {
  if (pendingPushPromises.size === 0) return;
  const snapshot = Array.from(pendingPushPromises);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Promise.allSettled(snapshot),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

  const existingNamed = getApps().find((a) => a.name === FCM_ADMIN_APP_NAME);
  if (existingNamed) {
    initializedApp = existingNamed;
    return initializedApp;
  }

  const parsed = parseServiceAccountFromEnv();
  if (parsed) {
    try {
      initializedApp = initializeApp(
        {
          credential: cert(parsed.serviceAccount),
          projectId: parsed.projectId,
        },
        FCM_ADMIN_APP_NAME
      );
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
  const explicitProjectId = String(
    process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  try {
    initializedApp = initializeApp(
      explicitProjectId
        ? {
            credential: applicationDefault(),
            projectId: explicitProjectId,
          }
        : {
            credential: applicationDefault(),
          },
      FCM_ADMIN_APP_NAME
    );
    initSource = gac ? 'google_application_credentials' : 'application_default';
    initProjectId = explicitProjectId || (initializedApp.options?.projectId ?? null);
    console.log(`[FCM] Firebase Admin SDK initialized via ${initSource} (project: ${initProjectId || 'auto'})`);
    return initializedApp;
  } catch (err) {
    console.warn('[FCM] applicationDefault() initialization failed:', err instanceof Error ? err.message : err);
  }

  console.warn(
    '[FCM] Firebase Admin credentials not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY). In-app notifications will still be saved in SQLite.'
  );
  return null;
}

export async function probeFcmAuth(): Promise<{
  ok: boolean;
  code?: string;
  message: string;
}> {
  const app = ensureFirebaseAdmin();
  if (!app) {
    return {
      ok: false,
      code: 'fcm_not_configured',
      message: 'لم يتم تهيئة Firebase Admin SDK على الخادم (أضف FIREBASE_SERVICE_ACCOUNT_JSON).',
    };
  }
  try {
    await getMessaging(app).send(
      {
        token: 'probe_invalid_token_check_auth_only',
        notification: { title: 'probe', body: 'probe' },
      },
      true
    );
    return { ok: true, message: 'اتصال Firebase Cloud Messaging مفعل ويعمل بنجاح.' };
  } catch (err: any) {
    const code = String(err?.code || 'unknown');
    const msg = String(err?.message || err);
    if (
      code === 'messaging/invalid-argument' ||
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      return { ok: true, code, message: 'صلاحيات Firebase Cloud Messaging (FCM v1) مفعلة وتعمل بنجاح.' };
    }
    lastFcmError = { code, message: msg, at: new Date().toISOString() };
    return {
      ok: false,
      code,
      message:
        code === 'messaging/mismatched-credential' || msg.includes('cloudmessaging.messages.create')
          ? `صلاحية إرسال إشعارات FCM غير مفعلة على الخادم (${code}): يرجى إضافة FIREBASE_SERVICE_ACCOUNT_JSON من مشروع Firebase الصحيح أو منح صلاحية Firebase Cloud Messaging API Admin لحساب خدمة Cloud Run.`
          : `فشل التحقق من FCM (${code}): ${msg}`,
    };
  }
}

export function getFcmStatus(): {
  configured: boolean;
  source: string;
  project_id: string | null;
  last_error: { code: string; message: string; at: string } | null;
  registered_devices: {
    total: number;
    customer: number;
    captain: number;
    merchant: number;
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
  const merchant = (
    db
      .prepare("SELECT COUNT(*) as c FROM push_device_tokens WHERE is_active = 1 AND user_role = 'merchant'")
      .get() as { c: number }
  ).c;

  return {
    configured: Boolean(app || customTransportForTests),
    source: customTransportForTests ? 'test_transport' : initSource,
    project_id: initProjectId,
    last_error: lastFcmError,
    registered_devices: { total, customer, captain, merchant },
  };
}

export function resolveChannelId(category?: string, deepLink?: string, targetApp?: string): PushChannelId {
  const dl = String(deepLink || '').toLowerCase();
  const cat = String(category || '').toLowerCase();
  if (dl.includes('chat')) return 'otlobha_chat_channel';
  if (cat === 'promo' || dl === 'offers' || dl === 'promo') return 'otlobha_admin_channel';
  if (
    (targetApp === 'captain' || targetApp === 'merchant') &&
    (cat === 'operational' || dl === 'orders' || dl === 'order' || dl === 'trip' || dl === 'rides' || dl === 'parcels')
  ) {
    return 'otlobha_dispatch_channel';
  }
  if (
    cat === 'compliance' ||
    cat === 'alert' ||
    dl === 'notifications' ||
    dl === 'profile' ||
    dl === 'kyc_upload' ||
    dl === 'verify_email'
  ) {
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

export function registerGuestDeviceToken(params: {
  fcmToken: string;
  deviceId: string;
  platform?: string | null;
  appVersion?: string | null;
  deviceLabel?: string | null;
  userRole?: PushUserRole;
}): { id: string; user_id: string; user_role: PushUserRole; device_id: string | null; active_devices: number } {
  const cleanDeviceId = String(params.deviceId || '').trim().slice(0, 100);
  const role: PushUserRole =
    params.userRole === 'captain' ? 'captain' : params.userRole === 'merchant' ? 'merchant' : 'customer';
  const existing = db
    .prepare('SELECT user_id, user_role FROM push_device_tokens WHERE fcm_token = ? LIMIT 1')
    .get(String(params.fcmToken || '').trim()) as { user_id?: string; user_role?: PushUserRole } | undefined;

  // Never downgrade a logged-in customer's token back to guest_ if it already belongs to a real user
  const effectiveUserId =
    existing?.user_id && !String(existing.user_id).startsWith('guest_')
      ? String(existing.user_id)
      : `guest_${cleanDeviceId}`;
  const effectiveRole: PushUserRole =
    existing?.user_id && !String(existing.user_id).startsWith('guest_') && existing.user_role
      ? existing.user_role
      : role;

  return registerDeviceToken({
    userId: effectiveUserId,
    userRole: effectiveRole,
    fcmToken: params.fcmToken,
    deviceId: cleanDeviceId,
    platform: params.platform,
    appVersion: params.appVersion,
    deviceLabel: params.deviceLabel,
  });
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
  category?: string | null;
}): string[] {
  const app = String(params.targetApp || 'customer').toLowerCase();
  const recipientId = params.recipientId ? String(params.recipientId).trim() : '';
  const zone = params.targetZone && params.targetZone !== 'all' ? String(params.targetZone).trim() : '';
  const isOperational = String(params.category || '').toLowerCase() === 'operational';

  if (recipientId) {
    const roles: PushUserRole[] =
      app === 'captain'
        ? ['captain']
        : app === 'merchant'
        ? ['merchant']
        : app === 'customer'
        ? ['customer']
        : ['customer', 'captain', 'merchant'];
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
    if (zone && !isOperational) {
      const zoneRows = db
        .prepare(
          `SELECT DISTINCT t.fcm_token
           FROM push_device_tokens t
           JOIN captains c ON c.id = t.user_id
           WHERE t.is_active = 1 AND t.user_role = 'captain'
             AND (c.zone_name = ? OR c.zone_name LIKE ?)`
        )
        .all(zone, `%${zone}%`) as Array<{ fcm_token: string }>;
      for (const r of zoneRows) tokens.add(r.fcm_token);
    }

    // For operational order/trip dispatch (or when zone-filtered captain query yields 0 tokens),
    // broadcast to all approved captains with registered tokens so no new order alert is silently dropped due to zone naming differences.
    if (isOperational || !zone || tokens.size === 0) {
      const rows = db
        .prepare(
          `SELECT DISTINCT t.fcm_token
           FROM push_device_tokens t
           LEFT JOIN captains c ON c.id = t.user_id
           WHERE t.is_active = 1 AND t.user_role = 'captain'
             AND (c.id IS NULL OR c.verification_status = 'approved')`
        )
        .all() as Array<{ fcm_token: string }>;
      for (const r of rows) tokens.add(r.fcm_token);
    }
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

  if (app === 'merchant' || app === 'all') {
    const rows = zone
      ? (db
          .prepare(
            `SELECT DISTINCT t.fcm_token
             FROM push_device_tokens t
             JOIN merchants m ON m.id = t.user_id
             WHERE t.is_active = 1 AND t.user_role = 'merchant'
               AND (m.zone_name = ? OR m.zone_name LIKE ?)`
          )
          .all(zone, `%${zone}%`) as Array<{ fcm_token: string }>)
      : (db
          .prepare(
            `SELECT DISTINCT fcm_token FROM push_device_tokens
             WHERE is_active = 1 AND user_role = 'merchant'`
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
            ttl: 3600 * 1000,
            notification: {
              channelId,
              sound: 'default',
              defaultVibrateTimings: true,
              visibility: 'public',
              priority: 'max',
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
        if (!resp.success) {
          if (resp.errorCode && INVALID_TOKEN_CODES.has(resp.errorCode)) {
            staleTokens.push(chunk[idx]);
          } else if (resp.errorCode || resp.errorMessage) {
            lastFcmError = {
              code: String(resp.errorCode || 'fcm_send_failed'),
              message: String(resp.errorMessage || 'FCM delivery failed'),
              at: new Date().toISOString(),
            };
            console.error(`[FCM] Delivery error (${lastFcmError.code}): ${lastFcmError.message}`);
          }
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
    } catch (err: any) {
      const code = String(err?.code || 'fcm_batch_error');
      const msg = err instanceof Error ? err.message : String(err);
      lastFcmError = { code, message: msg, at: new Date().toISOString() };
      console.error(`[FCM] Batch multicast send error (${code}):`, msg);
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

export async function sendPushToTopic(
  topic: string,
  payload: PushPayloadInput
): Promise<{ ok: boolean; topic: string; messageId?: string; errorCode?: string; errorMessage?: string }> {
  const cleanTopic = String(topic || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_.~%]/g, '_');
  if (!cleanTopic) {
    return { ok: false, topic: '', errorCode: 'invalid_topic', errorMessage: 'Empty FCM topic' };
  }
  const channelId = payload.channelId || resolveChannelId(payload.category, payload.deepLink, payload.targetApp);
  const app = customTransportForTests ? null : ensureFirebaseAdmin();
  if (!app) {
    return { ok: false, topic: cleanTopic, errorCode: 'fcm_not_configured', errorMessage: 'FCM Admin not configured' };
  }
  const dataMap = buildFcmDataMap(payload, channelId);
  try {
    const messageId = await getMessaging(app).send({
      topic: cleanTopic,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: dataMap,
      android: {
        priority: 'high',
        ttl: 3600 * 1000,
        notification: {
          channelId,
          sound: 'default',
          defaultVibrateTimings: true,
          visibility: 'public',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          tag: payload.notificationId || undefined,
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
    return { ok: true, topic: cleanTopic, messageId };
  } catch (err: any) {
    const code = String(err?.code || 'fcm_topic_error');
    const msg = err instanceof Error ? err.message : String(err);
    lastFcmError = { code, message: msg, at: new Date().toISOString() };
    console.error(`[FCM] Topic send error (${cleanTopic}) [${code}]:`, msg);
    return { ok: false, topic: cleanTopic, errorCode: code, errorMessage: msg };
  }
}

/**
 * Persists a notification into the existing `notifications` table AND dispatches real FCM Push Notifications
 * to all active devices matching the target audience. Preserves 100% of existing in-app notifications behavior.
 */
export interface NotificationCreatedEvent {
  id: string;
  targetApp: string;
  targetZone: string;
  recipientId: string | null;
  category: string;
  titleAr: string;
  bodyAr: string;
  deepLink: string;
  channelId: PushChannelId;
  orderId?: string | null;
  tripId?: string | null;
  parcelId?: string | null;
  status?: string | null;
  extraData?: Record<string, string>;
  createdAt: string;
}

type NotificationCreatedListener = (event: NotificationCreatedEvent) => void;
let notificationCreatedListener: NotificationCreatedListener | null = null;

export function setNotificationCreatedListener(listener: NotificationCreatedListener | null): void {
  notificationCreatedListener = listener;
}

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
  const resolvedChannel = params.channelId || resolveChannelId(category, deepLink, appTarget);

  const tokens = getActiveTokensForAudience({
    targetApp: appTarget,
    recipientId: params.recipientId,
    targetZone: zoneTarget,
    category,
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

  try {
    notificationCreatedListener?.({
      id,
      targetApp: appTarget,
      targetZone: zoneTarget,
      recipientId: params.recipientId || null,
      category,
      titleAr: titleClean,
      bodyAr: bodyClean,
      deepLink,
      channelId: resolvedChannel,
      orderId: params.orderId,
      tripId: params.tripId,
      parcelId: params.parcelId,
      status: params.status,
      extraData: params.extraData,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[PushService] NotificationCreatedListener error:', err instanceof Error ? err.message : err);
  }

  const pushPayload: PushPayloadInput = {
    title: titleClean,
    body: bodyClean,
    channelId: resolvedChannel,
    category,
    deepLink,
    notificationId: id,
    orderId: params.orderId,
    tripId: params.tripId,
    parcelId: params.parcelId,
    status: params.status,
    targetApp: appTarget,
    extraData: params.extraData,
  };

  let fcmDelivery = await sendPushToTokens(tokens, pushPayload);

  // For global broadcasts with 0 registered tokens OR 0 successful direct token sends,
  // also send to the FCM broadcast topic so phones subscribed to otlobha_customer_all / otlobha_captain_all / otlobha_merchant_all / otlobha_all receive background pushes.
  if (
    !params.recipientId &&
    zoneTarget === 'all' &&
    (tokens.length === 0 || fcmDelivery.sent_count === 0)
  ) {
    const targetTopic =
      appTarget === 'all'
        ? 'otlobha_all'
        : appTarget === 'captain'
        ? 'otlobha_captain_all'
        : appTarget === 'merchant'
        ? 'otlobha_merchant_all'
        : 'otlobha_customer_all';
    const topicRes = await sendPushToTopic(targetTopic, pushPayload);
    if (topicRes.ok) {
      fcmDelivery = {
        ...fcmDelivery,
        fcm_enabled: true,
        reason: undefined,
        sent_count: Math.max(fcmDelivery.sent_count, 1),
        topic_sent: true,
        topic_name: targetTopic,
        topic_message_id: topicRes.messageId,
      };
    } else if (topicRes.errorCode && topicRes.errorCode !== 'fcm_not_configured') {
      fcmDelivery = {
        ...fcmDelivery,
        reason: topicRes.errorCode,
        topic_sent: false,
        topic_name: targetTopic,
      };
    }
  }

  return {
    id,
    fcm_topic: fcmTopic,
    audience_count: audienceCount,
    fcm_delivery: fcmDelivery,
  };
}

/**
 * Queues a system push notification and tracks the in-flight promise so Cloud Run
 * does not throttle CPU and kill the FCM HTTPS request before delivery completes.
 */
export function enqueueSystemPushNotification(
  params: Parameters<typeof createAndSendNotification>[0]
): void {
  const task = createAndSendNotification(params).catch((err) => {
    console.error('[FCM] System event push error:', err instanceof Error ? err.message : err);
  });
  pendingPushPromises.add(task);
  task.finally(() => {
    pendingPushPromises.delete(task);
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
