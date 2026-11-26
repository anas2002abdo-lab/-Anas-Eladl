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
  source: 'nominatim';
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
const DEFAULT_OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

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

export async function searchPlaces(params: {
  query: string;
  nearLat?: number;
  nearLng?: number;
  countryCodes?: string;
  limit?: number;
}): Promise<GeoPlaceSuggestion[]> {
  const q = String(params.query || '').trim();
  if (q.length < 2) return [];
  const limit = Math.min(10, Math.max(1, params.limit ?? 6));
  const nearKey =
    Number.isFinite(params.nearLat) && Number.isFinite(params.nearLng)
      ? `${Number(params.nearLat).toFixed(2)},${Number(params.nearLng).toFixed(2)}`
      : 'global';
  const cacheKey = `${q.toLowerCase()}|${nearKey}|${params.countryCodes || ''}|${limit}`;
  const cached = getCached(geocodeCache, cacheKey);
  if (cached) return cached;

  const base = getNominatimBaseUrl();
  const qs = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    'accept-language': 'ar,en',
  });
  if (params.countryCodes) {
    qs.set('countrycodes', params.countryCodes);
  }
  if (Number.isFinite(params.nearLat) && Number.isFinite(params.nearLng)) {
    const lat = Number(params.nearLat);
    const lng = Number(params.nearLng);
    // Soft bias viewbox (~45km radius around user without strictly excluding other cities like Riyadh)
    const delta = 0.45;
    qs.set('viewbox', `${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)},${(lat - delta).toFixed(4)}`);
  }

  try {
    const rows = await fetchJsonWithTimeout<Array<Record<string, any>>>(
      `${base}/search?${qs.toString()}`,
      {
        Accept: 'application/json',
        'User-Agent': getNominatimUserAgent(),
      },
      6500
    );

    const mapped: GeoPlaceSuggestion[] = (Array.isArray(rows) ? rows : [])
      .map((item) => {
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
          place_id: String(item.place_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`),
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

    setCached(geocodeCache, cacheKey, mapped, 10 * 60 * 1000);
    return mapped;
  } catch (err) {
    console.warn('[GeoService] Nominatim search failed:', err instanceof Error ? err.message : err);
    return [];
  }
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
