import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { CornerUpLeft, Navigation } from 'lucide-react';

// Defensive patch for Leaflet's getPosition, _getMapPanePos, _rawPanBy, and _onZoomTransitionEnd
// to prevent "TypeError: Cannot read properties of undefined (reading '_leaflet_pos')"
// when map containers unmount or re-render during animations or resize events.
if (typeof window !== 'undefined' && L) {
  if (L.DomUtil && !(L.DomUtil as any)._otlobha_patched) {
    (L.DomUtil as any)._otlobha_patched = true;
    const origGetPosition = L.DomUtil.getPosition;
    L.DomUtil.getPosition = function (el: HTMLElement | null | undefined) {
      if (!el || typeof el !== 'object') {
        return new L.Point(0, 0);
      }
      try {
        return origGetPosition ? origGetPosition.call(this, el) : ((el as any)._leaflet_pos || new L.Point(0, 0));
      } catch {
        return (el as any)?._leaflet_pos || new L.Point(0, 0);
      }
    };
  }

  if (L.Map && L.Map.prototype && !(L.Map.prototype as any)._otlobha_patched) {
    (L.Map.prototype as any)._otlobha_patched = true;

    const origGetMapPanePos = (L.Map.prototype as any)._getMapPanePos;
    (L.Map.prototype as any)._getMapPanePos = function () {
      if (!this._mapPane) {
        return new L.Point(0, 0);
      }
      try {
        return origGetMapPanePos ? origGetMapPanePos.call(this) : new L.Point(0, 0);
      } catch {
        return new L.Point(0, 0);
      }
    };

    const origOnZoomTransitionEnd = (L.Map.prototype as any)._onZoomTransitionEnd;
    (L.Map.prototype as any)._onZoomTransitionEnd = function () {
      if (!this._mapPane || !this._container) {
        this._animatingZoom = false;
        return;
      }
      try {
        if (origOnZoomTransitionEnd) {
          origOnZoomTransitionEnd.call(this);
        }
      } catch {
        this._animatingZoom = false;
      }
    };

    const origRawPanBy = (L.Map.prototype as any)._rawPanBy;
    (L.Map.prototype as any)._rawPanBy = function (offset: any) {
      if (!this._mapPane) return;
      try {
        if (origRawPanBy) {
          origRawPanBy.call(this, offset);
        }
      } catch {
        // safely ignore during pane unmount
      }
    };
  }
}

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface StoreStopPoint extends MapPoint {
  id?: string;
  pickedUp?: boolean;
}

export interface CaptainPin {
  id: string;
  full_name: string;
  vehicle_type: string;
  vehicle_model?: string;
  availability_status?: string;
  lat: number;
  lng: number;
  distance_km?: number;
  eta_min?: number;
}

interface Props {
  heightClass?: string;
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  captainPin?: CaptainPin | null;
  storeStops?: StoreStopPoint[];
  nearbyCaptains?: CaptainPin[];
  selectedCaptainId?: string | null;
  onCaptainPinClick?: (captainId: string) => void;
  pickTarget?: 'pickup' | 'dropoff' | 'captain' | 'store' | null;
  onMapPick?: (lat: number, lng: number) => void;
  center?: [number, number];
  zoom?: number;
  showNavigationHud?: boolean;
}

function makeBadgeIcon(bgColor: string, text: string, pulse = false, borderColor = '#ffffff'): L.DivIcon {
  return L.divIcon({
    className: 'otlobha-map-pin',
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-100%);cursor:pointer;">
      ${
        pulse
          ? `<span style="position:absolute;width:36px;height:36px;border-radius:9999px;background:${bgColor};opacity:0.28;"></span>`
          : ''
      }
      <div style="background:${bgColor};color:#fff;font-family:Cairo,sans-serif;font-size:11px;font-weight:700;padding:4px 8px;border-radius:9999px;border:2.5px solid ${borderColor};box-shadow:0 3px 10px rgba(15,23,42,0.32);white-space:nowrap;">
        ${text}
      </div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function makeRouteArrowIcon(angleDeg: number): L.DivIcon {
  return L.divIcon({
    className: 'otlobha-route-arrow',
    html: `<div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;transform:rotate(${angleDeg}deg);">
      <div style="width:15px;height:15px;border-radius:9999px;background:#1D4ED8;border:1.5px solid #ffffff;box-shadow:0 2px 5px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:8px;font-weight:900;line-height:1;">
        ▲
      </div>
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const dLon = toRad(to[1] - from[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function buildInstantStreetPath(waypoints: Array<[number, number]>): Array<[number, number]> {
  if (waypoints.length < 2) return waypoints;
  const result: Array<[number, number]> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lat1, lng1] = waypoints[i];
    const [lat2, lng2] = waypoints[i + 1];
    result.push([lat1, lng1]);
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const dist = Math.hypot(dLat, dLng);
    if (dist > 0.0003) {
      result.push([lat1 + dLat * 0.34, lng1 + dLng * 0.16]);
      result.push([lat1 + dLat * 0.68, lng1 + dLng * 0.84]);
    }
  }
  result.push(waypoints[waypoints.length - 1]);
  return result;
}

export const GpsMapPicker: React.FC<Props> = ({
  heightClass = 'h-64',
  pickup,
  dropoff,
  captainPin,
  storeStops = [],
  nearbyCaptains = [],
  selectedCaptainId = null,
  onCaptainPinClick,
  pickTarget = null,
  onMapPick,
  center = [31.1583, 31.9369],
  zoom = 14,
  showNavigationHud,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onMapPick);
  const pickTargetRef = useRef(pickTarget);
  const onCaptainClickRef = useRef(onCaptainPinClick);
  const lastBoundsKeyRef = useRef<string>('');

  const [routeCoords, setRouteCoords] = useState<Array<[number, number]>>([]);
  const [routeStats, setRouteStats] = useState<{
    distanceKm: number;
    etaMin: number;
    nextDestinationLabel: string;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
  } | null>(null);

  onPickRef.current = onMapPick;
  pickTargetRef.current = pickTarget;
  onCaptainClickRef.current = onCaptainPinClick;

  // Build ordered navigation waypoints: Captain -> Unpicked Store(s) -> Pickup/Dropoff
  const routeWaypoints = useMemo(() => {
    const pts: Array<{ lat: number; lng: number; label: string }> = [];

    if (captainPin && Number.isFinite(captainPin.lat) && Number.isFinite(captainPin.lng)) {
      pts.push({
        lat: captainPin.lat,
        lng: captainPin.lng,
        label: `الكابتن: ${captainPin.full_name}`,
      });
    }

    const unpickedStores = storeStops.filter(
      (s) => !s.pickedUp && Number.isFinite(s.lat) && Number.isFinite(s.lng)
    );
    for (const st of unpickedStores) {
      pts.push({
        lat: st.lat,
        lng: st.lng,
        label: st.label || 'المتجر (استلام الطلب)',
      });
    }

    if (pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng)) {
      // Avoid duplicating if pickup is identical to first storeStop
      const isDup = pts.some((p) => Math.abs(p.lat - pickup.lat) < 0.00005 && Math.abs(p.lng - pickup.lng) < 0.00005);
      if (!isDup) {
        pts.push({
          lat: pickup.lat,
          lng: pickup.lng,
          label: pickup.label || (dropoff ? 'نقطة الاستلام' : 'موقع العميل'),
        });
      }
    }

    if (dropoff && Number.isFinite(dropoff.lat) && Number.isFinite(dropoff.lng)) {
      const isDup = pts.some((p) => Math.abs(p.lat - dropoff.lat) < 0.00005 && Math.abs(p.lng - dropoff.lng) < 0.00005);
      if (!isDup) {
        pts.push({
          lat: dropoff.lat,
          lng: dropoff.lng,
          label: dropoff.label || 'وجهة التوصيل (موقع العميل)',
        });
      }
    }

    return pts;
  }, [
    captainPin?.lat,
    captainPin?.lng,
    captainPin?.full_name,
    pickup?.lat,
    pickup?.lng,
    pickup?.label,
    dropoff?.lat,
    dropoff?.lng,
    dropoff?.label,
    JSON.stringify(storeStops),
  ]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Reset container's internal leaflet id if container was reused
    if ((containerRef.current as any)._leaflet_id) {
      delete (containerRef.current as any)._leaflet_id;
    }

    let map: L.Map | null = null;
    let resizeTimer: any = null;

    try {
      map = L.map(containerRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const routeGroup = L.layerGroup().addTo(map);
      const group = L.layerGroup().addTo(map);
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (pickTargetRef.current && onPickRef.current) {
          onPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
        }
      });

      mapRef.current = map;
      routeLayerGroupRef.current = routeGroup;
      layerGroupRef.current = group;

      resizeTimer = setTimeout(() => {
        if (mapRef.current && containerRef.current && (mapRef.current as any)._mapPane) {
          try {
            mapRef.current.invalidateSize({ debounceMoveend: true });
          } catch {
            // safely ignore if map was already unmounted
          }
        }
      }, 150);
    } catch {
      // container might have been unmounted during async init
    }

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      if (map) {
        try {
          (map as any)._animatingZoom = false;
          map.stop();
          map.remove();
        } catch {
          // safely ignore during cleanup
        }
      }
      mapRef.current = null;
      layerGroupRef.current = null;
      routeLayerGroupRef.current = null;
    };
  }, []);

  // Compute road-following Google Maps style route via OSRM with instant street fallback
  useEffect(() => {
    if (routeWaypoints.length < 2) {
      setRouteCoords([]);
      setRouteStats(null);
      return;
    }

    const rawPairs: Array<[number, number]> = routeWaypoints.map((w) => [w.lat, w.lng]);
    const instantCoords = buildInstantStreetPath(rawPairs);
    setRouteCoords(instantCoords);

    let directKm = 0;
    for (let i = 0; i < rawPairs.length - 1; i++) {
      directKm += haversineKm(rawPairs[i][0], rawPairs[i][1], rawPairs[i + 1][0], rawPairs[i + 1][1]);
    }
    const originPt = routeWaypoints[0];
    const nextPt = routeWaypoints[1];
    const destPt = routeWaypoints[routeWaypoints.length - 1];
    const fallbackKm = Number(Math.max(0.15, directKm * 1.25).toFixed(2));
    const fallbackEta = Math.max(2, Math.round(fallbackKm * 3.2));

    setRouteStats({
      distanceKm: typeof captainPin?.distance_km === 'number' ? captainPin.distance_km : fallbackKm,
      etaMin: typeof captainPin?.eta_min === 'number' ? captainPin.eta_min : fallbackEta,
      nextDestinationLabel: nextPt.label,
      originLat: originPt.lat,
      originLng: originPt.lng,
      destLat: destPt.lat,
      destLng: destPt.lng,
    });

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const coordStr = routeWaypoints.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');

    fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.routes?.[0]?.geometry?.coordinates) return;
        const geoCoords: Array<[number, number]> = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [Number(c[1]), Number(c[0])] as [number, number]
        );
        if (geoCoords.length >= 2) {
          setRouteCoords(geoCoords);
          const distMeters = Number(data.routes[0].distance || 0);
          const durSec = Number(data.routes[0].duration || 0);
          const roadKm = distMeters > 0 ? Number((distMeters / 1000).toFixed(2)) : fallbackKm;
          const roadMin = durSec > 0 ? Math.max(2, Math.round(durSec / 60)) : fallbackEta;
          setRouteStats({
            distanceKm: roadKm,
            etaMin: roadMin,
            nextDestinationLabel: nextPt.label,
            originLat: originPt.lat,
            originLng: originPt.lng,
            destLat: destPt.lat,
            destLng: destPt.lng,
          });
        }
      })
      .catch(() => {
        // Keep instant street route fallback
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [routeWaypoints]);

  // Draw Google Maps style dual-layer blue route line & directional chevrons
  useEffect(() => {
    const routeGroup = routeLayerGroupRef.current;
    if (!routeGroup || !mapRef.current || !(mapRef.current as any)._mapPane) return;

    try {
      routeGroup.clearLayers();
      if (routeCoords.length < 2) return;

    // Outer Google Maps navigation dark-blue casing
    L.polyline(routeCoords, {
      color: '#1E40AF',
      weight: 9,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeGroup);

    // Inner Google Maps navigation bright-blue road path
    L.polyline(routeCoords, {
      color: '#3B82F6',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeGroup);

    // Directional turn-by-turn arrows along the route
    const step = Math.max(1, Math.floor(routeCoords.length / 4));
    for (let i = step; i < routeCoords.length; i += step) {
      const prev = routeCoords[i - 1];
      const curr = routeCoords[i];
      if (!prev || !curr) continue;
      const angle = bearingDeg(prev, curr);
      const midLat = (prev[0] + curr[0]) / 2;
      const midLng = (prev[1] + curr[1]) / 2;
      L.marker([midLat, midLng], {
        icon: makeRouteArrowIcon(angle),
        interactive: false,
      }).addTo(routeGroup);
    }
    } catch {
      // safely ignore during map unmount
    }
  }, [routeCoords]);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || !(map as any)._mapPane || !containerRef.current) return;

    try {
      group.clearLayers();
      const boundsPoints: L.LatLngExpression[] = [];

    for (const st of storeStops) {
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;
      const m = L.marker([st.lat, st.lng], {
        icon: makeBadgeIcon(
          st.pickedUp ? '#10B981' : '#D97706',
          `${st.pickedUp ? '✓ ' : '🏪 '}${st.label || 'المتجر'}`,
          !st.pickedUp
        ),
        bubblingMouseEvents: false,
      });
      m.addTo(group);
      boundsPoints.push([st.lat, st.lng]);
    }

    if (pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng)) {
      const m = L.marker([pickup.lat, pickup.lng], {
        icon: makeBadgeIcon('#0D9488', `📍 ${pickup.label || 'موقع الانطلاق GPS'}`),
        bubblingMouseEvents: false,
      });
      m.addTo(group);
      boundsPoints.push([pickup.lat, pickup.lng]);
    }

    if (dropoff && Number.isFinite(dropoff.lat) && Number.isFinite(dropoff.lng)) {
      const m = L.marker([dropoff.lat, dropoff.lng], {
        icon: makeBadgeIcon('#EA580C', `🏠 ${dropoff.label || 'وجهة التوصيل'}`),
        bubblingMouseEvents: false,
      });
      m.addTo(group);
      boundsPoints.push([dropoff.lat, dropoff.lng]);
    }

    if (captainPin && Number.isFinite(captainPin.lat) && Number.isFinite(captainPin.lng)) {
      const m = L.marker([captainPin.lat, captainPin.lng], {
        icon: makeBadgeIcon('#1D4ED8', `🏍️ الطيار: ${captainPin.full_name}`, true, '#93C5FD'),
        bubblingMouseEvents: false,
        zIndexOffset: 500,
      });
      m.bindTooltip(
        `${captainPin.full_name}${captainPin.vehicle_model ? ` · ${captainPin.vehicle_model}` : ''}${
          typeof captainPin.distance_km === 'number' ? ` (${captainPin.distance_km} كم)` : ''
        }`
      );
      m.addTo(group);
      boundsPoints.push([captainPin.lat, captainPin.lng]);
    }

    for (const c of nearbyCaptains) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      if (captainPin && c.id === captainPin.id) continue;
      const vehEmoji = c.vehicle_type === 'car' ? '🚗' : c.vehicle_type === 'tuktuk' ? '🛺' : '🏍️';
      const isSelected = Boolean(selectedCaptainId && c.id === selectedCaptainId);
      const isAvail = c.availability_status === 'available';
      const isBusy = c.availability_status === 'busy';
      const pinColor = isSelected ? '#EA580C' : isAvail ? '#0D9488' : isBusy ? '#D97706' : '#64748B';
      const borderColor = isSelected ? '#FEF08A' : '#FFFFFF';
      const marker = L.marker([c.lat, c.lng], {
        icon: makeBadgeIcon(
          pinColor,
          `${isSelected ? '✓ ' : ''}${vehEmoji} ${c.full_name.split(' ')[0]}${
            typeof c.distance_km === 'number' ? ` · ${c.distance_km}كم` : ''
          }`,
          isSelected || isAvail,
          borderColor
        ),
        bubblingMouseEvents: false,
        zIndexOffset: isSelected ? 600 : 300,
      });
      marker.bindTooltip(
        `${c.full_name} (${c.vehicle_model || c.vehicle_type}) · ${
          isAvail ? 'متاح' : isBusy ? 'مشغول' : 'غير متصل'
        }${typeof c.distance_km === 'number' ? ` — ${c.distance_km} كم` : ''}`
      );
      marker.on('add', () => {
        const el = marker.getElement();
        if (el) {
          L.DomEvent.disableClickPropagation(el);
        }
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        if (e.originalEvent) {
          L.DomEvent.stopPropagation(e.originalEvent);
          L.DomEvent.preventDefault(e.originalEvent);
        }
        onCaptainClickRef.current?.(c.id);
      });
      marker.addTo(group);
      boundsPoints.push([c.lat, c.lng]);
    }

    const boundsKey = [
      pickup ? `${pickup.lat.toFixed(4)},${pickup.lng.toFixed(4)}` : '',
      dropoff ? `${dropoff.lat.toFixed(4)},${dropoff.lng.toFixed(4)}` : '',
      captainPin ? `${captainPin.lat.toFixed(4)},${captainPin.lng.toFixed(4)}` : '',
      String(storeStops.length),
      String(nearbyCaptains.length),
    ].join('|');

    if (boundsKey !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = boundsKey;
      if (!map || !(map as any)._mapPane || !containerRef.current) return;
      try {
        if (boundsPoints.length >= 2) {
          map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 15, animate: false });
        } else if (boundsPoints.length === 1) {
          map.setView(boundsPoints[0], 15, { animate: false });
        }
      } catch {
        // safely ignore bounds error if map is detached
      }
    }
    } catch {
      // safely ignore layer error if map is detached
    }
  }, [
    pickup?.lat,
    pickup?.lng,
    pickup?.label,
    dropoff?.lat,
    dropoff?.lng,
    dropoff?.label,
    captainPin?.lat,
    captainPin?.lng,
    captainPin?.full_name,
    selectedCaptainId,
    nearbyCaptains,
    storeStops,
  ]);

  const shouldShowHud = (showNavigationHud ?? Boolean(captainPin)) && Boolean(routeStats);

  return (
    <div className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-sm">
      {shouldShowHud && routeStats && (
        <div className="bg-gradient-to-l from-emerald-700 via-emerald-600 to-teal-700 text-white px-3 py-2 flex items-center justify-between gap-2 border-b border-emerald-800/30">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <CornerUpLeft className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-emerald-100 leading-tight">
                مسار التوصيل المباشر (Google Maps Navigation)
              </p>
              <p className="text-xs font-black truncate leading-tight">
                متجه إلى: {routeStats.nextDestinationLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="text-left bg-black/20 px-2 py-1 rounded-lg border border-white/15">
              <p className="text-[11px] font-black text-amber-200 leading-tight">{routeStats.etaMin} د</p>
              <p className="text-[10px] font-bold text-white leading-tight">{routeStats.distanceKm} كم</p>
            </div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&origin=${routeStats.originLat},${routeStats.originLng}&destination=${routeStats.destLat},${routeStats.destLng}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1.5 rounded-lg bg-white text-emerald-800 hover:bg-emerald-50 text-[10px] font-black flex items-center gap-1 shadow-sm"
              title="فتح مسار التوجيه في خرائط جوجل"
            >
              <Navigation className="w-3 h-3" />
              Google Maps
            </a>
          </div>
        </div>
      )}
      <div className={`relative w-full ${heightClass}`}>
        <div ref={containerRef} className="w-full h-full z-10" />
        {pickTarget && (
          <div className="absolute top-2.5 start-2.5 z-[400] bg-slate-900/90 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg pointer-events-none shadow">
            {pickTarget === 'pickup'
              ? 'اضغط على الخريطة لتحديد نقطة الانطلاق (GPS)'
              : pickTarget === 'dropoff'
              ? 'اضغط على الخريطة لتحديد مكان التوصيل'
              : pickTarget === 'store'
              ? 'اضغط على الخريطة لتحديد موقع المتجر / الصيدلية (GPS)'
              : 'اضغط على الخريطة لتحديث موقع الطيار بالـ GPS'}
          </div>
        )}
      </div>
    </div>
  );
};

