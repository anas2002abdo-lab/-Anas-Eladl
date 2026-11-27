import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { db, uid } from './db.ts';
import {
  ALL_ADMIN_ROLES,
  hasAuthPermission,
  isAdminAuth,
  requireAuth,
  requirePermission,
  requireRole,
  type AuthContext,
} from './auth.ts';
import { haversineKm } from './engines.ts';
import {
  calculateRoadRoute,
  findBestLocalPlaceMatch,
  getMapPublicConfig,
  getVehicleRoutingProfile,
  reverseGeocode,
  searchPlaces,
  type GeoPlaceSuggestion,
  type GeoPoint,
} from './geoService.ts';

export interface RidesSystemDeps {
  broadcastToRooms: (roomKeys: string[], payload: Record<string, unknown>) => void;
  enqueueSystemPushNotification: (params: {
    targetApp: 'customer' | 'captain' | 'merchant' | 'all';
    targetZone?: string;
    recipientId?: string | null;
    category?: 'alert' | 'compliance' | 'operational' | 'promo';
    titleAr: string;
    bodyAr: string;
    deepLink?: string;
    orderId?: string | null;
    tripId?: string | null;
    parcelId?: string | null;
    status?: string | null;
    channelId?: 'otlobha_orders_channel' | 'otlobha_dispatch_channel' | 'otlobha_chat_channel' | 'otlobha_admin_channel' | 'otlobha_promos_channel';
    sentBy?: string;
    extraData?: Record<string, string>;
  }) => unknown;
  postDoubleEntryLedger: (entry: {
    idempotency_base: string;
    reference_type: string;
    reference_id: string;
    description_ar: string;
    debit_account_code: string;
    debit_account_type: string;
    credit_account_code: string;
    credit_account_type: string;
    amount: number;
  }) => void;
  recordAuditLog: (params: {
    actor_name: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id: string;
    reason?: string | null;
    details: string;
  }) => void;
  createPendingCaptainRating: (params: {
    captain_id: string;
    captain_name: string;
    customer_id?: string | null;
    customer_name: string;
    customer_phone?: string | null;
    ref_type: 'order' | 'trip' | 'parcel';
    ref_id: string;
    ref_number: string;
    final_amount: number;
  }) => Record<string, unknown>;
  ensureTripChatStarter: (tripId: string, captainName: string) => void;
  canAccessTrip: (auth: AuthContext, trip: Record<string, unknown>) => boolean;
}

export const RIDE_STATUSES = [
  'searching',
  'offered',
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_driver',
  'expired',
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  searching: new Set(['offered', 'accepted', 'no_driver', 'expired', 'cancelled']),
  offered: new Set(['searching', 'offered', 'accepted', 'no_driver', 'expired', 'cancelled']),
  accepted: new Set(['arrived', 'cancelled']),
  captain_accepted: new Set(['arrived', 'cancelled']),
  arrived: new Set(['in_progress', 'cancelled']),
  captain_arrived: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
  no_driver: new Set(),
  expired: new Set(),
};

function normalizeRideStatus(raw: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'captain_accepted') return 'accepted';
  if (s === 'captain_arrived') return 'arrived';
  return s;
}

function canTransitionStatus(fromStatus: string, toStatus: string): boolean {
  const from = normalizeRideStatus(fromStatus);
  const to = normalizeRideStatus(toStatus);
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

function hashTripOtp(tripId: string, otp: string): string {
  return crypto.createHash('sha256').update(`otlobha-ride-otp:${tripId}:${otp.trim()}`).digest('hex');
}

function verifyTripOtpHash(tripId: string, otp: string, storedHash: string): boolean {
  if (!storedHash || !/^\d{4}$/.test(otp.trim())) return false;
  const candidate = Buffer.from(hashTripOtp(tripId, otp), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Keep plaintext OTP strictly in short-lived server memory for customer display until verified,
// plus encrypted/masked column so DB dumps do not leak raw OTPs after completion.
const activeCustomerOtpCache = new Map<string, string>();

const offerTimers = new Map<string, ReturnType<typeof setTimeout>>();

let schemaInitialized = false;

export function ensureRidesSchema(): void {
  if (schemaInitialized) return;
  schemaInitialized = true;

  // 1. Safely add new columns to existing trips table
  const tripCols = db.prepare("PRAGMA table_info('trips')").all() as Array<{ name: string }>;
  const tripAdditions: Array<[string, string]> = [
    ['waypoint_address', 'ALTER TABLE trips ADD COLUMN waypoint_address TEXT'],
    ['waypoint_lat', 'ALTER TABLE trips ADD COLUMN waypoint_lat REAL'],
    ['waypoint_lng', 'ALTER TABLE trips ADD COLUMN waypoint_lng REAL'],
    ['duration_min', 'ALTER TABLE trips ADD COLUMN duration_min REAL NOT NULL DEFAULT 0'],
    ['route_polyline_json', 'ALTER TABLE trips ADD COLUMN route_polyline_json TEXT'],
    ['routing_source', "ALTER TABLE trips ADD COLUMN routing_source TEXT NOT NULL DEFAULT 'osrm_live'"],
    ['payment_method', "ALTER TABLE trips ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'"],
    ['payment_status', "ALTER TABLE trips ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending'"],
    ['fare_snapshot_id', 'ALTER TABLE trips ADD COLUMN fare_snapshot_id TEXT'],
    ['commission_rate', 'ALTER TABLE trips ADD COLUMN commission_rate REAL NOT NULL DEFAULT 12'],
    ['commission_amount', 'ALTER TABLE trips ADD COLUMN commission_amount REAL NOT NULL DEFAULT 0'],
    ['driver_net_earnings', 'ALTER TABLE trips ADD COLUMN driver_net_earnings REAL NOT NULL DEFAULT 0'],
    ['waiting_minutes', 'ALTER TABLE trips ADD COLUMN waiting_minutes REAL NOT NULL DEFAULT 0'],
    ['waiting_fee', 'ALTER TABLE trips ADD COLUMN waiting_fee REAL NOT NULL DEFAULT 0'],
    ['extra_fees', 'ALTER TABLE trips ADD COLUMN extra_fees REAL NOT NULL DEFAULT 0'],
    ['tax_amount', 'ALTER TABLE trips ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0'],
    ['cancellation_fee', 'ALTER TABLE trips ADD COLUMN cancellation_fee REAL NOT NULL DEFAULT 0'],
    ['cancelled_by', 'ALTER TABLE trips ADD COLUMN cancelled_by TEXT'],
    ['cancellation_reason', 'ALTER TABLE trips ADD COLUMN cancellation_reason TEXT'],
    ['start_otp_hash', 'ALTER TABLE trips ADD COLUMN start_otp_hash TEXT'],
    ['start_otp_plain_masked', 'ALTER TABLE trips ADD COLUMN start_otp_plain_masked TEXT'],
    ['start_otp_verified_at', 'ALTER TABLE trips ADD COLUMN start_otp_verified_at TEXT'],
    ['start_otp_attempts', 'ALTER TABLE trips ADD COLUMN start_otp_attempts INTEGER NOT NULL DEFAULT 0'],
    ['accepted_at', 'ALTER TABLE trips ADD COLUMN accepted_at TEXT'],
    ['arrived_at', 'ALTER TABLE trips ADD COLUMN arrived_at TEXT'],
    ['started_at', 'ALTER TABLE trips ADD COLUMN started_at TEXT'],
    ['completed_at', 'ALTER TABLE trips ADD COLUMN completed_at TEXT'],
    ['cancelled_at', 'ALTER TABLE trips ADD COLUMN cancelled_at TEXT'],
    ['dispatch_radius_km', 'ALTER TABLE trips ADD COLUMN dispatch_radius_km REAL NOT NULL DEFAULT 2.0'],
    ['dispatch_attempts', 'ALTER TABLE trips ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0'],
    ['dispatch_expires_at', 'ALTER TABLE trips ADD COLUMN dispatch_expires_at TEXT'],
    ['share_token', 'ALTER TABLE trips ADD COLUMN share_token TEXT'],
  ];
  for (const [col, stmt] of tripAdditions) {
    if (!tripCols.some((c) => c.name === col)) {
      db.exec(stmt);
    }
  }

  // 2. Safely add KYC/vehicle fields to captains table
  const capCols = db.prepare("PRAGMA table_info('captains')").all() as Array<{ name: string }>;
  const capAdditions: Array<[string, string]> = [
    ['email', 'ALTER TABLE captains ADD COLUMN email TEXT'],
    ['avatar_url', "ALTER TABLE captains ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''"],
    ['vehicle_brand', "ALTER TABLE captains ADD COLUMN vehicle_brand TEXT NOT NULL DEFAULT ''"],
    ['vehicle_color', "ALTER TABLE captains ADD COLUMN vehicle_color TEXT NOT NULL DEFAULT ''"],
    ['residence_id', "ALTER TABLE captains ADD COLUMN residence_id TEXT NOT NULL DEFAULT ''"],
    ['insurance_number', "ALTER TABLE captains ADD COLUMN insurance_number TEXT NOT NULL DEFAULT ''"],
    ['license_number', "ALTER TABLE captains ADD COLUMN license_number TEXT NOT NULL DEFAULT ''"],
    ['registration_number', "ALTER TABLE captains ADD COLUMN registration_number TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, stmt] of capAdditions) {
    if (!capCols.some((c) => c.name === col)) {
      db.exec(stmt);
    }
  }

  // 3. Safely add auto-dispatch controls to dispatch_config table
  const dispCols = db.prepare("PRAGMA table_info('dispatch_config')").all() as Array<{ name: string }>;
  const dispAdditions: Array<[string, string]> = [
    ['auto_dispatch_enabled', 'ALTER TABLE dispatch_config ADD COLUMN auto_dispatch_enabled INTEGER NOT NULL DEFAULT 1'],
    ['radius_step_km', 'ALTER TABLE dispatch_config ADD COLUMN radius_step_km REAL NOT NULL DEFAULT 2.0'],
    ['max_dispatch_attempts', 'ALTER TABLE dispatch_config ADD COLUMN max_dispatch_attempts INTEGER NOT NULL DEFAULT 8'],
    ['priority_mode', "ALTER TABLE dispatch_config ADD COLUMN priority_mode TEXT NOT NULL DEFAULT 'balanced'"],
  ];
  for (const [col, stmt] of dispAdditions) {
    if (!dispCols.some((c) => c.name === col)) {
      db.exec(stmt);
    }
  }

  // 4. Create normalized ride-hailing tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS ride_vehicle_types (
      code TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_ar TEXT NOT NULL DEFAULT '',
      icon_key TEXT NOT NULL DEFAULT 'car',
      image_url TEXT NOT NULL DEFAULT '',
      max_passengers INTEGER NOT NULL DEFAULT 4,
      required_docs_json TEXT NOT NULL DEFAULT '[]',
      routing_profile TEXT NOT NULL DEFAULT 'car',
      is_active INTEGER NOT NULL DEFAULT 1,
      available_zones_json TEXT NOT NULL DEFAULT '["all"]',
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ride_fare_settings (
      id TEXT PRIMARY KEY,
      vehicle_type TEXT UNIQUE NOT NULL REFERENCES ride_vehicle_types(code) ON DELETE CASCADE,
      base_fare REAL NOT NULL DEFAULT 10,
      per_km_rate REAL NOT NULL DEFAULT 4,
      per_min_rate REAL NOT NULL DEFAULT 0.5,
      min_fare REAL NOT NULL DEFAULT 15,
      waiting_grace_min INTEGER NOT NULL DEFAULT 3,
      waiting_per_min_rate REAL NOT NULL DEFAULT 1,
      cancellation_fee REAL NOT NULL DEFAULT 5,
      commission_rate REAL NOT NULL DEFAULT 12,
      tax_rate REAL NOT NULL DEFAULT 0,
      extra_fee REAL NOT NULL DEFAULT 0,
      extra_fee_label_ar TEXT NOT NULL DEFAULT '',
      peak_multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL DEFAULT 'النظام',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ride_fare_history (
      id TEXT PRIMARY KEY,
      vehicle_type TEXT NOT NULL,
      previous_json TEXT NOT NULL DEFAULT '{}',
      new_json TEXT NOT NULL DEFAULT '{}',
      changed_by_id TEXT,
      changed_by_name TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ride_fare_snapshots (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      vehicle_type TEXT NOT NULL,
      distance_km REAL NOT NULL,
      duration_min REAL NOT NULL,
      base_fare REAL NOT NULL,
      distance_cost REAL NOT NULL,
      duration_cost REAL NOT NULL,
      waiting_fee REAL NOT NULL DEFAULT 0,
      extra_fees REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      min_fare_applied INTEGER NOT NULL DEFAULT 0,
      total_estimated_fare REAL NOT NULL,
      commission_rate REAL NOT NULL,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ride_offers (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      distance_to_pickup_km REAL NOT NULL DEFAULT 0,
      eta_to_pickup_min INTEGER NOT NULL DEFAULT 3,
      radius_km REAL NOT NULL DEFAULT 2.0,
      status TEXT NOT NULL DEFAULT 'pending',
      offered_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      responded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ride_status_history (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ride_location_logs (
      id TEXT PRIMARY KEY,
      trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      heading REAL DEFAULT 0,
      speed_kmh REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days'))
    );

    CREATE TABLE IF NOT EXISTS ride_disputes (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      trip_number TEXT NOT NULL DEFAULT '',
      reporter_role TEXT NOT NULL,
      reporter_id TEXT,
      reporter_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_decision TEXT NOT NULL DEFAULT '',
      resolved_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_earnings_ledger (
      id TEXT PRIMARY KEY,
      trip_id TEXT UNIQUE NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      gross_fare REAL NOT NULL,
      commission_rate REAL NOT NULL,
      commission_amount REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      net_driver_amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      settlement_status TEXT NOT NULL DEFAULT 'unsettled',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ride_offers_trip_status ON ride_offers(trip_id, status);
    CREATE INDEX IF NOT EXISTS idx_ride_offers_captain_status ON ride_offers(captain_id, status);
    CREATE INDEX IF NOT EXISTS idx_ride_status_history_trip ON ride_status_history(trip_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ride_loc_logs_trip ON ride_location_logs(trip_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ride_loc_logs_expires ON ride_location_logs(expires_at);
    CREATE INDEX IF NOT EXISTS idx_driver_earnings_cap ON driver_earnings_ledger(captain_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_trips_status_vehicle ON trips(status, vehicle_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_trips_share_token ON trips(share_token);
  `);

  // 5. Seed the 3 required vehicle types (Car, Motorcycle, Tuk-Tuk) if absent
  const defaultVehicles = [
    {
      code: 'car',
      name_ar: 'السيارة',
      name_en: 'Car',
      description_ar: 'سيارة مكيفة ومريحة للمشاوير العائلية والطرق الرئيسية والسريعة',
      icon_key: 'car',
      max_passengers: 4,
      required_docs: ['الهوية الوطنية / الإقامة', 'رخصة القيادة السارية', 'استمارة المركبة', 'وثيقة التأمين', 'صور السيارة واللوحة'],
      routing_profile: 'car',
      sort_order: 1,
      fare: {
        base_fare: 15,
        per_km_rate: 5.5,
        per_min_rate: 0.75,
        min_fare: 25,
        waiting_grace_min: 3,
        waiting_per_min_rate: 1.5,
        cancellation_fee: 10,
        commission_rate: 15,
        tax_rate: 0,
        extra_fee: 0,
        extra_fee_label_ar: '',
      },
    },
    {
      code: 'moto',
      name_ar: 'الموتوسيكل',
      name_en: 'Motorcycle',
      description_ar: 'وصول أسرع داخل الزحام لراكب واحد بتكلفة اقتصادية',
      icon_key: 'moto',
      max_passengers: 1,
      required_docs: ['الهوية الوطنية / الإقامة', 'رخصة قيادة دراجة نارية', 'استمارة الدراجة', 'وثيقة التأمين'],
      routing_profile: 'moto',
      sort_order: 2,
      fare: {
        base_fare: 8,
        per_km_rate: 3.0,
        per_min_rate: 0.4,
        min_fare: 12,
        waiting_grace_min: 3,
        waiting_per_min_rate: 0.75,
        cancellation_fee: 5,
        commission_rate: 12,
        tax_rate: 0,
        extra_fee: 0,
        extra_fee_label_ar: '',
      },
    },
    {
      code: 'tuktuk',
      name_ar: 'التوك توك',
      name_en: 'Tuk-Tuk',
      description_ar: 'مثالي للشوارع الداخلية والأحياء السكنية القريبة حتى 3 ركاب',
      icon_key: 'tuktuk',
      max_passengers: 3,
      required_docs: ['الهوية الوطنية / الإقامة', 'رخصة القيادة', 'تصريح/استمارة المركبة'],
      routing_profile: 'tuktuk',
      sort_order: 3,
      fare: {
        base_fare: 10,
        per_km_rate: 3.5,
        per_min_rate: 0.5,
        min_fare: 15,
        waiting_grace_min: 3,
        waiting_per_min_rate: 1.0,
        cancellation_fee: 5,
        commission_rate: 12,
        tax_rate: 0,
        extra_fee: 0,
        extra_fee_label_ar: '',
      },
    },
  ];

  const insertVehicle = db.prepare(`
    INSERT OR IGNORE INTO ride_vehicle_types
      (code, name_ar, name_en, description_ar, icon_key, max_passengers, required_docs_json, routing_profile, is_active, available_zones_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '["all"]', ?)
  `);
  const insertFare = db.prepare(`
    INSERT OR IGNORE INTO ride_fare_settings
      (id, vehicle_type, base_fare, per_km_rate, per_min_rate, min_fare, waiting_grace_min, waiting_per_min_rate, cancellation_fee, commission_rate, tax_rate, extra_fee, extra_fee_label_ar, peak_multiplier, is_active, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, 1, 'النظام')
  `);

  for (const v of defaultVehicles) {
    insertVehicle.run(
      v.code,
      v.name_ar,
      v.name_en,
      v.description_ar,
      v.icon_key,
      v.max_passengers,
      JSON.stringify(v.required_docs),
      v.routing_profile,
      v.sort_order
    );
    insertFare.run(
      `rfs_${v.code}`,
      v.code,
      v.fare.base_fare,
      v.fare.per_km_rate,
      v.fare.per_min_rate,
      v.fare.min_fare,
      v.fare.waiting_grace_min,
      v.fare.waiting_per_min_rate,
      v.fare.cancellation_fee,
      v.fare.commission_rate,
      v.fare.tax_rate,
      v.fare.extra_fee,
      v.fare.extra_fee_label_ar
    );
  }
}

export interface FareBreakdown {
  vehicle_type: string;
  base_fare: number;
  distance_km: number;
  duration_min: number;
  per_km_rate: number;
  per_min_rate: number;
  distance_cost: number;
  duration_cost: number;
  waiting_minutes: number;
  waiting_fee: number;
  extra_fees: number;
  extra_fee_label_ar: string;
  peak_multiplier: number;
  min_fare: number;
  min_fare_applied: boolean;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_fare: number;
  commission_rate: number;
  commission_amount: number;
  driver_net_earnings: number;
  cancellation_fee: number;
  settings_snapshot: Record<string, unknown>;
}

export function computeRideFare(params: {
  vehicle_type: string;
  distance_km: number;
  duration_min: number;
  waiting_minutes?: number;
}): FareBreakdown {
  const settings = db
    .prepare('SELECT * FROM ride_fare_settings WHERE vehicle_type = ?')
    .get(params.vehicle_type) as Record<string, any> | undefined;

  if (!settings || Number(settings.is_active) !== 1) {
    throw new Error(`فئة المركبة (${params.vehicle_type}) غير مفعّلة حالياً في إعدادات التسعير`);
  }

  const baseFare = Number(settings.base_fare || 0);
  const perKmRate = Number(settings.per_km_rate || 0);
  const perMinRate = Number(settings.per_min_rate || 0);
  const minFare = Number(settings.min_fare || 0);
  const graceMin = Number(settings.waiting_grace_min || 3);
  const waitPerMin = Number(settings.waiting_per_min_rate || 0);
  const extraFees = Number(settings.extra_fee || 0);
  const peak = Math.max(1, Number(settings.peak_multiplier || 1));
  const taxRate = Math.max(0, Number(settings.tax_rate || 0));
  const commRate = Math.min(100, Math.max(0, Number(settings.commission_rate || 12)));
  const cancelFee = Math.max(0, Number(settings.cancellation_fee || 0));

  const distanceKm = Math.max(0.2, Number(params.distance_km || 0));
  const durationMin = Math.max(1, Number(params.duration_min || 0));
  const waitingMin = Math.max(0, Number(params.waiting_minutes || 0));
  const billableWait = Math.max(0, waitingMin - graceMin);

  const distanceCost = Number((distanceKm * perKmRate).toFixed(2));
  const durationCost = Number((durationMin * perMinRate).toFixed(2));
  const waitingFee = Number((billableWait * waitPerMin).toFixed(2));

  const preMinSubtotal = Number(((baseFare + distanceCost + durationCost + waitingFee + extraFees) * peak).toFixed(2));
  const minFareApplied = preMinSubtotal < minFare;
  const subtotal = Number(Math.max(minFare, preMinSubtotal).toFixed(2));
  const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
  const totalFare = Number((subtotal + taxAmount).toFixed(2));
  const commissionAmount = Number(((subtotal * commRate) / 100).toFixed(2));
  const driverNet = Number(Math.max(0, subtotal - commissionAmount).toFixed(2));

  return {
    vehicle_type: params.vehicle_type,
    base_fare: baseFare,
    distance_km: Number(distanceKm.toFixed(2)),
    duration_min: Math.round(durationMin),
    per_km_rate: perKmRate,
    per_min_rate: perMinRate,
    distance_cost: distanceCost,
    duration_cost: durationCost,
    waiting_minutes: waitingMin,
    waiting_fee: waitingFee,
    extra_fees: extraFees,
    extra_fee_label_ar: String(settings.extra_fee_label_ar || ''),
    peak_multiplier: peak,
    min_fare: minFare,
    min_fare_applied: minFareApplied,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total_fare: totalFare,
    commission_rate: commRate,
    commission_amount: commissionAmount,
    driver_net_earnings: driverNet,
    cancellation_fee: cancelFee,
    settings_snapshot: {
      base_fare: baseFare,
      per_km_rate: perKmRate,
      per_min_rate: perMinRate,
      min_fare: minFare,
      waiting_grace_min: graceMin,
      waiting_per_min_rate: waitPerMin,
      extra_fee: extraFees,
      extra_fee_label_ar: String(settings.extra_fee_label_ar || ''),
      peak_multiplier: peak,
      tax_rate: taxRate,
      commission_rate: commRate,
      cancellation_fee: cancelFee,
      updated_at: settings.updated_at,
    },
  };
}

function getDispatchConfigRow(): {
  auto_dispatch_enabled: boolean;
  offer_timeout_sec: number;
  initial_radius_km: number;
  radius_step_km: number;
  max_radius_km: number;
  max_dispatch_attempts: number;
  priority_mode: 'nearest' | 'balanced' | 'highest_rated';
  weight_proximity: number;
  weight_acceptance: number;
  weight_rating: number;
  weight_idle_time: number;
} {
  const row = db.prepare("SELECT * FROM dispatch_config WHERE id = 'default'").get() as Record<string, any> | undefined;
  return {
    auto_dispatch_enabled: row ? Number(row.auto_dispatch_enabled ?? 1) === 1 : true,
    offer_timeout_sec: Math.max(5, Math.min(180, Number(row?.offer_timeout_sec ?? 25))),
    initial_radius_km: Math.max(0.5, Number(row?.initial_radius_km ?? 3.0)),
    radius_step_km: Math.max(0.5, Number(row?.radius_step_km ?? 2.5)),
    max_radius_km: Math.max(2, Number(row?.max_radius_km ?? 20.0)),
    max_dispatch_attempts: Math.max(1, Math.min(30, Number(row?.max_dispatch_attempts ?? 8))),
    priority_mode: (['nearest', 'balanced', 'highest_rated'].includes(String(row?.priority_mode))
      ? String(row?.priority_mode)
      : 'balanced') as 'nearest' | 'balanced' | 'highest_rated',
    weight_proximity: Number(row?.weight_proximity ?? 0.5),
    weight_acceptance: Number(row?.weight_acceptance ?? 0.25),
    weight_rating: Number(row?.weight_rating ?? 0.15),
    weight_idle_time: Number(row?.weight_idle_time ?? 0.1),
  };
}

function recordRideStatusHistory(params: {
  tripId: string;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string;
  actorId?: string | null;
  actorName: string;
  note?: string;
  lat?: number | null;
  lng?: number | null;
}) {
  db.prepare(`
    INSERT INTO ride_status_history
      (id, trip_id, from_status, to_status, actor_role, actor_id, actor_name, note, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid('rsh'),
    params.tripId,
    params.fromStatus,
    params.toStatus,
    params.actorRole,
    params.actorId ?? null,
    params.actorName,
    params.note || '',
    params.lat ?? null,
    params.lng ?? null
  );
}

function hydrateTripRow(tripId: string, viewerRole?: string, viewerId?: string): Record<string, any> | null {
  const row = db
    .prepare(`
      SELECT t.*,
             c.lat as captain_lat,
             c.lng as captain_lng,
             c.location_updated_at as captain_location_updated_at,
             c.vehicle_model as captain_vehicle_model,
             c.vehicle_brand as captain_vehicle_brand,
             c.vehicle_color as captain_vehicle_color,
             c.plate_number as captain_plate_number,
             c.rating_avg as captain_rating_avg,
             c.avatar_url as captain_avatar_url,
             COALESCE(t.captain_phone, c.phone) as captain_phone,
             vt.name_ar as vehicle_name_ar,
             vt.max_passengers as vehicle_max_passengers,
             (SELECT COUNT(*) FROM trip_chat_messages m WHERE m.trip_id = t.id) as chat_count
      FROM trips t
      LEFT JOIN captains c ON c.id = t.captain_id
      LEFT JOIN ride_vehicle_types vt ON vt.code = t.vehicle_type
      WHERE t.id = ?
    `)
    .get(tripId) as Record<string, any> | undefined;

  if (!row) return null;

  const normalizedStatus = normalizeRideStatus(String(row.status || 'searching'));
  let routePoints: Array<[number, number]> = [];
  try {
    const parsed = JSON.parse(String(row.route_polyline_json || '[]'));
    if (Array.isArray(parsed)) routePoints = parsed;
  } catch {
    routePoints = [];
  }

  const snapshot = db
    .prepare('SELECT * FROM ride_fare_snapshots WHERE trip_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(tripId) as Record<string, any> | undefined;

  const history = db
    .prepare('SELECT * FROM ride_status_history WHERE trip_id = ? ORDER BY created_at ASC')
    .all(tripId) as Array<Record<string, any>>;

  const rating = db
    .prepare("SELECT id, rating, comment, status, submitted_at FROM captain_ratings WHERE ref_type = 'trip' AND ref_id = ? LIMIT 1")
    .get(tripId) as Record<string, any> | undefined;

  const activeOffer = db
    .prepare(`
      SELECT ro.*, c.full_name as captain_name, c.vehicle_model, c.plate_number
      FROM ride_offers ro
      JOIN captains c ON c.id = ro.captain_id
      WHERE ro.trip_id = ? AND ro.status = 'pending'
      ORDER BY ro.offered_at DESC LIMIT 1
    `)
    .get(tripId) as Record<string, any> | undefined;

  // NEVER expose OTP hash or plain OTP to driver! Only reveal live 4-digit OTP to the trip's customer or admin before start.
  const canSeeStartOtp =
    !row.start_otp_verified_at &&
    ['searching', 'offered', 'accepted', 'arrived'].includes(normalizedStatus) &&
    ((viewerRole === 'customer' && String(row.customer_id || '') === String(viewerId || '')) ||
      (viewerRole && ALL_ADMIN_ROLES.includes(viewerRole as any)));

  const sanitized: Record<string, any> = {
    ...row,
    status: normalizedStatus,
    route_points: routePoints,
    fare_snapshot: snapshot || null,
    status_history: history,
    rating: rating || null,
    active_offer: activeOffer || null,
    start_otp_verified: Boolean(row.start_otp_verified_at),
  };
  delete sanitized.start_otp_hash;
  delete sanitized.start_otp_plain_masked;
  if (canSeeStartOtp) {
    sanitized.start_otp = activeCustomerOtpCache.get(tripId) || null;
  }
  return sanitized;
}

function isPaymentGatewayConfigured(): boolean {
  return Boolean(String(process.env.PAYMOB_API_KEY || '').trim() && String(process.env.PAYMOB_HMAC_SECRET || '').trim());
}

export function registerRidesRoutes(app: Express, deps: RidesSystemDeps) {
  ensureRidesSchema();

  const clearOfferTimer = (offerId: string) => {
    const t = offerTimers.get(offerId);
    if (t) {
      clearTimeout(t);
      offerTimers.delete(offerId);
    }
  };

  // =========================================================================
  // CENTRAL BACKEND AUTO-DISPATCH ENGINE
  // =========================================================================
  const findEligibleCandidatesForTrip = (trip: Record<string, any>, radiusKm: number) => {
    const cfg = getDispatchConfigRow();
    const pickupLat = Number(trip.pickup_lat);
    const pickupLng = Number(trip.pickup_lng);
    const vehicleType = String(trip.vehicle_type || 'car');
    const tripId = String(trip.id);

    // Strictly select approved, online/available, ride-eligible captains matching exact vehicle_type,
    // with NO active ride, NO pending offer on another ride, and NOT previously offered this trip.
    const rows = db
      .prepare(`
        SELECT c.*
        FROM captains c
        WHERE c.verification_status = 'approved'
          AND c.availability_status = 'available'
          AND c.is_eligible_for_rides = 1
          AND c.vehicle_type = ?
          AND c.cash_on_hand < c.cash_limit
          AND NOT EXISTS (
            SELECT 1 FROM trips t2
            WHERE t2.captain_id = c.id
              AND t2.status IN ('accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress')
          )
          AND NOT EXISTS (
            SELECT 1 FROM ride_offers ro_busy
            WHERE ro_busy.captain_id = c.id
              AND ro_busy.status = 'pending'
              AND ro_busy.expires_at > datetime('now')
          )
          AND NOT EXISTS (
            SELECT 1 FROM ride_offers ro_prev
            WHERE ro_prev.trip_id = ?
              AND ro_prev.captain_id = c.id
          )
      `)
      .all(vehicleType, tripId) as Array<Record<string, any>>;

    const speedKmh = getVehicleRoutingProfile(vehicleType).avgUrbanSpeedKmhFallback;
    const candidates: Array<{
      captain: Record<string, any>;
      distance_km: number;
      eta_min: number;
      score: number;
    }> = [];

    for (const c of rows) {
      // Also check allowed_services_json contains rides
      try {
        const allowed: string[] = JSON.parse(String(c.allowed_services_json || '["rides"]'));
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes('rides')) continue;
      } catch {
        // default allowed
      }
      const distKm = haversineKm(pickupLat, pickupLng, Number(c.lat || 0), Number(c.lng || 0));
      if (distKm > radiusKm) continue;
      const etaMin = Math.max(2, Math.round((distKm * 1.25 / speedKmh) * 60));

      const proximityScore = Math.max(0, 1 - distKm / Math.max(1, cfg.max_radius_km));
      const ratingScore = Math.min(1, Number(c.rating_avg || 5) / 5);
      const acceptanceScore = Math.min(1, Number(c.acceptance_rate || 95) / 100);
      const idleScore = Math.min(1, Number(c.idle_minutes || 15) / 60);

      let score = 0;
      if (cfg.priority_mode === 'nearest') {
        score = proximityScore * 0.85 + ratingScore * 0.15;
      } else if (cfg.priority_mode === 'highest_rated') {
        score = ratingScore * 0.55 + proximityScore * 0.35 + acceptanceScore * 0.1;
      } else {
        score =
          proximityScore * cfg.weight_proximity +
          acceptanceScore * cfg.weight_acceptance +
          ratingScore * cfg.weight_rating +
          idleScore * cfg.weight_idle_time;
      }

      candidates.push({ captain: c, distance_km: distKm, eta_min: etaMin, score });
    }

    candidates.sort((a, b) => {
      if (cfg.priority_mode === 'nearest' && a.distance_km !== b.distance_km) {
        return a.distance_km - b.distance_km;
      }
      return b.score - a.score;
    });

    return candidates;
  };

  const dispatchNextDriverForTrip = (tripId: string): {
    status: 'offered' | 'no_driver' | 'skipped';
    offer?: Record<string, any>;
    reason?: string;
  } => {
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return { status: 'skipped', reason: 'trip_not_found' };

    const normStatus = normalizeRideStatus(String(trip.status || ''));
    if (trip.captain_id || !['searching', 'offered'].includes(normStatus)) {
      return { status: 'skipped', reason: 'trip_not_dispatchable' };
    }

    const cfg = getDispatchConfigRow();
    if (!cfg.auto_dispatch_enabled) {
      return { status: 'skipped', reason: 'auto_dispatch_disabled' };
    }

    const attemptsSoFar = Number(trip.dispatch_attempts || 0);
    if (attemptsSoFar >= cfg.max_dispatch_attempts) {
      markTripNoDriver(trip, 'تم استنفاد الحد الأقصى لمحاولات البحث عن سائق');
      return { status: 'no_driver', reason: 'max_attempts_reached' };
    }

    // Expire any stale pending offers for this trip before dispatching next
    db.prepare("UPDATE ride_offers SET status = 'expired', responded_at = datetime('now') WHERE trip_id = ? AND status = 'pending'").run(tripId);

    // Search progressively expanding radius from current radius up to max_radius_km
    let searchRadius = Math.max(cfg.initial_radius_km, Number(trip.dispatch_radius_km || cfg.initial_radius_km));
    let chosen: { captain: Record<string, any>; distance_km: number; eta_min: number; score: number } | null = null;

    while (searchRadius <= cfg.max_radius_km + 0.001) {
      const candidates = findEligibleCandidatesForTrip(trip, searchRadius);
      if (candidates.length > 0) {
        chosen = candidates[0];
        break;
      }
      if (searchRadius >= cfg.max_radius_km) break;
      searchRadius = Math.min(cfg.max_radius_km, Number((searchRadius + cfg.radius_step_km).toFixed(2)));
    }

    if (!chosen) {
      markTripNoDriver(trip, `لم يتوفر سائق متاح ضمن نطاق ${cfg.max_radius_km} كم`);
      return { status: 'no_driver', reason: 'no_eligible_drivers' };
    }

    const offerId = uid('rof');
    const nextAttempt = attemptsSoFar + 1;
    const expiresAtIso = new Date(Date.now() + cfg.offer_timeout_sec * 1000).toISOString();
    const expiresAtSqlite = expiresAtIso.replace('T', ' ').slice(0, 19);

    const tx = db.transaction(() => {
      // Ensure trip wasn't cancelled/accepted concurrently
      const fresh = db.prepare('SELECT status, captain_id FROM trips WHERE id = ?').get(tripId) as
        | { status: string; captain_id: string | null }
        | undefined;
      if (!fresh || fresh.captain_id || !['searching', 'offered'].includes(normalizeRideStatus(fresh.status))) {
        return false;
      }
      db.prepare(`
        INSERT INTO ride_offers
          (id, trip_id, captain_id, attempt_number, distance_to_pickup_km, eta_to_pickup_min, radius_km, status, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        offerId,
        tripId,
        String(chosen!.captain.id),
        nextAttempt,
        chosen!.distance_km,
        chosen!.eta_min,
        searchRadius,
        expiresAtSqlite
      );

      db.prepare(`
        UPDATE trips
        SET status = 'offered',
            dispatch_radius_km = ?,
            dispatch_attempts = ?,
            dispatch_expires_at = ?
        WHERE id = ?
      `).run(searchRadius, nextAttempt, expiresAtSqlite, tripId);

      recordRideStatusHistory({
        tripId,
        fromStatus: normStatus,
        toStatus: 'offered',
        actorRole: 'system',
        actorName: 'محرك التوزيع التلقائي',
        note: `إرسال عرض الرحلة (محاولة #${nextAttempt}) إلى الكابتن ${String(chosen!.captain.full_name)} على بُعد ${chosen!.distance_km} كم (نطاق ${searchRadius} كم)`,
      });
      return true;
    });

    if (!tx()) {
      return { status: 'skipped', reason: 'concurrent_state_change' };
    }

    const offerPayload = {
      id: offerId,
      trip_id: tripId,
      trip_number: trip.trip_number,
      captain_id: String(chosen.captain.id),
      attempt_number: nextAttempt,
      distance_to_pickup_km: chosen.distance_km,
      eta_to_pickup_min: chosen.eta_min,
      radius_km: searchRadius,
      timeout_sec: cfg.offer_timeout_sec,
      expires_at: expiresAtIso,
      pickup_address: trip.pickup_address,
      dropoff_address: trip.dropoff_address,
      waypoint_address: trip.waypoint_address || null,
      pickup_lat: trip.pickup_lat,
      pickup_lng: trip.pickup_lng,
      dropoff_lat: trip.dropoff_lat,
      dropoff_lng: trip.dropoff_lng,
      distance_km: trip.distance_km,
      duration_min: trip.duration_min,
      estimated_fare: trip.estimated_fare,
      payment_method: trip.payment_method || 'cash',
      vehicle_type: trip.vehicle_type,
      customer_name: trip.customer_name,
    };

    // Real-time WebSocket offer directly to chosen driver + admin monitor
    deps.broadcastToRooms([`captain:${String(chosen.captain.id)}`, 'admin:all'], {
      type: 'ride:offer',
      offer: offerPayload,
    });

    // Notify customer room that dispatch is offering to a nearby driver
    const custRooms = [`trip:${tripId}`, 'admin:all', ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [])];
    deps.broadcastToRooms(custRooms, {
      type: 'trip:status',
      trip_id: tripId,
      status: 'offered',
      dispatch_attempt: nextAttempt,
      dispatch_radius_km: searchRadius,
    });

    // Real FCM push notification to the driver
    deps.enqueueSystemPushNotification({
      targetApp: 'captain',
      recipientId: String(chosen.captain.id),
      category: 'operational',
      titleAr: `طلب رحلة جديد #${String(trip.trip_number)}`,
      bodyAr: `من ${String(trip.pickup_address)} إلى ${String(trip.dropoff_address)} · الأجرة ${trip.estimated_fare} ج.م · يبعد ${chosen.distance_km} كم (مهلة ${cfg.offer_timeout_sec} ثانية)`,
      deepLink: 'ride_offer',
      tripId,
      status: 'offered',
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'محرك التوزيع',
      extraData: { offer_id: offerId, expires_at: expiresAtIso },
    });

    // Schedule exact server-side expiration check
    const timer = setTimeout(() => {
      offerTimers.delete(offerId);
      handleOfferExpiration(offerId);
    }, cfg.offer_timeout_sec * 1000 + 250);
    if (typeof timer.unref === 'function') timer.unref();
    offerTimers.set(offerId, timer);

    return { status: 'offered', offer: offerPayload };
  };

  const handleOfferExpiration = (offerId: string) => {
    const offer = db.prepare('SELECT * FROM ride_offers WHERE id = ?').get(offerId) as Record<string, any> | undefined;
    if (!offer || offer.status !== 'pending') return;

    const info = db
      .prepare("UPDATE ride_offers SET status = 'expired', responded_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(offerId);
    if (info.changes !== 1) return;

    deps.broadcastToRooms([`captain:${String(offer.captain_id)}`, 'admin:all'], {
      type: 'ride:offer_expired',
      offer_id: offerId,
      trip_id: offer.trip_id,
    });

    // Move immediately to the next eligible driver!
    dispatchNextDriverForTrip(String(offer.trip_id));
  };

  const markTripNoDriver = (trip: Record<string, any>, note: string) => {
    const tripId = String(trip.id);
    const info = db
      .prepare("UPDATE trips SET status = 'no_driver' WHERE id = ? AND captain_id IS NULL AND status IN ('searching', 'offered')")
      .run(tripId);
    if (info.changes !== 1) return;

    recordRideStatusHistory({
      tripId,
      fromStatus: normalizeRideStatus(String(trip.status)),
      toStatus: 'no_driver',
      actorRole: 'system',
      actorName: 'محرك التوزيع التلقائي',
      note,
    });

    const custRooms = [`trip:${tripId}`, 'admin:all', ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [])];
    deps.broadcastToRooms(custRooms, {
      type: 'trip:no_driver',
      trip_id: tripId,
      status: 'no_driver',
      message: 'نعتذر، لا يوجد سائق متاح حالياً في منطقتك. يمكنك المحاولة مرة أخرى بعد قليل أو اختيار فئة مركبة أخرى.',
    });

    if (trip.customer_id) {
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: 'لا يوجد سائق متاح حالياً',
        bodyAr: `لم نتمكن من إيجاد سائق متاح لرحلتك #${String(trip.trip_number)} في الوقت الحالي. يمكنك إعادة المحاولة.`,
        deepLink: 'trip',
        tripId,
        status: 'no_driver',
        channelId: 'otlobha_orders_channel',
        sentBy: 'النظام',
      });
    }
  };

  // Periodic background sweep: expire overdue offers (resilient across restarts) + clean expired GPS logs (privacy retention)
  const sweepTimer = setInterval(() => {
    try {
      const overdue = db
        .prepare("SELECT id FROM ride_offers WHERE status = 'pending' AND expires_at <= datetime('now') LIMIT 30")
        .all() as Array<{ id: string }>;
      for (const row of overdue) {
        clearOfferTimer(row.id);
        handleOfferExpiration(row.id);
      }
      // Enforce 30-day GPS location privacy retention
      db.prepare("DELETE FROM ride_location_logs WHERE expires_at <= datetime('now')").run();
    } catch {
      // ignore transient sweep error
    }
  }, 5000);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  // =========================================================================
  // 1. PUBLIC/AUTHENTICATED OPEN-SOURCE MAP & GEOCODING ENDPOINTS
  // =========================================================================
  app.get('/api/rides/map-config', (_req: Request, res: Response) => {
    res.json({
      ...getMapPublicConfig(),
      online_payment_enabled: isPaymentGatewayConfigured(),
    });
  });

  const loadOtlobhaLocalPlaces = (): GeoPlaceSuggestion[] => {
    const places: GeoPlaceSuggestion[] = [];
    try {
      const zones = db
        .prepare('SELECT id, name_ar, name_en, center_lat, center_lng FROM service_zones WHERE is_active = 1')
        .all() as Array<Record<string, any>>;
      const zoneCenterMap = new Map<string, { lat: number; lng: number }>();
      for (const z of zones) {
        const lat = Number(z.center_lat);
        const lng = Number(z.center_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        zoneCenterMap.set(String(z.name_ar || '').trim(), { lat, lng });
        places.push({
          place_id: `zone_${String(z.id)}`,
          display_name: `${String(z.name_ar)}، المنزلة، الدقهلية`,
          short_name: String(z.name_ar),
          address_line: `منطقة خدمة اطلبها — ${String(z.name_ar)}`,
          city: 'المنزلة',
          country: 'مصر',
          lat,
          lng,
          category: 'zone',
          source: 'otlobha_place',
        });
      }

      const merchants = db
        .prepare(
          `SELECT id, business_name_ar, branch_name, zone_name, address_detail, merchant_type
           FROM merchants
           WHERE verification_status = 'approved'
           LIMIT 200`
        )
        .all() as Array<Record<string, any>>;
      for (const m of merchants) {
        const zName = String(m.zone_name || '').trim();
        const center = zoneCenterMap.get(zName) || { lat: 31.1583, lng: 31.9369 };
        const name = String(m.business_name_ar || '').trim();
        if (!name) continue;
        const addrLine = [m.address_detail, m.branch_name, zName].filter((v) => String(v || '').trim().length > 0).join('، ') || 'المنزلة، الدقهلية';
        places.push({
          place_id: `mer_${String(m.id)}`,
          display_name: `${name} — ${addrLine}`,
          short_name: name,
          address_line: addrLine,
          city: zName || 'المنزلة',
          country: 'مصر',
          lat: center.lat,
          lng: center.lng,
          category: String(m.merchant_type || 'shop'),
          source: 'otlobha_place',
        });
      }
    } catch {
      // ignore optional local places lookup errors
    }
    return places;
  };

  app.get('/api/rides/geo/search', requireAuth, async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ items: [], allow_manual_destination: true, attribution: '© OpenStreetMap contributors' });
    }
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const countryCodes = typeof req.query.countrycodes === 'string' ? req.query.countrycodes.trim() : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 10;
    const extraLocalPlaces = loadOtlobhaLocalPlaces();
    const items = await searchPlaces({
      query: q,
      nearLat: Number.isFinite(lat) ? lat : undefined,
      nearLng: Number.isFinite(lng) ? lng : undefined,
      countryCodes,
      limit,
      extraLocalPlaces,
    });
    res.json({ items, allow_manual_destination: true, attribution: '© OpenStreetMap contributors' });
  });

  app.get('/api/rides/geo/reverse', requireAuth, async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'إحداثيات غير صالحة' });
    }
    const result = await reverseGeocode(lat, lng);
    res.json(result);
  });

  // =========================================================================
  // 2. CUSTOMER RIDE ESTIMATE (Real OSRM road route per vehicle OR manual typed address)
  // =========================================================================
  app.post('/api/rides/estimate', requireAuth, async (req: Request, res: Response) => {
    try {
      const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, dropoff_address, waypoint_lat, waypoint_lng, zone_id } = req.body || {};
      const pLat = Number(pickup_lat);
      const pLng = Number(pickup_lng);
      const hasRawDropoffCoords =
        dropoff_lat !== undefined && dropoff_lat !== null && dropoff_lat !== '' &&
        dropoff_lng !== undefined && dropoff_lng !== null && dropoff_lng !== '';
      let dLat: number | null = hasRawDropoffCoords ? Number(dropoff_lat) : null;
      let dLng: number | null = hasRawDropoffCoords ? Number(dropoff_lng) : null;
      const typedDropoffAddress = String(dropoff_address || '').trim();

      if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || pLat < -90 || pLat > 90) {
        return res.status(400).json({ error: 'يرجى تحديد موقع الانطلاق بشكل صحيح' });
      }

      if (dLat !== null && dLng !== null) {
        if (!Number.isFinite(dLat) || !Number.isFinite(dLng) || dLat < -90 || dLat > 90 || dLng < -180 || dLng > 180) {
          dLat = null;
          dLng = null;
        }
      }

      let resolvedDropoff: GeoPlaceSuggestion | null = null;
      if ((dLat === null || dLng === null) && typedDropoffAddress.length >= 2) {
        resolvedDropoff = findBestLocalPlaceMatch(typedDropoffAddress, loadOtlobhaLocalPlaces(), pLat, pLng);
        if (resolvedDropoff) {
          dLat = resolvedDropoff.lat;
          dLng = resolvedDropoff.lng;
        }
      }

      const isUnmappedDestination = dLat === null || dLng === null;
      if (isUnmappedDestination && typedDropoffAddress.length < 2) {
        return res.status(400).json({ error: 'يرجى كتابة اسم الوجهة أو تحديدها على الخريطة' });
      }

      const waypoints: GeoPoint[] = [];
      if (waypoint_lat !== undefined && waypoint_lat !== null && waypoint_lng !== undefined && waypoint_lng !== null) {
        const wLat = Number(waypoint_lat);
        const wLng = Number(waypoint_lng);
        if (Number.isFinite(wLat) && Number.isFinite(wLng)) {
          waypoints.push({ lat: wLat, lng: wLng });
        }
      }

      const vehicleTypes = db
        .prepare(`
          SELECT vt.*, rfs.is_active as fare_active
          FROM ride_vehicle_types vt
          JOIN ride_fare_settings rfs ON rfs.vehicle_type = vt.code
          WHERE vt.is_active = 1 AND rfs.is_active = 1
          ORDER BY vt.sort_order ASC
        `)
        .all() as Array<Record<string, any>>;

      const cfg = getDispatchConfigRow();
      const onlineDrivers = db
        .prepare(`
          SELECT id, vehicle_type, lat, lng, rating_avg
          FROM captains c
          WHERE c.verification_status = 'approved'
            AND c.availability_status = 'available'
            AND c.is_eligible_for_rides = 1
            AND NOT EXISTS (
              SELECT 1 FROM trips t2
              WHERE t2.captain_id = c.id
                AND t2.status IN ('accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress')
            )
        `)
        .all() as Array<Record<string, any>>;

      const activeZone = String(zone_id || '').trim();
      const options: Array<Record<string, any>> = [];

      for (const vt of vehicleTypes) {
        // Check zone availability rule ("لا تعرض أي نوع مركبة غير متاح في منطقة العميل")
        let allowedZones: string[] = ['all'];
        try {
          const parsedZones = JSON.parse(String(vt.available_zones_json || '["all"]'));
          if (Array.isArray(parsedZones) && parsedZones.length > 0) allowedZones = parsedZones;
        } catch {
          allowedZones = ['all'];
        }
        if (activeZone && !allowedZones.includes('all') && !allowedZones.includes(activeZone)) {
          continue;
        }

        const route = isUnmappedDestination
          ? {
              vehicle_type: String(vt.code),
              routing_profile: String(vt.code),
              routing_source: 'unmapped_address' as const,
              distance_km: 0,
              duration_min: 0,
              route_points: [] as Array<[number, number]>,
              steps: [] as Array<Record<string, unknown>>,
              warnings: [
                'وجهة مكتوبة يدوياً بدون نقطة على الخريطة — يظهر الحد الأدنى المبدئي للتعريفة ويتم التواصل مع الكابتن للوصول بدقة',
              ],
            }
          : await calculateRoadRoute({
              pickup: { lat: pLat, lng: pLng },
              dropoff: { lat: dLat!, lng: dLng! },
              waypoints,
              vehicleType: String(vt.code),
            });

        const fare = computeRideFare({
          vehicle_type: String(vt.code),
          distance_km: route.distance_km,
          duration_min: route.duration_min,
        });

        // Calculate nearest online driver ETA for this vehicle category
        const matchingDrivers = onlineDrivers
          .filter((d) => String(d.vehicle_type) === String(vt.code))
          .map((d) => ({
            id: String(d.id),
            distance_km: haversineKm(pLat, pLng, Number(d.lat || 0), Number(d.lng || 0)),
          }))
          .filter((d) => d.distance_km <= cfg.max_radius_km)
          .sort((a, b) => a.distance_km - b.distance_km);

        const speedKmh = getVehicleRoutingProfile(String(vt.code)).avgUrbanSpeedKmhFallback;
        const nearestDriver = matchingDrivers[0] || null;
        const driverEtaMin = nearestDriver
          ? Math.max(2, Math.round((nearestDriver.distance_km * 1.25 / speedKmh) * 60))
          : null;

        options.push({
          code: vt.code,
          name_ar: vt.name_ar,
          name_en: vt.name_en,
          description_ar: vt.description_ar,
          icon_key: vt.icon_key,
          image_url: vt.image_url,
          max_passengers: Number(vt.max_passengers || 1),
          routing_profile: route.routing_profile,
          routing_source: route.routing_source,
          unmapped_destination: isUnmappedDestination,
          distance_km: route.distance_km,
          duration_min: route.duration_min,
          route_points: route.route_points,
          steps: route.steps.slice(0, 15),
          warnings: route.warnings,
          driver_eta_min: driverEtaMin,
          nearby_drivers_count: matchingDrivers.length,
          estimated_fare: fare.total_fare,
          fare: {
            ...fare,
            estimated_fare: fare.total_fare,
          },
        });
      }

      res.json({
        pickup: { lat: pLat, lng: pLng },
        dropoff: isUnmappedDestination ? null : { lat: dLat, lng: dLng },
        resolved_dropoff: resolvedDropoff,
        unmapped_destination: isUnmappedDestination,
        waypoints,
        online_payment_enabled: isPaymentGatewayConfigured(),
        attribution: '© OpenStreetMap contributors',
        options,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حساب تسعيرة الرحلة' });
    }
  });

  // =========================================================================
  // 3. CUSTOMER REQUEST RIDE (Server-Calculated Fare + Snapshot + OTP + Dispatch)
  // =========================================================================
  app.post('/api/rides/request', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const {
        vehicle_type,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        waypoint_address,
        waypoint_lat,
        waypoint_lng,
        payment_method,
        customer_name,
        customer_phone,
      } = req.body || {};

      const vehCode = String(vehicle_type || '').trim().toLowerCase();
      const vehRow = db
        .prepare('SELECT * FROM ride_vehicle_types WHERE code = ? AND is_active = 1')
        .get(vehCode) as Record<string, any> | undefined;
      if (!vehRow) {
        return res.status(400).json({ error: 'نوع المركبة المختار غير متاح حالياً' });
      }

      const pLat = Number(pickup_lat);
      const pLng = Number(pickup_lng);
      const hasRawDropoffCoords =
        dropoff_lat !== undefined && dropoff_lat !== null && dropoff_lat !== '' &&
        dropoff_lng !== undefined && dropoff_lng !== null && dropoff_lng !== '';
      let dLat: number | null = hasRawDropoffCoords ? Number(dropoff_lat) : null;
      let dLng: number | null = hasRawDropoffCoords ? Number(dropoff_lng) : null;
      const cleanedDropoffAddress = String(dropoff_address || '').trim();

      if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || pLat < -90 || pLat > 90) {
        return res.status(400).json({ error: 'يرجى تحديد موقع الانطلاق قبل تأكيد الرحلة' });
      }
      if (dLat !== null && dLng !== null) {
        if (!Number.isFinite(dLat) || !Number.isFinite(dLng) || dLat < -90 || dLat > 90 || dLng < -180 || dLng > 180) {
          dLat = null;
          dLng = null;
        }
      }
      if ((dLat === null || dLng === null) && cleanedDropoffAddress.length >= 2) {
        const localMatch = findBestLocalPlaceMatch(cleanedDropoffAddress, loadOtlobhaLocalPlaces(), pLat, pLng);
        if (localMatch) {
          dLat = localMatch.lat;
          dLng = localMatch.lng;
        }
      }
      const isUnmappedDestination = dLat === null || dLng === null;
      if (isUnmappedDestination && cleanedDropoffAddress.length < 2) {
        return res.status(400).json({ error: 'يرجى كتابة اسم الوجهة أو تحديدها على الخريطة قبل تأكيد الرحلة' });
      }

      const payMethod = String(payment_method || 'cash').trim().toLowerCase();
      if (payMethod !== 'cash' && payMethod !== 'online') {
        return res.status(400).json({ error: 'وسيلة الدفع غير صالحة' });
      }
      if (payMethod === 'online' && !isPaymentGatewayConfigured()) {
        return res.status(400).json({ error: 'الدفع الإلكتروني غير مفعّل حالياً — يرجى اختيار الدفع نقداً للسائق' });
      }

      // Prevent customer from creating duplicate concurrent active ride
      const customerId = auth.role === 'customer' ? auth.id : req.body.customer_id ? String(req.body.customer_id) : null;
      if (customerId) {
        const existingActive = db
          .prepare(`
            SELECT id, trip_number, status FROM trips
            WHERE customer_id = ? AND status IN ('searching', 'offered', 'accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress')
            LIMIT 1
          `)
          .get(customerId) as { id: string; trip_number: string; status: string } | undefined;
        if (existingActive) {
          return res.status(409).json({
            error: `لديك رحلة نشطة حالياً (#${existingActive.trip_number}) — يرجى إنهاؤها أو إلغاؤها أولاً`,
            active_trip_id: existingActive.id,
          });
        }
      }

      const waypoints: GeoPoint[] = [];
      let wLat: number | null = null;
      let wLng: number | null = null;
      if (waypoint_lat !== undefined && waypoint_lat !== null && waypoint_lng !== undefined && waypoint_lng !== null) {
        const parsedWLat = Number(waypoint_lat);
        const parsedWLng = Number(waypoint_lng);
        if (Number.isFinite(parsedWLat) && Number.isFinite(parsedWLng)) {
          wLat = parsedWLat;
          wLng = parsedWLng;
          waypoints.push({ lat: parsedWLat, lng: parsedWLng });
        }
      }

      // Rule #4: Server ALWAYS calculates road route & fare (never trusts client price!)
      const route = isUnmappedDestination
        ? {
            distance_km: 0,
            duration_min: 0,
            route_points: [] as Array<[number, number]>,
            routing_source: 'unmapped_address' as const,
            warnings: [
              'وجهة مكتوبة يدوياً بدون نقطة على الخريطة — يتم التواصل مع الكابتن لتحديد الموقع بدقة',
            ],
          }
        : await calculateRoadRoute({
            pickup: { lat: pLat, lng: pLng },
            dropoff: { lat: dLat!, lng: dLng! },
            waypoints,
            vehicleType: vehCode,
          });

      const fare = computeRideFare({
        vehicle_type: vehCode,
        distance_km: route.distance_km,
        duration_min: route.duration_min,
      });

      if (!Number.isFinite(fare.total_fare) || fare.total_fare <= 0) {
        return res.status(400).json({ error: 'تعذر احتساب أجرة الرحلة من إعدادات التسعير' });
      }

      let resolvedCustName = String(customer_name || '').trim();
      let resolvedCustPhone = String(customer_phone || '').trim();
      if (customerId) {
        const cRow = db.prepare('SELECT full_name, phone FROM customers WHERE id = ?').get(customerId) as
          | { full_name?: string; phone?: string }
          | undefined;
        if (!resolvedCustName && cRow?.full_name) resolvedCustName = cRow.full_name;
        if (!resolvedCustPhone && cRow?.phone) resolvedCustPhone = cRow.phone;
      }
      resolvedCustName = resolvedCustName || auth.fullName || 'عميل اطلبها';
      resolvedCustPhone = resolvedCustPhone || '01000000000';

      const tripId = uid('trp');
      const tripNumber = `TRP-${Math.floor(10000 + Math.random() * 89999)}`;
      const snapshotId = uid('rfsn');
      const startOtp = String(crypto.randomInt(1000, 10000));
      const startOtpHash = hashTripOtp(tripId, startOtp);
      const shareToken = crypto.randomBytes(16).toString('hex');
      const cfg = getDispatchConfigRow();

      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO trips (
            id, trip_number, customer_id, customer_name, customer_phone, vehicle_type,
            pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
            waypoint_address, waypoint_lat, waypoint_lng,
            distance_km, duration_min, route_polyline_json, routing_source,
            estimated_fare, customer_proposed_fare, final_fare, fare_updated_by,
            payment_method, payment_status, fare_snapshot_id,
            commission_rate, commission_amount, driver_net_earnings,
            extra_fees, tax_amount,
            start_otp_hash, start_otp_plain_masked, share_token,
            dispatch_radius_km, dispatch_attempts, status
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, 'pricing_engine',
            ?, 'pending', ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, 0, 'searching'
          )
        `).run(
          tripId,
          tripNumber,
          customerId,
          resolvedCustName,
          resolvedCustPhone,
          vehCode,
          String(pickup_address || 'موقع الانطلاق المحدد').trim(),
          String(dropoff_address || 'الوجهة المحددة').trim(),
          pLat,
          pLng,
          dLat,
          dLng,
          waypoint_address ? String(waypoint_address).trim() : null,
          wLat,
          wLng,
          route.distance_km,
          route.duration_min,
          JSON.stringify(route.route_points),
          route.routing_source,
          fare.total_fare,
          fare.total_fare,
          fare.total_fare,
          payMethod,
          snapshotId,
          fare.commission_rate,
          fare.commission_amount,
          fare.driver_net_earnings,
          fare.extra_fees,
          fare.tax_amount,
          startOtpHash,
          `${startOtp.slice(0, 1)}**${startOtp.slice(3)}`,
          shareToken,
          cfg.initial_radius_km
        );

        db.prepare(`
          INSERT INTO ride_fare_snapshots (
            id, trip_id, vehicle_type, distance_km, duration_min,
            base_fare, distance_cost, duration_cost, waiting_fee, extra_fees,
            tax_amount, min_fare_applied, total_estimated_fare, commission_rate, settings_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `).run(
          snapshotId,
          tripId,
          vehCode,
          route.distance_km,
          route.duration_min,
          fare.base_fare,
          fare.distance_cost,
          fare.duration_cost,
          fare.extra_fees,
          fare.tax_amount,
          fare.min_fare_applied ? 1 : 0,
          fare.total_fare,
          fare.commission_rate,
          JSON.stringify(fare.settings_snapshot)
        );

        recordRideStatusHistory({
          tripId,
          fromStatus: null,
          toStatus: 'searching',
          actorRole: auth.role,
          actorId: auth.id,
          actorName: resolvedCustName,
          note: `إنشاء طلب رحلة ${vehRow.name_ar} — المسافة ${route.distance_km} كم — الأجرة المقدرة ${fare.total_fare} ج.م`,
          lat: pLat,
          lng: pLng,
        });
      });

      tx();
      activeCustomerOtpCache.set(tripId, startOtp);

      if (customerId) {
        deps.enqueueSystemPushNotification({
          targetApp: 'customer',
          recipientId: customerId,
          category: 'operational',
          titleAr: `جاري البحث عن سائق #${tripNumber}`,
          bodyAr: `تم تأكيد طلب رحلتك (${vehRow.name_ar}) بقيمة ${fare.total_fare} ج.م وجاري التواصل مع أقرب سائق معتمد.`,
          deepLink: 'trip',
          tripId,
          status: 'searching',
          channelId: 'otlobha_orders_channel',
          sentBy: 'النظام',
        });
      }

      deps.recordAuditLog({
        actor_name: resolvedCustName,
        actor_role: auth.role,
        action: 'RIDE_REQUESTED',
        entity_type: 'trips',
        entity_id: tripId,
        details: `طلب رحلة ${tripNumber} (${vehCode}) مسافة ${route.distance_km} كم، مدة ${route.duration_min} د، أجرة ${fare.total_fare} ج.م`,
      });

      // Trigger central auto-dispatch engine immediately!
      const dispatchResult = dispatchNextDriverForTrip(tripId);
      const hydrated = hydrateTripRow(tripId, auth.role, auth.id);

      deps.broadcastToRooms(
        ['admin:all', ...(customerId ? [`customer:${customerId}`] : [])],
        {
          type: 'trip:created',
          trip: hydrated,
        }
      );

      res.status(201).json({
        ok: true,
        id: tripId,
        trip_number: tripNumber,
        status: hydrated?.status || 'searching',
        start_otp: startOtp,
        share_token: shareToken,
        fare,
        route: {
          distance_km: route.distance_km,
          duration_min: route.duration_min,
          routing_source: route.routing_source,
          route_points: route.route_points,
          warnings: route.warnings,
        },
        dispatch: dispatchResult,
        trip: hydrated,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إنشاء طلب الرحلة' });
    }
  });

  // =========================================================================
  // 4. GET MY RIDES & SINGLE RIDE DETAILS & PUBLIC SAFE SHARE LINK
  // =========================================================================
  app.get('/api/rides/my', requireAuth, (req: Request, res: Response) => {
    const auth = req.auth!;
    let rows: Array<{ id: string }> = [];
    if (auth.role === 'customer') {
      rows = db
        .prepare('SELECT id FROM trips WHERE customer_id = ? ORDER BY created_at DESC LIMIT 40')
        .all(auth.id) as Array<{ id: string }>;
    } else if (auth.role === 'captain') {
      rows = db
        .prepare('SELECT id FROM trips WHERE captain_id = ? ORDER BY created_at DESC LIMIT 40')
        .all(auth.id) as Array<{ id: string }>;
    } else if (isAdminAuth(auth)) {
      rows = db.prepare('SELECT id FROM trips ORDER BY created_at DESC LIMIT 50').all() as Array<{ id: string }>;
    } else {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    const trips = rows
      .map((r) => hydrateTripRow(r.id, auth.role, auth.id))
      .filter((t): t is Record<string, any> => Boolean(t));

    const activeTrip =
      trips.find((t) => ['searching', 'offered', 'accepted', 'arrived', 'in_progress'].includes(String(t.status))) ||
      null;

    res.json({ active_trip: activeTrip, trips });
  });

  app.get('/api/rides/share/:token', (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    if (token.length < 16) return res.status(404).json({ error: 'رابط المشاركة غير صالح' });
    const row = db
      .prepare(`
        SELECT t.id, t.trip_number, t.status, t.vehicle_type,
               t.pickup_address, t.dropoff_address, t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng,
               t.distance_km, t.duration_min, t.route_polyline_json, t.created_at, t.started_at, t.completed_at,
               c.full_name as captain_name, c.vehicle_model, c.vehicle_color, c.plate_number, c.lat as captain_lat, c.lng as captain_lng
        FROM trips t
        LEFT JOIN captains c ON c.id = t.captain_id
        WHERE t.share_token = ?
      `)
      .get(token) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'لم يتم العثور على الرحلة' });
    let routePoints: Array<[number, number]> = [];
    try {
      routePoints = JSON.parse(String(row.route_polyline_json || '[]'));
    } catch {
      routePoints = [];
    }
    res.json({
      trip_number: row.trip_number,
      status: normalizeRideStatus(String(row.status)),
      vehicle_type: row.vehicle_type,
      pickup_address: row.pickup_address,
      dropoff_address: row.dropoff_address,
      pickup_lat: row.pickup_lat,
      pickup_lng: row.pickup_lng,
      dropoff_lat: row.dropoff_lat,
      dropoff_lng: row.dropoff_lng,
      distance_km: row.distance_km,
      duration_min: row.duration_min,
      route_points: routePoints,
      captain_name: row.captain_name || null,
      vehicle_model: row.vehicle_model || null,
      vehicle_color: row.vehicle_color || null,
      plate_number: row.plate_number || null,
      captain_lat: row.captain_lat ?? null,
      captain_lng: row.captain_lng ?? null,
      attribution: '© OpenStreetMap contributors',
    });
  });

  // =========================================================================
  // 5. CAPTAIN OFFERS, ATOMIC ACCEPTANCE, REJECTION, LIFECYCLE & EARNINGS
  // =========================================================================
  app.get('/api/rides/captain/offers', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const captainId = auth.role === 'captain' ? auth.id : String(req.query.captain_id || '');
    if (!captainId) return res.status(400).json({ error: 'معرّف الكابتن مطلوب' });

    const offers = db
      .prepare(`
        SELECT ro.*,
               t.trip_number, t.pickup_address, t.dropoff_address, t.waypoint_address,
               t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng,
               t.distance_km, t.duration_min, t.estimated_fare, t.payment_method,
               t.vehicle_type, t.customer_name
        FROM ride_offers ro
        JOIN trips t ON t.id = ro.trip_id
        WHERE ro.captain_id = ?
          AND ro.status = 'pending'
          AND ro.expires_at > datetime('now')
          AND t.captain_id IS NULL
          AND t.status IN ('searching', 'offered')
        ORDER BY ro.offered_at DESC
      `)
      .all(captainId) as Array<Record<string, any>>;

    const nowMs = Date.now();
    const enriched = offers.map((o) => {
      const expIso = String(o.expires_at).includes('T') ? String(o.expires_at) : `${String(o.expires_at).replace(' ', 'T')}Z`;
      const remainingSec = Math.max(0, Math.ceil((Date.parse(expIso) - nowMs) / 1000));
      return {
        ...o,
        expires_at: expIso,
        remaining_sec: remainingSec,
      };
    });

    const activeTripRow = db
      .prepare(`
        SELECT * FROM trips
        WHERE captain_id = ? AND status IN ('accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress')
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(captainId) as Record<string, any> | undefined;

    res.json({
      offers: enriched,
      active_trip: activeTripRow ? hydrateTripRow(String(activeTripRow.id), 'captain', captainId) : null,
    });
  });

  app.post('/api/rides/offers/:offerId/accept', requireAuth, requireRole('captain'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const { offerId } = req.params;
    const offer = db.prepare('SELECT * FROM ride_offers WHERE id = ?').get(offerId) as Record<string, any> | undefined;
    if (!offer) return res.status(404).json({ error: 'عرض الرحلة غير موجود' });
    if (String(offer.captain_id) !== auth.id) {
      return res.status(403).json({ error: 'هذا العرض مخصص لسائق آخر' });
    }

    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(auth.id) as Record<string, any> | undefined;
    if (!cap) return res.status(404).json({ error: 'بيانات الكابتن غير موجودة' });

    // Rules #1, #2, #3 enforcement
    if (cap.verification_status !== 'approved') {
      return res.status(403).json({ error: 'لا يمكنك قبول الرحلات قبل اعتماد حسابك ومستنداتك من الإدارة' });
    }
    if (cap.availability_status !== 'available') {
      return res.status(409).json({ error: 'يجب أن تكون متصلاً ومتاحاً لاستقبال الرحلات' });
    }

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(offer.trip_id) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (String(cap.vehicle_type) !== String(trip.vehicle_type)) {
      return res.status(403).json({ error: 'نوع مركبتك المعتمدة لا يطابق نوع المركبة المطلوب في هذه الرحلة' });
    }

    // Rule #5: Atomic SQLite IMMEDIATE transaction prevents double-acceptance by 2 drivers!
    let outcome: { ok: true } | { ok: false; status: number; error: string } = {
      ok: false,
      status: 409,
      error: 'تعذر قبول الرحلة — ربما انتهت المهلة أو تم قبولها بالفعل',
    };

    const tx = db.transaction(() => {
      const freshOffer = db.prepare('SELECT status, expires_at FROM ride_offers WHERE id = ?').get(offerId) as
        | { status: string; expires_at: string }
        | undefined;
      if (!freshOffer || freshOffer.status !== 'pending') {
        outcome = { ok: false, status: 409, error: 'انتهت صلاحية عرض الرحلة أو تم الرد عليه مسبقاً' };
        return;
      }
      const expIso = freshOffer.expires_at.includes('T') ? freshOffer.expires_at : `${freshOffer.expires_at.replace(' ', 'T')}Z`;
      if (Date.parse(expIso) < Date.now()) {
        db.prepare("UPDATE ride_offers SET status = 'expired', responded_at = datetime('now') WHERE id = ?").run(offerId);
        outcome = { ok: false, status: 409, error: 'انتهت مهلة قبول هذا العرض وتم تحويله لسائق آخر' };
        return;
      }

      const busyTrip = db
        .prepare(`
          SELECT id FROM trips
          WHERE captain_id = ? AND status IN ('accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress')
          LIMIT 1
        `)
        .get(auth.id);
      if (busyTrip) {
        outcome = { ok: false, status: 409, error: 'لديك رحلة نشطة بالفعل — لا يمكنك قبول رحلة أخرى في نفس الوقت' };
        return;
      }

      const tripUpdate = db
        .prepare(`
          UPDATE trips
          SET status = 'accepted',
              captain_id = ?,
              captain_name = ?,
              captain_phone = ?,
              accepted_at = datetime('now')
          WHERE id = ?
            AND captain_id IS NULL
            AND status IN ('searching', 'offered')
        `)
        .run(auth.id, String(cap.full_name), String(cap.phone || ''), String(trip.id));

      if (tripUpdate.changes !== 1) {
        outcome = { ok: false, status: 409, error: 'تم قبول هذه الرحلة بالفعل من سائق آخر أو ألغيت' };
        return;
      }

      db.prepare("UPDATE ride_offers SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(offerId);
      db.prepare("UPDATE ride_offers SET status = 'cancelled', responded_at = datetime('now') WHERE trip_id = ? AND id != ? AND status = 'pending'").run(
        String(trip.id),
        offerId
      );
      db.prepare("UPDATE captains SET availability_status = 'busy', acceptance_rate = MIN(100, ROUND(acceptance_rate + 0.5, 1)) WHERE id = ?").run(auth.id);

      recordRideStatusHistory({
        tripId: String(trip.id),
        fromStatus: normalizeRideStatus(String(trip.status)),
        toStatus: 'accepted',
        actorRole: 'captain',
        actorId: auth.id,
        actorName: String(cap.full_name),
        note: `قبل الكابتن ${String(cap.full_name)} الرحلة (${String(cap.vehicle_model)} · ${String(cap.plate_number)})`,
        lat: Number(cap.lat || 0),
        lng: Number(cap.lng || 0),
      });

      outcome = { ok: true };
    });

    tx.immediate();
    clearOfferTimer(offerId);

    if (!outcome.ok) {
      return res.status(outcome.status).json({ error: outcome.error });
    }

    deps.ensureTripChatStarter(String(trip.id), String(cap.full_name));

    const tripForCaptain = hydrateTripRow(String(trip.id), 'captain', auth.id);
    const tripForCustomer = hydrateTripRow(String(trip.id), 'customer', String(trip.customer_id || ''));

    // Broadcast separately so customer gets live OTP while captain NEVER sees OTP!
    deps.broadcastToRooms([`captain:${auth.id}`, 'admin:all'], {
      type: 'trip:accepted',
      trip_id: String(trip.id),
      status: 'accepted',
      trip: tripForCaptain,
    });
    if (trip.customer_id) {
      deps.broadcastToRooms([`customer:${String(trip.customer_id)}`, `trip:${String(trip.id)}`], {
        type: 'trip:accepted',
        trip_id: String(trip.id),
        status: 'accepted',
        trip: tripForCustomer,
      });

      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: `تم قبول رحلتك — الكابتن ${String(cap.full_name)} في طريقه إليك`,
        bodyAr: `${String(cap.vehicle_model)} (${String(cap.plate_number)}) · تقييم ${cap.rating_avg ?? 5} ★`,
        deepLink: 'trip',
        tripId: String(trip.id),
        status: 'accepted',
        channelId: 'otlobha_orders_channel',
        sentBy: String(cap.full_name),
      });
    }

    deps.enqueueSystemPushNotification({
      targetApp: 'captain',
      recipientId: auth.id,
      category: 'operational',
      titleAr: `تم إسناد الرحلة #${String(trip.trip_number)} إليك`,
      bodyAr: `توجه إلى موقع العميل: ${String(trip.pickup_address)}`,
      deepLink: 'trip',
      tripId: String(trip.id),
      status: 'accepted',
      channelId: 'otlobha_dispatch_channel',
      sentBy: 'النظام',
    });

    deps.recordAuditLog({
      actor_name: String(cap.full_name),
      actor_role: 'captain',
      action: 'RIDE_ACCEPTED',
      entity_type: 'trips',
      entity_id: String(trip.id),
      details: `قبول الرحلة #${String(trip.trip_number)} بواسطة الكابتن ${String(cap.full_name)}`,
    });

    res.json({ ok: true, trip: tripForCaptain });
  });

  app.post('/api/rides/offers/:offerId/reject', requireAuth, requireRole('captain'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const { offerId } = req.params;
    const offer = db.prepare('SELECT * FROM ride_offers WHERE id = ?').get(offerId) as Record<string, any> | undefined;
    if (!offer) return res.status(404).json({ error: 'العرض غير موجود' });
    if (String(offer.captain_id) !== auth.id) {
      return res.status(403).json({ error: 'هذا العرض لا يخصك' });
    }
    if (offer.status !== 'pending') {
      return res.status(409).json({ error: 'تم الرد على العرض أو انتهت صلاحيته مسبقاً' });
    }

    clearOfferTimer(offerId);
    db.prepare("UPDATE ride_offers SET status = 'rejected', responded_at = datetime('now') WHERE id = ?").run(offerId);
    db.prepare('UPDATE captains SET acceptance_rate = MAX(0, ROUND(acceptance_rate - 1.0, 1)) WHERE id = ?').run(auth.id);

    recordRideStatusHistory({
      tripId: String(offer.trip_id),
      fromStatus: 'offered',
      toStatus: 'searching',
      actorRole: 'captain',
      actorId: auth.id,
      actorName: auth.fullName,
      note: 'رفض الكابتن العرض — جاري التحويل للسائق التالي',
    });

    // Immediately dispatch to next eligible driver!
    const nextDispatch = dispatchNextDriverForTrip(String(offer.trip_id));
    res.json({ ok: true, next_dispatch: nextDispatch });
  });

  // Direct atomic accept by tripId (useful for testing race conditions or manual broadcast fallback)
  app.post('/api/rides/:id/accept', requireAuth, requireRole('captain'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const pendingOffer = db
      .prepare("SELECT id FROM ride_offers WHERE trip_id = ? AND captain_id = ? AND status = 'pending' LIMIT 1")
      .get(tripId, auth.id) as { id: string } | undefined;

    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(auth.id) as Record<string, any> | undefined;
    if (!cap) return res.status(404).json({ error: 'بيانات الكابتن غير موجودة' });
    if (cap.verification_status !== 'approved') {
      return res.status(403).json({ error: 'لا يمكنك قبول الرحلات قبل اعتماد حسابك ومستنداتك من الإدارة' });
    }
    if (cap.availability_status !== 'available') {
      return res.status(409).json({ error: 'يجب أن تكون متصلاً ومتاحاً لاستقبال الرحلات' });
    }

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (String(cap.vehicle_type) !== String(trip.vehicle_type)) {
      return res.status(403).json({ error: 'نوع مركبتك المعتمدة لا يطابق نوع المركبة المطلوب في هذه الرحلة' });
    }

    let ok = false;
    let errMsg = 'تم قبول هذه الرحلة بالفعل من سائق آخر';
    const tx = db.transaction(() => {
      const busy = db
        .prepare("SELECT id FROM trips WHERE captain_id = ? AND status IN ('accepted', 'captain_accepted', 'arrived', 'captain_arrived', 'in_progress') LIMIT 1")
        .get(auth.id);
      if (busy) {
        errMsg = 'لديك رحلة نشطة بالفعل';
        return;
      }
      const upd = db
        .prepare(`
          UPDATE trips
          SET status = 'accepted', captain_id = ?, captain_name = ?, captain_phone = ?, accepted_at = datetime('now')
          WHERE id = ? AND captain_id IS NULL AND status IN ('searching', 'offered')
        `)
        .run(auth.id, String(cap.full_name), String(cap.phone || ''), tripId);
      if (upd.changes !== 1) return;

      if (pendingOffer) {
        db.prepare("UPDATE ride_offers SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(pendingOffer.id);
      }
      db.prepare("UPDATE ride_offers SET status = 'cancelled', responded_at = datetime('now') WHERE trip_id = ? AND status = 'pending'").run(tripId);
      db.prepare("UPDATE captains SET availability_status = 'busy' WHERE id = ?").run(auth.id);
      recordRideStatusHistory({
        tripId,
        fromStatus: normalizeRideStatus(String(trip.status)),
        toStatus: 'accepted',
        actorRole: 'captain',
        actorId: auth.id,
        actorName: String(cap.full_name),
        note: `قبول مباشر ذري بواسطة ${String(cap.full_name)}`,
      });
      ok = true;
    });

    tx.immediate();
    if (pendingOffer) clearOfferTimer(pendingOffer.id);
    if (!ok) return res.status(409).json({ error: errMsg });

    deps.ensureTripChatStarter(tripId, String(cap.full_name));
    const tripForCaptain = hydrateTripRow(tripId, 'captain', auth.id);
    const tripForCustomer = hydrateTripRow(tripId, 'customer', String(trip.customer_id || ''));

    deps.broadcastToRooms([`captain:${auth.id}`, 'admin:all'], { type: 'trip:accepted', trip_id: tripId, status: 'accepted', trip: tripForCaptain });
    if (trip.customer_id) {
      deps.broadcastToRooms([`customer:${String(trip.customer_id)}`, `trip:${tripId}`], { type: 'trip:accepted', trip_id: tripId, status: 'accepted', trip: tripForCustomer });
    }
    res.json({ ok: true, trip: tripForCaptain });
  });

  // Driver marks arrival at pickup (`accepted` -> `arrived`)
  app.post('/api/rides/:id/arrived', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && String(trip.captain_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتحديث هذه الرحلة' });
    }
    if (!canTransitionStatus(String(trip.status), 'arrived')) {
      return res.status(409).json({ error: `لا يمكن الانتقال إلى حالة الوصول من الحالة الحالية (${trip.status})` });
    }

    const lat = req.body?.lat !== undefined ? Number(req.body.lat) : null;
    const lng = req.body?.lng !== undefined ? Number(req.body.lng) : null;

    db.prepare("UPDATE trips SET status = 'arrived', arrived_at = datetime('now') WHERE id = ?").run(tripId);
    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && trip.captain_id) {
      db.prepare("UPDATE captains SET lat = ?, lng = ?, location_updated_at = datetime('now') WHERE id = ?").run(lat, lng, String(trip.captain_id));
    }

    recordRideStatusHistory({
      tripId,
      fromStatus: normalizeRideStatus(String(trip.status)),
      toStatus: 'arrived',
      actorRole: auth.role,
      actorId: auth.id,
      actorName: auth.fullName,
      note: 'وصل الكابتن إلى نقطة الانطلاق بانتظار العميل',
      lat,
      lng,
    });

    const tripForCaptain = hydrateTripRow(tripId, 'captain', String(trip.captain_id || ''));
    const tripForCustomer = hydrateTripRow(tripId, 'customer', String(trip.customer_id || ''));

    deps.broadcastToRooms([`captain:${String(trip.captain_id)}`, 'admin:all'], {
      type: 'trip:status',
      trip_id: tripId,
      status: 'arrived',
      trip: tripForCaptain,
    });
    if (trip.customer_id) {
      deps.broadcastToRooms([`customer:${String(trip.customer_id)}`, `trip:${tripId}`], {
        type: 'trip:status',
        trip_id: tripId,
        status: 'arrived',
        trip: tripForCustomer,
      });
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: 'وصل السائق إلى نقطة الانطلاق',
        bodyAr: `الكابتن ${String(trip.captain_name || '')} في انتظارك الآن. اعطه رمز البدء المكوّن من 4 أرقام للانطلاق.`,
        deepLink: 'trip',
        tripId,
        status: 'arrived',
        channelId: 'otlobha_orders_channel',
        sentBy: String(trip.captain_name || 'الكابتن'),
      });
    }

    res.json({ ok: true, trip: isAdminAuth(auth) ? tripForCustomer : tripForCaptain });
  });

  // Rule #6: Start ride ONLY after verifying 4-digit single-use OTP (`arrived` -> `in_progress`)
  app.post('/api/rides/:id/start', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const otp = String(req.body?.otp || '').trim();
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && String(trip.captain_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك ببدء هذه الرحلة' });
    }
    if (!canTransitionStatus(String(trip.status), 'in_progress')) {
      return res.status(409).json({ error: 'يجب الضغط على «وصلت إلى العميل» أولاً قبل بدء الرحلة' });
    }
    if (trip.start_otp_verified_at) {
      return res.status(409).json({ error: 'تم استخدام رمز التحقق لهذه الرحلة بالفعل' });
    }
    if (Number(trip.start_otp_attempts || 0) >= 5) {
      return res.status(429).json({ error: 'تم تجاوز الحد الأقصى لمحاولات إدخال رمز البدء — يرجى التواصل مع الدعم' });
    }
    if (!/^\d{4}$/.test(otp)) {
      return res.status(400).json({ error: 'يرجى إدخال رمز بدء الرحلة المكون من 4 أرقام' });
    }
    if (!verifyTripOtpHash(tripId, otp, String(trip.start_otp_hash || ''))) {
      db.prepare('UPDATE trips SET start_otp_attempts = COALESCE(start_otp_attempts, 0) + 1 WHERE id = ?').run(tripId);
      return res.status(400).json({ error: 'رمز التحقق غير صحيح — تأكد من الرمز الظاهر لدى العميل' });
    }

    // Calculate waiting minutes between arrival and trip start
    let waitingMin = 0;
    if (trip.arrived_at) {
      const arrivedIso = String(trip.arrived_at).includes('T') ? String(trip.arrived_at) : `${String(trip.arrived_at).replace(' ', 'T')}Z`;
      const diffMs = Date.now() - Date.parse(arrivedIso);
      if (Number.isFinite(diffMs) && diffMs > 0) {
        waitingMin = Math.floor(diffMs / 60000);
      }
    }

    // Single-use OTP consumption: clear hash/cache & record verification timestamp
    db.prepare(`
      UPDATE trips
      SET status = 'in_progress',
          started_at = datetime('now'),
          waiting_minutes = ?,
          start_otp_verified_at = datetime('now'),
          start_otp_hash = NULL
      WHERE id = ? AND status IN ('arrived', 'captain_arrived') AND start_otp_verified_at IS NULL
    `).run(waitingMin, tripId);
    activeCustomerOtpCache.delete(tripId);

    recordRideStatusHistory({
      tripId,
      fromStatus: 'arrived',
      toStatus: 'in_progress',
      actorRole: auth.role,
      actorId: auth.id,
      actorName: auth.fullName,
      note: 'تم التحقق من رمز OTP بنجاح وبدأت الرحلة نحو الوجهة',
    });

    const updated = hydrateTripRow(tripId, auth.role, auth.id);
    const rooms = [`trip:${tripId}`, 'admin:all', `captain:${String(trip.captain_id)}`, ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [])];
    deps.broadcastToRooms(rooms, {
      type: 'trip:status',
      trip_id: tripId,
      status: 'in_progress',
      trip: updated,
    });

    if (trip.customer_id) {
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: 'بدأت رحلتك الآن',
        bodyAr: `انطلقت رحلتك #${String(trip.trip_number)} مع الكابتن ${String(trip.captain_name || '')}. نتمنى لك طريقاً آمناً.`,
        deepLink: 'trip',
        tripId,
        status: 'in_progress',
        channelId: 'otlobha_orders_channel',
        sentBy: String(trip.captain_name || 'الكابتن'),
      });
    }

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_STARTED_OTP_VERIFIED',
      entity_type: 'trips',
      entity_id: tripId,
      details: `بدء الرحلة #${String(trip.trip_number)} بعد التحقق الآمن من OTP`,
    });

    res.json({ ok: true, trip: updated });
  });

  // Live driver GPS update during trip
  app.post('/api/rides/:id/location', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && String(trip.captain_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتحديث موقع هذه الرحلة' });
    }
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const heading = Number(req.body?.heading || 0);
    const speedKmh = Number(req.body?.speed_kmh || 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'إحداثيات GPS غير صالحة' });
    }

    const capId = String(trip.captain_id || auth.id);
    db.prepare("UPDATE captains SET lat = ?, lng = ?, location_updated_at = datetime('now') WHERE id = ?").run(lat, lng, capId);
    db.prepare(`
      INSERT INTO ride_location_logs (id, trip_id, captain_id, lat, lng, heading, speed_kmh, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))
    `).run(uid('rloc'), tripId, capId, lat, lng, heading, speedKmh);

    // Remaining distance & ETA to pickup (if accepted) or dropoff (if in_progress and dropoff coords exist)
    const norm = normalizeRideStatus(String(trip.status));
    const hasDropoffCoords = trip.dropoff_lat !== null && trip.dropoff_lat !== undefined && trip.dropoff_lng !== null && trip.dropoff_lng !== undefined;
    let remainingKm: number | null = null;
    let remainingMin: number | null = null;
    if (norm === 'in_progress' && hasDropoffCoords) {
      remainingKm = Number((haversineKm(lat, lng, Number(trip.dropoff_lat), Number(trip.dropoff_lng)) * 1.25).toFixed(2));
    } else if (norm !== 'in_progress' && trip.pickup_lat !== null && trip.pickup_lat !== undefined) {
      remainingKm = Number((haversineKm(lat, lng, Number(trip.pickup_lat), Number(trip.pickup_lng)) * 1.25).toFixed(2));
    }
    if (remainingKm !== null) {
      const profileSpeed = getVehicleRoutingProfile(String(trip.vehicle_type || 'car')).avgUrbanSpeedKmhFallback;
      remainingMin = Math.max(1, Math.round((remainingKm / profileSpeed) * 60));
    }

    const updatedAt = new Date().toISOString();
    const rooms = [`trip:${tripId}`, 'admin:all', `captain:${capId}`, ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [])];
    deps.broadcastToRooms(rooms, {
      type: 'ride:location',
      trip_id: tripId,
      captain_id: capId,
      lat,
      lng,
      heading,
      speed_kmh: speedKmh,
      remaining_distance_km: remainingKm,
      remaining_eta_min: remainingMin,
      updated_at: updatedAt,
    });
    deps.broadcastToRooms(rooms, {
      type: 'captain:location',
      captain_id: capId,
      lat,
      lng,
      updated_at: updatedAt,
    });

    res.json({
      ok: true,
      lat,
      lng,
      remaining_distance_km: remainingKm,
      remaining_eta_min: remainingMin,
      updated_at: updatedAt,
    });
  });

  // Rule #7: Finish ride ONLY when status === 'in_progress', compute final fare from frozen snapshot, record commission & net earnings
  app.post('/api/rides/:id/complete', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && String(trip.captain_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بإنهاء هذه الرحلة' });
    }
    if (normalizeRideStatus(String(trip.status)) !== 'in_progress') {
      return res.status(400).json({ error: 'لا يمكن إنهاء رحلة لم تبدأ بعد — يجب تأكيد البدء برمز OTP أولاً' });
    }

    const capId = String(trip.captain_id || '');
    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(capId) as Record<string, any> | undefined;
    if (!cap) return res.status(404).json({ error: 'بيانات الكابتن غير موجودة' });

    // Use frozen fare snapshot so admin price changes NEVER alter active/past trip pricing!
    const snapshot = db
      .prepare('SELECT * FROM ride_fare_snapshots WHERE trip_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(tripId) as Record<string, any> | undefined;

    let finalFare = Number(trip.estimated_fare || trip.final_fare || 0);
    let waitingFee = 0;
    let commRate = Number(trip.commission_rate || 12);
    let taxAmount = Number(trip.tax_amount || 0);
    let settingsObj: Record<string, any> = {};

    if (snapshot) {
      try {
        settingsObj = JSON.parse(String(snapshot.settings_json || '{}'));
      } catch {
        settingsObj = {};
      }
      const waitGrace = Number(settingsObj.waiting_grace_min ?? 3);
      const waitRate = Number(settingsObj.waiting_per_min_rate ?? 0);
      const waitMin = Number(trip.waiting_minutes || 0);
      const extraWait = Math.max(0, waitMin - waitGrace);
      waitingFee = Number((extraWait * waitRate).toFixed(2));
      const baseTotal = Number(snapshot.total_estimated_fare || finalFare);
      finalFare = Number((baseTotal + waitingFee).toFixed(2));
      commRate = Number(snapshot.commission_rate ?? commRate);
      taxAmount = Number(snapshot.tax_amount ?? taxAmount);
    }

    const subtotalExTax = Math.max(0, Number((finalFare - taxAmount).toFixed(2)));
    const commissionAmount = Number(((subtotalExTax * commRate) / 100).toFixed(2));
    const driverNetEarnings = Number(Math.max(0, subtotalExTax - commissionAmount).toFixed(2));
    const payMethod = String(trip.payment_method || 'cash');

    let ratingPrompt: Record<string, unknown> | null = null;
    let completed = false;

    const tx = db.transaction(() => {
      const upd = db
        .prepare(`
          UPDATE trips
          SET status = 'completed',
              final_fare = ?,
              waiting_fee = ?,
              commission_rate = ?,
              commission_amount = ?,
              driver_net_earnings = ?,
              payment_status = 'paid',
              completed_at = datetime('now')
          WHERE id = ? AND status = 'in_progress'
        `)
        .run(finalFare, waitingFee, commRate, commissionAmount, driverNetEarnings, tripId);
      if (upd.changes !== 1) return;
      completed = true;

      db.prepare(`
        INSERT OR IGNORE INTO driver_earnings_ledger
          (id, trip_id, captain_id, gross_fare, commission_rate, commission_amount, tax_amount, net_driver_amount, payment_method, settlement_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unsettled')
      `).run(uid('del'), tripId, capId, finalFare, commRate, commissionAmount, taxAmount, driverNetEarnings, payMethod);

      // Release driver back to available + update completed count + cash commission due
      db.prepare(`
        UPDATE captains
        SET availability_status = 'available',
            completed_count = completed_count + 1,
            cash_on_hand = ROUND(cash_on_hand + ?, 2)
        WHERE id = ?
      `).run(payMethod === 'cash' ? commissionAmount : 0, capId);

      if (commissionAmount > 0) {
        deps.postDoubleEntryLedger({
          idempotency_base: `ride_completed_${tripId}`,
          reference_type: 'trip',
          reference_id: tripId,
          description_ar: `عمولة اطلبها (${commRate}%) من الرحلة #${String(trip.trip_number)} — الأجرة ${finalFare} ج.م — صافي السائق ${driverNetEarnings} ج.م`,
          debit_account_code: `CASH_CAPTAIN_${capId}`,
          debit_account_type: 'cash_clearing',
          credit_account_code: 'PLATFORM_REVENUE_RIDES',
          credit_account_type: 'platform_revenue',
          amount: commissionAmount,
        });
      }

      ratingPrompt = deps.createPendingCaptainRating({
        captain_id: capId,
        captain_name: String(cap.full_name || trip.captain_name || 'الكابتن'),
        customer_id: trip.customer_id ? String(trip.customer_id) : null,
        customer_name: String(trip.customer_name || 'عميل اطلبها'),
        customer_phone: trip.customer_phone ? String(trip.customer_phone) : null,
        ref_type: 'trip',
        ref_id: tripId,
        ref_number: String(trip.trip_number),
        final_amount: finalFare,
      });

      recordRideStatusHistory({
        tripId,
        fromStatus: 'in_progress',
        toStatus: 'completed',
        actorRole: auth.role,
        actorId: auth.id,
        actorName: auth.fullName,
        note: `اكتملت الرحلة — الأجرة النهائية ${finalFare} ج.م — العمولة ${commissionAmount} ج.م — صافي السائق ${driverNetEarnings} ج.م`,
      });
    });

    tx.immediate();
    if (!completed) {
      return res.status(409).json({ error: 'تم إنهاء الرحلة بالفعل أو تغيرت حالتها' });
    }

    const hydrated = hydrateTripRow(tripId, auth.role, auth.id);
    const rooms = [`trip:${tripId}`, 'admin:all', `captain:${capId}`, ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : [])];
    deps.broadcastToRooms(rooms, {
      type: 'trip:completed',
      trip_id: tripId,
      status: 'completed',
      final_fare: finalFare,
      commission_amount: commissionAmount,
      driver_net_earnings: driverNetEarnings,
      rating_prompt: ratingPrompt,
      trip: hydrated,
    });

    if (trip.customer_id) {
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: `انتهت رحلتك #${String(trip.trip_number)}`,
        bodyAr: `الأجرة النهائية: ${finalFare} ج.م (${payMethod === 'cash' ? 'نقداً للسائق' : 'دفع إلكتروني'}). يمكنك الآن تقييم الكابتن.`,
        deepLink: 'trip',
        tripId,
        status: 'completed',
        channelId: 'otlobha_orders_channel',
        sentBy: String(cap.full_name),
      });
    }

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_COMPLETED',
      entity_type: 'trips',
      entity_id: tripId,
      details: `إنهاء الرحلة #${String(trip.trip_number)} — الأجرة ${finalFare} ج.م — عمولة ${commissionAmount} ج.م — صافي السائق ${driverNetEarnings} ج.م`,
    });

    res.json({
      ok: true,
      final_fare: finalFare,
      waiting_fee: waitingFee,
      commission_rate: commRate,
      commission_amount: commissionAmount,
      driver_net_earnings: driverNetEarnings,
      payment_method: payMethod,
      rating_prompt: ratingPrompt,
      trip: hydrated,
    });
  });

  // Cancel ride with policy check & cleanup
  app.post('/api/rides/:id/cancel', requireAuth, (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });

    const isAdmin = isAdminAuth(auth);
    if (!isAdmin && !deps.canAccessTrip(auth, trip)) {
      return res.status(403).json({ error: 'غير مصرح لك بإلغاء هذه الرحلة' });
    }
    const currentStatus = normalizeRideStatus(String(trip.status));
    if (!canTransitionStatus(currentStatus, 'cancelled')) {
      return res.status(409).json({ error: 'لا يمكن إلغاء رحلة مكتملة أو ملغاة بالفعل' });
    }

    // Cancellation fee applies only when cancelling after driver arrived
    let cancellationFee = 0;
    if (auth.role === 'customer' && currentStatus === 'arrived') {
      const fRow = db.prepare('SELECT cancellation_fee FROM ride_fare_settings WHERE vehicle_type = ?').get(trip.vehicle_type) as
        | { cancellation_fee?: number }
        | undefined;
      cancellationFee = Number(fRow?.cancellation_fee || 0);
    }

    const pendingOffers = db
      .prepare("SELECT id, captain_id FROM ride_offers WHERE trip_id = ? AND status = 'pending'")
      .all(tripId) as Array<{ id: string; captain_id: string }>;

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE trips
        SET status = 'cancelled',
            cancelled_by = ?,
            cancellation_reason = ?,
            cancellation_fee = ?,
            cancelled_at = datetime('now'),
            start_otp_hash = NULL
        WHERE id = ?
      `).run(auth.role, reason || null, cancellationFee, tripId);

      db.prepare("UPDATE ride_offers SET status = 'cancelled', responded_at = datetime('now') WHERE trip_id = ? AND status = 'pending'").run(tripId);

      if (trip.captain_id) {
        db.prepare("UPDATE captains SET availability_status = 'available' WHERE id = ? AND availability_status = 'busy'").run(String(trip.captain_id));
        if (auth.role === 'captain') {
          db.prepare('UPDATE captains SET cancellation_rate = MIN(100, ROUND(cancellation_rate + 2.0, 1)) WHERE id = ?').run(String(trip.captain_id));
        }
      }

      recordRideStatusHistory({
        tripId,
        fromStatus: currentStatus,
        toStatus: 'cancelled',
        actorRole: auth.role,
        actorId: auth.id,
        actorName: auth.fullName,
        note: reason || `إلغاء الرحلة بواسطة ${auth.role}`,
      });
    });

    tx.immediate();
    activeCustomerOtpCache.delete(tripId);
    for (const po of pendingOffers) {
      clearOfferTimer(po.id);
      deps.broadcastToRooms([`captain:${po.captain_id}`], {
        type: 'ride:offer_cancelled',
        offer_id: po.id,
        trip_id: tripId,
      });
    }

    const hydrated = hydrateTripRow(tripId, auth.role, auth.id);
    const rooms = [
      `trip:${tripId}`,
      'admin:all',
      ...(trip.captain_id ? [`captain:${String(trip.captain_id)}`] : []),
      ...(trip.customer_id ? [`customer:${String(trip.customer_id)}`] : []),
    ];
    deps.broadcastToRooms(rooms, {
      type: 'trip:cancelled',
      trip_id: tripId,
      status: 'cancelled',
      cancelled_by: auth.role,
      cancellation_fee: cancellationFee,
      reason: reason || null,
      trip: hydrated,
    });

    if (trip.customer_id && auth.role !== 'customer') {
      deps.enqueueSystemPushNotification({
        targetApp: 'customer',
        recipientId: String(trip.customer_id),
        category: 'operational',
        titleAr: `تم إلغاء الرحلة #${String(trip.trip_number)}`,
        bodyAr: reason || 'تم إلغاء الرحلة — يمكنك طلب رحلة جديدة في أي وقت.',
        deepLink: 'trip',
        tripId,
        status: 'cancelled',
        channelId: 'otlobha_orders_channel',
        sentBy: auth.fullName,
      });
    }
    if (trip.captain_id && auth.role !== 'captain') {
      deps.enqueueSystemPushNotification({
        targetApp: 'captain',
        recipientId: String(trip.captain_id),
        category: 'operational',
        titleAr: `ألغيت الرحلة #${String(trip.trip_number)}`,
        bodyAr: reason || 'قام العميل بإلغاء الرحلة. أصبحت متاحاً لاستقبال طلبات جديدة.',
        deepLink: 'trip',
        tripId,
        status: 'cancelled',
        channelId: 'otlobha_dispatch_channel',
        sentBy: auth.fullName,
      });
    }

    res.json({ ok: true, cancellation_fee: cancellationFee, trip: hydrated });
  });

  // Rule #8: Customer rates driver ONLY after ride is completed (1..5 stars + comment)
  app.post('/api/rides/:id/rate', requireAuth, requireRole('customer', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const ratingVal = Math.round(Number(req.body?.rating ?? req.body?.stars ?? 0));
    const comment = String(req.body?.comment || '').trim();

    if (ratingVal < 1 || ratingVal > 5) {
      return res.status(400).json({ error: 'يرجى اختيار تقييم من 1 إلى 5 نجوم' });
    }
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && String(trip.customer_id || '') !== auth.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتقييم هذه الرحلة' });
    }
    if (normalizeRideStatus(String(trip.status)) !== 'completed') {
      return res.status(400).json({ error: 'لا يمكن تقييم رحلة لم تكتمل بعد' });
    }
    if (!trip.captain_id) {
      return res.status(400).json({ error: 'لا يوجد سائق مسجل على هذه الرحلة' });
    }

    const existing = db
      .prepare("SELECT * FROM captain_ratings WHERE ref_type = 'trip' AND ref_id = ? LIMIT 1")
      .get(tripId) as Record<string, any> | undefined;

    if (existing && existing.status === 'submitted') {
      return res.status(409).json({ error: 'تم تقييم هذه الرحلة مسبقاً' });
    }

    const capId = String(trip.captain_id);
    const tx = db.transaction(() => {
      if (existing) {
        db.prepare(`
          UPDATE captain_ratings
          SET rating = ?, comment = ?, status = 'submitted', submitted_at = datetime('now')
          WHERE id = ?
        `).run(ratingVal, comment, String(existing.id));
      } else {
        db.prepare(`
          INSERT INTO captain_ratings
            (id, captain_id, captain_name, customer_id, customer_name, customer_phone, ref_type, ref_id, ref_number, final_amount, rating, comment, status, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, 'trip', ?, ?, ?, ?, ?, 'submitted', datetime('now'))
        `).run(
          uid('crt'),
          capId,
          String(trip.captain_name || 'الكابتن'),
          trip.customer_id || null,
          String(trip.customer_name || auth.fullName),
          trip.customer_phone || null,
          tripId,
          String(trip.trip_number),
          Number(trip.final_fare || trip.estimated_fare || 0),
          ratingVal,
          comment
        );
      }

      const avgRow = db
        .prepare("SELECT AVG(rating) as avg_r FROM captain_ratings WHERE captain_id = ? AND status = 'submitted' AND rating IS NOT NULL")
        .get(capId) as { avg_r?: number } | undefined;
      if (avgRow && Number.isFinite(Number(avgRow.avg_r))) {
        db.prepare('UPDATE captains SET rating_avg = ? WHERE id = ?').run(Number(Number(avgRow.avg_r).toFixed(2)), capId);
      }
    });
    tx();

    res.json({ ok: true, rating: ratingVal, comment });
  });

  // Customer or Driver submits ride complaint / SOS dispute
  app.post('/api/rides/:id/dispute', requireAuth, (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && !deps.canAccessTrip(auth, trip)) {
      return res.status(403).json({ error: 'غير مصرح لك بتقديم شكوى على هذه الرحلة' });
    }
    const category = String(req.body?.category || 'safety').trim();
    const description = String(req.body?.description || '').trim();
    if (description.length < 4) {
      return res.status(400).json({ error: 'يرجى كتابة تفاصيل المشكلة أو الشكوى' });
    }

    const dispId = uid('rdsp');
    db.prepare(`
      INSERT INTO ride_disputes
        (id, trip_id, trip_number, reporter_role, reporter_id, reporter_name, category, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(dispId, tripId, String(trip.trip_number || ''), auth.role, auth.id, auth.fullName, category, description);

    deps.broadcastToRooms(['admin:all'], {
      type: 'ride:dispute_created',
      dispute_id: dispId,
      trip_id: tripId,
      trip_number: trip.trip_number,
      category,
    });

    res.status(201).json({ ok: true, id: dispId });
  });

  // Real computed Captain Financial Accounts (NEVER manual captain input!)
  app.get('/api/rides/captain/earnings', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const captainId = auth.role === 'captain' ? auth.id : String(req.query.captain_id || '');
    if (!captainId) return res.status(400).json({ error: 'معرّف الكابتن مطلوب' });

    const totals = db
      .prepare(`
        SELECT
          COUNT(*) as completed_rides,
          COALESCE(SUM(gross_fare), 0) as total_gross,
          COALESCE(SUM(commission_amount), 0) as total_commission,
          COALESCE(SUM(net_driver_amount), 0) as total_net,
          COALESCE(SUM(CASE WHEN settlement_status = 'unsettled' THEN net_driver_amount ELSE 0 END), 0) as unsettled_net,
          COALESCE(SUM(CASE WHEN settlement_status = 'unsettled' AND payment_method = 'cash' THEN commission_amount ELSE 0 END), 0) as unsettled_commission_due
        FROM driver_earnings_ledger
        WHERE captain_id = ?
      `)
      .get(captainId) as Record<string, any>;

    const todayStats = db
      .prepare(`
        SELECT
          COUNT(*) as rides_today,
          COALESCE(SUM(net_driver_amount), 0) as net_today,
          COALESCE(SUM(gross_fare), 0) as gross_today
        FROM driver_earnings_ledger
        WHERE captain_id = ? AND date(created_at) = date('now')
      `)
      .get(captainId) as Record<string, any>;

    const cancelledRow = db
      .prepare("SELECT COUNT(*) as c FROM trips WHERE captain_id = ? AND status = 'cancelled'")
      .get(captainId) as { c: number };

    const recentEarnings = db
      .prepare(`
        SELECT e.*, t.trip_number, t.pickup_address, t.dropoff_address, t.distance_km, t.vehicle_type
        FROM driver_earnings_ledger e
        JOIN trips t ON t.id = e.trip_id
        WHERE e.captain_id = ?
        ORDER BY e.created_at DESC
        LIMIT 50
      `)
      .all(captainId);

    const cap = db
      .prepare('SELECT id, full_name, rating_avg, cash_on_hand, cash_limit, verification_status, availability_status, vehicle_type, vehicle_model, plate_number FROM captains WHERE id = ?')
      .get(captainId) as Record<string, any> | undefined;

    const mySettlements = cap?.full_name
      ? db
          .prepare("SELECT * FROM settlements WHERE beneficiary_type = 'captain' AND beneficiary_name = ? ORDER BY created_at DESC LIMIT 30")
          .all(String(cap.full_name))
      : [];

    const weekStats = db
      .prepare(`
        SELECT COUNT(*) as rides_count, COALESCE(SUM(gross_fare), 0) as gross_fare,
               COALESCE(SUM(commission_amount), 0) as commission, COALESCE(SUM(net_driver_amount), 0) as net_earnings
        FROM driver_earnings_ledger
        WHERE captain_id = ? AND datetime(created_at) >= datetime('now', '-7 days')
      `)
      .get(captainId) as Record<string, any>;

    const monthStats = db
      .prepare(`
        SELECT COUNT(*) as rides_count, COALESCE(SUM(gross_fare), 0) as gross_fare,
               COALESCE(SUM(commission_amount), 0) as commission, COALESCE(SUM(net_driver_amount), 0) as net_earnings
        FROM driver_earnings_ledger
        WHERE captain_id = ? AND datetime(created_at) >= datetime('now', '-30 days')
      `)
      .get(captainId) as Record<string, any>;

    const recentTrips = db
      .prepare(`
        SELECT t.id, t.trip_number, t.pickup_address, t.dropoff_address, t.distance_km, t.vehicle_type,
               t.final_fare, t.commission_amount as platform_commission, t.driver_net_earnings,
               cr.rating as customer_rating, t.completed_at, t.created_at
        FROM trips t
        LEFT JOIN captain_ratings cr ON cr.ref_type = 'trip' AND cr.ref_id = t.id
        WHERE t.captain_id = ? AND t.status = 'completed'
        ORDER BY COALESCE(t.completed_at, t.created_at) DESC
        LIMIT 30
      `)
      .all(captainId);

    res.json({
      captain: cap,
      summary: {
        total_gross_revenue: Number(Number(totals?.total_gross || 0).toFixed(2)),
        platform_commission: Number(Number(totals?.total_commission || 0).toFixed(2)),
        net_driver_earnings: Number(Number(totals?.total_net || 0).toFixed(2)),
        completed_rides: Number(totals?.completed_rides || 0),
        cancelled_rides: Number(cancelledRow?.c || 0),
        rides_today: Number(todayStats?.rides_today || 0),
        net_today: Number(Number(todayStats?.net_today || 0).toFixed(2)),
        gross_today: Number(Number(todayStats?.gross_today || 0).toFixed(2)),
        unsettled_balance: Number(Number(totals?.unsettled_net || 0).toFixed(2)),
        unsettled_commission_due: Number(Number(totals?.unsettled_commission_due || 0).toFixed(2)),
      },
      periods: {
        today: {
          rides_count: Number(todayStats?.rides_today || 0),
          gross_fare: Number(Number(todayStats?.gross_today || 0).toFixed(2)),
          commission: Number(Number((todayStats?.gross_today || 0) - (todayStats?.net_today || 0)).toFixed(2)),
          net_earnings: Number(Number(todayStats?.net_today || 0).toFixed(2)),
        },
        week: {
          rides_count: Number(weekStats?.rides_count || 0),
          gross_fare: Number(Number(weekStats?.gross_fare || 0).toFixed(2)),
          commission: Number(Number(weekStats?.commission || 0).toFixed(2)),
          net_earnings: Number(Number(weekStats?.net_earnings || 0).toFixed(2)),
        },
        month: {
          rides_count: Number(monthStats?.rides_count || 0),
          gross_fare: Number(Number(monthStats?.gross_fare || 0).toFixed(2)),
          commission: Number(Number(monthStats?.commission || 0).toFixed(2)),
          net_earnings: Number(Number(monthStats?.net_earnings || 0).toFixed(2)),
        },
        all_time: {
          rides_count: Number(totals?.completed_rides || 0),
          gross_fare: Number(Number(totals?.total_gross || 0).toFixed(2)),
          commission: Number(Number(totals?.total_commission || 0).toFixed(2)),
          net_earnings: Number(Number(totals?.total_net || 0).toFixed(2)),
        },
      },
      recent_trips: recentTrips,
      ledger: recentEarnings,
      settlements: mySettlements,
    });
  });

  // Single trip detail route (placed AFTER specific /api/rides/* routes so it doesn't shadow them!)
  app.get('/api/rides/:id', requireAuth, (req: Request, res: Response) => {
    const auth = req.auth!;
    const tripId = String(req.params.id);
    const raw = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
    if (!raw) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (!isAdminAuth(auth) && !deps.canAccessTrip(auth, raw)) {
      return res.status(403).json({ error: 'غير مصرح لك بالاطلاع على بيانات هذه الرحلة' });
    }
    const hydrated = hydrateTripRow(tripId, auth.role, auth.id);
    res.json({ trip: hydrated });
  });

  // =========================================================================
  // 6. ADMIN RIDES MANAGEMENT APIS (/api/admin/rides/*)
  // =========================================================================
  const requireAdminRides = [requireAuth, requireRole(...ALL_ADMIN_ROLES)];

  app.get('/api/admin/rides/dashboard', ...requireAdminRides, (_req: Request, res: Response) => {
    const todayTrips = (db.prepare("SELECT COUNT(*) as c FROM trips WHERE date(created_at) = date('now')").get() as { c: number }).c;
    const activeTrips = (db.prepare("SELECT COUNT(*) as c FROM trips WHERE status IN ('searching','offered','accepted','captain_accepted','arrived','captain_arrived','in_progress')").get() as { c: number }).c;
    const completedTrips = (db.prepare("SELECT COUNT(*) as c FROM trips WHERE status = 'completed'").get() as { c: number }).c;
    const cancelledTrips = (db.prepare("SELECT COUNT(*) as c FROM trips WHERE status IN ('cancelled','no_driver','expired')").get() as { c: number }).c;
    const onlineDrivers = (db.prepare("SELECT COUNT(*) as c FROM captains WHERE verification_status = 'approved' AND availability_status IN ('available','busy')").get() as { c: number }).c;
    const offlineDrivers = (db.prepare("SELECT COUNT(*) as c FROM captains WHERE verification_status = 'approved' AND availability_status = 'offline'").get() as { c: number }).c;
    const pendingDrivers = (db.prepare("SELECT COUNT(*) as c FROM captains WHERE verification_status IN ('under_review','pending')").get() as { c: number }).c;
    const fin = db
      .prepare(`
        SELECT
          COALESCE(SUM(final_fare), 0) as total_gmv,
          COALESCE(SUM(commission_amount), 0) as total_commissions,
          COALESCE(SUM(driver_net_earnings), 0) as total_driver_net
        FROM trips
        WHERE status = 'completed'
      `)
      .get() as Record<string, number>;
    const avgRatingRow = db
      .prepare("SELECT AVG(rating_avg) as avg_r FROM captains WHERE verification_status = 'approved'")
      .get() as { avg_r?: number };
    const openDisputes = (db.prepare("SELECT COUNT(*) as c FROM ride_disputes WHERE status IN ('open','in_review')").get() as { c: number }).c;

    res.json({
      trips_today: todayTrips,
      active_trips: activeTrips,
      completed_trips: completedTrips,
      cancelled_trips: cancelledTrips,
      online_drivers: onlineDrivers,
      offline_drivers: offlineDrivers,
      pending_drivers: pendingDrivers,
      total_rides_gmv: Number(Number(fin?.total_gmv || 0).toFixed(2)),
      platform_commissions: Number(Number(fin?.total_commissions || 0).toFixed(2)),
      driver_payables: Number(Number(fin?.total_driver_net || 0).toFixed(2)),
      avg_driver_rating: Number(Number(avgRatingRow?.avg_r || 5).toFixed(2)),
      open_disputes: openDisputes,
    });
  });

  app.get('/api/admin/rides/live-map', ...requireAdminRides, (_req: Request, res: Response) => {
    const drivers = db
      .prepare(`
        SELECT c.id, c.full_name, c.phone, c.vehicle_type, c.vehicle_brand, c.vehicle_model, c.vehicle_color,
               c.plate_number, c.verification_status, c.availability_status, c.rating_avg,
               c.lat, c.lng, c.location_updated_at, c.completed_count,
               (SELECT t.id FROM trips t WHERE t.captain_id = c.id AND t.status IN ('accepted','captain_accepted','arrived','captain_arrived','in_progress') LIMIT 1) as active_trip_id,
               (SELECT t.trip_number FROM trips t WHERE t.captain_id = c.id AND t.status IN ('accepted','captain_accepted','arrived','captain_arrived','in_progress') LIMIT 1) as active_trip_number
        FROM captains c
        WHERE c.verification_status = 'approved'
        ORDER BY CASE WHEN c.availability_status = 'busy' THEN 0 WHEN c.availability_status = 'available' THEN 1 ELSE 2 END
      `)
      .all();

    const activeTripsRaw = db
      .prepare(`
        SELECT id FROM trips
        WHERE status IN ('searching','offered','accepted','captain_accepted','arrived','captain_arrived','in_progress')
        ORDER BY created_at DESC LIMIT 60
      `)
      .all() as Array<{ id: string }>;

    const activeTrips = activeTripsRaw
      .map((r) => hydrateTripRow(r.id, 'super_admin', 'admin'))
      .filter(Boolean);

    res.json({
      drivers,
      active_trips: activeTrips,
      map_config: getMapPublicConfig(),
    });
  });

  app.get('/api/admin/rides/trips', ...requireAdminRides, (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const vehicleType = String(req.query.vehicle_type || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));

    const where: string[] = [];
    const params: unknown[] = [];
    if (status && status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (vehicleType && vehicleType !== 'all') {
      where.push('t.vehicle_type = ?');
      params.push(vehicleType);
    }
    if (dateFrom) {
      where.push('date(t.created_at) >= date(?)');
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push('date(t.created_at) <= date(?)');
      params.push(dateTo);
    }
    if (q) {
      const like = `%${q}%`;
      where.push('(t.trip_number LIKE ? OR t.customer_name LIKE ? OR t.customer_phone LIKE ? OR COALESCE(t.captain_name, \'\') LIKE ? OR t.pickup_address LIKE ? OR t.dropoff_address LIKE ?)');
      params.push(like, like, like, like, like, like);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const ids = db
      .prepare(`SELECT t.id FROM trips t ${whereSql} ORDER BY t.created_at DESC LIMIT ?`)
      .all(...params, limit) as Array<{ id: string }>;

    const trips = ids.map((r) => hydrateTripRow(r.id, 'super_admin', 'admin')).filter(Boolean);
    res.json({ trips, total: trips.length });
  });

  // Vehicle Types Management
  app.get('/api/admin/rides/vehicle-types', ...requireAdminRides, (_req: Request, res: Response) => {
    const rows = db.prepare('SELECT * FROM ride_vehicle_types ORDER BY sort_order ASC').all() as Array<Record<string, any>>;
    res.json({
      vehicle_types: rows.map((r) => ({
        ...r,
        is_active: Number(r.is_active) === 1,
        required_docs: (() => {
          try {
            return JSON.parse(String(r.required_docs_json || '[]'));
          } catch {
            return [];
          }
        })(),
        available_zones: (() => {
          try {
            return JSON.parse(String(r.available_zones_json || '["all"]'));
          } catch {
            return ['all'];
          }
        })(),
      })),
    });
  });

  app.post('/api/admin/rides/vehicle-types', ...requireAdminRides, requirePermission('pricing.manage', 'services.manage'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const code = String(req.body?.code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const nameAr = String(req.body?.name_ar || '').trim();
    const nameEn = String(req.body?.name_en || code).trim();
    if (!code || !nameAr) {
      return res.status(400).json({ error: 'يرجى إدخال رمز المركبة واسمها بالعربية' });
    }
    const maxPassengers = Math.max(1, Math.min(20, Number(req.body?.max_passengers || 4)));
    const requiredDocs = Array.isArray(req.body?.required_docs) ? req.body.required_docs : [];
    const availableZones = Array.isArray(req.body?.available_zones) && req.body.available_zones.length > 0 ? req.body.available_zones : ['all'];
    const routingProfile = String(req.body?.routing_profile || 'car');

    db.prepare(`
      INSERT INTO ride_vehicle_types
        (code, name_ar, name_en, description_ar, icon_key, image_url, max_passengers, required_docs_json, routing_profile, is_active, available_zones_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 10)
    `).run(
      code,
      nameAr,
      nameEn,
      String(req.body?.description_ar || ''),
      String(req.body?.icon_key || 'car'),
      String(req.body?.image_url || ''),
      maxPassengers,
      JSON.stringify(requiredDocs),
      routingProfile,
      JSON.stringify(availableZones)
    );

    db.prepare(`
      INSERT OR IGNORE INTO ride_fare_settings
        (id, vehicle_type, base_fare, per_km_rate, per_min_rate, min_fare, commission_rate, updated_by)
      VALUES (?, ?, 15, 5, 0.75, 25, 15, ?)
    `).run(`rfs_${code}`, code, auth.fullName);

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_VEHICLE_TYPE_CREATED',
      entity_type: 'ride_vehicle_types',
      entity_id: code,
      details: `إضافة فئة مركبة جديدة: ${nameAr} (${code})`,
    });

    res.status(201).json({ ok: true, code });
  });

  app.patch('/api/admin/rides/vehicle-types/:code', ...requireAdminRides, requirePermission('pricing.manage', 'services.manage'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const code = String(req.params.code);
    const existing = db.prepare('SELECT * FROM ride_vehicle_types WHERE code = ?').get(code) as Record<string, any> | undefined;
    if (!existing) return res.status(404).json({ error: 'نوع المركبة غير موجود' });

    const nextNameAr = req.body?.name_ar !== undefined ? String(req.body.name_ar).trim() : existing.name_ar;
    const nextNameEn = req.body?.name_en !== undefined ? String(req.body.name_en).trim() : existing.name_en;
    const nextDesc = req.body?.description_ar !== undefined ? String(req.body.description_ar).trim() : existing.description_ar;
    const nextMaxPass = req.body?.max_passengers !== undefined ? Math.max(1, Number(req.body.max_passengers)) : existing.max_passengers;
    const nextActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
    const nextDocs = Array.isArray(req.body?.required_docs) ? JSON.stringify(req.body.required_docs) : existing.required_docs_json;
    const nextZones = Array.isArray(req.body?.available_zones) ? JSON.stringify(req.body.available_zones) : existing.available_zones_json;
    const nextProfile = req.body?.routing_profile !== undefined ? String(req.body.routing_profile) : existing.routing_profile;

    db.prepare(`
      UPDATE ride_vehicle_types
      SET name_ar = ?, name_en = ?, description_ar = ?, max_passengers = ?, is_active = ?,
          required_docs_json = ?, available_zones_json = ?, routing_profile = ?, updated_at = datetime('now')
      WHERE code = ?
    `).run(nextNameAr, nextNameEn, nextDesc, nextMaxPass, nextActive, nextDocs, nextZones, nextProfile, code);

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_VEHICLE_TYPE_UPDATED',
      entity_type: 'ride_vehicle_types',
      entity_id: code,
      details: `تعديل فئة المركبة ${nextNameAr} (${code}) — الحالة: ${nextActive ? 'مفعل' : 'موقوف'}`,
    });

    res.json({ ok: true });
  });

  // Per-Vehicle Fare Settings + Immutable History Audit
  app.get('/api/admin/rides/fare-settings', ...requireAdminRides, (_req: Request, res: Response) => {
    const settings = db
      .prepare(`
        SELECT rfs.*, vt.name_ar, vt.name_en, vt.max_passengers, vt.routing_profile, vt.is_active as vehicle_active
        FROM ride_fare_settings rfs
        JOIN ride_vehicle_types vt ON vt.code = rfs.vehicle_type
        ORDER BY vt.sort_order ASC
      `)
      .all();
    const history = db.prepare('SELECT * FROM ride_fare_history ORDER BY created_at DESC LIMIT 40').all();
    res.json({ settings, history });
  });

  app.put('/api/admin/rides/fare-settings/:vehicleType', ...requireAdminRides, requirePermission('pricing.manage'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const vehicleType = String(req.params.vehicleType);
    const existing = db.prepare('SELECT * FROM ride_fare_settings WHERE vehicle_type = ?').get(vehicleType) as Record<string, any> | undefined;
    if (!existing) return res.status(404).json({ error: 'إعدادات تسعير هذه المركبة غير موجودة' });

    const next = {
      base_fare: Math.max(0, Number(req.body?.base_fare ?? existing.base_fare)),
      per_km_rate: Math.max(0, Number(req.body?.per_km_rate ?? existing.per_km_rate)),
      per_min_rate: Math.max(0, Number(req.body?.per_min_rate ?? existing.per_min_rate)),
      min_fare: Math.max(0, Number(req.body?.min_fare ?? existing.min_fare)),
      waiting_grace_min: Math.max(0, Math.round(Number(req.body?.waiting_grace_min ?? existing.waiting_grace_min))),
      waiting_per_min_rate: Math.max(0, Number(req.body?.waiting_per_min_rate ?? existing.waiting_per_min_rate)),
      cancellation_fee: Math.max(0, Number(req.body?.cancellation_fee ?? existing.cancellation_fee)),
      commission_rate: Math.min(100, Math.max(0, Number(req.body?.commission_rate ?? existing.commission_rate))),
      tax_rate: Math.min(50, Math.max(0, Number(req.body?.tax_rate ?? existing.tax_rate))),
      extra_fee: Math.max(0, Number(req.body?.extra_fee ?? existing.extra_fee)),
      extra_fee_label_ar: String(req.body?.extra_fee_label_ar ?? existing.extra_fee_label_ar ?? ''),
      peak_multiplier: Math.max(1, Number(req.body?.peak_multiplier ?? existing.peak_multiplier)),
      is_active: req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : Number(existing.is_active),
    };
    const reason = String(req.body?.reason || 'تحديث تعريفة من لوحة الإدارة').trim();

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE ride_fare_settings
        SET base_fare = ?, per_km_rate = ?, per_min_rate = ?, min_fare = ?,
            waiting_grace_min = ?, waiting_per_min_rate = ?, cancellation_fee = ?,
            commission_rate = ?, tax_rate = ?, extra_fee = ?, extra_fee_label_ar = ?,
            peak_multiplier = ?, is_active = ?, updated_by = ?, updated_at = datetime('now')
        WHERE vehicle_type = ?
      `).run(
        next.base_fare,
        next.per_km_rate,
        next.per_min_rate,
        next.min_fare,
        next.waiting_grace_min,
        next.waiting_per_min_rate,
        next.cancellation_fee,
        next.commission_rate,
        next.tax_rate,
        next.extra_fee,
        next.extra_fee_label_ar,
        next.peak_multiplier,
        next.is_active,
        auth.fullName,
        vehicleType
      );

      db.prepare(`
        INSERT INTO ride_fare_history
          (id, vehicle_type, previous_json, new_json, changed_by_id, changed_by_name, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uid('rfh'), vehicleType, JSON.stringify(existing), JSON.stringify(next), auth.id, auth.fullName, reason);
    });
    tx();

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_FARE_UPDATED',
      entity_type: 'ride_fare_settings',
      entity_id: vehicleType,
      reason,
      details: `تعديل تسعير (${vehicleType}): بداية ${next.base_fare}، كم ${next.per_km_rate}، دقيقة ${next.per_min_rate}، حد أدنى ${next.min_fare}، عمولة ${next.commission_rate}%`,
    });

    res.json({ ok: true, settings: db.prepare('SELECT * FROM ride_fare_settings WHERE vehicle_type = ?').get(vehicleType) });
  });

  // Central Dispatch Engine Configuration
  app.get('/api/admin/rides/dispatch-config', ...requireAdminRides, (_req: Request, res: Response) => {
    res.json({ config: getDispatchConfigRow() });
  });

  app.put('/api/admin/rides/dispatch-config', ...requireAdminRides, requirePermission('dispatch.manage', 'pricing.manage'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const cur = getDispatchConfigRow();
    const next = {
      auto_dispatch_enabled: req.body?.auto_dispatch_enabled !== undefined ? (req.body.auto_dispatch_enabled ? 1 : 0) : (cur.auto_dispatch_enabled ? 1 : 0),
      offer_timeout_sec: Math.max(5, Math.min(180, Math.round(Number(req.body?.offer_timeout_sec ?? cur.offer_timeout_sec)))),
      initial_radius_km: Math.max(0.5, Number(req.body?.initial_radius_km ?? cur.initial_radius_km)),
      radius_step_km: Math.max(0.5, Number(req.body?.radius_step_km ?? cur.radius_step_km)),
      max_radius_km: Math.max(1, Number(req.body?.max_radius_km ?? cur.max_radius_km)),
      max_dispatch_attempts: Math.max(1, Math.min(30, Math.round(Number(req.body?.max_dispatch_attempts ?? cur.max_dispatch_attempts)))),
      priority_mode: ['nearest', 'balanced', 'highest_rated'].includes(String(req.body?.priority_mode))
        ? String(req.body.priority_mode)
        : cur.priority_mode,
    };

    db.prepare(`
      UPDATE dispatch_config
      SET auto_dispatch_enabled = ?,
          offer_timeout_sec = ?,
          initial_radius_km = ?,
          radius_step_km = ?,
          max_radius_km = ?,
          max_dispatch_attempts = ?,
          priority_mode = ?,
          updated_at = datetime('now')
      WHERE id = 'default'
    `).run(
      next.auto_dispatch_enabled,
      next.offer_timeout_sec,
      next.initial_radius_km,
      next.radius_step_km,
      next.max_radius_km,
      next.max_dispatch_attempts,
      next.priority_mode
    );

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_DISPATCH_CONFIG_UPDATED',
      entity_type: 'dispatch_config',
      entity_id: 'default',
      details: `تحديث إعدادات توزيع المشاوير: مهلة ${next.offer_timeout_sec}ث، نطاق ${next.initial_radius_km}-${next.max_radius_km} كم، خطوة ${next.radius_step_km} كم`,
    });

    res.json({ ok: true, config: getDispatchConfigRow() });
  });

  // Disputes & Complaints Management
  app.get('/api/admin/rides/disputes', ...requireAdminRides, (_req: Request, res: Response) => {
    const disputes = db.prepare('SELECT * FROM ride_disputes ORDER BY created_at DESC LIMIT 100').all();
    res.json({ disputes });
  });

  app.patch('/api/admin/rides/disputes/:id', ...requireAdminRides, requirePermission('complaints.resolve', 'dispatch.manage'), (req: Request, res: Response) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const existing = db.prepare('SELECT * FROM ride_disputes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    const status = ['open', 'in_review', 'resolved', 'rejected'].includes(String(req.body?.status))
      ? String(req.body.status)
      : 'resolved';
    const decision = String(req.body?.admin_decision || '').trim();

    db.prepare(`
      UPDATE ride_disputes
      SET status = ?, admin_decision = ?, resolved_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, decision, auth.fullName, id);

    deps.recordAuditLog({
      actor_name: auth.fullName,
      actor_role: auth.role,
      action: 'RIDE_DISPUTE_UPDATED',
      entity_type: 'ride_disputes',
      entity_id: id,
      details: `تحديث شكوى المشوار إلى (${status}): ${decision}`,
    });

    res.json({ ok: true, dispute: db.prepare('SELECT * FROM ride_disputes WHERE id = ?').get(id) });
  });

  // Financial Reports for Rides
  app.get('/api/admin/rides/reports/financial', ...requireAdminRides, (req: Request, res: Response) => {
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const clauses = ["t.status = 'completed'"];
    const params: unknown[] = [];
    if (dateFrom) {
      clauses.push('date(t.completed_at) >= date(?)');
      params.push(dateFrom);
    }
    if (dateTo) {
      clauses.push('date(t.completed_at) <= date(?)');
      params.push(dateTo);
    }
    const whereSql = `WHERE ${clauses.join(' AND ')}`;

    const totals = db
      .prepare(`
        SELECT
          COUNT(*) as rides_count,
          COALESCE(SUM(t.final_fare), 0) as total_gmv,
          COALESCE(SUM(t.commission_amount), 0) as total_commission,
          COALESCE(SUM(t.driver_net_earnings), 0) as total_driver_net,
          COALESCE(SUM(t.tax_amount), 0) as total_tax,
          COALESCE(SUM(CASE WHEN t.payment_method = 'cash' THEN t.final_fare ELSE 0 END), 0) as cash_total,
          COALESCE(SUM(CASE WHEN t.payment_method = 'online' THEN t.final_fare ELSE 0 END), 0) as online_total
        FROM trips t
        ${whereSql}
      `)
      .get(...params) as Record<string, number>;

    const byVehicle = db
      .prepare(`
        SELECT
          t.vehicle_type,
          COALESCE(vt.name_ar, t.vehicle_type) as vehicle_name_ar,
          COUNT(*) as rides_count,
          COALESCE(SUM(t.final_fare), 0) as total_gmv,
          COALESCE(SUM(t.commission_amount), 0) as total_commission,
          COALESCE(SUM(t.driver_net_earnings), 0) as total_driver_net
        FROM trips t
        LEFT JOIN ride_vehicle_types vt ON vt.code = t.vehicle_type
        ${whereSql}
        GROUP BY t.vehicle_type
      `)
      .all(...params);

    const byDay = db
      .prepare(`
        SELECT
          date(COALESCE(t.completed_at, t.created_at)) as day,
          COUNT(*) as rides_count,
          COALESCE(SUM(t.final_fare), 0) as total_gmv,
          COALESCE(SUM(t.commission_amount), 0) as total_commission
        FROM trips t
        ${whereSql}
        GROUP BY date(COALESCE(t.completed_at, t.created_at))
        ORDER BY day DESC
        LIMIT 30
      `)
      .all(...params);

    const settlements = db
      .prepare("SELECT * FROM settlements WHERE beneficiary_type = 'captain' ORDER BY created_at DESC LIMIT 30")
      .all();

    res.json({
      totals: {
        rides_count: Number(totals?.rides_count || 0),
        total_gmv: Number(Number(totals?.total_gmv || 0).toFixed(2)),
        total_commission: Number(Number(totals?.total_commission || 0).toFixed(2)),
        total_driver_net: Number(Number(totals?.total_driver_net || 0).toFixed(2)),
        total_tax: Number(Number(totals?.total_tax || 0).toFixed(2)),
        cash_total: Number(Number(totals?.cash_total || 0).toFixed(2)),
        online_total: Number(Number(totals?.online_total || 0).toFixed(2)),
      },
      by_vehicle: byVehicle,
      by_day: byDay,
      settlements,
    });
  });

  // Also enforce Rule #1 on captain availability toggle (cannot go online if not approved!)
  app.patch('/api/rides/captain/availability', requireAuth, requireRole('captain', ...ALL_ADMIN_ROLES), (req: Request, res: Response) => {
    const auth = req.auth!;
    const capId = auth.role === 'captain' ? auth.id : String(req.body?.captain_id || '');
    const rawStatus = req.body?.availability_status
      ? String(req.body.availability_status).trim()
      : typeof req.body?.online === 'boolean'
      ? req.body.online
        ? 'available'
        : 'offline'
      : '';
    const status = rawStatus;
    if (!['available', 'offline'].includes(status)) {
      return res.status(400).json({ error: 'حالة الاتصال يجب أن تكون available أو offline' });
    }
    const cap = db.prepare('SELECT * FROM captains WHERE id = ?').get(capId) as Record<string, any> | undefined;
    if (!cap) return res.status(404).json({ error: 'الكابتن غير موجود' });
    if (status === 'available' && cap.verification_status !== 'approved') {
      return res.status(403).json({ error: 'لا يمكنك تفعيل وضع الاتصال لاستقبال الرحلات قبل اعتماد حسابك ومستنداتك من الإدارة' });
    }
    const activeTrip = db
      .prepare("SELECT id FROM trips WHERE captain_id = ? AND status IN ('accepted','captain_accepted','arrived','captain_arrived','in_progress') LIMIT 1")
      .get(capId);
    if (activeTrip && status === 'offline') {
      return res.status(409).json({ error: 'لا يمكن قطع الاتصال أثناء وجود رحلة نشطة' });
    }

    const lat = req.body?.lat !== undefined ? Number(req.body.lat) : null;
    const lng = req.body?.lng !== undefined ? Number(req.body.lng) : null;
    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
      db.prepare("UPDATE captains SET availability_status = ?, lat = ?, lng = ?, location_updated_at = datetime('now') WHERE id = ?").run(status, lat, lng, capId);
    } else {
      db.prepare('UPDATE captains SET availability_status = ? WHERE id = ?').run(status, capId);
    }

    deps.broadcastToRooms(['admin:all', 'rides:all', `captain:${capId}`], {
      type: 'captains:updated',
      captain_id: capId,
      availability_status: status,
    });
    res.json({ ok: true, availability_status: status });
  });
}
