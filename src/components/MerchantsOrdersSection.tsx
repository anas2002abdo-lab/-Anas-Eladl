import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Building2,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Pill,
  ShieldCheck,
  Store,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  computeOrderStoreStats,
  getSectionItemCount,
  isSectionPickedUpByCaptain,
  isStorePrepared,
} from '../lib/orderBundles.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import { OrderChatPage } from './OrderChatPage.tsx';
import { TripChatPage } from './TripChatPage.tsx';
import type {
  AdminMerchantDetail,
  CaptainRecord,
  Language,
  MerchantRecord,
  OrderRecord,
  OrderStoreSectionRecord,
  ServiceZone,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  portalMode: 'admin' | 'merchant';
  merchants: MerchantRecord[];
  orders: OrderRecord[];
  zones: ServiceZone[];
  captains?: CaptainRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const VEHICLE_LABELS_AR: Record<string, string> = {
  moto: 'موتوسيكل',
  tuktuk: 'توكتوك',
  car: 'سيارة',
  bicycle: 'دراجة',
};

const MERCHANT_TYPE_LABELS: Record<string, string> = {
  supermarket: 'سوبر ماركت وبقالة',
  restaurant: 'مطعم / مأكولات',
  pharmacy: 'صيدلية',
  butcher: 'جزارة / لحوم ودواجن',
  bakery: 'مخبز / حلواني',
  vegetables: 'خضار وفاكهة',
  electronics: 'إلكترونيات وموبايلات',
  fashion: 'ملابس وأحذية',
  other: 'نشاط تجاري آخر',
};

const VERIFICATION_STATUS_LABELS: Record<string, { ar: string; cls: string }> = {
  approved: { ar: 'معتمد ومنشور على المنصة', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  pending: { ar: 'قيد المراجعة (بانتظار موافقة الإدارة)', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  rejected: { ar: 'مرفوض', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  suspended: { ar: 'موقوف مؤقتًا', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
};

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  vodafone_cash: 'فودافون كاش (Vodafone Cash)',
  instapay: 'إنستاباي (InstaPay)',
  bank_transfer: 'تحويل بنكي',
  cash_settlement: 'تسوية نقدية مباشرة',
};

export const MerchantsOrdersSection: React.FC<Props> = ({
  lang,
  portalMode,
  merchants,
  orders,
  zones,
  captains = [],
  onRefresh,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [quoteMap, setQuoteMap] = useState<Record<string, number>>({});
  const [rxNoteMap, setRxNoteMap] = useState<Record<string, string>>({});
  const [subNoteMap, setSubNoteMap] = useState<Record<string, string>>({});
  const [captainSelectMap, setCaptainSelectMap] = useState<Record<string, string>>({});
  const [assigningCaptainOrderId, setAssigningCaptainOrderId] = useState<string | null>(null);
  const [commEdit, setCommEdit] = useState<Record<string, number>>({});
  const [activeChatOrderId, setActiveChatOrderId] = useState<string | null>(null);
  const [activeChatTripId, setActiveChatTripId] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [onlyChatOrders, setOnlyChatOrders] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MerchantRecord | null>(null);
  const [deletingMerchant, setDeletingMerchant] = useState(false);
  const [deleteOrderTarget, setDeleteOrderTarget] = useState<OrderRecord | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantRecord | null>(null);
  const [merchantDetail, setMerchantDetail] = useState<AdminMerchantDetail | null>(null);
  const [loadingMerchantDetail, setLoadingMerchantDetail] = useState(false);
  const [licenseLightboxUrl, setLicenseLightboxUrl] = useState<string | null>(null);

  const sortedApprovedCaptains = useMemo(() => {
    const score = (avail: string) => (avail === 'available' ? 0 : avail === 'busy' ? 1 : 2);
    return captains
      .filter((c) => c.verification_status === 'approved')
      .slice()
      .sort((a, b) => {
        const diff = score(a.availability_status) - score(b.availability_status);
        if (diff !== 0) return diff;
        if ((b.rating_avg || 0) !== (a.rating_avg || 0)) return (b.rating_avg || 0) - (a.rating_avg || 0);
        return a.full_name.localeCompare(b.full_name, 'ar');
      });
  }, [captains]);

  useEffect(() => {
    if (portalMode === 'admin') {
      api.getTrips().then(setTrips).catch(() => {});
    }
  }, [portalMode, orders]);

  useEffect(() => {
    if (!selectedMerchant) return;
    const latest = merchants.find((m) => m.id === selectedMerchant.id);
    if (!latest) {
      setSelectedMerchant(null);
      setMerchantDetail(null);
    } else {
      setSelectedMerchant(latest);
    }
  }, [merchants]);

  const [newOrder, setNewOrder] = useState({
    customer_name: '',
    customer_phone: '',
    merchant_id: merchants[0]?.id || 'mer_1',
    zone_id: zones[0]?.id || 'zn_city_center',
    address_landmark: '',
    order_channel: 'free_text',
    free_order_text: '',
    is_express: false,
    subtotal: 0,
  });

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.customer_name.trim()) return;
    const res = await api.createOrder(newOrder);
    setNewOrder({ ...newOrder, customer_name: '', customer_phone: '', address_landmark: '', free_order_text: '', subtotal: 0 });
    await onRefresh();
    onNotify(isAr ? `تم إنشاء الطلب ${res.order_number} وإرساله للتاجر` : `Order ${res.order_number} created`);
  };

  const handleAdminMarkAllReadyAndAssign = async (o: OrderRecord) => {
    const selected = captainSelectMap[o.id] ?? (o.captain_id || '__auto__');
    setAssigningCaptainOrderId(o.id);
    try {
      const payload: {
        captain_id?: string | null;
        assign_best_captain?: boolean;
        mark_all_ready?: boolean;
      } = { mark_all_ready: true };
      if (selected === '__auto__') {
        payload.assign_best_captain = true;
      } else if (selected === '__none__') {
        payload.captain_id = null;
      } else if (selected) {
        payload.captain_id = selected;
      }
      const res = await api.adminUpdateOrder(o.id, payload);
      setCaptainSelectMap((prev) => {
        const next = { ...prev };
        delete next[o.id];
        return next;
      });
      await onRefresh();
      const capName = res.order?.captain_name;
      onNotify(
        capName
          ? isAr
            ? `تم تجهيز كل أقسام المتاجر في الطلب #${o.order_number} وإسناده للطيار: ${capName}`
            : `Marked all stores ready & assigned #${o.order_number} to ${capName}`
          : isAr
          ? `تم تجهيز كل أقسام المتاجر في الطلب #${o.order_number}`
          : `Marked all stores ready for #${o.order_number}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setAssigningCaptainOrderId(null);
    }
  };

  const handleSectionReady = async (o: OrderRecord, sec: OrderStoreSectionRecord) => {
    try {
      const subtotalVal = quoteMap[sec.id] ?? sec.subtotal;
      const res = await api.merchantOrderAction(o.id, {
        action: 'ready',
        merchant_id: sec.merchant_id,
        status: 'ready_for_pickup',
        subtotal: subtotalVal,
        pharmacist_notes: rxNoteMap[sec.id] ?? sec.pharmacist_notes,
        substitution_note: subNoteMap[sec.id] ?? sec.substitution_note,
        prescription_status: sec.merchant_type === 'pharmacy' ? 'reviewed' : o.prescription_status,
        assign_best_captain: true,
      });
      await onRefresh();
      onNotify(
        res.assigned_captain
          ? isAr
            ? `تم تجهيز قسم «${sec.merchant_name}» — كل المتاجر جاهزة وتم إسناد الطلب #${o.order_number} للطيار: ${res.assigned_captain}`
            : `Store ready & order #${o.order_number} assigned to ${res.assigned_captain}`
          : isAr
          ? `تم تحديد قسم «${sec.merchant_name}» كـ «جاهز» ✓ — بانتظار تجهيز باقي المتاجر لإسناد الطيار`
          : `Store ${sec.merchant_name} marked ready`
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleAssignCaptainDirect = async (o: OrderRecord) => {
    const selected = captainSelectMap[o.id] ?? (o.captain_id || '__auto__');
    if (!selected) {
      onNotify(isAr ? 'اختر طيارًا أولاً أو اختر الإسناد التلقائي' : 'Select a captain first');
      return;
    }
    setAssigningCaptainOrderId(o.id);
    try {
      const payload =
        selected === '__auto__'
          ? { assign_best_captain: true }
          : selected === '__none__'
          ? { captain_id: null }
          : { captain_id: selected };
      const res = await api.adminUpdateOrder(o.id, payload);
      setCaptainSelectMap((prev) => {
        const next = { ...prev };
        delete next[o.id];
        return next;
      });
      await onRefresh();
      if (selected === '__none__') {
        onNotify(isAr ? `تم إلغاء إسناد الطيار عن الطلب #${o.order_number}` : `Captain unassigned from #${o.order_number}`);
      } else if (selected === '__auto__') {
        const capName = res.order?.captain_name;
        onNotify(
          capName
            ? isAr
              ? `تم إسناد الطلب #${o.order_number} تلقائيًا للكابتن: ${capName}`
              : `Auto-assigned to ${capName}`
            : isAr
            ? 'لا يوجد طيار متاح للإسناد التلقائي حاليًا — اختر طيارًا يدويًا من القائمة'
            : 'No available captain found'
        );
      } else {
        const capName = res.order?.captain_name || sortedApprovedCaptains.find((c) => c.id === selected)?.full_name || '';
        onNotify(
          isAr ? `تم إسناد الطلب #${o.order_number} للطيار: ${capName}` : `Order assigned to ${capName}`
        );
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setAssigningCaptainOrderId(null);
    }
  };

  const handleOrderWorkflow = async (o: OrderRecord, action: 'quote' | 'dispatch' | 'deliver') => {
    const subtotalVal = quoteMap[o.id] ?? o.subtotal;
    if (action === 'quote') {
      const selectedCap = captainSelectMap[o.id] ?? (o.captain_id || '__auto__');
      const dispatchPayload: Record<string, unknown> =
        portalMode === 'admin'
          ? selectedCap === '__auto__'
            ? { assign_best_captain: true }
            : selectedCap === '__none__'
            ? { captain_id: null }
            : { captain_id: selectedCap }
          : { assign_best_captain: true };

      const res = await api.merchantOrderAction(o.id, {
        status: 'preparing',
        subtotal: subtotalVal,
        pharmacist_notes: rxNoteMap[o.id] ?? o.pharmacist_notes,
        substitution_note: subNoteMap[o.id] ?? o.substitution_note,
        prescription_status: o.merchant_type === 'pharmacy' ? 'reviewed' : o.prescription_status,
        ...dispatchPayload,
      });
      await onRefresh();
      onNotify(
        res.assigned_captain
          ? isAr
            ? `تم تسعير الطلب وتجهيزه وإسناده للكابتن: ${res.assigned_captain}`
            : `Order quoted & assigned to ${res.assigned_captain}`
          : selectedCap === '__none__'
          ? isAr
            ? 'تم تسعير الطلب وتجهيزه بدون إسناد طيار'
            : 'Order quoted without captain'
          : isAr
          ? 'تم حفظ تسعير الطلب'
          : 'Order quoted'
      );
      return;
    }

    if (action === 'dispatch') {
      const res = await api.merchantOrderAction(o.id, {
        action: 'ready',
        status: 'ready_for_pickup',
        assign_best_captain: true,
      });
      await onRefresh();
      onNotify(
        res.assigned_captain
          ? isAr
            ? `تم تجهيز المتجر وإسناد الطلب للكابتن: ${res.assigned_captain}`
            : `Assigned to ${res.assigned_captain}`
          : isAr
          ? 'تم تحديد الطلب كجاهز ✓'
          : 'Marked ready'
      );
      return;
    }

    await api.merchantOrderAction(o.id, { status: 'delivered' });
    await onRefresh();
    onNotify(isAr ? 'تم تأكيد التسليم وترحيل عمولة المنصة تلقائيًا إلى الدفتر المالي المركزي' : 'Delivered & commission posted to ledger');
  };

  const openMerchantDetails = async (m: MerchantRecord) => {
    setSelectedMerchant(m);
    setMerchantDetail(null);
    setLoadingMerchantDetail(true);
    try {
      const detail = (await api.getMerchantDetail(m.id)) as AdminMerchantDetail;
      setMerchantDetail(detail);
      if (detail?.merchant) {
        setSelectedMerchant(detail.merchant);
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingMerchantDetail(false);
    }
  };

  const handleMerchantSave = async (
    m: MerchantRecord,
    overrides?: { verification_status?: string; is_open_now?: boolean }
  ) => {
    await api.updateMerchant(m.id, {
      verification_status: overrides?.verification_status ?? m.verification_status,
      is_open_now: overrides?.is_open_now ?? m.is_open_now,
      commission_rate: commEdit[m.id] ?? m.commission_rate,
    });
    await onRefresh();
    if (selectedMerchant?.id === m.id) {
      openMerchantDetails(m).catch(() => {});
    }
    onNotify(isAr ? 'تم تحديث بيانات التاجر والصيدلية' : 'Merchant updated');
  };

  const handleConfirmDeleteMerchant = async () => {
    if (!deleteTarget) return;
    setDeletingMerchant(true);
    try {
      const deletingId = deleteTarget.id;
      const res = await api.deleteMerchant(deletingId);
      setDeleteTarget(null);
      if (selectedMerchant?.id === deletingId) {
        setSelectedMerchant(null);
        setMerchantDetail(null);
      }
      await onRefresh();
      onNotify(
        isAr
          ? `تم حذف المتجر «${res.deleted_business_name}» وكافة بياناته نهائيًا من المنصة`
          : `Merchant ${res.deleted_business_name} deleted`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setDeletingMerchant(false);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteOrderTarget) return;
    setDeletingOrder(true);
    try {
      const deletingId = deleteOrderTarget.id;
      const orderNum = deleteOrderTarget.order_number;
      const res = await api.deleteOrder(deletingId);
      setDeleteOrderTarget(null);
      await onRefresh();
      onNotify(
        isAr
          ? res.message || `تم حذف الطلب #${orderNum} نهائيًا بنجاح`
          : `Order #${orderNum} permanently deleted`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setDeletingOrder(false);
    }
  };

  if (activeChatOrderId) {
    return (
      <OrderChatPage
        orderId={activeChatOrderId}
        senderRole="admin"
        senderName={portalMode === 'admin' ? 'الإدارة - Super Admin' : 'إدارة التاجر'}
        lang={lang}
        onBack={() => setActiveChatOrderId(null)}
        onOrderUpdated={onRefresh}
        onNotify={onNotify}
      />
    );
  }

  if (activeChatTripId) {
    return (
      <TripChatPage
        tripId={activeChatTripId}
        senderRole="admin"
        senderName="الإدارة - Super Admin"
        lang={lang}
        onBack={() => setActiveChatTripId(null)}
        onTripUpdated={async () => {
          await onRefresh();
          api.getTrips().then(setTrips).catch(() => {});
        }}
        onNotify={onNotify}
      />
    );
  }

  return (
    <div className="space-y-6">
      {portalMode === 'merchant' && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 text-sm text-teal-900">
          {isAr
            ? 'أنت الآن داخل معاينة «لوحة التجار والصيدليات» — يمكنك استلام الطلبات الحرة والروشتات، تحديد أسعارها، اقتراح البدائل الطبية، وطلب إسناد أقرب كابتن مباشرة.'
            : 'Merchant & Pharmacy Portal Mode: review prescriptions, quote free-text orders, and dispatch nearest captain.'}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          {isAr ? 'محاكاة استقبال طلب جديد (متجر / طلب حر / روشتة صيدلية)' : 'Simulate New Order (Catalog / Free-Text / Pharmacy Rx)'}
        </h3>
        <form onSubmit={handleCreateOrder} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder={isAr ? 'اسم العميل' : 'Customer Name'}
            value={newOrder.customer_name}
            onChange={(e) => setNewOrder({ ...newOrder, customer_name: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <select
            value={newOrder.merchant_id}
            onChange={(e) => setNewOrder({ ...newOrder, merchant_id: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.business_name_ar} ({m.merchant_type === 'pharmacy' ? 'صيدلية' : 'متجر'})
              </option>
            ))}
          </select>
          <select
            value={newOrder.zone_id}
            onChange={(e) => setNewOrder({ ...newOrder, zone_id: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name_ar}
              </option>
            ))}
          </select>
          <select
            value={newOrder.order_channel}
            onChange={(e) => setNewOrder({ ...newOrder, order_channel: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="free_text">{isAr ? 'طلب حر مكتوب' : 'Free Text Order'}</option>
            <option value="prescription">{isAr ? 'روشتة صيدلية' : 'Pharmacy Prescription'}</option>
            <option value="catalog">{isAr ? 'طلب كتالوج مسعّر' : 'Catalog Order'}</option>
          </select>
          <input
            type="text"
            placeholder={isAr ? 'أقرب معلم مشهور (مثال: بجوار مدرسة التحرير)' : 'Nearest Landmark'}
            value={newOrder.address_landmark}
            onChange={(e) => setNewOrder({ ...newOrder, address_landmark: e.target.value })}
            className="md:col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder={isAr ? 'تفاصيل الطلب الحر أو الروشتة...' : 'Free-text shopping list or Rx note...'}
            value={newOrder.free_order_text}
            onChange={(e) => setNewOrder({ ...newOrder, free_order_text: e.target.value })}
            className="md:col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={newOrder.is_express}
              onChange={(e) => setNewOrder({ ...newOrder, is_express: e.target.checked })}
            />
            {isAr ? 'توصيل عاجل Express' : 'Express Delivery'}
          </label>
          <button
            type="submit"
            className="md:col-start-4 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg whitespace-nowrap"
          >
            {isAr ? 'إرسال الطلب للنظام' : 'Submit Order'}
          </button>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">
            {isAr ? 'الطلبات الحية والروشتات ومراقبة محادثات الطيار والعميل' : 'Live Orders, Rx & Captain-Customer Chat Monitor'}
          </h3>
          <button
            type="button"
            onClick={() => setOnlyChatOrders((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              onlyChatOrders
                ? 'bg-orange-600 text-white border-orange-600'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>
              {onlyChatOrders
                ? isAr
                  ? 'عرض كل الطلبات'
                  : 'Show All Orders'
                : isAr
                ? `الطلبات ذات الشات النشط (${orders.filter((x) => x.captain_id || (x.chat_count || 0) > 0).length})`
                : `Active Chats (${orders.filter((x) => x.captain_id || (x.chat_count || 0) > 0).length})`}
            </span>
          </button>
        </div>
        <div className="divide-y divide-slate-200">
          {orders
            .filter((o) => (!onlyChatOrders ? true : Boolean(o.captain_id) || (o.chat_count ?? 0) > 0))
            .map((o) => {
            const stats = computeOrderStoreStats(o);
            if (stats.isMultiStore) {
              const capSelection = captainSelectMap[o.id] ?? (o.captain_id || '__auto__');
              const isSavingCap = assigningCaptainOrderId === o.id;

              return (
                <div key={o.id} className="py-4 px-3 my-2 rounded-xl border-2 border-orange-200 bg-orange-50/35 space-y-3">
                  {/* Single Multi-Store Order Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-orange-600 text-white text-xs font-bold">
                          {isAr ? `طلب مقسم (${stats.activeSections.length} متاجر)` : `Multi-store (${stats.activeSections.length})`}
                        </span>
                        <span className="text-sm font-bold text-slate-900 font-mono-num">#{o.order_number}</span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-bold ${
                            stats.allStoresReady ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isAr
                            ? `تم تجهيز ${stats.readyCount} من ${stats.activeSections.length} متاجر`
                            : `Prepared ${stats.readyCount}/${stats.activeSections.length}`}
                        </span>
                        {stats.anchorSection && (
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-semibold">
                            {isAr ? `المتجر الأكثر طلبًا: ${stats.anchorSection.merchant_name}` : `Main Store: ${stats.anchorSection.merchant_name}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        {o.customer_name} ({o.customer_phone}) · {o.zone_name} — {o.address_landmark}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold text-slate-700 tabular-nums">
                      <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-900">
                        {isAr ? 'الإجمالي:' : 'Total:'} {o.total_amount} ج.م
                      </span>
                      {o.payment_method === 'network' ? (
                        <span className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg font-bold">
                          {isAr ? '💳 شبكة / POS' : 'POS'}
                        </span>
                      ) : o.payment_method === 'wallet' ? (
                        <span className="px-2.5 py-1 bg-purple-50 border border-purple-200 text-purple-800 rounded-lg font-bold">
                          {isAr ? '📱 محفظة' : 'Wallet'}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-bold">
                          {isAr ? '💵 كاش' : 'Cash'}
                        </span>
                      )}
                      {o.captain_name ? (
                        <span className="px-2.5 py-1 bg-teal-50 border border-teal-200 text-teal-800 rounded-lg font-bold">
                          {isAr ? `الطيار: ${o.captain_name}` : `Captain: ${o.captain_name}`}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg font-bold">
                          {stats.allStoresReady
                            ? isAr
                              ? 'جاهز لإسناد الطيار'
                              : 'Ready for captain'
                            : isAr
                            ? 'بانتظار تجهيز كل المتاجر'
                            : 'Awaiting all stores'}
                        </span>
                      )}
                      {(o.captain_id || (o.chat_count ?? 0) > 0 || o.status === 'on_the_way') && (
                        <button
                          type="button"
                          onClick={() => setActiveChatOrderId(o.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>
                            {isAr ? 'مراقبة شات الطيار والعميل' : 'Monitor Chat'} ({o.chat_count ?? 0})
                          </span>
                        </button>
                      )}
                      {o.status !== 'delivered' && o.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleOrderWorkflow(o, 'deliver')}
                          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                        >
                          {isAr ? 'تم التسليم' : 'Delivered'}
                        </button>
                      )}
                      {portalMode === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setDeleteOrderTarget(o)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
                          title={isAr ? 'حذف هذا الطلب نهائيًا من المنظومة' : 'Delete order permanently'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{isAr ? 'حذف نهائي' : 'Delete'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Single Captain Dispatch Bar for the whole Order */}
                  {portalMode === 'admin' && o.status !== 'delivered' && o.status !== 'cancelled' && (
                    <div className="flex flex-wrap items-center gap-2 bg-white border border-orange-200 rounded-lg px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                        <Bike className="w-4 h-4 text-orange-600" />
                        <span>{isAr ? 'إسناد طيار واحد للطلب بالكامل:' : 'Assign Single Captain:'}</span>
                      </span>
                      <select
                        aria-label={isAr ? `اختيار طيار للطلب ${o.order_number}` : `Select captain for ${o.order_number}`}
                        value={capSelection}
                        onChange={(e) => setCaptainSelectMap((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        disabled={isSavingCap}
                        className="flex-1 min-w-[230px] max-w-md px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                      >
                        <option value="__auto__">
                          {isAr ? '⚡ إسناد تلقائي لأقرب طيار للمتجر الأكثر طلبًا' : '⚡ Auto-assign nearest to main store'}
                        </option>
                        {sortedApprovedCaptains.map((cap) => {
                          const availText =
                            cap.availability_status === 'available'
                              ? isAr
                                ? 'متاح'
                                : 'Available'
                              : cap.availability_status === 'busy'
                              ? isAr
                                ? 'مشغول'
                                : 'Busy'
                              : isAr
                              ? 'غير متصل'
                              : 'Offline';
                          const vehicleText = VEHICLE_LABELS_AR[cap.vehicle_type] || cap.vehicle_type;
                          return (
                            <option key={cap.id} value={cap.id}>
                              {cap.full_name} · {vehicleText} · ({availText}) · ★{Number(cap.rating_avg || 5).toFixed(1)}
                            </option>
                          );
                        })}
                        {o.captain_id && (
                          <option value="__none__">{isAr ? '✕ إلغاء إسناد الطيار (بدون طيار)' : '✕ Unassign captain'}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={isSavingCap}
                        onClick={() => handleAssignCaptainDirect(o)}
                        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg whitespace-nowrap"
                      >
                        {isSavingCap
                          ? isAr
                            ? 'جاري الإسناد...'
                            : 'Assigning...'
                          : o.captain_id
                          ? isAr
                            ? 'تعيين / تغيير الطيار'
                            : 'Reassign'
                          : isAr
                          ? 'إسناد الطيار المختار'
                          : 'Assign Selected'}
                      </button>
                      {!stats.allStoresReady && (
                        <button
                          type="button"
                          disabled={isSavingCap}
                          onClick={() => handleAdminMarkAllReadyAndAssign(o)}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg whitespace-nowrap"
                        >
                          {isAr ? 'تجهيز كل المتاجر + إسناد' : 'Mark All Ready & Assign'}
                        </button>
                      )}
                    </div>
                  )}

                  {o.delivery_proof_image_url && (
                    <div className="flex items-center gap-2 text-[11px] text-teal-800 font-semibold px-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                      <span>{isAr ? 'صورة التسليم عند منزل العميل مرفقة ✓' : 'Doorstep proof captured ✓'}</span>
                    </div>
                  )}

                  {/* Per-store sections inside the single order */}
                  <div className="space-y-2.5 ps-3 border-s-2 border-orange-300">
                    {stats.sections.map((sec) => {
                      const prepared = isStorePrepared(sec.prep_status);
                      const pickedUp = isSectionPickedUpByCaptain(sec, o.status);
                      const isAnchor = stats.anchorSection?.id === sec.id;
                      const itemsList =
                        Array.isArray(sec.items) && sec.items.length > 0
                          ? sec.items
                              .filter((it) => it.status !== 'rejected')
                              .map((it) => `${it.name_ar} × ${it.quantity} (${it.total_price} ج.م)`)
                              .join(' · ')
                          : sec.free_order_text || '-';

                      return (
                        <div key={sec.id} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Store className="w-4 h-4 text-orange-600 shrink-0" />
                              <span className="text-sm font-bold text-slate-900">{sec.merchant_name}</span>
                              {isAnchor && (
                                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold">
                                  {isAr ? `الأكثر طلبًا (${getSectionItemCount(sec)} قطع)` : `Anchor (${getSectionItemCount(sec)})`}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono-num font-bold text-slate-900">{sec.subtotal} ج.م</span>
                              {sec.prep_status === 'cancelled' ? (
                                <span className="px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold">
                                  {isAr ? 'ملغي' : 'Cancelled'}
                                </span>
                              ) : pickedUp ? (
                                <span className="px-2.5 py-0.5 rounded-md bg-teal-600 text-white font-bold">
                                  {isAr ? '✓ قد تم التجهيز واستلمه الطيار' : '✓ Ready & Picked Up'}
                                </span>
                              ) : prepared ? (
                                <span className="px-2.5 py-0.5 rounded-md bg-teal-100 text-teal-800 font-bold">
                                  {isAr ? '✓ قد تم التجهيز' : '✓ Prepared'}
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">
                                  {isAr ? '⏳ لم يتم التجهيز بعد' : '⏳ Not prepared yet'}
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-slate-700 bg-slate-50 rounded px-2.5 py-1.5">{itemsList}</p>

                          {o.status !== 'delivered' && o.status !== 'cancelled' && sec.prep_status !== 'cancelled' && !prepared && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center pt-1">
                              <input
                                type="number"
                                placeholder={isAr ? 'سعر الأصناف (ج.م)' : 'Items Subtotal'}
                                value={quoteMap[sec.id] ?? sec.subtotal}
                                onChange={(e) => setQuoteMap({ ...quoteMap, [sec.id]: Number(e.target.value) })}
                                className="px-2.5 py-1.5 border border-slate-200 rounded text-xs tabular-nums"
                              />
                              <input
                                type="text"
                                placeholder={
                                  sec.merchant_type === 'pharmacy'
                                    ? isAr
                                      ? 'مراجعة الصيدلي / بديل...'
                                      : 'Pharmacist note...'
                                    : isAr
                                    ? 'ملاحظة التاجر (اختياري)...'
                                    : 'Merchant note...'
                                }
                                value={
                                  sec.merchant_type === 'pharmacy'
                                    ? rxNoteMap[sec.id] ?? sec.pharmacist_notes ?? ''
                                    : subNoteMap[sec.id] ?? sec.substitution_note ?? ''
                                }
                                onChange={(e) =>
                                  sec.merchant_type === 'pharmacy'
                                    ? setRxNoteMap({ ...rxNoteMap, [sec.id]: e.target.value })
                                    : setSubNoteMap({ ...subNoteMap, [sec.id]: e.target.value })
                                }
                                className="md:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                              />
                              <div className="flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleSectionReady(o, sec)}
                                  className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded hover:bg-slate-800 whitespace-nowrap"
                                >
                                  {isAr ? 'تحديد كـ جاهز ✓' : 'Mark Ready ✓'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            return (
            <div key={o.id} className="py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{o.order_number}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-sm font-medium text-slate-800">{o.merchant_name}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-xs text-slate-500">
                    {o.customer_name} ({o.zone_name} — {o.address_landmark})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold text-slate-700 tabular-nums">
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    <span>{o.status} · {isAr ? 'الإجمالي:' : 'Total:'} {o.total_amount} ج.م</span>
                    {o.payment_method === 'network' ? (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-bold">
                        {isAr ? '💳 شبكة / POS' : 'POS'}
                      </span>
                    ) : o.payment_method === 'wallet' ? (
                      <span className="px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-800 text-[10px] font-bold">
                        {isAr ? '📱 محفظة' : 'Wallet'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                        {isAr ? '💵 كاش' : 'Cash'}
                      </span>
                    )}
                    {o.captain_name && ` · ${isAr ? 'الكابتن:' : 'Captain:'} ${o.captain_name}`}
                  </span>
                  {(o.captain_id || (o.chat_count ?? 0) > 0 || o.status === 'on_the_way') && (
                    <button
                      type="button"
                      onClick={() => setActiveChatOrderId(o.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>
                        {isAr ? 'مراقبة شات الطيار والعميل' : 'Monitor Chat'} ({o.chat_count ?? 0})
                      </span>
                    </button>
                  )}
                  {portalMode === 'admin' && (
                    <button
                      type="button"
                      onClick={() => setDeleteOrderTarget(o)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
                      title={isAr ? 'حذف هذا الطلب نهائيًا من المنظومة' : 'Delete order permanently'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isAr ? 'حذف نهائي' : 'Delete'}</span>
                    </button>
                  )}
                </div>
              </div>

              {(o.free_order_text || o.prescription_image_url || o.delivery_proof_image_url || o.captain_id) && (
                <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex flex-wrap items-start gap-3">
                  {o.prescription_image_url && (
                    <a
                      href={o.prescription_image_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 block border border-slate-200 rounded-lg overflow-hidden bg-white"
                      title={isAr ? 'اضغط لعرض صورة الروشتة بحجم كامل' : 'View prescription image'}
                    >
                      <img
                        src={o.prescription_image_url}
                        alt={o.order_number}
                        referrerPolicy="no-referrer"
                        className="w-20 h-20 object-cover"
                      />
                    </a>
                  )}
                  {o.delivery_proof_image_url && (
                    <button
                      type="button"
                      onClick={() => setActiveChatOrderId(o.id)}
                      className="shrink-0 flex items-center gap-2 border-2 border-teal-500 rounded-lg p-1.5 bg-teal-50 hover:bg-teal-100"
                      title={isAr ? 'صورة الأوردر عند منزل العميل' : 'Doorstep proof photo'}
                    >
                      <img
                        src={o.delivery_proof_image_url}
                        alt={`${o.order_number} delivery proof`}
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 rounded object-cover"
                      />
                      <div className="text-start text-[11px] text-teal-900 font-semibold">
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-teal-700" />
                          <span>{isAr ? 'صورة التسليم عند العميل ✓' : 'Proof Captured ✓'}</span>
                        </div>
                        <span className="text-[10px] text-teal-700">{isAr ? 'اضغط لفتح الشات' : 'Open Chat'}</span>
                      </div>
                    </button>
                  )}
                  {!o.delivery_proof_image_url && o.captain_id && o.status !== 'delivered' && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-semibold text-amber-800">
                      <Camera className="w-3.5 h-3.5" />
                      <span>{isAr ? 'بانتظار تصوير الطيار للأوردر عند منزل العميل' : 'Awaiting doorstep photo'}</span>
                    </div>
                  )}
                  {o.free_order_text && (
                    <p className="text-xs text-slate-700 flex-1 min-w-[180px]">
                      <strong>{o.order_channel === 'prescription' ? (isAr ? 'وصف الروشتة:' : 'Rx:') : isAr ? 'قائمة المشتريات:' : 'List:'}</strong>{' '}
                      {o.free_order_text}
                    </p>
                  )}
                </div>
              )}

              {o.status !== 'delivered' && o.status !== 'cancelled' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                    <input
                      type="number"
                      placeholder={isAr ? 'سعر الأصناف (ج.م)' : 'Items Subtotal'}
                      value={quoteMap[o.id] ?? o.subtotal}
                      onChange={(e) => setQuoteMap({ ...quoteMap, [o.id]: Number(e.target.value) })}
                      className="px-2.5 py-1.5 border border-slate-200 rounded text-xs tabular-nums"
                    />
                    {o.merchant_type === 'pharmacy' ? (
                      <input
                        type="text"
                        placeholder={isAr ? 'مراجعة الصيدلي / اقتراح بديل...' : 'Pharmacist note / alternative...'}
                        value={rxNoteMap[o.id] ?? o.pharmacist_notes ?? ''}
                        onChange={(e) => setRxNoteMap({ ...rxNoteMap, [o.id]: e.target.value })}
                        className="md:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder={isAr ? 'ملاحظة بدائل غير متوفرة (اختياري)...' : 'Substitution note (optional)...'}
                        value={subNoteMap[o.id] ?? o.substitution_note ?? ''}
                        onChange={(e) => setSubNoteMap({ ...subNoteMap, [o.id]: e.target.value })}
                        className="md:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                      />
                    )}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => handleOrderWorkflow(o, 'quote')}
                        className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded hover:bg-slate-800 whitespace-nowrap"
                      >
                        {portalMode === 'admin'
                          ? isAr
                            ? 'تسعير وتجهيز + إسناد'
                            : 'Quote & Assign'
                          : isAr
                          ? 'تسعير وتجهيز + إسناد كابتن'
                          : 'Quote & Dispatch'}
                      </button>
                      <button
                        onClick={() => handleOrderWorkflow(o, 'deliver')}
                        className="px-3 py-1.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700 whitespace-nowrap"
                      >
                        {isAr ? 'تم التسليم' : 'Mark Delivered'}
                      </button>
                    </div>
                  </div>

                  {portalMode === 'admin' && (
                    <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <Bike className="w-3.5 h-3.5 text-orange-600" />
                        <span>{isAr ? 'اختيار الطيار:' : 'Select Captain:'}</span>
                      </span>
                      <select
                        aria-label={isAr ? `اختيار طيار للطلب ${o.order_number}` : `Select captain for ${o.order_number}`}
                        value={captainSelectMap[o.id] ?? (o.captain_id || '__auto__')}
                        onChange={(e) => setCaptainSelectMap((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        disabled={assigningCaptainOrderId === o.id}
                        className="flex-1 min-w-[220px] max-w-md px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                      >
                        <option value="__auto__">
                          {isAr ? '⚡ إسناد تلقائي لأقرب طيار متاح' : '⚡ Auto-assign nearest available'}
                        </option>
                        {sortedApprovedCaptains.map((cap) => {
                          const availText =
                            cap.availability_status === 'available'
                              ? isAr
                                ? 'متاح'
                                : 'Available'
                              : cap.availability_status === 'busy'
                              ? isAr
                                ? 'مشغول'
                                : 'Busy'
                              : isAr
                              ? 'غير متصل'
                              : 'Offline';
                          const vehicleText = VEHICLE_LABELS_AR[cap.vehicle_type] || cap.vehicle_type;
                          return (
                            <option key={cap.id} value={cap.id}>
                              {cap.full_name} · {vehicleText} · ({availText}) · ★{Number(cap.rating_avg || 5).toFixed(1)}
                            </option>
                          );
                        })}
                        {o.captain_id && (
                          <option value="__none__">{isAr ? '✕ إلغاء إسناد الطيار (بدون طيار)' : '✕ Unassign captain'}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={assigningCaptainOrderId === o.id}
                        onClick={() => handleAssignCaptainDirect(o)}
                        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg whitespace-nowrap"
                      >
                        {assigningCaptainOrderId === o.id
                          ? isAr
                            ? 'جاري الإسناد...'
                            : 'Assigning...'
                          : o.captain_id
                          ? isAr
                            ? 'تعيين / تغيير الطيار'
                            : 'Assign / Reassign'
                          : isAr
                          ? 'إسناد الطيار المختار'
                          : 'Assign Selected'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {portalMode === 'admin' && trips.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-orange-600" />
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'مشاوير «اطلبها مشوار» المباشرة (تتبع GPS ومراقبة الشات)' : 'Live Rides & GPS Monitor'}
            </h3>
          </div>
          <div className="divide-y divide-slate-200">
            {trips.map((t) => (
              <div key={t.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">
                    <span className="font-mono-num">{t.trip_number}</span> · {t.customer_name} ({t.vehicle_type})
                  </p>
                  <p className="text-xs text-slate-600">
                    من: {t.pickup_address} ← إلى: {t.dropoff_address} · {t.distance_km} كم · {t.estimated_fare} ج.م
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-slate-100 text-slate-800 font-semibold">
                    {t.status}
                    {t.captain_name ? ` · ${t.captain_name}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveChatTripId(t.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>
                      {isAr ? 'فتح الشات و GPS' : 'Trip Chat & GPS'} ({t.chat_count ?? 0})
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {portalMode === 'admin' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'توثيق التجار وتراخيص الصيدليات والعمولات الخاصة' : 'Merchants & Pharmacy License Verification'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr
                  ? 'اضغط على أي تاجر أو متجر لعرض ملفه ومعلوماته الكاملة (البيانات القانونية، GPS، المحفظة، الأقسام، والطلبات).'
                  : 'Click any merchant row to inspect complete profile, GPS location, wallet, and orders.'}
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              {merchants.length} {isAr ? 'تاجر / صيدلية' : 'Merchants'}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 text-start">{isAr ? 'المتجر / الصيدلية' : 'Business'}</th>
                <th className="py-2 text-start">{isAr ? 'الترخيص / النقابة' : 'License'}</th>
                <th className="py-2 text-start">{isAr ? 'العمولة (%)' : 'Commission %'}</th>
                <th className="py-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="py-2 text-end">{isAr ? 'إجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {merchants.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => openMerchantDetails(m)}
                  className="cursor-pointer hover:bg-orange-50/40 transition-colors"
                >
                  <td className="py-2.5 font-medium text-slate-900">
                    <div className="flex items-center gap-2.5">
                      {m.image_url ? (
                        <img
                          src={m.image_url}
                          alt={m.business_name_ar}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-50"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shrink-0">
                          <Store className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-slate-900 hover:text-orange-700">{m.business_name_ar}</span>{' '}
                        <span className="text-xs text-slate-500">({m.zone_name})</span>
                        {m.owner_name && (
                          <p className="text-[11px] text-slate-500 font-normal">
                            المالك: {m.owner_name} {m.owner_national_id ? `(${m.owner_national_id})` : ''}
                          </p>
                        )}
                        {m.address_detail && (
                          <p className="text-[11px] text-slate-400 font-normal">{m.address_detail}</p>
                        )}
                        {m.lat != null && m.lng != null && (
                          <p className="text-[10px] text-teal-700 font-mono-num" dir="ltr">
                            GPS: {Number(m.lat).toFixed(4)}, {Number(m.lng).toFixed(4)}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-xs text-slate-600 tabular-nums space-y-0.5">
                    <div>
                      {m.pharmacy_license_no
                        ? `${m.pharmacy_license_no} · ${m.pharmacist_name} (${m.syndicate_no})`
                        : MERCHANT_TYPE_LABELS[m.merchant_type] || m.merchant_type}
                    </div>
                    {m.commercial_reg_no && <div className="text-[11px] text-slate-500">سجل: {m.commercial_reg_no}</div>}
                    {m.is_email_verified && (
                      <div className="text-[11px] font-semibold text-indigo-700">بريد إلكتروني موثّق ✓</div>
                    )}
                    {m.terms_accepted && (
                      <div className="text-[11px] font-semibold text-teal-700">موافق على الاتفاقية ✓</div>
                    )}
                    {m.license_doc_url && (
                      <img
                        src={m.license_doc_url}
                        alt="License"
                        className="w-12 h-8 object-cover rounded border border-slate-200 mt-1"
                      />
                    )}
                  </td>
                  <td className="py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={commEdit[m.id] ?? m.commission_rate}
                        onChange={(e) => setCommEdit({ ...commEdit, [m.id]: Number(e.target.value) })}
                        className="w-20 px-2 py-1 border border-slate-200 rounded text-xs tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => handleMerchantSave(m)}
                        className="px-2 py-1 bg-slate-900 text-white text-xs rounded"
                      >
                        {isAr ? 'حفظ' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 text-xs font-medium">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold ${
                        VERIFICATION_STATUS_LABELS[m.verification_status]?.cls ||
                        'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {m.verification_status === 'approved'
                        ? 'معتمد'
                        : m.verification_status === 'pending'
                        ? 'بانتظار الموافقة'
                        : m.verification_status === 'suspended'
                        ? 'موقوف'
                        : m.verification_status}
                    </span>
                  </td>
                  <td className="py-2.5 text-end" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openMerchantDetails(m)}
                        title={isAr ? 'عرض كافة معلومات التاجر' : 'View Full Details'}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{isAr ? 'التفاصيل' : 'Details'}</span>
                      </button>
                      {m.verification_status !== 'approved' && (
                        <button
                          type="button"
                          onClick={() => handleMerchantSave(m, { verification_status: 'approved' })}
                          className="px-3 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg hover:bg-teal-700 whitespace-nowrap"
                        >
                          {isAr ? 'اعتماد التاجر' : 'Approve'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(m)}
                        title={isAr ? 'حذف المتجر / التاجر' : 'Delete Merchant'}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isAr ? 'حذف' : 'Delete'}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedMerchant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/70"
          onClick={() => setSelectedMerchant(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {selectedMerchant.image_url ? (
                  <img
                    src={selectedMerchant.image_url}
                    alt={selectedMerchant.business_name_ar}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-xl object-cover border-2 border-white/20 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-orange-600 text-white flex items-center justify-center shrink-0">
                    {selectedMerchant.merchant_type === 'pharmacy' ? (
                      <Pill className="w-6 h-6" />
                    ) : (
                      <Store className="w-6 h-6" />
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-extrabold truncate">{selectedMerchant.business_name_ar}</h3>
                    {selectedMerchant.business_name_en && (
                      <span className="text-xs text-slate-300 font-normal">({selectedMerchant.business_name_en})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-white/10 font-semibold text-white">
                      {MERCHANT_TYPE_LABELS[selectedMerchant.merchant_type] || selectedMerchant.merchant_type}
                    </span>
                    <span>الفرع: {selectedMerchant.branch_name || 'الرئيسي'}</span>
                    <span>·</span>
                    <span>{selectedMerchant.zone_name}</span>
                    <span>·</span>
                    <span
                      className={`px-2 py-0.5 rounded font-bold ${
                        selectedMerchant.is_open_now ? 'bg-teal-500/20 text-teal-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {selectedMerchant.is_open_now ? 'مفتوح الآن' : 'مغلق حاليًا'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMerchant(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-700">
              {/* Verification status banner + quick KPIs */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-600">حالة الاعتماد على المنصة:</span>
                  <span
                    className={`px-2.5 py-1 rounded-full border font-bold ${
                      VERIFICATION_STATUS_LABELS[selectedMerchant.verification_status]?.cls ||
                      'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {VERIFICATION_STATUS_LABELS[selectedMerchant.verification_status]?.ar ||
                      selectedMerchant.verification_status}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono-num" dir="ltr">
                  ID: {selectedMerchant.id}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">الأقسام</p>
                  <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                    {loadingMerchantDetail ? '...' : merchantDetail?.stats.categories_count ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">المنتجات</p>
                  <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                    {loadingMerchantDetail
                      ? '...'
                      : `${merchantDetail?.stats.products_available ?? 0} / ${merchantDetail?.stats.products_total ?? 0}`}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">إجمالي الطلبات</p>
                  <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                    {loadingMerchantDetail
                      ? selectedMerchant.orders_count
                      : `${merchantDetail?.stats.orders_delivered ?? 0} مكتمل / ${merchantDetail?.stats.orders_total ?? 0}`}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">إجمالي المبيعات</p>
                  <p className="text-base font-extrabold text-teal-700 mt-0.5 tabular-nums">
                    {loadingMerchantDetail ? '...' : `${(merchantDetail?.stats.total_sales ?? 0).toLocaleString('en-US')} ج.م`}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">رصيد المحفظة المتاح</p>
                  <p className="text-base font-extrabold text-indigo-700 mt-0.5 tabular-nums">
                    {loadingMerchantDetail
                      ? '...'
                      : `${(merchantDetail?.wallet?.available_balance ?? 0).toLocaleString('en-US')} ج.م`}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[11px] text-slate-500">عمولة المنصة</p>
                  <p className="text-base font-extrabold text-orange-600 mt-0.5 tabular-nums">
                    {selectedMerchant.commission_rate}%
                  </p>
                </div>
              </div>

              {/* 2-Column Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Owner & Contact */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                    <User className="w-4 h-4 text-orange-600" />
                    <span>بيانات المالك والتواصل والحساب</span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-3">
                    <div>
                      <span className="text-[11px] text-slate-400 block">اسم المالك / المسؤول</span>
                      <span className="font-bold text-slate-900">{selectedMerchant.owner_name || 'غير مسجل'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">الرقم القومي للمالك</span>
                      <span className="font-bold text-slate-900 font-mono-num" dir="ltr">
                        {selectedMerchant.owner_national_id || 'غير مسجل'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[11px] text-slate-400 block">البريد الإلكتروني</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 inline-flex items-center gap-1" dir="ltr">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {selectedMerchant.email || 'غير مسجل'}
                        </span>
                        {selectedMerchant.is_email_verified ? (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                            موثّق ✓
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                            غير موثّق
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">رقم الهاتف الأساسي</span>
                      <span className="font-bold text-slate-900 inline-flex items-center gap-1 font-mono-num" dir="ltr">
                        <Phone className="w-3.5 h-3.5 text-teal-600" />
                        {selectedMerchant.phone || 'غير مسجل'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">رقم الواتساب</span>
                      <span className="font-bold text-slate-900 font-mono-num" dir="ltr">
                        {selectedMerchant.whatsapp_phone || selectedMerchant.phone || 'غير مسجل'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">ساعات العمل</span>
                      <span className="font-semibold text-slate-800 inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {selectedMerchant.working_hours || 'غير محدد'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">استقبال الطلب الحر</span>
                      <span className="font-semibold text-slate-800">
                        {selectedMerchant.supports_free_order ? 'نعم (مفعّل ✓)' : 'لا (كتالوج فقط)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Legal, Licenses & Financial Payout */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                    <FileCheck2 className="w-4 h-4 text-teal-600" />
                    <span>التراخيص والاتفاقية والتسوية المالية</span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-3">
                    <div>
                      <span className="text-[11px] text-slate-400 block">السجل التجاري / الضريبي</span>
                      <span className="font-bold text-slate-900 font-mono-num">
                        {selectedMerchant.commercial_reg_no || 'غير مرفق'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">الموافقة على الاتفاقية</span>
                      <span className="font-bold text-teal-700">
                        {selectedMerchant.terms_accepted ? 'موافق وموقّع إلكترونيًا ✓' : 'لم يوقّع بعد'}
                      </span>
                      {selectedMerchant.terms_accepted_at && (
                        <span className="text-[10px] text-slate-400 block font-mono-num" dir="ltr">
                          {selectedMerchant.terms_accepted_at}
                        </span>
                      )}
                    </div>

                    {(selectedMerchant.merchant_type === 'pharmacy' ||
                      selectedMerchant.pharmacy_license_no ||
                      selectedMerchant.pharmacist_name) && (
                      <div className="col-span-2 p-2.5 rounded-lg bg-teal-50/70 border border-teal-200 grid grid-cols-3 gap-2">
                        <div>
                          <span className="text-[10px] text-teal-700 block">ترخيص الصيدلية</span>
                          <span className="font-bold text-teal-950 font-mono-num">
                            {selectedMerchant.pharmacy_license_no || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-teal-700 block">الصيدلي المدير</span>
                          <span className="font-bold text-teal-950">{selectedMerchant.pharmacist_name || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-teal-700 block">رقم النقابة</span>
                          <span className="font-bold text-teal-950 font-mono-num">
                            {selectedMerchant.syndicate_no || '—'}
                          </span>
                        </div>
                      </div>
                    )}

                    <div>
                      <span className="text-[11px] text-slate-400 block">طريقة استلام المستحقات</span>
                      <span className="font-bold text-slate-900 inline-flex items-center gap-1">
                        <Wallet className="w-3.5 h-3.5 text-indigo-600" />
                        {PAYOUT_METHOD_LABELS[selectedMerchant.payout_method || ''] ||
                          selectedMerchant.payout_method ||
                          'غير محدد'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">رقم / حساب التحويل</span>
                      <span className="font-bold text-slate-900 font-mono-num" dir="ltr">
                        {selectedMerchant.payout_account || 'غير مسجل'}
                      </span>
                    </div>

                    {merchantDetail?.wallet && (
                      <div className="col-span-2 flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                        <span className="text-slate-600">
                          الرصيد المعلق:{' '}
                          <strong className="text-slate-900">
                            {merchantDetail.wallet.pending_balance.toLocaleString('en-US')} ج.م
                          </strong>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            merchantDetail.wallet.is_frozen ? 'bg-rose-100 text-rose-700' : 'bg-teal-50 text-teal-700'
                          }`}
                        >
                          {merchantDetail.wallet.is_frozen ? 'المحفظة مجمدة' : 'المحفظة نشطة'}
                        </span>
                      </div>
                    )}

                    {selectedMerchant.license_doc_url && (
                      <div className="col-span-2 pt-1">
                        <span className="text-[11px] text-slate-400 block mb-1">صورة الترخيص / السجل التجاري</span>
                        <button
                          type="button"
                          onClick={() => setLicenseLightboxUrl(selectedMerchant.license_doc_url || null)}
                          className="group relative inline-flex items-center gap-2 p-1.5 border border-slate-200 rounded-lg hover:border-orange-400 bg-slate-50"
                        >
                          <img
                            src={selectedMerchant.license_doc_url}
                            alt="License document"
                            className="w-24 h-16 object-cover rounded"
                          />
                          <span className="text-[11px] font-bold text-orange-700 px-1.5">اضغط لتكبير المستند</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Location & GPS Map */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <MapPin className="w-4 h-4 text-orange-600" />
                    <span>الموقع الجغرافي والعنوان على الخريطة (GPS)</span>
                  </div>
                  {selectedMerchant.lat != null && selectedMerchant.lng != null && (
                    <span className="text-[11px] font-bold text-teal-700 font-mono-num" dir="ltr">
                      {Number(selectedMerchant.lat).toFixed(6)}, {Number(selectedMerchant.lng).toFixed(6)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block">المنطقة الإدارية</span>
                    <span className="font-bold text-slate-900">{selectedMerchant.zone_name}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">الفرع</span>
                    <span className="font-bold text-slate-900">{selectedMerchant.branch_name || 'الرئيسي'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">العنوان التفصيلي</span>
                    <span className="font-bold text-slate-900">{selectedMerchant.address_detail || 'محدد عبر الـ GPS'}</span>
                  </div>
                </div>
                {selectedMerchant.lat != null && selectedMerchant.lng != null ? (
                  <GpsMapPicker
                    heightClass="h-52"
                    pickup={{
                      lat: Number(selectedMerchant.lat),
                      lng: Number(selectedMerchant.lng),
                      label: selectedMerchant.business_name_ar,
                    }}
                    center={[Number(selectedMerchant.lat), Number(selectedMerchant.lng)]}
                    zoom={15}
                  />
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    لم يتم تسجيل إحداثيات GPS لهذا المتجر بعد.
                  </p>
                )}
              </div>

              {/* Categories & Recent Orders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-indigo-600" />
                      أقسام المتجر ({merchantDetail?.categories.length ?? 0})
                    </span>
                  </div>
                  {loadingMerchantDetail ? (
                    <p className="text-slate-400">جاري تحميل الأقسام...</p>
                  ) : !merchantDetail || merchantDetail.categories.length === 0 ? (
                    <p className="text-slate-400">لا توجد أقسام مسجلة لهذا المتجر بعد.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {merchantDetail.categories.map((cat) => (
                        <div
                          key={cat.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${
                            cat.is_offers_section
                              ? 'bg-orange-50 border-orange-200 text-orange-800'
                              : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        >
                          {cat.image_url && (
                            <img src={cat.image_url} alt={cat.name_ar} className="w-5 h-5 rounded-full object-cover" />
                          )}
                          <span>{cat.name_ar}</span>
                          {cat.is_offers_section && <span className="text-[10px]">(عروض)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-teal-600" />
                      أحدث الطلبات ({merchantDetail?.recent_orders.length ?? 0})
                    </span>
                  </div>
                  {loadingMerchantDetail ? (
                    <p className="text-slate-400">جاري تحميل الطلبات...</p>
                  ) : !merchantDetail || merchantDetail.recent_orders.length === 0 ? (
                    <p className="text-slate-400">لا توجد طلبات مسجلة لهذا المتجر حتى الآن.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-44 overflow-y-auto">
                      {merchantDetail.recent_orders.map((ord) => (
                        <div key={ord.id} className="py-1.5 flex items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-slate-900 font-mono-num">{ord.order_number}</span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="text-slate-700">{ord.customer_name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                              {ord.status}
                            </span>
                            <span className="font-bold text-slate-900 tabular-nums">{ord.total_amount} ج.م</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {selectedMerchant.verification_status !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleMerchantSave(selectedMerchant, { verification_status: 'approved' })}
                    className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold"
                  >
                    اعتماد التاجر ونشر المتجر
                  </button>
                )}
                {selectedMerchant.verification_status === 'approved' ? (
                  <button
                    type="button"
                    onClick={() => handleMerchantSave(selectedMerchant, { verification_status: 'suspended' })}
                    className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold"
                  >
                    إيقاف مؤقت
                  </button>
                ) : selectedMerchant.verification_status === 'suspended' ? (
                  <button
                    type="button"
                    onClick={() => handleMerchantSave(selectedMerchant, { verification_status: 'approved' })}
                    className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold"
                  >
                    إعادة تفعيل المتجر
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleMerchantSave(selectedMerchant, { is_open_now: !selectedMerchant.is_open_now })}
                  className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold"
                >
                  {selectedMerchant.is_open_now ? 'تبديل إلى مغلق' : 'تبديل إلى مفتوح'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(selectedMerchant)}
                  className="inline-flex items-center gap-1 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف المتجر</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMerchant(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {licenseLightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85"
          onClick={() => setLicenseLightboxUrl(null)}
        >
          <div className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white">
              <span className="text-xs font-bold">معاينة مستند الترخيص / السجل التجاري</span>
              <button
                type="button"
                onClick={() => setLicenseLightboxUrl(null)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-100 flex items-center justify-center max-h-[80vh] overflow-auto">
              <img src={licenseLightboxUrl} alt="License full preview" className="max-w-full max-h-[72vh] rounded-lg object-contain" />
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/65">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-rose-700 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {isAr ? 'تأكيد حذف المتجر / التاجر نهائيًا' : 'Confirm Delete Merchant'}
              </h3>
              <button
                type="button"
                onClick={() => !deletingMerchant && setDeleteTarget(null)}
                className="p-1 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-2.5 text-xs text-slate-700 leading-relaxed">
              <p className="text-sm font-bold text-slate-900">
                هل أنت متأكد من حذف «{deleteTarget.business_name_ar}»؟
              </p>
              <p>
                سيتم إزالة حساب التاجر/الصيدلية وأقسامه ومنتجاته وطلباته ومحفظته نهائيًا من لوحة التحكم والمنصة، ولن يظهر للعملاء بعد الحذف.
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingMerchant}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingMerchant}
                onClick={handleConfirmDeleteMerchant}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingMerchant ? 'جاري الحذف...' : isAr ? 'تأكيد الحذف النهائي' : 'Confirm Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOrderTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/65">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-rose-100">
            <div className="bg-rose-700 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <h3 className="text-sm font-bold">
                  {isAr ? 'حذف الطلب نهائيًا من قاعدة البيانات' : 'Permanently Delete Order'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !deletingOrder && setDeleteOrderTarget(null)}
                className="p-1 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                <p className="text-sm font-bold text-rose-900">
                  {isAr ? `تأكيد حذف الطلب رقم #${deleteOrderTarget.order_number}` : `Order #${deleteOrderTarget.order_number}`}
                </p>
                <p className="text-xs text-rose-700">
                  {isAr ? 'العميل:' : 'Customer:'} {deleteOrderTarget.customer_name} ({deleteOrderTarget.customer_phone}) · {deleteOrderTarget.total_amount} ج.م
                </p>
              </div>
              <p className="text-slate-600">
                {isAr
                  ? 'تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم حذف الطلب وكافة أقسام المتاجر التابعة له ومحادثات الشات وسجل التوصيل فورًا من النظام.'
                  : 'Warning: This action is permanent and cannot be undone. The order, its store sections, and all chat records will be purged from the system.'}
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingOrder}
                onClick={() => setDeleteOrderTarget(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingOrder}
                onClick={handleConfirmDeleteOrder}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingOrder ? (isAr ? 'جاري الحذف...' : 'Deleting...') : isAr ? 'نعم، حذف نهائي' : 'Yes, Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
