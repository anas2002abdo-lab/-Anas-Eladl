import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  Crosshair,
  DollarSign,
  ExternalLink,
  KeyRound,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Power,
  RefreshCw,
  ShieldAlert,
  Star,
  Wallet,
  XCircle,
} from 'lucide-react';
import { api } from '../../lib/api.ts';
import type { CaptainRecord, Language } from '../../shared/types.ts';

interface Props {
  captain: CaptainRecord;
  lang: Language;
  onOpenTripChat: (tripId: string) => void;
  onRefreshCore: () => Promise<void>;
  notify: (msg: string) => void;
}

const VEHICLE_LABELS: Record<string, string> = {
  car: 'سيارة',
  moto: 'موتوسيكل',
  tuktuk: 'توك توك',
};

const STATUS_LABELS: Record<string, { ar: string; badge: string }> = {
  accepted: { ar: 'متجه إلى العميل', badge: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  arrived: { ar: 'وصلت إلى نقطة الانطلاق', badge: 'bg-purple-100 text-purple-800 border-purple-200' },
  in_progress: { ar: 'الرحلة جارية نحو الوجهة', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  completed: { ar: 'مكتملة', badge: 'bg-green-100 text-green-800 border-green-200' },
  cancelled: { ar: 'ملغاة', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
};

function playOfferChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch {
    // ignore audio restrictions
  }
}

export function CaptainRidesPanel({ captain, lang, onOpenTripChat, onRefreshCore, notify }: Props) {
  const isAr = lang === 'ar';
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [subView, setSubView] = useState<'dispatch' | 'earnings'>('dispatch');
  const [mapConfig, setMapConfig] = useState<any>({
    tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
  });
  const [online, setOnline] = useState<boolean>(
    captain.availability_status === 'available' || captain.availability_status === 'busy'
  );
  const [driverLat, setDriverLat] = useState<number>(Number(captain.lat) || 31.1588);
  const [driverLng, setDriverLng] = useState<number>(Number(captain.lng) || 31.9369);
  const [offers, setOffers] = useState<any[]>([]);
  const [activeTrip, setActiveTrip] = useState<any | null>(null);
  const [earnings, setEarnings] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [waitingMinutes, setWaitingMinutes] = useState('0');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState('safety');
  const [disputeDesc, setDisputeDesc] = useState('');

  const isApproved = captain.verification_status === 'approved' && Boolean(captain.is_eligible_for_rides);

  useEffect(() => {
    setOnline(captain.availability_status === 'available' || captain.availability_status === 'busy');
    if (captain.lat && captain.lng) {
      setDriverLat(Number(captain.lat));
      setDriverLng(Number(captain.lng));
    }
  }, [captain.id, captain.availability_status, captain.lat, captain.lng]);

  // Countdown tick every second when offers exist
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadState = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [cfg, offersRes, earnRes] = await Promise.all([
        api.getRidesMapConfig().catch(() => null),
        api.getCaptainRideOffers().catch(() => ({ offers: [], active_trip: null })),
        api.getCaptainRideEarnings().catch(() => null),
      ]);
      if (cfg) setMapConfig(cfg);
      setOffers(offersRes?.offers || []);
      setActiveTrip(offersRes?.active_trip || null);
      if (earnRes) setEarnings(earnRes);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
    const poll = window.setInterval(() => {
      void loadState(true);
    }, 8000);
    return () => window.clearInterval(poll);
  }, [captain.id]);

  // WebSocket real-time connection for instant offers & ride status updates
  useEffect(() => {
    const token = localStorage.getItem('otlobha_jwt_captain') || localStorage.getItem('otlobha_jwt');
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/order-chat?channel=captain&captainId=${encodeURIComponent(captain.id)}`;
      ws = token ? new WebSocket(wsUrl, [`bearer.${token}`]) : new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ride:offer') {
            playOfferChime();
            notify(isAr ? 'وصلك طلب رحلة جديد!' : 'New ride offer received!');
            void loadState(true);
          } else if (
            [
              'ride:offer_expired',
              'ride:offer_cancelled',
              'trip:accepted',
              'trip:status',
              'trip:completed',
              'trip:cancelled',
            ].includes(msg.type)
          ) {
            void loadState(true);
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 3500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, [captain.id, activeTrip?.id]);

  // Live geolocation broadcast while online or on an active trip
  useEffect(() => {
    if (!online && !activeTrip) return;
    if (!navigator.geolocation) return;
    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setDriverLat(lat);
        setDriverLng(lng);
        const now = Date.now();
        if (now - lastSentAt < 6000) return;
        lastSentAt = now;
        if (activeTrip?.id && ['accepted', 'arrived', 'in_progress'].includes(activeTrip.status)) {
          api
            .updateRideLocation(activeTrip.id, {
              lat,
              lng,
              heading: pos.coords.heading ?? undefined,
              speed_kmh: pos.coords.speed ? Number((pos.coords.speed * 3.6).toFixed(1)) : undefined,
            })
            .catch(() => {});
        } else if (online && isApproved) {
          api.setCaptainRideAvailability({ availability_status: 'available', lat, lng }).catch(() => {});
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [online, isApproved, activeTrip?.id, activeTrip?.status]);

  // Initialize Leaflet OSM Map
  useEffect(() => {
    if (subView !== 'dispatch' || !mapElRef.current) return;
    if (!mapRef.current) {
      const m = L.map(mapElRef.current, { zoomControl: true }).setView([driverLat, driverLng], 14);
      L.tileLayer(mapConfig.tile_url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: mapConfig.attribution || '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(m);
      layerRef.current = L.layerGroup().addTo(m);
      m.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        setDriverLat(lat);
        setDriverLng(lng);
        if (activeTrip?.id && ['accepted', 'arrived', 'in_progress'].includes(activeTrip.status)) {
          api
            .updateRideLocation(activeTrip.id, { lat, lng })
            .then(() => notify(isAr ? 'تم تحديث موقعك المباشر للعميل' : 'Live location updated'))
            .catch(() => {});
        } else if (online && isApproved) {
          api
            .setCaptainRideAvailability({ availability_status: 'available', lat, lng })
            .then(() => notify(isAr ? 'تم تحديث موقع الكابتن على الخريطة' : 'Captain location updated'))
            .catch(() => {});
        }
      });
      mapRef.current = m;
    }

    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const bounds: L.LatLngExpression[] = [[driverLat, driverLng]];
    L.circleMarker([driverLat, driverLng], {
      radius: 10,
      color: '#ffffff',
      weight: 3,
      fillColor: '#A92224',
      fillOpacity: 1,
    })
      .bindPopup(`<b>${captain.full_name}</b><br/>موقعك الحالي`)
      .addTo(layer);

    if (activeTrip) {
      const pLat = activeTrip.pickup_lat != null ? Number(activeTrip.pickup_lat) : NaN;
      const pLng = activeTrip.pickup_lng != null ? Number(activeTrip.pickup_lng) : NaN;
      const dLat = activeTrip.dropoff_lat != null ? Number(activeTrip.dropoff_lat) : NaN;
      const dLng = activeTrip.dropoff_lng != null ? Number(activeTrip.dropoff_lng) : NaN;
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        bounds.push([pLat, pLng]);
        L.circleMarker([pLat, pLng], {
          radius: 9,
          color: '#ffffff',
          weight: 2,
          fillColor: '#059669',
          fillOpacity: 1,
        })
          .bindPopup(`<b>نقطة الانطلاق</b><br/>${activeTrip.pickup_address || ''}`)
          .addTo(layer);
      }
      if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
        bounds.push([dLat, dLng]);
        L.circleMarker([dLat, dLng], {
          radius: 9,
          color: '#ffffff',
          weight: 2,
          fillColor: '#EA580C',
          fillOpacity: 1,
        })
          .bindPopup(`<b>الوجهة</b><br/>${activeTrip.dropoff_address || ''}`)
          .addTo(layer);
      }

      if (activeTrip.route_geometry_json) {
        try {
          const parsed =
            typeof activeTrip.route_geometry_json === 'string'
              ? JSON.parse(activeTrip.route_geometry_json)
              : activeTrip.route_geometry_json;
          const coords: [number, number][] = Array.isArray(parsed)
            ? parsed.map((pt: any) => (Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.lat), Number(pt.lng)]))
            : [];
          if (coords.length > 1) {
            L.polyline(coords, { color: '#A92224', weight: 4, opacity: 0.85 }).addTo(layer);
            coords.forEach((c) => bounds.push(c));
          }
        } catch {
          // ignore invalid polyline
        }
      }
    }

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 16 });
    } else {
      map.setView([driverLat, driverLng], 14);
    }

    return () => {};
  }, [subView, driverLat, driverLng, activeTrip, mapConfig.tile_url, mapConfig.attribution, online, isApproved]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  const visibleOffers = useMemo(
    () =>
      offers.filter((o) => {
        if (!o.expires_at) return true;
        return new Date(o.expires_at).getTime() > nowMs;
      }),
    [offers, nowMs]
  );

  const handleToggleOnline = async () => {
    if (!isApproved) {
      notify(isAr ? 'لا يمكنك الاتصال قبل اعتماد حسابك ومركبتك من الإدارة' : 'Account must be approved by admin first');
      return;
    }
    const nextOnline = !online;
    setBusyAction('toggle');
    try {
      await api.setCaptainRideAvailability({
        availability_status: nextOnline ? 'available' : 'offline',
        lat: driverLat,
        lng: driverLng,
      });
      setOnline(nextOnline);
      notify(nextOnline ? 'أنت الآن متصل ومستعد لاستقبال المشاوير' : 'تم تحويل حالتك إلى غير متصل');
      await onRefreshCore();
    } catch (e: any) {
      notify(e?.message || 'تعذر تحديث حالة الاتصال');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      notify('المتصفح لا يدعم GPS');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setDriverLat(lat);
        setDriverLng(lng);
        try {
          if (activeTrip?.id && ['accepted', 'arrived', 'in_progress'].includes(activeTrip.status)) {
            await api.updateRideLocation(activeTrip.id, { lat, lng });
          } else if (online && isApproved) {
            await api.setCaptainRideAvailability({ availability_status: 'available', lat, lng });
          }
          notify('تم تحديد وتحديث موقعك الحالي بنجاح');
        } catch {
          notify('تم تحديد الإحداثيات محلياً');
        }
      },
      () => notify('يرجى السماح بالوصول إلى الموقع الجغرافي')
    );
  };

  const handleAcceptOffer = async (offerId: string) => {
    setBusyAction(`accept:${offerId}`);
    try {
      await api.acceptRideOffer(offerId);
      notify('تم قبول الرحلة بنجاح! توجه الآن إلى نقطة الانطلاق');
      await Promise.all([loadState(true), onRefreshCore()]);
    } catch (e: any) {
      notify(e?.message || 'تعذر قبول العرض — ربما انتهت مهلته أو قبله كابتن آخر');
      await loadState(true);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRejectOffer = async (offerId: string) => {
    setBusyAction(`reject:${offerId}`);
    try {
      await api.rejectRideOffer(offerId);
      notify('تم رفض الطلب وسيتم تحويله لأقرب سائق آخر');
      await loadState(true);
    } catch (e: any) {
      notify(e?.message || 'تعذر رفض الطلب');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMarkArrived = async () => {
    if (!activeTrip?.id) return;
    setBusyAction('arrived');
    try {
      await api.markRideArrived(activeTrip.id);
      notify('تم إشعار العميل بوصولك — اطلب منه رمز البدء المكون من 4 أرقام');
      await loadState(true);
    } catch (e: any) {
      notify(e?.message || 'تعذر تحديث الحالة');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartRide = async () => {
    if (!activeTrip?.id) return;
    if (!/^\d{4}$/.test(otpInput.trim())) {
      notify('يرجى إدخال رمز بدء الرحلة المكون من 4 أرقام');
      return;
    }
    setBusyAction('start');
    try {
      await api.startRideWithOtp(activeTrip.id, otpInput.trim());
      setOtpInput('');
      notify('تم التحقق من الرمز وبدأت الرحلة بنجاح!');
      await loadState(true);
    } catch (e: any) {
      notify(e?.message || 'رمز البدء غير صحيح');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCompleteRide = async () => {
    if (!activeTrip?.id) return;
    setBusyAction('complete');
    try {
      const res = await api.completeRideV2(activeTrip.id, {
        waiting_minutes: Number(waitingMinutes) || 0,
      });
      setWaitingMinutes('0');
      notify(
        `تم إنهاء الرحلة! الأجرة النهائية: ${res.final_fare} ج.م · صافي ربحك: ${res.driver_net_earnings} ج.م`
      );
      await Promise.all([loadState(true), onRefreshCore()]);
    } catch (e: any) {
      notify(e?.message || 'تعذر إنهاء الرحلة');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelRide = async () => {
    if (!activeTrip?.id) return;
    setBusyAction('cancel');
    try {
      await api.cancelRideV2(activeTrip.id, 'cancelled_by_captain');
      notify('تم إلغاء الرحلة');
      await Promise.all([loadState(true), onRefreshCore()]);
    } catch (e: any) {
      notify(e?.message || 'تعذر إلغاء الرحلة');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmitDispute = async () => {
    if (!activeTrip?.id || !disputeDesc.trim()) {
      notify('يرجى كتابة تفاصيل البلاغ');
      return;
    }
    setBusyAction('dispute');
    try {
      await api.reportRideDispute(activeTrip.id, disputeCategory, disputeDesc.trim());
      setDisputeDesc('');
      setDisputeModalOpen(false);
      notify('تم تسجيل البلاغ وإرساله لإدارة المشاوير فوراً');
    } catch (e: any) {
      notify(e?.message || 'تعذر إرسال البلاغ');
    } finally {
      setBusyAction(null);
    }
  };

  const openExternalNav = () => {
    if (!activeTrip) return;
    const isGoingToDropoff = activeTrip.status === 'in_progress';
    const targetLat = isGoingToDropoff ? activeTrip.dropoff_lat : activeTrip.pickup_lat;
    const targetLng = isGoingToDropoff ? activeTrip.dropoff_lng : activeTrip.pickup_lng;
    if (targetLat == null || targetLng == null || !Number.isFinite(Number(targetLat)) || !Number.isFinite(Number(targetLng))) {
      notify('وجهة العميل مكتوبة يدوياً بدون إحداثيات على الخريطة — يرجى التواصل مع العميل لتحديد الموقع بدقة');
      return;
    }
    const url = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${driverLat}%2C${driverLng}%3B${targetLat}%2C${targetLng}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const todaySummary = earnings?.periods?.today || { rides_count: 0, net_earnings: 0, gross_fare: 0 };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header Bar */}
      <div className="bg-gradient-to-l from-[#A92224] to-[#86191B] text-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center">
            <Car className="w-6 h-6 text-[#F5A623]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-extrabold">اطلبها كابتن — نظام المشاوير</h3>
              <span className="px-2 py-0.5 rounded-md bg-white/15 text-[11px] font-bold">
                {VEHICLE_LABELS[captain.vehicle_type] || captain.vehicle_type}
              </span>
              {captain.plate_number && (
                <span className="px-2 py-0.5 rounded-md bg-black/25 text-[11px] font-mono-num">
                  {captain.plate_number}
                </span>
              )}
            </div>
            <p className="text-xs text-white/85 flex items-center gap-3 mt-0.5">
              <span className="inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-[#F5A623] fill-[#F5A623]" />
                {Number(captain.rating_avg || 5).toFixed(2)}
              </span>
              <span>مشاوير اليوم: {todaySummary.rides_count}</span>
              <span>صافي اليوم: {Number(todaySummary.net_earnings || 0).toFixed(2)} ج.م</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busyAction === 'toggle' || !isApproved}
            onClick={handleToggleOnline}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition shadow-sm ${
              !isApproved
                ? 'bg-slate-600/60 text-white/70 cursor-not-allowed'
                : online
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-white text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Power className="w-4 h-4" />
            <span>{online ? 'متصل — يستقبل رحلات' : 'غير متصل — اضغط للاتصال'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 bg-slate-50">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('dispatch')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold ${
              subView === 'dispatch' ? 'bg-[#A92224] text-white' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            الخريطة والطلبات ({visibleOffers.length + (activeTrip ? 1 : 0)})
          </button>
          <button
            type="button"
            onClick={() => setSubView('earnings')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${
              subView === 'earnings' ? 'bg-[#A92224] text-white' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>الأرباح والمحفظة المالية</span>
          </button>
        </div>
        <button
          type="button"
          onClick={handleDetectGps}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#A92224] hover:underline"
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>تحديث موقعي GPS</span>
        </button>
      </div>

      {/* Approval Gate Banner */}
      {!isApproved && (
        <div className="m-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-extrabold">حسابك بانتظار اعتماد إدارة المشاوير</p>
            <p className="text-amber-900">
              حالة الحساب الحالية: <strong>{captain.verification_status}</strong> — لا يمكنك استقبال أو قبول رحلات قبل مراجعة مستنداتك
              واعتماد فئة مركبتك من لوحة الإدارة.
            </p>
          </div>
        </div>
      )}

      {subView === 'dispatch' ? (
        <div className="p-4 space-y-4">
          {/* Incoming Timed Ride Offers */}
          {visibleOffers.length > 0 && (
            <div className="space-y-3">
              {visibleOffers.map((offer) => {
                const remainSec = offer.expires_at
                  ? Math.max(0, Math.ceil((new Date(offer.expires_at).getTime() - nowMs) / 1000))
                  : 30;
                return (
                  <div
                    key={offer.id}
                    className="p-4 rounded-2xl border-2 border-[#A92224] bg-rose-50/70 space-y-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-[#A92224] text-white text-xs font-extrabold">
                          طلب رحلة جديد
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {VEHICLE_LABELS[offer.vehicle_type] || offer.vehicle_type}
                        </span>
                        {offer.distance_to_pickup_km != null && (
                          <span className="text-xs text-slate-600">
                            يبعد {Number(offer.distance_to_pickup_km).toFixed(1)} كم عنك
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-extrabold font-mono-num">
                        <Clock className="w-3.5 h-3.5" />
                        {remainSec} ث
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                        <p className="text-[11px] text-emerald-700 font-bold">نقطة الانطلاق</p>
                        <p className="font-semibold text-slate-900 mt-0.5">{offer.pickup_address}</p>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                        <p className="text-[11px] text-orange-700 font-bold">الوجهة</p>
                        <p className="font-semibold text-slate-900 mt-0.5">{offer.dropoff_address}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white p-3 rounded-xl border border-slate-200">
                      <span className="text-slate-700">
                        العميل: <strong>{offer.customer_name}</strong>
                      </span>
                      <span className="text-slate-700">
                        المسافة: <strong>{Number(offer.distance_km || 0).toFixed(1)} كم</strong> ·{' '}
                        {offer.estimated_duration_min || 10} د
                      </span>
                      <span className="text-[#A92224] font-extrabold text-sm">
                        الأجرة: {Number(offer.estimated_fare || 0).toFixed(2)} ج.م
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleAcceptOffer(offer.id)}
                        className="py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5"
                      >
                        {busyAction === `accept:${offer.id}` ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        <span>قبول الرحلة الآن</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleRejectOffer(offer.id)}
                        className="py-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4 text-rose-600" />
                        <span>رفض</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Ride Stepper Card */}
          {activeTrip && (
            <div className="p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50/40 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono-num font-extrabold text-slate-900 text-sm">
                    {activeTrip.trip_number}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${
                      STATUS_LABELS[activeTrip.status]?.badge || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {STATUS_LABELS[activeTrip.status]?.ar || activeTrip.status}
                  </span>
                </div>
                <span className="text-sm font-extrabold text-[#A92224]">
                  {Number(activeTrip.final_fare ?? activeTrip.estimated_fare ?? 0).toFixed(2)} ج.م ·{' '}
                  {activeTrip.payment_method === 'online' ? 'دفع إلكتروني' : 'نقداً'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                  <p className="font-bold text-slate-900">العميل: {activeTrip.customer_name}</p>
                  <p className="text-slate-600 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>الانطلاق: {activeTrip.pickup_address}</span>
                  </p>
                  <p className="text-slate-600 flex items-center gap-1">
                    <Navigation className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    <span>الوجهة: {activeTrip.dropoff_address}</span>
                  </p>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200 flex flex-wrap items-center gap-2 content-center">
                  {activeTrip.customer_phone && (
                    <a
                      href={`tel:${activeTrip.customer_phone}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>اتصال بالعميل</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenTripChat(activeTrip.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#F5A623]" />
                    <span>محادثة العميل</span>
                  </button>
                  <button
                    type="button"
                    onClick={openExternalNav}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>ملاحة خارجية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisputeModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>إبلاغ / طوارئ</span>
                  </button>
                </div>
              </div>

              {/* Action Controls by State */}
              {activeTrip.status === 'accepted' && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleMarkArrived}
                    className="flex-1 py-3 bg-[#A92224] hover:bg-[#86191B] disabled:opacity-60 text-white rounded-xl text-xs font-extrabold"
                  >
                    {busyAction === 'arrived' ? 'جاري التحديث...' : 'وصلت إلى نقطة الانطلاق'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleCancelRide}
                    className="px-4 py-3 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-xl text-xs font-bold"
                  >
                    إلغاء الرحلة
                  </button>
                </div>
              )}

              {activeTrip.status === 'arrived' && (
                <div className="p-3.5 bg-white rounded-xl border border-purple-200 space-y-2.5">
                  <p className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-purple-600" />
                    <span>أدخل رمز بدء الرحلة (4 أرقام) الظاهر لدى العميل للتحقق وبدء المشوار</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      dir="ltr"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                      className="w-32 px-3 py-2.5 border-2 border-purple-300 rounded-xl text-center text-base font-extrabold tracking-[0.35em] font-mono-num"
                    />
                    <button
                      type="button"
                      disabled={busyAction !== null || otpInput.length !== 4}
                      onClick={handleStartRide}
                      className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold"
                    >
                      {busyAction === 'start' ? 'جاري التحقق...' : 'تأكيد الرمز وبدء الرحلة'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleCancelRide}
                      className="px-3.5 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-xl text-xs font-bold"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              {activeTrip.status === 'in_progress' && (
                <div className="p-3.5 bg-white rounded-xl border border-emerald-200 flex flex-wrap items-center gap-2.5">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <span>دقائق الانتظار (إن وجدت):</span>
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={waitingMinutes}
                      onChange={(e) => setWaitingMinutes(e.target.value)}
                      className="w-20 px-2.5 py-2 border border-slate-300 rounded-lg text-center font-mono-num"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleCompleteRide}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs font-extrabold"
                  >
                    {busyAction === 'complete' ? 'جاري احتساب الأجرة النهائية...' : 'إنهاء الرحلة وتأكيد الوصول'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Live OSM Map */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>خريطة الموقع والمسار (اضغط على الخريطة لتحديث إحداثياتك المباشرة)</span>
              <span className="font-mono-num">
                {driverLat.toFixed(5)}, {driverLng.toFixed(5)}
              </span>
            </div>
            <div ref={mapElRef} className="w-full h-72 rounded-2xl border border-slate-200 overflow-hidden z-0" />
            <p className="text-[10px] text-slate-500 text-left" dir="ltr">
              {mapConfig.attribution || '© OpenStreetMap contributors'}
            </p>
          </div>
        </div>
      ) : (
        /* Earnings & Ledger Tab */
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'أرباح اليوم (صافي)', data: earnings?.periods?.today },
              { label: 'أرباح الأسبوع', data: earnings?.periods?.week },
              { label: 'أرباح الشهر', data: earnings?.periods?.month },
              { label: 'الإجمالي الكلي', data: earnings?.periods?.all_time },
            ].map((card) => (
              <div key={card.label} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold">{card.label}</p>
                <p className="text-lg font-extrabold text-[#A92224] mt-1 font-mono-num">
                  {Number(card.data?.net_earnings || 0).toFixed(2)} ج.م
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {card.data?.rides_count || 0} رحلة · عمولة {Number(card.data?.commission || 0).toFixed(2)} ج.م
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-[#A92224]" />
              <span>سجل الرحلات المكتملة والقيود المالية</span>
            </h4>
            {(earnings?.recent_trips || []).length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-xl">
                لا توجد رحلات مكتملة بعد في سجلك.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">الرحلة</th>
                      <th className="p-2.5">المسار</th>
                      <th className="p-2.5">الأجرة</th>
                      <th className="p-2.5">عمولة المنصة</th>
                      <th className="p-2.5">صافي السائق</th>
                      <th className="p-2.5">التقييم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(earnings?.recent_trips || []).map((t: any) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono-num font-bold">{t.trip_number}</td>
                        <td className="p-2.5 max-w-[220px] truncate">
                          {t.pickup_address} ← {t.dropoff_address}
                        </td>
                        <td className="p-2.5 font-mono-num">{Number(t.final_fare || 0).toFixed(2)} ج.م</td>
                        <td className="p-2.5 font-mono-num text-rose-700">
                          -{Number(t.platform_commission || 0).toFixed(2)} ج.م
                        </td>
                        <td className="p-2.5 font-mono-num font-bold text-emerald-700">
                          +{Number(t.driver_net_earnings || 0).toFixed(2)} ج.م
                        </td>
                        <td className="p-2.5">{t.customer_rating ? `${t.customer_rating} ★` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Emergency / Dispute Modal */}
      {disputeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-xl">
            <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>الإبلاغ عن مشكلة أو طارئ في الرحلة</span>
            </h4>
            <select
              value={disputeCategory}
              onChange={(e) => setDisputeCategory(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
            >
              <option value="safety">طارئ أمني / سلامة</option>
              <option value="payment">مشكلة في الدفع أو الأجرة</option>
              <option value="behavior">سلوك العميل</option>
              <option value="other">مشكلة أخرى</option>
            </select>
            <textarea
              rows={3}
              value={disputeDesc}
              onChange={(e) => setDisputeDesc(e.target.value)}
              placeholder="اشرح المشكلة بالتفصيل ليتم التعامل معها من الإدارة..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDisputeModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busyAction === 'dispute'}
                onClick={handleSubmitDispute}
                className="px-4 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold"
              >
                إرسال البلاغ للإدارة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
