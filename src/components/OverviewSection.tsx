import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Bike,
  Check,
  CreditCard,
  Headphones,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import { api } from '../lib/api.ts';
import {
  computeOrderStoreStats,
  getSectionItemCount,
  isSectionPickedUpByCaptain,
  isStorePrepared,
} from '../lib/orderBundles.ts';
import type {
  CaptainRecord,
  Language,
  OrderRecord,
  PaymentSettings,
  ServiceConfig,
  SupportMessageRecord,
  SupportTicketRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  overview: Record<string, number> | null;
  services: ServiceConfig[];
  captains?: CaptainRecord[];
  orders?: OrderRecord[];
  onNavigate: (tab: string) => void;
  onToggleService: (key: string, nextEnabled: boolean) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onNotify?: (msg: string) => void;
}

const VEHICLE_LABELS_AR: Record<string, string> = {
  moto: 'موتوسيكل',
  tuktuk: 'توكتوك',
  car: 'سيارة',
  bicycle: 'دراجة',
};

const ORDER_STATUS_AR: Record<string, { ar: string; en: string; cls: string }> = {
  pending_merchant: { ar: 'بانتظار التاجر', en: 'Pending Merchant', cls: 'bg-amber-100 text-amber-800' },
  awaiting_quote: { ar: 'بانتظار التسعير', en: 'Awaiting Quote', cls: 'bg-amber-100 text-amber-800' },
  preparing: { ar: 'قيد التجهيز', en: 'Preparing', cls: 'bg-sky-100 text-sky-800' },
  ready_for_pickup: { ar: 'جاهز للاستلام', en: 'Ready', cls: 'bg-indigo-100 text-indigo-800' },
  on_the_way: { ar: 'في الطريق', en: 'On The Way', cls: 'bg-teal-100 text-teal-800' },
};

export const OverviewSection: React.FC<Props> = ({
  lang,
  overview,
  services,
  captains = [],
  orders = [],
  onNavigate,
  onToggleService,
  onRefresh,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [supportTickets, setSupportTickets] = useState<SupportTicketRecord[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessageRecord[]>([]);
  const [adminReply, setAdminReply] = useState<string>('');
  const [sendingReply, setSendingReply] = useState<boolean>(false);
  const [captainDraftMap, setCaptainDraftMap] = useState<Record<string, string>>({});
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [orderDispatchFilter, setOrderDispatchFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [savingPayments, setSavingPayments] = useState(false);
  const [paymentSavedToast, setPaymentSavedToast] = useState(false);

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

  const activeOrders = useMemo(() => {
    return orders
      .filter((o) => !['delivered', 'cancelled', 'refunded'].includes(o.status))
      .slice()
      .sort((a, b) => {
        const unA = a.captain_id ? 1 : 0;
        const unB = b.captain_id ? 1 : 0;
        if (unA !== unB) return unA - unB;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (orderDispatchFilter === 'unassigned') {
      return activeOrders.filter((o) => !o.captain_id);
    }
    if (orderDispatchFilter === 'assigned') {
      return activeOrders.filter((o) => Boolean(o.captain_id));
    }
    return activeOrders;
  }, [activeOrders, orderDispatchFilter]);

  const handleAssignCaptainFromOverview = async (order: OrderRecord) => {
    const chosen = captainDraftMap[order.id] ?? (order.captain_id || '');
    if (!chosen) {
      onNotify?.(isAr ? 'اختر طيارًا أولاً أو اختر الإسناد التلقائي' : 'Select a captain first');
      return;
    }
    setAssigningOrderId(order.id);
    try {
      let payload: Record<string, unknown>;
      if (chosen === '__auto__') {
        payload = { assign_best_captain: true };
      } else if (chosen === '__none__') {
        payload = { captain_id: null };
      } else {
        payload = { captain_id: chosen };
      }
      const res = await api.adminUpdateOrder(order.id, payload);
      setCaptainDraftMap((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      await onRefresh?.();
      if (chosen === '__none__') {
        onNotify?.(isAr ? `تم إلغاء إسناد الطيار للطلب #${order.order_number}` : `Unassigned captain for #${order.order_number}`);
      } else if (chosen === '__auto__') {
        const capName = res.order?.captain_name;
        onNotify?.(
          capName
            ? isAr
              ? `تم إسناد الطلب #${order.order_number} تلقائيًا للكابتن ${capName}`
              : `Auto-assigned #${order.order_number} to ${capName}`
            : isAr
            ? 'لا يوجد طيار متاح للإسناد التلقائي حاليًا — اختر طيارًا يدويًا من القائمة'
            : 'No available captain found'
        );
      } else {
        const capName = res.order?.captain_name || sortedApprovedCaptains.find((c) => c.id === chosen)?.full_name || '';
        onNotify?.(
          isAr
            ? `تم إسناد الطلب #${order.order_number} للطيار ${capName}`
            : `Assigned #${order.order_number} to ${capName}`
        );
      }
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setAssigningOrderId(null);
    }
  };

  const loadSupportPreview = async (keepSelection = true) => {
    try {
      const list = await api.getSupportTickets();
      setSupportTickets(list);
      if (list.length > 0) {
        const nextId =
          keepSelection && selectedTicketId && list.some((t) => t.id === selectedTicketId)
            ? selectedTicketId
            : list[0].id;
        setSelectedTicketId(nextId);
        const detail = await api.getSupportMessages(nextId);
        setSupportMessages(detail.messages || []);
      } else {
        setSelectedTicketId(null);
        setSupportMessages([]);
      }
    } catch {
      // ignore initial failure
    }
  };

  const loadPaymentSettings = async () => {
    try {
      const s = await api.getPaymentSettings();
      setPaymentSettings(s);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSupportPreview(false);
    loadPaymentSettings();
  }, []);

  const handleSavePaymentSettings = async (partial?: Partial<PaymentSettings>) => {
    if (!paymentSettings) return;
    const payload = partial ? { ...paymentSettings, ...partial } : paymentSettings;
    setSavingPayments(true);
    try {
      const res = await api.updatePaymentSettings(payload);
      setPaymentSettings(res.settings);
      setPaymentSavedToast(true);
      setTimeout(() => setPaymentSavedToast(false), 3000);
      onNotify?.(isAr ? 'تم حفظ وتحديث إعدادات الدفع بنجاح' : 'Payment settings saved successfully');
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSavingPayments(false);
    }
  };

  useEffect(() => {
    if (!selectedTicketId) return;
    api
      .getSupportMessages(selectedTicketId)
      .then((d) => setSupportMessages(d.messages || []))
      .catch(() => setSupportMessages([]));
  }, [selectedTicketId]);

  const activeTicket = supportTickets.find((t) => t.id === selectedTicketId) || null;

  const handleQuickAdminReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !adminReply.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      await api.sendSupportMessage(activeTicket.id, {
        sender_role: 'admin',
        sender_name: isAr ? 'إدارة اطلبها' : 'Otlobha Admin',
        message_text: adminReply.trim(),
      });
      setAdminReply('');
      await loadSupportPreview(true);
      onNotify?.(
        isAr
          ? `تم إرسال الرد إلى ${activeTicket.customer_name}`
          : `Reply sent to ${activeTicket.customer_name}`
      );
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSendingReply(false);
    }
  };

  if (!overview) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const kpis = [
    {
      label: isAr ? 'إجمالي المبيعات (GMV)' : 'Gross Merchandise Value',
      value: `${overview.gmvTotal?.toLocaleString('en-US')} ${isAr ? 'ج.م' : 'EGP'}`,
      sub: isAr ? `${overview.ordersCount} طلب مسجل` : `${overview.ordersCount} recorded orders`,
    },
    {
      label: isAr ? 'إيرادات المنصة (الدفتر المركزي)' : 'Platform Ledger Revenue',
      value: `${overview.platformRevenue?.toLocaleString('en-US')} ${isAr ? 'ج.م' : 'EGP'}`,
      sub: isAr
        ? `غرامات الطيارين: ${overview.totalCaptainPenalties ?? 0} ج.م · Escrow: ${overview.escrowHeld}`
        : `Penalties: ${overview.totalCaptainPenalties ?? 0} EGP`,
    },
    {
      label: isAr ? 'تقييمات الطيارين المسجلة' : 'Captain Ratings',
      value: `${overview.avgCaptainRating ?? 5} ★ (${overview.ratingsCount ?? 0})`,
      sub: isAr
        ? `مشاوير نشطة الآن: ${overview.activeTripsCount ?? 0}`
        : `Active trips now: ${overview.activeTripsCount ?? 0}`,
    },
    {
      label: isAr ? 'الكباتن المتاحون بالمنزلة' : 'Available Captains (El Manzala)',
      value: `${overview.captainsAvailable} / ${overview.captainsTotal}`,
      sub: isAr ? `بانتظار المراجعة: ${overview.captainsPending}` : `Pending review: ${overview.captainsPending}`,
    },
  ];

  const actionQueue = [
    {
      title: isAr ? 'رسائل وتواصل العملاء مع الإدارة' : 'Customer support messages',
      count: overview.supportOpenCount ?? supportTickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
      tab: 'support',
      actionLabel: isAr ? 'فتح الدعم والتواصل' : 'Open Support',
    },
    {
      title: isAr ? 'كباتن بانتظار توثيق المركبات والمستندات' : 'Captains awaiting KYC review',
      count: overview.captainsPending,
      tab: 'captains',
      actionLabel: isAr ? 'مراجعة الكباتن' : 'Review Captains',
    },
    {
      title: isAr ? 'طلبات نشطة / بانتظار التسعير الحر' : 'Active / free-text orders',
      count: overview.ordersActive,
      tab: 'orders',
      actionLabel: isAr ? 'إدارة الطلبات' : 'Manage Orders',
    },
    {
      title: isAr ? 'إعلانات السوق بانتظار الموافقة' : 'Market listings awaiting moderation',
      count: overview.marketPending,
      tab: 'market',
      actionLabel: isAr ? 'مراجعة السوق' : 'Moderate Market',
    },
    {
      title: isAr ? 'شكاوى ونزاعات مفتوحة' : 'Open complaints & disputes',
      count: overview.complaintsOpen,
      tab: 'governance',
      actionLabel: isAr ? 'معالجة الشكاوى' : 'Resolve Disputes',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {isAr ? 'مركز القيادة الموحد — اطلبها (المنزلة، الدقهلية)' : 'Otlobha Unified Command — El Manzala, Dakahlia'}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {isAr
              ? 'البيانات المعروضة هنا مرتبطة بقاعدة البيانات المحلية المبدئية للتجربة؛ يمكنك تعديل الأسعار وتفعيل الخدمات وتنفيذ الطلبات والقيود المحاسبية مباشرة.'
              : 'Live local database workspace for El Manzala pilot operations. Every pricing rule, approval, and ledger entry persists immediately.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate('captains')}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {isAr ? 'خريطة الطيارين والتقييمات' : 'Captains Map & Ratings'}
          </button>
          <button
            onClick={() => onNavigate('pricing')}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {isAr ? 'التحكم بالتسعير والعمولات' : 'Control Pricing & Commissions'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-medium text-slate-500">{k.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{k.value}</p>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Active Orders & Manual Captain Selection Panel on Main Dashboard */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'الطلبات النشطة وإسناد الطيارين' : 'Active Orders & Captain Assignment'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'اختر الطيار المناسب لكل طلب من القائمة وأسنده مباشرة، أو استخدم الإسناد التلقائي لأقرب طيار متاح.'
                  : 'Select a specific captain from the fleet list or auto-dispatch to the nearest available captain.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {(
                [
                  { id: 'all', label: isAr ? `الكل (${activeOrders.length})` : `All (${activeOrders.length})` },
                  {
                    id: 'unassigned',
                    label: isAr
                      ? `بدون طيار (${activeOrders.filter((o) => !o.captain_id).length})`
                      : `Unassigned (${activeOrders.filter((o) => !o.captain_id).length})`,
                  },
                  {
                    id: 'assigned',
                    label: isAr
                      ? `مسندة (${activeOrders.filter((o) => Boolean(o.captain_id)).length})`
                      : `Assigned (${activeOrders.filter((o) => Boolean(o.captain_id)).length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setOrderDispatchFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    orderDispatchFilter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold whitespace-nowrap"
            >
              {isAr ? 'إدارة كل الطلبات ←' : 'All Orders'}
            </button>
          </div>
        </div>

        {sortedApprovedCaptains.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3.5 py-2.5 text-xs font-medium">
            {isAr
              ? 'لا يوجد طيارون معتمدون حاليًا في النظام — يمكنك مراجعة واعتماد الكباتن من قسم إدارة الكباتن.'
              : 'No approved captains available yet.'}
          </div>
        )}

        {visibleOrders.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-xs text-slate-500">
            {isAr ? 'لا توجد طلبات نشطة مطابقة للفلتر حاليًا.' : 'No active orders matching this filter.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {visibleOrders.slice(0, 12).map((o) => {
              const stats = computeOrderStoreStats(o);
              if (stats.isMultiStore) {
                const currentSelection = captainDraftMap[o.id] ?? (o.captain_id || '');
                const isSaving = assigningOrderId === o.id;
                const isUnchanged =
                  (currentSelection === '' && !o.captain_id) ||
                  (currentSelection === o.captain_id && Boolean(o.captain_id));

                return (
                  <div key={o.id} className="p-4 bg-orange-50/35 hover:bg-orange-50/55 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-md bg-orange-600 text-white text-[11px] font-bold">
                            {isAr ? `طلب مقسم (${stats.activeSections.length} متاجر)` : `Multi-store (${stats.activeSections.length})`}
                          </span>
                          <span className="font-mono-num font-bold text-slate-900">#{o.order_number}</span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                              stats.allStoresReady
                                ? 'bg-teal-100 text-teal-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isAr
                              ? `تم تجهيز ${stats.readyCount} من ${stats.activeSections.length}`
                              : `Prepared ${stats.readyCount}/${stats.activeSections.length}`}
                          </span>
                          {stats.anchorSection && (
                            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-semibold">
                              {isAr ? `الأكثر طلبًا: ${stats.anchorSection.merchant_name}` : `Main: ${stats.anchorSection.merchant_name}`}
                            </span>
                          )}
                          <span className="font-mono-num font-bold text-slate-900">
                            {o.total_amount} {isAr ? 'ج.م' : 'EGP'}
                          </span>
                          {o.captain_name ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                              <UserCheck className="w-3 h-3" />
                              <span>{isAr ? `الطيار: ${o.captain_name}` : `Captain: ${o.captain_name}`}</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                              {stats.allStoresReady
                                ? isAr
                                  ? 'جاهز لإسناد طيار'
                                  : 'Ready for captain'
                                : isAr
                                ? 'بانتظار تجهيز كل المتاجر'
                                : 'Waiting for stores'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 truncate">
                          {o.customer_name} ({o.customer_phone}) — {o.zone_name}
                          {o.address_landmark ? ` · ${o.address_landmark}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <select
                          aria-label={isAr ? `اختيار طيار للطلب ${o.order_number}` : `Select captain for ${o.order_number}`}
                          value={currentSelection}
                          onChange={(e) => setCaptainDraftMap((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          disabled={isSaving}
                          className="min-w-[230px] max-w-full sm:max-w-[300px] px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                        >
                          {!o.captain_id && (
                            <option value="">{isAr ? '— اختر طيارًا للطلب —' : '— Choose captain —'}</option>
                          )}
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
                            <option value="__none__">{isAr ? '✕ إلغاء إسناد الطيار' : '✕ Unassign captain'}</option>
                          )}
                        </select>

                        <button
                          type="button"
                          disabled={isSaving || !currentSelection || isUnchanged}
                          onClick={() => handleAssignCaptainFromOverview(o)}
                          className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-200 disabled:text-slate-500 text-white rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
                        >
                          {isSaving
                            ? isAr
                              ? 'جاري التنفيذ...'
                              : 'Saving...'
                            : currentSelection === '__none__'
                            ? isAr
                              ? 'إلغاء الإسناد'
                              : 'Unassign'
                            : o.captain_id
                            ? isAr
                              ? 'تغيير الطيار'
                              : 'Reassign'
                            : isAr
                            ? 'إسناد الطيار للطلب'
                            : 'Assign Order'}
                        </button>
                      </div>
                    </div>

                    {/* Per-store breakdown inside the single order */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                      {stats.sections.map((sec) => {
                        const prepared = isStorePrepared(sec.prep_status);
                        const pickedUp = isSectionPickedUpByCaptain(sec, o.status);
                        const isAnchor = stats.anchorSection?.id === sec.id;
                        const itemsSummary =
                          Array.isArray(sec.items) && sec.items.length > 0
                            ? sec.items
                                .filter((it) => it.status !== 'rejected')
                                .map((it) => `${it.name_ar} × ${it.quantity}`)
                                .join(' + ')
                            : sec.free_order_text || '-';
                        return (
                          <div
                            key={sec.id}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-slate-900">{sec.merchant_name}</span>
                                {isAnchor && (
                                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                    {isAr ? `الأكثر طلبًا (${getSectionItemCount(sec)})` : `Anchor (${getSectionItemCount(sec)})`}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 line-clamp-2">{itemsSummary}</p>
                              <p className="text-[11px] font-mono-num font-semibold text-slate-700">
                                {sec.subtotal} {isAr ? 'ج.م' : 'EGP'}
                              </p>
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              {sec.prep_status === 'cancelled' ? (
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                                  {isAr ? 'ملغي' : 'Cancelled'}
                                </span>
                              ) : pickedUp ? (
                                <span className="px-2 py-0.5 rounded bg-teal-600 text-white text-[10px] font-bold">
                                  {isAr ? '✓ تم التجهيز والاستلام' : '✓ Ready & Picked Up'}
                                </span>
                              ) : prepared ? (
                                <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-bold">
                                  {isAr ? '✓ قد تم التجهيز' : '✓ Prepared'}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                  {isAr ? '⏳ لم يتم التجهيز بعد' : '⏳ Not ready yet'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const statusMeta = ORDER_STATUS_AR[o.status] || {
                ar: o.status,
                en: o.status,
                cls: 'bg-slate-100 text-slate-700',
              };
              const currentSelection = captainDraftMap[o.id] ?? (o.captain_id || '');
              const isSaving = assigningOrderId === o.id;
              const isUnchanged =
                (currentSelection === '' && !o.captain_id) ||
                (currentSelection === o.captain_id && Boolean(o.captain_id));

              return (
                <div
                  key={o.id}
                  className="p-3.5 bg-white hover:bg-slate-50/70 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono-num font-bold text-slate-900">#{o.order_number}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${statusMeta.cls}`}>
                        {isAr ? statusMeta.ar : statusMeta.en}
                      </span>
                      <span className="font-semibold text-slate-800">{o.merchant_name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono-num font-bold text-slate-900">
                        {o.total_amount} {isAr ? 'ج.م' : 'EGP'}
                      </span>
                      {o.captain_name ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                          <UserCheck className="w-3 h-3" />
                          <span>{isAr ? `الطيار: ${o.captain_name}` : `Captain: ${o.captain_name}`}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                          {isAr ? 'بانتظار إسناد طيار' : 'Unassigned'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {o.customer_name} ({o.customer_phone}) — {o.zone_name}
                      {o.address_landmark ? ` · ${o.address_landmark}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                    <select
                      aria-label={isAr ? `اختيار طيار للطلب ${o.order_number}` : `Select captain for ${o.order_number}`}
                      value={currentSelection}
                      onChange={(e) => setCaptainDraftMap((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      disabled={isSaving}
                      className="min-w-[230px] max-w-full sm:max-w-[300px] px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                    >
                      {!o.captain_id && (
                        <option value="">{isAr ? '— اختر طيارًا من القائمة —' : '— Choose a captain —'}</option>
                      )}
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
                        <option value="__none__">{isAr ? '✕ إلغاء إسناد الطيار' : '✕ Unassign captain'}</option>
                      )}
                    </select>

                    <button
                      type="button"
                      disabled={isSaving || !currentSelection || isUnchanged}
                      onClick={() => handleAssignCaptainFromOverview(o)}
                      className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-200 disabled:text-slate-500 text-white rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
                    >
                      {isSaving
                        ? isAr
                          ? 'جاري التنفيذ...'
                          : 'Saving...'
                        : currentSelection === '__none__'
                        ? isAr
                          ? 'إلغاء الإسناد'
                          : 'Unassign'
                        : o.captain_id
                        ? isAr
                          ? 'تغيير الطيار'
                          : 'Reassign'
                        : isAr
                        ? 'إسناد الطلب'
                        : 'Assign'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer & Admin Direct Support & Communication Widget on Admin Home Page */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-[#A92224] flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'التواصل مع العملاء والإدارة والدعم المباشر' : 'Customer & Admin Support Inbox'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'الرسائل الواردة من العملاء عبر القائمة الجانبية لتطبيق العميل — رد مباشرة من الصفحة الرئيسية.'
                  : 'Incoming customer support tickets with instant admin replies.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadSupportPreview(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isAr ? 'تحديث' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('support')}
              className="px-3.5 py-1.5 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-lg text-xs font-bold whitespace-nowrap"
            >
              {isAr ? 'فتح مركز الدعم الكامل ←' : 'Open Full Support Center'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {supportTickets.length === 0 ? (
              <p className="text-xs text-slate-500 p-6 text-center">
                {isAr ? 'لا توجد محادثات دعم حالياً' : 'No support tickets'}
              </p>
            ) : (
              supportTickets.slice(0, 8).map((t) => {
                const selected = t.id === selectedTicketId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`w-full text-start p-3 transition-colors ${
                      selected ? 'bg-orange-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">{t.customer_name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.status === 'open'
                            ? 'bg-rose-100 text-rose-800'
                            : t.status === 'in_progress'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-teal-100 text-teal-800'
                        }`}
                      >
                        {t.status === 'open'
                          ? isAr ? 'مفتوح' : 'Open'
                          : t.status === 'in_progress'
                          ? isAr ? 'قيد المتابعة' : 'Active'
                          : isAr ? 'تم الحل' : 'Resolved'}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 mt-1 line-clamp-1">{t.subject}</p>
                    {t.last_message_text && (
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{t.last_message_text}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="lg:col-span-7 border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between bg-slate-50/60 min-h-[260px]">
            {!activeTicket ? (
              <div className="flex-1 flex flex-col items-center justify-center text-xs text-slate-400 gap-1.5">
                <MessageSquare className="w-6 h-6" />
                <span>{isAr ? 'اختر محادثة عميل للرد عليه مباشرة' : 'Select a ticket to reply'}</span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="text-xs">
                    <span className="font-mono-num font-bold text-slate-600">{activeTicket.ticket_number}</span>
                    <span className="mx-1.5 text-slate-400">·</span>
                    <span className="font-bold text-slate-900">{activeTicket.customer_name}</span>
                    {activeTicket.customer_phone && (
                      <span dir="ltr" className="mx-1.5 text-slate-500 font-mono-num">{activeTicket.customer_phone}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {(['in_progress', 'resolved'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={async () => {
                          await api.updateSupportTicketStatus(activeTicket.id, st);
                          await loadSupportPreview(true);
                          onNotify?.(isAr ? 'تم تحديث حالة المحادثة' : 'Status updated');
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold border ${
                          activeTicket.status === st
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {st === 'in_progress' ? (isAr ? 'متابعة' : 'In Progress') : isAr ? 'تم الحل' : 'Resolved'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 py-2.5 space-y-2 max-h-40 overflow-y-auto">
                  {supportMessages.map((m) => {
                    const isAdmin = m.sender_role === 'admin';
                    return (
                      <div key={m.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                            isAdmin ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-900'
                          }`}
                        >
                          <p className="text-[10px] font-bold opacity-75 mb-0.5">{m.sender_name}</p>
                          <p>{m.message_text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleQuickAdminReply} className="pt-2 border-t border-slate-200 flex items-center gap-2">
                  <input
                    type="text"
                    value={adminReply}
                    onChange={(e) => setAdminReply(e.target.value)}
                    placeholder={isAr ? `رد سريع للعميل ${activeTicket.customer_name}...` : 'Quick admin reply...'}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="submit"
                    disabled={sendingReply || !adminReply.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isAr ? 'رد' : 'Reply'}</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {captains.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'مواقع جميع الطيارين المباشرة (GPS) بالمنزلة' : 'Live GPS Locations of All Captains'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'أخضر: متاح · برتقالي: مشغول بمشوار · رمادي: غير متصل'
                  : 'Green: Available · Amber: Busy · Gray: Offline'}
              </p>
            </div>
            <button
              onClick={() => onNavigate('captains')}
              className="text-xs font-bold text-orange-600 hover:text-orange-700"
            >
              {isAr ? 'فتح إدارة الأسطول والتقييمات ←' : 'Open Fleet & Ratings'}
            </button>
          </div>
          <GpsMapPicker
            heightClass="h-64"
            nearbyCaptains={captains.map((c) => ({
              id: c.id,
              full_name: c.full_name,
              vehicle_type: c.vehicle_type,
              vehicle_model: c.vehicle_model,
              availability_status: c.availability_status,
              lat: Number(c.lat || 31.1583),
              lng: Number(c.lng || 31.9369),
            }))}
            onCaptainPinClick={() => onNavigate('captains')}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'مفاتيح تشغيل الخدمات (Feature Flags)' : 'Service Activation Controls'}
            </h3>
            <button
              onClick={() => onNavigate('services')}
              className="text-xs font-medium text-orange-600 hover:text-orange-700 whitespace-nowrap"
            >
              {isAr ? 'إدارة المناطق والحد الأدنى' : 'Manage Zones & Limits'}
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {services.map((s) => (
              <div key={s.service_key} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{isAr ? s.name_ar : s.name_en}</div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{isAr ? `الحد الأدنى: ${s.min_order_amount} ج.م` : `Min order: ${s.min_order_amount} EGP`}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {s.requires_license
                        ? s.license_ready
                          ? isAr
                            ? 'ترخيص مستوفى'
                            : 'License ready'
                          : isAr
                          ? 'يتطلب استيفاء ترخيص قانوني'
                          : 'Pending legal license'
                        : isAr
                        ? 'تشغيل مباشر'
                        : 'Direct operation'}
                    </span>
                  </div>
                </div>
                {s.service_key === 'rides' ? (
                  <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 text-white whitespace-nowrap shrink-0">
                    {isAr ? 'مفتوحة دائمًا' : 'Always Open'}
                  </span>
                ) : (
                  <button
                    onClick={() => onToggleService(s.service_key, !s.is_enabled)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      s.is_enabled
                        ? 'bg-teal-600 text-white hover:bg-teal-700'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    {s.is_enabled ? (isAr ? 'مفعّل' : 'Active') : isAr ? 'موقوف مؤقتًا' : 'Disabled'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {isAr ? 'مهام تحتاج قرارك الآن' : 'Pending Operational Actions'}
          </h3>
          <div className="divide-y divide-slate-100">
            {actionQueue.map((item) => (
              <div key={item.tab} className="py-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {isAr ? `العدد المفتوح: ${item.count}` : `Open items: ${item.count}`}
                  </p>
                </div>
                <button
                  onClick={() => onNavigate(item.tab)}
                  className="px-3 py-1.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                >
                  {item.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment Settings & Collection Methods Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'إعدادات الدفع ووسائل التحصيل المالي' : 'Payment Settings & Gateways'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'التحكم المباشر في قنوات الدفع التي تظهر لكل عميل عند إتمام الطلب (كاش عند الاستلام، بطاقة شبكة/POS مع الكابتن، محفظة إلكترونية)'
                  : 'Control customer payment methods: Cash on Delivery, POS Card with Captain, and Wallets'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {paymentSavedToast && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1.5 rounded-lg border border-teal-200">
                <Check className="w-3.5 h-3.5" />
                <span>{isAr ? 'تم الحفظ والمزامنة بنجاح' : 'Saved successfully'}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => handleSavePaymentSettings()}
              disabled={savingPayments || !paymentSettings}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold transition-colors whitespace-nowrap min-h-[38px]"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingPayments ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ إعدادات الدفع' : 'Save Payment Settings')}</span>
            </button>
          </div>
        </div>

        {!paymentSettings ? (
          <div className="h-32 bg-slate-50 border border-slate-100 rounded-xl animate-pulse" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Cash On Delivery */}
            <div
              className={`rounded-xl border p-4 transition-all space-y-3 ${
                paymentSettings.cod_enabled
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-slate-50 border-slate-200 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                      paymentSettings.cod_enabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{isAr ? 'الدفع عند الاستلام (كاش)' : 'Cash on Delivery'}</h4>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        paymentSettings.cod_enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {paymentSettings.cod_enabled ? (isAr ? 'مفعّل للعملاء' : 'Enabled') : (isAr ? 'معطّل مؤقتًا' : 'Disabled')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSavePaymentSettings({ cod_enabled: !paymentSettings.cod_enabled })}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                    paymentSettings.cod_enabled
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-slate-300 text-slate-700 hover:bg-slate-400'
                  }`}
                >
                  {paymentSettings.cod_enabled ? (isAr ? 'إيقاف' : 'Disable') : (isAr ? 'تفعيل' : 'Enable')}
                </button>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200/60 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'الحد الأقصى للطلب الكاش (ج.م):' : 'Max COD Amount (EGP):'}
                  </label>
                  <input
                    type="number"
                    value={paymentSettings.cod_max_amount}
                    onChange={(e) =>
                      setPaymentSettings({ ...paymentSettings, cod_max_amount: Number(e.target.value || 0) })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono-num font-semibold focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'إرشادات الكاش للعميل:' : 'Customer Instructions:'}
                  </label>
                  <input
                    type="text"
                    value={paymentSettings.cod_instructions_ar}
                    onChange={(e) =>
                      setPaymentSettings({ ...paymentSettings, cod_instructions_ar: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* 2. Network / POS Card Machine */}
            <div
              className={`rounded-xl border p-4 transition-all space-y-3 ${
                paymentSettings.network_pos_enabled
                  ? 'bg-blue-50/40 border-blue-200'
                  : 'bg-slate-50 border-slate-200 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                      paymentSettings.network_pos_enabled ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{isAr ? 'الدفع بالشبكة / بطاقة مع الكابتن (POS)' : 'POS Network Card'}</h4>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        paymentSettings.network_pos_enabled ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {paymentSettings.network_pos_enabled ? (isAr ? 'مفعّل للعملاء' : 'Enabled') : (isAr ? 'معطّل مؤقتًا' : 'Disabled')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSavePaymentSettings({ network_pos_enabled: !paymentSettings.network_pos_enabled })}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                    paymentSettings.network_pos_enabled
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-slate-300 text-slate-700 hover:bg-slate-400'
                  }`}
                >
                  {paymentSettings.network_pos_enabled ? (isAr ? 'إيقاف' : 'Disable') : (isAr ? 'تفعيل' : 'Enable')}
                </button>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200/60 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'الحد الأدنى للدفع بالشبكة (ج.م):' : 'Min Network Amount (EGP):'}
                  </label>
                  <input
                    type="number"
                    value={paymentSettings.network_min_amount}
                    onChange={(e) =>
                      setPaymentSettings({ ...paymentSettings, network_min_amount: Number(e.target.value || 0) })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono-num font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'إرشادات الشبكة للعميل:' : 'Customer Instructions:'}
                  </label>
                  <input
                    type="text"
                    value={paymentSettings.network_instructions_ar}
                    onChange={(e) =>
                      setPaymentSettings({ ...paymentSettings, network_instructions_ar: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 3. Digital Wallet & InstaPay */}
            <div
              className={`rounded-xl border p-4 transition-all space-y-3 ${
                paymentSettings.wallet_enabled
                  ? 'bg-purple-50/40 border-purple-200'
                  : 'bg-slate-50 border-slate-200 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                      paymentSettings.wallet_enabled ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{isAr ? 'محفظة إلكترونية / إنستاباي' : 'Wallet & InstaPay'}</h4>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        paymentSettings.wallet_enabled ? 'bg-purple-100 text-purple-800' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {paymentSettings.wallet_enabled ? (isAr ? 'مفعّل للعملاء' : 'Enabled') : (isAr ? 'معطّل مؤقتًا' : 'Disabled')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSavePaymentSettings({ wallet_enabled: !paymentSettings.wallet_enabled })}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                    paymentSettings.wallet_enabled
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-slate-300 text-slate-700 hover:bg-slate-400'
                  }`}
                >
                  {paymentSettings.wallet_enabled ? (isAr ? 'إيقاف' : 'Disable') : (isAr ? 'تفعيل' : 'Enable')}
                </button>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200/60 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'حالة التفعيل عبر المنصة:' : 'Platform Status:'}
                  </label>
                  <p className="text-[11px] text-slate-600 bg-white p-2 border border-slate-200 rounded-lg">
                    {isAr
                      ? 'فودافون كاش، أورنج، اتصالات، وشبكة InstaPay المعتمدة'
                      : 'Vodafone Cash, Orange, Etisalat, InstaPay'}
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {isAr ? 'إرشادات المحفظة للعميل:' : 'Customer Instructions:'}
                  </label>
                  <input
                    type="text"
                    value={paymentSettings.wallet_instructions_ar}
                    onChange={(e) =>
                      setPaymentSettings({ ...paymentSettings, wallet_instructions_ar: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

