import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Bell,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  FileSpreadsheet,
  FileWarning,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CategoryRecord, Language, MerchantRecord, OrderItemRecord, OrderRecord } from '../shared/types.ts';
import { CatalogSection } from './CatalogSection.tsx';
import { MerchantMasterLinkPanel } from './MerchantMasterLinkPanel.tsx';

interface Props {
  lang: Language;
  merchant: MerchantRecord;
  orders: OrderRecord[];
  categories?: CategoryRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

type StatusFilter = 'all' | 'active' | 'ready' | 'delivered' | 'cancelled';

const STATUS_AR: Record<string, string> = {
  awaiting_quote: 'بانتظار التسعير',
  pending_merchant: 'طلب جديد',
  preparing: 'قيد التجهيز',
  ready_for_pickup: 'الطلب جاهز للاستلام',
  on_the_way: 'مع الطيار في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغى / مرفوض',
};

export const MerchantStoreOrdersView: React.FC<Props> = ({
  lang,
  merchant,
  orders,
  categories = [],
  onRefresh,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [merchantSubTab, setMerchantSubTab] = useState<'orders' | 'excel' | 'catalog'>('orders');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [quoteMap, setQuoteMap] = useState<Record<string, number>>({});
  const [rxNoteMap, setRxNoteMap] = useState<Record<string, string>>({});

  // Partial item rejection state: orderId -> itemId -> { selected, reason }
  const [itemRejectState, setItemRejectState] = useState<
    Record<string, Record<string, { selected: boolean; reason: string }>>
  >({});

  // Full invoice cancellation state
  const [rejectInvoiceOrder, setRejectInvoiceOrder] = useState<OrderRecord | null>(null);
  const [invoiceRejectReason, setInvoiceRejectReason] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [previewProofModal, setPreviewProofModal] = useState<{
    url: string;
    orderNumber: string;
    methodLabel: string;
    totalAmount: number;
    storeSubtotal: number;
  } | null>(null);

  // Live in-app + OS/Browser notification state for incoming merchant orders
  const [incomingAlert, setIncomingAlert] = useState<{ title: string; body: string } | null>(null);
  const [notifPermission, setNotifPermission] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return window.Notification.permission;
    }
    return 'unsupported';
  });
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initializedOrdersRef = useRef(false);
  const shownNotifIdsRef = useRef<Set<string>>(new Set());

  const playOrderAlertSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const playTone = (freq: number, startOffset: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.22, now + startOffset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration + 0.02);
      };
      playTone(880, 0, 0.18);
      playTone(1174.66, 0.2, 0.28);
      setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch {
      // Ignore autoplay restrictions before user interaction
    }
  };

  const triggerMerchantAlert = (title: string, body: string, dedupeKey?: string) => {
    if (dedupeKey) {
      if (shownNotifIdsRef.current.has(dedupeKey)) return;
      shownNotifIdsRef.current.add(dedupeKey);
    }
    setIncomingAlert({ title, body });
    playOrderAlertSound();
    onNotify(`${title} — ${body}`);

    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
      try {
        const osNotif = new window.Notification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: dedupeKey || `merchant_order_${Date.now()}`,
          requireInteraction: true,
        });
        osNotif.onclick = () => {
          window.focus();
          setMerchantSubTab('orders');
          setFilter('active');
          osNotif.close();
        };
      } catch {
        // Fallback already shown via in-app banner
      }
    }
  };

  const handleRequestBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await window.Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === 'granted') {
        triggerMerchantAlert(
          'تم تفعيل إشعارات الطلبات الجديدة ✓',
          'ستصلك تنبيهات فورية بصوت وإشعار خارج المتصفح فور وصول أي طلب لمتجرك.',
          `perm_ok_${Date.now()}`
        );
      } else {
        onNotify(isAr ? 'يرجى السماح بالإشعارات من إعدادات المتصفح لتصلك تنبيهات الطلبات' : 'Please allow browser notifications');
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    onRefresh().catch(() => {});

    const connectWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/order-chat?channel=merchant&merchantId=${encodeURIComponent(merchant.id)}`;

      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}'));
            if (payload?.type === 'notification:new' && payload?.notification) {
              const n = payload.notification;
              const title = String(n.title_ar || 'طلب جديد لمتجرك');
              const body = String(n.body_ar || 'وصلك طلب جديد — افتح لتجهيز أصناف متجرك الآن.');
              triggerMerchantAlert(title, body, String(n.id || `${title}_${body}`));
            }
          } catch {
            // ignore non-json frames
          }
          onRefresh().catch(() => {});
        };
        ws.onclose = (ev) => {
          if (!closed && ev.code !== 4401) {
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connectWs, 4000);
      }
    };

    connectWs();
    const onFocus = () => onRefresh().catch(() => {});
    window.addEventListener('focus', onFocus);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      window.removeEventListener('focus', onFocus);
    };
  }, [merchant.id]);

  const getMerchantOrderView = (order: OrderRecord) => {
    const sections = Array.isArray(order.store_sections) ? order.store_sections : [];
    const mySection = sections.find((s) => s.merchant_id === merchant.id) || null;
    const rawItems: OrderItemRecord[] = mySection
      ? Array.isArray(mySection.items)
        ? mySection.items
        : []
      : Array.isArray(order.items)
      ? order.items.filter((it) => {
          const itemMerchantId = (it as OrderItemRecord & { merchant_id?: string }).merchant_id;
          return !itemMerchantId || itemMerchantId === merchant.id;
        })
      : [];

    const acceptedItemsSum = Number(
      rawItems
        .filter((it) => it.status !== 'rejected')
        .reduce((sum, it) => sum + Number(it.total_price || 0), 0)
        .toFixed(2)
    );

    const mySubtotal = mySection
      ? rawItems.length > 0
        ? acceptedItemsSum
        : Number(mySection.subtotal || 0)
      : rawItems.length > 0
      ? acceptedItemsSum
      : Number(order.subtotal || 0);

    const orderClosed = order.status === 'delivered' || order.status === 'cancelled';
    const myStatus = mySection
      ? orderClosed
        ? order.status
        : mySection.prep_status
      : ((order as OrderRecord & { my_section_status?: string }).my_section_status && !orderClosed
          ? (order as OrderRecord & { my_section_status?: string }).my_section_status!
          : order.status);

    const isMultiStore =
      Boolean((order as OrderRecord & { is_multi_store?: boolean }).is_multi_store) || sections.length > 1;

    return {
      mySection,
      myItems: rawItems,
      mySubtotal,
      myStatus,
      myChannel: mySection?.order_channel || order.order_channel,
      myFreeText: mySection ? mySection.free_order_text : order.free_order_text,
      myRxImage: mySection ? mySection.prescription_image_url : order.prescription_image_url,
      myNotes: mySection?.pharmacist_notes ?? order.pharmacist_notes,
      mySubNote: mySection?.substitution_note ?? order.substitution_note,
      myRejectionReason: mySection?.rejection_reason ?? order.rejection_reason,
      isMultiStore,
    };
  };

  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.merchant_id === merchant.id || (o.store_sections?.some((s) => s.merchant_id === merchant.id) ?? false)
      ),
    [orders, merchant.id]
  );

  // Detect brand-new active orders even if a WS notification frame was missed
  useEffect(() => {
    const currentIds = new Set(myOrders.map((o) => o.id));
    if (!initializedOrdersRef.current) {
      knownOrderIdsRef.current = currentIds;
      initializedOrdersRef.current = true;
      return;
    }
    for (const o of myOrders) {
      if (!knownOrderIdsRef.current.has(o.id)) {
        const view = getMerchantOrderView(o);
        if (['awaiting_quote', 'pending_merchant', 'preparing'].includes(view.myStatus)) {
          triggerMerchantAlert(
            `طلب جديد لمتجرك #${o.order_number}`,
            view.myItems.length > 0
              ? `وصلك طلب جديد (${view.myItems.length} صنف) بقيمة ${view.mySubtotal} ج.م من ${o.customer_name}.`
              : `وصلك طلب جديد من ${o.customer_name} — راجعه وجهّزه الآن.`,
            `order_arrival_${o.id}`
          );
        }
      }
    }
    knownOrderIdsRef.current = currentIds;
  }, [myOrders, merchant.id]);

  const filteredOrders = useMemo(() => {
    return myOrders.filter((o) => {
      const { myStatus } = getMerchantOrderView(o);
      if (filter === 'all') return true;
      if (filter === 'active') {
        return ['awaiting_quote', 'pending_merchant', 'preparing'].includes(myStatus);
      }
      if (filter === 'ready') {
        return ['ready_for_pickup', 'on_the_way'].includes(myStatus);
      }
      if (filter === 'delivered') return myStatus === 'delivered';
      if (filter === 'cancelled') return myStatus === 'cancelled';
      return true;
    });
  }, [myOrders, filter, merchant.id]);

  const activeCount = myOrders.filter((o) => {
    const { myStatus } = getMerchantOrderView(o);
    return ['awaiting_quote', 'pending_merchant', 'preparing'].includes(myStatus);
  }).length;
  const readyCount = myOrders.filter((o) => {
    const { myStatus } = getMerchantOrderView(o);
    return ['ready_for_pickup', 'on_the_way'].includes(myStatus);
  }).length;

  const toggleItemReject = (orderId: string, itemId: string) => {
    setItemRejectState((prev) => {
      const orderMap = prev[orderId] || {};
      const curr = orderMap[itemId] || { selected: false, reason: '' };
      return {
        ...prev,
        [orderId]: {
          ...orderMap,
          [itemId]: { ...curr, selected: !curr.selected },
        },
      };
    });
  };

  const setItemRejectReason = (orderId: string, itemId: string, reason: string) => {
    setItemRejectState((prev) => {
      const orderMap = prev[orderId] || {};
      const curr = orderMap[itemId] || { selected: true, reason: '' };
      return {
        ...prev,
        [orderId]: {
          ...orderMap,
          [itemId]: { ...curr, selected: true, reason },
        },
      };
    });
  };

  const handleSaveRejectedItems = async (order: OrderRecord) => {
    const orderMap = itemRejectState[order.id] || {};
    const selectedEntries = Object.entries(orderMap).filter(([, v]) => v.selected);
    if (selectedEntries.length === 0) {
      onNotify(isAr ? 'حدد الصنف المراد رفضه أولًا' : 'Select at least one item to reject');
      return;
    }
    for (const [, val] of selectedEntries) {
      if (!val.reason.trim()) {
        onNotify(isAr ? 'يجب كتابة سبب الرفض لكل صنف تم اختياره' : 'Rejection reason is required for each item');
        return;
      }
    }

    setBusyOrderId(order.id);
    try {
      await api.merchantOrderAction(order.id, {
        action: 'reject_items',
        merchant_id: merchant.id,
        rejected_items: selectedEntries.map(([item_id, v]) => ({
          item_id,
          reason: v.reason.trim(),
        })),
      });
      setItemRejectState((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      await onRefresh();
      onNotify(
        isAr
          ? `تم تحديث فاتورة الطلب #${order.order_number} وتسجيل أسباب رفض الأصناف وإشعار العميل`
          : 'Invoice updated with rejected items'
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleConfirmRejectInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectInvoiceOrder) return;
    if (!invoiceRejectReason.trim()) {
      onNotify(isAr ? 'يجب كتابة سبب إلغاء/رفض الفاتورة' : 'Cancellation reason is required');
      return;
    }
    setBusyOrderId(rejectInvoiceOrder.id);
    try {
      await api.merchantOrderAction(rejectInvoiceOrder.id, {
        action: 'reject_invoice',
        merchant_id: merchant.id,
        rejection_reason: invoiceRejectReason.trim(),
      });
      const ordNum = rejectInvoiceOrder.order_number;
      setRejectInvoiceOrder(null);
      setInvoiceRejectReason('');
      await onRefresh();
      onNotify(isAr ? `تم رفض وإلغاء طلب متجرك من الفاتورة #${ordNum} وإرسال السبب للعميل` : 'Invoice rejected');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleMarkOrderReady = async (order: OrderRecord) => {
    const view = getMerchantOrderView(order);
    if (['ready_for_pickup', 'on_the_way', 'delivered', 'cancelled'].includes(view.myStatus)) {
      return;
    }
    setBusyOrderId(order.id);
    try {
      const payload: Record<string, unknown> = {
        action: 'ready',
        merchant_id: merchant.id,
        pharmacist_notes: rxNoteMap[order.id] ?? view.myNotes,
        prescription_status: merchant.merchant_type === 'pharmacy' ? 'reviewed' : order.prescription_status,
        assign_best_captain: true,
      };
      // Only send a merchant-entered quote for free-text / prescription orders with no catalog items.
      if (view.myItems.length === 0) {
        const quoteVal = quoteMap[order.id] ?? view.mySubtotal;
        if (Number.isFinite(Number(quoteVal)) && Number(quoteVal) >= 0) {
          payload.subtotal = Number(quoteVal);
        }
      }
      const res = await api.merchantOrderAction(order.id, payload);
      await onRefresh();
      onNotify(
        res.assigned_captain
          ? isAr
            ? `تم تأكيد أن طلب متجرك #${order.order_number} جاهز وإسناده للطيار: ${res.assigned_captain}`
            : `Order ready & assigned to ${res.assigned_captain}`
          : isAr
          ? `تم تأكيد جاهزية طلب متجرك للطلب #${order.order_number} ✓ — سيتم إسناد الطيار فور جاهزية باقي المتاجر إذا كان الطلب مشتركًا`
          : `Order #${order.order_number} store section marked ready`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const renderOrderItems = (order: OrderRecord) => {
    const view = getMerchantOrderView(order);
    const items = view.myItems;
    const canModify = !['ready_for_pickup', 'delivered', 'cancelled', 'on_the_way'].includes(view.myStatus);
    const selectedMap = itemRejectState[order.id] || {};
    const selectedCount = Object.values(selectedMap).filter((v) => v.selected).length;

    if (items.length === 0) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          {view.myRxImage && (
            <div className="flex items-start gap-3">
              <a
                href={view.myRxImage}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 border border-slate-200 rounded-lg overflow-hidden bg-white"
              >
                <img
                  src={view.myRxImage}
                  alt={order.order_number}
                  referrerPolicy="no-referrer"
                  className="w-20 h-20 object-cover"
                />
              </a>
              <p className="text-xs text-slate-600">صورة الروشتة المرفقة من العميل — اضغط لعرضها بحجم كامل</p>
            </div>
          )}
          <p className="text-xs text-slate-800 leading-relaxed">
            <strong>{view.myChannel === 'prescription' ? 'تفاصيل الروشتة:' : 'محتويات طلب متجرك:'}</strong>{' '}
            {view.myFreeText || 'طلب كتالوج مسعّر'}
          </p>
        </div>
      );
    }

    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
          <span>أصناف متجرك فقط ({items.length})</span>
          {canModify && (
            <span className="text-[11px] font-normal text-slate-500">
              يمكنك رفض أي صنف غير متوفر مع كتابة السبب
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg overflow-hidden">
          {items.map((item) => {
            const isRejected = item.status === 'rejected';
            const rejEntry = selectedMap[item.id] || { selected: false, reason: '' };
            return (
              <div
                key={item.id}
                className={`p-2.5 space-y-2 ${isRejected ? 'bg-rose-50/70' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`font-bold ${
                        isRejected ? 'line-through text-rose-700' : 'text-slate-900'
                      }`}
                    >
                      {item.name_ar}
                    </span>
                    <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono-num text-slate-700">
                      × {item.quantity}
                    </span>
                    {isRejected && (
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[11px] font-bold">
                        مرفوض: {item.rejection_reason}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`font-bold font-mono-num ${
                        isRejected ? 'line-through text-slate-400' : 'text-slate-900'
                      }`}
                    >
                      {item.total_price} ج.م
                    </span>
                    {canModify && !isRejected && (
                      <button
                        type="button"
                        onClick={() => toggleItemReject(order.id, item.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                          rejEntry.selected
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                        }`}
                      >
                        {rejEntry.selected ? 'تراجع عن الرفض' : 'رفض هذا الصنف'}
                      </button>
                    )}
                  </div>
                </div>

                {canModify && !isRejected && rejEntry.selected && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rejEntry.reason}
                      onChange={(e) => setItemRejectReason(order.id, item.id, e.target.value)}
                      placeholder="اكتب سبب رفض الصنف (مثال: نفاد الكمية من المتجر)..."
                      className="flex-1 px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canModify && selectedCount > 0 && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={busyOrderId === order.id}
              onClick={() => handleSaveRejectedItems(order)}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            >
              <FileWarning className="w-3.5 h-3.5" />
              <span>حفظ رفض ({selectedCount}) أصناف وتحديث الفاتورة</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Live In-App Incoming Order Alert Banner */}
      {incomingAlert && (
        <div className="bg-red-700 text-white rounded-2xl p-3.5 shadow-lg border border-red-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5 text-white animate-bounce" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black truncate">{incomingAlert.title}</p>
              <p className="text-xs text-red-100 leading-snug">{incomingAlert.body}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMerchantSubTab('orders');
                setFilter('active');
                setIncomingAlert(null);
              }}
              className="px-3 py-1.5 bg-white text-red-700 hover:bg-red-50 rounded-xl text-xs font-extrabold"
            >
              {isAr ? 'عرض الطلب' : 'View'}
            </button>
            <button
              type="button"
              onClick={() => setIncomingAlert(null)}
              className="p-1.5 rounded-lg hover:bg-white/15 text-white"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Merchant Portal Navigation Switcher */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setMerchantSubTab('orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              merchantSubTab === 'orders'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>{isAr ? 'طلبات متجري الواردة' : 'Store Orders'}</span>
            {activeCount > 0 && (
              <span className="px-1.5 py-0.5 bg-orange-600 text-white rounded-full text-[10px]">
                {activeCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMerchantSubTab('excel')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              merchantSubTab === 'excel'
                ? 'bg-[#A92224] text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isAr ? 'رفع ملف Excel للإدارة للاعتماد' : 'Upload Excel for Approval'}</span>
          </button>
          <button
            type="button"
            onClick={() => setMerchantSubTab('catalog')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              merchantSubTab === 'catalog'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>{isAr ? 'إدارة المنتجات والأقسام' : 'Products & Catalog'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-2">
          {notifPermission !== 'unsupported' && (
            <button
              type="button"
              onClick={handleRequestBrowserNotifications}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                notifPermission === 'granted'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
              title={isAr ? 'تنبيهات فورية خارج المتصفح وداخله عند وصول طلب جديد' : 'Order notifications'}
            >
              {notifPermission === 'granted' ? (
                <>
                  <BellRing className="w-3.5 h-3.5 text-emerald-700" />
                  <span>{isAr ? 'إشعارات الطلبات مفعّلة ✓' : 'Alerts Active'}</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5 text-amber-700" />
                  <span>{isAr ? 'تفعيل إشعارات الطلبات' : 'Enable Order Alerts'}</span>
                </>
              )}
            </button>
          )}
          <div className="text-xs text-slate-500 px-1 font-semibold">
            {merchant.business_name_ar} · <span className="text-teal-700 font-bold">{merchant.branch_name}</span>
          </div>
        </div>
      </div>

      {merchantSubTab === 'excel' ? (
        <MerchantMasterLinkPanel
          merchantId={merchant.id}
          categories={categories}
          merchantProducts={[]}
          initialSubTab="excel"
          onRefresh={() => void onRefresh()}
          onToast={onNotify}
        />
      ) : merchantSubTab === 'catalog' ? (
        <CatalogSection
          lang={lang}
          merchants={[merchant]}
          portalMode="merchant"
          merchantSession={merchant}
          onRefreshCore={onRefresh}
          onNotify={onNotify}
        />
      ) : (
        <>
          {/* Clean Merchant Store Header */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isAr ? `طلبات متجري الواردة — ${merchant.business_name_ar}` : `${merchant.business_name_ar} Orders`}
                </h2>
                <p className="text-xs text-slate-500">
                  {isAr
                    ? 'تظهر هنا منتجات متجرك فقط لكل طلب؛ وفي الطلبات المجمعة يتم عزل أصناف ومستحقات متجرك بالكامل.'
                    : 'Only your store items and subtotal are shown for every order.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl font-bold text-amber-900 tabular-nums">
                قيد العمل: {activeCount}
              </div>
              <div className="px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-xl font-bold text-teal-900 tabular-nums">
                جاهز / بالتوصيل: {readyCount}
              </div>
            </div>
          </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `كل طلبات المتجر (${myOrders.length})` },
            { id: 'active', label: `طلبات جديدة وقيد التجهيز (${activeCount})` },
            { id: 'ready', label: `الطلبات الجاهزة (${readyCount})` },
            { id: 'delivered', label: 'المكتملة' },
            { id: 'cancelled', label: 'المرفوضة / الملغاة' },
          ] as Array<{ id: StatusFilter; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              filter === tab.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Store Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-800">
            {myOrders.length === 0
              ? 'لا توجد طلبات واردة لمتجرك حتى الآن'
              : 'لا توجد طلبات ضمن هذا التبويب'}
          </p>
          <p className="text-xs text-slate-500">
            عند قيام أي عميل بطلب منتجات من متجرك عبر تطبيق «اطلبها»، سيظهر الطلب هنا فورًا للتجهيز.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const view = getMerchantOrderView(order);
            const isSectionClosed = ['delivered', 'cancelled'].includes(view.myStatus);
            const isSectionReadyOrFurther = ['ready_for_pickup', 'on_the_way', 'delivered'].includes(view.myStatus);
            const canAct = !isSectionClosed && !isSectionReadyOrFurther;
            const statusText = STATUS_AR[view.myStatus] || view.myStatus;

            return (
              <div
                key={order.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${
                  view.myStatus === 'cancelled'
                    ? 'border-rose-200 bg-rose-50/20'
                    : isSectionReadyOrFurther
                    ? 'border-teal-200'
                    : 'border-slate-200'
                }`}
              >
                {/* Order Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 font-mono-num">
                        #{order.order_number}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                          view.myStatus === 'cancelled'
                            ? 'bg-rose-100 text-rose-800'
                            : view.myStatus === 'ready_for_pickup'
                            ? 'bg-teal-100 text-teal-800'
                            : view.myStatus === 'delivered'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {statusText}
                      </span>
                      {view.isMultiStore && (
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded text-[11px] font-bold">
                          طلب مشترك (منتجات متجرك فقط)
                        </span>
                      )}
                      {order.is_express && (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded text-[11px] font-bold">
                          عاجل Express
                        </span>
                      )}
                      {order.payment_method === 'vodafone_cash' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
                          📱 فودافون كاش
                        </span>
                      ) : order.payment_method === 'instapay' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          ⚡ إنستا باي (InstaPay)
                        </span>
                      ) : order.payment_method === 'network' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-blue-100 text-blue-800">
                          💳 دفع شبكة / POS
                        </span>
                      ) : order.payment_method === 'wallet' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-100 text-indigo-800">
                          📱 محفظة إلكترونية
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-800">
                          💵 كاش عند الاستلام
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">{order.customer_name}</span>
                      <span className="inline-flex items-center gap-1 font-mono-num" dir="ltr">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {order.customer_phone}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {order.zone_name} — {order.address_landmark}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono-num text-slate-400">
                        <Clock className="w-3 h-3" />
                        {String(order.created_at || '').slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="text-end tabular-nums">
                    <p className="text-xs text-slate-500">قيمة أصناف متجرك</p>
                    <p className="text-base font-bold text-slate-900">{view.mySubtotal} ج.م</p>
                  </div>
                </div>

                {/* Payment Info & Transfer Proof Verification Box (so merchant verifies payment before preparing) */}
                {(() => {
                  const pm = String(order.payment_method || 'cash').toLowerCase();
                  const isTransfer = pm === 'vodafone_cash' || pm === 'instapay';
                  const proofUrl = String(order.payment_proof_image_url || '').trim();
                  const pmLabel =
                    pm === 'vodafone_cash'
                      ? 'فودافون كاش'
                      : pm === 'instapay'
                      ? 'إنستا باي (InstaPay)'
                      : pm === 'network'
                      ? 'دفع بالشبكة / POS مع الطيار'
                      : pm === 'wallet'
                      ? 'محفظة إلكترونية'
                      : 'كاش عند الاستلام';

                  if (isTransfer) {
                    if (proofUrl) {
                      return (
                        <div className="p-3 rounded-xl bg-teal-50/75 border border-teal-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-extrabold text-teal-950">
                                  بيانات الدفع: {pmLabel} — مرفق صورة إيصال التحويل ✓
                                </span>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-white border border-teal-200 text-teal-900 font-mono-num">
                                  إجمالي الفاتورة: {order.total_amount} ج.م
                                </span>
                              </div>
                              <p className="text-[11px] font-semibold text-teal-800 leading-relaxed">
                                يرجى فتح صورة التحويل والتأكد من وصول المبلغ قبل البدء في تجهيز الطلب.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewProofModal({
                                  url: proofUrl,
                                  orderNumber: order.order_number,
                                  methodLabel: pmLabel,
                                  totalAmount: Number(order.total_amount || 0),
                                  storeSubtotal: Number(view.mySubtotal || 0),
                                })
                              }
                              className="group relative rounded-xl overflow-hidden border-2 border-teal-300 hover:border-teal-600 transition-colors shrink-0"
                              title="اضغط لعرض صورة التحويل بالحجم الكامل"
                            >
                              <img
                                src={proofUrl}
                                alt="إيصال التحويل"
                                className="w-16 h-16 object-cover"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewProofModal({
                                  url: proofUrl,
                                  orderNumber: order.order_number,
                                  methodLabel: pmLabel,
                                  totalAmount: Number(order.total_amount || 0),
                                  storeSubtotal: Number(view.mySubtotal || 0),
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>عرض إيصال التحويل</span>
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 flex items-start gap-2.5 text-rose-900">
                        <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-0.5">
                          <p className="font-extrabold">
                            تنبيه هام: الدفع ({pmLabel}) — لم يتم إرفاق صورة تحويل!
                          </p>
                          <p className="text-[11px] font-semibold text-rose-800">
                            لا تبدأ بتجهيز الطلب قبل التحقق من إتمام التحويل والتواصل مع الإدارة أو العميل.
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                      <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                        <CreditCard className="w-4 h-4 text-slate-500" />
                        <span>طريقة الدفع: {pmLabel}</span>
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600">
                        {pm === 'cash'
                          ? 'التحصيل نقدًا مع الطيار عند التسليم'
                          : pm === 'network'
                          ? 'التحصيل عبر ماكينة POS مع الطيار'
                          : 'دفع عبر المحفظة الإلكترونية'}
                      </span>
                    </div>
                  );
                })()}

                {/* Items List with Partial Rejection */}
                {renderOrderItems(order)}

                {/* Cancellation / Partial Rejection Notes */}
                {(view.myRejectionReason || view.mySubNote) && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>{view.myStatus === 'cancelled' ? 'سبب رفض الفاتورة:' : 'تحديث الأصناف:'}</strong>{' '}
                      {view.myRejectionReason || view.mySubNote}
                    </div>
                  </div>
                )}

                {/* Quote field if awaiting_quote (Free text or Pharmacy Rx) */}
                {canAct && view.myStatus === 'awaiting_quote' && view.myItems.length === 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        سعر أصناف متجرك بالـ ج.م *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={quoteMap[order.id] ?? view.mySubtotal}
                        onChange={(e) => setQuoteMap({ ...quoteMap, [order.id]: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {merchant.merchant_type === 'pharmacy'
                          ? 'ملاحظات الصيدلي / بديل مقترح (اختياري)'
                          : 'ملاحظات التجهيز (اختياري)'}
                      </label>
                      <input
                        type="text"
                        value={rxNoteMap[order.id] ?? view.myNotes ?? ''}
                        onChange={(e) => setRxNoteMap({ ...rxNoteMap, [order.id]: e.target.value })}
                        placeholder="أدخل أي ملاحظة للعميل..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Action Bar: "الطلب جاهز" & "رفض الفاتورة بالكامل" */}
                {!isSectionClosed && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    {canAct ? (
                      <>
                        <button
                          type="button"
                          disabled={busyOrderId === order.id}
                          onClick={() => {
                            setRejectInvoiceOrder(order);
                            setInvoiceRejectReason('');
                          }}
                          className="px-4 py-2.5 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <Ban className="w-4 h-4" />
                          <span>رفض طلب متجري (مع السبب)</span>
                        </button>

                        <button
                          type="button"
                          disabled={busyOrderId === order.id}
                          onClick={() => handleMarkOrderReady(order)}
                          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2 shadow-sm min-h-[42px]"
                        >
                          <PackageCheck className="w-4 h-4" />
                          <span>{busyOrderId === order.id ? 'جاري التأكيد...' : 'الطلب جاهز'}</span>
                        </button>
                      </>
                    ) : (
                      <div className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-teal-50 border border-teal-200 rounded-xl text-xs font-bold text-teal-800">
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                          <span>
                            تم تأكيد تجهيز طلب متجرك ✓
                            {order.captain_name ? ` · الطيار: ${order.captain_name}` : ' · بانتظار استلام الطيار'}
                          </span>
                        </span>
                        <span className="text-[11px] font-mono-num text-teal-700 shrink-0">
                          {view.mySubtotal} ج.م
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Full Invoice Rejection Modal (Mandatory Reason) */}
      {rejectInvoiceOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65">
          <form
            onSubmit={handleConfirmRejectInvoice}
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
          >
            <div className="bg-rose-700 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-bold">
                رفض وإلغاء الفاتورة #{rejectInvoiceOrder.order_number}
              </h3>
              <button
                type="button"
                onClick={() => setRejectInvoiceOrder(null)}
                className="p-1 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700 leading-relaxed">
                سيتم إلغاء الفاتورة بالكامل وإبلاغ العميل ({rejectInvoiceOrder.customer_name}) بالسبب المذكور أدناه:
              </p>
              <div>
                <label className="block font-bold text-slate-900 mb-1">سبب رفض الفاتورة (إلزامي) *</label>
                <textarea
                  rows={3}
                  required
                  value={invoiceRejectReason}
                  onChange={(e) => setInvoiceRejectReason(e.target.value)}
                  placeholder="مثال: جميع الأصناف المطلوبة غير متوفرة حاليًا أو المتجر مغلق للصيانة..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['نفاد جميع الأصناف المطلوبة', 'المتجر مغلق حاليًا', 'الكمية غير متوفرة حاليًا'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setInvoiceRejectReason(preset)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-medium"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectInvoiceOrder(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
              >
                تراجع
              </button>
              <button
                type="submit"
                disabled={!invoiceRejectReason.trim() || busyOrderId === rejectInvoiceOrder.id}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold"
              >
                تأكيد رفض الفاتورة وإلغائها
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Transfer Proof Full-Size Lightbox Modal */}
      {previewProofModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80"
          onClick={() => setPreviewProofModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold truncate">
                  إيصال التحويل — طلب #{previewProofModal.orderNumber}
                </h3>
                <p className="text-[11px] text-slate-300">
                  {previewProofModal.methodLabel} · قيمة متجرك {previewProofModal.storeSubtotal} ج.م (الإجمالي {previewProofModal.totalAmount} ج.م)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewProofModal(null)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 flex items-center justify-center max-h-[70vh] overflow-auto">
              <img
                src={previewProofModal.url}
                alt={`إيصال التحويل للطلب ${previewProofModal.orderNumber}`}
                className="max-w-full max-h-[64vh] object-contain rounded-xl border border-slate-200 bg-white shadow-sm"
              />
            </div>
            <div className="p-3.5 bg-white border-t border-slate-100 flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold text-teal-800">
                تأكد من مطابقة المبلغ وبيانات التحويل قبل تجهيز الطلب
              </span>
              <button
                type="button"
                onClick={() => setPreviewProofModal(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
