import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, MapPin, Navigation, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import type {
  CaptainRatingRecord,
  CaptainRecord,
  CaptainVerificationStatus,
  Language,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  captains: CaptainRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const STATUS_LABELS: Record<CaptainVerificationStatus, { ar: string; en: string }> = {
  new: { ar: 'تسجيل جديد', en: 'New' },
  incomplete_data: { ar: 'استكمال البيانات', en: 'Incomplete' },
  under_review: { ar: 'قيد المراجعة', en: 'Under Review' },
  needs_correction: { ar: 'يحتاج تعديل', en: 'Needs Correction' },
  approved: { ar: 'معتمد', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
  suspended: { ar: 'موقوف مؤقتًا', en: 'Suspended' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
};

const REF_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  trip: { ar: 'مشوار', en: 'Ride' },
  order: { ar: 'طلب متجر/صيدلية', en: 'Order' },
  parcel: { ar: 'طرد', en: 'Parcel' },
};

export const CaptainsKycSection: React.FC<Props> = ({ lang, captains, onRefresh, onNotify }) => {
  const isAr = lang === 'ar';
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<CaptainRecord | null>(captains[0] ?? null);
  const [rejectReason, setRejectReason] = useState('');
  const [cashLimitInput, setCashLimitInput] = useState<number>(selected?.cash_limit ?? 1000);
  const [credUsername, setCredUsername] = useState<string>(selected?.username ?? '');
  const [credPassword, setCredPassword] = useState<string>('');
  const [showCredPassword, setShowCredPassword] = useState<boolean>(false);
  const [savingCreds, setSavingCreds] = useState<boolean>(false);
  const [ratings, setRatings] = useState<CaptainRatingRecord[]>([]);
  const [ratingCaptainFilter, setRatingCaptainFilter] = useState<string>('all');
  const [ratingTypeFilter, setRatingTypeFilter] = useState<string>('all');
  const [refreshingGps, setRefreshingGps] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CaptainRecord | null>(null);
  const [deletingCaptain, setDeletingCaptain] = useState(false);

  const filtered = filter === 'all' ? captains : captains.filter((c) => c.verification_status === filter);

  const loadRatings = async () => {
    try {
      const list = await api.getRatings();
      setRatings(list || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    onRefresh().catch(() => {});
    loadRatings();

    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectAdminWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/order-chat?channel=admin`);
      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (
            payload.type === 'captains:updated' ||
            payload.type === 'captain:registered' ||
            payload.type === 'captain:location' ||
            payload.type === 'trip:completed' ||
            payload.type === 'trip:cancelled' ||
            payload.type === 'rating:submitted'
          ) {
            onRefresh().catch(() => {});
            loadRatings().catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!closed) reconnectTimer = setTimeout(connectAdminWs, 3000);
      };
    };

    connectAdminWs();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!selected && captains.length > 0) {
      const first = captains[0];
      setSelected(first);
      setCashLimitInput(first.cash_limit);
      setCredUsername(first.username || '');
    } else if (selected) {
      const fresh = captains.find((c) => c.id === selected.id);
      if (fresh) {
        setSelected(fresh);
        setCredUsername(fresh.username || '');
      } else {
        const next = captains[0] ?? null;
        setSelected(next);
        setCashLimitInput(next?.cash_limit ?? 1000);
        setCredUsername(next?.username || '');
      }
    }
  }, [captains]);

  const handleConfirmDeleteCaptain = async () => {
    if (!deleteTarget) return;
    setDeletingCaptain(true);
    try {
      const res = await api.deleteCaptain(deleteTarget.id);
      if (selected?.id === deleteTarget.id) {
        setSelected(null);
      }
      setDeleteTarget(null);
      await onRefresh();
      onNotify(
        isAr
          ? `تم حذف الطيار (${res.deleted_name || deleteTarget.full_name}) نهائيًا`
          : `Captain (${res.deleted_name || deleteTarget.full_name}) deleted`
      );
    } catch (err) {
      onNotify((err as Error).message || (isAr ? 'تعذر حذف الطيار' : 'Failed to delete captain'));
    } finally {
      setDeletingCaptain(false);
    }
  };

  const handleSelect = (c: CaptainRecord) => {
    setSelected(c);
    setCashLimitInput(c.cash_limit);
    setRejectReason(c.rejection_reason || '');
    setCredUsername(c.username || '');
    setCredPassword('');
  };

  const handleManualGpsRefresh = async () => {
    setRefreshingGps(true);
    try {
      await Promise.all([onRefresh(), loadRatings()]);
      onNotify(isAr ? 'تم تحديث مواقع جميع الطيارين والتقييمات' : 'Updated all captain GPS & ratings');
    } finally {
      setRefreshingGps(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const trimmedUser = credUsername.trim();
    const trimmedPass = credPassword.trim();
    if (!trimmedUser && !trimmedPass) {
      onNotify(isAr ? 'أدخل اسم المستخدم أو كلمة المرور الجديدة' : 'Enter username or new password');
      return;
    }
    setSavingCreds(true);
    try {
      const res = await api.updateCaptainCredentials(selected.id, {
        username: trimmedUser || undefined,
        password: trimmedPass || undefined,
      });
      setCredPassword('');
      await onRefresh();
      onNotify(
        isAr
          ? `تم حفظ بيانات دخول الكابتن (@${res.username})`
          : `Saved credentials (@${res.username})`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleUpdateCaptain = async (nextStatus: CaptainVerificationStatus) => {
    if (!selected) return;
    if (nextStatus === 'rejected' && !rejectReason.trim()) {
      onNotify(isAr ? 'يجب كتابة سبب الرفض قبل رفض الكابتن' : 'Rejection reason is required');
      return;
    }
    await api.updateCaptainStatus(selected.id, {
      verification_status: nextStatus,
      rejection_reason: nextStatus === 'rejected' || nextStatus === 'needs_correction' ? rejectReason : null,
      cash_limit: cashLimitInput,
      is_eligible_for_rides: selected.is_eligible_for_rides,
      allowed_services: selected.allowed_services,
    });
    await onRefresh();
    onNotify(isAr ? `تم تحديث حالة الكابتن إلى "${STATUS_LABELS[nextStatus].ar}"` : `Captain status updated to ${nextStatus}`);
  };

  const handleToggleRideEligibility = async () => {
    if (!selected) return;
    const nextElig = !selected.is_eligible_for_rides;
    const nextServices = nextElig
      ? Array.from(new Set([...selected.allowed_services, 'rides']))
      : selected.allowed_services.filter((s) => s !== 'rides');
    await api.updateCaptainStatus(selected.id, {
      is_eligible_for_rides: nextElig,
      allowed_services: nextServices,
    });
    setSelected({ ...selected, is_eligible_for_rides: nextElig, allowed_services: nextServices });
    await onRefresh();
    onNotify(isAr ? 'تم تحديث أهلية المركبة للمشاوير' : 'Vehicle ride eligibility updated');
  };

  const handleDocReview = async (docId: string, review_status: 'approved' | 'rejected') => {
    await api.reviewCaptainDoc(docId, {
      review_status,
      review_note: review_status === 'rejected' ? 'الصورة غير واضحة — يرجى إعادة التصوير' : 'تم التحقق',
    });
    await onRefresh();
    if (selected) {
      const updated = captains.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
    onNotify(isAr ? 'تم حفظ مراجعة المستند' : 'Document review saved');
  };

  const submittedRatings = ratings.filter((r) => r.status === 'submitted');
  const filteredRatings = submittedRatings.filter((r) => {
    if (ratingCaptainFilter !== 'all' && r.captain_id !== ratingCaptainFilter) return false;
    if (ratingTypeFilter !== 'all' && r.ref_type !== ratingTypeFilter) return false;
    return true;
  });

  const availLabel = (st: CaptainRecord['availability_status']) => {
    if (st === 'available') return isAr ? 'متاح الآن' : 'Available';
    if (st === 'busy') return isAr ? 'في مشوار' : 'Busy';
    return isAr ? 'غير متصل' : 'Offline';
  };

  return (
    <div className="space-y-5">
      {/* Live GPS Map of ALL Captains */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'خريطة المواقع المباشرة لجميع الطيارين (Live Fleet GPS)' : 'All Captains Live GPS Map'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'اضغط على أي طيار على الخريطة لعرض ملفه وتقييماته ومستحقاته — يتحدث تلقائيًا لحظيًا'
                  : 'Click any captain pin on the map to inspect profile, ratings & GPS'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleManualGpsRefresh}
            disabled={refreshingGps}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingGps ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'تحديث الخريطة والتقييمات' : 'Refresh Live GPS'}</span>
          </button>
        </div>

        <GpsMapPicker
          heightClass="h-72"
          selectedCaptainId={selected?.id ?? null}
          nearbyCaptains={captains.map((c) => ({
            id: c.id,
            full_name: c.full_name,
            vehicle_type: c.vehicle_type,
            vehicle_model: c.vehicle_model,
            availability_status: c.availability_status,
            lat: Number(c.lat || 31.1583),
            lng: Number(c.lng || 31.9369),
          }))}
          onCaptainPinClick={(capId) => {
            const match = captains.find((c) => c.id === capId);
            if (match) handleSelect(match);
          }}
        />

        {/* All Captains GPS & Penalties Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {captains.map((c) => {
            const isSel = selected?.id === c.id;
            return (
              <button
                key={`gps-${c.id}`}
                type="button"
                onClick={() => handleSelect(c)}
                className={`text-start p-3 rounded-xl border transition-colors ${
                  isSel ? 'border-orange-500 bg-orange-50/70' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 truncate">{c.full_name}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                      c.availability_status === 'available'
                        ? 'bg-teal-100 text-teal-800'
                        : c.availability_status === 'busy'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {availLabel(c.availability_status)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                  <span className="inline-flex items-center gap-1 font-mono-num" dir="ltr">
                    <MapPin className="w-3 h-3 text-teal-700" />
                    {Number(c.lat || 31.1583).toFixed(4)}, {Number(c.lng || 31.9369).toFixed(4)}
                  </span>
                  <span className="font-bold text-amber-600">★ {Number(c.rating_avg || 5).toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>عليه للتطبيق: <strong className="text-slate-900">{c.cash_on_hand} ج.م</strong></span>
                  <span>غرامات 10%: <strong className="text-rose-700">{c.total_penalties ?? 0} ج.م</strong></span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
            filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          {isAr ? 'الكل' : 'All'} ({captains.length})
        </button>
        {(['under_review', 'approved', 'needs_correction', 'rejected', 'suspended'] as CaptainVerificationStatus[]).map((st) => (
          <button
            key={st}
            onClick={() => setFilter(st)}
            className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
              filter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {isAr ? STATUS_LABELS[st].ar : STATUS_LABELS[st].en}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            {isAr ? 'أسطول الكباتن — المنزلة' : 'Captains Fleet — El Manzala'}
          </h3>
          <div className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                  selected?.id === c.id ? 'bg-orange-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="flex-1 min-w-0 text-start p-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-900 truncate">{c.full_name}</span>
                      {c.username && (
                        <span dir="ltr" className="text-[11px] font-mono-num px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded">
                          @{c.username}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-slate-600 shrink-0">
                      {isAr ? STATUS_LABELS[c.verification_status]?.ar : STATUS_LABELS[c.verification_status]?.en}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2 tabular-nums">
                    <span>{c.vehicle_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{c.plate_number}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-600 font-bold">★ {Number(c.rating_avg || 5).toFixed(2)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{c.zone_name}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(c);
                  }}
                  title={isAr ? 'حذف الطيار' : 'Delete Captain'}
                  aria-label={isAr ? `حذف الطيار ${c.full_name}` : `Delete captain ${c.full_name}`}
                  className="p-2 rounded-lg text-rose-600 hover:bg-rose-100/80 border border-transparent hover:border-rose-200 transition-colors shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          {selected ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{selected.full_name}</h3>
                    {selected.username && (
                      <span dir="ltr" className="px-2 py-0.5 bg-orange-50 text-orange-800 border border-orange-200 rounded text-xs font-mono-num font-semibold">
                        @{selected.username}
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-xs font-bold tabular-nums">
                      ★ {Number(selected.rating_avg || 5).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    {selected.phone} · {isAr ? 'رقم قومي:' : 'NID:'} {selected.national_id} · {selected.vehicle_model} ({selected.plate_number})
                  </p>
                  <p className="text-[11px] font-mono-num text-teal-700 mt-1" dir="ltr">
                    GPS: {Number(selected.lat || 31.1583).toFixed(5)}, {Number(selected.lng || 31.9369).toFixed(5)}
                    {selected.location_updated_at ? ` · ${selected.location_updated_at}` : ''}
                  </p>
                </div>
                <div className="text-xs text-slate-600 tabular-nums space-y-1.5 text-end">
                  <div>
                    {isAr ? 'مستحقات التطبيق على الكابتن:' : 'Cash:'} <strong>{selected.cash_on_hand}</strong> / {selected.cash_limit} ج.م
                  </div>
                  <div className="text-rose-700">
                    {isAr ? 'إجمالي غرامات الإلغاء (10%):' : 'Penalties:'} <strong>{selected.total_penalties ?? 0} ج.م</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(selected)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isAr ? 'حذف الطيار' : 'Delete Captain'}</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveCredentials} className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                  <KeyRound className="w-4 h-4 text-orange-600" />
                  <span>{isAr ? 'بيانات دخول الطيار (اسم المستخدم وكلمة المرور)' : 'Captain Login Credentials'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {isAr ? 'اسم المستخدم (Username)' : 'Username'}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={credUsername}
                      onChange={(e) => setCredUsername(e.target.value)}
                      placeholder="captain1"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {isAr ? 'تعيين كلمة مرور جديدة' : 'New Password'}
                    </label>
                    <div className="relative">
                      <input
                        type={showCredPassword ? 'text' : 'password'}
                        dir="ltr"
                        value={credPassword}
                        onChange={(e) => setCredPassword(e.target.value)}
                        placeholder={isAr ? 'اتركه فارغًا للإبقاء على الحالية' : 'Leave blank to keep current'}
                        className="w-full px-3 py-2 pe-9 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCredPassword(!showCredPassword)}
                        className="absolute inset-y-0 end-0 px-2.5 text-slate-500 hover:text-slate-800"
                        title={isAr ? 'إظهار/إخفاء كلمة المرور' : 'Toggle visibility'}
                      >
                        {showCredPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    <button
                      type="submit"
                      disabled={savingCreds}
                      className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg text-xs font-semibold whitespace-nowrap"
                    >
                      {savingCreds ? '...' : isAr ? 'حفظ' : 'Save'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {isAr ? 'السقف النقدي للكابتن (Cash Cap - ج.م)' : 'Cash Cap Limit (EGP)'}
                  </label>
                  <input
                    type="number"
                    value={cashLimitInput}
                    onChange={(e) => setCashLimitInput(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleToggleRideEligibility}
                    className={`w-full py-2 px-3 rounded-lg text-xs font-medium border ${
                      selected.is_eligible_for_rides
                        ? 'border-teal-600 text-teal-800 bg-teal-50'
                        : 'border-slate-200 text-slate-700 bg-slate-50'
                    }`}
                  >
                    {selected.is_eligible_for_rides
                      ? isAr
                        ? 'المركبة مرخصة ومؤهلة للمشاوير ✓'
                        : 'Eligible for Rides ✓'
                      : isAr
                      ? 'توصيل فقط (غير مصرح للمشاوير — اضغط للتعديل)'
                      : 'Delivery Only (Toggle Ride Eligibility)'}
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  {isAr ? 'مراجعة الصور والمستندات التسعة (Vehicle & ID KYC)' : '9-Point Vehicle & ID Verification'}
                </h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {selected.documents.map((doc) => (
                    <div key={doc.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5">
                        {doc.image_url && (
                          <a href={doc.image_url} target="_blank" rel="noreferrer" className="shrink-0">
                            <img
                              src={doc.image_url}
                              alt={doc.label_ar}
                              referrerPolicy="no-referrer"
                              className="w-12 h-10 rounded object-cover border border-slate-200"
                            />
                          </a>
                        )}
                        <div>
                          <span className="font-medium text-slate-800">{doc.label_ar}</span>
                          {doc.expires_at && (
                            <span className="text-slate-500 ms-2 tabular-nums">({isAr ? 'ينتهي:' : 'Exp:'} {doc.expires_at})</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={
                            doc.review_status === 'approved'
                              ? 'text-teal-700 font-medium'
                              : doc.review_status === 'rejected'
                              ? 'text-red-600 font-medium'
                              : 'text-amber-700 font-medium'
                          }
                        >
                          {doc.review_status}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDocReview(doc.id, 'approved')}
                          className="px-2 py-1 border border-slate-200 rounded hover:bg-slate-50"
                        >
                          {isAr ? 'قبول' : 'OK'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDocReview(doc.id, 'rejected')}
                          className="px-2 py-1 border border-slate-200 rounded hover:bg-red-50 text-red-700"
                        >
                          {isAr ? 'رفض' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-200">
                <input
                  type="text"
                  placeholder={isAr ? 'سبب الرفض أو ملاحظة التعديل (إجباري عند الرفض)...' : 'Rejection or correction note...'}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateCaptain('approved')}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg"
                  >
                    {isAr ? 'اعتماد الكابتن للعمل' : 'Approve Captain'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateCaptain('needs_correction')}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg"
                  >
                    {isAr ? 'طلب تعديل مستندات' : 'Request Correction'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateCaptain('rejected')}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg"
                  >
                    {isAr ? 'رفض الحساب' : 'Reject'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateCaptain('suspended')}
                    className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-medium rounded-lg"
                  >
                    {isAr ? 'إيقاف مؤقت' : 'Suspend'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{isAr ? 'اختر كابتن للمراجعة' : 'Select a captain'}</p>
          )}
        </div>
      </div>

      {/* Customer Ratings Feed Across All Operations */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 fill-amber-500 text-amber-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'تقييمات العملاء للطيارين بعد كل عملية' : 'Customer Ratings of Captains (All Operations)'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? `إجمالي التقييمات المسجلة: ${submittedRatings.length} تقييم`
                  : `Total submitted ratings: ${submittedRatings.length}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ratingCaptainFilter}
              onChange={(e) => setRatingCaptainFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
            >
              <option value="all">{isAr ? 'كل الطيارين' : 'All Captains'}</option>
              {captains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} (★ {Number(c.rating_avg || 5).toFixed(2)})
                </option>
              ))}
            </select>
            <select
              value={ratingTypeFilter}
              onChange={(e) => setRatingTypeFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
            >
              <option value="all">{isAr ? 'كل العمليات' : 'All Services'}</option>
              <option value="trip">{isAr ? 'المشاوير' : 'Rides'}</option>
              <option value="order">{isAr ? 'طلبات المتاجر والصيدليات' : 'Orders'}</option>
              <option value="parcel">{isAr ? 'الطرود' : 'Parcels'}</option>
            </select>
          </div>
        </div>

        {filteredRatings.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            {isAr
              ? 'لا توجد تقييمات مرسلة مطابقة حاليًا — يظهر التقييم هنا فور إرساله من العميل بعد أي مشوار أو طلب.'
              : 'No submitted ratings yet.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRatings.map((r) => (
              <div key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{r.captain_name}</span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-semibold">
                      {isAr ? REF_TYPE_LABELS[r.ref_type]?.ar || r.ref_type : r.ref_type}
                    </span>
                    <span className="font-mono-num text-slate-500">{r.ref_number}</span>
                    {r.final_amount > 0 && (
                      <span className="font-mono-num font-semibold text-teal-700">{r.final_amount} ج.م</span>
                    )}
                  </div>
                  <p className="text-slate-600">
                    {isAr ? 'العميل:' : 'Customer:'} <strong>{r.customer_name}</strong>
                    {r.comment ? ` — "${r.comment}"` : ''}
                  </p>
                </div>
                <div className="text-end shrink-0 space-y-0.5 tabular-nums">
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 font-bold">
                    <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    <span>{r.rating} / 5</span>
                  </div>
                  <p className="text-[11px] font-mono-num text-slate-400">
                    {String(r.submitted_at || r.created_at || '').slice(0, 16)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Captain Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">
                    {isAr ? 'تأكيد حذف الطيار' : 'Confirm Delete Captain'}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {isAr ? 'لا يمكن التراجع عن هذا الإجراء بعد التنفيذ' : 'This action cannot be undone'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              {isAr
                ? `هل أنت متأكد من حذف حساب الطيار «${deleteTarget.full_name}» (${deleteTarget.phone})؟ سيتم إنهاء جلساته النشطة وإزالة مستنداته وحسابه مع الحفاظ على سجل الطلبات التاريخي.`
                : `Are you sure you want to permanently delete captain "${deleteTarget.full_name}" (${deleteTarget.phone})?`}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingCaptain}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingCaptain}
                onClick={() => void handleConfirmDeleteCaptain()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingCaptain ? (isAr ? 'جارٍ الحذف...' : 'Deleting...') : isAr ? 'حذف نهائي' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
