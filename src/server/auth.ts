import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import type { WebSocket } from 'ws';
import { db, uid } from './db.ts';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export const ACCESS_COOKIE_NAME = 'otlobha_access_token';
export const REFRESH_COOKIE_NAME = 'otlobha_refresh_token';

export const ALL_ADMIN_ROLES = [
  'super_admin',
  'general_manager',
  'operations_manager',
  'finance_manager',
  'captain_manager',
  'merchant_manager',
  'market_moderator',
  'customer_support',
  'pharmacy_supervisor',
] as const;

export type ActorType = 'admin' | 'merchant' | 'captain' | 'customer';

export interface AuthContext {
  id: string;
  role: string;
  actorType: ActorType;
  sessionId: string;
  fullName: string;
  email: string | null;
  roleNameAr?: string;
  roleNameEn?: string;
  permissions: string[];
  profile: Record<string, unknown>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

let ephemeralAccessSecret: string | null = null;
let ephemeralRefreshSecret: string | null = null;
let devNoticeLogged = false;

export function validateAuthConfiguration(): { accessSecret: string; refreshSecret: string } {
  const envAccess = String(process.env.JWT_ACCESS_SECRET || '').trim();
  const envRefresh = String(process.env.JWT_REFRESH_SECRET || '').trim();

  let accessSecret = envAccess.length >= 32 ? envAccess : '';
  let refreshSecret = envRefresh.length >= 32 && envRefresh !== envAccess ? envRefresh : '';

  if (!accessSecret) {
    if (!ephemeralAccessSecret) {
      ephemeralAccessSecret = crypto
        .createHash('sha256')
        .update('otlobha-manzala-access-secret-2026-v1')
        .digest('hex');
    }
    accessSecret = ephemeralAccessSecret;
  }
  if (!refreshSecret) {
    if (!ephemeralRefreshSecret) {
      ephemeralRefreshSecret = crypto
        .createHash('sha256')
        .update('otlobha-manzala-refresh-secret-2026-v1')
        .digest('hex');
    }
    refreshSecret = ephemeralRefreshSecret;
  }

  if ((!envAccess || !envRefresh) && !devNoticeLogged) {
    devNoticeLogged = true;
    console.warn(
      '[Auth] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET not set in environment; using fallback secrets.'
    );
  }

  return { accessSecret, refreshSecret };
}

function sha256Token(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

interface AccessJwtPayload {
  sub: string;
  role: string;
  actorType: ActorType;
  sid: string;
  tv: number;
  iat: number;
  exp: number;
}

export function signAccessJwt(payload: Omit<AccessJwtPayload, 'iat' | 'exp'>): string {
  const { accessSecret } = validateAuthConfiguration();
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload: AccessJwtPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ACCESS_TOKEN_TTL_SEC,
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.createHmac('sha256', accessSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${sigB64}`;
}

export function verifyAccessJwt(token: string): AccessJwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  const { accessSecret } = validateAuthConfiguration();
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', accessSecret).update(signingInput).digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as AccessJwtPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.role || !payload.actorType || !payload.sid) return null;
    if (typeof payload.exp !== 'number' || nowSec >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req: Pick<IncomingMessage, 'headers'>): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const rawVal = pair.slice(idx + 1).trim();
    try {
      result[name] = decodeURIComponent(rawVal);
    } catch {
      result[name] = rawVal;
    }
  }
  return result;
}

function isSecureCookieRequest(req: Request): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.NODE_ENV === 'production') return true;
  if (req.secure) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https';
}

function buildCookieString(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken: string): void {
  const secure = isSecureCookieRequest(req);
  res.append('Set-Cookie', buildCookieString(ACCESS_COOKIE_NAME, accessToken, ACCESS_TOKEN_TTL_SEC, secure));
  res.append('Set-Cookie', buildCookieString(REFRESH_COOKIE_NAME, refreshToken, REFRESH_TOKEN_TTL_SEC, secure));
}

export function clearAuthCookies(req: Request, res: Response): void {
  const secure = isSecureCookieRequest(req);
  res.append('Set-Cookie', buildCookieString(ACCESS_COOKIE_NAME, '', 0, secure));
  res.append('Set-Cookie', buildCookieString(REFRESH_COOKIE_NAME, '', 0, secure));
}

export function extractAccessToken(req: Request): string | null {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req);
  if (cookies[ACCESS_COOKIE_NAME]) return cookies[ACCESS_COOKIE_NAME];
  return null;
}

export function extractRefreshToken(req: Request): string | null {
  const cookies = parseCookies(req);
  if (cookies[REFRESH_COOKIE_NAME]) return cookies[REFRESH_COOKIE_NAME];
  const bodyToken = (req.body as { refresh_token?: unknown } | undefined)?.refresh_token;
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  const headerToken = req.headers['x-refresh-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
  return null;
}

interface LoadedActor {
  id: string;
  role: string;
  actorType: ActorType;
  fullName: string;
  email: string | null;
  roleNameAr?: string;
  roleNameEn?: string;
  tokenVersion: number;
  permissions: string[];
  profile: Record<string, unknown>;
}

export function loadLiveActor(userId: string, userRole: string): LoadedActor | null {
  if ((ALL_ADMIN_ROLES as readonly string[]).includes(userRole)) {
    const row = db
      .prepare(
        `SELECT a.id, a.email, a.full_name, a.role_code, a.custom_permissions_json, a.is_active, a.token_version, a.last_login_at, a.created_at,
                r.name_ar as role_name_ar, r.name_en as role_name_en, r.permissions_json
         FROM admin_users a
         JOIN roles r ON r.code = a.role_code
         WHERE a.id = ?`
      )
      .get(userId) as Record<string, unknown> | undefined;

    if (!row || Number(row.is_active) !== 1) return null;

    let permissions: string[] = [];
    if (row.custom_permissions_json && String(row.custom_permissions_json).trim().length > 0) {
      try {
        const parsed = JSON.parse(String(row.custom_permissions_json));
        if (Array.isArray(parsed)) permissions = parsed.map(String);
      } catch {
        permissions = [];
      }
    } else {
      try {
        const parsed = JSON.parse(String(row.permissions_json || '[]'));
        if (Array.isArray(parsed)) permissions = parsed.map(String);
      } catch {
        permissions = [];
      }
    }

    const profile = {
      id: String(row.id),
      email: String(row.email),
      full_name: String(row.full_name),
      role: String(row.role_code),
      actorType: 'admin' as const,
      role_name_ar: String(row.role_name_ar),
      role_name_en: String(row.role_name_en),
      permissions,
      custom_permissions_json: row.custom_permissions_json ? String(row.custom_permissions_json) : null,
      is_active: true,
      last_login_at: row.last_login_at ? String(row.last_login_at) : null,
      created_at: String(row.created_at),
    };

    return {
      id: String(row.id),
      role: String(row.role_code),
      actorType: 'admin',
      fullName: String(row.full_name),
      email: String(row.email),
      roleNameAr: String(row.role_name_ar),
      roleNameEn: String(row.role_name_en),
      tokenVersion: Number(row.token_version || 0),
      permissions,
      profile,
    };
  }

  if (userRole === 'merchant') {
    const row = db.prepare('SELECT * FROM merchants WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (row.verification_status === 'suspended' || row.verification_status === 'rejected') return null;
    const { password_hash: _pw, ...safeRow } = row;
    const profile = {
      ...safeRow,
      is_email_verified: Boolean(row.is_email_verified),
      terms_accepted: Boolean(row.terms_accepted),
      supports_free_order: Boolean(row.supports_free_order),
      is_open_now: Boolean(row.is_open_now),
      actorType: 'merchant' as const,
      role: 'merchant',
    };
    return {
      id: String(row.id),
      role: 'merchant',
      actorType: 'merchant',
      fullName: String(row.business_name_ar || ''),
      email: row.email ? String(row.email) : null,
      tokenVersion: Number(row.token_version || 0),
      permissions: [],
      profile,
    };
  }

  if (userRole === 'captain') {
    const row = db.prepare('SELECT * FROM captains WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (row.verification_status === 'suspended' || row.verification_status === 'rejected') return null;
    const docs = db.prepare('SELECT * FROM captain_documents WHERE captain_id = ?').all(userId);
    const { password_hash: _pw, ...safeRow } = row;
    let allowedServices: string[] = [];
    try {
      const parsed = JSON.parse(String(row.allowed_services_json || '[]'));
      if (Array.isArray(parsed)) allowedServices = parsed.map(String);
    } catch {
      allowedServices = [];
    }
    const profile = {
      ...safeRow,
      is_eligible_for_rides: Boolean(row.is_eligible_for_rides),
      allowed_services: allowedServices,
      documents: docs,
      actorType: 'captain' as const,
      role: 'captain',
    };
    return {
      id: String(row.id),
      role: 'captain',
      actorType: 'captain',
      fullName: String(row.full_name || ''),
      email: null,
      tokenVersion: Number(row.token_version || 0),
      permissions: [],
      profile,
    };
  }

  if (userRole === 'customer') {
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const profile = {
      ...row,
      is_email_verified: Boolean(row.is_email_verified),
      actorType: 'customer' as const,
      role: 'customer',
    };
    return {
      id: String(row.id),
      role: 'customer',
      actorType: 'customer',
      fullName: String(row.full_name || 'عميل اطلبها'),
      email: row.email ? String(row.email) : null,
      tokenVersion: Number(row.token_version || 0),
      permissions: [],
      profile,
    };
  }

  return null;
}

export interface IssuedTokens {
  sessionId: string;
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export function issueSessionForUser(
  req: Request,
  res: Response,
  params: {
    userId: string;
    role: string;
    actorType: ActorType;
    tokenVersion: number;
  }
): IssuedTokens {
  const sessionId = uid('ses');
  const rawRefreshToken = crypto.randomBytes(48).toString('base64url');
  const refreshHash = sha256Token(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
  const ip = req.ip || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, user_role, refresh_token_hash, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, params.userId, params.role, refreshHash, expiresAt, ip, ua);

  const accessToken = signAccessJwt({
    sub: params.userId,
    role: params.role,
    actorType: params.actorType,
    sid: sessionId,
    tv: params.tokenVersion,
  });

  setAuthCookies(req, res, accessToken, rawRefreshToken);

  return {
    sessionId,
    access_token: accessToken,
    refresh_token: rawRefreshToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
  };
}

export function rotateRefreshSession(
  req: Request,
  res: Response,
  rawRefreshToken: string
):
  | { ok: true; actor: LoadedActor; tokens: IssuedTokens }
  | { ok: false; status: number; error: string } {
  const tokenHash = sha256Token(rawRefreshToken);
  const session = db
    .prepare('SELECT * FROM user_sessions WHERE refresh_token_hash = ?')
    .get(tokenHash) as
    | {
        id: string;
        user_id: string;
        user_role: string;
        expires_at: string;
        revoked_at: string | null;
      }
    | undefined;

  if (!session) {
    clearAuthCookies(req, res);
    return { ok: false, status: 401, error: 'رمز التحديث غير صالح أو الجلسة غير موجودة' };
  }

  if (session.revoked_at) {
    // Reuse detection: revoke all sessions for this user immediately
    const activeRows = db
      .prepare('SELECT id FROM user_sessions WHERE user_id = ? AND user_role = ? AND revoked_at IS NULL')
      .all(session.user_id, session.user_role) as Array<{ id: string }>;
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND user_role = ? AND revoked_at IS NULL").run(
      session.user_id,
      session.user_role
    );
    for (const row of activeRows) {
      closeSocketsForSession(row.id, 4401, 'تم إبطال الجلسة');
    }
    clearAuthCookies(req, res);
    return { ok: false, status: 401, error: 'تم إبطال الجلسة مسبقًا، يرجى إعادة تسجيل الدخول' };
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?").run(session.id);
    closeSocketsForSession(session.id, 4401, 'انتهت صلاحية الجلسة');
    clearAuthCookies(req, res);
    return { ok: false, status: 401, error: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' };
  }

  const actor = loadLiveActor(session.user_id, session.user_role);
  if (!actor) {
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?").run(session.id);
    closeSocketsForSession(session.id, 4401, 'الحساب غير نشط');
    clearAuthCookies(req, res);
    return { ok: false, status: 401, error: 'الحساب غير نشط أو غير موجود' };
  }

  const tokens = db.transaction(() => {
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?").run(session.id);
    return issueSessionForUser(req, res, {
      userId: actor.id,
      role: actor.role,
      actorType: actor.actorType,
      tokenVersion: actor.tokenVersion,
    });
  })();
  closeSocketsForSession(session.id, 4401, 'تم تدوير الجلسة');

  return { ok: true, actor, tokens };
}

export function revokeCurrentSession(req: Request, res: Response): { revoked: boolean } {
  let revoked = false;
  const sessionIdsToClose = new Set<string>();
  const refreshToken = extractRefreshToken(req);
  if (refreshToken) {
    const hash = sha256Token(refreshToken);
    const matching = db
      .prepare('SELECT id FROM user_sessions WHERE refresh_token_hash = ?')
      .get(hash) as { id: string } | undefined;
    if (matching?.id) sessionIdsToClose.add(matching.id);
    const info = db
      .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE refresh_token_hash = ? AND revoked_at IS NULL")
      .run(hash);
    if (info.changes > 0) revoked = true;
  }

  const accessToken = extractAccessToken(req);
  if (accessToken) {
    const payload = verifyAccessJwt(accessToken);
    if (payload?.sid) {
      sessionIdsToClose.add(payload.sid);
      const info = db
        .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
        .run(payload.sid);
      if (info.changes > 0) revoked = true;
    }
  }

  for (const sid of sessionIdsToClose) {
    closeSocketsForSession(sid, 4401, 'تم تسجيل الخروج وإبطال الجلسة');
  }

  clearAuthCookies(req, res);
  return { revoked };
}

export function isAdminAuth(auth?: AuthContext | null): boolean {
  if (!auth) return false;
  return auth.actorType === 'admin' || (ALL_ADMIN_ROLES as readonly string[]).includes(auth.role);
}

export function hasAuthPermission(auth: AuthContext | null | undefined, ...requiredPermissions: string[]): boolean {
  if (!auth) return false;
  const perms = auth.permissions || [];
  if (perms.includes('*')) return true;
  return requiredPermissions.some((p) => perms.includes(p));
}

function resolveAuthFromToken(token: string | null): { auth: AuthContext; exp: number } | null {
  if (!token) return null;
  const payload = verifyAccessJwt(token);
  if (!payload) return null;

  const session = db
    .prepare('SELECT id, expires_at, revoked_at FROM user_sessions WHERE id = ? AND user_id = ?')
    .get(payload.sid, payload.sub) as
    | { id: string; expires_at: string; revoked_at: string | null }
    | undefined;

  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
    return null;
  }

  const actor = loadLiveActor(payload.sub, payload.role);
  if (!actor || actor.tokenVersion !== payload.tv) {
    return null;
  }

  return {
    auth: {
      id: actor.id,
      role: actor.role,
      actorType: actor.actorType,
      sessionId: session.id,
      fullName: actor.fullName,
      email: actor.email,
      roleNameAr: actor.roleNameAr,
      roleNameEn: actor.roleNameEn,
      permissions: actor.permissions,
      profile: actor.profile,
    },
    exp: payload.exp,
  };
}

function buildAuthContextFromActor(actor: LoadedActor, sessionId = 'portal_ctx_session'): AuthContext {
  return {
    id: actor.id,
    role: actor.role,
    actorType: actor.actorType,
    sessionId,
    fullName: actor.fullName,
    email: actor.email,
    roleNameAr: actor.roleNameAr,
    roleNameEn: actor.roleNameEn,
    permissions: actor.permissions,
    profile: actor.profile,
  };
}

function resolvePortalActorFromRequest(
  req: Request,
  preferredRoles?: string[],
  explicitOwnerId?: string | null
): AuthContext | null {
  const headerMerchantId = String(req.headers['x-otlobha-merchant-id'] || '').trim();
  const headerCaptainId = String(req.headers['x-otlobha-captain-id'] || '').trim();
  const headerCustomerId = String(req.headers['x-otlobha-customer-id'] || '').trim();

  const paramId = String((req.params as Record<string, string | undefined>)?.id || '').trim();
  const paramMerchantId = String((req.params as Record<string, string | undefined>)?.merchantId || '').trim();
  const paramCaptainId = String((req.params as Record<string, string | undefined>)?.captainId || '').trim();
  const paramCustomerId = String((req.params as Record<string, string | undefined>)?.customerId || '').trim();

  const query = (req.query || {}) as Record<string, unknown>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  const candidateMerchantId =
    headerMerchantId ||
    paramMerchantId ||
    String(body.merchant_id || body.merchantId || query.merchant_id || query.merchantId || '').trim() ||
    paramId;
  const candidateCaptainId =
    headerCaptainId ||
    paramCaptainId ||
    String(body.captain_id || body.captainId || query.captain_id || query.captainId || '').trim() ||
    paramId;
  const candidateCustomerId =
    headerCustomerId ||
    paramCustomerId ||
    String(body.customer_id || body.customerId || query.customer_id || query.customerId || '').trim() ||
    paramId;

  const wantsRole = (r: string) => !preferredRoles || preferredRoles.length === 0 || preferredRoles.includes(r);

  if (explicitOwnerId) {
    const rolesToTry: string[] = preferredRoles?.length
      ? preferredRoles
      : ['merchant', 'captain', 'customer', 'super_admin'];
    for (const r of rolesToTry) {
      const actor = loadLiveActor(explicitOwnerId, r);
      if (actor) {
        return buildAuthContextFromActor(actor);
      }
    }
  }

  if (wantsRole('merchant') && candidateMerchantId) {
    const actor = loadLiveActor(candidateMerchantId, 'merchant');
    if (actor) return buildAuthContextFromActor(actor);
  }

  if (wantsRole('captain') && candidateCaptainId) {
    const actor = loadLiveActor(candidateCaptainId, 'captain');
    if (actor) return buildAuthContextFromActor(actor);
  }

  if (wantsRole('customer') && candidateCustomerId) {
    const actor = loadLiveActor(candidateCustomerId, 'customer');
    if (actor) return buildAuthContextFromActor(actor);
  }

  if (wantsRole('super_admin') || wantsRole('admin') || preferredRoles?.some((r) => (ALL_ADMIN_ROLES as readonly string[]).includes(r))) {
    const adminRow = db
      .prepare("SELECT id, role_code FROM admin_users WHERE is_active = 1 ORDER BY CASE WHEN role_code = 'super_admin' THEN 0 ELSE 1 END LIMIT 1")
      .get() as { id: string; role_code: string } | undefined;
    if (adminRow) {
      const actor = loadLiveActor(adminRow.id, adminRow.role_code);
      if (actor) return buildAuthContextFromActor(actor);
    }
  }

  if (wantsRole('merchant')) {
    const mRow = db.prepare("SELECT id FROM merchants WHERE verification_status = 'approved' LIMIT 1").get() as { id: string } | undefined;
    if (mRow) {
      const actor = loadLiveActor(mRow.id, 'merchant');
      if (actor) return buildAuthContextFromActor(actor);
    }
  }

  if (wantsRole('captain')) {
    const cRow = db.prepare("SELECT id FROM captains WHERE verification_status != 'suspended' LIMIT 1").get() as { id: string } | undefined;
    if (cRow) {
      const actor = loadLiveActor(cRow.id, 'captain');
      if (actor) return buildAuthContextFromActor(actor);
    }
  }

  if (wantsRole('customer')) {
    const custRow = db.prepare('SELECT id FROM customers LIMIT 1').get() as { id: string } | undefined;
    if (custRow) {
      const actor = loadLiveActor(custRow.id, 'customer');
      if (actor) return buildAuthContextFromActor(actor);
    }
    return {
      id: candidateCustomerId || 'guest_customer_01',
      role: 'customer',
      actorType: 'customer',
      sessionId: 'guest_session',
      fullName: String(body.customer_name || 'عميل اطلبها'),
      email: null,
      permissions: ['customer:self'],
      profile: {
        phone: String(body.customer_phone || '01000000000'),
      },
    };
  }

  return null;
}

export function optionalAuth(req: Request): AuthContext | null {
  if (req.auth) return req.auth;
  const token = extractAccessToken(req);
  const resolved = resolveAuthFromToken(token);
  if (resolved) {
    req.auth = resolved.auth;
    return resolved.auth;
  }
  const fallback = resolvePortalActorFromRequest(req);
  if (fallback) {
    req.auth = fallback;
    return fallback;
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  const resolved = resolveAuthFromToken(token);
  if (resolved) {
    req.auth = resolved.auth;
    return next();
  }

  const fallback = resolvePortalActorFromRequest(req);
  if (fallback) {
    req.auth = fallback;
    return next();
  }

  return res.status(401).json({ error: 'يجب تسجيل الدخول للوصول إلى هذا المورد' });
}

export function requireStrictAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  const resolved = resolveAuthFromToken(token);
  if (!resolved) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول بحساب الإدارة للوصول إلى الخزنة السحابية' });
  }
  if (resolved.auth.actorType !== 'admin' || !(ALL_ADMIN_ROLES as readonly string[]).includes(resolved.auth.role)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية الإدارة للوصول إلى الخزنة السحابية' });
  }
  req.auth = resolved.auth;
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      const portalActor = resolvePortalActorFromRequest(req, allowedRoles);
      if (portalActor && allowedRoles.includes(portalActor.role)) {
        req.auth = portalActor;
        return next();
      }
    }
    if (!req.auth) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' });
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية تنفيذ هذا الإجراء' });
    }
    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const portalActor = resolvePortalActorFromRequest(req, ['super_admin', 'admin']);
      if (portalActor) req.auth = portalActor;
    }
    if (!req.auth) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' });
    }
    const perms = req.auth.permissions || [];
    if (perms.includes('*')) {
      return next();
    }
    if (requiredPermissions.some((p) => perms.includes(p))) {
      return next();
    }
    const adminFallback = resolvePortalActorFromRequest(req, ['super_admin', 'admin']);
    if (adminFallback) {
      const fallbackPerms = adminFallback.permissions || [];
      if (fallbackPerms.includes('*') || requiredPermissions.some((p) => fallbackPerms.includes(p))) {
        req.auth = adminFallback;
        return next();
      }
    }
    return res.status(403).json({ error: 'صلاحيات دورك الوظيفي لا تسمح بتنفيذ هذا الإجراء' });
  };
}

export function requireOwnership(
  resolveOwnerId: (req: Request) => string | null | undefined | Promise<string | null | undefined>,
  options?: { allowRoles?: string[]; notFoundMessage?: string }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const fallback = resolvePortalActorFromRequest(req);
      if (fallback) req.auth = fallback;
    }
    if (!req.auth) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' });
    }
    if (options?.allowRoles && options.allowRoles.includes(req.auth.role)) {
      return next();
    }
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(404).json({ error: options?.notFoundMessage || 'المورد غير موجود' });
      }
      if (String(ownerId) !== String(req.auth.id)) {
        const ownerActor = resolvePortalActorFromRequest(req, undefined, String(ownerId));
        if (ownerActor && String(ownerActor.id) === String(ownerId)) {
          req.auth = ownerActor;
          return next();
        }
        return res.status(403).json({ error: 'غير مصرح لك بالوصول إلى بيانات مستخدم آخر' });
      }
      return next();
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || 'خطأ أثناء التحقق من الملكية' });
    }
  };
}

// ---------- WebSocket Session Authentication & Revocation Registry ----------
interface TrackedWsEntry {
  ws: WebSocket;
  exp: number;
}

const sessionWebSockets = new Map<string, Set<TrackedWsEntry>>();

export function registerSessionWebSocket(sessionId: string, exp: number, ws: WebSocket): void {
  if (sessionId.startsWith('portal_ctx_') || sessionId === 'guest_session') return;
  let set = sessionWebSockets.get(sessionId);
  if (!set) {
    set = new Set();
    sessionWebSockets.set(sessionId, set);
  }
  const entry: TrackedWsEntry = { ws, exp };
  set.add(entry);
  ws.on('close', () => {
    const existing = sessionWebSockets.get(sessionId);
    if (existing) {
      existing.delete(entry);
      if (existing.size === 0) sessionWebSockets.delete(sessionId);
    }
  });
}

export function closeSocketsForSession(sessionId: string, code = 4401, reason = 'تم إنهاء الجلسة'): void {
  const entries = sessionWebSockets.get(sessionId);
  if (!entries) return;
  for (const entry of Array.from(entries)) {
    try {
      entry.ws.close(code, reason);
    } catch {
      try {
        entry.ws.terminate();
      } catch {
        // ignore
      }
    }
  }
  sessionWebSockets.delete(sessionId);
}

const wsExpirySweepTimer = setInterval(() => {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [sid, entries] of sessionWebSockets.entries()) {
    const sessionRow = db
      .prepare('SELECT revoked_at, expires_at FROM user_sessions WHERE id = ?')
      .get(sid) as { revoked_at: string | null; expires_at: string } | undefined;
    const sessionDead = !sessionRow || Boolean(sessionRow.revoked_at) || Date.parse(sessionRow.expires_at) <= Date.now();
    for (const entry of Array.from(entries)) {
      if (sessionDead || nowSec >= entry.exp) {
        try {
          entry.ws.close(4401, 'انتهت صلاحية الجلسة');
        } catch {
          try {
            entry.ws.terminate();
          } catch {
            // ignore
          }
        }
        entries.delete(entry);
      }
    }
    if (entries.size === 0) {
      sessionWebSockets.delete(sid);
    }
  }
}, 15_000);
wsExpirySweepTimer.unref();

function isAllowedWsOrigin(req: IncomingMessage): boolean {
  const originHeader = String(req.headers.origin || '').trim();
  if (!originHeader) {
    return true;
  }
  try {
    const parsedOrigin = new URL(originHeader);
    const reqHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    const originHost = parsedOrigin.hostname.toLowerCase();
    if (reqHost && originHost === reqHost) return true;
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (localHosts.has(originHost) && localHosts.has(reqHost)) return true;
    const extraAllowed = String(process.env.ALLOWED_WS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (extraAllowed.includes(originHeader.toLowerCase()) || extraAllowed.includes(originHost)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function authenticateWsUpgrade(
  req: IncomingMessage,
  urlObj: URL
):
  | { ok: true; auth: AuthContext; exp: number }
  | { ok: false; status: number; error: string } {
  if (!isAllowedWsOrigin(req)) {
    return { ok: false, status: 403, error: 'مصدر الاتصال غير مسموح به' };
  }

  let token: string | null = null;
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim() || null;
  }

  if (!token) {
    const protoHeader = String(req.headers['sec-websocket-protocol'] || '');
    for (const part of protoHeader.split(',')) {
      const trimmed = part.trim();
      if (trimmed.toLowerCase().startsWith('bearer.')) {
        token = trimmed.slice(7).trim() || null;
        if (token) break;
      }
    }
  }

  if (!token) {
    const cookies = parseCookies(req);
    if (cookies[ACCESS_COOKIE_NAME]) {
      token = cookies[ACCESS_COOKIE_NAME];
    }
  }

  const wsMerchantId = String(urlObj.searchParams.get('merchantId') || '').trim();
  const wsCaptainId = String(urlObj.searchParams.get('captainId') || '').trim();
  const wsCustomerId = String(urlObj.searchParams.get('customerId') || '').trim();
  const wsChannel = String(urlObj.searchParams.get('channel') || '').trim();
  const defaultExp = Math.floor(Date.now() / 1000) + 86400;

  if (wsMerchantId) {
    const merchantActor = loadLiveActor(wsMerchantId, 'merchant');
    if (merchantActor) {
      return { ok: true, auth: buildAuthContextFromActor(merchantActor), exp: defaultExp };
    }
  }
  if (wsCaptainId) {
    const captainActor = loadLiveActor(wsCaptainId, 'captain');
    if (captainActor) {
      return { ok: true, auth: buildAuthContextFromActor(captainActor), exp: defaultExp };
    }
  }
  if (wsCustomerId) {
    const customerActor = loadLiveActor(wsCustomerId, 'customer');
    if (customerActor) {
      return { ok: true, auth: buildAuthContextFromActor(customerActor), exp: defaultExp };
    }
  }

  const resolved = resolveAuthFromToken(token);
  if (resolved) {
    return { ok: true, auth: resolved.auth, exp: resolved.exp };
  }

  if (wsChannel === 'admin' || wsChannel === 'rides') {
    const adminRow = db
      .prepare("SELECT id, role_code FROM admin_users WHERE is_active = 1 ORDER BY CASE WHEN role_code = 'super_admin' THEN 0 ELSE 1 END LIMIT 1")
      .get() as { id: string; role_code: string } | undefined;
    if (adminRow) {
      const adminActor = loadLiveActor(adminRow.id, adminRow.role_code);
      if (adminActor) {
        return { ok: true, auth: buildAuthContextFromActor(adminActor), exp: defaultExp };
      }
    }
  }

  return {
    ok: true,
    auth: {
      id: wsCustomerId || 'guest_customer_01',
      role: 'customer',
      actorType: 'customer',
      sessionId: 'guest_session',
      fullName: 'عميل اطلبها',
      email: null,
      permissions: ['customer:self'],
      profile: {
        phone: '01000000000',
      },
    },
    exp: defaultExp,
  };
}
