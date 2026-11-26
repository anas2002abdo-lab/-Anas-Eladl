import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Bike,
  Car,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Star,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../lib/api.ts';

interface Props {
  customerName: string;
  customerPhone: string;
  selectedZoneId: string;
  onOpenTripChat: (tripId: string) => void;
  notify: (msg: string) => void;
}

const VEHICLE_ICONS: Record<string, any> = {
  car: Car,
  moto: Bike,
  tuktuk: Navigation,
};

const STATUS_AR: Record<string, string> = {
  searching: 'جاري البحث عن أقرب سائق معتمد...',
  offered: 'تم إرسال طلبك لأقرب سائق — بانتظار القبول...',
  accepted: 'قبل السائق رحلتك وهو في طريقه إليك',
  arrived: 'وصل السائق إلى نقطة الانطلاق — اعطه رمز البدء',
  in_progress: 'الرحلة جارية الآن نحو وجهتك',
  completed: 'اكتملت الرحلة بحمد الله',
  cancelled: 'تم إلغاء الرحلة',
  no_driver: 'لا يوجد سائق متاح حالياً في منطقتك',
  expired: 'انتهت مهلة الطلب',
};

export function CustomerRidesView({ customerName, customerPhone, selectedZoneId, onOpenTripChat, notify }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [mapConfig, setMapConfig] = useState<any>({
    tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    online_payment_enabled: false,
  });

  // Pickup, optional waypoint, dropoff
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string }>({
    lat: 31.1583,
    lng: 31.9369,
    address: 'موقعي الحالي (GPS)',
  });
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [showWaypoint, setShowWaypoint] = useState(false);
  const [waypoint, setWaypoint] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [pickMode, setPickMode] = useState<'pickup' | 'dropoff' | 'waypoint' | null>('dropoff');

  // Search box (Nominatim)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTarget, setSearchTarget] = useState<'pickup' | 'dropoff' | 'waypoint'>('dropoff');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);

  // Estimate & vehicles
  const [estimating, setEstimating] = useState(false);
  const [estimateOptions, setEstimateOptions] = useState<any[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('car');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live Active Ride & History
  const [activeTrip, setActiveTrip] = useState<any | null>(null);
  const [rideHistory, setRideHistory] = useState<any[]>([]);
  const [liveDriverPos, setLiveDriverPos] = useState<{ lat: number; lng: number; eta?: number; dist?: number } | null>(null);

  // Rating & Dispute
  const [ratingTrip, setRatingTrip] = useState<any | null>(null);
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState('');

  const selectedOption = estimateOptions.find((o) => o.code === selectedVehicle) || estimateOptions[0] || null;

  // 1. Load map config + my rides + auto-detect GPS once
  useEffect(() => {
    void api.getRidesMapConfig().then((cfg) => setMapConfig(cfg)).catch(() => {});
    void loadMyRides();
  }, []);

  const loadMyRides = async () => {
    try {
      const res = await api.getMyRides();
      setActiveTrip(res.active_trip || null);
      setRideHistory(res.trips || []);
      if (res.active_trip?.captain_lat && res.active_trip?.captain_lng) {
        setLiveDriverPos({
          lat: Number(res.active_trip.captain_lat),
          lng: Number(res.active_trip.captain_lng),
        });
      }
      // Show rating prompt if latest completed trip is unrated
      const latestCompleted = (res.trips || []).find(
        (t: any) => t.status === 'completed' && (!t.rating || t.rating.status !== 'submitted')
      );
      if (!res.active_trip && latestCompleted) {
        setRatingTrip(latestCompleted);
      }
    } catch {
      // ignore
    }
  };

  // 2. Real-time WebSocket subscription for active ride & driver live GPS
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = activeTrip?.id
      ? `${proto}://${window.location.host}/ws/order-chat?tripId=${encodeURIComponent(activeTrip.id)}`
      : `${proto}://${window.location.host}/ws/order-chat?channel=customer`;
    let ws: WebSocket | null = null;
    let closed = false;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (msg.type === 'ride:location' && Number.isFinite(Number(msg.lat)) && Number.isFinite(Number(msg.lng))) {
            setLiveDriverPos({
              lat: Number(msg.lat),
              lng: Number(msg.lng),
              eta: msg.remaining_eta_min,
              dist: msg.remaining_distance_km,
            });
          } else if (
            ['trip:accepted', 'trip:status', 'trip:completed', 'trip:cancelled', 'trip:no_driver'].includes(msg.type)
          ) {
            void loadMyRides();
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
    const poll = setInterval(() => {
      if (!closed && activeTrip) void loadMyRides();
    }, 6000);
    return () => {
      closed = true;
      clearInterval(poll);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, [activeTrip?.id]);

  // 3. Initialize interactive Leaflet OpenStreetMap
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [pickup.lat, pickup.lng],
      zoom: 14,
      attributionControl: true,
    });
    L.tileLayer(mapConfig.tile_url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: mapConfig.attribution || '© OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      try {
        map.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [mapConfig.tile_url]);

  // Map click handler for setting pickup / dropoff / waypoint
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = async (e: L.LeafletMouseEvent) => {
      if (activeTrip) return;
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));
      let label = `موقع (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      try {
        const rev = await api.reverseGeocodeRide(lat, lng);
        if (rev?.short_name) label = rev.short_name;
      } catch {
        // fallback label
      }
      if (pickMode === 'pickup') {
        setPickup({ lat, lng, address: label });
        setPickMode('dropoff');
      } else if (pickMode === 'waypoint') {
        setWaypoint({ lat, lng, address: label });
        setPickMode('dropoff');
      } else {
        setDropoff({ lat, lng, address: label });
      }
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [pickMode, activeTrip]);

  // Redraw pins, OSRM road route polyline, and moving driver pin
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: Array<[number, number]> = [];

    const pLat = activeTrip ? Number(activeTrip.pickup_lat) : pickup.lat;
    const pLng = activeTrip ? Number(activeTrip.pickup_lng) : pickup.lng;
    const dLat = activeTrip ? Number(activeTrip.dropoff_lat) : dropoff?.lat;
    const dLng = activeTrip ? Number(activeTrip.dropoff_lng) : dropoff?.lng;

    if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
      bounds.push([pLat, pLng]);
      const pin = L.divIcon({
        className: 'otlobha-pickup-pin',
        html: '<div style="transform:translate(-50%,-100%);background:#059669;color:#fff;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.3);white-space:nowrap;">انطلاق</div>',
        iconSize: [0, 0],
      });
      L.marker([pLat, pLng], { icon: pin }).addTo(layer);
    }

    if (!activeTrip && waypoint) {
      bounds.push([waypoint.lat, waypoint.lng]);
      const pin = L.divIcon({
        className: 'otlobha-wp-pin',
        html: '<div style="transform:translate(-50%,-100%);background:#2563EB;color:#fff;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;border:2px solid #fff;white-space:nowrap;">توقف وسيط</div>',
        iconSize: [0, 0],
      });
      L.marker([waypoint.lat, waypoint.lng], { icon: pin }).addTo(layer);
    }

    if (dLat !== undefined && dLng !== undefined && Number.isFinite(dLat) && Number.isFinite(dLng)) {
      bounds.push([dLat, dLng]);
      const pin = L.divIcon({
        className: 'otlobha-drop-pin',
        html: '<div style="transform:translate(-50%,-100%);background:#A92224;color:#fff;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.3);white-space:nowrap;">الوجهة</div>',
        iconSize: [0, 0],
      });
      L.marker([dLat, dLng], { icon: pin }).addTo(layer);
    }

    const routePts: Array<[number, number]> = activeTrip
      ? activeTrip.route_points || []
      : selectedOption?.route_points || [];
    if (routePts.length > 1) {
      L.polyline(routePts, { color: '#A92224', weight: 4.5, opacity: 0.9 }).addTo(layer);
    }

    if (activeTrip && liveDriverPos && Number.isFinite(liveDriverPos.lat)) {
      bounds.push([liveDriverPos.lat, liveDriverPos.lng]);
      const capIcon = L.divIcon({
        className: 'otlobha-driver-live',
        html: '<div style="transform:translate(-50%,-100%);background:#0F172A;color:#F5A623;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:900;border:2px solid #F5A623;box-shadow:0 4px 12px rgba(0,0,0,0.4);white-space:nowrap;">الكابتن الآن</div>',
        iconSize: [0, 0],
      });
      L.marker([liveDriverPos.lat, liveDriverPos.lng], { icon: capIcon }).addTo(layer);
    }

    if (bounds.length > 1) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      } catch {
        // ignore
      }
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    }
  }, [pickup, dropoff, waypoint, selectedOption, activeTrip, liveDriverPos]);

  // 4. Auto-estimate real OSRM road route & fares whenever pickup/dropoff/waypoint changes
  useEffect(() => {
    if (!dropoff || activeTrip) return;
    let cancelled = false;
    setEstimating(true);
    api
      .estimateRide({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        waypoint_lat: waypoint?.lat ?? null,
        waypoint_lng: waypoint?.lng ?? null,
        zone_id: selectedZoneId,
      })
      .then((res) => {
        if (cancelled) return;
        const opts = res.options || [];
        setEstimateOptions(opts);
        if (opts.length > 0 && !opts.some((o: any) => o.code === selectedVehicle)) {
          setSelectedVehicle(opts[0].code);
        }
      })
      .catch((err) => {
        if (!cancelled) notify(err instanceof Error ? err.message : 'تعذر حساب المسار والتسعيرة');
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, dropoff?.lat, dropoff?.lng, waypoint?.lat, waypoint?.lng, selectedZoneId, activeTrip?.id]);

  // 5. Nominatim place search (debounced)
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingPlaces(true);
      try {
        const res = await api.searchRidePlaces(searchQuery.trim(), { lat: pickup.lat, lng: pickup.lng });
        setSuggestions(res.items || []);
      } catch {
        setSuggestions([]);
      } finally {
        setSearchingPlaces(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, pickup.lat, pickup.lng]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      notify('المتصفح لا يدعم تحديد الموقع GPS');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        let label = 'موقعي الحالي (GPS)';
        try {
          const rev = await api.reverseGeocodeRide(lat, lng);
          if (rev?.short_name) label = rev.short_name;
        } catch {
          // keep default
        }
        setPickup({ lat, lng, address: label });
        setLocatingGps(false);
        notify('تم تحديد موقعك الحالي بنجاح');
      },
      () => {
        setLocatingGps(false);
        notify('يرجى السماح بصلاحية الموقع GPS');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSelectSuggestion = (place: any) => {
    const point = { lat: Number(place.lat), lng: Number(place.lng), address: place.short_name || place.display_name };
    if (searchTarget === 'pickup') setPickup(point);
    else if (searchTarget === 'waypoint') setWaypoint(point);
    else setDropoff(point);
    setSuggestions([]);
    setSearchQuery('');
  };

  const handleConfirmRide = async () => {
    if (!dropoff || !selectedOption) {
      notify('يرجى تحديد الوجهة واختيار نوع المركبة أولاً');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.requestRideV2({
        vehicle_type: selectedOption.code,
        pickup_address: pickup.address,
        dropoff_address: dropoff.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        waypoint_address: waypoint?.address || null,
        waypoint_lat: waypoint?.lat ?? null,
        waypoint_lng: waypoint?.lng ?? null,
        payment_method: paymentMethod,
        customer_name: customerName,
        customer_phone: customerPhone,
      });
      setReviewOpen(false);
      setActiveTrip(res.trip);
      notify('تم إرسال طلب الرحلة وجاري البحث عن أقرب سائق معتمد');
      await loadMyRides();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إنشاء طلب الرحلة');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelActiveRide = async () => {
    if (!activeTrip) return;
    try {
      await api.cancelRideV2(activeTrip.id, 'إلغاء بواسطة العميل');
      notify('تم إلغاء الرحلة');
      setActiveTrip(null);
      await loadMyRides();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إلغاء الرحلة');
    }
  };

  const handleSubmitRating = async () => {
    if (!ratingTrip) return;
    try {
      await api.rateRideV2(ratingTrip.id, ratingStars, ratingComment);
      notify('شكراً لتقييمك السائق!');
      setRatingTrip(null);
      setRatingComment('');
      await loadMyRides();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إرسال التقييم');
    }
  };

  const handleSubmitDispute = async () => {
    const targetTrip = activeTrip || ratingTrip;
    if (!targetTrip || disputeText.trim().length < 4) return;
    try {
      await api.reportRideDispute(targetTrip.id, 'safety', disputeText.trim());
      setDisputeText('');
      setDisputeOpen(false);
      notify('تم إرسال البلاغ لفريق الإدارة فوراً للمتابعة');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إرسال البلاغ');
    }
  };

  const handleShareTrip = () => {
    if (!activeTrip?.share_token) return;
    const url = `${window.location.origin}/api/rides/share/${activeTrip.share_token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    notify('تم نسخ رابط مشاركة بيانات الرحلة الحية');
  };

  return (
    <div className="space-y-3">
      {/* Interactive Full-Width OpenStreetMap */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100">
        <div ref={mapContainerRef} className="w-full h-[300px] z-0" />
        {/* Floating GPS & Pick Target Controls */}
        {!activeTrip && (
          <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5">
            <button
              type="button"
              onClick={handleLocateMe}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 shadow-md border border-slate-200 text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              {locatingGps ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A92224]" /> : <Crosshair className="w-3.5 h-3.5 text-[#A92224]" />}
              موقعي الحالي
            </button>
            <div className="flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setPickMode('pickup')}
                className={`px-2 py-1 rounded-lg cursor-pointer ${pickMode === 'pickup' ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}
              >
                تحديد الانطلاق
              </button>
              <button
                type="button"
                onClick={() => setPickMode('dropoff')}
                className={`px-2 py-1 rounded-lg cursor-pointer ${pickMode === 'dropoff' ? 'bg-[#A92224] text-white' : 'text-slate-600'}`}
              >
                تحديد الوجهة
              </button>
            </div>
          </div>
        )}
        <div className="absolute bottom-2 left-2 z-[400] bg-white/90 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600">
          © OpenStreetMap contributors
        </div>
      </div>

      {/* ACTIVE RIDE LIVE TRACKING CARD */}
      {activeTrip ? (
        <div className="bg-white rounded-2xl border-2 border-[#A92224]/25 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-slate-500">رحلة #{activeTrip.trip_number}</div>
              <div className="text-sm font-black text-[#A92224]">
                {STATUS_AR[activeTrip.status] || activeTrip.status}
              </div>
            </div>
            {(activeTrip.status === 'searching' || activeTrip.status === 'offered') && (
              <Loader2 className="w-6 h-6 animate-spin text-[#A92224]" />
            )}
          </div>

          {/* 4-Digit Start OTP Card (Customer ONLY before start) */}
          {activeTrip.start_otp && ['accepted', 'arrived'].includes(activeTrip.status) && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-between">
              <div>
                <div className="text-xs font-black text-amber-900">رمز تأكيد بدء الرحلة (OTP)</div>
                <div className="text-[11px] text-amber-800">أعطِ هذا الرمز للسائق عند الركوب لبدء الرحلة بأمان</div>
              </div>
              <div className="text-2xl font-black tracking-widest text-[#A92224] bg-white px-3 py-1 rounded-xl border border-amber-300">
                {activeTrip.start_otp}
              </div>
            </div>
          )}

          {/* Driver Details Card once accepted */}
          {activeTrip.captain_id && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#A92224] text-white flex items-center justify-center font-black text-lg overflow-hidden">
                  {activeTrip.captain_avatar_url ? (
                    <img src={activeTrip.captain_avatar_url} alt={activeTrip.captain_name} className="w-full h-full object-cover" />
                  ) : (
                    String(activeTrip.captain_name || 'ك').slice(0, 1)
                  )}
                </div>
                <div>
                  <div className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                    {activeTrip.captain_name}
                    <span className="text-xs text-amber-600 flex items-center gap-0.5">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {activeTrip.captain_rating_avg ?? 5}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {activeTrip.captain_vehicle_brand || ''} {activeTrip.captain_vehicle_model || ''}
                    {activeTrip.captain_vehicle_color ? ` · ${activeTrip.captain_vehicle_color}` : ''}
                  </div>
                  <div className="text-xs font-black text-slate-800">رقم اللوحة: {activeTrip.captain_plate_number || '—'}</div>
                </div>
              </div>
              {liveDriverPos?.eta && (
                <div className="text-center bg-white px-3 py-2 rounded-xl border border-slate-200">
                  <div className="text-base font-black text-[#A92224]">{liveDriverPos.eta} د</div>
                  <div className="text-[10px] text-slate-500">{liveDriverPos.dist ?? activeTrip.distance_km} كم</div>
                </div>
              )}
            </div>
          )}

          {/* Route Summary */}
          <div className="text-xs space-y-1 bg-slate-50 p-3 rounded-xl">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-600" /> <strong>الانطلاق:</strong> {activeTrip.pickup_address}</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#A92224]" /> <strong>الوجهة:</strong> {activeTrip.dropoff_address}</div>
            <div className="flex items-center justify-between pt-1.5 border-t border-slate-200 font-bold">
              <span>المسافة: {activeTrip.distance_km} كم · المدة: {activeTrip.duration_min} د</span>
              <span className="text-[#A92224] text-sm font-black">{activeTrip.final_fare ?? activeTrip.estimated_fare} ج.م</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {activeTrip.captain_phone && (
              <a
                href={`tel:${activeTrip.captain_phone}`}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Phone className="w-4 h-4" /> اتصال
              </a>
            )}
            {activeTrip.captain_id && (
              <button
                type="button"
                onClick={() => onOpenTripChat(activeTrip.id)}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" /> محادثة
              </button>
            )}
            <button
              type="button"
              onClick={handleShareTrip}
              className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Share2 className="w-4 h-4" /> مشاركة
            </button>
            <button
              type="button"
              onClick={() => setDisputeOpen(true)}
              className="px-3 py-2.5 rounded-xl bg-amber-100 text-amber-900 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" /> إبلاغ
            </button>
            {['searching', 'offered', 'accepted', 'arrived'].includes(activeTrip.status) && (
              <button
                type="button"
                onClick={handleCancelActiveRide}
                className="px-3 py-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            )}
          </div>
        </div>
      ) : (
        /* BOOKING FLOW: PICKUP / DESTINATION SEARCH + VEHICLE SELECTION */
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
          {/* Address inputs + Nominatim search */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
              <input
                value={searchTarget === 'pickup' && searchQuery ? searchQuery : pickup.address}
                onFocus={() => {
                  setSearchTarget('pickup');
                  setPickMode('pickup');
                }}
                onChange={(e) => {
                  setSearchTarget('pickup');
                  setSearchQuery(e.target.value);
                  setPickup({ ...pickup, address: e.target.value });
                }}
                placeholder="موقع الانطلاق (ابحث أو اضغط الخريطة)"
                className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold"
              />
            </div>

            {showWaypoint && (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                <input
                  value={searchTarget === 'waypoint' && searchQuery ? searchQuery : waypoint?.address || ''}
                  onFocus={() => {
                    setSearchTarget('waypoint');
                    setPickMode('waypoint');
                  }}
                  onChange={(e) => {
                    setSearchTarget('waypoint');
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="وجهة وسيطة اختيارية..."
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-blue-300"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowWaypoint(false);
                    setWaypoint(null);
                  }}
                  className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#A92224] shrink-0" />
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                <input
                  value={searchTarget === 'dropoff' && searchQuery ? searchQuery : dropoff?.address || ''}
                  onFocus={() => {
                    setSearchTarget('dropoff');
                    setPickMode('dropoff');
                  }}
                  onChange={(e) => {
                    setSearchTarget('dropoff');
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="إلى أين تريد الذهاب؟ ابحث باسم المكان أو اضغط الخريطة..."
                  className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-300 font-bold"
                />
              </div>
              {!showWaypoint && (
                <button
                  type="button"
                  onClick={() => setShowWaypoint(true)}
                  title="إضافة وجهة وسيطة"
                  className="p-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Nominatim Autocomplete Suggestions */}
            {(searchingPlaces || suggestions.length > 0) && (
              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 max-h-44 overflow-y-auto shadow-md">
                {searchingPlaces && (
                  <div className="p-2.5 text-xs text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري البحث في OpenStreetMap...
                  </div>
                )}
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="w-full text-right p-2.5 hover:bg-slate-50 flex items-start gap-2 cursor-pointer"
                  >
                    <MapPin className="w-4 h-4 text-[#A92224] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-900 truncate">{s.short_name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{s.address_line}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3 Vehicle Cards (Server OSRM Road Route + Fare) */}
          {estimating && (
            <div className="py-4 text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#A92224]" /> جاري حساب مسافة الطريق الفعلية والأجرة...
            </div>
          )}

          {!estimating && estimateOptions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-black text-slate-800">اختر نوع المركبة</span>
                {selectedOption && (
                  <span className="text-[11px] font-bold text-slate-500">
                    مسافة الطريق: {selectedOption.distance_km} كم · {selectedOption.duration_min} د
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {estimateOptions.map((opt) => {
                  const Icon = VEHICLE_ICONS[opt.code] || Car;
                  const active = selectedVehicle === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => setSelectedVehicle(opt.code)}
                      className={`p-3 rounded-2xl border-2 text-right flex items-center justify-between gap-3 transition cursor-pointer ${
                        active ? 'border-[#A92224] bg-[#FEF2F2]/60' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${active ? 'bg-[#A92224] text-white' : 'bg-slate-100 text-slate-700'}`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="font-black text-sm text-slate-900 flex items-center gap-2">
                            {opt.name_ar}
                            <span className="text-[10px] font-bold text-slate-500 flex items-center gap-0.5">
                              <Users className="w-3 h-3" /> {opt.max_passengers}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex items-center gap-2">
                            <span>الرحلة: {opt.duration_min} د ({opt.distance_km} كم)</span>
                            <span>·</span>
                            <span className="text-emerald-700 font-bold">
                              {opt.driver_eta_min ? `وصول السائق ~${opt.driver_eta_min} د` : 'بحث تلقائي'}
                            </span>
                          </div>
                          {Array.isArray(opt.warnings) && opt.warnings.length > 0 && (
                            <div className="text-[10px] text-amber-700 mt-0.5">{opt.warnings[0]}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-base font-black text-[#A92224]">{opt.fare.total_fare} ج.م</div>
                        {opt.fare.min_fare_applied && <div className="text-[9px] text-slate-500">الحد الأدنى</div>}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="w-full py-3 rounded-2xl bg-[#A92224] text-white font-black text-sm shadow-md hover:bg-[#86191B] cursor-pointer"
              >
                مراجعة وتأكيد الرحلة ({selectedOption?.fare?.total_fare} ج.م)
              </button>
            </div>
          )}
        </div>
      )}

      {/* CONFIRMATION REVIEW MODAL */}
      {reviewOpen && selectedOption && dropoff && (
        <div className="bg-white rounded-2xl border-2 border-slate-900 p-4 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-sm text-slate-900">مراجعة تفاصيل الرحلة قبل التأكيد</h4>
            <button type="button" onClick={() => setReviewOpen(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <div className="text-xs space-y-1.5 bg-slate-50 p-3 rounded-xl">
            <div><strong>الانطلاق:</strong> {pickup.address}</div>
            {waypoint && <div><strong>نقطة توقف وسيطة:</strong> {waypoint.address}</div>}
            <div><strong>الوجهة:</strong> {dropoff.address}</div>
            <div><strong>المركبة:</strong> {selectedOption.name_ar} (حتى {selectedOption.max_passengers} ركاب)</div>
            <div><strong>مسافة الطريق والوقت:</strong> {selectedOption.distance_km} كم · ~{selectedOption.duration_min} دقيقة</div>
          </div>
          <div className="text-xs space-y-1 border-t border-slate-200 pt-2">
            <div className="flex justify-between"><span>سعر البداية</span><span>{selectedOption.fare.base_fare} ج.م</span></div>
            <div className="flex justify-between"><span>تكلفة المسافة ({selectedOption.distance_km} كم)</span><span>{selectedOption.fare.distance_cost} ج.م</span></div>
            <div className="flex justify-between"><span>تكلفة الوقت ({selectedOption.duration_min} د)</span><span>{selectedOption.fare.duration_cost} ج.م</span></div>
            {selectedOption.fare.extra_fees > 0 && (
              <div className="flex justify-between text-amber-700"><span>{selectedOption.fare.extra_fee_label_ar || 'رسوم إضافية'}</span><span>{selectedOption.fare.extra_fees} ج.م</span></div>
            )}
            {selectedOption.fare.tax_amount > 0 && (
              <div className="flex justify-between"><span>الضريبة</span><span>{selectedOption.fare.tax_amount} ج.م</span></div>
            )}
            <div className="flex justify-between font-black text-sm text-[#A92224] pt-1 border-t border-slate-200">
              <span>الأجرة الإجمالية المعتمدة</span>
              <span>{selectedOption.fare.total_fare} ج.م</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-bold text-slate-700">وسيلة الدفع</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`p-2.5 rounded-xl border font-bold cursor-pointer ${paymentMethod === 'cash' ? 'border-[#A92224] bg-[#FEF2F2] text-[#A92224]' : 'border-slate-200'}`}
              >
                نقداً للسائق
              </button>
              <button
                type="button"
                disabled={!mapConfig.online_payment_enabled}
                onClick={() => setPaymentMethod('online')}
                className={`p-2.5 rounded-xl border font-bold ${
                  !mapConfig.online_payment_enabled
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : paymentMethod === 'online'
                    ? 'border-[#A92224] bg-[#FEF2F2] text-[#A92224] cursor-pointer'
                    : 'border-slate-200 cursor-pointer'
                }`}
              >
                {mapConfig.online_payment_enabled ? 'دفع إلكتروني' : 'إلكتروني (غير مفعّل)'}
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirmRide}
            className="w-full py-3 rounded-xl bg-[#A92224] text-white font-black text-sm hover:bg-[#86191B] cursor-pointer"
          >
            {submitting ? 'جاري تأكيد الطلب...' : 'تأكيد الرحلة والبحث عن سائق'}
          </button>
        </div>
      )}

      {/* COMPLETED TRIP RATING CARD */}
      {ratingTrip && (
        <div className="bg-amber-50 rounded-2xl border border-amber-300 p-4 space-y-3">
          <div className="font-black text-sm text-amber-950">
            انتهت رحلتك #{ratingTrip.trip_number} — الأجرة النهائية: {ratingTrip.final_fare} ج.م
          </div>
          <div className="text-xs text-amber-900">قيّم الكابتن {ratingTrip.captain_name} (من 1 إلى 5 نجوم):</div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} type="button" onClick={() => setRatingStars(s)} className="cursor-pointer">
                <Star className={`w-7 h-7 ${s <= ratingStars ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`} />
              </button>
            ))}
          </div>
          <input
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            placeholder="أضف تعليقك عن الرحلة (اختياري)..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-amber-300 bg-white"
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmitRating} className="flex-1 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold cursor-pointer">
              إرسال التقييم
            </button>
            <button type="button" onClick={() => setDisputeOpen(true)} className="px-3 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-bold cursor-pointer">
              تقديم شكوى
            </button>
          </div>
        </div>
      )}

      {/* DISPUTE MODAL */}
      {disputeOpen && (
        <div className="bg-white rounded-2xl border border-rose-300 p-4 space-y-2.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-black text-xs text-rose-800">الإبلاغ عن مشكلة أو شكوى في الرحلة</span>
            <button type="button" onClick={() => setDisputeOpen(false)} className="cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <textarea
            value={disputeText}
            onChange={(e) => setDisputeText(e.target.value)}
            rows={3}
            placeholder="اكتب تفاصيل المشكلة ليتم توثيقها برقم الرحلة ومعالجتها من الإدارة..."
            className="w-full p-2.5 text-xs rounded-xl border border-slate-300"
          />
          <button type="button" onClick={handleSubmitDispute} className="w-full py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">
            إرسال البلاغ للإدارة
          </button>
        </div>
      )}

      {/* CUSTOMER RIDE HISTORY */}
      {rideHistory.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2">
          <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#A92224]" /> سجل رحلاتي ({rideHistory.length})
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {rideHistory.slice(0, 8).map((t) => (
              <div key={t.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-black text-slate-900">#{t.trip_number} · {t.vehicle_name_ar || t.vehicle_type}</div>
                  <div className="text-[11px] text-slate-600 truncate">{t.pickup_address} ← {t.dropoff_address}</div>
                </div>
                <div className="text-left shrink-0">
                  <div className="font-black text-[#A92224]">{t.final_fare ?? t.estimated_fare} ج.م</div>
                  <div className="text-[10px] text-slate-500">{t.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
