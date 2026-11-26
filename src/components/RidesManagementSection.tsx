import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  DollarSign,
  History,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Star,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CaptainRecord, Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  captains: CaptainRecord[];
  onRefreshCore: () => Promise<void>;
  notify: (msg: string) => void;
}

type SubTab = 'dashboard' | 'trips' | 'drivers_vehicles' | 'pricing_dispatch' | 'disputes_finance';

const STATUS_LABELS: Record<string, { ar: string; color: string }> = {
  searching: { ar: 'جاري البحث عن سائق', color: 'bg-amber-100 text-amber-800' },
  offered: { ar: 'معروضة على سائق', color: 'bg-sky-100 text-sky-800' },
  accepted: { ar: 'تم القبول — السائق قادم', color: 'bg-indigo-100 text-indigo-800' },
  arrived: { ar: 'وصل السائق للعميل', color: 'bg-purple-100 text-purple-800' },
  in_progress: { ar: 'الرحلة جارية', color: 'bg-emerald-100 text-emerald-800' },
  completed: { ar: 'مكتملة', color: 'bg-green-100 text-green-800' },
  cancelled: { ar: 'ملغاة', color: 'bg-rose-100 text-rose-800' },
  no_driver: { ar: 'لا يوجد سائق متاح', color: 'bg-slate-200 text-slate-700' },
  expired: { ar: 'منتهية الصلاحية', color: 'bg-slate-200 text-slate-700' },
};

const VEHICLE_LABELS: Record<string, string> = {
  car: 'سيارة',
  moto: 'موتوسيكل',
  tuktuk: 'توك توك',
};

function LiveAdminRidesMap({
  drivers,
  activeTrips,
  tileUrl,
  attribution,
  onSelectDriver,
}: {
  drivers: any[];
  activeTrips: any[];
  tileUrl: string;
  attribution: string;
  onSelectDriver: (d: any) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [31.1583, 31.9369],
      zoom: 13,
      attributionControl: true,
    });
    L.tileLayer(tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: attribution || '© OpenStreetMap contributors',
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
  }, [tileUrl, attribution]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: Array<[number, number]> = [];

    for (const d of drivers) {
      const lat = Number(d.lat);
      const lng = Number(d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      bounds.push([lat, lng]);
      const color =
        d.availability_status === 'busy'
          ? '#7C3AED'
          : d.availability_status === 'available'
          ? '#059669'
          : '#64748B';
      const vLabel = VEHICLE_LABELS[String(d.vehicle_type)] || String(d.vehicle_type);
      const icon = L.divIcon({
        className: 'otlobha-admin-driver-pin',
        html: `<div style="transform:translate(-50%,-100%);background:${color};color:#fff;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.25);white-space:nowrap;">${vLabel} · ${String(d.full_name || '').split(' ')[0]}</div>`,
        iconSize: [0, 0],
      });
      const marker = L.marker([lat, lng], { icon }).addTo(layer);
      marker.on('click', () => onSelectDriver(d));
    }

    for (const t of activeTrips) {
      const pLat = Number(t.pickup_lat);
      const pLng = Number(t.pickup_lng);
      const dLat = Number(t.dropoff_lat);
      const dLng = Number(t.dropoff_lng);
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        bounds.push([pLat, pLng]);
        L.circleMarker([pLat, pLng], { radius: 6, color: '#A92224', fillColor: '#A92224', fillOpacity: 0.9 })
          .bindTooltip(`انطلاق #${t.trip_number}`)
          .addTo(layer);
      }
      if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
        bounds.push([dLat, dLng]);
        L.circleMarker([dLat, dLng], { radius: 6, color: '#F5A623', fillColor: '#F5A623', fillOpacity: 0.9 })
          .bindTooltip(`وجهة #${t.trip_number}`)
          .addTo(layer);
      }
      if (Array.isArray(t.route_points) && t.route_points.length > 1) {
        L.polyline(t.route_points, { color: '#A92224', weight: 3, opacity: 0.75 }).addTo(layer);
      }
    }

    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
      } catch {
        // ignore
      }
    }
  }, [drivers, activeTrips, onSelectDriver]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
      <div ref={containerRef} className="w-full h-[380px] z-0" />
      <div className="absolute bottom-2 right-2 z-[400] bg-white/95 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 shadow-sm">
        بيانات الخرائط © مساهمو OpenStreetMap
      </div>
    </div>
  );
}

export function RidesManagementSection({ captains, onRefreshCore, notify }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [loading, setLoading] = useState(false);

  // Dashboard & Live Map
  const [kpi, setKpi] = useState<Record<string, number>>({});
  const [liveDrivers, setLiveDrivers] = useState<any[]>([]);
  const [liveActiveTrips, setLiveActiveTrips] = useState<any[]>([]);
  const [mapConfig, setMapConfig] = useState<any>({});
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null);

  // Trips table
  const [trips, setTrips] = useState<any[]>([]);
  const [tripQuery, setTripQuery] = useState('');
  const [tripStatusFilter, setTripStatusFilter] = useState('all');
  const [tripVehFilter, setTripVehFilter] = useState('all');
  const [tripDateFrom, setTripDateFrom] = useState('');
  const [tripDateTo, setTripDateTo] = useState('');
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);

  // Vehicles & Pricing & Dispatch
  const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);
  const [newVehicle, setNewVehicle] = useState({ code: '', name_ar: '', name_en: '', max_passengers: 4, routing_profile: 'car' });
  const [fareSettings, setFareSettings] = useState<any[]>([]);
  const [fareHistory, setFareHistory] = useState<any[]>([]);
  const [fareReason, setFareReason] = useState('');
  const [dispatchCfg, setDispatchCfg] = useState<any>(null);

  // Disputes & Finance
  const [disputes, setDisputes] = useState<any[]>([]);
  const [finReport, setFinReport] = useState<any>(null);
  const [finDateFrom, setFinDateFrom] = useState('');
  const [finDateTo, setFinDateTo] = useState('');
  const [disputeDecisions, setDisputeDecisions] = useState<Record<string, string>>({});

  const loadAll = async () => {
    setLoading(true);
    try {
      const [dashRes, mapRes, tripsRes, vehRes, fareRes, dispCfgRes, dispRes, finRes] = await Promise.allSettled([
        api.getAdminRidesDashboard(),
        api.getAdminRidesLiveMap(),
        api.getAdminRidesTrips({
          q: tripQuery || undefined,
          status: tripStatusFilter !== 'all' ? tripStatusFilter : undefined,
          vehicle_type: tripVehFilter !== 'all' ? tripVehFilter : undefined,
          date_from: tripDateFrom || undefined,
          date_to: tripDateTo || undefined,
        }),
        api.getAdminRideVehicleTypes(),
        api.getAdminRideFareSettings(),
        api.getAdminRideDispatchConfig(),
        api.getAdminRideDisputes(),
        api.getAdminRideFinancialReport({
          date_from: finDateFrom || undefined,
          date_to: finDateTo || undefined,
        }),
      ]);
      if (dashRes.status === 'fulfilled') setKpi(dashRes.value || {});
      if (mapRes.status === 'fulfilled') {
        setLiveDrivers(mapRes.value?.drivers || []);
        setLiveActiveTrips(mapRes.value?.active_trips || []);
        setMapConfig(mapRes.value?.map_config || {});
      }
      if (tripsRes.status === 'fulfilled') setTrips(tripsRes.value?.trips || []);
      if (vehRes.status === 'fulfilled') setVehicleTypes(vehRes.value?.vehicle_types || []);
      if (fareRes.status === 'fulfilled') {
        setFareSettings(fareRes.value?.settings || []);
        setFareHistory(fareRes.value?.history || []);
      }
      if (dispCfgRes.status === 'fulfilled') setDispatchCfg(dispCfgRes.value?.config || null);
      if (dispRes.status === 'fulfilled') setDisputes(dispRes.value?.disputes || []);
      if (finRes.status === 'fulfilled') setFinReport(finRes.value || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => {
      void api.getAdminRidesDashboard().then(setKpi).catch(() => {});
      void api
        .getAdminRidesLiveMap()
        .then((m) => {
          setLiveDrivers(m.drivers || []);
          setLiveActiveTrips(m.active_trips || []);
        })
        .catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, []);

  const handleSaveFare = async (row: any) => {
    try {
      await api.updateAdminRideFareSetting(row.vehicle_type, {
        base_fare: Number(row.base_fare),
        per_km_rate: Number(row.per_km_rate),
        per_min_rate: Number(row.per_min_rate),
        min_fare: Number(row.min_fare),
        waiting_grace_min: Number(row.waiting_grace_min),
        waiting_per_min_rate: Number(row.waiting_per_min_rate),
        cancellation_fee: Number(row.cancellation_fee),
        commission_rate: Number(row.commission_rate),
        tax_rate: Number(row.tax_rate),
        extra_fee: Number(row.extra_fee),
        extra_fee_label_ar: String(row.extra_fee_label_ar || ''),
        is_active: Boolean(row.is_active),
        reason: fareReason.trim() || `تحديث تعريفة ${row.name_ar || row.vehicle_type}`,
      });
      setFareReason('');
      notify(`تم حفظ تعريفة ${row.name_ar || row.vehicle_type} وتوثيقها في سجل التغييرات`);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر حفظ التسعير');
    }
  };

  const handleSaveDispatchConfig = async () => {
    if (!dispatchCfg) return;
    try {
      await api.updateAdminRideDispatchConfig(dispatchCfg);
      notify('تم حفظ إعدادات محرك التوزيع التلقائي للرحلات بنجاح');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر حفظ إعدادات التوزيع');
    }
  };

  const handleToggleVehicle = async (vt: any) => {
    try {
      await api.updateAdminRideVehicleType(vt.code, { is_active: !vt.is_active });
      notify(`تم ${!vt.is_active ? 'تفعيل' : 'إيقاف'} فئة ${vt.name_ar}`);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر تحديث فئة المركبة');
    }
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicle.code.trim() || !newVehicle.name_ar.trim()) return;
    try {
      await api.createAdminRideVehicleType(newVehicle);
      setNewVehicle({ code: '', name_ar: '', name_en: '', max_passengers: 4, routing_profile: 'car' });
      notify('تمت إضافة فئة المركبة الجديدة بنجاح');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر إضافة الفئة');
    }
  };

  const handleDriverAction = async (captainId: string, status: 'approved' | 'rejected' | 'suspended', reason?: string) => {
    try {
      await api.updateCaptainStatus(captainId, {
        verification_status: status,
        is_eligible_for_rides: status === 'approved',
        rejection_reason: reason,
      });
      notify(status === 'approved' ? 'تم اعتماد السائق وتفعيل استقبال المشاوير' : 'تم تحديث حالة السائق');
      await Promise.all([onRefreshCore(), loadAll()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر تحديث حالة السائق');
    }
  };

  const handleResolveDispute = async (id: string, status: 'in_review' | 'resolved' | 'rejected') => {
    try {
      await api.updateAdminRideDispute(id, {
        status,
        admin_decision: disputeDecisions[id] || 'تمت المراجعة واتخاذ القرار الإداري',
      });
      notify('تم تحديث حالة الشكوى وتسجيل قرار الإدارة');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر تحديث الشكوى');
    }
  };

  const tabs: Array<{ id: SubTab; label: string; icon: any }> = [
    { id: 'dashboard', label: 'المؤشرات والخريطة الحية', icon: Navigation },
    { id: 'trips', label: `سجل الرحلات (${trips.length})`, icon: Car },
    { id: 'drivers_vehicles', label: 'السائقون والمركبات', icon: Users },
    { id: 'pricing_dispatch', label: 'الأسعار والتوزيع التلقائي', icon: Sliders },
    { id: 'disputes_finance', label: 'الشكاوى والتقارير المالية', icon: DollarSign },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#A92224] text-white flex items-center justify-center shadow-sm">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">إدارة المشاوير — اطلبها</h2>
            <p className="text-xs text-slate-500">
              محرك توزيع مركزي فوري · تسعير لكل مركبة · خرائط OpenStreetMap وOSRM الحية · تقارير مالية وشكاوى
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-2 hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث البيانات الحية
        </button>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 border transition cursor-pointer ${
                active
                  ? 'bg-[#A92224] text-white border-[#A92224] shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-[#A92224]/40'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: KPIs + LIVE MAP */}
      {subTab === 'dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'رحلات اليوم', val: kpi.trips_today ?? 0, tone: 'text-slate-900' },
              { label: 'رحلات نشطة الآن', val: kpi.active_trips ?? 0, tone: 'text-[#A92224]' },
              { label: 'رحلات مكتملة', val: kpi.completed_trips ?? 0, tone: 'text-emerald-700' },
              { label: 'رحلات ملغاة', val: kpi.cancelled_trips ?? 0, tone: 'text-rose-700' },
              { label: 'متوسط تقييم السائقين', val: `${kpi.avg_driver_rating ?? 5} ★`, tone: 'text-amber-600' },
              { label: 'سائقون متصلون', val: kpi.online_drivers ?? 0, tone: 'text-emerald-700' },
              { label: 'سائقون غير متصلين', val: kpi.offline_drivers ?? 0, tone: 'text-slate-600' },
              { label: 'إجمالي قيمة الرحلات', val: `${kpi.total_rides_gmv ?? 0} ج.م`, tone: 'text-slate-900' },
              { label: 'عمولات المنصة', val: `${kpi.platform_commissions ?? 0} ج.م`, tone: 'text-[#A92224]' },
              { label: 'مستحقات السائقين', val: `${kpi.driver_payables ?? 0} ج.م`, tone: 'text-indigo-700' },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500">{item.label}</div>
                <div className={`text-xl font-black mt-1 ${item.tone}`}>{item.val}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#A92224]" />
                  الخريطة الحية للسائقين والرحلات النشطة
                </h3>
                <div className="flex items-center gap-3 text-[11px] font-bold">
                  <span className="flex items-center gap-1 text-emerald-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> متاح
                  </span>
                  <span className="flex items-center gap-1 text-purple-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-600" /> في رحلة
                  </span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> غير متصل
                  </span>
                </div>
              </div>
              <LiveAdminRidesMap
                drivers={liveDrivers}
                activeTrips={liveActiveTrips}
                tileUrl={mapConfig.tile_url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
                attribution={mapConfig.attribution || '© OpenStreetMap contributors'}
                onSelectDriver={setSelectedDriver}
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
              <h3 className="text-sm font-black text-slate-900">تفاصيل السائق / الرحلات الجارية</h3>
              {selectedDriver ? (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-sm">{selectedDriver.full_name}</span>
                    <span className="font-bold text-amber-600">{selectedDriver.rating_avg} ★</span>
                  </div>
                  <div className="text-slate-600">الهاتف: {selectedDriver.phone}</div>
                  <div className="text-slate-600">
                    المركبة: {VEHICLE_LABELS[selectedDriver.vehicle_type] || selectedDriver.vehicle_type} · {selectedDriver.vehicle_model} ({selectedDriver.plate_number})
                  </div>
                  <div className="text-slate-600">الحالة: {selectedDriver.availability_status}</div>
                  {selectedDriver.active_trip_number && (
                    <div className="text-[#A92224] font-bold">الرحلة النشطة: #{selectedDriver.active_trip_number}</div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-dashed border-slate-300">
                  اضغط على أي سائق في الخريطة لعرض بياناته المباشرة ورحلته الحالية.
                </div>
              )}

              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                <div className="text-xs font-black text-slate-700">الرحلات النشطة ({liveActiveTrips.length})</div>
                {liveActiveTrips.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4 text-center">لا توجد رحلات نشطة في هذه اللحظة</div>
                ) : (
                  liveActiveTrips.map((t) => {
                    const st = STATUS_LABELS[t.status] || { ar: t.status, color: 'bg-slate-100 text-slate-700' };
                    return (
                      <div key={t.id} className="p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-black text-slate-900">#{t.trip_number}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${st.color}`}>{st.ar}</span>
                        </div>
                        <div className="text-slate-600 truncate">من: {t.pickup_address}</div>
                        <div className="text-slate-600 truncate">إلى: {t.dropoff_address}</div>
                        <div className="flex justify-between text-[11px] font-bold text-slate-700">
                          <span>{VEHICLE_LABELS[t.vehicle_type] || t.vehicle_type} · {t.distance_km} كم</span>
                          <span className="text-[#A92224]">{t.final_fare ?? t.estimated_fare} ج.م</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TRIPS MANAGEMENT TABLE */}
      {subTab === 'trips' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5">
            <div className="md:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                value={tripQuery}
                onChange={(e) => setTripQuery(e.target.value)}
                placeholder="بحث برقم الرحلة أو العميل أو السائق أو العنوان..."
                className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
            <select
              value={tripStatusFilter}
              onChange={(e) => setTripStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="all">كل الحالات</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.ar}</option>
              ))}
            </select>
            <select
              value={tripVehFilter}
              onChange={(e) => setTripVehFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="all">كل المركبات</option>
              <option value="car">سيارة</option>
              <option value="moto">موتوسيكل</option>
              <option value="tuktuk">توك توك</option>
            </select>
            <input type="date" value={tripDateFrom} onChange={(e) => setTripDateFrom(e.target.value)} className="px-2 py-2 text-xs rounded-xl border border-slate-300" />
            <button
              type="button"
              onClick={() => void loadAll()}
              className="px-3 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold hover:bg-[#86191B] cursor-pointer"
            >
              تطبيق التصفية
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 font-bold border-y border-slate-200">
                <tr>
                  <th className="p-2.5">رقم الرحلة</th>
                  <th className="p-2.5">العميل</th>
                  <th className="p-2.5">السائق</th>
                  <th className="p-2.5">المركبة</th>
                  <th className="p-2.5">الانطلاق ← الوجهة</th>
                  <th className="p-2.5">المسافة</th>
                  <th className="p-2.5">الأجرة</th>
                  <th className="p-2.5">الحالة</th>
                  <th className="p-2.5">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map((t) => {
                  const st = STATUS_LABELS[t.status] || { ar: t.status, color: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTrip(t)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="p-2.5 font-black text-slate-900">#{t.trip_number}</td>
                      <td className="p-2.5">
                        <div className="font-bold">{t.customer_name}</div>
                        <div className="text-[10px] text-slate-400">{t.customer_phone}</div>
                      </td>
                      <td className="p-2.5">{t.captain_name || '—'}</td>
                      <td className="p-2.5 font-bold">{VEHICLE_LABELS[t.vehicle_type] || t.vehicle_type}</td>
                      <td className="p-2.5 max-w-[220px] truncate">{t.pickup_address} ← {t.dropoff_address}</td>
                      <td className="p-2.5">{t.distance_km} كم</td>
                      <td className="p-2.5 font-black text-[#A92224]">{t.final_fare ?? t.estimated_fare} ج.م</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${st.color}`}>{st.ar}</span>
                      </td>
                      <td className="p-2.5 text-[10px] text-slate-500">{String(t.created_at || '').slice(0, 16)}</td>
                    </tr>
                  );
                })}
                {trips.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-slate-400">لا توجد رحلات مطابقة للبحث</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedTrip && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-sm text-slate-900">تفاصيل الرحلة #{selectedTrip.trip_number}</h4>
                <button type="button" onClick={() => setSelectedTrip(null)} className="text-xs font-bold text-slate-500 cursor-pointer">إغلاق</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div><span className="text-slate-500">الأجرة النهائية:</span> <strong>{selectedTrip.final_fare ?? selectedTrip.estimated_fare} ج.م</strong></div>
                <div><span className="text-slate-500">عمولة المنصة:</span> <strong>{selectedTrip.commission_amount ?? 0} ج.م ({selectedTrip.commission_rate ?? 0}%)</strong></div>
                <div><span className="text-slate-500">صافي السائق:</span> <strong>{selectedTrip.driver_net_earnings ?? 0} ج.م</strong></div>
                <div><span className="text-slate-500">التحقق بـ OTP:</span> <strong>{selectedTrip.start_otp_verified ? 'تم التحقق ✓' : 'لم يبدأ'}</strong></div>
              </div>
              {Array.isArray(selectedTrip.status_history) && selectedTrip.status_history.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-black text-slate-700">سجل حالات الرحلة:</div>
                  {selectedTrip.status_history.map((h: any) => (
                    <div key={h.id} className="text-[11px] text-slate-600 flex items-center gap-2">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className="font-bold">{h.to_status}</span>
                      <span>— {h.note || h.actor_name}</span>
                      <span className="text-slate-400 ms-auto">{String(h.created_at || '').slice(0, 19)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DRIVERS & VEHICLE TYPES */}
      {subTab === 'drivers_vehicles' && (
        <div className="space-y-5">
          {/* Drivers list */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
            <h3 className="text-sm font-black text-slate-900">إدارة السائقين واعتماد الحسابات والمستندات</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 font-bold border-y border-slate-200">
                  <tr>
                    <th className="p-2.5">السائق</th>
                    <th className="p-2.5">المركبة واللوحة</th>
                    <th className="p-2.5">المستندات</th>
                    <th className="p-2.5">التقييم والرحلات</th>
                    <th className="p-2.5">الحالة</th>
                    <th className="p-2.5">إجراءات الإدارة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {captains.map((c) => (
                    <tr key={c.id}>
                      <td className="p-2.5">
                        <div className="font-bold text-slate-900">{c.full_name}</div>
                        <div className="text-[10px] text-slate-500">{c.phone} · هوية: {c.national_id}</div>
                      </td>
                      <td className="p-2.5">
                        <div className="font-bold">{VEHICLE_LABELS[c.vehicle_type] || c.vehicle_type} — {c.vehicle_model}</div>
                        <div className="text-[10px] text-slate-500">لوحة: {c.plate_number}</div>
                      </td>
                      <td className="p-2.5">
                        <span className="text-[11px] font-bold text-slate-700">{(c.documents || []).length} مستند</span>
                      </td>
                      <td className="p-2.5">
                        <div className="font-bold text-amber-600 flex items-center gap-1"><Star className="w-3 h-3" /> {c.rating_avg}</div>
                        <div className="text-[10px] text-slate-500">{c.completed_count} رحلة · نقدي: {c.cash_on_hand} ج.م</div>
                      </td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          c.verification_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.verification_status === 'suspended'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {c.verification_status === 'approved' ? 'معتمد' : c.verification_status === 'suspended' ? 'موقوف' : 'قيد المراجعة'}
                        </span>
                      </td>
                      <td className="p-2.5 flex flex-wrap gap-1.5">
                        {c.verification_status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => void handleDriverAction(c.id, 'approved')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            اعتماد
                          </button>
                        )}
                        {c.verification_status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => void handleDriverAction(c.id, 'suspended', 'إيقاف إداري مؤقت')}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            إيقاف
                          </button>
                        )}
                        {c.verification_status !== 'rejected' && c.verification_status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => void handleDriverAction(c.id, 'rejected', 'استكمال المستندات المطلوبة')}
                            className="px-2.5 py-1 rounded-lg bg-slate-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            رفض
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Vehicle Types Management */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
            <h3 className="text-sm font-black text-slate-900">إدارة فئات المركبات وملفات التوجيه</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {vehicleTypes.map((vt) => (
                <div key={vt.code} className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-black text-sm text-slate-900">{vt.name_ar} ({vt.code})</div>
                      <div className="text-[11px] text-slate-500">حتى {vt.max_passengers} ركاب · توجيه: {vt.routing_profile}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleVehicle(vt)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                        vt.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {vt.is_active ? 'مفعّل' : 'موقوف'}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-600">{vt.description_ar}</div>
                  {Array.isArray(vt.required_docs) && vt.required_docs.length > 0 && (
                    <div className="text-[10px] text-slate-500">المستندات المطلوبة: {vt.required_docs.join(' · ')}</div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleCreateVehicle} className="grid grid-cols-1 md:grid-cols-6 gap-2 pt-3 border-t border-slate-100">
              <input
                value={newVehicle.code}
                onChange={(e) => setNewVehicle({ ...newVehicle, code: e.target.value })}
                placeholder="رمز الفئة (مثال: van)"
                className="px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
              <input
                value={newVehicle.name_ar}
                onChange={(e) => setNewVehicle({ ...newVehicle, name_ar: e.target.value })}
                placeholder="الاسم بالعربية"
                className="px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
              <input
                value={newVehicle.name_en}
                onChange={(e) => setNewVehicle({ ...newVehicle, name_en: e.target.value })}
                placeholder="الاسم بالإنجليزية"
                className="px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
              <input
                type="number"
                min={1}
                max={14}
                value={newVehicle.max_passengers}
                onChange={(e) => setNewVehicle({ ...newVehicle, max_passengers: Number(e.target.value) })}
                placeholder="عدد الركاب"
                className="px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
              <select
                value={newVehicle.routing_profile}
                onChange={(e) => setNewVehicle({ ...newVehicle, routing_profile: e.target.value })}
                className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              >
                <option value="car">ملف توجيه سيارة</option>
                <option value="moto">ملف توجيه موتوسيكل</option>
                <option value="tuktuk">ملف توجيه توك توك</option>
              </select>
              <button type="submit" className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer">
                <Plus className="w-4 h-4" /> إضافة مركبة
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 4: PRICING PER VEHICLE + DISPATCH ENGINE CONFIG */}
      {subTab === 'pricing_dispatch' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">إدارة تسعير المشاوير المستقل لكل مركبة</h3>
              <input
                value={fareReason}
                onChange={(e) => setFareReason(e.target.value)}
                placeholder="سبب التعديل (يُوثّق في سجل تغييرات الأسعار)"
                className="px-3 py-1.5 text-xs rounded-xl border border-slate-300 w-72"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {fareSettings.map((row, idx) => (
                <div key={row.vehicle_type} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-black text-sm text-slate-900">{row.name_ar || row.vehicle_type}</div>
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_active)}
                        onChange={(e) => {
                          const copy = [...fareSettings];
                          copy[idx] = { ...row, is_active: e.target.checked ? 1 : 0 };
                          setFareSettings(copy);
                        }}
                      />
                      مفعّل
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ['base_fare', 'سعر البداية'],
                      ['per_km_rate', 'سعر الكيلومتر'],
                      ['per_min_rate', 'سعر الدقيقة'],
                      ['min_fare', 'الحد الأدنى للأجرة'],
                      ['waiting_per_min_rate', 'رسوم انتظار/دقيقة'],
                      ['cancellation_fee', 'رسوم الإلغاء'],
                      ['commission_rate', 'عمولة التطبيق %'],
                      ['tax_rate', 'الضريبة %'],
                      ['extra_fee', 'رسوم إضافية'],
                      ['waiting_grace_min', 'سماح الانتظار (د)'],
                    ].map(([field, label]) => (
                      <label key={field} className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-600 block">{label}</span>
                        <input
                          type="number"
                          step="0.25"
                          value={row[field] ?? 0}
                          onChange={(e) => {
                            const copy = [...fareSettings];
                            copy[idx] = { ...row, [field]: Number(e.target.value) };
                            setFareSettings(copy);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveFare(row)}
                    className="w-full py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold hover:bg-[#86191B] cursor-pointer"
                  >
                    حفظ تعريفة {row.name_ar}
                  </button>
                </div>
              ))}
            </div>

            {fareHistory.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-[#A92224]" /> سجل تغييرات الأسعار (لا يؤثر بأثر رجعي على الرحلات السابقة)
                </h4>
                <div className="max-h-40 overflow-y-auto space-y-1.5">
                  {fareHistory.map((h) => (
                    <div key={h.id} className="text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-200 flex justify-between">
                      <span><strong>{VEHICLE_LABELS[h.vehicle_type] || h.vehicle_type}</strong> — {h.reason} (بواسطة {h.changed_by_name})</span>
                      <span className="text-slate-400">{String(h.created_at || '').slice(0, 19)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Central Auto-Dispatch Settings */}
          {dispatchCfg && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-[#A92224]" /> إعدادات محرك التوزيع التلقائي (Backend Auto-Dispatch)
                </h3>
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(dispatchCfg.auto_dispatch_enabled)}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, auto_dispatch_enabled: e.target.checked })}
                  />
                  تفعيل التوزيع التلقائي
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">مهلة القبول (ثانية)</span>
                  <input
                    type="number"
                    value={dispatchCfg.offer_timeout_sec}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, offer_timeout_sec: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">نطاق البحث الأولي (كم)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={dispatchCfg.initial_radius_km}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, initial_radius_km: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">مقدار توسيع النطاق (كم)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={dispatchCfg.radius_step_km}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, radius_step_km: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">أقصى نطاق بحث (كم)</span>
                  <input
                    type="number"
                    step="1"
                    value={dispatchCfg.max_radius_km}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, max_radius_km: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">أقصى محاولات إرسال</span>
                  <input
                    type="number"
                    value={dispatchCfg.max_dispatch_attempts}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, max_dispatch_attempts: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">أولوية الترتيب</span>
                  <select
                    value={dispatchCfg.priority_mode}
                    onChange={(e) => setDispatchCfg({ ...dispatchCfg, priority_mode: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="nearest">الأقرب جغرافياً</option>
                    <option value="balanced">متوازن (القرب + التقييم + القبول)</option>
                    <option value="highest_rated">الأعلى تقييماً</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveDispatchConfig()}
                className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 cursor-pointer"
              >
                حفظ إعدادات التوزيع التلقائي
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: DISPUTES & FINANCIAL REPORTS */}
      {subTab === 'disputes_finance' && (
        <div className="space-y-5">
          {/* Financial Report */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">التقارير المالية للمشاوير</h3>
              <div className="flex items-center gap-2">
                <input type="date" value={finDateFrom} onChange={(e) => setFinDateFrom(e.target.value)} className="px-2 py-1.5 text-xs rounded-lg border border-slate-300" />
                <input type="date" value={finDateTo} onChange={(e) => setFinDateTo(e.target.value)} className="px-2 py-1.5 text-xs rounded-lg border border-slate-300" />
                <button type="button" onClick={() => void loadAll()} className="px-3 py-1.5 rounded-lg bg-[#A92224] text-white text-xs font-bold cursor-pointer">تحديث</button>
              </div>
            </div>

            {finReport?.totals && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">إجمالي قيمة الرحلات</div>
                  <div className="text-lg font-black text-slate-900">{finReport.totals.total_gmv} ج.م</div>
                </div>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <div className="text-rose-700">عمولة اطلبها</div>
                  <div className="text-lg font-black text-[#A92224]">{finReport.totals.total_commission} ج.م</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-emerald-700">صافي مستحقات السائقين</div>
                  <div className="text-lg font-black text-emerald-800">{finReport.totals.total_driver_net} ج.م</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="text-amber-700">المدفوعات النقدية</div>
                  <div className="text-lg font-black text-amber-800">{finReport.totals.cash_total} ج.م</div>
                </div>
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                  <div className="text-indigo-700">الدفع الإلكتروني</div>
                  <div className="text-lg font-black text-indigo-800">{finReport.totals.online_total} ج.م</div>
                </div>
              </div>
            )}

            {Array.isArray(finReport?.by_vehicle) && finReport.by_vehicle.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 border-y border-slate-200 text-slate-600 font-bold">
                    <tr>
                      <th className="p-2">نوع المركبة</th>
                      <th className="p-2">عدد الرحلات</th>
                      <th className="p-2">إجمالي الأجرة</th>
                      <th className="p-2">عمولة المنصة</th>
                      <th className="p-2">صافي السائقين</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {finReport.by_vehicle.map((v: any) => (
                      <tr key={v.vehicle_type}>
                        <td className="p-2 font-bold">{v.vehicle_name_ar}</td>
                        <td className="p-2">{v.rides_count}</td>
                        <td className="p-2 font-bold">{Number(v.total_gmv || 0).toFixed(2)} ج.م</td>
                        <td className="p-2 font-bold text-[#A92224]">{Number(v.total_commission || 0).toFixed(2)} ج.م</td>
                        <td className="p-2 font-bold text-emerald-700">{Number(v.total_driver_net || 0).toFixed(2)} ج.م</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ride Disputes */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#A92224]" /> شكاوى وبلاغات المشاوير ({disputes.length})
            </h3>
            {disputes.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-6">لا توجد شكاوى مشاوير مسجلة حالياً</div>
            ) : (
              <div className="space-y-2.5">
                {disputes.map((d) => (
                  <div key={d.id} className="p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-black text-slate-900">
                        رحلة #{d.trip_number} · مقدم البلاغ: {d.reporter_name} ({d.reporter_role === 'captain' ? 'سائق' : 'عميل'})
                      </div>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        d.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : d.status === 'rejected' ? 'bg-slate-200 text-slate-700' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {d.status}
                      </span>
                    </div>
                    <div className="text-slate-700">{d.description}</div>
                    {d.admin_decision && (
                      <div className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded-lg">
                        قرار الإدارة ({d.resolved_by}): {d.admin_decision}
                      </div>
                    )}
                    {d.status !== 'resolved' && d.status !== 'rejected' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <input
                          value={disputeDecisions[d.id] || ''}
                          onChange={(e) => setDisputeDecisions({ ...disputeDecisions, [d.id]: e.target.value })}
                          placeholder="اكتب قرار الإدارة..."
                          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleResolveDispute(d.id, 'resolved')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> حل الشكوى
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResolveDispute(d.id, 'rejected')}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" /> رفض
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
