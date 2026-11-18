import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileWarning,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  Store,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Language, MerchantRecord, OrderItemRecord, OrderRecord } from '../shared/types.ts';
import { CatalogSection } from './CatalogSection.tsx';

interface Props {
  lang: Language;
  merchant: MerchantRecord;
  orders: OrderRecord[];
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
  onRefresh,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [merchantSubTab, setMerchantSubTab] = useState<'orders' | 'catalog'>('orders');
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
        ws.onmessage = () => {
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

  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.merchant_id === merchant.id || (o.store_sections?.some((s) => s.merchant_id === merchant.id) ?? false)
      ),
    [orders, merchant.id]
  );

  const filteredOrders = useMemo(() => {
    return myOrders.filter((o) => {
      if (filter === 'all') return true;
      if (filter === 'active') {
        return ['awaiting_quote', 'pending_merchant', 'preparing'].includes(o.status);
      }
      if (filter === 'ready') {
        return ['ready_for_pickup', 'on_the_way'].includes(o.status);
      }
      if (filter === 'delivered') return o.status === 'delivered';
      if (filter === 'cancelled') return o.status === 'cancelled';
      return true;
    });
  }, [myOrders, filter]);

  const activeCount = myOrders.filter((o) =>
    ['awaiting_quote', 'pending_merchant', 'preparing'].includes(o.status)
  ).length;
  const readyCount = myOrders.filter((o) =>
    ['ready_for_pickup', 'on_the_way'].includes(o.status)
  ).length;

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
      onNotify(isAr ? `تم رفض وإلغاء الفاتورة #${ordNum} وإرسال السبب للعميل` : 'Invoice rejected');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleMarkOrderReady = async (order: OrderRecord) => {
    setBusyOrderId(order.id);
    try {
      const subtotalVal = quoteMap[order.id] ?? order.subtotal;
      const res = await api.merchantOrderAction(order.id, {
        action: 'ready',
        merchant_id: merchant.id,
        subtotal: subtotalVal,
        pharmacist_notes: rxNoteMap[order.id] ?? order.pharmacist_notes,
        prescription_status: order.merchant_type === 'pharmacy' ? 'reviewed' : order.prescription_status,
        assign_best_captain: true,
      });
      await onRefresh();
      onNotify(
        res.assigned_captain
          ? isAr
            ? `تم تأكيد أن الطلب #${order.order_number} جاهز وإسناده للطيار: ${res.assigned_captain}`
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
    const items: OrderItemRecord[] = Array.isArray(order.items) ? order.items : [];
    const canModify = !['delivered', 'cancelled', 'on_the_way'].includes(order.status);
    const selectedMap = itemRejectState[order.id] || {};
    const selectedCount = Object.values(selectedMap).filter((v) => v.selected).length;

    if (items.length === 0) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          {order.prescription_image_url && (
            <div className="flex items-start gap-3">
              <a
                href={order.prescription_image_url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 border border-slate-200 rounded-lg overflow-hidden bg-white"
              >
                <img
                  src={order.prescription_image_url}
                  alt={order.order_number}
                  referrerPolicy="no-referrer"
                  className="w-20 h-20 object-cover"
                />
              </a>
              <p className="text-xs text-slate-600">صورة الروشتة المرفقة من العميل — اضغط لعرضها بحجم كامل</p>
            </div>
          )}
          <p className="text-xs text-slate-800 leading-relaxed">
            <strong>{order.order_channel === 'prescription' ? 'تفاصيل الروشتة:' : 'محتويات الطلب:'}</strong>{' '}
            {order.free_order_text || 'طلب كتالوج مسعّر'}
          </p>
        </div>
      );
    }

    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
          <span>أصناف الفاتورة ({items.length})</span>
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
      {/* Merchant Portal Navigation Switcher */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
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
            onClick={() => setMerchantSubTab('catalog')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              merchantSubTab === 'catalog'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>{isAr ? 'إدارة المنتجات والأقسام (إضافة وتعديل)' : 'Products & Catalog'}</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 px-3 font-semibold">
          {merchant.business_name_ar} · <span className="text-teal-700 font-bold">{merchant.branch_name}</span>
        </div>
      </div>

      {merchantSubTab === 'catalog' ? (
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
                    ? 'تظهر هنا فقط الطلبات الموجهة لمتجرك؛ يمكنك تأكيد جاهزية الطلب أو رفض أصناف محددة أو رفض الفاتورة مع ذكر السبب.'
                    : 'Incoming orders for your store only.'}
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
            const canAct = !['delivered', 'cancelled'].includes(order.status);
            const isReadyOrFurther = ['ready_for_pickup', 'on_the_way', 'delivered'].includes(order.status);
            const statusText = STATUS_AR[order.status] || order.status;

            return (
              <div
                key={order.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${
                  order.status === 'cancelled'
                    ? 'border-rose-200 bg-rose-50/20'
                    : isReadyOrFurther
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
                          order.status === 'cancelled'
                            ? 'bg-rose-100 text-rose-800'
                            : order.status === 'ready_for_pickup'
                            ? 'bg-teal-100 text-teal-800'
                            : order.status === 'delivered'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {statusText}
                      </span>
                      {order.is_express && (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded text-[11px] font-bold">
                          عاجل Express
                        </span>
                      )}
                      {order.payment_method === 'network' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-blue-100 text-blue-800">
                          💳 دفع شبكة / POS
                        </span>
                      ) : order.payment_method === 'wallet' ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-purple-100 text-purple-800">
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
                    <p className="text-xs text-slate-500">قيمة الأصناف</p>
                    <p className="text-base font-bold text-slate-900">{order.subtotal} ج.م</p>
                    <p className="text-[11px] text-slate-500">
                      إجمالي الفاتورة بالعميل: {order.total_amount} ج.م
                    </p>
                  </div>
                </div>

                {/* Items List with Partial Rejection */}
                {renderOrderItems(order)}

                {/* Cancellation / Partial Rejection Notes */}
                {(order.rejection_reason || order.substitution_note) && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>{order.status === 'cancelled' ? 'سبب رفض الفاتورة:' : 'تحديث الأصناف:'}</strong>{' '}
                      {order.rejection_reason || order.substitution_note}
                    </div>
                  </div>
                )}

                {/* Quote field if awaiting_quote (Free text or Pharmacy Rx) */}
                {canAct && order.status === 'awaiting_quote' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        سعر الأصناف بالـ ج.م *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={quoteMap[order.id] ?? order.subtotal}
                        onChange={(e) => setQuoteMap({ ...quoteMap, [order.id]: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {order.merchant_type === 'pharmacy'
                          ? 'ملاحظات الصيدلي / بديل مقترح (اختياري)'
                          : 'ملاحظات التجهيز (اختياري)'}
                      </label>
                      <input
                        type="text"
                        value={rxNoteMap[order.id] ?? order.pharmacist_notes ?? ''}
                        onChange={(e) => setRxNoteMap({ ...rxNoteMap, [order.id]: e.target.value })}
                        placeholder="أدخل أي ملاحظة للعميل..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Action Bar: "الطلب جاهز" & "رفض الفاتورة بالكامل" */}
                {canAct && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
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
                      <span>رفض الفاتورة بالكامل (مع السبب)</span>
                    </button>

                    {order.status !== 'ready_for_pickup' && order.status !== 'on_the_way' ? (
                      <button
                        type="button"
                        disabled={busyOrderId === order.id}
                        onClick={() => handleMarkOrderReady(order)}
                        className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2 shadow-sm min-h-[42px]"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>{busyOrderId === order.id ? 'جاري التأكيد...' : 'الطلب جاهز'}</span>
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3.5 py-2 bg-teal-50 border border-teal-200 rounded-xl text-xs font-bold text-teal-800">
                        <CheckCircle2 className="w-4 h-4 text-teal-600" />
                        <span>
                          تم تأكيد جاهزية الطلب
                          {order.captain_name ? ` · الطيار: ${order.captain_name}` : ' · بانتظار استلام الطيار'}
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
        </>
      )}
    </div>
  );
};
