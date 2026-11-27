import { haversineKm } from './engines.ts';

export type RideVehicleClass = 'car' | 'moto' | 'tuktuk' | string;

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface GeoPlaceSuggestion {
  place_id: string;
  display_name: string;
  short_name: string;
  address_line: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: string;
  source: 'local_landmark' | 'otlobha_place' | 'photon' | 'nominatim';
}

export interface RouteStepSummary {
  instruction: string;
  name: string;
  distance_m: number;
  duration_s: number;
}

export interface VehicleRouteResult {
  vehicle_type: string;
  routing_profile: string;
  routing_source: 'osrm_live' | 'osrm_fallback_calibrated';
  distance_km: number;
  duration_min: number;
  route_points: Array<[number, number]>; // [lat, lng]
  steps: RouteStepSummary[];
  warnings: string[];
  attribution: string;
}

export interface VehicleRoutingProfileConfig {
  code: string;
  osrmProfile: string;
  osrmBaseUrlEnvKey: string;
  speedFactor: number; // Applied when using shared OSRM driving server to calibrate moto/tuktuk realistic urban speeds
  maxSpeedKmh: number;
  excludeClasses: string[]; // e.g. ['motorway'] for tuktuk
  roadRestrictionsAr: string;
  roadFactorFallback: number; // Used ONLY if OSRM server is temporarily unreachable
  avgUrbanSpeedKmhFallback: number;
}

const DEFAULT_OSRM_BASE = 'https://router.project-osrm.org';
const DEFAULT_NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const DEFAULT_PHOTON_BASE = 'https://photon.komoot.io';
const DEFAULT_OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export function normalizeArabicText(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface LocalLandmarkEntry {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  category: string;
  aliases: string[];
}

// Curated Al-Manzala & Dakahlia landmarks + surrounding villages/cities to guarantee instant Arabic search coverage
const AL_MANZALA_LANDMARKS: LocalLandmarkEntry[] = [
  { id: 'lm_manzala_center', name: 'وسط مدينة المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1583, lng: 31.9369, category: 'city', aliases: ['المنزلة', 'مدينة المنزلة', 'البلد', 'وسط البلد'] },
  { id: 'lm_manzala_hospital', name: 'مستشفى المنزلة العام', address: 'شارع المستشفى، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1614, lng: 31.9332, category: 'hospital', aliases: ['المستشفى العام', 'مستشفي المنزله', 'مستشفى', 'طوارئ المنزلة'] },
  { id: 'lm_manzala_fever_hosp', name: 'مستشفى حميات المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1631, lng: 31.9308, category: 'hospital', aliases: ['الحميات', 'مستشفى الحميات'] },
  { id: 'lm_manzala_bus_station', name: 'موقف المنزلة الرئيسي', address: 'طريق المنزلة - دكرنس، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1546, lng: 31.9398, category: 'station', aliases: ['الموقف', 'موقف السيارات', 'موقف المنصورة', 'موقف دمياط', 'موقف بورسعيد'] },
  { id: 'lm_manzala_train', name: 'محطة قطار المنزلة', address: 'شارع المحطة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1562, lng: 31.9415, category: 'station', aliases: ['المحطة', 'محطة القطر', 'السكه الحديد', 'ميدان المحطة'] },
  { id: 'lm_manzala_saah', name: 'ميدان الساعة - المنزلة', address: 'وسط المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1589, lng: 31.9364, category: 'square', aliases: ['الساعة', 'ميدان الساعه', 'الميدان'] },
  { id: 'lm_manzala_gomhouria', name: 'شارع الجمهورية - المنزلة', address: 'شارع الجمهورية، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1594, lng: 31.9355, category: 'road', aliases: ['الجمهورية', 'شارع الجمهوريه'] },
  { id: 'lm_manzala_portsaid_st', name: 'شارع بورسعيد - المنزلة', address: 'شارع بورسعيد، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1602, lng: 31.9384, category: 'road', aliases: ['شارع بورسعيد', 'طريق بورسعيد'] },
  { id: 'lm_manzala_tahrir', name: 'شارع التحرير - المنزلة', address: 'شارع التحرير، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1574, lng: 31.9349, category: 'road', aliases: ['التحرير', 'شارع التحرير'] },
  { id: 'lm_manzala_bahr', name: 'شارع البحر - المنزلة', address: 'شارع البحر، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1568, lng: 31.9389, category: 'road', aliases: ['البحر', 'الكورنيش', 'شارع البحر'] },
  { id: 'lm_manzala_court', name: 'محكمة المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1598, lng: 31.9341, category: 'government', aliases: ['المحكمة', 'محكمه المنزله', 'النيابة'] },
  { id: 'lm_manzala_police', name: 'مركز شرطة المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1591, lng: 31.9348, category: 'government', aliases: ['المركز', 'الشرطة', 'قسم الشرطة', 'مركز المنزلة'] },
  { id: 'lm_manzala_council', name: 'مجلس مدينة المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1585, lng: 31.9358, category: 'government', aliases: ['مجلس المدينة', 'رئاسة المركز', 'السجل المدني'] },
  { id: 'lm_manzala_club', name: 'نادي المنزلة الرياضي', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1621, lng: 31.9375, category: 'landmark', aliases: ['النادي', 'نادي المنزله', 'مركز الشباب', 'الاستاد'] },
  { id: 'lm_manzala_market', name: 'سوق المنزلة العمومي', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1577, lng: 31.9373, category: 'market', aliases: ['السوق', 'سوق الخضار', 'سوق السمك', 'السوق الكبير'] },
  { id: 'lm_manzala_bridge', name: 'كوبري المنزلة', address: 'مدخل المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1553, lng: 31.9379, category: 'landmark', aliases: ['الكوبري', 'كوبري البحر', 'الكوبري الجديد'] },
  { id: 'lm_manzala_highschool', name: 'مدرسة المنزلة الثانوية', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1608, lng: 31.9352, category: 'school', aliases: ['الثانوية', 'الثانويه بنين', 'الثانويه بنات', 'المدارس', 'الصنايع', 'التجارة'] },
  { id: 'lm_manzala_azhar', name: 'المعهد الديني الأزهري - المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1605, lng: 31.9367, category: 'school', aliases: ['المعهد الديني', 'المعهد الازهري', 'الازهر'] },
  { id: 'lm_manzala_mosque', name: 'المسجد الكبير - المنزلة', address: 'وسط المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1581, lng: 31.9366, category: 'mosque', aliases: ['الجامع الكبير', 'المسجد الكبير', 'مسجد المحطة'] },
  { id: 'lm_manzala_health_ins', name: 'التأمين الصحي - المنزلة', address: 'المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1610, lng: 31.9339, category: 'hospital', aliases: ['التأمين الصحي', 'التامين', 'عيادة التأمين'] },
  // القرى التابعة لمركز المنزلة
  { id: 'lm_aziza', name: 'العزيزة - مركز المنزلة', address: 'قرية العزيزة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1778, lng: 31.9762, category: 'village', aliases: ['العزيزة', 'العزيزه', 'قريه العزيزه'] },
  { id: 'lm_frousat', name: 'الفروسات - مركز المنزلة', address: 'قرية الفروسات، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1489, lng: 31.9614, category: 'village', aliases: ['الفروسات', 'قريه الفروسات'] },
  { id: 'lm_shoboul', name: 'الشبول - مركز المنزلة', address: 'قرية الشبول، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1864, lng: 31.9185, category: 'village', aliases: ['الشبول', 'قريه الشبول'] },
  { id: 'lm_basrat', name: 'البصراط - مركز المنزلة', address: 'قرية البصراط، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1965, lng: 31.9571, category: 'village', aliases: ['البصراط', 'قريه البصراط'] },
  { id: 'lm_nasayma', name: 'النسايمة - مركز المنزلة', address: 'قرية النسايمة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1682, lng: 31.9998, category: 'village', aliases: ['النسايمة', 'النسايمه', 'قريه النسايمه'] },
  { id: 'lm_houta', name: 'الحوتة - مركز المنزلة', address: 'قرية الحوتة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1326, lng: 31.9189, category: 'village', aliases: ['الحوتة', 'الحوته', 'قريه الحوته'] },
  { id: 'lm_amra', name: 'العامرة - مركز المنزلة', address: 'قرية العامرة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1441, lng: 31.9082, category: 'village', aliases: ['العامرة', 'العامره'] },
  { id: 'lm_awlad_sabour', name: 'أولاد صبور - مركز المنزلة', address: 'أولاد صبور، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1462, lng: 31.9812, category: 'village', aliases: ['اولاد صبور', 'ولاد صبور'] },
  { id: 'lm_mawagid', name: 'المواجد - مركز المنزلة', address: 'قرية المواجد، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1388, lng: 31.9467, category: 'village', aliases: ['المواجد', 'قريه المواجد'] },
  { id: 'lm_khalayfa', name: 'الخلايفة - مركز المنزلة', address: 'قرية الخلايفة، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1745, lng: 31.9261, category: 'village', aliases: ['الخلايفة', 'الخلايفه'] },
  { id: 'lm_awlad_nasser', name: 'أولاد ناصر - مركز المنزلة', address: 'أولاد ناصر، المنزلة، الدقهلية', city: 'المنزلة', lat: 31.1652, lng: 31.9541, category: 'village', aliases: ['اولاد ناصر', 'ولاد ناصر'] },
  { id: 'lm_qibab', name: 'القباب الكبرى - المنزلة', address: 'القباب الكبرى، الدقهلية', city: 'المنزلة', lat: 31.1196, lng: 31.8948, category: 'village', aliases: ['القباب', 'القباب الكبري', 'القباب الصغري'] },
  // المدن المجاورة
  { id: 'lm_gamalia', name: 'الجمالية - الدقهلية', address: 'مدينة الجمالية، الدقهلية', city: 'الجمالية', lat: 31.1806, lng: 31.8647, category: 'city', aliases: ['الجمالية', 'الجماليه'] },
  { id: 'lm_mataria', name: 'المطرية - الدقهلية', address: 'مدينة المطرية، الدقهلية', city: 'المطرية', lat: 31.1829, lng: 32.0311, category: 'city', aliases: ['المطرية', 'المطريه', 'المطرية دقهلية'] },
  { id: 'lm_mit_salsil', name: 'ميت سلسيل - الدقهلية', address: 'مدينة ميت سلسيل، الدقهلية', city: 'ميت سلسيل', lat: 31.1819, lng: 31.8056, category: 'city', aliases: ['ميت سلسيل', 'ميت سلسل'] },
  { id: 'lm_kurdi', name: 'الكردي - الدقهلية', address: 'مدينة الكردي، الدقهلية', city: 'الكردي', lat: 31.1695, lng: 31.7782, category: 'city', aliases: ['الكردي', 'مدينة الكردي'] },
  { id: 'lm_menyat_nasr', name: 'منية النصر - الدقهلية', address: 'مدينة منية النصر، الدقهلية', city: 'منية النصر', lat: 31.1258, lng: 31.6442, category: 'city', aliases: ['منية النصر', 'منيه النصر'] },
  { id: 'lm_dekernes', name: 'دكرنس - الدقهلية', address: 'مدينة دكرنس، الدقهلية', city: 'دكرنس', lat: 31.0889, lng: 31.5947, category: 'city', aliases: ['دكرنس'] },
  { id: 'lm_mansoura', name: 'المنصورة - الدقهلية', address: 'مدينة المنصورة، الدقهلية', city: 'المنصورة', lat: 31.0409, lng: 31.3785, category: 'city', aliases: ['المنصورة', 'المنصوره', 'جامعة المنصورة'] },
  { id: 'lm_damietta', name: 'دمياط', address: 'مدينة دمياط، محافظة دمياط', city: 'دمياط', lat: 31.4175, lng: 31.8144, category: 'city', aliases: ['دمياط', 'دمياط الجديدة', 'راس البر'] },
  { id: 'lm_portsaid', name: 'بورسعيد', address: 'مدينة بورسعيد', city: 'بورسعيد', lat: 31.2653, lng: 32.3019, category: 'city', aliases: ['بورسعيد', 'بور سعيد'] },
];

const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function sanitizeServiceBaseUrl(rawUrl: string | undefined, fallback: string, allowPrivateEnvHost = true): string {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    if (!allowPrivateEnvHost) {
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
        return fallback;
      }
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

export const VEHICLE_ROUTING_PROFILES: Record<string, VehicleRoutingProfileConfig> = {
  car: {
    code: 'car',
    osrmProfile: 'driving',
    osrmBaseUrlEnvKey: 'OSRM_CAR_URL',
    speedFactor: 1.0,
    maxSpeedKmh: 100,
    excludeClasses: [],
    roadRestrictionsAr: 'طرق رئيسية وسريعة وشوارع سيارات معتمدة',
    roadFactorFallback: 1.28,
    avgUrbanSpeedKmhFallback: 34,
  },
  moto: {
    code: 'moto',
    osrmProfile: 'driving',
    osrmBaseUrlEnvKey: 'OSRM_MOTO_URL',
    speedFactor: 0.86, // Motorcycles navigate urban traffic faster than cars on congested city arteries
    maxSpeedKmh: 75,
    excludeClasses: [],
    roadRestrictionsAr: 'شوارع حضرية وطرق فرعية ملائمة للموتوسيكلات (مع تجنب طرق المشاة)',
    roadFactorFallback: 1.22,
    avgUrbanSpeedKmhFallback: 38,
  },
  tuktuk: {
    code: 'tuktuk',
    osrmProfile: 'driving',
    osrmBaseUrlEnvKey: 'OSRM_TUKTUK_URL',
    speedFactor: 1.38, // Tuk-tuk max realistic operating speed is ~28-35 km/h on local roads
    maxSpeedKmh: 35,
    excludeClasses: ['motorway'],
    roadRestrictionsAr: 'شوارع داخلية وأحياء سكنية فقط — يُمنع السير على الطرق السريعة والمحاور الرئيسية',
    roadFactorFallback: 1.32,
    avgUrbanSpeedKmhFallback: 22,
  },
};

export function getVehicleRoutingProfile(vehicleType: string): VehicleRoutingProfileConfig {
  const key = String(vehicleType || 'car').trim().toLowerCase();
  return VEHICLE_ROUTING_PROFILES[key] || VEHICLE_ROUTING_PROFILES.car;
}

export function getMapPublicConfig() {
  const tileUrl = sanitizeServiceBaseUrl(process.env.OSM_TILE_URL, DEFAULT_OSM_TILE_URL, true);
  const nominatimConfigured = Boolean(String(process.env.NOMINATIM_BASE_URL || '').trim());
  const osrmDedicatedConfigured = Boolean(
    String(process.env.OSRM_CAR_URL || process.env.OSRM_MOTO_URL || process.env.OSRM_TUKTUK_URL || '').trim()
  );

  return {
    provider: 'openstreetmap',
    tile_url: process.env.OSM_TILE_URL?.trim() || tileUrl,
    attribution: OSM_ATTRIBUTION,
    attribution_ar: 'بيانات الخرائط © مساهمو OpenStreetMap',
    default_center: { lat: 31.1583, lng: 31.9369 },
    supported_profiles: Object.values(VEHICLE_ROUTING_PROFILES).map((p) => ({
      code: p.code,
      max_speed_kmh: p.maxSpeedKmh,
      exclude_classes: p.excludeClasses,
      road_restrictions_ar: p.roadRestrictionsAr,
    })),
    self_hosted_ready: true,
    using_private_nominatim: nominatimConfigured,
    using_dedicated_osrm: osrmDedicatedConfigured,
  };
}

// Simple bounded TTL cache to respect Nominatim/OSRM usage policies & keep latency crisp
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const routeCache = new Map<string, CacheEntry<VehicleRouteResult>>();
const geocodeCache = new Map<string, CacheEntry<GeoPlaceSuggestion[]>>();
const reverseCache = new Map<string, CacheEntry<{ display_name: string; short_name: string; city: string; country: string }>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number, maxEntries = 300) {
  if (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getNominatimBaseUrl(): string {
  return sanitizeServiceBaseUrl(process.env.NOMINATIM_BASE_URL, DEFAULT_NOMINATIM_BASE, true);
}

function getNominatimUserAgent(): string {
  return String(process.env.NOMINATIM_USER_AGENT || 'OtlobhaRides/2.0 (support@otlobha.eg)').trim();
}

function getOsrmBaseForVehicle(profile: VehicleRoutingProfileConfig): { baseUrl: string; dedicated: boolean } {
  const dedicatedUrl = String(process.env[profile.osrmBaseUrlEnvKey] || '').trim();
  if (dedicatedUrl) {
    return {
      baseUrl: sanitizeServiceBaseUrl(dedicatedUrl, DEFAULT_OSRM_BASE, true),
      dedicated: true,
    };
  }
  return {
    baseUrl: sanitizeServiceBaseUrl(process.env.OSRM_BASE_URL, DEFAULT_OSRM_BASE, true),
    dedicated: false,
  };
}

async function fetchJsonWithTimeout<T>(url: string, headers: Record<string, string>, timeoutMs = 6500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function matchLocalLandmarks(
  query: string,
  extraLocalPlaces: GeoPlaceSuggestion[] = [],
  nearLat?: number,
  nearLng?: number
): Array<{ item: GeoPlaceSuggestion; score: number }> {
  const normQ = normalizeArabicText(query);
  if (normQ.length < 2) return [];
  const tokens = normQ.split(' ').filter((t) => t.length >= 2);
  const scored: Array<{ item: GeoPlaceSuggestion; score: number }> = [];

  const scoreCandidate = (haystackParts: string[], lat: number, lng: number): number => {
    const joined = normalizeArabicText(haystackParts.join(' '));
    if (!joined) return 0;
    let score = 0;
    if (joined === normQ) score = 100;
    else if (joined.startsWith(normQ)) score = 90;
    else if (joined.includes(normQ)) score = 78;
    else if (tokens.length > 0) {
      const matched = tokens.filter((t) => joined.includes(t)).length;
      if (matched === tokens.length) score = 70;
      else if (matched > 0 && matched >= Math.ceil(tokens.length * 0.6)) score = 52;
    }
    if (score > 0 && Number.isFinite(nearLat) && Number.isFinite(nearLng)) {
      const d = haversineKm(Number(nearLat), Number(nearLng), lat, lng);
      if (d <= 25) score += 8;
      else if (d <= 80) score += 3;
    }
    return score;
  };

  for (const lm of AL_MANZALA_LANDMARKS) {
    const s = scoreCandidate([lm.name, lm.address, lm.city, ...lm.aliases], lm.lat, lm.lng);
    if (s > 0) {
      scored.push({
        score: s,
        item: {
          place_id: lm.id,
          display_name: `${lm.name}، ${lm.address}`,
          short_name: lm.name,
          address_line: lm.address,
          city: lm.city,
          country: 'مصر',
          lat: lm.lat,
          lng: lm.lng,
          category: lm.category,
          source: 'local_landmark',
        },
      });
    }
  }

  for (const extra of extraLocalPlaces) {
    const s = scoreCandidate([extra.short_name, extra.display_name, extra.address_line, extra.city], extra.lat, extra.lng);
    if (s > 0) {
      scored.push({ score: s + 4, item: extra });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

export function findBestLocalPlaceMatch(
  query: string,
  extraLocalPlaces: GeoPlaceSuggestion[] = [],
  nearLat?: number,
  nearLng?: number
): GeoPlaceSuggestion | null {
  const matches = matchLocalLandmarks(query, extraLocalPlaces, nearLat, nearLng);
  if (matches.length > 0 && matches[0].score >= 82) {
    return matches[0].item;
  }
  return null;
}

async function fetchNominatimBatch(
  q: string,
  limit: number,
  nearLat?: number,
  nearLng?: number,
  countryCodes?: string
): Promise<GeoPlaceSuggestion[]> {
  const base = getNominatimBaseUrl();
  const qs = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    'accept-language': 'ar,en',
  });
  if (countryCodes) {
    qs.set('countrycodes', countryCodes);
  }
  if (Number.isFinite(nearLat) && Number.isFinite(nearLng)) {
    const lat = Number(nearLat);
    const lng = Number(nearLng);
    const delta = 0.55;
    qs.set('viewbox', `${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)},${(lat - delta).toFixed(4)}`);
  }

  try {
    const rows = await fetchJsonWithTimeout<Array<Record<string, any>>>(
      `${base}/search?${qs.toString()}`,
      {
        Accept: 'application/json',
        'User-Agent': getNominatimUserAgent(),
      },
      5500
    );

    return (Array.isArray(rows) ? rows : [])
      .map((item): GeoPlaceSuggestion | null => {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const addr = (item.address || {}) as Record<string, string>;
        const shortName =
          String(item.name || '').trim() ||
          addr.road ||
          addr.neighbourhood ||
          addr.suburb ||
          String(item.display_name || '').split(',')[0]?.trim() ||
          q;
        const city = addr.city || addr.town || addr.village || addr.state || '';
        const country = addr.country || '';
        const addressParts = [addr.road, addr.suburb || addr.neighbourhood, city].filter(Boolean);
        return {
          place_id: `nom_${String(item.place_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`)}`,
          display_name: String(item.display_name || shortName),
          short_name: shortName,
          address_line: addressParts.length > 0 ? addressParts.join('، ') : String(item.display_name || shortName),
          city,
          country,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          category: String(item.category || item.type || 'place'),
          source: 'nominatim' as const,
        };
      })
      .filter((x): x is GeoPlaceSuggestion => x !== null);
  } catch (err) {
    console.warn('[GeoService] Nominatim search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function fetchPhotonBatch(
  q: string,
  limit: number,
  nearLat?: number,
  nearLng?: number
): Promise<GeoPlaceSuggestion[]> {
  const base = sanitizeServiceBaseUrl(process.env.PHOTON_BASE_URL, DEFAULT_PHOTON_BASE, true);
  const qs = new URLSearchParams({
    q,
    limit: String(limit),
  });
  if (Number.isFinite(nearLat) && Number.isFinite(nearLng)) {
    qs.set('lat', Number(nearLat).toFixed(5));
    qs.set('lon', Number(nearLng).toFixed(5));
  }

  try {
    const data = await fetchJsonWithTimeout<{ features?: Array<Record<string, any>> }>(
      `${base}/api/?${qs.toString()}`,
      {
        Accept: 'application/json',
        'User-Agent': getNominatimUserAgent(),
      },
      4500
    );
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((f, idx): GeoPlaceSuggestion | null => {
        const coords = f?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const p = (f.properties || {}) as Record<string, any>;
        const shortName = String(p.name || p.street || p.district || p.city || q).trim();
        const city = String(p.city || p.town || p.county || p.state || '').trim();
        const country = String(p.country || '').trim();
        const parts = [p.name, p.street, p.district, city, country].filter((x) => typeof x === 'string' && x.trim().length > 0);
        const displayName = parts.length > 0 ? Array.from(new Set(parts)).join('، ') : shortName;
        return {
          place_id: `ph_${String(p.osm_id || idx)}_${lat.toFixed(4)}_${lng.toFixed(4)}`,
          display_name: displayName,
          short_name: shortName,
          address_line: [p.street, p.district, city].filter(Boolean).join('، ') || displayName,
          city,
          country,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          category: String(p.osm_value || p.osm_key || 'place'),
          source: 'photon' as const,
        };
      })
      .filter((x): x is GeoPlaceSuggestion => x !== null);
  } catch (err) {
    console.warn('[GeoService] Photon search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function searchPlaces(params: {
  query: string;
  nearLat?: number;
  nearLng?: number;
  countryCodes?: string;
  limit?: number;
  extraLocalPlaces?: GeoPlaceSuggestion[];
}): Promise<GeoPlaceSuggestion[]> {
  const q = String(params.query || '').trim();
  if (q.length < 2) return [];
  const limit = Math.min(12, Math.max(1, params.limit ?? 10));
  const nearLat = Number.isFinite(params.nearLat) ? Number(params.nearLat) : undefined;
  const nearLng = Number.isFinite(params.nearLng) ? Number(params.nearLng) : undefined;

  // Layer 1: Instant curated Al-Manzala / Dakahlia landmarks + Otlobha DB places
  const localMatches = matchLocalLandmarks(q, params.extraLocalPlaces || [], nearLat, nearLng).map((m) => m.item);

  const nearKey = nearLat !== undefined && nearLng !== undefined ? `${nearLat.toFixed(2)},${nearLng.toFixed(2)}` : 'global';
  const cacheKey = `${q.toLowerCase()}|${nearKey}|${params.countryCodes || ''}|${limit}`;
  let remoteResults = getCached(geocodeCache, cacheKey);

  if (!remoteResults) {
    const isNearEgypt =
      nearLat !== undefined && nearLng !== undefined && nearLat >= 22 && nearLat <= 32.5 && nearLng >= 24 && nearLng <= 37;
    const isNearManzala =
      nearLat !== undefined && nearLng !== undefined && haversineKm(nearLat, nearLng, 31.1583, 31.9369) <= 45;
    const normQ = normalizeArabicText(q);
    const alreadyHasCity =
      normQ.includes('المنزله') ||
      normQ.includes('الدقهليه') ||
      normQ.includes('مصر') ||
      normQ.includes('الرياض') ||
      normQ.includes('القاهره') ||
      normQ.includes('المنصوره') ||
      normQ.includes('دمياط') ||
      normQ.includes('بورسعيد');

    const tasks: Array<Promise<GeoPlaceSuggestion[]>> = [
      fetchNominatimBatch(q, limit, nearLat, nearLng, params.countryCodes),
      fetchPhotonBatch(q, limit, nearLat, nearLng),
    ];

    // Boost Al-Manzala / Egypt local street & POI hits on Nominatim when user searches short Arabic names
    if (isNearManzala && !alreadyHasCity) {
      tasks.push(fetchNominatimBatch(`${q} المنزلة الدقهلية`, 6, nearLat, nearLng, 'eg'));
    } else if (isNearEgypt && !alreadyHasCity && !params.countryCodes) {
      tasks.push(fetchNominatimBatch(`${q} مصر`, 5, nearLat, nearLng, 'eg'));
    }

    const batches = await Promise.all(tasks);
    remoteResults = batches.flat();
    setCached(geocodeCache, cacheKey, remoteResults, 10 * 60 * 1000);
  }

  // Merge & deduplicate nearby entries, prioritizing local landmarks/stores and closest OSM results
  const combined: GeoPlaceSuggestion[] = [...localMatches];
  const sortedRemote = [...remoteResults].sort((a, b) => {
    if (nearLat !== undefined && nearLng !== undefined) {
      const da = haversineKm(nearLat, nearLng, a.lat, a.lng);
      const db = haversineKm(nearLat, nearLng, b.lat, b.lng);
      return da - db;
    }
    return 0;
  });
  combined.push(...sortedRemote);

  const deduped: GeoPlaceSuggestion[] = [];
  for (const item of combined) {
    const normName = normalizeArabicText(item.short_name);
    const isDup = deduped.some((existing) => {
      const sameCoords = haversineKm(existing.lat, existing.lng, item.lat, item.lng) < 0.08;
      const sameName = normalizeArabicText(existing.short_name) === normName;
      return sameCoords && sameName;
    });
    if (!isDup) {
      deduped.push(item);
      if (deduped.length >= limit) break;
    }
  }

  return deduped;
}

export async function reverseGeocode(lat: number, lng: number): Promise<{
  display_name: string;
  short_name: string;
  city: string;
  country: string;
  attribution: string;
}> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = getCached(reverseCache, key);
  if (cached) return { ...cached, attribution: OSM_ATTRIBUTION };

  const base = getNominatimBaseUrl();
  const qs = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    format: 'jsonv2',
    addressdetails: '1',
    'accept-language': 'ar,en',
  });

  try {
    const item = await fetchJsonWithTimeout<Record<string, any>>(
      `${base}/reverse?${qs.toString()}`,
      {
        Accept: 'application/json',
        'User-Agent': getNominatimUserAgent(),
      },
      5500
    );
    const addr = (item?.address || {}) as Record<string, string>;
    const city = addr.city || addr.town || addr.village || addr.state || '';
    const country = addr.country || '';
    const shortName =
      String(item?.name || '').trim() ||
      [addr.road, addr.suburb || addr.neighbourhood].filter(Boolean).join('، ') ||
      city ||
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const result = {
      display_name: String(item?.display_name || shortName),
      short_name: shortName,
      city,
      country,
    };
    setCached(reverseCache, key, result, 15 * 60 * 1000);
    return { ...result, attribution: OSM_ATTRIBUTION };
  } catch {
    return {
      display_name: `الموقع المحدد (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
      short_name: `موقع (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      city: '',
      country: '',
      attribution: OSM_ATTRIBUTION,
    };
  }
}

function buildInstructionAr(maneuver: Record<string, any> | undefined, streetName: string): string {
  const type = String(maneuver?.type || '');
  const modifier = String(maneuver?.modifier || '');
  const road = streetName ? ` على ${streetName}` : '';
  if (type === 'depart') return `انطلق${road}`;
  if (type === 'arrive') return 'الوصول إلى الوجهة';
  if (type === 'roundabout' || type === 'rotary') return `ادخل الدوار ثم تابع${road}`;
  if (modifier.includes('right')) return `انعطف يميناً${road}`;
  if (modifier.includes('left')) return `انعطف يساراً${road}`;
  if (modifier === 'uturn') return `استدر للخلف${road}`;
  return `تابع السير مباشرة${road}`;
}

export async function calculateRoadRoute(params: {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  waypoints?: GeoPoint[];
  vehicleType?: RideVehicleClass;
}): Promise<VehicleRouteResult> {
  const profile = getVehicleRoutingProfile(params.vehicleType || 'car');
  const points: GeoPoint[] = [
    params.pickup,
    ...(params.waypoints || []).filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng)),
    params.dropoff,
  ];

  const coordKey = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const cacheKey = `${profile.code}|${coordKey}`;
  const cached = getCached(routeCache, cacheKey);
  if (cached) return cached;

  const { baseUrl, dedicated } = getOsrmBaseForVehicle(profile);
  const osrmCoords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const qs = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
  });
  // For tuk-tuk on dedicated OSRM instances supporting motorway exclusion
  if (dedicated && profile.excludeClasses.length > 0) {
    qs.set('exclude', profile.excludeClasses.join(','));
  }

  const warnings: string[] = [];
  if (profile.code === 'tuktuk') {
    warnings.push(profile.roadRestrictionsAr);
  }

  const url = `${baseUrl}/route/v1/${encodeURIComponent(profile.osrmProfile)}/${osrmCoords}?${qs.toString()}`;

  try {
    const data = await fetchJsonWithTimeout<Record<string, any>>(
      url,
      {
        Accept: 'application/json',
        'User-Agent': getNominatimUserAgent(),
      },
      7500
    );

    const route = Array.isArray(data?.routes) ? data.routes[0] : null;
    if (data?.code === 'Ok' && route && Number.isFinite(Number(route.distance))) {
      const rawDistanceKm = Math.max(0.2, Number(route.distance) / 1000);
      const rawDurationMin = Math.max(1, Number(route.duration || 60) / 60);

      // Apply vehicle-specific speed calibration when sharing a standard car OSRM server
      let calibratedDurationMin = dedicated ? rawDurationMin : rawDurationMin * profile.speedFactor;
      const minDurationByMaxSpeed = (rawDistanceKm / profile.maxSpeedKmh) * 60;
      calibratedDurationMin = Math.max(2, calibratedDurationMin, minDurationByMaxSpeed);

      const rawCoords: Array<[number, number]> = Array.isArray(route.geometry?.coordinates)
        ? route.geometry.coordinates
            .filter((c: unknown) => Array.isArray(c) && c.length >= 2)
            .map((c: [number, number]) => [Number(c[1]), Number(c[0])] as [number, number])
        : points.map((p) => [p.lat, p.lng] as [number, number]);

      // Inspect road legs/steps for highway warnings on tuk-tuk
      const steps: RouteStepSummary[] = [];
      let touchesHighway = false;
      for (const leg of Array.isArray(route.legs) ? route.legs : []) {
        for (const step of Array.isArray(leg.steps) ? leg.steps : []) {
          const name = String(step.name || '').trim();
          const ref = String(step.ref || '').trim();
          if (
            profile.code === 'tuktuk' &&
            (step.driving_side && /motorway|highway|سريع|الدائري|الملك فهد/i.test(`${name} ${ref}`))
          ) {
            touchesHighway = true;
          }
          if (steps.length < 40) {
            steps.push({
              instruction: buildInstructionAr(step.maneuver, name),
              name,
              distance_m: Math.round(Number(step.distance || 0)),
              duration_s: Math.round(Number(step.duration || 0)),
            });
          }
        }
      }
      if (touchesHighway && profile.code === 'tuktuk') {
        warnings.push('تنبيه: يحتوي المسار على طريق سريع — يُنصح باختيار سيارة أو موتوسيكل لهذه الوجهة أو تفعيل ملف OSRM الخاص بالتوك توك.');
      }

      const result: VehicleRouteResult = {
        vehicle_type: profile.code,
        routing_profile: dedicated ? `osrm_${profile.code}_custom` : `osrm_${profile.osrmProfile}_calibrated_${profile.code}`,
        routing_source: 'osrm_live',
        distance_km: Number(rawDistanceKm.toFixed(2)),
        duration_min: Math.max(2, Math.round(calibratedDurationMin)),
        route_points: rawCoords,
        steps,
        warnings,
        attribution: OSM_ATTRIBUTION,
      };
      setCached(routeCache, cacheKey, result, 5 * 60 * 1000);
      return result;
    }
  } catch (err) {
    console.warn(`[GeoService] OSRM routing failed for ${profile.code}:`, err instanceof Error ? err.message : err);
  }

  // Calibrated fallback ONLY when OSRM upstream is unreachable (never raw straight-line distance)
  let totalAirKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalAirKm += haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  const calibratedDist = Math.max(0.5, Number((totalAirKm * profile.roadFactorFallback).toFixed(2)));
  const calibratedMin = Math.max(3, Math.round((calibratedDist / profile.avgUrbanSpeedKmhFallback) * 60));

  warnings.push('تم استخدام تقدير المسافة المعاير مؤقتاً لتعذر الوصول إلى خادم OSRM اللحظي.');
  return {
    vehicle_type: profile.code,
    routing_profile: `fallback_calibrated_${profile.code}`,
    routing_source: 'osrm_fallback_calibrated',
    distance_km: calibratedDist,
    duration_min: calibratedMin,
    route_points: points.map((p) => [p.lat, p.lng] as [number, number]),
    steps: [],
    warnings,
    attribution: OSM_ATTRIBUTION,
  };
}
